import { describe, expect, test } from 'vitest';
import {
  approxDistance,
  editDistance,
  foldText,
  fuzzyLimit,
  highlightSegments,
  queryWords,
  rankFields,
  rankLimits,
  tierScore,
  type RankField,
} from '../../apps/web/lib/palette-rank';
import { matches } from '../../apps/web/lib/palette-search';

// The palette's ranking (docs/revamp/specs/navigation-v1/command-palette-search.md, section 2): exact words,
// word starts, parts of words, then near misses; the label ahead of the detail within a tier; a typo never
// outranks an exact word and is reported as close. Pure, so a fixed fixture gives one exact order.
const score = (query: string, ...fields: RankField[]) => rankFields(queryWords(query), fields);

describe('P1 ranking', () => {
  test('a label that starts with the word is above a detail that only contains it', () => {
    const inLabel = score('mad', { value: 'Madrid Textiles', label: true }, { value: 'Spain' });
    const inDetail = score('mad', { value: 'Buyer', label: true }, { value: 'Nomad shoes' });
    expect(inLabel!.score).toBe(tierScore.prefix + 50);
    expect(inDetail!.score).toBe(tierScore.substring);
    expect(inLabel!.score).toBeGreaterThan(inDetail!.score);
  });
  test('within a tier the label beats the detail', () => {
    const label = score('mad', { value: 'Madrid Textiles', label: true }, { value: 'Spain' });
    const detail = score('mad', { value: 'Textiles', label: true }, { value: 'Madrid, Spain' });
    expect(label!.score).toBeGreaterThan(detail!.score);
  });
  test('tier decides first: an exact word in a detail is above a prefix in the label', () => {
    const exactDetail = score('mad', { value: 'Buyer', label: true }, { value: 'Mad dogs' });
    const prefixLabel = score('mad', { value: 'Madrid', label: true }, { value: '' });
    expect(exactDetail!.score).toBe(tierScore.exact);
    expect(exactDetail!.score).toBeGreaterThan(prefixLabel!.score);
  });
  test('a near miss in the label never beats an exact, prefix or part-of-word hit in a detail', () => {
    const fuzzyLabel = score('tributer', { value: 'Distributor', label: true });
    const substringDetail = score(
      'tributer',
      { value: 'Buyer', label: true },
      { value: 'tributer' },
    );
    expect(fuzzyLabel!.close).toBe(true);
    expect(fuzzyLabel!.score).toBeLessThan(tierScore.substring);
    expect(substringDetail!.score).toBeGreaterThan(fuzzyLabel!.score);
  });
  test('the label that is the query is ranked above a label that merely contains it', () => {
    const same = score('acme trading', { value: 'Acme Trading', label: true });
    const longer = score('acme trading', { value: 'Acme Trading Group', label: true });
    expect(same!.score).toBe(2 * (tierScore.exact + 50) + 25);
    expect(longer!.score).toBe(2 * (tierScore.exact + 50));
  });
  test('a fixed fixture gives one exact order, ties broken by position then id', () => {
    const rows = [
      { id: 'd', label: 'Nomad Freight', detail: 'Spain' },
      { id: 'b', label: 'Madrid Textiles', detail: 'Spain' },
      { id: 'a', label: 'Madrid Textiles', detail: 'Spain' },
      { id: 'c', label: 'Mad Dogs', detail: 'France' },
      { id: 'e', label: 'Buyer', detail: 'Mad cap' },
    ];
    const words = queryWords('mad');
    const ranked = rows
      .map((row, position) => ({
        row,
        position,
        rank: rankFields(words, [{ value: row.label, label: true }, { value: row.detail }])!,
      }))
      .sort(
        (x, y) =>
          y.rank.score - x.rank.score ||
          x.position - y.position ||
          (x.row.id < y.row.id ? -1 : x.row.id > y.row.id ? 1 : 0),
      )
      .map((entry) => entry.row.id);
    expect(ranked).toEqual(['c', 'e', 'b', 'a', 'd']);
  });
});

