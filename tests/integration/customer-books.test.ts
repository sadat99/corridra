import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { bookLines, bookPdf } from '../../packages/delivery/src/report';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';
import { CustomerBookService, customerBooksEnabled } from '../../packages/auth/src/customer-books';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { bookProjection, bookResult, type BookRecord } from '../../packages/domain/src/books';
import { orderTrip } from '../../apps/web/lib/trip';

// ADR-076 items 1 to 3, proved in the real database as the restricted runtime role. One reviewed
// mission is seeded with the data a book must never carry (a quotation price, a private contact and
// note, evidence, meeting participants, an unreviewed company, secret markers). Every case calls
// customer.saved_mission_book exactly as the service will, through a fresh customer session.
const issuer = 'https://ep-books-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const reason = 'Synthetic Trip Book and Supplier Book acceptance';
const markers = {
  brief: 'MARKER-BRIEF-9f3a',
  nextAction: 'MARKER-NEXT-4c1d',
  quotation: 'MARKER-QUOTE-77b2',
  price: '987654321',
  evidence: 'MARKER-EVIDENCE-2e8f',
  request: 'MARKER-REQUEST-5a60',
  oldRoom: 'OLD-LUNCH-ROOM',
  oldReschedule: 'OLD-RESCHEDULE-ROOM',
  participant: 'Synthetic Seller',
  note: 'Private negotiation details never shown to buyer',
};
const session = (who: string) => ({
  subject: 'synthetic-books-' + who,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
class BookCaller extends CustomerSessionBoundary {
  book(resource: string, kind: string, commandId: string, acknowledged: boolean | null = true) {
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.saved_mission_book($1,$2,$3,$4) AS result', [
            resource,
            kind,
            commandId,
            acknowledged,
          ])
        ).rows[0].result,
    );
  }
}
let f: Awaited<ReturnType<typeof commercialFixture>>;
let delivery: DeliveryService;
let resourceId: string, publicationId: string, linkId: string, emptyResourceId: string;
let sourceId: string;
let secondCompanyId: string;
let unreviewedCompany: string;
const caller = (who = 'alice') =>
  new BookCaller(f.runtime, f.auth, options, async () => session(who));
const saved = (who = 'alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(who));
const asRecord = (value: unknown) => {
  const parsed = bookResult.parse(value);
  if ('state' in parsed) throw new Error('A book was expected');
  return parsed as BookRecord;
};
// Mutations the product never makes (an expired link, a lapsed source, a rewritten meeting) are made
// as the owner with the table's guard triggers off for that one statement, then put back.
async function owner(table: string, sql: string, params: unknown[] = []) {
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await client.query(sql, params);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const share = (publication: string, expiresAt = future(2)) =>
  delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic Trip Book and Supplier Book acceptance',
    expiresAt,
    allowExport: false,
    approved: true,
  });
const save = async (token: string, who = 'alice') =>
  (
    await saved(who).command({
      action: 'save',
      commandId: randomUUID(),
      token,
      acknowledged: true,
    })
  ).id as string;
const rows = async (resource: string) =>
  (
    await f.owner.query(
      "SELECT command_id,input,resource_id FROM customer_private.saved_mission_command WHERE input->>'action'='book' AND resource_id=$1 ORDER BY created_at,command_id",
      [resource],
    )
  ).rows;
const events = async (resource: string) =>
  (
    await f.owner.query(
      `SELECT payload FROM app.domain_event WHERE type='delivery.book.generated'
       AND aggregate_id IN (SELECT command_id::text FROM customer_private.saved_mission_command WHERE resource_id=$1)`,
      [resource],
    )
  ).rows;
const eventCount = async () =>
  (
    await f.owner.query(
      "SELECT count(*)::int n FROM app.domain_event WHERE type='delivery.book.generated'",
    )
  ).rows[0].n as number;
const bookCount = async () =>
  (
    await f.owner.query(
      "SELECT count(*)::int n FROM customer_private.saved_mission_command WHERE input->>'action'='book'",
    )
  ).rows[0].n as number;
const digestOf = async (projection: unknown) =>
  (
    await f.owner.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') digest", [
      JSON.stringify(projection),
    ])
  ).rows[0].digest as string;

