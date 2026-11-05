import { test, expect, signInCustomer } from '../fixtures';

// CX PR 2a, Home on a production build with the test-only customer sign-in. Case ids: CX-02 (every destination
// and name Home had before is still reachable), CX-06 (no mono-capital label, no "not tracked yet"), and the one
// filled action: the header's New request is the only filled button on the page. The verification server has no
// workspaces switched on, so Active work (which needs them) is covered by tests/integration/revamp-cx2-home.test.ts.
test.beforeEach(async ({ context }) => {
  await signInCustomer(context);
});

test('CX-02 Home keeps every destination and name it had, as rows and links', async ({ page }) => {
  await page.goto('/account');
  const main = page.locator('main');
  // Before: a dark card with a New request button, then three quick links. After: the same, as row links.
  const next = main.getByRole('link', { name: /New request/ });
  await expect(next).toHaveCount(1);
  expect(['/plan', '/account?view=work#customer-workspaces']).toContain(
    await next.getAttribute('href'),
  );
  await expect(main.getByRole('link', { name: /Open a shared mission/ })).toHaveAttribute(
    'href',
    // The same page as before. It may also select the Shared With Me tab, where the invitation is (CX PR 3a;
    // the new Home's own tile follows when that lands), so either address is the same destination.
    /^\/account\?view=results(&tab=shared)?$/,
  );
  await expect(main.getByRole('link', { name: /Check a request receipt/ })).toHaveAttribute(
    'href',
    '/plan#receipt-check',
  );
  await expect(main.getByRole('heading', { name: 'Your next step' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Have something to open?' })).toBeVisible();
});

test('CX-06 Home has no mono-capital label, no "not tracked yet" and no stepper', async ({
  page,
}) => {
  await page.goto('/account');
  const main = page.locator('main');
  await expect(main.getByText('YOUR NEXT STEP', { exact: true })).toHaveCount(0);
  await expect(main.getByText(/not tracked yet/i)).toHaveCount(0);
  await expect(main.locator('.mr-road')).toHaveCount(0);
  const heading = main.getByRole('heading', { name: 'Your next step' });
  const style = await heading.evaluate((el) => {
    const css = getComputedStyle(el);
    return { transform: css.textTransform, family: css.fontFamily };
  });
  expect(style.transform).toBe('none');
  expect(style.family.toLowerCase()).not.toContain('mono');
});

test('Home has one filled action, the New request in the header, and none inside the page', async ({
  page,
}) => {
  await page.goto('/account');
  const filled = await page.evaluate(() => {
    const isFilled = (el: Element) => {
      const css = getComputedStyle(el);
      const bg = css.backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && css.display !== 'none';
    };
    const inMain = Array.from(document.querySelectorAll('main a, main button')).filter((el) => {
      const css = getComputedStyle(el);
      const bg = css.backgroundColor;
      // A row link's hover surface is not a filled action; only a solid brand-coloured control counts.
      return isFilled(el) && css.color === 'rgb(255, 255, 255)' && bg !== 'rgb(255, 255, 255)';
    });
    return inMain.map((el) => (el.textContent ?? '').trim());
  });
  expect(filled).toEqual([]);
  await expect(
    page.locator('header.ux-app-header').getByRole('link', { name: 'New request' }),
  ).toBeVisible();
});

test('actions align to the content left edge: headings, row text and the other links start at the same x', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/account');
  const left = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().left));
  const edge = await left('main h1');
  expect(await left('main h2:has-text("Your next step")')).toBe(edge);
  expect(await left('main .ux-row-title')).toBe(edge);
  expect(await left('main .ux-quick-links strong')).toBe(edge);
  await page.setViewportSize({ width: 390, height: 844 });
  const edge390 = await left('main h1');
  expect(await left('main .ux-row-title')).toBe(edge390);
});
