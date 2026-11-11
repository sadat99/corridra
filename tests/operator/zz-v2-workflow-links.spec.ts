import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { clearSignInLimits, totp } from './operator-signin';
import { openSection } from './workspace-nav';

// The five "Mission workflow" shortcuts on the team workspace start page open the section they name, with the team
// shell (CORRIDRA_UX_SHELLS_V2) off and on. With it on only the section in view is in the page, so a target is not
// there before the click: the check is the outcome of the click, not the presence of the target. This file signs in
// by itself (it enrols the authenticator when the database has none), so it can run alone with the switch on.
const secretFile = '.cache/part06-browser-authenticator.json';

async function signIn(page: Page) {
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8')),
    seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  await clearSignInLimits(local.ownerPassword);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Set up your authenticator|Verify your authenticator/ }),
  ).toBeVisible();
  let secret: string;
  if (await page.getByRole('heading', { name: 'Set up your authenticator' }).isVisible()) {
    await page.getByRole('button', { name: 'Set Up Authenticator', exact: true }).click();
    secret = await page.getByLabel('Authenticator setup key').inputValue();
    await writeFile(secretFile, JSON.stringify({ secret }), { mode: 0o600 });
  } else {
    secret = JSON.parse(await readFile(secretFile, 'utf8')).secret;
  }
  // A code is refused a second time in the same 30 second step, so wait for the next one.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and Open Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.' })).toBeVisible();
  await expect(page.getByText('Your access:')).toBeVisible();
}

test('each Mission workflow shortcut opens the section it names', async ({ page }) => {
  test.setTimeout(180000);
  await signIn(page);
  await openSection(page, 'main');
  const shortcuts = page.getByRole('navigation', { name: 'Mission workflow' });
  const hrefs = await shortcuts
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs).toHaveLength(5);
  for (const href of hrefs) {
    expect(href).toMatch(/^#workspace-[a-z-]+$/);
    const section = page.locator(href);
    await shortcuts.locator(`a[href="${href}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(section).toBeVisible();
    await expect(section).toBeFocused();
    await expect(
      page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
    ).toHaveCount(0);
    await openSection(page, 'main');
  }
  // An address that names no section still says so, and a shortcut clears the note.
  await page.evaluate(() => {
    window.location.hash = 'missing-tool';
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toBeVisible();
  await shortcuts.getByRole('link', { name: 'Missions and requirements', exact: false }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toHaveCount(0);
});
