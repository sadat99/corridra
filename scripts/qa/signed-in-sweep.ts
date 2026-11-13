// Signed-in sweep (task L12). Opens every signed-in page for each role at 390, 768 and 1440 px and records broken layout,
// sideways scroll, console errors, failed requests, missing navigation and wrong role access.
//
// Local (default): builds a throwaway database, installs every optional module, seeds "QA Test" identities with
// passwords and session tokens made up for this run, starts the production build with the test sign-in stand-in and sweeps it.
//   pnpm build && pnpm exec tsx scripts/qa/signed-in-sweep.ts [--roles customer,staff] [--out work/signed-in-sweep] [--shots]
// Needs the local PostgreSQL of docs/runbooks/development.md (pnpm db:local, or the native route in KI-15) and
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH when the browser is not Playwright's own.
//
// Remote (later, against a deployment that has real test accounts): nothing is seeded or started.
//   QA_SWEEP_IDENTITIES=path/to/identities.json pnpm exec tsx scripts/qa/signed-in-sweep.ts --target https://example
// identities.json is kept outside the repository and holds per role { "cookies": [...] } or, for staff,
// { "staff": { "email", "password", "totpSecret" } }, plus optional "ids" for dynamic routes. Nothing is created, so
// run it only against accounts that already exist. It is read-only: it opens pages and clicks nothing that writes.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Pool } from '../../packages/db/src/index';
import { seedSyntheticWorkspace } from '../../packages/auth/src/bootstrap';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { installLocalModules, openLocalControls, pinLocalCustomerIssuer } from './local-install';
import { measurePage, targetsBroken } from './ux-measure';

// The sweep seeds "Synthetic QA Test ..." labels and qa-test-...@example.invalid addresses (synthetic mode refuses any
// other label). That is data the run put there, so the forbidden-word check skips it; every other word is judged.
const seededText = [
  /Synthetic North/i,
  /Synthetic QA Test[^\n]*/i,
  /qa-test-[a-z0-9-]*@example\.invalid/i,
];
const measureOptions = { ignoreText: seededText };
import { totp } from '../../tests/operator/operator-signin';
import {
  buildQueue,
  discoverRoutes,
  expectation,
  fillRoute,
  harvestLinks,
  isDynamic,
  routeArea,
  stateRoutes,
  sweepRoles,
  sweepWidthOrder,
  tabRoute,
  type SweepRole,
} from './sweep-routes';

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const roles = (arg('roles')?.split(',') ?? [...sweepRoles]) as SweepRole[];
const remoteBase = arg('target');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(arg('out') ?? 'work/signed-in-sweep', stamp);
mkdirSync(outDir, { recursive: true });
const reportFile = resolve(outDir, 'report.jsonl');
const note = (line: string) => console.log(line);

type Identity = {
  role: SweepRole;
  cookies?: Parameters<BrowserContext['addCookies']>[0];
  staff?: { email: string; password: string; totpSecret?: string };
  headers?: Record<string, string>;
  ids: Record<string, string | undefined>;
};
const cookieName = '__Secure-neon-auth.session_token';
const customerAuthBase =
  'https://ep-qa-sweep.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const port = 3400;
// Every display switch is on, so every page that can be reached is swept. The real-use, real billing, real invoicing,
// mission email and live rollout switches stay off: no real operation can start from this run.
const uxFlags = [
  'CORRIDRA_UX_SHELLS_V2',
  'CORRIDRA_UX_MISSIONS_V2',
  'CORRIDRA_UX_ROAD',
  'CORRIDRA_UX_MOVE',
  'CORRIDRA_UX_NAV',
  'CORRIDRA_UX_LENSES',
  'CORRIDRA_UX_TRIP',
  'CORRIDRA_UX_PROGRAMME',
  'CORRIDRA_UX_FIRSTQ',
  'CORRIDRA_UX_FAIRS',
  'CORRIDRA_UX_BOOKS',
  'CORRIDRA_UX_MOVE_RECORDS',
  'CORRIDRA_UX_FRONT_DOORS',
  'CORRIDRA_UX_POCKET',
  'CORRIDRA_UX_OPERATOR_URLS',
  'CORRIDRA_NOTIFICATIONS_V2',
  'CORRIDRA_PULSE_ENABLED',
  'CORRIDRA_PROGRAMME_PAGES',
  'CORRIDRA_TEAM_INVITES',
  'CORRIDRA_ROUTE_PACK_FORM',
  'CORRIDRA_STATUS_LINK',
  'CORRIDRA_SHARE_CARD',
  'CORRIDRA_LANGUAGES_PREVIEW',
];
const origin = remoteBase ?? `http://127.0.0.1:${port}`;
const host = new URL(origin).hostname;

