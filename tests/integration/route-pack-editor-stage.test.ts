import { describe, expect, test } from 'vitest';
import {
  coreKeysV1,
  deriveCompleteness,
  goLiveCheck,
  goLiveWarningsMessage,
  parseContentDocument,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';
import {
  applyStage,
  canSave,
  cautionKeys,
  conflictId,
  discard,
  emptyStage,
  isBehind,
  mergeStage,
  openConflictIds,
  overlayDocument,
  parseStage,
  prepareSave,
  resolve,
  sameValue,
  serialiseStage,
  stageCount,
  stageFact,
  stageMark,
  summariseStage,
  unstageFact,
  warningWords,
  type Stage,
} from '../../apps/web/lib/route-pack-editor-stage';

// ADR-093 Phase 3, PR 2a: the pure staging library of the route pack editor. No database, no page: what a person has changed and
// not saved, how it is applied, summed up, rebased on a newer version and mirrored.
const day = '2026-11-20';
const fact = (key: string, value = 'A value', extra: Partial<ContentFact> = {}) =>
  ({
    key,
    state: 'FILLED',
    value,
    source: 'staff knowledge',
    observedOn: day,
    ...extra,
  }) as ContentFact;
const custom = (key: string, value = 'A value', extra: Partial<ContentFact> = {}) =>
  fact(key, value, { label: 'Dock rules', section: 9, type: 'text', ...extra });
const doc = (facts: ContentFact[] = [], marks: ContentDocument['sectionMarks'] = []) =>
  ({ standardVersion: 1, sectionMarks: marks, facts }) as ContentDocument;
const textField = (core: boolean) =>
  standardFieldsV1.find((f) => f.part === 'Content' && f.core === core && f.type === 'text')!;
const coreKey = textField(true).key;
const optionalKey = textField(false).key;

describe('staging', () => {
  test('a first edit captures the base once and a later edit keeps it', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    let stage = stageFact(emptyStage(4), saved, optionalKey, fact(optionalKey, 'First'));
    expect(stage.facts[optionalKey]).toEqual({
      base: saved.facts[0],
      mine: fact(optionalKey, 'First'),
    });
    stage = stageFact(stage, saved, optionalKey, fact(optionalKey, 'Second'));
    expect(stage.facts[optionalKey]!.base).toEqual(saved.facts[0]);
    expect(stage.facts[optionalKey]!.mine).toEqual(fact(optionalKey, 'Second'));
    expect(stage.baseVersion).toBe(4);
    // Even if the page now shows a different saved document, the base stays as it was when the key was first staged.
    stage = stageFact(
      stage,
      doc([fact(optionalKey, 'Moved on')]),
      optionalKey,
      fact(optionalKey, 'Third'),
    );
    expect(stage.facts[optionalKey]!.base).toEqual(saved.facts[0]);
  });

  test('an edit equal to its base is no edit, whatever the order of the keys', () => {
    const saved = doc([fact(optionalKey, 'Saved', { validUntil: '2027-01-01' })]);
    const staged = stageFact(emptyStage(1), saved, optionalKey, fact(optionalKey, 'Other'));
    expect(stageCount(staged)).toBe(1);
    const reordered = {
      validUntil: '2027-01-01',
      observedOn: day,
      source: 'staff knowledge',
      value: 'Saved',
      state: 'FILLED',
      key: optionalKey,
    } as ContentFact;
    const back = stageFact(staged, saved, optionalKey, reordered);
    expect(stageCount(back)).toBe(0);
    expect(back.facts).toEqual({});
    expect(sameValue({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(
      true,
    );
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue(null, { a: 1 })).toBe(false);
  });

  test('Pending on a row that has a fact stages mine as null, and Pending on a row with none is no edit', () => {
    const saved = doc([fact(coreKey)]);
    const removed = stageFact(emptyStage(1), saved, coreKey, null);
    expect(removed.facts[coreKey]).toEqual({ base: saved.facts[0], mine: null });
    expect(stageFact(emptyStage(1), saved, optionalKey, null).facts).toEqual({});
  });

  test('marks stage the same way: a note, a removal, and no edit when nothing changes', () => {
    const saved = doc([], [{ section: 5, note: 'Not part of this route' }]);
    let stage = stageMark(emptyStage(1), saved, 7, 'Nothing is bought in this section');
    stage = stageMark(stage, saved, 5, null);
    expect(stage.marks).toEqual({
      '7': { base: null, mine: 'Nothing is bought in this section' },
      '5': { base: 'Not part of this route', mine: null },
    });
    expect(stageCount(stage)).toBe(2);
    stage = stageMark(stage, saved, 5, 'Not part of this route');
    stage = stageMark(stage, saved, 7, null);
    expect(stageCount(stage)).toBe(0);
  });

  test('a mark note is trimmed before it is compared and kept, as the schema trims it when saved', () => {
    const saved = doc([], [{ section: 5, note: 'Not part of this route' }]);
    // The same note with spaces round it is no edit.
    expect(stageCount(stageMark(emptyStage(1), saved, 5, '  Not part of this route \n'))).toBe(0);
    // A new note is kept trimmed, so applying and comparing agree with what the server stores.
    const stage = stageMark(emptyStage(1), saved, 7, '  Nothing is bought here  ');
    expect(stage.marks['7']).toEqual({ base: null, mine: 'Nothing is bought here' });
    expect(applyStage(saved, stage).sectionMarks).toContainEqual({
      section: 7,
      note: 'Nothing is bought here',
    });
    // Staged first with spaces, then written without: still one edit that changes nothing more.
    expect(stageCount(stageMark(stage, saved, 7, 'Nothing is bought here'))).toBe(1);
    // A mirrored copy with untrimmed notes is read trimmed, and an edit that only differs in spaces is refused as no edit.
    const text = JSON.stringify({
      v: 1,
      baseVersion: 1,
      facts: {},
      marks: { '7': { base: null, mine: '  Spaced  ' } },
    });
    expect(parseStage(text)!.marks['7']).toEqual({ base: null, mine: 'Spaced' });
    const same = JSON.stringify({
      v: 1,
      baseVersion: 1,
      facts: {},
      marks: { '7': { base: 'Note', mine: ' Note ' } },
    });
    expect(parseStage(same)).toBeNull();
  });

  test('stageCount counts facts and marks; discard and unstageFact clear them and keep the version', () => {
    const saved = doc([fact(optionalKey)]);
    let stage = stageFact(emptyStage(3), saved, optionalKey, fact(optionalKey, 'New'));
    stage = stageFact(stage, saved, coreKey, fact(coreKey));
    stage = stageMark(stage, saved, 2, 'Not used');
    expect(stageCount(stage)).toBe(3);
    expect(stageCount(unstageFact(stage, coreKey))).toBe(2);
    const cleared = discard(stage);
    expect(cleared).toEqual({ v: 1, baseVersion: 3, facts: {}, marks: {} });
    expect(stageCount(cleared)).toBe(0);
  });
});

describe('applyStage', () => {
  test('adds, changes, removes, marks and unmarks, and the result is a valid whole document', () => {
    const saved = doc(
      [
        fact(optionalKey, 'Old'),
        fact('notes.general', 'Keep'),
        custom('custom.dock_rules', 'Gone'),
      ],
      [{ section: 5, note: 'Not part of this route' }],
    );
    let stage = stageFact(emptyStage(2), saved, optionalKey, fact(optionalKey, 'New'));
    stage = stageFact(stage, saved, coreKey, fact(coreKey, 'Added'));
    stage = stageFact(stage, saved, 'custom.dock_rules', null);
    stage = stageFact(stage, saved, 'custom.other_rule', custom('custom.other_rule', 'Fresh'));
    stage = stageMark(stage, saved, 5, null);
    stage = stageMark(stage, saved, 3, 'Everything here is fixed');
    const after = applyStage(saved, stage);
    expect(after.facts.map((item) => [item.key, item.value])).toEqual([
      [optionalKey, 'New'],
      ['notes.general', 'Keep'],
      // Added ones follow in key order.
      ['custom.other_rule', 'Fresh'],
      [coreKey, 'Added'],
    ]);
    expect(after.sectionMarks).toEqual([{ section: 3, note: 'Everything here is fixed' }]);
    expect(parseContentDocument(after)).toEqual(after);
    // The saved document is not changed.
    expect(saved.facts).toHaveLength(3);
  });

  test('an empty stage returns the same content, and a null document starts an empty one', () => {
    const saved = doc([fact(optionalKey)], [{ section: 2, note: 'Not used' }]);
    expect(applyStage(saved, emptyStage(1))).toEqual(saved);
    expect(applyStage(null, emptyStage(0))).toEqual(doc());
    const stage = stageFact(emptyStage(0), null, optionalKey, fact(optionalKey));
    expect(applyStage(null, stage).facts).toEqual([fact(optionalKey)]);
  });
});

describe('summariseStage', () => {
  test('lines for added, changed and removed facts with the standard labels, custom labels and section marks', () => {
    const saved = doc(
      [fact(optionalKey, 'Old'), fact(coreKey)],
      [{ section: 5, note: 'Not part of this route' }],
    );
    let stage = stageFact(emptyStage(1), saved, optionalKey, fact(optionalKey, 'New'));
    stage = stageFact(stage, saved, coreKey, null);
    stage = stageFact(stage, saved, 'custom.dock_rules', custom('custom.dock_rules'));
    stage = stageMark(stage, saved, 3, 'Everything here is fixed');
    stage = stageMark(stage, saved, 5, null);
    const label = (key: string) => standardFieldsV1.find((f) => f.key === key)!.label;
    expect(summariseStage(stage)).toEqual({
      added: ['Dock rules', '3. Languages, money and time, marked Not applicable'],
      changed: [label(optionalKey)],
      removed: [label(coreKey), '5. Trade fairs and events, marked Not applicable'],
    });
    // The page may name keys its own way.
    expect(summariseStage(stage, (key) => `<${key}>`).changed).toEqual([`<${optionalKey}>`]);
    expect(summariseStage(emptyStage(1))).toEqual({ added: [], changed: [], removed: [] });
  });
});

// A stage made on version 2 (base) against what is saved now (theirs, version 3).
const stageOf = (
  saved: ContentDocument,
  edits: Record<string, ContentFact | null>,
  marks: Record<number, string | null> = {},
) => {
  let stage = emptyStage(2);
  for (const [key, mine] of Object.entries(edits)) stage = stageFact(stage, saved, key, mine);
  for (const [section, note] of Object.entries(marks))
    stage = stageMark(stage, saved, Number(section), note);
  return stage;
};

describe('mergeStage', () => {
  const baseDoc = doc([fact(optionalKey, 'Base'), fact('notes.general', 'Base')]);
  const idOf = (conflict: { kind: 'fact' | 'mark'; key: string }) => conflictId(conflict);

  test('theirs equal to base: mine applies without asking, it is listed as merged, and the stage moves to the new version', () => {
    const stage = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Mine') });
    const theirs = doc([fact(optionalKey, 'Base'), fact('notes.general', 'Theirs')]);
    const { stage: merged, conflicts, merged: went, dropped } = mergeStage(stage, theirs, 3);
    expect(conflicts).toEqual([]);
    expect(went).toEqual([{ kind: 'fact', key: optionalKey }]);
    expect(dropped).toEqual([]);
    expect(merged.baseVersion).toBe(3);
    expect(merged.facts[optionalKey]).toEqual({
      base: fact(optionalKey, 'Base'),
      mine: fact(optionalKey, 'Mine'),
    });
    // Applied to theirs, both sides' work is in the document.
    const result = applyStage(theirs, merged);
    expect(result.facts.find((item) => item.key === optionalKey)!.value).toBe('Mine');
    expect(result.facts.find((item) => item.key === 'notes.general')!.value).toBe('Theirs');
  });

  test('both changed to the same thing: the edit is already saved, it is dropped and listed as dropped', () => {
    const stage = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Same') });
    const result = mergeStage(stage, doc([fact(optionalKey, 'Same')]), 3);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(result.dropped).toEqual([{ kind: 'fact', key: optionalKey }]);
    expect(stageCount(result.stage)).toBe(0);
  });

  test('both changed differently: a conflict with base, mine and theirs; the edit keeps its own base and mine stays in the document', () => {
    const stage = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Mine') });
    const theirs = doc([fact(optionalKey, 'Theirs')]);
    const { stage: merged, conflicts } = mergeStage(stage, theirs, 3);
    expect(conflicts).toEqual([
      {
        kind: 'fact',
        key: optionalKey,
        base: fact(optionalKey, 'Base'),
        mine: fact(optionalKey, 'Mine'),
        theirs: fact(optionalKey, 'Theirs'),
      },
    ]);
    // The stage is not rebased while the conflict is open: base and version are as they were.
    expect(merged.facts[optionalKey]!.base).toEqual(fact(optionalKey, 'Base'));
    expect(merged.baseVersion).toBe(2);
    expect(applyStage(theirs, merged).facts[0]!.value).toBe('Mine');
  });

  test('an open conflict survives merging again and a restore from the mirror: the same conflicts, the old version', () => {
    const stage = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Mine') });
    const theirs = doc([fact(optionalKey, 'Theirs')]);
    const once = mergeStage(stage, theirs, 3);
    const twice = mergeStage(once.stage, theirs, 3);
    expect(twice.conflicts).toEqual(once.conflicts);
    expect(twice.stage).toEqual(once.stage);
    // The mirror holds the stage as it was after the first merge; restored, it still asks.
    const restored = parseStage(serialiseStage(once.stage))!;
    expect(restored.baseVersion).toBeLessThan(3);
    const again = mergeStage(restored, theirs, 3);
    expect(again.conflicts).toEqual(once.conflicts);
    expect(again.stage.facts[optionalKey]!.base).toEqual(fact(optionalKey, 'Base'));
    // A third save lands: the conflict is judged against the newest document, and is still against the original base.
    const newest = doc([fact(optionalKey, 'Newest')]);
    const third = mergeStage(restored, newest, 4);
    expect(third.conflicts).toHaveLength(1);
    expect(third.conflicts[0]).toMatchObject({
      base: fact(optionalKey, 'Base'),
      theirs: fact(optionalKey, 'Newest'),
    });
  });

  test('resolve: Keep mine ends the conflict for good, Use theirs drops the edit, and the version moves on once nothing is open', () => {
    const stage = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Mine') });
    const theirs = doc([fact(optionalKey, 'Theirs')]);
    const { stage: merged, conflicts } = mergeStage(stage, theirs, 3);
    const id = idOf(conflicts[0]!);
    const keep = resolve(merged, conflicts, { [id]: 'mine' }, 3);
    expect(keep.missing).toEqual([]);
    expect(keep.stage.baseVersion).toBe(3);
    expect(applyStage(theirs, keep.stage).facts[0]!.value).toBe('Mine');
    // Merged again onto the same document: mine applies cleanly, the conflict does not come back.
    const after = mergeStage(keep.stage, theirs, 3);
    expect(after.conflicts).toEqual([]);
    expect(after.merged).toEqual([{ kind: 'fact', key: optionalKey }]);
    const use = resolve(merged, conflicts, { [id]: 'theirs' }, 3);
    expect(use.missing).toEqual([]);
    expect(stageCount(use.stage)).toBe(0);
    expect(applyStage(theirs, use.stage).facts[0]!.value).toBe('Theirs');
  });

  test('resolve with a choice missing does not keep mine in silence: the key is reported, the conflict stays open and so does the version', () => {
    const stage = stageOf(baseDoc, {
      [optionalKey]: fact(optionalKey, 'Mine'),
      'notes.general': fact('notes.general', 'Mine too'),
    });
    const theirs = doc([fact(optionalKey, 'Theirs'), fact('notes.general', 'Theirs too')]);
    const { stage: merged, conflicts } = mergeStage(stage, theirs, 3);
    expect(conflicts).toHaveLength(2);
    const none = resolve(merged, conflicts, {}, 3);
    expect(none.missing.sort()).toEqual(conflicts.map(idOf).sort());
    expect(none.stage).toEqual(merged);
    expect(none.stage.baseVersion).toBe(2);
    // One answered: the other is still missing, still open, and merging again returns just that one.
    const half = resolve(merged, conflicts, { [idOf(conflicts[0]!)]: 'mine' }, 3);
    expect(half.missing).toEqual([idOf(conflicts[1]!)]);
    expect(half.stage.baseVersion).toBe(2);
    const reopened = mergeStage(half.stage, theirs, 3);
    expect(reopened.conflicts.map(idOf)).toEqual([idOf(conflicts[1]!)]);
    // A value that is not a choice is not a choice.
    const odd = resolve(merged, conflicts, { [idOf(conflicts[0]!)]: 'both' as 'mine' }, 3);
    expect(odd.missing).toContain(idOf(conflicts[0]!));
  });

  test('theirs changed what I did not touch: nothing to merge, nothing staged', () => {
    const result = mergeStage(emptyStage(2), doc([fact(optionalKey, 'Theirs')]), 3);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.stage).toEqual({ v: 1, baseVersion: 3, facts: {}, marks: {} });
  });

  test('one side removed, the other changed: a conflict either way round', () => {
    // I removed a fact (Pending), they changed it.
    const mineRemoved = stageOf(baseDoc, { [optionalKey]: null });
    const theirsChanged = doc([fact(optionalKey, 'Theirs')]);
    const changed = mergeStage(mineRemoved, theirsChanged, 3);
    expect(changed.conflicts).toHaveLength(1);
    expect(changed.conflicts[0]).toMatchObject({ mine: null, theirs: fact(optionalKey, 'Theirs') });
    const id = idOf(changed.conflicts[0]!);
    const useTheirs = resolve(changed.stage, changed.conflicts, { [id]: 'theirs' }, 3);
    expect(applyStage(theirsChanged, useTheirs.stage).facts).toHaveLength(1);
    const keepMine = resolve(changed.stage, changed.conflicts, { [id]: 'mine' }, 3);
    expect(applyStage(theirsChanged, keepMine.stage).facts).toEqual([]);
    // I changed it, they removed it.
    const mineChanged = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Mine') });
    const gone = mergeStage(mineChanged, doc(), 3);
    expect(gone.conflicts[0]).toMatchObject({ mine: fact(optionalKey, 'Mine'), theirs: null });
    expect(applyStage(doc(), gone.stage).facts).toEqual([fact(optionalKey, 'Mine')]);
    const goneId = idOf(gone.conflicts[0]!);
    const takeTheirs = resolve(gone.stage, gone.conflicts, { [goneId]: 'theirs' }, 3);
    expect(applyStage(doc(), takeTheirs.stage).facts).toEqual([]);
    const keepMineAfterRemoval = resolve(gone.stage, gone.conflicts, { [goneId]: 'mine' }, 3);
    expect(mergeStage(keepMineAfterRemoval.stage, doc(), 3).conflicts).toEqual([]);
    // Both removed: it is already saved, so there is nothing to ask.
    expect(mergeStage(mineRemoved, doc(), 3).conflicts).toEqual([]);
    expect(stageCount(mergeStage(mineRemoved, doc(), 3).stage)).toBe(0);
  });

  test('both added the same custom key, differently: a conflict; the same: dropped', () => {
    const empty = doc();
    const stage = stageOf(empty, { 'custom.dock_rules': custom('custom.dock_rules', 'Mine') });
    const different = mergeStage(stage, doc([custom('custom.dock_rules', 'Theirs')]), 3);
    expect(different.conflicts).toHaveLength(1);
    expect(different.conflicts[0]).toMatchObject({
      base: null,
      theirs: custom('custom.dock_rules', 'Theirs'),
    });
    const same = mergeStage(stage, doc([custom('custom.dock_rules', 'Mine')]), 3);
    expect(same.conflicts).toEqual([]);
    expect(stageCount(same.stage)).toBe(0);
    expect(same.dropped).toEqual([{ kind: 'fact', key: 'custom.dock_rules' }]);
  });

  test('section marks merge the same way, and an open mark conflict also survives a second merge', () => {
    const saved = doc([], [{ section: 5, note: 'Base note' }]);
    // I changed the note of 5 and added 7; they changed 5 differently and added 7 the same.
    const stage = stageOf(saved, {}, { 5: 'My note', 7: 'Same note' });
    const theirs = doc(
      [],
      [
        { section: 5, note: 'Their note' },
        { section: 7, note: 'Same note' },
      ],
    );
    const { stage: merged, conflicts, dropped } = mergeStage(stage, theirs, 3);
    expect(conflicts).toEqual([
      { kind: 'mark', key: '5', base: 'Base note', mine: 'My note', theirs: 'Their note' },
    ]);
    expect(dropped).toEqual([{ kind: 'mark', key: '7' }]);
    expect(Object.keys(merged.marks)).toEqual(['5']);
    expect(merged.marks['5']!.base).toBe('Base note');
    expect(mergeStage(merged, theirs, 3).conflicts).toEqual(conflicts);
    const use = resolve(merged, conflicts, { 'mark:5': 'theirs' }, 3);
    expect(applyStage(theirs, use.stage).sectionMarks).toEqual(theirs.sectionMarks);
    const keep = resolve(merged, conflicts, { 'mark:5': 'mine' }, 3);
    expect(applyStage(theirs, keep.stage).sectionMarks).toContainEqual({
      section: 5,
      note: 'My note',
    });
    expect(mergeStage(keep.stage, theirs, 3).conflicts).toEqual([]);
    // They unmarked a section I marked differently.
    const removed = mergeStage(stage, doc(), 3);
    expect(removed.conflicts.map(conflictId)).toEqual(['mark:5']);
    // Unmarked by me, untouched by them: mine applies.
    const unmark = stageOf(saved, {}, { 5: null });
    const clean = mergeStage(unmark, saved, 3);
    expect(clean.conflicts).toEqual([]);
    expect(clean.merged).toEqual([{ kind: 'mark', key: '5' }]);
    expect(applyStage(saved, clean.stage).sectionMarks).toEqual([]);
  });

  test('merging with no open conflict twice changes nothing more', () => {
    const stage = stageOf(baseDoc, { [optionalKey]: fact(optionalKey, 'Mine') });
    const theirs = doc([fact(optionalKey, 'Base'), fact('notes.general', 'Theirs')]);
    const once = mergeStage(stage, theirs, 3);
    const twice = mergeStage(once.stage, theirs, 3);
    expect(twice.stage).toEqual(once.stage);
    expect(twice.conflicts).toEqual([]);
    expect(once.merged).toEqual([{ kind: 'fact', key: optionalKey }]);
    expect(twice.merged).toEqual(once.merged);
  });
});

describe('the mirrored copy', () => {
  const saved = doc([fact(optionalKey, 'Old')], [{ section: 5, note: 'Not part of this route' }]);
  const stage = stageMark(
    stageFact(
      stageFact(emptyStage(7), saved, optionalKey, fact(optionalKey, 'New')),
      saved,
      coreKey,
      null,
    ),
    saved,
    5,
    null,
  );

  test('serialise then parse gives the same stage', () => {
    const text = serialiseStage(stage);
    expect(parseStage(text)).toEqual(stage);
    expect(parseStage(serialiseStage(emptyStage(0)))).toEqual(emptyStage(0));
  });

  test('the text holds the edits and the version only, never a reason', () => {
    const carrying = { ...stage, reason: 'Synthetic secret reason' } as Stage;
    const text = serialiseStage(carrying);
    expect(text).not.toContain('Synthetic secret reason');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['baseVersion', 'facts', 'marks', 'v']);
    // A mirrored text that carries a reason is read without it.
    const withReason = JSON.stringify({
      ...JSON.parse(serialiseStage(stage)),
      reason: 'Synthetic secret reason',
    });
    expect(JSON.stringify(parseStage(withReason))).not.toContain('Synthetic secret reason');
  });

  test.each([
    ['not text', 42],
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['another version', JSON.stringify({ ...JSON.parse(serialiseStage(stage)), v: 2 })],
    [
      'a negative base version',
      JSON.stringify({ ...JSON.parse(serialiseStage(stage)), baseVersion: -1 }),
    ],
    [
      'a base version that is not whole',
      JSON.stringify({ ...JSON.parse(serialiseStage(stage)), baseVersion: 1.5 }),
    ],
    [
      'facts that are not an object',
      JSON.stringify({ v: 1, baseVersion: 1, facts: [], marks: {} }),
    ],
    [
      'a fact under another key',
      JSON.stringify({
        v: 1,
        baseVersion: 1,
        facts: { [coreKey]: { base: null, mine: fact(optionalKey) } },
        marks: {},
      }),
    ],
    [
      'a fact the standard would refuse',
      JSON.stringify({
        v: 1,
        baseVersion: 1,
        facts: { [optionalKey]: { base: null, mine: { key: optionalKey, state: 'MAYBE' } } },
        marks: {},
      }),
    ],
    [
      'an edit that changes nothing',
      JSON.stringify({
        v: 1,
        baseVersion: 1,
        facts: { [optionalKey]: { base: null, mine: null } },
        marks: {},
      }),
    ],
    [
      'a mark of a section that does not exist',
      JSON.stringify({
        v: 1,
        baseVersion: 1,
        facts: {},
        marks: { '18': { base: null, mine: 'Note' } },
      }),
    ],
    [
      'a mark note that is not text',
      JSON.stringify({ v: 1, baseVersion: 1, facts: {}, marks: { '5': { base: null, mine: 7 } } }),
    ],
    ['a copy over the size kept', 'x'.repeat(700000)],
  ])('%s is ignored: the result is null, not half a stage', (_name, text) => {
    expect(parseStage(text)).toBeNull();
  });
});

