import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Pool } from '../packages/db/src/index';
import { migrate } from '../packages/db/src/migrate';
import { migrateViewAs } from '../packages/db/src/view-as-migrate';
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
await migrateViewAs(db);
const password = randomBytes(24).toString('base64url');
const seed = await seedSyntheticWorkspace(db, {
  email: 'browser@example.invalid',
  password,
  name: 'Synthetic Browser Operator',
});
await configureSyntheticIntake(db, seed.tenantId, seed.principalId);
// The helper interest register fixture (ADR-085). Only while HELPER_INTEREST_FIXTURE is "true", which one CI step sets: the
// real-use modules, the real intake workspace and the register module are installed and real admission is opened on this
// throwaway local database, so the public form can be shown. Every other run is exactly as it was.
if (process.env.HELPER_INTEREST_FIXTURE === 'true') {
  const { migrateCustomerRealUse } = await import('../packages/db/src/customer-real-use-migrate');
  const { migrateHelperInterest } = await import('../packages/db/src/helper-interest-migrate');
  const { admitSyntheticCustomer } = await import('../packages/auth/src/customer-admission');
  const { configureCustomerRealUse } =
    await import('../packages/auth/src/customer-real-use-configuration');
  await migrateCustomerRealUse(db);
  const executor = (await db.query('SELECT service_id FROM app.intake_destination WHERE singleton'))
    .rows[0].service_id as string;
  await admitSyntheticCustomer(db, {
    issuer:
      'https://ep-helper-interest-browser.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    subject: 'helper-interest-browser-fixture',
    executorId: executor,
    reason: 'Local browser fixture authority only; never a production customer',
  });
  await configureCustomerRealUse(db, {
    enabled: true,
    reason: 'Local browser fixture with real admission open for the helper interest form',
  });
  await migrateHelperInterest(db);
}
await db.end();
await writeFile('.cache/part03-browser.json', JSON.stringify({ password, ...seed }), {
  mode: 0o600,
});
const connection = (role: string, secret: string) =>
  `postgresql://${role}:${secret}@127.0.0.1:54329/corridra_browser`;
const env = {
  ...process.env,
  CORRIDRA_FOUNDATIONS_ENABLED: 'true',
  CORRIDRA_DELIVERY_ENABLED: 'true',
  CORRIDRA_AI_ENABLED: 'true',
  CORRIDRA_NETWORK_ENABLED: 'true',
  CORRIDRA_OWNER_PAGE_ENABLED: 'true',
  CORRIDRA_VIEW_AS_ENABLED: 'true',
  CORRIDRA_AI_FIXTURE_URL: 'http://127.0.0.1:3201',
  APP_ORIGIN: 'http://127.0.0.1:3200',
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
await new Promise<void>((resolve) => providerFixture.listen(3201, '127.0.0.1', resolve));
// Signal the actual server, not a package-manager wrapper that can leave an orphan.
const nextCli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
  paths: [resolve('apps/web')],
});
const server = spawn(
  process.execPath,
  [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3200'],
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
