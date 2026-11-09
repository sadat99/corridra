import AxeBuilder from '@axe-core/playwright';
import { test, expect, evidence, signInOwner, qaSeed } from '../fixtures';

// V-06 (shell part), V-05 (client), V-45 (infrastructure) and D14 on the verification server: the
// Team shell with the seeded QA owner. One sign-in per width keeps inside the sign-in rate limit.

test('V-06 and D14: the Team shell has the sidebar, renders one section at a time and keeps every section reachable', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const seed = await signInOwner(page);
  await expect(page.locator('h1')).toHaveText('Today');
  await expect(page).toHaveTitle('Today | Corridra');
  const header = page.locator('header.ux-app-header[data-shell="team"]');
  await expect(header).toBeVisible();
  await expect(header.locator('.ux-app-status')).toContainText('Preview');
  // D14: no public marketing header inside the Team shell.
  await expect(page.locator('#public-navigation')).toHaveCount(0);
  const sidebar = page.getByRole('navigation', { name: 'Team sections' });
  const toggle = page.getByRole('button', { name: 'Sections', exact: true });
  const phone = info.project.name !== 'w1280';
  // Opens the phone drawer only when it is closed, and waits until it is open and shown.
  const openDrawer = async () => {
    if (!phone) return;
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeVisible();
  };
  if (phone) {
    await expect(sidebar).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(sidebar).toBeVisible();
  // Navigation v1: the five daily items are links and Admin (owner and admin) opens to list its five.
  for (const name of ['Today', 'Missions', 'Companies', 'Meetings', 'Money'])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(sidebar.locator('summary', { hasText: 'Admin' })).toBeVisible();
  // Every sidebar target is at least 44 pixels tall.
  for (const box of await sidebar
    .locator('a, summary')
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.getBoundingClientRect().height),
    ))
    expect(box).toBeGreaterThanOrEqual(44);
  await expect(sidebar.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // S-05: the sidebar has no accessibility violations and the page has no sideways scroll.
  const axe = await new AxeBuilder({ page })
    .include('#workspace-navigation')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await evidence(page, `V-06-today-${info.project.name}`);

  // Tab order: Today, Missions, Companies, Meetings, Money, then the Admin summary. A closed group's
  // links are not in the order. Enter and Space both toggle the group and focus stays on its summary.
  const focusedText = () =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute('title') ??
        document.activeElement?.textContent?.trim() ??
        '',
    );
  await sidebar.getByRole('link', { name: 'Today', exact: true }).focus();
  const order: string[] = [];
  for (let step = 0; step < 5; step++) {
    await page.keyboard.press('Tab');
    order.push(await focusedText());
  }
  expect(order).toEqual(['Missions', 'Companies', 'Meetings', 'Money', 'Admin']);
  const admin = sidebar.locator('summary', { hasText: 'Admin' });
  await expect(admin).toHaveAccessibleName('Admin');
  await expect(admin).toHaveAccessibleDescription('Owner and admin');
  await admin.focus();
  await page.keyboard.press('Space');
  await expect(admin.locator('xpath=..')).toHaveAttribute('open', '');
  await expect(admin).toBeFocused();
  for (const name of ['Health', 'Readiness', 'Audit', 'People and access', 'Settings'])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(admin.locator('xpath=..')).not.toHaveAttribute('open');
  await expect(admin).toBeFocused();

  // The command palette: Ctrl K opens it, Actions list only places this role may open, Tab changes scope,
  // Up and Down move, Escape closes and focus returns, and a mission is found by its company name.
  const palette = page.getByRole('dialog', { name: 'Search missions, companies and actions' });
  const trigger = page.locator('header.ux-app-header').getByRole('button', { name: /Search/ });
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await expect(palette.getByText('Searches only what your role may open')).toBeVisible();
  const box = palette.getByRole('combobox');
  await expect(box).toBeFocused();
  await box.fill('audit');
  await expect(palette.getByRole('option', { name: /Open Audit/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(palette.getByRole('button', { name: 'Missions', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(palette.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await box.fill('QA Test');
  await expect(palette.getByRole('option', { name: /QA Test Co/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(trigger).toBeFocused();
  // The compiled response of the search route carries the private headers (the framework override, not only the handler).
  const search = await page.request.get(`/api/workspace/search?tenant=${seed.tenantId}&q=qa`);
  expect(search.status()).toBe(200);
  expect(search.headers()['referrer-policy']).toBe('no-referrer');
  expect(search.headers()['cache-control']).toContain('no-store');
  // Enter opens the selected action: Audit, by its own address.
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox').fill('open audit');
  await expect(palette.getByRole('option', { name: /Open Audit/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/operator\/audit/);
  await page.goto(`/operator?workspace=${seed.tenantId}`);
  await expect(page.locator('h1')).toHaveText('Today');
  if (phone) await openDrawer();

  // Missions opens at its own address, with the row of places under the header.
  await sidebar.getByRole('link', { name: 'Missions', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/operator/missions\\?workspace=${seed.tenantId}$`));
  await expect(page).toHaveTitle('Missions | Corridra');
  await expect(page.locator('h1')).toHaveText('Missions');
  await expect(page.locator('#workspace-missions')).toBeVisible();
  // Only the active section is rendered.
  for (const other of ['#workspace-research', '#workspace-meetings', '#workspace-delivery'])
    await expect(page.locator(other)).toHaveCount(0);
  await expect(page.locator('.ux-overview')).toHaveCount(0);
  const second = page.getByRole('navigation', { name: 'In this section' });
  for (const name of ['Missions', 'Operations', 'Network', 'Assistance'])
    await expect(second.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(second.getByRole('link', { name: 'Missions', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  for (const box of await second
    .locator('a')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height)))
    expect(box).toBeGreaterThanOrEqual(44);
  // On a phone the drawer closes itself after a navigation; wait until it has closed, then open it
  // again, so the check never races the closing drawer (main CI 74b3681, run 42018219952).
  if (phone) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await openDrawer();
  }
  await expect(sidebar.getByRole('link', { name: 'Missions', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // Companies holds Sources in its row; Admin holds Audit, and Settings holds the Owner page.
  await sidebar.getByRole('link', { name: 'Companies', exact: true }).click();
  await expect(page).toHaveURL(/\/operator\/research/);
  await page
    .getByRole('navigation', { name: 'In this section' })
    .getByRole('link', { name: 'Sources and claims', exact: true })
    .click();
  await expect(page).toHaveURL(/\/operator\/sources/);
  await openDrawer();
  await sidebar.getByText('Admin', { exact: true }).click();
  await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/operator\/settings/);
  await expect(
    page
      .getByRole('navigation', { name: 'In this section' })
      .getByRole('link', { name: 'Owner page', exact: true }),
  ).toHaveAttribute('href', '/operator/owner');
  await openDrawer();
  await sidebar.getByRole('link', { name: 'Audit', exact: true }).click();
  await expect(page).toHaveURL(/\/operator\/audit/);
  await expect(page.locator('h1')).toHaveText('Access and audit');
  await expect(page.locator('#workspace-audit')).toBeVisible();
  await expect(page.locator('#workspace-missions')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await evidence(page, `V-06-audit-${info.project.name}`);

  // Loading, failure and recovery on Today and the workspace read. A failed read says so in words a
  // screen reader announces, and the retry works once the read succeeds again.
  const todayUrl = `/operator?workspace=${seed.tenantId}`;
  await page.route('**/api/workspace/missions**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // A read the page cancels while it waits is already handled.
    await route.continue().catch(() => undefined);
  });
  await page.goto(todayUrl);
  await expect(page.getByRole('status').filter({ hasText: 'Loading today' })).toBeVisible();
  await expect(page.locator('.ux-overview')).toBeVisible();
  await page.unroute('**/api/workspace/missions**');
  await page.route('**/api/workspace/missions**', (route) =>
    route.fulfill({ status: 500, json: { error: 'unavailable' } }),
  );
  await page.goto(todayUrl);
  await expect(
    page.getByRole('status').filter({ hasText: "Today's list could not be loaded." }),
  ).toBeVisible();
  await page.unroute('**/api/workspace/missions**');
  await page.route('**/api/workspace/workspace**', (route) =>
    route.fulfill({ status: 500, json: { error: 'unavailable' } }),
  );
  await page.goto(todayUrl);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Workspace could not be loaded.' }),
  ).toBeVisible();
  await page.unroute('**/api/workspace/workspace**');
  await page.getByRole('button', { name: 'Retry Workspace' }).click();
  await expect(page.locator('.ux-overview')).toBeVisible();

  // The old # links keep working inside the shell.
  await page.goto(`/operator?workspace=${seed.tenantId}#workspace-delivery`);
  await expect(page.locator('#workspace-delivery')).toBeVisible();

  // V-45 infrastructure: the inbox opens from the header and reads only the person's own items.
  const inbox = header.getByRole('button', { name: 'Inbox', exact: true });
  await expect(inbox).toBeVisible();
  await inbox.click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing new.')).toBeVisible();
  const own = await page.request.get(`/api/notifications?tenant=${seed.tenantId}`);
  expect(own.status()).toBe(200);
  expect(await own.json()).toEqual([]);
  const foreign = await page.request.post(`/api/notifications?tenant=${seed.tenantId}`, {
    headers: { Origin: 'https://evil.example' },
    data: { id: '00000000-0000-4000-8000-000000000000' },
  });
  expect(foreign.status()).toBe(403);
  await page.keyboard.press('Escape');
  await expect(inbox).toBeFocused();

  // V-05 client: a refused action opens the re-verify dialog in place; a wrong code is shown, and
  // "Not now" closes it without losing the page.
  await page.evaluate(() => {
    (window as unknown as { stepUp: Promise<boolean> }).stepUp = new Promise((resolve) => {
      window.dispatchEvent(
        new CustomEvent('corridra:step-up', { detail: { resolve }, cancelable: true }),
      );
    });
  });
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Six-digit code').fill('12');
  await dialog.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(dialog.getByRole('alert')).toContainText('six-digit code');
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() => (window as unknown as { stepUp: Promise<boolean> }).stepUp),
  ).toBe(false);
  await expect(page.locator('#workspace-delivery')).toBeVisible();
  await evidence(page, `V-05-${info.project.name}`);
  // Actual contributor route reuses staff identity and reads an account-wide inbox, without team context.
  await page.goto('/contributor');
  const contributorHeader = page.locator('header.ux-app-header[data-shell="contributor"]');
  await contributorHeader.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(page.getByText('Nothing new.', { exact: true })).toBeVisible();
  const contributorInbox = await page.request.get('/api/notifications');
  expect(contributorInbox.status()).toBe(200);
  expect(await contributorInbox.json()).toEqual([]);
  await evidence(page, `GAP-004-contributor-${info.project.name}`);
  // Sign Out from the avatar menu ends the session and returns to the staff sign-in page.
  await page.goto(`/operator?workspace=${seed.tenantId}`);
  await header.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click();
  await expect(page).toHaveURL(/\/operator\/signin/);
});

test('V-45 infrastructure: the inbox answers 401 to a signed-out visitor', async ({ request }) => {
  const seed = qaSeed();
  const response = await request.get(`/api/notifications?tenant=${seed.tenantId}`);
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toContain('no-store');
});