describe('P2 typo tolerance', () => {
  test('"tributer" finds "Distributor Madrid" through a near miss, and says it is close', () => {
    const found = score('tributer', { value: 'Distributor Madrid', label: true });
    expect(found).not.toBeNull();
    expect(found!.close).toBe(true);
    expect(found!.score).toBe(tierScore.fuzzy - 10 + 50);
  });
  test('"knit france" does not match "Sell knitwear, Spain", and matches() agrees', () => {
    expect(
      score(
        'knit france',
        { value: 'Acme', label: true },
        { value: 'Sell knitwear' },
        { value: 'Spain' },
      ),
    ).toBeNull();
    expect(matches('knit france', 'Sell knitwear', 'Spain')).toBe(false);
  });
  test('a swap of two neighbouring letters is one edit', () => {
    expect(editDistance('madird', 'madrid', 2)).toBe(1);
    expect(score('madird', { value: 'Madrid Textiles', label: true })).not.toBeNull();
  });
  test('a word of three characters or fewer has no near miss, only exact, start or part', () => {
    expect(fuzzyLimit(3)).toBe(0);
    expect(fuzzyLimit(1)).toBe(0);
    expect(score('mxd', { value: 'Madrid', label: true })).toBeNull();
    expect(score('mad', { value: 'Madrid', label: true })).not.toBeNull();
  });
  test('the allowed edits grow with the word: 4 to 7 characters one, 8 or more two', () => {
    expect(fuzzyLimit(4)).toBe(1);
    expect(fuzzyLimit(7)).toBe(1);
    expect(fuzzyLimit(8)).toBe(2);
    expect(rankLimits.fuzzyMinLength).toBe(4);
    expect(rankLimits.unanchoredFuzzyLength).toBe(6);
  });
  test('4 and 5 character words must match the start of a word; 6 and more may sit inside', () => {
    // anchored: "adri" is within one edit of the start of "madrid"? no, it is a part, so it is a part-of-word hit.
    expect(approxDistance('mxxr', 'madrid', true, 1)).toBe(2);
    expect(approxDistance('madx', 'madrid', true, 1)).toBe(1);
    expect(approxDistance('adrix', 'madrid', true, 1)).toBeGreaterThan(1);
    // unanchored: a typo inside a longer word is found.
    expect(approxDistance('stribat', 'distributor', false, 1)).toBe(1);
    expect(approxDistance('stribat', 'distributor', true, 1)).toBeGreaterThan(1);
  });
  test('two typos are tolerated only in a word of eight or more characters', () => {
    expect(score('distrabutar', { value: 'Distributor', label: true })).not.toBeNull();
    expect(score('trabutor', { value: 'Distributor', label: true })).not.toBeNull();
    expect(score('trabutar', { value: 'Distributor', label: true })).not.toBeNull();
    expect(score('stribxx', { value: 'Distributor', label: true })).toBeNull();
  });
  test('a word that matches somewhere is not also tried as a near miss', () => {
    const found = score('madrid', { value: 'Madrid', label: true }, { value: 'Madriz' });
    expect(found!.close).toBe(false);
    expect(found!.score).toBe(tierScore.exact + 50 + 25);
  });
  test('accents and look-alike letters are folded', () => {
    expect(foldText('Zürich')).toBe('zurich');
    expect(foldText('Łódź Straße')).toBe('lodz strasse');
    expect(score('zurich', { value: 'Zürich Trading', label: true })).not.toBeNull();
    expect(score('lodz', { value: 'Łódź', label: true })).not.toBeNull();
    expect(score('strasse', { value: 'Hauptstraße', label: true })).not.toBeNull();
  });
  test('every word must score, in any order', () => {
    expect(
      score('spain knit', { value: 'Acme', label: true }, { value: 'Sell knitwear · Spain' }),
    ).not.toBeNull();
    expect(
      score('spain wool', { value: 'Acme', label: true }, { value: 'Sell knitwear · Spain' }),
    ).toBeNull();
  });
  test('whatever matches() accepts as plain words, the ranker accepts too', () => {
    const rows: [string, string[]][] = [
      ['knit spain', ['Sell KNITWEAR', 'Spain']],
      ['palette trading', ['Palette1 Trading']],
      ['tributor madrid', ['Distributor', 'Madrid']],
      ['co ltd', ['Invented Towels Co. Ltd']],
      ['mad', ['Nomad']],
      ['ES', ['es']],
    ];
    for (const [query, fields] of rows) {
      expect(matches(query, ...fields)).toBe(true);
      expect(
        rankFields(
          queryWords(query),
          fields.map((value, index) => ({ value, label: index === 0 })),
        ),
        query,
      ).not.toBeNull();
    }
  });
  test('missing and non-text field values count as empty', () => {
    expect(
      score('mad', { value: undefined, label: true }, { value: 42 }, { value: null }),
    ).toBeNull();
    expect(score('mad', { value: undefined, label: true }, { value: 'Madrid' })).not.toBeNull();
  });
  test('query words are folded, unique, at most 8 and at most 40 characters; no usable word is no query', () => {
    expect(queryWords('  Mad  MAD madrid ')).toEqual(['mad', 'madrid']);
    expect(queryWords('a b c d e f g h i j')).toHaveLength(8);
    expect(queryWords('x'.repeat(60))[0]).toHaveLength(40);
    expect(queryWords('&& -- ..')).toEqual([]);
    expect(rankFields([], [{ value: 'anything', label: true }])).toBeNull();
  });
  test('the edit distance is capped at limit + 1', () => {
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
    expect(editDistance('same', 'same', 2)).toBe(0);
  });
});

