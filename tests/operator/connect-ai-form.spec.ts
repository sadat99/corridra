import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// ADR-089, Connect AI PR 2: the guided screen in the Settings panel, bundled from the source with the real stylesheets.
// Every read and write is answered here with page.route, so no switch is set: a 404 read is the switch off. The server
// rules (role, version, sources, fallback, countries) are held in tests/integration/ai-connect.test.ts.
const tenant = fixtureTenant;
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
let origin = '';
test.beforeAll(async () => {
  fixture = await startTodayFixture();
  origin = fixture.origin;
});
test.afterAll(async () => {
  await fixture.close();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(
  ' ',
);
const sources = [
  {
    id: id(11),
    kind: 'public_record',
    locator: 'Provider terms page',
    observedAt: '2026-11-01T00:00:00.000Z',
    retentionUntil: '2027-11-01T00:00:00.000Z',
    aiPolicy: 'REVIEW_REQUIRED',
  },
  {
    id: id(12),
    kind: 'document',
    locator: 'Evaluation notes on sample data',
    observedAt: '2026-10-20T00:00:00.000Z',
    retentionUntil: '2027-10-20T00:00:00.000Z',
    aiPolicy: 'REVIEW_REQUIRED',
  },
];
const options = (patch: Record<string, unknown> = {}) => ({
  moduleInstalled: true,
  realWorkspace: false,
  canConnect: true,
  canManage: true,
  blockedReason: null,
  locationLimit: 30,
  latest: [],
  fallbackFor: null,
  fallbackCandidates: [],
  eu: { codes: [...EU].sort(), recordedOn: '2026-10-12' },
  sources,
  ...patch,
});
type Answer = { status?: number; json?: unknown; abort?: boolean };
type Sent = Record<string, unknown>;

/** Opens Settings with the Connect AI read answered by `read` and each save answered by `answer`, in turn. */
async function open(
  page: Page,
  {
    read = () => ({ json: options() }),
    answer = () => ({ status: 201, json: { id: id(90), version: 1 } }),
    hold,
    holdRead,
    routePack = false,
    catalogue = { routes: [], packs: [], types: [], requirements: [], assessments: [] },
  }: {
    read?: (url: URL, count: number) => Answer;
    answer?: (body: Sent, count: number) => Answer;
    hold?: Promise<void>;
    /** Holds a read until the returned promise settles, so a person can act while it is under way. */
    holdRead?: (url: URL) => Promise<void> | undefined;
    /** Whether Add route pack is offered (its own switch on), so both switch-gated sections are drawn. With an object, the
     * read also says whether the route pack module is active and each save is answered in turn. */
    routePack?: boolean | { reviewed: boolean; answer: (count: number) => unknown };
    catalogue?: Record<string, unknown[]>;
  } = {},
) {
  const sent: Sent[] = [];
  const routePackSent: Sent[] = [];
  const other: string[] = [];
  let reads = 0;
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST') other.push(url);
    return route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } });
  });
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: false } }),
  );
  await page.route('**/api/workspace/mission-catalogue?*', (route) =>
    route.fulfill({ json: catalogue }),
  );
  if (routePack === true)
    await page.route('**/api/team-control/route-pack?*', (route) => route.fulfill({ json: {} }));
  if (typeof routePack === 'object')
    await page.route('**/api/team-control/route-pack?*', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { enabled: true, reviewed: routePack.reviewed } });
      routePackSent.push(route.request().postDataJSON() as Sent);
      return route.fulfill({ status: 201, json: routePack.answer(routePackSent.length) });
    });
  await page.route('**/api/workspace/ai-connect?*', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      reads += 1;
      const count = reads;
      const url = new URL(request.url());
      const wait = holdRead?.(url);
      if (wait) await wait;
      const { status = 200, json, abort } = read(url, count);
      return abort ? route.abort() : route.fulfill({ status, json });
    }
    const body = request.postDataJSON() as Sent;
    sent.push(body);
    if (hold) await hold;
    const { status = 201, json, abort } = answer(body, sent.length);
    return abort ? route.abort() : route.fulfill({ status, json });
  });
  // The first Connect AI read, answered or lost, so a test can assert what is drawn only after it settled.
  const firstRead = Promise.race([
    page.waitForResponse((r) => r.url().includes('/api/workspace/ai-connect?')),
    page.waitForEvent('requestfailed', (r) => r.url().includes('/api/workspace/ai-connect?')),
  ]);
  await page.goto(`${origin}/?workspace=${tenant}#workspace-settings`);
  await expect(page.getByText('Advanced (developers): versioned policy review')).toBeVisible();
  const settled = async () => {
    await firstRead;
    // Two frames after the answer: React has drawn whatever the answer leads to.
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
    );
  };
  return { sent, other, routePackSent, reads: () => reads, settled };
}

const flow = (page: Page) => page.getByRole('form', { name: 'Connect AI' });
const next = (page: Page) => flow(page).getByRole('button', { name: 'Next', exact: true }).click();
const question = (page: Page, name: string) =>
  expect(flow(page).getByRole('heading', { name, level: 3 })).toBeFocused();
const later = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);

