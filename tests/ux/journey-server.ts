import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext } from '@playwright/test';
import { Pool } from '../../packages/db/src/index';
import { seedSyntheticWorkspace } from '../../packages/auth/src/bootstrap';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import {
  installLocalModules,
  openLocalControls,
  pinLocalCustomerIssuer,
} from '../../scripts/qa/local-install';

// Journey modes on real signed-in pages (docs/revamp/specs/journey-modes.md section 5). The shared UX test server has
// no sign-in and no data, so this starts the same production build on its own port with its own throwaway database,
// the test sign-in stand-in (scripts/qa/fake-neon-auth.mjs, the one the verification server and the signed-in sweep
// use) and the journey switches on. Two made-up people: one with a Sourcing request, a Selling request, a request no
// journey claims and a programme, and one brand-new account with no work. Everything is created through the
// product's own routes. Nothing here is a real account, and no real operation can start from it.
const port = 3114;
export const journeyBase = `http://127.0.0.1:${port}`;
const database = 'corridra_journey_ux';
const cookieName = '__Secure-neon-auth.session_token';
const issuer = 'https://ep-qa-journey.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';

type Person = { subject: string; email: string; name: string; token: string };
const person = (role: string): Person => ({
  subject: `qa-test-journey-${role}-${randomBytes(5).toString('hex')}`,
  email: `qa-test-journey-${role}@example.invalid`,
  name: `QA Test ${role}`,
  token: randomBytes(32).toString('base64url'),
});

export type JourneySeed = {
  /** A person with work in every journey. */
  busy: Person;
  /** A brand-new account: signed in, no workspace, no work. */
  fresh: Person;
  /** A person whose only work is one Sourcing request. */
  single: Person;
  workspaceId: string;
  sourcing: string;
  selling: string;
  unsorted: string;
  /** The workspace that holds the programme, which is where a programme room lives. */
  programmeRoom: string;
};

const brief = (objective: string, offer: string) => ({
  objective,
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer,
  website: '',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'QA Test Person',
  company: 'Synthetic QA Test Importers Ltd',
  email: 'qa-test-journey-busy@example.invalid',
  acknowledged: true,
});

