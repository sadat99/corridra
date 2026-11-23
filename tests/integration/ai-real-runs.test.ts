import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { rawContext } from './support';
import { AccessService } from '../../packages/auth/src/access';
import { configureAiRealRuns } from '../../packages/auth/src/ai-real-configuration';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { migrateAiModelPolicyReal } from '../../packages/db/src/ai-model-policy-real-migrate';
import { migrateAiRealRuns } from '../../packages/db/src/ai-real-runs-migrate';
import { IntelligenceService } from '../../packages/intelligence/src/service';
import {
  SdkInferenceAdapter,
  adapterSecretRef,
  type AdapterRequest,
} from '../../packages/intelligence/src/adapters';

// ADR-091, on the database. AI runs, results and reviews work in a real workspace only while the owner-controlled database
// control is open. The rules that keep contact details away from a provider and that keep every result unverified until a
// person reviews it hold for real workspaces, with any of the three adapters, and no other workspace can read or write them.
let f: Awaited<ReturnType<typeof commercialFixture>>;
let routes: CorridorService;
let access: AccessService;
let ai: IntelligenceService;
const requests: AdapterRequest[] = [];
const reason = 'Real workspace AI assistance check';
const later = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
let purpose = 'synthetic_validation';
const raw = (user: keyof typeof f.users) => ({ ...f.users[user].ctx, purpose });
const missions: string[] = [];
const adapters = ['openai', 'anthropic', 'google'] as const;
type Adapter = (typeof adapters)[number];

async function toReal() {
  await f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
  await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [f.tenantA]);
  await f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
  await f.owner.query('ALTER TABLE app.membership DISABLE TRIGGER USER');
  await f.owner.query(
    "UPDATE app.membership SET allowed_purposes=ARRAY['commercial_qualification'] WHERE tenant_id=$1",
    [f.tenantA],
  );
  await f.owner.query('ALTER TABLE app.membership ENABLE TRIGGER USER');
  // A real workspace holds its settings under its own purpose from its first day; the fixture began as a sample one.
  await f.owner.query('ALTER TABLE app.config_version DISABLE TRIGGER USER');
  await f.owner.query(
    "UPDATE app.config_version SET purpose='commercial_qualification' WHERE tenant_id=$1",
    [f.tenantA],
  );
  await f.owner.query('ALTER TABLE app.config_version ENABLE TRIGGER USER');
  await f.owner.query(
    "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES('https://ai-real-fixture.example/auth',$1,$2,$3,'real-intake-2026-10-21-v1',true)",
    [f.serviceId, f.tenantA, f.users.owner.id],
  );
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'true');
  purpose = 'commercial_qualification';
}
async function publicClaim(statement: string, subjectLocations: string[] = []) {
  const source = (
    await f.evidence.createSource(f.users.owner.ctx, {
      kind: 'public_record',
      locator: 'Public capacity record ' + randomUUID(),
      observedAt: new Date().toISOString(),
      classification: 'PUBLIC',
      purpose,
      retentionUntil: later(10),
      aiPolicy: 'REVIEW_REQUIRED',
    })
  ).id as string;
  const claim = (await f.evidence.createClaim(f.users.owner.ctx, { sourceId: source, statement }))
    .id as string;
  await rawContext(
    f.runtime,
    raw('owner'),
    `INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,ai_permission,transfer_status,transfer_mechanism,effective_from,reason,created_by) VALUES($1,$2,$3,1,'Reviewed public record licence',ARRAY['AI_REVIEW'],'CONTROLLER',$4,'PUBLIC',ARRAY['DE'],$5,ARRAY['DE'],$6,'REVIEW_REQUIRED','APPROVED','Reviewed transfer record',now(),$7,$8)`,
    [
      randomUUID(),
      f.tenantA,
      source,
      purpose,
      subjectLocations,
      later(9),
      reason,
      f.users.owner.id,
    ],
  );
  return { source, claim };
}
async function policy(adapter: Adapter, source: string, evaluationStatus = 'APPROVED_PROVIDER') {
  const id = randomUUID();
  await ai.configure(f.users.owner.ctx, {
    policy: {
      id,
      version: 1,
      adapter,
      model: `reviewed-${adapter}-v1`,
      secretRef: adapterSecretRef[adapter],
      approved: true,
      evaluationStatus,
      evaluationSourceId: source,
      processingLocations: ['DE'],
      tasks: ['commercial_intent'],
      inputRateMinorPerMillion: '100',
      outputRateMinorPerMillion: '200',
      maxCostMinor: '100',
      currency: 'USD',
      effectiveUntil: later(5),
    },
    key: `real-${adapter}-${id.slice(0, 8)}`,
    termsSourceId: source,
    dailyBudgetMinor: '1000',
    effectiveFrom: new Date().toISOString(),
    reason,
  });
  return id;
}
// A new pack version on the one route that names the policy, then a first assignment of an unused request to it.
async function assign(policyId: string) {
  const missionId = missions.pop()!;
  const packId = randomUUID();
  const route = (
    await f.owner.query(
      "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='CN'",
      [f.tenantA],
    )
  ).rows[0].id as string;
  const version =
    (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2',
        [f.tenantA, route],
      )
    ).rows[0].n + 1;
  const type = 'machinery_procurement';
  const catalogue = await routes.catalogue(f.users.owner.ctx);
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: route,
    version,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: [type],
      requirements: [catalogue.requirements.find((r) => r.schema.typeKey === type)!.id],
      assessments: [catalogue.assessments.find((r) => r.schema.typeKey === type)!.id],
      requiredCapabilities: ['supplier_research'],
      aiPolicyRef: policyId,
    },
    reason,
  });
  await routes.assign(f.users.owner.ctx, {
    id: randomUUID(),
    missionId,
    packId,
    missionTypeId: catalogue.types.find((x) => x.key === type)!.id,
    version: 1,
    reason,
  });
  return missionId;
}
const command = (missionId: string, policyId: string, claim: string) => ({
  commandId: randomUUID(),
  missionId,
  policyId,
  input: { task: 'commercial_intent', schemaVersion: 1, claimIds: [claim] },
});
const count = async (table: string) =>
  (await f.owner.query(`SELECT count(*)::int n FROM app.${table} WHERE tenant_id=$1`, [f.tenantA]))
    .rows[0].n as number;
