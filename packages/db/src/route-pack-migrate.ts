import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { applyRoutePackMigrations } from './route-pack-apply';

// ADR-093 Phase 2a. Explicit optional installation of one-person route publication: one person may propose and publish a
// route pack, record its readiness and release it. It refuses to run unless the customer real-use module that holds the current
// operations guard is already installed (it never installs that module itself), and the SQL refuses unless the guard definition
// is exactly the one that module installed. It opens no gate. Only top-level .sql files are applied; the rollback directory is
// never run here. No runtime request receives this owner connection.
export function migrateRoutePack(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateRoutePack', () => migrateRoutePackRun(pool));
}

async function migrateRoutePackRun(pool: DatabasePool) {
  await applyRoutePackMigrations(pool);
}
