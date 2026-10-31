// Commercial readiness verification server (program W0.5). A copy of operator-browser-server.ts on its
// own database (corridra_verification) and port (3300), with the program flags on and the QA seed.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import { migrateViewAs } from '../../packages/db/src/view-as-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { seedPreview } from './seed-preview';
import { seed as seedA } from '../../tests/e2e/verification/ws-a/seed';
import { seed as seedB } from '../../tests/e2e/verification/ws-b/seed';
import { seed as seedC } from '../../tests/e2e/verification/ws-c/seed';
import { seed as seedD } from '../../tests/e2e/verification/ws-d/seed';
import { seed as seedE } from '../../tests/e2e/verification/ws-e/seed';
const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
const owner = new Pool({
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: local.ownerPassword,
  database: 'postgres',
});
// A fixed, local-only database dedicated to browser tests. Never use ambient DATABASE_URL.
await owner.query('DROP DATABASE IF EXISTS corridra_verification WITH (FORCE)');
await owner.query('CREATE DATABASE corridra_verification');
await owner.end();
const db = new Pool({
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: local.ownerPassword,
  database: 'corridra_verification',
});
await migrate(db);
await migrateViewAs(db);
await migrateCommercialReadiness(db);
const seed = await seedPreview(db, '127.0.0.1', {
  'ws-a': seedA,
  'ws-b': seedB,
  'ws-c': seedC,
  'ws-d': seedD,
  'ws-e': seedE,
});
await db.end();
await writeFile('.cache/qa-verification.json', JSON.stringify(seed), { mode: 0o600 });
const connection = (role: string, secret: string) =>
  `postgresql://${role}:${secret}@127.0.0.1:54329/corridra_verification`;
const env = {
  ...process.env,
  CORRIDRA_FOUNDATIONS_ENABLED: 'true',
  CORRIDRA_DELIVERY_ENABLED: 'true',
  CORRIDRA_AI_ENABLED: 'true',
  CORRIDRA_NETWORK_ENABLED: 'true',
  CORRIDRA_OWNER_PAGE_ENABLED: 'true',
  CORRIDRA_VIEW_AS_ENABLED: 'true',
  // Program flags (section 5.4): on here, off in production until the owner sets them.
  CORRIDRA_UX_SHELLS_V2: 'true',
  CORRIDRA_UX_MISSIONS_V2: 'true',
  CORRIDRA_NOTIFICATIONS_V2: 'true',
  CORRIDRA_TEAM_INVITES: 'true',
  CORRIDRA_ROUTE_PACK_FORM: 'true',
  CORRIDRA_UX_OPERATOR_URLS: 'true',
  CORRIDRA_AI_FIXTURE_URL: 'http://127.0.0.1:3301',
  APP_ORIGIN: 'http://127.0.0.1:3300',
  DATA_ENVIRONMENT: 'synthetic',
  DATABASE_REGION: 'local',
  RUNTIME_DATABASE_URL: connection('corridra_runtime_local', local.runtimePassword),
  AUTH_DATABASE_URL: connection('corridra_auth_local', local.authPassword),
  AUTH_SECRET: local.authSecret,
  // Invalid, synthetic identity-mail credentials. Browser recovery tests intercept
  // the same-origin SDK transport; backend tests use an in-memory mail collector.
  CORRIDRA_OPERATOR_RECOVERY_ENABLED: 'true',
  OPERATOR_RECOVERY_EMAIL_KEY: 'isolated-browser-fixture-not-a-provider-key',
  OPERATOR_RECOVERY_EMAIL_FROM: 'identity@example.invalid',
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
  'CORRIDRA_NEON_AUTH_ENABLED',
  'CORRIDRA_NEON_AUTH_PRODUCTION_READY',
  'NEON_AUTH_BASE_URL',
  'NEON_AUTH_COOKIE_SECRET',
])
  delete (env as NodeJS.ProcessEnv)[key];
// Explicit synthetic provider protocol fixture. No model inference or outbound provider traffic.
const providerFixture = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 40000) throw new Error('fixture size limit');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const user = body.messages.find((m: { role: string }) => m.role === 'user');
    const prompt = JSON.parse(user.content);
    if (prompt.task !== 'commercial_intent') throw new Error('Fixture task unsupported');
    const source = prompt.untrustedSources[0];
    const content = JSON.stringify({
      authority: 'UNVERIFIED_DRAFT',
      facts: [source],
      unknowns: ['Synthetic provider fixture only; acceptance unknown'],
      data: { proposedIntent: 'Review synthetic machinery', fields: [] },
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'synthetic-fixture',
        object: 'chat.completion',
        created: 0,
        model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      }),
    );
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: 'Synthetic fixture rejected request', type: 'fixture_error' },
      }),
    );
  }
});
await new Promise<void>((resolve) => providerFixture.listen(3301, '127.0.0.1', resolve));
// Signal the actual server, not a package-manager wrapper that can leave an orphan.
const nextCli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
  paths: [resolve('apps/web')],
});
const server = spawn(
  process.execPath,
  [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3300'],
  {
    env,
    cwd: resolve('apps/web'),
    stdio: 'inherit',
    detached: true,
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    providerFixture.close();
    if (server.pid) {
      try {
        process.kill(-server.pid, signal);
      } catch {
        /* Already stopped. */
      }
    }
  });
server.on('exit', (code) => {
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* Own process group already stopped. */
    }
  }
  providerFixture.close();
  process.exit(code ?? 1);
});
