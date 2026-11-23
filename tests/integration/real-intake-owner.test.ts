import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { migrateCustomerRealIntakeOwner } from '../../packages/db/src/customer-real-intake-owner-migrate';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { configureNetworkRealUse } from '../../packages/auth/src/network-real-use-configuration';
import {
  changeRealIntakeOwner,
  realIntakeOwnerPlan,
} from '../../packages/auth/src/customer-real-intake-owner';

// B11a (owner decision 23 Nov 2026) on a database: "Corridra founder" becomes the owner of new real requests and the two
// sample members lose their roles in the real workspace only. Nothing is deleted, the one immutable configuration row and
// the sample intake stay as they are, and requests made earlier keep their recorded owner. The tests run in order on one
// database: the refusals first (they write nothing), then the dry run, the change, the second run and the way back.
const issuer =
  'https://ep-intake-owner-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const reason = 'Owner decision 23 Nov 2026: the founder owns real intake';
const sessionFor = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let workspaceId: string;
let founder: string;
let before: Awaited<ReturnType<typeof state>>;
let firstRequest: string;
const short = (id: string) => id.slice(0, 8);

// Test set-up only: a staff write by the schema owner, attributed to the pinned service identity as offline work is.
async function asService(sql: string, args: unknown[] = []) {
  const db = await s.f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `SELECT set_config('corridra.bootstrap_actor',$1,true),
       set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)`,
      [s.f.serviceId, randomUUID(), randomUUID()],
    );
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function addPerson(name: string, role: string) {
  const id = randomUUID();
  const identityId = randomUUID();
  await s.f.owner.query(
    'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
    [identityId, name, `${id}@example.invalid`],
  );
  await s.f.owner.query(
    "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
    [id, identityId],
  );
  await asService(
    "INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes) VALUES($1,$2,$3,ARRAY['commercial_qualification'])",
    [s.intakeTenantId, id, role],
  );
  return id;
}
const rename = (principalId: string, name: string) =>
  s.f.owner.query(
    'UPDATE identity."user" u SET name=$2 FROM identity.principal p WHERE p.identity_id=u.id AND p.id=$1',
    [principalId, name],
  );
const setMember = (principalId: string, role: string, revoked: boolean) =>
  asService(
    'UPDATE app.membership SET role=$3,revoked_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE tenant_id=$1 AND user_id=$2',
    [s.intakeTenantId, principalId, role, revoked],
  );
// Everything this unit must leave alone or may only add to, read as the schema owner.
async function state(): Promise<Record<string, number | string>> {
  const installed = (
    await s.f.owner.query(
      "SELECT to_regclass('customer_private.real_intake_owner_version') IS NOT NULL AS present",
    )
  ).rows[0].present;
  const versions = installed
    ? (
        await s.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.real_intake_owner_version',
        )
      ).rows[0].n
    : -1;
  const row = (
    await s.f.owner.query(`SELECT
     (SELECT count(*) FROM identity."user")::int AS users,
     (SELECT count(*) FROM identity.principal)::int AS principals,
     (SELECT count(*) FROM customer_private.principal)::int AS customers,
     (SELECT count(*) FROM app.tenant)::int AS tenants,
     (SELECT count(*) FROM app.membership)::int AS memberships,
     (SELECT count(*) FROM app.mission)::int AS missions,
     (SELECT count(*) FROM app.domain_event)::int AS events,
     (SELECT count(*) FROM app.audit_event)::int AS audits,
     (SELECT to_jsonb(c)::text FROM customer_private.real_use_configuration c) AS configuration,
     (SELECT to_jsonb(d)::text FROM app.intake_destination d) AS destination,
     (SELECT string_agg(to_jsonb(m)::text,'|' ORDER BY m.tenant_id,m.user_id) FROM app.membership m
       JOIN app.tenant t ON t.id=m.tenant_id WHERE t.synthetic) AS sample_memberships,
     (SELECT string_agg(to_jsonb(m)::text,'|' ORDER BY m.user_id) FROM app.membership m WHERE m.tenant_id='${s.intakeTenantId}') AS real_memberships,
     (SELECT string_agg(m.id::text||':'||m.owner_id::text,'|' ORDER BY m.id) FROM app.mission m) AS mission_owners`)
  ).rows[0] as Record<string, number | string>;
  return { ...row, versions: versions as number };
}
const brief = () => ({
  objective: 'Source suppliers' as const,
  market: 'China',
  attendance: 'Not decided' as const,
  startDate: '',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Packaging machinery requirements ' + randomUUID(),
  website: 'https://business.test/catalogue',
  outcomes: ['Supplier visits' as const],
  notes: 'Original exclusions and support obligations',
  name: 'Request owner',
  company: 'Packaging company',
  email: 'owner-alice@business.test',
  acknowledged: true as const,
  experience: {
    schemaVersion: 1 as const,
    companyCountry: 'BD',
    marketCode: 'CN',
    job: 'machinery_procurement',
    requirements: {
      objective: 'Find a suitable machine',
      role: 'IMPORTER' as const,
      product: 'Packaging machine',
      budgetMinor: '1234',
      currency: 'BHD',
      budgetBasis: 'One machine; installation excluded',
      machinery: { installationReferences: 'Supplier installation required' },
    },
  },
});
// A customer makes a real request; the answer is the staff owner recorded on the mission it created.
async function requestOwner() {
  const made = await new CustomerRequestService(
    s.f.runtime,
    s.f.auth,
    options,
    sessionFor('owner-alice'),
  ).submit({ commandId: randomUUID(), workspaceId, brief: brief() }, (context, b) =>
    s.missions.prepareCustomerIntake(context, b),
  );
  const row = (
    await s.f.owner.query(
      'SELECT m.owner_id FROM customer_private.owned_request r JOIN app.mission m ON m.id=r.mission_id AND m.tenant_id=r.mission_tenant_id WHERE r.id=$1',
      [made.id],
    )
  ).rows[0];
  return { requestId: made.id as string, ownerId: row.owner_id as string };
}
const ownerOf = async (requestId: string) =>
  (
    await s.f.owner.query(
      'SELECT m.owner_id FROM customer_private.owned_request r JOIN app.mission m ON m.id=r.mission_id AND m.tenant_id=r.mission_tenant_id WHERE r.id=$1',
      [requestId],
    )
  ).rows[0].owner_id as string;
