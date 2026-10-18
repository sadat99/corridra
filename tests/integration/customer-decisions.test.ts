import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { customerDecisionsEnabled } from '../../packages/auth/src/customer-decisions';
import { rawContext } from './support';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { missionCatalogue, machineryFields } from '../../packages/domain/src/commercial-missions';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { DecisionDisclosureService } from '../../packages/delivery/src/decision-disclosures';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerDecisionService } from '../../packages/auth/src/customer-decisions';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
const issuer = 'https://ep-decision-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
  options = { enabled: true, synthetic: true, production: false, issuer };
const reason = 'Explicit synthetic decision disclosure acceptance';
let f: Awaited<ReturnType<typeof commercialFixture>>,
  routes: CorridorService,
  service: CommercialMissionService,
  delivery: DeliveryService,
  disclosure: DecisionDisclosureService;
let publicationId: string, decisionId: string, resourceId: string;
let preserved = false;
const session = (person = 'alice') => ({
  subject: 'synthetic-decisions-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const customer = (person = 'alice') =>
  new CustomerDecisionService(f.runtime, f.auth, options, async () => session(person));
const input = (version = 1) => ({
  commandId: randomUUID(),
  publicationId,
  version,
  decisionIds: [decisionId],
  reason,
  approved: true,
});
async function snapshot() {
  const functions = (
    await f.owner.query(
      "SELECT p.oid,pg_get_functiondef(p.oid) definition,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') ORDER BY p.oid",
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
  const data = [];
  for (const t of tables) {
    const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    data.push(
      (
        await f.owner.query(
          "SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM " +
            q(t.nspname) +
            '.' +
            q(t.relname) +
            ' v',
        )
      ).rows[0].digest,
    );
  }
  return {
    functions,
    policies,
    tables,
    data,
    core: (await f.owner.query('SELECT * FROM migrations.applied ORDER BY name')).rows,
    base: (await f.owner.query('SELECT * FROM customer_migrations.applied ORDER BY name')).rows,
    commercial: (
      await f.owner.query('SELECT * FROM customer_commercial_migrations.applied ORDER BY name')
    ).rows,
  };
}
beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
  service = new CommercialMissionService(f.runtime);
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-decision-fixture');
  disclosure = new DecisionDisclosureService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  await migrateCustomerSavedMissions(f.owner);
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: session().subject,
    executorId: f.serviceId,
    reason: 'Fictional customer decision disclosure fixture,not managed-provider evidence',
  });
  const j = await journey('BD', 'CN', 'sourcing', 'CNY');
  const assessment = await j.assess();
  decisionId = (
    await service.command(
      f.ctx,
      command('decision', {
        ...j.base,
        requirementId: j.requirement.id,
        targetId: j.targetId,
        assessmentId: assessment.id,
        decision: 'NEED_INFORMATION',
        rationale: 'Independent supplier evidence remains missing',
        ...f.next(),
      }),
    )
  ).id;
  publicationId = (
    await delivery.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      missionId: j.missionId,
      title: 'Approved synthetic commercial decision context',
      company: 'Fictional requesting company',
      objective: 'Review actual recorded commercial decisions',
      brief: 'Original approved fictional commercial requirement without private contacts',
      nextAction: 'Review the scoped decision and missing evidence',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  await new DeliveryExperienceService(f.runtime).publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId,
    requirementId: j.requirement.id,
    targetIds: [j.targetId],
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Explicitly scoped fictional decision reporting',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  resourceId = (
    await new CustomerSavedMissionService(f.runtime, f.auth, options, async () =>
      session(),
    ).command({ action: 'save', commandId: randomUUID(), token: link.token, acknowledged: true })
  ).id;
  const before = await snapshot();
  await migrateCustomerDecisions(f.owner);
  const after = await snapshot();
  expect(after.functions.filter((v) => before.functions.some((b) => b.oid === v.oid))).toEqual(
    before.functions,
  );
  expect(after.tables.filter((v) => before.tables.some((b) => b.oid === v.oid))).toEqual(
    before.tables,
  );
  expect(after.policies.filter((v) => v.tablename !== 'delivery_decision_publication')).toEqual(
    before.policies,
  );
  for (const [n, t] of before.tables.entries())
    expect(after.data[after.tables.findIndex((v) => v.oid === t.oid)]).toBe(before.data[n]);
  expect(after.core).toEqual(before.core);
  expect(after.base).toEqual(before.base);
  expect(after.commercial).toEqual(before.commercial);
  const installed = await snapshot();
  await migrateCustomerDecisions(f.owner);
  expect(await snapshot()).toEqual(installed);
  preserved = true;
});
afterAll(async () => {
  await f?.close();
});

