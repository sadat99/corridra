import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { changeMemberNow } from './change-member';
import { rawContext } from './support';
import { bdCnSourcingProfile } from './fixtures/bd-cn-sourcing-profile';
import { AccessService } from '../../packages/auth/src/access';
import { configureSourcingWorkflow } from '../../packages/auth/src/sourcing-workflow-configuration';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateSourcingWorkflow } from '../../packages/db/src/sourcing-workflow-migrate';
import { migrateRoutePack } from '../../packages/db/src/route-pack-migrate';
import { csvRows } from '../../packages/delivery/src/import';
import { countryCodes } from '../../packages/domain/src/countries';
import {
  initialRoutes,
  routeConfiguration,
  type RouteConfiguration,
} from '../../packages/domain/src/corridors';
import {
  blankSheetRows,
  carriedConfiguration,
  contentDocumentIssues,
  coreKeysV1,
  deriveCompleteness,
  emptyContentDocument,
  goLiveCheck,
  parseContentDocument,
  reasonWithRemovedPolicies,
  routePackWords,
  sectionFromName,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
  type PackStatus,
  type StandardField,
} from '../../packages/domain/src/route-pack-standard';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService, readinessDimensions } from '../../packages/missions/src/operations';
import {
  assertPackGoLive,
  commandStepId,
  RoutePackContentService,
} from '../../packages/missions/src/route-pack-content';
import {
  createRoutePack,
  guidedRoutePack,
  publishReviewed,
  routePackConfiguration,
} from '../../packages/missions/src/route-pack-form';

// ADR-093 Phase 2b: Route Pack Standard v1, the route pack content table and the shared go-live check on every pack path.
const reason = 'Synthetic route pack content validation';
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const lastYear = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
const lockedCore: Pick<
  RouteConfiguration,
  'missionTypes' | 'languages' | 'currencies' | 'timeZones' | 'channels'
> = {
  missionTypes: ['sourcing'],
  languages: ['en'],
  currencies: ['USD'],
  timeZones: ['Etc/UTC'],
  channels: ['SYNTHETIC'],
};
const draftConfiguration = (): RouteConfiguration => initialRouteConfiguration(initialRoutes[2]);
const liveConfiguration = (extra: Partial<RouteConfiguration> = {}): RouteConfiguration => ({
  ...draftConfiguration(),
  ...lockedCore,
  ...extra,
});
function sample(field: StandardField): ContentFact['value'] {
  if (field.type === 'list') {
    if (field.allowed) return [field.allowed[0]!];
    if (field.key === 'trade.hs_focus') return ['8452'];
    if (field.key === 'supply.public_sources') return ['https://example.org/register'];
    if (field.key === 'locale.public_holidays') return ['2026-12-16 Public holiday'];
    return ['Sample item'];
  }
  if (field.type === 'link') return 'https://example.org/page';
  if (field.type === 'number') return '12';
  return 'Sample route fact';
}
const filled = (key: string, value: ContentFact['value'], extra: Partial<ContentFact> = {}) =>
  ({
    key,
    state: 'FILLED',
    value,
    source: 'staff knowledge',
    observedOn: yesterday,
    ...extra,
  }) as ContentFact;
const notApplicable = (key: string, note = 'Does not apply on this route') =>
  ({ key, state: 'NOT_APPLICABLE', note }) as ContentFact;
const contentFields = standardFieldsV1.filter((field) => field.part === 'Content');
// Every Content Core field Filled, except the keys named.
function coreDocument(except: string[] = [], extra: ContentFact[] = []): ContentDocument {
  return {
    standardVersion: 1,
    sectionMarks: [],
    facts: [
      ...contentFields
        .filter((field) => field.core && !except.includes(field.key))
        .map((field) => filled(field.key, sample(field))),
      ...extra,
    ],
  };
}
const customFact = (overrides: Partial<ContentFact> = {}) =>
  filled('custom.visit_season', 'Spring and autumn', {
    label: 'Best months for factory visits',
    section: 11,
    type: 'text',
    ...overrides,
  });
const issuesOf = (document: unknown) => contentDocumentIssues(document).map((i) => i.message);

