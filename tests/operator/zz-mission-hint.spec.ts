import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { clearSignInLimits, totp } from './operator-signin';
import { MISSION_A, MISSION_B, NOTE, UNLISTED, commercial, listed } from './mission-hint-fixture';

// W5 on the real /operator route: a mission hint (`?mission=<id>#workspace-research`) opens only the section it
// names, once per page load, and never over the person's own choice. The signed-in workspace, its router and
// both sections are the real ones; only the two mission lists are answered here. The team shell switch decides
// whether a section that is left stays mounted, so the expected value on return depends on it: run this file
// with CORRIDRA_UX_SHELLS_V2=true as well as without.
const shells = process.env.CORRIDRA_UX_SHELLS_V2 === 'true';

async function openWorkspace(page: Page) {
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8')),
    seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8')),
    { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  await clearSignInLimits(local.ownerPassword);
  // A code from an earlier test in the same 30 second step could be refused as a replay.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  // Only the list the Research section reads (`filter=all`) is answered; the Missions section reads the same
  // path with another shape and keeps the real answer.
  await page.route(
    (url) => url.pathname === '/api/workspace/missions' && url.searchParams.get('filter') === 'all',
    (route) => route.fulfill({ json: { missions: listed, owners: [], total: listed.length } }),
  );
  await page.route('**/api/workspace/opportunities?*', (route) =>
    route.fulfill({ json: commercial }),
  );
  // The workspace is loaded; a navigation sent during its own address update can be aborted, so the first
  // address below is opened with a retry.
  await expect(page.getByText('Your access:')).toBeVisible();
  return seed.tenantId as string;
}
const address = (tenant: string, mission: string, section: string) =>
  `/operator?workspace=${encodeURIComponent(tenant)}&mission=${mission}#${section}`;
// A full page load, which also starts a new page life for the hints already used.
async function load(page: Page, to: string) {
  await expect(async () => {
    await page.goto(to);
  }).toPass({ timeout: 30000 });
}
const research = (page: Page) =>
  page.locator('#workspace-research').getByLabel('Shortlist mission');
const commercialPanel = (page: Page) =>
  page.locator('#workspace-commercial').getByLabel('Commercial report mission');
const goTo = (page: Page, section: string) =>
  page.evaluate((id) => {
    window.location.hash = id;
  }, section);

test('W5-real-1 a hint for Research opens Research only, and a later choice survives leaving and returning', async ({
  page,
}) => {
  test.setTimeout(180000);
  const tenant = await openWorkspace(page);
  await load(page, address(tenant, MISSION_A, 'workspace-research'));
  await expect(research(page)).toBeVisible({ timeout: 30000 });
  await expect(research(page).locator('option')).toHaveCount(3);
  await expect(research(page)).toHaveValue(MISSION_A);
  await expect(page.getByText(NOTE)).toHaveCount(0);
  // With the team shell off both panels are mounted at once; the other one must not take the hint.
  if (shells) await expect(commercialPanel(page)).toHaveCount(0);
  else {
    await expect(commercialPanel(page).locator('option')).toHaveCount(3);
    await expect(commercialPanel(page)).toHaveValue('');
  }
  // The person's own choice wins, and leaving the section and coming back does not bring the hint back.
  await research(page).selectOption(MISSION_B);
  await goTo(page, 'workspace-meetings');
  await expect(page.locator('#workspace-meetings')).toBeVisible();
  await goTo(page, 'workspace-research');
  await expect(research(page)).toBeVisible();
  await expect(research(page).locator('option')).toHaveCount(3);
  await expect(research(page)).toHaveValue(shells ? '' : MISSION_B);
  await expect(page.getByText(NOTE)).toHaveCount(0);
});

test('W5-real-2 a hint for Commercial opens Commercial only, and an unlisted mission shows the note once', async ({
  page,
}) => {
  test.setTimeout(180000);
  const tenant = await openWorkspace(page);
  await load(page, address(tenant, MISSION_A, 'workspace-commercial'));
  await expect(commercialPanel(page)).toBeVisible({ timeout: 30000 });
  await expect(commercialPanel(page)).toHaveValue(MISSION_A);
  // The Research panel is mounted but hidden with the team shell off, and not mounted at all with it on.
  if (!shells) await expect(research(page)).toHaveValue('');
  await load(page, address(tenant, UNLISTED, 'workspace-commercial'));
  await expect(commercialPanel(page)).toBeVisible({ timeout: 30000 });
  await expect(commercialPanel(page).locator('option')).toHaveCount(3);
  await expect(commercialPanel(page)).toHaveValue('');
  await expect(page.getByText(NOTE)).toHaveCount(1);
  await goTo(page, 'workspace-meetings');
  await goTo(page, 'workspace-commercial');
  await expect(commercialPanel(page)).toBeVisible();
  await expect(commercialPanel(page).locator('option')).toHaveCount(3);
  await expect(page.getByText(NOTE)).toHaveCount(shells ? 0 : 1);
});
