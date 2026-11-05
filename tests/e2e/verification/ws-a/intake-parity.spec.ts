import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// Intake parity guard (revamp Wave 3 precondition). Every one of the 15 mission jobs is opened from its
// deep link and sent through the real /plan form, and the request that leaves the browser is checked
// field by field: which fields the job asks for, the role and objective it produces, original currency,
// consent and the guest draft that survives a reload. The send is answered by the test, so no request is
// stored and the hourly intake budget is untouched. These must pass on current main and after any change
// to the public home, /plan or the first question. The server runs without real use: made-up details only.

type Sent = { key: string; brief: Record<string, any>; websiteCheck: string };

const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true });
// The optional fields of the details and results steps sit behind "More Details (Optional)".
const unfold = async (page: Page) => {
  const toggle = page.getByRole('button', { name: 'More Details (Optional)', exact: true });
  if (await toggle.count()) await toggle.click();
};
const fillField = async (page: Page, name: string, value: string) =>
  await page.locator(`#brief-${name}`).fill(value);

const objectives = {
  sell: 'Sell in a new market',
  customers: 'Find customers or distributors',
  source: 'Source suppliers',
  trip: 'Make an upcoming business trip more productive',
  mission: 'Run a multi-company mission',
};

// job, label in the catalogue, objective a link sets, role, the optional fields the job shows.
const jobs: {
  job: string;
  label: string;
  objective: string;
  role: string;
  fields: Record<string, [string, (r: Record<string, any>) => unknown]>;
  budget?: boolean;
  organiser?: boolean;
}[] = [];
type Fields = Record<string, [string, (r: Record<string, any>) => unknown]>;
const spec = (r: Record<string, any>) => r.specifications;
const constraints = (r: Record<string, any>) => r.technicalConstraints;
const seller: Fields = {
  parameters: ['Fabric buyers, 50 to 200 stores', spec],
  preferences: ['Samples by March', constraints],
};
const sourcing: Fields = {
  parameters: ['Combed cotton, 30s count', spec],
  quantity: ['500', (r: Record<string, any>) => r.quantity],
  unit: ['kg', (r: Record<string, any>) => r.unit],
  preferences: ['Audited mills only', constraints],
};
const add = (
  job: string,
  label: string,
  objective: string,
  role: string,
  fields: Record<string, [string, (r: Record<string, any>) => unknown]> = {},
  extra: { budget?: boolean; organiser?: boolean } = {},
) => jobs.push({ job, label, objective, role, fields, ...extra });
add('buyers', 'Find buyers', objectives.sell, 'EXPORTER', seller);
add('customers', 'Find customers', objectives.customers, 'EXPORTER', seller);
add('distributors', 'Find distributors', objectives.customers, 'EXPORTER', seller);
add('partners', 'Find commercial partners', objectives.customers, 'EXPORTER');
add('sourcing', 'Source products or components', objectives.source, 'IMPORTER', sourcing, {
  budget: true,
});
add(
  'machinery_procurement',
  'Procure machinery',
  objectives.source,
  'BUYER',
  {
    technicalPurpose: ['Circular knitting line', (r) => r.machinery?.application],
    parameters: ['24 inch, 28 gauge', spec],
    preferences: ['Three-phase power on site', constraints],
  },
  { budget: true },
);
add('supplier_evaluation', 'Qualify suppliers', objectives.source, 'IMPORTER', sourcing);
add('meetings', 'Arrange commercial meetings', objectives.trip, 'EXPORTER');
add('factory_visits', 'Conduct site visits', objectives.trip, 'IMPORTER', sourcing);
add('trade_fairs', 'Improve trade-fair yield', objectives.trip, 'EXPORTER');
add('business_trips', 'Plan commercial trip execution', objectives.trip, 'EXPORTER');
add('market_validation', 'Validate a market', objectives.sell, 'EXPORTER');
add('market_entry', 'Enter a market', objectives.sell, 'EXPORTER', seller);
add('export_market_access', 'Develop export access', objectives.sell, 'EXPORTER', seller);
add(
  'delegations',
  'Run a multi-company mission',
  objectives.mission,
  'INSTITUTION',
  {},
  {
    organiser: true,
  },
);

