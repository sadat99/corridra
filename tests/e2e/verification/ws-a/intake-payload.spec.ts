import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { proofClaimsIn } from '../../../integration/proof-claims';

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
  await page.getByRole('button', { name: 'More details (optional)', exact: true }).click();
  await page.locator('#brief-quantity').fill('500');
  await page.locator('#brief-unit').fill('kg');
  await page.locator('#brief-preferences').fill('Audited mills only');
  await page.locator('form.intake-form details summary').click();
  await page.locator('#brief-budgetAmount').fill('1.234');
  await page.getByRole('combobox', { name: /Original currency/ }).selectOption('BHD');
  await page.locator('#brief-budgetBasis').fill('Total budget');
  await page.locator('#brief-website').fill('https://example.com/catalogue');
  await next(page).click();
  await page.getByRole('button', { name: 'More details (optional)', exact: true }).click();
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

// P-10: a flow step fits 1.5 phone screens at 390 wide (height over 844) and one desktop screen at 1440 by 900.
// The measured thing is the form card, with its heading and buttons. Every step of every job is measured. The
// whole /plan page is longer (about 3.8 phone screens at 390: the shared footer is 991 px, plus the receipt check
// and the summary); that is recorded as existing debt in the verification record, not asserted here.
const jobKeys = [
  'buyers',
  'customers',
  'distributors',
  'partners',
  'sourcing',
  'machinery_procurement',
  'supplier_evaluation',
  'meetings',
  'factory_visits',
  'trade_fairs',
  'business_trips',
  'market_validation',
  'market_entry',
  'export_market_access',
  'delegations',
];
const stepNames = ['job', 'where', 'details', 'results', 'contact'];
async function freshPlan(page: Page, path: string) {
  await page.goto('/plan');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(path);
}
for (const job of jobKeys)
  test(`P-10 every step of the request form fits the flow-step budget for ${job}`, async ({
    page,
  }, info) => {
    const phone = info.project.name === 'w390';
    const desktop = info.project.name === 'w1280';
    test.skip(!phone && !desktop, 'The budget is stated for 390 wide and 1440 wide only');
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await freshPlan(page, `/plan?job=${job}&companyCountry=BD&marketCode=CN`);
    for (let step = 0; step < 5; step++) {
      const card = await page.locator('form.intake-form').boundingBox();
      expect(card, `${job} ${stepNames[step]}`).not.toBeNull();
      if (phone)
        expect(card!.height / 844, `${job} ${stepNames[step]} at 390`).toBeLessThanOrEqual(1.5);
      else expect(card!.height, `${job} ${stepNames[step]} at 1440`).toBeLessThanOrEqual(900);
      if (step === 4) break;
      if (step === 2)
        await page
          .getByLabel(/^Your offer or requirement|^What should the trip achieve/)
          .first()
          .fill('QA test (madeup): combed cotton yarn for knitting');
      if (step === 3) await page.getByLabel('Relevant meetings', { exact: true }).check();
      await next(page).click();
    }
  });

