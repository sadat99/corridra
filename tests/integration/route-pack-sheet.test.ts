import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command } from './access-fixture';
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
import {
  reasonWithRemovedPolicies,
  routePackWords,
  sheetColumns,
  standardFieldsV1,
} from '../../packages/domain/src/route-pack-standard';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { OperationsService } from '../../packages/missions/src/operations';
import {
  commandStepId,
  RoutePackContentService,
} from '../../packages/missions/src/route-pack-content';
import {
  RoutePackSheetService,
  sheetLimits,
  sheetWords,
  type SheetReport,
} from '../../packages/missions/src/route-pack-sheet';
import { bdCnSourcingProfile } from './fixtures/bd-cn-sourcing-profile';
import {
  checkOutcome,
  dryRunBody,
  exportFileName,
  nextSaveCommand,
  routeResults,
  saveBody,
  savedFactCount,
  sheetOutcome,
  type SaveCommand,
} from '../../apps/web/lib/route-pack-editor-sheet';

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
// Events, outbox rows, command (idempotency) rows and audit rows: a dry run adds none.
const writes = async () =>
  (
    await f.owner.query(
      `SELECT (SELECT count(*) FROM app.domain_event)::int events,(SELECT count(*) FROM app.outbox)::int outbox,
       (SELECT count(*) FROM app.operations_command)::int commands,(SELECT count(*) FROM app.audit_event)::int audit`,
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
      'SELECT id,version,status,configuration,reason FROM app.corridor_pack_version WHERE route_id=$1 ORDER BY version DESC LIMIT 1',
      [await routeId(key)],
    )
  ).rows[0];
const fact = (document: { facts: { key: string }[] }, key: string) =>
  document.facts.find((item) => item.key === key);
const plan = (report: SheetReport, route: string) => report.routes.find((r) => r.route === route)!;
type Rows = ReturnType<typeof rowsOf>;
// Follow-up per G73: a save sends back the plan fingerprint of the check that showed its plan, as the page does. The check is
// the owner's (the dry run is read only), so a refused save is refused for its own reason.
const printOf = async (rows: Rows) => (await sheet.dryRun(owner(), { rows })).planFingerprint!;
const printOfCsv = (csv: string) => printOf(csvRows(csv, sheetLimits.rows, 'route pack'));
const save = async (lines: string[][], ctx = owner(), saveId: string = randomUUID()) => {
  const rows = rowsOf(lines);
  return sheet.save(ctx, { rows, saveId, reason, planFingerprint: await printOf(rows) });
};
// The save body the page sends, with the fingerprint of a check made now unless one is given.
const saveRequest = async (csv: string, saveId: string, planFingerprint?: string) =>
  sheetRequest({
    mode: 'save',
    csv,
    saveId,
    reason,
    planFingerprint: planFingerprint ?? (await printOfCsv(csv)),
  });
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
  const writesBefore = await writes();
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
  expect(await writes()).toEqual(writesBefore);
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
  const response = await saveRequest(
    csvOf([
      good,
      filled('AR-CL', 'custom.cost_ar_cl', 'USD 45.001', {
        label: 'Cost',
        section: '9',
        type: 'money',
      }),
    ]),
    randomUUID(),
  );
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

test('on an ACTIVE route a file that turns a Filled Core field Pending saves with a warning in the dry run and the save', async () => {
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
  expect(report.ok).toBe(true);
  expect(report.errors).toEqual([]);
  expect(plan(report, 'CL-PE').goLive).toEqual({
    ok: true,
    warnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: ['identity.summary'] }],
  });
  const warning = {
    row: 2,
    route: 'CL-PE',
    key: 'identity.summary',
    code: 'ROUTE_PACK_CORE_TURNS_PENDING',
    message: 'These Core fields are now Pending on a live route: What this route is for.',
  };
  expect(report.warnings).toEqual([warning]);
  const saved = await save(file);
  expect(saved.ok).toBe(true);
  expect(saved.warnings).toEqual([warning]);
  expect(saved.saved).toEqual([
    {
      route: 'CL-PE',
      routeId: await routeId('CL-PE'),
      contentVersion: 2,
      packVersion: null,
      warnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: ['identity.summary'] }],
    },
  ]);
  expect(fact(await latestDocument('CL-PE'), 'identity.summary')).toBeUndefined();
  // Optional fields may still change on the live route, with no warning, and the status is never taken from the file.
  const optional = await save([filled('CL-PE', 'market.notes', 'Copper and fruit dominate')]);
  expect(optional.ok).toBe(true);
  expect(optional.warnings).toEqual([]);
  expect((await latestPack('CL-PE')).status).toBe('ACTIVE');
});

