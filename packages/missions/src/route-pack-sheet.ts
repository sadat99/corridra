import { z } from 'zod';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { routeConfiguration, type RouteConfiguration } from '@corridra/domain/corridors';
import { currency, formatMoney, parseMoney } from '@corridra/domain/opportunities';
import {
  carriedConfiguration,
  contentDocumentIssues,
  customKeyConflicts,
  deriveCompleteness,
  factSource,
  factTypes,
  goLiveMessage,
  latestCustomLabels,
  reasonWithRemovedPolicies,
  routePackSections,
  routePackWords,
  sheetColumns,
  sheetLockedKeys,
  standardFieldByKey,
  sectionFromName,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
  type FactType,
  type GoLiveResult,
  type GoLiveWarning,
  type PackStatus,
  type PackView,
} from '@corridra/domain/route-pack-standard';
import type { CorridorService } from './corridors';
import { changedPackFields, type OperationsService } from './operations';
import {
  commandStepId,
  judge,
  judgedPacks,
  loadRoutePackState,
  routePackContentActive,
  type RoutePackContentService,
} from './route-pack-content';
import { publishReviewed } from './route-pack-form';

// ADR-093 G, Phase 2c: the route pack sheet. One long sheet, one row per route and field, read as a dry run first and saved
// only when the dry run has no error. The web route parses the CSV text (missions cannot import delivery) and passes the cells.
// The sheet never sets a pack status: the status is carried from the current pack, DRAFT for a new route.
export const sheetLimits = { octets: 1048576, rows: 5000, routes: 20 } as const;
export type SheetIssue = {
  row: number | null;
  route: string | null;
  key: string | null;
  message: string;
  // Set on a save step's refusal that carries one, for example ROUTE_PACK_PACK_CHANGED.
  code?: string;
};
type FieldChange = { key: string; label: string };
export type SheetRoutePlan = {
  route: string;
  routeId: string | null;
  willBeAdded: boolean;
  pack: {
    changed: boolean;
    changedFields: string[];
    status: PackStatus;
    nextVersion: number | null;
  };
  content: {
    changed: boolean;
    nextVersion: number;
    added: FieldChange[];
    updated: FieldChange[];
    removed: FieldChange[];
    sectionMarks: { added: number[]; removed: number[] };
  };
  skipped: { row: number; key: string; message: string }[];
  completeness: { pendingCore: string[]; pendingOptionalCount: number };
  goLive: GoLiveResult;
};
export type SheetReport = {
  mode: 'dry-run' | 'save';
  ok: boolean;
  errors: SheetIssue[];
  // Go-live warnings (ADR-093 C, warn only): a Core field Pending on a route going or staying live. They never block a save.
  warnings: SheetIssue[];
  routes: SheetRoutePlan[];
  readinessInvalidated: boolean;
  saved?: {
    route: string;
    routeId: string;
    contentVersion: number | null;
    packVersion: number | null;
    // Expired policy references a pack moved to PAUSED no longer carries.
    removedRefs?: string[];
    // The go-live warnings the content and pack writes returned.
    warnings?: GoLiveWarning[];
  }[];
};
type SheetState = 'FILLED' | 'NOT_APPLICABLE' | 'PENDING';
export type SheetRow = {
  row: number;
  routes: string[];
  section: string;
  key: string;
  label: string;
  type: string;
  format: string;
  state: SheetState;
  value: string;
  source: string;
  observedOn: string;
  validUntil: string;
  note: string;
};
const cellRows = z
  .array(z.object({ row: z.int().positive(), cells: z.array(z.string()) }).strict())
  .min(1);
