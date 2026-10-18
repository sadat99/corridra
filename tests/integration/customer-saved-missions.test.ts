import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerSavedMissionService,
  customerSavedMissionsEnabled,
} from '../../packages/auth/src/customer-saved-missions';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { MissionService } from '../../packages/missions/src/index';
import { DeliveryService } from '../../packages/delivery/src/index';
import { intakeTemplate } from '../../packages/delivery/src/import';
const issuer = 'https://ep-saved-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>,
  delivery: DeliveryService,
  publicationId: string,
  programmeId: string;
let link: { id: string; token: string }, saved: { id: string };
let migrationPreserved = false;
const principals: Record<string, string> = {};
const session = (person: string) => ({
  subject: 'synthetic-saved-' + person,
  expiresAt: new Date(Date.now() + 3600000),
  emailVerified: true,
});
const service = (person = 'alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(person));
const workspace = (person: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const save = (token: string, commandId = randomUUID()) => ({
  action: 'save',
  commandId,
  token,
  acknowledged: true,
});
async function share(expiresAt = new Date(Date.now() + 86400000).toISOString()) {
  return delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic private commercial delivery navigation',
    expiresAt,
    allowExport: false,
    approved: true,
  });
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  for (const person of ['alice', 'bob', 'disabled', 'pages'])
    principals[person] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Fictional customer saved mission fixture,never real provider data',
      })
    ).id;
  const w = await workspace('bob').provision({
    commandId: randomUUID(),
    name: 'Synthetic independent customer workspace',
  });
  const invitation = await workspace('bob').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: w.id,
    label: 'Synthetic private participant',
  });
  await workspace('alice').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  delivery = new DeliveryService(
    f.runtime,
    new MissionService(f.runtime, 'synthetic-saved-secret'),
    'synthetic-saved-secret',
  );
  const programme = await delivery.programme(f.users.owner.ctx, {
    commandId: randomUUID(),
    name: 'Synthetic staff managed programme',
    reportingPurpose: 'Synthetic scoped delivery preservation test',
  });
  programmeId = programme.id;
  const preview = await delivery.preview(
    f.users.owner.ctx,
    programmeId,
    randomUUID(),
    Buffer.from(intakeTemplate()),
    'CSV',
  );
  const accepted = await delivery.confirm(f.users.owner.ctx, {
    commandId: randomUUID(),
    importId: preview.id,
    ownerId: f.users.operator.id,
    counts: preview.counts,
    acknowledged: true,
  });
  const publication = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: accepted.rows[0].missionId,
    title: 'Original approved commercial scope 工厂 বাংলা',
    company: 'Synthetic scoped company',
    objective: 'Find relevant commercial relationships',
    brief: 'Approved synthetic information without private contacts.',
    nextAction: 'Review requirements and proposed activities',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  publicationId = publication.id;
  link = await share();
  const functions = (
    await f.owner.query(
      `SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid`,
    )
  ).rows;
  const tables = (
    await f.owner.query(
      `SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid`,
    )
  ).rows;
  const records: Record<string, string> = {};
  const digest = async (t: (typeof tables)[number]) =>
    (
      await f.owner.query(
        "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) AS digest FROM \"" +
          t.nspname.replaceAll('"', '""') +
          '"."' +
          t.relname.replaceAll('"', '""') +
          '" v',
      )
    ).rows[0].digest as string;
  for (const table of tables) records[String(table.oid)] = await digest(table);
  const receipts = (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name'))
    .rows;
  await migrateCustomerSavedMissions(f.owner);
  expect(
    (
      await f.owner.query(
        'SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p WHERE p.oid=ANY($1::oid[]) ORDER BY p.oid',
        [functions.map((row) => row.oid)],
      )
    ).rows,
  ).toEqual(functions);
  expect(
    (
      await f.owner.query(
        `SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=ANY($1::oid[]) ORDER BY c.oid`,
        [tables.map((row) => row.oid)],
      )
    ).rows,
  ).toEqual(tables);
  for (const table of tables) expect(await digest(table)).toBe(records[String(table.oid)]);
  expect(
    (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
  ).toEqual(receipts);
  migrationPreserved = true;
  saved = await service().command(save(link.token));
});
afterAll(async () => {
  await f?.close();
});
test('stores no bearer or copied source;exact retry and duplicate save preserve one private binding and original domain records', async () => {
  const before = (
    await f.owner.query(
      'SELECT (SELECT count(*) FROM app.domain_event)::int events,(SELECT count(*) FROM app.mission)::int missions',
    )
  ).rows;
  const cmd = save(link.token);
  const a = await service().command(cmd),
    b = await service().command(cmd);
  expect(a.id).toBe(saved.id);
  expect(b).toEqual(a);
  const row = (
    await f.owner.query('SELECT * FROM customer_private.saved_mission WHERE id=$1', [saved.id])
  ).rows[0];
  expect(row.token_hash).toBe(createHash('sha256').update(link.token).digest('hex'));
  expect(JSON.stringify(row)).not.toContain(link.token);
  expect(Object.keys(row).sort()).toEqual([
    'created_at',
    'id',
    'link_id',
    'link_tenant_id',
    'principal_id',
    'removed_at',
    'token_hash',
  ]);
  expect(
    (
      await f.owner.query(
        'SELECT (SELECT count(*) FROM app.domain_event)::int events,(SELECT count(*) FROM app.mission)::int missions',
      )
    ).rows,
  ).toEqual(before);
  const other = await share();
  await expect(service().command({ ...cmd, token: other.token })).rejects.toMatchObject({
    code: '23514',
  });
});
test('creator views the unchanged V2 commercial report and source-backed counts;metadata never reveals digest or bearer', async () => {
  const viewed = await service().command({
    action: 'view',
    resourceId: saved.id,
    audience: 'CLIENT_PROGRESS',
  });
  const canonical = (await delivery.external({
    action: 'view',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
  })) as { generatedAt: string };
  expect(viewed.resourceId).toBe(saved.id);
  expect({ ...viewed.report, generatedAt: canonical.generatedAt }).toEqual(canonical);
  const list = await service().list();
  expect(list.missions.find((m: { id: string }) => m.id === saved.id)).toMatchObject({
    available: true,
    title: 'Original approved commercial scope 工厂 বাংলা',
  });
  expect(JSON.stringify(list)).not.toContain(link.token);
  expect(JSON.stringify(list)).not.toContain(createHash('sha256').update(link.token).digest('hex'));
});
test('workspace owner,other customer and unknown resources cannot inherit saved access;account pins reject stale contexts', async () => {
  await expect(
    service('bob').command({ action: 'view', resourceId: saved.id, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
  expect((await service('bob').list()).missions).toEqual([]);
  await expect(
    service().command({ action: 'view', resourceId: randomUUID(), audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(service().list({}, session('bob').subject, issuer)).rejects.toMatchObject({
    status: 409,
  });
  const explicit = await service('bob').command(save(link.token));
  expect(explicit.id).not.toBe(saved.id);
  expect(
    (
      await service('bob').command({
        action: 'view',
        resourceId: explicit.id,
        audience: 'CLIENT_PROGRESS',
      })
    ).report.scopeId,
  ).toBe(link.id);
});
test('invalid,institution and revoked capabilities cannot be saved;revoked entries retain no stale title or source', async () => {
  await expect(service().command(save('f'.repeat(64)))).rejects.toMatchObject({ code: '42501' });
  const institution = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId,
    publicationIds: [publicationId],
    audience: 'INSTITUTION_REPORT',
    purpose: 'Synthetic institutional report access',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    allowExport: true,
    approved: true,
  });
  await expect(service().command(save(institution.token))).rejects.toMatchObject({ code: '42501' });
  const temporary = await share();
  const item = await service().command(save(temporary.token));
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: temporary.id,
    publicationId: null,
    reason: 'Synthetic explicit scope revocation test',
  });
  await expect(
    service().command({ action: 'view', resourceId: item.id, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
  const page = await service().list();
  expect(page.missions.find((m: { id: string }) => m.id === item.id)).toEqual({
    id: item.id,
    available: false,
    removed: false,
  });
});
test('removing saved navigation is idempotent,does not revoke the canonical invitation,and old save retry cannot revive it', async () => {
  const unique = await share();
  const command = save(unique.token);
  const item = await service().command(command);
  const removal = { action: 'remove', commandId: randomUUID(), resourceId: item.id };
  expect(await service().command(removal)).toEqual({ id: item.id, removed: true });
  expect(await service().command(removal)).toEqual({ id: item.id, removed: true });
  expect(await service().command(command)).toEqual({
    id: item.id,
    available: false,
    removed: true,
  });
  await expect(
    service().command({ action: 'view', resourceId: item.id, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    await delivery.external({ action: 'view', token: unique.token, audience: 'CLIENT_PROGRESS' }),
  ).toMatchObject({ scopeId: unique.id });
  const fresh = await service().command(save(unique.token));
  expect(fresh.id).not.toBe(item.id);
});
test('source/link expiry cannot be extended by saving and locked reads deny late content', async () => {
  const short = await share(new Date(Date.now() + 500).toISOString());
  const item = await service().command(save(short.token));
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE app.delivery_publication IN ACCESS EXCLUSIVE MODE');
  const pending = service().command({
    action: 'view',
    resourceId: item.id,
    audience: 'CLIENT_PROGRESS',
  });
  const denial = expect(pending).rejects.toMatchObject({ code: '42501' });
  try {
    await f.owner.query('SELECT pg_sleep(0.65)');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  await denial;
  expect((await service().list()).missions.find((m: { id: string }) => m.id === item.id)).toEqual({
    id: item.id,
    available: false,
    removed: false,
  });
});
test('restricted SQL cannot mint customer identity or read private navigation;fresh identity and continuing principal admission remain mandatory', async () => {
  for (const sql of [
    'SELECT * FROM customer_private.saved_mission',
    'SELECT * FROM customer_private.saved_mission_command',
    'SELECT customer.saved_missions()',
  ])
    await expect(f.runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
  await expect(f.auth.query('SELECT customer.saved_missions()')).rejects.toMatchObject({
    code: '42501',
  });
  const absent = new CustomerSavedMissionService(f.runtime, f.auth, options, async () => null);
  await expect(absent.list()).rejects.toMatchObject({ status: 401 });
  const item = await service('disabled').command(save(link.token));
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE id=$1',
    [principals.disabled],
  );
  await expect(
    service('disabled').command({
      action: 'view',
      resourceId: item.id,
      audience: 'CLIENT_PROGRESS',
    }),
  ).rejects.toMatchObject({ code: '42501' });
});
test('separate module repeats safely and remains independently default-off,synthetic-only and hard-disabled in production', async () => {
  const receipts = (await f.owner.query('SELECT * FROM customer_commercial_migrations.applied'))
    .rows;
  await migrateCustomerSavedMissions(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_commercial_migrations.applied')).rows,
  ).toEqual(receipts);
  expect((await f.owner.query('SELECT * FROM customer_migrations.applied')).rows).toHaveLength(3);
  const enabled = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
  };
  expect(customerSavedMissionsEnabled({})).toBe(false);
  expect(customerSavedMissionsEnabled(enabled)).toBe(true);
  expect(customerSavedMissionsEnabled({ ...enabled, VERCEL_ENV: 'production' })).toBe(false);
  expect(customerSavedMissionsEnabled({ ...enabled, DATA_ENVIRONMENT: 'real' })).toBe(false);
});

test('saved scope reuses the original idempotent self-declaration port without granting other accounts response access', async () => {
  const request = await delivery.request(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId,
    ownerId: f.users.operator.id,
    title: 'Synthetic supporting information',
    instructions: 'Supply a fictional self-declaration only,never real documents.',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const command = {
    action: 'respond',
    resourceId: saved.id,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: request.id,
    body: 'Fictional response requiring independent review',
    acknowledged: true,
  };
  await expect(service('bob').command(command)).rejects.toMatchObject({ code: '42501' });
  const response = await service().command(command);
  expect(response).toEqual({
    resourceId: saved.id,
    response: { id: command.commandId, claimStatus: 'self_declared' },
  });
  expect(await service().command(command)).toEqual(response);
  await expect(
    service().command({ ...command, body: 'Changed response must not overwrite history' }),
  ).rejects.toMatchObject({ code: '23514' });
  const observed = await service().command({
    action: 'view',
    resourceId: saved.id,
    audience: 'CLIENT_PROGRESS',
  });
  expect(
    observed.report.missions[0].requests.find((r: { id: string }) => r.id === request.id),
  ).toMatchObject({ response: command.body, claimStatus: 'self_declared' });
});

test('saved capability bindings and command audit remain immutable;only one-way navigation removal is permitted', async () => {
  await expect(
    f.owner.query('UPDATE customer_private.saved_mission SET token_hash=$1 WHERE id=$2', [
      'e'.repeat(64),
      saved.id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    f.owner.query('DELETE FROM customer_private.saved_mission WHERE id=$1', [saved.id]),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.saved_mission_command WHERE principal_id=$1', [
      principals.alice,
    ]),
  ).rejects.toThrow();
});

test('populated commercial and customer upgrade preserves every old function,ACL,RLS table,source row digest and customer migration receipt', () => {
  expect(migrationPreserved).toBe(true);
});

test('creator-only pagination is bounded and exhaustive without duplicating canonical commercial missions', async () => {
  for (let index = 0; index < 27; index++) {
    const invitation = await share();
    await service('pages').command(save(invitation.token));
  }
  let after: string | undefined;
  const ids: string[] = [];
  const sizes: number[] = [];
  do {
    const page = await service('pages').list({ ...(after ? { after } : {}), pageSize: 10 });
    sizes.push(page.missions.length);
    ids.push(...page.missions.map((m: { id: string }) => m.id));
    after = page.nextAfter ?? undefined;
  } while (after);
  expect(sizes).toEqual([10, 10, 7]);
  expect(new Set(ids).size).toBe(27);
  expect(ids).toEqual([...ids].sort());
  await expect(service('pages').list({ pageSize: 26 })).rejects.toThrow();
});
