import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateViewerModule } from './viewer-module-run';

// ADR-087 U4, the member notice. Explicit optional installation, reached only through field_modules_action=member_notice: adds
// MEMBER_NOTICE to the inbox type check (hash guarded), the per-workspace delivery record, the per-member dismissal, the owner-run
// delivery function and the two customer functions. Installing writes no row and opens no access. It refuses unless the customer
// real-use modules are installed, like the other ADR-087 modules. The rollback folder is never applied. No runtime request
// receives this owner connection.
export function migrateMemberNotice(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateMemberNotice', () => migrateMemberNoticeRun(pool));
}

async function migrateMemberNoticeRun(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../member-notice-migrations/', import.meta.url),
    schema: 'member_notice_migrations',
    label: 'Member notice',
  });
}
