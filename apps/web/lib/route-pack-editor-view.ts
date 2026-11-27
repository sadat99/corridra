import { formatMoney } from '@corridra/domain/opportunities';
import {
  routePackSections,
  routePackWords,
  standardFieldByKey,
  type Completeness,
  type ContentDocument,
  type ContentFact,
  type FieldRow,
  type FieldState,
  type StandardField,
} from '@corridra/domain/route-pack-standard';
import type { RouteConfiguration } from '@corridra/domain/corridors';
import type { PackVersion, RouteSummary } from './route-pack-editor-read';

// ADR-093 Phase 3, PR 1: the pure helpers of the route pack editor (address, order of rows, words). No React, no browser, no
// request. Every count in a sentence is passed in from the data and the schema; none is typed here.

/** The three views of a route. A section is the third, chosen by its number. */
export type EditorView = 'todo' | 'sections';
export type RouteAddress = {
  /** The route key in the sheet form, for example BD-CN. */
  route: string | null;
  view: EditorView | null;
  section: number | null;
  /** A section was named but is not one of the standard's sections. */
  sectionUnknown: boolean;
};
const sectionNumbers: readonly number[] = routePackSections.map((section) => section.number);

export function parseAddress(search: string): RouteAddress {
  const query = new URLSearchParams(search);
  const route = query.get('route')?.trim() || null;
  const view = query.get('view');
  const asked = query.get('section');
  const section = asked !== null && /^[0-9]{1,2}$/.test(asked) ? Number(asked) : null;
  const known = section !== null && sectionNumbers.includes(section);
  return {
    route,
    view: view === 'todo' || view === 'sections' ? view : null,
    section: known ? section : null,
    sectionUnknown: asked !== null && !known,
  };
}
/**
 * The address for a state: the current address with `route`, `view` and `section` replaced and everything else (the
 * workspace, the tab, the hash) kept. A null part is removed. Returns a path with its query and hash.
 */
export function addressFor(
  href: string,
  next: { route: string | null; view?: EditorView | null; section?: number | null },
): string {
  const url = new URL(href, 'https://address.invalid');
  for (const name of ['route', 'view', 'section']) url.searchParams.delete(name);
  if (next.route) url.searchParams.set('route', next.route);
  if (next.route && next.view) url.searchParams.set('view', next.view);
  if (next.route && next.section) url.searchParams.set('section', String(next.section));
  return `${url.pathname}${url.search}${url.hash}`;
}
/** To Do while the route has a Pending Core field or a stale Core fact, otherwise All Sections. */
export const defaultView = (core: { pending: number; stale: number }): EditorView =>
  core.pending > 0 || core.stale > 0 ? 'todo' : 'sections';
export const routeIdOf = (key: string, routes: readonly RouteSummary[]) =>
  routes.find((route) => route.key === key)?.routeId ?? null;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Words. Each takes the numbers from the data.
export const coreListWords = (core: { total: number; pending: number }) =>
  core.total === 0
    ? null
    : core.pending === 0
      ? 'Core complete'
      : `Core ${core.total - core.pending} of ${core.total} done`;
export const staleListWords = (stale: number) => (stale > 0 ? `${stale} stale` : null);
export const progressWords = (core: { total: number; pending: number }) =>
  core.pending === 0
    ? `Core fields: ${core.total} of ${core.total} done.`
    : `Core fields: ${core.total - core.pending} of ${core.total} done. ${core.pending} still Pending.`;
export const staleLine = (stale: number) =>
  stale === 1
    ? '1 fact is stale. Check it before relying on it.'
    : `${stale} facts are stale. Check them before relying on them.`;
export const gapsLine = (status: string, pending: number) =>
  `This route is ${status}, and ${pending} Core ${plural(pending, 'field is', 'fields are')} still Pending. It keeps working. Fill ${plural(pending, 'it', 'them')} when you can. ${routePackWords.notCleared}`;
