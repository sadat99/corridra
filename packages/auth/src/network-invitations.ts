import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { countryCode } from '@corridra/domain/geography';
import { sessionHash, type DatabasePool, type RequestContext } from '@corridra/db';

const command = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('invite'),
      commandId: z.uuid(),
      email: z.email().trim().toLowerCase(),
      name: z.string().trim().min(1).max(80),
      operatingCountry: countryCode,
    })
    .strict(),
  z
    .object({
      action: z.literal('revoke'),
      commandId: z.uuid(),
      invitationId: z.uuid(),
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
]);

// This is the existing restricted auth role, never a schema-owner/runtime connection.
// SQL validates the bearer-derived actor and current scope inside the write transaction.
export class NetworkInvitations {
  constructor(
    private pool: DatabasePool,
    private enabled: boolean,
  ) {}
  async list(ctx: RequestContext, after?: string | null) {
    const installed = await this.pool.query(
      "SELECT to_regprocedure('identity.network_invitation_command(text,uuid,jsonb,text)') IS NOT NULL AS available",
    );
    if (!installed.rows[0]?.available)
      return { installed: false, enabled: false, invitations: [], next: null, countries: [] };
    if (after && after.length > 256) throw new DomainError('Invitation cursor is invalid.', 400);
    const cursor = after
      ? z
          .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
          .strict()
          .parse(JSON.parse(after))
      : null;
    const result = await this.run(ctx, {
      action: 'list',
      commandId: randomUUID(),
      ...(cursor ? { after: cursor } : {}),
    });
    return { ...result, installed: true, enabled: this.enabled && result.enabled };
  }
  async command(ctx: RequestContext, input: unknown) {
    const value = command.parse(input);
    if (!this.enabled && value.action === 'invite')
      throw new DomainError('Execution network is disabled', 503);
    const pendingPassword =
      value.action === 'invite' ? await hashPassword(randomBytes(48).toString('base64url')) : null;
    return this.run(ctx, value, pendingPassword);
  }
  private async run(ctx: RequestContext, value: unknown, pendingPassword: string | null = null) {
    try {
      const r = await this.pool.query(
        'SELECT identity.network_invitation_command($1,$2,$3::jsonb,$4) AS result',
        [sessionHash(ctx.token), ctx.tenantId, JSON.stringify(value), pendingPassword],
      );
      return r.rows[0].result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42501')
        throw new DomainError(
          'An authorized owner or admin with a current authenticator is required.',
          403,
        );
      if (['23505', '23514', 'P0001'].includes(code ?? ''))
        throw new DomainError(
          'The invitation cannot be changed. Refresh; finish any existing identity setup or use profile suspension for accepted access.',
          409,
        );
      throw error;
    }
  }
}
