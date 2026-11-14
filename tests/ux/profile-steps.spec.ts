import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI/UX.v3 audit unit A3b, part 1: the company profile form in three steps. The real component and the real stylesheets
// are drawn on a small bundled page inside the real customer frame (no sign-in, the profile API is answered by the test),
// at the three widths of the owner's checklist. The steps are presentation only, so these cases also pin what must not
// change: every control id and its order, the saved payload with its key order, and the messages. Every case fails on the
// code before this change: the component has no `steps` prop there, so every control is on screen at once.
const fixturePath = '/__profile-steps-fixture';
const workspaceId = '00000000-0000-4000-8000-000000000006';
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let html = '';

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { pageFrameSlots } from ${JSON.stringify(resolve('apps/web/components/ux/page-frame.tsx'))};
        import { OrganisationProfile } from ${JSON.stringify(resolve('apps/web/app/account/profile/organisation-profile.tsx'))};
        const query = new URLSearchParams(location.search);
        const steps = query.get('steps') !== '0';
        const slots = pageFrameSlots({
          back: { label: 'Back to my account', href: '/account' },
          helper: 'Sample details only, kept private to this workspace.',
        });
        createRoot(document.getElementById('app')).render(
          <WorkspaceShell title="Company profile" customer above={slots.above} lead={slots.lead}>
            <OrganisationProfile subject="synthetic-alice" issuer=${JSON.stringify(issuer)}
              workspaceId=${JSON.stringify(workspaceId)} steps={steps} framed={steps} />
          </WorkspaceShell>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    loader: { '.css': 'empty' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const css = [
    'app/globals.css',
    'components/ux/shells.css',
    'components/ux/page-frame.css',
    'components/ux/pickers.css',
    'app/account/page-budget.css',
    'app/account/profile/profile-steps.css',
  ]
    .flatMap((file) => {
      try {
        return [readFileSync(resolve('apps/web', file), 'utf8')];
      } catch {
        return [];
      }
    })
    .join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Profile steps fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${bundle.outputFiles[0]!.text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
});

const profile = {
  version: 1,
  legalName: 'Synthetic Dhaka Garments Limited',
  countryCode: 'BD',
  website: 'https://garments.example',
  commercialRoles: ['SELLER', 'MANUFACTURER'],
  sectors: ['Knitwear', 'Denim'],
  sizeBand: '201-1000',
  summary: 'Synthetic exporter of knit and denim garments',
  updatedAt: '2026-10-19T00:00:00Z',
};
function view(version: number) {
  return {
    workspaceId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    organisationId: null,
    canonicalLinked: false,
    provenance: 'SELF_REPORTED',
    verified: false,
    canEdit: true,
    currentVersion: version,
    profile: version === 0 ? null : { ...profile, version, reason: 'Synthetic original profile' },
  };
}

type Saved = Record<string, unknown>;
async function open(
  page: Page,
  width: number,
  options: { version?: number; steps?: boolean; height?: number } = {},
) {
  const saved: Saved[] = [];
  const version = options.version ?? 0;
  await page.route('**/api/customer-organisation-profiles**', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({
        json:
          new URL(request.url()).searchParams.get('scope') === 'history'
            ? { workspaceId, revisions: [], nextBefore: null }
            : view(version),
      });
    const body = request.postDataJSON() as Saved;
    saved.push(body);
    return route.fulfill({ json: { ...view(version + 1), commandId: body.commandId } });
  });
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width, height: options.height ?? 844 });
  await page.goto(`${fixturePath}?steps=${options.steps === false ? 0 : 1}`);
  await expect(page.locator('h1')).toHaveText('Company profile');
  if (version > 0) await page.getByRole('button', { name: 'Edit Company Profile' }).click();
  await expect(page.getByRole('group', { name: /company profile/i }).first()).toBeVisible();
  return saved;
}

const visibleControls = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.profile-step:not([hidden]) > *')).map(
      (el) => (el.querySelector('label, legend')?.textContent ?? el.textContent ?? '').trim(),
    ),
  );
const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const back = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const save = (page: Page) =>
  page.getByRole('button', { name: 'Save Company Profile', exact: true });
const title = (page: Page) => page.locator('.profile-step-title');

async function fillCompany(page: Page) {
  await page
    .getByLabel('Company name (start with Synthetic)')
    .fill('Synthetic Dhaka Garments Limited');
  await page.getByRole('combobox', { name: 'Country' }).fill('Bangladesh');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('Bangladesh');
}
async function fillProfile(page: Page) {
  await page.getByLabel('Buyer').check();
  await page.getByLabel('Seller').check();
  await page.getByLabel('Sectors (comma separated, up to ten)').fill(' Knitwear , Denim ,');
  await page.getByLabel('Company size').selectOption('201-1000');
}

