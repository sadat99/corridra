import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fixture, freshDatabase, rawContext } from './support';
import { sessionHash } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  customerWorkspacesEnabled,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';

const issuer =
  'https://ep-autumn-scene-b17sgino.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let f: Awaited<ReturnType<typeof fixture>>;
let alice: string, bob: string;
const options = { enabled: true, synthetic: true, production: false, issuer };
const session = (subject = 'synthetic-alice'): CustomerSession => ({
  subject,
  expiresAt: new Date(Date.now() + 3600000),
  emailVerified: true,
});
const service = (subject = 'synthetic-alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(subject));
const request = (name = 'Synthetic customer workspace') => ({ name, commandId: randomUUID() });
async function proof(
  subject: string,
  work: (hash: string) => Promise<unknown>,
  proofIssuer = issuer,
) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')`,
    [hash, proofIssuer, subject],
  );
  try {
    return await work(hash);
  } finally {
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
async function rawCustomer(hash: string, sql: string, args: unknown[] = []) {
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
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
async function coreSnapshot() {
  const functions = await f.owner
    .query(`SELECT p.oid::regprocedure::text AS name,pg_get_functiondef(p.oid) AS definition,p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity') ORDER BY 1`);
  const policies = await f.owner.query(
    "SELECT * FROM pg_policies WHERE schemaname IN ('app','identity') ORDER BY schemaname,tablename,policyname",
  );
  const tables = await f.owner
    .query(`SELECT n.nspname,c.relname,c.relacl,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('app','identity') AND c.relkind='r' ORDER BY 1,2`);
  const records = [];
  for (const row of tables.rows) {
    const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
    const digest = await f.owner.query(
      `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS digest FROM ${quote(row.nspname)}.${quote(row.relname)} t`,
    );
    records.push({ table: `${row.nspname}.${row.relname}`, digest: digest.rows[0].digest });
  }
  const history = await f.owner.query('SELECT * FROM migrations.applied ORDER BY name');
  return {
    functions: functions.rows,
    policies: policies.rows,
    tables: tables.rows,
    records,
    history: history.rows,
  };
}

beforeAll(async () => {
  f = await fixture();
  const before = await coreSnapshot();
  await migrateCustomerAuthority(f.owner);
  expect(await coreSnapshot()).toEqual(before);
  alice = (
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'synthetic-alice',
      executorId: f.serviceId,
      reason: 'Explicit invented integration fixture; no provider identity or email',
    })
  ).id;
  bob = (
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'synthetic-bob',
      executorId: f.serviceId,
      reason: 'Explicit invented integration fixture; no provider identity or email',
    })
  ).id;
});
afterAll(async () => {
  await f?.close();
});

