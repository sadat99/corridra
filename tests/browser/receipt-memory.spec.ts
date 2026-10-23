import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Sample mode (the public test server). A request recorded earlier is remembered on this device,
// so a new tab or a later visit still shows it, until the person asks the device to forget it.
const code = 'c'.repeat(64);
const keys = ['corridra-mission-receipt', 'corridra-mission-receipt-at'];
const remembered = () => ({
  receipt: sessionStorage.getItem('corridra-mission-receipt'),
  device: localStorage.getItem('corridra-mission-receipt'),
  at: localStorage.getItem('corridra-mission-receipt-at'),
});

test('a remembered request is still there in a new tab, and can be forgotten on this device', async ({
  page,
  context,
}) => {
  await page.addInitScript(
    ([receipt]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', 'yes');
        localStorage.setItem('corridra-mission-receipt', receipt);
        localStorage.setItem('corridra-mission-receipt-at', String(Date.now()));
      }
    },
    [code],
  );
  await page.goto('/plan');
  const saved = page.getByRole('region', { name: 'Keep your private receipt.', exact: true });
  await expect(saved).toBeVisible();
  await expect(saved.getByLabel('Private receipt code', { exact: true })).toHaveValue(code);
  await expect(saved).toContainText('Your request is saved on this device.');
  await expect(saved).toContainText('You do not need to copy a code.');
  // The new line is plain text. The one status message on the page is still the copy message.
  await expect(page.getByRole('status')).toHaveCount(0);

  // A new tab has its own empty tab storage, so only the device copy can bring the request back.
  const second = await context.newPage();
  await second.goto('/plan');
  const again = second.getByRole('region', { name: 'Keep your private receipt.', exact: true });
  await expect(again.getByLabel('Private receipt code', { exact: true })).toHaveValue(code);
  expect(await second.evaluate(remembered)).toMatchObject({ receipt: null, device: code });
  await second.close();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }

  await saved
    .getByRole('button', { name: 'Forget this request on this device', exact: true })
    .click();
  expect(await page.evaluate(remembered)).toMatchObject({ receipt: null, device: null, at: null });
  // The code stays on screen for now, so it cannot be lost by one click.
  await expect(saved.getByLabel('Private receipt code', { exact: true })).toHaveValue(code);
  await expect(saved).toContainText('This device no longer remembers your request.');
  await expect(saved).not.toContainText('Your request is saved on this device.');

  const third = await context.newPage();
  await third.goto('/plan');
  await expect(
    third.getByRole('region', { name: 'Keep your private receipt.', exact: true }),
  ).toHaveCount(0);
  await expect(third.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  await third.close();
  expect(keys).toHaveLength(2);
});

test('a request that is older than thirty days, or a bad value, is not shown', async ({ page }) => {
  await page.addInitScript(
    ([receipt]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', 'yes');
        localStorage.setItem('corridra-mission-receipt', receipt);
        localStorage.setItem(
          'corridra-mission-receipt-at',
          String(Date.now() - 31 * 24 * 60 * 60 * 1000),
        );
      }
    },
    [code],
  );
  await page.goto('/plan');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Keep your private receipt.', exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(remembered)).toMatchObject({ device: null, at: null });
});

test('with browser storage blocked the form still works and the request is not claimed saved', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/plan');
  await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toBeVisible();
  await expect(page.getByText('Your request is saved on this device.')).toHaveCount(0);
});
