import { standardFieldsV1, type ContentFact } from '@corridra/domain/route-pack-standard';
import { warningWords, type Conflict, type MergeNote, type Stage } from './route-pack-editor-stage';
import { valueWords } from './route-pack-editor-view';

// ADR-093 Phase 3, PR 2b: the words of the editor that carry a number or a name, in one place, so the screen draws them and a
// test reads them without a browser. Every count comes from the data. The copy is the designer's (spec 8.8, 9, 9.1, 9.2).

const many = (n: number, one: string, other: string) => (n === 1 ? one : other);

// ---- The unsaved bar, the status lines and the two small dialogs ----------------------------------------------------------------
export const changesNotSaved = (n: number) => `${n} ${many(n, 'change', 'changes')} not saved`;
export const reviewAndSave = (n: number) => `Review and Save (${n})`;
export const restoredLine = (n: number) =>
  `Restored ${n} ${many(n, 'change that was', 'changes that were')} not saved.`;
export const changeKept = (n: number) => `Change kept. ${changesNotSaved(n)}.`;
export const savedLine = (version: number) => `Saved. Route facts are now version ${version}.`;
export const noChangeToKeep = 'No change to keep.';
export const changesDiscarded = 'Changes discarded.';
export const finishOpenField = 'Keep Change or Cancel this field first.';
/** "Review and Save" while a row is open and touched: its answer is not in the save until Keep Change. */
export const openFieldNotIncluded = (label: string) =>
  `${label} is still open and is not included. Keep Change on it first to add it.`;
export const discardWords = (n: number) =>
  `This removes ${n} ${many(n, 'change', 'changes')} that ${many(n, 'is', 'are')} not saved. The saved facts stay as they are.`;
export const leaveTitle = 'You Have Changes That Are Not Saved';
/** `kept`: the edits are in the tab's copy, so leaving sets them aside (they come back); otherwise leaving removes them. */
export const leaveWords = (n: number, kept = false) =>
  n > 0
    ? kept
      ? `Leaving this route puts your ${n} unsaved ${many(n, 'change', 'changes')} aside. Your saved facts are not affected.`
      : `Leaving this route removes ${n} ${many(n, 'change', 'changes')} that ${many(n, 'is', 'are')} not saved. Your saved facts are not affected.`
    : 'Leaving this route removes the answer you are editing. You have not pressed Keep Change on it. Your saved facts are not affected.';
export const leaveKept = 'Your changes are kept for this tab session.';
export const pendingClears =
  'Pending clears the saved value from the next version. Earlier versions keep it.';
export const removeFieldHelp =
  'This field is no longer listed on this route after you save. Earlier versions keep it.';
export const nothingLeftToSave = 'Nothing is left to save.';

// ---- The More menu and its two dialogs (PR 2c, spec 8.1, 8.6, 8.8) --------------------------------------------------------------
export const moreWords = {
  /** The visible word of the button. */
  button: 'More',
  buttonLabel: (route: string) => `More actions for ${route}`,
  exportRoute: 'Export This Route',
  addCustom: 'Add Custom Field',
  mark: 'Mark Section Not Applicable',
  unmark: 'Unmark Section',
  discard: 'Discard Changes',
  markName: (section: string) => `Mark Section Not Applicable, ${section}`,
  unmarkName: (section: string) => `Unmark Section, ${section}`,
} as const;
export const markDialogWords = {
  title: 'Mark Section Not Applicable',
  reason: 'Reason',
  statement:
    'Every field in this section that is not Filled becomes Not applicable. Filled facts keep their value. Pack settings that are Core stay required.',
  confirm: 'Mark Not Applicable',
  cancel: 'Cancel',
  /** "Section 5, Trade fairs and events." */
  sectionLine: (number: number, name: string) => `Section ${number}, ${name}.`,
} as const;
export const markRemovedLine = (n: number) => `Mark removed. ${changesNotSaved(n)}.`;
/** The line when the last mark is removed and nothing else is staged: no count. */
export const markRemovedNone = 'Mark removed.';
export const fieldAddedLine = (n: number) => `Field added. ${changesNotSaved(n)}.`;
export const customDialogWords = {
  title: 'Add Custom Field',
  step1: 'Step 1 of 2: Define · Next: Value',
  step2: 'Step 2 of 2: Value',
  label: 'Label',
  type: 'Type',
  allowed: 'Allowed values',
  allowedHelp: 'One value on each line.',
  next: 'Next',
  back: 'Back',
  cancel: 'Cancel',
  add: 'Add Field',
  answer: 'Answer',
  nothingSaved: 'Nothing is saved until you press Review and Save.',
  goesIn: (number: number, name: string) => `Goes in section ${number}, ${name}.`,
  savedAs: (key: string) => `Saved as ${key}`,
} as const;
/** The types a custom field may have, in the order of the Type select. */
export const customTypeOptions = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'money', label: 'Money' },
  { value: 'date', label: 'Date' },
  { value: 'choice', label: 'Choice' },
  { value: 'list', label: 'List' },
  { value: 'link', label: 'Link' },
] as const;
/**
 * The line under a section marked Not applicable when Locked Core rows in it are not Filled (spec 8.6): the section word stays
 * Pending and this says why. One label, or the first label and a count of the others. Labels come from the data.
 */
