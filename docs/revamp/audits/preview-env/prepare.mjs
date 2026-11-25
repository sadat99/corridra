#!/usr/bin/env node
// Audit preview preparation. Run AFTER serve.sh is up:  node .cache/audit/prepare.mjs
// Installs the optional local modules, seeds synthetic data through the app's own APIs, creates the role accounts,
// saves signed-in storage states and writes env.json. Everything is invented: "Synthetic ..." and @example.invalid only.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseUrl, client, cookieClient, here, ownerPool, pw, readJson, repo } from './lib.mjs';
import { totp } from './totp.mjs';
import { seedStaff } from './seed-staff.mjs';
import { seedCustomers } from './seed-customers.mjs';

const t0 = Date.now();
const log = (line) => console.log(`[prepare +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`);
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. wait for the server (a static file, so no page read caches a "module missing" probe before the install)
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(2000) })).status < 500) break;
  } catch { /* not listening yet */ }
  if (i > 180) throw new Error('The server at 127.0.0.1:3200 did not answer within 3 minutes. Start serve.sh first.');
  await sleep(1000);
}
const seed = readJson(resolve(repo, '.cache/part03-browser.json'));
const customers = readJson(resolve(here, 'customers.json'));
const envFile = resolve(here, 'env.json');
if (existsSync(envFile) && readJson(envFile).tenantId === seed.tenantId && !process.argv.includes('--force')) {
  log('This server run is already prepared (env.json has the same workspace). Restart serve.sh for a fresh one, or pass --force.');
  process.exit(0);
}
log('server is up; installing optional modules');
const installed = JSON.parse(
  execFileSync('pnpm', ['exec', 'tsx', '.cache/audit/install.ts'], { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }).trim().split('\n').pop(),
);
for (const [name, state] of Object.entries(installed)) if (state !== 'ok') problems.push(`install ${name}: ${state}`);

const pool = ownerPool();
const resetLimits = async () => {
  await pool.query('DELETE FROM app.intake_rate_limit');
  await pool.query('DELETE FROM identity."rateLimit"');
};
const browser = await pw.chromium.launch();
const statePath = (role) => resolve(here, `state-${role}.json`);

