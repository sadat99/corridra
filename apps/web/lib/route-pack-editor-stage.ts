import {
  contentFact,
  goLiveCheck,
  routePackSections,
  routePackWords,
  standardFieldByKey,
  type ContentDocument,
  type ContentFact,
  type GoLiveWarning,
  type PackView,
} from '@corridra/domain/route-pack-standard';

// ADR-093 Phase 3, PR 2a: the unsaved edits of the route pack editor, as plain data and pure functions. Nothing here reads a
// page, a clock or a network, so the editor shell (PR 2b) only holds one Stage, and the same code is tested without a browser.
// Rules (spec sections 8.8 and 9):
// - An edit is kept as base (the fact as it was when the key was first staged) and mine (what the person wants now). Base is
//   captured once and never overwritten, so a merge can always tell what each side changed.
// - Mine equal to base is no edit and drops the entry. Equality is by stable key-sorted JSON, so the order of keys never matters.
// - A fact or a mark that is null is absent: choosing Pending on a content row stages mine as null (the fact is removed).
// - The stage never holds the reason, and the saved document is always the whole document with the stage applied.

export type FactEdit = { base: ContentFact | null; mine: ContentFact | null };
export type MarkEdit = { base: string | null; mine: string | null };
export type Stage = {
  v: 1;
  /** The facts version the stage was made on (0: nothing saved yet). */
  baseVersion: number;
  /** By fact key. */
  facts: Record<string, FactEdit>;
  /** By section number, as text. The value is the note of the mark. */
  marks: Record<string, MarkEdit>;
};

export function emptyStage(baseVersion = 0): Stage {
  return { v: 1, baseVersion, facts: {}, marks: {} };
}

// Stable text of a value: object keys sorted, undefined left out, so equal facts compare equal in any key order.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const factOf = (document: ContentDocument | null, key: string): ContentFact | null =>
  document?.facts.find((fact) => fact.key === key) ?? null;
const markOf = (document: ContentDocument | null, section: number): string | null =>
  document?.sectionMarks.find((mark) => mark.section === section)?.note ?? null;

/** Stages one fact. `document` is the saved document the page shows; `mine` null removes the fact (Pending). */
export function stageFact(
  stage: Stage,
  document: ContentDocument | null,
  key: string,
  mine: ContentFact | null,
): Stage {
  const base = stage.facts[key] ? stage.facts[key].base : factOf(document, key);
  const facts = { ...stage.facts };
  if (sameValue(base, mine)) delete facts[key];
  else facts[key] = { base, mine };
  return { ...stage, facts };
}
/** Stages the mark of one section: a note marks it Not applicable, null removes the mark. */
export function stageMark(
  stage: Stage,
  document: ContentDocument | null,
  section: number,
  note: string | null,
): Stage {
  const name = String(section);
  const base = stage.marks[name] ? stage.marks[name].base : markOf(document, section);
  const marks = { ...stage.marks };
  if (base === note) delete marks[name];
  else marks[name] = { base, mine: note };
  return { ...stage, marks };
}
/** Drops one staged fact edit, as Discard on a row would. */
export function unstageFact(stage: Stage, key: string): Stage {
  const facts = { ...stage.facts };
  delete facts[key];
  return { ...stage, facts };
}
/** Discard Changes: nothing staged, still made on the same version. */
export const discard = (stage: Stage): Stage => emptyStage(stage.baseVersion);
/** The number in "3 changes not saved": one per fact and one per section mark. */
export const stageCount = (stage: Stage) =>
  Object.keys(stage.facts).length + Object.keys(stage.marks).length;