beforeAll(async () => {
  f = await commercialFixture();
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-books-fixture');
  const routes = new CorridorService(f.runtime);
  const commercial = new CommercialMissionService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  await migrateCustomerBooks(f.owner);
  for (const who of ['alice', 'bob', 'carol'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(who).subject,
      executorId: f.serviceId,
      reason: 'Fictional customer book fixture, never real provider data',
    });
  // One mission, two reviewed companies and a third that is never reviewed.
  const t = await f.target('ES');
  const second = await f.target('ES');
  const third = await f.target('ES');
  const addTarget = async (other: typeof second, rationale: string) =>
    (
      await f.research.command(
        f.ctx,
        command('target', {
          missionId: t.missionId,
          relationshipId: other.relationshipId,
          contactId: other.contactId,
          claimIds: [other.claimId],
          fit: 'POSSIBLE',
          rationale,
          uncertainty: 'No independent verification is asserted',
          gaps: 'Review the actual commercial discussion',
          nextAction: 'Arrange a controlled discussion',
          dueAt: future(),
        }),
      )
    ).id as string;
  const secondTarget = await addTarget(second, 'Source-reported fit with the second company');
  const thirdTarget = await addTarget(third, 'Not reviewed by the customer report');
  secondCompanyId = (
    await f.owner.query(
      'SELECT r.organisation_id id FROM app.target_account a JOIN app.relationship r ON r.tenant_id=a.tenant_id AND r.id=a.relationship_id WHERE a.id=$1',
      [secondTarget],
    )
  ).rows[0].id;
  unreviewedCompany = (
    await f.owner.query(
      'SELECT o.name FROM app.target_account a JOIN app.relationship r ON r.tenant_id=a.tenant_id AND r.id=a.relationship_id JOIN app.organisation o ON o.id=r.organisation_id WHERE a.id=$1',
      [thirdTarget],
    )
  ).rows[0].name;
  await f.research.command(
    f.ctx,
    command('assess', {
      targetId: t.targetId,
      version: 1,
      fit: 'STRONG',
      rationale: 'Review supports discussion only, no certification',
      uncertainty: 'Capacity is not verified',
      gaps: 'Need documentation and actual evidence',
      nextAction: 'Arrange a controlled discussion',
      dueAt: future(),
      claimIds: [t.claimId],
    }),
  );
  const held = await f.held(undefined, t);
  // The journey of a sourcing request: route, pack, assignment, requirement, quotation.
  const catalogue = await routes.catalogue(f.users.owner.ctx);
  const definition = catalogue.requirements.find((r) => r.schema.typeKey === 'sourcing')!;
  const assessmentDefinition = catalogue.assessments.find((r) => r.schema.typeKey === 'sourcing')!;
  const type = catalogue.types.find((r) => r.key === 'sourcing')!;
  let route = (
    await f.owner.query(
      "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='ES'",
      [f.tenantA],
    )
  ).rows[0];
  if (!route) {
    route = { id: randomUUID() };
    await routes.createRoute(f.users.owner.ctx, {
      ...route,
      origin: 'BD',
      destination: 'ES',
      reason,
    });
  }
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
      ...initialRouteConfiguration(initialRoutes[0]),
      missionTypes: ['sourcing'],
      currencies: ['CNY'],
      requirements: [definition.id],
      assessments: [assessmentDefinition.id],
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
  sourceId = (
    await f.evidence.createSource(f.ctx, {
      kind: 'observation',
      locator: 'Synthetic evidence ' + markers.evidence,
      observedAt: new Date().toISOString(),
      classification: 'INTERNAL',
      purpose: 'synthetic_validation',
      retentionUntil: future(7),
      aiPolicy: 'DENY',
    })
  ).id;
  const claimId = (
    await f.evidence.createClaim(f.ctx, {
      sourceId,
      statement: 'Declared synthetic requirement, no independent verification',
    })
  ).id;
  const base = { missionId: t.missionId, sourceId, claimId, reason };
  const requirement = await commercial.command(
    f.ctx,
    command('requirements', {
      ...base,
      assignmentId,
      definitionId: definition.id,
      version: 1,
      schemaVersion: 1,
      declaration: 'Original synthetic customer request ' + markers.brief,
      fields: {
        objective: 'Find suitable machinery components',
        role: 'IMPORTER',
        product: 'Synthetic machinery components',
        quantity: '100',
        unit: 'pieces',
      },
    }),
  );
  const rfq = await commercial.command(
    f.ctx,
    command('rfq', {
      ...base,
      requirementId: requirement.id,
      targetIds: [t.targetId],
      buyerContext: 'Shareable invented buying context',
      requestedTerms: 'Original unit price, quantity and delivery conditions',
      dueAt: future(),
    }),
  );
  const quotation = await commercial.command(
    f.ctx,
    command('quotation', {
      ...base,
      rfqId: rfq.id,
      targetId: t.targetId,
      revision: 1,
      observedAt: new Date().toISOString(),
      currency: 'CNY',
      terms: { unitPriceMinor: markers.price },
      uncertainties: 'Quantity and logistics remain unconfirmed ' + markers.quotation,
    }),
  );
  // The reviewed itinerary: the held meeting plus rows made directly so the order, a tie, an undated
  // meeting, a changed schedule and RESCHEDULE_REQUIRED are all present. The labels are unique.
  const messageId = (
    await f.owner.query('SELECT message_id FROM app.meeting WHERE id=$1', [held.meetingId])
  ).rows[0].message_id;
  const meetingRow = {
    early: randomUUID(),
    tie: randomUUID(),
    late: randomUUID(),
    undated: randomUUID(),
    moved: randomUUID(),
    reschedule: randomUUID(),
  };
  const insert = (
    id: string,
    title: string,
    status: string,
    version: number,
    startsAt: string | null,
    timezone: string | null,
    location: string | null,
  ) =>
    owner(
      'app.meeting',
      `INSERT INTO app.meeting(id,tenant_id,mission_id,title,status,version,owner_id,next_action,due_at,reason,created_by,message_id,starts_at,ends_at,timezone,local_start,local_end,location)
       SELECT $1,tenant_id,mission_id,$2,$3,$4,owner_id,next_action,due_at,reason,created_by,message_id,$5::timestamptz,
       CASE WHEN $5::text IS NULL THEN NULL ELSE $5::timestamptz+interval '1 hour' END,$6,
       CASE WHEN $5::text IS NULL THEN NULL ELSE '2030-03-09T10:00' END,CASE WHEN $5::text IS NULL THEN NULL ELSE '2030-03-09T11:00' END,$7
       FROM app.meeting WHERE message_id=$8 AND status='HELD'`,
      [id, title, status, version, startsAt, timezone, location, messageId],
    );
  await insert(
    meetingRow.early,
    'Early visit',
    'SCHEDULED',
    3,
    '2030-03-09T04:00:00Z',
    'Europe/Madrid',
    'Madrid showroom',
  );
  await insert(
    meetingRow.tie,
    'Tie visit',
    'ACCEPTED',
    2,
    '2030-03-09T04:00:00Z',
    'Europe/Madrid',
    'Madrid warehouse',
  );
  await insert(
    meetingRow.late,
    'Late visit',
    'SCHEDULED',
    3,
    '2030-03-10T04:00:00Z',
    'Asia/Dhaka',
    'Dhaka factory',
  );
  await insert(meetingRow.undated, 'Undated call', 'PROPOSED', 1, null, null, null);
  await insert(
    meetingRow.moved,
    'Moved lunch',
    'SCHEDULED',
    2,
    '2030-03-08T04:00:00Z',
    'Europe/Madrid',
    markers.oldRoom,
  );
  await insert(
    meetingRow.reschedule,
    'Needs new time',
    'RESCHEDULE_REQUIRED',
    5,
    '2030-03-07T04:00:00Z',
    'Europe/Madrid',
    markers.oldReschedule,
  );
  const meetings = (
    await f.owner.query(
      'SELECT id,version,title FROM app.meeting WHERE mission_id=$1 ORDER BY title',
      [t.missionId],
    )
  ).rows.map((m) => ({
    id: m.id,
    version: m.version,
    label: m.title === 'Synthetic commercial meeting' ? 'Held conversation' : m.title,
  }));
  publicationId = (
    await delivery.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      missionId: t.missionId,
      title: 'Approved synthetic Trip and Supplier review',
      company: 'Fictional requesting company',
      objective: 'Review the approved itinerary and shortlist',
      brief: 'Approved summary without private supplier contacts ' + markers.brief,
      nextAction: 'Review the book ' + markers.nextAction,
      dueAt: future(),
      meetings,
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  await f.owner.query('SELECT 1');
  await new DeliveryExperienceService(f.runtime).publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId,
    requirementId: requirement.id,
    targetIds: [t.targetId, secondTarget],
    quotationIds: [quotation.id],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  await owner('app.meeting', 'UPDATE app.meeting SET version=3 WHERE id=$1', [meetingRow.moved]);
  const link = await share(publicationId);
  linkId = link.id;
  resourceId = await save(link.token);
  // A second mission with nothing reviewed, for the empty-book case.
  const empty = await f.target('ES');
  const emptyPublication = (
    await delivery.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      missionId: empty.missionId,
      title: 'Approved synthetic mission with nothing reviewed',
      company: 'Fictional requesting company',
      objective: 'A mission with no itinerary and no shortlist',
      brief: 'Approved summary without any reviewed meeting or company',
      nextAction: 'Wait for the review',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  emptyResourceId = await save((await share(emptyPublication)).token);
});
afterAll(async () => {
  await f?.close();
});

describe('what a book carries', () => {
  test('the Trip Book has exactly the allowed fields, in the order the Trip view shows', async () => {
    const book = asRecord(await caller().book(resourceId, 'TRIP', randomUUID()));
    expect(book.replayed).toBe(false);
    expect(book.projection.kind).toBe('TRIP');
    const projection = book.projection as Extract<BookRecord['projection'], { kind: 'TRIP' }>;
    expect(Object.keys(projection).sort()).toEqual(
      ['company', 'itinerary', 'kind', 'objective', 'reviewedAt', 'schemaVersion', 'title'].sort(),
    );
    expect(projection).toMatchObject({
      title: 'Approved synthetic Trip and Supplier review',
      company: 'Fictional requesting company',
      objective: 'Review the approved itinerary and shortlist',
    });
    const allowed = new Set([
      'label',
      'status',
      'changed',
      'startsAt',
      'endsAt',
      'timezone',
      'location',
    ]);
    for (const item of projection.itinerary)
      for (const key of Object.keys(item)) expect(allowed.has(key)).toBe(true);
    // The Trip view sorts the report itinerary with orderTrip; the file, the page and the digest agree.
    const report = (
      await saved().command({ action: 'view', resourceId, audience: 'CLIENT_PROGRESS' })
    ).report.missions[0];
    expect(projection.itinerary.map((item) => item.label)).toEqual(
      orderTrip(report.itinerary).map((item) => item.label),
    );
    const labels = projection.itinerary.map((item) => item.label);
    expect(labels).toHaveLength(7);
    expect(labels[0]).toBe('Held conversation');
    expect(labels.slice(1, 3).sort()).toEqual(['Early visit', 'Tie visit']);
    expect(labels.slice(3)).toEqual([
      'Late visit',
      'Undated call',
      'Needs new time',
      'Moved lunch',
    ]);
    expect(await digestOf(projection)).toBe(book.digest);
    expect(book.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
  test('the Supplier Book carries only the reviewed shortlist fields, sorted, with no target id', async () => {
    const book = asRecord(await caller().book(resourceId, 'SUPPLIER', randomUUID()));
    const projection = book.projection as Extract<BookRecord['projection'], { kind: 'SUPPLIER' }>;
    expect(Object.keys(projection).sort()).toEqual(
      ['kind', 'reviewedAt', 'schemaVersion', 'shortlist', 'title'].sort(),
    );
    expect(projection.title).toBe('Approved synthetic Trip and Supplier review');
    expect(projection.shortlist).toHaveLength(2);
    for (const item of projection.shortlist) {
      expect(Object.keys(item).sort()).toEqual(
        ['company', 'country', 'fit', 'gaps', 'rationale', 'uncertainty', 'verification'].sort(),
      );
      expect(item.verification).toBe('Source-reported; no independent verification asserted');
    }
    const report = (
      await saved().command({ action: 'view', resourceId, audience: 'CLIENT_PROGRESS' })
    ).report.missions[0];
    const ordered = [...report.experience.shortlist].sort((a: { id: string }, b: { id: string }) =>
      a.id < b.id ? -1 : 1,
    );
    expect(projection.shortlist.map((item) => item.company)).toEqual(
      ordered.map((item: { company: string }) => item.company),
    );
    expect(projection.shortlist.map((item) => item.fit).sort()).toEqual(['POSSIBLE', 'STRONG']);
    expect(await digestOf(projection)).toBe(book.digest);
  });
  test('nothing outside the allow-list reaches the projection, the event, the lines or the ledger', async () => {
    const trip = asRecord(await caller().book(resourceId, 'TRIP', randomUUID()));
    const supplier = asRecord(await caller().book(resourceId, 'SUPPLIER', randomUUID()));
    // The markers really are in the report the customer can read, so their absence from a book means something.
    const full = JSON.stringify(
      (await saved().command({ action: 'view', resourceId, audience: 'CLIENT_PROGRESS' })).report,
    );
    for (const value of [
      markers.brief,
      markers.nextAction,
      markers.quotation,
      markers.price,
      'Fictional requesting company',
    ])
      expect(full).toContain(value);
    const seen = [
      JSON.stringify(trip),
      JSON.stringify(supplier),
      bookLines(trip).join('\n'),
      bookLines(supplier).join('\n'),
      JSON.stringify(await events(resourceId)),
      JSON.stringify((await rows(resourceId)).map((row) => row.input)),
    ].join('\n');
    for (const value of [
      ...Object.values(markers),
      unreviewedCompany,
      'example.invalid',
      'Synthetic Buyer Person',
      'unitPriceMinor',
      'quotation',
      'nextAction',
      'dueAt',
      'brief',
    ])
      expect(seen).not.toContain(value);
    expect(bookProjection.safeParse({ ...trip.projection, price: '1' }).success).toBe(false);
  });
  test('a changed schedule and RESCHEDULE_REQUIRED show no old time, zone or place', async () => {
    const { projection } = asRecord(await caller().book(resourceId, 'TRIP', randomUUID()));
    const items = (projection as Extract<BookRecord['projection'], { kind: 'TRIP' }>).itinerary;
    for (const label of ['Moved lunch', 'Needs new time']) {
      const item = items.find((candidate) => candidate.label === label)!;
      expect(item).toEqual({
        label,
        status: item.status,
        changed: true,
      });
    }
    expect(items.find((item) => item.label === 'Needs new time')!.status).toBe(
      'RESCHEDULE_REQUIRED',
    );
    const rest = items.filter((item) => !item.changed);
    for (const item of rest) expect(item.changed).toBe(false);
    expect(items.find((item) => item.label === 'Late visit')).toMatchObject({
      startsAt: '2030-03-10T04:00:00.000000Z',
      endsAt: '2030-03-10T05:00:00.000000Z',
      timezone: 'Asia/Dhaka',
      location: 'Dhaka factory',
    });
    const undated = items.find((item) => item.label === 'Undated call')!;
    expect(Object.keys(undated).sort()).toEqual(['changed', 'label', 'status']);
  });
});

describe('who may generate a book', () => {
  test('every loss of access answers the same way and writes nothing', async () => {
    const before = await bookCount();
    const denied = async (run: () => Promise<unknown>) =>
      expect(run()).rejects.toMatchObject({ code: '42501' });
    // Another customer, an unknown mission and a mission that is not the caller's.
    await denied(() => caller('bob').book(resourceId, 'TRIP', randomUUID()));
    await denied(() => caller().book(randomUUID(), 'TRIP', randomUUID()));
    const bobResource = await save((await share(publicationId)).token, 'bob');
    await denied(() => caller().book(bobResource, 'TRIP', randomUUID()));
    // A removed saved mission.
    const removed = await save((await share(publicationId)).token);
    await saved().command({ action: 'remove', resourceId: removed, commandId: randomUUID() });
    await denied(() => caller().book(removed, 'TRIP', randomUUID()));
    // A revoked link.
    const revocable = await share(publicationId);
    const revocableResource = await save(revocable.token);
    await delivery.revoke(f.users.owner.ctx, {
      commandId: randomUUID(),
      linkId: revocable.id,
      publicationId: null,
      reason: 'Synthetic book revocation test',
    });
    await denied(() => caller().book(revocableResource, 'TRIP', randomUUID()));
    // An expired link, then access restored: the same call works again.
    const original = (
      await f.owner.query('SELECT created_at,expires_at FROM app.delivery_link WHERE id=$1', [
        linkId,
      ])
    ).rows[0];
    await owner(
      'app.delivery_link',
      "UPDATE app.delivery_link SET created_at=now()-interval '2 days',expires_at=now()-interval '1 minute' WHERE id=$1",
      [linkId],
    );
    await denied(() => caller().book(resourceId, 'TRIP', randomUUID()));
    await owner(
      'app.delivery_link',
      'UPDATE app.delivery_link SET created_at=$2,expires_at=$3 WHERE id=$1',
      [linkId, original.created_at, original.expires_at],
    );
    expect(asRecord(await caller().book(resourceId, 'TRIP', randomUUID())).kind).toBe('TRIP');
    // A source whose retention has ended.
    const lapse = (
      await f.owner.query('SELECT observed_at,retention_until FROM app.source_record WHERE id=$1', [
        sourceId,
      ])
    ).rows[0];
    await owner(
      'app.source_record',
      "UPDATE app.source_record SET observed_at=now()-interval '2 days',retention_until=now()-interval '1 minute' WHERE id=$1",
      [sourceId],
    );
    await denied(() => caller().book(resourceId, 'SUPPLIER', randomUUID()));
    await owner(
      'app.source_record',
      'UPDATE app.source_record SET observed_at=$2,retention_until=$3 WHERE id=$1',
      [sourceId, lapse.observed_at, lapse.retention_until],
    );
    expect(asRecord(await caller().book(resourceId, 'SUPPLIER', randomUUID())).kind).toBe(
      'SUPPLIER',
    );
    // A disabled customer.
    const carol = await save((await share(publicationId)).token, 'carol');
    await f.owner.query(
      'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE subject=$1',
      [session('carol').subject],
    );
    await denied(() => caller('carol').book(carol, 'TRIP', randomUUID()));
    // Only the two successful generations above wrote anything.
    expect(await bookCount()).toBe(before + 2);
  });
  test('a signed-out caller is refused before the database and writes nothing', async () => {
    const before = await bookCount();
    const signedOut = new BookCaller(f.runtime, f.auth, options, async () => null);
    await expect(signedOut.book(resourceId, 'TRIP', randomUUID())).rejects.toMatchObject({
      status: 401,
    });
    expect(await bookCount()).toBe(before);
  });
  test('the acknowledgement, the kind and the command are all required', async () => {
    const before = await bookCount();
    for (const run of [
      () => caller().book(resourceId, 'TRIP', randomUUID(), false),
      () => caller().book(resourceId, 'TRIP', randomUUID(), null),
      () => caller().book(resourceId, 'CSV', randomUUID()),
      () => caller().book(resourceId, 'TRIP', null as unknown as string),
    ])
      await expect(run()).rejects.toMatchObject({ code: '23514' });
    expect(await bookCount()).toBe(before);
  });
});

describe('an empty book and a retried download', () => {
  test('a mission with nothing reviewed gives no book, no record and no event', async () => {
    const before = await bookCount();
    for (const kind of ['TRIP', 'SUPPLIER'])
      expect(await caller().book(emptyResourceId, kind, randomUUID())).toEqual({ state: 'EMPTY' });
    expect(await bookCount()).toBe(before);
    expect(await events(emptyResourceId)).toEqual([]);
  });
  test('the same command returns the same record once: one ledger row, one event', async () => {
    const id = randomUUID();
    const a = asRecord(await caller().book(resourceId, 'TRIP', id));
    const b = asRecord(await caller().book(resourceId, 'TRIP', id));
    expect(b).toEqual({ ...a, replayed: true });
    expect(a.replayed).toBe(false);
    expect((await rows(resourceId)).filter((row) => row.command_id === id)).toHaveLength(1);
    const matching = (await events(resourceId)).filter(
      (event) => event.payload.digest === a.digest,
    );
    const stored = (await rows(resourceId)).find((row) => row.command_id === id)!;
    expect(stored.input).toMatchObject({
      action: 'book',
      kind: 'TRIP',
      resourceId,
      schemaVersion: 1,
      digest: a.digest,
      generatedAt: a.generatedAt,
    });
    expect(matching.length).toBeGreaterThan(0);
    const eventsForCommand = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='delivery.book.generated' AND aggregate_id=$1",
        [id],
      )
    ).rows;
    expect(eventsForCommand).toHaveLength(1);
    // The event names the book, its link and its publication, but not the customer's private saved-mission id.
    expect(eventsForCommand[0].payload).not.toHaveProperty('resourceId');
    expect(JSON.stringify(eventsForCommand[0].payload)).not.toContain(resourceId);
    expect(eventsForCommand[0].payload).toMatchObject({
      kind: 'TRIP',
      publicationId,
      linkId,
      digest: a.digest,
      schemaVersion: 1,
      format: 'PDF',
    });
    expect(Object.keys(eventsForCommand[0].payload)).not.toContain('projection');
  });
  test('a command is bound to its kind and resource, and a new command for unchanged content has the same digest', async () => {
    const id = randomUUID();
    const a = asRecord(await caller().book(resourceId, 'TRIP', id));
    await expect(caller().book(resourceId, 'SUPPLIER', id)).rejects.toMatchObject({
      code: '23514',
    });
    const other = await save((await share(publicationId)).token);
    await expect(caller().book(other, 'TRIP', id)).rejects.toMatchObject({ code: '23514' });
    const again = asRecord(await caller().book(resourceId, 'TRIP', randomUUID()));
    expect(again.digest).toBe(a.digest);
    expect(again.replayed).toBe(false);
    // The id of another kind of saved-mission command is not a book command either.
    const savedId = (
      await f.owner.query(
        "SELECT command_id FROM customer_private.saved_mission_command WHERE input->>'action'='save' LIMIT 1",
      )
    ).rows[0].command_id;
    await expect(caller().book(resourceId, 'TRIP', savedId)).rejects.toMatchObject({
      code: '23514',
    });
  });
  test('if the reviewed content changed, the retry is refused, nothing is written and a new command works', async () => {
    const id = randomUUID();
    const first = asRecord(await caller().book(resourceId, 'SUPPLIER', id));
    const heldId = (
      await f.owner.query(
        "SELECT id,status FROM app.meeting WHERE title='Early visit' AND mission_id=(SELECT mission_id FROM app.delivery_publication WHERE id=$1)",
        [publicationId],
      )
    ).rows[0];
    const tripId = randomUUID();
    const trip = asRecord(await caller().book(resourceId, 'TRIP', tripId));
    const before = await bookCount();
    await owner('app.meeting', "UPDATE app.meeting SET status='HELD' WHERE id=$1", [heldId.id]);
    try {
      await expect(caller().book(resourceId, 'TRIP', tripId)).rejects.toMatchObject({
        code: '23514',
      });
      expect(await bookCount()).toBe(before);
      const fresh = asRecord(await caller().book(resourceId, 'TRIP', randomUUID()));
      expect(fresh.digest).not.toBe(trip.digest);
      expect(await bookCount()).toBe(before + 1);
      // The supplier content did not change, so its retry still replays.
      expect(asRecord(await caller().book(resourceId, 'SUPPLIER', id)).digest).toBe(first.digest);
    } finally {
      await owner('app.meeting', 'UPDATE app.meeting SET status=$2 WHERE id=$1', [
        heldId.id,
        heldId.status,
      ]);
    }
    expect(asRecord(await caller().book(resourceId, 'TRIP', tripId)).digest).toBe(trip.digest);
  });
  test('a double submit at the same moment makes one record and one event', async () => {
    const id = randomUUID();
    const results = await Promise.all([
      caller().book(resourceId, 'SUPPLIER', id),
      caller().book(resourceId, 'SUPPLIER', id),
      caller().book(resourceId, 'SUPPLIER', id),
    ]);
    const records = results.map(asRecord);
    expect(new Set(records.map((record) => record.digest)).size).toBe(1);
    expect(new Set(records.map((record) => record.generatedAt)).size).toBe(1);
    expect(records.filter((record) => !record.replayed)).toHaveLength(1);
    expect((await rows(resourceId)).filter((row) => row.command_id === id)).toHaveLength(1);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM app.domain_event WHERE type='delivery.book.generated' AND aggregate_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('roles, immutability and limits', () => {
  test('only the runtime role may run it and nobody gets a table grant on the ledger', async () => {
    const grants = (
      await f.owner.query(
        `SELECT has_function_privilege('corridra_runtime','customer.saved_mission_book(uuid,text,uuid,boolean)','EXECUTE') runtime,
         has_function_privilege('corridra_auth','customer.saved_mission_book(uuid,text,uuid,boolean)','EXECUTE') auth,
         has_function_privilege('public','customer.saved_mission_book(uuid,text,uuid,boolean)','EXECUTE') pub,
         p.prosecdef definer,p.proconfig::text config FROM pg_proc p WHERE p.oid='customer.saved_mission_book(uuid,text,uuid,boolean)'::regprocedure`,
      )
    ).rows[0];
    expect(grants).toMatchObject({ runtime: true, auth: false, pub: false, definer: true });
    expect(grants.config).toContain('search_path=pg_catalog');
    for (const role of ['corridra_runtime', 'corridra_auth', 'public'])
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
        expect(
          (
            await f.owner.query('SELECT has_table_privilege($1,$2::regclass,$3) allowed', [
              role,
              'customer_private.saved_mission_command',
              privilege,
            ])
          ).rows[0].allowed,
        ).toBe(false);
    await expect(
      f.runtime.query('SELECT * FROM customer_private.saved_mission_command'),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      f.auth.query('SELECT customer.saved_mission_book($1,$2,$3,$4)', [
        resourceId,
        'TRIP',
        randomUUID(),
        true,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
  test('a generation record cannot be changed or deleted, even by the table owner', async () => {
    const id = randomUUID();
    await caller().book(resourceId, 'TRIP', id);
    await expect(
      f.owner.query(
        'UPDATE customer_private.saved_mission_command SET input=input||\'{"x":1}\' WHERE command_id=$1',
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      f.owner.query('DELETE FROM customer_private.saved_mission_command WHERE command_id=$1', [id]),
    ).rejects.toThrow();
  });
  test('the 31st new generation for one customer and mission in an hour is refused with 54000', async () => {
    const mission = await save((await share(publicationId)).token);
    for (let index = 0; index < 30; index++)
      asRecord(await caller().book(mission, index % 2 ? 'SUPPLIER' : 'TRIP', randomUUID()));
    await expect(caller().book(mission, 'TRIP', randomUUID())).rejects.toMatchObject({
      code: '54000',
    });
    expect(await rows(mission)).toHaveLength(30);
    // A replay of a recorded command is not a new generation and still answers.
    const first = (await rows(mission))[0];
    expect(
      asRecord(await caller().book(mission, first.input.kind, first.command_id)).replayed,
    ).toBe(true);
    // The cap is per mission: another mission of the same customer is unaffected.
    expect(asRecord(await caller().book(resourceId, 'TRIP', randomUUID())).kind).toBe('TRIP');
  });
  test('the link keeps its export permission off and is never changed by a book', async () => {
    const link = async () =>
      (
        await f.owner.query('SELECT to_jsonb(l) AS row FROM app.delivery_link l WHERE id=$1', [
          linkId,
        ])
      ).rows[0].row;
    const before = await link();
    await caller().book(resourceId, 'TRIP', randomUUID());
    expect(await link()).toEqual(before);
    expect(before.allow_export).toBe(false);
  });
});

describe('the service', () => {
  const on = {
    CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
    CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    DATA_ENVIRONMENT: 'synthetic',
    CORRIDRA_UX_BOOKS: 'true',
  };
  const service = (who = 'alice', over: Partial<typeof options> & { dataMode?: 'real' } = {}) =>
    new CustomerBookService(f.runtime, f.auth, { ...options, ...over }, async () => session(who));
  const render = (record: BookRecord) => bookPdf(record);
  const request = (over: Record<string, unknown> = {}) => ({
    resourceId,
    commandId: randomUUID(),
    kind: 'TRIP',
    acknowledged: true,
    ...over,
  });

  test('is on only when the books switch is exactly "true" and saved missions are on', () => {
    expect(customerBooksEnabled({})).toBe(false);
    expect(customerBooksEnabled(on)).toBe(true);
    for (const value of ['TRUE', '1', 'yes', 'false', ''])
      expect(customerBooksEnabled({ ...on, CORRIDRA_UX_BOOKS: value })).toBe(false);
    expect(customerBooksEnabled({ ...on, CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED: 'false' })).toBe(
      false,
    );
    expect(customerBooksEnabled({ ...on, CORRIDRA_DELIVERY_ENABLED: 'false' })).toBe(false);
    expect(customerBooksEnabled({ ...on, VERCEL_ENV: 'production' })).toBe(false);
  });
  test('reports the database module as installed once the installer has run', async () => {
    expect(await service().installed()).toBe(true);
  });
  test('returns a validated record, and a retry is the same record marked as a replay', async () => {
    const body = request();
    const first = await service().generate(body, render);
    expect(first.record).toMatchObject({ resourceId, kind: 'TRIP', replayed: false });
    expect(first.file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const again = await service().generate(body, render);
    expect(again.record).toEqual({ ...first.record, replayed: true });
    expect(again.file.equals(first.file)).toBe(true);
  });
  test('answers 422 for an empty book, 401 signed out and 429 past the hourly limit', async () => {
    await expect(
      service().generate(request({ resourceId: emptyResourceId }), render),
    ).rejects.toMatchObject({ status: 422, code: 'EMPTY' });
    const signedOut = new CustomerBookService(f.runtime, f.auth, options, async () => null);
    await expect(signedOut.generate(request(), render)).rejects.toMatchObject({ status: 401 });
    const mission = await save((await share(publicationId)).token);
    for (let index = 0; index < 30; index++)
      await service().generate(request({ resourceId: mission }), render);
    await expect(
      service().generate(request({ resourceId: mission }), render),
    ).rejects.toMatchObject({ status: 429 });
  });
  test('refuses input that is not exactly a book request before it reaches the database', async () => {
    const before = await bookCount();
    for (const bad of [
      request({ acknowledged: false }),
      request({ kind: 'CSV' }),
      request({ tenantId: randomUUID() }),
      {},
    ])
      await expect(service().generate(bad, render)).rejects.toThrow();
    expect(await bookCount()).toBe(before);
  });
  test('a browser that still shows another account is refused as access, never as a conflict', async () => {
    await expect(
      service().generate(request(), render, 'someone-else', issuer),
    ).rejects.toMatchObject({ status: 403 });
  });
  test('a real-data session is told plainly when shared reports are switched off, before the database', async () => {
    vi.stubEnv('CORRIDRA_REAL_REPORT_SIGNED_IN_ENABLED', 'false');
    try {
      const before = await bookCount();
      await expect(
        service('alice', { dataMode: 'real' }).generate(request(), render),
      ).rejects.toMatchObject({
        status: 503,
      });
      expect(await bookCount()).toBe(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  test('a book that cannot be made leaves no record and no event, and a retry after the text is fixed works', async () => {
    const before = { rows: await bookCount(), events: await eventCount() };
    const id = randomUUID();
    const original = (
      await f.owner.query('SELECT name FROM app.organisation WHERE id=$1', [secondCompanyId])
    ).rows[0].name;
    await owner('app.organisation', 'UPDATE app.organisation SET name=$2 WHERE id=$1', [
      secondCompanyId,
      'شركة ' + original,
    ]);
    try {
      // The database function succeeds and would record the book, but the file cannot be made: all of it rolls back.
      await expect(
        service().generate(request({ kind: 'SUPPLIER', commandId: id }), render),
      ).rejects.toMatchObject({ status: 422, code: 'UNSUPPORTED_TEXT' });
      expect({ rows: await bookCount(), events: await eventCount() }).toEqual(before);
      // The same happens for a renderer that fails any other way.
      await expect(
        service().generate(request({ commandId: id }), async () => {
          throw new Error('The renderer failed');
        }),
      ).rejects.toThrow('The renderer failed');
      expect({ rows: await bookCount(), events: await eventCount() }).toEqual(before);
    } finally {
      await owner('app.organisation', 'UPDATE app.organisation SET name=$2 WHERE id=$1', [
        secondCompanyId,
        original,
      ]);
    }
    const fixed = await service().generate(request({ kind: 'SUPPLIER', commandId: id }), render);
    expect(fixed.record.replayed).toBe(false);
    expect({ rows: await bookCount(), events: await eventCount() }).toEqual({
      rows: before.rows + 1,
      events: before.events + 1,
    });
  });
});
