// Commercial readiness verification server (program W0.5). A copy of operator-browser-server.ts on its
// own database (corridra_verification) and port (3300), with the program flags on and the QA seed.
// Ports: 3300 is the app, 3301 the synthetic provider fixture, 3302 the same app with a fake support WhatsApp
// number (+6500000000, not a real number) so the Chat on WhatsApp link can be checked. 3300 never has one.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
// One synthetic signed-in customer for browser tests. The token is made up for this run and kept in the
// same owner-only seed file the tests already read. Nothing here is a real account or a real provider.
const customer = {
  subject: `qa-customer-${randomBytes(6).toString('hex')}`,
  email: 'qa-customer@example.invalid',
  token: randomBytes(32).toString('base64url'),
};
await writeFile('.cache/qa-verification.json', JSON.stringify({ ...seed, customer }), {
  mode: 0o600,
});
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
  // Draft languages are offered here so the shells can be checked in every language and in Arabic
  // right to left (E-3, V-54). Production offers only reviewed languages.
  CORRIDRA_LANGUAGES_PREVIEW: 'true',
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
  'CORRIDRA_SUPPORT_WHATSAPP_NUMBER',
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
// Customer sign-in for browser tests. The app still asks the Neon Auth SDK for the session; a stand-in loaded
// into this server process only (scripts/qa/fake-neon-auth.mjs) answers that one request for the synthetic
// customer above. The address has the approved shape but is never contacted. Local synthetic runs only.
const customerAuthBase = 'https://ep-qa-customer.neonauth.eu-central-1.aws.neon.tech/qa/auth';
Object.assign(env, {
  CORRIDRA_NEON_AUTH_ENABLED: 'true',
  NEON_AUTH_BASE_URL: customerAuthBase,
  NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
  QA_FAKE_NEON_AUTH_BASE_URL: customerAuthBase,
  QA_FAKE_NEON_AUTH_TOKEN: customer.token,
  QA_FAKE_NEON_AUTH_SUBJECT: customer.subject,
  QA_FAKE_NEON_AUTH_EMAIL: customer.email,
  NODE_OPTIONS: [
    process.env.NODE_OPTIONS,
    `--import=${pathToFileURL(resolve('scripts/qa/fake-neon-auth.mjs')).href}`,
  ]
    .filter(Boolean)
    .join(' '),
});
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
function startNext(port: number, extraEnv: NodeJS.ProcessEnv) {
  return spawn(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      env: extraEnv,
      cwd: resolve('apps/web'),
      stdio: 'inherit',
      detached: true,
    },
  );
}
function stopGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    /* Already stopped. */
  }
}
// The second instance goes first and must answer before the main one starts, so the suite never sees 3300 up
// while 3302 is still starting. Every wait fails fast if the child has exited.
const whatsappServer = startNext(3302, {
  ...env,
  CORRIDRA_SUPPORT_WHATSAPP_NUMBER: '+6500000000',
  APP_ORIGIN: 'http://127.0.0.1:3302',
});
const main: { server?: ChildProcess } = {};
let whatsappExited = false;
function stopAll(code: number) {
  if (main.server) stopGroup(main.server, 'SIGTERM');
  stopGroup(whatsappServer, 'SIGTERM');
  providerFixture.close();
  process.exit(code);
}
// Handlers go in before the readiness wait, so a kill during it never leaves the detached 3302 server behind.
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    providerFixture.close();
    if (main.server) stopGroup(main.server, signal);
    stopGroup(whatsappServer, signal);
  });
whatsappServer.on('exit', (code) => {
  whatsappExited = true;
  // 3302 stopping on its own is a failure even with exit code 0: the suite would lose its WhatsApp checks.
  if (main.server) stopAll(code || 1);
});
const readyBy = Date.now() + 60_000;
for (;;) {
  if (whatsappExited)
    throw new Error('The support WhatsApp server on 3302 stopped before it was ready.');
  try {
    if ((await fetch('http://127.0.0.1:3302/', { signal: AbortSignal.timeout(2000) })).status < 500)
      break;
  } catch {
    /* Not listening yet. */
  }
  if (Date.now() > readyBy) {
    console.error('The support WhatsApp server on 3302 was not ready within 60 seconds.');
    stopAll(1);
  }
  await new Promise((done) => setTimeout(done, 250));
}
const server = startNext(3300, env);
main.server = server;
server.on('exit', (code) => stopAll(code ?? 1));
