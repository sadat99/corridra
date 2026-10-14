import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import {
  sessionHash,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
import { countryCode } from '@corridra/domain/geography';
import { role } from '@corridra/domain';
import { setupIdentifier } from './operator-setup';

// Offline owner procedure only. No request handler receives this schema-owner pool.
export async function inviteOperator(pool: DatabasePool, ctx: RequestContext, input: unknown) {
  const v = z
    .object({
      commandId: z.uuid(),
      email: z.email(),
      name: z.string().trim().min(1).max(80),
      role,
      operatingCountry: countryCode,
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose','synthetic_validation',true),set_config('corridra.correlation_id',$3,true),set_config('corridra.causation_id',$3,true)`,
      [sessionHash(ctx.token), ctx.tenantId, v.commandId],
    );
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [ctx.tenantId]);
    const approval = (
      await db.query(
        `SELECT app.actor_id() actor,coalesce(app.can_access($1,'INTERNAL','synthetic_validation') AND app.member_role($1)='owner' AND app.fresh_mfa() AND EXISTS(SELECT FROM app.tenant WHERE id=$1 AND synthetic),false) approved`,
        [ctx.tenantId],
      )
    ).rows[0];
    if (!approval?.approved)
      throw new Error('An active owner with fresh MFA must approve the invitation');
    await insertPending(db, v, ctx.tenantId, approval.actor);
    await db.query('COMMIT');
    return {
      prepared: true,
      role: v.role,
      requiresVerifiedAccount: true,
      requiresAuthenticator: true,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

type PendingInput = {
  commandId: string;
  email: string;
  name: string;
  role: z.infer<typeof role>;
  operatingCountry: z.infer<typeof countryCode>;
};
async function insertPending(
  db: DatabaseClient,
  v: PendingInput,
  tenantId: string,
  approvedBy: string,
) {
  const email = v.email.trim().toLowerCase(),
    identifier = setupIdentifier(email);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identifier]);
  if (
    (await db.query('SELECT 1 FROM identity."user" WHERE lower(email)=lower($1)', [email])).rowCount
  )
    throw new Error('Operator identity already exists; use the audited recovery procedure');
  const userId = randomUUID(),
    principalId = randomUUID();
  await db.query(
    'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,false,false)',
    [userId, v.name, email],
  );
  await db.query(
    'INSERT INTO identity.account(id,"userId","accountId","providerId",password) VALUES($1,$2,$2,\'credential\',$3)',
    [randomUUID(), userId, await hashPassword(randomBytes(48).toString('base64url'))],
  );
  await db.query(
    'INSERT INTO identity.principal(id,identity_id,operating_country,disabled_at) VALUES($1,$2,$3,now())',
    [principalId, userId, v.operatingCountry],
  );
  await db.query(
    'INSERT INTO app.membership(tenant_id,user_id,role,allowed_countries) VALUES($1,$2,$3,$4)',
    [tenantId, principalId, v.role, [v.operatingCountry]],
  );
  const invite = {
    userId,
    principalId,
    tenantId: tenantId,
    role: v.role,
    commandId: v.commandId,
    approvedBy: approvedBy,
  };
  await db.query(
    'INSERT INTO identity.verification(id,identifier,value,"expiresAt") VALUES($1,$2,$3,now()+interval \'7 days\')',
    [v.commandId, identifier, JSON.stringify(invite)],
  );
  await db.query(
    "INSERT INTO identity.security_event(identity_id,action) VALUES($1,'operator.invitation.approved')",
    [userId],
  );
}

// Exceptional OFFLINE first-human-owner bootstrap, not a request-handler capability.
// It is unavailable once ANY human owner has existed, including a revoked owner.
export async function prepareFirstHumanOwner(pool: DatabasePool, input: unknown) {
  const v = z
    .object({
      commandId: z.uuid(),
      email: z.email(),
      name: z.string().trim().min(1).max(80),
      operatingCountry: countryCode,
      tenantId: z.uuid(),
      approvalReference: z.string().regex(/^[a-z0-9-]{10,120}$/),
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [v.tenantId]);
    const authority = (
      await db.query(
        `SELECT pg_has_role(current_user,c.relowner,'MEMBER') approved FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname='membership'`,
      )
    ).rows[0];
    if (!authority?.approved) throw new Error('Offline schema-owner authority required');
    const tenant = (
      await db.query(
        'SELECT 1 FROM app.tenant WHERE id=$1 AND synthetic AND id=(SELECT tenant_id FROM app.intake_destination)',
        [v.tenantId],
      )
    ).rowCount;
    if (!tenant) throw new Error('Exact live synthetic intake workspace required');
    const customer = (
      await db.query(
        'SELECT 1 FROM neon_auth."user" WHERE lower(email)=lower($1) AND "emailVerified"=true',
        [v.email],
      )
    ).rowCount;
    if (customer !== 1) throw new Error('Existing independently verified customer email required');
    const owners = (
      await db.query(
        `SELECT 1 FROM app.membership m JOIN identity.principal p ON p.id=m.user_id JOIN identity."user" u ON u.id=p.identity_id WHERE m.tenant_id=$1 AND m.role='owner' AND lower(u.email) NOT LIKE '%@example.invalid'`,
        [v.tenantId],
      )
    ).rowCount;
    if (owners)
      throw new Error('A human owner has already existed; use normal owner invitation or recovery');
    const actor = randomUUID();
    await db.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service',$2)",
      [actor, v.operatingCountry],
    );
    await db.query(
      `SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$2,true)`,
      [actor, v.commandId],
    );
    await insertPending(db, { ...v, role: 'owner' }, v.tenantId, actor);
    await db.query('INSERT INTO identity.security_event(identity_id,action) VALUES($1,$2)', [
      actor,
      'operator.first-human-owner.approved.' + v.approvalReference,
    ]);
    await db.query('COMMIT');
    return {
      prepared: true,
      role: 'owner',
      requiresVerifiedAccount: true,
      requiresAuthenticator: true,
      existingOwnersPreserved: true,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