describe('cautionKeys and warningWords', () => {
  const live = { status: 'ACTIVE' as const, configuration: {} };
  const filled = (keys: string[]) => doc(keys.map((key) => fact(key)));

  test('cautionKeys is the shared go-live check: the Core fields a save turns Pending on a live route', () => {
    const coreContent = standardFieldsV1
      .filter((f) => f.part === 'Content' && f.core)
      .map((f) => f.key);
    expect(coreContent.length).toBeGreaterThan(1);
    expect(coreKeysV1).toEqual(expect.arrayContaining(coreContent));
    const [first, second] = [coreContent[0]!, coreContent[1]!];
    const before = filled([first!, second!]);
    const after = filled([second!]);
    expect(cautionKeys(live, before, after)).toEqual([first]);
    const check = goLiveCheck({
      before: { pack: live, document: before },
      after: { pack: live, document: after },
    });
    expect(check).toEqual({
      ok: true,
      warnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: [first] }],
    });
    // Nothing turns Pending: no caution. Not live: no caution. No pack: no caution.
    expect(cautionKeys(live, before, before)).toEqual([]);
    expect(cautionKeys({ status: 'TESTING', configuration: {} }, before, after)).toEqual([]);
    expect(cautionKeys(null, before, after)).toEqual([]);
    // A first save on a live route turns nothing Pending that was not Pending already.
    expect(cautionKeys(live, null, after)).toEqual([]);
    expect(deriveCompleteness(live, after, day).pendingCore).toContain(first);
  });

  test('warningWords: one sentence per warning with labels, then that this does not clear the route', () => {
    const label = standardFieldsV1.find((f) => f.key === coreKey)!.label;
    const turns = [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING' as const, keys: [coreKey] }];
    expect(warningWords(turns)).toBe(
      `These Core fields are now Pending on a live route: ${label}. This does not mean the route is cleared.`,
    );
    expect(warningWords(turns)).toBe(goLiveWarningsMessage(turns));
    const going = [
      {
        code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE' as const,
        keys: [coreKey, 'travel.visa_lead_time_days'],
      },
    ];
    expect(warningWords(going)).toBe(goLiveWarningsMessage(going));
    expect(warningWords(going, (key) => `<${key}>`)).toContain(
      `<${coreKey}>, <travel.visa_lead_time_days>`,
    );
    expect(warningWords([])).toBe('');
    expect(warningWords([{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: [] }])).toBe('');
  });
});

