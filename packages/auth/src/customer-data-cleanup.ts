import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseClient, DatabasePool } from '@corridra/db';

// Offline schema-owner operation only (U2). No request handler imports this module. It lists the made-up, demo and QA
// test workspaces, and archives or restores made-up (synthetic) workspaces by appending rows to
// customer_private.data_cleanup_archive. Nothing is deleted or updated: workspaces, money, audit, event and invoice rows
// are never touched, and "(madeup)" values stay as they are. QA-named real workspaces are listed only, never archived.
// Rollback of a run: action restore, which appends a restore row for each workspace a cleanup archive still holds.

// Workspaces the release checks, QA scripts and seeds create or name. A workspace whose current name is on this list is
// kept and reported with the file that uses it, never archived. When in doubt a name belongs here.
export const dataCleanupKeepList = [
  { name: 'Synthetic North', usedBy: 'packages/auth/src/bootstrap.ts' },
  { name: 'Synthetic QA Test Importers workspace', usedBy: 'scripts/qa/signed-in-sweep.ts' },
  { name: 'Synthetic QA Test Programme office', usedBy: 'scripts/qa/signed-in-sweep.ts' },
  { name: 'Synthetic QA Test Participant workspace', usedBy: 'scripts/qa/signed-in-sweep.ts' },
  { name: 'Synthetic QA Test Exporters workspace', usedBy: 'scripts/qa/signed-in-sweep.ts' },
  { name: 'QA Test Co (madeup)', usedBy: 'tests/e2e/verification/ws-c/seed.ts' },
] as const;

const qaName = String.raw`^(Synthetic )?QA Test( |\(|$)`;
const qaStaffEmail = String.raw`^qa-.*@example\.(com|invalid)$`;
const heldReason = 'real invoice or billing records';

type Present = {
  workspace: boolean;
  archivedGate: boolean;
  cleanup: boolean;
  realInvoice: boolean;
  subscription: boolean;
  sampleInvoice: boolean;
  samplePayment: boolean;
  sampleCredit: boolean;
  supplier: boolean;
};
type ListedWorkspace = {
  id: string;
  name: string;
  synthetic: boolean;
  archived: boolean;
  cleanup_archived: boolean;
  held: boolean;
};
export type CleanupWorkspace = { id: string; name: string };
export type DataCleanupInventory = {
  installed: { workspaces: boolean; lifecycle: boolean; cleanup: boolean };
  totals: { synthetic: number; real: number };
  synthetic: {
    toArchive: CleanupWorkspace[];
    kept: (CleanupWorkspace & { usedBy: string })[];
    heldBack: (CleanupWorkspace & { reason: string })[];
  };
  qa: { kept: (CleanupWorkspace & { usedBy: string })[]; listedOnly: CleanupWorkspace[] };
  cleanupArchived: CleanupWorkspace[];
  counts: {
    sampleInvoices: number | null;
    samplePayments: number | null;
    sampleCredits: number | null;
    supplierFieldsMadeUp: string[] | null;
    qaStaffAccounts: number;
  };
  lines: string[];
};

async function presence(db: DatabaseClient): Promise<Present> {
  return (
    await db.query<Present>(`SELECT
 to_regclass('customer.workspace') IS NOT NULL AS workspace,
 to_regprocedure('customer_private.workspace_archived(uuid)') IS NOT NULL AS "archivedGate",
 to_regclass('customer_private.data_cleanup_archive') IS NOT NULL AS cleanup,
 to_regclass('customer_private.real_invoice') IS NOT NULL AS "realInvoice",
 to_regclass('customer_private.billing_subscription') IS NOT NULL AS subscription,
 to_regclass('customer_private.invoicing_invoice') IS NOT NULL AS "sampleInvoice",
 to_regclass('customer_private.invoicing_payment') IS NOT NULL AS "samplePayment",
 to_regclass('customer_private.invoicing_credit') IS NOT NULL AS "sampleCredit",
 to_regclass('customer_private.real_invoicing_entity') IS NOT NULL AS supplier`)
  ).rows[0]!;
}

// The one SQL source both the inventory and the archive read: every made-up workspace and every QA-named one, with
// whether it is archived now, whether a cleanup archive is what holds it, and whether it has real money records. Only
// fixed fragments are chosen, by which optional tables exist; nothing from input is ever placed in the text.
function listing(present: Present) {
  const archived = present.archivedGate
    ? 'customer_private.workspace_archived(w.tenant_id)'
    : 'false';
  const cleanupArchived = present.cleanup
    ? `coalesce((SELECT c.action='archive' AND NOT EXISTS(SELECT FROM customer_private.workspace_revision r
        WHERE r.tenant_id=c.tenant_id AND r.created_at>c.created_at)
       FROM customer_private.data_cleanup_archive c WHERE c.tenant_id=w.tenant_id ORDER BY c.created_at DESC,c.id DESC LIMIT 1),false)`
    : 'false';
  const held = [
    present.realInvoice
      ? 'EXISTS(SELECT FROM customer_private.real_invoice i WHERE i.tenant_id=w.tenant_id)'
      : 'false',
    // Real plans reuse the subscription table; on a real workspace a subscription is a real one.
    present.subscription
      ? '(NOT t.synthetic AND EXISTS(SELECT FROM customer_private.billing_subscription s WHERE s.tenant_id=w.tenant_id))'
      : 'false',
  ].join(' OR ');
  return `SELECT w.tenant_id::text AS id,t.name,t.synthetic,${archived} AS archived,
 ${cleanupArchived} AS cleanup_archived,(${held}) AS held
 FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id
 WHERE t.synthetic OR t.name ~ $1 ORDER BY t.synthetic DESC,t.name,w.tenant_id`;
}

