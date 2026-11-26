import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { changeMemberNow } from './change-member';
import { AccessService } from '../../packages/auth/src/access';
import { configureSourcingWorkflow } from '../../packages/auth/src/sourcing-workflow-configuration';
import { csvCell } from '../../packages/auth/src/customer-programme-export-csv';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateSourcingWorkflow } from '../../packages/db/src/sourcing-workflow-migrate';
import { migrateRoutePack } from '../../packages/db/src/route-pack-migrate';
import { csvRows } from '../../packages/delivery/src/import';
import { DomainError } from '../../packages/domain/src/index';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { sheetColumns, standardFieldsV1 } from '../../packages/domain/src/route-pack-standard';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService } from '../../packages/missions/src/operations';
import { RoutePackContentService } from '../../packages/missions/src/route-pack-content';
import {
  RoutePackSheetService,
  sheetLimits,
  sheetWords,
  type SheetReport,
} from '../../packages/missions/src/route-pack-sheet';
import { bdCnSourcingProfile } from './fixtures/bd-cn-sourcing-profile';

// ADR-093 Phase 2c: the route pack sheet. The real handler, services and an isolated PostgreSQL with the route pack module
// installed; only the session provider and the switch reader are replaced. Red on the code before 2c: the sheet service and
// both team control actions did not exist.
const web = vi.hoisted(() => ({ actor: 'owner', switchOn: true }));
let f: Awaited<ReturnType<typeof commercialFixture>>;
let corridors: CorridorService, operations: OperationsService, content: RoutePackContentService;
let sheet: RoutePackSheetService;
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'http://localhost:3300' },
    provider: { getSession: async () => ({ token: f.users[web.actor]!.ctx.token }) },
    routePackSheet: sheet,
  }),
}));
vi.mock('../../apps/web/lib/ux-switches', () => ({ uxSwitchOn: () => web.switchOn }));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
import { GET, POST } from '../../apps/web/app/api/team-control/[action]/route';

const reason = 'Synthetic route pack sheet test';
const observed = '2026-11-01';
const owner = () => f.users.owner.ctx;
type Cells = Partial<Record<(typeof sheetColumns)[number], string>>;
const line = (cells: Cells) => sheetColumns.map((column) => cells[column] ?? '');
const filled = (route: string, key: string, value: string, cells: Cells = {}) =>
  line({
    route,
    field_key: key,
    state: 'Filled',
    value,
    source: 'staff knowledge',
    observed_on: observed,
    ...cells,
  });
const rowsOf = (lines: string[][]) =>
  [[...sheetColumns], ...lines].map((cells, i) => ({ row: i + 1, cells }));
const csvOf = (lines: string[][]) =>
  [[...sheetColumns], ...lines].map((cells) => cells.map((c) => csvCell(c)).join(',')).join('\r\n');
const lockedValues: Record<string, string> = {
  missionTypes: 'sourcing | buyers',
  languages: 'en | bn',
  currencies: 'USD',
  timeZones: 'Asia/Dhaka',
  channels: 'SYNTHETIC',
};
// Every Core field Filled, so the route may go live.
const coreLines = (route: string) =>
  standardFieldsV1
    .filter((field) => field.core)
    .map((field) =>
      field.configurationKey
        ? line({
            route,
            field_key: field.key,
            state: 'Filled',
            value: lockedValues[field.configurationKey]!,
          })
        : filled(
            route,
            field.key,
            field.type === 'list'
              ? 'Synthetic item one | Synthetic item two'
              : `Synthetic ${field.label}`,
          ),
    );
const counts = async () =>
  (
    await f.owner.query(
      `SELECT (SELECT count(*) FROM app.corridor_route)::int routes,(SELECT count(*) FROM app.corridor_pack_version)::int packs,
       (SELECT count(*) FROM app.route_pack_content)::int contents,(SELECT count(*) FROM app.configuration_proposal)::int proposals,
       (SELECT count(*) FROM app.configuration_decision)::int decisions`,
    )
  ).rows[0];
const routeId = async (key: string) => {
  const [origin, destination] = key.split('-');
  return (
    await f.owner.query(
      'SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market=$2 AND destination_market=$3',
      [f.tenantA, origin, destination],
    )
  ).rows[0]?.id as string | undefined;
};
const latestDocument = async (key: string) =>
  (
    await f.owner.query(
      'SELECT document FROM app.route_pack_content WHERE route_id=$1 ORDER BY version DESC LIMIT 1',
      [await routeId(key)],
    )
  ).rows[0]?.document;