export const optionalLine = (pending: number) =>
  pending > 0
    ? `${pending} optional ${plural(pending, 'field is', 'fields are')} still Pending. Open All Sections to see ${plural(pending, 'it', 'them')}.`
    : null;
/** "mission_types" and "supplier-discovery" as words, for names the schema does not label. */
export const humanKey = (key: string) => {
  const text = key
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return text ? text[0]!.toUpperCase() + text.slice(1) : key;
};
export const readinessLine = (
  readiness: { completeMissionTypes: string[] },
  packVersion: number,
) =>
  readiness.completeMissionTypes.length
    ? `Readiness: complete for ${readiness.completeMissionTypes.map(humanKey).join(', ')} on pack version ${packVersion}.`
    : `Readiness: not recorded for pack version ${packVersion}.`;
/**
 * The last pack change, from the newest entry of the pack history. The services return actor ids and no names, so the words
 * are "you", "a teammate", or two people. The date is the pack's effective date, and says so. A pack that did not go through
 * review has no proposer to name, and the line says that.
 */
export function packChangeLine(
  entry: Pick<
    PackVersion,
    'version' | 'reviewed' | 'proposedAndPublishedByYou' | 'proposedAndPublishedBySame'
  >,
  date: string,
) {
  if (!entry.reviewed)
    return `Pack version ${entry.version}, effective ${date}. This change did not go through review, so no proposer is recorded.`;
  const who = entry.proposedAndPublishedByYou
    ? 'proposed and published by you'
    : entry.proposedAndPublishedBySame
      ? 'proposed and published by a teammate'
      : 'proposed by one team member, published by another';
  return `Pack version ${entry.version}, ${who}, effective ${date}`;
}

// What a field row shows.
export type ValueWords =
  { kind: 'empty' } | { kind: 'text'; text: string } | { kind: 'list'; items: string[] };
