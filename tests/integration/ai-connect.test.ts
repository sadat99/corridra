import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { changeMemberNow } from './change-member';
import { rawContext } from './support';
import { AccessService } from '../../packages/auth/src/access';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateAiModelPolicyReal } from '../../packages/db/src/ai-model-policy-real-migrate';
import { IntelligenceService } from '../../packages/intelligence/src/service';
import type { InferenceAdapter } from '../../packages/intelligence/src/adapters';

// ADR-089, on the database. The guided connection writes the existing model policy row; real workspaces may hold one once the
// module is installed; nothing else about AI changes (no run, no attempt, no gate, no switch).
let f: Awaited<ReturnType<typeof commercialFixture>>;
let ai: IntelligenceService;
let access: AccessService;
const spy = { ready: 0, generate: 0 };
const adapter: InferenceAdapter = {
  ready() {
    spy.ready++;
    return false;
  },
  async generate() {
    spy.generate++;
    throw new Error('no provider call is allowed in this test');
  },
} as unknown as InferenceAdapter;
const EU = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
];
const later = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
const ownerCtx = () => f.users.owner.ctx;
let purposeOf = 'synthetic_validation';
const rawCtx = () => ({ ...ownerCtx(), purpose: purposeOf });
async function source(ctx = ownerCtx(), retentionDays = 10) {
  return (
    await f.evidence.createSource(ctx, {
      kind: 'public_record',
      locator: 'Provider document fixture',
      observedAt: new Date().toISOString(),
      classification: 'PUBLIC',
      purpose: purposeOf,
      retentionUntil: later(retentionDays),
      aiPolicy: 'REVIEW_REQUIRED',
    })
  ).id as string;
}
const form = (terms: string, evaluation: string, patch: Record<string, unknown> = {}) => ({
  adapter: 'anthropic',
  model: 'claude-test-1',
  evaluationStatus: 'SYNTHETIC_ONLY',
  processingScope: { kind: 'countries', codes: ['DE'] },
  termsSourceId: terms,
  evaluationSourceId: evaluation,
  inputRateMinorPerMillion: '300',
  outputRateMinorPerMillion: '1500',
  maxCostMinor: '200',
  dailyBudgetMinor: '5000',
  effectiveUntil: later(30),
  tasks: ['translation', 'evidence_gaps'],
  reason: 'Connect the reviewed provider',
  expectedVersion: 0,
  confirmed: true,
  ...patch,
});
const policies = async () =>
  (
    await f.owner.query(
      'SELECT id,key,version,configuration,created_by FROM app.ai_model_policy WHERE tenant_id=$1 ORDER BY created_at',
      [f.tenantA],
    )
  ).rows;
const versionOf = async (adapter: string) =>
  (await policies()).filter((p) => p.key === `connect-${adapter}`).length;
async function gates() {
  const c = await rawContext(
    f.runtime,
    rawCtx(),
    "SELECT app.part4_enabled($1,'ai.enabled') ai,app.part4_enabled($1,'network.enabled') net",
    [f.tenantA],
  );
  return {
    ...c.rows[0],
    versions: (await f.owner.query('SELECT count(*)::int n FROM app.config_version')).rows[0].n,
  };
}
async function toReal() {
  await f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
  await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [f.tenantA]);
  await f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
  await f.owner.query('ALTER TABLE app.membership DISABLE TRIGGER USER');
  await f.owner.query(
    "UPDATE app.membership SET allowed_purposes=allowed_purposes||ARRAY['commercial_qualification'] WHERE tenant_id=$1",
    [f.tenantA],
  );
  await f.owner.query('ALTER TABLE app.membership ENABLE TRIGGER USER');
  await f.owner.query(
    "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES('https://ai-connect-fixture.example/auth',$1,$2,$3,'real-intake-2026-10-21-v1',true)",
    [f.serviceId, f.tenantA, f.users.owner.id],
  );
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  purposeOf = 'commercial_qualification';
}
const stale = (user: { sessionId: string }) =>
  f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [user.sessionId],
  );
