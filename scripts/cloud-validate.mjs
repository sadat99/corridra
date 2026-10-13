import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { databasePool } from './database-pool.ts';
import { migrate } from '../packages/db/src/migrate.ts';
import { assertRestrictedPool, withTenant } from '../packages/db/src/index.ts';
import { seedSyntheticWorkspace } from '../packages/auth/src/bootstrap.ts';
import { createIdentity } from '../packages/auth/src/index.ts';
import { AccessService } from '../packages/auth/src/access.ts';
import { EvidenceService } from '../packages/evidence/src/index.ts';

// Explicitly invoked offline cloud acceptance. No production mode or automatic build hook.
const env = process.env;
assert.equal(env.MIGRATION_ENVIRONMENT, 'synthetic-preview');
assert.equal(env.MIGRATION_TRANSPORT, 'neon-websocket');
assert.notEqual(env.NEON_NONPROD_PROJECT_ID, env.NEON_PRODUCTION_PROJECT_ID);
const api = async (path, body) => {
  const r = await fetch('https://console.neon.tech/api/v2' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${env.NEON_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(r.ok, true, `Neon metadata status ${r.status}`);
  return r.json();
};
const base = `/projects/${env.NEON_NONPROD_PROJECT_ID}`;
const { project } = await api(base);
assert.equal(project.name, 'corridra-nonprod');
assert.equal(project.region_id, 'aws-eu-central-1');
const { branches } = await api(base + '/branches');
const branch = branches.find((b) => b.id === env.NEON_PREVIEW_BRANCH_ID);
assert.equal(branch?.name, 'corridra-pr-3');
assert.equal(branch.parent_id, env.NEON_SYNTHETIC_PARENT_ID);
const { endpoints } = await api(base + '/endpoints');
const host = new URL(env.MIGRATION_DATABASE_URL).hostname;
assert(endpoints.some((e) => e.host === host && e.branch_id === branch.id));
for (const [key, role] of [
  ['MIGRATION_DATABASE_URL', 'corridra_migrator'],
  ['RUNTIME_DATABASE_URL', 'corridra_app_login'],
  ['AUTH_DATABASE_URL', 'corridra_identity_login'],
]) {
  const url = new URL(env[key]);
  assert.equal(url.hostname, host);
  assert.equal(url.username, role);
  assert.equal(url.pathname, '/corridra');
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
}
const owner = databasePool(env.MIGRATION_DATABASE_URL);
const runtime = databasePool(env.RUNTIME_DATABASE_URL);
const auth = databasePool(env.AUTH_DATABASE_URL);
const checks = [];
let restore;
try {
  await migrate(owner);
  checks.push('Migration hashes and repeat application');
  await assertRestrictedPool(runtime);
  await assertRestrictedPool(auth, 'corridra_auth');
  checks.push('Separate restricted runtime and identity logins');
  const tables = await owner.query(
    "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND c.relname NOT IN ('country','corridor','organisation')",
  );
  assert(tables.rows.length > 0 && tables.rows.every((t) => t.relrowsecurity));
  assert.equal((await runtime.query('SELECT * FROM app.source_record')).rowCount, 0);
  await assert.rejects(runtime.query('SELECT * FROM identity.account'));
  checks.push('Tenant tables enforce RLS; context-free reads and identity secret access denied');
  const path = '.cache/cloud-acceptance-secrets.json';
  let secrets;
  try {
    secrets = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    secrets = {
      password: randomBytes(24).toString('base64url'),
      authSecret: randomBytes(32).toString('base64url'),
      email: 'cloud-operator@example.invalid',
    };
    await writeFile(path, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
  }
  // Do not reset cloud databases or fake MFA assurance. A failed run remains inspectable.
  assert.equal(
    (await owner.query('SELECT count(*)::int AS n FROM identity."user"')).rows[0].n,
    0,
    'Acceptance requires a fresh synthetic child; reuse requires deliberate cleanup',
  );
  const north = await seedSyntheticWorkspace(owner, {
    email: secrets.email,
    password: secrets.password,
    name: 'Synthetic Cloud Operator',
  });
  const south = await seedSyntheticWorkspace(owner, {
    email: 'cloud-other@example.invalid',
    password: randomBytes(24).toString('base64url'),
    name: 'Synthetic Other',
  });
  const origin = 'https://cloud-validation.example.invalid';
  const identity = createIdentity({ pool: auth, secret: secrets.authSecret, baseURL: origin });
  const access = new AccessService(runtime);
  const evidence = new EvidenceService(
    runtime,
    {
      async put() {
        throw new Error('Cloud storage gate is unresolved');
      },
      async get() {
        throw new Error('Cloud storage gate is unresolved');
      },
    },
    {
      async scan() {
        return { verdict: 'ERROR', engine: 'unconfigured' };
      },
    },
  );
  const jar = new Map();
  const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function request(path, body, requestOrigin = origin) {
    const r = await identity.handler(
      new Request(origin + '/api/auth' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: cookies() },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    for (const header of r.headers.getSetCookie()) {
      const [pair] = header.split(';'),
        at = pair.indexOf('=');
      if (header.includes('Max-Age=0')) jar.delete(pair.slice(0, at));
      else jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: r.status, ok: r.ok, data: await r.json() };
  }
  assert.equal(
    (
      await request('/sign-up/email', {
        email: 'denied@example.invalid',
        password: secrets.password,
        name: 'Synthetic',
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await request(
        '/sign-in/email',
        { email: secrets.email, password: secrets.password },
        'https://untrusted.invalid',
      )
    ).status,
    403,
  );
  assert.equal(
    (await request('/sign-in/email', { email: secrets.email, password: secrets.password })).ok,
    true,
  );
  let session = await identity.provider.getSession(new Headers({ Cookie: cookies() }));
  assert(session);
  assert.deepEqual(await access.tenants(session.token), []);
  checks.push('Public signup, cross-origin and password-only access denied');
  const enrollment = await request('/two-factor/enable', { password: secrets.password });
  assert.equal(enrollment.ok, true);
  const secret = new URL(enrollment.data.totpURI).searchParams.get('secret');
  const bits = [...secret.replace(/=+$/, '')]
    .map((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest(),
    offset = mac[mac.length - 1] & 15;
  const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  assert.equal((await request('/two-factor/verify-totp', { code, trustDevice: false })).ok, true);
  session = await identity.provider.getSession(new Headers({ Cookie: cookies() }));
  assert.deepEqual(
    (await access.tenants(session.token)).map((t) => t.id),
    [north.tenantId],
  );
  const ctx = { token: session.token, tenantId: north.tenantId, purpose: 'synthetic_validation' };
  await withTenant(runtime, ctx, 'trust.read', async (t) =>
    assert.equal(t.actorId, north.principalId),
  );
  await assert.rejects(
    withTenant(runtime, { ...ctx, tenantId: south.tenantId }, 'trust.read', async () => {}),
  );
  await assert.rejects(
    withTenant(
      runtime,
      { ...ctx, token: randomBytes(32).toString('hex') },
      'trust.read',
      async () => {},
    ),
  );
  checks.push('Real TOTP, same-tenant access, cross-tenant and non-member denial');
  const source = await evidence.createSource(ctx, {
    kind: 'self_declaration',
    locator: 'Synthetic cloud acceptance',
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: ctx.purpose,
    retentionUntil: new Date(Date.now() + 86400000).toISOString(),
    aiPolicy: 'DENY',
  });
  const count = async () =>
    (
      await owner.query(
        'SELECT (SELECT count(*) FROM app.source_record)::int AS sources,(SELECT count(*) FROM app.domain_event)::int AS events,(SELECT count(*) FROM app.outbox)::int AS outbox',
      )
    ).rows[0];
  const before = await count();
  await assert.rejects(
    withTenant(runtime, ctx, 'trust.write', async (t) => {
      await t.db.query(
        'INSERT INTO app.source_record(tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by) SELECT tenant_id,kind,$2,observed_at,classification,purpose,retention_until,ai_policy,created_by FROM app.source_record WHERE id=$1',
        [source.id, 'Synthetic rollback'],
      );
      throw new Error('Deliberate atomic rollback');
    }),
  );
  assert.deepEqual(await count(), before);
  assert(before.events > 0 && before.outbox === before.events);
  checks.push('Mutation, event and outbox atomicity');
  // Preserve a point after real MFA and before revocation in a separate recovery branch.
  const point = (await owner.query('SELECT pg_current_wal_lsn()::text AS lsn')).rows[0].lsn;
  const started = Date.now();
  const restoreName = 'corridra-pr-3-recovery';
  assert.equal(
    branches.some((b) => b.name === restoreName),
    false,
    'Existing recovery branch requires inspection',
  );
  const currentInventory = await api(base + '/branches');
  assert(
    currentInventory.branches.length < 10,
    'Retire completed branches before creating an eleventh',
  );
  ({ branch: restore } = await api(base + '/branches', {
    branch: {
      parent_id: branch.id,
      parent_lsn: point,
      name: restoreName,
      init_source: 'parent-data',
    },
    endpoints: [{ type: 'read_write' }],
  }));
  const restoredEndpoint = (await api(base + '/endpoints')).endpoints.find(
    (e) => e.branch_id === restore.id,
  );
  const restoredURL = new URL(env.RUNTIME_DATABASE_URL);
  restoredURL.hostname = restoredEndpoint.host;
  const restoredPool = databasePool(restoredURL.toString());
  try {
    await assertRestrictedPool(restoredPool);
    const restoredAccess = new AccessService(restoredPool);
    assert.deepEqual(
      (await restoredAccess.tenants(session.token)).map((t) => t.id),
      [north.tenantId],
    );
    await assert.rejects(
      withTenant(restoredPool, { ...ctx, tenantId: south.tenantId }, 'trust.read', async () => {}),
    );
    await withTenant(restoredPool, ctx, 'trust.read', async (t) => {
      assert.equal(
        (await t.db.query('SELECT count(*)::int AS n FROM app.source_record')).rows[0].n,
        1,
      );
      const {
        rows: [r],
      } = await t.db.query(
        'SELECT (SELECT count(*) FROM app.domain_event)::int AS events,(SELECT count(*) FROM app.outbox)::int AS outbox',
      );
      assert(r.events > 0 && r.events === r.outbox);
    });
  } finally {
    await restoredPool.end();
  }
  checks.push('Separate cloud point-in-time restore and restricted-role reconciliation');
  const recovery = {
    sourceBranchId: branch.id,
    restoredBranchId: restore.id,
    point,
    durationMs: Date.now() - started,
    sourceCount: before.sources,
  };
  assert.equal((await request('/sign-out', {})).ok, true);
  assert.equal(await identity.provider.getSession(new Headers({ Cookie: cookies() })), null);
  assert.deepEqual(await access.tenants(session.token), []);
  await assert.rejects(withTenant(runtime, ctx, 'trust.read', async () => {}));
  checks.push('Revoked sessions lose tenant access');
  const result = {
    checkedAt: new Date().toISOString(),
    projectId: project.id,
    productionProjectId: env.NEON_PRODUCTION_PROJECT_ID,
    region: project.region_id,
    postgresVersion: (await owner.query('SHOW server_version')).rows[0].server_version,
    branchId: branch.id,
    checks,
    recovery,
    unverified: [
      'Deployed operator flow',
      'EU object storage',
      'Cloud malware scanner',
      'Account protection controls',
    ],
  };
  await writeFile('.cache/part03-cloud-validation.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await Promise.all([owner.end(), runtime.end(), auth.end()]);
}