const rows = async () => ({
  run: await count('ai_run'),
  attempt: await count('ai_attempt'),
  result: await count('ai_result'),
  review: await count('ai_review'),
  completion: await count('ai_completion'),
});
const gate = async (user: keyof typeof f.users = 'owner') =>
  (
    await rawContext(f.runtime, raw(user), "SELECT app.part4_enabled($1,'ai.enabled') ai", [
      f.tenantA,
    ])
  ).rows[0].ai as boolean;
const control = (enabled: boolean) =>
  configureAiRealRuns(f.owner, {
    enabled,
    reason: enabled ? 'Owner opened AI for real workspaces' : 'Owner paused AI for real workspaces',
  });
const stale = (user: { sessionId: string }) =>
  f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [user.sessionId],
  );
const fresh = (user: { sessionId: string }) =>
  f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
    user.sessionId,
  ]);
const statement = 'Machine capacity is 100 units per hour.';
let open: { missionId: string; policyId: string; claim: string; source: string };

beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
  access = new AccessService(f.runtime);
  await migrateCommercialReadiness(f.owner);
  ai = new IntelligenceService(f.runtime, true, {
    async generate(r) {
      requests.push(r);
      const s = JSON.parse(r.prompt).untrustedSources[0];
      return {
        output: {
          authority: 'UNVERIFIED_DRAFT',
          facts: [s],
          unknowns: ['Acceptance is not known'],
          data: { proposedIntent: 'Review a machine', fields: [] },
        },
        inputTokens: 100,
        outputTokens: 100,
      };
    },
  });
  await routes.installTemplates(f.users.owner.ctx);
  await routes.createRoute(f.users.owner.ctx, {
    id: randomUUID(),
    origin: 'BD',
    destination: 'CN',
    reason,
  });
  await access.appendConfig(f.users.owner.ctx, { key: 'ai.enabled', enabled: true });
  for (let i = 0; i < 12; i++) missions.push((await f.target('CN')).missionId);
  await migrateCustomerRealUse(f.owner);
  await migrateNetworkRealUse(f.owner);
  await migrateAiModelPolicyReal(f.owner);
}, 300000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await f?.close();
});

