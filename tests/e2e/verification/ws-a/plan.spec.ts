import type { Page } from '@playwright/test';
import { test, expect, evidence } from '../fixtures';

// WS-A request intake (program 6.A). A-2: an error never pulls focus out of the field being typed in, and
// problems are plain words on the right field (CQ-01, CQ-11). A-3: a link that names another job asks before it
// replaces a saved draft, and Clear draft applies the link (CQ-14). V-10 (submit part) and V-49: a sent request
// is received with a receipt, never shown as a draft, and the receipt check answers every case visibly.
// The verification server runs without real use, so these requests use made-up details only.

const job = (page: Page) => page.getByRole('combobox', { name: 'Commercial job', exact: true });
const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true });

async function toDetails(page: Page, path = '/plan?job=sourcing&companyCountry=BD&marketCode=CN') {
  await page.goto(path);
  await expect(job(page)).toHaveValue(/.+/);
  await next(page).click();
  await expect(
    page.getByRole('combobox', { name: 'Where is the company based?', exact: true }),
  ).toHaveValue('BD');
  await next(page).click();
}

test('A-2 focus stays in the field while typing, and problems are plain words on their own field', async ({
  page,
}, info) => {
  await toDetails(page);
  // The field's error sits inside its label, so the field is found by its hint rather than its name.
  const offer = page.locator('textarea[aria-describedby^="offer-hint"]');
  await expect(offer).toBeVisible();
  // Continue with the required field empty: the summary takes focus once.
  await next(page).click();
  const summary = page.locator('.ux-error-summary');
  await expect(summary).toBeFocused();
  await expect(page.locator('#offer-error')).toBeVisible();
  await expect(offer).toHaveAttribute('aria-describedby', /offer-error/);
  // Typing in the field keeps focus there on every key, even while another problem is still listed.
  await offer.click();
  await offer.pressSequentially('Cotton yarn');
  await expect(offer).toBeFocused();
  await expect(offer).toHaveValue('Cotton yarn');
  // An optional field with too little text gets a plain message next to itself, not the library's wording.
  await offer.fill('Combed cotton yarn, 30s count, for knitting');
  const specs = page.getByLabel('Product specifications (optional)', { exact: true });
  await specs.fill('ab');
  await next(page).click();
  await expect(page.locator('#parameters-error')).toHaveText('Write at least 3 characters');
  await expect(specs).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('main')).not.toContainText('Too small');
  await expect(page.locator('main')).not.toContainText('expected string');
  // Emptying the optional field clears the problem: an empty optional field never errors.
  await specs.fill('');
  await next(page).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'What would make this worthwhile?' }),
  ).toBeVisible();
  // The desired outcomes group says it is required, and its error sits with the group.
  const group = page.getByRole('group', { name: /Desired outcomes \(Required\)/ });
  await expect(group).toBeVisible();
  await next(page).click();
  await expect(group.locator('#outcomes-error')).toBeVisible();
  await evidence(page, `A-2-${info.project.name}`);
});

