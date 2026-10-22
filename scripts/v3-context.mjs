import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { budgetRows, outline, safeMarkdownPath, section } from './context-tools.mjs';

// Read-only context/navigation helper. Never regenerates execution memory.
const budget = 12 * 1024;
const read = (path) => readFileSync(path, 'utf8');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const alwaysRead = ['CLAUDE.md', 'AGENTS.md', 'docs/START_HERE.md', 'docs/V3_LEDGER.md'];
const alwaysBudget = 32 * 1024;
const usage =
  'Usage: node scripts/v3-context.mjs [status [--since SHA8]|requirement ID...|chunk N|outline PATH [--last N] [--max-level L]|section PATH QUERY [--nth K] [--tail BYTES]|budget|verify]';
function option(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  assert.ok(/^\d+$/.test(value ?? ''), `${name} needs a number`);
  args.splice(at, 2);
  return Number(value);
}
function main() {
  const manifest = JSON.parse(read('docs/v3/history/manifest.json'));
  const [command = 'status', ...args] = process.argv.slice(2);
  let output;
  if (command === 'status') {
    const since = args[0] === '--since' ? args[1] : undefined;
    assert.ok(
      args.length === 0 || (args.length === 2 && /^[0-9a-f]{8}$/.test(since ?? '')),
      'Usage: node scripts/v3-context.mjs status [--since SHA8]',
    );
    const ledger = read('docs/V3_LEDGER.md');
    const id = sha(ledger).slice(0, 8);
    output =
      since === id
        ? `UNCHANGED since your last read; skip the re-read.\nledger-sha8: ${id}`
        : `${ledger.trimEnd()}\n\nledger-sha8: ${id}`;
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
  } else if (command === 'outline') {
    const path = safeMarkdownPath(args.shift() ?? '');
    const last = option(args, '--last') ?? 0;
    const maxLevel = option(args, '--max-level') ?? 3;
    assert.equal(args.length, 0, usage);
    output = `line\tbytes\theading\n${outline(read(path), { last, maxLevel })}`;
  } else if (command === 'section') {
    const path = safeMarkdownPath(args.shift() ?? '');
    const nth = option(args, '--nth') ?? 1;
    const tail = option(args, '--tail') ?? 0;
    assert.equal(args.length, 1, usage);
    output = section(read(path), args[0], { nth, tail });
  } else if (command === 'budget') {
    assert.equal(args.length, 0, 'Usage: node scripts/v3-context.mjs budget');
    const groups = [
      ['always', alwaysRead],
      [
        'product-work-once',
        ['docs/V3_CONTRACT.md', manifest.productVision, 'docs/agents/product-vision.md'],
      ],
      ['visible-ui', ['docs/agents/ui-direction.md']],
      [
        'release',
        [
          'docs/runbooks/deployment.md',
          'docs/verification-guide.md',
          'docs/implementation/current-plan.md',
        ],
      ],
      [
        'query-never-whole',
        [
          'docs/agents/work-log.md',
          'docs/documentation-map.md',
          manifest.archive,
          manifest.requirements,
        ],
      ],
    ];
    output = `group\tfile\tbytes\t~tokens (bytes/4)\n${budgetRows(groups, (file) => statSync(file).size)}`;
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
    const alwaysBytes = alwaysRead.reduce((sum, path) => sum + statSync(path).size, 0);
    assert.ok(
      alwaysBytes <= alwaysBudget,
      `Always-read guides total ${alwaysBytes} bytes; archive or condense to stay within 32 KiB`,
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
    output = `PASS: exact ${archive.length}-byte historical archive; unchanged contract/vision; ${manifest.additionalArchives.length} exact additional archives; ${rows.length} unique requirement identities/text; active ledger within 12 KiB.`;
  } else {
    throw Error(usage);
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