test('on an ACTIVE route a file cannot empty pack.languages: a Filled row without a value is refused and a Pending row keeps the list', async () => {
  expect((await save(coreLines('CL-BO'))).ok).toBe(true);
  const draft = await latestPack('CL-BO');
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: (await routeId('CL-BO'))!,
    version: draft.version + 1,
    status: 'ACTIVE',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: draft.configuration,
  });
  const before = await counts();
  const emptied = await save([
    line({ route: 'CL-BO', field_key: 'pack.languages', state: 'Filled', value: ' | ' }),
  ]);
  expect(emptied.ok).toBe(false);
  expect(emptied.errors).toEqual([
    { row: 2, route: 'CL-BO', key: 'pack.languages', message: sheetWords.filledEmpty },
  ]);
  expect(await counts()).toEqual(before);
  // A Pending row cannot clear a Filled pack setting, and the dry run and the save both say so.
  const pendingFile = [line({ route: 'CL-BO', field_key: 'pack.languages', state: 'Pending' })];
  const notCleared = [{ row: 2, key: 'pack.languages', message: sheetWords.lockedPending }];
  expect(sheetWords.lockedPending).toBe(
    'The pack keeps its current setting; the sheet cannot clear it.',
  );
  const dry = await sheet.dryRun(owner(), { rows: rowsOf(pendingFile) });
  expect(plan(dry, 'CL-BO').skipped).toEqual(notCleared);
  const pending = await save(pendingFile);
  expect(pending.ok).toBe(true);
  expect(plan(pending, 'CL-BO').pack.changed).toBe(false);
  expect(plan(pending, 'CL-BO').skipped).toEqual(notCleared);
  expect(await counts()).toEqual(before);
  expect((await latestPack('CL-BO')).configuration.languages).toEqual(['en', 'bn']);
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
  expect(report.planFingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const again = await saveRequest(csv, randomUUID(), report.planFingerprint);
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
  // Every send carries the first check's fingerprint: a later send under the same saveId is not compared, though its plan now
  // differs because of the first send's own steps.
  const planFingerprint = await printOf(file);
  const first = await interrupted.save(owner(), { rows: file, saveId, reason, planFingerprint });
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
  expect(await printOf(file)).not.toBe(planFingerprint);
  const second = await interrupted.save(owner(), { rows: file, saveId, reason, planFingerprint });
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
  expect(
    (await interrupted.save(owner(), { rows: file, saveId, reason, planFingerprint })).saved,
  ).toEqual([]);
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
          ['trade.duty_notes', "'=already quoted"],
          ['trade.preferences', '  padded value  '],
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
    "''=already quoted",
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
  // A value the editor saved with spaces at its ends comes back trimmed; the saved value is kept and the row says so.
  expect(plan(report, 'EC-PE').skipped).toEqual([
    {
      row: expect.any(Number),
      key: 'trade.preferences',
      message: sheetWords.trimKept,
    },
  ]);
});

test('a save that stops after writing for any reason answers 409 with the partial report, and the same file finishes it', async () => {
  const file = [
    filled('BO-EC', 'identity.display_name', 'Bolivia to Ecuador'),
    line({ route: 'BO-EC', field_key: 'pack.missionTypes', state: 'Filled', value: 'buyers' }),
  ];
  const saveId = randomUUID();
  const planFingerprint = await printOf(rowsOf(file));
  const real = sheet;
  sheet = interruptedOnce('propose', new Error('connection reset by the database'));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const response = await saveRequest(csvOf(file), saveId, planFingerprint);
    expect(response.status).toBe(409);
    // Logged once, with the request's correlation id and no personal data or internal message.
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      {
        event: 'route_pack_sheet_save_stopped',
        correlationId: response.headers.get('x-corridra-request-id'),
        code: null,
      },
    ]);
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
    logged.mockRestore();
  }
  const finished = await saveRequest(csvOf(file), saveId, planFingerprint);
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

test('a save that stopped after propose and before decide publishes on retry with the same file, and a changed file under that saveId is refused in plain words', async () => {
  const file = (missions: string) => [
    filled('EC-GT', 'identity.display_name', 'Ecuador to Guatemala'),
    line({ route: 'EC-GT', field_key: 'pack.missionTypes', state: 'Filled', value: missions }),
  ];
  const saveId = randomUUID();
  const before = await counts();
  const planFingerprint = await printOf(rowsOf(file('buyers')));
  const first = await interruptedOnce(
    'decide',
    new DomainError('Synthetic interruption', 503),
  ).save(owner(), { rows: rowsOf(file('buyers')), saveId, reason, planFingerprint });
  expect(first.ok).toBe(false);
  const id = await routeId('EC-GT');
  expect(first.saved).toEqual([
    { route: 'EC-GT', routeId: id, contentVersion: 1, packVersion: null },
  ]);
  const proposed = {
    ...before,
    routes: before.routes + 1,
    contents: before.contents + 1,
    proposals: before.proposals + 1,
  };
  expect(await counts()).toEqual(proposed);
  const changed = await save(file('sourcing'), owner(), saveId);
  expect(changed.ok).toBe(false);
  expect(changed.saved).toEqual([]);
  expect(changed.errors).toMatchObject([
    { row: null, route: 'EC-GT', key: null, message: sheetWords.saveReused },
  ]);
  const response = await saveRequest(csvOf(file('sourcing')), saveId);
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe(sheetWords.saveReused);
  expect(await counts()).toEqual(proposed);
  const finished = await sheet.save(owner(), {
    rows: rowsOf(file('buyers')),
    saveId,
    reason,
    planFingerprint,
  });
  expect(finished.ok).toBe(true);
  expect(finished.saved).toEqual([
    { route: 'EC-GT', routeId: id, contentVersion: null, packVersion: 1 },
  ]);
  expect((await latestPack('EC-GT')).configuration.missionTypes).toEqual(['buyers']);
  expect(await counts()).toEqual({
    ...proposed,
    packs: before.packs + 1,
    decisions: before.decisions + 1,
  });
});