/** The value of a fact in words: money exactly as stored (never converted), a list as its items, empty as empty. */
export function valueWords(value: ContentFact['value'] | undefined): ValueWords {
  if (value === undefined) return { kind: 'empty' };
  if (typeof value === 'string')
    return value.trim() ? { kind: 'text', text: value } : { kind: 'empty' };
  if (Array.isArray(value))
    return value.length ? { kind: 'list', items: value } : { kind: 'empty' };
  try {
    return {
      kind: 'text',
      text: formatMoney(value.amountMinor, value.currency as Parameters<typeof formatMoney>[1]),
    };
  } catch {
    return { kind: 'text', text: `${value.currency} ${value.amountMinor} minor units` };
  }
}
/** Where a fact came from: "Staff knowledge", or the host of an https address; nothing else is shown as an address. */
export function sourceWords(source: string | undefined) {
  if (!source) return null;
  if (source === 'staff knowledge') return 'Staff knowledge';
  try {
    const url = new URL(source);
    return url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}
export type FieldView = {
  key: string;
  label: string;
  core: boolean;
  /** A pack setting: its value is the pack's list and it has no source or dates. */
  locked: boolean;
  custom: boolean;
  state: FieldState;
  stale: boolean;
  value: ValueWords;
  /** The reason a fact is Not applicable. */
  note: string | null;
  source: string | null;
  observedOn: string | null;
  validUntil: string | null;
  /** A pack row of the section that carries a word of its own instead of a value. */
  packNote: string | null;
};
const sourcingNote = 'Set in Add route pack while the sourcing control is open.';
/** One row of the completeness, joined with its fact (or the pack for a pack setting) and its label from the dictionary. */
export function fieldView(
  row: FieldRow,
  facts: ReadonlyMap<string, ContentFact>,
  configuration: Partial<RouteConfiguration> | null,
  customLabels: Readonly<Record<string, string>>,
): FieldView {
  const standard: StandardField | undefined = standardFieldByKey.get(row.key);
  const fact = facts.get(row.key);
  const locked = row.part === 'Locked';
  const lockedValue =
    locked && standard?.configurationKey
      ? (configuration?.[standard.configurationKey] as string[] | undefined)
      : undefined;
  return {
    key: row.key,
    label: standard?.label ?? fact?.label ?? customLabels[row.key] ?? row.key,
    core: row.core,
    locked,
    custom: row.custom,
    state: row.state,
    stale: row.stale,
    value: locked ? valueWords(lockedValue) : valueWords(fact?.value),
    note: fact?.state === 'NOT_APPLICABLE' ? (fact.note ?? null) : null,
    source: locked ? null : sourceWords(typeof fact?.source === 'string' ? fact.source : undefined),
    observedOn: locked ? null : (fact?.observedOn ?? null),
    validUntil: locked ? null : (fact?.validUntil ?? null),
    packNote: locked && !standard?.configurationKey && row.state === 'FILLED' ? sourcingNote : null,
  };
}
export const factsByKey = (document: ContentDocument | null) =>
  new Map((document?.facts ?? []).map((fact) => [fact.key, fact]));

// To Do: every Pending Core field and every stale Core fact, by section.
export type TodoItem = {
  row: FieldRow;
  /** Set on the first row of each section, where its heading is drawn. */
  heading: { number: number; name: string } | null;
};
export function todoItems(completeness: Completeness): TodoItem[] {
  const rows = completeness.fields
    .filter((row) => row.core && (row.state === 'PENDING' || row.stale))
    .sort((a, b) => a.section - b.section);
  return rows.map((row, index) => ({
    row,
    heading:
      index === 0 || rows[index - 1]!.section !== row.section
        ? { number: row.section, name: sectionName(row.section) }
        : null,
  }));
}
export const todoCount = (completeness: Completeness) =>
  completeness.fields.filter((row) => row.core && (row.state === 'PENDING' || row.stale)).length;
export const sectionName = (number: number) =>
  routePackSections.find((section) => section.number === number)?.name ?? '';

// All Sections: one line for each of the standard's sections.
export type SectionLine = {
  number: number;
  name: string;
  state: FieldState;
  corePending: number;
  stale: number;
  optionalPending: number;
};
export function sectionLines(completeness: Completeness): SectionLine[] {
  return completeness.sections.map((section) => {
    const rows = completeness.fields.filter((row) => row.section === section.section);
    return {
      number: section.section,
      name: section.name,
      state: section.state,
      corePending: rows.filter((row) => row.core && row.state === 'PENDING').length,
      stale: rows.filter((row) => row.stale).length,
      optionalPending: rows.filter((row) => !row.core && row.state === 'PENDING').length,
    };
  });
}
/** The words of a section line, for the link's name and the visible line: "5, Trade fairs and events, Pending, 2 Core pending". */
export const sectionStateWord = (state: FieldState) =>
  state === 'FILLED' ? 'Filled' : state === 'NOT_APPLICABLE' ? 'Not applicable' : 'Pending';
export function sectionParts(line: SectionLine) {
  return [
    line.corePending > 0 ? `${line.corePending} Core pending` : null,
    line.stale > 0 ? `${line.stale} stale` : null,
    line.optionalPending > 0 ? `${line.optionalPending} optional pending` : null,
  ].filter((part): part is string => part !== null);
}
/** A section marked Not applicable that still holds a pack setting Core and Pending. Null when it does not. */
export function markedButOpen(
  completeness: Completeness,
  document: ContentDocument | null,
  section: number,
  labels: (key: string) => string,
) {
  const state = completeness.sections.find((item) => item.section === section);
  const marked = document?.sectionMarks.some((mark) => mark.section === section) ?? false;
  if (!state || !marked || !state.pendingLockedCore.length) return null;
  const [first, ...others] = state.pendingLockedCore;
  return `This section is marked Not applicable, but ${labels(first!)}${
    others.length
      ? ` and ${others.length} more pack ${plural(others.length, 'setting', 'settings')}`
      : ''
  } ${plural(state.pendingLockedCore.length, 'is', 'are')} Core and still Pending.`;
}