describe('Route Pack Standard v1, domain', () => {
  test('every v1 key parses, Filled with a value of its type or Not applicable on an Optional locked row', () => {
    const document = {
      standardVersion: 1,
      sectionMarks: [],
      facts: standardFieldsV1.flatMap((field) =>
        field.part === 'Content'
          ? [filled(field.key, sample(field))]
          : field.core
            ? []
            : [notApplicable(field.key)],
      ),
    };
    expect(issuesOf(document)).toEqual([]);
    expect(document.facts).toHaveLength(71 - 5);
    expect(parseContentDocument(document).facts.map((f) => f.key)).toEqual(
      standardFieldsV1.filter((f) => !(f.part === 'Locked' && f.core)).map((f) => f.key),
    );
  });

  test('the CSV field dictionary and the registry list the same fields in the same order', () => {
    const [header, ...rows] = csvRows(
      readFileSync('docs/adr/0093/route-pack-standard-v1-fields.csv', 'utf8'),
      500,
      'route pack',
    );
    const column = (name: string) => header!.cells.indexOf(name);
    const pick = (cells: string[]) =>
      ['section_no', 'field_key', 'label', 'part', 'core', 'type', 'format', 'help'].map(
        (name) => cells[column(name)],
      );
    expect(rows.map((row) => pick(row.cells))).toEqual(
      standardFieldsV1.map((field) => [
        String(field.section),
        field.key,
        field.label,
        field.part,
        field.core ? 'Core' : 'Optional',
        field.type,
        field.format,
        field.help,
      ]),
    );
    expect(standardFieldsV1).toHaveLength(71);
    expect(coreKeysV1).toHaveLength(20);
    expect(standardFieldsV1.filter((f) => f.part === 'Locked')).toHaveLength(13);
    expect(standardFieldsV1.filter((f) => f.part === 'Locked' && f.core)).toHaveLength(5);
    expect(standardFieldsV1.filter((f) => f.configurationKey)).toHaveLength(12);
    // The blank template carries the same rows, every one Pending.
    const template = blankSheetRows('AA-BB');
    expect(template).toHaveLength(72);
    expect(template.slice(1).map((row) => [row[2], row[8]])).toEqual(
      standardFieldsV1.map((field) => [field.key, 'Pending']),
    );
  });

  test('an email address is refused in a value, a note, a source and a label', () => {
    const email = 'buyer@example.org';
    for (const fact of [
      filled('identity.summary', `Write to ${email}`),
      notApplicable('travel.business_visa', `Ask ${email}`),
      filled('identity.summary', 'A route summary', {
        source: `https://example.org/${email}` as ContentFact['source'],
      }),
      customFact({ label: `Ask ${email}` }),
    ])
      expect(issuesOf({ ...emptyContentDocument, facts: [fact] })).toContain(routePackWords.email);
  });

  test('a Locked Core row is never Not applicable; sourcing.profile and pack.localities are, with a note', () => {
    for (const key of ['pack.languages', 'pack.channels', 'pack.missionTypes'])
      expect(issuesOf({ ...emptyContentDocument, facts: [notApplicable(key)] })).toEqual([
        routePackWords.coreNotApplicable(key),
      ]);
    expect(
      issuesOf({
        ...emptyContentDocument,
        facts: [notApplicable('sourcing.profile'), notApplicable('pack.localities')],
      }),
    ).toEqual([]);
    // A locked row takes no value in the content.
    expect(
      issuesOf({ ...emptyContentDocument, facts: [filled('pack.localities', ['dhaka'])] }),
    ).toEqual([
      routePackWords.lockedFilled('pack.localities'),
      routePackWords.lockedDetails('pack.localities'),
    ]);
  });

  test('a Filled Locked Core fact gets its own words, not the Not applicable ones', () => {
    const issues = issuesOf({ ...emptyContentDocument, facts: [filled('pack.languages', ['en'])] });
    expect(issues).toEqual([
      routePackWords.lockedCoreFilled('pack.languages'),
      routePackWords.lockedDetails('pack.languages'),
    ]);
    expect(issues).not.toContain(routePackWords.coreNotApplicable('pack.languages'));
  });

  test('a list value or an allowed value with the | sign is refused, so the sheet round trip is safe', () => {
    expect(
      issuesOf({
        ...emptyContentDocument,
        facts: [filled('market.key_cities', ['Dhaka|Gazipur'])],
      }),
    ).toEqual([routePackWords.listSeparator('market.key_cities')]);
    expect(
      issuesOf({
        ...emptyContentDocument,
        facts: [
          customFact({
            type: 'choice',
            value: 'Spring',
            allowedValues: ['Spring', 'Summer|Autumn'],
          }),
        ],
      }),
    ).toEqual([routePackWords.listSeparator('custom.visit_season')]);
    // A | inside plain text is still text.
    expect(
      issuesOf({ ...emptyContentDocument, facts: [filled('identity.summary', 'A | B')] }),
    ).toEqual([]);
  });

  test('Not applicable without a reason in the note is refused', () => {
    for (const note of [undefined, '', 'no'])
      expect(
        issuesOf({
          ...emptyContentDocument,
          facts: [{ key: 'travel.business_visa', state: 'NOT_APPLICABLE', note }],
        }),
      ).toContain(routePackWords.notApplicableNote);
  });

  test('a key outside custom. that is not a v1 field is refused, with the words a person can act on', () => {
    expect(() =>
      parseContentDocument({ ...emptyContentDocument, facts: [filled('market.colour', 'Blue')] }),
    ).toThrow(routePackWords.unknownKey('market.colour'));
    try {
      parseContentDocument({ ...emptyContentDocument, facts: [filled('market.colour', 'x')] });
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: 'ROUTE_PACK_INVALID' });
    }
  });

  test('a document over 131072 octets is refused even when every field is within its own limit', () => {
    const facts = Array.from({ length: 70 }, (_, i) =>
      customFact({
        key: `custom.long_note_${i}`,
        value: 'x'.repeat(1000),
        note: 'y'.repeat(1000),
      }),
    );
    expect(issuesOf({ ...emptyContentDocument, facts })).toEqual([routePackWords.tooLarge]);
    expect(issuesOf({ ...emptyContentDocument, facts: facts.slice(0, 50) })).toEqual([]);
  });

  test('a section mark, by number or by name, covers the custom rows of its section and never a Locked Core row', () => {
    expect(sectionFromName('3')).toBe(3);
    expect(sectionFromName('languages, money and time')).toBe(3);
    expect(sectionFromName('Trade fairs and events')).toBe(5);
    expect(sectionFromName('Weather')).toBeNull();
    const document = parseContentDocument({
      standardVersion: 1,
      sectionMarks: [
        { section: sectionFromName('Languages, money and time'), note: 'Covered elsewhere' },
        { section: sectionFromName('5'), note: 'No fairs on this route' },
      ],
      facts: [
        filled('locale.working_week', 'Origin: Sunday to Thursday.'),
        customFact({
          key: 'custom.fair_season',
          section: 5,
          state: 'NOT_APPLICABLE',
          note: 'None',
        }),
        customFact({ key: 'custom.local_week', section: 3 }),
      ],
    });
    const view = deriveCompleteness(
      { status: 'DRAFT', configuration: { ...draftConfiguration(), languages: ['en'] } },
      document,
      yesterday,
    );
    const row = (key: string) => view.fields.find((f) => f.key === key)!;
    expect(row('locale.working_week')).toMatchObject({ state: 'FILLED', coveredBySection: false });
    expect(row('locale.closure_periods')).toMatchObject({
      state: 'NOT_APPLICABLE',
      coveredBySection: true,
    });
    expect(row('custom.local_week')).toMatchObject({ state: 'FILLED', custom: true });
    expect(row('custom.fair_season')).toMatchObject({
      state: 'NOT_APPLICABLE',
      coveredBySection: true,
    });
    expect(row('events.trade_fairs')).toMatchObject({
      state: 'NOT_APPLICABLE',
      coveredBySection: true,
    });
    for (const key of ['pack.languages', 'pack.currencies', 'pack.timeZones'])
      expect(row(key).coveredBySection).toBe(false);
    expect(row('pack.languages').state).toBe('FILLED');
    expect(row('pack.currencies').state).toBe('PENDING');
    // The marked section with a Locked Core row not Filled is Pending and lists it.
    expect(view.sections[2]).toEqual({
      section: 3,
      name: 'Languages, money and time',
      state: 'PENDING',
      pendingLockedCore: ['pack.currencies', 'pack.timeZones'],
    });
    expect(view.sections[4]).toMatchObject({ section: 5, state: 'NOT_APPLICABLE' });
    expect(view.pendingCore).toContain('pack.currencies');
    expect(view.pendingCore).not.toContain('locale.closure_periods');
  });

  test('section states, pending Core, stale Core and the Optional count follow ADR C', () => {
    const document = coreDocument(
      ['payments.norms', 'travel.business_visa'],
      [
        notApplicable('travel.business_visa'),
        filled('standards.labelling', 'Labels in both languages'),
        filled('travel.visit_notes', 'Factory visits need a day of notice'),
      ],
    );
    document.facts = document.facts.map((fact) =>
      fact.key === 'identity.summary'
        ? { ...fact, validUntil: yesterday, observedOn: lastYear }
        : fact,
    );
    const today = new Date().toISOString().slice(0, 10);
    const view = deriveCompleteness(
      { status: 'DRAFT', configuration: liveConfiguration() },
      parseContentDocument(document),
      today,
    );
    const state = (n: number) => view.sections[n - 1]!.state;
    expect(state(1)).toBe('FILLED');
    expect(state(7)).toBe('FILLED');
    expect(state(10)).toBe('PENDING');
    expect(state(11)).toBe('FILLED');
    expect(state(5)).toBe('PENDING');
    expect(state(13)).toBe('PENDING');
    expect(view.pendingCore).toEqual(['payments.norms']);
    expect(view.staleCore).toEqual(['identity.summary']);
    expect(view.pendingOptionalCount).toBe(standardFieldsV1.filter((f) => !f.core).length - 2);
    // No pack and no content: every Core field is Pending.
    expect(deriveCompleteness(null, null, today).pendingCore).toEqual(coreKeysV1);
  });

  test('the go-live check refuses exactly the three ADR C writes', () => {
    const full = parseContentDocument(coreDocument());
    const missing = parseContentDocument(coreDocument(['risks.key_risks']));
    const pack = (status: PackStatus, extra: Partial<RouteConfiguration> = {}) => ({
      status,
      configuration: liveConfiguration(extra),
    });
    const draft = { pack: pack('DRAFT'), document: missing };
    expect(goLiveCheck({ before: draft, after: { ...draft, pack: pack('ACTIVE') } })).toEqual({
      ok: false,
      code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE',
      keys: ['risks.key_risks'],
    });
    expect(goLiveCheck({ before: draft, after: { pack: pack('ACTIVE'), document: full } })).toEqual(
      { ok: true },
    );
    expect(goLiveCheck({ before: draft, after: { ...draft, pack: pack('TESTING') } })).toEqual({
      ok: true,
    });
    const live = { pack: pack('ACTIVE'), document: full };
    expect(goLiveCheck({ before: live, after: { ...live, document: missing } })).toMatchObject({
      ok: false,
      code: 'ROUTE_PACK_CORE_TURNS_PENDING',
      keys: ['risks.key_risks'],
    });
    expect(
      goLiveCheck({ before: live, after: { ...live, pack: pack('ACTIVE', { channels: [] }) } }),
    ).toMatchObject({ ok: false, keys: ['pack.channels'] });
    expect(
      goLiveCheck({ before: live, after: { ...live, pack: pack('PAUSED', { languages: [] }) } }),
    ).toEqual({ ok: true });
    // Already live with a Pending field: a write that turns nothing else Pending passes.
    const legacy = { pack: pack('ACTIVE'), document: missing };
    expect(goLiveCheck({ before: legacy, after: legacy })).toEqual({ ok: true });
  });

  test('carry-over keeps every key the form does not set, and drops sourcing only when asked', () => {
    const current = routeConfiguration.parse({
      ...liveConfiguration(),
      requirements: [randomUUID()],
      assessments: [randomUUID()],
      jurisdictionPolicyRefs: [randomUUID()],
      aiPolicyRef: randomUUID(),
      localities: ['dhaka'],
      sourcing: bdCnSourcingProfile,
    });
    const form = guidedRoutePack.parse({
      routeId: randomUUID(),
      version: 2,
      status: 'TESTING',
      reason,
      missionTypes: ['sourcing', 'trade_fairs'],
    });
    expect(routePackConfiguration(form, current)).toEqual({
      ...current,
      missionTypes: ['sourcing', 'trade_fairs'],
    });
    const removed = routePackConfiguration({ ...form, removeSourcingProfile: true }, current);
    expect('sourcing' in removed).toBe(false);
    expect(removed.requirements).toEqual(current.requirements);
    expect(() =>
      guidedRoutePack.parse({
        ...form,
        removeSourcingProfile: true,
        sourcing: bdCnSourcingProfile,
      }),
    ).toThrow('Choose either a sourcing profile or Remove sourcing profile, not both');
    // With no pack the form writes exactly what it always wrote.
    expect(carriedConfiguration(null, {})).toEqual({
      ...draftConfiguration(),
      missionTypes: [],
      channels: [],
    });
  });

  test('the note of removed policies keeps the reason within 500 characters', () => {
    expect(reasonWithRemovedPolicies('Pause the route', [])).toBe('Pause the route');
    expect(reasonWithRemovedPolicies('Pause the route', ['policy A', 'policy B'])).toBe(
      'Pause the route Expired policies removed: policy A, policy B.',
    );
    const names = Array.from({ length: 20 }, (_, i) => `communication policy number ${i + 1}`);
    const long = reasonWithRemovedPolicies('r'.repeat(300), names);
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long).toMatch(
      /^r{300} Expired policies removed: communication policy number 1, .* and \d+ more\.$/,
    );
    const full = reasonWithRemovedPolicies('r'.repeat(500), names);
    expect(full.length).toBeLessThanOrEqual(500);
    expect(full.endsWith(' Expired policies removed: 20 policies.')).toBe(true);
  });

  test('property: country pairs in both orders take the same code path', () => {
    let seed = 20261126;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    const code = () =>
      String.fromCharCode(65 + (next() % 26)) + String.fromCharCode(65 + ((next() >>> 8) % 26));
    const document = parseContentDocument(coreDocument(['payments.norms'], [customFact()]));
    const pack = { status: 'DRAFT' as const, configuration: liveConfiguration() };
    const reference = deriveCompleteness(pack, document, yesterday);
    for (let i = 0; i < 300; i++) {
      const [a, b] = [code(), code()];
      for (const route of [`${a}-${b}`, `${b}-${a}`]) {
        const rows = blankSheetRows(route);
        expect(rows.slice(1).every((row) => row[0] === route)).toBe(true);
        expect(rows.map((row) => row.slice(1))).toEqual(
          blankSheetRows('XX-YY').map((row) => row.slice(1)),
        );
        expect(deriveCompleteness(pack, document, yesterday)).toEqual(reference);
      }
    }
    const quoted = /['"`](BD|CN|BGD|CHN|Bangladesh|China|Chinese)['"`]/;
    for (const file of [
      'packages/domain/src/route-pack-standard.ts',
      'packages/missions/src/route-pack-content.ts',
      'packages/missions/src/route-pack-form.ts',
      'packages/db/route-pack-migrations/0002_route_pack_content.sql',
    ])
      expect(readFileSync(file, 'utf8'), file).not.toMatch(quoted);
  });
});

