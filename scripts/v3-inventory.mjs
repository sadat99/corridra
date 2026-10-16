import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

// Always collect the immutable pre-V3 revision. Never infer runtime acceptance.
const baseline = process.argv[2] ?? 'e9ed2e53d97f543c30bace29d9ef38d568a65236';
const output = process.argv[3] ?? 'docs/v3/phase-0';
const scratch = '.cache/v3-inventory';
mkdirSync(scratch, { recursive: true });
mkdirSync(output, { recursive: true });
writeFileSync(
  `${scratch}/verification.json`,
  JSON.stringify({
    scope:
      'UX-06 collector reused only for V3 static discovery; no historical acceptance inherited',
    tests: [],
  }),
);
execFileSync('node', ['scripts/ux10x-inventory.mjs', baseline, scratch], { stdio: 'pipe' });
const old = JSON.parse(readFileSync(`${scratch}/coverage.json`, 'utf8'));
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { encoding: 'utf8' })
  .trim()
  .split('\n');
const source = (file) =>
  execFileSync('git', ['show', `${baseline}:${file}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
const hashes = files
  .filter((f) => /^packages\/db\/migrations\/.*\.sql$/.test(f) || f.startsWith('docs/source/'))
  .map((file) => ({
    file,
    sha256: createHash('sha256').update(source(file)).digest('hex'),
  }));
const domain = source('packages/domain/src/index.ts');
const commands = [];
const collections = [];
for (const file of files.filter(
  (f) => /^(packages|apps\/web)\//.test(f) && /\.(ts|tsx)$/.test(f),
)) {
  const text = source(file);
  const root = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    const line = root.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (ts.isMethodDeclaration(node) && node.name)
      commands.push({
        id: `${file}:${line}:${node.name.getText(root)}`,
        file,
        line,
        name: node.name.getText(root),
        status: 'NOT VERIFIED',
        nextAction:
          'Retain service contract; link positive and denial runtime evidence before replacement.',
      });
    // Expand literal-driven maps into explicit options; other maps stay unresolved.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'map'
    ) {
      const receiver = node.expression.expression;
      let array = ts.isArrayLiteralExpression(receiver) ? receiver : undefined;
      if (ts.isIdentifier(receiver)) {
        for (const statement of root.statements)
          if (ts.isVariableStatement(statement))
            for (const declaration of statement.declarationList.declarations) {
              if (
                declaration.name.getText(root) === receiver.text &&
                declaration.initializer &&
                ts.isArrayLiteralExpression(declaration.initializer)
              )
                array = declaration.initializer;
            }
      }
      collections.push({
        id: `${file}:${line}:map`,
        expression: receiver.getText(root),
        options: array?.elements.map((e) => e.getText(root)) ?? [],
        status: 'NOT VERIFIED',
        expanded: Boolean(array),
        nextAction:
          'Exercise each role and applicable response state; data-dependent instances remain unbounded.',
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
}
const destination = (file) => {
  if (/operator/.test(file))
    return '/operator: retained expert controls, contextual grouping in Phase 1';
  if (/plan|intake/.test(file)) return '/plan: guided objective entry, same admission boundary';
  if (/programme/.test(file)) return '/programme: Delegation OS scoped programme view';
  if (/client/.test(file)) return '/client: private mission, evidence and commercial progress';
  if (/buyer/.test(file)) return '/buyer: scoped recipient response';
  if (/contributor|network/.test(file)) return '/contributor: exact assigned tasks';
  return 'Retain original URL; contextual V3 entry must preserve this action';
};
const inventory = {
  schemaVersion: 1,
  baseline,
  method:
    'TypeScript AST collector plus service methods, literal map expansion and immutable hashes. Static reachability is not functional verification. No historical test pass inherited.',
  routes: old.routes,
  actions: old.actions.map((a) => ({
    ...a,
    status: 'NOT VERIFIED',
    destination: destination(a.file),
    nextAction:
      'Preserve original path; verify binding, role and applicable states before replacement.',
  })),
  endpoints: old.endpoints,
  commands,
  dynamicCollections: collections,
  domainStates: old.domainVocabulary,
  permissionBoundaries: old.contracts,
  rolesAndPermissions: { file: 'packages/domain/src/index.ts', declaration: domain },
  components: files.filter((f) => f.startsWith('apps/web/') && f.endsWith('.tsx')),
  tests: old.testCatalogue,
  sourceSurfaces: old.sourceSurfaces,
  migrations: hashes.filter((h) => h.file.endsWith('.sql')),
  immutableSources: hashes.filter((h) => !h.file.endsWith('.sql')),
  unresolved: old.unexpandedRuntimeCoverage,
};
writeFileSync(`${output}/inventory.json`, JSON.stringify(inventory, null, 2) + '\n');
const historical = ['docs/ux10x/coverage.json', 'docs/ux10x/ux06/coverage.json'];
const reconciliation = historical.map((file) => {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const current = new Set(inventory.actions.map((a) => a.id));
  return {
    file,
    baseline: data.baseline,
    historicalActions: data.actions?.length ?? 0,
    currentActions: inventory.actions.length,
    exactLocationsRetained: (data.actions ?? []).filter((a) => current.has(a.id)).length,
    note: 'Location changes do not establish loss; no historical acceptance transferred. Reconcile bindings and runtime instances before retiring any control.',
  };
});
writeFileSync(`${output}/reconciliation.json`, JSON.stringify(reconciliation, null, 2) + '\n');
console.log(
  JSON.stringify({
    baseline,
    routes: inventory.routes.length,
    controls: inventory.actions.length,
    endpoints: inventory.endpoints.length,
    commands: commands.length,
    dynamicCollections: collections.length,
    expandedLiteralCollections: collections.filter((c) => c.expanded).length,
    states: inventory.domainStates.length,
    tests: inventory.tests.length,
    migrations: inventory.migrations.length,
    unresolvedRuntimeCoverage: true,
  }),
);