// ---- PR 2b, carry A of G70's verification of PR 2a: nothing sends a conflicted stage on top of a newer version ----------------

const routeId = '00000000-0000-4000-8000-000000000101';
const command = '00000000-0000-4000-8000-0000000000aa';
const reason = 'Added the 2027 public holidays';

describe('carry A: the body of a save is built in one place and its version is the version of the stage plus 1', () => {
  test('a stage made on version 5 saves as version 6, with the whole document', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    const stage = stageFact(emptyStage(5), saved, optionalKey, fact(optionalKey, 'Mine'));
    const result = prepareSave({ stage, document: saved, routeId, id: command, reason });
    expect(result).toEqual({
      ok: true,
      body: {
        id: command,
        routeId,
        version: 6,
        document: doc([fact(optionalKey, 'Mine')]),
        reason,
      },
    });
    expect(canSave(stage)).toBe(true);
  });

  test('the id may be chosen from the rest of the body, so one id belongs to one body', () => {
    const saved = doc([]);
    const stage = stageFact(emptyStage(0), saved, optionalKey, fact(optionalKey, 'Mine'));
    let seen: unknown = null;
    const result = prepareSave({
      stage,
      document: saved,
      routeId,
      reason,
      id: (rest) => {
        seen = rest;
        return command;
      },
    });
    expect(result.ok && result.body.id).toBe(command);
    expect(seen).toEqual({
      routeId,
      version: 1,
      document: doc([fact(optionalKey, 'Mine')]),
      reason,
    });
  });

  test('a newer version given with no clash to resolve is not taken: a stage made on 5 is sent as 6, so the server refuses it instead of saving over version 7', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    const stage = stageFact(emptyStage(5), saved, optionalKey, fact(optionalKey, 'Mine'));
    // A stage restored from an older version whose check never ran (or failed): the page knows version 7 is saved now.
    expect(resolve(stage, [], {}, 7).stage.baseVersion).toBe(5);
    expect(
      prepareSave({ stage, document: saved, routeId, id: command, reason, theirsVersion: 7 }),
    ).toMatchObject({ ok: true, body: { version: 6 } });
    expect(canSave(stage, [], {}, 7)).toBe(true);
    // After the merge that read version 7 (nothing clashes), the stage stands on 7 and is sent as 8.
    const merged = mergeStage(stage, saved, 7);
    expect(merged.conflicts).toEqual([]);
    expect(
      prepareSave({
        stage: merged.stage,
        document: saved,
        routeId,
        id: command,
        reason,
        theirsVersion: 7,
      }),
    ).toMatchObject({ ok: true, body: { version: 8 } });
  });

  test('after a merge onto version 7 with a clash, nothing can be sent until every clash has a choice; it never sends version 8 conflicted', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    const stage = stageFact(emptyStage(5), saved, optionalKey, fact(optionalKey, 'Mine'));
    const theirs = doc([fact(optionalKey, 'Theirs')]);
    const merged = mergeStage(stage, theirs, 7);
    expect(merged.conflicts).toHaveLength(1);
    // The stage keeps its old version while the clash is open, and a body built now is refused.
    expect(merged.stage.baseVersion).toBe(5);
    const open = { stage: merged.stage, document: theirs, routeId, id: command, reason };
    expect(prepareSave({ ...open, conflicts: merged.conflicts, theirsVersion: 7 })).toEqual({
      ok: false,
      why: 'conflict',
    });
    expect(canSave(merged.stage, merged.conflicts, {}, 7)).toBe(false);
    expect(openConflictIds(merged.stage, merged.conflicts, {})).toEqual([
      conflictId(merged.conflicts[0]!),
    ]);
    // A choice for another key is no choice for this one.
    expect(canSave(merged.stage, merged.conflicts, { 'fact:other.key': 'mine' }, 7)).toBe(false);
    const chosen = { [conflictId(merged.conflicts[0]!)]: 'mine' as const };
    expect(canSave(merged.stage, merged.conflicts, chosen, 7)).toBe(true);
    const sent = prepareSave({
      ...open,
      conflicts: merged.conflicts,
      choices: chosen,
      theirsVersion: 7,
    });
    expect(sent).toMatchObject({ ok: true, body: { version: 8 } });
    expect(sent.ok && sent.body.document).toEqual(doc([fact(optionalKey, 'Mine')]));
  });

  test('one choice missing among several still refuses; with all chosen the version is theirs plus 1', () => {
    const [a, b] = [
      optionalKey,
      standardFieldsV1.find(
        (f) => f.type === 'text' && f.key !== optionalKey && !f.core && f.part === 'Content',
      )!.key,
    ];
    const saved = doc([fact(a, 'A saved'), fact(b, 'B saved')]);
    let stage = stageFact(emptyStage(2), saved, a, fact(a, 'A mine'));
    stage = stageFact(stage, saved, b, fact(b, 'B mine'));
    const theirs = doc([fact(a, 'A theirs'), fact(b, 'B theirs')]);
    const merged = mergeStage(stage, theirs, 9);
    expect(merged.conflicts).toHaveLength(2);
    const base = {
      stage: merged.stage,
      document: theirs,
      conflicts: merged.conflicts,
      theirsVersion: 9,
      routeId,
      id: command,
      reason,
    };
    const idA = conflictId(merged.conflicts.find((c) => c.key === a)!);
    const idB = conflictId(merged.conflicts.find((c) => c.key === b)!);
    expect(prepareSave({ ...base, choices: { [idA]: 'mine' } })).toEqual({
      ok: false,
      why: 'conflict',
    });
    const both = prepareSave({ ...base, choices: { [idA]: 'mine', [idB]: 'theirs' } });
    expect(both).toMatchObject({ ok: true, body: { version: 10 } });
    // Use theirs leaves the saved value of B in the document.
    expect(both.ok && both.body.document.facts.map((f) => f.value)).toEqual(['A mine', 'B theirs']);
  });

  test('a merge with nothing clashing is on the new version at once and saves as theirs plus 1, on top of theirs', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    const other = standardFieldsV1.find(
      (f) => f.type === 'text' && !f.core && f.part === 'Content' && f.key !== optionalKey,
    )!.key;
    const stage = stageFact(emptyStage(5), saved, optionalKey, fact(optionalKey, 'Mine'));
    const theirs = doc([fact(optionalKey, 'Saved'), fact(other, 'Added by them')]);
    const merged = mergeStage(stage, theirs, 7);
    expect(merged.conflicts).toEqual([]);
    const sent = prepareSave({
      stage: merged.stage,
      document: theirs,
      routeId,
      id: command,
      reason,
    });
    expect(sent).toMatchObject({ ok: true, body: { version: 8 } });
    expect(sent.ok && sent.body.document.facts.map((f) => f.key)).toEqual([optionalKey, other]);
    expect(isBehind(stage, 7)).toBe(true);
    expect(isBehind(merged.stage, 7)).toBe(false);
  });

  test('after resolve the version is theirs plus 1, and a stage that resolved to nothing is not saved', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    const stage = stageFact(emptyStage(5), saved, optionalKey, fact(optionalKey, 'Mine'));
    const theirs = doc([fact(optionalKey, 'Theirs')]);
    const merged = mergeStage(stage, theirs, 12);
    const choices = { [conflictId(merged.conflicts[0]!)]: 'theirs' as const };
    expect(resolve(merged.stage, merged.conflicts, choices, 12).stage.baseVersion).toBe(12);
    // Use theirs for the only edit leaves nothing to save.
    expect(canSave(merged.stage, merged.conflicts, choices, 12)).toBe(false);
    expect(
      prepareSave({
        stage: merged.stage,
        document: theirs,
        conflicts: merged.conflicts,
        choices,
        theirsVersion: 12,
        routeId,
        id: command,
        reason,
      }),
    ).toEqual({ ok: false, why: 'nothing' });
  });

  test('nothing staged and a reason of 2 or 501 characters give no body; 3 and 500 do, trimmed', () => {
    const saved = doc([]);
    expect(
      prepareSave({ stage: emptyStage(3), document: saved, routeId, id: command, reason }),
    ).toEqual({ ok: false, why: 'nothing' });
    expect(canSave(emptyStage(3))).toBe(false);
    const stage = stageFact(emptyStage(3), saved, optionalKey, fact(optionalKey, 'Mine'));
    const make = (text: string) =>
      prepareSave({ stage, document: saved, routeId, id: command, reason: text });
    expect(make('ab')).toEqual({ ok: false, why: 'reason' });
    expect(make('  a  ')).toEqual({ ok: false, why: 'reason' });
    expect(make('x'.repeat(501))).toEqual({ ok: false, why: 'reason' });
    expect(make('abc')).toMatchObject({ ok: true, body: { reason: 'abc' } });
    expect(make(`  ${'x'.repeat(500)}  `)).toMatchObject({ ok: true });
    expect(make('  Added it  ')).toMatchObject({ ok: true, body: { reason: 'Added it' } });
  });

  test('overlayDocument is the saved document with the stage applied', () => {
    const saved = doc([fact(optionalKey, 'Saved')]);
    const stage = stageFact(emptyStage(1), saved, optionalKey, null);
    expect(overlayDocument(saved, stage)).toEqual(doc([]));
    expect(overlayDocument(saved, emptyStage(1))).toEqual(saved);
  });
});

