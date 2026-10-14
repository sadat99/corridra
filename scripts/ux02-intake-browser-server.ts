import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Pool } from '../packages/db/src/index';
import { migrate } from '../packages/db/src/migrate';
import { seedSyntheticWorkspace } from '../packages/auth/src/bootstrap';
import { configureSyntheticIntake } from '../packages/missions/src/bootstrap';

// Dedicated local-only fixture. Keep the real six-request budget and all service/RLS contracts.
const database = 'corridra_browser_ux02_intake';
const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
const options = { host: '127.0.0.1', port: 54329, user: 'postgres', password: local.ownerPassword };
const owner = new Pool({ ...options, database: 'postgres' });
await owner.query('DROP DATABASE IF EXISTS corridra_browser_ux02_intake WITH (FORCE)');
await owner.query('CREATE DATABASE corridra_browser_ux02_intake');
await owner.end();
const db = new Pool({ ...options, database });
await migrate(db);
const seed = await seedSyntheticWorkspace(db, {
  email: 'ux02-intake-owner@example.invalid',
  password: randomBytes(24).toString('base64url'),
  name: 'Synthetic UX-02 Intake Operator',
});
await configureSyntheticIntake(db, seed.tenantId, seed.principalId);
await db.end();
const connection = (role: string, password: string) =>
  `postgresql://${role}:${password}@127.0.0.1:54329/${database}`;
const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
  paths: [resolve('apps/web')],
});
const server = spawn(
  process.execPath,
  [cli, 'start', '--hostname', '127.0.0.1', '--port', '3450'],
  {
    cwd: resolve('apps/web'),
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      CORRIDRA_FOUNDATIONS_ENABLED: 'true',
      APP_ORIGIN: 'http://127.0.0.1:3450',
      DATA_ENVIRONMENT: 'synthetic',
      DATABASE_REGION: 'local',
      RUNTIME_DATABASE_URL: connection('corridra_runtime_local', local.runtimePassword),
      AUTH_DATABASE_URL: connection('corridra_auth_local', local.authPassword),
      AUTH_SECRET: local.authSecret,
    },
  },
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.kill('SIGTERM'));
server.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