export function lockedCorePendingLine(labels: string[]): Words | null {
  const first = labels[0];
  if (first === undefined) return null;
  const lead = 'This section is marked Not applicable, but ';
  if (labels.length === 1)
    return [lead, { label: cut(first, 40) }, ' is a Core pack setting and is still Pending.'];
  const rest = labels.length - 1;
  return [
    lead,
    { label: cut(first, 40) },
    ` and ${rest} more pack ${many(rest, 'setting', 'settings')} are Core and still Pending.`,
  ];
}

// ---- Labels in a sentence -----------------------------------------------------------------------------------------------------
/** Pieces of a sentence: plain text, and a label the screen wraps in `<bdi>` because it may be in any script. */
export type Words = Array<string | { label: string }>;
export const plain = (words: Words) =>
  words.map((piece) => (typeof piece === 'string' ? piece : piece.label)).join('');
const cut = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
/** "A", "A and B", "A, B and C", "A, B, C and 2 more": the first 3, each cut at 40 characters. */
export function labelList(labels: string[]): Words {
  const shown = labels.slice(0, 3).map((label) => ({ label: cut(label, 40) }));
  if (shown.length === 0) return [];
  if (labels.length > 3) {
    const rest = labels.length - 3;
    return [shown[0]!, ', ', shown[1]!, ', ', shown[2]!, ` and ${rest} more`];
  }
  if (shown.length === 1) return [shown[0]!];
  if (shown.length === 2) return [shown[0]!, ' and ', shown[1]!];
  return [shown[0]!, ', ', shown[1]!, ' and ', shown[2]!];
}
const rowIndex = new Map(standardFieldsV1.map((field, index) => [field.key, index]));
/** The order of the rows on screen: the standard's order, then custom fields by key, then section marks by number. */
export function inRowOrder<T extends MergeNote>(notes: T[]): T[] {
  const rank = (note: MergeNote) =>
    note.kind === 'mark' ? 3e6 + Number(note.key) : (rowIndex.get(note.key) ?? 2e6);
  return [...notes].sort(
    (a, b) => rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}
/** The label of one edit in a sentence: a fact by its label, a section mark as "Section 5 mark". */
export const noteLabel = (note: MergeNote, factLabel: (key: string) => string) =>
  note.kind === 'mark' ? `Section ${note.key} mark` : factLabel(note.key);

// ---- Conflict: what an answer to Save Route Facts says when another save landed first ---------------------------------------
export const checkingWords = 'Checking what changed…';
/** The route could not be read again to check what changed: nothing was sent, and nothing is sent until a check has worked. */
export const checkFailedWords =
  'The latest route facts could not be read, so nothing was saved. Your changes are still here.';
export const clashHeading = (again: boolean) =>
  again
    ? 'Someone saved route facts again first.'
    : 'Someone saved route facts for this route first.';
export const clashKept = 'Facts only one of you changed are kept as they are.';
export const clashAsk = 'You both changed the facts below. Choose one answer for each.';
export const noClashFirst = (version: number) =>
  `Someone saved route facts for this route first. Their changes do not clash with yours. The latest version is ${version}.`;
export const allDroppedWords = (version: number) =>
  `Someone saved route facts for this route first. It already includes all of your changes. The latest version is ${version}. There is nothing left to save.`;
export const checkSummary = 'Check the summary, then save again.';
export function mergedLine(labels: string[]): Words | null {
  if (!labels.length) return null;
  return labels.length === 1
    ? [
        'Your change to ',
        ...labelList(labels),
        ' is kept. The other save did not change that fact.',
      ]
    : [
        'Your changes to ',
        ...labelList(labels),
        ' are kept. The other save did not change those facts.',
      ];
}
export function droppedLine(labels: string[]): Words | null {
  if (!labels.length) return null;
  return labels.length === 1
    ? [
        'The other save already includes your change to ',
        ...labelList(labels),
        ', so nothing is left to save for it.',
      ]
    : [
        'The other save already includes your changes to ',
        ...labelList(labels),
        ', so nothing is left to save for them.',
      ];
}
export const conflictStepWords = (step: number, steps: number) =>
  `Step ${step} of ${steps}: Choices${step < steps ? ' · Next: Choices' : ''}`;
export const choosePrompt = 'Choose for Each Fact';
export const conflictsPerStep = 3;

/** One side of a clash in words: a value cut at 120 characters, a list joined with commas, money exact, removal and notes. */
export function factValueWords(fact: ContentFact | null): string {
  if (fact === null) return 'Pending (cleared)';
  if (fact.state === 'NOT_APPLICABLE') return cut(`Not applicable: ${fact.note ?? ''}`.trim(), 120);
  const value = valueWords(fact.value);
  if (value.kind === 'empty') return 'Filled';
  return cut(value.kind === 'list' ? value.items.join(', ') : value.text, 120);
}
export const markValueWords = (note: string | null) =>
  note === null ? 'No mark' : cut(`Not applicable: ${note}`, 120);
/** "Keep mine: {value}" and "Use theirs: {value}" for one clash. */
export function conflictChoiceWords(side: 'mine' | 'theirs', conflict: Conflict): string {
  const value =
    conflict.kind === 'fact' ? factValueWords(conflict[side]) : markValueWords(conflict[side]);
  return `${side === 'mine' ? 'Keep mine' : 'Use theirs'}: ${value}`;
}

// ---- The summary lines of Save Route Facts ----------------------------------------------------------------------------------------
export type SummaryLines = {
  counts: { added: number; changed: number; removed: number };
  lines: string[];
};
/**
 * Lines of ChangeSummary: added, then changed, then removed. A standard field turned Pending reads "Removed: Privacy laws (now
 * Pending)"; a custom field taken off reads "Removed: Holiday notes"; a mark is "Section 5 marked Not applicable" or "Section 5
 * mark". `label` names a fact key.
 */
export function summaryLines(
  stage: Stage,
  label: (key: string, fact: ContentFact | null) => string,
): SummaryLines {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const note of inRowOrder(
    Object.keys(stage.facts).map((key) => ({ kind: 'fact' as const, key })),
  )) {
    const { base, mine } = stage.facts[note.key]!;
    const name = label(note.key, mine ?? base);
    if (base === null) added.push(`Added: ${name}`);
    else if (mine === null)
      removed.push(`Removed: ${name}${note.key.startsWith('custom.') ? '' : ' (now Pending)'}`);
    else changed.push(`Changed: ${name}`);
  }
  for (const key of Object.keys(stage.marks).sort((a, b) => Number(a) - Number(b))) {
    const { base, mine } = stage.marks[key]!;
    if (base === null) added.push(`Added: Section ${key} marked Not applicable`);
    else if (mine === null) removed.push(`Removed: Section ${key} mark`);
    else changed.push(`Changed: Section ${key} mark`);
  }
  return {
    counts: { added: added.length, changed: changed.length, removed: removed.length },
    lines: [...added, ...changed, ...removed],
  };
}

// ---- Cautions ---------------------------------------------------------------------------------------------------------------------
/**
 * The caution of a save that turns Core fields Pending on a live route: the words of the shared go-live check
 * (`goLiveWarningsMessage`), with the page's labels where it has its own. Empty when no field turns Pending.
 */
export const cautionLine = (keys: string[], label?: (key: string) => string): string =>
  warningWords([{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys }], label);