async function capture(page: Page) {
  let sent: Sent | undefined;
  await page.route('**/api/intake', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent = route.request().postDataJSON() as Sent;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ receipt: 'a'.repeat(64) }),
    });
  });
  return () => sent;
}

for (const entry of jobs) {
  test(`P-01 P-02 P-05 ${entry.job}: opens from its link and sends every field it captures`, async ({
    page,
  }) => {
    const sentRequest = await capture(page);
    await page.goto(`/plan?job=${entry.job}&companyCountry=BD&marketCode=CN`);
    // Deep-link job selection: the job is chosen before anything is typed.
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      entry.job,
    );
    await next(page).click();
    // The countries from the link are kept; the optional date and attendance are asked here.
    await expect(page.locator('form.intake-form input[name="companyCountry"]')).toHaveValue('BD');
    await expect(page.locator('form.intake-form input[name="marketCode"]')).toHaveValue('CN');
    await fillField(page, 'whenNeeded', '2026-12-01');
    if (entry.job === 'trade_fairs') {
      await page.getByRole('radio', { name: 'Yes', exact: true }).check();
      await fillField(page, 'startDate', '2026-12-01');
      await fillField(page, 'endDate', '2026-12-05');
    }
    await next(page).click();
    // Details: only this job's fields appear, and none of another job's.
    await page
      .getByLabel(/^Your offer or requirement|^What should the trip achieve/)
      .first()
      .fill(`QA test (madeup): ${entry.label} for a knitting unit`);
    await unfold(page);
    const everyOptional = [
      'technicalPurpose',
      'parameters',
      'quantity',
      'unit',
      'preferences',
      'organiser',
      'participants',
    ];
    const shown = Object.keys(entry.fields).concat(
      entry.organiser ? ['organiser', 'participants'] : [],
    );
    for (const name of everyOptional)
      await expect(page.locator(`#brief-${name}`)).toHaveCount(shown.includes(name) ? 1 : 0);
    for (const [name, [value]] of Object.entries(entry.fields)) await fillField(page, name, value);
    if (entry.organiser) {
      await fillField(page, 'organiser', 'Dhaka Chamber trade desk');
      await fillField(page, 'participants', 'Twelve garment makers wanting fabric buyers');
    }
    await expect(page.locator('form.intake-form details summary')).toHaveCount(
      entry.budget ? 1 : 0,
    );
    if (entry.budget) {
      await page.locator('form.intake-form details summary').click();
      await fillField(page, 'budgetAmount', entry.job === 'sourcing' ? '1.234' : '12000.50');
      await page
        .getByRole('combobox', { name: /Original currency/ })
        .selectOption(entry.job === 'sourcing' ? 'BHD' : 'CNY');
      await fillField(page, 'budgetBasis', 'Total budget');
    }
    await fillField(page, 'website', 'https://example.com/catalogue');
    await next(page).click();
    // Results.
    await unfold(page);
    await fillField(page, 'worthwhile', 'Three real meetings');
    await page.getByLabel('Relevant meetings', { exact: true }).check();
    await page.getByLabel('Supplier visits', { exact: true }).check();
    await page.getByLabel('Anything specific we should know? (optional)').fill('Prefer mornings');
    await next(page).click();
    // Contact and consent: the request cannot be sent without the acknowledgement.
    await page.getByLabel('Name', { exact: true }).fill('QA buyer (madeup)');
    await page.getByLabel('Company', { exact: true }).fill('QA test company (madeup)');
    await page.getByLabel('Work email', { exact: true }).fill('QA-Buyer@example.invalid');
    await page.getByRole('button', { name: 'Submit Mission Request', exact: true }).click();
    await expect(page.locator('#acknowledged-error')).toBeVisible();
    expect(sentRequest()).toBeUndefined();
    await page.getByLabel('I have read', { exact: false }).check();
    await page.getByRole('button', { name: 'Submit Mission Request', exact: true }).click();
    await expect(page.getByLabel('Private receipt code')).toHaveValue('a'.repeat(64));

    const sent = sentRequest()!;
    expect(sent.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.websiteCheck).toBe('');
    const brief = sent.brief;
    expect(brief.objective).toBe(entry.objective);
    expect(brief.market).toBe('China');
    expect(brief.email).toBe('qa-buyer@example.invalid');
    expect(brief.acknowledged).toBe(true);
    expect(brief.outcomes).toEqual(['Relevant meetings', 'Supplier visits']);
    expect(brief.notes).toBe('Prefer mornings');
    expect(brief.website).toBe('https://example.com/catalogue');
    expect(brief.offer).toContain(entry.label);
    expect(brief.attendance).toBe(entry.job === 'trade_fairs' ? 'Yes' : 'Not decided');
    expect(brief.startDate).toBe(entry.job === 'trade_fairs' ? '2026-12-01' : '');
    expect(brief.endDate).toBe(entry.job === 'trade_fairs' ? '2026-12-05' : '');
    const x = brief.experience;
    expect(x).toMatchObject({
      schemaVersion: 1,
      companyCountry: 'BD',
      marketCode: 'CN',
      job: entry.job,
    });
    const r = x.requirements;
    expect(r.objective).toBe(entry.label);
    expect(r.role).toBe(entry.role);
    expect(r.product).toBe(brief.offer);
    expect(r.travelDates).toBe('2026-12-01');
    expect(r.decisionCriteria).toEqual(['Three real meetings']);
    for (const [, [value, read]] of Object.entries(entry.fields)) expect(read(r)).toBe(value);
    if (entry.budget) {
      // The amount is stored in the original currency's own smallest unit, never converted.
      expect(r.currency).toBe(entry.job === 'sourcing' ? 'BHD' : 'CNY');
      expect(r.budgetMinor).toBe(entry.job === 'sourcing' ? '1234' : '1200050');
      expect(r.budgetBasis).toBe('Total budget');
    } else {
      expect(r.budgetMinor).toBeUndefined();
      expect(r.currency).toBeUndefined();
    }
    expect(x.organiser).toBe(entry.organiser ? 'Dhaka Chamber trade desk' : undefined);
    expect(x.participants).toBe(
      entry.organiser ? 'Twelve garment makers wanting fabric buyers' : undefined,
    );
  });
}

