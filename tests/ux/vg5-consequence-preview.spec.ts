import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { translate } from '../../apps/web/lib/i18n/messages';

// Visual grammar PR 5 (17 November 2026, requirement V3-05-033): a short preview in plain words, right before
// "Send response" on an evidence request, of what pressing it does: who can read it, what is sent and until when.
// Step 1 is behaviour only: the request the button sends must not change by a byte. The real DeliveryView is
// mounted the way mr-explain.spec.ts mounts the teaching layer (an esbuild fixture over a served page that supplies
// the app's real stylesheet), with /api/delivery answered by the test. No production route changes for the test.

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);
const token = 'a'.repeat(64);
const requestId = '11111111-1111-4111-8111-111111111111';
const typed = 'Our certificate renewal is in progress.';
const widths = [320, 390, 768, 1440] as const;
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { DeliveryView } from ${JSON.stringify(resolve('apps/web/app/delivery-view.tsx'))};
import { ConsequencePreview } from ${JSON.stringify(resolve('apps/web/components/consequence-preview.tsx'))};

const mount = document.getElementById('mount');
if (window.location.hash === '#ar')
  createRoot(mount).render(
    <main id="vg5-fixture" lang="en">
      <h1>Preview fixture</h1>
      <ConsequencePreview locale="ar" expires="17 Dec 2026, 09:00" />
    </main>,
  );
else
  createRoot(mount).render(
    <main id="vg5-fixture" lang="en" className="ux-workspace ux-customer">
      <h1>Your next commercial step</h1>
      <DeliveryView audience="CLIENT_PROGRESS" capability=${JSON.stringify(token)} endpoint="/api/delivery" />
    </main>,
  );
`;

test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: resolve('apps/web') },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  script = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
});

const mission = {
  publicationId: '22222222-2222-4222-8222-222222222222',
  title: 'Synthetic mission',
  company: 'Example Garments',
  objective: 'Find a trim supplier.',
  brief: 'Plain trims for a spring line.',
  nextAction: 'Answer the evidence request.',
  dueAt: '2026-12-10T00:00:00.000Z',
  reviewedAt: '2026-11-01T00:00:00.000Z',
  status: 'ACTIVE',
  updatedAt: '2026-11-10T00:00:00.000Z',
  itinerary: [],
  outcomes: {
    opportunities: 0,
    qualified: 0,
    proposals: 0,
    contracts: 0,
    rfqs: 0,
    samples: 0,
    heldMeetings: 0,
  },
  totals: [],
  requests: [
    {
      id: requestId,
      title: 'Confirm your factory certificate',
      instructions: 'Tell us in your own words where the certificate stands.',
      dueAt: '2026-12-05T00:00:00.000Z',
      status: 'OPEN',
    },
  ],
};
const report = {
  schemaVersion: 1,
  scopeId: '33333333-3333-4333-8333-333333333333',
  audience: 'CLIENT_PROGRESS',
  purpose: 'client_progress',
  programme: null,
  generatedAt: '2026-11-17T09:00:00.000Z',
  expiresAt: '2026-12-17T09:00:00.000Z',
  allowExport: false,
  approvedParticipants: 1,
  approvedCompanies: 1,
  qualifiedCounterparties: 0,
  totals: [],
  missions: [mission],
  attribution: 'Approved mission and opportunity scope only.',
};

/** Serves any page for the app's own stylesheet, then answers /api/delivery and keeps every respond request. */
async function mount(page: Page, width: number, hash = '') {
  const bodies: string[] = [];
  await page.route('**/api/delivery', async (route) => {
    const raw = route.request().postData() ?? '';
    const input = JSON.parse(raw);
    if (input.action === 'respond') {
      bodies.push(raw);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: input.commandId, claimStatus: 'self_declared' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(report),
    });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await page.evaluate(
    ({ css }) => {
      document.body.innerHTML = '<div id="mount"></div>';
      document.body.className = '';
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    },
    { css: styles },
  );
  await page.evaluate((h) => (window.location.hash = h), hash);
  await page.addScriptTag({ content: 'window.process = { env: { NODE_ENV: "production" } };' });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector('#vg5-fixture');
  return bodies;
}
const height = (page: Page) =>
  page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));

test.describe('the evidence reply says what Send response will do', () => {
  test('the request the Send button makes is byte for byte what it was before the preview', async ({
    page,
  }) => {
    const bodies = await mount(page, 1440);
    await page.getByLabel('Response', { exact: true }).fill(typed);
    await page.getByLabel('This response is my declaration', { exact: false }).check();
    await page.getByRole('button', { name: 'Send response', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Response received' })).toBeVisible();
    expect(bodies).toHaveLength(1);
    // Captured on main before the preview existed: same keys, same order, same values, one fresh command id.
    const raw = bodies[0].replace(/"commandId":"[0-9a-f-]{36}"/, '"commandId":"<uuid>"');
    expect(raw).toBe(
      `{"action":"respond","requestId":"${requestId}","body":"${typed}","acknowledged":true,"commandId":"<uuid>","audience":"CLIENT_PROGRESS","token":"${token}"}`,
    );
  });

  test('a preview sits right before Send response: who can read it, what is sent, until when', async ({
    page,
  }) => {
    await mount(page, 1440);
    const form = page.locator('form.operator-form');
    const preview = form.getByRole('group', { name: say('consequence.heading') });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(say('consequence.whatBody'));
    await expect(preview).toContainText(say('consequence.onceBody'));
    await expect(preview).toContainText(say('consequence.untilBody'));
    await expect(preview).toContainText('17 Dec 2026');
    const who = form.getByRole('group', { name: say('privacy.heading') });
    await expect(who).toContainText(say('privacy.reader.anyoneWithLink'));
    await expect(who).toContainText(say('privacy.canSee'));
    // Order inside the form: the fields, then who can see it, then the preview, then the button.
    const order = await form.evaluate((node) => {
      const at = (el: Element | null) => (el ? [...node.querySelectorAll('*')].indexOf(el) : -1);
      return [
        at(node.querySelector('fieldset')),
        at(node.querySelector('.privacy-label')),
        at(node.querySelectorAll('.privacy-label')[1] ?? null),
        at(node.querySelector('button')),
      ];
    });
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // It adds no control: the form still holds the one textarea, the one checkbox and the one button.
    await expect(preview.locator('button, input, a, select, textarea, [tabindex]')).toHaveCount(0);
    await expect(form.locator('button, input, textarea')).toHaveCount(3);
  });

  for (const width of widths)
    test(`stays readable, clean for axe and inside the width at ${width}px`, async ({
      page,
    }, info) => {
      await mount(page, width);
      await expect(page.locator('form.operator-form')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const found = (
        await new AxeBuilder({ page }).include('form.operator-form').analyze()
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found).toEqual([]);
      // Measured, not asserted against a new budget: the screen height in pixels at this width.
      const h = await height(page);
      info.annotations.push({ type: 'page-height', description: `${width}px: ${h}px` });
      console.log(`PAGE_HEIGHT ${width} ${h}`);
    });

  test('in Arabic the preview reads right to left, with its own language and no extra control', async ({
    page,
  }) => {
    await mount(page, 390, '#ar');
    const preview = page.getByRole('group', { name: translate('ar', 'consequence.heading') });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('dir', 'rtl');
    await expect(preview).toHaveAttribute('lang', 'ar');
    await expect(preview).toContainText(translate('ar', 'consequence.untilBody'));
    const violations = (await new AxeBuilder({ page }).include('#vg5-fixture').analyze())
      .violations;
    expect(violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