const run = (apply: boolean) => changeRealIntakeOwner(s.f.owner, { apply, reason });

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-intake-owner-fixture-secret');
  workspaceId = (
    await new CustomerWorkspaceService(
      s.f.runtime,
      s.f.auth,
      options,
      sessionFor('owner-alice'),
    ).provision({ commandId: randomUUID(), name: 'Packaging company workspace' })
  ).id;
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

describe('the real intake owner change', () => {
  test('the plan names exactly the owner decision', () => {
    expect(realIntakeOwnerPlan).toEqual({
      workspace: 'Corridra request operations',
      owner: 'Corridra founder',
      remove: ['Synthetic operator', 'Synthetic reviewer'],
    });
  });

  test('installing the module alone changes no owner, and the record of owners cannot be rewritten or read at runtime', async () => {
    const earlier = await requestOwner();
    expect(earlier.ownerId).toBe(s.f.users.owner!.id);
    firstRequest = earlier.requestId;
    await migrateCustomerRealIntakeOwner(s.f.owner);
    await migrateCustomerRealIntakeOwner(s.f.owner);
    expect((await requestOwner()).ownerId).toBe(s.f.users.owner!.id);
    expect((await state()).versions).toBe(0);
    // With no owner recorded the module adds no check: real intake behaves exactly as before, even when the configuration
    // owner is no longer an owner or admin, so a failed or partial install can never stop real intake.
    await setMember(s.f.users.owner!.id, 'viewer', false);
    expect((await requestOwner()).ownerId).toBe(s.f.users.owner!.id);
    await setMember(s.f.users.owner!.id, 'owner', true);
    expect((await requestOwner()).ownerId).toBe(s.f.users.owner!.id);
    await setMember(s.f.users.owner!.id, 'owner', false);
    await expect(
      s.f.runtime.query('SELECT * FROM customer_private.real_intake_owner_version'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      s.f.auth.query('SELECT * FROM customer_private.real_intake_owner_version'),
    ).rejects.toMatchObject({ code: '42501' });
  }, 120000);

  test('it refuses, and writes nothing, when the new owner is missing, not an owner or admin, or named twice', async () => {
    const start = await state();
    await expect(run(false)).rejects.toThrow(
      'Expected exactly one active owner or admin named "Corridra founder" in the real workspace, found 0',
    );
    await expect(run(true)).rejects.toThrow(/named "Corridra founder" .* found 0/);
    expect(await state()).toEqual(start);
    founder = await addPerson('Corridra founder', 'operator');
    const asOperator = await state();
    await expect(run(true)).rejects.toThrow(/named "Corridra founder" .* found 0/);
    expect(await state()).toEqual(asOperator);
    await setMember(founder, 'owner', true);
    await expect(run(true)).rejects.toThrow(/named "Corridra founder" .* found 0/);
    await setMember(founder, 'owner', false);
    const twin = await addPerson('Corridra founder', 'admin');
    const twice = await state();
    await expect(run(false)).rejects.toThrow(/named "Corridra founder" .* found 2/);
    await expect(run(true)).rejects.toThrow(/named "Corridra founder" .* found 2/);
    expect(await state()).toEqual(twice);
    await rename(twin, 'Another admin');
  }, 120000);

  test('it refuses when the new owner lacks the real processing purpose', async () => {
    await asService(
      "UPDATE app.membership SET allowed_purposes=ARRAY['synthetic_validation'] WHERE tenant_id=$1 AND user_id=$2",
      [s.intakeTenantId, founder],
    );
    const start = await state();
    await expect(run(true)).rejects.toThrow(
      'The new owner needs an active account and the real processing purpose in the real workspace',
    );
    expect(await state()).toEqual(start);
    await asService(
      "UPDATE app.membership SET allowed_purposes=ARRAY['commercial_qualification'] WHERE tenant_id=$1 AND user_id=$2",
      [s.intakeTenantId, founder],
    );
  }, 120000);

  test('it refuses when a sample member name matches no member or two members', async () => {
    await rename(s.f.users.operator!.id, 'Renamed operator');
    const none = await state();
    await expect(run(false)).rejects.toThrow(
      'Expected exactly one member named "Synthetic operator" in the real workspace, found 0',
    );
    await expect(run(true)).rejects.toThrow(/named "Synthetic operator" .* found 0/);
    expect(await state()).toEqual(none);
    await rename(s.f.users.operator!.id, 'Synthetic operator');
    const twin = await addPerson('Synthetic reviewer', 'reviewer');
    const two = await state();
    await expect(run(false)).rejects.toThrow(/named "Synthetic reviewer" .* found 2/);
    await expect(run(true)).rejects.toThrow(/named "Synthetic reviewer" .* found 2/);
    expect(await state()).toEqual(two);
    await rename(twin, 'Another reviewer');
  }, 120000);

  test('it refuses when the change would leave the real workspace without an active owner', async () => {
    await setMember(founder, 'admin', false);
    await setMember(s.f.users.operator!.id, 'owner', false);
    await setMember(s.f.users.owner!.id, 'admin', false);
    const start = await state();
    await expect(run(true)).rejects.toThrow('The real workspace must keep an active owner');
    await expect(run(false)).rejects.toThrow('The real workspace must keep an active owner');
    expect(await state()).toEqual(start);
    await setMember(s.f.users.owner!.id, 'owner', false);
    await setMember(s.f.users.operator!.id, 'operator', false);
    await setMember(founder, 'owner', false);
  }, 120000);

  test('it refuses a caller that is not the schema owner, and a short reason', async () => {
    await expect(changeRealIntakeOwner(s.f.runtime, { apply: false, reason })).rejects.toThrow();
    await expect(
      changeRealIntakeOwner(s.f.owner, { apply: true, reason: 'short' }),
    ).rejects.toThrow();
    await expect(
      changeRealIntakeOwner(s.f.owner, { apply: true, reason, owner: 'Someone else' }),
    ).rejects.toThrow();
  });

  test('the dry run says when the configuration owner would not pass the owner check, and prints no name read from the database', async () => {
    // The configuration owner carries a free-text display name; only its short id may reach the log.
    await rename(s.f.users.owner!.id, 'Free text <name> from the database');
    await setMember(founder, 'owner', false);
    await setMember(s.f.users.owner!.id, 'viewer', false);
    const result = await run(false);
    expect(result.lines).toContain(
      `owner check: configuration owner (${short(s.f.users.owner!.id)}) does not pass`,
    );
    expect(result.lines).toContain(
      `owner check: new owner Corridra founder (${short(founder)}) passes`,
    );
    expect(result.lines.join('\n')).not.toMatch(/Free text|<name>/);
    await setMember(s.f.users.owner!.id, 'owner', false);
    const passing = await run(false);
    expect(passing.lines.join('\n')).not.toMatch(/Free text|<name>/);
    await rename(s.f.users.owner!.id, 'Synthetic owner');
  }, 120000);

  test('the dry run lists exactly what would change, with names and short ids only, and writes nothing', async () => {
    before = await state();
    const result = await run(false);
    expect(result.state).toBe('dry_run');
    expect(result.lines).toEqual([
      `real workspace: Corridra request operations (${short(s.intakeTenantId)})`,
      `owner of new real requests: would change from the current owner (${short(s.f.users.owner!.id)}) to Corridra founder (${short(founder)})`,
      `owner check: configuration owner (${short(s.f.users.owner!.id)}) passes`,
      `owner check: new owner Corridra founder (${short(founder)}) passes`,
      `member: would remove Synthetic operator (${short(s.f.users.operator!.id)}), role operator, from the real workspace only`,
      `member: would remove Synthetic reviewer (${short(s.f.users.reviewer!.id)}), role reviewer, from the real workspace only`,
      'nothing written (dry run)',
    ]);
    expect(result.lines.join('\n')).not.toMatch(/@|example\.invalid/);
    expect(await state()).toEqual(before);
  }, 120000);

  test('applying it appends the owner, removes the two sample members from the real workspace only and deletes nothing', async () => {
    const result = await run(true);
    expect(result.state).toBe('applied');
    expect(result.lines.at(-1)).toBe('applied');
    expect(result.lines.join('\n')).not.toMatch(/@|example\.invalid/);
    const after = await state();
    // One owner version appended; two audit trails appended; no row removed anywhere.
    expect(after.versions).toBe(1);
    for (const key of ['users', 'principals', 'customers', 'tenants', 'memberships', 'missions'])
      expect(after[key], key).toBe(before[key]);
    expect(after.events).toBe((before.events as number) + 2);
    expect(after.audits).toBe((before.audits as number) + 2);
    // The immutable configuration row, the sample intake, every sample workspace membership and every earlier request stay.
    expect(after.configuration).toBe(before.configuration);
    expect(after.destination).toBe(before.destination);
    expect(after.sample_memberships).toBe(before.sample_memberships);
    expect(after.mission_owners).toBe(before.mission_owners);
    expect(await ownerOf(firstRequest)).toBe(s.f.users.owner!.id);
    const version = (
      await s.f.owner.query(
        'SELECT id,owner_id,set_by,reason FROM customer_private.real_intake_owner_version',
      )
    ).rows;
    expect(version).toEqual([{ id: 1, owner_id: founder, set_by: s.f.serviceId, reason }]);
    const members = (
      await s.f.owner.query(
        `SELECT u.name,m.role,m.revoked_at IS NOT NULL AS revoked,t.synthetic FROM app.membership m
         JOIN app.tenant t ON t.id=m.tenant_id JOIN identity.principal p ON p.id=m.user_id
         JOIN identity."user" u ON u.id=p.identity_id
         WHERE u.name IN ('Synthetic operator','Synthetic reviewer','Synthetic owner','Synthetic viewer','Corridra founder')
         ORDER BY t.synthetic,u.name`,
      )
    ).rows;
    expect(members).toEqual([
      { name: 'Corridra founder', role: 'owner', revoked: false, synthetic: false },
      { name: 'Synthetic operator', role: 'operator', revoked: true, synthetic: false },
      { name: 'Synthetic owner', role: 'owner', revoked: false, synthetic: false },
      { name: 'Synthetic reviewer', role: 'reviewer', revoked: true, synthetic: false },
      { name: 'Synthetic viewer', role: 'viewer', revoked: false, synthetic: false },
      { name: 'Synthetic operator', role: 'operator', revoked: false, synthetic: true },
      { name: 'Synthetic owner', role: 'owner', revoked: false, synthetic: true },
      { name: 'Synthetic reviewer', role: 'reviewer', revoked: false, synthetic: true },
      { name: 'Synthetic viewer', role: 'viewer', revoked: false, synthetic: true },
    ]);
    // The audit rows: one per removed member, in the real workspace, by the pinned service identity, sharing one correlation.
    const audit = (
      await s.f.owner.query(
        `SELECT e.aggregate_id,e.type,e.payload->>'revoked' AS revoked,e.actor_id,a.action,e.correlation_id::text
         FROM app.domain_event e JOIN app.audit_event a ON a.domain_event_id=e.id
         WHERE e.tenant_id=$1 AND e.type='membership.update' AND e.aggregate_id=ANY($2::text[]) AND e.payload->>'revoked'='true'
         ORDER BY e.aggregate_id`,
        [s.intakeTenantId, [s.f.users.operator!.id, s.f.users.reviewer!.id]],
      )
    ).rows;
    expect(audit).toHaveLength(2);
    expect(new Set(audit.map((row) => row.correlation_id)).size).toBe(1);
    for (const row of audit)
      expect(row).toMatchObject({
        type: 'membership.update',
        action: 'membership.update',
        actor_id: s.f.serviceId,
      });
    // A new real request is owned by the founder.
    expect((await requestOwner()).ownerId).toBe(founder);
  }, 120000);

  test('a second run reports unchanged and writes nothing', async () => {
    const start = await state();
    const dry = await run(false);
    expect(dry.state).toBe('unchanged');
    const again = await run(true);
    expect(again.state).toBe('unchanged');
    expect(again.lines).toEqual([
      `real workspace: Corridra request operations (${short(s.intakeTenantId)})`,
      `owner of new real requests: already Corridra founder (${short(founder)})`,
      `owner check: configuration owner (${short(s.f.users.owner!.id)}) passes`,
      `owner check: new owner Corridra founder (${short(founder)}) passes`,
      `member: Synthetic operator (${short(s.f.users.operator!.id)}) is already removed from the real workspace`,
      `member: Synthetic reviewer (${short(s.f.users.reviewer!.id)}) is already removed from the real workspace`,
      'unchanged',
    ]);
    expect(await state()).toEqual(start);
  }, 120000);

  test('the offline network switch follows the recorded owner when the configuration owner has left the real workspace', async () => {
    // In production the configuration owner is one of the removed members. The network open and pause step must keep working.
    await migrateNetworkRealUse(s.f.owner);
    const networkReason = 'Owner approved reviewed real contributor work within retained scope';
    await setMember(s.f.users.owner!.id, 'owner', true);
    expect(
      await configureNetworkRealUse(s.f.owner, { enabled: true, reason: networkReason }),
    ).toEqual({ enabled: true, changed: true });
    const written = (
      await s.f.owner.query(
        "SELECT created_by FROM app.config_version WHERE tenant_id=$1 AND key='network.enabled' ORDER BY version DESC LIMIT 1",
        [s.intakeTenantId],
      )
    ).rows[0];
    expect(written.created_by).toBe(founder);
    // It still refuses when the recorded owner is not an active owner or admin.
    await setMember(founder, 'operator', false);
    await expect(
      configureNetworkRealUse(s.f.owner, { enabled: false, reason: networkReason }),
    ).rejects.toThrow('Enabled real scope and active original owner/executor are required');
    await setMember(founder, 'owner', false);
    expect(
      await configureNetworkRealUse(s.f.owner, { enabled: false, reason: networkReason }),
    ).toEqual({ enabled: false, changed: true });
    await setMember(s.f.users.owner!.id, 'owner', false);
  }, 120000);

  test('the owner record is append only, and real intake is refused while the recorded owner is not an active owner or admin', async () => {
    await expect(
      s.f.owner.query('UPDATE customer_private.real_intake_owner_version SET owner_id=set_by'),
    ).rejects.toThrow('Immutable record; append a new record');
    await expect(
      s.f.owner.query('DELETE FROM customer_private.real_intake_owner_version'),
    ).rejects.toThrow('Immutable record; append a new record');
    await setMember(founder, 'owner', true);
    await expect(requestOwner()).rejects.toThrow('Real intake unavailable');
    await setMember(founder, 'operator', false);
    await expect(requestOwner()).rejects.toThrow('Real intake unavailable');
    await setMember(founder, 'owner', false);
    expect((await requestOwner()).ownerId).toBe(founder);
  }, 120000);

  test('the way back: a later owner version pointing back wins, and nothing was deleted to get there', async () => {
    await s.f.owner.query(
      'INSERT INTO customer_private.real_intake_owner_version(id,owner_id,set_by,reason) VALUES(2,$1,$2,$3)',
      [s.f.users.owner!.id, s.f.serviceId, 'Rollback rehearsal: the earlier owner again'],
    );
    expect((await requestOwner()).ownerId).toBe(s.f.users.owner!.id);
    const end = await state();
    for (const key of ['users', 'principals', 'customers', 'tenants', 'memberships'])
      expect(end[key], key).toBe(before[key]);
    expect(end.configuration).toBe(before.configuration);
    expect(end.destination).toBe(before.destination);
    expect(end.sample_memberships).toBe(before.sample_memberships);
  }, 120000);
});