const latestPack = async (key: string) =>
  (
    await f.owner.query(
      'SELECT id,version,status,configuration FROM app.corridor_pack_version WHERE route_id=$1 ORDER BY version DESC LIMIT 1',
      [await routeId(key)],
    )
  ).rows[0];
const fact = (document: { facts: { key: string }[] }, key: string) =>
  document.facts.find((item) => item.key === key);
const plan = (report: SheetReport, route: string) => report.routes.find((r) => r.route === route)!;
const save = (lines: string[][], ctx = owner(), saveId: string = randomUUID()) =>
  sheet.save(ctx, { rows: rowsOf(lines), saveId, reason });
// A sheet service whose operations command fails once, on the first command with this action.
function interruptedOnce(action: string, failure: Error) {
  let interrupt = true;
  const flaky = new Proxy(operations, {
    get(target, property) {
      if (property === 'command')
        return async (
          ctx: Parameters<OperationsService['command']>[0],
          input: { action?: string },
        ) => {
          if (interrupt && input.action === action) {
            interrupt = false;
            throw failure;
          }
          return target.command(ctx, input);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new RoutePackSheetService(f.runtime, corridors, flaky, content);
}
async function newRoute(key: string) {
  const [origin, destination] = key.split('-');
  const id = randomUUID();
  await corridors.createRoute(owner(), { id, origin, destination, reason });
  return id;
}
const sheetRequest = (body: unknown, origin = 'http://localhost:3300') =>
  POST(
    new Request(`http://localhost:3300/api/team-control/route-pack-import?tenant=${f.tenantA}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body:
        typeof body === 'string' || body instanceof Uint8Array || body instanceof ReadableStream
          ? body
          : JSON.stringify(body),
      duplex: 'half',
    } as RequestInit),
    { params: Promise.resolve({ action: 'route-pack-import' }) },
  );
const exportRequest = (routes: string) =>
  GET(
    new Request(
      `http://localhost:3300/api/team-control/route-pack-export?tenant=${f.tenantA}&routes=${encodeURIComponent(routes)}`,
    ),
    { params: Promise.resolve({ action: 'route-pack-export' }) },
  );

beforeAll(async () => {
  process.env.CORRIDRA_ROUTE_PACK_FORM = 'true';
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
  await migrateSourcingWorkflow(f.owner);
  await configureSourcingWorkflow(f.owner, {
    enabled: true,
    reason: 'Owner opened the sourcing route profile for the sheet test',
  });
  await migrateRoutePack(f.owner);
  corridors = new CorridorService(f.runtime);
  operations = new OperationsService(f.runtime);
  content = new RoutePackContentService(f.runtime);
  sheet = new RoutePackSheetService(f.runtime, corridors, operations, content);
  await corridors.installTemplates(owner());
}, 180000);
afterAll(async () => {
  delete process.env.CORRIDRA_ROUTE_PACK_FORM;
  await f?.close();
});
beforeEach(async () => {
  web.actor = 'owner';
  web.switchOn = true;
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});

test('the dry run writes nothing and lists every error with its row, route and key', async () => {
  const before = await counts();
  const report = await sheet.dryRun(owner(), {
    rows: rowsOf([
      filled('AR-BR', 'identity.display_name', 'Argentina to Brazil'),
      filled('AR-BR', 'identity.unknown_field', 'Anything'),
      line({ route: 'AR-BR', field_key: 'identity.summary', state: 'Not applicable' }),
      line({ route: 'AR-BR', field_key: 'identity.service_coverage', state: 'Done' }),
      filled('QQ-ZZ', 'identity.display_name', 'No such markets'),
      filled('AR-BR', 'market.notes', 'Write to buyer@example.com'),
    ]),
  });
  expect(report.mode).toBe('dry-run');
  expect(report.ok).toBe(false);
  expect(report.errors.map(({ row, route, key }) => ({ row, route, key }))).toEqual(
    expect.arrayContaining([
      { row: 3, route: 'AR-BR', key: 'identity.unknown_field' },
      { row: 4, route: 'AR-BR', key: 'identity.summary' },
      { row: 5, route: 'AR-BR', key: 'identity.service_coverage' },
      { row: 6, route: 'QQ-ZZ', key: null },
      { row: 7, route: 'AR-BR', key: 'market.notes' },
    ]),
  );
  expect(report.errors).toHaveLength(5);
  expect(report.errors.find((e) => e.row === 4)!.message).toBe(
    'Not applicable needs a reason in the note.',
  );
  expect(report.errors.find((e) => e.row === 7)!.message).toMatch(/Remove the email address/);
  expect(plan(report, 'AR-BR').willBeAdded).toBe(true);
  expect(await counts()).toEqual(before);
});

test('a file with any error saves nothing, and the same file saves once the error is fixed', async () => {
  const before = await counts();
  const good = filled('AR-CL', 'identity.display_name', 'Argentina to Chile');
  const refused = await save([
    good,
    filled('AR-CL', 'custom.cost_ar_cl', 'USD 45.001', {
      label: 'Cost',
      section: '9',
      type: 'money',
    }),
  ]);
  expect(refused.ok).toBe(false);
  expect(refused.saved).toBeUndefined();
  expect(refused.errors).toEqual([
    {
      row: 3,
      route: 'AR-CL',
      key: 'custom.cost_ar_cl',
      message: 'Enter an amount with the currency’s supported decimal places',
    },
  ]);
  expect(await counts()).toEqual(before);
  const response = await sheetRequest({
    mode: 'save',
    csv: csvOf([
      good,
      filled('AR-CL', 'custom.cost_ar_cl', 'USD 45.001', {
        label: 'Cost',
        section: '9',
        type: 'money',
      }),
    ]),
    saveId: randomUUID(),
    reason,
  });
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe('Fix the errors in the dry run first');
  expect(await counts()).toEqual(before);
  const saved = await save([good]);
  expect(saved.ok).toBe(true);
  expect(await counts()).toEqual({
    ...before,
    routes: before.routes + 1,
    contents: before.contents + 1,
  });
});

test('a route cell listing two routes copies the row to each', async () => {
  const report = await sheet.dryRun(owner(), {
    rows: rowsOf([filled('bd-cn |  CN-BD', 'identity.summary', 'Machinery sourcing both ways')]),
  });
  expect(report.errors).toEqual([]);
  expect(report.routes.map((r) => r.route)).toEqual(['BD-CN', 'CN-BD']);
  for (const r of report.routes)
    expect(r.content.added).toEqual([{ key: 'identity.summary', label: 'What this route is for' }]);
});

test('values separated by | and repeated list rows join in order; a repeated row with another source is refused', async () => {
  const saved = await save([
    filled('BR-CL', 'market.priority_sectors', 'Textiles | Leather'),
    line({ route: 'BR-CL', field_key: 'market.priority_sectors', state: 'Filled', value: 'Jute' }),
    filled('BR-CL', 'market.key_cities', 'Santos', { observed_on: '2026-10-20' }),
    filled('BR-CL', 'market.key_cities', 'Recife', { valid_until: '2026-12-31' }),
  ]);
  expect(saved.errors).toEqual([]);
  const document = await latestDocument('BR-CL');
  expect(fact(document, 'market.priority_sectors')).toMatchObject({
    value: ['Textiles', 'Leather', 'Jute'],
    source: 'staff knowledge',
    observedOn: observed,
  });
  expect(fact(document, 'market.key_cities')).toMatchObject({
    value: ['Santos', 'Recife'],
    observedOn: '2026-10-20',
    validUntil: '2026-12-31',
  });
  const refused = await sheet.dryRun(owner(), {
    rows: rowsOf([
      filled('BR-CL', 'market.counterpart_types', 'Buyers'),
      filled('BR-CL', 'market.counterpart_types', 'Distributors', {
        source: 'https://example.org/list',
      }),
      filled('BR-CL', 'identity.summary', 'One'),
      filled('BR-CL', 'identity.summary', 'Two'),
    ]),
  });
  expect(refused.errors).toEqual([
    { row: 3, route: 'BR-CL', key: 'market.counterpart_types', message: sheetWords.repeatedSource },
    { row: 5, route: 'BR-CL', key: 'identity.summary', message: sheetWords.repeatedType },
  ]);
});

test('money keeps exact minor units in its own currency, and extra decimals are refused', async () => {
  const money = (value: string) =>
    filled('BR-PE', 'custom.sample_cost_br_pe', value, {
      label: 'Usual courier cost for a small sample',
      section: 'Logistics',
      type: 'money',
    });
  await save([money('USD 45.10')]);
  expect(fact(await latestDocument('BR-PE'), 'custom.sample_cost_br_pe')).toEqual({
    key: 'custom.sample_cost_br_pe',
    state: 'FILLED',
    value: { currency: 'USD', amountMinor: '4510' },
    source: 'staff knowledge',
    observedOn: observed,
    label: 'Usual courier cost for a small sample',
    section: 9,
    type: 'money',
  });
  const refused = await sheet.dryRun(owner(), { rows: rowsOf([money('USD 45.001')]) });
  expect(refused.errors).toEqual([
    {
      row: 2,
      route: 'BR-PE',
      key: 'custom.sample_cost_br_pe',
      message: 'Enter an amount with the currency’s supported decimal places',
    },
  ]);
  // Zero and an amount longer than 18 digits in minor units are row errors, not a refusal of the whole request.
  for (const amount of ['USD 0', 'USD 12345678901234567.89'])
    expect((await sheet.dryRun(owner(), { rows: rowsOf([money(amount)]) })).errors).toEqual([
      { row: 2, route: 'BR-PE', key: 'custom.sample_cost_br_pe', message: sheetWords.moneyRange },
    ]);
});

test('the template saves nothing from its example rows: a Pending new custom row is skipped and a Filled EXAMPLE ROW is refused', async () => {
  const template = csvRows(
    readFileSync('docs/adr/0093/route-pack-template-v1.csv', 'utf8'),
    sheetLimits.rows,
    'route pack',
  );
  const report = await sheet.dryRun(owner(), { rows: template });
  expect(report.errors).toEqual([]);
  expect(report.ok).toBe(true);
  expect(plan(report, 'BD-CN').skipped.map((s) => s.key)).toEqual([
    'custom.factory_visit_season',
    'custom.sample_courier_cost',
  ]);
  expect(plan(report, 'BD-CN').skipped[0]).toEqual({
    row: 73,
    key: 'custom.factory_visit_season',
    message: sheetWords.pendingCustom,
  });
  const example = template.find((r) => r.cells[2] === 'custom.factory_visit_season')!;
  const filledExample = [...example.cells];
  filledExample[8] = 'Filled';
  filledExample[9] = 'March to May';
  filledExample[10] = 'staff knowledge';
  filledExample[11] = observed;
  const refused = await sheet.dryRun(owner(), {
    rows: [template[0]!, { row: 2, cells: filledExample }],
  });
  expect(refused.errors).toEqual([
    { row: 2, route: 'BD-CN', key: 'custom.factory_visit_season', message: sheetWords.example },
  ]);
});

test('on an ACTIVE route a file that turns a Filled Core field Pending is refused in the dry run and saves nothing', async () => {
  expect((await save(coreLines('CL-PE'))).ok).toBe(true);
  const pack = await latestPack('CL-PE');
  expect(pack.status).toBe('DRAFT');
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: await routeId('CL-PE'),
    version: pack.version + 1,
    status: 'ACTIVE',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: pack.configuration,
  });
  const file = [line({ route: 'CL-PE', field_key: 'identity.summary', state: 'Pending' })];
  const report = await sheet.dryRun(owner(), { rows: rowsOf(file) });
  expect(report.ok).toBe(false);
  expect(plan(report, 'CL-PE').goLive).toEqual({
    ok: false,
    code: 'ROUTE_PACK_CORE_TURNS_PENDING',
    keys: ['identity.summary'],
  });
  expect(report.errors).toEqual([
    {
      row: 2,
      route: 'CL-PE',
      key: 'identity.summary',
      message:
        'The route is live, so these Core fields cannot become Pending: What this route is for.',
    },
  ]);
  const before = await counts();
  expect((await save(file)).ok).toBe(false);
  expect(await counts()).toEqual(before);
  // Optional fields may still change on the live route, and the status is never taken from the file.
  const optional = await save([filled('CL-PE', 'market.notes', 'Copper and fruit dominate')]);
  expect(optional.ok).toBe(true);
  expect((await latestPack('CL-PE')).status).toBe('ACTIVE');
});

test('a file filling pack.languages is judged against the resulting pack', async () => {
  const id = await newRoute('PE-UY');
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: id,
    version: 1,
    status: 'DRAFT',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: initialRouteConfiguration(initialRoutes[2]),
  });
  const report = await sheet.dryRun(owner(), {
    rows: rowsOf([
      line({ route: 'PE-UY', field_key: 'pack.languages', state: 'Filled', value: 'es | en' }),
    ]),
  });
  const p = plan(report, 'PE-UY');
  expect(p.pack).toEqual({
    changed: true,
    changedFields: ['languages'],
    status: 'DRAFT',
    nextVersion: 2,
  });
  expect(p.completeness.pendingCore).not.toContain('pack.languages');
  expect(p.completeness.pendingCore).toContain('pack.currencies');
  expect(report.readinessInvalidated).toBe(true);
});

