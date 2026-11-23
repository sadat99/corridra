import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerRequestReferences } from '../../packages/db/src/customer-request-reference-migrate';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { missionCatalogue } from '../../packages/domain/src/commercial-missions';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { DecisionDisclosureService } from '../../packages/delivery/src/decision-disclosures';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';

// ADR-076 item 4, proved in the real database as the restricted runtime role. A card stores no decision text:
// these cases show what the six fields are, who may make, see and withdraw a card, and that every public
// refusal is the same answer. Customer sessions are real proofs, the public read is an anonymous runtime call.
const issuer = 'https://ep-cards-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const reason = 'Synthetic decision card acceptance';
const markers = {
  quotation: 'MARKER-QUOTE-3b7e',
  price: '918273645',
  second: 'MARKER-SECOND-DECISION-8d1c',
  evidence: 'MARKER-EVIDENCE-6a02',
  brief: 'MARKER-BRIEF-51ef',
  request: 'MARKER-REQUEST-c94b',
};
const unknown = { state: 'unknown' };
const people = ['alice', 'bob', 'carol', 'dave', 'erin'] as const;
type Person = (typeof people)[number];
const session = (who: string) => ({
  subject: 'synthetic-cards-' + who,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const hex = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hex(token) };
};
const functions = {
  state: 'customer.decision_card_state(uuid)',
  preview: 'customer.decision_card_preview(uuid,uuid)',
  create: 'customer.create_decision_card(uuid,uuid,uuid,text,text,timestamp with time zone)',
  withdraw: 'customer.withdraw_decision_card(uuid,uuid)',
  read: 'app.read_decision_card(text)',
};

let f: Awaited<ReturnType<typeof commercialFixture>>;
let routes: CorridorService, commercial: CommercialMissionService, delivery: DeliveryService;
let disclosure: DecisionDisclosureService, staff: CustomerDeliveryService;
let workspaceId: string, daveWorkspace: string;
const principals: Record<string, string> = {};
const members: Record<string, string> = {};

type Scenario = Awaited<ReturnType<typeof build>>;
type Card = { cardId: string; expiresAt: string; state: string; token: string; hash: string };

const workspaces = (who: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(who));
const roles = (who: string) =>
  new CustomerMemberRoleService(f.runtime, f.auth, options, async () => session(who));
const saved = (who: string) =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(who));

// One statement as a customer with a fresh proof, in its own transaction, exactly as the service runs it.
async function as(who: string, sql: string, args: unknown[] = [], zone?: string) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, issuer, session(who).subject],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    if (zone) await db.query("SELECT set_config('TimeZone',$1,true)", [zone]);
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
const preview = async (who: string, s: { resourceId: string }, decision: string) =>
  (
    await as(who, 'SELECT customer.decision_card_preview($1,$2) AS result', [
      s.resourceId,
      decision,
    ])
  ).rows[0].result;
const state = async (who: string, resource: string) =>
  (await as(who, 'SELECT customer.decision_card_state($1) AS result', [resource])).rows[0].result;
const create = async (
  who: string,
  s: { resourceId: string },
  decision: string,
  digest: string,
  token = newToken(),
  commandId: string = randomUUID(),
  expiresAt: string | null = null,
) => {
  const result = (
    await as(who, 'SELECT customer.create_decision_card($1,$2,$3,$4,$5,$6) AS result', [
      commandId,
      s.resourceId,
      decision,
      digest,
      token.hash,
      expiresAt,
    ])
  ).rows[0].result;
  return { ...result, ...token, commandId } as Card & { commandId: string };
};
const withdraw = async (who: string, card: string, commandId = randomUUID()) =>
  (await as(who, 'SELECT customer.withdraw_decision_card($1,$2) AS result', [commandId, card]))
    .rows[0].result;
const read = async (hash: string | null) =>
  (await f.runtime.query('SELECT app.read_decision_card($1) AS result', [hash])).rows[0].result;
// Preview and create in the way the service will: the digest comes from the preview.
async function share(who: string, s: Scenario, decision = s.decisionId, expiresAt = false) {
  // Test housekeeping: earlier cases leave live cards on the shared reports, so make room under the limit of five
  // by withdrawing the oldest as the owner connection. The limit itself is proved on a report of its own.
  await f.owner.query(
    `INSERT INTO customer_private.decision_card_withdrawal(card_id,principal_id,command_id)
     SELECT c.id,c.principal_id,gen_random_uuid() FROM customer_private.decision_card c
     WHERE c.saved_mission_id=$1 AND c.expires_at>now()
     AND NOT EXISTS(SELECT FROM customer_private.decision_card_withdrawal w WHERE w.card_id=c.id)
     AND (SELECT count(*) FROM customer_private.decision_card x WHERE x.saved_mission_id=$1 AND x.expires_at>now()
          AND NOT EXISTS(SELECT FROM customer_private.decision_card_withdrawal y WHERE y.card_id=x.id))>=4`,
    [s.resourceId],
  );
  const p = await preview(who, s, decision);
  return create(
    who,
    s,
    decision,
    p.digest,
    newToken(),
    randomUUID(),
    expiresAt ? p.expiresAt : null,
  );
}
// Mutations the product never makes (a revoked member, a lapsed source, an edited decision) are made as the
// owner connection with the table's guard triggers off for that one statement, then put back.
async function mutate(table: string, sql: string, args: unknown[] = []) {
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await client.query(sql, args);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const one = async (sql: string, args: unknown[] = []) => (await f.owner.query(sql, args)).rows[0];
const count = async (table: string, where = 'true', args: unknown[] = []) =>
  (await one(`SELECT count(*)::int n FROM ${table} WHERE ${where}`, args)).n as number;

async function join(person: Person) {
  const invited = await workspaces('alice').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic invited ' + person,
  });
  const accepted = await workspaces(person).access({
    action: 'accept',
    commandId: randomUUID(),
    token: invited.token!,
  });
  members[person] = accepted.memberId!;
}
const setRole = (person: Person, role: 'admin' | 'member', expectedRole: 'admin' | 'member') =>
  roles('alice').command({
    action: 'set_role',
    commandId: randomUUID(),
    workspaceId,
    memberId: members[person]!,
    role,
    expectedRole,
  });

async function journey() {
  const t = await f.target('CN'),
    catalogue = await routes.catalogue(f.users.owner.ctx);
  let route = (
    await f.owner.query(
      "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='CN'",
      [f.tenantA],
    )
  ).rows[0];
  if (!route) {
    route = { id: randomUUID() };
    await routes.createRoute(f.users.owner.ctx, {
      ...route,
      origin: 'BD',
      destination: 'CN',
      reason,
    });
  }
  const definition = catalogue.requirements.find((r) => r.schema.typeKey === 'sourcing')!;
  const assessment = catalogue.assessments.find((r) => r.schema.typeKey === 'sourcing')!;
  const type = catalogue.types.find((r) => r.key === 'sourcing')!;
  const packId = randomUUID(),
    assignmentId = randomUUID();
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: route.id,
    version:
      (
        await f.owner.query(
          'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE route_id=$1',
          [route.id],
        )
      ).rows[0].n + 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: ['sourcing'],
      currencies: ['CNY'],
      requirements: [definition.id],
      assessments: [assessment.id],
    },
  });
  await routes.assign(f.users.owner.ctx, {
    id: assignmentId,
    missionId: t.missionId,
    packId,
    missionTypeId: type.id,
    version: 1,
    reason,
  });
  const source = await f.evidence.createSource(f.ctx, {
    kind: 'observation',
    locator: 'Synthetic evidence ' + markers.evidence,
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: 'synthetic_validation',
    retentionUntil: future(30),
    aiPolicy: 'DENY',
  });
  const claim = await f.evidence.createClaim(f.ctx, {
    sourceId: source.id,
    statement: 'Declared synthetic requirement and supplier response, no independent verification',
  });
  const base = { missionId: t.missionId, reason, sourceId: source.id, claimId: claim.id };
  const requirement = await commercial.command(
    f.ctx,
    command('requirements', {
      ...base,
      assignmentId,
      definitionId: definition.id,
      version: 1,
      schemaVersion: 1,
      declaration: 'Original synthetic customer request ' + markers.request,
      fields: {
        objective: 'Assess suppliers against actual declared requirements',
        role: 'IMPORTER',
        product: 'Synthetic production equipment',
        quantity: '100',
        unit: 'pieces',
        budgetMinor: '200000',
        currency: 'CNY',
        budgetBasis: 'One hundred pieces',
      },
    }),
  );
  const assess = async (version: number) =>
    commercial.command(
      f.ctx,
      command('assessment', {
        ...base,
        requirementId: requirement.id,
        definitionId: assessment.id,
        targetId: t.targetId,
        version,
        method: 'Human declared-evidence review v1',
        observedAt: new Date().toISOString(),
        results: [
          ...missionCatalogue.find((v) => v.key === 'sourcing')!.criteria,
          'evidence_completeness',
        ].map((criterion) => ({
          criterion,
          result: 'UNKNOWN',
          requirement: 'Declared capacity and suitability',
          basis: 'Supplier claim is recorded; independent evidence remains missing',
        })),
        technicalResults: [],
        unknowns: 'Independent confirmation is absent',
        gaps: 'Need documentation and actual evidence',
        rationale: 'Review supports discussion only, no certification',
      }),
    );
  return { ...t, base, requirement, assess, sourceId: source.id, claimId: claim.id };
}

