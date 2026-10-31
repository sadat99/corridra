import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { clearSignInLimits, totp } from './operator-signin';

// The staff billing panel inside the real workspace frame (Delivery, phone fold, delivery
// experience, billing hub), where its text column was narrowed on phones. The committed
// v3-billing-ui fixture mounts the panel without that nesting, so it cannot show the fault.
// BILLING_PHONE_EVIDENCE=before|after also writes the captures and measurements.
const stage = process.env.BILLING_PHONE_EVIDENCE;
const capturing = stage === 'before' || stage === 'after';
const folder = `docs/design-system/evidence/billing-phone-and-error-return-2026-10-31/${stage}`;
const billingRoute = '**/api/workspace/customer-billing**';
const subscriptionId = '00000000-0000-4000-8000-0000000000b2';
const words = ['Problem.', 'subscription', 'requested', 'customer', 'refused', 'Activate'];
// An 80-character note with no break opportunity, which must still wrap inside the card.
const longNote = 'Synthetic' + 'x'.repeat(71);
const phone: Record<number, { text: number; notice: number }> = {
  320: { text: 200, notice: 160 },
  390: { text: 260, notice: 220 },
};
// The computed frames at 768, 1024 and 1440 as measured at d073641 (the before run), which the
// phone-only rules must leave exactly as they were.
const framedCard = {
  border: '1px 1px',
  padding: '24px 24px',
  background: 'rgb(255, 255, 255)',
  radius: '12px',
};
const wideFrames = [
  { selector: '#workspace-delivery section.delivery-ops.detail-card', ...framedCard },
  {
    selector: '#workspace-delivery details.phone-fold',
    border: '0px 0px',
    padding: '0px 0px',
    background: 'rgba(0, 0, 0, 0)',
    radius: '12px',
  },
  { selector: '#workspace-delivery details.phone-fold > section.detail-card', ...framedCard },
  { selector: '#billing-plans > section.detail-card', ...framedCard },
];

const summary = (over: Record<string, unknown> = {}) => ({
  id: subscriptionId,
  workspaceName: 'Synthetic billing workspace',
  planKey: 'example-organiser',
  planVersion: 1,
  planTitle: 'Organiser monthly (sample plan)',
  interval: 'month',
  priceMinor: '4900',
  currency: 'USD',
  status: 'requested',
  periodStart: null,
  periodEnd: null,
  periodElapsed: false,
  lastSeq: 2,
  ...over,
});
const entitlementKeys = [
  { key: 'workspace_members', unit: 'count', label: 'People in the workspace' },
  { key: 'report_exports', unit: 'flag', label: 'Programme report exports' },
];
const plan = {
  key: 'example-organiser',
  version: 1,
  title: 'Organiser monthly (sample plan)',
  summary: 'An example monthly plan for a delegation organiser. The price is invented.',
  interval: 'month',
  priceMinor: '4900',
  currency: 'USD',
  taxTreatment: 'price_excludes_tax',
  included: ['A shared workspace for a larger team'],
  excluded: ['The cost of any help request'],
  entitlements: [
    {
      key: 'workspace_members',
      label: 'People in the workspace',
      unit: 'count',
      mode: 'limit',
      limit: 10,
    },
    {
      key: 'report_exports',
      label: 'Programme report exports',
      unit: 'flag',
      mode: 'included',
      limit: null,
    },
  ],
  active: true,
};
const detail = {
  subscription: summary(),
  plan,
  events: [
    {
      seq: 1,
      at: '2026-10-22T09:00:00.000Z',
      kind: 'requested',
      status: 'requested',
      actorKind: 'customer',
      customerNote: null,
      internalNote: null,
      periodStart: null,
      periodEnd: null,
      endReason: null,
    },
    {
      seq: 2,
      at: '2026-10-22T10:00:00.000Z',
      kind: 'note',
      status: 'requested',
      actorKind: 'staff',
      customerNote: null,
      internalNote: longNote,
      periodStart: null,
      periodEnd: null,
      endReason: null,
    },
  ],
  lastSeq: 2,
  actions: ['activate', 'decline', 'note'],
  replacesHeldPlan: false,
  periodElapsed: false,
  synthetic: true,
};