test('the import keeps the pack status and every key not in the sheet, including sourcing, through the reviewed path', async () => {
  const id = await newRoute('UY-PY');
  const configuration = {
    ...initialRouteConfiguration(initialRoutes[2]),
    coverage: ['montevideo'],
    sourcing: bdCnSourcingProfile,
  };
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: id,
    version: 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration,
  });
  const before = await counts();
  const report = await save([
    line({ route: 'UY-PY', field_key: 'pack.languages', state: 'Filled', value: 'es' }),
    line({ route: 'UY-PY', field_key: 'sourcing.profile', state: 'Filled' }),
  ]);
  expect(report.ok).toBe(true);
  expect(report.saved).toEqual([
    { route: 'UY-PY', routeId: id, contentVersion: null, packVersion: 2 },
  ]);
  const pack = await latestPack('UY-PY');
  expect(pack.version).toBe(2);
  expect(pack.status).toBe('TESTING');
  expect(pack.configuration).toEqual({ ...configuration, languages: ['es'] });
  expect(await counts()).toEqual({
    ...before,
    packs: before.packs + 1,
    proposals: before.proposals + 1,
    decisions: before.decisions + 1,
  });
  const decision = (
    await f.owner.query(
      'SELECT d.decision,d.created_by,q.created_by proposer FROM app.configuration_decision d JOIN app.configuration_proposal q ON q.id=d.proposal_id WHERE d.published_pack_id=$1',
      [pack.id],
    )
  ).rows;
  expect(decision).toEqual([
    { decision: 'PUBLISH', created_by: f.users.owner.id, proposer: f.users.owner.id },
  ]);
});