// One complete reviewed report for one customer: the decision, its disclosure, the link, the request that owns
// it in that customer's workspace, the staff assignment and the customer's saved report.
async function build(who: Person, where: string, extras: { second?: boolean; days?: number } = {}) {
  const j = await journey();
  const decide = async (
    assessmentId: string,
    decision: string,
    rationale: string,
    quotationId?: string,
  ) =>
    (
      await commercial.command(
        f.ctx,
        command('decision', {
          ...j.base,
          requirementId: j.requirement.id,
          targetId: j.targetId,
          assessmentId,
          ...(quotationId ? { quotationId } : {}),
          decision,
          rationale,
          ...f.next(),
        }),
      )
    ).id as string;
  const decisionId = await decide(
    (await j.assess(1)).id,
    'NEED_INFORMATION',
    'Independent supplier evidence remains missing ' + randomUUID().slice(0, 8),
  );
  const decisions = [decisionId];
  const quotationIds: string[] = [];
  let otherDecisionId: string | null = null;
  if (extras.second) {
    const rfq = await commercial.command(
      f.ctx,
      command('rfq', {
        ...j.base,
        requirementId: j.requirement.id,
        targetIds: [j.targetId],
        buyerContext: 'Shareable invented buying context',
        requestedTerms: 'Original unit price, quantity and delivery conditions',
        dueAt: future(),
      }),
    );
    const quotation = await commercial.command(
      f.ctx,
      command('quotation', {
        ...j.base,
        rfqId: rfq.id,
        targetId: j.targetId,
        revision: 1,
        observedAt: new Date().toISOString(),
        currency: 'CNY',
        terms: { unitPriceMinor: markers.price },
        uncertainties: 'Quantity and logistics remain unconfirmed ' + markers.quotation,
      }),
    );
    quotationIds.push(quotation.id);
    otherDecisionId = await decide(
      (await j.assess(2)).id,
      'SELECT',
      'Selected for discussion ' + markers.second,
      quotation.id,
    );
    decisions.push(otherDecisionId);
  }
  const publicationId = (
    await delivery.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      missionId: j.missionId,
      title: 'Approved synthetic commercial decision context',
      company: 'Fictional requesting company',
      objective: 'Review actual recorded commercial decisions',
      brief: 'Original approved fictional commercial requirement ' + markers.brief,
      nextAction: 'Review the scoped decision and missing evidence',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id as string;
  await new DeliveryExperienceService(f.runtime).publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId,
    requirementId: j.requirement.id,
    targetIds: [j.targetId],
    quotationIds,
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
    expiresAt: future(extras.days ?? 3),
    allowExport: false,
    approved: true,
  });
  const approve = (version: number, ids: string[]) =>
    disclosure.approve(f.users.owner.ctx, {
      commandId: randomUUID(),
      publicationId,
      version,
      decisionIds: ids,
      reason,
      approved: true,
    });
  await approve(1, decisions);
  const requestId = randomUUID();
  await f.owner.query(
    `INSERT INTO customer_private.owned_request(id,principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      requestId,
      principals[who],
      randomUUID(),
      where,
      f.tenantA,
      j.missionId,
      randomUUID(),
      hex(randomUUID()),
      hex(randomUUID()),
    ],
  );
  await staff.assign(f.users.owner.ctx, {
    commandId: randomUUID(),
    requestId,
    linkId: link.id,
    reason: 'Explicit synthetic account report delivery review',
    approved: true,
  });
  const resourceId = (
    await saved(who).command({
      action: 'save',
      commandId: randomUUID(),
      token: link.token,
      acknowledged: true,
    })
  ).id as string;
  return {
    who,
    ...j,
    decisionId,
    otherDecisionId,
    publicationId,
    link,
    resourceId,
    requestId,
    approve,
    decisions,
  };
}

// The same report held by another customer who has the link but is not the requester.
const holdLink = async (who: Person, s: Scenario) =>
  (
    await saved(who).command({
      action: 'save',
      commandId: randomUUID(),
      token: s.link.token,
      acknowledged: true,
    })
  ).id as string;

let main: Scenario, plain: Scenario;
let adminSaved: Scenario, memberSaved: Scenario;

beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
  commercial = new CommercialMissionService(f.runtime);
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-card-fixture');
  disclosure = new DecisionDisclosureService(f.runtime);
  staff = new CustomerDeliveryService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  // The real-use module is part of the installed environment this module must live beside: it widens the
  // publisher test the card must not inherit.
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerDecisionCards(f.owner);
  for (const who of people) {
    principals[who] = (
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(who).subject,
        executorId: f.serviceId,
        reason: 'Fictional customer decision card fixture, never real provider data',
      })
    ).id;
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[who]!,
      reason: 'Explicit fictional private request admission',
    });
  }
  workspaceId = (
    await workspaces('alice').provision({
      commandId: randomUUID(),
      name: 'Synthetic card owner workspace',
    })
  ).id;
  daveWorkspace = (
    await workspaces('dave').provision({
      commandId: randomUUID(),
      name: 'Synthetic other tenant workspace',
    })
  ).id;
  for (const who of ['bob', 'carol', 'erin'] as const) await join(who);
  await setRole('bob', 'admin', 'member');
  await setRole('erin', 'admin', 'member');
  main = await build('alice', workspaceId, { second: true });
  plain = await build('alice', workspaceId);
  adminSaved = await build('bob', workspaceId);
  memberSaved = await build('carol', workspaceId);
}, 240000);
afterAll(async () => {
  await f?.close();
});

describe('before the module has what the customer needs', () => {
  test('the database module is installed for these cases', async () => {
    expect(
      (await one("SELECT to_regprocedure('customer.decision_card_state(uuid)') IS NOT NULL ok")).ok,
    ).toBe(true);
  });
});

describe('preview and creation', () => {
  test('the preview carries exactly the six fields and equals the matching reviewed decision', async () => {
    const result = await preview('alice', main, main.decisionId);
    expect(Object.keys(result.fields).sort()).toEqual(
      ['company', 'decision', 'dueAt', 'nextAction', 'provenance', 'rationale'].sort(),
    );
    expect(Object.keys(result.fields.provenance).sort()).toEqual(['claimStatus', 'sourceKind']);
    const listed = (
      await as('alice', 'SELECT customer.saved_mission_decisions($1) AS result', [main.resourceId])
    ).rows[0].result.decisions.find((d: { id: string }) => d.id === main.decisionId);
    expect(result.fields).toMatchObject({
      company: listed.company,
      decision: listed.decision,
      rationale: listed.rationale,
      nextAction: listed.nextAction,
      provenance: { sourceKind: listed.sourceKind, claimStatus: listed.claimStatus },
    });
    expect(Date.parse(result.fields.dueAt)).toBe(Date.parse(listed.dueAt));
    expect(result.fields.dueAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    expect(result.digest).toBe(
      (
        await one("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') d", [
          JSON.stringify(result.fields),
        ])
      ).d,
    );
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    // A preview writes nothing.
    expect(await count('customer_private.decision_card')).toBe(0);
  });

  test('the owner creates a card; the stored row holds ids, a digest of the fields and the token digest only', async () => {
    const p = await preview('alice', main, main.decisionId);
    const card = await create('alice', main, main.decisionId, p.digest);
    expect(Object.keys(card).sort()).toEqual(
      ['cardId', 'commandId', 'expiresAt', 'hash', 'state', 'token'].sort(),
    );
    expect(card.state).toBe('ACTIVE');
    const row = await one('SELECT * FROM customer_private.decision_card WHERE id=$1', [
      card.cardId,
    ]);
    expect(row).toMatchObject({
      principal_id: principals.alice,
      saved_mission_id: main.resourceId,
      workspace_id: workspaceId,
      decision_id: main.decisionId,
      field_digest: p.digest,
      token_hash: card.hash,
    });
    expect(row.expires_at.toISOString()).toBe(new Date(card.expiresAt).toISOString());
    const text = JSON.stringify(row);
    expect(text).not.toContain(card.token);
    expect(text).not.toContain(p.fields.rationale);
    expect(text).not.toContain(p.fields.nextAction);
    expect(text).not.toContain(p.fields.company);
  });

  test('creation writes one audit event and one outbox row naming no field, digest or token', async () => {
    const p = await preview('alice', main, main.decisionId);
    const card = await create('alice', main, main.decisionId, p.digest);
    const events = (
      await f.owner.query(
        "SELECT id,tenant_id,payload,aggregate_type FROM app.domain_event WHERE type='customer.decision_card.created' AND correlation_id=$1",
        [card.commandId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].tenant_id).toBe(workspaceId);
    expect(events[0].aggregate_type).toBe('customer_workspace_access');
    expect(events[0].payload).toMatchObject({
      cardId: card.cardId,
      resourceId: main.resourceId,
      decisionId: main.decisionId,
      initiator_id: principals.alice,
    });
    expect(Date.parse(events[0].payload.expiresAt)).toBe(Date.parse(card.expiresAt));
    const serialized = JSON.stringify(events[0].payload);
    for (const value of [card.token, card.hash, p.digest, p.fields.rationale, p.fields.company])
      expect(serialized).not.toContain(value);
    expect(await count('app.audit_event', 'domain_event_id=$1', [events[0].id])).toBe(1);
    expect(await count('app.outbox', 'event_id=$1', [events[0].id])).toBe(1);
  });

  test('an exact retry returns the same card and expiry and writes nothing more', async () => {
    const p = await preview('alice', main, main.decisionId);
    const token = newToken(),
      commandId = randomUUID();
    const first = await create('alice', main, main.decisionId, p.digest, token, commandId);
    const rows = await count('customer_private.decision_card');
    const events = await count('app.domain_event', "type='customer.decision_card.created'");
    const again = await create('alice', main, main.decisionId, p.digest, token, commandId);
    expect(again.cardId).toBe(first.cardId);
    expect(again.expiresAt).toBe(first.expiresAt);
    expect(again.state).toBe('ACTIVE');
    expect(await count('customer_private.decision_card')).toBe(rows);
    expect(await count('app.domain_event', "type='customer.decision_card.created'")).toBe(events);
    const [a, b] = await Promise.all([
      create('alice', main, main.decisionId, p.digest, token, commandId),
      create('alice', main, main.decisionId, p.digest, token, commandId),
    ]);
    expect([a.cardId, b.cardId]).toEqual([first.cardId, first.cardId]);
    expect(await count('customer_private.decision_card')).toBe(rows);
  });

  test('a changed retry and a stale digest are the CHANGED conflict and write nothing', async () => {
    const p = await preview('alice', main, main.decisionId);
    const token = newToken(),
      commandId = randomUUID();
    await create('alice', main, main.decisionId, p.digest, token, commandId);
    const rows = await count('customer_private.decision_card');
    const changed = { code: '23514', message: 'DECISION_CARD_CHANGED' };
    await expect(
      create('alice', main, main.otherDecisionId!, p.digest, token, commandId),
    ).rejects.toMatchObject(changed);
    await expect(
      create('alice', main, main.decisionId, hex('other'), token, commandId),
    ).rejects.toMatchObject(changed);
    await expect(
      create('alice', main, main.decisionId, p.digest, newToken(), commandId),
    ).rejects.toMatchObject(changed);
    await expect(
      create('alice', main, main.decisionId, hex('stale digest'), newToken()),
    ).rejects.toMatchObject(changed);
    expect(await count('customer_private.decision_card')).toBe(rows);
  });

  test('malformed input is refused before any write', async () => {
    const p = await preview('alice', main, main.decisionId);
    for (const [digest, hash] of [
      ['not-a-digest', newToken().hash],
      [p.digest, 'short'],
      [p.digest, newToken().token],
    ])
      await expect(
        as('alice', 'SELECT customer.create_decision_card($1,$2,$3,$4,$5)', [
          randomUUID(),
          main.resourceId,
          main.decisionId,
          digest,
          hash,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    await expect(
      as('alice', 'SELECT customer.create_decision_card(NULL,$1,$2,$3,$4)', [
        main.resourceId,
        main.decisionId,
        p.digest,
        newToken().hash,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('an invited admin who owns the request can create, a plain member cannot, and neither sees the other', async () => {
    const p = await preview('bob', adminSaved, adminSaved.decisionId);
    const card = await create('bob', adminSaved, adminSaved.decisionId, p.digest);
    expect(card.state).toBe('ACTIVE');
    await expect(preview('carol', memberSaved, memberSaved.decisionId)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      create('carol', memberSaved, memberSaved.decisionId, p.digest),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await state('carol', memberSaved.resourceId)).toMatchObject({
      canShare: false,
      maxActive: 5,
      cards: [],
    });
    expect((await state('bob', adminSaved.resourceId)).canShare).toBe(true);
  });

  test('a customer of another workspace shares their own report and reaches none of the first workspace', async () => {
    const theirs = await build('dave', daveWorkspace);
    const card = await share('dave', theirs);
    const event = await one(
      "SELECT tenant_id FROM app.domain_event WHERE type='customer.decision_card.created' AND payload->>'cardId'=$1",
      [card.cardId],
    );
    expect(event.tenant_id).toBe(daveWorkspace);
    expect((await state('dave', theirs.resourceId)).cards.map((c: { id: string }) => c.id)).toEqual(
      [card.cardId],
    );
    const first = await share('alice', plain);
    await expect(withdraw('dave', first.cardId)).rejects.toMatchObject({ code: '42501' });
    await expect(preview('dave', plain, plain.decisionId)).rejects.toMatchObject({ code: '42501' });
    expect((await read(first.hash)).state).toBe('OPEN');
  });

  test('another customer, an admin of the same workspace or another workspace, cannot make a card for a report they only hold', async () => {
    const p = await preview('alice', plain, plain.decisionId);
    for (const who of ['erin', 'dave'] as const) {
      const resource = await holdLink(who, plain);
      await expect(
        as(who, 'SELECT customer.decision_card_preview($1,$2)', [resource, plain.decisionId]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        create(who, { resourceId: resource }, plain.decisionId, p.digest),
      ).rejects.toMatchObject({ code: '42501' });
      expect(await state(who, resource)).toMatchObject({ canShare: false, cards: [] });
      // Neither can reach the owner's saved report by its id.
      await expect(preview(who, plain, plain.decisionId)).rejects.toMatchObject({ code: '42501' });
      await expect(state(who, plain.resourceId)).rejects.toMatchObject({ code: '42501' });
    }
  });

  test('a signed-out caller, an unknown report and a decision that is not disclosed are refused', async () => {
    const p = await preview('alice', plain, plain.decisionId);
    await expect(
      f.runtime.query('SELECT customer.decision_card_preview($1,$2)', [
        plain.resourceId,
        plain.decisionId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.runtime.query('SELECT customer.create_decision_card($1,$2,$3,$4,$5)', [
        randomUUID(),
        plain.resourceId,
        plain.decisionId,
        p.digest,
        newToken().hash,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(state('alice', randomUUID())).rejects.toMatchObject({ code: '42501' });
    await expect(preview('alice', plain, randomUUID())).rejects.toMatchObject({ code: '42501' });
    // A decision of another report: it exists and is disclosed there, but not in this publication.
    await expect(preview('alice', plain, main.decisionId)).rejects.toMatchObject({ code: '42501' });
    await expect(create('alice', plain, main.decisionId, p.digest)).rejects.toMatchObject({
      code: '42501',
    });
  });

  test('a saved report with no assignment has no workspace and cannot make a card', async () => {
    const lone = await build('alice', workspaceId);
    await f.owner.query('SELECT 1');
    await mutate(
      'app.customer_delivery_assignment',
      'DELETE FROM app.customer_delivery_assignment WHERE link_id=$1',
      [lone.link.id],
    );
    await expect(preview('alice', lone, lone.decisionId)).rejects.toMatchObject({ code: '42501' });
    expect((await state('alice', lone.resourceId)).canShare).toBe(false);
  });
});

describe('what a card must never carry', () => {
  test('the public card holds the six fields only: no quotation, price, contact, evidence, other decision or request text', async () => {
    const card = await share('alice', main);
    const result = await read(card.hash);
    expect(result.state).toBe('OPEN');
    expect(Object.keys(result).sort()).toEqual(['card', 'expiresAt', 'state', 'synthetic']);
    expect(result.synthetic).toBe(true);
    expect(Object.keys(result.card).sort()).toEqual(
      ['company', 'decision', 'dueAt', 'nextAction', 'provenance', 'rationale'].sort(),
    );
    expect(Object.keys(result.card.provenance).sort()).toEqual(['claimStatus', 'sourceKind']);
    const serialized = JSON.stringify(result);
    const seeded = [
      markers.quotation,
      markers.price,
      markers.second,
      markers.evidence,
      markers.brief,
      markers.request,
      'Original unit price',
      'Shareable invented buying context',
      'Fictional requesting company',
      'Synthetic Buyer Person',
      'example.invalid',
      main.targetId,
      main.decisionId,
      main.otherDecisionId!,
      main.publicationId,
      main.link.token,
      card.token,
      card.hash,
      principals.alice!,
      issuer,
    ];
    for (const value of seeded) expect(serialized).not.toContain(value);
  });

  test('the preview and the public read format the same fields, and the expiry shown is the stored expiry', async () => {
    const p = await preview('alice', main, main.decisionId);
    const card = await create(
      'alice',
      main,
      main.decisionId,
      p.digest,
      newToken(),
      randomUUID(),
      p.expiresAt,
    );
    const result = await read(card.hash);
    expect(result.card).toEqual(p.fields);
    expect(Date.parse(result.expiresAt)).toBe(Date.parse(p.expiresAt));
    expect(Date.parse(card.expiresAt)).toBe(Date.parse(p.expiresAt));
    const row = await one('SELECT expires_at FROM customer_private.decision_card WHERE id=$1', [
      card.cardId,
    ]);
    expect(row.expires_at.getTime()).toBe(Date.parse(p.expiresAt));
  });

  test('the second decision of the same report is not readable through the first card', async () => {
    const first = await share('alice', main, main.decisionId);
    const second = await share('alice', main, main.otherDecisionId!);
    const a = JSON.stringify((await read(first.hash)).card);
    const b = JSON.stringify((await read(second.hash)).card);
    expect(a).not.toContain(markers.second);
    expect(b).toContain(markers.second);
    expect(b).not.toContain('Independent supplier evidence');
  });
});

describe('the public read', () => {
  test('a valid token opens the card and the counter equals the number of opens', async () => {
    const card = await share('alice', plain);
    expect(
      (await state('alice', plain.resourceId)).cards.find(
        (c: { id: string }) => c.id === card.cardId,
      ),
    ).toMatchObject({
      state: 'ACTIVE',
      opens: 0,
      lastOpenedAt: null,
    });
    for (let n = 0; n < 3; n++) expect((await read(card.hash)).state).toBe('OPEN');
    const open = await one('SELECT * FROM customer_private.decision_card_open WHERE card_id=$1', [
      card.cardId,
    ]);
    expect(Number(open.opens)).toBe(3);
    const listed = (await state('alice', plain.resourceId)).cards.find(
      (c: { id: string }) => c.id === card.cardId,
    );
    expect(listed).toMatchObject({ state: 'ACTIVE', opens: 3, decisionId: plain.decisionId });
    expect(Date.parse(listed.lastOpenedAt)).toBe(open.last_opened_at.getTime());
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => read(card.hash)));
    expect(concurrent.every((r) => r.state === 'OPEN')).toBe(true);
    expect(
      Number(
        (
          await one('SELECT opens FROM customer_private.decision_card_open WHERE card_id=$1', [
            card.cardId,
          ])
        ).opens,
      ),
    ).toBe(8);
  });

  test('a read writes no event, outbox row, audit row or visitor datum', async () => {
    const card = await share('alice', plain);
    const before = [
      await count('app.domain_event'),
      await count('app.outbox'),
      await count('app.audit_event'),
    ];
    await read(card.hash);
    await read(card.hash);
    expect([
      await count('app.domain_event'),
      await count('app.outbox'),
      await count('app.audit_event'),
    ]).toEqual(before);
    const columns = (
      await f.owner.query(
        `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='customer_private' AND table_name LIKE 'decision_card%' ORDER BY 1,2`,
      )
    ).rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(columns.length).toBeGreaterThan(10);
    for (const column of columns)
      expect(column.split('.')[1]).not.toMatch(
        /^(ip|ip_address|address|user_agent|agent|cookie|header|headers|referrer|email|token)$/,
      );
  });

  test('every refusal is the identical answer as an unknown random token', async () => {
    const baseline = await read(newToken().hash);
    expect(baseline).toEqual(unknown);
    const cases: (string | null)[] = [
      null,
      '',
      'abc',
      hex('x').slice(1),
      hex('x') + '0',
      hex('x').toUpperCase(),
      newToken().token,
      'g'.repeat(64),
      newToken().hash,
    ];
    for (const hash of cases)
      expect(JSON.stringify(await read(hash))).toBe(JSON.stringify(baseline));
    // Withdrawn.
    const withdrawn = await share('alice', plain);
    expect((await read(withdrawn.hash)).state).toBe('OPEN');
    await withdraw('alice', withdrawn.cardId);
    expect(JSON.stringify(await read(withdrawn.hash))).toBe(JSON.stringify(baseline));
    // Expired: a past-dated row inserted by the owner (the product only ever inserts live rows).
    const p = await preview('alice', plain, plain.decisionId);
    const past = newToken();
    await f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '2 days',now()-interval '1 day')`,
      [
        principals.alice,
        randomUUID(),
        plain.resourceId,
        workspaceId,
        plain.decisionId,
        p.digest,
        past.hash,
      ],
    );
    expect(JSON.stringify(await read(past.hash))).toBe(JSON.stringify(baseline));
    const lapsed = await one('SELECT id FROM customer_private.decision_card WHERE token_hash=$1', [
      past.hash,
    ]);
    expect(
      (await state('alice', plain.resourceId)).cards.find(
        (c: { id: string }) => c.id === lapsed.id,
      ),
    ).toMatchObject({ state: 'EXPIRED', opens: 0, lastOpenedAt: null });
    // Digest mismatch: what the card was made for no longer equals what the sources say.
    const drift = newToken();
    await f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 day')`,
      [
        principals.alice,
        randomUUID(),
        plain.resourceId,
        workspaceId,
        plain.decisionId,
        hex('different fields'),
        drift.hash,
      ],
    );
    expect(JSON.stringify(await read(drift.hash))).toBe(JSON.stringify(baseline));
    // The same card made with the right digest is open, so the refusal above was the digest.
    const right = newToken();
    await f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 day')`,
      [
        principals.alice,
        randomUUID(),
        plain.resourceId,
        workspaceId,
        plain.decisionId,
        p.digest,
        right.hash,
      ],
    );
    expect((await read(right.hash)).state).toBe('OPEN');
  });

  test('a field changed after the preview answers unknown, and the same card is open again when it matches', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    expect((await read(card.hash)).state).toBe('OPEN');
    const old = (
      await one('SELECT next_action FROM app.mission_selection WHERE id=$1', [s.decisionId])
    ).next_action;
    await mutate(
      'app.mission_selection',
      "UPDATE app.mission_selection SET next_action='Changed after the preview' WHERE id=$1",
      [s.decisionId],
    );
    expect(await read(card.hash)).toEqual(unknown);
    const listed = (await state('alice', s.resourceId)).cards[0];
    expect(listed.state).toBe('UNAVAILABLE');
    await mutate(
      'app.mission_selection',
      'UPDATE app.mission_selection SET next_action=$2 WHERE id=$1',
      [s.decisionId, old],
    );
    expect((await read(card.hash)).state).toBe('OPEN');
  });
});