test('P-04 a guest draft survives a reload and resumes on the same step with its fields, and nothing is sent before Submit', async ({
  page,
}) => {
  const sentRequest = await capture(page);
  await page.goto('/plan?job=sourcing&companyCountry=BD&marketCode=CN');
  await next(page).click();
  await next(page).click();
  await page
    .getByLabel('Your offer or requirement', { exact: true })
    .fill('QA test (madeup): combed cotton yarn, kept across a reload');
  await unfold(page);
  await fillField(page, 'quantity', '500');
  await fillField(page, 'unit', 'kg');
  await page.reload();
  await expect(
    page.getByText('A draft from this tab was resumed.', { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Your offer or requirement/ })).toHaveValue(
    'QA test (madeup): combed cotton yarn, kept across a reload',
  );
  await expect(page.locator('#brief-quantity')).toHaveValue('500');
  await expect(page.locator('#brief-unit')).toHaveValue('kg');
  const draft = await page.evaluate(() => sessionStorage.getItem('corridra-mission-draft'));
  expect(JSON.parse(draft!)).toMatchObject({ version: 2, step: 2 });
  expect(sentRequest()).toBeUndefined();
});

test('P-02 a quantity without a unit and a partial budget are refused on their own fields', async ({
  page,
}) => {
  await page.goto('/plan?job=sourcing&companyCountry=BD&marketCode=CN');
  await next(page).click();
  await next(page).click();
  await page
    .getByLabel('Your offer or requirement', { exact: true })
    .fill('QA test (madeup): combed cotton yarn for a knitting unit');
  await unfold(page);
  await fillField(page, 'quantity', '500');
  await next(page).click();
  await expect(page.locator('#unit-error')).toBeVisible();
  await fillField(page, 'unit', 'kg');
  await page.locator('form.intake-form details summary').click();
  await fillField(page, 'budgetAmount', '100');
  await next(page).click();
  await expect(page.locator('main')).toContainText(/currency|quantity basis/i);
  await expect(page.locator('#brief-budgetAmount')).toBeVisible();
});

test('P-05 an old or unknown job link opens the plan with no job chosen', async ({ page }) => {
  for (const path of ['/plan', '/plan?job=not_a_job', '/plan?job=']) {
    await page.goto(path);
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      '',
    );
  }
});
