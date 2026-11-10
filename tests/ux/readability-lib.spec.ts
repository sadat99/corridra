import { expect, test } from '@playwright/test';
import {
  countSyllables,
  failureSentences,
  fkGrade,
  kindChangeError,
  mergeBaseline,
  readabilityViolations,
  scoreProse,
  splitSentences,
  words,
  worstCount,
  type Entry,
} from './readability-lib';

// Unit cases for the reading-level functions (docs/revamp/specs/workflow-intelligence.md, W1). They
// use no page. The expected grades are worked out by hand from
//   grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59, rounded to one decimal.

test('R-01 syllables: monosyllables and short words are one', () => {
  for (const word of ['a', 'the', 'page', 'read', 'proof', 'use', 'what', 'files', 'rules']) {
    expect(countSyllables(word), word).toBe(1);
  }
});

test('R-02 syllables: pinned on a fixed word list', () => {
  const expected: Record<string, number> = {
    table: 2, // ta-ble: a consonant plus "le" is a syllable
    tables: 2,
    people: 2,
    wanted: 2, // "ted" keeps its "ed"
    request: 2,
    account: 2,
    password: 2,
    agreed: 2,
    reviewed: 2,
    customer: 3,
    services: 3,
    created: 3, // cre-a-ted (exception list)
    evidence: 3, // ev-i-dence: the final "e" is silent
    quotation: 3, // quo-ta-tion: "uo" is one group
    verified: 3, // ver-i-fied: "ed" after "i" is silent
    commercial: 3, // com-mer-cial
    verification: 5,
    documentation: 5,
  };
  for (const [word, count] of Object.entries(expected)) {
    expect(countSyllables(word), word).toBe(count);
  }
});

test('R-03 syllables: silent endings, case, punctuation and hyphens', () => {
  expect(countSyllables('makes')).toBe(1); // silent "es"
  expect(countSyllables('changes')).toBe(2); // "ges": the "es" is its own syllable
  expect(countSyllables('Verified')).toBe(3);
  expect(countSyllables("don't")).toBe(1);
  expect(countSyllables('well-known')).toBe(2); // well + known
  expect(countSyllables('')).toBe(0);
  expect(countSyllables('42')).toBe(0);
});

test('R-04 sentences: split on stops, question marks and exclamation marks', () => {
  expect(splitSentences('We read the page. Is it done? Yes! Good')).toEqual([
    'We read the page.',
    'Is it done?',
    'Yes!',
    'Good',
  ]);
  expect(splitSentences('Really?! Yes.')).toEqual(['Really?!', 'Yes.']);
  expect(splitSentences('No closing mark')).toEqual(['No closing mark']);
  expect(splitSentences('   ')).toEqual([]);
  expect(splitSentences('One line.\nAnother line.')).toEqual(['One line.', 'Another line.']);
});

test('R-05 sentences: abbreviations and decimals do not end a sentence', () => {
  expect(
    splitSentences('Dr. Rahman checked the U.S. rules, e.g. the visa list. Is it done? Yes!'),
  ).toEqual(['Dr. Rahman checked the U.S. rules, e.g. the visa list.', 'Is it done?', 'Yes!']);
  expect(splitSentences('The fee is 3.5 percent. It was 12.25 last year.')).toEqual([
    'The fee is 3.5 percent.',
    'It was 12.25 last year.',
  ]);
  // "etc." ends a sentence only when a capital letter follows.
  expect(splitSentences('We need forms, photos, etc. Then we file.')).toEqual([
    'We need forms, photos, etc.',
    'Then we file.',
  ]);
  expect(splitSentences('We need forms, photos, etc. and more.')).toEqual([
    'We need forms, photos, etc. and more.',
  ]);
  expect(splitSentences('Ask J. Smith about it. Then wait.')).toEqual([
    'Ask J. Smith about it.',
    'Then wait.',
  ]);
});