describe('every authority edge ends the card at once', () => {
  async function dies(s: Scenario, kill: () => Promise<unknown>, who: Person = 'alice') {
    const card = await share(who, s);
    expect((await read(card.hash)).state).toBe('OPEN');
    const opens = async () =>
      Number(
        (
          await one(
            'SELECT coalesce(max(opens),0) n FROM customer_private.decision_card_open WHERE card_id=$1',
            [card.cardId],
          )
        ).n,
      );
    const before = await opens();
    await kill();
    expect(await read(card.hash)).toEqual(unknown);
    expect(await opens()).toBe(before);
    return card;
  }

  test('a removed saved report', async () => {
    const s = await build('alice', workspaceId);
    await dies(s, () =>
      as('alice', 'SELECT customer.remove_saved_mission($1,$2)', [randomUUID(), s.resourceId]),
    );
  });

  test('a revoked delivery link', async () => {
    const s = await build('alice', workspaceId);
    await dies(s, () =>
      delivery.revoke(f.users.owner.ctx, {
        commandId: randomUUID(),
        linkId: s.link.id,
        publicationId: null,
        reason: 'Synthetic revocation',
      }),
    );
  });

  test('an expired delivery link', async () => {
    const s = await build('alice', workspaceId);
    await dies(s, () =>
      mutate(
        'app.delivery_link',
        "UPDATE app.delivery_link SET created_at=now()-interval '2 days',expires_at=now()-interval '1 minute' WHERE id=$1",
        [s.link.id],
      ),
    );
  });

  test('a publisher who lost their membership', async () => {
    const s = await build('alice', workspaceId);
    await dies(s, async () => {
      await mutate(
        'app.membership',
        'UPDATE app.membership SET revoked_at=now() WHERE user_id=$1 AND tenant_id=$2',
        [f.users.owner.id, f.tenantA],
      );
    });
    await mutate(
      'app.membership',
      'UPDATE app.membership SET revoked_at=NULL WHERE user_id=$1 AND tenant_id=$2',
      [f.users.owner.id, f.tenantA],
    );
  });

  test('a newer disclosure that drops the decision, while the other decision stays open', async () => {
    const s = await build('alice', workspaceId, { second: true });
    const a = await share('alice', s, s.decisionId);
    const b = await share('alice', s, s.otherDecisionId!);
    await s.approve(2, [s.otherDecisionId!]);
    expect(await read(a.hash)).toEqual(unknown);
    expect((await read(b.hash)).state).toBe('OPEN');
    expect(
      (await state('alice', s.resourceId)).cards.find((c: { id: string }) => c.id === a.cardId)
        .state,
    ).toBe('UNAVAILABLE');
    await s.approve(3, s.decisions);
    expect((await read(a.hash)).state).toBe('OPEN');
  });

  test('a source past its retention date', async () => {
    const s = await build('alice', workspaceId);
    await dies(s, () =>
      mutate(
        'app.source_record',
        "UPDATE app.source_record SET observed_at=now()-interval '2 days',retention_until=now()-interval '1 minute' WHERE id=$1",
        [s.sourceId],
      ),
    );
  });

  test('a revoked customer request', async () => {
    const s = await build('alice', workspaceId);
    await dies(s, () =>
      f.owner.query(
        "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Synthetic request revocation')",
        [s.requestId],
      ),
    );
  });

  test('a creator who is demoted to member, and the card comes back if they are promoted again', async () => {
    const s = await build('bob', workspaceId);
    const card = await dies(s, () => setRole('bob', 'member', 'admin'), 'bob');
    expect(await state('bob', s.resourceId)).toMatchObject({ canShare: false });
    expect(
      (await state('bob', s.resourceId)).cards.find((c: { id: string }) => c.id === card.cardId)
        .state,
    ).toBe('UNAVAILABLE');
    await expect(preview('bob', s, s.decisionId)).rejects.toMatchObject({ code: '42501' });
    // A demoted creator can still withdraw: retraction is always safe.
    expect((await withdraw('bob', card.cardId)).state).toBe('WITHDRAWN');
    await setRole('bob', 'admin', 'member');
  });

  test('a creator who left the workspace', async () => {
    const s = await build('erin', workspaceId);
    await dies(
      s,
      () =>
        workspaces('alice').access({
          action: 'revoke',
          commandId: randomUUID(),
          workspaceId,
          kind: 'membership',
          targetId: members.erin!,
        }),
      'erin',
    );
  });

  test('a real tenant: neither a real publication tenant nor a real workspace ever answers', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    expect((await read(card.hash)).state).toBe('OPEN');
    // Real use is open in this environment, so the publisher test alone would now pass for a real tenant.
    await mutate(
      'customer_private.real_use_configuration',
      "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES($1,$2,$3,$4,'real-intake-2026-10-21-v1',true)",
      [issuer, f.serviceId, f.tenantA, f.users.owner.id],
    );
    try {
      await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=false WHERE id=$1', [f.tenantA]);
      expect(await read(card.hash)).toEqual(unknown);
      await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=true WHERE id=$1', [f.tenantA]);
      expect((await read(card.hash)).state).toBe('OPEN');
      await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=false WHERE id=$1', [
        workspaceId,
      ]);
      expect(await read(card.hash)).toEqual(unknown);
      await expect(preview('alice', s, s.decisionId)).rejects.toMatchObject({ code: '42501' });
      expect((await state('alice', s.resourceId)).canShare).toBe(false);
    } finally {
      await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=true WHERE id=ANY($1)', [
        [f.tenantA, workspaceId],
      ]);
      await mutate(
        'customer_private.real_use_configuration',
        'DELETE FROM customer_private.real_use_configuration',
      );
    }
    expect((await read(card.hash)).state).toBe('OPEN');
  });
});