const fresh = (user: { sessionId: string }) =>
  f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    user.sessionId,
  ]);

beforeAll(async () => {
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
  ai = new IntelligenceService(f.runtime, false, adapter);
  access = new AccessService(f.runtime);
}, 120000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await f?.close();
});

describe('sample workspace before the module is installed', () => {
  test('options say the module is missing, limit 20, and a sample workspace may still connect', async () => {
    const o = await ai.connectOptions(ownerCtx());
    expect(o).toMatchObject({
      moduleInstalled: false,
      realWorkspace: false,
      canConnect: true,
      locationLimit: 20,
    });
    expect(o.eu.codes).toEqual([...EU].sort());
  });
  test('EU and more than 20 countries are refused plainly; nothing is written', async () => {
    const [t, e] = [await source(), await source()];
    await expect(
      ai.connect(ownerCtx(), form(t, e, { processingScope: { kind: 'market', key: 'EU' } })),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      ai.connect(
        ownerCtx(),
        form(t, e, { processingScope: { kind: 'countries', codes: EU.slice(0, 21) } }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await policies()).toHaveLength(0);
  });
  test('an owner with a fresh check connects: version 1, sixteen keys, one event, server secret name', async () => {
    const [t, e] = [await source(), await source()];
    const before = await gates();
    const r = await ai.connect(ownerCtx(), form(t, e));
    expect(r.version).toBe(1);
    const rows = await policies();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].configuration)).toHaveLength(16);
    expect(rows[0].configuration.secretRef).toBe('CORRIDRA_ANTHROPIC_API_KEY');
    expect(rows[0].key).toBe('connect-anthropic');
    expect(rows[0].created_by).toBe(f.users.owner.id);
    const events = await f.owner.query(
      "SELECT actor_id FROM app.domain_event WHERE tenant_id=$1 AND aggregate_type='ai_model_policy' AND aggregate_id=$2",
      [f.tenantA, r.id],
    );
    expect(events.rows).toEqual([{ actor_id: f.users.owner.id }]);
    expect(await gates()).toEqual(before);
    expect(spy).toEqual({ ready: 0, generate: 0 });
  });
  test('a stale expected version gets 409, a refresh and retry gets version 2', async () => {
    const [t, e] = [await source(), await source()];
    await expect(ai.connect(ownerCtx(), form(t, e))).rejects.toMatchObject({ status: 409 });
    const options = await ai.connectOptions(ownerCtx());
    const latest = options.latest.find((p: { key: string }) => p.key === 'connect-anthropic');
    expect(latest.version).toBe(1);
    const r = await ai.connect(ownerCtx(), form(t, e, { expectedVersion: latest.version }));
    expect(r.version).toBe(2);
  });
  test('an admin may connect; operator, reviewer and viewer are denied with no row written', async () => {
    const [t, e] = [await source(), await source()];
    const count = (await policies()).length;
    for (const who of ['operator', 'reviewer', 'viewer'] as const)
      await expect(
        ai.connect(f.users[who].ctx, form(t, e, { adapter: 'openai' })),
      ).rejects.toMatchObject({ status: 403 });
    expect((await policies()).length).toBe(count);
    await changeMemberNow(access, ownerCtx(), {
      userId: f.users.reviewer.id,
      role: 'admin',
      revoked: false,
    });
    const r = await ai.connect(f.users.reviewer.ctx, form(t, e, { adapter: 'openai' }));
    expect(r.version).toBe(1);
  });
  test('a stale authenticator check gets STEP_UP_REQUIRED and nothing is written', async () => {
    const [t, e] = [await source(), await source()];
    const count = (await policies()).length;
    await stale(f.users.owner);
    try {
      await expect(ai.connect(ownerCtx(), form(t, e, { adapter: 'google' }))).rejects.toMatchObject(
        { status: 401, code: 'STEP_UP_REQUIRED' },
      );
    } finally {
      await fresh(f.users.owner);
    }
    expect((await policies()).length).toBe(count);
  });
  test('an expired source gets a plain 400 that says what to do', async () => {
    const t = await source();
    const e = await source();
    await f.owner.query('ALTER TABLE app.source_record DISABLE TRIGGER USER');
    await f.owner.query(
      "UPDATE app.source_record SET observed_at=now()-interval '3 days',retention_until=now()-interval '1 day' WHERE id=$1",
      [e],
    );
    await f.owner.query('ALTER TABLE app.source_record ENABLE TRIGGER USER');
    await expect(ai.connect(ownerCtx(), form(t, e, { adapter: 'google' }))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Choose a current source'),
    });
    await expect(
      ai.connect(ownerCtx(), form(t, randomUUID(), { adapter: 'google' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('real workspace', () => {
  let t: string, e: string;
  test('before the module is installed: options say so and connect gets 403', async () => {
    await toReal();
    [t, e] = [await source(), await source()];
    const o = await ai.connectOptions(ownerCtx());
    expect(o).toMatchObject({ moduleInstalled: false, realWorkspace: true, canConnect: false });
    await expect(ai.connect(ownerCtx(), form(t, e))).rejects.toMatchObject({ status: 403 });
    // The developer JSON path is refused by the database in the same way.
    await expect(
      rawContext(
        f.runtime,
        rawCtx(),
        `INSERT INTO app.ai_model_policy(id,tenant_id,key,version,configuration,terms_source_id,daily_budget_minor,effective_from,created_by,reason) VALUES($1,$2,'raw-real',1,'{}'::jsonb,$3,100,now(),app.actor_id(),'raw real attempt')`,
        [randomUUID(), f.tenantA, t],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  test('after the install an owner with a fresh check connects; gates and config versions do not move', async () => {
    await migrateAiModelPolicyReal(f.owner);
    const o = await ai.connectOptions(ownerCtx());
    expect(o).toMatchObject({
      moduleInstalled: true,
      realWorkspace: true,
      canConnect: true,
      locationLimit: 30,
    });
    const before = await gates();
    const count = (await policies()).length;
    const r = await ai.connect(ownerCtx(), form(t, e, { adapter: 'google' }));
    expect(r.version).toBe(1);
    const rows = await policies();
    expect(rows).toHaveLength(count + 1);
    const row = rows.find((p) => p.id === r.id)!;
    expect(Object.keys(row.configuration)).toHaveLength(16);
    expect(row.created_by).toBe(f.users.owner.id);
    expect(await gates()).toEqual(before);
    expect(before.ai).toBe(false);
    expect(spy).toEqual({ ready: 0, generate: 0 });
    const second = await ai.connect(
      ownerCtx(),
      form(t, e, { adapter: 'google', expectedVersion: 1 }),
    );
    expect(second.version).toBe(2);
    expect(await gates()).toEqual(before);
  });
  test('operator, reviewer-turned-admin rules: operator and viewer are denied; stale owner is stepped up', async () => {
    const count = (await policies()).length;
    for (const who of ['operator', 'viewer'] as const)
      await expect(
        ai.connect(f.users[who].ctx, form(t, e, { adapter: 'google', expectedVersion: 2 })),
      ).rejects.toMatchObject({ status: 403 });
    await stale(f.users.owner);
    try {
      await expect(
        ai.connect(ownerCtx(), form(t, e, { adapter: 'google', expectedVersion: 2 })),
      ).rejects.toMatchObject({ status: 401, code: 'STEP_UP_REQUIRED' });
    } finally {
      await fresh(f.users.owner);
    }
    expect((await policies()).length).toBe(count);
  });
  test('a direct runtime insert by a non-owner is refused by the database', async () => {
    await expect(
      rawContext(
        f.runtime,
        { ...f.users.operator.ctx, purpose: purposeOf },
        `INSERT INTO app.ai_model_policy(id,tenant_id,key,version,configuration,terms_source_id,daily_budget_minor,effective_from,created_by,reason) VALUES($1,$2,'raw-operator',1,'{}'::jsonb,$3,100,now(),app.actor_id(),'raw operator attempt')`,
        [randomUUID(), f.tenantA, t],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
  test('an ai_run, attempt, result and completion are still refused in a real workspace', async () => {
    const id = randomUUID();
    const rows: [string, unknown[]][] = [
      [
        'INSERT INTO app.ai_run(id,tenant_id,mission_id,policy_id,task,input,input_hash,created_by) VALUES($1,$2,$1,$1,$3,$4::jsonb,$5,app.actor_id())',
        [id, f.tenantA, 'translation', '{}', 'x'],
      ],
      [
        'INSERT INTO app.ai_attempt(id,tenant_id,run_id,policy_id,reserved_minor,created_by) VALUES($1,$2,$1,$1,10,app.actor_id())',
        [id, f.tenantA],
      ],
      [
        "INSERT INTO app.ai_result(id,tenant_id,attempt_id,status,metadata,created_by) VALUES($1,$2,$1,'FAILED','{}'::jsonb,app.actor_id())",
        [id, f.tenantA],
      ],
      [
        "INSERT INTO app.ai_completion(id,tenant_id,run_id,status,reason_code,created_by) VALUES($1,$2,$1,'MANUAL_REVIEW','PROVIDER_OR_BUDGET_UNAVAILABLE',app.actor_id())",
        [id, f.tenantA],
      ],
    ];
    for (const [sql, args] of rows)
      await expect(rawContext(f.runtime, rawCtx(), sql, args)).rejects.toThrow(
        'Scoped synthetic actor required',
      );
  });
  test('EU resolves to the stored in-force members, with no market name in the configuration', async () => {
    const o = await ai.connectOptions(ownerCtx());
    expect(o.eu.codes).toEqual([...EU].sort());
    const r = await ai.connect(
      ownerCtx(),
      form(t, e, {
        adapter: 'google',
        expectedVersion: await versionOf('google'),
        processingScope: { kind: 'market', key: 'EU' },
        evaluationStatus: 'APPROVED_PROVIDER',
      }),
    );
    const cfg = (await policies()).find((p) => p.id === r.id)!.configuration;
    expect(cfg.processingLocations).toEqual([...EU].sort());
    expect(cfg.processingLocations).toHaveLength(27);
    expect(JSON.stringify(cfg)).not.toMatch(/"EU"/);
    expect(Object.keys(cfg)).toHaveLength(16);
  });
  test('an expired membership is not resolved; an empty list is refused plainly', async () => {
    await f.owner.query('ALTER TABLE app.market_member DISABLE TRIGGER USER');
    await f.owner.query(
      "UPDATE app.market_member SET effective_until=current_date-1,effective_from=current_date-10 WHERE market_key='EU' AND country_code='SE'",
    );
    try {
      const o = await ai.connectOptions(ownerCtx());
      expect(o.eu.codes).not.toContain('SE');
      expect(o.eu.codes).toHaveLength(26);
      await f.owner.query(
        "UPDATE app.market_member SET effective_until=current_date-1,effective_from=current_date-10 WHERE market_key='EU'",
      );
      await expect(
        ai.connect(
          ownerCtx(),
          form(t, e, {
            adapter: 'google',
            expectedVersion: await versionOf('google'),
            processingScope: { kind: 'market', key: 'EU' },
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await f.owner.query(
        "UPDATE app.market_member SET effective_until=NULL,effective_from=DATE '2026-10-12' WHERE market_key='EU'",
      );
      await f.owner.query('ALTER TABLE app.market_member ENABLE TRIGGER USER');
    }
  });
  test('an EU policy authorizes nothing until a source rights review lists every country', async () => {
    const eu = (await policies()).filter((p) => p.key === 'connect-google').pop()!;
    const run = (policy: string) =>
      rawContext(f.runtime, rawCtx(), 'SELECT app.ai_run_authorized($1,$2,$3,$4,$5::jsonb,$6) ok', [
        f.tenantA,
        randomUUID(),
        policy,
        f.users.owner.id,
        JSON.stringify({ task: 'translation', schemaVersion: 1, claimIds: [randomUUID()] }),
        'translation',
      ]);
    expect((await run(eu.id)).rows[0].ok).toBe(false);
  });
});