export function journeyServer() {
  let server: ChildProcess | undefined;
  let db: Pool | undefined;
  const stop = async () => {
    if (server?.pid)
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    server = undefined;
    await db?.end().catch(() => undefined);
    db = undefined;
  };
  return {
    stop,
    async start(): Promise<JourneySeed> {
      const local = JSON.parse(readFileSync('.cache/part03-local.json', 'utf8'));
      const owner = (name: string) =>
        new Pool({
          host: '127.0.0.1',
          port: 54329,
          user: 'postgres',
          password: local.ownerPassword,
          database: name,
        });
      const admin = owner('postgres');
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${database}`);
      await admin.end();
      db = owner(database);
      await installLocalModules(db);
      await openLocalControls(db);
      const staff = await seedSyntheticWorkspace(db, {
        email: 'qa-test-journey-staff@example.invalid',
        password: randomBytes(24).toString('base64url'),
        name: 'QA Test Staff',
      });
      await configureSyntheticIntake(db, staff.tenantId, staff.principalId);
      await pinLocalCustomerIssuer(db, issuer);

      const busy = person('busy');
      const fresh = person('fresh');
      const single = person('single');
      const connection = (role: string, secret: string) =>
        `postgresql://${role}:${secret}@127.0.0.1:54329/${database}`;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CORRIDRA_FOUNDATIONS_ENABLED: 'true',
        CORRIDRA_DELIVERY_ENABLED: 'true',
        CORRIDRA_UX_SHELLS_V2: 'true',
        CORRIDRA_UX_MOVE: 'true',
        CORRIDRA_UX_JOURNEY_MODES: 'true',
        CORRIDRA_UX_ROAD: 'true',
        CORRIDRA_UX_NAV: 'true',
        CORRIDRA_NEON_AUTH_ENABLED: 'true',
        CORRIDRA_CUSTOMER_OPEN_ADMISSION: 'synthetic-only',
        APP_ORIGIN: journeyBase,
        DATA_ENVIRONMENT: 'synthetic',
        DATABASE_REGION: 'local',
        RUNTIME_DATABASE_URL: connection('corridra_runtime_local', local.runtimePassword),
        AUTH_DATABASE_URL: connection('corridra_auth_local', local.authPassword),
        AUTH_SECRET: local.authSecret,
        NEON_AUTH_BASE_URL: issuer,
        NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
        QA_FAKE_NEON_AUTH_BASE_URL: issuer,
        QA_FAKE_NEON_AUTH_USERS: JSON.stringify([busy, fresh, single]),
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${pathToFileURL(resolve('scripts/qa/fake-neon-auth.mjs')).href}`,
        ]
          .filter(Boolean)
          .join(' '),
      };
      for (const key of Object.keys(process.env))
        if (/^CORRIDRA_CUSTOMER_.*_ENABLED$/.test(key)) delete env[key];
      for (const name of [
        'WORKSPACES',
        'COMPANIES',
        'SAVED_MISSIONS',
        'DELIVERY',
        'REQUESTS',
        'REQUEST_DETAILS',
        'MISSION_DRAFTS',
        'PROGRAMMES',
        'PARTICIPANTS',
      ])
        env[`CORRIDRA_CUSTOMER_${name}_ENABLED`] = 'true';
      for (const key of [
        'VERCEL_ENV',
        'DATABASE_URL',
        'EVIDENCE_BUCKET',
        'EVIDENCE_STORAGE_PROVIDER',
        'CORRIDRA_LIVE_ROLLOUT_ENABLED',
        'CORRIDRA_REAL_USE_ENABLED',
        'BLOB_READ_WRITE_TOKEN',
        'CLAMAV_HOST',
      ])
        delete env[key];
      const nextCli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
        paths: [resolve('apps/web')],
      });
      server = spawn(
        process.execPath,
        [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
        { env, cwd: resolve('apps/web'), stdio: 'ignore', detached: true },
      );
      for (let i = 0; ; i++) {
        try {
          if ((await fetch(journeyBase + '/', { signal: AbortSignal.timeout(2000) })).status < 500)
            break;
        } catch {
          /* Not listening yet. */
        }
        if (i === 240) throw new Error('The journey test server did not start.');
        await new Promise((done) => setTimeout(done, 500));
      }

      const api = async (who: Person, path: string, body: unknown) => {
        // The request budget is a counter in this throwaway database; clear it, never raise a limit.
        await db!.query('DELETE FROM app.intake_rate_limit');
        const response = await fetch(journeyBase + path, {
          method: 'POST',
          headers: {
            origin: journeyBase,
            cookie: `${cookieName}=${who.token}`,
            'content-type': 'application/json',
            'x-corridra-customer-subject': who.subject,
            'x-corridra-customer-issuer': issuer,
          },
          body: JSON.stringify(body),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`Seeding ${path} answered ${response.status}: ${text}`);
        return JSON.parse(text) as Record<string, unknown>;
      };
      const workspaceId = (
        await api(busy, '/api/customer-workspaces', {
          commandId: randomUUID(),
          name: 'Synthetic QA Test Importers workspace',
        })
      ).id as string;
      const request = async (objective: string, offer: string) =>
        (
          await api(busy, '/api/customer-requests', {
            commandId: randomUUID(),
            workspaceId,
            brief: brief(objective, offer),
          })
        ).id as string;
      const sourcing = await request('Source suppliers', 'Synthetic cotton towels for hotels.');
      const selling = await request('Sell in a new market', 'Synthetic leather bags for shops.');
      const unsorted = await request('Something else', 'Synthetic request with no journey.');
      await api(busy, '/api/customer-programmes', {
        commandId: randomUUID(),
        workspaceId,
        name: 'Synthetic QA Test buyer delegation',
        reportingPurpose: 'Synthetic QA Test delegation for the journey pages.',
        acknowledged: true,
      });
      const only = (
        await api(single, '/api/customer-workspaces', {
          commandId: randomUUID(),
          name: 'Synthetic QA Test Sourcing workspace',
        })
      ).id as string;
      await api(single, '/api/customer-requests', {
        commandId: randomUUID(),
        workspaceId: only,
        brief: brief('Source suppliers', 'Synthetic ceramic tiles for one buyer.'),
      });
      return {
        busy,
        fresh,
        single,
        workspaceId,
        sourcing,
        selling,
        unsorted,
        programmeRoom: workspaceId,
      };
    },
  };
}

/** Signs a made-up person in, with an optional journey already chosen (the cookie the switcher writes). */
export async function signInAs(context: BrowserContext, who: Person, journey?: string) {
  await context.clearCookies();
  await context.addCookies([
    {
      name: cookieName,
      value: who.token,
      domain: '127.0.0.1',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
    ...(journey
      ? [
          {
            name: 'corridra_journey',
            value: journey,
            domain: '127.0.0.1',
            path: '/account',
            sameSite: 'Lax' as const,
          },
        ]
      : []),
  ]);
}