const keptBy = (name: string) => dataCleanupKeepList.find((entry) => entry.name === name)?.usedBy;

function classify(rows: ListedWorkspace[]) {
  const synthetic: DataCleanupInventory['synthetic'] = { toArchive: [], kept: [], heldBack: [] };
  const qa: DataCleanupInventory['qa'] = { kept: [], listedOnly: [] };
  const cleanupArchived: CleanupWorkspace[] = [];
  for (const row of rows) {
    const workspace = { id: row.id, name: row.name };
    const usedBy = keptBy(row.name);
    if (row.cleanup_archived) cleanupArchived.push(workspace);
    if (!row.synthetic) {
      if (usedBy) qa.kept.push({ ...workspace, usedBy });
      else qa.listedOnly.push(workspace);
    } else if (row.archived)
      synthetic.heldBack.push({
        ...workspace,
        reason: row.cleanup_archived ? 'archived by data cleanup' : 'already archived',
      });
    else if (usedBy) synthetic.kept.push({ ...workspace, usedBy });
    else if (row.held) synthetic.heldBack.push({ ...workspace, reason: heldReason });
    else synthetic.toArchive.push(workspace);
  }
  return { synthetic, qa, cleanupArchived };
}

async function listWorkspaces(db: DatabaseClient, present: Present) {
  return (await db.query<ListedWorkspace>(listing(present), [qaName])).rows;
}

const short = (workspace: CleanupWorkspace) => `${workspace.id.slice(0, 8)} ${workspace.name}`;
const countOf = async (db: DatabaseClient, sql: string) =>
  Number((await db.query<{ n: string }>(sql)).rows[0]!.n);

async function readInventory(db: DatabaseClient): Promise<DataCleanupInventory> {
  const present = await presence(db);
  const totals = present.workspace
    ? (
        await db.query<{ synthetic: number; real: number }>(
          `SELECT count(*) FILTER (WHERE t.synthetic)::int AS synthetic,count(*) FILTER (WHERE NOT t.synthetic)::int AS real
          FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id`,
        )
      ).rows[0]!
    : { synthetic: 0, real: 0 };
  const { synthetic, qa, cleanupArchived } = classify(
    present.workspace ? await listWorkspaces(db, present) : [],
  );
  const counts: DataCleanupInventory['counts'] = {
    sampleInvoices: present.sampleInvoice
      ? await countOf(db, 'SELECT count(*) AS n FROM customer_private.invoicing_invoice')
      : null,
    samplePayments: present.samplePayment
      ? await countOf(db, 'SELECT count(*) AS n FROM customer_private.invoicing_payment')
      : null,
    sampleCredits: present.sampleCredit
      ? await countOf(db, 'SELECT count(*) AS n FROM customer_private.invoicing_credit')
      : null,
    supplierFieldsMadeUp: present.supplier
      ? ((
          await db.query<{ fields: string[] }>(
            'SELECT placeholder_fields AS fields FROM customer_private.real_invoicing_entity ORDER BY version DESC LIMIT 1',
          )
        ).rows[0]?.fields ?? [])
      : null,
    qaStaffAccounts: Number(
      (
        await db.query<{ n: string }>(
          'SELECT count(*) AS n FROM identity."user" WHERE email ~ $1',
          [qaStaffEmail],
        )
      ).rows[0]!.n,
    ),
  };
  const notInstalled = (value: number | null) => (value === null ? 'not installed' : `${value}`);
  const lines = [
    present.workspace
      ? `workspaces: ${totals.synthetic + totals.real} (synthetic ${totals.synthetic}, real ${totals.real})`
      : 'workspaces: not installed',
    `synthetic_workspace to archive: ${synthetic.toArchive.length}`,
    ...synthetic.toArchive.map((workspace) => `  ${short(workspace)}`),
    ...synthetic.kept.map(
      (workspace) => `  ${short(workspace)}: kept, used by ${workspace.usedBy}`,
    ),
    `synthetic_workspace held back: ${synthetic.heldBack.length}`,
    ...synthetic.heldBack.map((workspace) => `  ${short(workspace)}: ${workspace.reason}`),
    `qa_workspace (real, never archived here): ${qa.kept.length + qa.listedOnly.length}`,
    ...qa.kept.map((workspace) => `  ${short(workspace)}: kept, used by ${workspace.usedBy}`),
    ...qa.listedOnly.map((workspace) => `  ${short(workspace)}: listed only, not archived`),
    `archived by data cleanup now: ${cleanupArchived.length}`,
    `synthetic invoices (never changed): ${notInstalled(counts.sampleInvoices)}`,
    `synthetic payment records (never changed): ${notInstalled(counts.samplePayments)}`,
    `synthetic credit notes (never changed): ${notInstalled(counts.sampleCredits)}`,
    `supplier fields still marked made up (never changed): ${
      counts.supplierFieldsMadeUp === null
        ? 'not installed'
        : `${counts.supplierFieldsMadeUp.length}${counts.supplierFieldsMadeUp.length ? ' (' + counts.supplierFieldsMadeUp.join(', ') + ')' : ''}`
    }`,
    `QA staff accounts (never changed): ${counts.qaStaffAccounts}`,
  ];
  return {
    installed: {
      workspaces: present.workspace,
      lifecycle: present.archivedGate,
      cleanup: present.cleanup,
    },
    totals,
    synthetic,
    qa,
    cleanupArchived,
    counts,
    lines,
  };
}

