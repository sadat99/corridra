import { test, expect, signInCustomer } from '../fixtures';
import type { Page } from '@playwright/test';

// Account settings tabs (S28): All Tools has one home on a wide screen (the left bar foot) and one row below the
// rail breakpoint, the five tabs share one column and rhythm, and the closure block is grouped. Presentation only.
// The All Tools cases need CORRIDRA_UX_NAV=true on the server (serve with it set); the closure layout cases also need
// CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED=true. Both skip themselves otherwise.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'w1280', 'Runs once; it switches viewports itself.');
});

const tabs = ['Profile', 'Workspaces and Team', 'Notifications', 'Plan and Billing', 'Security'];
const allToolsLinks = (page: Page) => page.locator('a[href="/account/all-tools"]');

async function visibleCount(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluateAll(
      (nodes) => nodes.filter((node) => (node as HTMLElement).offsetParent !== null).length,
    );
}

async function openTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.count()) await tab.click();
  return tab.count();
}

test.describe('All Tools (navigation switch on)', () => {
  test.skip(process.env.CORRIDRA_UX_NAV !== 'true', 'Needs CORRIDRA_UX_NAV=true on the server.');

  for (const collapsed of [false, true])
    test(`the rail link All Tools is a 44 px target at 1440, ${collapsed ? 'collapsed' : 'expanded'}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await signInCustomer(context);
      await page.goto('/account?view=more');
      if (collapsed) await page.locator('.ux-leftnav-collapse').click();
      const link = page.locator('a.ux-rail-tools');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/account/all-tools');
      await expect(page.getByRole('link', { name: 'All Tools', exact: true })).toHaveCount(1);
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    });

  test('across the five tabs one All Tools link shows at 1440 and the phone row is hidden', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInCustomer(context);
    await page.goto('/account?view=more');
    for (const name of tabs) {
      if (!(await openTab(page, name))) continue;
      expect(await visibleCount(page, 'a[href="/account/all-tools"]')).toBe(1);
      await expect(page.locator('.ux-account-alltools')).toBeHidden();
      await expect(page.locator('a.ux-rail-tools')).toBeVisible();
    }
  });

  test('at 390 the row under the tabs is the one visible link, outside the tab panel, on every tab', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInCustomer(context);
    await page.goto('/account?view=more');
    for (const name of tabs) {
      if (!(await openTab(page, name))) continue;
      expect(await visibleCount(page, 'a[href="/account/all-tools"]')).toBe(1);
      const row = page.locator('.ux-account-alltools a');
      await expect(row).toBeVisible();
      await expect(page.locator('[role=tabpanel] a[href="/account/all-tools"]')).toHaveCount(0);
      await expect(page.locator('a.ux-rail-tools')).toBeHidden();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of [1023, 1024])
    test(`at ${width} exactly one All Tools link is visible`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInCustomer(context);
      await page.goto('/account?view=more');
      expect(await visibleCount(page, 'a[href="/account/all-tools"]')).toBe(1);
    });
});

test.describe('All Tools (navigation switch off)', () => {
  test.skip(process.env.CORRIDRA_UX_NAV === 'true', 'Runs with the default switches.');

  test('Account has no All Tools link and Other ways in is an h3 in Security', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInCustomer(context);
    await page.goto('/account?view=more&tab=security');
    await expect(allToolsLinks(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Other ways in', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other ways in', level: 2 })).toHaveCount(0);
  });
});

for (const width of [320, 390, 768, 1024, 1440])
  test(`no sideways scroll on any Account tab at ${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await signInCustomer(context);
    await page.goto('/account?view=more');
    for (const name of tabs) {
      if (!(await openTab(page, name))) continue;
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${name} at ${width}`).toBeLessThanOrEqual(0);
    }
  });

test('Sign Out is its own row with a gap before the next block', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInCustomer(context);
  await page.goto('/account?view=more&tab=security');
  const signOut = page.getByRole('button', { name: 'Sign Out', exact: true });
  await expect(signOut).toBeVisible();
  expect((await signOut.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const next = page.locator('.ux-account-actions ~ *').first();
  if (await next.count()) {
    const a = (await signOut.boundingBox())!;
    const b = (await next.boundingBox())!;
    expect(b.y - (a.y + a.height)).toBeGreaterThan(0);
  }
});

test.describe('closure block layout (account module on)', () => {
  test.skip(
    process.env.CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED !== 'true',
    'Needs CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED=true on the server.',
  );
  const active = (erasure: unknown) => ({
    open: true,
    status: 'active',
    closedAt: null,
    undoUntil: null,
    canUndo: false,
    erasure,
    blockers: [],
  });
  const filed = {
    reference: 'ER-0001',
    filedAt: '2026-11-01T10:00:00.000Z',
    dueAt: '2026-12-01T10:00:00.000Z',
    status: 'received',
    note: null,
  };

  async function mock(page: Page, state: unknown) {
    await page.route('**/api/customer-account-lifecycle', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }),
    );
  }

  test('at 1440 each row has its text on the start side and its button on the end side', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInCustomer(context);
    await mock(page, active(null));
    await page.goto('/account?view=more&tab=security');
    await expect(page.getByRole('heading', { name: 'Close Account or Erase Data' })).toBeVisible();
    for (const name of ['Close Account', 'Ask for Erasure']) {
      const row = page.locator('.ux-account-row', {
        has: page.getByRole('heading', { name, level: 4 }),
      });
      const button = (await row.getByRole('button', { name, exact: true }).boundingBox())!;
      const text = (await row.locator('p').boundingBox())!;
      expect(button.x).toBeGreaterThanOrEqual(text.x + text.width - 1);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    const rows = page.locator('.ux-account-zone .ux-account-row');
    const first = (await rows.nth(0).boundingBox())!;
    const second = (await rows.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  });

  test('at 390 the button sits under its text, full width, 44 px tall, no sideways scroll', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInCustomer(context);
    await mock(page, active(null));
    await page.goto('/account?view=more&tab=security');
    const row = page.locator('.ux-account-row', {
      has: page.getByRole('heading', { name: 'Close Account', level: 4 }),
    });
    const button = (await row
      .getByRole('button', { name: 'Close Account', exact: true })
      .boundingBox())!;
    const text = (await row.locator('p').boundingBox())!;
    expect(button.y).toBeGreaterThanOrEqual(text.y + text.height);
    expect(button.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const width of [320, 1440])
    test(`an open erasure request shows every field in order at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInCustomer(context);
      await mock(page, active(filed));
      await page.goto('/account?view=more&tab=security');
      await expect(page.locator('dl')).toHaveCount(1);
      const terms = await page.locator('dl dt').allTextContents();
      expect(terms).toEqual(['Reference', 'Sent', 'Staff reply due by', 'Status']);
      await expect(page.locator('dl dd').first()).toHaveText('ER-0001');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
});