test('export then import gives no change, including a formula-like cell and every value type', async () => {
  const lines = [
    ...coreLines('UY-AR'),
    filled('UY-AR', 'identity.origin_scope', '=SUM(1)'),
    filled('UY-AR', 'travel.visa_lead_time_days', '012'),
    filled('UY-AR', 'logistics.usual_modes', 'sea | air'),
    filled('UY-AR', 'trade.customs_link', 'https://example.org/customs'),
    filled('UY-AR', 'custom.port_fee_uy_ar', 'UYU 1200.50', {
      label: 'Port fee',
      section: '9',
      type: 'money',
    }),
    filled('UY-AR', 'custom.season_uy_ar', 'Spring', {
      label: 'Best season',
      section: 'Travel',
      type: 'choice',
      format: 'Spring | Autumn',
    }),
    line({
      route: 'UY-AR',
      field_key: 'pack.localities',
      state: 'Not applicable',
      note: 'No place keys yet',
    }),
    line({
      route: 'UY-AR',
      field_key: 'section',
      section: '5',
      state: 'Not applicable',
      note: 'No fairs on this route',
    }),
  ];
  const saved = await save(lines);
  expect(saved.errors).toEqual([]);
  const response = await exportRequest('UY-AR');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-disposition')).toBe(
    `attachment; filename=route-packs-${new Date().toISOString().slice(0, 10)}.csv`,
  );
  const csv = await response.text();
  expect(csv).toContain(",'=SUM(1),");
  expect(csv).toContain('UYU 1200.50');
  const exported = csvRows(csv, sheetLimits.rows, 'route pack');
  expect(exported).toHaveLength(1 + standardFieldsV1.length + 2 + 1);
  expect(exported.find((r) => r.cells[2] === 'travel.visa_lead_time_days')!.cells[9]).toBe('12');
  const before = await counts();
  const dry = await sheetRequest({ mode: 'dry-run', csv });
  expect(dry.status).toBe(200);
  const report = (await dry.json()) as SheetReport;
  expect(report.errors).toEqual([]);
  expect(plan(report, 'UY-AR').content).toMatchObject({
    changed: false,
    added: [],
    updated: [],
    removed: [],
    sectionMarks: { added: [], removed: [] },
  });
  expect(plan(report, 'UY-AR').pack.changed).toBe(false);
  const again = await sheetRequest({ mode: 'save', csv, saveId: randomUUID(), reason });
  expect(again.status).toBe(201);
  expect(await counts()).toEqual(before);
});