for (const width of [390, 768, 1440]) {
  test.describe(`${width} px`, () => {
    test('the form shows one step of one to three controls, the step it is on and the next action', async ({
      page,
    }) => {
      await open(page, width);
      await expect(title(page)).toHaveText('Step 1 of 3: Company');
      const controls = await visibleControls(page);
      expect(controls.length).toBeGreaterThanOrEqual(1);
      expect(controls.length).toBeLessThanOrEqual(3);
      await expect(page.getByLabel('Company name (start with Synthetic)')).toBeVisible();
      await expect(page.getByLabel('About the company (start with Synthetic)')).toBeHidden();
      await expect(next(page)).toBeVisible();
      await expect(save(page)).toHaveCount(0);
      await expect(back(page)).toHaveCount(0);
      await expect(page.locator('.profile-steps li[aria-current="step"]')).toHaveText(/Company/);
      await expect(page.locator('.button-primary')).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      if (width === 390) {
        expect((await next(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('every step holds one to three controls and fits the signed-in page budget', async ({
      page,
    }) => {
      // The owner's budget is measured on a 390 x 844 phone and a 1440 x 900 desktop; the tablet uses the desktop height.
      await open(page, width, { height: width === 390 ? 844 : 900 });
      const limit = width === 390 ? 1.5 : 1;
      const screens = async () =>
        (await page.evaluate(() => document.documentElement.scrollHeight)) /
        page.viewportSize()!.height;
      expect(await screens()).toBeLessThanOrEqual(limit);
      await fillCompany(page);
      await next(page).click();
      await expect(title(page)).toHaveText('Step 2 of 3: Profile');
      expect((await visibleControls(page)).length).toBeLessThanOrEqual(3);
      // The frame, the heading and one step: inside the signed-in budget (phone 1.5 target, desktop 1).
      expect(await screens()).toBeLessThanOrEqual(limit);
      await fillProfile(page);
      await next(page).click();
      await expect(title(page)).toHaveText('Step 3 of 3: Confirm');
      expect((await visibleControls(page)).length).toBeLessThanOrEqual(3);
      await expect(save(page)).toBeVisible();
      await expect(next(page)).toHaveCount(0);
      expect(await screens()).toBeLessThanOrEqual(limit);
    });
  });
}

test('the stepped form has exactly the controls, ids and order of the single form', async ({
  page,
}) => {
  const ids = async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('form [id]')).map((el) =>
        el.id.replace(/^.*?(legalName|countryCode|website|sectors|sizeBand|summary|reason)$/, '$1'),
      ),
    );
  await open(page, 1440, { version: 1, steps: false });
  const single = await ids();
  await page.goto(`${fixturePath}?steps=1`);
  await page.getByRole('button', { name: 'Edit Company Profile' }).click();
  await expect(title(page)).toBeVisible();
  expect(await ids()).toEqual(single);
  expect(single).toEqual(
    expect.arrayContaining([
      'legalName',
      'countryCode',
      'website',
      'sectors',
      'sizeBand',
      'summary',
      'reason',
    ]),
  );
});

test('a first profile saves the same payload, in the same key order, as the single form', async ({
  page,
}) => {
  const saved = await open(page, 1440);
  await fillCompany(page);
  await next(page).click();
  await fillProfile(page);
  await next(page).click();
  await page
    .getByLabel('About the company (start with Synthetic)')
    .fill('Synthetic exporter of knit and denim garments');
  await expect(page.getByLabel('Reason for this change', { exact: true })).toHaveCount(0);
  await page
    .getByLabel('I confirm these details are accurate to the best of my knowledge.')
    .check();
  await save(page).click();
  await expect(page.getByRole('status')).toHaveText('Company profile saved.');
  expect(saved).toHaveLength(1);
  expect(Object.keys(saved[0]!)).toEqual([
    'commandId',
    'workspaceId',
    'expectedVersion',
    'legalName',
    'countryCode',
    'website',
    'commercialRoles',
    'sectors',
    'sizeBand',
    'summary',
    'reason',
    'acknowledged',
  ]);
  expect(saved[0]).toMatchObject({
    workspaceId,
    expectedVersion: 0,
    legalName: 'Synthetic Dhaka Garments Limited',
    countryCode: 'BD',
    website: null,
    commercialRoles: ['BUYER', 'SELLER'],
    sectors: ['Knitwear', 'Denim'],
    sizeBand: '201-1000',
    reason: 'First version of the company profile',
    acknowledged: true,
  });
});

test('Back and Next keep every typed value and focus moves to the new step title', async ({
  page,
}) => {
  await open(page, 390);
  await fillCompany(page);
  await next(page).click();
  await expect(title(page)).toBeFocused();
  await fillProfile(page);
  await back(page).click();
  await expect(title(page)).toHaveText('Step 1 of 3: Company');
  await expect(title(page)).toBeFocused();
  await expect(page.getByLabel('Company name (start with Synthetic)')).toHaveValue(
    'Synthetic Dhaka Garments Limited',
  );
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('Bangladesh');
  await next(page).click();
  await expect(page.getByLabel('Seller')).toBeChecked();
  await expect(page.getByLabel('Sectors (comma separated, up to ten)')).toHaveValue(
    ' Knitwear , Denim ,',
  );
  await expect(page.getByLabel('Company size')).toHaveValue('201-1000');
});

test('Enter in a field goes to the next step and a step lists its controls to a screen reader', async ({
  page,
}) => {
  await open(page, 1440);
  await fillCompany(page);
  await page.getByLabel(/^Website/).press('Enter');
  await expect(title(page)).toHaveText('Step 2 of 3: Profile');
  await expect(page.locator('.profile-steps')).toHaveAttribute('aria-label', 'Steps');
  await expect(page.locator('.profile-steps li[aria-current="step"]')).toHaveText(/Profile/);
  await expect(page.locator('.profile-steps li').first()).toContainText('(done)');
});

test('an invalid control on the shown step stops Next, is named in an alert and takes focus', async ({
  page,
}) => {
  await open(page, 390);
  await next(page).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Step 1 of 3 needs a fix.');
  await expect(alert).toContainText('Company name');
  await expect(title(page)).toHaveText('Step 1 of 3: Company');
  await expect(page.getByLabel('Company name (start with Synthetic)')).toBeFocused();
  await page
    .getByLabel('Company name (start with Synthetic)')
    .fill('Synthetic Dhaka Garments Limited');
  await expect(alert).toHaveCount(0);
});

test('Save never hides an error: it returns to the first step that needs a fix and sends nothing', async ({
  page,
}) => {
  const saved = await open(page, 1440);
  await fillCompany(page);
  await next(page).click();
  await fillProfile(page);
  await next(page).click();
  await page
    .getByLabel('About the company (start with Synthetic)')
    .fill('Synthetic exporter of knit and denim garments');
  await page
    .getByLabel('I confirm these details are accurate to the best of my knowledge.')
    .check();
  // A control on an earlier step becomes empty while it is out of sight (a browser autofill or an extension can do this).
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[id$="legalName"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await save(page).click();
  await expect(title(page)).toHaveText('Step 1 of 3: Company');
  await expect(page.getByRole('alert')).toContainText('Step 1 of 3 needs a fix.');
  await expect(page.getByLabel('Company name (start with Synthetic)')).toBeFocused();
  expect(saved).toHaveLength(0);
});

test('an existing profile edit asks for its reason on the last step, with the same short-reason rule', async ({
  page,
}) => {
  const saved = await open(page, 1440, { version: 1 });
  await next(page).click();
  await next(page).click();
  await expect(page.getByLabel('Reason for this change', { exact: true })).toBeVisible();
  expect((await visibleControls(page)).length).toBe(3);
  const reason = page.getByLabel('Reason for this change', { exact: true });
  await reason.pressSequentially('ab');
  await page
    .getByLabel('I confirm these details are accurate to the best of my knowledge.')
    .check();
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText('Step 3 of 3 needs a fix.');
  expect(saved).toHaveLength(0);
  await reason.pressSequentially('c');
  await save(page).click();
  await expect(page.getByRole('status')).toHaveText('Company profile saved.');
  expect(saved[0]).toMatchObject({ reason: 'abc', expectedVersion: 1 });
});

for (const width of [390, 1440]) {
  test(`${width} px: no accessibility violations on any step`, async ({ page }) => {
    await open(page, width);
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .include('form')
          .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
          .analyze()
      ).violations;
    expect(await scan()).toEqual([]);
    await fillCompany(page);
    await next(page).click();
    expect(await scan()).toEqual([]);
    await fillProfile(page);
    await next(page).click();
    expect(await scan()).toEqual([]);
  });
}