test('a pack paused after the plan is not un-paused by the save: the pack step is refused as changed and the report shows the content saved', async () => {
  expect((await save(coreLines('GT-HN'))).ok).toBe(true);
  const id = (await routeId('GT-HN'))!;
  const draft = await latestPack('GT-HN');
  const statusChange = async (status: 'ACTIVE' | 'PAUSED', version: number) =>
    corridors.appendPack(owner(), {
      id: randomUUID(),
      routeId: id,
      version,
      status,
      effectiveFrom: new Date().toISOString(),
      reason,
      configuration: draft.configuration,
    });
  await statusChange('ACTIVE', draft.version + 1);
  // Someone pauses the route while this save is between its content step and its pack step.
  const racing = new Proxy(content, {
    get(target, property) {
      if (property === 'appendBatch')
        return async (
          ctx: Parameters<RoutePackContentService['appendBatch']>[0],
          input: unknown,
        ) => {
          const written = await target.appendBatch(ctx, input);
          await statusChange('PAUSED', draft.version + 2);
          return written;
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const raced = new RoutePackSheetService(f.runtime, corridors, operations, racing);
  const rows = rowsOf([
    filled('GT-HN', 'market.notes', 'Coffee and textiles'),
    line({ route: 'GT-HN', field_key: 'pack.languages', state: 'Filled', value: 'es' }),
  ]);
  const report = await raced.save(owner(), {
    rows,
    saveId: randomUUID(),
    reason,
    planFingerprint: await printOf(rows),
  });
  expect(plan(report, 'GT-HN').pack.status).toBe('ACTIVE');
  expect(report.ok).toBe(false);
  expect(report.errors).toEqual([
    {
      row: null,
      route: 'GT-HN',
      key: null,
      code: 'ROUTE_PACK_PACK_CHANGED',
      message: "This route's pack changed since you opened it. Reload and try again.",
    },
  ]);
  expect(report.saved).toEqual([
    { route: 'GT-HN', routeId: id, contentVersion: 2, packVersion: null },
  ]);
  const pack = await latestPack('GT-HN');
  expect(pack.version).toBe(draft.version + 2);
  expect(pack.status).toBe('PAUSED');
});

test('a pack published between the proposal and the decision refuses that route as changed, with its code (follow-up per G73)', async () => {
  expect((await save(coreLines('GT-BZ'))).ok).toBe(true);
  const id = (await routeId('GT-BZ'))!;
  const draft = await latestPack('GT-BZ');
  let race = true;
  // Someone publishes a pack after this save proposed its own and before the decision.
  const racing = new Proxy(operations, {
    get(target, property) {
      if (property === 'command')
        return async (
          ctx: Parameters<OperationsService['command']>[0],
          input: { action?: string },
        ) => {
          if (race && input.action === 'decide') {
            race = false;
            await corridors.appendPack(owner(), {
              id: randomUUID(),
              routeId: id,
              version: draft.version + 1,
              status: draft.status,
              effectiveFrom: new Date().toISOString(),
              reason,
              configuration: draft.configuration,
            });
          }
          return target.command(ctx, input);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const rows = rowsOf([
    filled('GT-BZ', 'market.notes', 'Coffee and sugar'),
    line({ route: 'GT-BZ', field_key: 'pack.languages', state: 'Filled', value: 'es' }),
  ]);
  const report = await new RoutePackSheetService(f.runtime, corridors, racing, content).save(
    owner(),
    { rows, saveId: randomUUID(), reason, planFingerprint: await printOf(rows) },
  );
  expect(race).toBe(false);
  expect(report.ok).toBe(false);
  expect(report.errors).toEqual([
    {
      row: null,
      route: 'GT-BZ',
      key: null,
      code: 'ROUTE_PACK_PACK_CHANGED',
      message: routePackWords.packChanged,
    },
  ]);
  expect(report.saved).toEqual([
    { route: 'GT-BZ', routeId: id, contentVersion: 2, packVersion: null },
  ]);
  expect((await latestPack('GT-BZ')).version).toBe(draft.version + 1);
});

test('follow-up per G73: a second part-way answer still names the facts the first answer wrote; once the cause is fixed the same file finishes, and once more it has nothing left', async () => {
  expect((await save(coreLines('HN-CR'))).ok).toBe(true);
  const id = (await routeId('HN-CR'))!;
  let refuse = true;
  // The decision of the pack step is refused until the cause is fixed.
  const refusing = new Proxy(operations, {
    get(target, property) {
      if (property === 'command')
        return async (
          ctx: Parameters<OperationsService['command']>[0],
          input: { action?: string },
        ) => {
          if (refuse && input.action === 'decide')
            throw new DomainError('Synthetic refusal of the decision', 409, 'FORCED');
          return target.command(ctx, input);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const refused = new RoutePackSheetService(f.runtime, corridors, refusing, content);
  const rows = rowsOf([
    filled('HN-CR', 'market.notes', 'Coffee and bananas'),
    line({ route: 'HN-CR', field_key: 'pack.languages', state: 'Filled', value: 'es' }),
  ]);
  const body = { rows, saveId: randomUUID(), reason, planFingerprint: await printOf(rows) };
  const words = `Synthetic refusal of the decision ${routePackWords.notPublished}`;
  const stopped = [
    { row: null, route: 'HN-CR', key: null, code: 'ROUTE_PACK_NOT_PUBLISHED', message: words },
  ];
  const first = await refused.save(owner(), body);
  expect(first.errors).toEqual(stopped);
  expect(first.saved).toEqual([
    { route: 'HN-CR', routeId: id, contentVersion: 2, packVersion: null },
  ]);
  const second = await refused.save(owner(), body);
  expect(plan(second, 'HN-CR').content.changed).toBe(false);
  expect(second.ok).toBe(false);
  expect(second.errors).toEqual(stopped);
  expect(second.saved).toEqual([
    { route: 'HN-CR', routeId: id, contentVersion: 2, packVersion: null },
  ]);
  // The page reads it as the facts saved and the pack refused, and counts no fact twice.
  expect(routeResults(second)).toEqual([
    { route: 'HN-CR', kind: 'factsOnly', why: 'refused', reason: words },
  ]);
  expect(savedFactCount(second)).toBe(0);
  expect(await contentVersions('HN-CR')).toBe(2);
  refuse = false;
  const finished = await refused.save(owner(), body);
  expect(finished.ok).toBe(true);
  expect(finished.saved).toEqual([
    { route: 'HN-CR', routeId: id, contentVersion: null, packVersion: 2 },
  ]);
  // A finished save sent again has nothing left: "Nothing left to save" is unchanged.
  const again = await refused.save(owner(), body);
  expect(again.ok).toBe(true);
  expect(again.saved).toEqual([]);
  expect(await contentVersions('HN-CR')).toBe(2);
  expect((await latestPack('HN-CR')).version).toBe(2);
});

test('follow-up per G73: a pack only save that stopped part way finishes after a teammate publishes a newer pack on a route it already saved, and writes nothing twice', async () => {
  expect((await save(coreLines('LT-LV'))).ok).toBe(true);
  expect((await save(coreLines('LV-EE'))).ok).toBe(true);
  const first = (await routeId('LT-LV'))!;
  const second = (await routeId('LV-EE'))!;
  const saveId = randomUUID();
  // Only the decision of the second route's pack step is refused, until the cause is fixed.
  const refusedProposal = commandStepId(commandStepId(saveId, 'LV-EE', 'pack'), 'propose');
  let refuse = true;
  const refusing = new Proxy(operations, {
    get(target, property) {
      if (property === 'command')
        return async (
          ctx: Parameters<OperationsService['command']>[0],
          input: { action?: string; proposalId?: string },
        ) => {
          if (refuse && input.action === 'decide' && input.proposalId === refusedProposal)
            throw new DomainError('Synthetic refusal of the decision', 409, 'FORCED');
          return target.command(ctx, input);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const refused = new RoutePackSheetService(f.runtime, corridors, refusing, content);
  const rows = rowsOf([
    line({ route: 'LT-LV', field_key: 'pack.languages', state: 'Filled', value: 'lt' }),
    line({ route: 'LV-EE', field_key: 'pack.languages', state: 'Filled', value: 'lv' }),
  ]);
  const body = { rows, saveId, reason, planFingerprint: await printOf(rows) };
  const report = await refused.save(owner(), body);
  expect(plan(report, 'LT-LV').content.changed).toBe(false);
  expect(plan(report, 'LV-EE').content.changed).toBe(false);
  expect(report.ok).toBe(false);
  expect(report.errors).toEqual([
    {
      row: null,
      route: 'LV-EE',
      key: null,
      code: 'ROUTE_PACK_NOT_PUBLISHED',
      message: `Synthetic refusal of the decision ${routePackWords.notPublished}`,
    },
  ]);
  expect(report.saved).toEqual([
    { route: 'LT-LV', routeId: first, contentVersion: null, packVersion: 2 },
  ]);
  // A teammate then publishes a newer pack on the route this save already wrote.
  const ours = await latestPack('LT-LV');
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: first,
    version: ours.version + 1,
    status: ours.status,
    effectiveFrom: new Date().toISOString(),
    reason: 'Published by a teammate after the first answer',
    configuration: { ...ours.configuration, languages: ['en'] },
  });
  const before = await counts();
  refuse = false;
  // Try the Rest Again: the same file and save id continue the save, so the plan is not compared with the check.
  const finished = await refused.save(owner(), body);
  expect(finished.errors).toEqual([]);
  expect(finished.ok).toBe(true);
  expect(finished.saved).toEqual([
    { route: 'LT-LV', routeId: first, contentVersion: null, packVersion: 2 },
    { route: 'LV-EE', routeId: second, contentVersion: null, packVersion: 2 },
  ]);
  // Only the second route's decision and its pack are new; the first route keeps the teammate's pack.
  expect(await counts()).toEqual({
    ...before,
    packs: before.packs + 1,
    decisions: before.decisions + 1,
  });
  expect((await latestPack('LT-LV')).version).toBe(ours.version + 1);
  expect((await latestPack('LV-EE')).configuration.languages).toEqual(['lv']);
});

test('the dry run judges go-live against the latest pack, a scheduled one included, and warns', async () => {
  expect((await save(coreLines('GT-SV'))).ok).toBe(true);
  const draft = await latestPack('GT-SV');
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: (await routeId('GT-SV'))!,
    version: draft.version + 1,
    status: 'ACTIVE',
    effectiveFrom: new Date(Date.now() + 3600000).toISOString(),
    reason,
    configuration: draft.configuration,
  });
  const report = await sheet.dryRun(owner(), {
    rows: rowsOf([line({ route: 'GT-SV', field_key: 'identity.summary', state: 'Pending' })]),
  });
  // Judged against the scheduled live pack, so the file warns; it is never refused for this.
  expect(plan(report, 'GT-SV').goLive).toEqual({
    ok: true,
    warnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: ['identity.summary'] }],
  });
  expect(report.ok).toBe(true);
  expect(report.warnings.map((w) => w.key)).toEqual(['identity.summary']);
});

test('a pack over the review size limit is a route error in the save report, and nothing is written', async () => {
  const id = await newRoute('SV-HN');
  await corridors.appendPack(owner(), {
    id: randomUUID(),
    routeId: id,
    version: 1,
    status: 'DRAFT',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: initialRouteConfiguration(initialRoutes[2]),
  });
  const keys = (prefix: string) =>
    Array.from({ length: 50 }, (_, i) =>
      `${prefix}${String(i).padStart(2, '0')}`.padEnd(70, 'x'),
    ).join(' | ');
  const file = ['localities', 'clusters', 'coverage'].map((key) =>
    line({ route: 'SV-HN', field_key: `pack.${key}`, state: 'Filled', value: keys(key[0]!) }),
  );
  const before = await counts();
  const report = await save(file);
  expect(report.ok).toBe(false);
  expect(report.saved).toEqual([]);
  expect(report.errors).toEqual([
    {
      row: null,
      route: 'SV-HN',
      key: null,
      code: 'ROUTE_PACK_TOO_LARGE',
      message: routePackWords.proposalTooLarge,
    },
  ]);
  expect(await counts()).toEqual(before);
  const response = await saveRequest(csvOf(file), randomUUID());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe(routePackWords.proposalTooLarge);
});

test('the dry run also judges the pack in force: a live pack with a scheduled pause still warns about a Core field turning Pending', async () => {
  expect((await save(coreLines('HN-NI'))).ok).toBe(true);
  const draft = await latestPack('HN-NI');
  const id = (await routeId('HN-NI'))!;
  for (const [offset, status] of [
    [1, 'ACTIVE'],
    [2, 'PAUSED'],
  ] as const)
    await corridors.appendPack(owner(), {
      id: randomUUID(),
      routeId: id,
      version: draft.version + offset,
      status,
      effectiveFrom: new Date(Date.now() + (status === 'PAUSED' ? 3600000 : 0)).toISOString(),
      reason,
      configuration: draft.configuration,
    });
  const report = await sheet.dryRun(owner(), {
    rows: rowsOf([line({ route: 'HN-NI', field_key: 'identity.summary', state: 'Pending' })]),
  });
  expect(plan(report, 'HN-NI').goLive).toEqual({
    ok: true,
    warnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: ['identity.summary'] }],
  });
});

test('an expired carried policy reference refuses the pack step of a route that is not paused, in plain words, and a paused route drops and names it', async () => {
  const policy = await f.communications.command(
    owner(),
    command('policy', {
      jurisdiction: 'DE',
      channel: 'SYNTHETIC',
      contactPurpose: 'institutional_introduction',
      basis: 'Invented policy that expires during the sheet test',
      validUntil: new Date(Date.now() + 1500).toISOString(),
      enabled: true,
    }),
  );
  const configuration = {
    ...initialRouteConfiguration(initialRoutes[2]),
    jurisdictionPolicyRefs: [policy.id],
  };
  const routes: Record<string, string> = {};
  for (const [key, status] of [
    ['NI-CR', 'DRAFT'],
    ['CR-PA', 'PAUSED'],
  ] as const) {
    routes[key] = await newRoute(key);
    await corridors.appendPack(owner(), {
      id: randomUUID(),
      routeId: routes[key]!,
      version: 1,
      status,
      effectiveFrom: new Date().toISOString(),
      reason,
      configuration,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const languages = (route: string) => [
    line({ route, field_key: 'pack.languages', state: 'Filled', value: 'es' }),
  ];
  const before = await counts();
  const refused = await save(languages('NI-CR'));
  expect(refused.ok).toBe(false);
  expect(refused.saved).toEqual([]);
  expect(refused.errors).toMatchObject([
    {
      row: null,
      route: 'NI-CR',
      key: null,
      code: 'ROUTE_PACK_POLICY_EXPIRED',
      message: expect.stringContaining('communication policy DE SYNTHETIC'),
    },
  ]);
  expect(refused.errors[0]!.message).not.toContain(policy.id);
  expect(await counts()).toEqual(before);
  const paused = await save(languages('CR-PA'));
  expect(paused.ok).toBe(true);
  expect(paused.saved).toEqual([
    {
      route: 'CR-PA',
      routeId: routes['CR-PA'],
      contentVersion: null,
      packVersion: 2,
      removedRefs: [policy.id],
    },
  ]);
  const pack = await latestPack('CR-PA');
  expect(pack.status).toBe('PAUSED');
  expect(pack.configuration).toMatchObject({ languages: ['es'], jurisdictionPolicyRefs: [] });
  // The recorded reason names what was dropped, the same words the guided form records.
  const name = refused.errors[0]!.message.match(
    /communication policy DE SYNTHETIC [a-z_]+ version \d+/,
  )![0];
  expect(pack.reason).toBe(reasonWithRemovedPolicies(reason, [name]));
  expect(pack.reason).not.toBe(reason);
});

test('with the switch on and the content marker absent, both actions answer 404 before reading or parsing anything', async () => {
  const unread = (total: number) => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled >= total) return controller.close();
          pulled += 65536;
          controller.enqueue(new Uint8Array(65536).fill(0x20));
        },
      },
      { highWaterMark: 0 },
    );
    return { body, pulled: () => pulled };
  };
  await f.owner.query(
    'ALTER FUNCTION app.route_pack_content_installed() RENAME TO route_pack_content_installed_hidden',
  );
  try {
    const malformed = await sheetRequest({ mode: 'dry-run', csv: '"unclosed' });
    expect(malformed.status).toBe(404);
    expect((await malformed.json()).error).toBe('Not found');
    const large = unread(8 * sheetLimits.octets);
    expect((await sheetRequest(large.body)).status).toBe(404);
    expect(large.pulled()).toBe(0);
    const save = unread(65536);
    expect((await sheetRequest(save.body)).status).toBe(404);
    expect(save.pulled()).toBe(0);
    // Follow-up per G73: a save body with its fingerprint is Not found just the same.
    const withPrint = await sheetRequest({
      mode: 'save',
      csv: '"unclosed',
      saveId: randomUUID(),
      reason,
      planFingerprint: 'A'.repeat(43),
    });
    expect(withPrint.status).toBe(404);
    expect((await withPrint.json()).error).toBe('Not found');
    expect((await exportRequest('x'.repeat(200))).status).toBe(404);
    const many = Array.from({ length: 25 }, (_, i) => `R${i}-X${i}`).join('|');
    expect((await exportRequest(many)).status).toBe(404);
    // The service itself answers Not found before it parses its input.
    await expect(sheet.dryRun(owner(), { rows: 'not rows' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(sheet.save(owner(), { rows: 'not rows' })).rejects.toMatchObject({ status: 404 });
    await expect(sheet.export(owner(), { routes: [] })).rejects.toMatchObject({ status: 404 });
  } finally {
    await f.owner.query(
      'ALTER FUNCTION app.route_pack_content_installed_hidden() RENAME TO route_pack_content_installed',
    );
  }
  expect((await sheetRequest({ mode: 'dry-run', csv: '"unclosed' })).status).toBe(400);
});

test('file words that name object prototype keys are ordinary text: refused as a state, a route or a field key', async () => {
  const report = await sheet.dryRun(owner(), {
    rows: rowsOf([
      line({ route: 'AR-BR', field_key: 'identity.summary', state: 'constructor', value: 'x' }),
      line({ route: 'AR-BR', field_key: 'identity.summary', state: '__proto__', value: 'x' }),
      filled('__proto__', 'identity.summary', 'Synthetic'),
      filled('constructor', 'identity.summary', 'Synthetic'),
      filled('AR-BR', '__proto__', 'Synthetic'),
      filled('AR-BR', 'constructor', 'Synthetic'),
      filled('AR-BR', 'section', 'Synthetic', {
        section: '__proto__',
        state: 'Not applicable',
        note: 'none',
      }),
    ]),
  });
  expect(
    report.errors
      .map(({ row, message }) => ({ row, message }))
      .sort((a, b) => (a.row ?? 0) - (b.row ?? 0)),
  ).toEqual([
    { row: 2, message: sheetWords.state },
    { row: 3, message: sheetWords.state },
    { row: 4, message: sheetWords.route },
    { row: 5, message: sheetWords.route },
    { row: 6, message: routePackWords.unknownKey('__proto__') },
    { row: 7, message: routePackWords.unknownKey('constructor') },
    { row: 8, message: routePackWords.sectionName },
  ]);
});

test('a save interrupted by a thrown null after a write still returns the partial report', async () => {
  const file = rowsOf([
    filled('CR-NI', 'identity.display_name', 'Costa Rica to Nicaragua'),
    line({ route: 'CR-NI', field_key: 'pack.missionTypes', state: 'Filled', value: 'buyers' }),
  ]);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const report = await interruptedOnce('propose', null as unknown as Error).save(owner(), {
      rows: file,
      saveId: randomUUID(),
      reason,
      planFingerprint: await printOf(file),
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([
      { row: null, route: 'CR-NI', key: null, message: sheetWords.saveStopped },
    ]);
    expect(report.saved).toEqual([
      { route: 'CR-NI', routeId: await routeId('CR-NI'), contentVersion: 1, packVersion: null },
    ]);
    expect(JSON.parse(String(logged.mock.calls[0]![0]))).toMatchObject({ code: null });
  } finally {
    logged.mockRestore();
  }
});

// ---- ADR-093 Phase 3, PR 4: the page's bodies and readings through the real handler. Red before PR 4: the library did not exist.
const pageCheck = async (csv: string) => {
  const response = await sheetRequest(dryRunBody(csv));
  return { status: response.status, outcome: checkOutcome(response.status, await response.json()) };
};
// The page sends the fingerprint of the check it showed; given none, a check is made now (as the owner, read only).
const pageSave = async (csv: string, command: SaveCommand, planFingerprint?: string) => {
  const response = await sheetRequest(
    saveBody(csv, command, `  ${reason}  `, planFingerprint ?? (await printOfCsv(csv))),
  );
  const json = await response.json();
  return { status: response.status, json, outcome: sheetOutcome(response.status, json) };
};
const contentVersions = async (key: string) =>
  (
    await f.owner.query('SELECT count(*)::int n FROM app.route_pack_content WHERE route_id=$1', [
      await routeId(key),
    ])
  ).rows[0].n as number;

test('PR 4: the page bodies pass the server schema; one save id per file text, and sending it again adds nothing', async () => {
  const csv = csvOf([filled('NO-SE', 'identity.display_name', 'Norway to Sweden')]);
  const check = await pageCheck(csv);
  expect(check.status).toBe(200);
  expect(check.outcome.kind).toBe('report');
  const command = nextSaveCommand(null, csv, randomUUID);
  const first = await pageSave(csv, command);
  expect(first.status).toBe(201);
  expect(first.outcome.kind).toBe('saved');
  if (first.outcome.kind === 'saved') expect(savedFactCount(first.outcome.report)).toBe(1);
  const before = await counts();
  const kept = nextSaveCommand(command, csv, randomUUID);
  expect(kept.id).toBe(command.id);
  const again = await pageSave(csv, kept);
  expect(again.status).toBe(201);
  expect(await counts()).toEqual(before);
  // One word more than the schema knows is refused, so the page can only send what the server reads.
  const extra = await sheetRequest({ ...dryRunBody(csv), routes: 'NO-SE' });
  expect(extra.status).toBe(400);
  // A file the server refuses as a whole is a file problem in its own words.
  const malformed = await pageCheck('"unclosed');
  expect(malformed.status).toBe(400);
  expect(malformed.outcome.kind).toBe('fileProblem');
});

test('PR 4: an export decoded as the browser reads it and checked again changes nothing', async () => {
  expect(
    (await save([...coreLines('FI-EE'), filled('FI-EE', 'identity.origin_scope', '=SUM(1)')])).ok,
  ).toBe(true);
  const response = await exportRequest('FI-EE');
  expect(response.status).toBe(200);
  expect(exportFileName(response.headers.get('content-disposition'))).toBe(
    `route-packs-${new Date().toISOString().slice(0, 10)}.csv`,
  );
  const csv = new TextDecoder('utf-8').decode(await response.arrayBuffer());
  const check = await pageCheck(csv);
  expect(check.outcome.kind).toBe('report');
  if (check.outcome.kind !== 'report') return;
  expect(check.outcome.report.errors).toEqual([]);
  expect(check.outcome.report.routes.length).toBeGreaterThan(0);
  for (const plan of check.outcome.report.routes) {
    expect(plan.content.changed).toBe(false);
    expect(plan.pack.changed).toBe(false);
  }
});

test('PR 4: a save that stopped part way reads as part way with the route not saved, and the same body finishes it once', async () => {
  const csv = csvOf([
    filled('DK-IS', 'identity.display_name', 'Denmark to Iceland'),
    line({ route: 'DK-IS', field_key: 'pack.missionTypes', state: 'Filled', value: 'buyers' }),
  ]);
  const command = nextSaveCommand(null, csv, randomUUID);
  const planFingerprint = await printOfCsv(csv);
  const real = sheet;
  sheet = interruptedOnce('propose', new DomainError('Synthetic interruption', 503));
  let stopped;
  try {
    stopped = await pageSave(csv, command, planFingerprint);
  } finally {
    sheet = real;
  }
  expect(stopped.status).toBe(409);
  expect(stopped.outcome.kind).toBe('partWay');
  if (stopped.outcome.kind !== 'partWay') return;
  // PR 4 per G72: the facts were written before the pack step stopped, so the route reads "facts saved", not "not saved".
  expect(routeResults(stopped.outcome.report)).toEqual([
    { route: 'DK-IS', kind: 'factsOnly', why: 'refused', reason: 'Synthetic interruption' },
  ]);
  expect(savedFactCount(stopped.outcome.report)).toBe(1);
  expect(await contentVersions('DK-IS')).toBe(1);
  const finished = await pageSave(csv, nextSaveCommand(command, csv, randomUUID), planFingerprint);
  expect(finished.status).toBe(201);
  expect(finished.outcome.kind).toBe('saved');
  expect(await contentVersions('DK-IS')).toBe(1);
  expect((await latestPack('DK-IS')).version).toBe(1);
});

test('PR 4: a pack changed between the plan and its step reads as that route changed', async () => {
  expect((await save(coreLines('PT-ES'))).ok).toBe(true);
  const id = (await routeId('PT-ES'))!;
  const draft = await latestPack('PT-ES');
  const racing = new Proxy(content, {
    get(target, property) {
      if (property === 'appendBatch')
        return async (
          ctx: Parameters<RoutePackContentService['appendBatch']>[0],
          input: unknown,
        ) => {
          const written = await target.appendBatch(ctx, input);
          await corridors.appendPack(owner(), {
            id: randomUUID(),
            routeId: id,
            version: draft.version + 1,
            status: 'PAUSED',
            effectiveFrom: new Date().toISOString(),
            reason,
            configuration: draft.configuration,
          });
          return written;
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const csv = csvOf([
    filled('PT-ES', 'market.notes', 'Cork and textiles'),
    line({ route: 'PT-ES', field_key: 'pack.languages', state: 'Filled', value: 'es' }),
  ]);
  const real = sheet;
  sheet = new RoutePackSheetService(f.runtime, corridors, operations, racing);
  let raced;
  try {
    raced = await pageSave(csv, nextSaveCommand(null, csv, randomUUID));
  } finally {
    sheet = real;
  }
  expect(raced.status).toBe(409);
  expect(raced.outcome).toMatchObject({ kind: 'routeChanged', route: 'PT-ES' });
});

// Follow-up per G73: the first send of a save id is compared with the plan the check showed (this replaces the PR 4 rule, per
// Guardian G72, that the file value wins over a change made in between).
const savedBetween = async (key: string) => {
  const id = (await routeId(key))!;
  const [view] = (await content.overview(owner(), { routeIds: [id] })).routes;
  await content.append(owner(), {
    id: randomUUID(),
    routeId: id,
    version: view!.content!.version + 1,
    document: {
      standardVersion: 1,
      sectionMarks: [],
      facts: [
        {
          key: 'market.notes',
          state: 'FILLED',
          value: 'Notes saved in between',
          source: 'staff knowledge',
          observedOn: observed,
        },
      ],
    },
    reason: 'Saved between the check and the save',
  });
  return id;
};
test('follow-up per G73: a change made between the check and the save is 409 ROUTE_PACK_PLAN_CHANGED with nothing written; checked again, the file saves and History keeps both', async () => {
  expect((await save([filled('MA-TN', 'market.notes', 'First notes')])).ok).toBe(true);
  const csv = csvOf([filled('MA-TN', 'market.notes', 'Notes from the file')]);
  const check = await pageCheck(csv);
  expect(check.outcome.kind).toBe('report');
  if (check.outcome.kind !== 'report') return;
  const checked = check.outcome.report.planFingerprint;
  expect(checked).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // Someone saves the same route's facts after the check.
  const id = await savedBetween('MA-TN');
  const before = await counts();
  const writesBefore = await writes();
  const refused = await pageSave(csv, nextSaveCommand(null, csv, randomUUID), checked);
  expect(refused.status).toBe(409);
  expect(refused.json).toMatchObject({
    code: 'ROUTE_PACK_PLAN_CHANGED',
    error: sheetWords.planChanged,
  });
  expect(refused.json).not.toHaveProperty('report');
  expect(refused.outcome).toEqual({ kind: 'routeChanged', route: null, report: null });
  expect(await counts()).toEqual(before);
  expect(await writes()).toEqual(writesBefore);
  expect(fact(await latestDocument('MA-TN'), 'market.notes')).toMatchObject({
    value: 'Notes saved in between',
  });
  // Recovery: check again, then the save writes the file's value and History keeps both.
  const again = await pageCheck(csv);
  if (again.outcome.kind !== 'report') throw new Error('The second check did not finish');
  expect(again.outcome.report.planFingerprint).not.toBe(checked);
  const saved = await pageSave(
    csv,
    nextSaveCommand(null, csv, randomUUID),
    again.outcome.report.planFingerprint,
  );
  expect(saved.status).toBe(201);
  expect(saved.outcome.kind).toBe('saved');
  expect(fact(await latestDocument('MA-TN'), 'market.notes')).toMatchObject({
    value: 'Notes from the file',
  });
  const history = await content.history(owner(), { routeId: id });
  expect(history.map((row) => row.reason)).toEqual([
    reason,
    'Saved between the check and the save',
    reason,
  ]);
});

test('follow-up per G73: a check then a save with nothing changed in between saves; the same fingerprint is the same plan', async () => {
  const csv = csvOf([filled('MA-DZ', 'identity.display_name', 'Morocco to Algeria')]);
  const first = await pageCheck(csv);
  const second = await pageCheck(csv);
  if (first.outcome.kind !== 'report' || second.outcome.kind !== 'report')
    throw new Error('A check did not finish');
  expect(second.outcome.report.planFingerprint).toBe(first.outcome.report.planFingerprint);
  const saved = await pageSave(
    csv,
    nextSaveCommand(null, csv, randomUUID),
    first.outcome.report.planFingerprint,
  );
  expect(saved.status).toBe(201);
  expect(saved.outcome.kind).toBe('saved');
});

test('follow-up per G73: a save without a fingerprint, or with one that is not well formed, is 400 with nothing written; with the check fingerprint it saves', async () => {
  const csv = csvOf([filled('TN-LY', 'identity.display_name', 'Tunisia to Libya')]);
  const before = await counts();
  const writesBefore = await writes();
  const missing = await sheetRequest({ mode: 'save', csv, saveId: randomUUID(), reason });
  expect(missing.status).toBe(400);
  for (const planFingerprint of ['short', 'A'.repeat(44), `${'A'.repeat(42)}=`, 7]) {
    const malformed = await sheetRequest({
      mode: 'save',
      csv,
      saveId: randomUUID(),
      reason,
      planFingerprint,
    });
    expect(malformed.status).toBe(400);
  }
  await expect(
    sheet.save(owner(), {
      rows: csvRows(csv, sheetLimits.rows, 'route pack'),
      saveId: randomUUID(),
      reason,
    }),
  ).rejects.toMatchObject({ name: 'ZodError' });
  expect(await counts()).toEqual(before);
  expect(await writes()).toEqual(writesBefore);
  expect((await saveRequest(csv, randomUUID())).status).toBe(201);
});

test('follow-up per G73: a stale authenticator check is 401 and writes nothing; after a fresh one the same body with the same fingerprint saves', async () => {
  const csv = csvOf([filled('LY-EG', 'identity.display_name', 'Libya to Egypt')]);
  const check = await pageCheck(csv);
  if (check.outcome.kind !== 'report') throw new Error('The check did not finish');
  const command = nextSaveCommand(null, csv, randomUUID);
  const before = await counts();
  await f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '1 hour'");
  const stale = await pageSave(csv, command, check.outcome.report.planFingerprint);
  expect(stale.status).toBe(401);
  expect(stale.outcome).toEqual({ kind: 'stepUp' });
  expect(await counts()).toEqual(before);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  const saved = await pageSave(csv, command, check.outcome.report.planFingerprint);
  expect(saved.status).toBe(201);
  expect(saved.outcome.kind).toBe('saved');
});

test('PR 4: the admin checks and is refused the save; a stale authenticator reads as the check to ask again', async () => {
  await changeMemberNow(new AccessService(f.runtime), owner(), {
    userId: f.users.viewer.id,
    role: 'admin',
    revoked: false,
  });
  const csv = csvOf([filled('SN-ML', 'identity.display_name', 'Senegal to Mali')]);
  web.actor = 'viewer';
  expect((await pageCheck(csv)).status).toBe(200);
  const before = await counts();
  const denied = await pageSave(csv, nextSaveCommand(null, csv, randomUUID));
  expect(denied.status).toBe(403);
  expect(denied.outcome).toEqual({ kind: 'denied' });
  web.actor = 'owner';
  await f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '1 hour'");
  const stale = await pageSave(csv, nextSaveCommand(null, csv, randomUUID));
  expect(stale.status).toBe(401);
  expect(stale.outcome).toEqual({ kind: 'stepUp' });
  expect(await counts()).toEqual(before);
});

test('PR 4: a member of another workspace is refused the check, the save and the export', async () => {
  const csv = csvOf([filled('NO-SE', 'identity.display_name', 'Norway to Sweden')]);
  web.actor = 'other';
  const before = await counts();
  expect((await pageCheck(csv)).status).toBe(403);
  const save = await pageSave(csv, nextSaveCommand(null, csv, randomUUID));
  expect(save.status).toBe(403);
  expect(JSON.stringify(save.json)).not.toContain('Norway');
  const exported = await exportRequest('NO-SE');
  expect(exported.status).toBe(403);
  expect(await exported.text()).not.toContain('identity.display_name');
  expect(await counts()).toEqual(before);
});