test('a save that stopped between content and pack finishes on retry with the same saveId and adds no duplicates', async () => {
  const interrupted = interruptedOnce('propose', new DomainError('Synthetic interruption', 503));
  const saveId = randomUUID();
  const file = rowsOf([
    filled('PY-BO', 'identity.display_name', 'Paraguay to Bolivia'),
    line({ route: 'PY-BO', field_key: 'pack.missionTypes', state: 'Filled', value: 'buyers' }),
  ]);
  const before = await counts();
  const first = await interrupted.save(owner(), { rows: file, saveId, reason });
  expect(first.ok).toBe(false);
  expect(first.errors).toEqual([
    { row: null, route: 'PY-BO', key: null, message: 'Synthetic interruption' },
  ]);
  const id = await routeId('PY-BO');
  expect(first.saved).toEqual([
    { route: 'PY-BO', routeId: id, contentVersion: 1, packVersion: null },
  ]);
  expect(await counts()).toEqual({
    ...before,
    routes: before.routes + 1,
    contents: before.contents + 1,
  });
  const second = await interrupted.save(owner(), { rows: file, saveId, reason });
  expect(second.ok).toBe(true);
  expect(second.saved).toEqual([
    { route: 'PY-BO', routeId: id, contentVersion: null, packVersion: 1 },
  ]);
  const done = {
    ...before,
    routes: before.routes + 1,
    contents: before.contents + 1,
    packs: before.packs + 1,
    proposals: before.proposals + 1,
    decisions: before.decisions + 1,
  };
  expect(await counts()).toEqual(done);
  expect((await interrupted.save(owner(), { rows: file, saveId, reason })).saved).toEqual([]);
  expect(await counts()).toEqual(done);
});