let f: Awaited<ReturnType<typeof commercialFixture>>,
  corridors: CorridorService,
  operations: OperationsService,
  content: RoutePackContentService;
const deps = () => ({ corridors, operations, content });
const owner = () => f.users.owner.ctx;
const admin = () => f.users.reviewer.ctx;
const formSwitch = (on: boolean) => {
  if (on) process.env.CORRIDRA_ROUTE_PACK_FORM = 'true';
  else delete process.env.CORRIDRA_ROUTE_PACK_FORM;
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));
async function stamp() {
  await pause();
  return new Date().toISOString();
}
let pairs = 0;
async function newRoute(id: string = randomUUID()) {
  // Each route a new pair of real market keys, both orders alike.
  const [origin, destination] = [countryCodes[2 * pairs]!, countryCodes[2 * pairs + 1]!];
  pairs++;
  await corridors.createRoute(owner(), { id, origin, destination, reason });
  return id;
}
async function appendPack(
  routeId: string,
  version: number,
  status: PackStatus,
  configuration: RouteConfiguration,
) {
  return corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId,
    version,
    status,
    effectiveFrom: await stamp(),
    reason,
    configuration,
  });
}
async function packVersions(routeId: string) {
  return (
    await f.owner.query(
      'SELECT version,status,reason,configuration,configuration::text AS text FROM app.corridor_pack_version WHERE route_id=$1 ORDER BY version',
      [routeId],
    )
  ).rows;
}
async function latestPack(routeId: string) {
  return (await packVersions(routeId)).at(-1);
}
async function contentRows(routeId: string) {
  return (
    await f.owner.query('SELECT count(*)::int n FROM app.route_pack_content WHERE route_id=$1', [
      routeId,
    ])
  ).rows[0].n as number;
}
async function saveContent(routeId: string, document: ContentDocument, id = randomUUID()) {
  const [view] = (await content.overview(owner(), { routeIds: [routeId] })).routes;
  return content.append(owner(), {
    id,
    routeId,
    version: (view?.content?.version ?? 0) + 1,
    document,
    reason,
  });
}
async function proposeAndDecide(
  routeId: string,
  status: PackStatus,
  configuration: RouteConfiguration,
) {
  const current = await latestPack(routeId);
  const proposalId = randomUUID();
  const base = (
    await f.owner.query(
      'SELECT id FROM app.corridor_pack_version WHERE route_id=$1 ORDER BY version DESC LIMIT 1',
      [routeId],
    )
  ).rows[0]?.id;
  await operations.command(owner(), {
    id: proposalId,
    action: 'propose',
    basePackId: base ?? null,
    pack: {
      id: randomUUID(),
      routeId,
      version: (current?.version ?? 0) + 1,
      status,
      effectiveFrom: await stamp(),
      reason,
      configuration,
    },
    reason,
  });
  return () =>
    operations.command(owner(), {
      id: randomUUID(),
      action: 'decide',
      proposalId,
      decision: 'PUBLISH',
      reason,
    });
}
function formInput(routeId: string, version: number, status: PackStatus, extra = {}) {
  return {
    routeId,
    version,
    status,
    effectiveFrom: new Date().toISOString(),
    reason,
    missionTypes: lockedCore.missionTypes,
    languages: lockedCore.languages,
    currencies: lockedCore.currencies,
    timeZones: lockedCore.timeZones,
    manualChannel: false,
    ...extra,
  };
}
// Runs the go-live check while another session holds the corridor lock. An inert check returns at once; an active one waits
// for the lock and times out.
async function goLiveUnderHeldLock(routeId: string) {
  const [holder, runner] = [await f.owner.connect(), await f.owner.connect()];
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      f.tenantA + ':corridor',
    ]);
    await runner.query('BEGIN');
    await runner.query("SET LOCAL lock_timeout='300ms'");
    return await assertPackGoLive(runner, f.tenantA, {
      routeId,
      status: 'ACTIVE',
      configuration: draftConfiguration(),
    }).then(
      () => 'returned',
      (error: { code?: string }) => error.code,
    );
  } finally {
    await runner.query('ROLLBACK').catch(() => undefined);
    runner.release();
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
  }
}
const expectedLegacyForm = (currencies: string[]) => ({
  missionTypes: ['sourcing'],
  requiredCapabilities: [],
  languages: [],
  currencies,
  timeZones: [],
  localities: [],
  clusters: [],
  requirements: [],
  assessments: [],
  sourceCategories: [],
  channels: ['SYNTHETIC'],
  jurisdictionPolicyRefs: [],
  evidenceTypes: [],
  reviewRequired: true,
  operatorCapabilities: [],
  coverage: [],
  aiPolicyRef: null,
  pricingRef: null,
});
let legacyLive: string;

