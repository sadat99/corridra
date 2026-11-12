// A per-person limit on the team palette's search. One search reads up to eight pages one after the other, so a
// burst of searches (a held key, a script, a stuck client) is bounded here before any page is read. The repository
// has no shared helper that fits: app.intake_budget allows only 6 or 60 a HOUR (changing that is a migration) and
// the customer budget guards the public intake. So this is an in-process sliding window: it is per server
// instance, not shared across replicas, keeps nothing on disk and holds only the server-side user id, never the words typed and never a client-supplied value such as the workspace. It
// refuses with the seconds to wait; the route answers 429 and the palette shows a calm "try again", never an
// empty result. Owner: S67.
export const paletteLimit = { searches: 30, windowMs: 10_000, maxKeys: 5_000 } as const;

const hits = new Map<string, number[]>();

export type PaletteAllowance = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Counts one search for this person in this workspace. `now` is passed in so a test needs no clock. */
export function spendPaletteSearch(key: string, now: number = Date.now()): PaletteAllowance {
  const since = now - paletteLimit.windowMs;
  const recent = (hits.get(key) ?? []).filter((at) => at > since);
  if (recent.length >= paletteLimit.searches) {
    hits.set(key, recent);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + paletteLimit.windowMs - now) / 1000)),
    };
  }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > paletteLimit.maxKeys) {
    // Drop the people idle the longest (the map keeps the most recently used last), so memory stays bounded.
    for (const [other, list] of hits) {
      if (hits.size <= paletteLimit.maxKeys) break;
      if (other !== key && (list.at(-1) ?? 0) <= since) hits.delete(other);
    }
    for (const other of hits.keys()) {
      if (hits.size <= paletteLimit.maxKeys) break;
      if (other !== key) hits.delete(other);
    }
  }
  return { allowed: true };
}

/** For tests only: forget every count. */
export function resetPaletteLimit() {
  hits.clear();
}