test('R-06 sentences: closing quotes and brackets stay with their sentence', () => {
  expect(splitSentences('(See below.) "Quoted." Next')).toEqual([
    '(See below.)',
    '"Quoted."',
    'Next',
  ]);
});

test('R-07 words: letters with inner apostrophes or hyphens; numbers and codes are not words', () => {
  expect(words("Don't use well-known 3.5 G12 items, 2nd KI-44.")).toEqual([
    "Don't",
    'use',
    'well-known',
    'items',
  ]);
  expect(words('12 345 6.7')).toEqual([]);
  expect(words('')).toEqual([]);
});

test('R-08 grade: the formula on fixed counts', () => {
  // 0.39 * 12 + 11.8 * 15 / 12 - 15.59 = 4.68 + 14.75 - 15.59 = 3.84 -> 3.8
  expect(fkGrade(12, 1, 15)).toBe(3.8);
  // 0.39 * 1 + 11.8 * 1 - 15.59 = -3.4: not clamped
  expect(fkGrade(1, 1, 1)).toBe(-3.4);
  expect(fkGrade(0, 1, 1)).toBe(0);
  expect(fkGrade(5, 0, 5)).toBe(0);
});

test('R-09 grade: short fixed paragraphs, worked by hand', () => {
  // "We read the page. You can see the proof."
  //   sentence 1: We read the page = 4 words, 4 syllables; sentence 2: You can see the proof = 5 words, 5 syllables.
  //   W = 9, S = 2, Syl = 9.
  //   grade = 0.39 * (9 / 2) + 11.8 * (9 / 9) - 15.59 = 1.755 + 11.8 - 15.59 = -2.035 -> -2.0
  //   sentence grades: 0.39 * 5 + 11.8 - 15.59 = -1.84 -> -1.8 and 0.39 * 4 + 11.8 - 15.59 = -2.23 -> -2.2
  const simple = scoreProse(['We read the page. You can see the proof.']);
  expect(simple).toEqual({
    words: 9,
    sentences: 2,
    grade: -2,
    long: 0,
    hard: 0,
    worst: [
      { text: 'You can see the proof.', grade: -1.8, words: 5 },
      { text: 'We read the page.', grade: -2.2, words: 4 },
    ],
  });

  // "Quotation evidence is verified." = 4 words; syllables 3 + 3 + 1 + 3 = 10; one sentence.
  //   grade = 0.39 * 4 + 11.8 * (10 / 4) - 15.59 = 1.56 + 29.5 - 15.59 = 15.47 -> 15.5
  //   Under 8 words, so it is not a hard sentence even at grade 15.5.
  const dense = scoreProse(['Quotation evidence is verified.']);
  expect(dense.words).toBe(4);
  expect(dense.sentences).toBe(1);
  expect(dense.grade).toBe(15.5);
  expect(dense.hard).toBe(0);

  // Two blocks count as two separate texts: a stop-less block is still a sentence.
  //   "We read the page" (4 words, 4 syl) + "Quotation evidence is verified." (4 words, 10 syl)
  //   W = 8, S = 2, Syl = 14: 0.39 * 4 + 11.8 * (14 / 8) - 15.59 = 1.56 + 20.65 - 15.59 = 6.62 -> 6.6
  const blocks = scoreProse(['We read the page', 'Quotation evidence is verified.']);
  expect(blocks.words).toBe(8);
  expect(blocks.sentences).toBe(2);
  expect(blocks.grade).toBe(6.6);
});

test('R-10 long: more than 20 words counts, exactly 20 does not', () => {
  // Each "go" is one syllable. 21 words: 0.39 * 21 + 11.8 - 15.59 = 8.19 + 11.8 - 15.59 = 4.4
  const twenty = Array(20).fill('go').join(' ') + '.';
  const twentyOne = Array(21).fill('go').join(' ') + '.';
  expect(scoreProse([twenty]).long).toBe(0);
  const long = scoreProse([twentyOne]);
  expect(long.long).toBe(1);
  expect(long.grade).toBe(4.4);
  expect(long.hard).toBe(0); // long is not the same as hard
  expect(scoreProse([twenty, twentyOne, twentyOne]).long).toBe(2);
});