describe('route pack content on the database', () => {
  beforeAll(async () => {
    formSwitch(false);
    f = await commercialFixture();
    corridors = new CorridorService(f.runtime);
    operations = new OperationsService(f.runtime);
    content = new RoutePackContentService(f.runtime);
    await corridors.installTemplates(owner());
    await changeMemberNow(new AccessService(f.runtime), owner(), {
      userId: f.users.reviewer.id,
      role: 'admin',
      revoked: false,
    });
  }, 120000);
  afterAll(async () => {
    formSwitch(false);
    await f?.close();
  });
  beforeEach(async () => {
    await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  });

  test('S2, before the install: every pack path is as on main, the check takes no lock and the content service answers Not found', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', { ...draftConfiguration(), localities: ['dhaka'] });
    expect(await goLiveUnderHeldLock(routeId)).toBe('returned');
    // DRAFT to ACTIVE with every Core field Pending is not held back before the install.
    await appendPack(routeId, 2, 'ACTIVE', draftConfiguration());
    // The form writes through appendPack with exactly the configuration it always wrote, dropping unset keys as before.
    await createRoutePack(deps(), owner(), {
      ...formInput(routeId, 3, 'ACTIVE'),
      languages: undefined,
      timeZones: undefined,
      missionTypes: ['sourcing'],
      currencies: ['EUR'],
    });
    const stored = await latestPack(routeId);
    expect(stored.status).toBe('ACTIVE');
    expect(stored.text).toBe(
      (await f.owner.query('SELECT $1::jsonb::text t', [expectedLegacyForm(['EUR'])])).rows[0].t,
    );
    expect(await content.capabilities(owner())).toEqual({
      routePackForm: true,
      contentInstalled: false,
      onePersonPublication: false,
    });
    await expect(content.overview(owner())).rejects.toMatchObject({
      status: 404,
      message: 'Not found',
    });
    await expect(
      content.append(owner(), {
        id: randomUUID(),
        routeId,
        version: 1,
        document: emptyContentDocument,
        reason,
      }),
    ).rejects.toMatchObject({ status: 404 });
    legacyLive = routeId;
  });

  test('install: the real-use, sourcing and route pack modules; with the switch off every pack path is still as on main', async () => {
    await migrateCustomerRealUse(f.owner);
    await migrateSourcingWorkflow(f.owner);
    await configureSourcingWorkflow(f.owner, {
      enabled: true,
      reason: 'Synthetic sourcing control open for route pack content tests',
    });
    await migrateRoutePack(f.owner);
    formSwitch(false);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', draftConfiguration());
    expect(await goLiveUnderHeldLock(routeId)).toBe('returned');
    await appendPack(routeId, 2, 'LIMITED', draftConfiguration());
    await createRoutePack(deps(), owner(), {
      ...formInput(routeId, 3, 'ACTIVE'),
      languages: undefined,
      timeZones: undefined,
      currencies: ['EUR'],
    });
    expect((await latestPack(routeId)).text).toBe(
      (await f.owner.query('SELECT $1::jsonb::text t', [expectedLegacyForm(['EUR'])])).rows[0].t,
    );
    const decide = await proposeAndDecide(routeId, 'ACTIVE', draftConfiguration());
    await decide();
    expect((await latestPack(routeId)).version).toBe(4);
    await expect(content.overview(owner())).rejects.toMatchObject({ status: 404 });
    // Switched on, the same check now waits for the corridor lock.
    formSwitch(true);
    expect(await goLiveUnderHeldLock(routeId)).toBe('55P03');
    expect(await content.capabilities(owner())).toEqual({
      routePackForm: true,
      contentInstalled: true,
      onePersonPublication: true,
    });
  });

  test('row security: another workspace reads none of the content and cannot add to it', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const saved = await saveContent(routeId, coreDocument());
    expect(saved).toMatchObject({ version: 1, packId: null, duplicate: false });
    const other = f.users.other.ctx;
    expect(
      (await rawContext(f.runtime, other, 'SELECT count(*)::int n FROM app.route_pack_content'))
        .rows[0].n,
    ).toBe(0);
    await expect(
      rawContext(
        f.runtime,
        other,
        'INSERT INTO app.route_pack_content(id,tenant_id,route_id,version,standard_version,document,reason,created_by) VALUES($1,$2,$3,1,1,\'{"standardVersion":1,"sectionMarks":[],"facts":[]}\',$4,$5)',
        [randomUUID(), f.tenantA, routeId, reason, f.users.other.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await content.overview(other)).routes.map((r) => r.routeId)).not.toContain(routeId);
    expect(await contentRows(routeId)).toBe(1);
  });

  test('content is append-only, its versions are sequential and the size cap holds even for the database owner', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const saved = await saveContent(routeId, coreDocument());
    await expect(
      f.owner.query("UPDATE app.route_pack_content SET reason='Rewritten reason' WHERE id=$1", [
        saved.id,
      ]),
    ).rejects.toThrow('Immutable record; append a new record');
    await expect(
      f.owner.query('DELETE FROM app.route_pack_content WHERE id=$1', [saved.id]),
    ).rejects.toThrow('Immutable record; append a new record');
    await expect(
      rawContext(f.runtime, owner(), 'DELETE FROM app.route_pack_content WHERE id=$1', [saved.id]),
    ).rejects.toMatchObject({ code: '42501' });
    const insert = (version: number, document: unknown) =>
      rawContext(
        f.runtime,
        owner(),
        'INSERT INTO app.route_pack_content(id,tenant_id,route_id,version,standard_version,document,reason,created_by) VALUES($1,$2,$3,$4,1,$5,$6,$7)',
        [randomUUID(), f.tenantA, routeId, version, document, reason, f.users.owner.id],
      );
    await expect(insert(3, emptyContentDocument)).rejects.toThrow(
      'Sequential route content version required',
    );
    const oversized = {
      ...emptyContentDocument,
      facts: [filled('notes.general', 'x'.repeat(140000))],
    };
    await expect(insert(2, oversized)).rejects.toMatchObject({ code: '23514' });
    await expect(insert(2, oversized)).rejects.toThrow('check constraint');
    expect(await contentRows(routeId)).toBe(1);
  });

  test('the event of a content version carries its id and version, not its content', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const saved = await saveContent(routeId, coreDocument());
    const events = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='route_pack_content.insert' AND aggregate_id=$1",
        [saved.id],
      )
    ).rows;
    // The shared event function adds its revoked flag; nothing of the document, the reason or a person is carried.
    expect(events).toEqual([{ payload: { id: saved.id, version: 1, revoked: false } }]);
  });

  test('saving needs the owner with a fresh authenticator check; an admin reads but cannot save', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const item = { id: randomUUID(), routeId, version: 1, document: coreDocument(), reason };
    await expect(content.append(admin(), item)).rejects.toMatchObject({ status: 403 });
    expect(await contentRows(routeId)).toBe(0);
    await f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '10 minutes'");
    await expect(content.append(owner(), item)).rejects.toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
    await content.append(owner(), item);
    const [view] = (await content.overview(admin(), { routeIds: [routeId] })).routes;
    expect(view?.content?.version).toBe(1);
    expect(await content.history(f.users.viewer.ctx, { routeId })).toMatchObject([
      { version: 1, createdByYou: false, reason },
    ]);
  });

  test('a retried save is a duplicate and adds no row; the same id with another document is refused', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const item = { id: randomUUID(), routeId, version: 1, document: coreDocument(), reason };
    expect(await content.append(owner(), item)).toMatchObject({ version: 1, duplicate: false });
    expect(await content.append(owner(), item)).toMatchObject({ version: 1, duplicate: true });
    expect(await contentRows(routeId)).toBe(1);
    await expect(
      content.append(owner(), {
        ...item,
        document: coreDocument([], [filled('notes.general', 'Changed')]),
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ROUTE_PACK_COMMAND_REUSED' });
    expect(await contentRows(routeId)).toBe(1);
  });

  test('recovery: after a version conflict a fresh read and a new save succeed', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await saveContent(routeId, coreDocument());
    const stale = { id: randomUUID(), routeId, version: 1, document: coreDocument(), reason };
    await expect(content.append(owner(), stale)).rejects.toMatchObject({
      status: 409,
      code: 'ROUTE_PACK_CONTENT_CHANGED',
      message: routePackWords.contentChanged,
    });
    const [view] = (await content.overview(owner(), { routeIds: [routeId] })).routes;
    expect(
      await content.append(owner(), {
        ...stale,
        id: randomUUID(),
        version: view!.content!.version + 1,
      }),
    ).toMatchObject({ version: 2 });
  });

  test('a custom key keeps one meaning across routes, judged after the whole batch; a new label is shown everywhere', async () => {
    formSwitch(true);
    const [first, second] = [await newRoute(), await newRoute()];
    await saveContent(first, coreDocument([], [customFact()]));
    for (const changed of [
      { type: 'number' as const, value: '3' },
      { section: 9 },
      { type: 'choice' as const, value: 'Spring', allowedValues: ['Spring', 'Autumn'] },
    ])
      await expect(
        saveContent(second, coreDocument([], [customFact(changed)])),
      ).rejects.toMatchObject({
        status: 409,
        code: 'ROUTE_PACK_CUSTOM_KEY_CONFLICT',
        message: routePackWords.customKeyConflict('custom.visit_season'),
      });
    expect(await contentRows(second)).toBe(0);
    // One batch that changes the key on both routes leaves no conflict behind.
    const both = coreDocument([], [customFact({ type: 'number', value: '3' })]);
    await content.appendBatch(owner(), {
      items: [
        { id: randomUUID(), routeId: first, version: 2, document: both, reason },
        { id: randomUUID(), routeId: second, version: 1, document: both, reason },
      ],
    });
    await saveContent(
      second,
      coreDocument(
        [],
        [customFact({ type: 'number', value: '4', label: 'Visit months, renamed' })],
      ),
    );
    const view = await content.overview(f.users.viewer.ctx);
    expect(view.customLabels['custom.visit_season']).toBe('Visit months, renamed');
    expect(view.routes.find((r) => r.routeId === first)?.readiness).toBeNull();
  });

  test('DRAFT to ACTIVE with a Core field Pending is refused on all four pack paths and passes once it is Filled or Not applicable', async () => {
    formSwitch(true);
    const routes = [await newRoute(), await newRoute(), await newRoute(), await newRoute()];
    for (const routeId of routes) {
      await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
      await saveContent(routeId, coreDocument(['payments.norms']));
    }
    const [raw, form, publish, statusChange] = routes as [string, string, string, string];
    const refused = { status: 409, code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE' };
    await expect(appendPack(raw, 2, 'ACTIVE', liveConfiguration())).rejects.toMatchObject(refused);
    await expect(appendPack(raw, 2, 'ACTIVE', liveConfiguration())).rejects.toThrow(
      'The route cannot go live while these Core fields are Pending: Usual payment terms.',
    );
    await expect(
      createRoutePack(deps(), owner(), formInput(form, 2, 'ACTIVE', { commandId: randomUUID() })),
    ).rejects.toMatchObject(refused);
    const decidePublish = await proposeAndDecide(
      publish,
      'ACTIVE',
      liveConfiguration({ localities: ['dhaka'] }),
    );
    await expect(decidePublish()).rejects.toMatchObject(refused);
    const decideStatus = await proposeAndDecide(statusChange, 'ACTIVE', liveConfiguration());
    await expect(decideStatus()).rejects.toMatchObject(refused);
    for (const routeId of routes) expect((await latestPack(routeId)).status).toBe('DRAFT');
    // Filled on two routes, Not applicable on the other two: every path now passes.
    for (const [i, routeId] of routes.entries())
      await saveContent(
        routeId,
        coreDocument(
          ['payments.norms'],
          [
            i % 2
              ? notApplicable('payments.norms')
              : filled('payments.norms', 'Deposit then balance'),
          ],
        ),
      );
    await appendPack(raw, 2, 'ACTIVE', liveConfiguration());
    const published = await createRoutePack(deps(), owner(), formInput(form, 2, 'ACTIVE'));
    expect(published).toMatchObject({ version: 2, duplicate: false });
    await decidePublish();
    await decideStatus();
    for (const routeId of routes) expect((await latestPack(routeId)).status).toBe('ACTIVE');
    // The status change published the configuration unchanged, as a reviewed proposal and decision.
    expect((await packVersions(statusChange)).map((p) => p.configuration)).toEqual([
      liveConfiguration(),
      liveConfiguration(),
    ]);
    const history = await content.packHistory(owner(), { routeId: statusChange });
    expect(history[0]).toMatchObject({
      version: 2,
      status: 'ACTIVE',
      reviewed: true,
      proposedAndPublishedByYou: true,
    });
    expect(history[1]).toMatchObject({ version: 1, reviewed: false, proposedBy: null });
  });

  test('on a live route, content or a pack that turns a Core field Pending is refused; PAUSED is always allowed', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
    await saveContent(routeId, coreDocument());
    await appendPack(routeId, 2, 'ACTIVE', liveConfiguration());
    const turns = { status: 409, code: 'ROUTE_PACK_CORE_TURNS_PENDING' };
    await expect(saveContent(routeId, coreDocument(['identity.summary']))).rejects.toMatchObject(
      turns,
    );
    // Filled to Not applicable is not Pending.
    await saveContent(
      routeId,
      coreDocument(['identity.summary'], [notApplicable('identity.summary')]),
    );
    await expect(
      appendPack(routeId, 3, 'ACTIVE', liveConfiguration({ languages: [] })),
    ).rejects.toMatchObject(turns);
    await expect(
      appendPack(routeId, 3, 'ACTIVE', liveConfiguration({ channels: [] })),
    ).rejects.toThrow(
      'The route is live, so these Core fields cannot become Pending: Message channels.',
    );
    await expect(
      createRoutePack(deps(), owner(), formInput(routeId, 3, 'ACTIVE', { languages: [] })),
    ).rejects.toMatchObject(turns);
    expect((await latestPack(routeId)).version).toBe(2);
    await appendPack(routeId, 3, 'PAUSED', liveConfiguration({ languages: [], channels: [] }));
    expect((await latestPack(routeId)).status).toBe('PAUSED');
  });

  test('a route already ACTIVE with Pending Core fields before the install keeps working and is listed', async () => {
    formSwitch(true);
    const [view] = (await content.overview(owner(), { routeIds: [legacyLive] })).routes;
    expect(view?.pack?.status).toBe('ACTIVE');
    expect(view?.completeness.pendingCore).toEqual(
      coreKeysV1.filter(
        (key) => !['pack.missionTypes', 'pack.currencies', 'pack.channels'].includes(key),
      ),
    );
    // Content that leaves fields Pending but turns nothing Pending, and a pack that only adds a key, both pass.
    await saveContent(legacyLive, coreDocument(['payments.norms']));
    await appendPack(legacyLive, 4, 'ACTIVE', {
      ...(await latestPack(legacyLive)).configuration,
      localities: ['dhaka'],
    });
    const decide = await proposeAndDecide(
      legacyLive,
      'PAUSED',
      (await latestPack(legacyLive)).configuration,
    );
    await decide();
    expect((await latestPack(legacyLive)).status).toBe('PAUSED');
  });

  test('readiness is shown to owners and admins only, as the complete mission types of the current pack', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'TESTING', liveConfiguration());
    const t = await f.target();
    const packId = (await content.overview(owner(), { routeIds: [routeId] })).routes[0]?.pack?.id;
    for (const dimension of readinessDimensions)
      await operations.command(admin(), {
        id: randomUUID(),
        action: 'readiness',
        routeId,
        packId,
        missionType: 'sourcing',
        dimension,
        version: 1,
        status: 'PASS',
        ownerId: f.users.operator.id,
        sourceId: t.sourceId,
        validUntil: future(),
        reason,
      });
    for (const ctx of [owner(), admin()])
      expect((await content.overview(ctx, { routeIds: [routeId] })).routes[0]?.readiness).toEqual({
        packId,
        completeMissionTypes: ['sourcing'],
      });
    expect(
      (await content.overview(f.users.viewer.ctx, { routeIds: [routeId] })).routes[0]?.readiness,
    ).toBeNull();
  });

  test('carry-over: the reviewed form keeps every unset key including sourcing; Remove sourcing profile removes it; a retry adds nothing', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const catalogue = await corridors.catalogue(owner());
    const requirement = catalogue.requirements[0]!.id as string;
    const assessment = catalogue.assessments[0]!.id as string;
    const current = liveConfiguration({
      requirements: [requirement],
      assessments: [assessment],
      localities: ['dhaka'],
      sourcing: bdCnSourcingProfile,
    });
    await appendPack(routeId, 1, 'DRAFT', current);
    const commandId = randomUUID();
    const input = {
      ...formInput(routeId, 2, 'TESTING', { commandId }),
      languages: undefined,
      missionTypes: ['sourcing', 'trade_fairs'],
    };
    const first = await createRoutePack(deps(), owner(), input);
    expect((await latestPack(routeId)).configuration).toEqual({
      ...current,
      missionTypes: ['sourcing', 'trade_fairs'],
    });
    // The same command again: no second proposal, no second pack.
    const proposals = async () =>
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.configuration_proposal WHERE route_id=$1',
          [routeId],
        )
      ).rows[0].n;
    expect(await proposals()).toBe(1);
    expect(await createRoutePack(deps(), owner(), input)).toEqual({ ...first, duplicate: true });
    // The same command with other values is refused; with the values it published, it is a duplicate.
    const retry = { commandId, routeId, status: 'TESTING' as const, reason };
    await expect(
      publishReviewed(deps(), owner(), { ...retry, configuration: current }),
    ).rejects.toMatchObject({ status: 409, code: 'ROUTE_PACK_COMMAND_REUSED' });
    expect(
      await publishReviewed(deps(), owner(), {
        ...retry,
        configuration: { ...current, missionTypes: ['sourcing', 'trade_fairs'] },
      }),
    ).toMatchObject({
      proposalId: commandStepId(commandId, 'propose'),
      version: 2,
      duplicate: true,
    });
    expect(await proposals()).toBe(1);
    expect(await packVersions(routeId)).toHaveLength(2);
    await createRoutePack(deps(), owner(), {
      ...formInput(routeId, 3, 'TESTING'),
      removeSourcingProfile: true,
      reason: 'Customers do not buy on this route',
    });
    const after = (await latestPack(routeId)).configuration;
    expect('sourcing' in after).toBe(false);
    expect(after.requirements).toEqual([requirement]);
    expect(after.localities).toEqual(['dhaka']);
  });

  test('a route whose latest pack is live but scheduled counts as live; content still names the pack in force', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const inForce = await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
    await saveContent(routeId, coreDocument());
    const day = 86400000;
    const scheduled = (version: number, days: number, configuration: RouteConfiguration) =>
      corridors.appendPack(owner(), {
        id: randomUUID(),
        routeId,
        version,
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() + days * day).toISOString(),
        reason,
        configuration,
      });
    await scheduled(2, 1, liveConfiguration());
    const turns = { status: 409, code: 'ROUTE_PACK_CORE_TURNS_PENDING' };
    await expect(saveContent(routeId, coreDocument(['identity.summary']))).rejects.toMatchObject(
      turns,
    );
    await expect(scheduled(3, 2, liveConfiguration({ languages: [] }))).rejects.toMatchObject(
      turns,
    );
    const saved = await saveContent(
      routeId,
      coreDocument(['identity.summary'], [notApplicable('identity.summary')]),
    );
    expect(saved.packId).toBe(inForce.id);
  });

  test('a retried reviewed publish with other values is refused; with the same values it publishes', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
    let failDecide = true;
    const flaky = {
      ...deps(),
      operations: {
        command: async (
          ctx: Parameters<OperationsService['command']>[0],
          input: { action?: string },
        ) => {
          if (input.action === 'decide' && failDecide) {
            failDecide = false;
            throw new Error('Forced failure between propose and decide');
          }
          return operations.command(ctx, input);
        },
      } as unknown as OperationsService,
    };
    const first = {
      commandId: randomUUID(),
      routeId,
      status: 'TESTING' as const,
      configuration: liveConfiguration({ localities: ['dhaka'] }),
      reason,
    };
    await expect(publishReviewed(flaky, owner(), first)).rejects.toThrow('Forced failure');
    expect(await packVersions(routeId)).toHaveLength(1);
    for (const changed of [
      { configuration: liveConfiguration({ localities: ['gazipur'] }) },
      { status: 'ACTIVE' as const },
      { reason: 'A different reason for the same command' },
    ])
      await expect(publishReviewed(flaky, owner(), { ...first, ...changed })).rejects.toMatchObject(
        { status: 409, code: 'ROUTE_PACK_COMMAND_REUSED' },
      );
    expect(await packVersions(routeId)).toHaveLength(1);
    expect(await publishReviewed(flaky, owner(), first)).toMatchObject({
      version: 2,
      duplicate: true,
    });
    expect((await latestPack(routeId)).configuration).toEqual(first.configuration);
  });

  test('a stale form or a changed base is refused, and a double click publishes once', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
    const changed = {
      status: 409,
      code: 'ROUTE_PACK_PACK_CHANGED',
      message: routePackWords.packChanged,
    };
    await expect(
      createRoutePack(deps(), owner(), formInput(routeId, 1, 'TESTING')),
    ).rejects.toMatchObject(changed);
    await expect(
      publishReviewed(deps(), owner(), {
        commandId: randomUUID(),
        routeId,
        status: 'TESTING',
        configuration: liveConfiguration(),
        reason,
        expectedBasePackId: randomUUID(),
      }),
    ).rejects.toMatchObject(changed);
    expect(await packVersions(routeId)).toHaveLength(1);
    const click = formInput(routeId, 2, 'TESTING');
    const once = await createRoutePack(deps(), owner(), click);
    expect(await createRoutePack(deps(), owner(), click)).toEqual({ ...once, duplicate: true });
    expect(await packVersions(routeId)).toHaveLength(2);
    // The base the caller read is accepted while it is still current.
    expect(
      await publishReviewed(deps(), owner(), {
        commandId: randomUUID(),
        routeId,
        status: 'TESTING',
        configuration: liveConfiguration({ localities: ['dhaka'] }),
        reason,
        expectedBasePackId: once.id,
      }),
    ).toMatchObject({ version: 3, duplicate: false });
  });

  test('a pack over the 8192 octet review limit is refused in plain words before any proposal', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
    const long = (prefix: string) =>
      Array.from({ length: 50 }, (_, i) =>
        `${prefix}${String(i).padStart(2, '0')}`.padEnd(80, 'x'),
      );
    await expect(
      createRoutePack(deps(), owner(), {
        ...formInput(routeId, 2, 'TESTING'),
        localities: long('l'),
        clusters: long('c'),
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'ROUTE_PACK_INVALID',
      message: routePackWords.proposalTooLarge,
    });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.configuration_proposal WHERE route_id=$1',
          [routeId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('a live route stays live while a later DRAFT waits: the pack in force is judged too', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await saveContent(routeId, coreDocument());
    await appendPack(routeId, 1, 'ACTIVE', liveConfiguration());
    await corridors.appendPack(owner(), {
      id: randomUUID(),
      routeId,
      version: 2,
      status: 'DRAFT',
      effectiveFrom: new Date(Date.now() + 30 * 86400000).toISOString(),
      reason,
      configuration: liveConfiguration(),
    });
    const missing = coreDocument(['identity.summary']);
    await expect(saveContent(routeId, missing)).rejects.toMatchObject({
      status: 409,
      code: 'ROUTE_PACK_CORE_TURNS_PENDING',
    });
    expect(await content.goLive(owner(), { routeId, document: missing })).toMatchObject({
      ok: false,
      code: 'ROUTE_PACK_CORE_TURNS_PENDING',
      keys: ['identity.summary'],
    });
    expect(await contentRows(routeId)).toBe(1);
  });

  test('an expired policy reference refuses a live publish in plain words and writes nothing', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await saveContent(routeId, coreDocument());
    const policy = await f.communications.command(
      owner(),
      command('policy', {
        jurisdiction: 'DE',
        channel: 'SYNTHETIC',
        contactPurpose: 'institutional_introduction',
        basis: 'Invented policy that expires before the live publish',
        validUntil: new Date(Date.now() + 1500).toISOString(),
        enabled: true,
      }),
    );
    await appendPack(
      routeId,
      1,
      'DRAFT',
      liveConfiguration({ jurisdictionPolicyRefs: [policy.id] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const refused = createRoutePack(deps(), owner(), formInput(routeId, 2, 'ACTIVE'));
    await expect(refused).rejects.toMatchObject({ status: 409, code: 'ROUTE_PACK_POLICY_EXPIRED' });
    await expect(refused).rejects.toThrow(
      /^These policies have expired: communication policy DE SYNTHETIC institutional_introduction version \d+\. Pause the route, or publish with a current policy\.$/,
    );
    expect(await packVersions(routeId)).toHaveLength(1);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.configuration_proposal WHERE route_id=$1',
          [routeId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('a carried policy reference that expired is dropped and named when the route is paused', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const policy = await f.communications.command(
      owner(),
      command('policy', {
        jurisdiction: 'DE',
        channel: 'SYNTHETIC',
        contactPurpose: 'institutional_introduction',
        basis: 'Invented policy that expires during this test',
        validUntil: new Date(Date.now() + 1500).toISOString(),
        enabled: true,
      }),
    );
    await appendPack(
      routeId,
      1,
      'DRAFT',
      liveConfiguration({ jurisdictionPolicyRefs: [policy.id] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const paused = await createRoutePack(deps(), owner(), formInput(routeId, 2, 'PAUSED'));
    expect(paused).toMatchObject({ version: 2, removedRefs: [policy.id] });
    const after = await latestPack(routeId);
    expect(after.status).toBe('PAUSED');
    expect(after.configuration.jurisdictionPolicyRefs).toEqual([]);
  });

  test('a PAUSED publish with an expired reference records the policy it removed in its reason', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    const policy = await f.communications.command(
      owner(),
      command('policy', {
        jurisdiction: 'DE',
        channel: 'SYNTHETIC',
        contactPurpose: 'institutional_introduction',
        basis: 'Invented policy that expires before the route is paused',
        validUntil: new Date(Date.now() + 1500).toISOString(),
        enabled: true,
      }),
    );
    await appendPack(
      routeId,
      1,
      'DRAFT',
      liveConfiguration({ jurisdictionPolicyRefs: [policy.id] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const input = { ...formInput(routeId, 2, 'PAUSED'), commandId: randomUUID() };
    expect(await createRoutePack(deps(), owner(), input)).toMatchObject({
      version: 2,
      duplicate: false,
    });
    const recorded = new RegExp(
      `^${reason} Expired policies removed: communication policy DE SYNTHETIC institutional_introduction version \\d+\\.$`,
    );
    expect((await latestPack(routeId)).reason).toMatch(recorded);
    const proposal = (
      await f.owner.query(
        "SELECT q.reason AS proposal,q.proposed_pack->>'reason' AS pack,d.reason AS decision FROM app.configuration_proposal q JOIN app.configuration_decision d ON d.proposal_id=q.id WHERE q.route_id=$1",
        [routeId],
      )
    ).rows[0];
    for (const text of [proposal.proposal, proposal.pack, proposal.decision])
      expect(text).toMatch(recorded);
    // A retry finds the policy gone already and keeps the recorded reason.
    expect(await createRoutePack(deps(), owner(), input)).toMatchObject({
      duplicate: true,
      version: 2,
    });
  });

  test('the latest label of a custom key is chosen the same way every time: time, then version, then route key', async () => {
    formSwitch(true);
    // The route ids run against the route keys, so an order by id would pick the other label.
    const small = await newRoute('ffffffff-ffff-4fff-bfff-ffffffffffff');
    const large = await newRoute('00000000-0000-4000-8000-000000000001');
    const labelled = (label: string) =>
      coreDocument([], [customFact({ key: 'custom.tie_label', label })]);
    const item = (routeId: string, version: number, label: string) => ({
      id: randomUUID(),
      routeId,
      version,
      document: labelled(label),
      reason,
    });
    await content.appendBatch(owner(), {
      items: [item(small, 1, 'From the first route'), item(large, 1, 'From the second route')],
    });
    const label = async () => (await content.overview(owner())).customLabels['custom.tie_label'];
    expect(await label()).toBe('From the second route');
    await saveContent(small, labelled('First route again'));
    await content.appendBatch(owner(), {
      items: [item(small, 3, 'Higher version'), item(large, 2, 'Lower version')],
    });
    expect(await label()).toBe('Higher version');
  });

  test('rollback/0002 hides the module: Not found, an inert check and no inserts, while every row stays', async () => {
    formSwitch(true);
    const routeId = await newRoute();
    await appendPack(routeId, 1, 'DRAFT', liveConfiguration());
    await saveContent(routeId, coreDocument(['payments.norms']));
    const total = async () =>
      (await f.owner.query('SELECT count(*)::int n FROM app.route_pack_content')).rows[0].n;
    const before = await total();
    const rollback = readFileSync(
      'packages/db/route-pack-migrations/rollback/0002_hide_route_pack_content.sql',
      'utf8',
    );
    await f.owner.query(rollback);
    await expect(f.owner.query(rollback)).rejects.toThrow('Route pack content rollback refused');
    await expect(content.overview(owner())).rejects.toMatchObject({ status: 404 });
    await expect(saveContent(routeId, coreDocument())).rejects.toMatchObject({ status: 404 });
    expect(await goLiveUnderHeldLock(routeId)).toBe('returned');
    await appendPack(routeId, 2, 'ACTIVE', liveConfiguration());
    await expect(
      rawContext(
        f.runtime,
        owner(),
        'INSERT INTO app.route_pack_content(id,tenant_id,route_id,pack_id,version,standard_version,document,reason,created_by) VALUES($1,$2,$3,$4,2,1,$5,$6,$7)',
        [randomUUID(), f.tenantA, routeId, null, emptyContentDocument, reason, f.users.owner.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await total()).toBe(before);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM route_pack_migrations.applied WHERE name='0002_route_pack_content.sql'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
