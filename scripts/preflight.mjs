import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const NEEDLE_SKIP = ['page', 'route', 'layout', 'index', 'app', 'src'];

/**
 * Operator specs to run for a set of changed files: the changed specs themselves, plus every spec whose
 * text names a changed module or its folder. A name longer than 4 characters matches as a substring; a
 * shorter one (road, card, nav) matches only as a whole word, case-insensitive, so `road.tsx` selects a
 * spec that renders <Road> or the `.mr-road` class without `broad` or `railroad` selecting it.
 * `readSpec` returns a spec's text; `specs` are the file names found in the operator folder.
 */
export function selectOperatorSpecs(changed, specs, readSpec, dir = 'tests/operator') {
  const wanted = new Set(
    changed
      .filter((f) => f.startsWith(`${dir}/`) && f.endsWith('.spec.ts'))
      .map((f) => basename(f)),
  );
  const needles = changed
    .filter((f) => f.startsWith('apps/web/') || f.startsWith('packages/'))
    .flatMap((f) => [basename(f).replace(/\.[^.]+$/, ''), basename(dirname(f))])
    .filter((n) => n.length >= 3 && !NEEDLE_SKIP.includes(n));
  const matchers = needles.map((n) =>
    n.length > 4
      ? (text) => text.includes(n)
      : (text) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text),
  );
  for (const spec of specs) {
    const text = readSpec(spec);
    if (matchers.some((m) => m(text))) wanted.add(spec);
  }
  // The enrolment the zzz specs rely on comes from workspace.spec.ts in the same run.
  if ([...wanted].some((s) => s.startsWith('zzz-'))) wanted.add('workspace.spec.ts');
  return [...wanted].sort().map((s) => `${dir}/${s}`);
}

// Runs, on this machine, the checks CI would run, in the order that finds a failure soonest, so a
// push is expected to be green. Nothing here replaces CI: CI stays the proof for the exact head.
//
//   node scripts/preflight.mjs            quick checks, then build, affected tests, UX gate, e2e
//   node scripts/preflight.mjs quick      only the fast checks (about 2 minutes)
//   node scripts/preflight.mjs full       everything above plus the whole operator suite
//
// Needs the local PostgreSQL on port 54329 for the operator and integration steps (see KI-15) and
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH where the browser is not installed the usual way.
async function main() {
  const mode = process.argv[2] ?? 'standard';
  if (!['quick', 'standard', 'full'].includes(mode)) {
    console.error('Usage: node scripts/preflight.mjs [quick|standard|full]');
    process.exit(2);
  }

  const git = (args) => {
    try {
      return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const base = git(['merge-base', 'HEAD', 'origin/main']) || 'origin/main';
  const changed = [
    ...new Set(
      [git(['diff', '--name-only', base, 'HEAD']), git(['diff', '--name-only'])]
        .join('\n')
        .split('\n')
        .filter(Boolean),
    ),
  ];

  /** One verification command through the repository's gate runner (full log under work/). */
  function step(name, command) {
    return () =>
      new Promise((resolve) => {
        const started = Date.now();
        const child = spawn(
          process.execPath,
          ['scripts/gate.mjs', `pf-${name}`, '--tail', '14', '--', ...command],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (out += d));
        child.on('close', (code) => {
          const seconds = Math.round((Date.now() - started) / 1000);
          console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${seconds}s`);
          if (code !== 0) console.log(out.split('\n').slice(-22).join('\n'));
          resolve({ name, ok: code === 0, seconds });
        });
      });
  }

  /** Operator specs that name a changed file, a changed route folder, or are themselves changed. */
  function affectedOperatorSpecs() {
    const dir = 'tests/operator';
    if (!existsSync(dir)) return [];
    const specs = readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
    return selectOperatorSpecs(
      changed,
      specs,
      (spec) => readFileSync(join(dir, spec), 'utf8'),
      dir,
    );
  }

  const quick = [
    step('format', ['pnpm', 'format:check']),
    step('lint', ['pnpm', 'lint']),
    step('typecheck', ['pnpm', 'typecheck']),
    step('docs-tests', ['pnpm', 'test']),
    step('ledger', ['node', 'scripts/v3-context.mjs', 'verify']),
    // CI scans the whole history of the pull request, so a secret-looking line in any commit fails it even
    // if a later commit removes the line. This asks the same question of the commits this branch adds.
    // The scanner binary is downloaded by scripts/security-scan.mjs. A finding must fail this step: the
    // skip message is only for a missing scanner (an earlier `a && b || echo` form swallowed findings).
    step('security-scan', [
      'sh',
      '-c',
      `node scripts/security-scan.mjs 2>&1 >/dev/null | grep -m1 'could not be completed' >&2; if [ -x .cache/security/gitleaks ]; then .cache/security/gitleaks git . --redact=100 --no-banner --log-opts='${base}..HEAD'; else echo 'scanner unavailable, skipped'; fi`,
    ]),
  ];

  const results = [];
  const run = async (steps) => {
    for (const s of steps) results.push(await s());
  };

  console.log(`preflight ${mode}: ${changed.length} changed files against ${base.slice(0, 7)}`);
  await run(quick);
  if (mode !== 'quick' && results.every((r) => r.ok)) {
    await run([
      step('integration-changed', ['pnpm', 'exec', 'vitest', 'run', '--changed', base]),
      step('build', ['pnpm', 'build']),
    ]);
    if (results.every((r) => r.ok)) {
      const specs = mode === 'full' ? [] : affectedOperatorSpecs();
      const operator =
        mode === 'full'
          ? step('operator-all', ['pnpm', 'test:operator'])
          : specs.length
            ? step('operator-affected', [
                'pnpm',
                'exec',
                'playwright',
                'test',
                '--config',
                'playwright.operator.config.ts',
                ...specs,
              ])
            : null;
      // The browser lane and the operator lane use different ports and can run side by side.
      const lanes = [
        (async () => {
          results.push(await step('e2e', ['pnpm', 'test:e2e'])());
          results.push(await step('ux-gate', ['pnpm', 'test:ux'])());
        })(),
        operator ? operator().then((r) => results.push(r)) : Promise.resolve(),
      ];
      await Promise.all(lanes);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length
      ? `\nNOT READY: ${failed.map((r) => r.name).join(', ')} (full logs in work/pf-*.log)`
      : '\nREADY TO PUSH: every local check passed. CI remains the proof for the exact head.',
  );
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
