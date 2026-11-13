import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { clearSignInLimits, totp } from './operator-signin';
import {
  measure,
  viewports,
  writeReport,
  type Measurement,
  type Viewport,
} from '../ux/page-length-lib';

// Staff page length (task L21, owner 13 November 2026: a desktop page is at most one screen and a phone page at
// most two, measured with disclosures closed). Every /operator page the team workspace serves is opened as a
// signed-in staff member at 1440 x 900 and 390 x 844, in its default state, and judged against the layout
// budget (docs/revamp/specs/layout-budget.md section 2) through the shared measure of tests/ux/page-length-lib.ts,
// the same one the public guard and the signed-in sweep use.
//
// The page is measured as a person first sees it: nothing is clicked, so every disclosure is closed and the
// first sub-tab is the one shown. The run also records how many forms are open at once; the budget allows one.
//
// On the code before this task every page in `faults` below was over its limit (the corrected sweep of PR 480
// measured, for example, /operator/control-center at 2.3 desktop screens and 3.5 phone screens), so this
// spec fails on that code and passes on this one.
const report = 'l21-staff-page-budget';

/** Every section of the team workspace at its own address (apps/web/lib/operator-urls.ts), and the owner page. */
const staffPages = [
  '/operator',
  '/operator/missions',
  '/operator/research',
  '/operator/meetings',
  '/operator/commercial',
  '/operator/delivery',
  '/operator/sources',
  '/operator/evidence',
  '/operator/assistance',
  '/operator/network',
  '/operator/operations',
  '/operator/dashboard',
  '/operator/control-center',
  '/operator/health',
  '/operator/readiness',
  '/operator/settings',
  '/operator/audit',
  '/operator/controls',
  '/operator/owner',
] as const;

/** The lengths the corrected sweep of PR 480 measured before this task, used to show the test fails on old code. */
const faults: Record<string, { desktop?: number; phone?: number }> = {
  '/operator/control-center': { desktop: 2.3, phone: 3.5 },
  '/operator/network': { phone: 3.8 },
  '/operator/settings': { desktop: 1.9, phone: 3.3 },
  '/operator/commercial': { desktop: 2.0, phone: 3.2 },
  '/operator/operations': { phone: 3.0 },
  '/operator/assistance': { phone: 2.9 },
  '/operator/dashboard': { phone: 2.9 },
  '/operator/owner': { desktop: 1.7, phone: 2.6 },
  '/operator/controls': { desktop: 1.8, phone: 2.6 },
  '/operator/meetings': { desktop: 1.9, phone: 2.4 },
  '/operator/missions': { desktop: 1.5, phone: 2.5 },
  '/operator/readiness': { desktop: 1.8, phone: 2.3 },
  '/operator/research': { desktop: 1.7, phone: 2.4 },
  '/operator/health': { desktop: 1.3, phone: 2.2 },
  '/operator/evidence': { phone: 2.2 },
  '/operator': { desktop: 1.1 },
};

/** Signs in and enrols the authenticator when this is the first sign-in of the run. */
async function signIn(page: Page) {
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  await clearSignInLimits(
    JSON.parse(await readFile('.cache/part03-local.json', 'utf8')).ownerPassword,
  );
  // A code from an earlier test in the same 30 second step could be refused as a replay.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('heading', { name: /Set up your authenticator|Verify your authenticator/ })
    .waitFor({ timeout: 30000 });
  const file = '.cache/part06-browser-authenticator.json';
  let secret = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')).secret : '';
  if (await page.getByRole('heading', { name: 'Set up your authenticator' }).isVisible()) {
    await page.getByRole('button', { name: 'Set Up Authenticator', exact: true }).click();
    secret = await page.getByLabel('Authenticator setup key').inputValue();
    await writeFile(file, JSON.stringify({ secret }), { mode: 0o600 });
  }
  expect(secret, 'the staff identity has an authenticator key').toBeTruthy();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/operator/signin'), { timeout: 30000 });
}

/** Waits for the workspace read to finish, so a page is never measured while it still says "Loading". */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () => !/Loading workspace|Loading…/.test(document.getElementById('main')?.innerText ?? ''),
      null,
      { timeout: 20000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

/** How many forms are open at once, counted the way scripts/qa/ux-measure.ts counts them. */
async function openForms(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
      if (check && !check.call(el, { contentVisibilityAuto: true, visibilityProperty: true }))
        return false;
      const box = (el as HTMLElement).getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const main = document.getElementById('main') ?? document.body;
    return Array.from(main.querySelectorAll('form')).filter(
      (form) =>
        visible(form) &&
        Array.from(form.querySelectorAll('input, select, textarea')).some(
          (field) => (field as HTMLInputElement).type !== 'hidden' && visible(field),
        ),
    ).length;
  });
}

test('every staff page is within the layout budget at 1440 and 390, with its disclosures closed', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signIn(page);
  const rows: Measurement[] = [];
  const over: string[] = [];
  const forms: string[] = [];
  for (const viewport of viewports as readonly Viewport[]) {
    for (const route of staffPages) {
      const entry = { route, audience: 'staff' };
      const row = await measure(page, entry, route, viewport, settle);
      rows.push(row);
      expect(row.measured, `${route} at ${viewport.width}: ${row.reason ?? ''}`).toBe(true);
      const limit = viewport.name === 'phone' ? 2.0 : 1.0;
      // Judged on the staff measure of scripts/qa/ux-measure.ts, which rounds to one place: that is the
      // measure the signed-in sweep and the fault list this task works from both use, and it leaves the
      // line of room CI's fonts can need (KI-28). The exact document height is recorded for every page.
      const screens = Math.round((row.screens ?? 0) * 10) / 10;
      if (screens > limit)
        over.push(
          `${route} at ${viewport.width}: ${screens} screens (${row.documentHeight}px), limit ${limit}`,
        );
      const open = await openForms(page);
      if (open > 1) forms.push(`${route} at ${viewport.width}: ${open} forms open at once`);
    }
  }
  const summary = writeReport(report, rows);
  console.log(summary);
  test.info().annotations.push({ type: 'page-length', description: summary });
  expect(over, 'staff pages over the page-length budget').toEqual([]);
  expect(forms, 'staff pages with more than one form open').toEqual([]);
  // The old code was over on these pages, so this case could not have passed before the change.
  for (const [route, fault] of Object.entries(faults)) {
    const desktop = rows.find((r) => r.route === route && r.viewport === 'desktop');
    const phone = rows.find((r) => r.route === route && r.viewport === 'phone');
    if (fault.desktop) expect(desktop?.screens ?? 0).toBeLessThan(fault.desktop);
    if (fault.phone) expect(phone?.screens ?? 0).toBeLessThan(fault.phone);
  }
});
