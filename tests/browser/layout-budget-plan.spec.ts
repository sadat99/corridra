import { expect, test, type Page } from '@playwright/test';

// The request page length: /plan keeps its own limit, set from the measured result of the page-length change
// (docs/revamp/evidence/s13-plan-length: 2.53 screens at 390 x 844, 1.80 at 1440 x 900 and 1780 x 900). The earlier
// limits (2.0 and 1.0) were not reachable with the footer and the page head on the page. These numbers are the S5
// conductor's proposal of 9 November 2026 after measurement, owner confirmed, 9 November 2026 (relayed by the
// conductor: "proceed with /plan proposal"): the owner's targets were 2.4 and
// 1.8, and the phone misses 2.4 (2.53). The test notice's availability sentence stays in view because existing
// honesty tests need it; hiding it would still only reach 2.48 (a style in the current build, see the evidence
// folder). They never go up without the owner.
// Measured 2.53 phone (2132 px) and 1.80 desktop (1617 px); each limit leaves more than one text line of room, because
// CI's fonts can differ from the local ones (KI-28): phone 2.60 is 2194 px (62 px of room), desktop 1.85 is 1665 px (48 px).
const limits = { phone: 2.6, desktop: 1.85 } as const;
const sizes = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
  wide: { width: 1780, height: 900 },
} as const;

const screens = async (page: Page) =>
  (await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  )) / (await page.evaluate(() => innerHeight));

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set in each case');
});

const footer = (page: Page) => page.locator('footer[data-footer="v44"]');

