// A per-person sliding window for search routes. One search reads several pages one after the other, so a burst of
// searches (a held key, a script, a stuck client) is bounded here before any page is read. The repository has no shared
// helper that fits: app.intake_budget allows only 6 or 60 a HOUR (changing that is a migration) and the customer budget
// guards the public intake. So this is an in-process window: it is per server instance, not shared across replicas,
// keeps nothing on disk and holds only the key the caller gives it, which must be a server-side person id, never the words
// typed and never a client-supplied value such as a workspace. Each search route makes its own limit with its own
// numbers, so one route's searches never spend another's allowance. Owner: S67.
export type SearchLimitOptions = { searches: number; windowMs: number; maxKeys: number };
export type SearchAllowance = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function createSearchLimit(options: SearchLimitOptions) {
  const hits = new Map<string, number[]>();
  return {
    /** Counts one search for this key. `now` is passed in so a test needs no clock. */
    spend(key: string, now: number = Date.now()): SearchAllowance {
      const since = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((at) => at > since);
      if (recent.length >= options.searches) {
        hits.set(key, recent);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + options.windowMs - now) / 1000)),
        };
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > options.maxKeys) {
        // Drop the people idle the longest (the map keeps the most recently used last), so memory stays bounded.
        for (const [other, list] of hits) {
          if (hits.size <= options.maxKeys) break;
          if (other !== key && (list.at(-1) ?? 0) <= since) hits.delete(other);
        }
        for (const other of hits.keys()) {
          if (hits.size <= options.maxKeys) break;
          if (other !== key) hits.delete(other);
        }
      }
      return { allowed: true };
    },
    /** How many keys are held (a test checks that it stays bounded). */
    size: () => hits.size,
    /** For tests only: forget every count. */
    reset: () => hits.clear(),
  };
}