if (remoteBase) {
  if (!/^https:\/\//.test(remoteBase)) throw new Error('A remote base must be https.');
  if (!process.env.QA_SWEEP_IDENTITIES)
    throw new Error(
      '--target needs QA_SWEEP_IDENTITIES, the test-account file kept outside the repository.',
    );
} else if (process.env.DATA_ENVIRONMENT === 'real' || process.env.VERCEL_ENV === 'production') {
  throw new Error('The local sweep refuses a real or production environment.');
}

// ---- local seeding --------------------------------------------------------------------------------------------------

let server: ChildProcess | undefined;
const stopServer = () => {
  if (server?.pid)
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
};
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopServer();
    process.exit(1);
  });

async function api(
  who: Identity,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  subject?: string,
) {
  await resetLimits();
  const response = await fetch(origin + path, {
    method,
    headers: {
      origin,
      cookie: `${cookieName}=${who.cookies![0]!.value}`,
      'content-type': 'application/json',
      'x-corridra-customer-subject': subject ?? who.headers!.subject!,
      'x-corridra-customer-issuer': customerAuthBase,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* Not JSON. */
  }
  return { status: response.status, json: json as Record<string, unknown> | null, text };
}

// The sign-in and request budgets are counters in the local throwaway database. A sweep opens hundreds of pages from one
// address, so it clears the counters (never raises a limit) before each page. Never done in remote mode.
let resetPool: Pool | undefined;
const resetLimits = async () => {
  if (!resetPool) return;
  await resetPool.query('DELETE FROM app.intake_rate_limit');
  await resetPool.query('DELETE FROM identity."rateLimit"');
};

type Local = { identities: Identity[]; staffSecretFile: string };
async function localSetup(): Promise<Local> {
  const local = JSON.parse(readFileSync('.cache/part03-local.json', 'utf8'));
  const admin = new Pool({
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: local.ownerPassword,
    database: 'postgres',
  });
  await admin.query('DROP DATABASE IF EXISTS corridra_sweep WITH (FORCE)');
  await admin.query('CREATE DATABASE corridra_sweep');
  await admin.end();
  const db = new Pool({
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: local.ownerPassword,
    database: 'corridra_sweep',
  });
  await installLocalModules(db, (line) => note(`  ${line}`));
  await openLocalControls(db);
  resetPool = db;
  const staffPassword = randomBytes(24).toString('base64url');
  const seed = await seedSyntheticWorkspace(db, {
    email: 'qa-test-staff@example.invalid',
    password: staffPassword,
    name: 'QA Test Staff',
  });
  await configureSyntheticIntake(db, seed.tenantId, seed.principalId);
  await pinLocalCustomerIssuer(db, customerAuthBase);

  const customers = (['customer', 'organiser', 'participant', 'seller'] as const).map((role) => ({
    role,
    subject: `qa-test-${role}-${randomBytes(5).toString('hex')}`,
    email: `qa-test-${role}@example.invalid`,
    name: `QA Test ${role[0]!.toUpperCase()}${role.slice(1)}`,
    token: randomBytes(32).toString('base64url'),
  }));
  const connection = (role: string, secret: string) =>
    `postgresql://${role}:${secret}@127.0.0.1:54329/corridra_sweep`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CORRIDRA_FOUNDATIONS_ENABLED: 'true',
    CORRIDRA_DELIVERY_ENABLED: 'true',
    CORRIDRA_AI_ENABLED: 'true',
    CORRIDRA_NETWORK_ENABLED: 'true',
    CORRIDRA_OWNER_PAGE_ENABLED: 'true',
    CORRIDRA_VIEW_AS_ENABLED: 'true',
    ...Object.fromEntries(uxFlags.map((name) => [name, 'true'])),
    CORRIDRA_NEON_AUTH_ENABLED: 'true',
    CORRIDRA_CUSTOMER_OPEN_ADMISSION: 'synthetic-only',
    APP_ORIGIN: origin,
    DATA_ENVIRONMENT: 'synthetic',
    DATABASE_REGION: 'local',
    RUNTIME_DATABASE_URL: connection('corridra_runtime_local', local.runtimePassword),
    AUTH_DATABASE_URL: connection('corridra_auth_local', local.authPassword),
    AUTH_SECRET: local.authSecret,
    CORRIDRA_OPERATOR_RECOVERY_ENABLED: 'true',
    OPERATOR_RECOVERY_EMAIL_KEY: 'isolated-browser-fixture-not-a-provider-key',
    OPERATOR_RECOVERY_EMAIL_FROM: 'identity@example.invalid',
    NEON_AUTH_BASE_URL: customerAuthBase,
    NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'),
    QA_FAKE_NEON_AUTH_BASE_URL: customerAuthBase,
    QA_FAKE_NEON_AUTH_USERS: JSON.stringify(customers),
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--import=${pathToFileURL(resolve('scripts/qa/fake-neon-auth.mjs')).href}`,
    ]
      .filter(Boolean)
      .join(' '),
  };
  // Every customer module switch is on; the real billing, real invoicing and real-use gates stay off.
  // QA_SWEEP_POCKET=off sweeps the same build with the Pocket switch unset, to compare its off state with main.
  if (process.env.QA_SWEEP_POCKET === 'off') delete env.CORRIDRA_UX_POCKET;
  for (const key of Object.keys(process.env))
    if (/^CORRIDRA_(CUSTOMER_.*_ENABLED)$/.test(key)) delete env[key];
  for (const name of [
    'WORKSPACES',
    'COMPANIES',
    'SAVED_MISSIONS',
    'DECISIONS',
    'DELIVERY',
    'REQUESTS',
    'REQUEST_DETAILS',
    'ORGANISATION_PROFILES',
    'MISSION_DRAFTS',
    'PROGRAMMES',
    'PARTICIPANTS',
    'PROGRAMME_CONTEXT',
    'PROGRAMME_ECONOMICS',
    'PROGRAMME_COORDINATION',
    'PROGRAMME_TEMPLATES',
    'PROGRAMME_PRICING',
    'PROGRAMME_TERMS',
    'PROGRAMME_PROJECTIONS',
    'MISSION_SHARES',
    'MEMBER_ROLES',
    'ORGANISATION_LINKS',
    'SERVICE_REQUESTS',
    'SPECIFICATION_CONFIRMATION',
    'BILLING',
    'INVOICING',
    'SIMULATED_PAYMENTS',
    'ACCOUNT_LIFECYCLE',
    'WORKSPACE_LIFECYCLE',
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
    { env, cwd: resolve('apps/web'), stdio: ['ignore', 'inherit', 'inherit'], detached: true },
  );
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(origin + '/', { signal: AbortSignal.timeout(2000) })).status < 500) break;
    } catch {
      /* Not listening yet. */
    }
    if (i === 239) throw new Error('The application did not start.');
    await new Promise((done) => setTimeout(done, 500));
  }
  const identities: Identity[] = customers.map((c) => ({
    role: c.role,
    cookies: [
      {
        name: cookieName,
        value: c.token,
        domain: host,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ],
    headers: { subject: c.subject },
    ids: {},
  }));
  identities.push({
    role: 'staff',
    staff: { email: 'qa-test-staff@example.invalid', password: staffPassword },
    ids: {},
  });
  await seedCustomers(identities);
  return { identities, staffSecretFile: resolve(outDir, 'staff-authenticator.json') };
}

async function seedCustomers(identities: Identity[]) {
  const by = (role: SweepRole) => identities.find((i) => i.role === role)!;
  const seeded: Record<string, unknown> = {};
  const workspace = async (who: Identity, name: string) => {
    const r = await api(who, 'POST', '/api/customer-workspaces', {
      commandId: randomUUID(),
      name,
    });
    seeded[`workspace:${who.role}`] = { status: r.status, body: r.json ?? r.text.slice(0, 200) };
    who.ids.workspaceId = (r.json?.id as string | undefined) ?? undefined;
  };
  await workspace(by('customer'), 'Synthetic QA Test Importers workspace');
  await workspace(by('organiser'), 'Synthetic QA Test Programme office');
  await workspace(by('participant'), 'Synthetic QA Test Participant workspace');
  await workspace(by('seller'), 'Synthetic QA Test Exporters workspace');
  // Each person's company profile carries the commercial role the sweep names them by.
  const profile = async (who: Identity, roleName: string, legalName: string) => {
    if (!who.ids.workspaceId) return;
    const r = await api(who, 'POST', '/api/customer-organisation-profiles', {
      commandId: randomUUID(),
      workspaceId: who.ids.workspaceId,
      expectedVersion: 0,
      legalName,
      countryCode: 'BD',
      website: null,
      commercialRoles: [roleName],
      sectors: ['Garments'],
      sizeBand: '11-50',
      summary: 'Synthetic QA Test company used only by the signed-in sweep.',
      reason: 'Signed-in sweep setup',
      acknowledged: true,
    });
    seeded[`profile:${who.role}`] = { status: r.status, body: r.json ?? r.text.slice(0, 200) };
  };
  await profile(by('customer'), 'BUYER', 'Synthetic QA Test Importers Ltd');
  await profile(by('organiser'), 'ORGANISER', 'Synthetic QA Test Programme Office');
  await profile(by('participant'), 'BUYER', 'Synthetic QA Test Participant Ltd');
  await profile(by('seller'), 'SELLER', 'Synthetic QA Test Exporters Ltd');
  // The organiser opens a programme and invites the participant, who accepts. Neither step sends a message.
  const organiser = by('organiser'),
    participant = by('participant');
  if (organiser.ids.workspaceId) {
    const made = await api(organiser, 'POST', '/api/customer-programmes', {
      commandId: randomUUID(),
      workspaceId: organiser.ids.workspaceId,
      name: 'Synthetic QA Test buyer programme',
      reportingPurpose: 'Synthetic QA Test programme for the signed-in sweep.',
      acknowledged: true,
    });
    seeded['programme'] = { status: made.status, body: made.json ?? made.text.slice(0, 200) };
    const programmeId = (made.json?.id ?? made.json?.programmeId) as string | undefined;
    organiser.ids.programmeId = programmeId;
    if (programmeId) {
      const invite = await api(organiser, 'POST', '/api/customer-programme-participants', {
        commandId: randomUUID(),
        action: 'invite',
        workspaceId: organiser.ids.workspaceId,
        programmeId,
        label: 'Synthetic QA Test participant',
        acknowledged: true,
      });
      seeded['invite'] = { status: invite.status, body: { keys: Object.keys(invite.json ?? {}) } };
      const token = invite.json?.token as string | undefined;
      if (token) {
        const accepted = await api(participant, 'POST', '/api/customer-programme-participants', {
          commandId: randomUUID(),
          action: 'accept',
          token,
          programmeId,
          displayLabel: 'Synthetic QA Test participant',
          consented: true,
        });
        seeded['accept'] = {
          status: accepted.status,
          body: accepted.json ?? accepted.text.slice(0, 200),
        };
        participant.ids.programmeId = programmeId;
      }
    }
  }
  // The customer also holds a programme and a paid-service request about it, so the Your work list has a programme row
  // and a delegation service row to draw (task L12, owner screenshots of 13 November).
  const customer = by('customer');
  if (customer.ids.workspaceId) {
    const own = await api(customer, 'POST', '/api/customer-programmes', {
      commandId: randomUUID(),
      workspaceId: customer.ids.workspaceId,
      name: 'Synthetic QA Test buyer delegation',
      reportingPurpose: 'Synthetic QA Test delegation for the signed-in sweep.',
      acknowledged: true,
    });
    seeded['programme:customer'] = { status: own.status, body: own.json ?? own.text.slice(0, 160) };
    const programmeId = own.json?.id as string | undefined;
    customer.ids.programmeId = programmeId;
    const key = resetPool
      ? (
          await resetPool.query(
            'SELECT service_key FROM customer_private.service_catalogue_version WHERE active LIMIT 1',
          )
        ).rows[0]?.service_key
      : undefined;
    if (programmeId && key) {
      const asked = await api(customer, 'POST', '/api/customer-service-requests', {
        action: 'create',
        commandId: randomUUID(),
        workspaceId: customer.ids.workspaceId,
        contextKind: 'programme',
        contextRef: programmeId,
        serviceKey: key,
        need: 'Synthetic QA Test need for local support during the delegation visit.',
        preferredFrom: null,
        preferredTo: null,
        region: 'Dhaka',
      });
      seeded['service-request'] = {
        status: asked.status,
        body: asked.json ?? asked.text.slice(0, 160),
      };
    }
  }
  // Every role that owns a workspace keeps one open draft, so the draft page (?draft=<id>) is swept as well.
  for (const who of [customer, organiser, participant, by('seller')]) {
    if (!who.ids.workspaceId) continue;
    const saved = await api(who, 'POST', '/api/customer-mission-drafts', {
      action: 'save',
      input: {
        commandId: randomUUID(),
        workspaceId: who.ids.workspaceId,
        draftId: null,
        expectedVersion: 0,
        details: {
          title: 'Synthetic QA Test open request',
          family: 'SUPPLIERS_PRODUCTS',
          objective: 'Source suppliers',
          market: 'Bangladesh',
          attendance: 'No',
          startDate: '',
          endDate: '',
          timezone: 'Asia/Dhaka',
          offer: '',
          website: '',
          outcomes: [],
          notes: '',
          requirements: [],
          contactName: 'QA Test Person',
          contactEmail: '',
          profileVersion: null,
          sourcingContext: 'MACHINERY',
          companyName: '',
        },
        acknowledged: true,
      },
    });
    seeded[`draft:${who.role}`] = {
      status: saved.status,
      body: saved.json ?? saved.text.slice(0, 200),
    };
    who.ids.draftId = (saved.json?.id ?? saved.json?.draftId) as string | undefined;
  }
  writeFileSync(resolve(outDir, 'seed.json'), JSON.stringify(seeded, null, 2));
  for (const [key, value] of Object.entries(seeded)) {
    const status = (value as { status: number }).status;
    note(`  seed ${key}: ${status}`);
  }
}

// ---- sweep ----------------------------------------------------------------------------------------------------------

type Row = {
  role: SweepRole;
  width: number;
  route: string;
  finalPath: string;
  status: number;
  expected: 'content' | 'gated';
  actual: 'content' | 'gated';
  problems: string[];
  measure?: unknown;
};
const rows: Row[] = [];
const tabRow = (
  who: Identity,
  width: number,
  route: string,
  finalPath: string,
  status: number,
  problems: string[],
  measure?: unknown,
): Row => ({
  role: who.role,
  width,
  route,
  finalPath,
  status,
  expected: 'content',
  actual: 'content',
  problems: [...new Set(problems)],
  measure,
});

async function signInStaff(browser: Browser, who: Identity, secretFile: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(origin + '/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill(who.staff!.email);
  await page.getByLabel('Password', { exact: true }).fill(who.staff!.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('heading', { name: /Set up your authenticator|Verify your authenticator/ })
    .waitFor({ timeout: 20000 });
  let secret = who.staff!.totpSecret ?? '';
  if (await page.getByRole('heading', { name: 'Set up your authenticator' }).isVisible()) {
    await page.getByRole('button', { name: 'Set Up Authenticator', exact: true }).click();
    secret = await page.getByLabel('Authenticator setup key').inputValue();
    writeFileSync(secretFile, JSON.stringify({ note: 'QA Test staff, this run only', secret }), {
      mode: 0o600,
    });
  }
  if (!secret) throw new Error('No authenticator key for the staff identity.');
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/operator/signin'), { timeout: 20000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

// A page is gated when it fails, sends the visitor to a sign-in page, leaves its own area, or (for pages that are not open
// to everyone) opens on a sign-in or no-access message instead of its content. A redirect inside the area, such as the
// account home choosing the one workspace, is still content. Open pages are never judged by their words.
const looksGated = (finalPath: string, route: string, status: number, text: string) => {
  const wanted = route.split('?')[0]!;
  const open = ['public', 'staff-entry'].includes(routeArea(wanted));
  return (
    status >= 400 ||
    (finalPath !== wanted &&
      (/^\/(signin|operator\/signin)/.test(finalPath) ||
        routeArea(finalPath) !== routeArea(wanted))) ||
    (!open && /^\s*(sign in|not found|no access|access denied|forbidden)\b/i.test(text))
  );
};

async function visit(
  context: BrowserContext,
  who: Identity,
  width: number,
  route: string,
  links: Set<string>,
) {
  await resetLimits();
  const page: Page = await context.newPage();
  const problems: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 160)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).origin === origin)
      failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  const expected = expectation(who.role, route.split('?')[0]!);
  let status = 0;
  try {
    const response = await page.goto(origin + route, { waitUntil: 'load', timeout: 30000 });
    status = response?.status() ?? 0;
    await page
      .locator('h1')
      .first()
      .waitFor({ state: 'attached', timeout: 8000 })
      .catch(() => undefined);
    await page.waitForTimeout(500);
  } catch (error) {
    problems.push(`navigation: ${(error as Error).message.slice(0, 120)}`);
  }
  const finalPath = (() => {
    const u = new URL(page.url());
    return u.pathname + u.search;
  })();
  const text = await page
    .locator('main')
    .first()
    .innerText()
    .catch(() => '');
  const actual = looksGated(new URL(page.url()).pathname, route, status, text)
    ? 'gated'
    : 'content';
  if (process.argv.includes('--shots')) {
    const name = `${who.role}-${width}-${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.png`;
    mkdirSync(resolve(outDir, 'shots'), { recursive: true });
    await page.screenshot({ path: resolve(outDir, 'shots', name), fullPage: true });
  }
  let measure: unknown;
  // Page length limits are the signed-in rule: sign-in, setup and recovery pages and the home page have their own limits.
  const judged = { signedIn: ['customer', 'staff'].includes(routeArea(route.split('?')[0]!)) };
  if (actual === 'content') {
    // A measurement that cannot be taken is a finding, never a silent pass: it would hide every check below.
    const m = await measurePage(page, route, status, measureOptions).catch((error: unknown) => {
      problems.push(`measure failed: ${(error as Error).message.split('\n')[0]!.slice(0, 140)}`);
      return undefined;
    });
    measure = m;
    if (m) problems.push(...targetsBroken(m, judged));
    const nav = await page.locator('nav a[href], header a[href]').count();
    if (!nav && !/\/(signin|setup)/.test(route)) problems.push('no navigation links found');
    for (const href of harvestLinks(
      await page
        .locator('nav a[href^="/"], main a[href^="/"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute('href'))),
    ))
      links.add(href);
    // Every tab is opened and measured in its own state: a tab that is not shown first is still a page the person sees.
    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count().catch(() => 0);
    for (let i = 0; i < tabCount; i++) {
      const tab = tabs.nth(i);
      const label = ((await tab.innerText().catch(() => '')) || `tab ${i + 1}`)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
      if (!(await tab.isVisible().catch(() => false))) continue;
      if ((await tab.getAttribute('aria-selected')) === 'true') continue;
      const tabProblems: string[] = [];
      try {
        await tab.click({ timeout: 5000 });
        await page.waitForTimeout(250);
        if (process.argv.includes('--shots')) {
          const tabName = `${who.role}-${width}-${tabRoute(route, label)
            .replace(/[^a-z0-9]+/gi, '_')
            .slice(0, 100)}.png`;
          await page.screenshot({ path: resolve(outDir, 'shots', tabName), fullPage: true });
        }
        const tm = await measurePage(page, tabRoute(route, label), status, measureOptions);
        tabProblems.push(...targetsBroken(tm, judged));
        rows.push(tabRow(who, width, tabRoute(route, label), finalPath, status, tabProblems, tm));
      } catch (error) {
        tabProblems.push(
          `tab "${label}": ${(error as Error).message.split('\n')[0]!.slice(0, 120)}`,
        );
        rows.push(tabRow(who, width, tabRoute(route, label), finalPath, status, tabProblems));
      }
      appendFileSync(reportFile, JSON.stringify(rows[rows.length - 1]) + '\n');
    }
  }
  if (expected !== actual) problems.push(`access: expected ${expected}, got ${actual}`);
  for (const f of new Set(failed))
    if (!(expected === 'gated' && /^40[134]/.test(f))) problems.push(`request ${f}`);
  const row: Row = {
    role: who.role,
    width,
    route,
    finalPath,
    status,
    expected,
    actual,
    problems: [...new Set(problems)],
    measure,
  };
  rows.push(row);
  appendFileSync(reportFile, JSON.stringify(row) + '\n');
  await page.close();
}

async function sweepRole(browser: Browser, who: Identity, secretFile: string) {
  const all = discoverRoutes(resolve('apps/web/app'));
  const base = all.filter(
    (r) => !isDynamic(r) && (r.startsWith('/account') || r.startsWith('/operator') || r === '/'),
  );
  const dynamic = all
    .filter(isDynamic)
    .map((r) => fillRoute(r, who.ids))
    .filter((r): r is string => !!r);
  const storageState = who.staff ? await signInStaff(browser, who, secretFile) : undefined;
  const links = new Set<string>();
  const state = stateRoutes(who.ids);
  // 1440 first: it harvests the links that 390 and 768 then open too. Links found at a narrower width are opened there.
  for (const width of sweepWidthOrder) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      storageState,
    });
    // tsx keeps function names with a __name helper; functions sent to the page need it defined.
    await context.addInitScript('globalThis.__name = (fn) => fn;');
    if (who.cookies) await context.addCookies(who.cookies);
    const queue = buildQueue({ base, dynamic, state, links: [...links].slice(0, 120) });
    for (const route of queue) await visit(context, who, width, route, links);
    for (const route of [...links].filter((l) => !queue.includes(l)).slice(0, 80))
      await visit(context, who, width, route, links);
    await context.close();
    note(
      `  ${who.role} ${width}px done (${rows.filter((r) => r.role === who.role).length} visits)`,
    );
  }
}

// ---- main -----------------------------------------------------------------------------------------------------------

try {
  let identities: Identity[];
  let secretFile = resolve(outDir, 'staff-authenticator.json');
  if (remoteBase) {
    const file = JSON.parse(readFileSync(process.env.QA_SWEEP_IDENTITIES!, 'utf8')) as Record<
      string,
      Omit<Identity, 'role'>
    >;
    identities = Object.entries(file).map(([role, value]) => ({
      ...value,
      role: role as SweepRole,
      ids: value.ids ?? {},
    }));
  } else {
    note('Preparing the local database and application');
    const prepared = await localSetup();
    identities = prepared.identities;
    secretFile = prepared.staffSecretFile;
    // --serve: keep the seeded application running and write the identities, so a layout can be tried page by page
    // (for example with a style injected in the browser) without a new build and a full sweep each time.
    if (process.argv.includes('--serve')) {
      writeFileSync(resolve(outDir, 'identities.json'), JSON.stringify(identities));
      note(`Serving; identities in ${outDir}/identities.json`);
      await new Promise(() => undefined);
    }
  }
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  );
  try {
    for (const who of identities.filter((i) => roles.includes(i.role))) {
      note(`Sweeping ${who.role}`);
      await sweepRole(browser, who, secretFile);
    }
  } finally {
    await browser.close();
    await resetPool?.end();
  }
  const bad = rows.filter((r) => r.problems.length);
  const lines = [
    `# Signed-in sweep ${stamp}`,
    '',
    `Visits: ${rows.length}. Pages with a finding: ${new Set(bad.map((r) => `${r.role} ${r.route}`)).size}.`,
    '',
    '| Role | Width | Route | Final | Status | Findings |',
    '| --- | --- | --- | --- | --- | --- |',
    ...bad.map(
      (r) =>
        `| ${r.role} | ${r.width} | ${r.route} | ${r.finalPath} | ${r.status} | ${r.problems.join('; ').replace(/\|/g, '/')} |`,
    ),
  ];
  writeFileSync(resolve(outDir, 'summary.md'), lines.join('\n') + '\n');
  note(`Report: ${outDir}/summary.md (${bad.length} visits with findings of ${rows.length})`);
} finally {
  stopServer();
}
