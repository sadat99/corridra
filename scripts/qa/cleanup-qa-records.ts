// QA record cleanup (commercial readiness program, Appendix A). Dry run by default.
//
// Lists the records the 31 Oct 2026 QA review created ("QA test (madeup)") and what depends on them.
// It never deletes anything and never touches ledger, audit or evidence rows. With
// --apply --confirm-production --actor <team member reference> it only revokes the QA report and its
// private link, by appending revocation rows in the acting member's name. Everything else is listed
// for the owner to archive or cancel in the product, where the normal checks and history apply.
//
// Usage (the owner runs this; agents run it only against the local test database):
//   pnpm exec tsx scripts/qa/cleanup-qa-records.ts --connection "postgres://..."            (dry run)
//   pnpm exec tsx scripts/qa/cleanup-qa-records.ts --connection "postgres://..." --apply \
//     --confirm-production --actor <principal uuid>
//
// The connection string is required as an explicit argument; it is never read from the environment
// and never printed.
import { randomUUID } from 'node:crypto';
import { Pool } from '../../packages/db/src/index';

type Row = Record<string, string>;
type Queryable = {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>;
};

export const QA_MARK = 'QA test (madeup)';
export const QA_CLAIM = '02604514-8cab-4104-8ea8-5d958b464131';

export type CleanupOptions = {
  connection: string;
  apply: boolean;
  confirmProduction: boolean;
  actor: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]): CleanupOptions {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    const found = index >= 0 ? argv[index + 1] : undefined;
    return found && !found.startsWith('--') ? found : null;
  };
  const connection = value('--connection');
  if (!connection)
    throw new Error('Pass the database with --connection "<connection string>". Nothing was read.');
  const apply = argv.includes('--apply');
  const confirmProduction = argv.includes('--confirm-production');
  const actor = value('--actor');
  if (apply && !confirmProduction)
    throw new Error('--apply needs --confirm-production as well. Nothing was changed.');
  if (apply && (!actor || !uuid.test(actor)))
    throw new Error('--apply needs --actor <team member reference>. Nothing was changed.');
  return { connection, apply, confirmProduction, actor };
}

export type CleanupPlan = {
  missions: Row[];
  publications: Row[];
  links: Row[];
  claims: Row[];
  evidence: Row[];
  programmes: Row[];
};

/** Read only: what matches the QA marker, and what depends on it. */
export async function plan(db: Queryable): Promise<CleanupPlan> {
  const like = `%${QA_MARK.toLowerCase()}%`;
  const missions = (
    await db.query(
      `SELECT m.id::text,m.tenant_id::text,m.status,i.brief->>'company' AS company FROM app.mission m
       JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id
       WHERE lower(i.brief::text) LIKE $1 OR lower(i.brief->>'company') LIKE '%qa test co (madeup)%'
       ORDER BY m.created_at LIMIT 500`,
      [like],
    )
  ).rows;
  const publications = (
    await db.query(
      `SELECT p.id::text,p.tenant_id::text,p.mission_id::text,
        EXISTS(SELECT FROM app.delivery_revocation r WHERE r.tenant_id=p.tenant_id AND r.publication_id=p.id) AS revoked
       FROM app.delivery_publication p WHERE lower(p.copy::text) LIKE $1 ORDER BY p.created_at LIMIT 500`,
      [like],
    )
  ).rows;
  const links = publications.length
    ? (
        await db.query(
          `SELECT l.id::text,l.tenant_id::text,l.expires_at::text,
            EXISTS(SELECT FROM app.delivery_revocation r WHERE r.tenant_id=l.tenant_id AND r.link_id=l.id) AS revoked
           FROM app.delivery_link l WHERE l.publication_ids && $1::uuid[] ORDER BY l.created_at LIMIT 500`,
          [publications.map((p) => p.id)],
        )
      ).rows
    : [];
  const claims = (
    await db.query(
      `SELECT c.id::text,c.tenant_id::text,c.status FROM app.claim c
       WHERE c.id::text=$2 OR lower(c.statement) LIKE $1 ORDER BY c.created_at LIMIT 500`,
      [like, QA_CLAIM],
    )
  ).rows;
  const evidence = claims.length
    ? (
        await db.query(
          `SELECT e.id::text,e.claim_id::text,s.status FROM app.evidence_object e
           JOIN app.evidence_state s USING(tenant_id,id) WHERE e.claim_id=ANY($1::uuid[]) LIMIT 500`,
          [claims.map((c) => c.id)],
        )
      ).rows
    : [];
  // Team delivery programmes with the marker. Customer-side programmes are archived in the product.
  const programmes = (
    await db.query(
      `SELECT id::text,name FROM app.delivery_programme WHERE lower(name) LIKE $1 LIMIT 500`,
      [like],
    )
  ).rows;
  return { missions, publications, links, claims, evidence, programmes };
}

/** Appends revocation rows for QA reports and links that are still open. Never deletes. */
export async function applyRevocations(db: Queryable, found: CleanupPlan, actor: string) {
  let revoked = 0;
  await db.query('BEGIN');
  try {
    for (const link of found.links.filter((l) => String(l.revoked) !== 'true')) {
      const r = await db.query(
        `INSERT INTO app.delivery_revocation(id,tenant_id,link_id,reason,created_by) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), link.tenant_id, link.id, 'QA review record (madeup) withdrawn', actor],
      );
      revoked += r.rowCount ?? 0;
    }
    for (const p of found.publications.filter((p) => String(p.revoked) !== 'true')) {
      const r = await db.query(
        `INSERT INTO app.delivery_revocation(id,tenant_id,publication_id,reason,created_by) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), p.tenant_id, p.id, 'QA review record (madeup) withdrawn', actor],
      );
      revoked += r.rowCount ?? 0;
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  return revoked;
}

function print(found: CleanupPlan) {
  const section = (title: string, rows: Row[], note: string) => {
    console.log(`${title}: ${rows.length}. ${note}`);
    for (const row of rows) console.log('  ' + JSON.stringify(row));
  };
  section('Missions', found.missions, 'Cancel or close in the product; history is kept.');
  section('Reports', found.publications, 'Revoked by --apply; the report row is kept.');
  section('Private links', found.links, 'Revoked by --apply; the link row is kept.');
  section('Claims', found.claims, 'Kept. Evidence rules forbid deleting claims.');
  section('Evidence', found.evidence, 'Kept. Evidence rows are never deleted.');
  section('Programmes', found.programmes, 'Archive in the product; registrations are kept.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: options.connection, max: 1 });
  const client = await pool.connect();
  try {
    const found = await plan(client);
    print(found);
    if (!options.apply) {
      console.log('Dry run. Nothing was changed.');
      return;
    }
    const revoked = await applyRevocations(client, found, options.actor!);
    console.log(`Appended ${revoked} revocation rows. Nothing was deleted.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Cleanup failed.');
    process.exitCode = 1;
  });
