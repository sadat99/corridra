import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError, role } from '@corridra/domain';
import { setupIdentifier, setupInvitation } from './operator-setup';

// Team invitations (CQ-74, D8) and authenticator reset (V-03) for the workspace owner.
//
// Authority: every write first passes withTenant('members.manage'), which needs the workspace
// owner and an authenticator check from the last five minutes (otherwise STEP_UP_REQUIRED). The
// membership row is written through the runtime pool, so the existing RLS policy still decides.
// Identity rows are written with the restricted auth pool, the same role the operator setup and
// contributor invitations use. Nothing here touches customer identity, and nothing matches people by
// email similarity: an existing team sign-in with the exact same email is refused, never merged.
//
// Invitations reuse the operator invitation model: a disabled identity, a pending membership and a
// 7-day identity.verification row that OperatorSetup.complete consumes unchanged. Resend writes a
// new row with a new 7-day window; cancel deletes the row and revokes the pending membership.
// Audit: the restricted auth role cannot write the security log directly (migration 0029), so the
// record comes from the existing database triggers. Invite and cancel change app.membership, which
// app.record_change writes to the workspace audit log (app.domain_event) with the owner as actor.
// An authenticator reset sets twoFactorEnabled=false, which identity.record_mfa_change writes as
// 'mfa.disabled', and ending the sessions writes 'session.delete'. Writing the acting owner next to
// the reset and the resend needs a reviewed database function (lead integration note).

export const teamInviteInput = z
  .object({
    commandId: z.uuid(),
    email: z.email().max(254),
    name: z.string().trim().min(1).max(80),
    role,
  })
  .strict();
const inviteRef = z.object({ invitationId: z.uuid() }).strict();
const resetInput = z.object({ userId: z.uuid() }).strict();

export type TeamInvitation = {
  id: string;
  principalId: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  state: 'PENDING' | 'EXPIRED';
};

const identifierPrefix = 'corridra-operator-setup:';

async function authorize(runtime: DatabasePool, ctx: RequestContext) {
  return withTenant(runtime, ctx, 'members.manage', async (t) => ({
    actorId: t.actorId,
    tenantId: t.tenantId,
  }));
}

