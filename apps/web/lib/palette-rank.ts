// Ranking and highlighting for the team command palette (docs/revamp/specs/navigation-v1/command-palette-search.md).
// Pure and isomorphic: no I/O, no imports. The server uses it to order hits, the client to find the words to mark.
// A hit needs every query word. A word scores by the best tier it reaches in any field of the row: an exact
// word, a word that starts with it, a part of a word, or (only when none of those exist for that word anywhere
// in the row) a near miss within a small number of edits. A near miss never outranks any other tier, and a hit
// found only that way is reported as close so it is never shown as an exact match. Owner: S4.

export const rankLimits = {
  maxWords: 8,
  fuzzyMinLength: 4,
  unanchoredFuzzyLength: 6,
  maxTokenLength: 40,
  maxTokensPerField: 64,
} as const;
export const tierScore = { exact: 400, prefix: 300, substring: 200, fuzzy: 100 } as const;
export const labelBonus = 50;
export const exactLabelBonus = 25;
export const editPenalty = 10;

const letterMap: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  æ: 'ae',
  œ: 'oe',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

function foldPoint(point: string): string {
  const lowered = point.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
  let out = '';
  for (const char of lowered) out += letterMap[char] ?? char;
  return out;
}

/** The text with case, accents and a few look-alike letters removed, so "Zürich" and "zurich" are one word. */
export function foldText(value: string): string {
  let out = '';
  for (const point of value) out += foldPoint(point);
  return out;
}

type Folded = { folded: string; start: number[]; end: number[] };

/** The folded text with, for every folded character, where its source character starts and ends in the raw text. */
function foldWithMap(raw: string): Folded {
  const start: number[] = [];
  const end: number[] = [];
  let folded = '';
  let offset = 0;
  let lastGroup = 0;
  for (const point of raw) {
    const next = offset + point.length;
    const piece = foldPoint(point);
    if (piece === '') {
      // A combining mark belongs to the character before it, so a mark ends the same span.
      for (let index = lastGroup; index < end.length; index++) end[index] = next;
    } else {
      lastGroup = end.length;
      for (let n = 0; n < piece.length; n++) {
        start.push(offset);
        end.push(next);
      }
      folded += piece;
    }
    offset = next;
  }
  return { folded, start, end };
}

type Token = { text: string; from: number };

function tokenise(folded: string): Token[] {
  const tokens: Token[] = [];
  for (const match of folded.matchAll(/[\p{L}\p{N}]+/gu))
    tokens.push({ text: match[0], from: match.index });
  return tokens;
}

/** The words of a query, folded, without repeats: at most 8, each at most 40 characters. */
export function queryWords(query: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const token of tokenise(foldText(query))) {
    const word = token.text.slice(0, rankLimits.maxTokenLength);
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length === rankLimits.maxWords) break;
  }
  return words;
}

/** How many edits a word of this length may be away from a word in the text. Short words need an exact start. */
export function fuzzyLimit(wordLength: number): 0 | 1 | 2 {
  if (wordLength < rankLimits.fuzzyMinLength) return 0;
  return wordLength >= 8 ? 2 : 1;
}

/**
 * Edits between two words, where swapping two neighbouring letters is one edit (optimal string alignment).
 * Returns limit + 1 for anything further apart than the limit.
 */
export function editDistance(a: string, b: string, limit: number): number {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > limit) return limit + 1;
  const d: number[][] = [];
  for (let i = 0; i <= x.length; i++) {
    d.push(new Array<number>(y.length + 1).fill(0));
    d[i]![0] = i;
  }
  for (let j = 0; j <= y.length; j++) d[0]![j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  return Math.min(d[x.length]![y.length]!, limit + 1);
}

/**
 * The fewest edits between the word and a part of the token: a start of it (anchored) or any run inside it.
 * Returns limit + 1 for anything further than the limit.
 */
export function approxDistance(
  word: string,
  token: string,
  anchored: boolean,
  limit: number,
): number {
  const x = [...word];
  const y = [...token];
  if (x.length === 0) return 0;
  // A part of the token cannot be shorter than the word minus the edits allowed.
  if (y.length + limit < x.length) return limit + 1;
  const d: number[][] = [];
  for (let i = 0; i <= x.length; i++) {
    d.push(new Array<number>(y.length + 1).fill(0));
    d[i]![0] = i;
  }
  // Unanchored: the part of the token may start anywhere, so the top row costs nothing.
  for (let j = 0; j <= y.length; j++) d[0]![j] = anchored ? j : 0;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  let min = limit + 1;
  for (let j = 0; j <= y.length; j++) min = Math.min(min, d[x.length]![j]!);
  return min;
}

export type RankField = { value: unknown; label?: boolean };
export type Ranked = { score: number; close: boolean };

const anchoredFuzzy = (word: string) => word.length < rankLimits.unanchoredFuzzyLength;
const fuzzyPart = (token: string) => token.slice(0, rankLimits.maxTokenLength);

