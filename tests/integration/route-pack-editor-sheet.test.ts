import { describe, expect, test } from 'vitest';
import { csvCell } from '../../packages/auth/src/customer-programme-export-csv';
import { csvRows } from '../../packages/delivery/src/import';
import { blankSheetRows, standardFieldsV1 } from '../../packages/domain/src/route-pack-standard';
import {
  sheetLimits,
  sheetWords,
  type SheetReport,
  type SheetRoutePlan,
} from '../../packages/missions/src/route-pack-sheet';
import {
  checkOutcome,
  doneRoutes,
  dryRunBody,
  exportFileName,
  exportRoutes,
  fileRefusal,
  nextSaveCommand,
  notSaved,
  onlyPendingCustom,
  packFieldLabels,
  pendingCustomWords,
  problemItems,
  routeDone,
  saveBody,
  savedFactCount,
  sheetFileLimit,
  sheetOutcome,
  sheetRouteLimit,
  skippedRows,
} from '../../apps/web/lib/route-pack-editor-sheet';
import {
  blankTemplate,
  csvText,
  problemList,
} from '../../apps/web/app/operator/route-pack-sheet-files';

// ADR-093 Phase 3, PR 4: the page's side of route-pack-import and route-pack-export. Pure: no network, no page. The bodies go
// through the real handler in route-pack-sheet.test.ts; here the constants are pinned to the server's and every answer the
// server can give is read. Red before PR 4: the library did not exist.
let n = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const change = (key: string) => ({ key, label: key });
const routePlan = (route: string, over: Partial<SheetRoutePlan> = {}): SheetRoutePlan => ({
  route,
  routeId: null,
  willBeAdded: false,
  pack: { changed: false, changedFields: [], status: 'DRAFT', nextVersion: null },
  content: {
    changed: true,
    nextVersion: 2,
    added: [change('a'), change('b')],
    updated: [change('c')],
    removed: [],
    sectionMarks: { added: [], removed: [] },
  },
  skipped: [],
  completeness: { pendingCore: [], pendingOptionalCount: 0 },
  goLive: { ok: true, warnings: [] } as unknown as SheetRoutePlan['goLive'],
  ...over,
});
const report = (over: Partial<SheetReport> = {}): SheetReport => ({
  mode: 'save',
  ok: true,
  errors: [],
  warnings: [],
  routes: [],
  readinessInvalidated: false,
  ...over,
});

describe('constants agree with the server', () => {
  test('limits and the Pending custom words', () => {
    expect(sheetFileLimit).toBe(sheetLimits.octets);
    expect(sheetRouteLimit).toBe(sheetLimits.routes);
    expect(pendingCustomWords).toBe(sheetWords.pendingCustom);
  });
});

describe('a file is refused before upload', () => {
  test('by name or type, then by size', () => {
    expect(fileRefusal({ name: 'routes.csv', type: '', size: 10 })).toBeNull();
    expect(fileRefusal({ name: 'ROUTES.CSV', type: '', size: 10 })).toBeNull();
    expect(fileRefusal({ name: 'routes', type: 'text/csv', size: 10 })).toBeNull();
    expect(fileRefusal({ name: 'routes.xlsx', type: 'application/vnd.ms-excel', size: 10 })).toBe(
      'type',
    );
    expect(fileRefusal({ name: 'routes.csv.txt', type: 'text/plain', size: 10 })).toBe('type');
    expect(
      fileRefusal({ name: 'routes.csv', type: 'text/csv', size: sheetLimits.octets }),
    ).toBeNull();
    expect(
      fileRefusal({ name: 'routes.csv', type: 'text/csv', size: sheetLimits.octets + 1 }),
    ).toBe('size');
  });
});

describe('bodies and the save id', () => {
  test('a check carries the file only; a save carries the kept id and the trimmed reason', () => {
    expect(dryRunBody('a,b')).toEqual({ mode: 'dry-run', csv: 'a,b' });
    const command = nextSaveCommand(null, 'a,b', makeId);
    expect(saveBody('a,b', command, '  Yearly review  ')).toEqual({
      mode: 'save',
      csv: 'a,b',
      saveId: command.id,
      reason: 'Yearly review',
    });
  });
  test('the same file text keeps its id; another file makes a new one', () => {
    const first = nextSaveCommand(null, 'one', makeId);
    expect(nextSaveCommand(first, 'one', makeId)).toBe(first);
    const second = nextSaveCommand(first, 'two', makeId);
    expect(second.id).not.toBe(first.id);
    expect(second.csv).toBe('two');
  });
});

