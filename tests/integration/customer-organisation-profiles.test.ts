import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import {
  CustomerOrganisationProfileService,
  customerOrganisationProfileInput,
} from '../../packages/auth/src/customer-organisation-profiles';
import { sessionHash } from '../../packages/db/src/index';

// Invented provider-session fixtures exercise the real restricted SQL logins.
// They do not establish private managed-provider/email acceptance.
const issuer = 'https://ep-profile-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const people = ['alice', 'bob', 'carol', 'dave', 'outsider'];
let f: Awaited<ReturnType<typeof fixture>>, workspaceId: string, otherWorkspace: string;
let oldSnapshot: Awaited<ReturnType<typeof snapshot>>;
const subject = (person: string) => 'synthetic-profile-' + person;
const session = (person: string): CustomerSession => ({
  subject: subject(person),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const service = (person = 'alice') =>
  new CustomerOrganisationProfileService(f.runtime, f.auth, options, async () => session(person));
const details = (over: Record<string, unknown> = {}) => ({
  legalName: 'Synthetic Dhaka Garments Limited',
  countryCode: 'BD',
  website: 'https://garments.example',
  commercialRoles: ['SELLER', 'MANUFACTURER'],
  sectors: ['Knitwear', 'Denim'],
  sizeBand: '201-1000',
  summary: 'Synthetic exporter of knit and denim garments for European buyers',
  ...over,
});
const input = (expectedVersion = 0, over: Record<string, unknown> = {}, target = workspaceId) => ({
  commandId: randomUUID(),
  workspaceId: target,
  expectedVersion,
  reason: 'Initial synthetic profile',
  acknowledged: true as const,
  ...details(),
  ...over,
});
async function counts() {
  return (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.organisation_profile_revision) revisions,
 (SELECT count(*)::int FROM customer_private.organisation_profile_command) commands,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_organisation_profile') events,
 (SELECT count(*)::int FROM app.audit_event WHERE action='customer.organisation_profile.revised') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_organisation_profile') outbox,
 (SELECT count(*)::int FROM app.organisation) organisations,
 (SELECT count(*)::int FROM app.membership) staff,
 (SELECT count(*)::int FROM customer_private.session_proof) proofs`)
  ).rows[0];
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid,p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid`,
    )
  ).rows;
  const digests = [];
  for (const row of tables)
    digests.push(
      (
        await f.owner.query(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) digest FROM "${row.nspname}"."${row.relname}" t`,
        )
      ).rows[0].digest,
    );
  return {
    functions,
    tables,
    digests,
    policies: (
      await f.owner.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
      )
    ).rows,
    coreHistory: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    customerHistory: (
      await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')
    ).rows,
  };
}
async function raw(person: string, sql: string, args: unknown[] = [], target = workspaceId) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, issuer, subject(person)],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),set_config('corridra.tenant_id',$2,true)",
      [hash, target],
    );
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
async function rejected(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; message?: string; status?: number };
  }
  throw new Error('Expected the operation to be rejected');
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  for (const person of people)
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(person),
      executorId: f.serviceId,
      reason: 'Explicit invented organisation profile test identity; no real account or email',
    });
  workspaceId = (
    await workspaces().provision({
      commandId: randomUUID(),
      name: 'Synthetic profile workspace',
    })
  ).id;
  otherWorkspace = (
    await workspaces('carol').provision({
      commandId: randomUUID(),
      name: 'Synthetic separate profile workspace',
    })
  ).id;
  const invitation = await workspaces().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic profile reader',
  });
  await workspaces('bob').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  oldSnapshot = await snapshot();
  await migrateCustomerOrganisationProfiles(f.owner);
  await migrateCustomerOrganisationProfiles(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('populated additive install preserves every existing row, function, ACL, policy and receipt and is repeatable', async () => {
  const after = await snapshot();
  const knownTables = new Set(oldSnapshot.tables.map((t) => t.oid));
  const knownFunctions = new Set(oldSnapshot.functions.map((p) => p.oid));
  expect(after.functions.filter((p) => knownFunctions.has(p.oid))).toEqual(oldSnapshot.functions);
  expect(after.tables.filter((t) => knownTables.has(t.oid))).toEqual(oldSnapshot.tables);
  expect(
    after.tables
      .filter((t) => !knownTables.has(t.oid))
      .map((t) => t.relname)
      .sort(),
  ).toEqual(['organisation_profile_command', 'organisation_profile_revision']);
  const keep = after.tables.map((t) => knownTables.has(t.oid));
  expect(after.digests.filter((_, i) => keep[i])).toEqual(oldSnapshot.digests);
  expect(after.policies).toEqual(oldSnapshot.policies);
  expect(after.coreHistory).toEqual(oldSnapshot.coreHistory);
  expect(after.customerHistory).toEqual(oldSnapshot.customerHistory);
  const receipts = (
    await f.owner.query('SELECT name FROM customer_organisation_profile_migrations.applied')
  ).rows;
  expect(receipts).toEqual([{ name: '0001_private_organisation_profiles.sql' }]);
});

test('an empty workspace has no profile and the owner may edit', async () => {
  const view = await service().view({ workspaceId });
  expect(view).toMatchObject({
    workspaceId,
    organisationId: null,
    canonicalLinked: false,
    provenance: 'SELF_REPORTED',
    verified: false,
    canEdit: true,
    currentVersion: 0,
    profile: null,
  });
  const window = Date.parse(view.expiresAt) - Date.now();
  expect(window).toBeGreaterThan(0);
  expect(window).toBeLessThanOrEqual(61000);
});

test('owner records a typed self-reported revision with one event chain and no canonical organisation', async () => {
  const before = await counts();
  const saved = await service().command(input(0));
  expect(saved).toMatchObject({
    currentVersion: 1,
    superseded: false,
    organisationId: null,
    verified: false,
    provenance: 'SELF_REPORTED',
  });
  expect(saved.profile).toMatchObject({
    version: 1,
    ...details(),
    reason: 'Initial synthetic profile',
  });
  const after = await counts();
  expect(after).toEqual({
    ...before,
    revisions: before.revisions + 1,
    commands: before.commands + 1,
    events: before.events + 1,
    audits: before.audits + 1,
    outbox: before.outbox + 1,
  });
  expect(after.organisations).toBe(before.organisations);
  expect(after.staff).toBe(before.staff);
  expect(after.proofs).toBe(0);
  const events = (
    await f.owner.query(
      "SELECT payload,aggregate_version FROM app.domain_event WHERE aggregate_type='customer_organisation_profile'",
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(Object.keys(events[0].payload).sort()).toEqual([
    'initiator_id',
    'initiator_kind',
    'revisionId',
    'synthetic',
    'version',
  ]);
  expect(JSON.stringify(events)).not.toContain('Synthetic Dhaka');
  expect(JSON.stringify(events)).not.toContain('garments.example');
});

test('a stale expected version writes nothing and a reload then succeeds', async () => {
  const before = await counts();
  const error = await rejected(service().command(input(0, { legalName: 'Synthetic Stale Co' })));
  expect(error.code).toBe('23514');
  expect(error.message).toContain('reload');
  expect(await counts()).toEqual(before);
  const next = await service().command(
    input(1, { summary: 'Synthetic exporter adding home textiles', reason: 'Added a category' }),
  );
  expect(next.currentVersion).toBe(2);
  expect(next.profile?.summary).toContain('home textiles');
});

test('an exact retry returns the original revision without new rows, even after a later edit', async () => {
  const body = input(2, { legalName: 'Synthetic Retry Textiles Limited', reason: 'Rename' });
  const first = await service().command(body);
  const before = await counts();
  const again = await service().command(body);
  expect(again.profile?.version).toBe(first.profile?.version);
  expect(again.superseded).toBe(false);
  expect(await counts()).toEqual(before);
  await service().command(input(3, { reason: 'Later edit' }));
  const late = await service().command(body);
  expect(late.profile).toMatchObject({
    version: 3,
    legalName: 'Synthetic Retry Textiles Limited',
  });
  expect(late.superseded).toBe(true);
  expect(late.currentVersion).toBe(4);
});

test('a reused command id with different content is rejected and writes nothing', async () => {
  const commandId = randomUUID();
  await service().command({ ...input(4), commandId });
  const before = await counts();
  const error = await rejected(
    service().command({ ...input(4, { sectors: ['Leather'] }), commandId }),
  );
  expect(error.code).toBe('23514');
  expect(error.message).toContain('conflicts');
  expect(await counts()).toEqual(before);
});

test('an active member reads the current profile but sees no reason and cannot write or read history', async () => {
  const view = await service('bob').view({ workspaceId });
  expect(view.canEdit).toBe(false);
  expect(view.profile).toMatchObject({ legalName: 'Synthetic Dhaka Garments Limited' });
  expect(view.profile).not.toHaveProperty('reason');
  const before = await counts();
  const write = await rejected(service('bob').command(input(view.currentVersion)));
  expect(write.code).toBe('42501');
  const history = await rejected(service('bob').history({ workspaceId }));
  expect(history.code).toBe('42501');
  expect(await counts()).toEqual(before);
});

test('non-members and other workspace owners are denied, including forged workspace ids', async () => {
  for (const person of ['outsider', 'carol', 'dave']) {
    expect((await rejected(service(person).view({ workspaceId }))).code).toBe('42501');
    expect((await rejected(service(person).command(input(0)))).code).toBe('42501');
    expect((await rejected(service(person).history({ workspaceId }))).code).toBe('42501');
  }
  expect((await service('carol').view({ workspaceId: otherWorkspace })).profile).toBeNull();
  expect((await rejected(service().view({ workspaceId: randomUUID() }))).code).toBe('42501');
  expect((await rejected(service().command(input(0, {}, otherWorkspace)))).code).toBe('42501');
});

test('writers read paged history without author identity; each page links to older revisions', async () => {
  const page = await service().history({ workspaceId, pageSize: 2 });
  expect(page.revisions.map((r) => r.version)).toEqual([5, 4]);
  expect(page.nextBefore).toBe(4);
  expect(page.revisions[0]).toEqual({
    version: 5,
    reason: expect.any(String),
    createdAt: expect.any(String),
    byYou: true,
    provenance: 'SELF_REPORTED',
  });
  const middle = await service().history({ workspaceId, beforeVersion: 4, pageSize: 2 });
  expect(middle.revisions.map((r) => r.version)).toEqual([3, 2]);
  expect(middle.nextBefore).toBe(2);
  const oldest = await service().history({ workspaceId, beforeVersion: 2, pageSize: 2 });
  expect(oldest.revisions.map((r) => r.version)).toEqual([1]);
  expect(oldest.nextBefore).toBeNull();
  expect((await rejected(service().history({ workspaceId, pageSize: 0 }))).message).toBeTruthy();
});

test('runtime and auth roles cannot read or write profile tables or call private helpers directly', async () => {
  for (const pool of [f.runtime, f.auth])
    for (const sql of [
      'SELECT * FROM customer_private.organisation_profile_revision',
      "INSERT INTO customer_private.organisation_profile_revision(tenant_id,version,details,reason,created_by) VALUES(gen_random_uuid(),1,'{}','abc',gen_random_uuid())",
      'SELECT * FROM customer_private.organisation_profile_command',
      "UPDATE customer_private.organisation_profile_revision SET reason='xxxx'",
      'DELETE FROM customer_private.organisation_profile_revision',
    ])
      expect((await rejected(pool.query(sql))).code).toBe('42501');
  for (const sql of [
    'SELECT customer_private.organisation_profile_role(gen_random_uuid(),gen_random_uuid())',
    "SELECT customer_private.organisation_profile_valid('{}')",
    'SELECT customer_private.organisation_profile_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1)',
  ])
    expect((await rejected(raw('alice', sql))).code).toBe('42501');
  expect(
    (await rejected(f.auth.query('SELECT customer.organisation_profile_view($1)', [workspaceId])))
      .code,
  ).toBe('42501');
  // Without a fresh admitted proof the public functions grant nothing.
  expect(
    (
      await rejected(
        f.runtime.query('SELECT customer.organisation_profile_view($1)', [workspaceId]),
      )
    ).code,
  ).toBe('42501');
});

test('the schema owner cannot rewrite or delete history either', async () => {
  for (const sql of [
    "UPDATE customer_private.organisation_profile_revision SET reason='Rewritten reason'",
    'DELETE FROM customer_private.organisation_profile_revision',
    'DELETE FROM customer_private.organisation_profile_command',
  ])
    expect(await rejected(f.owner.query(sql))).toBeTruthy();
  expect((await counts()).revisions).toBe(5);
});

test('SQL independently rejects non-synthetic, real-host, unknown-country and malformed profiles', async () => {
  const valid = async (value: unknown) =>
    (
      await f.owner.query('SELECT customer_private.organisation_profile_valid($1::jsonb) AS ok', [
        JSON.stringify(value),
      ])
    ).rows[0].ok;
  expect(await valid(details())).toBe(true);
  expect(await valid(details({ website: null, sectors: [] }))).toBe(true);
  for (const bad of [
    details({ legalName: 'Dhaka Garments Limited' }),
    details({ summary: 'Exporter of garments for European buyers' }),
    details({ website: 'https://garments.com' }),
    details({ website: 'http://garments.example' }),
    details({ countryCode: 'ZZ' }),
    details({ commercialRoles: [] }),
    details({ commercialRoles: ['SELLER', 'SELLER'] }),
    details({ commercialRoles: ['REGULATOR'] }),
    details({ sectors: ['Denim', 'denim'] }),
    details({ sectors: Array.from({ length: 11 }, (_, i) => 'Sector ' + i) }),
    details({ sizeBand: 'huge' }),
    { ...details(), extra: 'x' },
    { ...details(), legalName: 5 },
    { legalName: 'Synthetic Only Name Limited' },
    details({ legalName: 'Synthetic Bad\u0007Control Limited' }),
  ])
    expect(await valid(bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
  const before = await counts();
  for (const bad of [
    { legalName: 'Dhaka Garments Limited' },
    { website: 'https://garments.com' },
    { countryCode: 'ZZ' },
  ])
    expect(
      (
        await rejected(
          raw('alice', 'SELECT customer.organisation_profile_command($1,$2,$3,$4,$5)', [
            randomUUID(),
            workspaceId,
            4,
            JSON.stringify(details(bad)),
            'Direct bad input',
          ]),
        )
      ).code,
    ).toBe('23514');
  expect(await counts()).toEqual(before);
});

test('the application schema rejects unsafe or malformed input before the database', () => {
  const ok = input(0);
  expect(customerOrganisationProfileInput.safeParse(ok).success).toBe(true);
  for (const bad of [
    { ...ok, acknowledged: false },
    { ...ok, legalName: 'Real Company Limited' },
    { ...ok, website: 'https://real-company.com' },
    { ...ok, countryCode: 'bd' },
    { ...ok, expectedVersion: -1 },
    { ...ok, commercialRoles: ['SELLER', 'SELLER'] },
    { ...ok, sectors: ['Denim', 'DENIM'] },
    { ...ok, reason: 'x' },
    { ...ok, organisationId: randomUUID() },
    { ...ok, verified: true },
    { ...ok, provenance: 'VERIFIED' },
  ])
    expect(customerOrganisationProfileInput.safeParse(bad).success).toBe(false);
});

test('concurrent writers on the same version yield exactly one winner and contiguous versions', async () => {
  const head = (await service().view({ workspaceId })).currentVersion;
  const before = await counts();
  const results = await Promise.allSettled([
    service().command(
      input(head, { legalName: 'Synthetic Race Winner One Limited', reason: 'Race one' }),
    ),
    service().command(
      input(head, { legalName: 'Synthetic Race Winner Two Limited', reason: 'Race two' }),
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.code).toBe('23514');
  const after = await counts();
  expect(after.revisions).toBe(before.revisions + 1);
  expect(after.events).toBe(before.events + 1);
  const versions = (
    await f.owner.query(
      'SELECT version FROM customer_private.organisation_profile_revision WHERE tenant_id=$1 ORDER BY version',
      [workspaceId],
    )
  ).rows.map((r) => r.version);
  expect(versions).toEqual(versions.map((_, i) => i + 1));
});

test('a revoked member and a disabled account lose read access immediately', async () => {
  const invitation = await workspaces().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic profile temporary reader',
  });
  const accepted = await workspaces('dave').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  expect((await service('dave').view({ workspaceId })).canEdit).toBe(false);
  await workspaces().access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: accepted.memberId,
  });
  expect((await rejected(service('dave').view({ workspaceId }))).code).toBe('42501');
  expect((await service('bob').view({ workspaceId })).canEdit).toBe(false);
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
    [subject('bob')],
  );
  expect((await rejected(service('bob').view({ workspaceId }))).code).toBe('42501');
});

test('the account-context guard and session checks run before any database work', async () => {
  const before = await counts();
  expect((await rejected(service().view({ workspaceId }, 'someone-else'))).message).toContain(
    'account changed',
  );
  expect(
    (
      await rejected(
        service().view(
          { workspaceId },
          subject('alice'),
          'https://ep-other.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        ),
      )
    ).message,
  ).toContain('account changed');
  const unverified = new CustomerOrganisationProfileService(
    f.runtime,
    f.auth,
    options,
    async () => ({
      ...session('alice'),
      emailVerified: false,
    }),
  );
  expect((await rejected(unverified.view({ workspaceId }))).message).toContain('Verify');
  const expired = new CustomerOrganisationProfileService(f.runtime, f.auth, options, async () => ({
    ...session('alice'),
    expiresAt: new Date(Date.now() - 1000),
  }));
  expect((await rejected(expired.view({ workspaceId }))).message).toContain('Sign in');
  const disabled = new CustomerOrganisationProfileService(
    f.runtime,
    f.auth,
    { ...options, enabled: false },
    async () => session('alice'),
  );
  expect((await rejected(disabled.view({ workspaceId }))).message).toContain('unavailable');
  expect(await counts()).toEqual(before);
});
