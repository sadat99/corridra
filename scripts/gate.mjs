import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { constants } from 'node:os';

// Runs one verification command with its full output saved under work/ and prints only a compact
// receipt: exact exit code, final totals, failure context and the log path. Run from the repo root.
const usage = 'Usage: node scripts/gate.mjs <name> [--tail N] -- <command> [args...]';
const printBudget = 6 * 1024;
const ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const totals = [
  /^\s*(Test Files|Tests|Duration)\s+\S/,
  /^\s*\d+ (passed|failed|flaky|skipped|did not run)\b/,
  /^# (tests|pass|fail|cancelled|skipped|todo) \d+/,
  /\d+ problems? \(\d+ errors?, \d+ warnings?\)/,
  /Found \d+ errors?/,
  /Code style issues found|All matched files use Prettier code style/,
  /Compiled successfully|Failed to compile/,
];
const failure = /(\bFAIL\b|✘|✖|×|\bError\b|error TS\d+|\[warn\]|\bfailed\b|^not ok )/;

function redact(line) {
  return line
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"/]*:[^\s'"@]*@[^\s'"]+/gi, '[redacted-url]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]')
    .replace(
      /(password|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
      '$1$2[redacted]',
    )
    .slice(0, 240);
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function parse(argv) {
  const split = argv.indexOf('--');
  const head = split < 0 ? argv : argv.slice(0, split);
  const command = split < 0 ? [] : argv.slice(split + 1);
  const [name, ...rest] = head;
  let tail = 25;
  if (rest.length === 2 && rest[0] === '--tail') tail = Number(rest[1]);
  else if (rest.length) throw new Error(usage);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name ?? '')) throw new Error(usage);
  if (!Number.isInteger(tail) || tail < 1 || tail > 200) throw new Error('--tail must be 1 to 200');
  if (!command.length) throw new Error(usage);
  return { name, tail, command };
}

async function main() {
  const { name, tail, command } = parse(process.argv.slice(2));
  mkdirSync('work', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const log = `work/${name}-${stamp}.log`;
  const sink = createWriteStream(log);
  const started = Date.now();
  const child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(sink, { end: false });
  child.stderr.pipe(sink, { end: false });
  const outcome = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ code: 127, signal: null, error: error.message }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  if (outcome.error) sink.write(`spawn failed: ${outcome.error}\n`);
  sink.end();
  await once(sink, 'finish');

  const exit = outcome.signal
    ? 128 + (constants.signals[outcome.signal] ?? 0)
    : (outcome.code ?? 1);
  const bytes = readFileSync(log);
  const lines = bytes.toString('utf8').replace(ansi, '').split('\n');
  const dirty = git(['status', '--porcelain']);
  const receipt = {
    name,
    command: redact(command.join(' ')),
    exit,
    signal: outcome.signal,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    logBytes: statSync(log).size,
    logSha256: createHash('sha256').update(bytes).digest('hex'),
    head: git(['rev-parse', 'HEAD']),
    changedPaths: dirty === null ? null : dirty.split('\n').filter(Boolean).length,
    log,
  };
  writeFileSync(`${log}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);

  const out = [JSON.stringify({ ...receipt, logSha256: receipt.logSha256.slice(0, 12) })];
  const found = [...new Set(lines.filter((line) => totals.some((rx) => rx.test(line))))];
  if (found.length) out.push('totals:', ...found.slice(-12).map(redact));
  if (exit !== 0) {
    const hits = lines.filter((line) => failure.test(line)).slice(0, 20);
    if (hits.length) out.push('failure context:', ...hits.map(redact));
    out.push(`last ${tail} lines:`, ...lines.filter(Boolean).slice(-tail).map(redact));
  }
  let text = out.join('\n');
  if (Buffer.byteLength(text) > printBudget)
    text = `${text.slice(0, printBudget)}\n[truncated; full output in ${log}]`;
  process.stdout.write(`${text}\n`);
  process.exitCode = exit;
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${String(error.message ?? error).slice(0, 512)}\n`);
  process.exitCode = 2;
});