async function journey(origin: string, destination: string, typeKey: string, code: string) {
  const t = await f.target(destination),
    catalogue = await routes.catalogue(f.users.owner.ctx);
  let route = (
    await f.owner.query(
      'SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market=$2 AND destination_market=$3',
      [f.tenantA, origin, destination],
    )
  ).rows[0];
  if (!route) {
    route = { id: randomUUID() };
    await routes.createRoute(f.users.owner.ctx, { ...route, origin, destination, reason });
  }
  const definition = catalogue.requirements.find((r) => r.schema.typeKey === typeKey)!;
  const assessment = catalogue.assessments.find((r) => r.schema.typeKey === typeKey)!;
  const type = catalogue.types.find((r) => r.key === typeKey)!;
  const packId = randomUUID(),
    assignmentId = randomUUID();
  const version =
    (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE route_id=$1',
        [route.id],
      )
    ).rows[0].n + 1;
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: route.id,
    version,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: [typeKey],
      currencies: [code],
      requirements: [definition.id],
      assessments: [assessment.id],
    },
  });
  await routes.assign(f.users.owner.ctx, {
    id: assignmentId,
    missionId: t.missionId,
    packId: packId,
    missionTypeId: type.id,
    version: 1,
    reason,
  });
  const sourceId = (await f.source()).id,
    claimId = (
      await f.evidence.createClaim(f.ctx, {
        sourceId,
        statement:
          'Declared synthetic requirement and supplier response, no independent verification',
      })
    ).id;
  const provenance = { sourceId, claimId },
    base = { missionId: t.missionId, reason, ...provenance };
  const requirementInput = command('requirements', {
    ...base,
    assignmentId,
    definitionId: definition.id,
    version: 1,
    schemaVersion: 1,
    declaration: 'Original synthetic customer request retained unchanged',
    fields: {
      objective: 'Assess suppliers against actual declared requirements',
      role: 'IMPORTER',
      product: 'Synthetic production equipment',
      quantity: '100',
      unit: 'pieces',
      budgetMinor: '200000',
      currency: code,
      budgetBasis: 'One hundred pieces',
      ...(typeKey === 'machinery_procurement'
        ? {
            machinery: {
              application: 'Synthetic manufacturing',
              capacity: '100 pieces per hour',
              utilities: 'Site electricity not yet confirmed',
              acceptance: 'FAT and SAT require qualified engineering review',
            },
          }
        : {}),
    },
  });
  const requirement = await service.command(f.ctx, requirementInput);
  const assess = async (targetId = t.targetId, version = 1) =>
    service.command(
      f.ctx,
      command('assessment', {
        ...base,
        requirementId: requirement.id,
        definitionId: assessment.id,
        targetId,
        version,
        method: 'Human declared-evidence review v1',
        observedAt: new Date().toISOString(),
        results: [
          ...missionCatalogue.find((v) => v.key === typeKey)!.criteria,
          'evidence_completeness',
        ].map((criterion) => ({
          criterion,
          result: 'UNKNOWN',
          requirement: 'Declared capacity and suitability',
          basis: 'Supplier claim is recorded; independent evidence remains missing',
        })),
        technicalResults:
          typeKey === 'machinery_procurement'
            ? machineryFields.map((field) => ({
                field,
                result: 'UNKNOWN',
                basis: 'Not assessed, independent supplier evidence absent',
              }))
            : [],
        unknowns: 'Independent confirmation is absent',
        gaps: 'Need documentation and actual evidence',
        rationale: 'Review supports discussion only, no certification',
      }),
    );
  return {
    ...t,
    base,
    provenance,
    requirement,
    requirementInput,
    assess,
    code,
    assessmentDefinition: assessment.id,
  };
}

