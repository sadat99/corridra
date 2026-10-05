import { databasePool } from './database-pool';
import { writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
// Official REST schema: https://neon.com/api_spec/release/v2.json (checked 2026-10-04).
const c = z
  .object({
    NEON_API_KEY: z.string().min(1),
    NEON_NONPROD_PROJECT_ID: z.string().regex(/^[a-z0-9-]+$/),
    NEON_PRODUCTION_PROJECT_ID: z.string().regex(/^[a-z0-9-]+$/),
    NEON_PRODUCTION_PROJECT_NAME: z.string().min(1),
    NEON_SYNTHETIC_PARENT_ID: z.string().regex(/^br-[a-z0-9-]+$/),
    NEON_NONPROD_DATABASE_URL: z.url().optional(),
  })
  .parse(process.env);
if (c.NEON_NONPROD_PROJECT_ID === c.NEON_PRODUCTION_PROJECT_ID)
  throw new Error('Production and non-production must be separate projects');
const [action, pr] = process.argv.slice(2);
if (!['create', 'delete', 'inspect'].includes(action) || !/^\d{1,8}$/.test(pr ?? ''))
  throw new Error('Usage: neon-preview.ts create|delete|inspect <PR number>');
async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('https://console.neon.tech/api/v2' + path, {
    method,
    headers: { Authorization: `Bearer ${c.NEON_API_KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Neon ${method} failed with status ${r.status}`);
  return r.status === 204 ? {} : r.json();
}
const base = `/projects/${c.NEON_NONPROD_PROJECT_ID}`;
const { project } = await api(base);
if (
  project.name !== 'corridra-nonprod' ||
  !['aws-eu-central-1', 'aws-eu-west-1', 'aws-eu-west-3'].includes(project.region_id)
)
  throw new Error('Expected the approved EU non-production project');
const { project: production } = await api(`/projects/${c.NEON_PRODUCTION_PROJECT_ID}`);
if (
  production.name !== c.NEON_PRODUCTION_PROJECT_NAME ||
  production.region_id !== project.region_id ||
  production.pg_version !== project.pg_version
)
  throw new Error('Production project identity/region mismatch');
const { branches } = await api(base + '/branches');
const parent = branches.find((b: { id: string }) => b.id === c.NEON_SYNTHETIC_PARENT_ID);
if (!parent || parent.name !== 'synthetic') throw new Error('Explicit synthetic parent required');
const name = `corridra-pr-${pr}`;
let branch = branches.find((b: { name: string }) => b.name === name);
if (branch && (branch.parent_id !== parent.id || branch.id === parent.id || branch.protected))
  throw new Error('Existing preview is outside the managed lifecycle');
if (action === 'create' && !branch) {
  if (!c.NEON_NONPROD_DATABASE_URL) throw new Error('Parent connection required for creation');
  const url = new URL(c.NEON_NONPROD_DATABASE_URL);
  const { endpoints } = await api(base + '/endpoints');
  if (
    url.searchParams.get('sslmode') !== 'verify-full' ||
    url.username !== 'corridra_migrator' ||
    url.pathname !== '/corridra' ||
    !endpoints.some(
      (e: { branch_id: string; host: string }) =>
        e.branch_id === parent.id && e.host === url.hostname,
    )
  )
    throw new Error('Direct TLS database must belong to the verified non-production parent');
  const pool = databasePool(c.NEON_NONPROD_DATABASE_URL);
  try {
    // The parent is a sterile template: only schemas, migration hashes and factual country primitives.
    // Synthetic accounts are seeded independently on each child, never cloned with sessions/passwords.
    const tables = await pool.query(
      "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('app','identity') AND table_type='BASE TABLE' AND table_name NOT IN ('country','corridor')",
    );
    for (const t of tables.rows) {
      const count = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM "${t.table_schema}"."${t.table_name}") AS populated`,
      );
      if (count.rows[0].populated)
        throw new Error('Synthetic parent must be sterile before cloning');
    }
  } finally {
    await pool.end();
  }
  ({ branch } = await api(base + '/branches', 'POST', {
    branch: { parent_id: parent.id, name, init_source: 'parent-data' },
    endpoints: [{ type: 'read_write' }],
  }));
}
if (action === 'delete' && branch) {
  await api(base + '/branches/' + encodeURIComponent(branch.id), 'DELETE');
  branch = undefined;
}
await mkdir('.cache', { recursive: true });
const evidence = {
  checkedAt: new Date().toISOString(),
  projectId: project.id,
  region: project.region_id,
  productionProjectId: production.id,
  parentId: parent.id,
  pr: Number(pr),
  branchId: branch?.id ?? null,
  action,
};
await writeFile(`.cache/neon-pr-${pr}.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