async function inAuth<T>(
  auth: DatabasePool,
  work: (q: DatabasePool['query']) => Promise<T>,
): Promise<T> {
  const db = await auth.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db.query.bind(db) as DatabasePool['query']);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export class TeamControl {
  constructor(
    private runtime: DatabasePool,
    private auth: DatabasePool,
  ) {}

  /** Pending and expired team invitations of this workspace. Owner and admin may read them. */
  async list(ctx: RequestContext): Promise<TeamInvitation[]> {
    await withTenant(this.runtime, ctx, 'audit.read', async () => null);
    const rows = (
      await this.auth.query(
        `SELECT v.id,v.value,v."createdAt",v."expiresAt",u.name,u.email
         FROM identity.verification v
         JOIN identity."user" u ON u.id=(v.value::jsonb->>'userId')
         WHERE v.identifier LIKE $1 AND v.value::jsonb->>'tenantId'=$2
           AND v.value::jsonb->>'role'<>'contributor'
         ORDER BY v."createdAt" DESC LIMIT 100`,
        [identifierPrefix + '%', ctx.tenantId],
      )
    ).rows;
    return rows.map((r) => {
      const invite = setupInvitation.parse(JSON.parse(r.value));
      return {
        id: r.id,
        principalId: invite.principalId,
        name: r.name,
        email: r.email,
        role: invite.role,
        createdAt: new Date(r.createdAt).toISOString(),
        expiresAt: new Date(r.expiresAt).toISOString(),
        state: new Date(r.expiresAt) > new Date() ? 'PENDING' : 'EXPIRED',
      };
    });
  }

  /** Creates a pending team member and a 7-day setup invitation. Owner only, fresh check. */
  async invite(ctx: RequestContext, input: unknown) {
    const v = teamInviteInput.parse(input);
    const { actorId, tenantId } = await authorize(this.runtime, ctx);
    const email = v.email.trim().toLowerCase();
    const identifier = setupIdentifier(email);
    const pending = await inAuth(this.auth, async (q) => {
      await q('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identifier]);
      const replay = await q('SELECT id FROM identity.verification WHERE id=$1', [v.commandId]);
      if (replay.rowCount) throw new DomainError('This invitation was already sent.', 409);
      // Exact match only. A person who already has a team sign-in is never merged or reset here.
      if ((await q('SELECT 1 FROM identity."user" WHERE lower(email)=$1', [email])).rowCount)
        throw new DomainError(
          'This email already has a Corridra team sign-in. Change their access in the member list instead.',
          409,
        );
      const inviter = (
        await q('SELECT operating_country FROM identity.principal WHERE id=$1', [actorId])
      ).rows[0];
      if (!inviter) throw new DomainError('Access denied');
      const userId = randomUUID(),
        principalId = randomUUID();
      await q(
        'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,false,false)',
        [userId, v.name, email],
      );
      await q(
        'INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',
        [randomUUID(), userId, await hashPassword(randomBytes(48).toString('base64url'))],
      );
      await q(
        'INSERT INTO identity.principal(id,identity_id,operating_country,disabled_at) VALUES($1,$2,$3,now())',
        [principalId, userId, inviter.operating_country],
      );
      const invite = setupInvitation.parse({
        userId,
        principalId,
        tenantId,
        role: v.role,
        commandId: v.commandId,
        approvedBy: actorId,
      });
      await q(
        'INSERT INTO identity.verification(id,identifier,value,"expiresAt") VALUES($1,$2,$3,now()+interval \'7 days\')',
        [v.commandId, identifier, JSON.stringify(invite)],
      );
      return { userId, principalId, country: inviter.operating_country as string };
    });
    try {
      await withTenant(this.runtime, ctx, 'members.manage', async (t) => {
        await t.db.query(
          'INSERT INTO app.membership(tenant_id,user_id,role,allowed_countries) VALUES($1,$2,$3,$4)',
          [t.tenantId, pending.principalId, v.role, [pending.country]],
        );
      });
    } catch (error) {
      // The disabled identity stays (its history is kept) but can no longer be set up.
      await this.auth.query('DELETE FROM identity.verification WHERE id=$1', [v.commandId]);
      throw error;
    }
    return {
      id: v.commandId,
      principalId: pending.principalId,
      role: v.role,
      expiresInDays: 7,
    };
  }

  /** A new 7-day window for a pending or expired invitation. Owner only, fresh check. */
  async resend(ctx: RequestContext, input: unknown) {
    const { invitationId } = inviteRef.parse(input);
    const { tenantId } = await authorize(this.runtime, ctx);
    return inAuth(this.auth, async (q) => {
      const row = (
        await q(
          'SELECT id,identifier,value FROM identity.verification WHERE id=$1 AND identifier LIKE $2 FOR UPDATE',
          [invitationId, identifierPrefix + '%'],
        )
      ).rows[0];
      const invite = row ? setupInvitation.parse(JSON.parse(row.value)) : null;
      if (!row || !invite || invite.tenantId !== tenantId || invite.role === 'contributor')
        throw new DomainError('Invitation not found', 404);
      const next = randomUUID();
      // OperatorSetup.complete ties the principal's disabled time to the invitation row.
      await q(
        'UPDATE identity.principal SET disabled_at=now() WHERE id=$1 AND disabled_at IS NOT NULL',
        [invite.principalId],
      );
      await q('DELETE FROM identity.verification WHERE id=$1', [row.id]);
      await q(
        'INSERT INTO identity.verification(id,identifier,value,"expiresAt") VALUES($1,$2,$3,now()+interval \'7 days\')',
        [next, row.identifier, JSON.stringify(invite)],
      );
      return { id: next, principalId: invite.principalId, expiresInDays: 7 };
    });
  }

  /** Cancels a pending invitation and revokes its pending membership. Owner only, fresh check. */
  async cancel(ctx: RequestContext, input: unknown) {
    const { invitationId } = inviteRef.parse(input);
    const { tenantId } = await authorize(this.runtime, ctx);
    const row = (
      await this.auth.query(
        'SELECT id,value FROM identity.verification WHERE id=$1 AND identifier LIKE $2',
        [invitationId, identifierPrefix + '%'],
      )
    ).rows[0];
    const invite = row ? setupInvitation.parse(JSON.parse(row.value)) : null;
    if (!row || !invite || invite.tenantId !== tenantId || invite.role === 'contributor')
      throw new DomainError('Invitation not found', 404);
    await withTenant(this.runtime, ctx, 'members.manage', async (t) => {
      await t.db.query(
        'UPDATE app.membership SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [t.tenantId, invite.principalId],
      );
    });
    await this.auth.query('DELETE FROM identity.verification WHERE id=$1', [row.id]);
    return { cancelled: true };
  }

  /**
   * Resets another member's authenticator (V-03). Owner only, fresh check, same workspace, never
   * yourself. The member's sessions end and they set up a new authenticator at next sign-in.
   */
  async resetAuthenticator(ctx: RequestContext, input: unknown) {
    const { userId } = resetInput.parse(input);
    await withTenant(this.runtime, ctx, 'members.manage', async (t) => {
      if (userId === t.actorId)
        throw new DomainError(
          'You cannot reset your own authenticator here. Ask another owner, or use the recovery steps.',
          409,
        );
      const member = await t.db.query(
        'SELECT 1 FROM app.membership WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [t.tenantId, userId],
      );
      if (!member.rowCount) throw new DomainError('Member not found in this workspace', 404);
    });
    return inAuth(this.auth, async (q) => {
      const target = (
        await q(
          "SELECT p.identity_id FROM identity.principal p WHERE p.id=$1 AND p.kind='person' FOR UPDATE",
          [userId],
        )
      ).rows[0];
      if (!target?.identity_id) throw new DomainError('Member not found in this workspace', 404);
      await q('DELETE FROM identity."twoFactor" WHERE "userId"=$1', [target.identity_id]);
      await q('UPDATE identity."user" SET "twoFactorEnabled"=false,"updatedAt"=now() WHERE id=$1', [
        target.identity_id,
      ]);
      const ended = await q('DELETE FROM identity.session WHERE "userId"=$1', [target.identity_id]);
      return { reset: true, sessionsEnded: ended.rowCount ?? 0, reEnrolAtNextSignIn: true };
    });
  }
}
