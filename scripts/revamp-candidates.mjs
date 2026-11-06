#!/usr/bin/env node
// Wave 7 K-01: candidate report only. Builds a usage graph of the tracked source tree (code, CSS files and CSS
// selectors, assets, scripts, test helpers) and writes docs/revamp/wave-7/candidates.json.
// Nothing is deleted or changed. Every entry carries approval: null until the Guardian marks it (K-02).
//
//   node scripts/revamp-candidates.mjs [outFile]
//
// Method (recorded in the report): `git ls-files` at HEAD is the universe. A file is referenced when another tracked
// file names it as an import specifier, a path, a CSS import, a URL or a package script. Framework and tool
// conventions (Next route files, tool configs, test files, workflows) are loaded by name and are KEEP. A CSS selector
// is referenced when its class name appears as a token in any tracked non-CSS source file. Documentation mentions are
// recorded but do not keep a file alive. Dynamic names (template strings with a stem) are listed as `dynamicPrefix`
// and make a selector KEEP-by-prefix instead of REVIEW.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] ?? 'docs/revamp/wave-7/candidates.json';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// The baseline is the main commit the scan ran on, so each recovery step points at a commit that stays reachable.
const head = git('merge-base', 'HEAD', 'origin/main').trim();
const files = git('ls-files').trim().split('\n');

const never = [
  /^docs\/source\//,
  /^docs\/v3\/history\//,
  /^docs\/adr\//,
  /^docs\/qa\//,
  /^docs\/design-system\/evidence\//,
  /^docs\/revamp\/CONTRACT\.md$/,
  /^packages\/db\/.*migrations/,
  /\.sql$/,
  /^docs\/v3\/phase-0\/requirements\.json$/,
];
const isNever = (p) => never.some((r) => r.test(p));

