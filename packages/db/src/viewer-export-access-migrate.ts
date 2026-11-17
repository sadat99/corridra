import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateViewerModule } from './viewer-module-run';

// ADR-087 U3. Explicit optional installation, reached only through field_modules_action=viewer_export_access: report exports
// and snapshots for every staff role except viewer (two read policy pairs gain the viewer clause). It refuses unless the
// customer real-use modules are installed, and its SQL refuses unless each policy is exactly the one it replaces. The rollback
// folder is never applied. No runtime request receives this owner connection.
export function migrateViewerExportAccess(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateViewerExportAccess', () => migrateViewerExportAccessRun(pool));
}

async function migrateViewerExportAccessRun(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../viewer-export-access-migrations/', import.meta.url),
    schema: 'viewer_export_access_migrations',
    label: 'Viewer export access',
  });
}