test('R-11 hard: at least 8 words and a sentence grade above 9', () => {
  // "The commercial verification evidence requires quotation and documentation." = 8 words.
  //   syllables 1 + 3 + 5 + 3 + 2 + 3 + 1 + 5 = 23
  //   grade = 0.39 * 8 + 11.8 * (23 / 8) - 15.59 = 3.12 + 33.925 - 15.59 = 21.455 -> 21.5
  const hard = scoreProse([
    'The commercial verification evidence requires quotation and documentation.',
  ]);
  expect(hard.words).toBe(8);
  expect(hard.grade).toBe(21.5);
  expect(hard.hard).toBe(1);
  expect(hard.long).toBe(0);
  // 7 words of the same kind: grade is high, but it is under the 8-word floor.
  const short = scoreProse([
    'Commercial verification evidence requires quotation and documentation.',
  ]);
  expect(short.words).toBe(7);
  expect(short.grade).toBeGreaterThan(9);
  expect(short.hard).toBe(0);
  // 8 plain words: at least 8 words, grade far below 9.
  expect(scoreProse(['We read the page and we see the proof.']).hard).toBe(0);
  // Sentences count one by one, not by the paragraph grade.
  const mixed = scoreProse([
    'The commercial verification evidence requires quotation and documentation. We read the page.',
  ]);
  expect(mixed.sentences).toBe(2);
  expect(mixed.hard).toBe(1);
});

test('R-12 worst: sorted by sentence grade, at most 20, ties keep reading order', () => {
  expect(scoreProse([]).worst).toEqual([]);
  expect(scoreProse([]).grade).toBe(0);
  expect(scoreProse(['12 345.']).sentences).toBe(0); // no words, no sentence
  const many = Array.from(
    { length: 25 },
    (_, i) => `We read the page ${'and the page '.repeat(i)}.`,
  );
  const result = scoreProse(many);
  expect(result.sentences).toBe(25);
  expect(result.worst).toHaveLength(worstCount);
  const grades = result.worst.map((s) => s.grade);
  expect(grades).toEqual([...grades].sort((a, b) => b - a));
  const same = scoreProse(['We read the page.', 'We read the page.']);
  expect(same.worst.map((s) => s.text)).toEqual(['We read the page.', 'We read the page.']);
});

// Baseline rules (R-13 and up). They are pure functions on entries, so no page is needed.

const measured = (grade: number, long: number, hard: number, w = 100, n = 10): Entry => ({
  words: w,
  sentences: n,
  grade,
  long,
  hard,
});

test('R-13 merge: a new key takes what was measured, whatever its kind', () => {
  const { merged, errors } = mergeBaseline(
    { '/a': measured(5, 0, 0) },
    {
      '/a': measured(5, 0, 0),
      '/b': measured(7.2, 2, 3),
      '/c': { redirectsTo: '/sign-in' },
      '/d': { unavailable: true },
    },
  );
  expect(errors).toEqual([]);
  expect(merged['/b']).toEqual(measured(7.2, 2, 3));
  expect(merged['/c']).toEqual({ redirectsTo: '/sign-in' });
  expect(merged['/d']).toEqual({ unavailable: true });
});

test('R-14 merge: a route that got worse keeps the lower long, hard and grade', () => {
  const { merged, errors } = mergeBaseline(
    { '/a': measured(5, 1, 2, 100, 10) },
    { '/a': measured(8.4, 3, 5, 140, 12) },
  );
  expect(errors).toEqual([]);
  // Words and sentences are facts about the page now, so they take the new values.
  expect(merged['/a']).toEqual({ words: 140, sentences: 12, grade: 5, long: 1, hard: 2 });
});