// Owner, 23 Nov 2026: "decision cards for real". The sample world is turned real in place for one case at a time, the
// way the case above already does: both tenants, an open real-use configuration, the real purpose for the staff who
// published, and a verified real customer session. Everything is put back afterwards.
describe('real workspaces', () => {
  const publicOn = { 'corridra.real_report_public': 'on' };
  async function asReal(
    who: string,
    sql: string,
    args: unknown[] = [],
    settings: Record<string, string> = {},
  ) {
    const hash = sessionHash(randomBytes(32).toString('hex'));
    await f.auth.query(
      "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at,data_mode,verified_email_hash) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds','real',$4)",
      [hash, issuer, session(who).subject, hex('real-' + who + '@business.test')],
    );
    const db = await f.runtime.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
      for (const [name, value] of Object.entries(settings))
        await db.query('SELECT set_config($1,$2,true)', [name, value]);
      const result = await db.query(sql, args);
      await db.query('COMMIT');
      return result.rows[0].result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
      await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
    }
  }
  // The anonymous read inside one transaction that carries the given settings, as the application sends it.
  async function readWith(hash: string, settings: Record<string, string>) {
    const db = await f.runtime.connect();
    try {
      await db.query('BEGIN');
      for (const [name, value] of Object.entries(settings))
        await db.query('SELECT set_config($1,$2,true)', [name, value]);
      const result = await db.query('SELECT app.read_decision_card($1) AS result', [hash]);
      await db.query('COMMIT');
      return result.rows[0].result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  const previewReal = (s: Scenario, settings: Record<string, string> = {}) =>
    asReal(
      'alice',
      'SELECT customer.decision_card_preview($1,$2) AS result',
      [s.resourceId, s.decisionId],
      settings,
    );
  async function real(
    sides: { publisher: boolean; workspace: boolean; open?: boolean },
    work: () => Promise<void>,
  ) {
    const real = [
      ...(sides.publisher ? [f.tenantA] : []),
      ...(sides.workspace ? [workspaceId] : []),
    ];
    await mutate(
      'customer_private.real_use_configuration',
      "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES($1,$2,$3,$4,'real-intake-2026-10-21-v1',$5)",
      [issuer, f.serviceId, f.tenantA, f.users.owner.id, sides.open ?? true],
    );
    await mutate(
      'app.membership',
      "UPDATE app.membership SET allowed_purposes=array_append(allowed_purposes,'commercial_qualification') WHERE tenant_id=$1 AND NOT 'commercial_qualification'=ANY(allowed_purposes)",
      [f.tenantA],
    );
    await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=false WHERE id=ANY($1)', [real]);
    try {
      await work();
    } finally {
      await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=true WHERE id=ANY($1)', [
        [f.tenantA, workspaceId],
      ]);
      await mutate(
        'app.membership',
        "UPDATE app.membership SET allowed_purposes=array_remove(allowed_purposes,'commercial_qualification') WHERE tenant_id=$1",
        [f.tenantA],
      );
      await mutate(
        'customer_private.real_use_configuration',
        'DELETE FROM customer_private.real_use_configuration',
      );
    }
  }

  test('both sides real: a verified real session shares a decision and the public read answers only under the public link setting', async () => {
    const s = await build('alice', workspaceId);
    let hash = '';
    await real({ publisher: true, workspace: true }, async () => {
      expect(
        (await asReal('alice', 'SELECT customer.decision_card_state($1) AS result', [s.resourceId]))
          .canShare,
      ).toBe(true);
      const p = await previewReal(s);
      expect(Object.keys(p.fields).sort()).toEqual(
        ['company', 'decision', 'dueAt', 'nextAction', 'provenance', 'rationale'].sort(),
      );
      const token = newToken();
      hash = token.hash;
      const commandId = randomUUID();
      const card = await asReal(
        'alice',
        'SELECT customer.create_decision_card($1,$2,$3,$4,$5,$6) AS result',
        [commandId, s.resourceId, s.decisionId, p.digest, token.hash, null],
      );
      expect(card.state).toBe('ACTIVE');
      // Same history rule as a sample card: creation writes exactly one event, for the workspace.
      const events = (
        await f.owner.query(
          "SELECT tenant_id FROM app.domain_event WHERE type='customer.decision_card.created' AND correlation_id=$1",
          [commandId],
        )
      ).rows;
      expect(events).toEqual([{ tenant_id: workspaceId }]);
      // The anonymous read carries no purpose of its own.
      expect(await read(token.hash)).toEqual(unknown);
      expect(await readWith(token.hash, { 'corridra.real_report_public': 'off' })).toEqual(unknown);
      const open = await readWith(token.hash, publicOn);
      expect(open.state).toBe('OPEN');
      expect(open.synthetic).toBe(false);
      expect(open.card).toEqual(p.fields);
      expect(
        (
          await one(
            'SELECT opens::int AS opens FROM customer_private.decision_card_open WHERE card_id=$1',
            [card.cardId],
          )
        ).opens,
      ).toBe(1);
      // A staff tenant on the transaction never opens a card, whatever its purpose.
      expect(await readWith(token.hash, { ...publicOn, 'corridra.tenant_id': f.tenantA })).toEqual(
        unknown,
      );
      // A sample session cannot use a real workspace, and the signed-in switch closes a real session.
      await expect(preview('alice', s, s.decisionId)).rejects.toMatchObject({ code: '42501' });
      expect((await state('alice', s.resourceId)).canShare).toBe(false);
      await expect(
        previewReal(s, { 'corridra.real_report_signed_in': 'off' }),
      ).rejects.toMatchObject({ code: '42501' });
      // The stored card is as immutable for a real workspace as for a sample one.
      await expect(
        f.owner.query('UPDATE customer_private.decision_card SET field_digest=$2 WHERE id=$1', [
          card.cardId,
          p.digest,
        ]),
      ).rejects.toThrow();
      await expect(
        f.owner.query('DELETE FROM customer_private.decision_card WHERE id=$1', [card.cardId]),
      ).rejects.toThrow();
    });
    // Back in the sample world the same card is a sample card again and says so.
    const sample = await read(hash);
    expect(sample.state).toBe('OPEN');
    expect(sample.synthetic).toBe(true);
  });

  test('a real card ends when its creator is demoted, comes back when they are promoted, and a session on the transaction never uses the public rule', async () => {
    const s = await build('bob', workspaceId);
    const card = await share('bob', s);
    try {
      await real({ publisher: true, workspace: true }, async () => {
        expect((await readWith(card.hash, publicOn)).state).toBe('OPEN');
        // The role read without a session agrees with the shared role function for the same people.
        const writer = async (person: Person) =>
          (
            await one('SELECT customer_private.decision_card_public_writer($1,$2) AS ok', [
              workspaceId,
              principals[person],
            ])
          ).ok;
        expect([
          await writer('alice'),
          await writer('bob'),
          await writer('carol'),
          await writer('dave'),
        ]).toEqual([true, true, false, false]);
        // A customer proof on the transaction, even with the public setting, is held to the session rule.
        expect(
          await readWith(card.hash, {
            ...publicOn,
            'corridra.customer_proof_hash': hex('no-such-session'),
          }),
        ).toEqual(unknown);
        await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=true WHERE id=ANY($1)', [
          [f.tenantA, workspaceId],
        ]);
        await setRole('bob', 'member', 'admin');
        await mutate('app.tenant', 'UPDATE app.tenant SET synthetic=false WHERE id=ANY($1)', [
          [f.tenantA, workspaceId],
        ]);
        expect(await writer('bob')).toBe(false);
        expect(await readWith(card.hash, publicOn)).toEqual(unknown);
      });
    } finally {
      await setRole('bob', 'admin', 'member').catch(() => undefined);
    }
    await real({ publisher: true, workspace: true }, async () => {
      expect((await readWith(card.hash, publicOn)).state).toBe('OPEN');
    });
  });

  // The removed member suites keep file 0003 away from their ladder (tests/integration/removed-member-hide.ts), so the
  // real card path is proven here for the two people those suites are about.
  test('a creator removed from a real workspace, and a person who was never a member, get nothing in public or signed in while the public link setting is on and real use is open for both sides', async () => {
    const both = { publisher: true, workspace: true };
    const writer = async (person: Person) =>
      (
        await one('SELECT customer_private.decision_card_public_writer($1,$2) AS ok', [
          workspaceId,
          principals[person],
        ])
      ).ok;
    const stateSql = 'SELECT customer.decision_card_state($1) AS result';
    const previewSql = 'SELECT customer.decision_card_preview($1,$2) AS result';
    const createSql = 'SELECT customer.create_decision_card($1,$2,$3,$4,$5,$6) AS result';
    // erin leaves in an earlier case. She is brought back as an admin so that this case stands alone.
    if (!(await writer('erin'))) {
      await join('erin');
      await setRole('erin', 'admin', 'member');
    }
    const s = await build('erin', workspaceId);
    const card = await share('erin', s);
    // dave was never a member of this workspace. He holds the same report by its link, nothing more.
    const held = await holdLink('dave', s);
    let digest = '';
    await real(both, async () => {
      // Control: while erin is an admin the card opens and she can share.
      expect((await readWith(card.hash, publicOn)).state).toBe('OPEN');
      expect((await asReal('erin', stateSql, [s.resourceId])).canShare).toBe(true);
      digest = (await asReal('erin', previewSql, [s.resourceId, s.decisionId])).digest;
      expect(await writer('dave')).toBe(false);
      for (const resource of [held, s.resourceId]) {
        await expect(asReal('dave', previewSql, [resource, s.decisionId])).rejects.toMatchObject({
          code: '42501',
        });
        await expect(
          asReal('dave', createSql, [
            randomUUID(),
            resource,
            s.decisionId,
            digest,
            newToken().hash,
            null,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
      }
      expect(await asReal('dave', stateSql, [held])).toMatchObject({ canShare: false, cards: [] });
      await expect(asReal('dave', stateSql, [s.resourceId])).rejects.toMatchObject({
        code: '42501',
      });
    });
    // The removal is made in the sample world, as the role change in the case above is.
    await workspaces('alice').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId,
      kind: 'membership',
      targetId: members.erin!,
    });
    const made = await count('customer_private.decision_card');
    await real(both, async () => {
      expect(await writer('erin')).toBe(false);
      expect(await readWith(card.hash, publicOn)).toEqual(unknown);
      expect(await read(card.hash)).toEqual(unknown);
      await expect(asReal('erin', previewSql, [s.resourceId, s.decisionId])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        asReal('erin', createSql, [
          randomUUID(),
          s.resourceId,
          s.decisionId,
          digest,
          newToken().hash,
          null,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      // A removed person's real session no longer reaches the report at all, so the state is refused outright.
      await expect(asReal('erin', stateSql, [s.resourceId])).rejects.toMatchObject({
        code: '42501',
      });
    });
    expect(await count('customer_private.decision_card')).toBe(made);
    // Back in the sample world the card stays closed too: its creator is gone.
    expect(await read(card.hash)).toEqual(unknown);
  });

  test('never a mix: one real side and one sample side is refused, signed in and in public', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    for (const sides of [
      { publisher: true, workspace: false },
      { publisher: false, workspace: true },
    ])
      await real(sides, async () => {
        await expect(previewReal(s)).rejects.toMatchObject({ code: '42501' });
        await expect(preview('alice', s, s.decisionId)).rejects.toMatchObject({ code: '42501' });
        expect(await readWith(card.hash, publicOn)).toEqual(unknown);
        expect(await read(card.hash)).toEqual(unknown);
      });
    expect((await read(card.hash)).state).toBe('OPEN');
  });

  test('real use closed: both sides real but the real-use configuration is off, so nothing answers', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    await real({ publisher: true, workspace: true, open: false }, async () => {
      await expect(previewReal(s)).rejects.toMatchObject({ code: '42501' });
      expect(await readWith(card.hash, publicOn)).toEqual(unknown);
    });
  });

  test('the new helpers are private: no application role may run them, and the replaced functions keep their grants', async () => {
    const granted = async (role: string, fn: string) =>
      (await one('SELECT has_function_privilege($1,$2,$3) AS ok', [role, fn, 'EXECUTE'])).ok;
    for (const role of ['corridra_runtime', 'corridra_auth'])
      for (const helper of [
        'customer_private.decision_card_real_allowed(uuid,uuid,uuid)',
        'customer_private.decision_card_public_writer(uuid,uuid)',
      ])
        expect(await granted(role, helper)).toBe(false);
    expect(
      await granted('corridra_runtime', 'customer_private.decision_card_workspace(uuid,uuid)'),
    ).toBe(false);
    expect(await granted('corridra_runtime', functions.read)).toBe(true);
    expect(await granted('corridra_auth', functions.read)).toBe(false);
    expect(
      (
        await one(
          "SELECT count(*)::int AS n FROM customer_decision_card_migrations.applied WHERE name='0003_real_workspace_decision_cards.sql'",
        )
      ).n,
    ).toBe(1);
  });
});