for (const [name, size] of Object.entries(sizes))
  test(`the request page is within its length at ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/plan');
    await page.evaluate(() => document.fonts.ready);
    const limit = name === 'phone' ? limits.phone : limits.desktop;
    expect(await screens(page), `${name} screens`).toBeLessThanOrEqual(limit);
  });

// Owner 2a, 18 Nov 2026 (UI/UX.v4 row "Plan page"): the callout box and its "Test mode" pill are gone. G29 round 1 (D2):
// the availability sentence and the way to the whole notice are ONE summary line under the heading; the old lead and
// the rest open from it.
test('the test notice is one summary line with its availability sentence, and the rest opens from it', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  await expect(page.locator('aside.intake-notice')).toHaveCount(0);
  await expect(page.locator('.guide-pill')).toHaveCount(0);
  const notice = page.locator('.plan-sample-note');
  const more = notice.locator('details');
  const summary = more.locator('summary');
  await expect(
    summary.getByText('Test intake is open. Real customer mission admission is unavailable.'),
  ).toBeVisible();
  await expect(summary.getByText('Read the Test Notice')).toBeVisible();
  await expect(more).not.toHaveAttribute('open', '');
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await expect(notice.getByText('Email delivery is not enabled.')).toBeHidden();
  await expect(notice.getByText('A short request is enough. No account needed.')).toBeHidden();
  await summary.click();
  await expect(notice.getByText('Email delivery is not enabled.')).toBeVisible();
  await expect(notice.getByText('A short request is enough. No account needed.')).toBeVisible();
  await expect(notice.getByText(/Use invented details/)).toBeVisible();
  await expect(notice.locator('a[href="/privacy"]')).toHaveText('Read the test intake notice');
  await expect(page.locator('.plan-privacy-line')).toHaveText(
    'Nothing is sent until you check it.',
  );
});

// The request page is the two-pane window of 28 Nov 2026 (owner canvas board v10, CORRIDRA_UX_PLAN_V10): the request taking
// shape sits on the left. It replaces the example-request column, which was a closed line on a phone and an open column
// on a wide screen; the same two intents hold, the pane is short on a phone and open beside the form on a wide screen.
test('on a phone the left pane is one heading, the map and the answers wait, and the progress words show', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const side = page.locator('aside.pv-side');
  await expect(side.locator('.pv-side-h')).toHaveText('Taking shape as you answer.');
  await expect(side.locator('.pv-map')).toBeHidden();
  await expect(side.locator('dl.pv-sum')).toBeHidden();
  expect((await side.boundingBox())!.height).toBeLessThanOrEqual(190);
  // The steps row has no names on a phone, so the progress words are shown and say where the person is.
  await expect(page.locator('.plan-progress-line')).toBeVisible();
  await expect(page.locator('.plan-progress-line')).toContainText('Step 1 of 5');
  await page.locator('form.intake-form input[type="radio"]').first().check({ force: true });
  await expect(page.locator('.pv-step[data-state="now"]')).toHaveCount(1);
});

test('on a wide screen the left pane is open beside the form and follows the answers, and the receipt check sits under the form', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/plan');
  const aside = page.locator('aside.pv-side');
  await expect(aside.locator('.pv-eb')).toHaveText('Your request');
  await expect(aside.locator('dl.pv-sum dt')).toHaveText([
    'Goal',
    'Based in',
    'Market',
    'When',
    'Note',
  ]);
  await expect(aside.locator('dl.pv-sum dd[data-mute]')).toHaveCount(5);
  await expect(aside.locator('dl.pv-sum').getByText('Not chosen yet').first()).toBeVisible();
  const [a, r, f] = await Promise.all([
    aside.boundingBox(),
    page.locator('#receipt-check').boundingBox(),
    page.locator('form.intake-form').boundingBox(),
  ]);
  // B2a (D-006): the receipt check is in the main column, under the form; the left pane sits beside both, so it can
  // never cover the receipt check.
  expect(r!.y).toBeGreaterThanOrEqual(f!.y + f!.height - 1);
  expect(Math.abs(r!.x - f!.x)).toBeLessThan(2);
  expect(a!.x + a!.width).toBeLessThanOrEqual(f!.x + 1);
  // The receipt check is still a disclosure that opens.
  await page.locator('#receipt-check summary').click();
  await expect(page.locator('#receipt-check input')).toBeVisible();
});

test('the footer on the request page keeps every link and action, with the trust legend folded', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const f = footer(page);
  await expect(f).toHaveAttribute('data-compact', '');
  await expect(f.locator('.hv7-footer-actions a[href="/plan"]')).toBeVisible();
  await expect(f.locator('.hv7-footer-actions a[href="/signin"]')).toBeVisible();
  await expect(f.locator('.hv7-footer-actions a[href="/workspace"]')).toBeVisible();
  // The four link groups sit in one disclosure; open it and each group, then every link is in view.
  await f.locator('details.hv7-footer-fold > summary').first().click();
  const groups = f.locator('details.hv7-footer-group');
  await expect(groups).toHaveCount(4);
  for (const group of await groups.all()) await group.locator('summary').click();
  for (const href of [
    '/source',
    '/machinery',
    '/corridors/bangladesh-china',
    '/corridors#mission-example',
    '/sell',
    '/enter-market',
    '/business-trips',
    // owner decision 17 Nov 2026, routes and markets: the footer's EU link opens the EU page
    '/corridors/bangladesh-eu',
    '/trade-missions',
    '/institutions',
    '/network',
    '/corridors',
    '/how-it-works',
    '/about',
    '/trust',
    '/privacy',
  ])
    await expect(f.locator(`a[href="${href}"]`).first(), href).toBeVisible();
  const trust = f.locator('details.hv7-footer-trust-fold');
  await expect(trust).not.toHaveAttribute('open', '');
  await expect(trust.locator('summary')).toHaveText('Every fact says where it comes from:');
  expect((await trust.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await trust.locator('summary').click();
  await expect(trust.locator('.guide-tag')).toHaveText([
    'Self-declared',
    'Evidence available',
    'Verified',
    'Not confirmed',
  ]);
  await expect(
    trust.getByRole('link', { name: 'How We Label Facts', exact: true }),
  ).toHaveAttribute('href', '/trust');
});

test('every other public page keeps the full footer with the legend in view', async ({ page }) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  await expect(footer(page)).not.toHaveAttribute('data-compact', '');
  await expect(footer(page).locator('.hv7-footer-trust')).toBeVisible();
});

// Owner 2a and the board's phone bottom action area: the reassurance line sits under Continue in the fixed bar, says
// "Saved in this tab for up to 24 hours." only once a draft exists, and Clear Answers stays a 44 px target.
test('on a phone the reassurance line and Clear Answers sit under Continue in the action area, with a 44 px target', async ({
  page,
}) => {
  await page.setViewportSize(sizes.phone);
  await page.goto('/plan');
  const line = page.locator('.plan-action-note');
  await expect(line).not.toContainText('Saved in this tab');
  const clear = line.getByRole('button', { name: 'Clear Answers' });
  await expect(clear).toBeVisible();
  expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await page.locator('form.intake-form input[type="radio"]').first().check({ force: true });
  await expect(line).toContainText('Saved in this tab for up to 24 hours.');
  const [c, l] = await Promise.all([
    page.locator('form.intake-form .primary-link').boundingBox(),
    line.boundingBox(),
  ]);
  expect(l!.y - (c!.y + c!.height)).toBeLessThan(24);
});

test('the folded trust legend keeps its exact words and link, and they are the same words as on every other page', async ({
  page,
}) => {
  await page.setViewportSize(sizes.desktop);
  await page.goto('/about');
  const full = await footer(page).locator('.hv7-footer-trust').innerText();
  const fullLink = await footer(page)
    .getByRole('link', { name: 'How We Label Facts', exact: true })
    .getAttribute('href');
  await page.goto('/plan');
  const trust = footer(page).locator('details.hv7-footer-trust-fold');
  // Closed: the words are in the page (a closed details keeps its content in the DOM), and the summary is a real,
  // keyboard-reachable control that carries the legend's opening words.
  await expect(trust).not.toHaveAttribute('open', '');
  const closed = await trust.evaluate((el) => el.textContent ?? '');
  for (const word of [
    'Every fact says where it comes from:',
    'Self-declared',
    'Evidence available',
    'Verified',
    'Not confirmed',
    'How We Label Facts',
  ])
    expect(closed, word).toContain(word);
  await trust.locator('summary').focus();
  await expect(trust.locator('summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trust).toHaveAttribute('open', '');
  // Opened: the same words, in the same order, and the same link address, as the full footer on another page.
  const opened = (await trust.innerText()).replace(/\s+/g, ' ').trim();
  // (The legend and its link are one row in the new footer, so the full text already ends with the link.)
  expect(opened).toBe(full.replace(/\s+/g, ' ').trim());
  await expect(
    trust.getByRole('link', { name: 'How We Label Facts', exact: true }),
  ).toHaveAttribute('href', fullLink!);
  const names = await trust.locator('.guide-tag').allInnerTexts();
  expect(names.map((n) => n.trim())).toEqual([
    'Self-declared',
    'Evidence available',
    'Verified',
    'Not confirmed',
  ]);
});

// The compact footer is outside #main, so the form's own layout guard never sees it. Here it is measured on its own at
// 320 px, at normal size and with the text at 200 percent, in English, German and Arabic (the footer follows the
// language chip): no box past the window edge, no sideways scroll, and every group summary and the trust summary at
// least 44 px tall.
for (const chosen of ['en', 'de', 'ar'])
  for (const zoom of [false, true])
    test(`the compact footer fits at 320 px${zoom ? ' with 200% text' : ''} in ${chosen}, with 44 px summaries`, async ({
      page,
    }) => {
      await page.addInitScript((value) => localStorage.setItem('corridra.language', value), chosen);
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto('/plan');
      if (zoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.evaluate(() => document.fonts.ready);
      const f = footer(page);
      await expect(f).toHaveAttribute('data-compact', '');
      // Open the fold, every group and the trust fold, the tallest state.
      for (const summary of await f.locator('summary').all()) {
        await summary.scrollIntoViewIfNeeded();
        await summary.click();
      }
      const result = await page.evaluate(() => {
        const edge = document.documentElement.clientWidth;
        const footerEl = document.querySelector('footer[data-footer="v44"]')!;
        const out = Array.from(footerEl.querySelectorAll('*'))
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 1 && (box.right > edge + 0.5 || box.left < -0.5);
          })
          .map(
            (el) => `${el.tagName.toLowerCase()}.${el.className} ${el.textContent?.slice(0, 40)}`,
          );
        const small = Array.from(footerEl.querySelectorAll('summary'))
          .filter((el) => el.getBoundingClientRect().height < 43.5)
          .map(
            (el) =>
              `${Math.round(el.getBoundingClientRect().height)}: ${el.textContent?.slice(0, 40)}`,
          );
        return { out, small, wide: document.documentElement.scrollWidth > edge };
      });
      expect(result.out, 'boxes past the edge').toEqual([]);
      expect(result.small, 'summaries under 44 px').toEqual([]);
      expect(result.wide, 'sideways scroll').toBe(false);
      // The fold of the groups, the four groups and the trust fold.
      expect(await f.locator('summary').count()).toBe(6);
    });