// Text corpus. Logs and evidence are excluded: they quote paths without using them.
const textExt = /\.(ts|tsx|mjs|js|cjs|json|md|css|yml|yaml|sh|html|txt|toml)$/;
const corpus = new Map();
for (const f of files) {
  if (!textExt.test(f) || /\.log$/.test(f) || /(^|\/)(evidence|node_modules)\//.test(f)) continue;
  if (/^docs\/(qa|v3\/history|source)\//.test(f)) continue;
  try {
    const t = readFileSync(f, 'utf8');
    if (t.length < 4_000_000) corpus.set(f, t);
  } catch {
    /* binary or unreadable */
  }
}
const isDoc = (f) => /^docs\//.test(f) || /\.md$/.test(f);
const isTest = (f) => /^tests\//.test(f);
const codeCorpus = [...corpus].filter(([f]) => !isDoc(f));

// ---- Universe ----------------------------------------------------------------------------------------------
const codeExt = /\.(ts|tsx|mjs|js)$/;
const assetExt = /\.(png|jpe?g|svg|ico|webp|gif|woff2?|ttf|otf|mp4|pdf)$/;
const universe = files.filter((f) => {
  if (isNever(f)) return false;
  if (/\.(test|spec)\.(ts|tsx|mjs|js)$/.test(f)) return false;
  if (/^apps\/web\/.*\.(ts|tsx|mjs|js|css)$/.test(f)) return !/\.d\.ts$/.test(f);
  if (/^apps\/web\/(public|app|components)\/.*/.test(f) && assetExt.test(f)) return true;
  if (/^apps\//.test(f) && assetExt.test(f)) return true;
  if (/^packages\/.*\.(ts|tsx|mjs|js|css)$/.test(f)) return !/\.d\.ts$/.test(f);
  if (/^scripts\//.test(f) && /\.(ts|mjs|js|sh|py)$/.test(f)) return true;
  if (/^tests\/.*\.(ts|tsx|mjs|js)$/.test(f)) return true;
  return false;
});

// ---- Loaded by convention ----------------------------------------------------------------------------------
const nextConvention =
  /(^|\/)(page|layout|route|loading|error|global-error|not-found|default|template|middleware|proxy|instrumentation|instrumentation-client|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(ts|tsx|js)$/;
const toolConfig =
  /(^|\/)(next\.config|eslint\.config|vitest\.config|vitest\.workspace|playwright[\w.-]*\.config|tsconfig[\w.-]*|postcss\.config|tailwind\.config|prettier\.config)\.(ts|mjs|js|json)$/;
const nextEnv = /(^|\/)next-env\.d\.ts$/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stemOf = (f) => {
  const base = f
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '');
  return base === 'index' ? f.split('/').slice(-2, -1)[0] : base;
};

function references(path) {
  const stem = stemOf(path);
  const base = path.split('/').pop();
  const ext = (base.match(/\.[^.]+$/) ?? [''])[0];
  // Import specifier or path ending: a quote or slash, the stem, an optional extension, a closing quote.
  const specifier = new RegExp(`(?:^|[/'"\`])${esc(stem)}(?:\\.(?:tsx?|mjs|js|css))?['"\`]`);
  const fullPath = new RegExp(`(?:^|[^\\w/.-])${esc(path)}(?![\\w-])`);
  const asset = new RegExp(`${esc(base)}(?![\\w-])`);
  const code = [];
  const docs = [];
  const test = [];
  const looks = (text) =>
    codeExt.test(path) || ext === '.css'
      ? specifier.test(text) || fullPath.test(text)
      : /\.(sh|py)$/.test(path)
        ? fullPath.test(text) || asset.test(text)
        : asset.test(text) || fullPath.test(text);
  for (const [f, t] of corpus) {
    if (f === path) continue;
    if (!t.includes(stem) && !t.includes(base)) continue;
    if (!looks(t)) continue;
    (isDoc(f) ? docs : isTest(f) ? test : code).push(f);
  }
  return { code, docs, test };
}

// package.json scripts and workflow files count as code references for a script by file name; references() covers
// them because both are in the corpus.

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const lastCommit = (p) => git('log', '-1', '--format=%H', '--', p).trim();

const entries = [];
const counts = { KEEP: 0, REVIEW: 0 };
function add(e) {
  counts[e.classification] += 1;
  entries.push({ ...e, approval: null });
}
const recovery = (p) => `git checkout ${head.slice(0, 12)} -- ${p}`;

for (const path of universe) {
  const conv = nextConvention.test(path) || toolConfig.test(path) || nextEnv.test(path);
  const r = references(path);
  const kind = /\.css$/.test(path)
    ? 'css'
    : assetExt.test(path)
      ? 'asset'
      : /^scripts\//.test(path)
        ? 'script'
        : /^tests\//.test(path)
          ? 'test-helper'
          : 'code';
  const live = r.code.length + r.test.length;
  if (conv) continue; // loaded by name; not a candidate
  if (live > 0) continue; // referenced; not a candidate
  const stat = readFileSync(path);
  const entry = {
    path,
    kind,
    classification: 'REVIEW',
    reason:
      r.docs.length > 0
        ? 'no importer, path or URL reference in code or tests; named only in documentation'
        : 'no importer, path or URL reference anywhere in the tracked tree',
    incomingReferences: {
      importers: 0,
      code: r.code,
      tests: r.test,
      documentation: r.docs,
    },
    replacement: null,
    recovery: recovery(path),
    proof: {
      sha256: sha(path),
      bytes: stat.length,
      lastCommit: lastCommit(path),
      method: 'full-tree reference scan at ' + head.slice(0, 12),
    },
  };
  // A script that documentation names by its path is a documented operator tool: kept, with the documents listed.
  if (kind === 'script' && r.docs.some((d) => corpus.get(d).includes(path))) {
    entry.classification = 'KEEP';
    entry.reason =
      'KEEP: documented operator or agent tool, named by path in ' + r.docs.length + ' document(s)';
  }
  // Known tool entry points are kept, not proposed: files run by path from the CLI or loaded by a tool by name.
  if (
    kind === 'script' &&
    /^scripts\/(preflight|gate|authority|authority-tools|context-tools|v3-context|v3-inventory|v3-register|v3-preservation-check|revamp-manifest|revamp-candidates|local-database|prepare-local|security-scan)\./.test(
      path,
    )
  ) {
    entry.classification = 'KEEP';
    entry.reason = 'KEEP: operator or agent CLI run by path or imported by a sibling tool';
  }
  add(entry);
}

// ---- CSS selectors -----------------------------------------------------------------------------------------
const cssFiles = files.filter((f) => /^apps\/web\/.*\.css$/.test(f) && !isNever(f));
const sourceText = codeCorpus.filter(([f]) => !/\.css$/.test(f) && !isTest(f));
const testText = codeCorpus.filter(([f]) => !/\.css$/.test(f) && isTest(f));
const joinedSource = sourceText.map(([, t]) => t).join('\n');
const joinedTests = testText.map(([, t]) => t).join('\n');
// Template-string prefixes such as `ux-badge-${tone}` make every class starting with the prefix possibly live.
const dynamicPrefixes = new Set(
  [...joinedSource.matchAll(/([a-z][\w-]*-)\$\{/g)].map((m) => m[1]).filter((p) => p.length >= 4),
);
const tokenRe = (name) => new RegExp(`(?<![\\w-])${esc(name)}(?![\\w-])`);
const selectorPrelude = (css) => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '');
  const classes = new Set();
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    for (const c of prelude.matchAll(/(?<![\w\d)\]-])\.([a-zA-Z_][\w-]+)/g)) classes.add(c[1]);
  }
  return [...classes];
};
const cssSummary = [];
for (const path of cssFiles) {
  const text = readFileSync(path, 'utf8');
  const classes = selectorPrelude(text);
  const unreferenced = [];
  const testOnly = [];
  const dynamic = [];
  for (const c of classes) {
    if (tokenRe(c).test(joinedSource)) continue;
    const prefix = [...dynamicPrefixes].find((p) => c.startsWith(p));
    if (prefix) {
      dynamic.push(c);
      continue;
    }
    if (tokenRe(c).test(joinedTests)) testOnly.push(c);
    else unreferenced.push(c);
  }
  cssSummary.push({ path, classes: classes.length });
  if (unreferenced.length === 0 && testOnly.length === 0) continue;
  add({
    path,
    kind: 'css-selectors',
    classification: 'REVIEW',
    reason: `${unreferenced.length} class selector(s) named in no tracked source file${testOnly.length ? ` and ${testOnly.length} named only by tests` : ''}; the file itself is ${entries.some((e) => e.path === path) ? 'also unreferenced' : 'imported'}`,
    selectors: { unreferenced, testOnly, dynamicPrefixKept: dynamic.length },
    incomingReferences: {
      importers: references(path).code.length,
      code: references(path).code,
      tests: [],
      documentation: references(path).docs.slice(0, 10),
    },
    replacement: null,
    recovery: recovery(path),
    proof: {
      sha256: sha(path),
      bytes: Buffer.byteLength(text),
      lastCommit: lastCommit(path),
      method:
        'class tokens from rule preludes (comments and url() removed) searched across tracked non-CSS source; dynamic prefixes: ' +
        dynamicPrefixes.size,
    },
  });
}

