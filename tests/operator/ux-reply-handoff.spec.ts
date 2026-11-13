import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The hand-off from a published supplier reply to the "Record a supplier offer" form (ADR-081): the reply
// card's link, and the bound form with the supplier's exact terms. The real components and stylesheets are
// mounted; the workspace interfaces are answered by the test. No database, no supplier.
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');
const tenant = '11111111-1111-4111-8111-111111111111';
const replyId = '22222222-2222-4222-8222-222222222222';
const missionId = '44444444-4444-4444-8444-444444444444';
const rfqId = '55555555-5555-4555-8555-555555555555';
const targetId = '66666666-6666-4666-8666-666666666666';
const requirementId = '77777777-7777-4777-8777-777777777777';
const previousId = '88888888-8888-4888-8888-888888888888';
const sourceId = '99999999-9999-4999-8999-999999999999';
const claimId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const digest = 'ab'.repeat(32);
const linkId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const published = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    responseId: replyId,
    decision: 'PUBLISH',
    reasonCode: null,
    askTerms: null,
    note: null,
    createdAt: '2026-10-25T01:00:00Z',
  },
];
const reply = {
  id: replyId,
  link_id: linkId,
  created_at: '2026-10-24T08:00:00Z',
  body: {
    body: 'We can quote this.',
    meetingInterest: false,
    quotation: {
      currency: 'USD',
      terms: { quantity: '10', unit: 'pieces', unitPriceMinor: '1250', totalPriceMinor: '12500' },
      uncertainties: 'Lead time not yet known',
    },
  },
};

function eligible(over: { currency?: string; terms?: Record<string, string> } = {}) {
  return {
    eligible: true,
    reason: null,
    responseId: replyId,
    seen: 2,
    digest,
    missionId,
    rfqId,
    requirementId,
    targetId,
    currency: over.currency ?? 'USD',
    terms: over.terms ?? {
      quantity: '10',
      unit: 'pieces',
      unitPriceMinor: '1250',
      totalPriceMinor: '12500',
      toolingMinor: '0',
      leadTime: '6 weeks',
    },
    uncertainties: 'Lead time not yet known',
    observedAt: '2026-10-24T08:00:00.123456Z',
    sourceKind: 'SELF_DECLARATION',
    revision: 3,
    previousId,
  };
}
const refusalCodes = [
  'NOT_FOUND',
  'NOT_PUBLISHED',
  'REJECTED',
  'ASKED_ONLY',
  'ALREADY_RECORDED',
  'NO_QUOTATION',
  'REVIEW_CLOSED',
  'MISSION_CLOSED',
  'REQUIREMENT_SUPERSEDED',
  'CURRENCY_NOT_ON_ROUTE',
  'TERM_NOT_RECORDABLE',
];
const digitsOnly = (text: string | null) => (text ?? '').replace(/[^\d.]/g, '');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{ReplyReview}from ${JSON.stringify(resolve('apps/web/app/operator/reply-review.tsx'))};
      import{CommercialMission}from ${JSON.stringify(resolve('apps/web/app/operator/commercial-mission.tsx'))};
      import{OperatorFlags}from ${JSON.stringify(resolve('apps/web/app/operator/operator-flags.tsx'))};
      const q=new URLSearchParams(location.search);
      const props=JSON.parse(q.get('props'));
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page ux-workspace"><h1>Mission</h1><h2>Work</h2><h3>Requirements</h3>
        <OperatorFlags replyReview>{q.get('entry')==='card'
          ?<ReplyReview {...props}/>
          :<CommercialMission {...props}/>}</OperatorFlags></main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hand-off fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Answer = { status: number; body: unknown };