const saveInput = z
  .object({
    rows: cellRows,
    saveId: z.uuid(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const exportInput = z
  .object({
    routes: z.array(z.string().max(40)).min(1).max(1000),
  })
  .strict();

export const sheetWords = {
  empty: 'The file has no rows. Start from an export or the template.',
  header: (missing: string[], unknown: string[], repeated: string[]) =>
    `The first row must name these 15 columns once each: ${sheetColumns.join(', ')}.` +
    (missing.length ? ` Missing: ${missing.join(', ')}.` : '') +
    (unknown.length ? ` Not a column: ${unknown.join(', ')}.` : '') +
    (repeated.length ? ` Repeated: ${repeated.join(', ')}.` : ''),
  rows: `Use at most ${sheetLimits.rows} route pack rows`,
  octets: 'The file is larger than 1 MiB. Split it into smaller files.',
  routes: `A file may name at most ${sheetLimits.routes} routes. Split it into smaller files.`,
  exportRoutes: `Export at most ${sheetLimits.routes} routes at a time.`,
  route: 'Write the route as ORIGIN-DESTINATION with market keys, for example BD-CN.',
  market: (route: string) =>
    `${route} is not a route between two different markets. Use market keys such as BD, CN, EU or GB.`,
  noKey: 'Fill field_key.',
  state: 'Write the state as Filled, Not applicable or Pending.',
  date: 'Write dates as YYYY-MM-DD.',
  sectionFilled: 'A section row can be Not applicable or Pending, not Filled.',
  repeatedState: 'Repeated rows of one field must have the same state.',
  repeatedType: 'Only a list field may repeat on more rows. Put one value in one row.',
  repeatedSource:
    'Repeated rows of one field have different sources. Use one source, or leave it empty on the later rows.',
  filledEmpty: 'A filled row needs a value. Use Pending to leave the field out.',
  lockedValue: 'This value is not accepted by the route pack. Check the format column.',
  sourcingValue:
    'Leave the value of sourcing.profile empty. The profile is entered through the pack.',
  sourcingAbsent:
    'This route pack has no sourcing profile, so sourcing.profile cannot be Filled. Use Pending or Not applicable.',
  pendingCustom: 'Skipped: a Pending row does not create a custom field.',
  trimKept:
    'Only spaces at the start or end of this value differ from the saved one, so the saved value is kept.',
  lockedPending: 'A pack setting cannot be cleared from the sheet. Use the route pack editor.',
  example: 'Remove EXAMPLE ROW from the label first. Example rows are never saved as they are.',
  customType: 'A custom field needs a type: text, number, money, date, choice, list or link.',
  customChoice: 'A choice field needs its allowed values in the format column, separated by |.',
  // A number is stored without leading zeros, so a code such as 0042 would come back as 42.
  customNumberHelp: 'Use text for codes with leading zeros.',
  money: 'Write money as a currency code and an amount, for example USD 45.00.',
  moneyRange: 'Write an amount above zero with at most 18 digits, for example USD 45.00.',
  notAllowed: (value: string) => `${value} is not one of the allowed values for this field.`,
  saveErrors: 'Fix the errors in the dry run first',
  savePartly: 'The save stopped part way. Fix the error, then save the same file again to finish.',
  saveStopped: 'Saving this route stopped. Save the same file again to finish.',
  saveReused:
    'This save was started with a different file. Run the dry run again and save the file as a new save.',
} as const;

// A Map, so a cell naming an object prototype key (constructor, __proto__) is just an unknown word.
const states = new Map<string, SheetState>([
  ['filled', 'FILLED'],
  ['not applicable', 'NOT_APPLICABLE'],
  ['pending', 'PENDING'],
]);
const stateWords: Record<SheetState, string> = {
  FILLED: 'Filled',
  NOT_APPLICABLE: 'Not applicable',
  PENDING: 'Pending',
};
const routeShape = /^([A-Z][A-Z0-9]{1,9})-([A-Z][A-Z0-9]{1,9})$/;
// The export prefixes a cell that a spreadsheet could read as a formula with one apostrophe (csvCell); the import takes it off
// again and keeps the rest exactly, a leading tab or line break included, so an export imported unchanged changes nothing.
// A value that already starts with apostrophes and then one of these characters gets one more apostrophe on export
// (escapedValue), so it too comes back exactly. A genuine typed value that starts with an apostrophe and then one of these
// characters loses one apostrophe. Other cells are trimmed.
const escapedFormula = /^'+[=+\-@\t\r\n]/;
const escapedValue = (cell: string) => (escapedFormula.test(cell) ? "'" + cell : cell);
const cleanCell = (cell: string | undefined) =>
  cell && escapedFormula.test(cell) ? cell.slice(1) : (cell ?? '').trim();
const isDate = (value: string) => z.iso.date().safeParse(value).success;

export function sheetFromCells(rows: { row: number; cells: string[] }[]): {
  rows: SheetRow[];
  errors: SheetIssue[];
} {
  const [head, ...body] = rows;
  if (!head)
    return { rows: [], errors: [{ row: null, route: null, key: null, message: sheetWords.empty }] };
  const names = head.cells.map((cell) => cleanCell(cell).toLowerCase());
  const known = new Set<string>(sheetColumns);
  const missing = sheetColumns.filter((column) => !names.includes(column));
  const unknown = names.filter((name) => name && !known.has(name));
  const repeated = sheetColumns.filter(
    (column) => names.indexOf(column) !== names.lastIndexOf(column),
  );
  if (missing.length || unknown.length || repeated.length)
    return {
      rows: [],
      errors: [
        {
          row: head.row,
          route: null,
          key: null,
          message: sheetWords.header(missing, unknown, repeated),
        },
      ],
    };
  if (body.length > sheetLimits.rows)
    return { rows: [], errors: [{ row: null, route: null, key: null, message: sheetWords.rows }] };
  const at = Object.fromEntries(
    sheetColumns.map((column) => [column, names.indexOf(column)]),
  ) as Record<(typeof sheetColumns)[number], number>;
  const out: SheetRow[] = [];
  const errors: SheetIssue[] = [];
  const routes = new Set<string>();
  for (const { row, cells } of body) {
    const cell = (column: (typeof sheetColumns)[number]) => cleanCell(cells[at[column]]);
    if (cells.every((c) => !cleanCell(c))) continue;
    const key = cell('field_key');
    const issue = (message: string) =>
      errors.push({ row, route: cell('route') || null, key: key || null, message });
    const named = cell('route')
      .split('|')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    if (!named.length || named.some((route) => !routeShape.test(route))) {
      issue(sheetWords.route);
      continue;
    }
    if (!key) {
      issue(sheetWords.noKey);
      continue;
    }
    const state = states.get(cell('state').toLowerCase());
    if (!state) {
      issue(sheetWords.state);
      continue;
    }
    const observedOn = cell('observed_on'),
      validUntil = cell('valid_until');
    if ((observedOn && !isDate(observedOn)) || (validUntil && !isDate(validUntil))) {
      issue(sheetWords.date);
      continue;
    }
    for (const route of named) routes.add(route);
    out.push({
      row,
      routes: [...new Set(named)],
      section: cell('section'),
      key,
      label: cell('label'),
      type: cell('type').toLowerCase(),
      format: cell('format'),
      state,
      value: cell('value'),
      source: cell('source'),
      observedOn,
      validUntil,
      note: cell('note'),
    });
  }
  if (routes.size > sheetLimits.routes)
    return {
      rows: [],
      errors: [{ row: null, route: null, key: null, message: sheetWords.routes }],
    };
  return { rows: out, errors };
}

type RoutePackState = Awaited<ReturnType<typeof loadRoutePackState>>;
type PlannedRoute = SheetRoutePlan & {
  origin: string;
  destination: string;
  document: ContentDocument;
  configuration: RouteConfiguration;
  // The pack the plan read, so the pack step refuses if another write changed it meanwhile.
  basePackId: string | null;
};
const listItems = (text: string) =>
  text
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
// The canonical decimal text of a number fact: no leading zeros, no trailing fraction zeros, no negative zero. Text that is not
// a number is kept as written, so the standard's own check names the row.
function canonicalNumber(text: string): string {
  const m = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(text);
  if (!m) return text;
  const whole = m[2]!.replace(/^0+(?=\d)/, ''),
    fraction = (m[3] ?? '').replace(/0+$/, '');
  const digits = fraction ? `${whole}.${fraction}` : whole;
  return m[1] && digits !== '0' ? `-${digits}` : digits;
}
type Value = ContentFact['value'];
// The sheet text of a Filled value as the fact stores it. Lengths, allowed values, dates and links are judged by the standard.
function typedValue(type: FactType, text: string): { value: Value } | { message: string } {
  if (type === 'list') return { value: listItems(text) };
  if (type === 'number') return { value: canonicalNumber(text) };
  if (type !== 'money') return { value: text };
  const m = /^([A-Z]{3})\s+(\S+)$/.exec(text);
  const code = currency.safeParse(m?.[1]);
  if (!m || !code.success) return { message: sheetWords.money };
  try {
    return { value: { currency: code.data, amountMinor: parseMoney(m[2]!, code.data) } };
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    // The amount parsed but is zero or longer than 18 digits in minor units.
    if (error instanceof z.ZodError) return { message: sheetWords.moneyRange };
    throw error;
  }
}
// The rows of one key for one route, joined: list values append in row order, a later row may leave source, dates and note
// empty, a source it does give must match the first row's, and the earliest date given wins.
function joinRows(rows: SheetRow[], list: boolean): { row: SheetRow } | { message: string } {
  const [first, ...later] = rows;
  if (!later.length) return { row: first! };
  if (!list) return { message: sheetWords.repeatedType };
  if (later.some((r) => r.state !== first!.state)) return { message: sheetWords.repeatedState };
  if (later.some((r) => r.source && r.source !== first!.source))
    return { message: sheetWords.repeatedSource };
  const earliest = (pick: (r: SheetRow) => string) =>
    rows.map(pick).filter(Boolean).sort()[0] ?? '';
  return {
    row: {
      ...first!,
      value: rows.flatMap((r) => listItems(r.value)).join('|'),
      observedOn: earliest((r) => r.observedOn),
      validUntil: earliest((r) => r.validUntil),
      note: rows.find((r) => r.note)?.note ?? '',
    },
  };
}
const optional = (text: string) => text || undefined;
// One fact as comparable text, independent of the key order a stored document comes back in.
const factText = (fact: ContentFact) =>
  JSON.stringify([
    fact.key,
    fact.state,
    fact.value && typeof fact.value === 'object' && !Array.isArray(fact.value)
      ? [fact.value.currency, fact.value.amountMinor]
      : fact.value,
    fact.source,
    fact.observedOn,
    fact.validUntil,
    fact.note,
    fact.label,
    fact.section,
    fact.type,
    fact.allowedValues,
  ]);
const trimmedValue = (fact: ContentFact): ContentFact => ({
  ...fact,
  value:
    typeof fact.value === 'string'
      ? fact.value.trim()
      : Array.isArray(fact.value)
        ? fact.value.map((item) => item.trim())
        : fact.value,
});
const fieldLabel = (fact: ContentFact) =>
  standardFieldByKey.get(fact.key)?.label ?? fact.label ?? fact.key;

function planRoute(
  route: string,
  rows: SheetRow[],
  state: RoutePackState,
  today: string,
  errors: SheetIssue[],
  warnings: SheetIssue[],
): PlannedRoute | null {
  const issue = (row: number | null, key: string | null, message: string) =>
    errors.push({ row, route, key, message });
  const [origin, destination] = route.split('-') as [string, string];
  if (origin === destination || !state.markets.has(origin) || !state.markets.has(destination)) {
    issue(rows[0]!.row, null, sheetWords.market(route));
    return null;
  }
  const existing = state.routes.get(route);
  const pack = existing ? state.packs.get(existing.id) : undefined;
  const before = existing ? (state.contents.get(existing.id)?.document ?? null) : null;
  const facts = new Map((before?.facts ?? []).map((fact) => [fact.key, fact]));
  const marks = new Map((before?.sectionMarks ?? []).map((mark) => [mark.section, mark.note]));
  const set: Partial<Pick<RouteConfiguration, (typeof sheetLockedKeys)[number]>> = {};
  const skipped: SheetRoutePlan['skipped'] = [];
  const firstRow = new Map<string, number>();
  const byKey = new Map<string, SheetRow[]>();
  const markedSections = new Set<number>();
  for (const row of rows) {
    if (!firstRow.has(row.key)) firstRow.set(row.key, row.row);
    if (row.key !== 'section') {
      const same = byKey.get(row.key);
      if (same) same.push(row);
      else byKey.set(row.key, [row]);
      continue;
    }
    const section = sectionFromName(row.section);
    if (!section) issue(row.row, row.key, routePackWords.sectionName);
    else if (markedSections.has(section)) issue(row.row, row.key, routePackWords.repeatedSection);
    else if (row.state === 'FILLED') issue(row.row, row.key, sheetWords.sectionFilled);
    else {
      markedSections.add(section);
      if (row.state === 'PENDING') marks.delete(section);
      else if (row.note.length < 3) issue(row.row, row.key, routePackWords.notApplicableNote);
      else marks.set(section, row.note);
    }
  }
  for (const [key, keyRows] of byKey) {
    const field = standardFieldByKey.get(key);
    const custom = key.startsWith('custom.');
    const fail = (message: string, row = keyRows[0]!.row) => issue(row, key, message);
    if (!field && !custom) {
      fail(routePackWords.unknownKey(key));
      continue;
    }
    const type = field?.type ?? factTypes.find((t) => t === keyRows[0]!.type);
    const joined = joinRows(keyRows, type === 'list');
    if ('message' in joined) {
      fail(joined.message, keyRows[1]!.row);
      continue;
    }
    const row = joined.row;
    // Not applicable, its reason and whether a row may be Not applicable at all are judged by the standard.
    const notApplicable = (definition: Partial<ContentFact> = {}) =>
      facts.set(key, { key, state: 'NOT_APPLICABLE', note: optional(row.note), ...definition });
    if (field?.part === 'Locked') {
      // Locked rows ignore source and date cells: the pack's reason records why. sourcing.profile is a state row only, in
      // every state; the block itself enters through the pack (ADR-083).
      const current = field.configurationKey
        ? pack?.configuration[field.configurationKey]
        : pack?.configuration.sourcing;
      const packFilled = Array.isArray(current) ? current.length > 0 : current !== undefined;
      if (!field.configurationKey && row.value) fail(sheetWords.sourcingValue);
      else if (row.state === 'PENDING') {
        facts.delete(key);
        // Pending never clears what the pack holds; the row says so instead of passing silently.
        if (packFilled) skipped.push({ row: row.row, key, message: sheetWords.lockedPending });
      } else if (row.state === 'NOT_APPLICABLE') notApplicable();
      else if (field.configurationKey) {
        const items = listItems(row.value);
        const outside = items.find((item) => field.allowed && !field.allowed.includes(item));
        const parsed = routeConfiguration.shape[field.configurationKey].safeParse(items);
        if (!items.length) fail(sheetWords.filledEmpty);
        else if (outside) fail(sheetWords.notAllowed(outside));
        else if (!parsed.success) fail(sheetWords.lockedValue);
        else Object.assign(set, { [field.configurationKey]: parsed.data });
      } else if (!pack?.configuration.sourcing) fail(sheetWords.sourcingAbsent);
      continue;
    }
    if (custom && row.state === 'PENDING' && !facts.has(key)) {
      skipped.push({ row: row.row, key, message: sheetWords.pendingCustom });
      continue;
    }
    if (row.state === 'PENDING') {
      facts.delete(key);
      continue;
    }
    let definition: Partial<ContentFact> = {};
    if (custom) {
      const section = sectionFromName(row.section);
      const allowedValues = type === 'choice' || type === 'list' ? listItems(row.format) : [];
      if (/^example row/i.test(row.label)) fail(sheetWords.example);
      else if (!section) fail(routePackWords.sectionName);
      else if (!type) fail(sheetWords.customType);
      else if (type === 'choice' && !allowedValues.length) fail(sheetWords.customChoice);
      else
        definition = {
          label: optional(row.label),
          section,
          type,
          ...(allowedValues.length ? { allowedValues } : {}),
        };
      if (!definition.type) continue;
    }
    if (row.state === 'NOT_APPLICABLE') {
      notApplicable(definition);
      continue;
    }
    const source = factSource.safeParse(row.source);
    if (!row.value) fail(sheetWords.filledEmpty);
    else if (row.source && !source.success) fail(routePackWords.source);
    else {
      const value = typedValue(type!, row.value);
      if ('message' in value) fail(value.message);
      else {
        const fact: ContentFact = {
          key,
          state: 'FILLED',
          value: value.value,
          source: source.data,
          observedOn: optional(row.observedOn),
          validUntil: optional(row.validUntil),
          note: optional(row.note),
          ...definition,
        };
        // A plain cell is trimmed, so a value saved with spaces at its ends comes back without them: the saved value is
        // kept and the row says so, rather than showing it as changed.
        const previous = facts.get(key);
        if (
          previous &&
          factText(previous) !== factText(fact) &&
          factText(trimmedValue(previous)) === factText(fact)
        )
          skipped.push({ row: row.row, key, message: sheetWords.trimKept });
        else facts.set(key, fact);
      }
    }
  }
  const document: ContentDocument = {
    standardVersion: 1,
    sectionMarks: [...marks]
      .sort(([a], [b]) => a - b)
      .map(([section, note]) => ({ section, note })),
    facts: [...facts.values()].map(
      (fact) =>
        Object.fromEntries(Object.entries(fact).filter(([, v]) => v !== undefined)) as ContentFact,
    ),
  };
  for (const found of contentDocumentIssues(document))
    issue(found.key ? (firstRow.get(found.key) ?? null) : null, found.key, found.message);
  const status: PackStatus = pack?.status ?? 'DRAFT';
  const configuration = carriedConfiguration(pack?.configuration ?? null, set);
  const changedFields = changedPackFields(pack?.configuration, configuration);
  const packChanged = pack ? changedFields.length > 0 : Object.keys(set).length > 0;
  // Go-live is judged exactly as every pack and content write judges it, against the same packs.
  const latest = existing ? state.latestPacks.get(existing.id) : undefined;
  const judged = judgedPacks(pack, latest);
  const newPack: PackView = packChanged ? { status, configuration } : null;
  const goLive = judge(judged, before, { pack: newPack ?? undefined, document });
  const afterPack: PackView = newPack ?? judged[0] ?? null;
  // Only emptying a Locked Core row of a live route is refused; a Pending Core field is a warning.
  for (const found of goLive.ok ? goLive.warnings : [goLive])
    for (const key of found.keys)
      (goLive.ok ? warnings : errors).push({
        row: firstRow.get(key) ?? null,
        route,
        key,
        message: goLiveMessage({ ...found, keys: [key] }),
        code: found.code,
      });
  const completeness = deriveCompleteness(afterPack, document, today);
  const old = new Map((before?.facts ?? []).map((fact) => [fact.key, fact]));
  const next = new Map(document.facts.map((fact) => [fact.key, fact]));
  const pick = (from: Map<string, ContentFact>, test: (fact: ContentFact) => boolean) =>
    [...from.values()].filter(test).map((fact) => ({ key: fact.key, label: fieldLabel(fact) }));
  const oldMarks = new Map((before?.sectionMarks ?? []).map((mark) => [mark.section, mark.note]));
  const content = {
    nextVersion: (existing ? (state.contents.get(existing.id)?.version ?? 0) : 0) + 1,
    added: pick(next, (fact) => !old.has(fact.key)),
    updated: pick(
      next,
      (fact) => old.has(fact.key) && factText(old.get(fact.key)!) !== factText(fact),
    ),
    removed: pick(old, (fact) => !next.has(fact.key)),
    sectionMarks: {
      added: document.sectionMarks.filter((m) => !oldMarks.has(m.section)).map((m) => m.section),
      removed: [...oldMarks.keys()].filter((section) => !marks.has(section)),
    },
  };
  const marksChanged =
    document.sectionMarks.some((m) => oldMarks.get(m.section) !== m.note) ||
    content.sectionMarks.removed.length > 0;
  return {
    route,
    routeId: existing?.id ?? null,
    willBeAdded: !existing,
    origin,
    destination,
    pack: {
      changed: packChanged,
      changedFields: packChanged ? changedFields : [],
      status,
      nextVersion: packChanged ? (pack?.version ?? 0) + 1 : null,
    },
    content: {
      changed:
        marksChanged || content.added.length + content.updated.length + content.removed.length > 0,
      ...content,
    },
    skipped,
    completeness: {
      pendingCore: completeness.pendingCore,
      pendingOptionalCount: completeness.pendingOptionalCount,
    },
    goLive,
    document,
    configuration,
    basePackId: pack?.id ?? null,
  };
}

// Plans the whole file against one snapshot of the workspace. Pure: the same rows and state give the same plan.
function planSheet(
  sheet: { rows: SheetRow[]; errors: SheetIssue[] },
  state: RoutePackState,
  today: string,
): { errors: SheetIssue[]; warnings: SheetIssue[]; routes: PlannedRoute[] } {
  const errors = [...sheet.errors];
  const warnings: SheetIssue[] = [];
  const byRoute = new Map<string, SheetRow[]>();
  for (const row of sheet.rows)
    for (const route of row.routes) {
      const same = byRoute.get(route);
      if (same) same.push(row);
      else byRoute.set(route, [row]);
    }
  const routes = [...byRoute]
    .map(([route, rows]) => planRoute(route, rows, state, today, errors, warnings))
    .filter((plan): plan is PlannedRoute => plan !== null);
  // ADR-093 E: one custom key keeps one meaning across the workspace, judged after the whole file is applied.
  const documents = new Map<string, ContentDocument>(
    [...state.contents].map(([routeId, content]) => [routeId, content.document]),
  );
  const routeOf = new Map<string, PlannedRoute>();
  for (const plan of routes) {
    const id = plan.routeId ?? `new:${plan.route}`;
    documents.set(id, plan.document);
    routeOf.set(id, plan);
  }
  for (const conflict of customKeyConflicts(documents))
    for (const id of conflict.routeIds) {
      const plan = routeOf.get(id);
      if (plan)
        errors.push({
          row:
            sheet.rows.find((r) => r.key === conflict.key && r.routes.includes(plan.route))?.row ??
            null,
          route: plan.route,
          key: conflict.key,
          message: routePackWords.customKeyConflict(conflict.key),
        });
    }
  return { errors, warnings, routes };
}
const publicPlan = (p: PlannedRoute): SheetRoutePlan => ({
  route: p.route,
  routeId: p.routeId,
  willBeAdded: p.willBeAdded,
  pack: p.pack,
  content: p.content,
  skipped: p.skipped,
  completeness: p.completeness,
  goLive: p.goLive,
});
function report(
  mode: SheetReport['mode'],
  planned: { errors: SheetIssue[]; warnings: SheetIssue[]; routes: PlannedRoute[] },
): SheetReport {
  return {
    mode,
    ok: planned.errors.length === 0,
    errors: planned.errors,
    warnings: planned.warnings,
    routes: planned.routes.map(publicPlan),
    readinessInvalidated: planned.routes.some((plan) => plan.pack.changed),
  };
}
function readSheet(rows: { row: number; cells: string[] }[]) {
  if (rows.length > sheetLimits.rows + 1) throw new DomainError(sheetWords.rows, 400);
  const octets = rows.reduce(
    (sum, r) => sum + r.cells.reduce((n, cell) => n + Buffer.byteLength(cell, 'utf8'), 0),
    0,
  );
  if (octets > sheetLimits.octets) throw new DomainError(sheetWords.octets, 413);
  return sheetFromCells(rows);
}
// The warnings of a route's content and pack writes, each key once per code.
function mergedWarnings(warnings: GoLiveWarning[]): GoLiveWarning[] {
  const byCode = new Map<GoLiveWarning['code'], Set<string>>();
  for (const warning of warnings)
    byCode.set(warning.code, new Set([...(byCode.get(warning.code) ?? []), ...warning.keys]));
  return [...byCode].map(([code, keys]) => ({ code, keys: [...keys] }));
}
async function requireContent(db: DatabaseClient) {
  if (!(await routePackContentActive(db))) throw new DomainError('Not found', 404);
}
const today = () => new Date().toISOString().slice(0, 10);

export class RoutePackSheetService {
  constructor(
    private pool: DatabasePool,
    private corridors: CorridorService,
    private operations: OperationsService,
    private content: RoutePackContentService,
  ) {}
  // Whether the sheet can run at all: the switch is on and the content module's marker exists. It reads no workspace data,
  // so the web route asks first and answers Not found before it reads or parses a request, exactly as with the switch off.
  async available(): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      return await routePackContentActive(db);
    } finally {
      db.release();
    }
  }
  // The dry run writes nothing. It is the existing preview authority: owner and admin, no fresh authenticator check.
  async dryRun(ctx: RequestContext, input: unknown): Promise<SheetReport> {
    return withTenant(this.pool, ctx, 'audit.read', async ({ db }) => {
      await requireContent(db);
      const sheet = readSheet(z.object({ rows: cellRows }).strict().parse(input).rows);
      return report(
        'dry-run',
        planSheet(sheet, await loadRoutePackState(db, ctx.tenantId), today()),
      );
    });
  }
  // Saving plans again against the current state and writes nothing while any error remains. Every step is idempotent by an
  // id derived from saveId, so a save that stopped part way is finished by sending the same file with the same saveId.
  async save(ctx: RequestContext, input: unknown): Promise<SheetReport> {
    // config.manage needs a fresh authenticator check, so a stale one stops here before anything is written.
    const { v, planned } = await withTenant(this.pool, ctx, 'config.manage', async ({ db }) => {
      await requireContent(db);
      const v = saveInput.parse(input);
      const sheet = readSheet(v.rows);
      return { v, planned: planSheet(sheet, await loadRoutePackState(db, ctx.tenantId), today()) };
    });
    const result = { ...report('save', planned), saved: [] as NonNullable<SheetReport['saved']> };
    if (!result.ok) return { ...result, saved: undefined };
    const saved = new Map<string, NonNullable<SheetReport['saved']>[number]>();
    const progress = (
      plan: PlannedRoute,
      routeId: string,
      change: {
        contentVersion?: number;
        packVersion?: number;
        removedRefs?: string[];
        warnings?: GoLiveWarning[];
      },
    ) => {
      const seen = saved.get(plan.route);
      const warnings = mergedWarnings([...(seen?.warnings ?? []), ...(change.warnings ?? [])]);
      saved.set(plan.route, {
        route: plan.route,
        routeId,
        contentVersion: change.contentVersion ?? seen?.contentVersion ?? null,
        packVersion: change.packVersion ?? seen?.packVersion ?? null,
        ...(change.removedRefs?.length ? { removedRefs: change.removedRefs } : {}),
        ...(warnings.length ? { warnings } : {}),
      });
    };
    const ids = new Map<string, string>();
    let step: PlannedRoute | null = null;
    try {
      for (const plan of planned.routes) {
        step = plan;
        if (plan.routeId) {
          ids.set(plan.route, plan.routeId);
          continue;
        }
        const id = commandStepId(v.saveId, plan.route, 'route');
        await this.corridors.createRoute(ctx, {
          id,
          origin: plan.origin,
          destination: plan.destination,
          reason: v.reason,
        });
        ids.set(plan.route, id);
        progress(plan, id, {});
      }
      step = null;
      const changed = planned.routes.filter((plan) => plan.content.changed);
      if (changed.length) {
        const written = await this.content.appendBatch(ctx, {
          items: changed.map((plan) => ({
            id: commandStepId(v.saveId, plan.route, 'content'),
            routeId: ids.get(plan.route)!,
            version: plan.content.nextVersion,
            document: plan.document,
            reason: v.reason,
          })),
        });
        written.items.forEach((item, i) =>
          progress(changed[i]!, item.routeId, {
            contentVersion: item.version,
            warnings: item.warnings,
          }),
        );
      }
      for (const plan of planned.routes.filter((p) => p.pack.changed)) {
        step = plan;
        // As the guided form: an expired policy reference is dropped and named on a pack staying PAUSED, and the reason
        // recorded says so; any other carried status refuses the route's pack step.
        const { configuration, removedRefs, removedNames } = await this.content.withoutExpiredRefs(
          ctx,
          plan.configuration,
          plan.pack.status,
        );
        const published = await publishReviewed(
          { operations: this.operations, content: this.content },
          ctx,
          {
            commandId: commandStepId(v.saveId, plan.route, 'pack'),
            routeId: ids.get(plan.route)!,
            status: plan.pack.status,
            configuration,
            reason: reasonWithRemovedPolicies(v.reason, removedNames),
            expectedBasePackId: plan.basePackId,
          },
        );
        progress(plan, ids.get(plan.route)!, {
          packVersion: published.version,
          removedRefs,
          warnings: published.warnings,
        });
      }
    } catch (error) {
      // A refusal of one route's step (its pack changed, it is too large to review) is that route's error in the report, and a
      // saveId already used for another file is worded for the sheet. Once a step is written, any failure returns the report
      // of how far the save got, so the same file and saveId can finish it. Otherwise, with nothing written, the refusal
      // stands as it is: a stale authenticator check still asks for a new one.
      const reused = error instanceof DomainError && error.code === 'ROUTE_PACK_COMMAND_REUSED';
      const routeRefusal = error instanceof DomainError && step !== null && error.status !== 401;
      if (saved.size === 0 && !reused && !routeRefusal) throw error;
      if (!(error instanceof DomainError))
        console.error(
          JSON.stringify({
            event: 'route_pack_sheet_save_stopped',
            correlationId: ctx.correlationId,
            code: (error as { code?: unknown }).code ?? null,
          }),
        );
      const message = reused
        ? sheetWords.saveReused
        : error instanceof DomainError
          ? error.message
          : sheetWords.saveStopped;
      return {
        ...result,
        ok: false,
        errors: [
          {
            row: null,
            route: step?.route ?? null,
            key: null,
            message,
            ...(error instanceof DomainError && error.code ? { code: error.code } : {}),
          },
        ],
        saved: [...saved.values()],
      };
    }
    return { ...result, saved: [...saved.values()] };
  }
  // Every standard field in registry order, Pending ones included, then custom rows by section and key with the workspace's
  // latest label, then the section marks. Plain cells, already apostrophe-safe (escapedValue); the web route writes each
  // through csvCell.
  async export(ctx: RequestContext, input: unknown): Promise<string[][]> {
    return withTenant(this.pool, ctx, 'missions.read', async ({ db }) => {
      await requireContent(db);
      const wanted = [
        ...new Set(exportInput.parse(input).routes.map((route) => route.trim().toUpperCase())),
      ];
      if (wanted.length > sheetLimits.routes) throw new DomainError(sheetWords.exportRoutes, 400);
      const state = await loadRoutePackState(db, ctx.tenantId);
      const labels = latestCustomLabels(
        [...state.routes].flatMap(([routeKey, route]) => {
          const content = state.contents.get(route.id);
          return content ? [{ routeKey, ...content }] : [];
        }),
      );
      const rows: string[][] = [[...sheetColumns]];
      for (const route of wanted) {
        const found = state.routes.get(route);
        if (!found) throw new DomainError('Route unavailable', 404);
        rows.push(
          ...exportRoute(
            route,
            state.packs.get(found.id)?.configuration ?? null,
            state.contents.get(found.id)?.document ?? null,
            labels,
          ),
        );
      }
      return rows.map((row) => row.map(escapedValue));
    });
  }
}
function valueText(value: Value): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join(' | ');
  return typeof value === 'object' ? formatMoney(value.amountMinor, value.currency) : value;
}
function exportRoute(
  route: string,
  configuration: RouteConfiguration | null,
  document: ContentDocument | null,
  labels: Record<string, string>,
): string[][] {
  const facts = new Map((document?.facts ?? []).map((fact) => [fact.key, fact]));
  const sectionName = (n: number) => routePackSections.find((s) => s.number === n)!.name;
  const factCells = (fact: ContentFact | undefined) =>
    fact
      ? [
          stateWords[fact.state],
          valueText(fact.value),
          typeof fact.source === 'string' ? fact.source : '',
          fact.observedOn ?? '',
          fact.validUntil ?? '',
          fact.note ?? '',
        ]
      : [stateWords.PENDING, '', '', '', '', ''];
  const rows = standardFieldsV1.map((field) => {
    const fact = facts.get(field.key);
    const listed = field.configurationKey ? configuration?.[field.configurationKey] : undefined;
    const locked =
      Array.isArray(listed) && listed.length
        ? [stateWords.FILLED, listed.join(' | '), '', '', '', '']
        : field.key === 'sourcing.profile' && configuration?.sourcing
          ? [stateWords.FILLED, '', '', '', '', '']
          : null;
    return [
      route,
      sectionName(field.section),
      field.key,
      field.label,
      field.part,
      field.core ? 'Core' : 'Optional',
      field.type,
      field.format,
      ...(locked ?? factCells(fact)),
      field.help,
    ];
  });
  const custom = [...facts.values()]
    .filter((fact) => fact.key.startsWith('custom.'))
    .sort((a, b) => (a.section ?? 0) - (b.section ?? 0) || a.key.localeCompare(b.key))
    .map((fact) => [
      route,
      sectionName(fact.section ?? 17),
      fact.key,
      (Object.hasOwn(labels, fact.key) ? labels[fact.key] : fact.label) ?? '',
      'Content',
      'Optional',
      fact.type ?? '',
      (fact.allowedValues ?? []).join(' | '),
      ...factCells(fact),
      fact.type === 'number' ? sheetWords.customNumberHelp : '',
    ]);
  const marks = (document?.sectionMarks ?? []).map((mark) => [
    route,
    sectionName(mark.section),
    'section',
    '',
    '',
    '',
    '',
    '',
    stateWords.NOT_APPLICABLE,
    '',
    '',
    '',
    '',
    mark.note,
    '',
  ]);
  return [...rows, ...custom, ...marks];
}
