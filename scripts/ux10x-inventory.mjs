import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Baseline is immutable: this collector never reads modified UI as original coverage.
const baseline = process.argv[2] ?? '1e0dbea6f146265b256ca89b5482e789f97acdd9';
const outputDirectory = process.argv[3] ?? 'docs/ux10x';
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { encoding: 'utf8' })
  .trim()
  .split('\n');
const sources = new Map();
for (const file of files.filter(
  (f) => /^(apps\/web|packages|tests)\//.test(f) && /\.(tsx?|mjs)$/.test(f),
)) {
  sources.set(
    file,
    execFileSync('git', ['show', `${baseline}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}
const nodes = new Map(
  [...sources].map(([f, s]) => [f, ts.createSourceFile(f, s, ts.ScriptTarget.Latest, true)]),
);
const compact = (s) => s.replace(/\s+/g, ' ').trim();
const location = (f, n) =>
  `${f}:${nodes.get(f).getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
const imports = new Map();
for (const [f, node] of nodes) {
  const deps = [];
  node.forEachChild((n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
    const name = n.moduleSpecifier.text;
    if (name.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), name));
      const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.ts`].find((p) =>
        nodes.has(p),
      );
      if (resolved) deps.push(resolved);
    } else if (name.startsWith('@corridra/')) deps.push(name);
  });
  imports.set(f, deps);
}
function dependencies(f, seen = new Set()) {
  if (seen.has(f)) return seen;
  seen.add(f);
  for (const dep of imports.get(f) ?? []) dependencies(dep, seen);
  return seen;
}
const routes = files
  .filter(
    (f) => /^apps\/web\/app\/.+\/(page\.tsx|route\.ts)$/.test(f) || f === 'apps/web/app/page.tsx',
  )
  .map((file) => {
    const route =
      '/' + file.replace('apps/web/app/', '').replace(/(?:^|\/)(page\.tsx|route\.ts)$/, '');
    const access =
      route.startsWith('/api/workspace') || route === '/operator'
        ? 'Invited operator identity, current MFA and tenant membership; server permission and RLS checks'
        : /operator/.test(route)
          ? 'Public entry to invited operator authentication/setup; verified invitation, independent password and MFA, no anonymous membership creation'
          : /\/(client|programme|buyer)/.test(route) || route === '/api/delivery'
            ? 'Private capability, audience, publication, expiry/revocation and source rights'
            : /contributor|network\/tasks/.test(route)
              ? 'Invited identity and exact assignee/task/tenant disclosure; current MFA'
              : /account|customer-missions/.test(route)
                ? 'Customer identity and verified invitation; no implicit operator membership'
                : 'Public entry; auth and intake server validation where applicable';
    return {
      route,
      file,
      access,
      dependencies: [
        ...new Set([
          ...dependencies(file),
          ...(!route.startsWith('/api/') ? dependencies('apps/web/app/layout.tsx') : []),
        ]),
      ].sort(),
      status: 'NOT YET COVERED',
    };
  });
const tests = [];
const contracts = [];
const actions = [];
const surfaces = [];
for (const [file, root] of nodes) {
  const surface = {
    file,
    imports: imports.get(file),
    responseStates: [],
    dynamicCollections: [],
    strings: [],
    elements: {},
  };
  function visit(n) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(root);
      if (/\.map$/.test(callee) && file.startsWith('apps/web/'))
        surface.dynamicCollections.push({
          location: location(file, n),
          expression: compact(n.getText(root)),
        });
      if (/^(test|it)(\.|$)/.test(callee) && n.arguments[0] && ts.isStringLiteral(n.arguments[0]))
        tests.push({ id: location(file, n), name: n.arguments[0].text });
      if (['withTenant', 'authorize'].includes(callee) || /Response\.json|DomainError/.test(callee))
        contracts.push({ location: location(file, n), contract: compact(n.getText(root)) });
    }
    if (ts.isNewExpression(n) && n.expression.getText(root) === 'DomainError')
      surface.responseStates.push({
        location: location(file, n),
        expression: compact(n.getText(root)),
      });
    if (
      ts.isStringLiteral(n) &&
      /loading|unavailable|denied|expired|revoked|retry|empty|unknown|not configured|no .*yet|failed/i.test(
        n.text,
      )
    )
      surface.responseStates.push({ location: location(file, n), text: n.text });
    if (ts.isJsxText(n) && compact(n.text)) surface.strings.push(compact(n.text));
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(root);
      surface.elements[tag] = (surface.elements[tag] ?? 0) + 1;
      if (['form', 'button', 'a', 'Link', 'input', 'select', 'textarea', 'summary'].includes(tag)) {
        const whole = ts.isJsxOpeningElement(n) ? n.parent : n;
        const guards = [];
        for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
          if (ts.isConditionalExpression(p)) guards.push(compact(p.condition.getText(root)));
          if (
            ts.isBinaryExpression(p) &&
            p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          )
            guards.push(compact(p.left.getText(root)));
        }
        const bindings = n.attributes.properties.map((p) => compact(p.getText(root)));
        const reachable = routes.filter((r) => r.dependencies.includes(file)).map((r) => r.route);
        actions.push({
          id: location(file, n) + ':' + tag,
          file,
          routes: reachable,
          element: tag,
          label: compact(whole.getText(root)).slice(0, 400),
          bindings,
          visibilityConditions: guards,
          personaAndAccess: reachable.map((r) => routes.find((v) => v.route === r).access),
          apiAndDomainDependencies: [...dependencies(file)].filter(
            (d) => d.startsWith('@corridra/') || d.includes('/lib/'),
          ),
          responseStates: 'See sourceSurfaces entry; applicability requires runtime verification',
          plannedComponent: file.includes('/operator/')
            ? 'WorkspaceShell / RoleNavigation / retained domain panel'
            : file.includes('delivery')
              ? 'CapabilityScopeNotice / retained approved report'
              : 'PublicShell / access state / retained form',
          testIds: [],
          acceptance: 'NOT YET COVERED',
          evidence: [],
        });
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(root);
  if (file.startsWith('apps/web/')) surfaces.push(surface);
}
const domainVocabulary = [];
for (const [file, root] of nodes) {
  if (!file.startsWith('packages/')) continue;
  function visit(n) {
    if (ts.isCallExpression(n) && /z\.(enum|literal)$/.test(n.expression.getText(root)))
      domainVocabulary.push({ location: location(file, n), expression: compact(n.getText(root)) });
    ts.forEachChild(n, visit);
  }
  visit(root);
}
const endpoints = [];
for (const [file, root] of nodes) {
  if (!file.endsWith('/route.ts')) continue;
  function visit(n) {
    if (
      ts.isVariableDeclaration(n) &&
      ['read', 'writes'].includes(n.name.getText(root)) &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      for (const p of n.initializer.properties)
        endpoints.push({
          route: file,
          method: n.name.getText(root) === 'read' ? 'GET' : 'POST',
          action: p.name?.getText(root).replaceAll("'", ''),
          implementation: compact(p.getText(root)),
          location: location(file, p),
          acceptance: 'NOT YET COVERED',
        });
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      /action|method/.test(n.left.getText(root))
    )
      endpoints.push({
        route: file,
        branch: compact(n.getText(root)),
        location: location(file, n),
        acceptance: 'NOT YET COVERED',
      });
    ts.forEachChild(n, visit);
  }
  visit(root);
}
mkdirSync(outputDirectory, { recursive: true });
const verification = JSON.parse(readFileSync(`${outputDirectory}/verification.json`, 'utf8'));
const phase = verification.scope.match(/\bUX-(0[1-6])\b/)?.[1];
if (!phase) throw new Error('Verification scope must identify its UX-01 through UX-06 phase');
const coverage = {
  schemaVersion: 1,
  baselineRepository: 'sadat99/corridra',
  baselineCommitAudited: baseline,
  actualBaselineCommitAtExecution: baseline,
  allBaselineRoutesFound: true,
  allBaselineUserActionsFound: false,
  programmeRequirements: readFileSync('docs/ux10x/master-handoff.md', 'utf8')
    .split('\n')
    .filter((line) => /^\| [A-Z]\d{2} \|/.test(line))
    .map((line) => ({
      requirement: line,
      status: 'NOT YET COVERED',
      note: 'Programme acceptance is not implied by baseline preservation or UX-01 tests.',
    })),
  verification,
  records: [
    ...actions.map((a) => ({
      id: a.id,
      routeOrModule: a.routes.length ? a.routes.join(', ') : a.file,
      role: a.personaAndAccess,
      baselineAction: a.label,
      authoritativeApiOrDomain: a.apiAndDomainDependencies,
      redesignedLocation: a.plannedComponent,
      preservation: 'NOT_YET_VERIFIED',
      positiveTestIds: [],
      negativeTestIds: [],
      screenshots: [],
      notes:
        'Static control discovery; dynamic instances and runtime state coverage must be reconciled.',
    })),
    ...verification.tests.map((test, index) => ({
      id: `UX${phase}-SCENARIO-${index + 1}`,
      routeOrModule: test.baseline,
      role: 'Exact roles exercised by linked test; no inference for other roles',
      baselineAction: test.baseline,
      authoritativeApiOrDomain: 'Existing service endpoints; see test source',
      redesignedLocation: test.implementation,
      preservation:
        test.status === 'PASS'
          ? 'VERIFIED'
          : test.status === 'PARTIAL'
            ? 'PARTIAL'
            : 'NOT_YET_VERIFIED',
      positiveTestIds: [test.positive],
      negativeTestIds: [test.negative],
      screenshots: [test.evidence],
      notes: 'Bounded executed scenario only. Does not mark every control in this module verified.',
    })),
  ],
  baseline,
  method:
    'TypeScript AST over every tracked baseline app/package/test source. Source controls, not a claim of expanded runtime action coverage. Dynamic maps/options and external auth actions require manual/runtime reconciliation. No inferred test success.',
  routes,
  specialRouteFiles: files.filter(
    (f) => /^apps\/web\/app\//.test(f) && /\/(layout|error|loading|not-found)\.tsx$/.test(f),
  ),
  dynamicPublicPaths: ['bangladesh-china', 'bangladesh-spain', 'bangladesh-eu'].map(
    (s) => '/corridors/' + s,
  ),
  permissionDeclarations: [...nodes]
    .filter(([f]) => f === 'packages/domain/src/index.ts')
    .map(([f]) => ({ file: f, source: sources.get(f) })),
  domainVocabulary,
  actions,
  endpoints,
  contracts,
  testCatalogue: tests,
  sourceSurfaces: surfaces,
  unexpandedRuntimeCoverage: [
    'Dynamic action menus and repeated records',
    'Neon Auth external identity/email lifecycle',
    'All role × response-state combinations',
    'Shared layout reachability and runtime redirects',
    'Measured browser accessibility and performance',
  ],
};
writeFileSync(`${outputDirectory}/coverage.json`, JSON.stringify(coverage, null, 2) + '\n');
writeFileSync(
  `${outputDirectory}/inventory.md`,
  `# UX10X baseline inventory\n\nBaseline: \`${baseline}\`. Generated by \`node scripts/ux10x-inventory.mjs\`.\n\n${routes.length} filesystem routes, ${actions.length} source controls, ${endpoints.length} API dispatch/condition entries, ${tests.length} test declarations. These are static discovery counts, **not an exhaustive runtime action denominator**. Source-control rows remain conservative; bounded executed acceptance is linked separately in verification.json and this JSON verification field. No percentage of functional preservation is claimed.\n\nThe JSON retains control bindings, visibility expressions, local import reachability, domain dependencies, strings, element types, error expressions and permission-boundary calls. Dynamic controls need expansion and the test catalogue is not an assertion that a test covers a control.\n\n| Route | Source | Access | Status |\n| --- | --- | --- | --- |\n${routes.map((r) => `| \`${r.route}\` | \`${r.file}\` | ${r.access} | ${r.status} |`).join('\n')}\n\n## Identity and authority\n\nAnonymous; verified/unverified customer; scoped buyer/supplier/client/institution capability; independently invited contributor; owner/admin/operator/reviewer/viewer are separate access classes. Exact authoritative role mappings remain in packages/domain/src/index.ts and per-service withTenant checks. Configuration, current MFA, source rights, capability audience, revocation, expiry, independent review and RLS remain additional conditions. A visible tool is not permission.\n\n## Availability\n\nV1 1–8 and V2 1–5 are implemented. Mission operations remain synthetic. D01–D06 and D08, real outreach, live AI providers and contributor pilots remain externally gated; payments/payout execution is not implemented. Customer identity activation is a separate accepted baseline. No live gate was queried or modified by this collector.\n\n## Reconciliation limitations\n\nGate 0 discovery includes the generated inventory, immutable master handoff, baseline measurements and verification report. Exhaustive runtime action expansion is not claimed. Runtime action expansion, baseline screenshots, per-action positive/negative linkage, role/state verification and protected workflow execution are tracked separately. Original source documents and domain contracts are unchanged.\n`,
);
console.log(
  JSON.stringify({
    routes: routes.length,
    sourceControls: actions.length,
    endpointEntries: endpoints.length,
    tests: tests.length,
  }),
);