type Options = {
  role?: string;
  prefill?: Answer;
  /** Answers to saving the offer, one per attempt; the last repeats. */
  saves?: Answer[];
  saveDelay?: number;
  /** Whether mission pages are on (CORRIDRA_UX_MISSIONS_V2); on unless false. */
  missionsV2?: boolean;
  /** Never answers the prefill request. */
  prefillStalls?: boolean;
  /** Milliseconds to hold the flags answer, and an answer to give instead of the flags. */
  flagsDelay?: number;
  flagsAnswer?: Answer;
};
/** Answers the workspace interfaces and records what the page asked for. */
async function stub(page: Page, options: Options) {
  const prefillRequests: string[] = [];
  const saved: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (status: number, value: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/api/team-work/flags') {
      if (options.flagsDelay) await new Promise((done) => setTimeout(done, options.flagsDelay));
      const answer = options.flagsAnswer ?? {
        status: 200,
        body: { missionsV2: options.missionsV2 !== false },
      };
      return json(answer.status, answer.body);
    }
    if (url.pathname === '/api/reply/review') return json(200, { open: false, reviews: published });
    if (url.pathname === '/api/workspace/reply-quotation-prefill') {
      prefillRequests.push(url.search);
      if (options.prefillStalls) return;
      const answer = options.prefill ?? { status: 200, body: eligible() };
      return json(answer.status, answer.body);
    }
    if (url.pathname === '/api/workspace/mission-catalogue')
      return json(200, { packs: [], types: [], requirements: [], assessments: [] });
    if (url.pathname === '/api/workspace/workspace')
      return json(200, {
        sources: [{ id: sourceId, locator: 'Supplier reply, self-declared' }],
        claims: [
          { id: claimId, source_id: sourceId, statement: 'The supplier stated these terms' },
        ],
      });
    if (url.pathname === '/api/workspace/commercial-mission') {
      if (request.method() === 'GET')
        return json(200, {
          role: options.role ?? 'owner',
          mission: { id: missionId, version: 1, created_at: '2026-10-20T00:00:00Z', brief: {} },
          assignments: [],
          requirements: [],
          assessments: [],
          rfqs: [],
          quotations: [],
          decisions: [],
          schedules: [],
          meetings: [],
          targets: [],
          owners: [],
          comparison: [],
        });
      saved.push(JSON.parse(request.postData() ?? '{}'));
      if (options.saveDelay) await new Promise((done) => setTimeout(done, options.saveDelay));
      const saves = options.saves ?? [{ status: 200, body: { id: 'x' } }];
      const answer = saves[Math.min(saved.length, saves.length) - 1]!;
      return json(answer.status, answer.body);
    }
    return json(404, { error: 'Not stubbed' });
  });
  return { prefillRequests, saved };
}
async function openCard(page: Page, role: string) {
  await page.goto(
    `${origin}/?entry=card&props=${encodeURIComponent(
      JSON.stringify({
        tenant,
        role,
        responses: [reply],
        disclosures: [{ link_id: linkId, role: 'SUPPLIER', shared_requirements: 'Curtain track' }],
      }),
    )}`,
  );
}
async function openForm(page: Page, reference: string | null = replyId) {
  await page.goto(
    `${origin}/?entry=form&props=${encodeURIComponent(
      JSON.stringify({ tenant, missionId, ...(reference === null ? {} : { replyId: reference }) }),
    )}`,
  );
}
async function fillAndSave(page: Page) {
  await page.getByLabel('Declared source').selectOption(sourceId);
  await page.getByLabel('Source declaration').selectOption(claimId);
  await page.getByRole('button', { name: 'Save Quotation', exact: true }).click();
}

