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
  if (phone) {
    await expect(sidebar).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(sidebar).toBeVisible();
  const names = [
    'Today',
    'Missions',
    'Companies',
    'Meetings',
    'Quotes and billing',
    'Reports',
    'Network',
    'Evidence',
  ];
  for (const name of names)
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
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
  await evidence(page, `V-06-today-${info.project.name}`);

  await sidebar.getByRole('link', { name: 'Missions', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/operator/missions\\?workspace=${seed.tenantId}$`));
  await expect(page).toHaveTitle('Missions | Corridra');
  await expect(page.locator('h1')).toHaveText('Missions');
  await expect(page.locator('#workspace-missions')).toBeVisible();
  // Only the active section is rendered.
  for (const other of ['#workspace-research', '#workspace-meetings', '#workspace-delivery'])
    await expect(page.locator(other)).toHaveCount(0);
  await expect(page.locator('.ux-overview')).toHaveCount(0);

  // Settings holds the remaining sections and the Owner page.
  if (phone && !(await sidebar.isVisible())) await toggle.click();
  await sidebar.getByText('Settings', { exact: true }).click();
  for (const name of [
    'Access and audit',
    'Authenticator',
    'Sources and claims',
    'Workspace controls',
  ])
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Owner: what is on and off' })).toHaveAttribute(
    'href',
    '/operator/owner',
  );
  await sidebar.getByRole('link', { name: 'Access and audit', exact: true }).click();
  await expect(page).toHaveURL(/\/operator\/audit/);
  await expect(page.locator('h1')).toHaveText('Access and audit');
  await expect(page.locator('#workspace-audit')).toBeVisible();
  await expect(page.locator('#workspace-missions')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await evidence(page, `V-06-audit-${info.project.name}`);

  // The old # links keep working inside the shell.
  await page.goto(`/operator?workspace=${seed.tenantId}#workspace-delivery`);
  await expect(page.locator('#workspace-delivery')).toBeVisible();

  // V-45 infrastructure: the inbox opens from the header and reads only the person's own items.
  const inbox = header.getByRole('button', { name: 'Inbox', exact: true });
  await expect(inbox).toBeVisible();
  await inbox.click();
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
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
});

test('V-45 infrastructure: the inbox answers 401 to a signed-out visitor', async ({ request }) => {
  const seed = qaSeed();
  const response = await request.get(`/api/notifications?tenant=${seed.tenantId}`);
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toContain('no-store');
});
