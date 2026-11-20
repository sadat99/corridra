import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { translate } from '../../apps/web/lib/i18n/messages';

// Wave 3 unit 09 (owner approved 20 November 2026): one Before Send block directly above each Send, with three rows
// (who can see it, what is sent, until when) and, on the evidence reply only, the one-response sentence. The real
// DeliveryView and ReplyJourney are mounted with the switch's prop on, the way vg5-consequence-preview.spec.ts mounts
// the older preview, with /api/delivery and /api/buyer answered by the test. Every name is invented sample data.

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);
const token = 'a'.repeat(64);
const requestId = '11111111-1111-4111-8111-111111111111';
const secondRequestId = '44444444-4444-4444-8444-444444444444';
const typed = 'Our certificate renewal is in progress.';
const widths = [320, 390, 768, 1440] as const;
const shots = process.env.BEFORE_SEND_SHOTS_DIR;
let script = '';
let styles = '';

const entry = `
import { createRoot } from 'react-dom/client';
import { DeliveryView } from ${JSON.stringify(resolve('apps/web/app/delivery-view.tsx'))};
import { ReplyJourney } from ${JSON.stringify(resolve('apps/web/app/buyer/reply-journey.tsx'))};
import { BeforeSend } from ${JSON.stringify(resolve('apps/web/components/before-send.tsx'))};

const mount = document.getElementById('mount');
const hash = window.location.hash.slice(1);
const locales = { ar: 'rtl', bn: 'ltr', zh: 'ltr' };
const reply = {
  introduction: {
    company: 'Example Trims Limited',
    country: 'Bangladesh',
    capability: 'Plain trims',
    fit: 'Spring line',
    uncertainty: 'None stated',
    conversationPurpose: 'Introduction',
  },
  template: 'An introduction from the team.',
  expiresAt: '2026-12-17T09:00:00.000Z',
  decision: 'INTERESTED',
  sharedRequirements: 'Plain trims for a spring line.',
  allowQuotation: false,
  allowMeetingInterest: false,
  capability: ${JSON.stringify(token)},
};
if (hash in locales)
  createRoot(mount).render(
    <main id="bs-fixture" lang="en">
      <h1>Example: Before Send</h1>
      <BeforeSend surface="evidenceReply" locale={hash} expires="17 Dec 2026, 09:00" />
    </main>,
  );
else if (hash === 'reply' || hash === 'replyzh' || hash === 'replyoff')
  createRoot(mount).render(
    <main id="bs-fixture" lang="en" className="ux-workspace ux-customer">
      <h1>Example: reply</h1>
      <ReplyJourney data={reply} token=${JSON.stringify(token)} language={hash === 'replyzh' ? 'zh' : 'en'} beforeSend={hash !== 'replyoff'} ask={[]} busy={false} pending={null} declined={false} optOut={false} onOptOut={() => {}} onRespond={() => {}} onStop={() => {}} onAccessDenied={() => {}} />
    </main>,
  );
else
  createRoot(mount).render(
    <main id="bs-fixture" lang="en" className="ux-workspace ux-customer">
      <h1>Example: your next commercial step</h1>
      <DeliveryView audience="CLIENT_PROGRESS" capability=${JSON.stringify(token)} endpoint="/api/delivery" beforeSend={hash !== 'evidenceoff'} />
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

const open = (id: string, title: string) => ({
  id,
  title,
  instructions: 'Tell us in your own words where it stands.',
  dueAt: '2026-12-05T00:00:00.000Z',
  status: 'OPEN',
});
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
  missions: [
    {
      publicationId: '22222222-2222-4222-8222-222222222222',
      title: 'Sample mission',
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
        open(requestId, 'Confirm your factory certificate'),
        open(secondRequestId, 'Confirm your export licence'),
      ],
    },
  ],
  attribution: 'Approved mission and opportunity scope only.',
};

/** Serves any page for the app's own stylesheet, answers the two APIs and keeps every send request. */
async function mount(page: Page, width: number, hash = '') {
  const sent: string[] = [];
  await page.route('**/api/delivery', async (route) => {
    const raw = route.request().postData() ?? '';
    const input = JSON.parse(raw);
    if (input.action === 'respond') {
      sent.push(raw);
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
  await page.route('**/api/buyer', async (route) => {
    sent.push(route.request().postData() ?? '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/plan');
  await expect(
    page.getByRole('button', { name: /^(Continue|Pick One to Continue)$/ }),
  ).toBeEnabled();
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
  await page.waitForSelector('#bs-fixture');
  return sent;
}
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
async function reachCheck(page: Page) {
  await page.locator('#reply-body').fill(typed);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Check/ })).toBeVisible();
}

test.describe('the evidence reply says what Send response will do, above each Send', () => {
  test('each form has one block directly above its Send, with three read-only rows', async ({
    page,
  }) => {
    await mount(page, 1440);
    await expect(page.locator('form.operator-form')).toHaveCount(2);
    await expect(page.locator('.before-send')).toHaveCount(2);
    // The older single preview is not drawn while the block is on.
    await expect(page.getByRole('group', { name: say('consequence.heading') })).toHaveCount(2);
    for (const form of await page.locator('form.operator-form').all()) {
      const block = form.locator('.before-send');
      await expect(block.locator('.before-send-row')).toHaveCount(3);
      await expect(block.locator('.before-send-question')).toHaveText([
        say('privacy.heading'),
        say('consequence.what'),
        say('consequence.until'),
      ]);
      await expect(block).toContainText(say('privacy.reader.anyoneWithThisLink'));
      await expect(block).toContainText(say('privacy.reader.sendingTeam'));
      await expect(block).toContainText(say('consequence.whatSent'));
      await expect(block).toContainText(`${say('consequence.untilBody')} 17 Dec 2026`);
      await expect(block).toContainText(say('consequence.oneResponse'));
      await expect(block.locator('.before-send-once svg')).toHaveCount(1);
      await expect(block.locator('button, input, a, select, textarea, [tabindex]')).toHaveCount(0);
      // The block comes before Send in the DOM, so a screen reader meets it in the same order as the eye.
      const before = await form.evaluate(
        (el) =>
          !!(
            el.querySelector('.before-send')!.compareDocumentPosition(el.querySelector('button')!) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      );
      expect(before).toBe(true);
    }
  });

  test('an unticked declaration shows one message, sends nothing and keeps Send available', async ({
    page,
  }) => {
    const sent = await mount(page, 390);
    const form = page.locator('form.operator-form').first();
    await form.getByLabel('Response', { exact: true }).fill(typed);
    const send = form.getByRole('button', { name: 'Send response', exact: true });
    await send.click();
    const box = form.getByRole('checkbox');
    const error = form.locator('.field-error');
    await expect(error).toHaveCount(1);
    await expect(error).toHaveText(say('beforeSend.tick'));
    await expect(error.locator('svg')).toHaveCount(1);
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    const id = await error.getAttribute('id');
    await expect(box).toHaveAttribute('aria-describedby', id!);
    await expect(box).toBeFocused();
    await expect(send).toBeEnabled();
    expect(sent).toEqual([]);
    expect(await error.evaluate((el) => getComputedStyle(el).borderInlineStartWidth)).toBe('2px');
    // Recovery: ticking clears the message and the same Send now sends, byte for byte as before.
    await box.check();
    await expect(error).toHaveCount(0);
    await expect(box).not.toHaveAttribute('aria-invalid', 'true');
    await send.click();
    await expect(page.getByRole('status').filter({ hasText: 'Response received' })).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].replace(/"commandId":"[0-9a-f-]{36}"/, '"commandId":"<uuid>"')).toBe(
      `{"action":"respond","requestId":"${requestId}","body":"${typed}","acknowledged":true,"commandId":"<uuid>","audience":"CLIENT_PROGRESS","token":"${token}"}`,
    );
  });

  for (const width of widths)
    test(`at ${width}px: inside the width, 44 px targets, Send height steps at 768, axe clean`, async ({
      page,
    }) => {
      await mount(page, width);
      await expect(page.locator('form.operator-form').first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const send = (await page
        .locator('form.operator-form')
        .first()
        .getByRole('button', { name: 'Send response', exact: true })
        .boundingBox())!;
      expect(send.height).toBeGreaterThanOrEqual(width >= 768 ? 48 : 56);
      const label = (await page.locator('.before-send-check').first().boundingBox())!;
      expect(label.height).toBeGreaterThanOrEqual(44);
      const title = await page
        .locator('.before-send-question')
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.fontSize, style.fontWeight];
        });
      expect(title).toEqual(['18px', '600']);
      await page
        .locator('form.operator-form')
        .first()
        .getByLabel('Response', { exact: true })
        .fill(typed);
      await page.locator('form.operator-form').first().getByRole('button').click();
      await expect(page.locator('.field-error')).toHaveCount(1);
      const found = (
        await new AxeBuilder({ page }).include('form.operator-form').analyze()
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found).toEqual([]);
      await shot(page, `evidence-${width}`);
    });

  test('forced colours keep the block border and the 2 px error edge', async ({ page }) => {
    await mount(page, 390);
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(page.locator('form.operator-form').first()).toBeVisible();
    await page
      .locator('form.operator-form')
      .first()
      .getByLabel('Response', { exact: true })
      .fill(typed);
    await page.locator('form.operator-form').first().getByRole('button').click();
    await expect(page.locator('.field-error')).toHaveCount(1);
    const edges = await page.evaluate(() => {
      const width = (selector: string, side: 'borderTopWidth' | 'borderInlineStartWidth') =>
        getComputedStyle(document.querySelector(selector)!)[side];
      const style = getComputedStyle(document.querySelector('.field-error')!);
      return [
        width('.before-send', 'borderTopWidth'),
        width('.field-error', 'borderInlineStartWidth'),
        style.borderInlineStartStyle,
      ];
    });
    expect(edges).toEqual(['1px', '2px', 'solid']);
  });
});

test.describe('the recipient reply check step says the same, without a withdrawal claim', () => {
  test('the block sits directly above Send with the three readers and no one-response sentence', async ({
    page,
  }) => {
    await mount(page, 390, 'reply');
    await reachCheck(page);
    const block = page.locator('.before-send');
    await expect(block).toHaveCount(1);
    await expect(page.locator('.privacy-label')).toHaveCount(0);
    await expect(block.locator('.before-send-question')).toHaveText([
      say('privacy.heading'),
      say('consequence.what'),
      say('consequence.until'),
    ]);
    await expect(block.locator('.before-send-readers li')).toHaveCount(3);
    await expect(block).toContainText(say('privacy.reader.anyoneWithReplyLink'));
    await expect(block).toContainText(say('privacy.reader.sendingTeam'));
    await expect(block).toContainText(
      `${say('privacy.reader.requester')} ${say('privacy.notStated')}`,
    );
    await expect(block).toContainText('Recorded as your own declaration. The team will review it.');
    await expect(block).toContainText('This private link expires');
    await expect(block).not.toContainText(say('consequence.oneResponse'));
    await expect(block.locator('.before-send-once')).toHaveCount(0);
    await expect(block).not.toContainText(/withdraw/i);
    await expect(block.locator('button, input, a, select, textarea, [tabindex]')).toHaveCount(0);
    const order = await page.evaluate(() => {
      const form = document.querySelector('form')!;
      const send = [...form.querySelectorAll('button')].find((b) => b.textContent === 'Send')!;
      return !!(
        form.querySelector('.before-send')!.compareDocumentPosition(send) &
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(order).toBe(true);
  });

  test('an unticked declaration shows the same one message and sends nothing', async ({ page }) => {
    const sent = await mount(page, 390, 'reply');
    await reachCheck(page);
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await send.click();
    const error = page.locator('.field-error');
    await expect(error).toHaveText(say('beforeSend.tick'));
    const box = page.getByRole('checkbox');
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(box).toHaveAttribute('aria-describedby', (await error.getAttribute('id'))!);
    await expect(box).toBeFocused();
    await expect(send).toBeEnabled();
    expect(sent).toEqual([]);
    await box.check();
    await expect(error).toHaveCount(0);
    await send.click();
    await expect.poll(() => sent.length).toBeGreaterThan(0);
    expect(JSON.parse(sent[0])).toMatchObject({ action: 'detail-response', acknowledged: true });
  });

  for (const width of widths)
    test(`at ${width}px: inside the width, Send height steps at 768, axe clean`, async ({
      page,
    }) => {
      await mount(page, width, 'reply');
      await reachCheck(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const send = (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox())!;
      expect(send.height).toBeGreaterThanOrEqual(width >= 768 ? 48 : 56);
      const found = (
        await new AxeBuilder({ page }).include('#bs-fixture').analyze()
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found).toEqual([]);
      await shot(page, `reply-${width}`);
    });
});

test.describe('other scripts and directions at 320px', () => {
  for (const locale of ['ar', 'bn', 'zh'] as const)
    test(`${locale} reads in its own direction, inside the width, axe clean`, async ({ page }) => {
      await mount(page, 320, locale);
      const block = page.locator('.before-send');
      await expect(block).toHaveAttribute('lang', locale === 'zh' ? 'zh-Hans' : locale);
      await expect(block).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(block).toContainText(translate(locale, 'consequence.oneResponse'));
      await expect(block).toContainText(translate(locale, 'consequence.until'));
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const found = (await new AxeBuilder({ page }).include('#bs-fixture').analyze()).violations;
      expect(found.map((v) => v.id)).toEqual([]);
      if (locale === 'ar') await shot(page, 'evidence-ar-320');
    });
});

test.describe('with the switch off both pages keep what they had', () => {
  test('the evidence reply draws no block, keeps the native required box and the old preview', async ({
    page,
  }) => {
    await mount(page, 390, 'evidenceoff');
    await expect(page.locator('form.operator-form').first()).toBeVisible();
    await expect(page.locator('.before-send')).toHaveCount(0);
    const form = page.locator('form.operator-form').first();
    await expect(form.getByRole('checkbox')).toHaveAttribute('required', '');
    await expect(form.getByRole('checkbox')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.field-error')).toHaveCount(0);
  });

  test('the recipient reply keeps its privacy label, its alert and focus on Send', async ({
    page,
  }) => {
    await mount(page, 390, 'replyoff');
    await reachCheck(page);
    await expect(page.locator('.before-send')).toHaveCount(0);
    await expect(page.locator('.privacy-label')).toHaveCount(1);
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await send.click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Tick the box to confirm.' }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox').last()).not.toBeFocused();
  });
});
