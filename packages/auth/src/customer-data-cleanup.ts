import type { DatabaseClient, DatabasePool } from '@corridra/db';

// Offline schema-owner report only (U2). No request handler imports this module. It counts the made-up, demo and QA test
// workspaces and records and writes nothing. It archives nothing either: every customer workspace is created by a signed-in
// person through customer.provision_workspace (synthetic only because real use was off at the time), and no seed writes one
// in production, so no stored fact proves that a workspace was made up by us. Its output is printed in public Actions logs:
// it carries counts and 8-character ids only, and a workspace name only when that name is on the keep list below.

// Workspace names the seeds, the QA sweep and the end-to-end checks create or name. They are ours, so the report may
// print them, marked with the file that uses them. No other workspace name is ever printed.
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

type Present = {
  workspace: boolean;
  archivedGate: boolean;
  sampleInvoice: boolean;
  samplePayment: boolean;
  sampleCredit: boolean;
  supplier: boolean;
};
type ListedWorkspace = { id: string; name: string; synthetic: boolean; archived: boolean };
export type KeptWorkspace = { id: string; name: string; usedBy: string };
export type DataCleanupInventory = {
  installed: { workspaces: boolean; lifecycle: boolean };
  totals: { synthetic: number; real: number };
  // Made-up workspaces: those on the keep list, and those created by a person (count and ids only).
  synthetic: { kept: KeptWorkspace[]; createdByPerson: string[]; archived: number };
  // Real workspaces whose current name starts like a QA test name: listed only.
  qa: { kept: KeptWorkspace[]; listedOnly: string[] };
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
 to_regclass('customer_private.invoicing_invoice') IS NOT NULL AS "sampleInvoice",
 to_regclass('customer_private.invoicing_payment') IS NOT NULL AS "samplePayment",
 to_regclass('customer_private.invoicing_credit') IS NOT NULL AS "sampleCredit",
 to_regclass('customer_private.real_invoicing_entity') IS NOT NULL AS supplier`)
  ).rows[0]!;
}

// Every made-up workspace and every QA-named one, and whether it is archived now. Only a fixed fragment is chosen, by
// whether the workspace lifecycle is installed; nothing from input is ever placed in the text.
const listing = (present: Present) => `SELECT w.tenant_id::text AS id,t.name,t.synthetic,
 ${present.archivedGate ? 'customer_private.workspace_archived(w.tenant_id)' : 'false'} AS archived
 FROM customer.workspace w JOIN app.tenant t ON t.id=w.tenant_id
 WHERE t.synthetic OR t.name ~ $1 ORDER BY t.synthetic DESC,w.tenant_id`;

const keptBy = (row: ListedWorkspace) => {
  const entry = dataCleanupKeepList.find((kept) => kept.name === row.name);
  return entry ? { id: row.id, name: row.name, usedBy: entry.usedBy } : undefined;
};
const short = (id: string) => id.slice(0, 8);
const keptLine = (row: KeptWorkspace) =>
  `  ${short(row.id)} ${row.name}: kept, used by ${row.usedBy}`;
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
  const rows = present.workspace
    ? (await db.query<ListedWorkspace>(listing(present), [qaName])).rows
    : [];
  const synthetic: DataCleanupInventory['synthetic'] = {
    kept: [],
    createdByPerson: [],
    archived: 0,
  };
  const qa: DataCleanupInventory['qa'] = { kept: [], listedOnly: [] };
  for (const row of rows) {
    const kept = keptBy(row);
    if (row.synthetic) {
      if (row.archived) synthetic.archived += 1;
      if (kept) synthetic.kept.push(kept);
      else synthetic.createdByPerson.push(row.id);
    } else if (kept) qa.kept.push(kept);
    else qa.listedOnly.push(row.id);
  }
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
  const madeUp = counts.supplierFieldsMadeUp;
  const lines = [
    present.workspace
      ? `workspaces: ${totals.synthetic + totals.real} (synthetic ${totals.synthetic}, real ${totals.real})`
      : 'workspaces: not installed',
    `synthetic workspaces kept (ours, used by a seed or check): ${synthetic.kept.length}`,
    ...synthetic.kept.map(keptLine),
    `synthetic workspaces held, created by a person (never archived here): ${synthetic.createdByPerson.length}`,
    ...synthetic.createdByPerson.map((id) => `  ${short(id)}`),
    `synthetic workspaces archived now: ${present.archivedGate ? synthetic.archived : 'lifecycle not installed'}`,
    `real workspaces named like a QA test (listed only): ${qa.kept.length + qa.listedOnly.length}`,
    ...qa.kept.map(keptLine),
    ...qa.listedOnly.map((id) => `  ${short(id)}`),
    `synthetic invoices (never changed): ${notInstalled(counts.sampleInvoices)}`,
    `synthetic payment records (never changed): ${notInstalled(counts.samplePayments)}`,
    `synthetic credit notes (never changed): ${notInstalled(counts.sampleCredits)}`,
    `supplier fields still marked made up (never changed): ${
      madeUp === null
        ? 'not installed'
        : `${madeUp.length}${madeUp.length ? ' (' + madeUp.join(', ') + ')' : ''}`
    }`,
    `QA staff accounts (never changed): ${counts.qaStaffAccounts}`,
    'Nothing was archived, changed or deleted.',
  ];
  return {
    installed: { workspaces: present.workspace, lifecycle: present.archivedGate },
    totals,
    synthetic,
    qa,
    counts,
    lines,
  };
}

// Read only. It runs inside a read-only transaction that is always rolled back, so it can write nothing, and it works
// whether or not the workspace lifecycle or invoicing modules are installed.
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