/** The whole document with the stage applied: edited facts keep their place, new ones follow in key order. */
export function applyStage(document: ContentDocument | null, stage: Stage): ContentDocument {
  const edits = stage.facts;
  const kept = (document?.facts ?? []).flatMap((fact) => {
    const edit = edits[fact.key];
    if (!edit) return [fact];
    return edit.mine ? [edit.mine] : [];
  });
  const present = new Set((document?.facts ?? []).map((fact) => fact.key));
  const added = Object.keys(edits)
    .filter((key) => !present.has(key) && edits[key]!.mine)
    .sort()
    .map((key) => edits[key]!.mine!);
  const marks = new Map((document?.sectionMarks ?? []).map((mark) => [mark.section, mark.note]));
  for (const [name, edit] of Object.entries(stage.marks)) {
    if (edit.mine === null) marks.delete(Number(name));
    else marks.set(Number(name), edit.mine);
  }
  return {
    standardVersion: 1,
    sectionMarks: [...marks]
      .sort(([a], [b]) => a - b)
      .map(([section, note]) => ({
        section: section as ContentDocument['sectionMarks'][number]['section'],
        note,
      })),
    facts: [...kept, ...added],
  };
}

// ---- The summary of Save Route Facts: added, changed and removed, in words ----------------------------------------------

export type StageSummary = { added: string[]; changed: string[]; removed: string[] };
/** The label of a fact key: the standard's label, a custom fact's own label, or the key itself. */
export function factLabel(
  key: string,
  fact?: ContentFact | null,
  custom: Record<string, string> = {},
) {
  return standardFieldByKey.get(key)?.label ?? fact?.label ?? custom[key] ?? key;
}
const sectionLabel = (name: string) => {
  const section = routePackSections.find((item) => String(item.number) === name);
  return section ? `${section.number}. ${section.name}` : `Section ${name}`;
};
/**
 * The lines of ChangeSummary. A mark that is new is Added, a mark note that changed is Changed and a mark taken off is
 * Removed. `labels` names a key; the default is the standard label.
 */
export function summariseStage(
  stage: Stage,
  labels: (key: string, fact: ContentFact | null) => string = (key, fact) => factLabel(key, fact),
): StageSummary {
  const summary: StageSummary = { added: [], changed: [], removed: [] };
  for (const key of Object.keys(stage.facts).sort()) {
    const { base, mine } = stage.facts[key]!;
    const label = labels(key, mine ?? base);
    if (base === null) summary.added.push(label);
    else if (mine === null) summary.removed.push(label);
    else summary.changed.push(label);
  }
  for (const name of Object.keys(stage.marks).sort((a, b) => Number(a) - Number(b))) {
    const { base, mine } = stage.marks[name]!;
    const label = `${sectionLabel(name)}, marked Not applicable`;
    if (base === null) summary.added.push(label);
    else if (mine === null) summary.removed.push(label);
    else summary.changed.push(label);
  }
  return summary;
}

// ---- Merge: another save landed first (spec 9.2) ------------------------------------------------------------------------

export type Conflict =
  | {
      kind: 'fact';
      key: string;
      base: ContentFact | null;
      mine: ContentFact | null;
      theirs: ContentFact | null;
    }
  | { kind: 'mark'; key: string; base: string | null; mine: string | null; theirs: string | null };
export type Choice = 'mine' | 'theirs';
export const conflictId = (conflict: Conflict) => `${conflict.kind}:${conflict.key}`;

/**
 * Three-way merge of a stage onto the document that is saved now (`theirs`, at `theirsVersion`). For each edit: theirs equal
 * to base means mine applies; mine equal to theirs means the edit is already saved and is dropped; anything else is a conflict
 * (this includes one side removing what the other changed, and both sides adding the same custom key differently). The
 * returned stage is made on `theirsVersion` and keeps mine for every conflict until `resolve` is given a choice.
 */
export function mergeStage(
  stage: Stage,
  theirs: ContentDocument | null,
  theirsVersion: number,
): { stage: Stage; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const facts: Stage['facts'] = {};
  for (const key of Object.keys(stage.facts)) {
    const { base, mine } = stage.facts[key]!;
    const now = factOf(theirs, key);
    if (sameValue(mine, now)) continue;
    facts[key] = { base: now, mine };
    if (!sameValue(base, now)) conflicts.push({ kind: 'fact', key, base, mine, theirs: now });
  }
  const marks: Stage['marks'] = {};
  for (const name of Object.keys(stage.marks)) {
    const { base, mine } = stage.marks[name]!;
    const now = markOf(theirs, Number(name));
    if (mine === now) continue;
    marks[name] = { base: now, mine };
    if (base !== now) conflicts.push({ kind: 'mark', key: name, base, mine, theirs: now });
  }
  return { stage: { v: 1, baseVersion: theirsVersion, facts, marks }, conflicts };
}
/**
 * Applies the person's choices to a merged stage. "Use theirs" drops the edit (the stage is made on theirs, so the saved value
 * stays); "Keep mine" and a conflict with no choice yet keep the edit.
 */
