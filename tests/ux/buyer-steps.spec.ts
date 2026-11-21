import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { translate } from '../../apps/web/lib/i18n/messages';

// Wave 3 unit 08 (owner approved 20 November 2026): the Buyer reply in steps, behind CORRIDRA_UX_BUYER_STEPS. The real
// BuyerIntroduction (and so the real respond command) is mounted inside the page's customer wrappers, the way
// before-send.spec.ts mounts the reply, with /api/buyer answered by the test. Every name is invented sample data.

const token = 'a'.repeat(64);
const typed = 'We can supply plain trims.';
const claim = 'Operator-reported context. No independent verification is asserted.';
const widths = [320, 390, 768, 1440] as const;
const shots = process.env.BUYER_STEPS_SHOTS_DIR;
let script = '';
let styles = '';

const introduction = {
  company: 'Example Trims Limited',
  country: 'Bangladesh',
  capability: 'Plain trims',
  fit: 'They make trims for a spring line.',
  evidence: 'Operator reported.',
  uncertainty: 'Monthly volume not stated',
  conversationPurpose: 'Discuss a trim supply',
  availableDates: 'Weeks 3 and 4',
};
const view = (over: Record<string, unknown> = {}) => ({
  role: 'SUPPLIER',
  sharedRequirements: 'Plain trims for a spring line, about 1,200 pieces.',
  sharedUncertainty: 'Buyer budget is not verified.',
  allowQuotation: false,
  allowMeetingInterest: false,
  introduction,
  template: 'An introduction from the Corridra team.',
  expiresAt: '2099-01-01T00:00:00.000Z',
  decision: null,
  synthetic: true,
  ...over,
});

