import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { fixture } from './support';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerRequestDetails } from '../../packages/db/src/customer-detail-migrate';
import { migrateCustomerMissionShares } from '../../packages/db/src/customer-mission-share-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerRequestDetailService } from '../../packages/auth/src/customer-request-details';
import {
  CustomerMissionShareService,
  customerMissionSharesEnabled,
} from '../../packages/auth/src/customer-mission-shares';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
const issuer = 'https://ep-objective-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>,
  programmeWorkspace: string,
  requestWorkspace: string,
  programmeId: string;
const ids: Record<string, string> = {};
const session = (person = 'bob') => ({
  subject: 'synthetic-objective-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspace = (p = 'bob') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(p));
const participants = (p = 'bob') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(p));
const shares = (p = 'bob') =>
  new CustomerMissionShareService(f.runtime, f.auth, options, async () => session(p));
const details = (p = 'bob') =>
  new CustomerRequestDetailService(f.runtime, f.auth, options, async () => session(p));
const brief = () => ({
  objective: 'Source suppliers' as const,
  market: 'China',
  attendance: 'Not decided' as const,
  startDate: '',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Synthetic original machinery 工厂 বাংলা ' + randomUUID(),
  website: 'https://example.invalid/',
  outcomes: ['Supplier visits' as const],
  notes: 'Original private installation exclusions',
  name: 'Synthetic Person',
  company: 'Synthetic Private Company',
  email: 'objective@example.invalid',
  acknowledged: true as const,
});
async function request() {
  const missions = new MissionService(f.runtime, 'synthetic-objective-secret');
  const original = brief();
  const result = await new CustomerRequestService(f.runtime, f.auth, options, async () =>
    session(),
  ).submit({ commandId: randomUUID(), workspaceId: requestWorkspace, brief: original }, (c, b) =>
    missions.prepareCustomerIntake(c, b),
  );
  return { original, ...result };
}
async function registration(person = 'bob') {
  const invitation = await participants('alice').command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: programmeWorkspace,
    programmeId,
    label: 'Synthetic private invitation',
    acknowledged: true,
  });
  return participants(person).command({
    action: 'accept',
    commandId: randomUUID(),
    programmeId,
    token: invitation.token,
    displayLabel: 'Synthetic ' + person + ' participant',
    consented: true,
  });
}
async function scenario() {
  programmeId = (
    await new CustomerProgrammeService(f.runtime, f.auth, options, async () =>
      session('alice'),
    ).create({
      commandId: randomUUID(),
      workspaceId: programmeWorkspace,
      name: 'Synthetic independent scenario',
      reportingPurpose: 'Synthetic isolated summary consent scenario',
      acknowledged: true,
    })
  ).id;
  const reg = await registration();
  const req = await request();
  return {
    reg,
    req,
    command: {
      action: 'share',
      commandId: randomUUID(),
      registrationId: reg.id,
      requestId: req.id,
      summary: 'Synthetic supplier objective 工厂 বাংলা',
      consented: true,
      expectedVersion: 0,
    },
  };
}
async function raw(person: string, sql: string, args: unknown[] = [], lifetime = 25000) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond')",
    [hash, issuer, session(person).subject, lifetime],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const r = await db.query(sql, args);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid",
    )
  ).rows;
  const tables = (
    await f.owner.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid",
    )
  ).rows;
  const rows: Record<string, string> = {};
  for (const t of tables) {
    const q = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    rows[t.oid] = (
      await f.owner.query(
        "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM " +
          q(t.nspname) +
          '.' +
          q(t.relname) +
          ' v',
      )
    ).rows[0].digest;
  }
  const receipts: Record<string, unknown> = {};
  for (const schema of [
    'migrations',
    'customer_migrations',
    'customer_programme_migrations',
    'customer_participant_migrations',
    'customer_detail_migrations',
  ])
    receipts[schema] = (
      await f.owner.query('SELECT * FROM ' + schema + '.applied ORDER BY name')
    ).rows;
  return {
    functions,
    tables,
    rows,
    receipts,
    policies: (
      await f.owner.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')
    ).rows,
  };
}
let old: Awaited<ReturnType<typeof snapshot>>;
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerParticipants(f.owner);
  await migrateCustomerRequestDetails(f.owner);
  for (const p of ['alice', 'bob', 'carol', 'member']) {
    ids[p] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(p).subject,
        executorId: f.serviceId,
        reason: 'Synthetic explicit participant objective acceptance',
      })
    ).id;
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: ids[p],
      reason: 'Synthetic separate private-request admission',
    });
  }
  programmeWorkspace = (
    await workspace('alice').provision({
      commandId: randomUUID(),
      name: 'Synthetic programme owner',
    })
  ).id;
  requestWorkspace = (
    await workspace().provision({
      commandId: randomUUID(),
      name: 'Synthetic private commercial workspace',
    })
  ).id;
  programmeId = (
    await new CustomerProgrammeService(f.runtime, f.auth, options, async () =>
      session('alice'),
    ).create({
      commandId: randomUUID(),
      workspaceId: programmeWorkspace,
      name: 'Synthetic commercial delegation',
      reportingPurpose: 'Synthetic explicit participant summary sharing only',
      acknowledged: true,
    })
  ).id;
  const invite = await workspace('alice').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: programmeWorkspace,
    label: 'Synthetic existing colleague',
  });
  await workspace('member').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invite.token,
  });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await request();
  old = await snapshot();
  await migrateCustomerMissionShares(f.owner);
});
afterAll(async () => {
  await f?.close();
});
test('additive installer preserves populated functions/ACL/RLS/tables/rows and retries without rewriting old receipts', async () => {
  const now = await snapshot();
  for (const fn of old.functions) expect(now.functions.find((v) => v.oid === fn.oid)).toEqual(fn);
  expect(now.tables.filter((t) => old.tables.some((o) => o.oid === t.oid))).toEqual(old.tables);
  for (const t of old.tables) expect(now.rows[t.oid]).toBe(old.rows[t.oid]);
  expect(now.policies).toEqual(old.policies);
  expect(now.receipts).toEqual(old.receipts);
  const before = (await f.owner.query('SELECT * FROM customer_mission_share_migrations.applied'))
    .rows;
  await migrateCustomerMissionShares(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM customer_mission_share_migrations.applied')).rows,
  ).toEqual(before);
});
test('same canonical mission reused across three authorities;organiser sees only expressly shared text', async () => {
  const { reg, req, command } = await scenario();
  const count = Number((await f.owner.query('SELECT count(*) FROM app.mission')).rows[0].count);
  const saved = await shares().command(command);
  expect(saved.status).toBe('SHARED');
  expect((await f.owner.query('SELECT count(*) FROM app.mission')).rows[0].count).toBe(
    String(count),
  );
  expect(new Set([programmeWorkspace, requestWorkspace, f.tenantA]).size).toBe(3);
  const own = await shares().summaries({ registrationId: reg.id, view: 'own' });
  expect(own.objectives[0]).toMatchObject({ requestId: req.id, summary: command.summary });
  const view = await shares('alice').summaries({ registrationId: reg.id, view: 'manage' });
  expect(view.objectives[0]).toMatchObject({
    summary: command.summary,
    claimStatus: 'Self-declared',
  });
  const text = JSON.stringify(view);
  for (const secret of [
    req.id,
    f.tenantA,
    requestWorkspace,
    req.original.offer,
    req.original.email,
    'receiptHash',
    'requestId',
    'missionId',
    'original',
  ])
    expect(text).not.toContain(secret);
  expect((await details().detail(req.id)).original).toEqual(req.original);
  await expect(details('alice').detail(req.id)).rejects.toThrow();
});
test('original choices are creator-only;programme owner,colleague,other participant and forged registration denied', async () => {
  const { reg, req, command } = await scenario();
  const choices = await shares().choices({ registrationId: reg.id });
  expect(choices.requests.some((r: { id: string }) => r.id === req.id)).toBe(true);
  for (const p of ['alice', 'member', 'carol']) {
    await expect(shares(p).choices({ registrationId: reg.id })).rejects.toThrow();
    await expect(shares(p).summaries({ registrationId: reg.id, view: 'own' })).rejects.toThrow();
    await expect(shares(p).command(command)).rejects.toThrow();
  }
  for (const p of ['bob', 'member', 'carol'])
    await expect(shares(p).summaries({ registrationId: reg.id, view: 'manage' })).rejects.toThrow();
  await expect(shares().command({ ...command, registrationId: randomUUID() })).rejects.toThrow();
});
test('explicit consent,strict schemas,expected revision and fictional/control-free text enforced in service and SQL', async () => {
  const { command } = await scenario();
  for (const patch of [
    { consented: false },
    { summary: 'Real undisclosed objective' },
    { summary: 'Synthetic hidden\ncontrol' },
    { expectedVersion: -1 },
    { expectedVersion: undefined },
    { privateContact: 'forbidden' },
  ])
    await expect(shares().command({ ...command, ...patch })).rejects.toThrow();
  for (const patch of [
    { consented: false },
    { summary: 'Synthetic hidden\ncontrol' },
    { expectedVersion: null },
    { registrationId: null },
  ]) {
    const { action, commandId, ...payload } = { ...command, ...patch };
    await expect(
      raw('bob', 'SELECT customer.programme_mission_command($1,$2,$3)', [
        commandId,
        action,
        JSON.stringify(payload),
      ]),
    ).rejects.toThrow();
  }
});
test('exact retries append once;new stale edits conflict;superseded retry cannot restore old consent', async () => {
  const { reg, command } = await scenario();
  const first = await shares().command(command);
  expect(await shares().command(command)).toEqual(first);
  const revision = await shares().command({
    ...command,
    commandId: randomUUID(),
    summary: 'Synthetic amended objective',
    expectedVersion: first.version,
  });
  expect(revision.version).toBe(first.version + 1);
  await expect(
    shares().command({ ...command, commandId: randomUUID(), summary: 'Synthetic stale overwrite' }),
  ).rejects.toThrow(/version conflict/i);
  await expect(shares().command(command)).rejects.toThrow(/superseded/i);
  const w = {
    action: 'withdraw',
    commandId: randomUUID(),
    linkId: first.id,
    expectedVersion: revision.version,
    reason: 'Synthetic participant withdraws summary',
    acknowledged: true,
  };
  const withdrawn = await shares().command(w);
  expect(await shares().command(w)).toEqual(withdrawn);
  const view = await shares('alice').summaries({ registrationId: reg.id, view: 'manage' });
  expect(view.objectives[0].status).toBe('WITHDRAWN');
  expect(JSON.stringify(view)).not.toContain('amended objective');
  expect(
    (
      await f.owner.query(
        'SELECT count(*) FROM customer_private.programme_mission_revision WHERE link_id=$1',
        [first.id],
      )
    ).rows[0].count,
  ).toBe('3');
});
test('withdrawing programme membership removes summary visibility but preserves original private mission', async () => {
  const { reg, req, command } = await scenario();
  const saved = await shares().command(command);
  await participants().command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: reg.id,
    reason: 'Synthetic independent programme departure',
    acknowledged: true,
  });
  expect(
    (await shares('alice').summaries({ registrationId: reg.id, view: 'manage' })).objectives,
  ).toEqual([]);
  await expect(
    shares().command({ ...command, commandId: randomUUID(), expectedVersion: saved.version }),
  ).rejects.toThrow();
  expect((await details().detail(req.id)).available).toBe(true);
  await shares().command({
    action: 'withdraw',
    commandId: randomUUID(),
    linkId: saved.id,
    expectedVersion: saved.version,
    reason: 'Synthetic explicit objective withdrawal',
    acknowledged: true,
  });
});
test('source revocation removes dependent summary and never falls back or revokes registration', async () => {
  const { reg, req, command } = await scenario();
  const saved = await shares().command(command);
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: req.id,
    reason: 'Synthetic original source permission withdrawal',
  });
  const v = await shares('alice').summaries({ registrationId: reg.id, view: 'manage' });
  expect(v.active).toBe(true);
  expect(v.objectives[0]).toEqual({ id: saved.id, version: 1, status: 'UNAVAILABLE' });
  await expect(shares().command(command)).rejects.toThrow();
});
test('null manage view cannot bypass ownership;private tables/helpers and rewrite commands denied', async () => {
  const { reg, command } = await scenario();
  const s = await shares().command(command);
  await expect(
    raw('carol', 'SELECT customer.programme_mission_summaries($1,NULL)', [reg.id]),
  ).rejects.toThrow();
  for (const table of [
    'programme_mission_link',
    'programme_mission_revision',
    'programme_mission_command',
  ]) {
    await expect(f.runtime.query('SELECT * FROM customer_private.' + table)).rejects.toThrow();
    await expect(f.auth.query('SELECT * FROM customer_private.' + table)).rejects.toThrow();
  }
  await expect(
    raw('bob', 'SELECT customer_private.programme_mission_source($1)', [s.id]),
  ).rejects.toThrow();
  await expect(
    f.owner.query(
      'UPDATE customer_private.programme_mission_revision SET summary=$1 WHERE link_id=$2',
      ['Synthetic rewrite', s.id],
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.programme_mission_link WHERE id=$1', [s.id]),
  ).rejects.toThrow();
});
test('actual service/customer attribution and atomic event/audit/outbox exclude private source and text', async () => {
  const { req, command } = await scenario();
  const saved = await shares().command(command);
  const events = (
    await f.owner.query('SELECT * FROM app.domain_event WHERE correlation_id=$1', [
      command.commandId,
    ])
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(f.serviceId);
  expect(events[0].payload.initiator_id).toBe(ids.bob);
  for (const value of [req.id, req.original.offer, command.summary])
    expect(JSON.stringify(events)).not.toContain(value);
  for (const table of ['audit_event', 'outbox'])
    expect(
      Number(
        (
          await f.owner.query(
            'SELECT count(*) FROM app.' +
              table +
              ' WHERE ' +
              (table === 'audit_event' ? 'domain_event_id' : 'event_id') +
              '=$1',
            [events[0].id],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  expect(saved.changed).toBe(true);
});
test('concurrent independent edits at same expected version have one winner and one explicit conflict', async () => {
  const { command } = await scenario();
  const outcomes = await Promise.allSettled([
    shares().command(command),
    shares().command({
      ...command,
      commandId: randomUUID(),
      summary: 'Synthetic competing objective',
    }),
  ]);
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((x) => x.status === 'rejected')).toHaveLength(1);
});
test('gates require every participant/request prerequisite and stay production hard off', () => {
  const env = {
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'preview',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_COLLABORATION_ENABLED: 'true',
    CORRIDRA_CUSTOMER_REQUESTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_MISSION_SHARES_ENABLED: 'true',
  };
  expect(customerMissionSharesEnabled(env)).toBe(true);
  for (const key of [
    'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
    'CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED',
    'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
    'CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED',
    'CORRIDRA_CUSTOMER_MISSION_SHARES_ENABLED',
  ])
    expect(customerMissionSharesEnabled({ ...env, [key]: 'false' })).toBe(false);
  expect(customerMissionSharesEnabled({})).toBe(false);
  expect(customerMissionSharesEnabled({ ...env, VERCEL_ENV: 'production' })).toBe(false);
  expect(customerMissionSharesEnabled({ ...env, DATA_ENVIRONMENT: 'real' })).toBe(false);
});
test('late proof expiry at a real event insert rolls back grant,revision,command,event,audit and outbox', async () => {
  const { command } = await scenario();
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE app.domain_event IN SHARE MODE');
  let failure: unknown;
  try {
    const { action, commandId, ...payload } = command;
    const pending = raw(
      'bob',
      'SELECT customer.programme_mission_command($1,$2,$3)',
      [commandId, action, JSON.stringify(payload)],
      150,
    ).catch((e) => {
      failure = e;
    });
    await new Promise((r) => setTimeout(r, 350));
    await lock.query('COMMIT');
    await pending;
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect(String(failure)).toMatch(/expired|access/i);
  expect(
    (
      await f.owner.query(
        'SELECT count(*) FROM customer_private.programme_mission_command WHERE command_id=$1',
        [command.commandId],
      )
    ).rows[0].count,
  ).toBe('0');
  expect(
    (
      await f.owner.query(
        'SELECT count(*) FROM customer_private.programme_mission_link WHERE registration_id=$1',
        [command.registrationId],
      )
    ).rows[0].count,
  ).toBe('0');
  expect(
    (
      await f.owner.query('SELECT count(*) FROM app.domain_event WHERE correlation_id=$1', [
        command.commandId,
      ])
    ).rows[0].count,
  ).toBe('0');
});
test('registration revoked while waiting for workspace lock prevents even an exact retry from disclosing or sharing', async () => {
  const { reg, command } = await scenario();
  const saved = await shares().command(command);
  const lock = await f.owner.connect();
  await lock.query('BEGIN');
  await lock.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||$1::text,0))",
    [programmeWorkspace],
  );
  let failure: unknown;
  try {
    const pending = shares()
      .command(command)
      .catch((e) => {
        failure = e;
      });
    await new Promise((r) => setTimeout(r, 100));
    await f.owner.query(
      "INSERT INTO customer_private.programme_participant_revocation(workspace_id,programme_id,registration_id,created_by,reason) VALUES($1,$2,$3,$4,'Synthetic concurrent permission withdrawal')",
      [programmeWorkspace, programmeId, reg.id, ids.alice],
    );
    await lock.query('COMMIT');
    await pending;
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect(String(failure)).toMatch(/unavailable|access/i);
  expect(
    (await shares('alice').summaries({ registrationId: reg.id, view: 'manage' })).objectives,
  ).toEqual([]);
  expect(
    (
      await f.owner.query(
        'SELECT count(*) FROM customer_private.programme_mission_revision WHERE link_id=$1',
        [saved.id],
      )
    ).rows[0].count,
  ).toBe('1');
});
test('unknown optional migration receipt fails closed without changing accepted optional history', async () => {
  const name = '9999_unknown.sql';
  await f.owner.query(
    'INSERT INTO customer_mission_share_migrations.applied(name,sha256) VALUES($1,$2)',
    [name, 'f'.repeat(64)],
  );
  try {
    await expect(migrateCustomerMissionShares(f.owner)).rejects.toThrow('history mismatch');
  } finally {
    await f.owner.query('DELETE FROM customer_mission_share_migrations.applied WHERE name=$1', [
      name,
    ]);
  }
  await migrateCustomerMissionShares(f.owner);
});
test('retention expiry suppresses dependent summary without rewriting original source history', async () => {
  await f.owner.query(
    "CREATE FUNCTION customer_private.objective_short_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.retention_until:=clock_timestamp()+interval '700 milliseconds';RETURN NEW;END $$",
  );
  await f.owner.query(
    'CREATE TRIGGER objective_short_retention BEFORE INSERT ON app.mission_intake FOR EACH ROW EXECUTE FUNCTION customer_private.objective_short_retention()',
  );
  let ctx: Awaited<ReturnType<typeof scenario>>;
  try {
    ctx = await scenario();
  } finally {
    await f.owner.query('DROP TRIGGER objective_short_retention ON app.mission_intake');
    await f.owner.query('DROP FUNCTION customer_private.objective_short_retention()');
  }
  const s = await shares().command(ctx.command);
  await new Promise((r) => setTimeout(r, 800));
  const v = await shares('alice').summaries({ registrationId: ctx.reg.id, view: 'manage' });
  expect(v.objectives).toEqual([{ id: s.id, version: 1, status: 'UNAVAILABLE' }]);
  expect((await details().detail(ctx.req.id)).original).toBeNull();
});
test('stored revision constraints reject null shared objectives and null withdrawal reasons', async () => {
  const { command } = await scenario();
  const saved = await shares().command(command);
  for (const status of ['SHARED', 'WITHDRAWN'])
    await expect(
      f.owner.query(
        'INSERT INTO customer_private.programme_mission_revision(link_id,version,status,summary,reason,created_by) VALUES($1,2,$2,NULL,NULL,$3)',
        [saved.id, status, ids.bob],
      ),
    ).rejects.toMatchObject({ code: '23514' });
});