/** Answers steps 1 to 8 with plain values and stops on Save. */
async function walk(
  page: Page,
  provider = 'Anthropic',
  scope: 'countries' | 'eu' = 'countries',
  onTasks?: () => Promise<void>,
) {
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await expect(flow(page)).toContainText('Step 1 of 9: Provider · Next: Model');
  await flow(page).getByText(provider, { exact: true }).click();
  await next(page);
  await question(page, 'Which model will you use?');
  await flow(page).getByLabel('Model name').fill('claude-test-1');
  await flow(page).getByText('Sample data only', { exact: true }).click();
  await next(page);
  await question(page, 'Which countries does this connection list?');
  if (scope === 'eu') {
    await flow(page).getByText('EU member countries (list Corridra records)').click();
  } else {
    await expect(flow(page).getByLabel('Find a country')).toHaveCount(0);
    await flow(page).getByText('Choose countries one by one', { exact: true }).click();
    await addCountry(page, 'Germ', 'Germany');
    await expect(flow(page)).toContainText('1 of 30 countries chosen');
  }
  await next(page);
  await flow(page).getByLabel('Provider terms source').selectOption(id(11));
  await flow(page).getByLabel('Evaluation record source').selectOption(id(12));
  await next(page);
  await flow(page).getByLabel('Input rate per million tokens').fill('3');
  await flow(page).getByLabel('Output rate per million tokens').fill('15.5');
  await flow(page).getByLabel('Cost cap for one call').fill('0.05');
  await next(page);
  await flow(page).getByLabel('Daily budget').fill('50');
  await flow(page).getByLabel('Valid until').fill(later);
  await next(page);
  await flow(page).getByText('Documents and quotes (0 of 4 chosen)').click();
  await flow(page).getByText('Translate text', { exact: true }).click();
  await expect(flow(page)).toContainText('Documents and quotes (1 of 4 chosen)');
  await onTasks?.();
  await next(page);
  await question(page, 'Check your answers');
  await expect(flow(page)).toContainText('Public record · Provider terms page · 1 November 2026');
  await expect(flow(page)).toContainText('15.50 USD');
  await next(page);
  await question(page, 'Save this version');
  await flow(page).getByLabel('Why are you saving this version?').fill('Connect the provider');
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
}
async function addCountry(page: Page, typed: string, name: string) {
  await flow(page).getByLabel('Find a country').fill(typed);
  await flow(page)
    .getByRole('button', { name: `Add ${name}` })
    .click();
}
const save = (page: Page) => flow(page).getByRole('button', { name: 'Save Connection' }).click();

