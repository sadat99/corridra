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
  }: {
    read?: (url: URL, count: number) => Answer;
    answer?: (body: Sent, count: number) => Answer;
    hold?: Promise<void>;
  } = {},
) {
  const sent: Sent[] = [];
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
    route.fulfill({
      json: { routes: [], packs: [], types: [], requirements: [], assessments: [] },
    }),
  );
  await page.route('**/api/workspace/ai-connect?*', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      reads += 1;
      const { status = 200, json, abort } = read(new URL(request.url()), reads);
      return abort ? route.abort() : route.fulfill({ status, json });
    }
    const body = request.postDataJSON() as Sent;
    sent.push(body);
    if (hold) await hold;
    const { status = 201, json, abort } = answer(body, sent.length);
    return abort ? route.abort() : route.fulfill({ status, json });
  });
  await page.goto(`${origin}/?workspace=${tenant}#workspace-settings`);
  await expect(page.getByText('Advanced (developers): versioned policy review')).toBeVisible();
  return { sent, other, reads: () => reads };
}

const flow = (page: Page) => page.getByRole('form', { name: 'Connect AI' });
const next = (page: Page) => flow(page).getByRole('button', { name: 'Next', exact: true }).click();
const question = (page: Page, name: string) =>
  expect(flow(page).getByRole('heading', { name, level: 3 })).toBeFocused();
const later = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);

/** Answers steps 1 to 8 with plain values and stops on Save. */
async function walk(page: Page, provider = 'Anthropic') {
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  await expect(flow(page)).toContainText('Step 1 of 9: Provider · Next: Model');
  await flow(page).getByText(provider, { exact: true }).click();
  await next(page);
  await question(page, 'Which model will you use?');
  await flow(page).getByLabel('Model name').fill('claude-test-1');
  await flow(page).getByText('Sample data only', { exact: true }).click();
  await next(page);
  await question(page, 'Which countries does this connection list?');
  await flow(page).getByLabel('Find a country').fill('Germ');
  await flow(page).getByRole('button', { name: 'Add Germany' }).click();
  await expect(flow(page)).toContainText('1 of 30 countries chosen');
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
  await flow(page).getByText('Translate text', { exact: true }).click();
  await next(page);
  await question(page, 'Check your answers');
  await expect(flow(page)).toContainText('Public record · Provider terms page · 1 November 2026');
  await expect(flow(page)).toContainText('15.50 USD');
  await next(page);
  await question(page, 'Save this version');
  await flow(page).getByLabel('Why are you saving this version?').fill('Connect the provider');
  await flow(page).getByLabel('I have read the facts above and want to save this version.').check();
}
const save = (page: Page) => flow(page).getByRole('button', { name: 'Save Connection' }).click();

test('with the read answering 404 (switch off) nothing is drawn and Advanced is unchanged', async ({
  page,
}) => {
  const { reads } = await open(page, {
    read: () => ({ status: 404, json: { error: 'Not found' } }),
  });
  await expect.poll(reads).toBeGreaterThan(0);
  await expect(page.getByText('Connect an AI Provider')).toHaveCount(0);
  await expect(page.locator('details.connect-ai')).toHaveCount(0);
});

test('with no session (401) nothing is drawn', async ({ page }) => {
  const { reads } = await open(page, {
    read: () => ({ status: 401, json: { error: 'Sign in to continue' } }),
  });
  await expect.poll(reads).toBeGreaterThan(0);
  await expect(page.locator('details.connect-ai')).toHaveCount(0);
});

test('with an unreachable read nothing is drawn', async ({ page }) => {
  const { reads } = await open(page, { read: () => ({ abort: true }) });
  await expect.poll(reads).toBeGreaterThan(0);
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

test('a team member who is not an owner or admin sees only that owners can do this', async ({
  page,
}) => {
  await open(page, { read: () => ({ json: options({ canManage: false, sources: [] }) }) });
  await page.getByText('Connect an AI Provider', { exact: true }).click();
  const box = page.locator('details.connect-ai');
  await expect(box.getByRole('heading', { name: 'Only owners can do this' })).toBeVisible();
  await expect(box).toContainText(
    'Only owners and admins can connect an AI provider. Ask an owner to do this for you.',
  );
  await expect(box.locator('input, select, textarea')).toHaveCount(0);
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
  await expect(flow(page)).toContainText(
    'Corridra saves the countries it lists as EU members today (27 countries, recorded 12 October 2026). This is a list of countries, not a check of where your provider processes data. Later changes to the list do not alter what you save.',
  );
  await expect(flow(page)).toContainText(
    "To use this list, the owner must set CORRIDRA_GOOGLE_PROCESSING_LOCATIONS and each cited source's rights review to include every country.",
  );
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

test('a source that expired meanwhile: back to Sources with the error beside it and the list re-read', async ({
  page,
}) => {
  const { reads } = await open(page, {
    answer: () => ({
      status: 400,
      json: { error: 'The evaluation record source is expired.', code: 'SOURCE_EVALUATION' },
    }),
  });
  await walk(page);
  const before = reads();
  await save(page);
  await expect(flow(page)).toContainText('Step 4 of 9: Sources');
  await expect(flow(page)).toContainText('Not saved. Fix the source on step 4.');
  await expect(flow(page)).toContainText(
    'This source is expired or not available to you. Choose a current source.',
  );
  await expect(flow(page).getByLabel('Evaluation record source')).toBeFocused();
  expect(reads()).toBeGreaterThan(before);
  await expect(flow(page).getByLabel('Provider terms source')).toHaveValue(id(11));
});

test('a fallback that is the same connection: back to Tasks with the error beside the fallback', async ({
  page,
}) => {
  await open(page, {
    answer: () => ({
      status: 409,
      json: { error: 'A connection cannot be its own fallback.', code: 'FALLBACK_SELF' },
    }),
  });
  await walk(page);
  await save(page);
  await expect(flow(page)).toContainText('Step 7 of 9: Tasks');
  await expect(flow(page)).toContainText(
    'A connection cannot be its own fallback. Choose another connection or save without one.',
  );
  await expect(flow(page).getByLabel('Fallback connection (optional)')).toBeFocused();
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
