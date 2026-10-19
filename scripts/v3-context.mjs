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
    for (const source of ['docs/V3_LEDGER.md', manifest.archive]) {
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
    assert.equal(
      sha(readFileSync(manifest.contract)),
      manifest.contractSha256,
      'Contract changed; review the amendment',
    );
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
    output = `PASS: exact ${archive.length}-byte historical archive; unchanged contract; ${rows.length} unique requirement identities/text; active ledger within 12 KiB.`;
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