describe('expiry', () => {
  test('a card never lasts longer than seven days; an eight day row is rejected', async () => {
    const s = await build('alice', workspaceId, { days: 20 });
    const p = await preview('alice', s, s.decisionId);
    const card = await create('alice', s, s.decisionId, p.digest);
    const row = await one(
      'SELECT created_at,expires_at FROM customer_private.decision_card WHERE id=$1',
      [card.cardId],
    );
    const days = (row.expires_at.getTime() - row.created_at.getTime()) / 86400000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    await expect(
      f.owner.query(
        `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,now(),now()+interval '8 days')`,
        [
          principals.alice,
          randomUUID(),
          s.resourceId,
          workspaceId,
          s.decisionId,
          p.digest,
          newToken().hash,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.owner.query(
        `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,now(),now())`,
        [
          principals.alice,
          randomUUID(),
          s.resourceId,
          workspaceId,
          s.decisionId,
          p.digest,
          newToken().hash,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('the expiry is the earliest of seven days, the link expiry and every source retention', async () => {
    const s = await build('alice', workspaceId, { days: 20 });
    const retention = new Date(Date.now() + 36 * 3600000);
    retention.setMilliseconds(0);
    await mutate(
      'app.source_record',
      'UPDATE app.source_record SET retention_until=$2 WHERE id=$1',
      [s.sourceId, retention.toISOString()],
    );
    const p = await preview('alice', s, s.decisionId);
    expect(Date.parse(p.expiresAt)).toBe(retention.getTime());
    const card = await create(
      'alice',
      s,
      s.decisionId,
      p.digest,
      newToken(),
      randomUUID(),
      p.expiresAt,
    );
    expect(Date.parse(card.expiresAt)).toBe(retention.getTime());
    expect(Date.parse((await state('alice', s.resourceId)).cards[0].expiresAt)).toBe(
      retention.getTime(),
    );
    // The link ends sooner than seven days here.
    const short = await build('alice', workspaceId, { days: 2 });
    const q = await preview('alice', short, short.decisionId);
    const linkExpiry = (
      await one('SELECT expires_at FROM app.delivery_link WHERE id=$1', [short.link.id])
    ).expires_at;
    expect(Date.parse(q.expiresAt)).toBe(linkExpiry.getTime());
  });

  test('shortening a source after creation clamps the open card to the new retention date', async () => {
    const s = await build('alice', workspaceId, { days: 20 });
    const card = await share('alice', s);
    // The card itself runs for seven days, so only the live clamp on every read can end it at the new date.
    const stored = (
      await one('SELECT expires_at FROM customer_private.decision_card WHERE id=$1', [card.cardId])
    ).expires_at;
    const retention = new Date(Date.now() + 3600000);
    retention.setMilliseconds(0);
    expect(stored.getTime()).toBeGreaterThan(retention.getTime() + 24 * 3600000);
    await mutate(
      'app.source_record',
      'UPDATE app.source_record SET retention_until=$2 WHERE id=$1',
      [s.sourceId, retention.toISOString()],
    );
    const opened = await read(card.hash);
    expect(opened.state).toBe('OPEN');
    expect(Date.parse(opened.expiresAt)).toBe(retention.getTime());
    // And once that date has passed the same card is unknown.
    await mutate(
      'app.source_record',
      "UPDATE app.source_record SET observed_at=now()-interval '2 days',retention_until=now()-interval '1 minute' WHERE id=$1",
      [s.sourceId],
    );
    expect(await read(card.hash)).toEqual(unknown);
  });

  test('a preview that is out of date is the CHANGED conflict, not a longer card than was shown', async () => {
    const s = await build('alice', workspaceId, { days: 20 });
    const p = await preview('alice', s, s.decisionId);
    await mutate(
      'app.source_record',
      "UPDATE app.source_record SET retention_until=now()+interval '2 days' WHERE id=$1",
      [s.sourceId],
    );
    await expect(
      create('alice', s, s.decisionId, p.digest, newToken(), randomUUID(), p.expiresAt),
    ).rejects.toMatchObject({ code: '23514', message: 'DECISION_CARD_CHANGED' });
    await expect(
      create(
        'alice',
        s,
        s.decisionId,
        p.digest,
        newToken(),
        randomUUID(),
        new Date(Date.now() - 1000).toISOString(),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      await count('customer_private.decision_card', 'saved_mission_id=$1', [s.resourceId]),
    ).toBe(0);
  });
});

describe('withdrawal and the limit of five', () => {
  test('only the creator can see, preview or withdraw; another admin and a member are refused', async () => {
    const card = await share('alice', main);
    for (const who of ['bob', 'carol', 'dave'] as const) {
      await expect(withdraw(who, card.cardId)).rejects.toMatchObject({ code: '42501' });
      // Holding the same link gives a saved report of their own, with none of the creator's cards in it.
      const theirs = await holdLink(who, main);
      expect(JSON.stringify(await state(who, theirs))).not.toContain(card.cardId);
      await expect(state(who, main.resourceId)).rejects.toMatchObject({ code: '42501' });
      await expect(preview(who, main, main.decisionId)).rejects.toMatchObject({ code: '42501' });
    }
    expect((await read(card.hash)).state).toBe('OPEN');
    expect(
      await count('customer_private.decision_card_withdrawal', 'card_id=$1', [card.cardId]),
    ).toBe(0);
  });

  test('the creator withdraws: the card answers unknown, the counter is unchanged and a repeat is the same answer', async () => {
    const card = await share('alice', plain);
    await read(card.hash);
    const commandId = randomUUID();
    const first = await withdraw('alice', card.cardId, commandId);
    expect(first).toMatchObject({ cardId: card.cardId, state: 'WITHDRAWN' });
    expect(await read(card.hash)).toEqual(unknown);
    expect(
      Number(
        (
          await one('SELECT opens FROM customer_private.decision_card_open WHERE card_id=$1', [
            card.cardId,
          ])
        ).opens,
      ),
    ).toBe(1);
    const events = await count(
      'app.domain_event',
      "type='customer.decision_card.withdrawn' AND payload->>'cardId'=$1",
      [card.cardId],
    );
    expect(events).toBe(1);
    expect(await withdraw('alice', card.cardId, commandId)).toEqual(first);
    expect(await withdraw('alice', card.cardId)).toEqual(first);
    expect(
      await count('customer_private.decision_card_withdrawal', 'card_id=$1', [card.cardId]),
    ).toBe(1);
    expect(
      await count(
        'app.domain_event',
        "type='customer.decision_card.withdrawn' AND payload->>'cardId'=$1",
        [card.cardId],
      ),
    ).toBe(1);
    const listed = (await state('alice', plain.resourceId)).cards.find(
      (c: { id: string }) => c.id === card.cardId,
    );
    expect(listed).toMatchObject({ state: 'WITHDRAWN', opens: 1 });
  });

  test('a withdraw command cannot be reused for another card, and an unknown card is refused', async () => {
    const a = await share('alice', plain);
    const b = await share('alice', plain);
    const commandId = randomUUID();
    await withdraw('alice', a.cardId, commandId);
    await expect(withdraw('alice', b.cardId, commandId)).rejects.toMatchObject({ code: '23514' });
    await expect(withdraw('alice', randomUUID())).rejects.toMatchObject({ code: '42501' });
    expect((await read(b.hash)).state).toBe('OPEN');
  });

  test('a card that is unavailable, or whose decision is no longer listed, is still listed and can be withdrawn', async () => {
    const s = await build('alice', workspaceId, { second: true });
    const a = await share('alice', s, s.decisionId);
    await s.approve(2, [s.otherDecisionId!]);
    const cards = (await state('alice', s.resourceId)).cards;
    expect(cards.map((c: { id: string; state: string }) => [c.id, c.state])).toEqual([
      [a.cardId, 'UNAVAILABLE'],
    ]);
    expect(cards[0].decisionId).toBe(s.decisionId);
    expect((await withdraw('alice', a.cardId)).state).toBe('WITHDRAWN');
    expect((await state('alice', s.resourceId)).cards[0].state).toBe('WITHDRAWN');
  });

  test('the sixth active card is the CAP_REACHED conflict; an exact retry at five still succeeds; a withdrawal frees a place', async () => {
    const s = await build('alice', workspaceId);
    const p = await preview('alice', s, s.decisionId);
    const made: (Card & { commandId: string })[] = [];
    for (let n = 0; n < 5; n++) made.push(await create('alice', s, s.decisionId, p.digest));
    const cap = { code: '53400', message: 'DECISION_CARD_CAP_REACHED' };
    await expect(create('alice', s, s.decisionId, p.digest)).rejects.toMatchObject(cap);
    // The retry of the fifth command returns that card before the limit is looked at.
    const retry = await as(
      'alice',
      'SELECT customer.create_decision_card($1,$2,$3,$4,$5) AS result',
      [made[4]!.commandId, s.resourceId, s.decisionId, p.digest, made[4]!.hash],
    );
    expect(retry.rows[0].result).toMatchObject({ cardId: made[4]!.cardId, state: 'ACTIVE' });
    expect(
      await count('customer_private.decision_card', 'saved_mission_id=$1', [s.resourceId]),
    ).toBe(5);
    const listed = await state('alice', s.resourceId);
    expect(listed.cards).toHaveLength(5);
    await withdraw('alice', made[0]!.cardId);
    expect((await create('alice', s, s.decisionId, p.digest)).state).toBe('ACTIVE');
    await expect(create('alice', s, s.decisionId, p.digest)).rejects.toMatchObject(cap);
    // The limit belongs to the saved report: another report has its own five.
    expect((await share('alice', plain)).state).toBe('ACTIVE');
    // Concurrent creates cannot pass the limit together.
    const q = await build('alice', workspaceId);
    const d = await preview('alice', q, q.decisionId);
    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () => create('alice', q, q.decisionId, d.digest)),
    );
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(
      settled
        .filter((r) => r.status === 'rejected')
        .every((r) => (r as PromiseRejectedResult).reason.code === '53400'),
    ).toBe(true);
  });
});

describe('roles, grants and immutability', () => {
  const owned = async () =>
    (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text signature,
         has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth,
         has_function_privilege('public',p.oid,'EXECUTE') pub,p.prosecdef definer,p.proconfig::text config
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('app','customer','customer_private') AND p.proname LIKE '%decision\\_card%'`,
      )
    ).rows as {
      signature: string;
      runtime: boolean;
      auth: boolean;
      pub: boolean;
      definer: boolean;
      config: string;
    }[];

  test('the runtime role may execute the five functions and nothing else of the module; nobody else may execute any', async () => {
    const rows = await owned();
    expect(
      rows
        .filter((r) => r.runtime)
        .map((r) => r.signature)
        .sort(),
    ).toEqual(Object.values(functions).sort());
    expect(rows.filter((r) => r.auth || r.pub)).toEqual([]);
    for (const row of rows.filter((r) => r.runtime)) {
      expect(row.definer).toBe(true);
      expect(row.config).toBe('{search_path=pg_catalog}');
    }
    // Helpers the module defines are not callable by the runtime role.
    expect(rows.length).toBeGreaterThan(5);
    await expect(
      f.runtime.query('SELECT customer_private.decision_card_resolve($1,$2,$3)', [
        main.resourceId,
        main.decisionId,
        principals.alice,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.auth.query('SELECT app.read_decision_card($1)', [newToken().hash]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('no role other than the owner has any right on the new tables', async () => {
    for (const table of ['decision_card', 'decision_card_withdrawal', 'decision_card_open']) {
      for (const role of ['corridra_runtime', 'corridra_auth', 'public'])
        for (const right of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES'])
          expect(
            (
              await one(`SELECT has_table_privilege($1,'customer_private.${table}',$2) ok`, [
                role,
                right,
              ])
            ).ok,
          ).toBe(false);
      expect(
        (
          await one('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass', [
            'customer_private.' + table,
          ])
        ).relrowsecurity,
      ).toBe(true);
    }
    await expect(
      f.runtime.query('SELECT * FROM customer_private.decision_card'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.runtime.query('DELETE FROM customer_private.decision_card'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.auth.query('SELECT * FROM customer_private.decision_card_open'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('cards and withdrawals cannot be changed or deleted, and the open counter only counts up by one', async () => {
    const card = await share('alice', plain);
    await withdraw('alice', card.cardId);
    const open = await share('alice', plain);
    await read(open.hash);
    for (const sql of [
      "UPDATE customer_private.decision_card SET expires_at=expires_at+interval '1 hour' WHERE id=$1",
      'UPDATE customer_private.decision_card SET field_digest=field_digest WHERE id=$1',
      'DELETE FROM customer_private.decision_card WHERE id=$1',
    ])
      await expect(f.owner.query(sql, [card.cardId])).rejects.toMatchObject({ code: '23514' });
    for (const sql of [
      'UPDATE customer_private.decision_card_withdrawal SET created_at=now() WHERE card_id=$1',
      'DELETE FROM customer_private.decision_card_withdrawal WHERE card_id=$1',
    ])
      await expect(f.owner.query(sql, [card.cardId])).rejects.toMatchObject({ code: '23514' });
    for (const sql of [
      'UPDATE customer_private.decision_card_open SET opens=opens+2 WHERE card_id=$1',
      'UPDATE customer_private.decision_card_open SET opens=opens WHERE card_id=$1',
      'UPDATE customer_private.decision_card_open SET opens=1 WHERE card_id=$1',
      "UPDATE customer_private.decision_card_open SET opens=opens+1,first_opened_at=first_opened_at-interval '1 day' WHERE card_id=$1",
      "UPDATE customer_private.decision_card_open SET opens=opens+1,last_opened_at=last_opened_at-interval '1 day' WHERE card_id=$1",
      'DELETE FROM customer_private.decision_card_open WHERE card_id=$1',
    ])
      await expect(f.owner.query(sql, [open.cardId])).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.owner.query(
        'INSERT INTO customer_private.decision_card_open(card_id,opens,first_opened_at,last_opened_at) VALUES($1,5,now(),now())',
        [card.cardId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      Number(
        (
          await one('SELECT opens FROM customer_private.decision_card_open WHERE card_id=$1', [
            open.cardId,
          ])
        ).opens,
      ),
    ).toBe(1);
    await f.owner.query(
      'UPDATE customer_private.decision_card_open SET opens=opens+1,last_opened_at=clock_timestamp() WHERE card_id=$1',
      [open.cardId],
    );
    expect(
      Number(
        (
          await one('SELECT opens FROM customer_private.decision_card_open WHERE card_id=$1', [
            open.cardId,
          ])
        ).opens,
      ),
    ).toBe(2);
  });
});

describe('session time zone, churn and the list', () => {
  const zone = 'America/New_York';
  test('a card is at most 168 hours whatever the session time zone, and times leave as UTC text', async () => {
    const s = await build('alice', workspaceId, { days: 20 });
    const p = (
      await as(
        'alice',
        'SELECT customer.decision_card_preview($1,$2) AS result',
        [s.resourceId, s.decisionId],
        zone,
      )
    ).rows[0].result;
    const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
    expect(p.expiresAt).toMatch(utc);
    expect(p.fields.dueAt).toMatch(utc);
    const made = (
      await as(
        'alice',
        'SELECT customer.create_decision_card($1,$2,$3,$4,$5) AS result',
        [randomUUID(), s.resourceId, s.decisionId, p.digest, newToken().hash],
        zone,
      )
    ).rows[0].result;
    expect(made.expiresAt).toMatch(utc);
    const row = await one(
      "SELECT expires_at-created_at<=interval '168 hours' AS within,extract(epoch FROM expires_at-created_at)/3600 AS hours FROM customer_private.decision_card WHERE id=$1",
      [made.cardId],
    );
    expect(row.within).toBe(true);
    expect(Number(row.hours)).toBeGreaterThan(167.9);
    // 28 October to 4 November 2026 is 169 hours by the New York clock (the clocks go back on 1 November). A
    // table bound written as seven days would let a 169 hour card in under that session time zone.
    const attempt = async (expires: string) => {
      const client = await f.owner.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL TIME ZONE '${zone}'`);
        await client.query(
          `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,'2026-10-28 12:00:00-04',$8)`,
          [
            principals.alice,
            randomUUID(),
            s.resourceId,
            workspaceId,
            s.decisionId,
            p.digest,
            newToken().hash,
            expires,
          ],
        );
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };
    await expect(attempt('2026-11-04 12:00:00-05')).rejects.toMatchObject({ code: '23514' });
    await attempt('2026-11-04 11:00:00-05');
  });

  test('the thirty-first new card in an hour for one report is the RATE_LIMITED refusal; a retry, another report and another customer are not affected', async () => {
    const s = await build('alice', workspaceId);
    const p = await preview('alice', s, s.decisionId);
    let last: Awaited<ReturnType<typeof create>> | undefined;
    for (let n = 0; n < 30; n++) {
      last = await create('alice', s, s.decisionId, p.digest);
      await withdraw('alice', last.cardId);
    }
    const before = [
      await count('customer_private.decision_card'),
      await count('app.domain_event', "type='customer.decision_card.created'"),
    ];
    await expect(create('alice', s, s.decisionId, p.digest)).rejects.toMatchObject({
      code: '54000',
      message: 'DECISION_CARD_RATE_LIMITED',
    });
    expect([
      await count('customer_private.decision_card'),
      await count('app.domain_event', "type='customer.decision_card.created'"),
    ]).toEqual(before);
    // The exact retry of the last command still returns that card, before every limit.
    const retry = await as(
      'alice',
      'SELECT customer.create_decision_card($1,$2,$3,$4,$5) AS result',
      [last!.commandId, s.resourceId, s.decisionId, p.digest, last!.hash],
    );
    expect(retry.rows[0].result).toMatchObject({ cardId: last!.cardId, state: 'WITHDRAWN' });
    expect((await share('alice', plain)).state).toBe('ACTIVE');
    expect((await share('bob', adminSaved)).state).toBe('ACTIVE');
  }, 120000);

  test('live cards are always listed first and a hundred newer withdrawn cards never push them off', async () => {
    const s = await build('alice', workspaceId);
    const live = await share('alice', s);
    const p = await preview('alice', s, s.decisionId);
    const drift = newToken();
    await f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '1 day',now()+interval '1 day')`,
      [
        principals.alice,
        randomUUID(),
        s.resourceId,
        workspaceId,
        s.decisionId,
        hex('other fields'),
        drift.hash,
      ],
    );
    await f.owner.query(
      `INSERT INTO customer_private.decision_card(principal_id,command_id,saved_mission_id,workspace_id,decision_id,field_digest,token_hash,created_at,expires_at)
       SELECT $1,gen_random_uuid(),$2,$3,$4,$5,encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),
        clock_timestamp()+n*interval '1 second',clock_timestamp()+n*interval '1 second'+interval '1 hour' FROM generate_series(1,105) n`,
      [principals.alice, s.resourceId, workspaceId, s.decisionId, p.digest],
    );
    await f.owner.query(
      `INSERT INTO customer_private.decision_card_withdrawal(card_id,principal_id,command_id)
       SELECT c.id,c.principal_id,gen_random_uuid() FROM customer_private.decision_card c WHERE c.saved_mission_id=$1 AND c.id<>$2 AND c.token_hash<>$3`,
      [s.resourceId, live.cardId, drift.hash],
    );
    const cards = (await state('alice', s.resourceId)).cards as { id: string; state: string }[];
    expect(cards).toHaveLength(100);
    expect(cards.slice(0, 2).map((c) => c.state)).toEqual(['ACTIVE', 'UNAVAILABLE']);
    expect(cards[0]!.id).toBe(live.cardId);
    expect(cards.slice(2).every((c) => c.state === 'WITHDRAWN')).toBe(true);
  }, 60000);
});

describe('edges of the creator and the command', () => {
  const retry = (
    who: string,
    s: { resourceId: string },
    decision: string,
    digest: string,
    card: Card & { commandId: string },
  ) => create(who, s, decision, digest, { token: card.token, hash: card.hash }, card.commandId);

  test('a disabled customer cannot create, preview, list or withdraw, and their card answers unknown', async () => {
    const s = await build('bob', workspaceId);
    const p = await preview('bob', s, s.decisionId);
    const card = await create('bob', s, s.decisionId, p.digest);
    expect((await read(card.hash)).state).toBe('OPEN');
    await mutate(
      'customer_private.principal',
      'UPDATE customer_private.principal SET disabled_at=now() WHERE id=$1',
      [principals.bob],
    );
    try {
      await expect(preview('bob', s, s.decisionId)).rejects.toMatchObject({ code: '42501' });
      await expect(create('bob', s, s.decisionId, p.digest)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(state('bob', s.resourceId)).rejects.toMatchObject({ code: '42501' });
      await expect(withdraw('bob', card.cardId)).rejects.toMatchObject({ code: '42501' });
      expect(await read(card.hash)).toEqual(unknown);
    } finally {
      await mutate(
        'customer_private.principal',
        'UPDATE customer_private.principal SET disabled_at=NULL WHERE id=$1',
        [principals.bob],
      );
    }
    expect((await read(card.hash)).state).toBe('OPEN');
  });

  test('a hash with whitespace around it is unknown, not an error', async () => {
    const card = await share('alice', plain);
    expect((await read(card.hash)).state).toBe('OPEN');
    for (const padded of [
      card.hash + '\n',
      card.hash + ' ',
      ' ' + card.hash,
      '\t' + card.hash,
      card.hash + '\r\n',
    ])
      expect(await read(padded)).toEqual(unknown);
  });

  test('a link secret already used under another command is the plain unique violation and writes nothing', async () => {
    const s = await build('alice', workspaceId);
    const p = await preview('alice', s, s.decisionId);
    const first = await create('alice', s, s.decisionId, p.digest);
    const before = [
      await count('customer_private.decision_card'),
      await count('app.domain_event', "type='customer.decision_card.created'"),
      await count('app.outbox'),
    ];
    await expect(
      create('alice', s, s.decisionId, p.digest, { token: first.token, hash: first.hash }),
    ).rejects.toMatchObject({ code: '23505' });
    expect([
      await count('customer_private.decision_card'),
      await count('app.domain_event', "type='customer.decision_card.created'"),
      await count('app.outbox'),
    ]).toEqual(before);
  });

  test('a shown expiry beyond seven days or beyond the live expiry is the CHANGED conflict; a shorter one is kept', async () => {
    const s = await build('alice', workspaceId, { days: 20 });
    const p = await preview('alice', s, s.decisionId);
    const changed = { code: '23514', message: 'DECISION_CARD_CHANGED' };
    await expect(
      create(
        'alice',
        s,
        s.decisionId,
        p.digest,
        newToken(),
        randomUUID(),
        new Date(Date.parse(p.expiresAt) + 3600000).toISOString(),
      ),
    ).rejects.toMatchObject(changed);
    const retention = new Date(Date.now() + 36 * 3600000);
    await mutate(
      'app.source_record',
      'UPDATE app.source_record SET retention_until=$2 WHERE id=$1',
      [s.sourceId, retention.toISOString()],
    );
    await expect(
      create(
        'alice',
        s,
        s.decisionId,
        p.digest,
        newToken(),
        randomUUID(),
        new Date(Date.now() + 48 * 3600000).toISOString(),
      ),
    ).rejects.toMatchObject(changed);
    expect(
      await count('customer_private.decision_card', 'saved_mission_id=$1', [s.resourceId]),
    ).toBe(0);
    const shorter = new Date(Date.now() + 30 * 3600000);
    shorter.setMilliseconds(0);
    const card = await create(
      'alice',
      s,
      s.decisionId,
      p.digest,
      newToken(),
      randomUUID(),
      shorter.toISOString(),
    );
    expect(Date.parse(card.expiresAt)).toBe(shorter.getTime());
  });

  test('an exact retry after a withdrawal is the same card, withdrawn, and never active again', async () => {
    const s = await build('alice', workspaceId);
    const p = await preview('alice', s, s.decisionId);
    const card = await create('alice', s, s.decisionId, p.digest);
    await withdraw('alice', card.cardId);
    const again = await retry('alice', s, s.decisionId, p.digest, card);
    expect(again).toMatchObject({
      cardId: card.cardId,
      state: 'WITHDRAWN',
      expiresAt: card.expiresAt,
    });
    expect(await read(card.hash)).toEqual(unknown);
  });

  test('a demoted creator gets the same card back as unavailable on a retry, and the same link works again when they are promoted', async () => {
    const s = await build('bob', workspaceId);
    const p = await preview('bob', s, s.decisionId);
    const card = await create('bob', s, s.decisionId, p.digest);
    const opened = await read(card.hash);
    expect(opened.state).toBe('OPEN');
    await setRole('bob', 'member', 'admin');
    try {
      expect(await retry('bob', s, s.decisionId, p.digest, card)).toMatchObject({
        cardId: card.cardId,
        state: 'UNAVAILABLE',
      });
      expect(await read(card.hash)).toEqual(unknown);
    } finally {
      await setRole('bob', 'admin', 'member');
    }
    // Intended: the card is not rebuilt, so the same link revives with the same fields once the role is back.
    expect(await retry('bob', s, s.decisionId, p.digest, card)).toMatchObject({
      cardId: card.cardId,
      state: 'ACTIVE',
    });
    expect(await read(card.hash)).toMatchObject({ state: 'OPEN', card: opened.card });
  });

  test('a card checks only its own decision: another decision leaving the disclosure does not end it', async () => {
    const s = await build('alice', workspaceId, { second: true });
    const a = await share('alice', s, s.decisionId);
    const b = await share('alice', s, s.otherDecisionId!);
    await s.approve(2, [s.decisionId]);
    expect(await read(b.hash)).toEqual(unknown);
    expect((await read(a.hash)).state).toBe('OPEN');
  });

  test('the creator can still withdraw after the saved report was removed, and a repeat is the same answer', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    await as('alice', 'SELECT customer.remove_saved_mission($1,$2)', [randomUUID(), s.resourceId]);
    expect(await read(card.hash)).toEqual(unknown);
    const commandId = randomUUID();
    const first = await withdraw('alice', card.cardId, commandId);
    expect(first).toEqual({ cardId: card.cardId, state: 'WITHDRAWN' });
    expect(await withdraw('alice', card.cardId, commandId)).toEqual(first);
    expect(await withdraw('alice', card.cardId)).toEqual(first);
    expect(
      await count('customer_private.decision_card_withdrawal', 'card_id=$1', [card.cardId]),
    ).toBe(1);
    const listed = await state('alice', s.resourceId);
    expect(listed.canShare).toBe(false);
    expect(listed.cards.map((c: { state: string }) => c.state)).toEqual(['WITHDRAWN']);
  });

  test('the withdrawn event names the card, report and decision and no digest, field or link secret', async () => {
    const s = await build('alice', workspaceId);
    const p = await preview('alice', s, s.decisionId);
    const card = await create('alice', s, s.decisionId, p.digest);
    const commandId = randomUUID();
    await withdraw('alice', card.cardId, commandId);
    const events = (
      await f.owner.query(
        "SELECT id,tenant_id,payload FROM app.domain_event WHERE type='customer.decision_card.withdrawn' AND correlation_id=$1",
        [commandId],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(events[0].tenant_id).toBe(workspaceId);
    expect(events[0].payload).toMatchObject({
      cardId: card.cardId,
      resourceId: s.resourceId,
      decisionId: s.decisionId,
      initiator_id: principals.alice,
    });
    const serialized = JSON.stringify(events[0].payload);
    for (const value of [
      card.token,
      card.hash,
      p.digest,
      p.fields.rationale,
      p.fields.company,
      p.fields.nextAction,
    ])
      expect(serialized).not.toContain(value);
    expect(await count('app.audit_event', 'domain_event_id=$1', [events[0].id])).toBe(1);
    expect(await count('app.outbox', 'event_id=$1', [events[0].id])).toBe(1);
  });
});

describe('a public read that waits on the open counter', () => {
  // Concurrent reads of one card contend on its counter row. A read that was blocked there must check everything
  // again when it wakes, because the card can be withdrawn, lapse or change while it waits. The ordering is made by
  // locks, not by timing: A holds the counter row, B (the reader) is seen waiting in pg_stat_activity, the
  // disturbance commits on its own connection, and only then is A released.
  const quietly = async (sql: string, args: unknown[]) => {
    // Owner-connection test mutation with trigger enforcement off for this transaction only. ALTER TABLE ... DISABLE
    // TRIGGER cannot be used here: it would wait for the blocked reader, which waits for A.
    const client = await f.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role=replica');
      await client.query(sql, args);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const opens = async (card: string) =>
    Number(
      (
        await one(
          'SELECT coalesce(max(opens),0) n FROM customer_private.decision_card_open WHERE card_id=$1',
          [card],
        )
      ).n,
    );
  async function waitedRead(card: Card, disturb: () => Promise<unknown>) {
    await read(card.hash); // creates the counter row, so the lock below has a row to hold
    const before = await opens(card.cardId);
    const holder = await f.owner.connect();
    const reader = await f.runtime.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT 1 FROM customer_private.decision_card_open WHERE card_id=$1 FOR UPDATE',
        [card.cardId],
      );
      const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const answer = reader.query('SELECT app.read_decision_card($1) AS result', [card.hash]);
      let waiting = false;
      for (let attempt = 0; attempt < 400 && !waiting; attempt++) {
        waiting =
          (
            await f.owner.query(
              "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",
              [pid],
            )
          ).rowCount === 1;
        if (!waiting) await new Promise((resolve) => setImmediate(resolve));
      }
      expect(waiting).toBe(true);
      await disturb();
      await holder.query('COMMIT');
      return { result: (await answer).rows[0].result, before, after: await opens(card.cardId) };
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
      reader.release();
    }
  }

  test('a read nothing disturbed still opens with the six fields and counts exactly once', async () => {
    const s = await build('alice', workspaceId);
    const p = await preview('alice', s, s.decisionId);
    const card = await create('alice', s, s.decisionId, p.digest);
    const { result, before, after } = await waitedRead(card, async () => undefined);
    expect(result.state).toBe('OPEN');
    expect(result.card).toEqual(p.fields);
    expect(Object.keys(result).sort()).toEqual(['card', 'expiresAt', 'state', 'synthetic']);
    expect(after).toBe(before + 1);
  }, 60000);

  test('a card withdrawn while the read waited answers unknown and is not counted', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    const { result, before, after } = await waitedRead(card, () => withdraw('alice', card.cardId));
    expect(result).toEqual(unknown);
    expect(after).toBe(before);
  }, 60000);

  test('a card whose time ran out while the read waited answers unknown and is not counted', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    const { result, before, after } = await waitedRead(card, () =>
      quietly(
        "UPDATE customer_private.decision_card SET created_at=now()-interval '2 days',expires_at=now()-interval '1 minute' WHERE id=$1",
        [card.cardId],
      ),
    );
    expect(result).toEqual(unknown);
    expect(after).toBe(before);
  }, 60000);

  test('a decision field that changed while the read waited answers unknown and is not counted', async () => {
    const s = await build('alice', workspaceId);
    const card = await share('alice', s);
    const { result, before, after } = await waitedRead(card, () =>
      quietly(
        "UPDATE app.mission_selection SET next_action='Changed while a read waited' WHERE id=$1",
        [s.decisionId],
      ),
    );
    expect(result).toEqual(unknown);
    expect(after).toBe(before);
  }, 60000);
});

// Owner, 23 Nov 2026: "short request references (RQ-000001)". The module is installed here, after the world above has
// made its requests, so the one-time fill and the trigger for new requests are both proved on real rows.
describe('short request references', () => {
  const table = 'customer_private.request_reference';
  const refs = async (who: string, ids: string[]) =>
    (await as(who, 'SELECT customer.request_references($1::uuid[]) AS result', [ids])).rows[0]
      .result as Record<string, string>;
  let before: { id: string; created_at: Date }[];
  beforeAll(async () => {
    before = (
      await f.owner.query(
        'SELECT id,created_at FROM customer_private.owned_request ORDER BY created_at,id',
      )
    ).rows;
    expect(before.length).toBeGreaterThan(3);
    expect(
      (await one("SELECT to_regclass('customer_private.request_reference') AS t")).t,
    ).toBeNull();
    await migrateCustomerRequestReferences(f.owner);
  }, 120000);

  test('every request that already existed got one reference, oldest first, and no request row was touched', async () => {
    const rows = (
      await f.owner.query(
        `SELECT x.request_id,x.number::int AS number,x.reference FROM ${table} x ORDER BY x.number`,
      )
    ).rows;
    expect(rows.map((row) => row.request_id)).toEqual(before.map((row) => row.id));
    expect(rows.map((row) => row.number)).toEqual(before.map((_, index) => index + 1));
    expect(rows[0].reference).toBe('RQ-000001');
    for (const row of rows) expect(row.reference).toBe('RQ-' + String(row.number).padStart(6, '0'));
    const after = (
      await f.owner.query(
        'SELECT id,created_at FROM customer_private.owned_request ORDER BY created_at,id',
      )
    ).rows;
    expect(after).toEqual(before);
    expect(
      (
        await one(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='customer_private' AND table_name='owned_request' AND column_name IN ('number','reference')",
        )
      ).n,
    ).toBe(0);
  });

  test('a new request gets the next reference in the same transaction, and it never changes', async () => {
    const last = (await one(`SELECT max(number)::int AS n FROM ${table}`)).n;
    const s = await build('alice', workspaceId);
    const row = await one(
      `SELECT number::int AS number,reference FROM ${table} WHERE request_id=$1`,
      [s.requestId],
    );
    expect(row.number).toBe(last + 1);
    expect(row.reference).toBe('RQ-' + String(last + 1).padStart(6, '0'));
    // A request made in a transaction that rolls back leaves no reference behind. A mission carries one request at
    // most, so the ghost request gets a mission of its own: a copy of this one under a new id, made with the mission
    // table's guards off for that statement, all inside the transaction that is rolled back.
    const db = await f.owner.connect();
    const ghost = randomUUID();
    const ghostMission = randomUUID();
    let inside = -1;
    try {
      await db.query('BEGIN');
      await db.query('ALTER TABLE app.mission DISABLE TRIGGER USER');
      await db.query(
        `INSERT INTO app.mission SELECT (jsonb_populate_record(m,jsonb_build_object('id',$1::uuid))).*
         FROM app.mission m JOIN customer_private.owned_request r ON r.mission_tenant_id=m.tenant_id AND r.mission_id=m.id
         WHERE r.id=$2`,
        [ghostMission, s.requestId],
      );
      await db.query('ALTER TABLE app.mission ENABLE TRIGGER USER');
      const made = await db.query(
        `INSERT INTO customer_private.owned_request(id,principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
         SELECT $1,principal_id,gen_random_uuid(),workspace_id,mission_tenant_id,$3,gen_random_uuid(),brief_digest,receipt_hash
         FROM customer_private.owned_request WHERE id=$2`,
        [ghost, s.requestId, ghostMission],
      );
      expect(made.rowCount).toBe(1);
      inside = (
        await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE request_id=$1`, [ghost])
      ).rows[0].n;
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(inside).toBe(1);
    expect(await count(table, 'request_id=$1', [ghost])).toBe(0);
    await expect(
      f.owner.query(`UPDATE ${table} SET created_at=now() WHERE request_id=$1`, [s.requestId]),
    ).rejects.toThrow();
    await expect(
      f.owner.query(`DELETE FROM ${table} WHERE request_id=$1`, [s.requestId]),
    ).rejects.toThrow();
    await expect(
      f.owner.query(`UPDATE ${table} SET reference='RQ-999999' WHERE request_id=$1`, [s.requestId]),
    ).rejects.toThrow();
    expect(
      (await one(`SELECT reference FROM ${table} WHERE request_id=$1`, [s.requestId])).reference,
    ).toBe(row.reference);
  });

  test('a number past 999999 keeps every digit, so the reference stays unique', async () => {
    const text = (
      await one(
        "SELECT pg_get_expr(d.adbin,d.adrelid) AS e FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='customer_private.request_reference'::regclass AND a.attname='reference'",
      )
    ).e as string;
    const made = await one(
      `SELECT ${text.replaceAll('number', 'n')} AS reference FROM (VALUES(1000000::bigint)) v(n)`,
    );
    expect(made.reference).toBe('RQ-1000000');
  });

  test('a customer reads the references of their own requests only; unknown, another person and revoked are simply absent', async () => {
    const mine = await build('alice', workspaceId);
    const theirs = await build('bob', workspaceId);
    const revoked = await build('alice', workspaceId);
    await f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Synthetic request revocation')",
      [revoked.requestId],
    );
    const ids = [mine.requestId, theirs.requestId, revoked.requestId, randomUUID()];
    const found = await refs('alice', ids);
    expect(Object.keys(found)).toEqual([mine.requestId]);
    expect(found[mine.requestId]).toMatch(/^RQ-\d{6}$/);
    expect(Object.keys(await refs('bob', ids))).toEqual([theirs.requestId]);
    expect(await refs('dave', ids)).toEqual({});
    expect(await refs('alice', [])).toEqual({});
    await expect(
      f.runtime.query('SELECT customer.request_references($1::uuid[]) AS result', [ids]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      refs(
        'alice',
        Array.from({ length: 101 }, () => randomUUID()),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('a person removed from the workspace no longer reads the reference of a request they wrote there', async () => {
    const s = await build('carol', workspaceId);
    expect(Object.keys(await refs('carol', [s.requestId]))).toEqual([s.requestId]);
    await workspaces('alice').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId,
      kind: 'membership',
      targetId: members.carol!,
    });
    expect(await refs('carol', [s.requestId])).toEqual({});
  });

  test('the table is closed to every application role, row security is on, and only the read function is granted', async () => {
    for (const role of ['corridra_runtime', 'corridra_auth'])
      for (const right of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
        expect(
          (await one('SELECT has_table_privilege($1,$2,$3) AS ok', [role, table, right])).ok,
        ).toBe(false);
    await expect(f.runtime.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({
      code: '42501',
    });
    expect(
      (await one('SELECT relrowsecurity AS on FROM pg_class WHERE oid=$1::regclass', [table])).on,
    ).toBe(true);
    const granted = async (role: string, fn: string) =>
      (await one('SELECT has_function_privilege($1,$2,$3) AS ok', [role, fn, 'EXECUTE'])).ok;
    expect(await granted('corridra_runtime', 'customer.request_references(uuid[])')).toBe(true);
    expect(await granted('corridra_auth', 'customer.request_references(uuid[])')).toBe(false);
    expect(await granted('corridra_runtime', 'customer_private.assign_request_reference()')).toBe(
      false,
    );
    expect(
      (await one('SELECT count(*)::int AS n FROM customer_request_reference_migrations.applied')).n,
    ).toBe(1);
  });

  test('the request list carries the reference as an API field for each request it already shows', async () => {
    const s = await build('alice', workspaceId);
    const page = (await new CustomerRequestService(f.runtime, f.auth, options, async () =>
      session('alice'),
    ).list({ pageSize: 100 })) as { requests: { id: string; reference?: string }[] };
    expect(page.requests.length).toBeGreaterThan(0);
    const stored = (await f.owner.query(`SELECT request_id,reference FROM ${table}`)).rows;
    for (const item of page.requests)
      expect(item.reference).toBe(stored.find((row) => row.request_id === item.id)?.reference);
    expect(page.requests.some((item) => item.id === s.requestId)).toBe(true);
  });
});