/** Tier of a word against one token, or 0. */
function literalTier(word: string, token: string): number {
  if (token === word) return tierScore.exact;
  if (token.startsWith(word)) return tierScore.prefix;
  if (token.includes(word)) return tierScore.substring;
  return 0;
}

/**
 * Scores one row. Every word must score, or the answer is null. A word's score is its best tier over all
 * fields, plus 50 when the best hit is in the label field. A word with no exact, prefix or substring hit
 * anywhere is tried as a near miss. The row score is the sum, plus 25 when the label's words are the query words.
 */
export function rankFields(words: string[], fields: RankField[]): Ranked | null {
  if (words.length === 0) return null;
  const prepared = fields.map((field) => ({
    label: field.label === true,
    tokens: tokenise(foldText(typeof field.value === 'string' ? field.value : '')),
  }));
  let score = 0;
  let close = false;
  for (const word of words) {
    let best = 0;
    for (const field of prepared)
      for (const token of field.tokens) {
        const tier = literalTier(word, token.text);
        if (tier > 0) best = Math.max(best, tier + (field.label ? labelBonus : 0));
      }
    if (best === 0) {
      const limit = fuzzyLimit(word.length);
      if (limit > 0) {
        const anchored = anchoredFuzzy(word);
        for (const field of prepared)
          for (const token of field.tokens.slice(0, rankLimits.maxTokensPerField)) {
            const distance = approxDistance(word, fuzzyPart(token.text), anchored, limit);
            if (distance <= limit)
              best = Math.max(
                best,
                tierScore.fuzzy - editPenalty * distance + (field.label ? labelBonus : 0),
              );
          }
        if (best > 0) close = true;
      }
    }
    if (best === 0) return null;
    score += best;
  }
  const label = prepared.find((field) => field.label);
  if (
    label &&
    label.tokens.length === words.length &&
    label.tokens.every(
      (token, index) => token.text.slice(0, rankLimits.maxTokenLength) === words[index],
    )
  )
    score += exactLabelBonus;
  return { score, close };
}

export type Segment = { text: string; hit: boolean };

/** The shortest run of the token within the limit of the word, earliest first, as folded offsets in the token. */
function fuzzySpan(
  word: string,
  token: string,
  anchored: boolean,
  limit: number,
): [number, number] | null {
  const best = approxDistance(word, token, anchored, limit);
  if (best > limit) return null;
  const chars = [...token];
  for (let length = 1; length <= chars.length; length++)
    for (let from = 0; from + length <= chars.length; from++) {
      if (anchored && from > 0) break;
      const part = chars.slice(from, from + length).join('');
      if (editDistance(word, part, best) === best) {
        const before = chars.slice(0, from).join('').length;
        return [before, before + part.length];
      }
    }
  return null;
}

/**
 * The text cut into pieces, each saying whether the query marks it. Exact, prefix and part-of-word matches are
 * always marked; a near-miss span is marked only when the hit is close, so a typo is never drawn as an exact
 * match. The pieces always join back into the original text. The client draws marked pieces as text inside
 * `<mark>`; nothing here makes HTML.
 */
export function highlightSegments(
  text: string,
  query: string,
  options: { close?: boolean } = {},
): Segment[] {
  if (text === '') return [];
  const words = queryWords(query);
  const { folded, start, end } = foldWithMap(text);
  const tokens = tokenise(folded);
  const spans: [number, number][] = [];
  for (const word of words) {
    let literal = false;
    for (const token of tokens) {
      const at = token.text.indexOf(word);
      if (at < 0) continue;
      literal = true;
      spans.push([token.from + at, token.from + at + word.length]);
    }
    if (literal || options.close !== true) continue;
    const limit = fuzzyLimit(word.length);
    if (limit === 0) continue;
    const anchored = anchoredFuzzy(word);
    let chosen: { distance: number; token: Token } | null = null;
    for (const token of tokens.slice(0, rankLimits.maxTokensPerField)) {
      const distance = approxDistance(word, fuzzyPart(token.text), anchored, limit);
      if (distance <= limit && (!chosen || distance < chosen.distance))
        chosen = { distance, token };
    }
    if (!chosen) continue;
    const span = fuzzySpan(word, fuzzyPart(chosen.token.text), anchored, limit);
    if (span) spans.push([chosen.token.from + span[0], chosen.token.from + span[1]]);
  }
  const raw = spans
    .filter(([from, to]) => to > from && to <= start.length)
    .map(([from, to]): [number, number] => [start[from]!, end[to - 1]!])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  const segments: Segment[] = [];
  let at = 0;
  for (const [from, to] of merged) {
    if (from > at) segments.push({ text: text.slice(at, from), hit: false });
    segments.push({ text: text.slice(from, to), hit: true });
    at = to;
  }
  if (at < text.length) segments.push({ text: text.slice(at), hit: false });
  return segments;
}