describe('what an answer means', () => {
  test('a check: a report, a file problem in the server words, or a check that did not finish', () => {
    const dry = report({ mode: 'dry-run', routes: [routePlan('NO-SE')] });
    expect(checkOutcome(200, dry)).toEqual({ kind: 'report', report: dry });
    expect(checkOutcome(200, { nope: true })).toEqual({ kind: 'failed' });
    expect(checkOutcome(400, { error: sheetWords.rows })).toEqual({
      kind: 'fileProblem',
      message: sheetWords.rows,
    });
    expect(checkOutcome(413, { error: sheetWords.octets })).toEqual({
      kind: 'fileProblem',
      message: sheetWords.octets,
    });
    expect(checkOutcome(413, null)).toEqual({ kind: 'fileProblem', message: null });
    for (const status of [401, 403, 404, 500, 502])
      expect(checkOutcome(status, {})).toEqual({ kind: 'failed' });
  });

  test('a save: every outcome the server can give', () => {
    const saved = report({ routes: [routePlan('NO-SE')], saved: [] });
    expect(sheetOutcome(201, saved)).toEqual({ kind: 'saved', report: saved });
    expect(sheetOutcome(201, report())).toEqual({ kind: 'offline' });
    const refused = report({
      ok: false,
      errors: [{ row: 3, route: 'NO-SE', key: 'a', message: 'x' }],
    });
    expect(sheetOutcome(409, { error: sheetWords.saveErrors, report: refused })).toEqual({
      kind: 'problems',
      report: refused,
    });
    for (const code of ['ROUTE_PACK_PACK_CHANGED', 'ROUTE_PACK_CONTENT_CHANGED']) {
      const changed = report({
        ok: false,
        saved: [],
        errors: [{ row: null, route: 'FI-EE', key: null, message: 'changed', code }],
      });
      expect(sheetOutcome(409, { error: 'changed', report: changed })).toEqual({
        kind: 'routeChanged',
        route: 'FI-EE',
        report: changed,
      });
    }
    // Nothing written yet, the facts of a route changed: the server sends its refusal without a report.
    expect(sheetOutcome(409, { error: 'changed', code: 'ROUTE_PACK_CONTENT_CHANGED' })).toEqual({
      kind: 'routeChanged',
      route: null,
      report: null,
    });
    const reused = report({
      ok: false,
      saved: [],
      errors: [
        {
          row: null,
          route: null,
          key: null,
          message: sheetWords.saveReused,
          code: 'ROUTE_PACK_COMMAND_REUSED',
        },
      ],
    });
    expect(sheetOutcome(409, { error: sheetWords.saveReused, report: reused })).toEqual({
      kind: 'reused',
      report: reused,
    });
    const partWay = report({
      ok: false,
      routes: [routePlan('NO-SE'), routePlan('FI-EE')],
      saved: [{ route: 'NO-SE', routeId: 'r', contentVersion: 2, packVersion: null }],
      errors: [{ row: null, route: 'FI-EE', key: null, message: sheetWords.saveStopped }],
    });
    expect(sheetOutcome(409, { error: sheetWords.savePartly, report: partWay })).toEqual({
      kind: 'partWay',
      report: partWay,
    });
    expect(sheetOutcome(409, { error: 'The record changed. Refresh and try again.' })).toEqual({
      kind: 'offline',
    });
    expect(sheetOutcome(401, { code: 'STEP_UP_REQUIRED' })).toEqual({ kind: 'stepUp' });
    expect(sheetOutcome(401, { error: 'Sign in' })).toEqual({ kind: 'signedOut' });
    expect(sheetOutcome(403, {})).toEqual({ kind: 'denied' });
    expect(sheetOutcome(404, {})).toEqual({ kind: 'notFound' });
    expect(sheetOutcome(400, { error: 'Check the submitted values' })).toEqual({
      kind: 'refused',
      message: 'Check the submitted values',
    });
    expect(sheetOutcome(500, {})).toEqual({ kind: 'offline' });
    expect(sheetOutcome(201, 'not json')).toEqual({ kind: 'offline' });
  });
});

