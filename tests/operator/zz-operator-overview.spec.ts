import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { openSection } from './workspace-nav';

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, ''))
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

test('operator overview follows the bento references and preserves every authorized destination', async ({
  page,
}) => {
  test.setTimeout(180000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.goto('/operator/signin');
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(seed.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
  await page.getByRole('button', { name: 'Verify and open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
  // Earlier suites create other authorized workspaces. Select this test's owner workspace explicitly.
  await page.goto('/operator?workspace=' + encodeURIComponent(seed.tenantId));
  await expect(page.getByText('Your access: owner', { exact: true })).toBeVisible();
  const home = page.locator('.ux-overview');
  const workflow = page.getByRole('navigation', { name: 'Mission workflow' });
  await expect(workflow.getByRole('link')).toHaveCount(5);
  // Today shows seven counts (accepted quotes and replies added, CQ-34 and CQ-73).
  await expect(home.getByRole('list', { name: 'Counts' }).getByRole('listitem')).toHaveCount(7);
  const directory = page.locator('#workspace-navigation details');
  await expect(directory).not.toHaveAttribute('open');
  await page.getByText('Manage this workspace', { exact: true }).click();
  await directory.locator('summary').click();
  for (const section of workspaceSections) {
    await expect(directory.locator(`a[href="#${section.id}"]`)).toBeVisible();
    await expect(page.locator('#' + section.id)).toBeAttached();
  }
  const out = 'work/operator-ui';
  await mkdir(out, { recursive: true });
  const observations = [];
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1100 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const axe = await new AxeBuilder({ page }).include('main').analyze();
    expect(axe.violations).toEqual([]);
    const cards = await workflow.getByRole('link').evaluateAll((links) =>
      links.map((link) => ({
        width: link.getBoundingClientRect().width,
        height: link.getBoundingClientRect().height,
      })),
    );
    expect(cards.every((card) => card.width >= 110 && card.height >= 76)).toBe(true);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${out}/overview-${width}.png`, fullPage: true });
    await page.screenshot({ path: `${out}/viewport-${width}.png` });
    observations.push({ width, overflow, axeViolations: axe.violations.length, cards });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  // Use the actual keyboard and original fragment handling, including focus transfer.
  for (const section of workspaceSections.slice(0, 5)) {
    const link = workflow.getByRole('link', { name: section.label, exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#' + section.id)).toBeVisible();
    await expect(page.locator('#' + section.id)).toBeFocused();
    await openSection(page, 'main');
  }
  await writeFile(`${out}/observations.json`, JSON.stringify(observations, null, 2) + '\n');
});