test('a new route is created as route, then content, then pack v1 DRAFT through propose and decide', async () => {
  const report = await save([
    filled('GH-KE', 'identity.display_name', 'Ghana to Kenya'),
    line({
      route: 'GH-KE',
      field_key: 'pack.missionTypes',
      state: 'Filled',
      value: 'buyers | sourcing',
    }),
  ]);
  expect(report.ok).toBe(true);
  const id = await routeId('GH-KE');
  expect(plan(report, 'GH-KE')).toMatchObject({ willBeAdded: true, routeId: null });
  expect(report.saved).toEqual([
    { route: 'GH-KE', routeId: id, contentVersion: 1, packVersion: 1 },
  ]);
  const pack = await latestPack('GH-KE');
  expect(pack).toMatchObject({ version: 1, status: 'DRAFT' });
  expect(pack.configuration.missionTypes).toEqual(['buyers', 'sourcing']);
  const order = (
    await f.owner.query(
      `SELECT r.created_at route_at,c.created_at content_at,c.pack_id,p.created_at pack_at,q.base_pack_id
       FROM app.corridor_route r JOIN app.route_pack_content c ON c.route_id=r.id JOIN app.corridor_pack_version p ON p.route_id=r.id
       JOIN app.configuration_proposal q ON q.route_id=r.id WHERE r.id=$1`,
      [id],
    )
  ).rows[0];
  expect(order.pack_id).toBeNull();
  expect(order.base_pack_id).toBeNull();
  expect(order.route_at <= order.content_at && order.content_at <= order.pack_at).toBe(true);
});

test('an admin may run the dry run and export but is refused on save; a stale authenticator check is asked again', async () => {
  await changeMemberNow(new AccessService(f.runtime), owner(), {
    userId: f.users.viewer.id,
    role: 'admin',
    revoked: false,
  });
  const admin = f.users.viewer.ctx;
  const file = [filled('KE-TZ', 'identity.display_name', 'Kenya to Tanzania')];
  expect((await sheet.dryRun(admin, { rows: rowsOf(file) })).ok).toBe(true);
  const before = await counts();
  await expect(save(file, admin)).rejects.toMatchObject({ status: 403 });
  expect(await counts()).toEqual(before);
  expect((await sheet.export(f.users.operator.ctx, { routes: ['GH-KE'] })).length).toBeGreaterThan(
    1,
  );
  await f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '1 hour'");
  await expect(save(file)).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  expect(await counts()).toEqual(before);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  expect((await save(file)).ok).toBe(true);
});

