import type { DatabasePool } from './index';
import { migrateViewerModule } from './viewer-module-run';

// ADR-087 U2. Explicit optional installation, reached only through field_modules_action=viewer_reply_metadata: staff viewers
// read reply and answer metadata only (two read policy pairs gain the viewer clause, and two typed meta reads are added). It
// refuses unless the customer real-use modules that hold the real read policies are installed (it never installs them), and
// each SQL file refuses unless every policy it replaces is exactly the one it was written against. A file whose header names a
// table with "-- requires-table:" is applied only where that table exists, and is otherwise left unrecorded so a later run
// applies it: 0002 waits for the recipient response revision module, whose install calls refreshViewerReplyMetadata. Only the
// .sql files directly in the folder are read; the rollback folder is never applied. Not memoised on purpose (like the workspace
// lifecycle): the refresh must run it again in the same installer run. No runtime request receives this owner connection.
export async function migrateViewerReplyMetadata(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../viewer-reply-metadata-migrations/', import.meta.url),
    schema: 'viewer_reply_metadata_migrations',
    label: 'Viewer reply metadata',
  });
}

// Brings U2 current where it is already installed (after the answer-correction module arrives); does nothing where it is not,
// so installing answer correction never installs U2. Returns null when U2 is not installed.
export async function refreshViewerReplyMetadata(pool: DatabasePool) {
  const installed = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('viewer_reply_metadata_migrations.applied') IS NOT NULL AS present",
  );
  if (!installed.rows[0]?.present) return null;
  return migrateViewerReplyMetadata(pool);
}
