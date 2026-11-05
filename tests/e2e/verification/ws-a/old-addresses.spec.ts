import { test, expect } from '../fixtures';
import { corridorPages } from '../../../../apps/web/content/corridors';

// Spec pack 1 (docs/revamp/specs/public-home.md), P-06 and P-07. Every old public address still answers, and
// the link on it that starts a request keeps the job it names today. Frozen on 4 Nov 2026 from
// apps/web/content/public-pages.ts, apps/web/app/corridors and apps/web/app/page.tsx. If a job here has to
// change, that is a product decision, not a refactor. /fairs depends on the trade-fairs switch
// (CORRIDRA_UX_FAIRS) at build time; see its test. The off state is also pinned in tests/integration/ux-fairs.test.ts.

const withJob: [string, string][] = [
  ['/sell', '/plan?job=buyers'],
  ['/source', '/plan?job=sourcing'],
  ['/machinery', '/plan?job=machinery_procurement'],
  ['/trade-missions', '/plan?job=delegations'],
  ['/business-trips', '/plan?job=business_trips'],
  ['/enter-market', '/plan?job=market_entry'],
];

for (const [path, plan] of withJob)
  test(`P-06 ${path} still answers and keeps its request link ${plan}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator(`main a[href="${plan}"]`).first()).toBeVisible();
    await page.locator(`main a[href="${plan}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(plan.replace('?', '\\?') + '$'));
    const job = plan.split('=')[1]!;
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      job,
    );
  });

test('P-06 /corridors lists every route and starts a request', async ({ page }) => {
  const response = await page.goto('/corridors');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main a[href="/plan"]').first()).toBeVisible();
  for (const slug of Object.keys(corridorPages))
    await expect(page.locator(`main a[href="/corridors/${slug}"]`).first(), slug).toBeVisible();
});

for (const [slug, corridor] of Object.entries(corridorPages))
  test(`P-06 /corridors/${slug} still answers and opens the plan with its countries`, async ({
    page,
  }) => {
    const response = await page.goto(`/corridors/${slug}`);
    expect(response?.status()).toBe(200);
    const link = page.locator(
      `main a[href="/plan?companyCountry=BD&marketCode=${corridor.market}"]`,
    );
    await expect(link.first()).toBeVisible();
    await link.first().click();
    await expect(page).toHaveURL(/\/plan\?companyCountry=BD&marketCode=/);
    await page
      .getByRole('combobox', { name: 'Commercial job', exact: true })
      .selectOption('sourcing');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('form.intake-form input[name="companyCountry"]')).toHaveValue('BD');
    await expect(page.locator('form.intake-form input[name="marketCode"]')).toHaveValue(
      corridor.market,
    );
  });

test('P-06 an unknown corridor is the plain not found page, not an error', async ({ page }) => {
  expect((await page.goto('/corridors/not-a-route'))?.status()).toBe(404);
});

test('P-06 /fairs answers for the way this server was built, and keeps its request link', async ({
  page,
}) => {
  // /fairs is pre-rendered at build time with CORRIDRA_UX_FAIRS. CI builds with it on (ci.yml, "Production
  // build"); a local build without it is the plain not found page. Each state has its own assertions, and a
  // build that was made with the switch on must show the page.
  const response = await page.goto('/fairs');
  const status = response?.status();
  if (process.env.CORRIDRA_UX_FAIRS === 'true') expect(status).toBe(200);
  expect([200, 404]).toContain(status);
  if (status === 200) {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fairs we have checked.' }),
    ).toBeVisible();
    // The fair list is empty on purpose until a person adds a checked entry, so the page offers the request.
    await expect(page.locator('main a[href="/plan?job=trade_fairs"]').first()).toBeVisible();
    await page.locator('main a[href="/plan?job=trade_fairs"]').first().click();
    await expect(page.getByRole('combobox', { name: 'Commercial job', exact: true })).toHaveValue(
      'trade_fairs',
    );
  } else {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main a[href="/plan?job=trade_fairs"]')).toHaveCount(0);
  }
});

test('P-06 /fairs/<slug> is the plain not found page for an address that is not a checked fair', async ({
  page,
}) => {
  // No fair is listed yet, so every slug is not found, with the switch on or off, and it is never an error.
  expect((await page.goto('/fairs/any-fair'))?.status()).toBe(404);
  expect((await page.goto('/fairs/madrid-2026'))?.status()).toBe(404);
});

test('P-06 /plan#receipt-check opens the receipt check', async ({ page }) => {
  await page.goto('/plan#receipt-check');
  await expect(page.getByLabel('Receipt code', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check Status and Replies' })).toBeVisible();
});

test('P-07 the home page sends its three jobs to buyers, sourcing and delegations', async ({
  page,
}) => {
  await page.goto('/');
  for (const href of ['/plan?job=buyers', '/plan?job=sourcing', '/plan?job=delegations'])
    await expect(page.locator(`main a[href="${href}"]`).first(), href).toBeVisible();
});