describe('reading a report', () => {
  test('a route is done when each step it needs is written', () => {
    const both = routePlan('NO-SE', {
      pack: { changed: true, changedFields: ['languages'], status: 'DRAFT', nextVersion: 2 },
    });
    expect(routeDone(both, undefined)).toBe(false);
    expect(
      routeDone(both, { route: 'NO-SE', routeId: 'r', contentVersion: 2, packVersion: null }),
    ).toBe(false);
    expect(
      routeDone(both, { route: 'NO-SE', routeId: 'r', contentVersion: 2, packVersion: 2 }),
    ).toBe(true);
    const packOnly = routePlan('NO-SE', {
      pack: both.pack,
      content: { ...both.content, changed: false },
    });
    expect(
      routeDone(packOnly, { route: 'NO-SE', routeId: 'r', contentVersion: null, packVersion: 2 }),
    ).toBe(true);
    // Nothing to write: done without a saved entry.
    expect(
      routeDone(routePlan('NO-SE', { content: { ...both.content, changed: false } }), undefined),
    ).toBe(true);
  });

  test('part way: the route it stopped at has the server words, a later one was not tried; facts are counted', () => {
    const partWay = report({
      ok: false,
      routes: [routePlan('NO-SE'), routePlan('FI-EE'), routePlan('DK-IS')],
      saved: [{ route: 'NO-SE', routeId: 'r', contentVersion: 2, packVersion: null }],
      errors: [{ row: null, route: 'FI-EE', key: null, message: 'Saving this route stopped.' }],
    });
    expect(doneRoutes(partWay)).toEqual(['NO-SE']);
    expect(notSaved(partWay)).toEqual([
      { route: 'FI-EE', reason: 'Saving this route stopped.' },
      { route: 'DK-IS', reason: null },
    ]);
    expect(savedFactCount(partWay)).toBe(3);
    expect(savedFactCount(report({ routes: [routePlan('NO-SE')], saved: [] }))).toBe(0);
  });

  test('problems: the whole file first, then by row in a stable order, rows counted once', () => {
    const errors = [
      { row: 14, route: 'NO-SE', key: 'pack.languages', message: 'second' },
      { row: 3, route: 'NO-SE', key: 'custom.port_fee', message: 'first' },
      { row: null, route: null, key: null, message: 'file' },
      { row: 14, route: 'NO-SE', key: null, message: 'third' },
    ];
    const labels: Record<string, string> = { 'pack.languages': 'Working languages' };
    const { items, rows } = problemItems(errors, (key) => labels[key] ?? key);
    expect(items.map((item) => item.message)).toEqual(['file', 'first', 'second', 'third']);
    expect(items[1]).toEqual({
      row: 3,
      route: 'NO-SE',
      label: 'custom.port_fee',
      message: 'first',
    });
    expect(items[2]!.label).toBe('Working languages');
    expect(items[3]!.label).toBeNull();
    expect(rows).toBe(2);
  });

  test('skipped rows by row; one line when every one is a Pending custom row', () => {
    const plan = report({
      routes: [
        routePlan('NO-SE', { skipped: [{ row: 9, key: 'custom.a', message: pendingCustomWords }] }),
        routePlan('FI-EE', { skipped: [{ row: 4, key: 'custom.b', message: pendingCustomWords }] }),
      ],
    });
    expect(skippedRows(plan).map((skip) => [skip.row, skip.route])).toEqual([
      [4, 'FI-EE'],
      [9, 'NO-SE'],
    ]);
    expect(onlyPendingCustom(skippedRows(plan))).toBe(true);
    expect(
      onlyPendingCustom([{ message: pendingCustomWords }, { message: sheetWords.trimKept }]),
    ).toBe(false);
  });

  test('pack settings by their dictionary labels', () => {
    const languages = standardFieldsV1.find((field) => field.configurationKey === 'languages')!;
    expect(packFieldLabels(['languages', 'unknownKey'], standardFieldsV1)).toEqual([
      languages.label,
      'unknownKey',
    ]);
  });

  test('the export file name and routes', () => {
    expect(exportFileName('attachment; filename=route-packs-2026-11-26.csv')).toBe(
      'route-packs-2026-11-26.csv',
    );
    expect(exportFileName('attachment; filename="route-packs-2026-11-26.csv"')).toBe(
      'route-packs-2026-11-26.csv',
    );
    expect(exportFileName(null)).toBeNull();
    expect(exportFileName('attachment')).toBeNull();
    expect(exportRoutes(['BD-CN', 'CN-BD'])).toBe('BD-CN|CN-BD');
  });
});

describe('files made in the page', () => {
  test('the blank template is the domain template, written as the server writes', () => {
    const text = blankTemplate('NO-SE');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text).toBe(
      '﻿' +
        blankSheetRows('NO-SE')
          .map((row) => row.map((cell) => csvCell(cell)).join(','))
          .join('\r\n') +
        '\r\n',
    );
    expect(csvRows(text, sheetLimits.rows, 'route pack').map((row) => row.cells)).toEqual(
      blankSheetRows('NO-SE'),
    );
  });

  test('the problem list escapes formula-like cells and quotes', () => {
    const risky = ['=1+1', '+1', '-1', '@x', '\tx', '\rx', 'say "no", then'];
    const text = problemList(
      risky.map((message, i) => ({ row: i + 1, route: 'NO-SE', label: 'Label', message })),
    );
    const [head, ...lines] = csvRows(text, 100, 'problem').map((row) => row.cells);
    expect(head).toEqual(['row', 'route', 'field', 'problem']);
    expect(lines.map((cells) => cells[3])).toEqual([
      "'=1+1",
      "'+1",
      "'-1",
      "'@x",
      "'\tx",
      "'\rx",
      'say "no", then',
    ]);
    expect(problemList([{ row: null, route: null, label: null, message: 'file' }])).toBe(
      csvText([
        ['row', 'route', 'field', 'problem'],
        ['', '', '', 'file'],
      ]),
    );
  });
});
