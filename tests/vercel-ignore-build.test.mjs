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
  const origin = mkdtempSync(join(tmpdir(), 'ignore-build-origin-'));
  git(origin, 'init', '-q', '--bare');
  const connect = () => {
    git(dir, 'remote', 'add', 'origin', origin);
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  };
  const commit = (file, message) => {
    writeFileSync(join(dir, file), Math.random() + '\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', message);
    return git(dir, 'rev-parse', 'HEAD');
  };
  return { dir, base, commit, origin, connect };
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
    rmSync(r.origin, { recursive: true, force: true });
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
    rmSync(r.origin, { recursive: true, force: true });
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
    rmSync(r.origin, { recursive: true, force: true });
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

test('anything uncertain builds: no comparison point, unknown commit with no remote, or not a git repository', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'ignore-build-outside-'));
  try {
    r.commit('docs/a.md', 'docs');
    const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' };
    assert.equal(run(r.dir, preview).code, 1);
    assert.match(run(r.dir, preview).out, /no usable comparison commit \(previous sha unset\)/);
    assert.equal(run(r.dir, { ...preview, VERCEL_GIT_PREVIOUS_SHA: 'deadbeef'.repeat(5) }).code, 1);
    assert.equal(run(outside, { ...preview, VERCEL_GIT_PREVIOUS_SHA: r.base }).code, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(r.origin, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('content identical to the last built commit is skipped because that build already exists', () => {
  const r = repo();
  try {
    const head = r.commit('docs/a.md', 'docs');
    const result = run(r.dir, {
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'feat/x',
      VERCEL_GIT_PREVIOUS_SHA: head,
    });
    assert.equal(result.code, 0);
    assert.match(result.out, /no file differs/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(r.origin, { recursive: true, force: true });
  }
});

test('without a usable previous commit the branch is compared with main: documentation-only skips, code builds', () => {
  const r = repo();
  try {
    r.connect();
    const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' };
    r.commit('docs/a.md', 'docs');
    r.commit('docs/b.md', 'more docs');
    const docs = run(r.dir, preview);
    assert.equal(docs.code, 0);
    assert.match(docs.out, /documentation-only change since main/);
    r.commit('apps/app.ts', 'code');
    const code = run(r.dir, preview);
    assert.equal(code.code, 1);
    assert.match(code.out, /apps\/app\.ts \(compared with main\)/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(r.origin, { recursive: true, force: true });
  }
});

test('a previous commit missing from a shallow clone is fetched by SHA and compared tree to tree', () => {
  const r = repo();
  try {
    r.connect();
    const built = r.commit('docs/a.md', 'docs built earlier');
    git(r.dir, 'push', '-q', 'origin', 'HEAD:refs/heads/built');
    git(r.dir, 'reset', '-q', '--hard', r.base);
    git(r.dir, 'reflog', 'expire', '--expire=now', '--all');
    git(r.dir, 'gc', '-q', '--prune=now');
    r.commit('docs/c.md', 'docs since');
    const preview = {
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'feat/x',
      VERCEL_GIT_PREVIOUS_SHA: built,
    };
    const docs = run(r.dir, preview);
    assert.equal(docs.code, 0);
    assert.match(docs.out, /documentation-only change since the last built commit/);
    r.commit('apps/app.ts', 'code');
    assert.equal(run(r.dir, preview).code, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(r.origin, { recursive: true, force: true });
  }
});
