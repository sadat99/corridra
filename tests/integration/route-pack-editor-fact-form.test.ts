import { describe, expect, test } from 'vitest';
import {
  contentDocumentIssues,
  parseContentDocument,
  standardFieldsV1,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';
import {
  answersFor,
  coveredHelp,
  customDefinition,
  customField,
  customKeyFor,
  draftFromFact,
  emptyDraft,
  factFromDraft,
  fieldOfCustomFact,
  lockedCoreHelp,
  refusalWords,
  standardField,
  type FactDraft,
  type FormField,
} from '../../apps/web/lib/route-pack-editor-fact-form';

// ADR-093 Phase 3, PR 2a: the pure step from what a person typed into a row to a ContentFact, with the words of spec 8.8.
const today = '2026-11-27';
const yesterday = '2026-11-26';
const field = (predicate: (f: (typeof standardFieldsV1)[number]) => boolean) => {
  const found = standardFieldsV1.find(predicate);
  if (!found) throw new Error('No such standard field');
  return standardField(found.key)!;
};
const textRow = field((f) => f.part === 'Content' && f.type === 'text' && f.core);
const optionalText = field(
  (f) => f.part === 'Content' && f.type === 'text' && !f.core && f.maxLength === 1000,
);
const numberRow = field((f) => f.type === 'number');
const linkRow = field((f) => f.type === 'link');
const listRow = field(
  (f) => f.part === 'Content' && f.type === 'list' && !f.allowed && !f.itemPattern,
);
const allowedListRow = field((f) => f.part === 'Content' && f.type === 'list' && !!f.allowed);
const lockedCore = field((f) => f.part === 'Locked' && f.core);
const lockedOptional = field((f) => f.part === 'Locked' && !f.core);
const draft = (change: Partial<FactDraft> = {}): FactDraft => ({
  ...emptyDraft(today),
  observedOn: yesterday,
  ...change,
});
const built = (row: FormField, change: Partial<FactDraft>) =>
  factFromDraft(row, draft(change), today);
const okFact = (row: FormField, change: Partial<FactDraft>) => {
  const result = built(row, change);
  if (!result.ok) throw new Error(`Refused: ${result.refusals.map((r) => r.message).join(' ')}`);
  return result.fact;
};
const refusals = (row: FormField, change: Partial<FactDraft>) => {
  const result = built(row, change);
  if (result.ok) throw new Error('Expected a refusal');
  return result.refusals;
};
// A fact this file returns always passes the rules of the document (the server stays the authority).
const passes = (fact: ContentFact | null) => {
  if (!fact) return;
  expect(contentDocumentIssues({ standardVersion: 1, sectionMarks: [], facts: [fact] })).toEqual(
    [],
  );
  expect(() =>
    parseContentDocument({ standardVersion: 1, sectionMarks: [], facts: [fact] }),
  ).not.toThrow();
};
const customRow = (type: string, allowedValues?: string[], key = 'custom.sample') => {
  const defined = customDefinition({ label: 'Sample field', section: 9, type, allowedValues });
  if (!defined.ok) throw new Error('Definition refused');
  return customField(key, defined.definition);
};

describe('every type builds a fact the standard accepts', () => {
  test('text: trimmed, with a source and an observed date', () => {
    const fact = okFact(textRow, { text: '  A sample note  ' });
    expect(fact).toEqual({
      key: textRow.key,
      state: 'FILLED',
      value: 'A sample note',
      source: 'staff knowledge',
      observedOn: yesterday,
    });
    passes(fact);
  });

  test('a web address source and a valid until date', () => {
    const fact = okFact(optionalText, {
      text: 'Value',
      source: 'web',
      address: ' https://example.org/rules ',
      validUntil: '2027-06-30',
    });
    expect(fact).toMatchObject({ source: 'https://example.org/rules', validUntil: '2027-06-30' });
    passes(fact);
  });

  test('number: whole numbers where the field says so, and the one standard number field is whole days from 0', () => {
    expect(okFact(numberRow, { text: '30' })).toMatchObject({ value: '30' });
    expect(okFact(numberRow, { text: '0' })).toMatchObject({ value: '0' });
    passes(okFact(numberRow, { text: '9999' }));
    for (const typed of ['-3', '2.5', '10000', '007', '', 'abc', '+5', '-0'])
      expect(refusals(numberRow, { text: typed })[0]).toMatchObject({
        field: 'text',
        message: 'Use a whole number, such as 12.',
      });
  });

  test('a custom number field takes decimals and a minus sign, and writes them in the form the standard stores', () => {
    const row = customRow('number');
    for (const [typed, stored] of [
      ['12', '12'],
      ['12.5', '12.5'],
      ['12.50', '12.5'],
      ['12.0', '12'],
      ['-4', '-4'],
      ['-0.25', '-0.25'],
    ] as const) {
      const fact = okFact(row, { text: typed });
      expect(fact).toMatchObject({ value: stored });
      passes(fact);
    }
    for (const typed of ['-0', '1,5', '1e3', ' ', '12.1234567', '1234567890123456'])
      expect(refusals(row, { text: typed })[0]!.message).toBe('Use a number, such as 12 or 12.5.');
  });

  test('money: exact minor units in its own currency, never converted', () => {
    const row = customRow('money');
    const fact = okFact(row, { currency: 'usd', amount: '45.00' });
    expect(fact).toMatchObject({ value: { currency: 'USD', amountMinor: '4500' } });
    passes(fact);
    expect(okFact(row, { currency: 'USD', amount: '45' })).toMatchObject({
      value: { amountMinor: '4500' },
    });
    expect(okFact(row, { currency: 'USD', amount: '0.05' })).toMatchObject({
      value: { amountMinor: '5' },
    });
    expect(okFact(row, { currency: 'USD', amount: '45.5' })).toMatchObject({
      value: { amountMinor: '4550' },
    });
    // A currency with no minor unit and one with three.
    expect(okFact(row, { currency: 'JPY', amount: '1200' })).toMatchObject({
      value: { currency: 'JPY', amountMinor: '1200' },
    });
    expect(okFact(row, { currency: 'BHD', amount: '1.234' })).toMatchObject({
      value: { currency: 'BHD', amountMinor: '1234' },
    });
  });

  test('money refuses extra decimals with the words of the spec, a zero or negative amount and a currency that is not one', () => {
    const row = customRow('money');
    expect(refusals(row, { currency: 'USD', amount: '45.001' })).toEqual([
      { field: 'amount', message: 'Use at most 2 decimals for USD' },
    ]);
    expect(refusals(row, { currency: 'JPY', amount: '1200.5' })[0]!.message).toBe(
      'Use no decimals for JPY',
    );
    expect(refusals(row, { currency: 'BHD', amount: '1.2345' })[0]!.message).toBe(
      'Use at most 3 decimals for BHD',
    );
    expect(refusals(row, { currency: 'USD', amount: '0' })[0]!.message).toBe(
      'Enter an amount above zero.',
    );
    expect(refusals(row, { currency: 'USD', amount: '0.00' })[0]!.message).toBe(
      'Enter an amount above zero.',
    );
    expect(refusals(row, { currency: 'USD', amount: '-5' })[0]!.field).toBe('amount');
    expect(refusals(row, { currency: 'USD', amount: '4,5' })[0]!.field).toBe('amount');
    expect(refusals(row, { currency: 'USD', amount: '' })[0]!.field).toBe('amount');
    expect(refusals(row, { currency: 'ZZZ', amount: '5' })[0]).toEqual({
      field: 'currency',
      message: 'Choose a currency.',
    });
    expect(refusals(row, { currency: 'USD', amount: '1'.repeat(19) })[0]!.message).toBe(
      'That amount is too large.',
    );
  });

  test('date: written YYYY-MM-DD and a real day', () => {
    const row = customRow('date');
    passes(okFact(row, { text: '2027-02-28' }));
    for (const typed of ['2027-02-30', '28/02/2027', '2027-2-3', ''])
      expect(refusals(row, { text: typed })[0]!.message).toBe('Write the date as YYYY-MM-DD.');
  });

  test('choice: one of the allowed answers', () => {
    const row = customRow('choice', ['Sea', 'Air']);
    expect(okFact(row, { text: 'Air' })).toMatchObject({
      value: 'Air',
      type: 'choice',
      allowedValues: ['Sea', 'Air'],
    });
    passes(okFact(row, { text: 'Sea' }));
    expect(refusals(row, { text: 'Road' })[0]!.message).toBe('Choose one of the answers.');
  });

  test('list: entries trimmed, blanks dropped, the allowed values and the item pattern respected', () => {
    const fact = okFact(listRow, { items: [' First ', '', 'Second'] });
    expect(fact).toMatchObject({ value: ['First', 'Second'] });
    passes(fact);
    expect(refusals(listRow, { items: ['', '  '] })[0]).toEqual({
      field: 'items',
      message: 'Add at least one entry.',
    });
    expect(refusals(listRow, { items: ['x'.repeat(listRow.maxLength + 1)] })[0]!.message).toBe(
      refusalWords.limit(listRow.maxLength + 1, listRow.maxLength),
    );
    const allowed = allowedListRow.allowed![0]!;
    passes(okFact(allowedListRow, { items: [allowed] }));
    expect(refusals(allowedListRow, { items: ['not an allowed value'] })[0]!.message).toBe(
      'Choose from the answers offered.',
    );
    expect(
      refusals(listRow, {
        items: Array.from({ length: (listRow.maxItems ?? 100) + 1 }, (_, i) => `Item ${i}`),
      })[0]!.message,
    ).toMatch(/^Add at most \d+ entries\.$/);
    // The sheet uses the | sign to separate values, so the server refuses it and the words come from the domain.
    expect(refusals(listRow, { items: ['a|b'] })[0]!.message).toContain('|');
  });

  test('link: starts with https://', () => {
    passes(okFact(linkRow, { text: 'https://example.org/page' }));
    for (const typed of ['http://example.org', 'example.org', 'https://', 'https:// space'])
      expect(refusals(linkRow, { text: typed })[0]!.message).toBe(
        'Give a web address that starts with https://.',
      );
  });
});

describe('the refusals, in the words of spec 8.8', () => {
  test('an email address in a value, a note or a source', () => {
    expect(refusals(optionalText, { text: 'Write to a@b.example' })).toEqual([
      { field: 'text', message: refusalWords.email },
    ]);
    expect(refusals(optionalText, { answer: 'NOT_APPLICABLE', note: 'Ask a@b.example' })).toEqual([
      { field: 'note', message: refusalWords.email },
    ]);
    expect(
      refusals(optionalText, {
        text: 'Fine',
        source: 'web',
        address: 'https://user@host.example/x',
      })[0],
    ).toEqual({
      field: 'address',
      message: refusalWords.email,
    });
    expect(refusals(listRow, { items: ['ok', 'me@host.example'] })).toEqual([
      { field: 'items', message: refusalWords.email },
    ]);
    expect(refusalWords.email).toBe(
      'This looks like an email address. Route facts name organisations, places and rules, never people. Remove it.',
    );
  });

  test('over the limit: the count with a thousands separator and the limit', () => {
    expect(refusals(optionalText, { text: 'x'.repeat(1204) })).toEqual([
      { field: 'text', message: 'That is 1,204 characters. The limit is 1000. Shorten it.' },
    ]);
    expect(
      refusals(optionalText, { answer: 'NOT_APPLICABLE', note: 'n'.repeat(1001) })[0]!.message,
    ).toBe('That is 1,001 characters. The limit is 1000. Shorten it.');
    // At the limit it is fine.
    passes(okFact(optionalText, { text: 'x'.repeat(1000) }));
  });

  test('a source that is not https:// or Staff knowledge', () => {
    const words = 'Give a web address that starts with https://, or choose Staff knowledge.';
    for (const address of ['', 'http://example.org', 'example.org', 'ftp://example.org'])
      expect(refusals(optionalText, { text: 'Fine', source: 'web', address })).toEqual([
        { field: 'address', message: words },
      ]);
    expect(refusalWords.source).toBe(words);
  });

  test('Not applicable without a reason', () => {
    for (const note of ['', '   ', 'no'])
      expect(refusals(optionalText, { answer: 'NOT_APPLICABLE', note })).toEqual([
        { field: 'note', message: 'Say why this does not apply to this route.' },
      ]);
    const fact = okFact(optionalText, {
      answer: 'NOT_APPLICABLE',
      note: ' Not part of this route ',
    });
    expect(fact).toEqual({
      key: optionalText.key,
      state: 'NOT_APPLICABLE',
      note: 'Not part of this route',
    });
    passes(fact);
  });

  test('dates: the observed date is needed and not in the future; valid until is not before it', () => {
    expect(refusals(optionalText, { text: 'Fine', observedOn: '' })[0]!.field).toBe('observedOn');
    expect(refusals(optionalText, { text: 'Fine', observedOn: '2026-11-28' })[0]).toEqual({
      field: 'observedOn',
      message: 'The observed date cannot be in the future.',
    });
    expect(refusals(optionalText, { text: 'Fine', validUntil: '2026-11-01' })[0]).toEqual({
      field: 'validUntil',
      message: 'Valid until must be on or after the observed date.',
    });
    expect(refusals(optionalText, { text: 'Fine', validUntil: 'soon' })[0]!.field).toBe(
      'validUntil',
    );
    passes(okFact(optionalText, { text: 'Fine', observedOn: today, validUntil: today }));
  });

  test('every refusal comes back at once, in the order of the form', () => {
    const all = refusals(optionalText, {
      text: '',
      source: 'web',
      address: 'nope',
      observedOn: '',
    });
    expect(all.map((item) => item.field)).toEqual(['text', 'address', 'observedOn']);
  });

  test('a rule the form does not word falls back to the domain message (a Locked row takes no value)', () => {
    const result = built(lockedOptional, { text: 'Anything' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals[0]!.message).toContain('belongs to the locked pack');
  });
});

describe('Pending, Remove Field and the draft of a row', () => {
  test('Pending and Remove Field give no fact: the fact leaves the document', () => {
    expect(built(optionalText, { answer: 'PENDING' })).toEqual({ ok: true, fact: null });
    expect(built(customRow('text'), { answer: 'REMOVE' })).toEqual({ ok: true, fact: null });
  });

  test('draftFromFact then factFromDraft gives the fact back, for every kind of answer', () => {
    const facts: [FormField, ContentFact][] = [
      [
        textRow,
        {
          key: textRow.key,
          state: 'FILLED',
          value: 'Text',
          source: 'staff knowledge',
          observedOn: yesterday,
        },
      ],
      [
        optionalText,
        {
          key: optionalText.key,
          state: 'FILLED',
          value: 'Text',
          source: 'https://example.org/a',
          observedOn: yesterday,
          validUntil: '2027-01-01',
          note: 'Kept',
        },
      ],
      [
        listRow,
        {
          key: listRow.key,
          state: 'FILLED',
          value: ['One', 'Two'],
          source: 'staff knowledge',
          observedOn: yesterday,
        },
      ],
      [
        numberRow,
        {
          key: numberRow.key,
          state: 'FILLED',
          value: '45',
          source: 'staff knowledge',
          observedOn: yesterday,
        },
      ],
      [
        optionalText,
        { key: optionalText.key, state: 'NOT_APPLICABLE', note: 'Not part of this route' },
      ],
    ];
    for (const [row, fact] of facts)
      expect(okFact(row, { ...draftFromFact(row, fact, today) })).toEqual(fact);
    const money = customRow('money');
    const moneyFact = {
      key: 'custom.sample',
      state: 'FILLED',
      value: { currency: 'USD', amountMinor: '4500' },
      source: 'staff knowledge',
      observedOn: yesterday,
      label: 'Sample field',
      section: 9,
      type: 'money',
    } as ContentFact;
    expect(draftFromFact(money, moneyFact, today)).toMatchObject({
      currency: 'USD',
      amount: '45.00',
    });
    expect(okFact(money, { ...draftFromFact(money, moneyFact, today) })).toEqual(moneyFact);
    const yen = { ...moneyFact, value: { currency: 'JPY', amountMinor: '1200' } } as ContentFact;
    expect(draftFromFact(money, yen, today)).toMatchObject({ amount: '1200' });
    expect(okFact(money, { ...draftFromFact(money, yen, today) })).toEqual(yen);
  });

  test('a row with no fact opens as Pending (a custom row as Filled), observed today, source Staff knowledge', () => {
    expect(draftFromFact(optionalText, null, today)).toMatchObject({
      answer: 'PENDING',
      observedOn: today,
      source: 'staff',
      items: [''],
    });
    expect(draftFromFact(customRow('text'), null, today).answer).toBe('FILLED');
  });

  test('a note that a Filled fact already carries is kept; the reason of Not applicable is a separate field', () => {
    const fact = {
      key: optionalText.key,
      state: 'FILLED',
      value: 'v',
      source: 'staff knowledge',
      observedOn: yesterday,
      note: 'Saved by an import',
    } as ContentFact;
    const started = draftFromFact(optionalText, fact, today);
    expect(started.filledNote).toBe('Saved by an import');
    expect(started.note).toBe('');
    // Switching to Not applicable and back does not turn the old note into a reason.
    expect(
      okFact(optionalText, { ...started, answer: 'NOT_APPLICABLE', note: 'Another reason' }),
    ).toEqual({
      key: optionalText.key,
      state: 'NOT_APPLICABLE',
      note: 'Another reason',
    });
  });
});

describe('answersFor', () => {
  test('a standard content row offers Filled, Not applicable and Pending', () => {
    expect(answersFor({ field: optionalText })).toEqual(['FILLED', 'NOT_APPLICABLE', 'PENDING']);
    expect(answersFor({ field: textRow })).toEqual(['FILLED', 'NOT_APPLICABLE', 'PENDING']);
  });

  test('Pending is not offered on a row covered by a section marked Not applicable, and the help says why', () => {
    expect(answersFor({ field: optionalText, coveredBySection: true })).toEqual([
      'FILLED',
      'NOT_APPLICABLE',
    ]);
    expect(coveredHelp).toBe(
      'This section is marked Not applicable. Unmark the section to make this field Pending.',
    );
  });

  test('a custom row offers Remove Field as its third answer and never Pending', () => {
    const row = customRow('text');
    expect(answersFor({ field: row })).toEqual(['FILLED', 'NOT_APPLICABLE', 'REMOVE']);
    expect(answersFor({ field: row, coveredBySection: true })).toEqual([
      'FILLED',
      'NOT_APPLICABLE',
      'REMOVE',
    ]);
  });

  test('every Locked row is read only in PR 2, so no Locked Core row offers Not applicable (or anything)', () => {
    for (const locked of standardFieldsV1.filter((f) => f.part === 'Locked')) {
      const row = standardField(locked.key)!;
      expect(answersFor({ field: row })).toEqual([]);
      expect(answersFor({ field: row, coveredBySection: true })).toEqual([]);
    }
    expect(answersFor({ field: lockedCore })).not.toContain('NOT_APPLICABLE');
    expect(lockedCoreHelp).toBe('An empty list is not the same as does not apply.');
  });

  test('every standard content row offers at least Filled and can be built as a fact', () => {
    for (const standard of standardFieldsV1.filter((f) => f.part === 'Content'))
      expect(answersFor({ field: standardField(standard.key)! })).toContain('FILLED');
  });
});

describe('custom fields', () => {
  test('customKeyFor makes a short key from the label and never one that is taken', () => {
    expect(customKeyFor('Dock opening hours')).toBe('custom.dock_opening_hours');
    expect(customKeyFor('  Port & Dock -- Rules!  ')).toBe('custom.port_dock_rules');
    expect(customKeyFor('Dock', ['custom.dock'])).toBe('custom.dock_2');
    expect(customKeyFor('Dock', ['custom.dock', 'custom.dock_2'])).toBe('custom.dock_3');
    expect(customKeyFor('2027 holidays')).toBe('custom.f_2027_holidays');
    // A label with no Latin letters or digits still gets a valid key.
    expect(customKeyFor('ওষধ')).toBe('custom.field');
    expect(customKeyFor('ওষধ', ['custom.field'])).toBe('custom.field_2');
    const long = customKeyFor('a'.repeat(200), ['custom.' + 'a'.repeat(59)]);
    expect(long).toMatch(/^custom\.[a-z][a-z0-9_]{0,59}$/);
    expect(long).not.toBe('custom.' + 'a'.repeat(59));
    // Always a key the document accepts.
    for (const label of ['Dock', 'Port & Dock', '2027', '!!!', 'x'.repeat(300)])
      expect(customKeyFor(label)).toMatch(/^custom\.[a-z][a-z0-9_]{0,59}$/);
  });

  test('customDefinition checks the label, the section, the type and the allowed values', () => {
    expect(
      customDefinition({
        label: ' Dock rules ',
        section: 9,
        type: 'list',
        allowedValues: [' a ', 'b', 'a'],
      }),
    ).toEqual({
      ok: true,
      definition: { label: 'Dock rules', section: 9, type: 'list', allowedValues: ['a', 'b'] },
    });
    expect(customDefinition({ label: 'Dock rules', section: 9, type: 'text' })).toEqual({
      ok: true,
      definition: { label: 'Dock rules', section: 9, type: 'text' },
    });
    const refused = (input: Parameters<typeof customDefinition>[0]) => {
      const result = customDefinition(input);
      if (result.ok) throw new Error('Expected a refusal');
      return result.refusals.map((item) => item.message);
    };
    expect(refused({ label: ' ', section: 9, type: 'text' })).toEqual(['Give the field a name.']);
    expect(refused({ label: 'x'.repeat(121), section: 9, type: 'text' })).toEqual([
      refusalWords.limit(121, 120),
    ]);
    expect(refused({ label: 'Mail a@b.example', section: 9, type: 'text' })).toEqual([
      refusalWords.email,
    ]);
    expect(refused({ label: 'Rules', section: 18, type: 'text' })[0]).toContain('Name the section');
    expect(refused({ label: 'Rules', section: 9, type: 'sentence' })).toEqual([
      'Choose the type of the answer.',
    ]);
    expect(refused({ label: 'Rules', section: 9, type: 'choice' })).toEqual([
      'Give the answers a person may choose from.',
    ]);
    expect(refused({ label: 'Rules', section: 9, type: 'text', allowedValues: ['a'] })).toEqual([
      'Only a choice or a list takes allowed values.',
    ]);
    expect(refused({ label: 'Rules', section: 9, type: 'list', allowedValues: ['a|b'] })).toEqual([
      'An allowed value cannot contain the | sign.',
    ]);
    expect(
      refused({
        label: 'Rules',
        section: 9,
        type: 'list',
        allowedValues: Array.from({ length: 51 }, (_, i) => `v${i}`),
      }),
    ).toEqual(['Give at most 50 allowed values.']);
    expect(
      refused({ label: 'Rules', section: 9, type: 'list', allowedValues: ['y'.repeat(121)] }),
    ).toEqual([refusalWords.limit(121, 120)]);
  });

  test('a custom fact carries its definition, and the row of a saved custom fact is read back from it', () => {
    const row = customRow('choice', ['Sea', 'Air'], 'custom.mode');
    const fact = okFact(row, { text: 'Sea' });
    expect(fact).toMatchObject({
      key: 'custom.mode',
      label: 'Sample field',
      section: 9,
      type: 'choice',
      allowedValues: ['Sea', 'Air'],
    });
    passes(fact);
    const back = fieldOfCustomFact(fact!);
    expect(back).toMatchObject({
      key: 'custom.mode',
      custom: true,
      type: 'choice',
      allowed: ['Sea', 'Air'],
    });
    expect(okFact(back!, { ...draftFromFact(back!, fact, today) })).toEqual(fact);
    // A Not applicable custom fact keeps the definition too.
    const na = okFact(row, { answer: 'NOT_APPLICABLE', note: 'Not used here' });
    expect(na).toMatchObject({ state: 'NOT_APPLICABLE', label: 'Sample field', section: 9 });
    passes(na);
    expect(fieldOfCustomFact({ key: 'custom.x', state: 'FILLED' } as ContentFact)).toBeNull();
    expect(fieldOfCustomFact({ key: optionalText.key, state: 'FILLED' } as ContentFact)).toBeNull();
  });
});

describe('v1 number fields and negatives (asked by the plan for the PR text)', () => {
  test('the standard has one number field, it is whole days from 0, so no standard number field allows a negative', () => {
    const numbers = standardFieldsV1.filter((f) => f.type === 'number');
    expect(numbers.map((f) => f.key)).toEqual(['travel.visa_lead_time_days']);
    for (const number of numbers) {
      // The item pattern is what the server tests: digits only, no sign, no decimals, up to 9999.
      expect(number.itemPattern).toBeDefined();
      for (const negative of ['-1', '-0', '-12'] as const)
        expect(number.itemPattern!.test(negative)).toBe(false);
      for (const fine of ['0', '1', '9999'] as const)
        expect(number.itemPattern!.test(fine)).toBe(true);
      expect(number.itemPattern!.test('10000')).toBe(false);
      expect(number.itemPattern!.test('2.5')).toBe(false);
      // The server agrees: a negative fact is refused in the domain words.
      const negative = {
        key: number.key,
        state: 'FILLED',
        value: '-3',
        source: 'staff knowledge',
        observedOn: yesterday,
      } as ContentFact;
      expect(
        contentDocumentIssues({ standardVersion: 1, sectionMarks: [], facts: [negative] })[0]!
          .message,
      ).toContain('a whole number');
    }
  });

  test('a custom number field is the one place a negative is allowed: the standard stores a canonical decimal with an optional minus', () => {
    const negative = {
      key: 'custom.balance',
      state: 'FILLED',
      value: '-12.5',
      source: 'staff knowledge',
      observedOn: yesterday,
      label: 'Balance',
      section: 17,
      type: 'number',
    } as ContentFact;
    expect(
      contentDocumentIssues({ standardVersion: 1, sectionMarks: [], facts: [negative] }),
    ).toEqual([]);
    // So a control for a custom number field must not carry a minimum of 0.
    expect(okFact(customRow('number'), { text: '-12.5' })).toMatchObject({ value: '-12.5' });
  });
});