// ---- package.json scripts ----------------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scriptNames = Object.keys(pkg.scripts ?? {});
const workflowText = [...corpus]
  .filter(([f]) => f.startsWith('.github/') || f === 'package.json')
  .map(([, t]) => t)
  .join('\n');
for (const name of scriptNames) {
  const used = new RegExp(
    `(?:pnpm|npm run|yarn)(?: run)?(?: -w[^ ]*)? ${esc(name)}(?![\\w:-])`,
  ).test(
    workflowText +
      '\n' +
      [...corpus]
        .filter(
          ([f]) =>
            /^(scripts|tests|\.claude|docs\/(agents|v3|revamp))\//.test(f) ||
            f === 'CLAUDE.md' ||
            f === 'AGENTS.md',
        )
        .map(([, t]) => t)
        .join('\n'),
  );
  const internal = Object.entries(pkg.scripts).some(
    ([k, v]) =>
      k !== name && new RegExp(`(?:pnpm|npm run)(?: run)? ${esc(name)}(?![\\w:-])`).test(v),
  );
  if (used || internal || /^(pre|post)/.test(name)) continue;
  const standard = /^(dev|start|build|test|lint|format|check|typecheck)(:|$)/.test(name);
  add({
    path: `package.json#scripts.${name}`,
    kind: 'package-script',
    classification: standard ? 'KEEP' : 'REVIEW',
    reason: standard
      ? 'KEEP: standard developer entry point, run by hand'
      : 'a package script no workflow, other script, test or agent document runs by name',
    incomingReferences: { importers: 0, code: [], tests: [], documentation: [] },
    replacement: null,
    recovery: `git checkout ${head.slice(0, 12)} -- package.json`,
    proof: {
      sha256: sha('package.json'),
      bytes: Buffer.byteLength(pkg.scripts[name]),
      lastCommit: lastCommit('package.json'),
      method:
        'script name searched in workflows, package scripts, scripts/, tests/, agent and process docs',
    },
  });
}

entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
const report = {
  schemaVersion: 1,
  wave: 7,
  step: 'K-01',
  purpose:
    'Candidate report only. Nothing is deleted or changed by this report. Each entry needs the Guardian marking (K-02: KEEP, CONSOLIDATE or DELETE-AFTER-PROOF in docs/revamp/CLEANUP-MANIFEST.json) and an independent adversarial review before any deletion PR (K-03). approval stays null here.',
  baseline: head,
  generatedBy: 'node scripts/revamp-candidates.mjs',
  neverCandidates: never.map((r) => String(r)),
  method: {
    universe:
      'git ls-files at the baseline: apps/web code, CSS and assets, packages code, scripts, and test helpers (not *.test/*.spec files, not migrations, not the never-touched trees)',
    referenced:
      'an import specifier, a path, a CSS import, an asset or URL name, or a package script named in another tracked file; test references count as live use',
    loadedByName:
      'Next route and metadata files, tool configs and type declarations are loaded by convention and are not candidates',
    documentation: 'documentation mentions are recorded but do not keep a file alive',
    css: 'class selectors from rule preludes, searched as whole tokens in tracked non-CSS source; template-string prefixes keep a class by prefix',
    limits:
      'runtime flags, deep-link aliases and privacy links are covered by route coverage (scripts/revamp-manifest.mjs, 127 routes, 0 unmapped); this report does not infer anything from string-built paths other than the template-string prefixes it lists',
  },
  totals: {
    scanned: universe.length,
    cssFiles: cssFiles.length,
    dynamicPrefixes: [...dynamicPrefixes].sort(),
    ...counts,
    byKind: entries.reduce((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {}),
  },
  entries,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(
  `wrote ${out}: ${entries.length} entries`,
  JSON.stringify(report.totals.byKind),
  JSON.stringify(counts),
);
if (!existsSync(out)) process.exit(1);
