import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// Spec pack 1 (docs/revamp/specs/public-home.md), P-10 and P-11, plus the honest-proof rule of change 3.

const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true });

// P-11: the request body for fixed answers, frozen byte for byte (key order and values). The random request
// key is not part of the brief. A change to the form, the draft or the schema that alters one byte of this
// is a change to what is sent and needs a decision, not a refactor.
const frozenBrief =
  '{"experience":{"schemaVersion":1,"companyCountry":"BD","marketCode":"CN","job":"sourcing","requirements":{"objective":"Source products or components","role":"IMPORTER","product":"QA test (madeup): combed cotton yarn for knitting","specifications":"Combed cotton, 30s count","quantity":"500","unit":"kg","budgetMinor":"1234","currency":"BHD","budgetBasis":"Total budget","technicalConstraints":"Audited mills only","travelDates":"2026-12-01","decisionCriteria":["Three real meetings"]}},"objective":"Source suppliers","market":"China","attendance":"Not decided","startDate":"","endDate":"","timezone":"UTC","offer":"QA test (madeup): combed cotton yarn for knitting","website":"https://example.com/catalogue","outcomes":["Relevant meetings","Supplier visits"],"notes":"Prefer mornings","name":"QA buyer (madeup)","company":"QA test company (madeup)","email":"qa-buyer@example.invalid","acknowledged":true}';

test('P-11 the request body for fixed answers is byte for byte what it was', async ({ page }) => {
  let body = '';
  await page.route('**/api/intake', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    body = route.request().postData() ?? '';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ receipt: 'a'.repeat(64) }),
    });
  });
  await page.goto('/plan?job=sourcing&companyCountry=BD&marketCode=CN');
  await next(page).click();
  await page.locator('#brief-whenNeeded').fill('2026-12-01');
  await next(page).click();
  await page
    .getByLabel(/^Your offer or requirement/)
    .fill('QA test (madeup): combed cotton yarn for knitting');
  await page.locator('#brief-parameters').fill('Combed cotton, 30s count');
  await page.locator('#brief-quantity').fill('500');
  await page.locator('#brief-unit').fill('kg');
  await page.locator('#brief-preferences').fill('Audited mills only');
  await page.locator('form.intake-form details summary').click();
  await page.locator('#brief-budgetAmount').fill('1.234');
  await page.getByRole('combobox', { name: /Original currency/ }).selectOption('BHD');
  await page.locator('#brief-budgetBasis').fill('Total budget');
  await page.locator('#brief-website').fill('https://example.com/catalogue');
  await next(page).click();
  await page.locator('#brief-worthwhile').fill('Three real meetings');
  await page.getByLabel('Relevant meetings', { exact: true }).check();
  await page.getByLabel('Supplier visits', { exact: true }).check();
  await page.getByLabel('Anything specific we should know? (optional)').fill('Prefer mornings');
  await next(page).click();
  await page.getByLabel('Name', { exact: true }).fill('QA buyer (madeup)');
  await page.getByLabel('Company', { exact: true }).fill('QA test company (madeup)');
  await page.getByLabel('Work email', { exact: true }).fill('QA-Buyer@example.invalid');
  await page.getByLabel('I have read', { exact: false }).check();
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(page.getByLabel('Private receipt code')).toHaveValue('a'.repeat(64));
  const sent = JSON.parse(body) as { key: string; brief: unknown; websiteCheck: string };
  expect(Object.keys(sent)).toEqual(['key', 'brief', 'websiteCheck']);
  expect(sent.websiteCheck).toBe('');
  expect(JSON.stringify(sent.brief)).toBe(frozenBrief);
});

// P-10: the first step fits the flow-step budget: 1.5 phone screens at 390 wide (height over 844) and one
// desktop screen at 1440 by 900. The measured thing is the form card, with its heading and buttons. The whole
// /plan page is longer (about 3.7 phone screens at 390: the shared footer is 991 px, plus the receipt check and
// the summary) and the details and results steps are taller than one desktop screen; both are existing debt
// recorded in the verification record, not asserted here.
test('P-10 the first step of the request form fits the flow-step budget', async ({
  page,
}, info) => {
  const phone = info.project.name === 'w390';
  const desktop = info.project.name === 'w1280';
  test.skip(!phone && !desktop, 'The budget is stated for 390 wide and 1440 wide only');
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  for (const path of ['/plan', '/plan?job=sourcing&companyCountry=BD&marketCode=CN']) {
    await page.goto(path);
    const card = await page.locator('form.intake-form').boundingBox();
    expect(card, path).not.toBeNull();
    if (phone) expect(card!.height / 844, path).toBeLessThanOrEqual(1.5);
    else expect(card!.height, path).toBeLessThanOrEqual(900);
  }
});

// Change 3: honest proof only. The public pages carry no claim of customers, results, counts or logos. The
// patterns are the ones the owner's rules name; sample material may say "sample" and "example".
const publicPaths = [
  '/',
  '/about',
  '/how-it-works',
  '/trust',
  '/sell',
  '/source',
  '/machinery',
  '/trade-missions',
  '/business-trips',
  '/enter-market',
  '/corridors',
  '/corridors/bangladesh-china',
  '/corridors/bangladesh-spain',
  '/institutions',
  '/network',
];
const proofClaims: RegExp[] = [
  /trusted by/i,
  /our customers/i,
  /testimonials?/i,
  /case studies?/i,
  /as seen (in|on)/i,
  /\b[0-9][0-9,]*\+?\s+(companies|buyers|suppliers|factories|customers|missions|meetings|deals)\b/i,
  /\b(thousands|hundreds) of (companies|buyers|suppliers)\b/i,
  /\bverified (buyers|suppliers|factories)\b/i,
  /\b(guaranteed|guarantee[sd]?)\s+(meetings|sales|orders|results)\b/i,
  /\bno\.?\s*1\b|\bleading platform\b|\bworld'?s (best|leading|largest)\b/i,
];
for (const path of publicPaths)
  test(`change 3 ${path} makes no proof claim`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    // The sample mission on the home page is labelled Example and is not scanned; its label must be there.
    const example = page.locator('.ac1-record');
    if (path === '/') await expect(example.locator('.ac1-example-tag')).toBeVisible();
    const text = await page.locator('main').evaluate((main) => {
      const copy = main.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.ac1-record').forEach((node) => node.remove());
      return copy.textContent ?? '';
    });
    // A sentence that denies a claim ("We do not book travel or guarantee meetings") is not a claim.
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/)
      .filter(
        (sentence) =>
          !/\b(do|does|did|will|can|would)\s*not\b|\bnever\b|\bno\b|n't\b/i.test(sentence),
      );
    for (const sentence of sentences)
      for (const claim of proofClaims) expect(sentence, `${path} ${claim}`).not.toMatch(claim);
  });