test('R-15 merge: a route that got easier is lowered, field by field', () => {
  const { merged } = mergeBaseline(
    { '/a': measured(9.1, 4, 6) },
    { '/a': measured(6.3, 5, 2, 90, 9) },
  );
  // grade and hard fell, long rose: each field keeps its own minimum.
  expect(merged['/a']).toEqual({ words: 90, sentences: 9, grade: 6.3, long: 4, hard: 2 });
});

test('R-16 merge: a change of kind is an error, in either direction, and the old entry stays', () => {
  const before: Record<string, Entry> = {
    '/m': measured(5, 0, 0),
    '/r': { redirectsTo: '/sign-in' },
    '/u': { unavailable: true },
  };
  const now: Record<string, Entry> = {
    '/m': { redirectsTo: '/sign-in' },
    '/r': measured(5, 0, 0),
    '/u': { redirectsTo: '/' },
  };
  const { merged, errors } = mergeBaseline(before, now);
  expect(errors).toHaveLength(3);
  expect(errors.join('\n')).toContain('/m: was');
  expect(merged).toEqual(before);
  expect(
    mergeBaseline({ '/r': before['/r'] }, { '/r': { redirectsTo: '/other' } }).errors,
  ).toHaveLength(1);
});

test('R-17 merge: a redirect or unavailable page that stays the same is no error', () => {
  const same: Record<string, Entry> = {
    '/r': { redirectsTo: '/sign-in' },
    '/u': { unavailable: true },
  };
  expect(mergeBaseline(same, same)).toEqual({ merged: same, errors: [] });
  expect(kindChangeError('/r', same['/r'], same['/r'])).toBeNull();
});

test('R-18 merge: a key not measured in this run keeps its entry', () => {
  const { merged } = mergeBaseline(
    { '/a': measured(5, 0, 0), '/b': measured(6, 1, 1) },
    { '/a': measured(4.5, 0, 0) },
  );
  expect(merged['/b']).toEqual(measured(6, 1, 1));
  expect(merged['/a']).toMatchObject({ grade: 4.5 });
});

test('R-19 violations: a rise in long, hard or grade fails, a rise of exactly 0.5 passes', () => {
  const before = measured(5, 1, 1);
  expect(readabilityViolations('/a', measured(5.5, 1, 1), before)).toEqual([]);
  expect(readabilityViolations('/a', measured(5.6, 1, 1), before)).toHaveLength(1);
  expect(readabilityViolations('/a', measured(4, 2, 1), before)[0]).toContain('over 20 words rose');
  expect(readabilityViolations('/a', measured(4, 1, 2), before)[0]).toContain(
    'hard sentences rose',
  );
  expect(readabilityViolations('/a', measured(3, 0, 0), before)).toEqual([]);
});

test('R-20 violations: a failing route lists its three hardest sentences with grade and words', () => {
  const worst = [1, 2, 3, 4, 5].map((n) => ({
    text: `Sentence ${n}.`,
    grade: 14 - n,
    words: 20 + n,
  }));
  const found = readabilityViolations('/a', measured(5, 0, 3), measured(5, 0, 2), worst);
  expect(found).toHaveLength(2);
  const block = found[1];
  expect(block.split('\n')).toHaveLength(1 + failureSentences);
  expect(block).toContain('1. [grade 13, 21 words] Sentence 1.');
  expect(block).toContain('3. [grade 11, 23 words] Sentence 3.');
  expect(block).not.toContain('Sentence 4.');
  // A passing route adds nothing, and neither does a route without sentences.
  expect(readabilityViolations('/a', measured(5, 0, 2), measured(5, 0, 2), worst)).toEqual([]);
  expect(readabilityViolations('/a', measured(5, 0, 3), measured(5, 0, 2), [])).toHaveLength(1);
});

test('R-21 violations: no baseline entry, and a change of kind, fail with a plain message', () => {
  expect(readabilityViolations('/new', measured(5, 0, 0), undefined)[0]).toContain(
    'no readability baseline entry',
  );
  expect(readabilityViolations('/a', { redirectsTo: '/sign-in' }, measured(5, 0, 0))[0]).toContain(
    '/a: was',
  );
});