describe('installed and closed', () => {
  test('the install opens nothing: the control is closed and a sample workspace runs exactly as before', async () => {
    await migrateAiRealRuns(f.owner);
    expect((await f.owner.query('SELECT app.ai_real_runs_open() open')).rows[0].open).toBe(false);
    expect((await f.owner.query('SELECT count(*)::int n FROM app.ai_real_control')).rows[0].n).toBe(
      0,
    );
    const c = await publicClaim(statement);
    // A sample workspace may still use a policy evaluated on sample data only.
    const policyId = await policy('openai', c.source, 'SYNTHETIC_ONLY');
    const missionId = await assign(policyId);
    const result = await ai.run(f.ctx, command(missionId, policyId, c.claim));
    expect('output' in result && result.output).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(await rows()).toMatchObject({ run: 1, attempt: 1, result: 1, completion: 1 });
  });

  test('a real workspace cannot run while the control is closed, and no provider is called', async () => {
    await toReal();
    const c = await publicClaim(statement);
    const policyId = await policy('anthropic', c.source);
    const missionId = await assign(policyId);
    open = { missionId, policyId, ...c };
    const before = await rows();
    expect(await gate()).toBe(false);
    await expect(ai.run(f.ctx, command(missionId, policyId, c.claim))).rejects.toMatchObject({
      status: 403,
      code: 'AI_REAL_OFF',
    });
    // The database refuses on its own, whatever the application does.
    await expect(
      rawContext(
        f.runtime,
        raw('operator'),
        "INSERT INTO app.ai_run(id,tenant_id,mission_id,policy_id,task,input,input_hash,created_by) VALUES($1,$2,$3,$4,'commercial_intent',$5::jsonb,'hash',app.actor_id())",
        [
          randomUUID(),
          f.tenantA,
          missionId,
          policyId,
          JSON.stringify({ task: 'commercial_intent', schemaVersion: 1, claimIds: [c.claim] }),
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await rows()).toEqual(before);
    expect(requests).toHaveLength(1);
    expect((await ai.workspace(f.ctx)).enabled).toBe(false);
  });

  test('only the offline owner can open the control, with a reason, and the runtime cannot touch it', async () => {
    await expect(
      configureAiRealRuns(f.owner, { enabled: true, reason: 'short' }),
    ).rejects.toThrow();
    await expect(
      configureAiRealRuns(f.runtime, { enabled: true, reason: 'Runtime tries to open it' }),
    ).rejects.toThrow();
    for (const sql of [
      "INSERT INTO app.ai_real_control(version,enabled,reason) VALUES(1,true,'Runtime tries to open it')",
      'SELECT * FROM app.ai_real_control',
    ])
      await expect(rawContext(f.runtime, raw('owner'), sql)).rejects.toMatchObject({
        code: '42501',
      });
    expect((await f.owner.query('SELECT app.ai_real_runs_open() open')).rows[0].open).toBe(false);
  });
});

describe('open', () => {
  test('opening is recorded once, and the workspace owner still has to switch AI on for the workspace', async () => {
    expect(await control(true)).toEqual({ enabled: true, changed: true });
    expect(await control(true)).toEqual({ enabled: true, changed: false });
    expect(
      (await f.owner.query('SELECT version,enabled,reason FROM app.ai_real_control')).rows,
    ).toEqual([{ version: 1, enabled: true, reason: 'Owner opened AI for real workspaces' }]);
    await expect(f.owner.query('UPDATE app.ai_real_control SET enabled=false')).rejects.toThrow();
    expect(await gate()).toBe(true);
    await access.appendConfig(f.users.owner.ctx, { key: 'ai.enabled', enabled: false });
    expect(await gate()).toBe(false);
    await expect(
      ai.run(f.ctx, command(open.missionId, open.policyId, open.claim)),
    ).rejects.toMatchObject({ code: 'AI_REAL_OFF' });
    await access.appendConfig(f.users.owner.ctx, { key: 'ai.enabled', enabled: true });
    expect(await gate()).toBe(true);
    // A member of another workspace never sees the gate as open.
    await expect(
      rawContext(
        f.runtime,
        { ...f.users.other.ctx, purpose },
        'SELECT app.part4_enabled($1,$2) ai',
        [f.tenantA, 'ai.enabled'],
      ),
    ).resolves.toMatchObject({ rows: [{ ai: false }] });
  });

  test('a run works with each of the three adapters and sends only the cited public statement', async () => {
    const seen: string[] = [];
    for (const adapter of adapters) {
      const target =
        adapter === 'anthropic'
          ? open
          : await (async () => {
              const c = await publicClaim(statement);
              const policyId = await policy(adapter, c.source);
              return { missionId: await assign(policyId), policyId, ...c };
            })();
      // The anthropic policy was pinned by an earlier pack version; pin it again so it is the current one.
      const missionId = adapter === 'anthropic' ? await assign(target.policyId) : target.missionId;
      const sent = requests.length;
      const cmd = command(missionId, target.policyId, target.claim);
      const result = await ai.run(f.ctx, cmd);
      expect('output' in result && result.output, adapter).toBeTruthy();
      expect(requests).toHaveLength(sent + 1);
      const request = requests[sent];
      expect(request).toMatchObject({ adapter, secretRef: adapterSecretRef[adapter] });
      expect(JSON.parse(request.prompt)).toEqual({
        task: 'commercial_intent',
        untrustedSources: [{ sourceId: target.source, claimId: target.claim, quote: statement }],
      });
      const stored = (
        await f.owner.query(
          'SELECT r.status,r.output,r.metadata FROM app.ai_result r JOIN app.ai_attempt a ON a.id=r.attempt_id WHERE a.run_id=$1',
          [cmd.commandId],
        )
      ).rows[0];
      expect(stored.status).toBe('SUCCEEDED');
      expect(stored.output.authority).toBe('UNVERIFIED_DRAFT');
      expect(stored.metadata.adapter).toBe(adapter);
      seen.push(stored.metadata.adapter);
      // An exact retry never calls the provider again.
      await ai.run(f.ctx, cmd);
      expect(requests).toHaveLength(sent + 1);
      if (adapter === 'anthropic') open = { ...target, missionId };
    }
    expect(seen).toEqual([...adapters]);
  });

  test('each provider adapter is ready only with an approved evaluation, its key and every processing location', () => {
    for (const adapter of adapters) {
      const upper = adapter.toUpperCase();
      const ready = (env: Record<string, string>, evaluationStatus = 'APPROVED_PROVIDER') =>
        new SdkInferenceAdapter(env).ready({
          adapter,
          secretRef: adapterSecretRef[adapter],
          evaluationStatus,
          processingLocations: ['DE', 'FR'],
        });
      const key = { [adapterSecretRef[adapter]]: 'unit-test-not-a-key' };
      const locations = { [`CORRIDRA_${upper}_PROCESSING_LOCATIONS`]: 'DE, FR' };
      expect(ready({ ...key, ...locations }), adapter).toBe(true);
      expect(ready({ ...key, ...locations }, 'SYNTHETIC_ONLY'), adapter).toBe(false);
      expect(ready({ ...locations }), adapter).toBe(false);
      expect(ready({ ...key, [`CORRIDRA_${upper}_PROCESSING_LOCATIONS`]: 'DE' }), adapter).toBe(
        false,
      );
    }
  });

  test('a provider evaluated on sample data only never serves a real workspace', async () => {
    const c = await publicClaim(statement);
    const policyId = await policy('google', c.source, 'SYNTHETIC_ONLY');
    const missionId = await assign(policyId);
    const before = { rows: await rows(), sent: requests.length };
    await expect(ai.run(f.ctx, command(missionId, policyId, c.claim))).rejects.toMatchObject({
      message: expect.stringContaining('Approved provider evaluation required in a real workspace'),
    });
    expect({ rows: await rows(), sent: requests.length }).toEqual(before);
    // The same rule holds for an attempt, so a fallback evaluated on sample data only cannot serve the run either.
    const run = (
      await f.owner.query('SELECT id FROM app.ai_run WHERE tenant_id=$1 AND mission_id=$2', [
        f.tenantA,
        open.missionId,
      ])
    ).rows[0].id;
    await expect(
      rawContext(
        f.runtime,
        raw('operator'),
        'INSERT INTO app.ai_attempt(id,tenant_id,run_id,policy_id,reserved_minor,created_by) VALUES($1,$2,$3,$4,1,app.actor_id())',
        [randomUUID(), f.tenantA, run, policyId],
      ),
    ).rejects.toMatchObject({
      code: '42501',
      message: 'Approved provider evaluation required in a real workspace',
    });
    expect({ rows: await rows(), sent: requests.length }).toEqual(before);
  });

  test('contact details and personal data never reach a provider', async () => {
    const before = { rows: await rows(), sent: requests.length };
    for (const [words, subjects] of [
      ['Write to sales@factory.example for the capacity sheet.', []],
      ['Capacity desk phone: 0171 2345 6789.', []],
      ['Call +880 1711 234567 for the capacity sheet.', []],
      [statement, ['BD']],
    ] as const) {
      const c = await publicClaim(words, [...subjects]);
      const policyId = await policy('openai', c.source);
      const missionId = await assign(policyId);
      await expect(
        ai.run(f.ctx, command(missionId, policyId, c.claim)),
        words,
      ).rejects.toMatchObject({ code: '42501' });
    }
    expect({ rows: await rows(), sent: requests.length }).toEqual(before);
  });
});

describe('review and isolation', () => {
  const draft = async () =>
    (await ai.workspace(f.ctx)).drafts.find(
      (d: { mission_id: string; result_id: string | null; decision: string | null }) =>
        d.mission_id === open.missionId && d.result_id && !d.decision,
    )!;

  test('a result stays unverified until a reviewer with a fresh authenticator check decides', async () => {
    // A fresh run, so its route pack is the current one when the review is recorded.
    const c = await publicClaim(statement);
    const policyId = await policy('anthropic', c.source);
    open = { missionId: await assign(policyId), policyId, ...c };
    await ai.run(f.ctx, command(open.missionId, open.policyId, open.claim));
    const d = await draft();
    expect(d.output.authority).toBe('UNVERIFIED_DRAFT');
    const decide = (user: keyof typeof f.users, extra: Record<string, unknown> = {}) =>
      ai.review(f.users[user].ctx, {
        commandId: randomUUID(),
        resultId: d.result_id,
        decision: 'ACCEPT',
        reason,
        ...extra,
      });
    await expect(decide('viewer')).rejects.toThrow();
    await expect(decide('other')).rejects.toThrow();
    await stale(f.users.reviewer);
    try {
      await expect(decide('reviewer')).rejects.toThrow();
    } finally {
      await fresh(f.users.reviewer);
    }
    // An edit cannot add a statement that no cited source holds.
    await expect(
      decide('reviewer', {
        decision: 'EDIT',
        editedOutput: {
          ...d.output,
          facts: [{ ...d.output.facts[0], quote: 'Machine capacity is 900 units per hour.' }],
        },
      }),
    ).rejects.toThrow();
    expect(await count('ai_review')).toBe(0);
    expect(await decide('reviewer')).toMatchObject({
      decision: 'ACCEPT',
      authority: 'REVIEWED_DRAFT',
    });
    await expect(decide('reviewer')).rejects.toThrow();
    expect(
      (
        await f.owner.query('SELECT decision,created_by FROM app.ai_review WHERE result_id=$1', [
          d.result_id,
        ])
      ).rows,
    ).toEqual([{ decision: 'ACCEPT', created_by: f.users.reviewer.id }]);
    // History cannot be rewritten, even by the database owner.
    await expect(
      f.owner.query("UPDATE app.ai_result SET output='{}'::jsonb WHERE id=$1", [d.result_id]),
    ).rejects.toThrow();
  });

  test('a viewer and another workspace read nothing and write nothing', async () => {
    const tables = ['ai_run', 'ai_attempt', 'ai_result', 'ai_review', 'ai_completion'];
    for (const table of tables) {
      expect(await count(table), table).toBeGreaterThan(0);
      expect(
        (
          await rawContext(
            f.runtime,
            raw('reviewer'),
            `SELECT count(*)::int n FROM app.${table} WHERE tenant_id=$1`,
            [f.tenantA],
          )
        ).rows[0].n,
        table,
      ).toBe(await count(table));
      for (const ctx of [
        raw('viewer'),
        { ...f.users.other.ctx, purpose },
        f.users.other.ctx,
        // A member of this workspace under the sample purpose reads nothing either.
        { ...f.users.reviewer.ctx, purpose: 'synthetic_validation' },
      ])
        expect(
          (await rawContext(f.runtime, ctx, `SELECT count(*)::int n FROM app.${table}`)).rows[0].n,
          table,
        ).toBe(0);
    }
    const input = JSON.stringify({
      task: 'commercial_intent',
      schemaVersion: 1,
      claimIds: [open.claim],
    });
    const insert = (ctx: ReturnType<typeof raw>, tenant: string) =>
      rawContext(
        f.runtime,
        ctx,
        "INSERT INTO app.ai_run(id,tenant_id,mission_id,policy_id,task,input,input_hash,created_by) VALUES($1,$2,$3,$4,'commercial_intent',$5::jsonb,'hash',app.actor_id())",
        [randomUUID(), tenant, open.missionId, open.policyId, input],
      );
    const before = await rows();
    await expect(insert({ ...f.users.other.ctx, purpose }, f.tenantA)).rejects.toThrow();
    await expect(insert(f.users.other.ctx, f.tenantA)).rejects.toThrow();
    await expect(insert(raw('viewer'), f.tenantA)).rejects.toThrow();
    // A member of the real workspace cannot write a run into another workspace.
    await expect(insert(raw('operator'), f.tenantB)).rejects.toThrow();
    const run = (
      await f.owner.query('SELECT id FROM app.ai_run WHERE mission_id=$1', [open.missionId])
    ).rows[0].id;
    for (const ctx of [{ ...f.users.other.ctx, purpose }, raw('viewer')])
      await expect(
        rawContext(f.runtime, ctx, 'SELECT app.ai_scoped_sources($1,$2)', [f.tenantA, run]),
      ).rejects.toMatchObject({ code: '42501' });
    expect(await rows()).toEqual(before);
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.ai_run WHERE tenant_id=$1', [
          f.tenantB,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  test('every run, result and review raised its change event for the real workspace', async () => {
    const events = (
      await f.owner.query(
        "SELECT aggregate_type,count(*)::int n FROM app.domain_event WHERE tenant_id=$1 AND aggregate_type LIKE 'ai_%' GROUP BY 1",
        [f.tenantA],
      )
    ).rows;
    const byType = Object.fromEntries(events.map((e) => [e.aggregate_type, e.n]));
    const now = await rows();
    expect(byType).toMatchObject({
      ai_run: now.run,
      ai_attempt: now.attempt,
      ai_result: now.result,
      ai_review: now.review,
      ai_completion: now.completion,
    });
  });
});

describe('paused', () => {
  test('pausing stops new runs and reviews at once and keeps every record readable', async () => {
    const c = await publicClaim(statement);
    const policyId = await policy('openai', c.source);
    const missionId = await assign(policyId);
    const pending = command(missionId, policyId, c.claim);
    await ai.run(f.ctx, pending);
    const unreviewed = (
      await f.owner.query(
        'SELECT r.id FROM app.ai_result r JOIN app.ai_attempt a ON a.id=r.attempt_id WHERE a.run_id=$1',
        [pending.commandId],
      )
    ).rows[0].id;
    expect(await control(false)).toEqual({ enabled: false, changed: true });
    const before = { rows: await rows(), sent: requests.length };
    expect(await gate()).toBe(false);
    await expect(ai.run(f.ctx, command(missionId, policyId, c.claim))).rejects.toMatchObject({
      code: 'AI_REAL_OFF',
    });
    await expect(
      ai.review(f.users.reviewer.ctx, {
        commandId: randomUUID(),
        resultId: unreviewed,
        decision: 'ACCEPT',
        reason,
      }),
    ).rejects.toThrow();
    expect({ rows: await rows(), sent: requests.length }).toEqual(before);
    const workspace = await ai.workspace(f.ctx);
    expect(workspace.enabled).toBe(false);
    expect(workspace.drafts.length).toBe(before.rows.run);
    expect(
      (await f.owner.query('SELECT version,enabled FROM app.ai_real_control ORDER BY version'))
        .rows,
    ).toEqual([
      { version: 1, enabled: true },
      { version: 2, enabled: false },
    ]);
  });

  test('switching real use off closes AI for the real workspace even while the control is open', async () => {
    await control(true);
    expect(await gate()).toBe(true);
    await f.owner.query('ALTER TABLE customer_private.real_use_configuration DISABLE TRIGGER USER');
    try {
      await f.owner.query('UPDATE customer_private.real_use_configuration SET enabled=false');
      expect(await gate()).toBe(false);
    } finally {
      await f.owner.query('UPDATE customer_private.real_use_configuration SET enabled=true');
      await f.owner.query(
        'ALTER TABLE customer_private.real_use_configuration ENABLE TRIGGER USER',
      );
    }
    expect(await gate()).toBe(true);
  });
});