test('A-3 a link naming another job asks before replacing a saved draft, and Clear draft applies the link', async ({
  page,
}, info) => {
  await page.goto('/plan?job=sourcing');
  await expect(job(page)).toHaveValue('sourcing');
  await next(page).click();
  // The saved draft (sourcing, step 2) meets a link for a group trip.
  await page.goto('/plan?job=delegations');
  const question = page.getByRole('group', { name: /You have a saved request/ });
  await expect(question).toContainText('Continue it, or start a new request for');
  await evidence(page, `A-3-question-${info.project.name}`);
  await question.getByRole('button', { name: 'Start a new request', exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(job(page)).toHaveValue('delegations');
  // Group trips get trip-leader wording (CQ-16).
  await next(page).click();
  await page
    .getByRole('combobox', { name: 'Where is the company based?', exact: true })
    .selectOption('BD');
  await page
    .getByRole('combobox', { name: 'Which market is involved?', exact: true })
    .selectOption('CN');
  await next(page).click();
  const offer = page.getByLabel('What should the trip achieve?', { exact: true });
  await expect(offer).toBeVisible();
  await expect(offer).not.toHaveAttribute('placeholder', /towel/i);
  // Back to a sourcing link: continuing keeps the saved trip; Clear draft applies the link instead.
  await page.goto('/plan?job=sourcing');
  await expect(page.getByRole('group', { name: /You have a saved request/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
  await expect(page.getByRole('group', { name: /You have a saved request/ })).toHaveCount(0);
  await expect(job(page)).toHaveValue('sourcing');
  // Countries are listed by name with the route countries first (CQ-15).
  await next(page).click();
  const first = await page
    .getByRole('combobox', { name: 'Where is the company based?', exact: true })
    .locator('option')
    .evaluateAll((options) => options.slice(1, 4).map((o) => o.textContent));
  expect(first).toEqual(['Bangladesh', 'China', 'Spain']);
});

test('V-10 a sent request gets a receipt and reads as received, never as a draft', async ({
  page,
}, info) => {
  await toDetails(page);
  await page
    .getByLabel('Your offer or requirement', { exact: true })
    .fill(`QA test (madeup): combed cotton yarn for a knitting unit, ${info.project.name}`);
  await next(page).click();
  await page.getByLabel('Supplier visits', { exact: true }).check();
  await next(page).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveAttribute('autocomplete', 'name');
  await expect(page.getByLabel('Company', { exact: true })).toHaveAttribute(
    'autocomplete',
    'organization',
  );
  await expect(page.getByLabel('Work email', { exact: true })).toHaveAttribute(
    'autocomplete',
    'email',
  );
  await page.getByLabel('Name', { exact: true }).fill('QA buyer (madeup)');
  await page.getByLabel('Company', { exact: true }).fill('QA test company (madeup)');
  await page.getByLabel('Work email', { exact: true }).fill('qa-buyer@example.invalid');
  await page.getByLabel('I have read', { exact: false }).check();
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/intake'));
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  const response = await sent;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { receipt?: string };
  expect(body.receipt).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.getByLabel('Private receipt code')).toHaveValue(body.receipt!);
  // The status check reads the stored request through the API and shows the customer label (D6).
  const checked = page.waitForResponse((r) => r.url().endsWith('/api/intake/receipt'));
  await page.getByRole('button', { name: 'Check status and replies' }).click();
  const answer = await checked;
  expect(answer.status()).toBe(200);
  expect(((await answer.json()) as { status: string }).status).toMatch(/^[A-Z_]+$/);
  await expect(page.getByText('Received, waiting for review', { exact: true })).toBeVisible();
  await expect(page.getByText(/^(DRAFT|Draft)$/)).toHaveCount(0);
  await evidence(page, `V-10-${info.project.name}`);
});

test('V-49 the receipt check explains an empty code and a wrong code, with a hint', async ({
  page,
}, info) => {
  // The account page and the tools list open the check at #receipt-check; on a plain /plan visit it
  // stays folded so the page has one open form (V-57).
  await page.goto('/plan#receipt-check');
  const code = page.getByLabel('Receipt code', { exact: true });
  await expect(page.locator('#check-hint')).toHaveText(
    'The code shown after you sent the request.',
  );
  await expect(code).toHaveAttribute('aria-describedby', 'check-hint');
  let called = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/intake/receipt')) called = true;
  });
  await page.getByRole('button', { name: 'Check status and replies' }).click();
  await expect(page.locator('#check-error')).toHaveText('Enter the code from your receipt.');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  expect(called).toBe(false);
  await code.fill('0'.repeat(64));
  await expect(page.locator('#check-error')).toHaveCount(0);
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/intake/receipt'));
  await page.getByRole('button', { name: 'Check status and replies' }).click();
  expect((await refused).ok()).toBe(false);
  await expect(page.locator('main')).toContainText('Receipt unavailable or expired');
  await evidence(page, `V-49-${info.project.name}`);
});
