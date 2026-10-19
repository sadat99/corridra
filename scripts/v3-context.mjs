import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Read-only context/navigation helper. Never regenerates execution memory.
const budget = 12 * 1024;
const read = (path) => readFileSync(path, 'utf8');
const sha = (value) => createHash('sha256').update(value).digest('hex');
function main() {
  const manifest = JSON.parse(read('docs/v3/history/manifest.json'));
  const [command = 'status', ...args] = process.argv.slice(2);
  let output;
  if (command === 'status') {
    assert.equal(args.length, 0, 'Usage: node scripts/v3-context.mjs status');
    output = read('docs/V3_LEDGER.md');
  } else if (command === 'requirement') {
    assert.ok(args.length, 'Usage: node scripts/v3-context.mjs requirement V3-02-046');
    const rows = JSON.parse(read(manifest.requirements));
    const selected = args.map((id) => {
      const row = rows.find((item) => item.id === id);
      assert.ok(row, `Unknown requirement: ${id}`);
      return row;
    });
    output = JSON.stringify(selected, null, 2);
  } else if (command === 'chunk') {
    assert.ok(
      args.length === 1 && /^\d+$/.test(args[0]),
      'Usage: node scripts/v3-context.mjs chunk 109',
    );
    const heading = new RegExp(`^## Chunk${Number(args[0])}(?=:|\\s|$).*`, 'm');
    for (const source of [
      'docs/V3_LEDGER.md',
      manifest.archive,
      ...(manifest.additionalArchives ?? [])
        .filter((entry) => entry.kind === 'ledger-chunks')
        .map((entry) => entry.archive),
    ]) {
      const text = read(source);
      const match = heading.exec(text);
      if (!match) continue;
      const next = text.indexOf('\n## ', match.index + match[0].length);
      output = text.slice(match.index, next < 0 ? undefined : next).trim();
      break;
    }
    assert.ok(output, `Unknown chunk: ${args[0]}`);
  } else if (command === 'verify') {
    assert.equal(args.length, 0, 'Usage: node scripts/v3-context.mjs verify');
    const archive = readFileSync(manifest.archive);
    assert.equal(archive.length, manifest.archiveBytes, 'Historical archive byte count changed');
    assert.equal(sha(archive), manifest.archiveSha256, 'Historical archive changed');
    for (const entry of manifest.additionalArchives ?? []) {
      const bytes = readFileSync(entry.archive);
      assert.equal(bytes.length, entry.bytes, `Historical guide size changed: ${entry.sourcePath}`);
      assert.equal(sha(bytes), entry.sha256, `Historical guide changed: ${entry.sourcePath}`);
    }
    assert.equal(
      sha(readFileSync(manifest.contract)),
      manifest.contractSha256,
      'Contract changed; review the amendment',
    );
    assert.equal(
      sha(readFileSync(manifest.productVision)),
      manifest.productVisionSha256,
      'Product vision changed; review the amendment',
    );
    const guides = {
      'CLAUDE.md': 2000,
      'docs/START_HERE.md': 6500,
      'docs/agents/README.md': 4000,
      'docs/agents/master-plan.md': 2000,
      'docs/implementation/current-plan.md': 6000,
      'docs/v3/STATUS.md': 1800,
    };
    for (const [path, limit] of Object.entries(guides)) {
      const text = read(path);
      assert.ok(
        Buffer.byteLength(text) <= limit,
        `Current guide exceeds its context budget: ${path}`,
      );
      assert.ok(
        text.includes(path === 'CLAUDE.md' ? 'docs/START_HERE.md' : 'V3_LEDGER.md'),
        `Current guide lost its shared entry/state link: ${path}`,
      );
      assert.ok(
        !/\b(?:dpl_[A-Za-z0-9]+|[a-f0-9]{40})\b/.test(text),
        `Put live release metadata only in the ledger: ${path}`,
      );
    }
    const rows = JSON.parse(read(manifest.requirements));
    assert.equal(rows.length, manifest.requirementCount, 'Requirement count changed');
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'Duplicate requirement ID');
    const identity = rows.map((row) =>
      ['id', 'section', 'heading', 'line', 'requirement'].map((key) => row[key]),
    );
    assert.equal(
      sha(JSON.stringify(identity)),
      manifest.requirementIdentitySha256,
      'Requirement identity/text changed',
    );
    assert.ok(
      Buffer.byteLength(read('docs/V3_LEDGER.md')) <= budget,
      'Active ledger exceeds 12 KiB; archive history forward',
    );
    output = `PASS: exact ${archive.length}-byte historical archive; unchanged contract/vision; ${manifest.additionalArchives.length} exact additional archives; ${rows.length} unique requirement identities/text; active ledger within 12 KiB.`;
  } else {
    throw Error('Usage: node scripts/v3-context.mjs [status|requirement ID...|chunk N|verify]');
  }
  assert.ok(
    Buffer.byteLength(output) <= budget,
    'Requested excerpt exceeds 12 KiB; use targeted rg and line ranges instead',
  );
  process.stdout.write(output.trimEnd() + '\n');
}
try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Context read failed';
  process.stderr.write(`ERROR: ${message.slice(0, 512)}\n`);
  process.exitCode = 1;
}
