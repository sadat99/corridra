import { createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';
import { DomainError, role } from '@corridra/domain';

export const setupIdentifier = (email: string) =>
  'corridra-operator-setup:' +
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
export const setupInvitation = z
  .object({
    userId: z.uuid(),
    principalId: z.uuid(),
    tenantId: z.uuid(),
    role: z.union([role, z.literal('contributor')]),
    commandId: z.uuid(),
    approvedBy: z.uuid(),
  })
  .strict();
const verifiedAccount = z.object({ email: z.email(), emailVerified: z.literal(true) });

// Only the trusted server-side customer provider supplies this proof. This service
// consumes an explicit reviewed invitation; it never creates users or memberships.
export class OperatorSetup {
  constructor(private pool: DatabasePool) {}
  async status(proof: unknown) {
    const account = verifiedAccount.parse(proof);
    const rows = (
      await this.pool.query(
        'SELECT value,"expiresAt" FROM identity.verification WHERE identifier=$1 AND "expiresAt">now()',
        [setupIdentifier(account.email)],
      )
    ).rows;
    if (rows.length !== 1) return { available: false };
    const invite = setupInvitation.parse(JSON.parse(rows[0].value));
    if (invite.role === 'contributor') {
      const check = await this.pool.query(
        'SELECT identity.network_invitation_current($1,$2) AS active',
        [invite.commandId, invite.principalId],
      );
      if (!check.rows[0]?.active) return { available: false };
      return {
        available: true,
        role: invite.role,
        workspaceId: invite.tenantId,
        expiresAt: rows[0].expiresAt,
      };
    }
    return { available: true, role: invite.role, expiresAt: rows[0].expiresAt };
  }
  async complete(proof: unknown, input: unknown) {
    const account = verifiedAccount.parse(proof);
    const { password } = z
      .object({ password: z.string().min(14).max(128) })
      .strict()
      .parse(input);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const identifier = setupIdentifier(account.email);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identifier]);
      const rows = (
        await db.query(
          'SELECT id,value FROM identity.verification WHERE identifier=$1 AND "expiresAt">now() FOR UPDATE',
          [identifier],
        )
      ).rows;
      if (rows.length !== 1)
        throw new DomainError('No current operator invitation is available for this account.', 404);
      const invite = setupInvitation.parse(JSON.parse(rows[0].value));
      if (invite.role === 'contributor') {
        const check = await db.query(
          'SELECT identity.network_invitation_current($1,$2,true) AS active',
          [invite.commandId, invite.principalId],
        );
        if (!check.rows[0]?.active)
          throw new DomainError('This contributor invitation has expired or was revoked.', 403);
      }
      const target = (
        await db.query(
          `SELECT u.id FROM identity."user" u JOIN identity.principal p ON p.identity_id=u.id
         WHERE u.id=$1 AND p.id=$2 AND lower(u.email)=lower($3) AND u."emailVerified"=false
         AND u."twoFactorEnabled"=false AND p.disabled_at=(SELECT "createdAt" FROM identity.verification WHERE id=$4)
         AND NOT EXISTS(SELECT FROM identity.session s WHERE s."userId"=u.id)
         AND NOT EXISTS(SELECT FROM identity."twoFactor" m WHERE m."userId"=u.id) FOR UPDATE OF u,p`,
          [invite.userId, invite.principalId, account.email, rows[0].id],
        )
      ).rows;
      if (target.length !== 1)
        throw new DomainError('This invitation cannot reset an existing operator account.', 409);
      const result = await db.query(
        `UPDATE identity.account SET password=$2,"updatedAt"=now()
         WHERE "userId"=$1 AND "providerId"='credential'`,
        [invite.userId, await hashPassword(password)],
      );
      if (result.rowCount !== 1) throw new DomainError('Operator invitation is unavailable.', 409);
      await db.query(
        'UPDATE identity."user" SET "emailVerified"=true,"updatedAt"=now() WHERE id=$1',
        [invite.userId],
      );
      await db.query('UPDATE identity.principal SET disabled_at=NULL WHERE id=$1', [
        invite.principalId,
      ]);
      await db.query('DELETE FROM identity.verification WHERE id=$1', [rows[0].id]);
      await db.query('COMMIT');
      return invite.role === 'contributor'
        ? {
            completed: true,
            requiresAuthenticator: true,
            role: invite.role,
            workspaceId: invite.tenantId,
          }
        : { completed: true, requiresAuthenticator: true };
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
}
