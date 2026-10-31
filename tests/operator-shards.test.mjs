import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { parse } from 'yaml';

// CI splits the operator browser tests into the shards ci.yml lists. Playwright gives each shard
// whole files, and each shard starts on a fresh database, so a spec that reads a .cache file another
// spec writes must run in the writer's shard, after it. Listing needs no build, server or browser.
const shards = parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.operator.strategy.matrix
  .shard;
const specs = readdirSync('tests/operator')
  .filter((name) => name.endsWith('.spec.ts'))
  .sort();

// Loading the specs reads the local database settings in .cache (tests/integration/support.ts),
// which only `pnpm db:local` writes and the CI checks job does not have. So list from a scratch
// folder that links to every repository entry except .cache and holds an empty stand-in there.
// Listing runs no test, so nothing uses it, and the real .cache is never read or touched. Playwright
// is started directly: pnpm run from the scratch folder would rebuild the real node_modules.
const root = process.cwd();
const listingRoot = mkdtempSync(join(tmpdir(), 'operator-shards-'));
for (const entry of readdirSync(root))
  if (entry !== '.cache') symlinkSync(join(root, entry), join(listingRoot, entry));
mkdirSync(join(listingRoot, '.cache'));
writeFileSync(join(listingRoot, '.cache/part03-local.json'), '{}');
after(() => rmSync(listingRoot, { recursive: true, force: true }));

function filesInShard(shard) {
  const listing = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config',
      join(root, 'playwright.operator.config.ts'),
      '--list',
      '--reporter=json',
      `--shard=${shard}/${shards.length}`,
    ],
    { cwd: listingRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(listing.status, 0, `listing shard ${shard} failed: ${listing.stderr}`);
  const report = JSON.parse(listing.stdout);
  assert.deepEqual(report.errors, [], `listing shard ${shard} must not report errors`);
  return report.suites.map((suite) => suite.file);
}

// One listing per shard, one after another, shared by the tests below.
let placement;
function shardPlacement() {
  if (placement) return placement;
  const where = new Map();
  for (const shard of shards)
    filesInShard(shard).forEach((file, order) => {
      assert.ok(!where.has(file), `${file} is listed in more than one shard`);
      where.set(file, { shard, order });
    });
  placement = where;
  return placement;
}

function cacheFiles(source, call) {
  const pattern = new RegExp(`${call}(?:Sync)?\\(\\s*['"\`](\\.cache/[^'"\`]+\\.json)['"\`]`, 'g');
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

test('ci.yml numbers the operator shards 1 to N', () => {
  assert.ok(shards.length > 0, 'the operator job must list its shards');
  assert.deepEqual(
    shards,
    Array.from({ length: shards.length }, (_, index) => index + 1),
  );
});

test('every operator spec runs in exactly one shard', () => {
  const where = shardPlacement();
  assert.deepEqual([...where.keys()].sort(), specs);
});

test('a spec that reads a cache file another spec writes runs after it in the same shard', () => {
  const where = shardPlacement();
  const sources = new Map(
    specs.map((file) => [file, readFileSync(`tests/operator/${file}`, 'utf8')]),
  );
  for (const [writer, writerSource] of sources)
    for (const path of cacheFiles(writerSource, 'writeFile'))
      for (const [reader, readerSource] of sources) {
        if (reader === writer || !cacheFiles(readerSource, 'readFile').has(path)) continue;
        const written = where.get(writer);
        const read = where.get(reader);
        assert.ok(
          read.shard === written.shard && read.order > written.order,
          `${reader} (shard ${read.shard}) reads ${path}, which ${writer} (shard ${written.shard}) writes; it must run after it in the same shard`,
        );
      }
});