/** Signs a staff or helper account in (enrols an authenticator on first use) and saves the storage state. */
async function staffSignIn({ role, email, password, totpSecret, door = '/operator/signin' }) {
  await resetLimits();
  const ctx = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(door, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const setUp = page.getByRole('button', { name: 'Set Up Authenticator', exact: true });
  const code = page.getByLabel('Six-digit code', { exact: true });
  await setUp.or(code).first().waitFor({ timeout: 20000 });
  let secret = totpSecret;
  if (await setUp.isVisible()) {
    await setUp.click();
    await page.getByLabel('Authenticator setup key').waitFor({ timeout: 20000 });
    secret = await page.getByLabel('Authenticator setup key').inputValue();
  }
  // Never submit a code in the last seconds of its 30 s window.
  if (30 - ((Date.now() / 1000) % 30) < 4) await sleep(4500);
  await code.fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/signin'), { timeout: 30000 });
  await page.waitForTimeout(2000);
  await ctx.storageState({ path: statePath(role) });
  return { ctx, page, account: { role, email, password, totpSecret: secret, storageState: statePath(role), signInAt: door } };
}

const accounts = [];
log('signing in the owner');
const owner = await staffSignIn({ role: 'owner', email: 'browser@example.invalid', password: seed.password });
accounts.push({ ...owner.account, kind: 'staff' });
const api = client(owner.ctx.request);
const tenantId = seed.tenantId;

log('seeding staff data (companies, missions, quotations, meetings, opportunities)');
const staff = await seedStaff({ api, tenantId, ownerId: seed.principalId, resetLimits, log, problems });

// 2. stand-in customer sessions (scripts/qa/fake-neon-auth.mjs answers for these made-up tokens)
const cookieName = '__Secure-neon-auth.session_token';
const standIn = Object.fromEntries(customers.users.map((u) => [u.role, u]));
async function customerContext(u) {
  const ctx = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: cookieName, value: u.token, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  return ctx;
}
const customerApi = (_ctx, u) => cookieClient(`${cookieName}=${u.token}`, { 'x-corridra-customer-subject': u.subject, 'x-corridra-customer-issuer': customers.base });

// 3. team members: the owner invites, the invited person accepts through the app's own setup route, then signs in
log('inviting team members and the field helper');
const invites = {};
for (const role of ['admin', 'operator', 'reviewer', 'viewer']) {
  const u = standIn[role];
  const r = await api('POST', `/api/team-control/invites?tenant=${tenantId}`, { action: 'invite', invite: { commandId: randomUUID(), email: u.email, name: u.name, role } });
  if (!r.ok) { problems.push(`invite ${role}: ${r.status} ${r.text.slice(0, 160)}`); continue; }
  invites[role] = r.json;
}
const helperInvite = await api('POST', `/api/workspace/network-invitation?tenant=${tenantId}`, { action: 'invite', commandId: randomUUID(), name: standIn.helper.name, email: standIn.helper.email, operatingCountry: 'DE' });
if (!helperInvite.ok) problems.push(`invite helper: ${helperInvite.status} ${helperInvite.text.slice(0, 160)}`);
// One invitation stays pending so the Team screen has a waiting row.
const pending = await api('POST', `/api/team-control/invites?tenant=${tenantId}`, { action: 'invite', invite: { commandId: randomUUID(), email: 'audit-pending-invite@example.invalid', name: 'Synthetic Pending Invitee', role: 'operator' } });
if (!pending.ok) problems.push(`invite pending: ${pending.status} ${pending.text.slice(0, 160)}`);

for (const role of ['admin', 'operator', 'reviewer', 'viewer', 'helper']) {
  if (role === 'helper' ? !helperInvite.ok : !invites[role]) continue;
  const u = standIn[role], password = randomBytes(18).toString('base64url');
  const ctx = await customerContext(u);
  const kind = role === 'helper' ? '?kind=contributor' : '';
  const done = await customerApi(ctx, u)('POST', `/api/operator-setup${kind}`, { password });
  await ctx.close();
  if (!done.ok) { problems.push(`setup ${role}: ${done.status} ${done.text.slice(0, 160)}`); continue; }
  try {
    const s = await staffSignIn({ role, email: u.email, password, door: role === 'helper' ? '/contributor/signin' : '/operator/signin' });
    accounts.push({ ...s.account, kind: role === 'helper' ? 'helper' : 'staff', landedOn: new URL(s.page.url()).pathname + new URL(s.page.url()).search });
    if (role === 'helper') staff.helperCtx = s.ctx; else await s.ctx.close();
  } catch (error) {
    problems.push(`sign-in ${role}: ${String(error.message).split('\n')[0]}`);
  }
}

// 4. customers (buyer, organiser, participant, seller) and the customer-facing records
log('seeding customer workspaces, programme, service requests');
const customerSeed = await seedCustomers({ api, tenantId, customers, standIn, customerContext, customerApi, resetLimits, problems, pool, staff, ownerId: seed.principalId, helperPrincipalId: helperInvite.json?.principalId, reviewerId: invites.admin?.principalId });
for (const role of ['customer', 'organiser', 'participant', 'seller']) {
  const ctx = await customerContext(standIn[role]);
  await ctx.storageState({ path: statePath(role) });
  await ctx.close();
  accounts.push({ role, kind: 'customer', email: standIn[role].email, password: null, totpSecret: null, storageState: statePath(role), signInAt: 'cookie only (test sign-in stand-in); open /account', apiHeaders: { 'x-corridra-customer-subject': standIn[role].subject, 'x-corridra-customer-issuer': customers.base } });
}
if (staff.helperCtx) await staff.helperCtx.close();
delete staff.helperCtx;

// 5. verify with a fresh context from the saved owner state
log('verifying pages and endpoints with state-owner.json');
const check = await browser.newContext({ baseURL: baseUrl, storageState: statePath('owner'), viewport: { width: 1440, height: 900 } });
const page = await check.newPage();
const sampleMission = staff.missions.quoteSent?.id ?? Object.values(staff.missions)[0]?.id;
const w = `workspace=${tenantId}`;
const urls = {
  today: `/operator?${w}`,
  missions: `/operator/missions?${w}`,
  mission: `/operator/missions/${sampleMission}?${w}`,
  research: `/operator/research?${w}`,
  controls: `/operator/controls?${w}`,
  operations: `/operator/operations?${w}`,
};
const pages = {};
for (const [name, url] of Object.entries(urls)) {
  const response = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const final = new URL(page.url());
  pages[name] = { url, status: response?.status() ?? 0, finalPath: final.pathname, ok: (response?.status() ?? 0) < 400 && !final.pathname.includes('signin') };
  if (!pages[name].ok) problems.push(`page ${name}: ${JSON.stringify(pages[name])}`);
}
const endpoints = {};
const checkApi = client(check.request);
for (const path of ['workspace/customer-erasure-queue', 'workspace/customer-service-requests', 'workspace/customer-billing', 'supply/state', 'supply/sources', 'supply/missions', 'team-control/invites', 'team-control/route-pack', 'workspace/ai-connect', 'workspace/problem-reports', 'workspace/programme-applications', 'helper-interest?view=installed', 'team-control/today']) {
  const r = await checkApi('GET', `/api/${path}${path.includes('?') ? '&' : '?'}tenant=${tenantId}`);
  endpoints[path] = r.status;
  if (!r.ok) problems.push(`endpoint ${path}: ${r.status}`);
}
const today = (await checkApi('GET', `/api/team-control/today?tenant=${tenantId}`)).json;
await check.close();
await owner.ctx.close();
await browser.close();
await pool.end();

const missionUrls = Object.fromEntries(Object.entries(staff.missions).map(([k, v]) => [k, `/operator/missions/${v.id}?${w}`]));
writeFileSync(
  envFile,
  JSON.stringify(
    {
      baseUrl, tenantId, preparedAt: new Date().toISOString(), teamDeskV41: readJson2(resolve(here, 'mode')),
      note: 'Synthetic data only. Storage states die when serve.sh restarts (the database is recreated): run prepare.mjs again.',
      accounts,
      seeded: {
        missionIds: Object.fromEntries(Object.entries(staff.missions).map(([k, v]) => [k, v.id])),
        missionStatus: Object.fromEntries(Object.entries(staff.missions).map(([k, v]) => [k, v.status ?? 'submitted'])),
        companyIds: staff.companies.map((c) => c.id),
        targetIds: staff.targets, rfqIds: staff.rfqs, quotationIds: staff.quotations,
        meetings: staff.meetings, opportunities: staff.opportunities, replyLinks: staff.replyLinks ?? [],
        customers: customerSeed,
        exampleUrls: {
          ...urls, missionByStage: missionUrls,
          company: staff.companies[0] ? `/operator/research?${w}&id=${staff.companies[0].id}` : null,
          supply: `/operator/supply?${w}`, inbox: `/operator/inbox?${w}`, problemReports: `/operator/problem-reports?${w}`,
          customerHome: '/account', helperHome: `/contributor?${w}`, publicReply: (staff.replyLinks ?? [])[0] ?? null,
        },
      },
      todayCounts: today, verified: { pages, endpoints }, installed,
      gapsStillOpen: [...new Set([
        ...problems, ...(customerSeed.gaps ?? []),
        'helper interest register: module installed (200, installed:true) but no rows; the public form answers 404 because it needs real admission open (HELPER_INTEREST_FIXTURE path), which this preview keeps closed',
        'supply candidates: none (a candidate needs a counterparty profile version and no HTTP route saves one); sources and the mission list are populated',
        'simulated payments, real billing, real invoicing, mission mail, notifications v2: controls closed (need real-use configuration)',
        'erasure queue and programme applications: endpoints answer 200 with empty lists',
        'evidence uploads: storage not configured locally (uploadsConfigured false); AI assistance: no model policy seeded',
      ])],
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
function readJson2(p) { try { return (execFileSync('cat', [p], { encoding: 'utf8' }).trim() || 'on') === 'on'; } catch { return null; } }
log(`done. accounts: ${accounts.map((a) => a.role).join(', ')}; open problems: ${problems.length}`);
for (const p of problems) console.log('  - ' + p);