test('explicit customer install preserves populated core rows, ACLs, functions, RLS and all migration receipts', async () => {
  await migrateCustomerAuthority(f.owner);
  const dir = new URL('../../packages/db/customer-migrations/', import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const expected = await Promise.all(
    names.map(async (name) => ({
      name,
      sha256: createHash('sha256')
        .update(await readFile(new URL(name, dir)))
        .digest('hex'),
    })),
  );
  expect(expected.length).toBeGreaterThan(0);
  expect(
    (await f.owner.query('SELECT name,sha256 FROM customer_migrations.applied ORDER BY name')).rows,
  ).toEqual(expected);
  // The unchanged original runner still owns its original registry.
  await migrate(f.owner);
  expect((await f.owner.query('SELECT count(*)::int AS n FROM migrations.applied')).rows[0].n).toBe(
    29,
  );
});
test('fresh module install is explicit and repeatable', async () => {
  const pool = await freshDatabase('corridra_upgrade');
  try {
    await migrateCustomerAuthority(pool);
    const first = await pool.query('SELECT * FROM customer_migrations.applied ORDER BY name');
    await migrateCustomerAuthority(pool);
    expect(
      (await pool.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
    ).toEqual(first.rows);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM customer_private.configuration')).rows[0].n,
    ).toBe(0);
  } finally {
    await pool.end();
  }
});
test('changed and missing customer history fails closed without altering core history', async () => {
  const original = (
    await f.owner.query('SELECT name,sha256 FROM customer_migrations.applied ORDER BY name')
  ).rows[0];
  try {
    await f.owner.query('UPDATE customer_migrations.applied SET sha256=$1 WHERE name=$2', [
      'invalid',
      original.name,
    ]);
    await expect(migrateCustomerAuthority(f.owner)).rejects.toThrow(
      'Applied customer migration changed',
    );
  } finally {
    await f.owner.query('UPDATE customer_migrations.applied SET sha256=$1 WHERE name=$2', [
      original.sha256,
      original.name,
    ]);
  }
  try {
    await f.owner.query(
      "INSERT INTO customer_migrations.applied(name,sha256) VALUES('9999_missing.sql','invalid')",
    );
    await expect(migrateCustomerAuthority(f.owner)).rejects.toThrow(
      'Applied customer migration missing',
    );
  } finally {
    await f.owner.query("DELETE FROM customer_migrations.applied WHERE name='9999_missing.sql'");
  }
});
test('provisioning creates an owned synthetic tenant, one immutable command and one event/audit/outbox chain', async () => {
  const organisations = (await f.owner.query('SELECT count(*)::int AS n FROM app.organisation'))
    .rows[0].n;
  const input = request();
  const workspace = await service().provision(input);
  expect(workspace).toMatchObject({
    name: input.name,
    role: 'owner',
    synthetic: true,
    organisationId: null,
  });
  expect(await service().provision(input)).toEqual(workspace);
  expect(await service().list()).toContainEqual(workspace);
  expect(await service('synthetic-bob').list()).not.toContainEqual(workspace);
  const {
    rows: [event],
  } = await f.owner.query('SELECT * FROM app.domain_event WHERE tenant_id=$1', [workspace.id]);
  expect(event).toMatchObject({
    type: 'customer.workspace.provisioned',
    actor_id: f.serviceId,
    correlation_id: input.commandId,
    causation_id: input.commandId,
  });
  expect(event.payload).toMatchObject({
    initiator_kind: 'customer',
    initiator_id: alice,
    organisation_linked: false,
    synthetic: true,
  });
  for (const table of ['audit_event', 'outbox', 'outbox_delivery'])
    expect(
      (
        await f.owner.query(`SELECT count(*)::int AS n FROM app.${table} WHERE tenant_id=$1`, [
          workspace.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.membership WHERE tenant_id=$1', [
        workspace.id,
      ])
    ).rows[0].n,
  ).toBe(0);
  expect((await f.owner.query('SELECT count(*)::int AS n FROM app.organisation')).rows[0].n).toBe(
    organisations,
  );
});
test('concurrent duplicate retries are atomic; changed payload conflicts and commands are principal-scoped', async () => {
  const input = request('Synthetic concurrent workspace');
  const results = await Promise.all([service().provision(input), service().provision(input)]);
  expect(results[0]).toEqual(results[1]);
  await expect(
    service().provision({ ...input, name: 'Synthetic changed request' }),
  ).rejects.toThrow('Command conflicts');
  const other = await service('synthetic-bob').provision(input);
  expect(other.id).not.toBe(results[0].id);
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.domain_event WHERE tenant_id=$1', [
        results[0].id,
      ])
    ).rows[0].n,
  ).toBe(1);
});
test('unadmitted, unverified, expired and missing sessions cannot create workspaces', async () => {
  await expect(service('not-admitted').provision(request())).rejects.toThrow(
    'Customer access denied',
  );
  for (const [candidate, message] of [
    [null, 'Sign in'],
    [{ ...session(), emailVerified: false }, 'Verify your email'],
    [{ ...session(), expiresAt: new Date(Date.now() - 1000) }, 'Sign in'],
    [{ ...session(), expiresAt: new Date('invalid') }, 'Sign in'],
  ] as const) {
    const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => candidate);
    await expect(client.provision(request())).rejects.toThrow(message);
  }
});
test('disabled customer loses existing workspace access and repeat admission never reactivates it', async () => {
  await service('synthetic-bob').provision(request('Synthetic revocation workspace'));
  await f.owner.query('UPDATE customer_private.principal SET disabled_at=now() WHERE id=$1', [bob]);
  try {
    await expect(service('synthetic-bob').list()).rejects.toThrow('Customer access denied');
    const admitted = await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'synthetic-bob',
      executorId: f.serviceId,
      reason: 'Repeat fixture admission must preserve the recorded disablement',
    });
    expect(admitted).toEqual({ id: bob, active: false });
  } finally {
    await f.owner.query('UPDATE customer_private.principal SET disabled_at=NULL WHERE id=$1', [
      bob,
    ]);
  }
});
test('provider failure is an unavailable service and leaves no proof or workspace write', async () => {
  const before = (await f.owner.query('SELECT count(*)::int AS n FROM customer.workspace')).rows[0]
    .n;
  const client = new CustomerWorkspaceService(f.runtime, f.auth, options, async () => {
    throw new Error('Sensitive provider diagnostic must not escape');
  });
  await expect(client.provision(request())).rejects.toMatchObject({
    message: 'Customer identity is unavailable',
    status: 503,
  });
  expect((await f.owner.query('SELECT count(*)::int AS n FROM customer.workspace')).rows[0].n).toBe(
    before,
  );
  expect(
    (await f.auth.query('SELECT count(*)::int AS n FROM customer_private.session_proof')).rows[0].n,
  ).toBe(0);
});
test('runtime cannot mint/read/extend proofs, grant admission or write memberships directly', async () => {
  for (const sql of [
    'SELECT * FROM customer_private.session_proof',
    'SELECT * FROM customer_private.configuration',
    'SELECT * FROM customer_private.principal',
    'SELECT * FROM customer_migrations.applied',
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES(repeat('a',64),'fake','fake',now()+interval '1 hour')",
    `INSERT INTO customer.membership(tenant_id,principal_id,role) VALUES('${f.tenantA}','${alice}','owner')`,
    'DELETE FROM customer.membership',
    "UPDATE customer.membership SET role='admin'",
  ])
    await expect(f.runtime.query(sql)).rejects.toThrow();
  for (const sql of [
    'SELECT * FROM customer_private.principal',
    'SELECT * FROM customer_private.configuration',
    'UPDATE customer_private.session_proof SET expires_at=now()',
    'SELECT * FROM customer.membership',
    "SELECT customer.provision_workspace(gen_random_uuid(),'Synthetic forged')",
  ])
    await expect(f.auth.query(sql)).rejects.toThrow();
  await expect(
    admitSyntheticCustomer(f.runtime, {
      issuer,
      subject: 'forged',
      executorId: f.serviceId,
      reason: 'Unauthorized runtime admission attempt',
    }),
  ).rejects.toThrow();
});
test('auth proofs have an immutable database creation time and at most thirty seconds of authority', async () => {
  await expect(
    f.auth.query(
      `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at)
    VALUES($1,$2,'synthetic-alice',clock_timestamp()+interval '1 hour')`,
      [sessionHash('too-long'), issuer],
    ),
  ).rejects.toThrow();
  await expect(
    f.auth.query(
      `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at,created_at)
    VALUES($1,$2,'synthetic-alice',now()+interval '1 hour',now()+interval '1 hour')`,
      [sessionHash('fake-time'), issuer],
    ),
  ).rejects.toThrow();
});
test('runtime GUC subjects, staff credentials and forged hashes do not establish customer authority', async () => {
  await expect(
    f.runtime.query('SELECT customer.provision_workspace($1,$2)', [
      randomUUID(),
      'Synthetic forged workspace',
    ]),
  ).rejects.toThrow('Customer access denied');
  await expect(
    rawCustomer(sessionHash('forged'), 'SELECT * FROM customer.workspaces()'),
  ).rejects.toThrow('Customer access denied');
  await expect(
    rawContext(f.runtime, f.users.owner.ctx, 'SELECT * FROM customer.workspaces()'),
  ).rejects.toThrow('Customer access denied');
  const result = await f.runtime.query(
    "SELECT set_config('corridra.customer_subject','synthetic-alice',false),customer.actor_id() AS actor",
  );
  expect(result.rows[0].actor).toBeNull();
  await f.runtime.query('RESET corridra.customer_subject');
});
test('proofs for a different issuer or an expired proof fail closed', async () => {
  await proof(
    'synthetic-alice',
    async (hash) => {
      await expect(rawCustomer(hash, 'SELECT * FROM customer.workspaces()')).rejects.toThrow(
        'Customer access denied',
      );
    },
    issuer.replace('ep-autumn-scene-b17sgino', 'ep-other-branch'),
  );
  await proof('synthetic-alice', async (hash) => {
    await f.owner.query(
      "UPDATE customer_private.session_proof SET created_at=now()-interval '60 seconds',expires_at=now()-interval '35 seconds' WHERE hash=$1",
      [hash],
    );
    await expect(rawCustomer(hash, 'SELECT * FROM customer.workspaces()')).rejects.toThrow(
      'Customer access denied',
    );
  });
});
test('customer SQL stays separate from all staff/tenant authority and other customer rows', async () => {
  const b = await service('synthetic-bob').provision(request('Synthetic private Bob workspace'));
  await proof('synthetic-alice', async (hash) => {
    const own = await rawCustomer(
      hash,
      'SELECT customer.actor_id() AS customer,app.actor_id() AS staff,app.fresh_mfa() AS mfa',
    );
    expect(own.rows[0]).toEqual({ customer: alice, staff: null, mfa: false });
    expect((await rawCustomer(hash, 'SELECT * FROM app.tenant')).rows).toEqual([]);
    expect((await rawCustomer(hash, 'SELECT * FROM app.membership')).rows).toEqual([]);
    expect((await rawCustomer(hash, 'SELECT * FROM app.source_record')).rows).toEqual([]);
    expect(
      (await rawCustomer(hash, 'SELECT * FROM customer.membership WHERE tenant_id=$1', [b.id]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await rawCustomer(hash, 'SELECT * FROM customer.provision_request WHERE principal_id=$1', [
          bob,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (await rawCustomer(hash, 'SELECT * FROM customer.workspace WHERE tenant_id=$1', [b.id])).rows,
    ).toEqual([]);
  });
});
test('the sole owner cannot be removed or rewritten, including by a schema-owner accident', async () => {
  const workspace = await service().provision(request('Synthetic immutable ownership'));
  await expect(
    f.owner.query('DELETE FROM customer.membership WHERE tenant_id=$1', [workspace.id]),
  ).rejects.toThrow('Immutable record');
  await expect(
    f.owner.query("UPDATE customer.membership SET role='member' WHERE tenant_id=$1", [
      workspace.id,
    ]),
  ).rejects.toThrow('Immutable record');
});
test('rollback and success leave no proofs or customer context in pooled connections', async () => {
  const input = request('Synthetic pooled context');
  await service().provision(input);
  await expect(
    service().provision({ ...input, name: 'Synthetic conflicting pooled context' }),
  ).rejects.toThrow();
  expect(
    (await f.auth.query('SELECT count(*)::int AS n FROM customer_private.session_proof')).rows[0].n,
  ).toBe(0);
  for (let index = 0; index < 5; index++) {
    const db = await f.runtime.connect();
    try {
      expect(
        (await db.query('SELECT customer.actor_id() AS customer,app.actor_id() AS staff')).rows[0],
      ).toEqual({ customer: null, staff: null });
    } finally {
      db.release();
    }
  }
});
test('the module is off by default, production stays off even with the flag and service cannot bypass it', async () => {
  expect(customerWorkspacesEnabled({})).toBe(false);
  expect(
    customerWorkspacesEnabled({
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
      VERCEL_ENV: 'preview',
    }),
  ).toBe(true);
  expect(
    customerWorkspacesEnabled({
      CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
      DATA_ENVIRONMENT: 'synthetic',
      VERCEL_ENV: 'production',
    }),
  ).toBe(false);
  for (const change of [{ enabled: false }, { synthetic: false }, { production: true }]) {
    const client = new CustomerWorkspaceService(
      f.runtime,
      f.auth,
      { ...options, ...change },
      async () => {
        throw new Error('Provider should not be contacted');
      },
    );
    await expect(client.list()).rejects.toThrow('Customer workspaces are unavailable');
  }
});
test('pinned issuer/executor and synthetic-only input cannot be silently changed', async () => {
  await expect(
    admitSyntheticCustomer(f.owner, {
      issuer: issuer.replace('ep-autumn-scene-b17sgino', 'ep-other'),
      subject: 'another',
      executorId: f.serviceId,
      reason: 'Attempted silent issuer replacement',
    }),
  ).rejects.toThrow('pinned');
  await expect(
    admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'another',
      executorId: f.users.owner.id,
      reason: 'A staff person cannot be the service executor',
    }),
  ).rejects.toThrow('active service executor');
  await expect(
    service().provision({ ...request(), name: 'Actual customer company' }),
  ).rejects.toThrow();
  await expect(service().provision({ ...request(), principalId: alice })).rejects.toThrow();
  await proof('synthetic-alice', async (hash) => {
    await expect(
      rawCustomer(hash, 'SELECT customer.provision_workspace($1,$2)', [
        randomUUID(),
        'Actual customer company',
      ]),
    ).rejects.toThrow('labelled synthetic');
  });
});
