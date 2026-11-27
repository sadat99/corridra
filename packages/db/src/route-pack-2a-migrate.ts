import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { applyRoutePackMigrations } from './route-pack-apply';

// ADR-093 Phase 2a alone (amended 27 Nov 2026). The same reviewed installer as migrateRoutePack, stopped after
// 0001_one_person_route_publication.sql, so one-person route publication can be installed before the 2b content store. Every
// source is still loaded and every history row verified, so a changed 0002 stops this run too. It opens no gate. Its memo key is
// its own name, so a 2a-only call in an installer run never makes a later full migrateRoutePack call skip 0002.
export function migrateRoutePack2a(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateRoutePack2a', () => migrateRoutePack2aRun(pool));
}

async function migrateRoutePack2aRun(pool: DatabasePool) {
  await applyRoutePackMigrations(pool, '0001');
}