const entry = `
import { createRoot } from 'react-dom/client';
import { BuyerIntroduction } from ${JSON.stringify(resolve('apps/web/app/buyer/introduction.tsx'))};

createRoot(document.getElementById('mount')).render(
  <main id="bs-fixture" lang="en" className="ux-workspace ux-customer">
    <h1>Example: Would this company be relevant to you?</h1>
    <BuyerIntroduction replyPage chineseReleased beforeSend steps={window.__steps} />
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

type Sent = Record<string, unknown>;
type Options = {
  steps?: boolean;
  language?: 'en' | 'zh';
  view?: Record<string, unknown>;
  failRespond?: number;
};

/** Serves /plan for the app's own stylesheet, answers /api/buyer and keeps every command, in order. */
async function mount(page: Page, width: number, options: Options = {}) {
  const sent: Sent[] = [];
  let failures = options.failRespond ?? 0;
  await page.route('**/api/buyer', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Sent;
    sent.push(body);
    const json = (status: number, value: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (body.action === 'read') return json(200, view(options.view));
    if (body.action === 'respond') {
      if (failures > 0) {
        failures -= 1;
        return json(500, { error: 'The request could not be completed. Please try again.' });
      }
      return json(200, { decision: body.decision });
    }
    if (body.action === 'detail-response') return json(200, { recorded: true });
    return json(400, { error: 'unexpected' });
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
  const hash = `t=${token}${options.language === 'zh' ? '&l=zh' : ''}`;
  await page.evaluate((h) => (window.location.hash = h), hash);
  await page.addScriptTag({
    content: `window.process = { env: { NODE_ENV: "production" } }; window.__steps = ${options.steps !== false};`,
  });
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForSelector('#bs-fixture .reply h2');
  return sent;
}
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const stepLine = (page: Page) => page.locator('.reply-step');
/** Answers Interested, types the message and goes on to the check step, in any language. */
async function reachCheck(page: Page) {
  await page.locator('.ux-choice-primary').click();
  await page.locator('#reply-body').fill(typed);
  await page.locator('.reply-actions .primary-link').click();
  await expect(page.locator('form .before-send')).toBeVisible();
}
/** The commands in the order they were sent, with the random ids replaced by their first-seen position. */
const normalised = (sent: Sent[]) => {
  const ids: string[] = [];
  return sent.map((command) =>
    Object.fromEntries(
      Object.entries(command).map(([key, value]) => {
        if (key !== 'responseId') return [key, value];
        if (!ids.includes(String(value))) ids.push(String(value));
        return [key, `id-${ids.indexOf(String(value))}`];
      }),
    ),
  );
};

test.describe('the step line names this step and the next', () => {
  test('answer, message and check without a quote', async ({ page }) => {
    await mount(page, 390);
    await expect(stepLine(page)).toHaveText('Step 1 of 3: Your answer · Next: Your message');
    await page.getByRole('button', { name: 'Yes, Interested', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your message' })).toBeFocused();
    await expect(stepLine(page)).toHaveText('Step 2 of 3: Your message · Next: Check and send');
    await page.locator('#reply-body').fill(typed);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check and send' })).toBeVisible();
    await expect(stepLine(page)).toHaveText('Step 3 of 3: Check and send');
  });

  test('the quote path counts its four steps', async ({ page }) => {
    await mount(page, 390, { view: { allowQuotation: true } });
    await page.getByRole('button', { name: 'Yes, Interested', exact: true }).click();
    await page.locator('#reply-body').fill(typed);
    await page.getByRole('button', { name: 'Add a quote' }).click();
    await expect(stepLine(page)).toHaveText(
      'Step 3 of 7: Your quote: what you offer · Next: Your quote: the price',
    );
  });

  test('with nothing shared there is no message to follow, so the answer is the only step', async ({
    page,
  }) => {
    await mount(page, 390, { view: { sharedRequirements: undefined } });
    await expect(stepLine(page)).toHaveText('Step 1 of 1: Your answer');
  });
});

test.describe('the introduction reads as one sentence, two fact rows and one fold', () => {
  test('the claim sentence once, no label chips, every string still on the page', async ({
    page,
  }) => {
    await mount(page, 390);
    const intro = page.locator('.reply-intro');
    await expect(intro).toHaveAttribute('lang', 'en');
    await expect(intro.locator('.reply-lead')).toHaveText(
      'An introduction from the Corridra team.',
    );
    await expect(intro.locator(':scope > .reply-facts dt')).toHaveText([
      'Relevant capability',
      'What remains unverified',
    ]);
    await expect(page.getByText(claim, { exact: true })).toHaveCount(1);
    await expect(
      intro.locator('[class*="trust"], [class*="chip"], [class*="badge"], .evidence-label'),
    ).toHaveCount(0);
    // The fold starts closed and holds the rest; the shared requirement is one line in it.
    const fold = page.locator('details.reply-about');
    await expect(fold).not.toHaveAttribute('open', '');
    await expect(page.locator('.reply-shared')).toHaveCount(0);
    await fold.locator('summary').click();
    for (const text of [
      'An introduction from the Corridra team.',
      introduction.capability,
      introduction.uncertainty,
      introduction.fit,
      introduction.company,
      introduction.country,
      introduction.conversationPurpose,
      'Plain trims for a spring line, about 1,200 pieces.',
    ])
      await expect(page.locator('.reply-intro')).toContainText(text);
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator('dd').last()).toBeVisible();
    // The opt-out box sits directly under the three answers.
    const after = await page.evaluate(
      () => document.querySelector('.ux-choice-row')!.nextElementSibling?.className,
    );
    expect(after).toBe('check-field');
    await expect(
      page.getByRole('group', { name: 'Would this company be relevant to you?' }),
    ).toBeVisible();
    await expect(page.locator('.ux-choice svg')).toHaveCount(3);
  });
});

test.describe('the answers send exactly what they sent before', () => {
  async function interestedPath(page: Page, steps: boolean) {
    const sent = await mount(page, 390, { steps });
    await page
      .getByRole('button', { name: steps ? 'Yes, Interested' : 'Interested', exact: true })
      .click();
    await page.locator('#reply-body').fill(typed);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
    await expect.poll(() => sent.filter((c) => c.action === 'read').length).toBe(2);
    return sent;
  }

  test('Yes, Interested sends one respond, then the same detail response as with the switch off', async ({
    page,
    browser,
  }) => {
    const sent = await interestedPath(page, true);
    expect(sent.filter((c) => c.action === 'respond')).toMatchObject([
      { action: 'respond', token, decision: 'INTERESTED', optOut: false },
    ]);
    expect(sent.filter((c) => c.action === 'detail-response')).toHaveLength(1);
    const off = await browser.newPage();
    const before = await interestedPath(off, false);
    await off.close();
    expect(normalised(sent)).toEqual(normalised(before));
  });

  test('ticking opt-out disables Yes, Interested; Not Relevant sends the opt-out', async ({
    page,
  }) => {
    const sent = await mount(page, 390);
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'Yes, Interested', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Not Relevant', exact: true }).click();
    await expect.poll(() => sent.filter((c) => c.action === 'respond').length).toBe(1);
    expect(sent.find((c) => c.action === 'respond')).toMatchObject({
      decision: 'NOT_RELEVANT',
      optOut: true,
    });
  });

  test('a failed answer offers the retry, which resends the same id', async ({ page }) => {
    const sent = await mount(page, 390, { failRespond: 1 });
    await page.getByRole('button', { name: 'I Need More Information', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Retry the same response', exact: true });
    await expect(retry).toBeVisible();
    for (const name of ['Yes, Interested', 'I Need More Information', 'Not Relevant'])
      await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    await retry.click();
    await expect(page.getByRole('heading', { name: 'Your answer is recorded' })).toBeVisible();
    const responds = sent.filter((c) => c.action === 'respond');
    expect(responds).toHaveLength(2);
    expect(responds[1]).toEqual(responds[0]);
    expect(responds[0]).toMatchObject({ decision: 'NEED_INFO', optOut: false });
  });
});

test.describe('the check step reads the shared box and the consent at the moment of sending', () => {
  test('shared box, acknowledgement, Before Send, then Send, in the page flow', async ({
    page,
  }) => {
    const sent = await mount(page, 390);
    await reachCheck(page);
    const order = await page.evaluate(() => {
      const form = document.querySelector('form')!;
      const items = [
        form.querySelector('.reply-shared'),
        form.querySelector('.check-field'),
        form.querySelector('.before-send'),
        form.querySelector('.reply-actions'),
      ];
      const following = items.every(
        (item, i) =>
          i === 0 ||
          !!(items[i - 1]!.compareDocumentPosition(item!) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
      const actions = form.querySelector('.before-send')!.nextElementSibling!;
      const send = actions.firstElementChild as HTMLElement;
      return {
        following,
        sharedLang: [items[0]!.getAttribute('lang'), items[0]!.getAttribute('dir')],
        actions: actions.className,
        first: send.textContent,
        position: getComputedStyle(send).position,
        actionsPosition: getComputedStyle(actions).position,
      };
    });
    expect(order).toEqual({
      following: true,
      sharedLang: ['en', 'ltr'],
      actions: 'reply-actions',
      first: 'Send',
      position: 'static',
      actionsPosition: 'static',
    });
    const back = (await page.getByRole('button', { name: 'Back', exact: true }).boundingBox())!;
    expect(back.height).toBeGreaterThanOrEqual(44);

    // An unticked Send shows the one message and moves focus to the box after it is drawn.
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await send.click();
    const error = page.locator('.field-error');
    await expect(error).toHaveText(translate('en', 'beforeSend.tick'));
    const box = page.getByRole('checkbox');
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('aria-describedby', (await error.getAttribute('id'))!);
    await expect(page.locator('[role="alert"]')).toHaveCount(1);
    expect(sent.filter((c) => c.action === 'detail-response')).toHaveLength(0);
    // Recovery: ticking clears it and the same Send sends.
    await box.check();
    await expect(error).toHaveCount(0);
    await send.click();
    await expect.poll(() => sent.filter((c) => c.action === 'detail-response').length).toBe(1);
  });
});

const layouts = [
  ...widths.map((width) => ({ width, language: 'en' as const })),
  { width: 320, language: 'zh' as const },
  { width: 390, language: 'zh' as const },
];
test.describe('layout', () => {
  for (const { width, language } of layouts)
    test(`${language} at ${width}px: choice heights, type from tokens, no sideways scroll, axe clean`, async ({
      page,
    }) => {
      await mount(page, width, { language });
      const heights = await page
        .locator('.ux-choice')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(heights).toHaveLength(3);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(width >= 768 ? 72 : 64);
      const type = await page.evaluate(() => {
        const token = (name: string) => {
          const probe = document.createElement('span');
          probe.style.setProperty('font-size', `var(${name})`);
          document.querySelector('.reply')!.append(probe);
          const size = getComputedStyle(probe).fontSize;
          probe.remove();
          return size;
        };
        const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
        const h2 = style('.reply h2');
        return {
          h2: Number.parseFloat(h2.lineHeight) / Number.parseFloat(h2.fontSize),
          h2Size: [h2.fontSize, token('--text-h2')],
          lead: [style('.reply-lead').fontSize, token('--text-lead')],
          dd: [style('.reply-facts dd').fontSize, token('--text-base')],
          step: [style('.reply-step').fontSize, token('--text-lg')],
          transform: style('.reply-step').textTransform,
        };
      });
      expect(type.h2).toBeCloseTo(1.3, 2);
      expect(type.h2Size[0]).toBe(type.h2Size[1]);
      expect(type.lead[0]).toBe(type.lead[1]);
      expect(type.dd[0]).toBe(type.dd[1]);
      expect(type.step[0]).toBe(type.step[1]);
      expect(type.transform).toBe('none');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const answer = (await new AxeBuilder({ page }).include('#bs-fixture').analyze()).violations;
      expect(answer.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
      await shot(page, `answer-${language}-${width}`);

      await reachCheck(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const check = (await new AxeBuilder({ page }).include('#bs-fixture').analyze()).violations;
      expect(check.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`)).toEqual([]);
      await shot(page, `check-${language}-${width}`);
    });
});

test.describe('with the switch off the page keeps what it had', () => {
  test('no steps marker, no choice rows, the old answers and the shared box on the first step', async ({
    page,
  }) => {
    await mount(page, 390, { steps: false });
    await expect(page.locator('.reply')).not.toHaveAttribute('data-steps', '');
    await expect(page.locator('.ux-choice')).toHaveCount(0);
    await expect(page.locator('.reply-intro')).toHaveCount(0);
    await expect(stepLine(page)).toHaveText('Step 1 of 3');
    await expect(page.locator('.reply-shared')).toBeVisible();
    for (const name of ['Interested', 'Need more information', 'Not relevant'])
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await shot(page, 'answer-switch-off-390');
  });
});
