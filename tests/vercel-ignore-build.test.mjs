import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The Ignored Build Step skips only previews it can prove carry no application change.
// Exit 0 skips the build; any other exit builds. Every uncertain case must build.
const script = resolve('scripts/vercel-ignore-build.sh');
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-build-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'apps'));
  writeFileSync(join(dir, 'docs/a.md'), 'a\n');
  writeFileSync(join(dir, 'apps/app.ts'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  const commit = (file, message) => {
    writeFileSync(join(dir, file), Math.random() + '\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', message);
    return git(dir, 'rev-parse', 'HEAD');
  };
  return { dir, base, commit };
}
function run(dir, env) {
  const result = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
  return { code: result.status, out: result.stdout };
}

test('a documentation-only change since the last built commit is skipped', () => {
  const r = repo();
  try {
    r.commit('docs/a.md', 'docs only');
    r.commit('docs/b.md', 'more docs');
    const result = run(r.dir, {
      VERCEL_ENV: 'preview',
      VERCEL_GIT_PREVIOUS_SHA: r.base,
      VERCEL_GIT_COMMIT_REF: 'feat/x',
    });
    assert.equal(result.code, 0);
    assert.match(result.out, /skip: documentation-only/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('any application or test change builds, even when earlier commits were documentation', () => {
  const r = repo();
  try {
    r.commit('docs/a.md', 'docs');
    r.commit('apps/app.ts', 'code');
    r.commit('docs/c.md', 'docs again');
    const result = run(r.dir, {
      VERCEL_ENV: 'preview',
      VERCEL_GIT_PREVIOUS_SHA: r.base,
      VERCEL_GIT_COMMIT_REF: 'feat/x',
    });
    assert.equal(result.code, 1);
    assert.match(result.out, /apps\/app\.ts/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('production deployments are never skipped, even for a documentation-only change', () => {
  const r = repo();
  try {
    r.commit('docs/a.md', 'docs');
    assert.equal(
      run(r.dir, {
        VERCEL_ENV: 'production',
        VERCEL_GIT_PREVIOUS_SHA: r.base,
        VERCEL_GIT_COMMIT_REF: 'main',
      }).code,
      1,
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('Dependabot branches are skipped without reading git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-build-none-'));
  try {
    assert.equal(
      run(dir, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'dependabot/npm_and_yarn/x' }).code,
      0,
    );
    assert.equal(
      run(dir, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'dependabot/npm_and_yarn/x' })
        .code,
      1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anything uncertain builds: no previous commit, unknown commit, empty diff or not a git repository', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'ignore-build-outside-'));
  try {
    const head = r.commit('docs/a.md', 'docs');
    const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' };
    assert.equal(run(r.dir, preview).code, 1);
    assert.equal(run(r.dir, { ...preview, VERCEL_GIT_PREVIOUS_SHA: 'deadbeef'.repeat(5) }).code, 1);
    assert.equal(run(r.dir, { ...preview, VERCEL_GIT_PREVIOUS_SHA: head }).code, 1);
    assert.equal(run(outside, { ...preview, VERCEL_GIT_PREVIOUS_SHA: r.base }).code, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
