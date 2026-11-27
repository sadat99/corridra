import { describe, expect, test } from 'vitest';
import {
  parseContentDocument,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';
import { emptyDraft, factFromDraft } from '../../apps/web/lib/route-pack-editor-fact-form';
import {
  addCustomPlan,
  canOfferMark,
  markNoteIssue,
  sectionRefusalWords,
} from '../../apps/web/lib/route-pack-editor-section';
import {
  emptyStage,
  prepareSave,
  stageCount,
  stageFact,
  stageMark,
} from '../../apps/web/lib/route-pack-editor-stage';

// ADR-093 Phase 3, PR 2c: the pure rules behind the More menu of a section (spec 8.1, 8.6 and 8.8): the reason of a mark, who is
// offered a mark, and the first step of Add Custom Field. A mark and a custom field are staged like any edit and saved in the one
// body prepareSave builds.
const today = '2026-11-27';
const routeId = '00000000-0000-4000-8000-000000000101';
const command = '00000000-0000-4000-8000-0000000000aa';
const reason = 'Marked trade fairs and added visa notes';
const doc = (facts: ContentFact[] = [], marks: ContentDocument['sectionMarks'] = []) =>
  ({ standardVersion: 1, sectionMarks: marks, facts }) as ContentDocument;
const lockedRow = standardFieldsV1.find((field) => field.part === 'Locked')!;
const contentRow = standardFieldsV1.find((field) => field.part === 'Content')!;
const plan = (change: Partial<Parameters<typeof addCustomPlan>[0]> = {}) =>
  addCustomPlan({
    label: 'Visa notes',
    section: 5,
    type: 'text',
    allowed: [],
    takenKeys: [],
    ...change,
  });
const messages = (result: ReturnType<typeof addCustomPlan>) =>
  result.ok ? [] : result.refusals.map((refusal) => refusal.message);

describe('the reason of a section mark', () => {
  test('is trimmed and must be 3 to 500 characters, with the real count in the words, and never an email address', () => {
    expect(markNoteIssue('  ab  ', 5)).toBe(sectionRefusalWords.markReason);
    expect(sectionRefusalWords.markReason).toBe(
      'Say why this section does not apply to this route.',
    );
    expect(markNoteIssue('', 5)).toBe(sectionRefusalWords.markReason);
    expect(markNoteIssue('  abc  ', 5)).toBeNull();
    expect(markNoteIssue('x'.repeat(500), 5)).toBeNull();
    expect(markNoteIssue(`  ${'x'.repeat(500)}  `, 5)).toBeNull();
    expect(markNoteIssue('x'.repeat(504), 5)).toBe(
      'That is 504 characters. The limit is 500. Shorten it.',
    );
    expect(markNoteIssue('Ask desk@example.com about fairs', 5)).toBe(
      'This looks like an email address. Route facts name organisations, places and rules, never people. Remove it.',
    );
  });
});

describe('who is offered Mark Section Not Applicable', () => {
  test('the owner is offered it on a section and a content row; an admin never is, and a Locked row never is', () => {
    expect(canOfferMark('owner')).toBe(true);
    expect(canOfferMark('owner', contentRow)).toBe(true);
    expect(canOfferMark('admin')).toBe(false);
    expect(canOfferMark('admin', contentRow)).toBe(false);
    expect(canOfferMark('member')).toBe(false);
    expect(canOfferMark('owner', lockedRow)).toBe(false);
    expect(canOfferMark('admin', lockedRow)).toBe(false);
  });
});

describe('Add Custom Field, step 1: Define', () => {
  test('makes the key from the label, in the section the menu was opened from, and refuses a key the route already has instead of renaming it', () => {
    const made = plan();
    expect(made).toMatchObject({
      ok: true,
      key: 'custom.visa_notes',
      definition: { label: 'Visa notes', section: 5, type: 'text' },
      field: { key: 'custom.visa_notes', custom: true, part: 'Content', core: false },
    });
    // Saved, staged or named elsewhere on the route: refused in words, never given a _2 suffix.
    const taken = plan({ takenKeys: ['custom.visa_notes'] });
    expect(taken.ok).toBe(false);
    expect(messages(taken)).toEqual([
      'A field named custom.visa_notes already exists on this route. Use another name.',
    ]);
    expect(
      messages(plan({ label: ' VISA  notes! ', takenKeys: new Set(['custom.visa_notes']) })),
    ).toEqual(['A field named custom.visa_notes already exists on this route. Use another name.']);
    expect(plan({ takenKeys: ['custom.visa_notes_2'] })).toMatchObject({
      key: 'custom.visa_notes',
    });
  });

  test('refuses a label with no usable letters, and a choice or a list with fewer than 2 allowed values', () => {
    expect(messages(plan({ label: 'ビザ' }))).toEqual([
      'This name has no letters or numbers the route file can use. Add a word in English letters.',
    ]);
    expect(messages(plan({ label: '   ' }))).toEqual(['Give the field a name.']);
    const fewer = 'Add at least 2 allowed values, one per line.';
    expect(messages(plan({ type: 'choice', allowed: [] }))).toEqual([fewer]);
    expect(messages(plan({ type: 'choice', allowed: ['Yes', ' Yes ', ''] }))).toEqual([fewer]);
    expect(messages(plan({ type: 'list', allowed: ['Spring'] }))).toEqual([fewer]);
    expect(plan({ type: 'list', allowed: ['Spring', 'Autumn'] })).toMatchObject({
      ok: true,
      definition: { type: 'list', allowedValues: ['Spring', 'Autumn'] },
    });
    // The refusals of the shared definition still apply (an allowed value on a text field).
    expect(messages(plan({ type: 'text', allowed: ['Yes', 'No'] }))).toEqual([
      'Only a choice or a list takes allowed values.',
    ]);
  });
});

describe('a mark and a custom field are saved together', () => {
  test('one prepareSave body, at the version of the stage plus 1, carries the mark with its note and the custom fact with its definition', () => {
    const saved = doc([], []);
    const made = plan();
    if (!made.ok) throw new Error('The plan was refused');
    const built = factFromDraft(
      made.field,
      { ...emptyDraft(today), text: 'Business visas take two weeks' },
      today,
    );
    if (!built.ok || !built.fact) throw new Error('The fact was refused');
    let stage = stageMark(emptyStage(4), saved, 5, '  No trade fairs on this route  ');
    stage = stageFact(stage, saved, made.key, built.fact);
    expect(stageCount(stage)).toBe(2);
    const result = prepareSave({ stage, document: saved, routeId, id: command, reason });
    if (!result.ok) throw new Error(`Not saved: ${result.why}`);
    expect(result.body.version).toBe(5);
    expect(result.body.document.sectionMarks).toEqual([
      { section: 5, note: 'No trade fairs on this route' },
    ]);
    expect(result.body.document.facts).toEqual([
      {
        key: 'custom.visa_notes',
        state: 'FILLED',
        value: 'Business visas take two weeks',
        source: 'staff knowledge',
        observedOn: today,
        label: 'Visa notes',
        section: 5,
        type: 'text',
      },
    ]);
    // The body is a document the server reads.
    expect(parseContentDocument(result.body.document)).toEqual(result.body.document);
  });

  test('marking then unmarking in one stage leaves no entry, and unmarking a saved mark stages its removal', () => {
    const unmarked = doc();
    const marked = stageMark(emptyStage(2), unmarked, 5, 'No trade fairs on this route');
    expect(stageCount(marked)).toBe(1);
    const back = stageMark(marked, unmarked, 5, null);
    expect(back.marks).toEqual({});
    expect(stageCount(back)).toBe(0);

    const saved = doc([], [{ section: 5, note: 'No trade fairs on this route' }]);
    const removed = stageMark(emptyStage(2), saved, 5, null);
    expect(removed.marks).toEqual({ '5': { base: 'No trade fairs on this route', mine: null } });
    // Undo: the same note again is no edit.
    expect(stageMark(removed, saved, 5, 'No trade fairs on this route').marks).toEqual({});
  });
});
