import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { fixture, rawContext, freshDatabase, connection, sandbox } from './support';
import { withTenant, assertRestrictedPool, Pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import {
  EvidenceService,
  type ObjectStorage,
  type MalwareScanner,
  inspectFile,
} from '../../packages/evidence/src/index';
import { AccessService } from '../../packages/auth/src/access';
let f: Awaited<ReturnType<typeof fixture>>, evidence: EvidenceService, access: AccessService;
const objects = new Map<string, Uint8Array>();
const storage: ObjectStorage = {
  async put(k, b) {
    if (objects.has(k)) throw new Error('Immutable object');
    objects.set(k, b.slice());
  },
  async get(k) {
    const b = objects.get(k);
    if (!b) throw new Error('Missing object');
    return b;
  },
};
let verdict: 'CLEAN' | 'INFECTED' | 'ERROR' = 'CLEAN';
const scanner: MalwareScanner = {
  async scan() {
    return { verdict, engine: 'test-adapter' };
  },
};
const source = () => ({
  kind: 'observation',
  locator: 'Synthetic inspection record',
  observedAt: new Date().toISOString(),
  classification: 'INTERNAL',
  purpose: 'synthetic_validation',
  retentionUntil: new Date(Date.now() + 86400000).toISOString(),
  aiPolicy: 'DENY',
});
async function newClaim() {
  const s = await evidence.createSource(f.users.operator.ctx, source());
  return evidence.createClaim(f.users.operator.ctx, {
    sourceId: s.id,
    statement: 'Synthetic capacity claim',
  });
}
async function newEvidence() {
  const c = await newClaim();
  return evidence.upload(
    f.users.operator.ctx,
    c.id,
    Buffer.from('%PDF-1.7\nSynthetic test document'),
    'application/pdf',
  );
}
beforeAll(async () => {
  f = await fixture();
  evidence = new EvidenceService(f.runtime, storage, scanner);
  access = new AccessService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});
test('fresh and repeat migrations preserve hashes and create a restricted runtime', async () => {
  await migrate(f.owner);
  await assertRestrictedPool(f.runtime);
  await assertRestrictedPool(f.auth, 'corridra_auth');
  await expect(assertRestrictedPool(f.owner)).rejects.toThrow('not restricted');
  const r = await f.owner.query('SELECT count(*)::int AS n FROM migrations.applied');
  expect(r.rows[0].n).toBe(8);
});
test('startup rejects login roles that cross the identity boundary or can create roles', async () => {
  const password = randomBytes(32).toString('hex');
  await f.owner.query('DROP ROLE IF EXISTS corridra_combined_test');
  await f.owner.query(
    `CREATE ROLE corridra_combined_test LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`,
  );
  await f.owner.query('GRANT corridra_runtime,corridra_auth TO corridra_combined_test');
  const pool = new Pool(connection('corridra_integration', 'corridra_combined_test', password));
  try {
    await expect(assertRestrictedPool(pool)).rejects.toThrow('not restricted');
    await expect(assertRestrictedPool(pool, 'corridra_auth')).rejects.toThrow('not restricted');
    await f.owner.query('REVOKE corridra_auth FROM corridra_combined_test');
    await f.owner.query('ALTER ROLE corridra_combined_test CREATEROLE');
    await expect(assertRestrictedPool(pool)).rejects.toThrow('not restricted');
  } finally {
    await pool.end();
    await f.owner.query('DROP ROLE corridra_combined_test');
  }
});
test('upgrade from identity schema preserves existing primitives', async () => {
  const p = await freshDatabase('corridra_upgrade');
  try {
    await migrate(p, '0001_identity_tenancy.sql');
    await p.query("INSERT INTO app.country VALUES('FR','France')");
    await migrate(p);
    expect((await p.query("SELECT name FROM app.country WHERE code='FR'")).rows[0].name).toBe(
      'France',
    );
  } finally {
    await p.end();
  }
});
test('runtime has RLS on every tenant-private table and cannot read identity secrets', async () => {
  const r = await f.owner.query(
    "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN information_schema.columns cols ON cols.table_schema=n.nspname AND cols.table_name=c.relname AND cols.column_name='tenant_id' WHERE n.nspname='app' AND c.relkind='r'",
  );
  expect(r.rows.length).toBeGreaterThan(10);
  expect(r.rows.every((row) => row.relrowsecurity)).toBe(true);
  await expect(f.runtime.query('SELECT token FROM identity.session')).rejects.toThrow();
  await expect(f.auth.query('SELECT * FROM app.claim')).rejects.toThrow();
  await expect(f.runtime.query('SET ROLE corridra_auth')).rejects.toThrow();
});
test('same-tenant access succeeds; other tenant and non-member are denied by service and RLS', async () => {
  const s = await evidence.createSource(f.users.operator.ctx, source());
  expect((await evidence.workspace(f.users.viewer.ctx)).sources.some((r) => r.id === s.id)).toBe(
    true,
  );
  await expect(evidence.workspace({ ...f.users.other.ctx, tenantId: f.tenantA })).rejects.toThrow(
    'Access denied',
  );
  await expect(evidence.workspace(f.users.outsider.ctx)).rejects.toThrow('Access denied');
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.other.ctx,
        'SELECT * FROM app.source_record WHERE id=$1',
        [s.id],
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    rawContext(
      f.runtime,
      f.users.other.ctx,
      "INSERT INTO app.claim(tenant_id,source_id,statement,classification,purpose,created_by) VALUES($1,$2,'forged','INTERNAL','synthetic_validation',$3)",
      [f.tenantA, s.id, f.users.other.id],
    ),
  ).rejects.toThrow();
});
test('RBAC, purpose and country constraints deny unauthorized work', async () => {
  await expect(evidence.createSource(f.users.viewer.ctx, source())).rejects.toThrow(
    'Access denied',
  );
  await expect(
    evidence.workspace({ ...f.users.operator.ctx, purpose: 'unapproved' }),
  ).rejects.toThrow('Access denied');
  await f.owner.query("UPDATE identity.principal SET operating_country='US' WHERE id=$1", [
    f.users.viewer.id,
  ]);
  await expect(evidence.workspace(f.users.viewer.ctx)).rejects.toThrow('Access denied');
  await f.owner.query("UPDATE identity.principal SET operating_country='DE' WHERE id=$1", [
    f.users.viewer.id,
  ]);
  await expect(
    evidence.createSource(f.users.operator.ctx, {
      ...source(),
      classification: 'HIGHLY_RESTRICTED',
    }),
  ).rejects.toThrow();
});
test('revoked, expired, disabled and non-MFA sessions fail immediately', async () => {
  const u = f.users.viewer;
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '13 hours' WHERE session_id=$1",
    [u.sessionId],
  );
  await expect(evidence.workspace(u.ctx)).rejects.toThrow('Access denied');
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    u.sessionId,
  ]);
  await f.owner.query('UPDATE identity.principal SET disabled_at=now() WHERE id=$1', [u.id]);
  await expect(evidence.workspace(u.ctx)).rejects.toThrow('Access denied');
  await f.owner.query('UPDATE identity.principal SET disabled_at=NULL WHERE id=$1', [u.id]);
  await f.owner.query('DELETE FROM identity.session WHERE id=$1', [u.sessionId]);
  await expect(evidence.workspace(u.ctx)).rejects.toThrow('Access denied');
});
test('source creation atomically appends event, audit and outbox without claim text in payload', async () => {
  const s = await evidence.createSource(f.users.operator.ctx, source());
  const r = await f.owner.query(
    'SELECT d.*,a.id AS audit_id,o.id AS outbox_id FROM app.domain_event d JOIN app.audit_event a ON a.domain_event_id=d.id JOIN app.outbox o ON o.event_id=d.id WHERE d.aggregate_id=$1',
    [s.id],
  );
  expect(r.rowCount).toBe(1);
  expect(r.rows[0].schema_version).toBe(1);
  expect(r.rows[0].actor_id).toBe(f.users.operator.id);
  expect(JSON.stringify(r.rows[0].payload)).not.toContain('Synthetic inspection');
  await expect(
    f.owner.query("UPDATE app.domain_event SET type='rewritten' WHERE id=$1", [r.rows[0].id]),
  ).rejects.toThrow('Immutable');
});
test('a failed business transaction rolls back its data, event, audit and outbox', async () => {
  const id = randomUUID();
  const before = (await f.owner.query('SELECT count(*)::int AS n FROM app.outbox')).rows[0].n;
  await expect(
    withTenant(f.runtime, f.users.operator.ctx, 'trust.write', async (t) => {
      await t.db.query(
        "INSERT INTO app.source_record(id,tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by) VALUES($1,$2,'observation','Rollback test',now(),'INTERNAL','synthetic_validation',now()+interval '1 day','DENY',$3)",
        [id, t.tenantId, t.actorId],
      );
      throw new Error('Fail after event');
    }),
  ).rejects.toThrow('Fail after event');
  expect((await f.owner.query('SELECT FROM app.source_record WHERE id=$1', [id])).rowCount).toBe(0);
  expect((await f.owner.query('SELECT count(*)::int AS n FROM app.outbox')).rows[0].n).toBe(before);
});
test('metadata is immutable and cross-tenant provenance links cannot be created', async () => {
  const c = await newClaim();
  await expect(
    rawContext(f.runtime, f.users.operator.ctx, 'UPDATE app.claim SET statement=$2 WHERE id=$1', [
      c.id,
      'altered',
    ]),
  ).rejects.toThrow();
  const s = await evidence.createSource(f.users.other.ctx, source());
  await expect(
    evidence.createClaim(f.users.operator.ctx, { sourceId: s.id, statement: 'Cross tenant' }),
  ).rejects.toThrow('Source unavailable');
});
test('uploads stay quarantined through scanner errors and tampered files are rejected', async () => {
  const e = await newEvidence();
  await expect(evidence.download(f.users.operator.ctx, e.id)).rejects.toThrow(
    'Evidence unavailable',
  );
  verdict = 'ERROR';
  expect((await evidence.scan(f.users.operator.ctx, e.id)).scanStatus).toBe('ERROR');
  await expect(evidence.download(f.users.operator.ctx, e.id)).rejects.toThrow(
    'Evidence unavailable',
  );
  const key = [...objects.keys()].find((k) => k.endsWith(e.id))!;
  objects.set(key, Buffer.from('%PDF-1.7\nChanged bytes'));
  verdict = 'CLEAN';
  expect((await evidence.scan(f.users.operator.ctx, e.id)).status).toBe('REJECTED');
  await expect(evidence.download(f.users.operator.ctx, e.id)).rejects.toThrow(
    'Evidence unavailable',
  );
});
test('MIME mismatch, oversized files and unknown formats are rejected before storage', () => {
  expect(() => inspectFile(Buffer.from('plain text'), 'application/pdf')).toThrow('MIME');
  expect(() => inspectFile(Buffer.alloc(4194305), 'application/pdf')).toThrow('4 MiB');
  expect(() => inspectFile(Buffer.from('%PDF-1.7'), 'image/png')).toThrow('MIME');
});
test('clean evidence needs an independent reviewer and fresh MFA before a canonical fact exists', async () => {
  verdict = 'CLEAN';
  const e = await newEvidence();
  expect((await evidence.scan(f.users.operator.ctx, e.id)).status).toBe('UNDER_REVIEW');
  expect((await evidence.download(f.users.operator.ctx, e.id)).mime).toBe('application/pdf');
  const v = {
    decision: 'VERIFIED' as const,
    method: 'Synthetic manual check',
    scope: 'Full synthetic capacity claim',
    validUntil: new Date(Date.now() + 86400000).toISOString(),
  };
  await expect(evidence.verify(f.users.operator.ctx, e.id, v)).rejects.toThrow('Access denied');
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [f.users.reviewer.sessionId],
  );
  await expect(evidence.verify(f.users.reviewer.ctx, e.id, v)).rejects.toThrow('authenticator');
  await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    f.users.reviewer.sessionId,
  ]);
  await evidence.verify(f.users.reviewer.ctx, e.id, v);
  expect((await evidence.workspace(f.users.operator.ctx)).facts.length).toBeGreaterThan(0);
  await expect(evidence.verify(f.users.reviewer.ctx, e.id, v)).rejects.toThrow('transition');
});
test('database rejects an attempt to promote evidence without scan and verification records', async () => {
  const e = await newEvidence();
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      "UPDATE app.evidence_state SET status='VERIFIED',scan_status='CLEAN',version=version+1 WHERE id=$1",
      [e.id],
    ),
  ).rejects.toThrow();
});
test('feature changes append immutable versions; last owner cannot be removed', async () => {
  const a = await access.appendConfig(f.users.owner.ctx, {
    key: 'evidence.uploads',
    enabled: true,
  });
  const b = await access.appendConfig(f.users.owner.ctx, {
    key: 'evidence.uploads',
    enabled: false,
  });
  expect(b.version).toBe(a.version + 1);
  expect((await access.config(f.users.owner.ctx))[0].value.enabled).toBe(false);
  await expect(
    access.appendConfig(f.users.operator.ctx, { key: 'evidence.uploads', enabled: true }),
  ).rejects.toThrow('Access denied');
  await expect(
    access.changeMember(f.users.owner.ctx, {
      userId: f.users.owner.id,
      role: 'viewer',
      revoked: true,
    }),
  ).rejects.toThrow('retain an active owner');
});
test('direct SQL cannot downgrade provenance and pooled contexts do not leak', async () => {
  const src = await evidence.createSource(f.users.operator.ctx, {
    ...source(),
    classification: 'INTERNAL',
  });
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      "INSERT INTO app.claim(tenant_id,source_id,statement,classification,purpose,created_by) VALUES($1,$2,'Synthetic downgrade','PUBLIC','synthetic_validation',$3)",
      [f.tenantA, src.id, f.users.operator.id],
    ),
  ).rejects.toThrow('inherited');
  const p = new Pool({
    ...connection('corridra_integration', 'corridra_runtime_local', sandbox.runtimePassword),
    max: 1,
  });
  try {
    expect(
      (await rawContext(p, f.users.operator.ctx, 'SELECT * FROM app.source_record')).rowCount,
    ).toBeGreaterThan(0);
    expect((await p.query('SELECT * FROM app.source_record')).rowCount).toBe(0);
    expect(
      (
        await rawContext(
          p,
          f.users.other.ctx,
          'SELECT * FROM app.source_record WHERE tenant_id=$1',
          [f.tenantA],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await p.end();
  }
});
test('config changes serialize and preserve every version and event', async () => {
  const changes = await Promise.all(
    [true, false, true].map((enabled) =>
      access.appendConfig(f.users.owner.ctx, { key: 'evidence.verification', enabled }),
    ),
  );
  expect(changes.map((c) => c.version).sort()).toEqual([1, 2, 3]);
  const events = await rawContext(
    f.runtime,
    f.users.owner.ctx,
    "SELECT aggregate_id,aggregate_version FROM app.domain_event WHERE aggregate_type='config_version' AND aggregate_id='evidence.verification' ORDER BY aggregate_version",
  );
  expect(events.rows.map((r) => r.aggregate_version)).toEqual([1, 2, 3]);
});
test('membership revocation takes effect for existing sessions', async () => {
  await access.changeMember(f.users.owner.ctx, {
    userId: f.users.operator.id,
    role: 'operator',
    revoked: true,
  });
  await expect(evidence.workspace(f.users.operator.ctx)).rejects.toThrow('Access denied');
});
test('non-production backup restores evidence and retains runtime denial rules', async () => {
  const env = { ...process.env };
  for (const k of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete env[k];
  const args = ['--host=unix:///var/run/docker.sock', 'exec', 'corridra-part03-postgres'];
  const dump = spawnSync(
    'docker',
    [...args, 'pg_dump', '-U', 'postgres', '-d', 'corridra_integration', '--format=custom'],
    { env, maxBuffer: 10 * 1024 * 1024 },
  );
  expect(dump.status).toBe(0);
  await writeFile('.cache/part03-restore.dump', dump.stdout, { mode: 0o600 });
  const restored = await freshDatabase('corridra_restore');
  try {
    const result = spawnSync(
      'docker',
      [
        '--host=unix:///var/run/docker.sock',
        'exec',
        '-i',
        'corridra-part03-postgres',
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        'corridra_restore',
        '--exit-on-error',
      ],
      { env, input: await readFile('.cache/part03-restore.dump'), maxBuffer: 1024 * 1024 },
    );
    expect(result.status, result.stderr.toString()).toBe(0);
    const before = (await f.owner.query('SELECT count(*)::int AS n FROM app.domain_event')).rows[0]
      .n;
    expect(
      (await restored.query('SELECT count(*)::int AS n FROM app.domain_event')).rows[0].n,
    ).toBe(before);
    expect(
      (await restored.query("SELECT relrowsecurity FROM pg_class WHERE oid='app.claim'::regclass"))
        .rows[0].relrowsecurity,
    ).toBe(true);
    const runtime = new Pool(
      connection('corridra_restore', 'corridra_runtime_local', sandbox.runtimePassword),
    );
    try {
      await assertRestrictedPool(runtime);
      expect(
        (await rawContext(runtime, f.users.owner.ctx, 'SELECT * FROM app.claim')).rowCount,
      ).toBeGreaterThan(0);
      expect(
        (
          await rawContext(
            runtime,
            f.users.other.ctx,
            'SELECT * FROM app.claim WHERE tenant_id=$1',
            [f.tenantA],
          )
        ).rowCount,
      ).toBe(0);
      await expect(
        new EvidenceService(runtime, storage, scanner).workspace(f.users.operator.ctx),
      ).rejects.toThrow('Access denied');
    } finally {
      await runtime.end();
    }
    await writeFile(
      '.cache/part03-restore-evidence.json',
      JSON.stringify({
        completedAt: new Date().toISOString(),
        eventsRestored: before,
        rlsRetained: true,
      }),
    );
  } finally {
    await restored.end();
  }
});
