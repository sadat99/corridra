import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateViewerModule } from './viewer-module-run';

// ADR-087 U5, member access. Explicit optional installation, reached only through field_modules_action=member_access: adds the
// read-only functions by which a workspace owner or admin lists and opens current members' saved reports (0001) and decision
// cards (0002, which waits until the decision card module is installed), and downloads their books. Installing writes no row and
// opens nothing by itself: each workspace opens only 24 hours after its member notice was delivered, and the application switch
// CORRIDRA_MEMBER_ACCESS stays off until the owner turns it on. 0001 refuses unless the member notice module (U4) is installed.
// The rollback folder is never applied. No runtime request receives this owner connection.
export function migrateMemberAccess(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateMemberAccess', () => migrateMemberAccessRun(pool));
}

async function migrateMemberAccessRun(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../member-access-migrations/', import.meta.url),
    schema: 'member_access_migrations',
    label: 'Member access',
  });
}
