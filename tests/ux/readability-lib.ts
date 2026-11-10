// Reading-level measure (docs/revamp/specs/workflow-intelligence.md, section 4, batch W1).
//
// Pure functions: no browser, no Node-only imports, so the same text can be scored in a unit test and
// in the readability spec. The grade is the Flesch-Kincaid grade level. It is an approximation for
// English prose and guides plain wording; it never replaces native review or user testing.

/** Words the vowel-group heuristic gets wrong and that appear often in this product's copy. */
const SYLLABLE_EXCEPTIONS: Readonly<Record<string, number>> = {
  area: 3,
  areas: 3,
  being: 2,
  client: 2,
  clients: 2,
  create: 2,
  created: 3,
  creates: 2,
  creating: 3,
  creation: 3,
  creative: 3,
  doing: 2,
  going: 2,
  idea: 3,
  ideas: 3,
  quiet: 2,
  trial: 2,
  trials: 2,
  video: 3,
  videos: 3,
};

/**
 * Syllables in one English word, by a vowel-group heuristic: count runs of vowels (a leading "y" is a
 * consonant), after dropping a silent final "e", a silent "-es" or "-ed" ending, and treating a
 * consonant plus "-le" as a syllable. A short exception list covers common words the rule misses. A
 * word with letters has at least one syllable; text with no letters has none. A hyphenated word is the
 * sum of its parts.
 */
export function countSyllables(word: string): number {
  if (word.includes('-')) {
    return word.split('-').reduce((sum, part) => sum + countSyllables(part), 0);
  }
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const fixed = SYLLABLE_EXCEPTIONS[w];
  if (fixed !== undefined) return fixed;
  if (w.length <= 3) return 1;
  if (/[^aeiouy]les$/.test(w)) {
    // "tables": the final syllable is "bles", counted like "table".
    w = w.slice(0, -1);
  } else if (/(?:[cgsxz]|[cs]h)es$/.test(w)) {
    // "changes", "boxes", "wishes": the "es" is its own syllable. Nothing to drop.
  } else if (/[^aeiouy]es$/.test(w)) {
    w = w.slice(0, -2); // "makes" -> "mak"
  } else if (/[^td]ed$/.test(w)) {
    w = w.slice(0, -2); // "verified" -> "verifi"; "wanted" and "needed" keep their "ed"
  } else if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) {
    w = w.slice(0, -1); // silent final "e"; "table" keeps its "le"
  }
  w = w.replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]+/g) ?? []).length);
}

/** Abbreviations whose full stop does not end a sentence. Lowercase, with the stop. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'vs.',
  'inc.',
  'ltd.',
  'co.',
  'e.g.',
  'i.e.',
  'u.s.',
  'u.k.',
]);

/**
 * Splits prose into sentences. A sentence ends at ".", "!" or "?" (a run of them counts once) that is
 * followed by a space or the end of the text. A stop inside a number ("3.5"), after a known
 * abbreviation ("Dr.", "e.g.", "U.S."), after a dotted acronym or after a single capital initial is
 * not an end. "etc." ends a sentence only when the next word starts with a capital letter. Text with
 * no closing mark, such as a list item, is one sentence. Line breaks count as spaces.
 */
