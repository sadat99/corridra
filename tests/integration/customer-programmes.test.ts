import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture, rawContext, freshDatabase } from './support';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import {
  CustomerProgrammeService,
  customerProgrammesEnabled,
} from '../../packages/auth/src/customer-programmes';
import { DeliveryService } from '../../packages/delivery/src/index';
import { MissionService } from '../../packages/missions/src/index';
import { intakeTemplate } from '../../packages/delivery/src/import';
const issuer = 'https://ep-programme-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>,
  workspaceId: string,
  otherWorkspace: string,
  createdId: string;
let preserved = false;
const session = (person = 'alice') => ({
  subject: 'synthetic-programme-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const service = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const workspace = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const input = (target = workspaceId) => ({
  commandId: randomUUID(),
  workspaceId: target,
  name: 'Synthetic organiser programme 工厂 বাংলা',
  reportingPurpose: 'Fictional programme planning only,not a live commercial delegation',
  acknowledged: true,
});
const delivery = () =>
  new DeliveryService(
    f.runtime,
    new MissionService(f.runtime, 'synthetic-programme-secret'),
    'synthetic-programme-secret',
  );
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition,p.proacl,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid",
    )
  ).rows;
  const policies = (
    await f.owner.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity','customer','customer_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const tables = (
    await f.owner.query(
      "SELECT c.oid,n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') ORDER BY c.oid",
    )
  ).rows;
  const rows: Record<string, string> = {};
  for (const t of tables) {
    const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    rows[t.oid] = (
      await f.owner.query(
        "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM " +
          quote(t.nspname) +
          '.' +
          quote(t.relname) +
          ' v',
      )
    ).rows[0].digest;
  }
  return {
    functions,
    policies,
    tables,
    rows,
    core: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    base: (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
  };
}
async function rawProof(work: (hash: string) => Promise<unknown>, milliseconds = 25000) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+$4*interval '1 millisecond')",
    [hash, issuer, session().subject, milliseconds],
  );
  try {
    return await work(hash);
  } finally {
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
async function raw(hash: string, sql: string, args: unknown[] = []) {
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
beforeAll(async () => {
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  for (const person of ['alice', 'bob', 'member', 'admin'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional programme authority acceptance fixture,no real customer identity',
    });
  workspaceId = (
    await workspace().provision({ commandId: randomUUID(), name: 'Synthetic organiser workspace' })
  ).id;
  otherWorkspace = (
    await workspace('bob').provision({
      commandId: randomUUID(),
      name: 'Synthetic unrelated workspace',
    })
  ).id;
  for (const person of ['member']) {
    const invite = await workspace().access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic ' + person,
    });
    await workspace(person).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invite.token,
    });
  }
  await f.owner.query(
    "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
    [workspaceId, issuer, session('admin').subject],
  );
  // Populate the original engine before installing the optional forward extension.
  await delivery().programme(f.users.owner.ctx, {
    commandId: randomUUID(),
    name: 'Original staff programme',
    reportingPurpose: 'Original staff authority and source history must remain intact',
  });
  // Upgrade alongside all accepted optional customer engines, not an obsolete baseline.
  await migrateCustomerCompanies(f.owner);
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  const before = await snapshot();
  await migrateCustomerProgrammes(f.owner);
  const after = await snapshot();
  for (const original of before.functions) {
    const changed = after.functions.find((p) => p.name === original.name);
    expect(changed?.proacl).toEqual(original.proacl);
    expect(changed?.proowner).toBe(original.proowner);
    if (!['app.delivery_guard()', 'app.record_change()'].includes(original.name))
      expect(changed).toEqual(original);
  }
  expect(
    after.functions
      .filter((p) =>
        before.functions.some((q) => q.name === p.name && q.definition !== p.definition),
      )
      .map((p) => p.name)
      .sort(),
  ).toEqual(['app.delivery_guard()', 'app.record_change()']);
  expect(after.policies).toEqual(before.policies);
  expect(after.tables.filter((t) => before.tables.some((b) => b.oid === t.oid))).toEqual(
    before.tables,
  );
  for (const t of before.tables) expect(after.rows[t.oid]).toBe(before.rows[t.oid]);
  expect(after.core).toEqual(before.core);
  expect(after.base).toEqual(before.base);
  preserved = true;
});
afterAll(async () => {
  await f?.close();
});
test('optional upgrade preserves populated records,all policies/ACLs/history and all functions except the two reviewed extensions', async () => {
  expect(preserved).toBe(true);
  await migrateCustomerProgrammes(f.owner);
  await migrateCustomerAuthority(f.owner);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_migrations.applied')).rows[0].n,
  ).toBe(3);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_programme_migrations.applied'))
      .rows[0].n,
  ).toBe(1);
});
test('owner creates exactly one canonical programme under concurrent exact retry with real service and customer attribution', async () => {
  const value = input();
  const [a, b] = await Promise.all([service().create(value), service().create(value)]);
  expect(a).toEqual(b);
  createdId = a.id;
  expect(a.workspaceId).toBe(workspaceId);
  const row = (await f.owner.query('SELECT * FROM app.delivery_programme WHERE id=$1', [a.id]))
    .rows[0];
  expect(row.created_by).toBe(f.serviceId);
  expect(row.name).toBe(value.name);
  const events = (
    await f.owner.query(
      "SELECT * FROM app.domain_event WHERE aggregate_id=$1 AND type='delivery_programme.insert'",
      [a.id],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(f.serviceId);
  expect(events[0].payload).toMatchObject({
    initiator_kind: 'customer',
    customer_workspace_id: workspaceId,
    command_id: value.commandId,
    authority: 'customer_programme_command',
  });
  for (const table of ['app.audit_event', 'app.outbox'])
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM ' +
            table +
            ' WHERE ' +
            (table.endsWith('audit_event') ? 'domain_event_id' : 'event_id') +
            '=$1',
          [events[0].id],
        )
      ).rows[0].n,
    ).toBe(1);
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_private.programme_execution_grant'))
      .rows[0].n,
  ).toBe(0);
  await expect(
    service().create({ ...value, name: 'Conflicting fictional programme' }),
  ).rejects.toThrow('conflicts');
});
test('member,other workspace,unadmitted,anonymous and unverified identities cannot create or inspect programmes', async () => {
  for (const [person, target] of [
    ['member', workspaceId],
    ['bob', workspaceId],
    ['alice', otherWorkspace],
    ['unknown', workspaceId],
  ]) {
    await expect(service(person).create(input(target))).rejects.toMatchObject({ code: '42501' });
    await expect(service(person).list({ workspaceId: target })).rejects.toMatchObject({
      code: '42501',
    });
  }
  for (const identity of [null, { ...session(), emailVerified: false }])
    await expect(
      new CustomerProgrammeService(f.runtime, f.auth, options, async () => identity).create(
        input(),
      ),
    ).rejects.toThrow();
  await expect(service().create(input(), session('bob').subject, issuer)).rejects.toMatchObject({
    status: 409,
  });
});
test('programme listing returns only canonical customer-created planning metadata with bounded pagination', async () => {
  for (let n = 0; n < 3; n++) await service().create(input());
  const first = await service().list({ workspaceId, pageSize: 2 });
  expect(first.programmes).toHaveLength(2);
  expect(first.nextAfter).toBeTruthy();
  const second = await service().list({ workspaceId, pageSize: 2, after: first.nextAfter });
  expect(second.programmes).toHaveLength(2);
  expect(second.nextAfter).toBeNull();
  expect(new Set([...first.programmes, ...second.programmes].map((p) => p.id)).size).toBe(4);
  expect(JSON.stringify(first)).not.toContain('Original staff programme');
  expect(first.programmes[0]).not.toHaveProperty('participants');
});
test('runtime cannot forge grants,call private helpers,read private bindings or bypass canonical RLS', async () => {
  await expect(
    f.runtime.query('SELECT * FROM customer_private.programme_execution_grant'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.auth.query('SELECT * FROM customer_private.programme_creation'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.runtime.query(
      "SELECT customer_private.programme_execution_context('app.delivery_programme'::regclass,'{}')",
    ),
  ).rejects.toMatchObject({ code: '42501' });
  await rawProof(async (hash) => {
    expect((await raw(hash, 'SELECT * FROM app.delivery_programme')).rows).toHaveLength(0);
    await expect(
      raw(
        hash,
        "WITH flag AS MATERIALIZED (SELECT set_config('corridra.customer_programme_execution',repeat('a',64),true)) INSERT INTO app.delivery_programme(id,tenant_id,name,reporting_purpose,created_by) SELECT $1,$2,'Forged programme','Fabricated grant must never authorize',$3 FROM flag",
        [randomUUID(), workspaceId, f.serviceId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
test('canonical binding is immutable and service execution does not grant staff membership or private mission access', async () => {
  await expect(
    f.owner.query(
      'UPDATE customer_private.programme_creation SET command_id=$1 WHERE programme_id=$2',
      [randomUUID(), createdId],
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.programme_creation WHERE programme_id=$1', [
      createdId,
    ]),
  ).rejects.toThrow();
  expect(
    (await f.owner.query('SELECT * FROM app.membership WHERE tenant_id=$1', [workspaceId])).rows,
  ).toHaveLength(0);
  await rawProof(async (hash) => {
    expect((await raw(hash, 'SELECT app.actor_id() id')).rows[0].id).toBeNull();
    expect((await raw(hash, 'SELECT * FROM app.delivery_participant')).rows).toHaveLength(0);
  });
});
test('unchanged staff owner/operator commands work and viewer/reviewer/cross-tenant sharing authority remains denied after upgrade', async () => {
  for (const role of ['owner', 'operator'])
    await expect(
      delivery().programme(f.users[role].ctx, {
        commandId: randomUUID(),
        name: 'Staff ' + role + ' after upgrade',
        reportingPurpose: 'Existing staff authority must remain functional after additive upgrade',
      }),
    ).resolves.toHaveProperty('id');
  for (const role of ['viewer', 'reviewer', 'outsider'])
    await expect(
      delivery().programme(f.users[role].ctx, {
        commandId: randomUUID(),
        name: 'Denied staff programme',
        reportingPurpose: 'Existing role denials must remain enforced after upgrade',
      }),
    ).rejects.toThrow();
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.other.ctx,
        'SELECT * FROM app.delivery_programme WHERE tenant_id=$1',
        [f.tenantA],
      )
    ).rows,
  ).toHaveLength(0);
});
test('expired proof after waiting for workspace authority cannot create a programme or events', async () => {
  const lock = await f.owner.connect();
  const value = input();
  await lock.query('BEGIN');
  await lock.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||$1::text,0))",
    [workspaceId],
  );
  try {
    await rawProof(async (hash) => {
      const pending = raw(hash, 'SELECT customer.create_programme($1,$2,$3,$4)', [
        value.commandId,
        workspaceId,
        value.name,
        value.reportingPurpose,
      ]);
      const denial = expect(pending).rejects.toMatchObject({ code: '42501' });
      await lock.query('SELECT pg_sleep(0.7)');
      await lock.query('COMMIT');
      await denial;
    }, 400);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  expect(
    (
      await f.owner.query('SELECT * FROM customer_private.programme_creation WHERE command_id=$1', [
        value.commandId,
      ])
    ).rows,
  ).toHaveLength(0);
});
test('feature requires the independent flag,synthetic workspace mode and nonproduction', () => {
  const env = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'preview',
  };
  expect(customerProgrammesEnabled(env)).toBe(true);
  expect(customerProgrammesEnabled({ ...env, VERCEL_ENV: 'production' })).toBe(false);
  expect(customerProgrammesEnabled({ ...env, DATA_ENVIRONMENT: 'real' })).toBe(false);
  expect(customerProgrammesEnabled({ ...env, CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'false' })).toBe(
    false,
  );
});

test('failed canonical insert rolls back programme,customer binding,event,audit,outbox and private grant atomically', async () => {
  const value = { ...input(), name: 'Synthetic forced atomic rollback' };
  const counts = async () =>
    (
      await f.owner.query(
        'SELECT (SELECT count(*) FROM app.delivery_programme)::int programmes,(SELECT count(*) FROM app.domain_event)::int events,(SELECT count(*) FROM app.audit_event)::int audits,(SELECT count(*) FROM app.outbox)::int outbox,(SELECT count(*) FROM customer_private.programme_creation)::int bindings',
      )
    ).rows[0];
  const before = await counts();
  await f.owner.query(
    "CREATE FUNCTION customer_private.test_programme_rollback() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW.name='Synthetic forced atomic rollback' THEN RAISE EXCEPTION 'Forced atomic acceptance failure'; END IF; RETURN NEW; END $$",
  );
  await f.owner.query(
    'CREATE TRIGGER zz_test_programme_rollback AFTER INSERT ON app.delivery_programme FOR EACH ROW EXECUTE FUNCTION customer_private.test_programme_rollback()',
  );
  try {
    await expect(service().create(value)).rejects.toThrow('Forced atomic acceptance failure');
    expect(await counts()).toEqual(before);
    expect(
      (await f.owner.query('SELECT * FROM customer_private.programme_execution_grant')).rows,
    ).toHaveLength(0);
  } finally {
    await f.owner.query('DROP TRIGGER zz_test_programme_rollback ON app.delivery_programme');
    await f.owner.query('DROP FUNCTION customer_private.test_programme_rollback()');
  }
  await expect(service().create(value)).resolves.toHaveProperty('id');
});
test('private grant requires exact canonical relation,row digest,backend,transaction,nonce and proof', async () => {
  await rawProof(async (hash) => {
    const db = await f.owner.connect(),
      nonce = 'b'.repeat(64),
      command = randomUUID();
    const row = {
      id: randomUUID(),
      tenant_id: workspaceId,
      name: 'Synthetic exact row',
      reporting_purpose: 'Fictional exact row grant binding',
      created_by: f.serviceId,
      created_at: '2026-10-18T00:00:00Z',
    };
    try {
      await db.query('BEGIN');
      await db.query(
        "SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.customer_programme_execution',$2,true)",
        [hash, nonce],
      );
      await db.query(
        "INSERT INTO customer_private.programme_execution_grant(nonce_hash,proof_hash,principal_id,workspace_id,executor_id,relation_oid,record_digest,backend_pid,transaction_id,command_id,expires_at) SELECT $1,$2,customer.actor_id(),$3,$4,'app.delivery_programme'::regclass,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),pg_backend_pid(),txid_current(),$6,clock_timestamp()+interval '10 seconds'",
        [nonce, hash, workspaceId, f.serviceId, JSON.stringify(row), command],
      );
      const context = async (relation = 'app.delivery_programme', data: unknown = row) =>
        (
          await db.query(
            'SELECT customer_private.programme_execution_context($1::regclass,$2::jsonb) result',
            [relation, JSON.stringify(data)],
          )
        ).rows[0].result;
      expect(await context()).toMatchObject({
        executorId: f.serviceId,
        attribution: { command_id: command },
      });
      expect(await context('app.delivery_programme', { ...row, name: 'Different row' })).toBeNull();
      expect(await context('app.delivery_participant')).toBeNull();
      await db.query('CREATE TEMP TABLE delivery_programme (LIKE app.delivery_programme)');
      expect(await context('pg_temp.delivery_programme')).toBeNull();
      await db.query(
        'UPDATE customer_private.programme_execution_grant SET transaction_id=transaction_id-1 WHERE nonce_hash=$1',
        [nonce],
      );
      expect(await context()).toBeNull();
      await db.query(
        'UPDATE customer_private.programme_execution_grant SET transaction_id=txid_current(),backend_pid=pg_backend_pid()+1 WHERE nonce_hash=$1',
        [nonce],
      );
      expect(await context()).toBeNull();
      await db.query(
        'UPDATE customer_private.programme_execution_grant SET backend_pid=pg_backend_pid() WHERE nonce_hash=$1',
        [nonce],
      );
      await db.query(
        "SELECT set_config('corridra.customer_programme_execution',repeat('c',64),true)",
      );
      expect(await context()).toBeNull();
      await db.query(
        "SELECT set_config('corridra.customer_programme_execution',$1,true),set_config('corridra.customer_proof_hash',repeat('d',64),true)",
        [nonce],
      );
      expect(await context()).toBeNull();
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
});
test('original publication and fresh-MFA sharing rules still run after optional upgrade', async () => {
  const d = delivery();
  const p = await d.programme(f.users.owner.ctx, {
    commandId: randomUUID(),
    name: 'Synthetic staff sharing after upgrade',
    reportingPurpose: 'Verify existing guarded staff publication behavior after additive upgrade',
  });
  const preview = await d.preview(
    f.users.owner.ctx,
    p.id,
    randomUUID(),
    Buffer.from(intakeTemplate()),
    'CSV',
  );
  const accepted = await d.confirm(f.users.owner.ctx, {
    commandId: randomUUID(),
    importId: preview.id,
    ownerId: f.users.operator.id,
    counts: preview.counts,
    acknowledged: true,
  });
  const publication = {
    commandId: randomUUID(),
    missionId: accepted.rows[0].missionId,
    title: 'Synthetic original staff publication',
    company: 'Fictional company',
    objective: 'Review fictional commercial programme',
    brief: 'Original reviewed fictional brief with no real personal information',
    nextAction: 'Review approved programme scope',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  };
  await expect(d.publication(f.users.operator.ctx, publication)).rejects.toThrow();
  await expect(d.publication(f.users.owner.ctx, publication)).resolves.toHaveProperty('id');
  await f.owner.query('DELETE FROM identity.assurance WHERE session_id=$1', [
    f.users.owner.sessionId,
  ]);
  try {
    await expect(
      d.publication(f.users.owner.ctx, { ...publication, commandId: randomUUID() }),
    ).rejects.toThrow();
  } finally {
    await f.owner.query("INSERT INTO identity.assurance VALUES($1,now(),'totp')", [
      f.users.owner.sessionId,
    ]);
  }
});

test('explicit current workspace admin can create;identity and unrelated workspace authority remain independent', async () => {
  const value = input();
  const result = await service('admin').create(value);
  expect(result.workspaceId).toBe(workspaceId);
  await expect(service('admin').list({ workspaceId })).resolves.toHaveProperty('programmes');
  await expect(service('admin').create(input(otherWorkspace))).rejects.toMatchObject({
    code: '42501',
  });
});
test('installer refuses changed original security contract before installing optional authority', async () => {
  const pool = await freshDatabase('corridra_upgrade');
  try {
    await migrateCustomerAuthority(pool);
    const original = (
      await pool.query("SELECT pg_get_functiondef('app.delivery_guard()'::regprocedure) definition")
    ).rows[0].definition as string;
    expect(original).toContain('BEGIN');
    await pool.query(original.replace('BEGIN', 'BEGIN\n PERFORM 1;'));
    await expect(migrateCustomerProgrammes(pool)).rejects.toThrow(
      'Original programme guard/event contract changed',
    );
    expect(
      (await pool.query("SELECT to_regnamespace('customer_programme_migrations') module")).rows[0]
        .module,
    ).toBeNull();
    expect(
      (await pool.query('SELECT count(*)::int n FROM customer_migrations.applied')).rows[0].n,
    ).toBe(3);
  } finally {
    await pool.end();
  }
});

test('unknown or changed optional receipts fail closed without changing base or programme records', async () => {
  const before = (await f.owner.query('SELECT * FROM customer_programme_migrations.applied'))
    .rows[0];
  try {
    await f.owner.query(
      "UPDATE customer_programme_migrations.applied SET sha256='invalid' WHERE name=$1",
      [before.name],
    );
    await expect(migrateCustomerProgrammes(f.owner)).rejects.toThrow(
      'Customer programme migration history mismatch',
    );
  } finally {
    await f.owner.query(
      'UPDATE customer_programme_migrations.applied SET sha256=$1 WHERE name=$2',
      [before.sha256, before.name],
    );
  }
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM customer_migrations.applied')).rows[0].n,
  ).toBe(3);
  await expect(service().list({ workspaceId })).resolves.toHaveProperty('programmes');
});