// Read only. It runs inside a read-only transaction that is always rolled back, so it can write nothing, and it works
// whether or not the workspace lifecycle, data cleanup or invoicing modules are installed.
export async function inventoryDataCleanup(pool: DatabasePool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    return await readInventory(db);
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}

// Archive: one 'archive' row per made-up workspace that is not archived, not on the keep list and has no real money
// records, all in one transaction under one batch id. Restore: one 'restore' row for each workspace whose newest cleanup
// row is an archive that still holds it, chosen by tenant id from the archive rows alone. A second run writes nothing.
export async function configureDataCleanup(pool: DatabasePool, input: unknown) {
  const value = z
    .object({
      action: z.enum(['archive', 'restore']),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.data_cleanup_archive'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:data-cleanup'))");
    // The customer module's executor, pinned with the customer issuer; the real-use executor when that is all there is.
    const executor = (
      await db.query<{ executor_id: string }>(
        `SELECT executor_id FROM (SELECT executor_id,1 AS rank FROM customer_private.configuration
        UNION ALL SELECT executor_id,2 FROM customer_private.real_use_configuration) e ORDER BY rank LIMIT 1`,
      )
    ).rows[0]?.executor_id;
    if (!executor) throw new Error('Customer configuration has not been initialized');
    // The lock every workspace write takes, so no new request slips in beside the archive or the restore.
    const lockAll = (ids: string[]) =>
      db.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('customer.access.workspace:'||id::text,0))
        FROM unnest($1::uuid[]) id ORDER BY id`,
        [ids],
      );
    const batchId = randomUUID();
    if (value.action === 'archive') {
      const present = await presence(db);
      await lockAll(
        (await listWorkspaces(db, present)).filter((row) => row.synthetic).map((row) => row.id),
      );
      const ids = classify(await listWorkspaces(db, present)).synthetic.toArchive.map(
        (row) => row.id,
      );
      if (ids.length)
        await db.query(
          `INSERT INTO customer_private.data_cleanup_archive(tenant_id,category,action,batch_id,executor_id,reason)
          SELECT id,'synthetic_workspace','archive',$2,$3,$4 FROM unnest($1::uuid[]) id`,
          [ids, batchId, executor, value.reason],
        );
      await db.query('COMMIT');
      return { batchId: ids.length ? batchId : null, archived: ids.length, restored: 0 };
    }
    const archivedNow = `SELECT l.tenant_id::text AS id,l.category FROM (
      SELECT DISTINCT ON (c.tenant_id) c.tenant_id,c.category,c.action,c.created_at FROM customer_private.data_cleanup_archive c
      ORDER BY c.tenant_id,c.created_at DESC,c.id DESC) l
      WHERE l.action='archive' AND NOT EXISTS(SELECT FROM customer_private.workspace_revision r
       WHERE r.tenant_id=l.tenant_id AND r.created_at>l.created_at)`;
    await lockAll((await db.query<{ id: string }>(archivedNow)).rows.map((row) => row.id));
    const held = (await db.query<{ id: string; category: string }>(archivedNow)).rows;
    if (held.length)
      await db.query(
        `INSERT INTO customer_private.data_cleanup_archive(tenant_id,category,action,batch_id,executor_id,reason)
        SELECT h.id,h.category,'restore',$3,$4,$5 FROM unnest($1::uuid[],$2::text[]) h(id,category)`,
        [
          held.map((row) => row.id),
          held.map((row) => row.category),
          batchId,
          executor,
          value.reason,
        ],
      );
    await db.query('COMMIT');
    return { batchId: held.length ? batchId : null, archived: 0, restored: held.length };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
