// A per-person limit on the team palette's search. One search reads up to eight pages one after the other, so a
// burst of searches is bounded here before any page is read. The window itself is the shared one in search-limit.ts,
// with this route's own numbers and its own map; it holds only the server-side user id, never the words typed and never
// a client-supplied value such as the workspace. The route answers 429 and the palette shows a calm "try again",
// never an empty result. Owner: S67.
import { createSearchLimit, type SearchAllowance } from './search-limit';

export const paletteLimit = { searches: 30, windowMs: 10_000, maxKeys: 5_000 } as const;

const limit = createSearchLimit(paletteLimit);

export type PaletteAllowance = SearchAllowance;

/** Counts one search for this person in this workspace. `now` is passed in so a test needs no clock. */
export function spendPaletteSearch(key: string, now: number = Date.now()): PaletteAllowance {
  return limit.spend(key, now);
}

/** For tests only: forget every count. */
export function resetPaletteLimit() {
  limit.reset();
}