// The folded optional fields (revamp /plan step budget). Only optional fields fold; a required field is never
// hidden; every folded field stays mounted with the same id and name; an error in a folded field opens its fold
// and puts the focus on that field.
const fold = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function toStep(page: Page, path: string, step: number) {
  await freshPlan(page, path);
  for (let at = 0; at < step; at++) {
    if (at === 2)
      await page
        .getByLabel(/^Your offer or requirement|^What should the trip achieve/)
        .first()
        .fill('QA test (madeup): combed cotton yarn for knitting');
    if (at === 3) await page.getByLabel('Relevant meetings', { exact: true }).check();
    await next(page).click();
  }
}
test('P-10 the details step folds only optional fields, keeps them mounted, and never hides a required one', async ({
  page,
}) => {
  await toStep(page, '/plan?job=sourcing&companyCountry=BD&marketCode=CN', 2);
  // The toggle is found by what it controls, because its name changes when it opens.
  const more = page.locator('button[aria-controls="fold-details"]');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  // The required offer and the first job fields stay in view.
  await expect(page.getByLabel(/^Your offer or requirement/)).toBeVisible();
  await expect(page.locator('#brief-parameters')).toBeVisible();
  // The folded fields are in the page, hidden, with the same ids and names.
  for (const name of ['quantity', 'unit', 'preferences', 'website']) {
    await expect(page.locator(`#brief-${name}`), name).toHaveCount(1);
    await expect(page.locator(`#brief-${name}`), name).toBeHidden();
  }
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['quantity', 'unit', 'preferences', 'website'])
    await expect(page.locator(`#brief-${name}`), name).toBeVisible();
});
test('P-10 an error in a folded details field opens the fold and focuses the field', async ({
  page,
}) => {
  await toStep(page, '/plan?job=sourcing&companyCountry=BD&marketCode=CN', 2);
  await page
    .getByLabel(/^Your offer or requirement/)
    .fill('QA test (madeup): combed cotton yarn for knitting');
  await expect(page.locator('#brief-quantity')).toBeHidden();
  // The quantity is typed inside the fold, which is then closed again by the person.
  await fold(page, 'More details (optional)').click();
  await page.locator('#brief-quantity').fill('500');
  await fold(page, 'Fewer details').click();
  await expect(page.locator('#brief-quantity')).toBeHidden();
  await next(page).click();
  // A quantity needs a unit: the fold opens, the error is shown and the focus is on the unit.
  await expect(fold(page, 'Fewer details')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#unit-error')).toBeVisible();
  await expect(page.locator('#brief-unit')).toBeFocused();
});
test('P-10 a saved draft with a folded value comes back with the fold open', async ({ page }) => {
  await toStep(page, '/plan?job=sourcing&companyCountry=BD&marketCode=CN', 2);
  await fold(page, 'More details (optional)').click();
  await page.locator('#brief-quantity').fill('500');
  await page.locator('#brief-unit').fill('kg');
  await page.reload();
  await expect(page.locator('#brief-quantity')).toBeVisible();
  await expect(page.locator('#brief-quantity')).toHaveValue('500');
  await expect(page.locator('#brief-unit')).toHaveValue('kg');
});
test('P-10 the results step folds only optional fields and an error in one opens it', async ({
  page,
}) => {
  await toStep(page, '/plan?job=buyers&companyCountry=BD&marketCode=CN', 3);
  // The desired outcomes are required and stay in view; the two optional fields are folded and mounted.
  await expect(page.getByRole('group', { name: /Desired outcomes/ })).toBeVisible();
  for (const name of ['worthwhile'])
    await expect(page.locator(`#brief-${name}`), name).toBeHidden();
  await expect(page.getByLabel('Anything specific we should know? (optional)')).toHaveCount(1);
  await expect(page.getByLabel('Anything specific we should know? (optional)')).toBeHidden();
  // The required outcome is chosen, so the only problem is the folded field.
  await page.getByLabel('Relevant meetings', { exact: true }).check();
  await fold(page, 'More details (optional)').click();
  await page.locator('#brief-worthwhile').fill('ab');
  await fold(page, 'Fewer details').click();
  await next(page).click();
  await expect(fold(page, 'Fewer details')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#worthwhile-error')).toBeVisible();
  await expect(page.locator('#brief-worthwhile')).toBeFocused();
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

// The text of a page as separate blocks, so a denial in one paragraph never reaches a claim in the next. A block
// is the text of an element that holds no other block (a paragraph, list item, heading, cell, caption, summary);
// text outside those is read one text node at a time. Runs in the browser. The labelled Example mission is left out.
const readBlocks = (root: Element) => {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.ac1-record').forEach((node) => node.remove());
  const selector = 'p,li,h1,h2,h3,h4,h5,h6,dt,dd,td,th,figcaption,blockquote,summary,button,label';
  const blocks: string[] = [];
  const leaves = Array.from(copy.querySelectorAll(selector)).filter(
    (node) => !node.querySelector(selector),
  );
  for (const leaf of leaves) {
    blocks.push(leaf.textContent ?? '');
    leaf.textContent = '';
  }
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if ((node.textContent ?? '').trim()) blocks.push(node.textContent ?? '');
  return blocks;
};

test('change 3 guard: a claim after a denial, in the same or the next block, is still found', async ({
  page,
}) => {
  await page.setContent(
    `<main><p>Trusted by 100 companies with no subscription fees.</p>
     <p>We do not promise sales</p><p>Trusted by 5 buyers</p>
     <ul><li>We do not offer</li><li>Join 1,200 companies</li></ul>
     <p>We do not book travel or guarantee meetings.</p>
     <p>A plan for a <b>trip</b>.</p></main>`,
  );
  const blocks = await page.locator('main').evaluate(readBlocks);
  const found = proofClaimsIn(blocks).map((item) => item.sentence);
  expect(found).toEqual([
    'Trusted by 100 companies with no subscription fees.',
    'Trusted by 5 buyers',
    'Join 1,200 companies',
  ]);
});

for (const path of publicPaths)
  test(`change 3 ${path} makes no proof claim`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    // The sample mission on the home page is labelled Example and is not scanned; its label must be there.
    if (path === '/') await expect(page.locator('.ac1-record .ac1-example-tag')).toBeVisible();
    const blocks = await page.locator('main').evaluate(readBlocks);
    expect(blocks.length, path).toBeGreaterThan(3);
    expect(proofClaimsIn(blocks), path).toEqual([]);
  });