test('more than 20 routes, 5000 rows or 1 MiB is refused', async () => {
  const markets = ['AR', 'BR', 'CL', 'PE', 'UY', 'PY', 'BO', 'EC', 'CO', 'VE', 'MX', 'GT'];
  const routes = markets
    .flatMap((a) => markets.filter((b) => b !== a).map((b) => `${a}-${b}`))
    .slice(0, 21);
  const tooMany = await sheet.dryRun(owner(), {
    rows: rowsOf(routes.map((route) => filled(route, 'identity.display_name', 'Synthetic route'))),
  });
  expect(tooMany.errors).toEqual([
    { row: null, route: null, key: null, message: sheetWords.routes },
  ]);
  const many = Array.from({ length: sheetLimits.rows + 1 }, () =>
    filled('AR-BR', 'market.key_cities', 'Rosario'),
  );
  await expect(sheet.dryRun(owner(), { rows: rowsOf(many) })).rejects.toThrow(sheetWords.rows);
  const rowsResponse = await sheetRequest({ mode: 'dry-run', csv: csvOf(many) });
  expect(rowsResponse.status).toBe(400);
  expect((await rowsResponse.json()).error).toBe(`Use at most ${sheetLimits.rows} route pack rows`);
  const large = await sheetRequest({ mode: 'dry-run', csv: 'x'.repeat(sheetLimits.octets + 1) });
  expect(large.status).toBe(413);
  expect((await large.json()).error).toBe(sheetWords.octets);
  const body = await sheetRequest(
    '{"mode":"dry-run","csv":"' + 'x'.repeat(2 * sheetLimits.octets) + '"}',
  );
  expect(body.status).toBe(413);
});

test('the actions refuse a foreign origin and answer 404 while the route pack form switch is off', async () => {
  const csv = csvOf([filled('AR-BR', 'identity.display_name', 'Argentina to Brazil')]);
  const foreign = await sheetRequest({ mode: 'dry-run', csv }, 'https://attacker.example');
  expect(foreign.status).toBe(403);
  expect((await foreign.json()).error).toBe('Request origin is not allowed');
  expect((await sheetRequest({ mode: 'dry-run', csv })).status).toBe(200);
  web.switchOn = false;
  expect((await sheetRequest({ mode: 'dry-run', csv })).status).toBe(404);
  expect((await exportRequest('GH-KE')).status).toBe(404);
  web.switchOn = true;
  // The other actions keep their 4096 octet cap.
  const invite = await POST(
    new Request(`http://localhost:3300/api/team-control/route-pack?tenant=${f.tenantA}`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3300', 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(5000) }),
    }),
    { params: Promise.resolve({ action: 'route-pack' }) },
  );
  expect(invite.status).toBe(413);
});

test('the import body is read with a running cap: a chunked body over 2 MiB stops early, and bytes that are not UTF-8 are refused', async () => {
  const chunk = new Uint8Array(65536).fill(0x20);
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= 8 * sheetLimits.octets) return controller.close();
      pulled += chunk.length;
      controller.enqueue(chunk);
    },
  });
  const large = await sheetRequest(body);
  expect(large.status).toBe(413);
  expect((await large.json()).error).toBe('Request is too large');
  expect(pulled).toBeLessThanOrEqual(2 * sheetLimits.octets + 4 * chunk.length);
  const notUtf8 = await sheetRequest(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]));
  expect(notUtf8.status).toBe(400);
  expect((await notUtf8.json()).error).toBe('Send the file as UTF-8 text');
});

test('formula safety: every risky first character is escaped on export and export then import gives no change', async () => {
  const saved = await save([
    filled('EC-PE', 'identity.origin_scope', '=SUM(1)'),
    filled('EC-PE', 'identity.destination_scope', '+1 more region'),
    filled('EC-PE', 'market.notes', '@ Guayaquil port'),
    filled('EC-PE', 'market.key_cities', '=A1 | Quito'),
    filled('EC-PE', 'custom.balance_ec_pe', '-12.5', {
      label: 'Usual balance',
      section: '10',
      type: 'number',
    }),
    filled('EC-PE', 'custom.trend_ec_pe', '=Up', {
      label: '=Trend',
      section: '16',
      type: 'choice',
      format: '=Up | -Down',
    }),
  ]);
  expect(saved.errors).toEqual([]);
  // Tab, CR and LF cannot come from the sheet, which trims plain cells, but the content service stores them as given.
  const id = (await routeId('EC-PE'))!;
  const document = await latestDocument('EC-PE');
  await content.append(owner(), {
    id: randomUUID(),
    routeId: id,
    version: 2,
    reason,
    document: {
      ...document,
      facts: [
        ...document.facts,
        ...[
          ['identity.out_of_scope', '\tTabbed text'],
          ['missions.eligibility_notes', '\rCarriage return text'],
          ['missions.typical_timeline', '\nLine feed text'],
        ].map(([key, value]) => ({
          key,
          state: 'FILLED',
          value,
          source: 'staff knowledge',
          observedOn: observed,
        })),
      ],
    },
  });
  const csv = await (await exportRequest('EC-PE')).text();
  const cells = csvRows(csv, sheetLimits.rows, 'route pack').flatMap((r) => r.cells);
  expect(cells.filter((cell) => /^[=+\-@\t\r\n]/.test(cell))).toEqual([]);
  for (const escaped of [
    "'=SUM(1)",
    "'+1 more region",
    "'@ Guayaquil port",
    "'=A1 | Quito",
    "'-12.5",
    "'=Trend",
    "'=Up | -Down",
    "'=Up",
    "'\tTabbed text",
    "'\rCarriage return text",
    "'\nLine feed text",
  ])
    expect(cells).toContain(escaped);
  const report = (await (await sheetRequest({ mode: 'dry-run', csv })).json()) as SheetReport;
  expect(report.errors).toEqual([]);
  expect(plan(report, 'EC-PE').content).toMatchObject({
    changed: false,
    added: [],
    updated: [],
    removed: [],
  });
});

