import type { DatabasePool } from './index';

// Per-run memoisation of the migrators, opt-in. Every optional migrator first calls each migrator it depends on, so one
// installer run repeated the same already-current check hundreds of times (about two seconds each against the live database).
// Only scripts/install-customer-modules.ts starts a run. While no run is started for a pool, migrateOnce simply calls the
// function, so the application, the tests and any second caller behave exactly as before. While a run is started, a migrator
// body executes at most once per pool: later calls share its result. A failure is never kept, so a retry runs the body again.
// Do not use it for a function that is re-run on purpose to refresh what another module patched (see refreshCustomerWorkspaceLifecycle).
const runs = new WeakMap<DatabasePool, Map<string, Promise<unknown>>>();

export function startMigrationRun(pool: DatabasePool) {
  runs.set(pool, new Map());
}

export function endMigrationRun(pool: DatabasePool) {
  runs.delete(pool);
}

export function migrateOnce<T>(pool: DatabasePool, key: string, run: () => Promise<T>): Promise<T> {
  const cache = runs.get(pool);
  if (!cache) return run();
  const known = cache.get(key);
  if (known) return known as Promise<T>;
  const started = run();
  cache.set(key, started);
  started.catch(() => {
    if (cache.get(key) === started) cache.delete(key);
  });
  return started;
}