test.describe('the reply card', () => {
  for (const role of ['owner', 'admin', 'operator']) {
    test(`offers the prepared offer to ${role} and links to the mission's Requirements tab`, async ({
      page,
    }) => {
      const { prefillRequests } = await stub(page, {});
      await openCard(page, role);
      const link = page.getByRole('link', { name: 'Open Prepared Offer' });
      await expect(link).toHaveAttribute(
        'href',
        `/operator/missions/${missionId}?workspace=${tenant}&reply=${replyId}#requirements`,
      );
      await expect(
        page.getByText('Published: prepared as a mission quotation, not yet confirmed.'),
      ).toBeVisible();
      await expect(page.getByText(/Copy this into Record a supplier offer/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeVisible();
      expect(prefillRequests).toEqual([`?tenant=${tenant}&reply=${replyId}`]);
    });
  }
  for (const role of ['reviewer', 'viewer']) {
    test(`shows ${role} no link and asks nothing`, async ({ page }) => {
      const { prefillRequests } = await stub(page, {});
      await openCard(page, role);
      await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toHaveCount(0);
      expect(prefillRequests).toHaveLength(0);
      // Control: the same card for an owner does offer it, so the absence above is the role, not a missing feature.
      const owner = await page.context().newPage();
      await stub(owner, {});
      await openCard(owner, 'owner');
      await expect(owner.getByRole('link', { name: 'Open Prepared Offer' })).toBeVisible();
    });
  }
  test('offers no link and says so while mission pages are off, and copy stays', async ({
    page,
  }) => {
    await stub(page, { missionsV2: false });
    await openCard(page, 'owner');
    await expect(
      page.getByText(
        'Prepared offers are not available yet on this system. Copy the prepared quotation below and use it to fill the form by hand.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeVisible();
  });
  test('says it is checking while the mission-pages answer is pending, then shows the link', async ({
    page,
  }) => {
    const { prefillRequests } = await stub(page, { flagsDelay: 2500 });
    await openCard(page, 'owner');
    // The prefill answer has come back, so what shows now is the wait for the mission-pages answer.
    await expect.poll(() => prefillRequests.length).toBe(1);
    await page.waitForTimeout(600);
    await expect(page.getByText('Checking whether this reply can be prepared.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('not available yet');
    await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toBeVisible();
  });
  for (const status of [500, 401]) {
    test(`says it could not check, not that offers are unavailable, when the flags answer ${status}`, async ({
      page,
    }) => {
      await stub(page, { flagsAnswer: { status, body: { error: 'No' } } });
      await openCard(page, 'owner');
      await expect(
        page.getByText(
          'We could not check whether this offer can be opened. Nothing was changed. Copy the prepared quotation below and use it to fill the form by hand.',
        ),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText('not available yet');
      await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeVisible();
    });
  }
  test('does not call a refused reply prepared', async ({ page }) => {
    await stub(page, { prefill: { status: 200, body: { eligible: false, reason: 'REJECTED' } } });
    await openCard(page, 'owner');
    await expect(
      page.getByText('Published. This reply cannot be prepared as an offer.'),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('prepared as a mission quotation');
  });
  test('says copy this into the form by hand where the binding is not installed', async ({
    page,
  }) => {
    await stub(page, { prefill: { status: 503, body: { error: 'Reply binding is unavailable' } } });
    await openCard(page, 'owner');
    await expect(
      page.getByText(
        'Copy this into Record a supplier offer on the mission and confirm it there. The reply is the self-declared source. Nothing reaches a customer until the publication path approves it.',
      ),
    ).toBeVisible();
  });
  for (const code of refusalCodes) {
    test(`says in fixed words why ${code} cannot be prepared`, async ({ page }) => {
      await stub(page, { prefill: { status: 200, body: { eligible: false, reason: code } } });
      await openCard(page, 'owner');
      const status = page.locator('.reply-handoff-status');
      await expect(status).toHaveText(/\.$/);
      await expect(status).not.toContainText('Open Prepared Offer');
      await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText(digest);
    });
  }
  test('says prepared offers are not available when the binding is not installed, and copy stays', async ({
    page,
  }) => {
    await stub(page, { prefill: { status: 503, body: { error: 'Reply binding is unavailable' } } });
    await openCard(page, 'owner');
    await expect(
      page.getByText(
        'Prepared offers are not available yet on this system. Copy the prepared quotation below and use it to fill the form by hand.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy the Prepared Quotation' })).toBeEnabled();
  });
  test('says a refused role may review but not record, in fixed words', async ({ page }) => {
    await stub(page, { prefill: { status: 403, body: { error: 'Access denied' } } });
    await openCard(page, 'owner');
    await expect(
      page.getByText(
        'You can review this reply, but only an owner, admin or operator can record an offer from it.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toHaveCount(0);
  });
});

test.describe('the prepared offer form', () => {
  test('links to the full original reply on the reply card it came from', async ({ page }) => {
    await stub(page, {});
    await openForm(page);
    const link = page.getByRole('link', { name: 'Open the Full Original Reply' });
    await expect(link).toHaveAttribute(
      'href',
      `/operator/delivery?workspace=${tenant}#reply-${replyId}`,
    );
    // The address ends at an element that exists on the reply card, so the link lands on the reply.
    await openCard(page, 'owner');
    await expect(page.locator(`li.reply-review-card#reply-${replyId}`)).toHaveCount(1);
  });

  test('shows the supplier terms read only, says what is not stated, and saves the exact strings with the reply binding', async ({
    page,
  }) => {
    const { saved, prefillRequests } = await stub(page, {});
    await openForm(page);
    await expect(page.getByRole('heading', { name: 'Record a supplier offer' })).toBeVisible();
    await expect(
      page.getByText(
        /Prefilled from a reviewed supplier reply\. Reply version 2, offer revision 3/,
      ),
    ).toBeVisible();
    await expect(page.getByText('Self-declared', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Supplier reply, self-declared. Reviewed and published by the Corridra team.'),
    ).toBeVisible();
    const terms = page.locator('.reply-handoff-group dd');
    await expect(terms.filter({ hasText: 'USD 12.50' })).toHaveCount(1);
    await expect(page.locator('.reply-handoff input[name="unitPrice"]')).toHaveCount(0);
    const check = page.getByRole('group', { name: 'Check before saving' });
    await expect(check).toContainText('Commissioning');
    await expect(check).toContainText('Minimum order');
    await expect(check).not.toContainText('Tooling');
    await expect(page.getByLabel('Reason for recording this change')).toHaveValue(
      'Offer from reviewed reply, revision 3',
    );
    await expect(page.getByText('Nothing reaches the customer from this form.')).toBeVisible();
    await fillAndSave(page);
    await expect(
      page.getByText('Offer saved. It is not yet confirmed and not shown to the customer.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Quotation', exact: true })).toHaveCount(0);
    expect(prefillRequests).toHaveLength(1);
    expect(saved).toHaveLength(1);
    const { commandId, ...rest } = saved[0]!;
    expect(commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rest).toEqual({
      missionId,
      reason: 'Offer from reviewed reply, revision 3',
      sourceId,
      claimId,
      action: 'quotation',
      rfqId,
      targetId,
      revision: 3,
      previousId,
      currency: 'USD',
      terms: eligible().terms,
      uncertainties: 'Lead time not yet known',
      observedAt: '2026-10-24T08:00:00.123456Z',
      replyBinding: { responseId: replyId, seen: 2, digest },
    });
  });
  test('shows an amount above 2^53 minor units exactly and sends the same string', async ({
    page,
  }) => {
    const { saved } = await stub(page, {
      prefill: {
        status: 200,
        body: eligible({ terms: { totalPriceMinor: '9007199254740993123' } }),
      },
    });
    await openForm(page);
    await expect(
      page.locator('.reply-handoff-group dd').filter({ hasText: /^USD/ }).first(),
    ).toBeVisible();
    const shown = await page
      .locator('.reply-handoff-group dt', { hasText: 'Total price' })
      .locator('xpath=following-sibling::dd')
      .textContent();
    expect(digitsOnly(shown)).toBe('90071992547409931.23');
    await fillAndSave(page);
    await expect.poll(() => saved.length).toBe(1);
    expect((saved[0]!.terms as Record<string, string>).totalPriceMinor).toBe('9007199254740993123');
  });
  test('shows a zero-decimal currency without a decimal point and sends the exact string', async ({
    page,
  }) => {
    const { saved } = await stub(page, {
      prefill: {
        status: 200,
        body: eligible({ currency: 'JPY', terms: { unitPriceMinor: '123456789012345678' } }),
      },
    });
    await openForm(page);
    const shown = await page
      .locator('.reply-handoff-group dt', { hasText: 'Unit price' })
      .locator('xpath=following-sibling::dd')
      .textContent();
    expect(digitsOnly(shown)).toBe('123456789012345678');
    await fillAndSave(page);
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]!.currency).toBe('JPY');
    expect((saved[0]!.terms as Record<string, string>).unitPriceMinor).toBe('123456789012345678');
  });
  test('ends a prefill request that never answers and shows the plain form', async ({ page }) => {
    await page.clock.install();
    await stub(page, { prefillStalls: true });
    await openForm(page);
    await expect(page.getByText('Loading the prepared offer.')).toBeVisible();
    await expect(page.getByLabel('Next task')).toHaveCount(0);
    await page.clock.runFor(10500);
    await expect(
      page.getByText('We could not check this reply. Nothing was changed.'),
    ).toBeVisible();
    await expect(page.getByLabel('Next task')).toBeVisible();
  });
  test('shows the bound default reason even when a hand-form reason was typed earlier', async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, value]) => window.sessionStorage.setItem(key!, value!),
      [
        `corridra.draft.commercial-mission:${JSON.stringify([tenant, missionId, 'quotation'])}`,
        JSON.stringify({ reason: 'Typed by hand earlier' }),
      ],
    );
    const { saved } = await stub(page, {});
    await openForm(page);
    const reason = page.getByLabel('Reason for recording this change');
    await expect(reason).toHaveValue('Offer from reviewed reply, revision 3');
    await fillAndSave(page);
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]!.reason).toBe('Offer from reviewed reply, revision 3');
    const kept = await page.evaluate(() =>
      Object.keys(window.sessionStorage).filter((key) => key.startsWith('corridra.draft.')),
    );
    expect(kept).toHaveLength(1);
  });
  test('lists many missing terms as one sentence', async ({ page }) => {
    await stub(page, { prefill: { status: 200, body: eligible({ terms: { quantity: '10' } }) } });
    await openForm(page);
    const check = page.getByRole('group', { name: 'Check before saving' });
    await expect(check.locator('li')).toHaveCount(0);
    await expect(check).toContainText('Not stated: Specification, Minimum order, Unit,');
  });
  for (const role of ['reviewer', 'viewer']) {
    test(`gives ${role} no bound form and asks nothing, even with a reply in the link`, async ({
      page,
    }) => {
      const { prefillRequests } = await stub(page, { role });
      await openForm(page);
      await expect(page.getByRole('button', { name: /Review Requirements/ })).toBeVisible();
      await expect(page.getByText('Prefilled from a reviewed supplier reply')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save Quotation', exact: true })).toHaveCount(
        0,
      );
      expect(prefillRequests).toHaveLength(0);
      // Control: an owner with the same link does get the bound form.
      const owner = await page.context().newPage();
      await stub(owner, {});
      await openForm(owner);
      await expect(owner.getByText('Prefilled from a reviewed supplier reply')).toBeVisible();
    });
  }
  test('shows the plain form and asks nothing when the reply in the link is not an id', async ({
    page,
  }) => {
    const { prefillRequests } = await stub(page, {});
    await openForm(page, 'not-an-id');
    await page.getByRole('button', { name: /Review Requirements/ }).click();
    await expect(page.getByLabel('Next task')).toBeVisible();
    await expect(page.getByText('Prefilled from a reviewed supplier reply')).toHaveCount(0);
    expect(prefillRequests).toHaveLength(0);
    // Control: a real reply id in the same link does ask and does prefill.
    const real = await page.context().newPage();
    await stub(real, {});
    await openForm(real);
    await expect(real.getByText('Prefilled from a reviewed supplier reply')).toBeVisible();
  });
  test('keeps the values and the command id when a save fails, and a retry sends the same id', async ({
    page,
  }) => {
    const { saved } = await stub(page, {
      saves: [
        { status: 500, body: { error: 'Internal detail that must not show' } },
        { status: 200, body: { id: 'x' } },
      ],
    });
    await openForm(page);
    await fillAndSave(page);
    await expect(page.getByText('Could not save. Your values are kept. Try again.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Internal detail');
    await page.getByRole('button', { name: 'Save Quotation', exact: true }).click();
    await expect(page.getByText(/Offer saved\./)).toBeVisible();
    expect(saved).toHaveLength(2);
    expect(saved[1]!.commandId).toBe(saved[0]!.commandId);
  });
  test('saves one offer on a double click', async ({ page }) => {
    const { saved } = await stub(page, { saveDelay: 400 });
    await openForm(page);
    await page.getByLabel('Declared source').selectOption(sourceId);
    await page.getByLabel('Source declaration').selectOption(claimId);
    const save = page.getByRole('button', { name: 'Save Quotation', exact: true });
    await save.dblclick();
    await expect(page.getByText(/Offer saved\./)).toBeVisible();
    expect(saved).toHaveLength(1);
  });
  test('saves with Ctrl and Enter', async ({ page }) => {
    const { saved } = await stub(page, {});
    await openForm(page);
    await page.getByLabel('Declared source').selectOption(sourceId);
    await page.getByLabel('Source declaration').selectOption(claimId);
    await page.getByLabel('Reason for recording this change').press('Control+Enter');
    await expect(page.getByText(/Offer saved\./)).toBeVisible();
    expect(saved).toHaveLength(1);
  });
  test('says the reply has changed, saves nothing, never resubmits, and the hand form still works', async ({
    page,
  }) => {
    const { saved } = await stub(page, {
      saves: [{ status: 409, body: { error: 'Reply version changed; reload before confirming' } }],
    });
    await openForm(page);
    await fillAndSave(page);
    const alert = page.getByRole('alert').filter({ hasText: 'This reply has changed' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Nothing was filled in and nothing was saved.');
    await expect(page.getByRole('link', { name: 'Review the Newer Reply' })).toHaveAttribute(
      'href',
      `/operator/delivery?workspace=${tenant}`,
    );
    await expect(page.getByRole('button', { name: 'Save Quotation', exact: true })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(saved).toHaveLength(1);
    await page.getByRole('button', { name: 'Fill This Form by Hand Instead' }).click();
    await expect(page.getByLabel('Next task')).toHaveValue('quotation');
    await expect(page.getByRole('combobox', { name: 'RFQ' })).toBeVisible();
    expect(saved).toHaveLength(1);
  });
  test('shows the recorded state when the reply is already an offer', async ({ page }) => {
    await stub(page, {
      saves: [{ status: 409, body: { error: 'This reply is already recorded as an offer' } }],
    });
    await openForm(page);
    await fillAndSave(page);
    await expect(page.getByText('This reply is already recorded as an offer.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Quotation', exact: true })).toHaveCount(0);
  });
  for (const [label, answer, text] of [
    [
      'a reply that cannot be prepared',
      { status: 200, body: { eligible: false, reason: 'REJECTED' } },
      'This reply was rejected, so no offer can be prepared.',
    ],
    [
      'a binding that is not installed',
      { status: 503, body: { error: 'Reply binding is unavailable' } },
      'Prepared offers are not available yet on this system.',
    ],
    [
      'a refused role',
      { status: 403, body: { error: 'Access denied' } },
      'only an owner, admin or operator can record an offer from it.',
    ],
    [
      'a signed-out session',
      { status: 401, body: { error: 'Sign in' } },
      'We could not check this reply. Nothing was changed.',
    ],
  ] as [string, Answer, string][]) {
    test(`says why for ${label} and keeps the plain form`, async ({ page }) => {
      await stub(page, { prefill: answer });
      await openForm(page);
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByLabel('Next task')).toBeVisible();
      await expect(page.getByText('Prefilled from a reviewed supplier reply')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save Quotation', exact: true })).toHaveCount(
        0,
      );
    });
  }
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    test(`fits ${width} pixels wide with no sideways scroll and passes the accessibility scan`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await stub(page, {});
      await openForm(page);
      await expect(page.getByRole('button', { name: 'Save Quotation', exact: true })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    });
    test(`fits the reply card at ${width} pixels`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stub(page, {});
      await openCard(page, 'owner');
      await expect(page.getByRole('link', { name: 'Open Prepared Offer' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
    });
  }
});