export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  const sentences: string[] = [];
  let start = 0;
  const mark = /[.!?]+(?=["')\]”’]*(?:\s|$))/g;
  for (let m = mark.exec(flat); m; m = mark.exec(flat)) {
    let end = m.index + m[0].length;
    // Keep closing quotes and brackets with the sentence they close.
    while (end < flat.length && /["')\]”’]/.test(flat[end])) end++;
    const lead = flat.slice(start, m.index + m[0].length);
    const token = (/(\S+)$/.exec(lead)?.[1] ?? '').replace(/^["'(\[“‘]+/, '');
    const lower = token.toLowerCase();
    if (m[0] === '.') {
      const next = flat.slice(end).trimStart();
      const abbreviation =
        ABBREVIATIONS.has(lower) ||
        /^(?:[a-z]\.){2,}$/i.test(token) ||
        /^[A-Z]\.$/.test(token) ||
        (lower === 'etc.' && !/^[A-Z]/.test(next));
      if (abbreviation && next) continue;
    }
    const piece = flat.slice(start, end).trim();
    if (piece) sentences.push(piece);
    start = end;
    mark.lastIndex = end;
  }
  const rest = flat.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/**
 * The words in a text: runs of letters, with an apostrophe or hyphen allowed inside a word
 * ("don't", "well-known"). Numbers are not words, and neither is a code such as "G12" or "KI-44".
 */
export function words(text: string): string[] {
  return text.match(/(?<![A-Za-z0-9])[A-Za-z]+(?:['’-][A-Za-z]+)*(?![A-Za-z0-9]|-[0-9])/g) ?? [];
}

/**
 * Flesch-Kincaid grade level: 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59,
 * rounded to one decimal. Zero when there are no words or no sentences. It can be below zero for very
 * simple text; it is not clamped.
 */
export function fkGrade(wordCount: number, sentenceCount: number, syllableCount: number): number {
  if (wordCount <= 0 || sentenceCount <= 0) return 0;
  const raw = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
  return Math.round(raw * 10) / 10 + 0; // "+ 0" turns -0 into 0
}

export type WorstSentence = { text: string; grade: number; words: number };
export type ProseScore = {
  words: number;
  sentences: number;
  /** Flesch-Kincaid grade over all the prose together. */
  grade: number;
  /** Sentences of more than 20 words. */
  long: number;
  /** Sentences of at least 8 words whose own grade is above 9. */
  hard: number;
  /** The 20 sentences with the highest own grade (ties: more words first, then reading order). */
  worst: WorstSentence[];
};

export const longSentenceWords = 20;
export const hardSentenceMinWords = 8;
export const hardSentenceGrade = 9;
export const worstCount = 20;

/** Scores blocks of prose. Each block is split into sentences on its own. */
export function scoreProse(blocks: string[]): ProseScore {
  let totalWords = 0;
  let totalSyllables = 0;
  let long = 0;
  let hard = 0;
  const scored: (WorstSentence & { order: number })[] = [];
  for (const block of blocks) {
    for (const sentence of splitSentences(block)) {
      const list = words(sentence);
      if (list.length === 0) continue;
      const syllables = list.reduce((sum, word) => sum + countSyllables(word), 0);
      const grade = fkGrade(list.length, 1, syllables);
      totalWords += list.length;
      totalSyllables += syllables;
      if (list.length > longSentenceWords) long++;
      if (list.length >= hardSentenceMinWords && grade > hardSentenceGrade) hard++;
      scored.push({ text: sentence, grade, words: list.length, order: scored.length });
    }
  }
  const worst = [...scored]
    .sort((a, b) => b.grade - a.grade || b.words - a.words || a.order - b.order)
    .slice(0, worstCount)
    .map(({ text, grade, words: count }) => ({ text, grade, words: count }));
  return {
    words: totalWords,
    sentences: scored.length,
    grade: fkGrade(totalWords, scored.length, totalSyllables),
    long,
    hard,
    worst,
  };
}

// ---- Baseline rules (pure, so they are unit-tested without a browser) ----

export type Measured = Pick<ProseScore, 'words' | 'sentences' | 'grade' | 'long' | 'hard'>;
/** One baseline entry: a measured page, a page that redirects, or a page that is unavailable. */
export type Entry = Measured | { redirectsTo: string } | { unavailable: true };

/** The most the grade may rise against the baseline before a route fails. */
export const maxGradeRise = 0.5;
/** How many of a route's hardest sentences go into its failure message. */
export const failureSentences = 3;

export const isMeasured = (entry: Entry | undefined): entry is Measured =>
  !!entry && 'grade' in entry && 'hard' in entry;

const kindOf = (entry: Entry): 'measured' | 'redirect' | 'unavailable' =>
  isMeasured(entry) ? 'measured' : 'redirectsTo' in entry ? 'redirect' : 'unavailable';

/**
 * A route that changed kind (measured, redirect, unavailable) or now redirects somewhere else. This
 * fails in a normal run and in update mode alike: the new kind cannot be compared with the old numbers.
 */
export function kindChangeError(key: string, now: Entry, before: Entry): string | null {
  if (kindOf(now) === 'measured' && kindOf(before) === 'measured') return null;
  return JSON.stringify(now) === JSON.stringify(before)
    ? null
    : `${key}: was ${JSON.stringify(before)}, now ${JSON.stringify(now)}`;
}

/** The hardest sentences of a route, as one readable block for a failure message. */
export function worstBlock(key: string, worst: WorstSentence[]): string {
  if (worst.length === 0) return '';
  const lines = worst
    .slice(0, failureSentences)
    .map((s, i) => `  ${i + 1}. [grade ${s.grade}, ${s.words} words] ${s.text}`);
  return `${key}: hardest sentences\n${lines.join('\n')}`;
}

/**
 * What is worse than the baseline, as plain messages. Empty when the route is no harder than before.
 * When a measured route fails, its hardest sentences follow so the failure shows what to rewrite.
 */
export function readabilityViolations(
  key: string,
  now: Entry,
  before: Entry | undefined,
  worst: WorstSentence[] = [],
): string[] {
  if (!before) {
    return [
      `${key} has no readability baseline entry. Run with READABILITY_UPDATE_BASELINE=1 to record it. ` +
        'That flag is only for recording existing text, never for hiding a rise: fix the copy instead.',
    ];
  }
  if (isMeasured(now) && isMeasured(before)) {
    const found: string[] = [];
    if (now.long > before.long) {
      found.push(`${key}: sentences over 20 words rose from ${before.long} to ${now.long}`);
    }
    if (now.hard > before.hard) {
      found.push(`${key}: hard sentences rose from ${before.hard} to ${now.hard}`);
    }
    if (now.grade - before.grade > maxGradeRise + 1e-9) {
      found.push(
        `${key}: grade rose from ${before.grade} to ${now.grade} (allowed rise ${maxGradeRise})`,
      );
    }
    const block = found.length > 0 ? worstBlock(key, worst) : '';
    return block ? [...found, block] : found;
  }
  const error = kindChangeError(key, now, before);
  return error ? [error] : [];
}

/**
 * The baseline an update run writes. A new key takes what was measured. A key measured before and now
 * keeps the lower of the old and new long, hard and grade (a route that got worse is not written in);
 * words and sentences take the new values. A change of kind is an error and the old entry stays. Keys
 * that were not measured in this run keep their old entry.
 */
export function mergeBaseline(
  before: Record<string, Entry>,
  now: Record<string, Entry>,
): { merged: Record<string, Entry>; errors: string[] } {
  const merged: Record<string, Entry> = { ...before };
  const errors: string[] = [];
  for (const [key, entry] of Object.entries(now)) {
    const old = before[key];
    if (!old) {
      merged[key] = entry;
    } else if (isMeasured(old) && isMeasured(entry)) {
      merged[key] = {
        words: entry.words,
        sentences: entry.sentences,
        grade: Math.min(old.grade, entry.grade),
        long: Math.min(old.long, entry.long),
        hard: Math.min(old.hard, entry.hard),
      };
    } else {
      const error = kindChangeError(key, entry, old);
      if (error) errors.push(error);
    }
  }
  return { merged, errors };
}
