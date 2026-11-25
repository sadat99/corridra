#!/usr/bin/env node
// Smoke check: node .cache/audit/check.mjs [role=owner] [--shots]  Loads the main screens with the saved storage state and
// lists redirects to sign-in and every /api answer that is not 2xx. Uses load + 2 s (never networkidle).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseUrl, here, pw, readJson } from './lib.mjs';
const role = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'owner';
const shots = process.argv.includes('--shots');
const env = readJson(resolve(here, 'env.json'));
const account = env.accounts.find((a) => a.role === role);
const w = `workspace=${env.tenantId}`;
const staffPaths = [
  '',
  'missions',
  `missions/${env.seeded.missionIds.quoteSent}`,
  `missions/${env.seeded.missionIds.pipeline}`,
  'research',
  'meetings',
  'commercial',
  'delivery',
  'sources',
  'evidence',
  'assistance',
  'network',
  'operations',
  'dashboard',
  'control-center',
  'health',
  'readiness',
  'settings',
  'audit',
  'controls',
  'inbox',
  'supply',
  'supply/do-not-contact',
  'problem-reports',
].map((p) => `/operator${p ? '/' + p : ''}?${w}`);
const paths =
  account.kind === 'staff'
    ? staffPaths
    : account.kind === 'helper'
      ? [`/contributor?${w}`, '/contributor/me']
      : (() => {
          const ws = env.seeded.customers.workspaces[role];
          return [
            '/account',
            '/account/move',
            '/account/all-tools',
            '/account/companies',
            '/account/delegations',
            `/account/delegations/${ws}`,
            '/account/meetings',
            '/account/service-requests',
            `/account/service-requests/${ws}`,
            '/account/billing',
            `/account/billing/${ws}`,
            '/account/profile',
            `/account/profile/${ws}`,
            '/account/problem-reports',
          ];
        })();
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({
  baseURL: baseUrl,
  storageState: account.storageState,
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
let bad = [];
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/') && r.status() >= 400) bad.push(`${r.status()} ${u.pathname}`);
});
if (shots) mkdirSync(resolve(here, 'shots'), { recursive: true });
let failed = 0;
for (const path of paths) {
  bad = [];
  const response = await page.goto(path, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const final = new URL(page.url());
  const signin = final.pathname.includes('signin');
  const text = (
    await page
      .locator('main')
      .first()
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  const notAvailable = /not available|unavailable|could not be loaded/i.test(text);
  if (signin || (response?.status() ?? 0) >= 400) failed += 1;
  console.log(
    `${response?.status()} ${path.replace(/\?.*/, '')} -> ${final.pathname}${signin ? '  SIGN-IN REDIRECT' : ''}${notAvailable ? '  [says unavailable]' : ''}  chars=${text.length}${bad.length ? '  api: ' + [...new Set(bad)].join(', ') : ''}`,
  );
  if (shots)
    await page.screenshot({
      path: resolve(
        here,
        'shots',
        `${role}-${path.replace(/\?.*/, '').replace(/[^a-z0-9]+/gi, '_')}.png`,
      ),
    });
}
await browser.close();
process.exit(failed ? 1 : 0);
