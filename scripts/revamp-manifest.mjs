// Wave 0 manifest for the controlled V3 revamp (docs/revamp/README.md).
// Derives a compact route/action/permission manifest and a cleanup reference check
// from the existing V3 static collector (scripts/v3-inventory.mjs). Read-only: it never
// deletes, renames or moves a file. Static reachability is not functional verification.
//
// Usage: node scripts/v3-inventory.mjs <sha> <dir> && node scripts/revamp-manifest.mjs <dir>/inventory.json [out]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const inventoryPath = process.argv[2];
const output = process.argv[3] ?? 'docs/revamp/wave-0';
if (!inventoryPath || !existsSync(inventoryPath)) {
  console.error('usage: node scripts/revamp-manifest.mjs <inventory.json> [output-dir]');
  process.exit(2);
}
const raw = readFileSync(inventoryPath);
const inventory = JSON.parse(raw.toString('utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
if (!head.startsWith(String(inventory.baseline))) {
  console.error(`inventory baseline ${inventory.baseline} does not match HEAD ${head}`);
  process.exit(1);
}

// Audience by route prefix. Order matters: first match wins.
const audiences = [
  [/^\/api\/(customer-|account$|move\/mine)/, 'customer'],
  [/^\/account(\/|$)/, 'customer'],
  [
    /^\/(api\/)?(workspace|operator|team-control|team-work|operator-auth|operator-setup|move\/staff|reply\/review|delivery|picker)(\/|$)/,
    'staff',
  ],
  [/^\/(api\/network|contributor)(\/|$)/, 'contributor'],
  [
    /^\/(api\/)?(buyer|client|programme|mute|pulse|mission-mail)(\/|$)/,
    'recipient or private link',
  ],
  [
    /^\/(api\/)?(intake|plan|signin|signup|verify-email|forgot-password|reset-password|auth|auth-mail)(\/|$)/,
    'public intake and customer identity',
  ],
  [/^\/api\/notifications$/, 'signed-in (customer or staff)'],
  [/.*/, 'public'],
];
const audienceOf = (route) => audiences.find(([re]) => re.test(route))[1];

// Contract section 4 customer navigation: Home, My Work, Companies, Results, More.
const customerHome = [
  [/^\/account$/, 'Home (also My Work, Results and More sections by ?view=)'],
  [/^\/account\/move$/, 'Home (Your Move, behind CORRIDRA_UX_MOVE)'],
  [/^\/account\/companies$/, 'Companies'],
  [/^\/account\/(profile|billing|notifications|all-tools)(\/|$)/, 'More'],
  [/^\/account\//, 'My Work'],
];
const v3HomeOf = (route, audience) => {
  if (audience !== 'customer' || route.startsWith('/api/')) return null;
  return customerHome.find(([re]) => re.test(route))?.[1] ?? 'UNMAPPED';
};

const controlsByRoute = new Map();
for (const action of inventory.actions) {
  for (const route of action.routes ?? []) {
    controlsByRoute.set(route, (controlsByRoute.get(route) ?? 0) + 1);
  }
}
const boundariesByFile = new Map();
for (const boundary of inventory.permissionBoundaries) {
  const file = String(boundary.location).replace(/:\d+$/, '');
  boundariesByFile.set(file, (boundariesByFile.get(file) ?? 0) + 1);
}
const branchesByFile = new Map();
for (const endpoint of inventory.endpoints) {
  const list = branchesByFile.get(endpoint.route) ?? [];
  list.push({ branch: endpoint.branch, acceptance: endpoint.acceptance });
  branchesByFile.set(endpoint.route, list);
}

const routes = inventory.routes
  .map((r) => {
    const audience = audienceOf(r.route);
    const entry = {
      route: r.route,
      file: r.file,
      audience,
      access: r.access,
      v3Home: v3HomeOf(r.route, audience),
      controls: controlsByRoute.get(r.route) ?? 0,
      permissionBoundariesInFile: boundariesByFile.get(r.file) ?? 0,
      status: 'EXISTING (static); runtime acceptance NOT VERIFIED',
    };
    const branches = branchesByFile.get(r.file);
    if (branches) entry.handlerBranches = branches;
    return entry;
  })
  .sort((a, b) => a.route.localeCompare(b.route));

// Cleanup reference check: tracked source files with no importer, script or config reference.
const tracked = git('ls-files').split('\n');
const sourceFiles = tracked.filter(
  (f) => /^(apps\/web|packages|scripts|tests)\//.test(f) && /\.(ts|tsx|mjs|js|css)$/.test(f),
);
const special =
  /\/(page|route|layout|loading|error|not-found|template|default|global-error|middleware|instrumentation|opengraph-image)\.(tsx?|jsx?|mjs)$/;
const texts = new Map(sourceFiles.map((f) => [f, readFileSync(f, 'utf8')]));
const configText = tracked
  .filter((f) => !f.startsWith('docs/') && /(package\.json|\.ya?ml|\.json)$/.test(f))
  .filter((f) => existsSync(f) && statSync(f).size < 500_000)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const docFiles = tracked.filter(
  (f) => /\.(md|json)$/.test(f) && /^(docs|\.claude|\.github)\/|^(AGENTS|CLAUDE)\.md$/.test(f),
);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cleanup = [];
for (const file of sourceFiles) {
  if (file.startsWith('tests/') || /\.(test|spec)\./.test(file) || special.test(file)) continue;
  if (file.endsWith('.d.ts') || file.includes('/migrations')) continue;
  let stem = path.basename(file).replace(/\.(tsx?|mjs|js|css)$/, '');
  if (stem === 'index') stem = path.basename(path.dirname(file));
  const pattern = new RegExp(`['"/]${escape(stem)}(\\.(tsx?|mjs|js|css))?['"]`);
  const importers = [...texts].filter(([f, t]) => f !== file && pattern.test(t)).map(([f]) => f);
  if (importers.length || pattern.test(configText)) continue;
  const base = path.basename(file);
  const docRefs = docFiles.filter((f) => readFileSync(f, 'utf8').includes(base));
  const frameworkLoaded = /(eslint|postcss|next|playwright|vitest)\.config\.(mjs|ts|js)$/.test(
    file,
  );
  const disposition = frameworkLoaded
    ? 'KEEP: loaded by its tool by file name'
    : file.startsWith('scripts/')
      ? 'KEEP: operator or agent CLI run by path; documented or historical evidence tooling'
      : 'REVIEW: no importer found; needs owner-approved deletion with preservation and rollback proof';
  cleanup.push({
    file,
    sha256: createHash('sha256').update(texts.get(file)).digest('hex'),
    lastCommit: git('log', '-1', '--format=%h %ad', '--date=short', '--', file),
    importers: 0,
    documentationReferences: docRefs,
    disposition,
  });
}

const counts = {};
for (const r of routes) counts[r.audience] = (counts[r.audience] ?? 0) + 1;
const manifest = {
  schemaVersion: 1,
  purpose:
    'Wave 0 of the V3 controlled revamp: every route, its audience, access rule, V3 customer home, control count and handler branches; plus a cleanup reference check. Nothing is deleted by this manifest.',
  baseline: head,
  generatedBy:
    'node scripts/v3-inventory.mjs <sha> <dir> && node scripts/revamp-manifest.mjs <dir>/inventory.json',
  sourceInventory: {
    sha256: createHash('sha256').update(raw).digest('hex'),
    bytes: raw.length,
    note: 'Full collector output is regenerated from the baseline commit, not committed (6 MB).',
    totals: Object.fromEntries(
      Object.entries(inventory)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, v.length]),
    ),
    unresolved: inventory.unresolved,
  },
  routeCountsByAudience: counts,
  unmappedCustomerRoutes: routes.filter((r) => r.v3Home === 'UNMAPPED').map((r) => r.route),
  routes,
  cleanup: {
    method:
      'Tracked apps/web, packages and scripts source with no import, CSS import, package script or config reference. Next special files, tests, migrations and type declarations are excluded. docs/source, ADRs, QA, history and migrations are never candidates.',
    candidates: cleanup,
    deleted: [],
  },
};
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    baseline: head.slice(0, 8),
    routes: routes.length,
    counts,
    unmapped: manifest.unmappedCustomerRoutes.length,
    cleanupCandidates: cleanup.length,
    review: cleanup.filter((c) => c.disposition.startsWith('REVIEW')).length,
  }),
);
