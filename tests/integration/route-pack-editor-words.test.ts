import { describe, expect, test } from 'vitest';
import {
  goLiveWarningsMessage,
  standardFieldByKey,
  standardFieldsV1,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';
import {
  conflictId,
  emptyStage,
  mergeStage,
  stageFact,
  stageMark,
  type Conflict,
} from '../../apps/web/lib/route-pack-editor-stage';
import * as words from '../../apps/web/lib/route-pack-editor-words';

// ADR-093 Phase 3, PR 2b: the words that carry a number or a name, from one library. Every string is the designer's.
const day = '2026-11-20';
const fact = (key: string, extra: Partial<ContentFact> = {}): ContentFact => ({
  key,
  state: 'FILLED',
  value: 'A value',
  source: 'staff knowledge',
  observedOn: day,
  ...extra,
});
const label = (key: string) => standardFieldByKey.get(key)?.label ?? key;
const [a, b, c] = standardFieldsV1
  .filter((f) => f.part === 'Content' && f.type === 'text')
  .map((f) => f.key);

describe('counts in words', () => {
  test('singular and plural', () => {
    expect(words.changesNotSaved(1)).toBe('1 change not saved');
    expect(words.changesNotSaved(3)).toBe('3 changes not saved');
    expect(words.reviewAndSave(3)).toBe('Review and Save (3)');
    expect(words.changeKept(3)).toBe('Change kept. 3 changes not saved.');
    expect(words.changeKept(1)).toBe('Change kept. 1 change not saved.');
    expect(words.restoredLine(3)).toBe('Restored 3 changes that were not saved.');
    expect(words.restoredLine(1)).toBe('Restored 1 change that was not saved.');
    expect(words.savedLine(6)).toBe('Saved. Route facts are now version 6.');
    expect(words.discardWords(3)).toBe(
      'This removes 3 changes that are not saved. The saved facts stay as they are.',
    );
    expect(words.discardWords(1)).toBe(
      'This removes 1 change that is not saved. The saved facts stay as they are.',
    );
    expect(words.leaveWords(3)).toBe(
      'Leaving this route removes 3 changes that are not saved. Your saved facts are not affected.',
    );
    // With the tab's copy kept, leaving sets the edits aside: the line never says they are removed (designer audit, spec 9).
    expect(words.leaveWords(3, true)).toBe(
      'Leaving this route puts your 3 unsaved changes aside. Your saved facts are not affected.',
    );
    expect(words.leaveWords(1, true)).toBe(
      'Leaving this route puts your 1 unsaved change aside. Your saved facts are not affected.',
    );
    expect(words.leaveWords(3, false)).toBe(words.leaveWords(3));
    expect(words.leaveTitle).toBe('You Have Changes That Are Not Saved');
    expect(words.leaveKept).toBe('Your changes are kept for this tab session.');
    expect(words.openFieldNotIncluded('Working week')).toBe(
      'Working week is still open and is not included. Keep Change on it first to add it.',
    );
    expect(words.finishOpenField).toBe('Keep Change or Cancel this field first.');
  });
});

describe('the summary lines', () => {
  test('added, changed and removed, in that order, with the standard words', () => {
    const saved = { standardVersion: 1, sectionMarks: [], facts: [fact(b!), fact(c!)] } as const;
    let stage = stageFact(emptyStage(2), saved as never, a!, fact(a!));
    stage = stageFact(stage, saved as never, b!, fact(b!, { value: 'Other' }));
    stage = stageFact(stage, saved as never, c!, null);
    stage = stageFact(
      stage,
      saved as never,
      'custom.dock',
      fact('custom.dock', { label: 'Dock rules', section: 9, type: 'text' }),
    );
    stage = stageMark(stage, saved as never, 5, 'Not held here');
    const { counts, lines } = words.summaryLines(
      stage,
      (key, f) => standardFieldByKey.get(key)?.label ?? f?.label ?? key,
    );
    expect(counts).toEqual({ added: 3, changed: 1, removed: 1 });
    expect(lines).toEqual([
      `Added: ${label(a!)}`,
      'Added: Dock rules',
      'Added: Section 5 marked Not applicable',
      `Changed: ${label(b!)}`,
      `Removed: ${label(c!)} (now Pending)`,
    ]);
    // A custom field taken off is not "now Pending": it simply goes.
    const gone = stageFact(
      emptyStage(1),
      {
        standardVersion: 1,
        sectionMarks: [],
        facts: [fact('custom.dock', { label: 'Holiday notes', section: 9, type: 'text' })],
      },
      'custom.dock',
      null,
    );
    expect(words.summaryLines(gone, (key, f) => f?.label ?? key).lines).toEqual([
      'Removed: Holiday notes',
    ]);
    const unmark = stageMark(
      emptyStage(1),
      { standardVersion: 1, sectionMarks: [{ section: 5, note: 'Not held' }], facts: [] },
      5,
      null,
    );
    expect(words.summaryLines(unmark, label).lines).toEqual(['Removed: Section 5 mark']);
  });
});

describe('the caution is the shared go-live words', () => {
  test('cautionLine equals goLiveWarningsMessage for the same keys, and is empty for none', () => {
    const keys = standardFieldsV1
      .filter((f) => f.core && f.part === 'Content')
      .slice(0, 2)
      .map((f) => f.key);
    expect(words.cautionLine(keys)).toBe(
      goLiveWarningsMessage([{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys }]),
    );
    expect(words.cautionLine(keys)).toMatch(
      /^These Core fields are now Pending on a live route: .+\. This does not mean the route is cleared\.$/,
    );
    expect(words.cautionLine([])).toBe('');
  });
});

describe('labels in a sentence (designer addendum)', () => {
  const list = (labels: string[]) => words.plain(words.labelList(labels));
  test('one, two, three, four or more; each cut at 40 characters', () => {
    expect(list(['A'])).toBe('A');
    expect(list(['A', 'B'])).toBe('A and B');
    expect(list(['A', 'B', 'C'])).toBe('A, B and C');
    expect(list(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 more');
    expect(list(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])).toBe('A, B, C and 6 more');
    const long = 'x'.repeat(60);
    expect(list([long])).toBe(`${'x'.repeat(39)}…`);
    expect(list(['x'.repeat(40)])).toBe('x'.repeat(40));
    // A label that holds "and" or a comma stays one unit: the label is its own piece for the screen to wrap.
    const pieces = words.labelList(['Fairs, shows and expos', 'B']);
    expect(pieces).toContainEqual({ label: 'Fairs, shows and expos' });
  });

  test('merged and dropped lines: singular for one, plural for more, nothing for none', () => {
    const plain = words.plain;
    expect(words.mergedLine([])).toBeNull();
    expect(words.droppedLine([])).toBeNull();
    expect(plain(words.mergedLine(['Working week'])!)).toBe(
      'Your change to Working week is kept. The other save did not change that fact.',
    );
    expect(
      plain(
        words.mergedLine([
          'Working week',
          'Usual business hours',
          'Public holidays',
          'Currency',
          'Fairs',
        ])!,
      ),
    ).toBe(
      'Your changes to Working week, Usual business hours, Public holidays and 2 more are kept. The other save did not change those facts.',
    );
    expect(plain(words.droppedLine(['Currency'])!)).toBe(
      'The other save already includes your change to Currency, so nothing is left to save for it.',
    );
    expect(plain(words.droppedLine(['Currency', 'Fairs'])!)).toBe(
      'The other save already includes your changes to Currency and Fairs, so nothing is left to save for them.',
    );
  });

  test('the banner words', () => {
    expect(words.noClashFirst(7)).toBe(
      'Someone saved route facts for this route first. Their changes do not clash with yours. The latest version is 7.',
    );
    expect(words.allDroppedWords(7)).toBe(
      'Someone saved route facts for this route first. It already includes all of your changes. The latest version is 7. There is nothing left to save.',
    );
    expect(words.checkSummary).toBe('Check the summary, then save again.');
    expect(words.clashHeading(false)).toBe('Someone saved route facts for this route first.');
    expect(words.clashHeading(true)).toBe('Someone saved route facts again first.');
    expect(words.clashKept).toBe('Facts only one of you changed are kept as they are.');
    expect(words.clashAsk).toBe('You both changed the facts below. Choose one answer for each.');
    expect(words.checkingWords).toBe('Checking what changed…');
    expect(words.conflictStepWords(1, 2)).toBe('Step 1 of 2: Choices · Next: Choices');
    expect(words.conflictStepWords(2, 2)).toBe('Step 2 of 2: Choices');
    expect(words.choosePrompt).toBe('Choose for Each Fact');
  });

  test('the editor order: the standard rows first in the standard order, then custom fields, then marks; marks are Section N mark', () => {
    const notes = [
      { kind: 'mark' as const, key: '5' },
      { kind: 'fact' as const, key: 'custom.zed' },
      { kind: 'fact' as const, key: c! },
      { kind: 'fact' as const, key: a! },
      { kind: 'fact' as const, key: 'custom.alpha' },
    ];
    expect(words.inRowOrder(notes).map((note) => note.key)).toEqual([
      a,
      c,
      'custom.alpha',
      'custom.zed',
      '5',
    ]);
    expect(words.noteLabel({ kind: 'mark', key: '5' }, label)).toBe('Section 5 mark');
    expect(words.noteLabel({ kind: 'fact', key: a! }, label)).toBe(label(a!));
  });
});

describe('the two sides of a clash', () => {
  const clash = (
    base: ContentFact | null,
    mine: ContentFact | null,
    theirs: ContentFact | null,
  ): Conflict => ({
    kind: 'fact',
    key: 'custom.x',
    base,
    mine,
    theirs,
  });
  test('a value is cut at 120 characters, a list is joined with commas, money is exact, a removal and a note read in words', () => {
    const long = 'y'.repeat(200);
    expect(
      words.conflictChoiceWords('mine', clash(null, fact('custom.x', { value: long }), null)),
    ).toBe(`Keep mine: ${'y'.repeat(119)}…`);
    expect(
      words.conflictChoiceWords(
        'theirs',
        clash(null, null, fact('custom.x', { value: ['One', 'Two', 'Three'] })),
      ),
    ).toBe('Use theirs: One, Two, Three');
    expect(
      words.conflictChoiceWords(
        'mine',
        clash(null, fact('custom.x', { value: { currency: 'USD', amountMinor: '4500' } }), null),
      ),
    ).toBe('Keep mine: USD 45.00');
    expect(
      words.conflictChoiceWords('theirs', clash(fact('custom.x'), fact('custom.x'), null)),
    ).toBe('Use theirs: Pending (cleared)');
    expect(
      words.conflictChoiceWords(
        'mine',
        clash(null, { key: 'custom.x', state: 'NOT_APPLICABLE', note: 'Not held here' }, null),
      ),
    ).toBe('Keep mine: Not applicable: Not held here');
    const mark: Conflict = { kind: 'mark', key: '5', base: null, mine: 'Not held', theirs: null };
    expect(words.conflictChoiceWords('mine', mark)).toBe('Keep mine: Not applicable: Not held');
    expect(words.conflictChoiceWords('theirs', mark)).toBe('Use theirs: No mark');
  });

  test('real clashes from the merge read the same', () => {
    const saved = {
      standardVersion: 1,
      sectionMarks: [],
      facts: [fact(a!, { value: 'Saved' })],
    } as never;
    const stage = stageFact(emptyStage(1), saved, a!, fact(a!, { value: 'Mine' }));
    const merged = mergeStage(
      stage,
      { standardVersion: 1, sectionMarks: [], facts: [fact(a!, { value: 'Theirs' })] },
      2,
    );
    expect(
      merged.conflicts.map((item) => [
        conflictId(item),
        words.conflictChoiceWords('mine', item),
        words.conflictChoiceWords('theirs', item),
      ]),
    ).toEqual([[`fact:${a}`, 'Keep mine: Mine', 'Use theirs: Theirs']]);
  });
});

describe('no em dash anywhere', () => {
  test('every string the library exports or builds', () => {
    const strings: string[] = [];
    for (const value of Object.values(words)) if (typeof value === 'string') strings.push(value);
    strings.push(
      words.leaveWords(0),
      words.leaveWords(2),
      words.discardWords(2),
      words.nothingLeftToSave,
      words.pendingClears,
      words.removeFieldHelp,
    );
    for (const text of strings) expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