describe('P3 highlighting', () => {
  const join = (segments: { text: string }[]) => segments.map((s) => s.text).join('');
  test('the pieces always join back into the text', () => {
    for (const [text, query] of [
      ['Madrid Textiles', 'mad'],
      ['Nomad Mad Dogs', 'mad dog'],
      ['Zürich Straße', 'zurich strasse'],
      ['Distributor Madrid', 'tributer'],
      ['', 'mad'],
      ['Nothing here', 'mad'],
    ] as const)
      expect(join(highlightSegments(text, query, { close: true })), text).toBe(text);
  });
  test('exact, start and part-of-word matches are marked', () => {
    expect(highlightSegments('Madrid Textiles', 'mad')).toEqual([
      { text: 'Mad', hit: true },
      { text: 'rid Textiles', hit: false },
    ]);
    expect(highlightSegments('Nomad Mad', 'mad')).toEqual([
      { text: 'No', hit: false },
      { text: 'mad', hit: true },
      { text: ' ', hit: false },
      { text: 'Mad', hit: true },
    ]);
  });
  test('a word over accents is marked over the original characters', () => {
    expect(highlightSegments('Zürich Trading', 'zurich')).toEqual([
      { text: 'Zürich', hit: true },
      { text: ' Trading', hit: false },
    ]);
  });
  test('a near miss is marked only when the hit is close', () => {
    expect(highlightSegments('Distributor Madrid', 'tributer')).toEqual([
      { text: 'Distributor Madrid', hit: false },
    ]);
    expect(highlightSegments('Distributor Madrid', 'tributer', { close: true })).toEqual([
      { text: 'Dis', hit: false },
      { text: 'tributor', hit: true },
      { text: ' Madrid', hit: false },
    ]);
  });
  test('markup in a name stays text', () => {
    const hostile = '<img src=x onerror=alert(1)> Mad Co';
    const segments = highlightSegments(hostile, 'mad');
    expect(join(segments)).toBe(hostile);
    expect(segments.every((s) => typeof s.text === 'string')).toBe(true);
    expect(segments.find((s) => s.hit)!.text).toBe('Mad');
    expect(highlightSegments('<img src=x onerror=alert(1)>', 'img')).toContainEqual({
      text: 'img',
      hit: true,
    });
  });
  test('overlapping words merge into one mark', () => {
    expect(highlightSegments('Madrid', 'mad madr')).toEqual([
      { text: 'Madr', hit: true },
      { text: 'id', hit: false },
    ]);
  });
});

describe('S4 scripts whose vowel signs are letters of the word', () => {
  test('only the Latin accent marks are removed; Bengali and Devanagari signs stay', () => {
    expect(queryWords('ঢাকা')).toEqual(['ঢাকা']);
    expect(queryWords('कि')).toEqual(['कि']);
    expect(foldText('Zürich')).toBe('zurich');
    expect(foldText('Łódź')).toBe('lodz');
    expect(foldText('Dhaka')).toBe('dhaka');
  });
  test('words that differ only in a vowel sign are different words and never an exact hit', () => {
    expect(score('कि', { value: 'की', label: true })).toBeNull();
    expect(score('ঢাকা', { value: 'ঢুকি Traders', label: true })).toBeNull();
    expect(score('ঢাকা', { value: 'ঢাকা Traders', label: true })!.score).toBe(tierScore.exact + 50);
  });
  test('a mark in a non-matching word is not marked as a hit', () => {
    expect(highlightSegments('ঢুকি Traders', 'ঢাকা').some((s) => s.hit)).toBe(false);
    expect(highlightSegments('ঢাকা Traders', 'ঢাকা')[0]).toEqual({ text: 'ঢাকা', hit: true });
  });
});

describe('a highlight never splits a letter from its vowel sign', () => {
  const join = (segments: { text: string }[]) => segments.map((s) => s.text).join('');
  test('a query that ends before a Devanagari vowel sign marks the sign with its consonant', () => {
    const segments = highlightSegments('कि Traders', 'क');
    expect(segments[0]).toEqual({ text: 'कि', hit: true });
    expect(segments.filter((s) => s.hit)).toHaveLength(1);
    expect(join(segments)).toBe('कि Traders');
  });
  test('the same for Bengali text, in the middle of a word and at its end', () => {
    expect(highlightSegments('ঢাকা Traders', 'ঢ')[0]).toEqual({ text: 'ঢা', hit: true });
    const middle = highlightSegments('ঢাকা Traders', 'ক');
    expect(middle.filter((s) => s.hit)).toEqual([{ text: 'কা', hit: true }]);
    expect(join(middle)).toBe('ঢাকা Traders');
    expect(highlightSegments('ঢাকা', 'কা')).toEqual([
      { text: 'ঢা', hit: false },
      { text: 'কা', hit: true },
    ]);
  });
  test('Latin text is cut as before', () => {
    expect(highlightSegments('Madrid Textiles', 'mad')).toEqual([
      { text: 'Mad', hit: true },
      { text: 'rid Textiles', hit: false },
    ]);
    expect(highlightSegments('Zürich', 'zu')).toEqual([
      { text: 'Zü', hit: true },
      { text: 'rich', hit: false },
    ]);
  });
});

describe('N8 a long field costs a bounded amount of work', () => {
  test('only the first 256 characters of a field are read', () => {
    const tail = 'a'.repeat(300) + ' zebra';
    expect(score('zebra', { value: tail, label: true })).toBeNull();
    expect(score('zebra', { value: 'a '.repeat(100) + 'zebra', label: true })).not.toBeNull();
  });
});
