import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const dir = '.cache/security';
await mkdir(dir, { recursive: true, mode: 0o700 });
const root = 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/';
const archive = 'gitleaks_8.30.1_linux_x64.tar.gz';
async function fetchFile(name) {
  const response = await fetch(root + name);
  if (!response.ok) throw new Error('Official scanner download failed: ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 16000000) throw new Error('Scanner download exceeded its bound');
  return bytes;
}
const checksumText = new TextDecoder().decode(await fetchFile('gitleaks_8.30.1_checksums.txt'));
const expected = checksumText
  .split('\n')
  .find((line) => line.trim().endsWith(archive))
  ?.trim()
  .split(/\s+/)[0];
if (expected !== '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb')
  throw new Error('Pinned scanner checksum mismatch');
let bytes;
try {
  bytes = await readFile(dir + '/' + archive);
} catch {
  bytes = await fetchFile(archive);
}
if (createHash('sha256').update(bytes).digest('hex') !== expected)
  throw new Error('Scanner checksum mismatch');
await writeFile(dir + '/' + archive, bytes, { mode: 0o600 });
execFileSync('tar', ['-xzf', dir + '/' + archive, '-C', dir, 'gitleaks'], { stdio: 'pipe' });
const report = dir + '/gitleaks.json';
try {
  execFileSync(
    dir + '/gitleaks',
    ['git', '.', '--redact=100', '--no-banner', '--report-format=json', '--report-path=' + report],
    { stdio: 'pipe' },
  );
} catch {
  const findings = JSON.parse(await readFile(report, 'utf8'));
  console.error(
    JSON.stringify({
      scanner: 'gitleaks',
      findings: findings.length,
      safeRules: [...new Set(findings.map((f) => f.RuleID))],
    }),
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    scanner: 'gitleaks',
    version: '8.30.1',
    archiveSha256: expected,
    findings: 0,
    scope: 'Git history; reports redacted',
  }),
);