// What the mocked billing reads and saves answer; each state the panel can show.
type Mode = {
  list: 'one' | 'empty' | 'denied' | 'loading';
  save: 'conflict' | 'unconfirmed' | 'saved';
};
async function serveBilling(page: Page, mode: Mode) {
  const held: Route[] = [];
  await page.route(billingRoute, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST')
      return mode.save === 'conflict'
        ? route.fulfill({ status: 409, json: { error: 'Synthetic conflict' } })
        : mode.save === 'unconfirmed'
          ? route.fulfill({ status: 500, json: { error: 'Synthetic lost save' } })
          : route.fulfill({ json: summary({ status: 'active' }) });
    const scope = url.searchParams.get('scope');
    if (scope === 'detail') return route.fulfill({ json: detail });
    if (scope === 'plans')
      return route.fulfill({ json: { plans: [plan], entitlementKeys, synthetic: true } });
    if (mode.list === 'denied')
      return route.fulfill({ status: 403, json: { error: 'Synthetic refusal' } });
    if (mode.list === 'loading') {
      held.push(route);
      return;
    }
    return route.fulfill({
      json: {
        subscriptions: mode.list === 'empty' ? [] : [summary()],
        nextAfter: null,
        synthetic: true,
      },
    });
  });
  return held;
}

// Widths of the plans card and what it holds, measured in the page.
async function measure(page: Page) {
  return page.evaluate((splitWords) => {
    const card = document.querySelector<HTMLElement>('#billing-plans > section.detail-card')!;
    const cardStyle = getComputedStyle(card);
    const box = card.getBoundingClientRect();
    const left =
      box.left + parseFloat(cardStyle.borderLeftWidth) + parseFloat(cardStyle.paddingLeft);
    const right =
      box.right - parseFloat(cardStyle.borderRightWidth) - parseFloat(cardStyle.paddingRight);
    const contentBox = (element: Element | null) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return (
        (element as HTMLElement).clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      );
    };
    const named = (element: Element) =>
      element.tagName.toLowerCase() + (element.className ? '.' + String(element.className) : '');
    const wider = Array.from(card.querySelectorAll('*'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < left - 1 || rect.right > right + 1);
      })
      .map(named);
    const spilled = Array.from(card.querySelectorAll('p, li, h3, h4, label, legend, summary'))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map(named);
    const split: string[] = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const word of splitWords)
        for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + word.length);
          const lines = new Set(
            Array.from(range.getClientRects())
              .filter((r) => r.width > 0)
              .map((r) => Math.round(r.top)),
          );
          if (lines.size > 1) split.push(word);
        }
    }
    const small = [
      ...Array.from(card.querySelectorAll('button, input, select, textarea, summary')),
      ...Array.from(document.querySelectorAll('#workspace-delivery .billing-jump a')),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height < 43.5;
      })
      .map(named);
    return {
      card: Math.round(right - left),
      detail: contentBox(card.querySelector('.billing-detail > h4 + p')),
      notice: contentBox(card.querySelector('.billing-notice')),
      wider,
      spilled,
      split,
      small,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  }, words);
}
type Measures = Awaited<ReturnType<typeof measure>>;

