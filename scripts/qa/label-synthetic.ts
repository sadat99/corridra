// Synthetic record labelling (commercial readiness program CQ-33, CQ-66). Dry run by default.
//
// Lists made-up organisation and route records that are not yet marked "(madeup)" and shows the
// label each would get. It never deletes anything. With --apply --confirm-production it appends the
// "(madeup)" marker to organisation names only; routes are listed for a reviewed relabel because their
// market codes are part of route history and are never rewritten.
//
// Usage (the owner runs this; agents run it only against the local test database):
//   pnpm exec tsx scripts/qa/label-synthetic.ts --connection "postgres://..."            (dry run)
//   pnpm exec tsx scripts/qa/label-synthetic.ts --connection "postgres://..." --apply --confirm-production
//
// The connection string is required as an explicit argument; the environment is never read for it.
// It is never printed.
import { Pool } from '../../packages/db/src/index';

type Queryable = {
  query: (
    sql: string,
    args?: unknown[],
  ) => Promise<{ rows: Array<Record<string, string>>; rowCount: number | null }>;
};

export type LabelPlan = {
  organisations: { id: string; name: string; label: string }[];
  routes: { id: string; route: string; note: string }[];
};

export type LabelOptions = { connection: string; apply: boolean; confirmProduction: boolean };

export function parseArgs(argv: string[]): LabelOptions {
  const index = argv.indexOf('--connection');
  const connection = index >= 0 ? argv[index + 1] : undefined;
  if (!connection || connection.startsWith('--'))
    throw new Error('Pass the database with --connection "<connection string>". Nothing was read.');
  const apply = argv.includes('--apply');
  const confirmProduction = argv.includes('--confirm-production');
  if (apply && !confirmProduction)
    throw new Error('--apply needs --confirm-production as well. Nothing was changed.');
  return { connection, apply, confirmProduction };
}

const MARK = '(madeup)';

/** Reads what would be labelled. Read only. */
export async function plan(client: Queryable): Promise<LabelPlan> {
  const organisations = (
    await client.query(
      `SELECT id::text,name FROM app.organisation WHERE synthetic AND position($1 in name)=0 ORDER BY name,id LIMIT 1000`,
      [MARK],
    )
  ).rows.map((r) => ({
    id: r.id,
    name: r.name,
    label: `${r.name} ${MARK}`.slice(0, 200),
  }));
  // The leftover Albania to Australia route (CQ-66) and any route in a synthetic workspace.
  const routes = (
    await client.query(
      `SELECT r.id::text,r.origin_market||' to '||r.destination_market AS route
       FROM app.corridor_route r JOIN app.tenant t ON t.id=r.tenant_id
       WHERE t.synthetic OR (r.origin_market='AL' AND r.destination_market='AU')
       ORDER BY route,r.id LIMIT 1000`,
    )
  ).rows.map((r) => ({
    id: r.id,
    route: r.route,
    note:
      r.route === 'AL to AU'
        ? 'Leftover test route: show as "(madeup)" in the route list; history is kept.'
        : 'Route in a sample workspace; history is kept.',
  }));
  return { organisations, routes };
}

/** Appends the marker to organisation names. Never deletes, never touches routes or history. */
export async function apply(client: Queryable, organisations: LabelPlan['organisations']) {
  let changed = 0;
  await client.query('BEGIN');
  try {
    for (const org of organisations) {
      const r = await client.query(
        'UPDATE app.organisation SET name=$2 WHERE id=$1::uuid AND synthetic AND position($3 in name)=0',
        [org.id, org.label, MARK],
      );
      changed += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return changed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: options.connection, max: 1 });
  const client = await pool.connect();
  try {
    const found = await plan(client);
    console.log(`Organisations to label: ${found.organisations.length}`);
    for (const org of found.organisations)
      console.log(`  ${org.id}  ${org.name}  ->  ${org.label}`);
    console.log(`Routes to review (listed only, never rewritten): ${found.routes.length}`);
    for (const route of found.routes) console.log(`  ${route.id}  ${route.route}  ${route.note}`);
    if (!options.apply) {
      console.log('Dry run. Nothing was changed. Add --apply --confirm-production to label.');
      return;
    }
    const changed = await apply(client, found.organisations);
    console.log(`Labelled ${changed} organisation names. Nothing was deleted.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Labelling failed.');
    process.exitCode = 1;
  });
