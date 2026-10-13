import { createHash, createHmac } from 'node:crypto';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { buyerRequest, communicationCommand } from '@corridra/domain/access';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class CommunicationService {
  constructor(
    private pool: DatabasePool,
    private secret: string,
  ) {}
  private capability(kind: 'buyer' | 'dispatch', id: string) {
    return createHmac('sha256', this.secret).update(`part06:${kind}:${id}`).digest('hex');
  }
  dispatchCapability(id: string) {
    return this.capability('dispatch', id);
  }
  async budget(client: string, token: string) {
    const key = (v: string) =>
      createHmac('sha256', this.secret).update(`buyer-budget:${v}`).digest('hex');
    const r = await this.pool.query(
      'SELECT app.intake_budget($1,60) AS client,app.intake_budget($2,60) AS token,app.intake_budget($3,60) AS global',
      [key(client), key(token), key('global')],
    );
    if (!r.rows[0].client || !r.rows[0].token || !r.rows[0].global)
      throw new DomainError('Too many requests. Try again in an hour.', 429);
  }
  async buyer(input: unknown) {
    const v = buyerRequest.parse(input);
    if (v.action === 'optout') {
      const r = await this.pool.query('SELECT app.buyer_optout($1) AS result', [hash(v.token)]);
      if (!r.rows[0].result)
        throw new DomainError('This private link is unavailable or expired', 404);
      return { optedOut: true };
    }
    if (v.action === 'detail-response') {
      const { token, responseId, action: _action, ...body } = v;
      void _action;
      const r = await this.pool.query(
        'SELECT app.recipient_detail_respond($1,$2,$3::jsonb) result',
        [hash(token), responseId, JSON.stringify(body)],
      );
      if (!r.rows[0].result)
        throw new DomainError('This private link is unavailable or expired', 404);
      return r.rows[0].result;
    }
    const r =
      v.action === 'read'
        ? await this.pool.query('SELECT app.recipient_detail_view($1) AS result', [hash(v.token)])
        : await this.pool.query('SELECT app.buyer_decide($1,$2,$3,$4) AS result', [
            hash(v.token),
            v.responseId,
            v.decision,
            v.optOut,
          ]);
    if (!r.rows[0].result)
      throw new DomainError('This private link is unavailable or expired', 404);
    return r.rows[0].result;
  }
  workspace(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'communications.read', async ({ db, role }) => {
      const policies = (
        await db.query(
          'SELECT DISTINCT ON(jurisdiction,channel,contact_purpose) * FROM app.communication_policy WHERE tenant_id=$1 ORDER BY jurisdiction,channel,contact_purpose,version DESC',
          [ctx.tenantId],
        )
      ).rows;
      const templates = (
        await db.query(
          'SELECT DISTINCT ON(name) * FROM app.communication_template WHERE tenant_id=$1 ORDER BY name,version DESC',
          [ctx.tenantId],
        )
      ).rows;
      const targets = (
        await db.query(
          `SELECT t.id,t.mission_id,t.relationship_id,o.name,m.status AS mission_status,i.brief->>'company' AS supplier
        FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation o ON o.id=r.organisation_id
        JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id
        WHERE t.tenant_id=$1 AND m.status IN ('TARGETING','OUTREACH','MEETINGS') ORDER BY t.created_at DESC LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const contacts = (
        await db.query(
          'SELECT id,relationship_id,name,email,valid_until FROM app.private_contact_data WHERE tenant_id=$1 AND valid_until>now() ORDER BY created_at DESC LIMIT 100',
          [ctx.tenantId],
        )
      ).rows;
      const messages = (
        await db.query(
          `SELECT c.*,p.channel,l.id AS link_id,br.status AS decision,br.id AS response_id,br.created_at AS response_at,j.status AS delivery_status,j.attempts,j.last_error,j.workflow_run_id,
        EXISTS(SELECT FROM app.buyer_link_revocation r WHERE r.tenant_id=l.tenant_id AND r.link_id=l.id) AS revoked
        FROM app.communication c JOIN app.communication_policy p ON p.tenant_id=c.tenant_id AND p.id=c.policy_id LEFT JOIN app.buyer_link l ON l.tenant_id=c.tenant_id AND l.message_id=c.id
        LEFT JOIN app.buyer_response br ON br.tenant_id=l.tenant_id AND br.link_id=l.id LEFT JOIN app.communication_dispatch j ON j.tenant_id=c.tenant_id AND j.id=c.id
        WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 50`,
          [ctx.tenantId],
        )
      ).rows;
      const optouts = (
        await db.query(
          'SELECT id,contact_id,reason,created_at FROM app.communication_optout WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',
          [ctx.tenantId],
        )
      ).rows;
      const attempts = (
        await db.query(
          'SELECT * FROM app.communication_attempt WHERE tenant_id=$1 AND message_id=ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 100',
          [ctx.tenantId, messages.map((m) => m.id)],
        )
      ).rows;
      return { role, policies, templates, targets, contacts, messages, optouts, attempts };
    });
  }
  async command(ctx: RequestContext, input: unknown) {
    const v = communicationCommand.parse(input),
      digest = hash(JSON.stringify(v));
    const result = await withTenant(
      this.pool,
      ctx,
      ['policy', 'template'].includes(v.action)
        ? 'communications.approve'
        : 'communications.manage',
      async ({ db, actorId }) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${ctx.tenantId}:communications`,
        ]);
        const old = (
          await db.query('SELECT * FROM app.communication_command WHERE tenant_id=$1 AND id=$2', [
            ctx.tenantId,
            v.commandId,
          ])
        ).rows[0];
        if (old) {
          if (old.input_hash !== digest || old.created_by !== actorId)
            throw new DomainError('Command key reused with different values', 409);
          return old.result as { id: string };
        }
        let id = v.commandId;
        if (v.action === 'policy') {
          const r = await db.query(
            `INSERT INTO app.communication_policy(tenant_id,jurisdiction,channel,contact_purpose,version,basis,enabled,valid_until,created_by)
          SELECT $1,$2,$3,$4,coalesce(max(version),0)+1,$5,$6,$7,$8 FROM app.communication_policy WHERE tenant_id=$1 AND jurisdiction=$2 AND channel=$3 AND contact_purpose=$4 RETURNING id`,
            [
              ctx.tenantId,
              v.jurisdiction,
              v.channel,
              v.contactPurpose,
              v.basis,
              v.enabled,
              v.validUntil,
              actorId,
            ],
          );
          id = r.rows[0].id;
        } else if (v.action === 'template') {
          const r = await db.query(
            `INSERT INTO app.communication_template(tenant_id,name,version,contact_purpose,body,created_by)
          SELECT $1,$2,coalesce(max(version),0)+1,$3,$4,$5 FROM app.communication_template WHERE tenant_id=$1 AND name=$2 RETURNING id`,
            [ctx.tenantId, v.name, v.contactPurpose, v.body, actorId],
          );
          id = r.rows[0].id;
        } else if (v.action === 'introduce') {
          const enabled = (
            await db.query(
              "SELECT app.communication_enabled($1,'communications.introductions') AS enabled",
              [ctx.tenantId],
            )
          ).rows[0].enabled;
          if (!enabled) throw new DomainError('New introductions are disabled', 409);
          await db.query(
            'INSERT INTO app.communication(id,tenant_id,target_id,contact_id,policy_id,template_id,presentation,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
            [
              id,
              ctx.tenantId,
              v.targetId,
              v.contactId,
              v.policyId,
              v.templateId,
              JSON.stringify(v.introduction),
              v.expiresAt,
              actorId,
            ],
          );
          await db.query(
            'INSERT INTO app.buyer_link(id,tenant_id,message_id,token_hash,created_by) VALUES($1,$2,$1,$3,$4)',
            [id, ctx.tenantId, hash(this.capability('buyer', id)), actorId],
          );
          await db.query('SELECT app.queue_communication($1,$2)', [
            id,
            hash(this.dispatchCapability(id)),
          ]);
        } else if (v.action === 'revoke') {
          const l = (
            await db.query('SELECT * FROM app.buyer_link WHERE tenant_id=$1 AND id=$2', [
              ctx.tenantId,
              v.linkId,
            ])
          ).rows[0];
          if (!l) throw new DomainError('Introduction unavailable', 404);
          const r = await db.query(
            'INSERT INTO app.buyer_link_revocation(tenant_id,link_id,reason,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,link_id) DO NOTHING RETURNING id',
            [ctx.tenantId, v.linkId, v.reason, actorId],
          );
          id =
            r.rows[0]?.id ??
            (
              await db.query(
                'SELECT id FROM app.buyer_link_revocation WHERE tenant_id=$1 AND link_id=$2',
                [ctx.tenantId, v.linkId],
              )
            ).rows[0].id;
        } else if (v.action === 'optout') {
          const r = await db.query(
            `INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by)
          SELECT $1,id,encode(sha256(convert_to(lower(email),'UTF8')),'hex'),$3,$4 FROM app.private_contact_data WHERE tenant_id=$1 AND id=$2 ON CONFLICT(tenant_id,recipient_key) DO NOTHING RETURNING id`,
            [ctx.tenantId, v.contactId, v.reason, actorId],
          );
          if (!r.rowCount) {
            const existing = await db.query(
              "SELECT o.id FROM app.communication_optout o JOIN app.private_contact_data pc ON pc.tenant_id=o.tenant_id AND o.recipient_key=encode(sha256(convert_to(lower(pc.email),'UTF8')),'hex') WHERE pc.tenant_id=$1 AND pc.id=$2",
              [ctx.tenantId, v.contactId],
            );
            if (!existing.rowCount) throw new DomainError('Contact unavailable', 404);
            id = existing.rows[0].id;
          } else id = r.rows[0].id;
        } else if (v.action === 'retry') {
          await db.query('SELECT app.retry_communication($1,$2)', [v.messageId, v.reason]);
          id = v.messageId;
        }
        const result = { id };
        await db.query(
          'INSERT INTO app.communication_command(id,tenant_id,action,input_hash,result,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
          [v.commandId, ctx.tenantId, v.action, digest, JSON.stringify(result), actorId],
        );
        return result;
      },
    );
    return v.action === 'introduce'
      ? { ...result, buyerPath: `/buyer#${this.capability('buyer', result.id)}` }
      : result;
  }
  pending(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'communications.manage', async ({ db }) => {
      if (
        !(
          await db.query(
            "SELECT app.communication_enabled($1,'communications.dispatch') AS enabled",
            [ctx.tenantId],
          )
        ).rows[0].enabled
      )
        throw new DomainError('Dispatch is disabled', 409);
      return (
        await db.query(
          "SELECT id FROM app.communication_dispatch WHERE tenant_id=$1 AND status IN ('PENDING','RUNNING') AND available_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY available_at LIMIT 20",
          [ctx.tenantId],
        )
      ).rows as { id: string }[];
    });
  }
  started(ctx: RequestContext, id: string, runId: string) {
    return withTenant(this.pool, ctx, 'communications.manage', async ({ db }) => {
      await db.query('SELECT app.communication_started($1,$2)', [id, runId]);
    });
  }
}
