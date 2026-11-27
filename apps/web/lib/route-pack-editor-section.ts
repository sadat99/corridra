import {
  contentDocumentIssues,
  type FactType,
  type FieldRow,
  type SectionNumber,
} from '@corridra/domain/route-pack-standard';
import { hasContactShape } from '@corridra/domain/supply-sources';
import {
  customDefinition,
  customField,
  customKeyFor,
  refusalWords,
  type CustomDefinition,
  type FormField,
  type Refusal,
} from './route-pack-editor-fact-form';

// ADR-093 Phase 3, PR 2c: the pure rules behind the More menu of a section (spec 8.1, 8.6 and 8.8). The page stages what these
// allow with stageMark and stageFact, and the mark and the custom fact are saved with the other facts in the one body that
// prepareSave builds. The server stays the authority: after the worded checks a mark note is run through the domain's own rules.

export const sectionRefusalWords = {
  markReason: 'Say why this section does not apply to this route.',
  noUsableLetters:
    'This name has no letters or numbers the route file can use. Add a word in English letters.',
  fieldExists: (key: string) =>
    `A field named ${key} already exists on this route. Use another name.`,
  fewAllowed: 'Add at least 2 allowed values, one per line.',
} as const;

const markNoteLimit = 500;
/** What is wrong with the reason of a mark (the note the mark keeps), trimmed as it is saved; null when it may be staged. */
export function markNoteIssue(note: string, section: SectionNumber): string | null {
  const text = note.trim();
  if (text.length < 3) return sectionRefusalWords.markReason;
  if (text.length > markNoteLimit) return refusalWords.limit(text.length, markNoteLimit);
  if (hasContactShape(text, { phone: false })) return refusalWords.email;
  // The domain's own rules, for anything not worded above.
  const issues = contentDocumentIssues({
    standardVersion: 1,
    sectionMarks: [{ section, note: text }],
    facts: [],
  });
  return issues[0]?.message ?? null;
}

/**
 * Whether Mark Section Not Applicable is offered: to the owner only. Given a row, a Locked row never offers it, because Locked
 * rows are read only in PR 2 (pack settings are PR 3) and a Locked Core row never offers Not applicable (spec 8.7).
 */
export function canOfferMark(role: string, row?: Pick<FieldRow, 'part'> | null): boolean {
  return role === 'owner' && row?.part !== 'Locked';
}

export type CustomPlan =
  | { ok: true; key: string; definition: CustomDefinition; field: FormField }
  | { ok: false; refusals: Refusal[] };
/**
 * Step 1 of Add Custom Field: the key, definition and field of a new custom field in `section`, or every refusal in the order
 * of the form. `takenKeys` holds every key the route has, saved or staged (and the keys of custom labels); a label whose key is
 * taken is refused in words and never renamed with a suffix (spec 8.8). A choice or a list needs at least 2 allowed values.
 */
export function addCustomPlan(input: {
  label: string;
  section: SectionNumber;
  type: FactType;
  allowed: readonly string[];
  takenKeys: Iterable<string>;
}): CustomPlan {
  const defined = customDefinition({
    label: input.label,
    section: input.section,
    type: input.type,
    allowedValues: [...input.allowed],
  });
  const shared: Refusal[] = defined.ok ? [] : defined.refusals;
  const key = customKeyFor(input.label);
  // The label's own refusals come first in the shared list; these two are judged only on a label that passed them.
  const labelPassed = !shared.some((refusal) => refusal.field === 'text');
  const usable = /[a-z0-9]/.test(input.label.normalize('NFKD').toLowerCase());
  const labelRefusals: Refusal[] = !labelPassed
    ? []
    : !usable
      ? [{ field: 'text', message: sectionRefusalWords.noUsableLetters }]
      : new Set(input.takenKeys).has(key)
        ? [{ field: 'text', message: sectionRefusalWords.fieldExists(key) }]
        : [];
  const refusals = [...labelRefusals, ...shared];
  const allowed = new Set(input.allowed.map((value) => value.trim()).filter(Boolean));
  if ((input.type === 'choice' || input.type === 'list') && allowed.size < 2) {
    // With no allowed values the only refusal of the shared definition about them is the empty choice, which this replaces.
    const kept =
      allowed.size === 0 ? refusals.filter((refusal) => refusal.field !== 'items') : refusals;
    return {
      ok: false,
      refusals: [...kept, { field: 'items', message: sectionRefusalWords.fewAllowed }],
    };
  }
  if (!defined.ok || refusals.length) return { ok: false, refusals };
  return {
    ok: true,
    key,
    definition: defined.definition,
    field: customField(key, defined.definition),
  };
}