// ---- PR 2b, carry B: what is staged is what contentFact reads, so a restore never drops the whole stage ----------------------

describe('carry B: stageFact reads the fact through contentFact, as parseStage does', () => {
  test("base 'x' and mine 'x ' is no edit; 'y ' stages 'y'", () => {
    const saved = doc([custom('custom.dock', 'x')]);
    const same = stageFact(
      emptyStage(1),
      saved,
      'custom.dock',
      custom('custom.dock', 'x', { note: 'n ' }),
    );
    // A note is trimmed by the schema, so only a real difference stages.
    expect(same.facts['custom.dock']!.mine!.note).toBe('n');
    const nothing = stageFact(
      emptyStage(1),
      doc([custom('custom.dock', 'x', { note: 'n' })]),
      'custom.dock',
      custom('custom.dock', 'x', { note: 'n ' }),
    );
    expect(stageCount(nothing)).toBe(0);
    const label = stageFact(
      emptyStage(1),
      doc([custom('custom.dock', 'x', { label: 'Dock rules' })]),
      'custom.dock',
      custom('custom.dock', 'x', { label: 'Dock rules  ' }),
    );
    expect(stageCount(label)).toBe(0);
    const y = stageFact(
      emptyStage(1),
      saved,
      'custom.dock',
      custom('custom.dock', 'x', { note: 'y ' }),
    );
    expect(y.facts['custom.dock']!.mine!.note).toBe('y');
  });

  test('a staged fact survives serialiseStage then parseStage as the same stage, never null', () => {
    const saved = doc([custom('custom.dock', 'x', { note: 'n' })]);
    const stage = stageFact(
      emptyStage(4),
      saved,
      'custom.dock',
      custom('custom.dock', 'x', { note: 'n2  ' }),
    );
    expect(stageCount(stage)).toBe(1);
    expect(parseStage(serialiseStage(stage))).toEqual(stage);
    // The case G70 found: the base was 'x', the edit 'x ' (equal once read), which used to be staged and then dropped on restore.
    const odd = stageFact(
      emptyStage(4),
      doc([custom('custom.dock', 'x', { label: 'Dock rules' })]),
      'custom.dock',
      custom('custom.dock', 'x', { label: ' Dock rules ' }),
    );
    expect(parseStage(serialiseStage(odd))).toEqual(odd);
  });

  test('a fact that does not read, or whose key is another key, leaves the stage as it was', () => {
    const saved = doc([]);
    const before = stageFact(emptyStage(1), saved, optionalKey, fact(optionalKey, 'One'));
    expect(
      stageFact(before, saved, optionalKey, {
        key: optionalKey,
        state: 'FILLED',
        source: 'not a source',
      } as ContentFact),
    ).toBe(before);
    expect(stageFact(before, saved, optionalKey, fact(coreKey, 'Wrong key'))).toBe(before);
    expect(
      stageFact(before, saved, optionalKey, {
        ...fact(optionalKey),
        extra: 1,
      } as unknown as ContentFact),
    ).toBe(before);
  });
});
