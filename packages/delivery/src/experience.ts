import { z } from 'zod';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  delegationContextInput,
  agendaInput,
  missionExperienceInput,
  recipientDisclosureInput,
  participantIdentityInput,
} from '@corridra/domain/experience';
export class DeliveryExperienceService {
  constructor(private pool: DatabasePool) {}
  workspace(ctx: RequestContext, programmeId?: string, missionId?: string) {
    if (programmeId) z.uuid().parse(programmeId);
    if (missionId) z.uuid().parse(missionId);
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db }) => ({
      contexts: (
        await db.query(
          'SELECT * FROM app.delivery_programme_context WHERE tenant_id=$1 AND programme_id=$2 ORDER BY version DESC LIMIT 20',
          [ctx.tenantId, programmeId ?? null],
        )
      ).rows,
      agenda: (
        await db.query(
          'SELECT * FROM app.delivery_agenda WHERE tenant_id=$1 AND programme_id=$2 ORDER BY created_at DESC LIMIT 200',
          [ctx.tenantId, programmeId ?? null],
        )
      ).rows,
      requirements: (
        await db.query(
          'SELECT id,version,fields FROM app.mission_requirements WHERE tenant_id=$1 AND mission_id=$2 ORDER BY version DESC LIMIT 20',
          [ctx.tenantId, missionId ?? null],
        )
      ).rows,
      targets: (
        await db.query(
          'SELECT t.id,o.name FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation o ON o.id=r.organisation_id WHERE t.tenant_id=$1 AND t.mission_id=$2 ORDER BY o.name LIMIT 100',
          [ctx.tenantId, missionId ?? null],
        )
      ).rows,
      quotations: (
        await db.query(
          'SELECT id,target_id,currency,revision,uncertainties FROM app.mission_quotation WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at DESC LIMIT 100',
          [ctx.tenantId, missionId ?? null],
        )
      ).rows,
      links: (
        await db.query(
          "SELECT l.id,c.presentation->>'company' company,c.target_id,t.mission_id FROM app.buyer_link l JOIN app.communication c ON c.tenant_id=l.tenant_id AND c.id=l.message_id JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id WHERE l.tenant_id=$1 ORDER BY l.created_at DESC LIMIT 100",
          [ctx.tenantId],
        )
      ).rows,
      organisations: (
        await db.query(
          "SELECT o.id,o.name,s.id source_id,c.id claim_id FROM app.organisation o JOIN app.organisation_source os ON os.organisation_id=o.id JOIN app.source_record s ON s.tenant_id=os.tenant_id AND s.id=os.source_id JOIN app.claim c ON c.tenant_id=s.tenant_id AND c.source_id=s.id WHERE os.tenant_id=$1 AND s.classification='PUBLIC' AND s.retention_until>now() ORDER BY o.name LIMIT 100",
          [ctx.tenantId],
        )
      ).rows,
      rfqs: (
        await db.query(
          'SELECT id,target_ids FROM app.mission_rfq WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at DESC LIMIT 30',
          [ctx.tenantId, missionId ?? null],
        )
      ).rows,
      disclosures: (
        await db.query(
          'SELECT id,link_id,role,shared_requirements,uncertainty,allow_quotation,allow_meeting_interest FROM app.recipient_disclosure WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
          [ctx.tenantId],
        )
      ).rows,
      responses: (
        await db.query(
          'SELECT id,link_id,body,source_kind,created_at FROM app.recipient_detail_response WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
          [ctx.tenantId],
        )
      ).rows,
    }));
  }
  context(ctx: RequestContext, input: unknown) {
    const { commandId, programmeId, version, ...details } = delegationContextInput.parse(input);
    return this.insert(ctx, 'delivery.manage', 'delivery_programme_context', commandId, {
      programme_id: programmeId,
      version,
      details,
    });
  }
  async agenda(ctx: RequestContext, input: unknown) {
    const { commandId, programmeId, itemId, version, ...details } = agendaInput.parse(input);
    return this.insert(
      ctx,
      'delivery.manage',
      'delivery_agenda',
      commandId,
      { programme_id: programmeId, item_id: itemId, version, details },
      async (db) => {
        const meetings = (
          await db.query(
            'SELECT id,version FROM app.meeting WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
            [ctx.tenantId, details.meetingIds],
          )
        ).rows;
        if (meetings.length !== details.meetingIds.length)
          throw new DomainError('Meeting scope unavailable', 403);
        return { details: { ...details, meetingVersions: meetings } };
      },
    );
  }
  publication(ctx: RequestContext, input: unknown) {
    const {
      commandId,
      publicationId,
      requirementId,
      targetIds,
      quotationIds,
      agendaItemIds,
      approved: _approved,
      reason,
    } = missionExperienceInput.parse(input);
    void _approved;
    return this.insert(
      ctx,
      'delivery.share',
      'delivery_experience_publication',
      commandId,
      {
        publication_id: publicationId,
        requirement_id: requirementId,
        target_ids: targetIds,
        quotation_ids: quotationIds,
        agenda_item_ids: agendaItemIds,
        reason,
      },
      async (db) => ({
        target_snapshots: (
          await db.query(
            'SELECT t.id,(SELECT a.id FROM app.match_assessment a WHERE a.tenant_id=t.tenant_id AND a.target_id=t.id ORDER BY a.version DESC LIMIT 1) "assessmentId" FROM app.target_account t WHERE t.tenant_id=$1 AND t.id=ANY($2::uuid[]) ORDER BY t.id',
            [ctx.tenantId, targetIds],
          )
        ).rows,
      }),
    );
  }
  disclosure(ctx: RequestContext, input: unknown) {
    const {
      commandId,
      linkId,
      role,
      sharedRequirements,
      uncertainty,
      rfqId,
      allowQuotation,
      allowMeetingInterest,
      approved: _approved,
      reason,
    } = recipientDisclosureInput.parse(input);
    void _approved;
    return this.insert(ctx, 'delivery.share', 'recipient_disclosure', commandId, {
      link_id: linkId,
      role,
      shared_requirements: sharedRequirements,
      uncertainty,
      rfq_id: rfqId,
      allow_quotation: allowQuotation,
      allow_meeting_interest: allowMeetingInterest,
      reason,
    });
  }
  identity(ctx: RequestContext, input: unknown) {
    const {
      commandId,
      participantId,
      organisationId,
      sourceId,
      claimId,
      reason,
      approved: _approved,
    } = participantIdentityInput.parse(input);
    void _approved;
    return this.insert(ctx, 'delivery.share', 'delivery_participant_identity', commandId, {
      participant_id: participantId,
      organisation_id: organisationId,
      source_id: sourceId,
      claim_id: claimId,
      reason,
    });
  }
  private insert(
    ctx: RequestContext,
    permission: 'delivery.manage' | 'delivery.share',
    table: string,
    id: string,
    values: Record<string, unknown>,
    derive?: (db: TenantTransaction['db']) => Promise<Record<string, unknown>>,
  ) {
    return withTenant(this.pool, ctx, permission, async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id]);
      const old = (
        await db.query(`SELECT * FROM app.${table} WHERE tenant_id=$1 AND id=$2`, [
          ctx.tenantId,
          id,
        ])
      ).rows[0];
      if (old) {
        const normalize = (v: unknown): unknown =>
          Array.isArray(v)
            ? v.map(normalize)
            : v && typeof v === 'object'
              ? Object.fromEntries(
                  Object.entries(v)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, x]) => [k, normalize(x)]),
                )
              : v;
        for (const [key, value] of Object.entries(values)) {
          const previous =
            key === 'details' && old.details
              ? Object.fromEntries(
                  Object.entries(old.details).filter(([k]) => k !== 'meetingVersions'),
                )
              : old[key];
          if (
            JSON.stringify(normalize(previous)) !== JSON.stringify(normalize(value)) ||
            old.created_by !== actorId
          )
            throw new DomainError('Command key reused', 409);
        }
        return { id };
      }
      const data = { ...values, ...(derive ? await derive(db) : {}) };
      const entries = Object.entries(data);
      await db.query(
        `INSERT INTO app.${table}(id,tenant_id,created_by,${entries.map(([key]) => key).join(',')}) VALUES($1,$2,$3,${entries.map(([key], i) => `$${i + 4}${['details', 'target_snapshots'].includes(key) ? '::jsonb' : ''}`).join(',')})`,
        [
          id,
          ctx.tenantId,
          actorId,
          ...entries.map(([key, value]) =>
            ['details', 'target_snapshots'].includes(key) ? JSON.stringify(value) : value,
          ),
        ],
      );
      return { id };
    });
  }
}
