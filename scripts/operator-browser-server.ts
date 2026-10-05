import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from '../packages/db/src/index';
import { migrate } from '../packages/db/src/migrate';
import { seedSyntheticWorkspace } from '../packages/auth/src/bootstrap';
import { configureSyntheticIntake } from '../packages/missions/src/bootstrap';
const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
const owner = new Pool({
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: local.ownerPassword,
  database: 'postgres',
});
// A fixed, local-only database dedicated to browser tests. Never use ambient DATABASE_URL.
await owner.query('DROP DATABASE IF EXISTS corridra_browser WITH (FORCE)');
await owner.query('CREATE DATABASE corridra_browser');
await owner.end();
const db = new Pool({
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: local.ownerPassword,
  database: 'corridra_browser',
});
await migrate(db);
const password = randomBytes(24).toString('base64url');
const seed = await seedSyntheticWorkspace(db, {
  email: 'browser@example.invalid',
  password,
  name: 'Synthetic Browser Operator',
});
await configureSyntheticIntake(db, seed.tenantId, seed.principalId);
await db.end();
await writeFile('.cache/part03-browser.json', JSON.stringify({ password, ...seed }), {
  mode: 0o600,
});
const connection = (role: string, secret: string) =>
  `postgresql://${role}:${secret}@127.0.0.1:54329/corridra_browser`;
const env = {
  ...process.env,
  CORRIDRA_FOUNDATIONS_ENABLED: 'true',
  APP_ORIGIN: 'http://127.0.0.1:3200',
  DATA_ENVIRONMENT: 'synthetic',
  DATABASE_REGION: 'local',
  RUNTIME_DATABASE_URL: connection('corridra_runtime_local', local.runtimePassword),
  AUTH_DATABASE_URL: connection('corridra_auth_local', local.authPassword),
  AUTH_SECRET: local.authSecret,
};
// Prevent inherited cloud configuration from changing this local-only test.
for (const key of [
  'VERCEL_ENV',
  'DATABASE_URL',
  'EVIDENCE_BUCKET',
  'EVIDENCE_REGION',
  'EVIDENCE_STORAGE_PROVIDER',
  'EVIDENCE_SCAN_MODE',
  'CORRIDRA_LIVE_ROLLOUT_ENABLED',
  'EVIDENCE_BLOB_REGION',
  'EVIDENCE_BLOB_READS_ENABLED',
  'EVIDENCE_MIGRATED_BLOB_STORE_ID',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CLAMAV_HOST',
])
  delete (env as NodeJS.ProcessEnv)[key];
const server = spawn('pnpm', ['--filter', '@corridra/web', 'start', '--port', '3200'], {
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 1));