test('unapproved canonical decision exists but customer report discloses no private decision data', async () => {
  const data = await customer().read(resourceId);
  expect(data.state).toBe('NOT_APPROVED');
  expect(data.decisions).toEqual([]);
  expect(JSON.stringify(data)).not.toContain('Independent supplier evidence');
});
test('owner explicitly approves canonical decision and exact retry creates one atomic disclosure/event', async () => {
  const value = input();
  const a = await disclosure.approve(f.users.owner.ctx, value),
    b = await disclosure.approve(f.users.owner.ctx, value);
  expect(a).toEqual(b);
  const result = await customer().read(resourceId);
  expect(result.state).toBe('APPROVED');
  expect(result.decisions).toHaveLength(1);
  const d = result.decisions[0];
  expect(d).toMatchObject({
    id: decisionId,
    decision: 'NEED_INFORMATION',
    rationale: 'Independent supplier evidence remains missing',
    quotationId: null,
    claimStatus: 'self_declared',
  });
  expect(d).not.toHaveProperty('ownerId');
  expect(JSON.stringify(result)).not.toContain('@example.invalid');
  const canonical = (
    await f.owner.query('SELECT * FROM app.mission_selection WHERE id=$1', [decisionId])
  ).rows[0];
  expect(d.nextAction).toBe(canonical.next_action);
  expect(Date.parse(d.dueAt)).toBe(canonical.due_at.getTime());
  const events = (
    await f.owner.query(
      "SELECT * FROM app.domain_event WHERE aggregate_type='delivery_decision_publication' AND aggregate_id=$1",
      [a.id],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(f.users.owner.id);
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
  await expect(
    disclosure.approve(f.users.owner.ctx, { ...value, reason: 'Conflicting different review' }),
  ).rejects.toMatchObject({ status: 409 });
});
test('operator,reviewer,viewer and other tenant cannot approve or directly insert a decision disclosure', async () => {
  for (const role of ['operator', 'reviewer', 'viewer', 'other', 'outsider'])
    await expect(disclosure.approve(f.users[role].ctx, input(2))).rejects.toThrow();
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      'INSERT INTO app.delivery_decision_publication(id,tenant_id,publication_id,version,decision_ids,reason,created_by) VALUES($1,$2,$3,2,$4,$5,$6)',
      [randomUUID(), f.tenantA, publicationId, [decisionId], reason, f.users.operator.id],
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
test('customer account cannot inherit staff disclosure or read another principal saved scope', async () => {
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: session('bob').subject,
    executorId: f.serviceId,
    reason: 'Fictional separate account without inherited report authority',
  });
  await expect(customer('bob').read(resourceId)).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.runtime.query('SELECT customer.saved_mission_decisions($1)', [resourceId]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    f.runtime.query('SELECT app.client_decision_valid($1,$2,$3,$4)', [
      f.tenantA,
      publicationId,
      decisionId,
      f.users.owner.id,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});
test('disclosure revisions are immutable and an empty next revision withdraws content without deleting history', async () => {
  await expect(
    f.owner.query(
      'UPDATE app.delivery_decision_publication SET decision_ids=ARRAY[]::uuid[] WHERE publication_id=$1',
      [publicationId],
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM app.delivery_decision_publication WHERE publication_id=$1', [
      publicationId,
    ]),
  ).rejects.toThrow();
  await disclosure.approve(f.users.owner.ctx, { ...input(2), decisionIds: [] });
  const result = await customer().read(resourceId);
  expect(result.state).toBe('APPROVED');
  expect(result.version).toBe(2);
  expect(result.decisions).toEqual([]);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.delivery_decision_publication WHERE publication_id=$1',
        [publicationId],
      )
    ).rows[0].n,
  ).toBe(2);
});

test('populated optional upgrade preserves all previous functions,ACLs,RLS,rows and migration receipts', () => {
  expect(preserved).toBe(true);
});
test('unapproved or cross-mission decision IDs fail atomically without events', async () => {
  const value = { ...input(3), decisionIds: [randomUUID()] };
  await expect(disclosure.approve(f.users.owner.ctx, value)).rejects.toMatchObject({
    code: '42501',
  });
  expect(
    (
      await f.owner.query('SELECT id FROM app.delivery_decision_publication WHERE id=$1', [
        value.commandId,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
        value.commandId,
      ])
    ).rowCount,
  ).toBe(0);
});
test('expired MFA denies approval without changing disclosure or canonical records', async () => {
  const before = await snapshot();
  const old = (
    await f.owner.query('SELECT verified_at::text FROM identity.assurance WHERE session_id=$1', [
      f.users.owner.sessionId,
    ])
  ).rows[0].verified_at;
  try {
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await expect(disclosure.approve(f.users.owner.ctx, input(3))).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    await f.owner.query('UPDATE identity.assurance SET verified_at=$2 WHERE session_id=$1', [
      f.users.owner.sessionId,
      old,
    ]);
  }
  expect(await snapshot()).toEqual(before);
});
test('concurrent exact retries produce one revision and one event; stale version fails', async () => {
  const value = input(3);
  const [a, b] = await Promise.all([
    disclosure.approve(f.users.owner.ctx, value),
    disclosure.approve(f.users.owner.ctx, value),
  ]);
  expect(a).toEqual(b);
  expect(
    (
      await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
        value.commandId,
      ])
    ).rowCount,
  ).toBe(1);
  await expect(disclosure.approve(f.users.owner.ctx, input(3))).rejects.toMatchObject({
    code: '23514',
  });
});
test('customer proof expiry after a principal lock cannot disclose decision history', async () => {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '0.4 seconds')",
    [hash, issuer, session().subject],
  );
  const lock = await f.owner.connect(),
    db = await f.runtime.connect();
  try {
    await lock.query('BEGIN');
    await lock.query(
      'SELECT * FROM customer_private.principal WHERE issuer=$1 AND subject=$2 FOR UPDATE',
      [issuer, session().subject],
    );
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const denial = expect(
      db.query('SELECT customer.saved_mission_decisions($1)', [resourceId]),
    ).rejects.toMatchObject({ code: '42501' });
    await lock.query('SELECT pg_sleep(0.7)');
    await lock.query('COMMIT');
    await denial;
  } finally {
    await lock.query('ROLLBACK');
    await db.query('ROLLBACK');
    lock.release();
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
});
test('exposure requires every existing synthetic nonproduction boundary', () => {
  const env = {
    CORRIDRA_CUSTOMER_DECISIONS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    VERCEL_ENV: 'preview',
  };
  expect(customerDecisionsEnabled(env)).toBe(true);
  expect(customerDecisionsEnabled({})).toBe(false);
  for (const key of Object.keys(env)) {
    const altered = { ...env, [key]: key === 'VERCEL_ENV' ? 'production' : 'false' };
    expect(customerDecisionsEnabled(altered)).toBe(false);
  }
});

