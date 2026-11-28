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
import type { FactsSaveBody } from './route-pack-editor-write';

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

/**
 * Stages one fact. `document` is the saved document the page shows; `mine` null removes the fact (Pending).
 *
 * `mine` is read through the domain's own `contentFact` (the same read `parseStage` makes of a mirrored copy), and what is
 * staged is the read result, so a fact is kept exactly as it will be saved: text is trimmed, so 'x ' on top of a saved 'x' is no
 * edit, and a staged stage always survives `serialiseStage` then `parseStage`. A fact that does not read, or whose key is not
 * `key`, changes nothing: the page has already refused such a fact before it gets here (`factFromDraft`).
 */
export function stageFact(
  stage: Stage,
  document: ContentDocument | null,
  key: string,
  mine: ContentFact | null,
): Stage {
  let kept: ContentFact | null = null;
  if (mine !== null) {
    const parsed = contentFact.safeParse(mine);
    if (!parsed.success || parsed.data.key !== key) return stage;
    kept = parsed.data;
  }
  const base = stage.facts[key] ? stage.facts[key].base : factOf(document, key);
  const facts = { ...stage.facts };
  if (sameValue(base, kept)) delete facts[key];
  else facts[key] = { base, mine: kept };
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
  // The schema trims a note when it is saved, so the note is trimmed before it is compared and kept.
  const mine = note === null ? null : note.trim();
  const marks = { ...stage.marks };
  if (base === mine) delete marks[name];
  else marks[name] = { base, mine };
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
/** A stage made on an older version than the one saved now: it must be merged and the person asked, however little clashes. */
export const isBehind = (stage: Stage, savedVersion: number) =>
  stageCount(stage) > 0 && stage.baseVersion < savedVersion;

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

/** What the page shows behind the edits: the saved document with the stage applied (state and value of every row). */
export const overlayDocument = (document: ContentDocument | null, stage: Stage): ContentDocument =>
  applyStage(document, stage);

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
export const conflictId = (conflict: { kind: 'fact' | 'mark'; key: string }) =>
  `${conflict.kind}:${conflict.key}`;
/** One edit named by its kind and key (a fact key, or a section number for a mark). */
export type MergeNote = { kind: 'fact' | 'mark'; key: string };

/**
 * Three-way merge of a stage onto the document that is saved now (`theirs`, at `theirsVersion`). For each edit: theirs equal
 * to base means mine applies (`merged`); mine equal to theirs means the edit is already saved and is dropped (`dropped`);
 * anything else is a conflict (this includes one side removing what the other changed, and both sides adding the same custom
 * key differently).
 *
 * Every edit keeps the base it was first staged with, so a conflict stays a conflict however often the stage is merged again
 * or restored from its mirror: it ends only when `resolve` is given a choice for its key. While any conflict is open the stage
 * also keeps its old version, so a restored stage is still seen to be behind and asks again. With none open, the stage is made
 * on `theirsVersion`. `merged` and `dropped` let the page list what went through without asking (spec 9.2).
 */
export function mergeStage(
  stage: Stage,
  theirs: ContentDocument | null,
  theirsVersion: number,
): { stage: Stage; conflicts: Conflict[]; merged: MergeNote[]; dropped: MergeNote[] } {
  const conflicts: Conflict[] = [];
  const merged: MergeNote[] = [];
  const dropped: MergeNote[] = [];
  const facts: Stage['facts'] = {};
  for (const key of Object.keys(stage.facts)) {
    const edit = stage.facts[key]!;
    const now = factOf(theirs, key);
    if (sameValue(edit.mine, now)) {
      dropped.push({ kind: 'fact', key });
      continue;
    }
    facts[key] = edit;
    if (sameValue(edit.base, now)) merged.push({ kind: 'fact', key });
    else conflicts.push({ kind: 'fact', key, base: edit.base, mine: edit.mine, theirs: now });
  }
  const marks: Stage['marks'] = {};
  for (const name of Object.keys(stage.marks)) {
    const edit = stage.marks[name]!;
    const now = markOf(theirs, Number(name));
    if (edit.mine === now) {
      dropped.push({ kind: 'mark', key: name });
      continue;
    }
    marks[name] = edit;
    if (edit.base === now) merged.push({ kind: 'mark', key: name });
    else conflicts.push({ kind: 'mark', key: name, base: edit.base, mine: edit.mine, theirs: now });
  }
  return {
    stage: {
      v: 1,
      baseVersion: conflicts.length ? stage.baseVersion : theirsVersion,
      facts,
      marks,
    },
    conflicts,
    merged,
    dropped,
  };
}
/**
 * Applies the person's choices to a merged stage. "Use theirs" drops the edit (the saved value stays). "Keep mine" keeps it and
 * moves its base to what is saved now, so the conflict is over. A conflict with no choice is left exactly as it is and its id
 * is listed in `missing`: the page must not offer "Save With These Choices" while `missing` is not empty. Once there were
 * clashes and nothing is missing, the stage is made on `theirsVersion`; with no clashes it keeps its own version.
 */
export function resolve(
  stage: Stage,
  conflicts: Conflict[],
  choices: Record<string, Choice | undefined>,
  theirsVersion: number,
): { stage: Stage; missing: string[] } {
  const facts = { ...stage.facts };
  const marks = { ...stage.marks };
  const missing: string[] = [];
  for (const conflict of conflicts) {
    const choice = choices[conflictId(conflict)];
    if (choice !== 'mine' && choice !== 'theirs') {
      missing.push(conflictId(conflict));
      continue;
    }
    if (conflict.kind === 'fact') {
      const edit = facts[conflict.key];
      if (choice === 'theirs' || !edit) delete facts[conflict.key];
      else facts[conflict.key] = { base: conflict.theirs, mine: edit.mine };
    } else {
      const edit = marks[conflict.key];
      if (choice === 'theirs' || !edit) delete marks[conflict.key];
      else marks[conflict.key] = { base: conflict.theirs, mine: edit.mine };
    }
  }
  return {
    stage: {
      ...stage,
      // Only a merge gives clashes, so with none to resolve the stage keeps its own version: a version newer than the stage's
      // can never be taken without the merge that read it (a stage that is behind is then refused by the server, never saved
      // on top of the newer save).
      baseVersion: missing.length || conflicts.length === 0 ? stage.baseVersion : theirsVersion,
      facts,
      marks,
    },
    missing,
  };
}

// ---- The save: the only builder of the body of route-pack-facts (carry A of PR 2a) -------------------------------------------

/** The ids of the conflicts that have no choice yet. While any is listed the stage is not saved. */
export function openConflictIds(
  stage: Stage,
  conflicts: Conflict[],
  choices: Record<string, Choice | undefined>,
): string[] {
  return resolve(stage, conflicts, choices, stage.baseVersion).missing;
}
/**
 * Whether Save Route Facts may send: something is staged once the choices are applied, and no conflict is without a choice.
 * `theirsVersion` is the version just read, which only matters after a merge; left out it is the version of the stage.
 */
export function canSave(
  stage: Stage,
  conflicts: Conflict[] = [],
  choices: Record<string, Choice | undefined> = {},
  theirsVersion: number = stage.baseVersion,
): boolean {
  const resolved = resolve(stage, conflicts, choices, theirsVersion);
  return resolved.missing.length === 0 && stageCount(resolved.stage) > 0;
}
export type PrepareSave =
  { ok: true; body: FactsSaveBody } | { ok: false; why: 'nothing' | 'conflict' | 'reason' };
/**
 * The body of one save, or why there is none. The only place the body is built: the page gives the stage, the document the stage
 * stands on (the saved one, or `theirs` after a merge), the clashes and the choices, and never a version. The choices are
 * applied here, a conflict without a choice refuses (`conflict`), nothing staged refuses (`nothing`) and the reason is trimmed
 * and must be 3 to 500 characters (`reason`). The version written is the version of the stage plus 1, and the version of the
 * stage is `theirsVersion` once nothing is open, so a conflicted stage can never be sent on top of a newer version.
 */
export function prepareSave(input: {
  stage: Stage;
  document: ContentDocument | null;
  conflicts?: Conflict[];
  choices?: Record<string, Choice | undefined>;
  /** The version just read; left out it is the version of the stage. */
  theirsVersion?: number;
  routeId: string;
  /**
   * The command id, or a function that gives it from the rest of the body once the body is known: the page keeps one id per
   * route, version, document and reason (`nextCommand`), so the id can only be chosen after the body is built.
   */
  id: string | ((rest: Omit<FactsSaveBody, 'id'>) => string);
  reason: string;
}): PrepareSave {
  const resolved = resolve(
    input.stage,
    input.conflicts ?? [],
    input.choices ?? {},
    input.theirsVersion ?? input.stage.baseVersion,
  );
  if (stageCount(resolved.stage) === 0 && resolved.missing.length === 0)
    return { ok: false, why: 'nothing' };
  if (resolved.missing.length) return { ok: false, why: 'conflict' };
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false, why: 'reason' };
  const rest = {
    routeId: input.routeId,
    version: resolved.stage.baseVersion + 1,
    document: applyStage(input.document, resolved.stage),
    reason,
  };
  return {
    ok: true,
    body: { id: typeof input.id === 'function' ? input.id(rest) : input.id, ...rest },
  };
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
    if (!text(base) || !text(mine)) return null;
    const trimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : null);
    if (trimmed(base) === trimmed(mine)) return null;
    marks[name] = { base: trimmed(base), mine: trimmed(mine) };
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