const record: Record<string, unknown> = {};
async function checkPhone(page: Page, width: number, state: string) {
  const m: Measures = await measure(page);
  record[`${width} ${state}`] = m;
  const min = phone[width]!;
  expect.soft(m.card, `${width} ${state}: card content`).toBeGreaterThanOrEqual(min.text);
  if (m.detail !== null)
    expect.soft(m.detail, `${width} ${state}: detail paragraph`).toBeGreaterThanOrEqual(min.text);
  if (m.notice !== null)
    expect.soft(m.notice, `${width} ${state}: notice text`).toBeGreaterThanOrEqual(min.notice);
  expect.soft(m.wider, `${width} ${state}: wider than the card`).toEqual([]);
  expect.soft(m.spilled, `${width} ${state}: text past its box`).toEqual([]);
  expect.soft(m.split, `${width} ${state}: words split`).toEqual([]);
  expect.soft(m.small, `${width} ${state}: targets under 44 px`).toEqual([]);
  expect.soft(m.sideways, `${width} ${state}: sideways scroll`).toBe(false);
}
async function axeClean(page: Page, label: string) {
  expect
    .soft(
      (await new AxeBuilder({ page }).include('#workspace-delivery').analyze()).violations.map(
        (v) => v.id,
      ),
      label,
    )
    .toEqual([]);
}
async function capture(page: Page, name: string) {
  if (!capturing) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${folder}/${name}.png` });
}
// Brings an element to the top of the view with no smooth scrolling, so captures are stable.
async function toTop(page: Page, selector: string) {
  await page
    .locator(selector)
    .first()
    .evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
}

// The Status line at the top of the view with the notice below it. Where the notice does not fit
// in that view (as on phones before the phone rules), the notice is brought to the top instead, so
// the capture still shows the result, and the miss is reported.
async function frameNotice(page: Page, label: string) {
  const status = page.locator('#billing-plans .billing-detail > h4 + p');
  const lead = page.locator('#billing-plans .billing-notice strong');
  await toTop(page, '#billing-plans .billing-detail > h4 + p');
  const inView = await lead.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  if (!inView) await toTop(page, '#billing-plans .billing-notice');
  await expect(lead).toBeInViewport({ ratio: 1 });
  await expect.soft(status, `${label}: Status line in view with the notice`).toBeInViewport();
}

test('the staff billing panel reads in normal lines on phones and is unchanged from 40rem up', async ({
  page,
}) => {
  test.setTimeout(240000);
  const seed = JSON.parse(await readFile('.cache/part03-browser.json', 'utf8'));
  const { secret } = JSON.parse(await readFile('.cache/part06-browser-authenticator.json', 'utf8'));
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const address = '/operator?workspace=' + seed.tenantId + '#workspace-delivery';
  const card = page.locator('#billing-plans > section.detail-card');
  const fold = page.locator('#workspace-delivery details.phone-fold').first();
  const mode: Mode = { list: 'one', save: 'conflict' };
  if (capturing) await mkdir(folder, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await clearSignInLimits(local.ownerPassword);
  try {
    await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
    await page.goto('/operator/signin');
    await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(seed.password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Six-digit code', { exact: true }).fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and open workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Your workspace.', exact: true })).toBeVisible();
    const held = await serveBilling(page, mode);

    async function open(width: number) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('about:blank');
      await page.goto(address);
      await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
      await expect(
        page.getByRole('heading', { name: 'Client and programme delivery' }),
      ).toBeVisible();
    }
    async function unfold() {
      if (!(await fold.evaluate((details) => (details as HTMLDetailsElement).open)))
        await fold.locator(':scope > summary').click();
      await expect(card).toBeVisible();
    }

    for (const width of [320, 390]) {
      mode.list = 'one';
      mode.save = 'conflict';
      await open(width);
      // Closed by default on phones: the heading and the fold summary, with the parents flattened.
      await expect(fold).not.toHaveAttribute('open', '');
      await toTop(page, '#workspace-delivery section.delivery-ops');
      await capture(page, `delivery-top-${width}`);
      const closedLength = await page
        .locator('#workspace-delivery')
        .evaluate((panel) => panel.getBoundingClientRect().height);
      await unfold();
      const openLength = await page
        .locator('#workspace-delivery')
        .evaluate((panel) => panel.getBoundingClientRect().height);
      record[`${width} panel length`] = { closed: closedLength, open: openLength };

      await expect(card.locator('.billing-request')).toHaveCount(1);
      await toTop(page, '#billing-plans');
      await capture(page, `billing-requests-${width}`);
      await checkPhone(page, width, 'requests');
      await card
        .getByRole('button', {
          name: 'Open Organiser monthly (sample plan) for Synthetic billing workspace',
        })
        .click();
      await expect(card.getByText('Status: requested.', { exact: false })).toBeVisible();
      await checkPhone(page, width, 'detail');
      if (width === 320) {
        await toTop(page, '#billing-plans .billing-timeline');
        await capture(page, 'billing-long-note-320');
      }

      // Conflict: the result is said next to Activate, with the Status line in the same view.
      const activate = card.getByRole('form', { name: 'Activate' });
      await activate.getByRole('button', { name: 'Activate this plan' }).click();
      const notice = card.locator('.billing-notice');
      await expect(notice).toContainText('Reload and check.');
      expect(await notice.textContent()).toMatch(/^Problem\. \S/);
      await expect(notice.locator('strong')).toHaveCSS('margin-right', '0px');
      await expect(notice).toHaveAttribute('role', 'alert');
      await expect(notice).toHaveAttribute('data-tone', 'error');
      await frameNotice(page, `${width} conflict`);
      await capture(page, `billing-error-${width}`);
      await checkPhone(page, width, 'conflict');
      await axeClean(page, `${width} conflict axe`);

      // A save that could not be confirmed, then one that is saved.
      mode.save = 'unconfirmed';
      await activate.getByRole('button', { name: 'Activate this plan' }).click();
      await expect(notice).toContainText('Could not confirm that this was saved.');
      await checkPhone(page, width, 'unconfirmed');
      mode.save = 'saved';
      await activate.getByRole('button', { name: 'Activate this plan' }).click();
      await expect(notice).toContainText('Saved. The plan is active for the period you set.');
      await expect(notice).toHaveAttribute('role', 'status');
      await expect(notice).toBeInViewport();
      await toTop(page, '#billing-plans .billing-notice');
      await capture(page, `billing-saved-${width}`);
      await checkPhone(page, width, 'saved');

      // The plan form with its price pair.
      await card.getByText('Plans on offer and plan versions').click();
      await card.getByRole('button', { name: 'Add a new plan' }).click();
      await expect(card.getByRole('form', { name: 'Plan version' })).toBeVisible();
      await toTop(page, '#billing-plans .billing-pair');
      await capture(page, `billing-plan-form-${width}`);
      await checkPhone(page, width, 'plan form');
      await axeClean(page, `${width} plan form axe`);

      // Empty, refused and loading lists.
      for (const list of ['empty', 'denied', 'loading'] as const) {
        mode.list = list;
        await open(width);
        await unfold();
        await expect(
          card.getByText(
            list === 'empty'
              ? 'No customer has asked for a plan.'
              : list === 'denied'
                ? 'Owner or admin access with a fresh authenticator check is required.'
                : 'Loading plan requests…',
            { exact: false },
          ),
        ).toBeVisible();
        await checkPhone(page, width, list);
      }
      for (const route of held.splice(0)) await route.abort().catch(() => undefined);
    }

    // From 40rem up nothing changes: each frame keeps its border and padding, the phone fold has
    // no chrome, and the conflict notice sits where it did.
    for (const width of [768, 1024, 1440]) {
      mode.list = 'one';
      mode.save = 'conflict';
      await open(width);
      await expect(card).toBeVisible();
      const frames = await page.evaluate(() =>
        [
          '#workspace-delivery section.delivery-ops.detail-card',
          '#workspace-delivery details.phone-fold',
          '#workspace-delivery details.phone-fold > section.detail-card',
          '#billing-plans > section.detail-card',
        ].map((selector) => {
          const style = getComputedStyle(document.querySelector(selector)!);
          return {
            selector,
            border: style.borderLeftWidth + ' ' + style.borderTopWidth,
            padding: style.paddingLeft + ' ' + style.paddingTop,
            background: style.backgroundColor,
            radius: style.borderTopLeftRadius,
          };
        }),
      );
      record[`${width} frames`] = frames;
      expect.soft(frames, `${width} frames`).toEqual(wideFrames);
      if (width !== 1024) {
        await card
          .getByRole('button', {
            name: 'Open Organiser monthly (sample plan) for Synthetic billing workspace',
          })
          .click();
        await card
          .getByRole('form', { name: 'Activate' })
          .getByRole('button', { name: 'Activate this plan' })
          .click();
        await expect(card.locator('.billing-notice')).toContainText('Reload and check.');
        await frameNotice(page, `${width} conflict`);
        await capture(page, `billing-error-${width}`);
        await axeClean(page, `${width} conflict axe`);
      }
    }
  } finally {
    if (capturing)
      await writeFile(`${folder}/measurements.json`, JSON.stringify(record, null, 2) + '\n');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await clearSignInLimits(local.ownerPassword);
  }
});