test('a save that stops after writing for any reason answers 409 with the partial report, and the same file finishes it', async () => {
  const file = [
    filled('BO-EC', 'identity.display_name', 'Bolivia to Ecuador'),
    line({ route: 'BO-EC', field_key: 'pack.missionTypes', state: 'Filled', value: 'buyers' }),
  ];
  const saveId = randomUUID();
  const real = sheet;
  sheet = interruptedOnce('propose', new Error('connection reset by the database'));
  try {
    const response = await sheetRequest({ mode: 'save', csv: csvOf(file), saveId, reason });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe(sheetWords.savePartly);
    expect(body.report.saved).toEqual([
      { route: 'BO-EC', routeId: await routeId('BO-EC'), contentVersion: 1, packVersion: null },
    ]);
    expect(body.report.errors).toEqual([
      { row: null, route: 'BO-EC', key: null, message: sheetWords.saveStopped },
    ]);
    expect(JSON.stringify(body)).not.toContain('connection reset');
  } finally {
    sheet = real;
  }
  const finished = await sheetRequest({ mode: 'save', csv: csvOf(file), saveId, reason });
  expect(finished.status).toBe(201);
  expect((await latestPack('BO-EC')).version).toBe(1);
});

test('a pack row marked Pending clears its Not applicable mark, and sourcing.profile refuses a value and a Filled state without a profile', async () => {
  const na = line({
    route: 'EC-BO',
    field_key: 'pack.localities',
    state: 'Not applicable',
    note: 'No place keys on this route',
  });
  expect((await save([na])).ok).toBe(true);
  expect(fact(await latestDocument('EC-BO'), 'pack.localities')).toEqual({
    key: 'pack.localities',
    state: 'NOT_APPLICABLE',
    note: 'No place keys on this route',
  });
  const cleared = await save([
    line({ route: 'EC-BO', field_key: 'pack.localities', state: 'Pending' }),
  ]);
  expect(plan(cleared, 'EC-BO').content.removed).toEqual([
    { key: 'pack.localities', label: 'Place keys' },
  ]);
  expect(fact(await latestDocument('EC-BO'), 'pack.localities')).toBeUndefined();
  const refused = await sheet.dryRun(owner(), {
    rows: rowsOf([
      line({ route: 'EC-BO', field_key: 'sourcing.profile', state: 'Filled' }),
      line({ route: 'BO-PE', field_key: 'sourcing.profile', state: 'Pending', value: 'profile' }),
    ]),
  });
  expect(refused.errors).toEqual([
    { row: 2, route: 'EC-BO', key: 'sourcing.profile', message: sheetWords.sourcingAbsent },
    { row: 3, route: 'BO-PE', key: 'sourcing.profile', message: sheetWords.sourcingValue },
  ]);
});

test('an export of more than 20 routes says so plainly, and a custom number row carries help about codes', async () => {
  const many = Array.from({ length: 21 }, (_, i) => `R${i}-X${i}`).join('|');
  const refused = await exportRequest(many);
  expect(refused.status).toBe(400);
  expect((await refused.json()).error).toBe('Export at most 20 routes at a time.');
  const rows = csvRows(await (await exportRequest('EC-PE')).text(), sheetLimits.rows, 'route pack');
  const number = rows.find((r) => r.cells[2] === 'custom.balance_ec_pe')!;
  expect(number.cells[14]).toBe('Use text for codes with leading zeros.');
  expect(rows.find((r) => r.cells[2] === 'custom.trend_ec_pe')!.cells[14]).toBe('');
});
