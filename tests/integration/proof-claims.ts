// The honest-proof rule for public copy (revamp spec pack 1, change 3): no claim of customers, results,
// counts, logos or superlatives. Used by the browser guard in tests/e2e/verification/ws-a/intake-payload.spec.ts
// and tested with red fixtures in proof-claims.test.ts.

export const proofClaims: RegExp[] = [
  /trusted by/i,
  /our customers/i,
  /testimonials?/i,
  /case studies?/i,
  /as seen (in|on)/i,
  /\b[0-9][0-9,]*\+?\s+(companies|buyers|suppliers|factories|customers|missions|meetings|deals)\b/i,
  /\b(thousands|hundreds) of (companies|buyers|suppliers)\b/i,
  /\bverified (buyers|suppliers|factories)\b/i,
  /\b(guaranteed|guarantee[sd]?)\s+(meetings|sales|orders|results)\b/i,
  /\bno\.?\s*1\b|\bleading platform\b|\bworld'?s (best|leading|largest)\b/i,
];

// Words that deny what follows them in the same clause: "We do not book travel or guarantee meetings".
const denial =
  /\b(?:do|does|did|will|would|can|could|should|must)\s+not\b|\b(?:don|doesn|didn|won|wouldn|can|couldn|shouldn)['’]t\b|\bcannot\b|\bnever\b|\bwithout\b|\bnot\b/i;

/**
 * Whether the match at `index` is denied by its own clause. Only the words before the match, back to the
 * last clause break (comma, semicolon, colon, dash, "but" or "and"), count, so "Trusted by 100 companies with
 * no subscription fees" is still a claim and a denial elsewhere in the sentence does not cover it.
 */
function denied(sentence: string, index: number) {
  const before = sentence.slice(0, index);
  const clause = before.split(/[,;:–—]|\bbut\b|\band\b/i).pop() ?? '';
  return denial.test(clause) || /\bno\s+$/i.test(clause);
}

/** The claims found in blocks of copy. Each block is read on its own, so a denial never crosses a block. */
export function proofClaimsIn(blocks: readonly string[]): { claim: string; sentence: string }[] {
  const found: { claim: string; sentence: string }[] = [];
  for (const block of blocks)
    for (const sentence of block.split(/(?<=[.!?])\s+|\n+/)) {
      const text = sentence.trim();
      if (!text) continue;
      // Every match of a pattern is checked, so a denied first mention never hides a later claim.
      const hits = proofClaims.filter((pattern) => {
        const every = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
        return Array.from(text.matchAll(every)).some((match) => !denied(text, match.index ?? 0));
      });
      // One entry per sentence, naming every pattern it breaks.
      if (hits.length) found.push({ claim: hits.map(String).join(' '), sentence: text });
    }
  return found;
}