test('fresh MFA that expires while waiting for the publication lock denies all writes', async () => {
  const old = (
    await f.owner.query('SELECT verified_at::text FROM identity.assurance WHERE session_id=$1', [
      f.users.owner.sessionId,
    ])
  ).rows[0].verified_at;
  const lock = await f.owner.connect();
  const value = input(4);
  try {
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=clock_timestamp()-interval '298 seconds' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await lock.query('BEGIN');
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('delivery-decision:'||$1::text||':'||$2::text,0))",
      [f.tenantA, publicationId],
    );
    const denial = expect(disclosure.approve(f.users.owner.ctx, value)).rejects.toMatchObject({
      code: '42501',
    });
    await lock.query('SELECT pg_sleep(2.3)');
    await lock.query('COMMIT');
    await denial;
    expect(
      (
        await f.owner.query('SELECT id FROM app.delivery_decision_publication WHERE id=$1', [
          value.commandId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
          value.commandId,
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await f.owner.query('UPDATE identity.assurance SET verified_at=$2 WHERE session_id=$1', [
      f.users.owner.sessionId,
      old,
    ]);
  }
});
test('authorised administrator can explicitly review their own publication without inheriting another publisher authority', async () => {
  await rawContext(
    f.runtime,
    f.users.owner.ctx,
    "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [f.tenantA, f.users.other.id],
  );
  const ctx = { ...f.users.other.ctx, tenantId: f.tenantA };
  await expect(disclosure.approve(ctx, input(4))).rejects.toMatchObject({ code: '42501' });
  const original = (
    await f.owner.query('SELECT * FROM app.delivery_publication WHERE id=$1', [publicationId])
  ).rows[0];
  const experience = (
    await f.owner.query(
      'SELECT * FROM app.delivery_experience_publication WHERE publication_id=$1',
      [publicationId],
    )
  ).rows[0];
  const own = await delivery.publication(ctx, {
    commandId: randomUUID(),
    missionId: original.mission_id,
    title: 'Separately approved administrator report',
    company: 'Fictional customer',
    objective: 'Review independent administrator disclosure',
    brief: 'No authority inherited from the other publisher',
    nextAction: 'Review source evidence',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  await new DeliveryExperienceService(f.runtime).publication(ctx, {
    commandId: randomUUID(),
    publicationId: own.id,
    requirementId: experience.requirement_id,
    targetIds: experience.target_ids,
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  const approved = await disclosure.approve(ctx, { ...input(), publicationId: own.id });
  expect(approved.version).toBe(1);
  expect(
    (
      await f.owner.query('SELECT created_by FROM app.delivery_decision_publication WHERE id=$1', [
        approved.id,
      ])
    ).rows[0].created_by,
  ).toBe(f.users.other.id);
});

test('staff options reuse the real read permission and reveal eligible records only to owner/admin', async () => {
  const view = await disclosure.options(f.users.owner.ctx, publicationId);
  expect(view.decisions.map((d) => d.id)).toContain(decisionId);
  expect(view.decisions[0].claim_status).toBe('self_declared');
  for (const role of ['operator', 'reviewer', 'viewer', 'outsider'])
    await expect(disclosure.options(f.users[role].ctx, publicationId)).rejects.toThrow();
});

test('MFA expiry after the event lock rolls back disclosure,event,audit and outbox together', async () => {
  const old = (
    await f.owner.query('SELECT verified_at::text FROM identity.assurance WHERE session_id=$1', [
      f.users.owner.sessionId,
    ])
  ).rows[0].verified_at;
  const lock = await f.owner.connect(),
    value = input(4);
  try {
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=clock_timestamp()-interval '298 seconds' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE app.domain_event IN SHARE MODE');
    const denial = expect(disclosure.approve(f.users.owner.ctx, value)).rejects.toMatchObject({
      code: '42501',
    });
    await lock.query('SELECT pg_sleep(2.3)');
    await lock.query('COMMIT');
    await denial;
    expect(
      (
        await f.owner.query('SELECT id FROM app.delivery_decision_publication WHERE id=$1', [
          value.commandId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
          value.commandId,
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await f.owner.query('UPDATE identity.assurance SET verified_at=$2 WHERE session_id=$1', [
      f.users.owner.sessionId,
      old,
    ]);
  }
});
test('an exact successful command retry still rechecks MFA after a publication lock wait', async () => {
  const previous = (
    await f.owner.query(
      'SELECT * FROM app.delivery_decision_publication WHERE publication_id=$1 AND version=3',
      [publicationId],
    )
  ).rows[0];
  const value = {
    commandId: previous.id,
    publicationId,
    version: 3,
    decisionIds: previous.decision_ids,
    reason: previous.reason,
    approved: true,
  };
  const old = (
    await f.owner.query('SELECT verified_at::text FROM identity.assurance WHERE session_id=$1', [
      f.users.owner.sessionId,
    ])
  ).rows[0].verified_at;
  const lock = await f.owner.connect();
  try {
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=clock_timestamp()-interval '298 seconds' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await lock.query('BEGIN');
    await lock.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('delivery-decision:'||$1::text||':'||$2::text,0))",
      [f.tenantA, publicationId],
    );
    const denial = expect(disclosure.approve(f.users.owner.ctx, value)).rejects.toMatchObject({
      code: '42501',
    });
    await lock.query('SELECT pg_sleep(2.3)');
    await lock.query('COMMIT');
    await denial;
    expect(
      (
        await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
          value.commandId,
        ])
      ).rowCount,
    ).toBe(1);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await f.owner.query('UPDATE identity.assurance SET verified_at=$2 WHERE session_id=$1', [
      f.users.owner.sessionId,
      old,
    ]);
  }
});
test('expired original decision source withdraws customer data without deleting canonical history', async () => {
  const original = (
    await f.owner.query('SELECT * FROM app.mission_selection WHERE id=$1', [decisionId])
  ).rows[0];
  const source = await f.evidence.createSource(f.ctx, {
    kind: 'observation',
    locator: 'Synthetic short-lived disclosure test',
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: 'synthetic_validation',
    retentionUntil: new Date(Date.now() + 5000).toISOString(),
    aiPolicy: 'DENY',
  });
  const claim = await f.evidence.createClaim(f.ctx, {
    sourceId: source.id,
    statement: 'Synthetic expiring source;no independent verification',
  });
  const added = await service.command(
    f.ctx,
    command('decision', {
      missionId: original.mission_id,
      requirementId: original.requirement_id,
      targetId: original.target_id,
      assessmentId: original.assessment_id,
      decision: 'NEED_INFORMATION',
      rationale: 'Short-lived decision source requires fresh review',
      sourceId: source.id,
      claimId: claim.id,
      ...f.next(),
    }),
  );
  await disclosure.approve(f.users.owner.ctx, { ...input(4), decisionIds: [added.id] });
  expect((await customer().read(resourceId)).decisions[0].id).toBe(added.id);
  await f.owner.query('SELECT pg_sleep(5.2)');
  const unavailable = await customer().read(resourceId);
  expect(unavailable.state).toBe('SOURCE_UNAVAILABLE');
  expect(unavailable.decisions).toEqual([]);
  expect(JSON.stringify(unavailable)).not.toContain('Short-lived');
  expect(
    (await f.owner.query('SELECT rationale FROM app.mission_selection WHERE id=$1', [added.id]))
      .rows[0].rationale,
  ).toBe('Short-lived decision source requires fresh review');
});

test('revoked original client capability denies decision history and leaves recorded disclosure immutable', async () => {
  const saved = (
    await f.owner.query('SELECT link_id FROM customer_private.saved_mission WHERE id=$1', [
      resourceId,
    ])
  ).rows[0];
  const before = (
    await f.owner.query('SELECT * FROM app.delivery_decision_publication ORDER BY id')
  ).rows;
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: saved.link_id,
    publicationId: null,
    reason: 'Synthetic original client capability revocation',
  });
  await expect(customer().read(resourceId)).rejects.toMatchObject({ code: '42501' });
  expect(
    (await f.owner.query('SELECT * FROM app.delivery_decision_publication ORDER BY id')).rows,
  ).toEqual(before);
  for (const pool of [f.runtime, f.auth])
    await expect(
      pool.query('SELECT * FROM customer_decision_migrations.applied'),
    ).rejects.toMatchObject({ code: '42501' });
});

test('a real decision from another mission cannot be approved into this publication', async () => {
  const j = await journey('BD', 'CN', 'sourcing', 'CNY'),
    assessment = await j.assess();
  const other = await service.command(
    f.ctx,
    command('decision', {
      ...j.base,
      ...f.next(),
      requirementId: j.requirement.id,
      targetId: j.targetId,
      assessmentId: assessment.id,
      decision: 'NEED_INFORMATION',
      rationale: 'Separate canonical mission must remain outside this disclosure',
    }),
  );
  expect(
    (await f.owner.query('SELECT mission_id FROM app.mission_selection WHERE id=$1', [other.id]))
      .rows[0].mission_id,
  ).toBe(j.missionId);
  expect(
    (
      await f.owner.query('SELECT app.client_decision_valid($1,$2,$3,$4) valid', [
        f.tenantA,
        publicationId,
        decisionId,
        f.users.owner.id,
      ])
    ).rows[0].valid,
  ).toBe(true);
  const value = { ...input(5), decisionIds: [other.id] };
  await expect(disclosure.approve(f.users.owner.ctx, value)).rejects.toMatchObject({
    code: '42501',
  });
  expect(
    (
      await f.owner.query('SELECT id FROM app.delivery_decision_publication WHERE id=$1', [
        value.commandId,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await f.owner.query('SELECT id FROM app.domain_event WHERE aggregate_id=$1', [
        value.commandId,
      ])
    ).rowCount,
  ).toBe(0);
});
