import { test, expect, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The paste-a-private-link field on /access/link (access doors, Unit E). The link is a secret that lives in the
// address fragment, so the field must work in the browser alone: no request carries the token, nothing is stored,
// every refused paste shows one fixed message that never repeats the paste, and the page sends no referrer.
const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const b64 = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE'.slice(0, 43);
const links = [
  { path: '/buyer', token: hex },
  { path: '/client', token: hex },
  { path: '/programme', token: hex },
  { path: '/decision-card', token: b64 },
];
const refusal =
  'That link cannot be opened here. Paste the whole link exactly as it was sent, or ask the person who sent it for a new one.';
const label = 'Paste your private link';

const field = (page: Page) => page.getByLabel(label, { exact: true });
const open = (page: Page) => page.getByRole('button', { name: 'Open Link', exact: true });

async function ready(page: Page) {
  await page.goto('/access/link');
  await expect(field(page)).toBeVisible();
  await expect(field(page)).toBeEnabled();
  await page.waitForLoadState('networkidle');
}

/** Every place a request can carry a value: address, headers and body. */
const carries = (request: Request, secret: string) =>
  [request.url(), JSON.stringify(request.headers()), request.postData() ?? ''].some((part) =>
    part.includes(secret),
  );

const storedNothing = (page: Page) =>
  page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
  }));

test.describe('the page keeps its words and adds the field', () => {
  test('the field sits with the existing text, the role cards and the trouble section', async ({
    page,
  }) => {
    await ready(page);
    const main = page.getByRole('main');
    await expect(main.getByText('The link is your access', { exact: false })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'An introduction' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'A report or programme brief' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Link not working?' })).toBeVisible();
    await expect(open(page)).toBeVisible();
    // The cards still carry no link, and the field is not a form (a form could put the link in an address).
    await expect(main.locator('.access-card a')).toHaveCount(0);
    await expect(main.locator('form')).toHaveCount(0);
    const input = field(page);
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(input).not.toHaveAttribute('name', /.+/);
  });
});

test.describe('response headers on /access/link', () => {
  test('sends no referrer and is never stored', async ({ page }) => {
    const response = await page.goto('/access/link');
    const headers = response!.headers();
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toContain('no-store');
  });

  test('the other access pages keep the site-wide referrer policy', async ({ page }) => {
    const response = await page.goto('/access/customer');
    expect(response!.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

for (const { path, token } of links) {
  test(`a pasted ${path} link opens with the fragment intact and no request carries the token`, async ({
    page,
  }) => {
    // Stand in for the destination page so only this page's own behaviour is measured.
    await page.route(`**${path}`, (route) =>
      route.request().resourceType() === 'document'
        ? route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>Stub</title><main>Stub</main>',
          })
        : route.continue(),
    );
    await ready(page);
    const seen: Request[] = [];
    page.on('request', (request) => seen.push(request));

    await field(page).fill(`${new URL(page.url()).origin}${path}#${token}`);
    expect(seen).toHaveLength(0); // typing or pasting sends nothing
    await Promise.all([page.waitForURL(`**${path}#${token}`), open(page).click()]);

    expect(new URL(page.url()).hash).toBe(`#${token}`);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(seen.filter((r) => carries(r, token))).toEqual([]);
    expect(seen.filter((r) => r.method() !== 'GET')).toEqual([]);
    expect(await storedNothing(page)).toEqual({ local: 0, session: 0 });
  });
}

test('the keyboard alone pastes, opens and refuses', async ({ page }) => {
  await page.route('**/buyer', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Stub</title>' }),
  );
  await ready(page);
  const input = field(page);
  await input.focus();
  await page.keyboard.type('https://evil.example/buyer#nope');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(refusal);
  await expect(input).toBeFocused(); // focus stays where the visitor is typing
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await input.fill(`${new URL(page.url()).origin}/buyer#${hex}`);
  await expect(page.getByRole('alert')).toHaveCount(0); // editing clears the message
  await page.keyboard.press('Tab');
  await expect(open(page)).toBeFocused();
  await Promise.all([page.waitForURL(`**/buyer#${hex}`), page.keyboard.press('Enter')]);
  expect(new URL(page.url()).hash).toBe(`#${hex}`);
});

test.describe('refused pastes', () => {
  const refused: Array<[string, (origin: string) => string]> = [
    ['an empty paste', () => ''],
    ['only spaces', () => '   '],
    ['another host', () => `https://evil.example/buyer#${hex}`],
    ['a look-alike host', (o) => `${o}.evil.example/buyer#${hex}`],
    ['userinfo', (o) => `${o.replace('://', '://evil.example@')}/buyer#${hex}`],
    ['javascript:', () => 'javascript:alert(document.domain)'],
    ['a protocol-relative link', () => `//evil.example/buyer#${hex}`],
    ['a path not on the list', (o) => `${o}/operator#${hex}`],
    ['a path with no token', (o) => `${o}/buyer`],
    ['a token in the query string', (o) => `${o}/buyer?t=${hex}`],
    ['a line break inside the path', (o) => `${o}/bu\nyer#${hex}`],
    ['an encoded path', (o) => `${o}/%62uyer#${hex}`],
    ['a short token', (o) => `${o}/buyer#${hex.slice(0, 40)}`],
  ];

  for (const [name, make] of refused) {
    test(`${name} shows the one fixed message and goes nowhere`, async ({ page }) => {
      const dialogs: string[] = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await ready(page);
      const start = page.url();
      const text = make(new URL(start).origin);
      const seen: Request[] = [];
      page.on('request', (request) => seen.push(request));

      await field(page).fill(text);
      await open(page).click();

      const alert = page.getByRole('alert');
      await expect(alert).toHaveText(refusal);
      // The message never repeats what was pasted.
      const shown = (await alert.textContent()) ?? '';
      for (const piece of [hex, 'evil', 'javascript', 'operator']) expect(shown).not.toContain(piece);
      expect(page.url()).toBe(start);
      expect(seen).toEqual([]);
      expect(dialogs).toEqual([]);
      expect(await storedNothing(page)).toEqual({ local: 0, session: 0 });
    });
  }
});

for (const width of [320, 768]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('has no horizontal scroll, 44 px targets and no accessibility violations, with and without the message', async ({
      page,
    }) => {
      await ready(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      for (const box of [await field(page).boundingBox(), await open(page).boundingBox()]) {
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await field(page).fill('https://evil.example/buyer');
      await open(page).click();
      await expect(page.getByRole('alert')).toHaveText(refusal);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  });
}