test('with the read answering 404 (switch off) nothing is drawn and Advanced is unchanged', async ({
  page,
}) => {
  const { settled } = await open(page, {
    read: () => ({ status: 404, json: { error: 'Not found' } }),
  });
  await settled();
  await expect(page.getByText('Connect an AI Provider')).toHaveCount(0);
  await expect(page.locator('details.connect-ai')).toHaveCount(0);
  await expect(page.getByText('Advanced (developers): versioned policy review')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect AI', exact: true })).toHaveCount(0);
  // The section numbers are today's: Add route pack (03) is off here as well.
  expect(
    await page
      .locator('.ux-settings-sections > details > summary')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-step'))),
  ).toEqual(['01', '02', '04', '05']);
});

test('with no session (401) nothing is drawn', async ({ page }) => {
  const { settled } = await open(page, {
    read: () => ({ status: 401, json: { error: 'Sign in to continue' } }),
  });
  await settled();
  await expect(page.locator('details.connect-ai')).toHaveCount(0);
});

test('with an unreachable read nothing is drawn', async ({ page }) => {
  const { settled } = await open(page, { read: () => ({ abort: true }) });
  await settled();
  await expect(page.locator('details.connect-ai')).toHaveCount(0);
});

test('an owner saves in nine steps: one request of plain answers, facts before Save, saved and not switched on', async ({
  page,
}) => {
  const { sent, other } = await open(page);
  await walk(page);
  const facts = flow(page).getByRole('group', { name: 'Before you save' });
  await expect(facts).toContainText(
    'This is the first version of the Anthropic connection. No route pack is pinned to an earlier version.',
  );
  await expect(facts).toContainText('No. This saves settings only. No money moves.');
  await expect(facts).toContainText('No. This save runs no AI and does not switch it on.');
  await expect(facts.locator('.before-send-row').nth(2).locator('p').nth(1)).toHaveText(
    'No. This save runs no AI and does not switch it on.',
  );
  await expect(facts).toContainText('The save is recorded with your name and your reason.');
  const saveButton = flow(page).getByRole('button', { name: 'Save Connection' });
  expect((await facts.boundingBox())!.y).toBeLessThan((await saveButton.boundingBox())!.y);
  expect(await new AxeBuilder({ page }).include('details.connect-ai').analyze()).toMatchObject({
    violations: [],
  });
  await save(page);
  const saved = page.getByRole('heading', { name: 'Saved, not switched on' });
  await expect(saved).toBeFocused();
  await expect(page.locator('details.connect-ai')).toContainText(
    'Version 1 of the Anthropic connection is saved. AI is not switched on. This save ran no AI and moved no money.',
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({
    adapter: 'anthropic',
    model: 'claude-test-1',
    evaluationStatus: 'SYNTHETIC_ONLY',
    processingScope: { kind: 'countries', codes: ['DE'] },
    termsSourceId: id(11),
    evaluationSourceId: id(12),
    inputRateMinorPerMillion: '300',
    outputRateMinorPerMillion: '1550',
    maxCostMinor: '5',
    dailyBudgetMinor: '5000',
    effectiveUntil: `${later}T23:59:59Z`,
    tasks: ['translation'],
    reason: 'Connect the provider',
    expectedVersion: 0,
    confirmed: true,
  });
  expect(other.filter((url) => /ai-run|ai-review|ai-policy|config|switch/.test(url))).toEqual([]);
});

test('a team member who is not an owner or admin sees only that owners and admins can do this', async ({
  page,
}) => {
  await open(page, { read: () => ({ json: options({ canManage: false, sources: [] }) }) });
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  const box = page.locator('details.connect-ai');
  await expect(
    box.getByRole('heading', { name: 'Only owners and admins can do this' }),
  ).toBeVisible();
  await expect(box).toContainText(
    'Only owners and admins can connect an AI provider. Ask an owner to do this for you.',
  );
  await expect(box.locator('input, select, textarea')).toHaveCount(0);
});

for (const [state, aiOn, fact] of [
  [
    'off',
    false,
    'No. This save runs no AI and does not switch it on. AI is off for this workspace, so no AI run can start here.',
  ],
  [
    'on',
    true,
    'No. This save runs no AI and does not switch it on. AI is already on for this workspace. A later run can use this connection only if the route pack of the request names it and the evaluation status is Approved provider. A run is refused if a cited statement holds an email address or a phone number. The cost cap and the daily budget still apply. A person must review every result.',
  ],
] as const)
  test(`a real workspace with AI ${state} says before Save what can run`, async ({ page }) => {
    await open(page, { read: () => ({ json: options({ realWorkspace: true, aiOn }) }) });
    await walk(page);
    const facts = flow(page).getByRole('group', { name: 'Before you save' });
    await expect(facts.locator('.before-send-row').nth(2).locator('p').nth(1)).toHaveText(fact);
    await expect(facts).not.toContainText('No AI run is possible in a real workspace yet');
    await expect(facts).toContainText('No. This saves settings only. No money moves.');
    expect(await new AxeBuilder({ page }).include('details.connect-ai').analyze()).toMatchObject({
      violations: [],
    });
    const width = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(width[0]).toBeLessThanOrEqual(width[1]);
    await save(page);
    const box = page.locator('details.connect-ai');
    if (aiOn) {
      await expect(page.getByRole('heading', { name: 'Saved, AI was already on' })).toBeFocused();
      await expect(box).toContainText(
        'Version 1 of the Anthropic connection is saved. AI was already on for this workspace, and this save did not change that. This save ran no AI and moved no money. A run starts only when a person starts one, and it must pass the checks.',
      );
      await expect(box).not.toContainText('not switched on');
    } else {
      await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeFocused();
      await expect(box).toContainText(
        'Version 1 of the Anthropic connection is saved. AI is not switched on. This save ran no AI and moved no money.',
      );
      await expect(box).not.toContainText('already on');
    }
    expect(await new AxeBuilder({ page }).include('details.connect-ai').analyze()).toMatchObject({
      violations: [],
    });
  });

test('a real workspace without the module says why and offers no Save', async ({ page }) => {
  await open(page, {
    read: () => ({
      json: options({
        realWorkspace: true,
        canConnect: false,
        blockedReason: 'MODULE_NOT_INSTALLED',
        moduleInstalled: false,
        locationLimit: 20,
        sources: [],
      }),
    }),
  });
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  const box = page.locator('details.connect-ai');
  await expect(box.getByRole('heading', { name: 'Not available yet' })).toBeVisible();
  await expect(box).toContainText(
    'Connecting an AI provider is not available for this workspace yet. Ask the owner to install the AI connection module.',
  );
  await expect(box.getByRole('button', { name: 'Save Connection' })).toHaveCount(0);
  await box.getByRole('button', { name: 'Back to AI Settings' }).click();
  await expect(box).toHaveJSProperty('open', false);
});

test('without the module marker the EU choice is absent and at most 20 countries are offered', async ({
  page,
}) => {
  await open(page, {
    read: () => ({ json: options({ moduleInstalled: false, locationLimit: 20 }) }),
  });
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await flow(page).getByText('OpenAI', { exact: true }).click();
  await next(page);
  await flow(page).getByLabel('Model name').fill('gpt-test');
  await flow(page).getByText('Approved provider', { exact: true }).click();
  await next(page);
  await expect(flow(page).getByText('EU member countries (list Corridra records)')).toHaveCount(0);
  await expect(flow(page)).toContainText('0 of 20 countries chosen');
  await next(page);
  await expect(flow(page)).toContainText('Choose at least one country.');
  await expect(flow(page).getByLabel('Find a country')).toBeFocused();
});

test('with the marker the EU choice uses the approved words with the count and date', async ({
  page,
}) => {
  await open(page);
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await flow(page).getByText('Google', { exact: true }).click();
  await next(page);
  await flow(page).getByLabel('Model name').fill('gemini-test');
  await flow(page).getByText('Sample data only', { exact: true }).click();
  await next(page);
  await expect(flow(page).getByText('EU member countries (list Corridra records)')).toBeVisible();
  // The approved explanation is visible where the choice is made, word for word, with no disclosure opened.
  const helper = flow(page).getByText(
    'Corridra saves the countries it lists as EU members today (27 countries, recorded 12 October 2026). This is a list of countries, not a check of where your provider processes data. Later changes to the list do not alter what you save.',
    { exact: true },
  );
  await expect(helper).toBeVisible();
  const consequence = flow(page).getByText(
    "To use this list, the owner must set CORRIDRA_GOOGLE_PROCESSING_LOCATIONS and each cited source's rights review to include every country.",
    { exact: true },
  );
  // The owner's settings line shows once the EU list is chosen, and only the country list stays folded.
  await expect(consequence).toHaveCount(0);
  await flow(page).getByText('EU member countries (list Corridra records)').click();
  await expect(consequence).toBeVisible();
  await expect(flow(page).getByText('Austria', { exact: false }).first()).toBeHidden();
  await flow(page).getByText('Show the Countries', { exact: true }).click();
  await expect(flow(page).getByText('Austria', { exact: false }).first()).toBeVisible();
});

test('without the EU list on offer no line refers to it', async ({ page }) => {
  await open(page, {
    read: () => ({ json: options({ moduleInstalled: false, locationLimit: 20 }) }),
  });
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await flow(page).getByText('Google', { exact: true }).click();
  await next(page);
  await flow(page).getByLabel('Model name').fill('gemini-test');
  await flow(page).getByText('Sample data only', { exact: true }).click();
  await next(page);
  await expect(flow(page).getByLabel('Find a country')).toBeVisible();
  await expect(flow(page)).not.toContainText('To use this list');
  await expect(flow(page)).not.toContainText('EU members');
});

test('a version saved meanwhile: the answers stay, Load Latest Version re-reads and the next save sends it', async ({
  page,
}) => {
  const latest = {
    key: 'connect-anthropic',
    id: id(80),
    version: 1,
    dailyBudgetMinor: '5000',
    configuration: { model: 'claude-test-1' },
  };
  const { sent } = await open(page, {
    read: (_url, count) => ({ json: options({ latest: count > 2 ? [latest] : [] }) }),
    answer: (_body, count) =>
      count === 1
        ? {
            status: 409,
            json: {
              error: 'This connection changed since you opened it.',
              code: 'VERSION_CHANGED',
            },
          }
        : { status: 201, json: { id: id(91), version: 2 } },
  });
  await walk(page);
  await save(page);
  await expect(flow(page).getByRole('alert').first()).toContainText(
    'This connection changed after you started.',
  );
  await expect(flow(page).getByLabel('Why are you saving this version?')).toHaveValue(
    'Connect the provider',
  );
  await flow(page).getByRole('button', { name: 'Load Latest Version' }).click();
  await expect(flow(page).getByRole('group', { name: 'Before you save' })).toContainText(
    'Saving makes version 2 of the Anthropic connection. It replaces version 1',
  );
  await expect(
    flow(page).getByLabel('I have read the facts above and want to save this version.'),
  ).not.toBeChecked();
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
  await save(page);
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  expect(sent.map((body) => body.expectedVersion)).toEqual([0, 1]);
});

test('a source that expired meanwhile: back to Sources, the refused source cleared, the list re-read, the tick reset', async ({
  page,
}) => {
  const { reads, sent } = await open(page, {
    // After the refusal the server no longer lists the expired evaluation source.
    read: (_url, count) => ({ json: options(count > 2 ? { sources: [sources[0]] } : {}) }),
    answer: (_body, count) =>
      count === 1
        ? {
            status: 400,
            json: { error: 'The evaluation record source is expired.', code: 'SOURCE_EVALUATION' },
          }
        : { status: 201, json: { id: id(92), version: 1 } },
  });
  await walk(page);
  const before = reads();
  await save(page);
  await expect(flow(page)).toContainText('Step 4 of 9: Sources');
  await expect(flow(page)).toContainText('Not saved. Fix the source on step 4.');
  await expect(flow(page)).toContainText(
    'This source is expired or not available to you. Choose a current source.',
  );
  const evaluation = flow(page).getByLabel('Evaluation record source');
  await expect(evaluation).toBeFocused();
  expect(reads()).toBeGreaterThan(before);
  // The refused id is gone from the draft, the select and the list; the other answer stays.
  await expect(evaluation).toHaveValue('');
  await expect(evaluation.locator(`option[value="${id(12)}"]`)).toHaveCount(0);
  await expect(flow(page).getByLabel('Provider terms source')).toHaveValue(id(11));
  await evaluation.selectOption(id(11));
  for (let n = 0; n < 5; n++) await next(page);
  await question(page, 'Save this version');
  await expect(
    flow(page).getByLabel('I have read the facts above and want to save this version.'),
  ).not.toBeChecked();
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
  await save(page);
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  expect(sent.map((body) => body.evaluationSourceId)).toEqual([id(12), id(11)]);
});

test('a fallback that stopped being current: back to Tasks, the fallback cleared, the error beside it', async ({
  page,
}) => {
  // Another provider's current connection, as the server offers it to an Anthropic save.
  const other = {
    id: id(70),
    key: 'connect-google',
    version: 3,
    adapter: 'google',
    model: 'gemini-x',
  };
  const { sent } = await open(page, {
    read: (_url, count) => ({
      json: options({ fallbackCandidates: count > 2 ? [] : [other] }),
    }),
    answer: () => ({
      status: 409,
      json: { error: 'The fallback connection is not current.', code: 'FALLBACK_NOT_CURRENT' },
    }),
  });
  await walk(page, 'Anthropic', 'countries', async () => {
    await flow(page).getByLabel('Fallback connection (optional)').selectOption(id(70));
  });
  await save(page);
  await expect(flow(page)).toContainText('Step 7 of 9: Tasks');
  await expect(flow(page)).toContainText(
    'This fallback is no longer a current connection. Choose another or save without one.',
  );
  const fallback = flow(page).getByLabel('Fallback connection (optional)');
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveValue('');
  await expect(flow(page)).toContainText('There is no other current connection to choose.');
  expect(sent[0]!.fallbackPolicyId).toBe(id(70));
});

test('two quick presses send one request', async ({ page }) => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  const first = await open(page, { hold });
  await walk(page);
  const button = flow(page).locator('.connect-ai-end .primary-link');
  await button.click();
  // The button now says it is busy (aria-disabled), so the second press is forced past Playwright's own wait.
  await button.click({ force: true });
  await expect(flow(page).getByRole('button', { name: 'Saving' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  release();
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  expect(first.sent).toHaveLength(1);
});

test('a lost request says nothing is confirmed as saved and keeps the answers', async ({
  page,
}) => {
  const lost = await open(page, { answer: () => ({ abort: true }) });
  await walk(page);
  await save(page);
  await expect(flow(page)).toContainText(
    'Corridra could not save this version. Nothing is confirmed as saved. Your answers are still here.',
  );
  await expect(flow(page).getByRole('button', { name: 'Try Again' })).toBeVisible();
  await expect(flow(page).getByLabel('Why are you saving this version?')).toHaveValue(
    'Connect the provider',
  );
  await expect(page.getByText('Saved, not switched on')).toHaveCount(0);
  expect(lost.sent).toHaveLength(1);
});

test('a failed refresh after a save keeps the saved view and says so quietly', async ({ page }) => {
  await open(page, {
    // The read after the save fails; the save itself succeeded.
    read: (_url, count) =>
      count > 2 ? { status: 500, json: { error: 'Failed' } } : { json: options() },
  });
  await walk(page);
  await save(page);
  const box = page.locator('details.connect-ai');
  await expect(box.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  await expect(box).toContainText(
    'Corridra could not refresh the connection list just now. Your saved version is not affected.',
  );
  await expect(box).not.toContainText('Nothing has changed');
  await expect(box.getByRole('alert')).toHaveCount(0);
});

test('a provider read that answers after another provider was chosen changes nothing, not even the lists', async ({
  page,
}) => {
  // Google's earlier version uses the Anthropic connection as its fallback. Each read leaves out its own provider's key,
  // as the server does, so a late Anthropic answer would drop that fallback if it were applied.
  const anthropicConnection = {
    id: id(71),
    key: 'connect-anthropic',
    version: 2,
    adapter: 'anthropic',
    model: 'claude-x',
  };
  const googleConnection = {
    id: id(72),
    key: 'connect-google',
    version: 5,
    adapter: 'google',
    model: 'gemini-y',
  };
  const latest = [
    {
      key: 'connect-google',
      id: id(72),
      version: 5,
      dailyBudgetMinor: '5000',
      configuration: {
        model: 'gemini-old',
        evaluationStatus: 'SYNTHETIC_ONLY',
        processingLocations: ['DE'],
        tasks: ['translation'],
        fallbackPolicyIds: [id(71)],
        inputRateMinorPerMillion: '300',
        outputRateMinorPerMillion: '1500',
        maxCostMinor: '200',
      },
    },
    {
      key: 'connect-anthropic',
      id: id(71),
      version: 2,
      dailyBudgetMinor: '4000',
      configuration: { model: 'claude-old', evaluationStatus: 'SYNTHETIC_ONLY' },
    },
  ];
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await open(page, {
    read: (url) => {
      const adapter = url.searchParams.get('adapter');
      const candidates =
        adapter === 'anthropic'
          ? [googleConnection]
          : adapter === 'google'
            ? [anthropicConnection]
            : [anthropicConnection, googleConnection];
      return { json: options({ latest, fallbackCandidates: candidates }) };
    },
    holdRead: (url) => (url.searchParams.get('adapter') === 'anthropic' ? held : undefined),
  });
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await flow(page).getByText('Anthropic', { exact: true }).click();
  await next(page);
  const action = flow(page).locator('.connect-ai-actions .primary-link');
  await expect(action).toHaveAttribute('aria-busy', 'true');
  await flow(page).getByText('Google', { exact: true }).click();
  await next(page);
  await question(page, 'Which model will you use?');
  await expect(flow(page).getByLabel('Model name')).toHaveValue('gemini-old');
  await expect(flow(page)).toContainText('From version 5');
  // The Anthropic answer arrives last.
  const late = page.waitForResponse((r) => r.url().includes('adapter=anthropic'));
  release();
  await late;
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
  );
  await expect(flow(page)).toContainText('Step 2 of 9: Model');
  await expect(flow(page).getByLabel('Model name')).toHaveValue('gemini-old');
  for (let n = 0; n < 2; n++) await next(page);
  await flow(page).getByLabel('Provider terms source').selectOption(id(11));
  await flow(page).getByLabel('Evaluation record source').selectOption(id(12));
  await next(page);
  await next(page);
  await flow(page).getByLabel('Valid until').fill(later);
  await next(page);
  await question(page, 'What may this connection be used for?');
  // The Google lists still stand: the Anthropic connection is offered and kept as the fallback.
  await expect(flow(page).getByLabel('Fallback connection (optional)')).toHaveValue(id(71));
});

test('an EU choice whose list goes away meanwhile leads back to an open countries path, never a dead end', async ({
  page,
}) => {
  const { sent } = await open(page, {
    // After the version conflict the module is gone (no EU list on offer, 20 at most).
    read: (_url, count) =>
      count > 2
        ? { json: options({ moduleInstalled: false, locationLimit: 20 }) }
        : { json: options() },
    answer: (_body, count) =>
      count === 1
        ? { status: 409, json: { error: 'Changed.', code: 'VERSION_CHANGED' } }
        : { status: 201, json: { id: id(94), version: 1 } },
  });
  await walk(page, 'Anthropic', 'eu');
  await save(page);
  await flow(page).getByRole('button', { name: 'Load Latest Version' }).click();
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
  await save(page);
  expect(sent).toHaveLength(1);
  await expect(flow(page)).toContainText('Step 3 of 9: Countries');
  await expect(flow(page)).toContainText('Choose at least one country.');
  const find = flow(page).getByLabel('Find a country');
  await expect(find).toBeFocused();
  await expect(flow(page)).toContainText('0 of 20 countries chosen');
  await addCountry(page, 'Bangla', 'Bangladesh');
  for (let n = 0; n < 6; n++) await next(page);
  await question(page, 'Save this version');
  await expect(flow(page)).not.toContainText('EU member countries');
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
  await save(page);
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  expect(sent[1]!.processingScope).toEqual({ kind: 'countries', codes: ['BD'] });
});

test('a source dropped by a later read is cleared everywhere, and Save goes back to it', async ({
  page,
}) => {
  await open(page, {
    read: (_url, count) => ({ json: options(count > 2 ? { sources: [sources[0]] } : {}) }),
    answer: () => ({ status: 409, json: { error: 'Changed.', code: 'VERSION_CHANGED' } }),
  });
  await walk(page);
  await save(page);
  await flow(page).getByRole('button', { name: 'Load Latest Version' }).click();
  // The tick is cleared with the source, so the facts are read again.
  const tick = flow(page).getByLabel('I have read the facts above and want to save this version.');
  await expect(tick).not.toBeChecked();
  await tick.check();
  await save(page);
  await expect(flow(page)).toContainText('Step 4 of 9: Sources');
  const evaluation = flow(page).getByLabel('Evaluation record source');
  await expect(evaluation).toBeFocused();
  await expect(evaluation).toHaveValue('');
  await expect(flow(page)).toContainText('Choose a source.');
});

test('Show All shows every chosen country, and the section numbers follow what is drawn', async ({
  page,
}) => {
  await open(page, {
    read: () => ({ json: options({ moduleInstalled: false, locationLimit: 20 }) }),
    routePack: true,
  });
  // Add route pack and Connect AI are both drawn: every number once.
  const numbers = () =>
    page
      .locator('.ux-settings-sections > details > summary')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-step')));
  await expect.poll(numbers).toEqual(['01', '02', '03', '04', '05', '06']);
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await flow(page).getByText('OpenAI', { exact: true }).click();
  await next(page);
  await flow(page).getByLabel('Model name').fill('gpt-test');
  await flow(page).getByText('Sample data only', { exact: true }).click();
  await next(page);
  const chosen = ['Germany', 'France', 'Spain', 'Italy', 'Poland', 'Austria', 'Bangladesh'];
  for (const name of chosen) await addCountry(page, name.slice(0, 5), name);
  const listed = flow(page).locator('.connect-ai-chosen li');
  await expect(listed).toHaveCount(5);
  // By keyboard: Enter on Show All keeps the person's place on the first country it revealed.
  await flow(page).getByRole('button', { name: 'Show All' }).focus();
  await page.keyboard.press('Enter');
  await expect(listed).toHaveCount(7);
  await expect(flow(page).getByRole('button', { name: 'Remove Austria' })).toBeFocused();
  for (const name of chosen)
    await expect(flow(page).getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  // Removing one moves focus to the search field, never to the page.
  await page.keyboard.press('Enter');
  await expect(flow(page).getByLabel('Find a country')).toBeFocused();
  await expect(listed).toHaveCount(6);
});

test('an EU choice dropped while the list was gone does not come back over the countries chosen meanwhile', async ({
  page,
}) => {
  const { sent } = await open(page, {
    // The third read (the first Load Latest Version) finds the module gone; every other read finds it installed.
    read: (_url, count) =>
      count === 3
        ? { json: options({ moduleInstalled: false, locationLimit: 20 }) }
        : { json: options() },
    answer: (_body, count) =>
      count < 3
        ? { status: 409, json: { error: 'Changed.', code: 'VERSION_CHANGED' } }
        : { status: 201, json: { id: id(95), version: 1 } },
  });
  const tick = flow(page).getByLabel('I have read the facts above and want to save this version.');
  await walk(page, 'Anthropic', 'eu');
  await save(page);
  await flow(page).getByRole('button', { name: 'Load Latest Version' }).click();
  await tick.check();
  await save(page);
  // The list is gone: back on Countries with the countries path open.
  await expect(flow(page)).toContainText('Step 3 of 9: Countries');
  await addCountry(page, 'Bangla', 'Bangladesh');
  for (let n = 0; n < 6; n++) await next(page);
  await tick.check();
  await save(page);
  // A second conflict; this time the list is back.
  await flow(page).getByRole('button', { name: 'Load Latest Version' }).click();
  await expect(tick).not.toBeChecked();
  await flow(page).getByRole('button', { name: 'Back', exact: true }).click();
  await question(page, 'Check your answers');
  const countriesRow = flow(page)
    .locator('.connect-ai-review > div')
    .filter({ hasText: 'Countries' });
  await expect(countriesRow).toContainText('Bangladesh');
  await expect(countriesRow).not.toContainText('EU member countries');
  await next(page);
  await tick.check();
  await save(page);
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  expect(sent.map((body) => body.processingScope)).toEqual([
    { kind: 'market', key: 'EU' },
    { kind: 'countries', codes: ['BD'] },
    { kind: 'countries', codes: ['BD'] },
  ]);
});

test('with Connect AI off the section numbers are what they were', async ({ page }) => {
  const { settled } = await open(page, {
    read: () => ({ status: 404, json: { error: 'Not found' } }),
    routePack: true,
  });
  await settled();
  const numbers = () =>
    page
      .locator('.ux-settings-sections > details > summary')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-step')));
  await expect.poll(numbers).toEqual(['01', '02', '03', '04', '05']);
});

test('an EU list that cannot be used: back to Countries on the countries path, then the save sends countries', async ({
  page,
}) => {
  const { sent } = await open(page, {
    // After the refusal the EU list has no members in force.
    read: (_url, count) =>
      count > 2 ? { json: options({ eu: { codes: [], recordedOn: null } }) } : { json: options() },
    answer: (_body, count) =>
      count === 1
        ? {
            status: 409,
            json: { error: 'The EU member list could not be used.', code: 'EU_UNUSABLE' },
          }
        : { status: 201, json: { id: id(93), version: 1 } },
  });
  await walk(page, 'Anthropic', 'eu');
  await save(page);
  expect(sent[0]!.processingScope).toEqual({ kind: 'market', key: 'EU' });
  await expect(flow(page)).toContainText('Step 3 of 9: Countries');
  await expect(flow(page)).toContainText(
    'The EU member list could not be used. Choose the countries one by one.',
  );
  await expect(flow(page).getByText('EU member countries (list Corridra records)')).toHaveCount(0);
  await expect(flow(page).getByLabel('Find a country')).toBeFocused();
  await addCountry(page, 'Bangla', 'Bangladesh');
  for (let n = 0; n < 6; n++) await next(page);
  await question(page, 'Save this version');
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
  await save(page);
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  expect(sent[1]!.processingScope).toEqual({ kind: 'countries', codes: ['BD'] });
});

test('changing an answer from Review clears the tick, so the facts are read again', async ({
  page,
}) => {
  await open(page);
  await walk(page);
  const tick = flow(page).getByLabel('I have read the facts above and want to save this version.');
  await expect(tick).toBeChecked();
  await flow(page).getByRole('button', { name: 'Back', exact: true }).click();
  await question(page, 'Check your answers');
  await flow(page).getByRole('button', { name: 'Change Model' }).click();
  await question(page, 'Which model will you use?');
  await flow(page).getByLabel('Model name').fill('claude-test-2');
  for (let n = 0; n < 7; n++) await next(page);
  await question(page, 'Save this version');
  await expect(tick).not.toBeChecked();
});

test('changing an answer through the Back links clears the tick too', async ({ page }) => {
  await open(page);
  await walk(page);
  const tick = flow(page).getByLabel('I have read the facts above and want to save this version.');
  await expect(tick).toBeChecked();
  const back = flow(page).getByRole('button', { name: 'Back', exact: true });
  for (let n = 0; n < 4; n++) await back.click();
  await question(page, 'What does the provider charge?');
  await flow(page).getByLabel('Cost cap for one call').fill('0.06');
  for (let n = 0; n < 4; n++) await next(page);
  await question(page, 'Save this version');
  await expect(tick).not.toBeChecked();
  // The reason alone does not clear it.
  await tick.check();
  await flow(page)
    .getByLabel('Why are you saving this version?')
    .fill('Connect the provider again');
  await expect(tick).toBeChecked();
});

for (const [width, height, scale] of [
  [320, 640, 2],
  [390, 844, 1],
  [768, 1024, 1],
  [1440, 900, 1],
] as const)
  test(`at ${width} px with text at ${scale * 100}% the step action covers no control`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    if (scale !== 1) await page.addStyleTag({ content: `html { font-size: ${scale * 100}%; }` });
    // Each click fails if anything, such as the step action, lies over the control.
    await page.getByText('Connect an AI Provider', { exact: true }).click();
    await flow(page).getByText('OpenAI', { exact: true }).click();
    await next(page);
    await flow(page).getByLabel('Model name').fill('gpt-test');
    await flow(page).getByText('Approved provider', { exact: true }).click();
    await next(page);
    await flow(page).getByText('Choose countries one by one', { exact: true }).click();
    await addCountry(page, 'Germ', 'Germany');
    await flow(page).getByRole('button', { name: 'Back', exact: true }).click();
    await question(page, 'Which model will you use?');
    // One line each: a one-word action never breaks inside its word.
    for (const name of ['Back', 'Next']) {
      const lines = await flow(page)
        .getByRole('button', { name, exact: true })
        .evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
        });
      expect(lines, name).toBe(1);
    }
    const sticky = await flow(page)
      .locator('.connect-ai-actions')
      .evaluate((el) => ({
        position: getComputedStyle(el).position,
        share: el.getBoundingClientRect().height / window.innerHeight,
      }));
    if (sticky.position === 'sticky') expect(sticky.share).toBeLessThanOrEqual(0.25);
    // The section itself stays inside the screen. (At 320 px with 200% text the team header already overflows with the
    // switch off; that is the shell, not this section.)
    const right = await page
      .locator('details.connect-ai')
      .evaluate((el) =>
        Math.max(
          ...[el, ...Array.from(el.querySelectorAll('*'))].map(
            (n) => n.getBoundingClientRect().right,
          ),
        ),
      );
    expect(right).toBeLessThanOrEqual(width);
  });

test('a late post-save read from the finished flow does not change the lists of the next provider', async ({
  page,
}) => {
  // The just-saved Anthropic connection, as the server offers it to an OpenAI save.
  const saved = {
    id: id(96),
    key: 'connect-anthropic',
    version: 1,
    adapter: 'anthropic',
    model: 'claude-test-1',
  };
  let anthropicReads = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await open(page, {
    read: (url) => {
      const adapter = url.searchParams.get('adapter');
      // Each read leaves out its own provider's key, as the server does.
      return {
        json: options({ fallbackCandidates: adapter === 'anthropic' ? [] : [saved] }),
      };
    },
    // The read after the Anthropic save (the second Anthropic read) is slow.
    holdRead: (url) =>
      url.searchParams.get('adapter') === 'anthropic' && ++anthropicReads === 2 ? held : undefined,
  });
  await walk(page);
  await save(page);
  await expect(page.getByRole('heading', { name: 'Saved, not switched on' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Another Provider' }).click();
  await flow(page).getByText('OpenAI', { exact: true }).click();
  await next(page);
  await flow(page).getByLabel('Model name').fill('gpt-test');
  await flow(page).getByText('Sample data only', { exact: true }).click();
  await next(page);
  await flow(page).getByText('Choose countries one by one', { exact: true }).click();
  await addCountry(page, 'Germ', 'Germany');
  await next(page);
  await flow(page).getByLabel('Provider terms source').selectOption(id(11));
  await flow(page).getByLabel('Evaluation record source').selectOption(id(12));
  await next(page);
  await flow(page).getByLabel('Input rate per million tokens').fill('3');
  await flow(page).getByLabel('Output rate per million tokens').fill('15');
  await flow(page).getByLabel('Cost cap for one call').fill('1');
  await next(page);
  await flow(page).getByLabel('Daily budget').fill('50');
  await flow(page).getByLabel('Valid until').fill(later);
  await next(page);
  const fallback = flow(page).getByLabel('Fallback connection (optional)');
  await fallback.selectOption(id(96));
  // The late Anthropic answer arrives now.
  const late = page.waitForResponse(
    (r) => r.url().includes('adapter=anthropic') && anthropicReads === 2,
  );
  release();
  await late;
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
  );
  await expect(fallback).toHaveValue(id(96));
  await expect(fallback.locator(`option[value="${id(96)}"]`)).toHaveCount(1);
  await expect(flow(page)).toContainText('Step 7 of 9: Tasks');
  await expect(page.getByText('Corridra could not refresh')).toHaveCount(0);
});

// ADR-093 2b, Add route pack. The server says whether the route pack module is active (`reviewed`). Active, the form sends
// only what the person set, so the server carries every other key from the current pack, and the result says what the
// reviewed publish did. Inactive, it sends and says exactly what it always did.
const packCatalogue = {
  routes: [{ id: id(70), origin_market: 'BD', destination_market: 'CN' }],
  packs: [],
  types: [{ id: id(71), key: 'sourcing' }],
  requirements: [],
  assessments: [],
};
async function fillRoutePack(page: Page) {
  const form = page.locator('form').filter({ hasText: 'New route pack' });
  await form.getByLabel('Route').selectOption(id(70));
  await form.locator('input[name="missionTypes"][value="sourcing"]').check();
  await form.getByLabel('Status').selectOption('TESTING');
  await form.getByLabel('Reason for this pack').fill('Sample route pack for the form test');
  return form;
}
const routePackFeedback = (page: Page) => page.locator('[data-feedback-scope="route-pack"]');

test('Add route pack with the module active sends only what was set and says what was published', async ({
  page,
}) => {
  const removed = 'communication policy DE SYNTHETIC institutional_introduction version 1';
  const { routePackSent } = await open(page, {
    read: () => ({ status: 404, json: { error: 'Not found' } }),
    catalogue: packCatalogue,
    routePack: {
      reviewed: true,
      answer: (count) =>
        count === 1
          ? {
              id: id(80),
              version: 1,
              proposalId: id(81),
              duplicate: false,
              removedRefs: [id(82)],
              removedPolicies: [removed],
            }
          : {
              id: id(80),
              version: 1,
              proposalId: id(81),
              duplicate: true,
              removedRefs: [id(82)],
              removedPolicies: [removed],
            },
    },
  });
  await page.getByText('Add route pack', { exact: true }).click();
  let form = await fillRoutePack(page);
  await form.getByRole('button', { name: 'Save Route Pack' }).click();
  await expect(routePackFeedback(page)).toHaveText(
    `Route pack version 1 published. Expired policies removed: ${removed}.`,
  );
  expect(routePackSent[0]).toEqual({
    routeId: id(70),
    version: 1,
    status: 'TESTING',
    reason: 'Sample route pack for the form test',
    missionTypes: ['sourcing'],
  });
  form = await fillRoutePack(page);
  await form.locator('input[name="languages"][value="en"]').check();
  await form.locator('input[name="manualChannel"]').uncheck();
  await form.getByRole('button', { name: 'Save Route Pack' }).click();
  await expect(routePackFeedback(page)).toHaveText('Already saved. Nothing changed.');
  expect(routePackSent[1]).toMatchObject({ languages: ['en'], manualChannel: false });
  expect(Object.keys(routePackSent[1]!)).not.toContain('currencies');
  expect(Object.keys(routePackSent[1]!)).not.toContain('effectiveFrom');
});

test('Add route pack with the module active keeps a caution naming the Core fields still Pending until the next save', async ({
  page,
}) => {
  const published = {
    id: id(80),
    version: 1,
    proposalId: id(81),
    duplicate: false,
    removedRefs: [],
    removedPolicies: [],
  };
  await open(page, {
    read: () => ({ status: 404, json: { error: 'Not found' } }),
    catalogue: packCatalogue,
    routePack: {
      reviewed: true,
      answer: (count) =>
        count === 1
          ? {
              ...published,
              warnings: [
                {
                  code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE',
                  keys: ['payments.norms', 'risks.key_risks'],
                },
              ],
            }
          : { ...published, version: 2, warnings: [] },
    },
  });
  await page.getByText('Add route pack', { exact: true }).click();
  let form = await fillRoutePack(page);
  await form.getByLabel('Status').selectOption('ACTIVE');
  await form.getByRole('button', { name: 'Save Route Pack' }).click();
  const caution =
    'Route pack version 1 saved and published. These Core fields are still Pending: Usual payment terms, Main risks for customers. This does not mean the route is cleared.';
  const line = routePackFeedback(page);
  await expect(line).toHaveText(caution);
  await expect(line).toHaveAttribute('role', 'status');
  await expect(line.locator('.ux-kit-feedback')).toHaveAttribute('data-kind', 'caution');
  expect(
    await new AxeBuilder({ page }).include('[data-feedback-scope="route-pack"]').analyze(),
  ).toMatchObject({ violations: [] });
  // A success clears itself after 6 seconds; the caution does not.
  await page.waitForTimeout(6500);
  await expect(line).toHaveText(caution);
  // The next save replaces it; without warnings it is the success line again.
  form = await fillRoutePack(page);
  await form.getByRole('button', { name: 'Save Route Pack' }).click();
  await expect(line).toHaveText('Route pack version 2 published.');
  await expect(line.locator('.ux-kit-feedback')).toHaveAttribute('data-kind', 'success');
});

test('Add route pack with the module inactive sends and says what it always did', async ({
  page,
}) => {
  const { routePackSent } = await open(page, {
    read: () => ({ status: 404, json: { error: 'Not found' } }),
    catalogue: packCatalogue,
    routePack: { reviewed: false, answer: () => ({ id: id(80), version: 1 }) },
  });
  await page.getByText('Add route pack', { exact: true }).click();
  const form = await fillRoutePack(page);
  await form.getByRole('button', { name: 'Save Route Pack' }).click();
  await expect(routePackFeedback(page)).toHaveText(
    'Route pack version 1 saved. Review is still required.',
  );
  const sent = routePackSent[0]!;
  expect(Object.keys(sent).sort()).toEqual(
    [
      'currencies',
      'effectiveFrom',
      'languages',
      'manualChannel',
      'missionTypes',
      'reason',
      'routeId',
      'status',
      'timeZones',
      'version',
    ].sort(),
  );
  expect(sent).toMatchObject({
    languages: [],
    currencies: [],
    timeZones: [],
    manualChannel: true,
  });
});