export function resolve(
  stage: Stage,
  conflicts: Conflict[],
  choices: Record<string, Choice | undefined>,
): Stage {
  const facts = { ...stage.facts };
  const marks = { ...stage.marks };
  for (const conflict of conflicts) {
    if (choices[conflictId(conflict)] !== 'theirs') continue;
    if (conflict.kind === 'fact') delete facts[conflict.key];
    else delete marks[conflict.key];
  }
  return { ...stage, facts, marks };
}

// ---- The copy kept in sessionStorage (a convenience only) --------------------------------------------------------------

/** The text to mirror. It holds the edits and the version they were made on, never the reason. */
export function serialiseStage(stage: Stage): string {
  return JSON.stringify({
    v: 1,
    baseVersion: stage.baseVersion,
    facts: stage.facts,
    marks: stage.marks,
  } satisfies Stage);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const mirrorLimit = 600000;
function parseFact(value: unknown, key: string): ContentFact | null | undefined {
  if (value === null) return null;
  const parsed = contentFact.safeParse(value);
  return parsed.success && parsed.data.key === key ? parsed.data : undefined;
}
/** The stage in a mirrored text, or null for anything that is not exactly a stage of this version: nothing half-read is kept. */
export function parseStage(text: unknown): Stage | null {
  if (typeof text !== 'string' || text.length > mirrorLimit) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1) return null;
  const { baseVersion, facts: rawFacts, marks: rawMarks } = raw;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0)
    return null;
  if (!isRecord(rawFacts) || !isRecord(rawMarks)) return null;
  const facts: Stage['facts'] = {};
  for (const [key, edit] of Object.entries(rawFacts)) {
    if (!isRecord(edit)) return null;
    const base = parseFact(edit.base, key);
    const mine = parseFact(edit.mine, key);
    if (base === undefined || mine === undefined || sameValue(base, mine)) return null;
    facts[key] = { base, mine };
  }
  const marks: Stage['marks'] = {};
  for (const [name, edit] of Object.entries(rawMarks)) {
    if (!isRecord(edit) || !/^([1-9]|1[0-7])$/.test(name)) return null;
    const { base, mine } = edit;
    const text = (value: unknown) => value === null || typeof value === 'string';
    if (!text(base) || !text(mine) || base === mine) return null;
    marks[name] = { base: base as string | null, mine: mine as string | null };
  }
  return { v: 1, baseVersion, facts, marks };
}

// ---- Cautions (advisory: the server's warnings in the answer are the authority) -----------------------------------------

/**
 * The Core fields a save would turn Pending on a live route, from the shared go-live check on the pack in force. Empty when
 * the pack is not live, nothing turns Pending, or there is no pack.
 */
export function cautionKeys(
  pack: PackView,
  before: ContentDocument | null,
  after: ContentDocument | null,
): string[] {
  const result = goLiveCheck({
    before: { pack, document: before },
    after: { pack, document: after },
  });
  return result.ok ? result.warnings.flatMap((warning) => warning.keys) : [];
}

/**
 * The words of the warnings of a save, as the page shows them: one sentence per warning with the labels of its fields, then
 * that this does not clear the route. Empty without warnings.
 */
export function warningWords(
  warnings: GoLiveWarning[],
  labels: (key: string) => string = (key) => standardFieldByKey.get(key)?.label ?? key,
): string {
  const sentences = warnings
    .filter((warning) => warning.keys.length)
    .map((warning) => {
      const names = warning.keys.map(labels).join(', ');
      return warning.code === 'ROUTE_PACK_GO_LIVE_PENDING_CORE'
        ? routePackWords.goLivePendingCore(names)
        : routePackWords.coreTurnsPending(names);
    });
  return sentences.length ? [...sentences, routePackWords.notCleared].join(' ') : '';
}
