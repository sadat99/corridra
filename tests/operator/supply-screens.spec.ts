import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { startSupplyFixture, supplyCandidate, supplyMission, supplyTenant } from './supply-fixture';

// ADR-082 slice S3: the supply source screens. The screens are bundled from the source with the real stylesheets and the team
// shell, and every read and write is answered here with synthetic rows. The switch-off test starts the real server on a production build when one exists;
// the route handler itself is held in tests/integration/supply-routes.test.ts.
let fixture: Awaited<ReturnType<typeof startSupplyFixture>>;
test.beforeAll(async () => {
  fixture = await startSupplyFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const now = new Date().toISOString();
const later = new Date(Date.now() + 200 * 86400000).toISOString();
const source = {
  id: '00000000-0000-4000-8000-0000000000d1',
  kind: 'staff_research',
  versionId: '00000000-0000-4000-8000-0000000000d2',
  version: 2,
  status: 'active',
  label: 'Trade register of Spain',
  sourceRecordId: null,
  defaultRetentionMonths: 12,
  agreementEndsAt: null,
  reason: 'Created by staff',
};
const candidateRow = (name: string, extra: Record<string, unknown> = {}) => ({
  id: supplyCandidate,
  missionId: supplyMission,
  companyName: name,
  country: 'ES',
  sourceLabel: source.label,
  sourceKind: 'staff_research',
  sourceVersion: 2,
  method: 'manual',
  state: 'source-reported',
  observedAt: now,
  retentionUntil: later,
  expired: false,
  warnings: [],
  websiteHost: null,
  publicIdentifier: null,
  nominationNote: null,
  sizeBand: null,
  counterpartyTypes: [],
  latestReview: null,
  latestMatch: null,
  currentMatch: null,
  reviews: [],
  matches: [],
  ...extra,
});

type World = {
  moduleOpen: boolean;
  candidates: ReturnType<typeof candidateRow>[];
  blocks: Record<string, unknown>[];
  sent: { action: string; body: Record<string, unknown> }[];
  fileClosed: boolean;
};
async function open(page: Page, screen: string, world: Partial<World> = {}, role = 'owner') {
  const w: World = {
    moduleOpen: true,
    candidates: [candidateRow('Ibérica Frutas SL')],
    blocks: [],
    sent: [],
    fileClosed: true,
    ...world,
  };
  await page.route('**/api/supply/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/').pop()!;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().method() === 'POST') {
      if (action === 'import-file')
        return json({ error: 'File import is not available yet.' }, 409);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      w.sent.push({ action, body });
      if (action === 'add-candidate') {
        w.candidates = [
          candidateRow(String(body.companyName), {
            id: supplyCandidate,
            warnings: ['personal_name_check'],
          }),
        ];
        return json({ candidateId: supplyCandidate, warnings: ['personal_name_check'] }, 201);
      }
      if (action === 'block') {
        w.blocks = [
          {
            id: 'blk1',
            state: 'BLOCKED',
            organisationId: null,
            organisationName: null,
            nameKey: String(body.companyName).toLowerCase(),
            country: body.country,
            reason: body.reason,
            reference: body.reference,
            at: now,
            by: 'u',
            current: true,
          },
        ];
        return json({ blockId: 'blk1' }, 201);
      }
      if (action === 'lift') {
        const [latest, ...rest] = w.blocks;
        w.blocks = [
          { ...latest, id: 'blk2', state: 'LIFTED', current: true },
          { ...latest, current: false },
          ...rest,
        ];
        return json({ blockId: 'blk2' }, 201);
      }
      return json({ ok: true }, 201);
    }
    if (action === 'state')
      return json({
        moduleOpen: w.moduleOpen,
        profile: { id: '00000000-0000-4000-8000-0000000000e1', version: 3, role: 'BUYER' },
        kinds: ['staff_research'],
      });
    if (action === 'sources') return json({ sources: [source] });
    if (action === 'source-versions')
      return json({
        versions: [
          { id: 'v2', version: 2, status: 'active', reason: 'Resumed', createdAt: now },
          { id: 'v1', version: 1, status: 'active', reason: 'Created by staff', createdAt: now },
        ],
      });
    if (action === 'missions')
      return json({
        missions: [
          {
            id: supplyMission,
            status: 'open',
            nextAction: 'Review candidates',
            createdAt: now,
            candidates: 1,
            candidatesLive: 1,
            profileVersion: 3,
          },
        ],
      });
    if (action === 'route-kinds')
      return json({
        routes: [
          {
            id: supplyMission,
            status: 'open',
            nextAction: 'x',
            createdAt: now,
            kinds: ['staff_research', 'partner_organisation'],
          },
        ],
      });
    if (action === 'candidates') return json({ candidates: w.candidates });
    if (action === 'candidate') return json({ candidate: w.candidates[0] });
    if (action === 'batches') return json({ batches: [] });
    if (action === 'blocks') return json({ blocks: w.blocks });
    return json({ error: 'Not found' }, 404);
  });
  await page.route('**/api/workspace/research**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ organisations: [] }) }),
  );
  await page.route('**/api/picker/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ options: [] }) }),
  );
  await page.goto(`${fixture.origin}/?screen=${screen}&role=${role}`);
  return w;
}

test.describe('switch off', () => {
  test('the four pages answer 404 on a build with the switch off', async () => {
    test.skip(!existsSync('apps/web/.next/BUILD_ID'), 'needs pnpm build');
    const port = 3299;
    const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
      cwd: 'apps/web',
      env: { ...process.env, CORRIDRA_SUPPLY_SOURCES: undefined },
      stdio: 'ignore',
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      await expect
        .poll(
          async () =>
            fetch(base).then(
              (r) => r.status,
              () => 0,
            ),
          { timeout: 30000 },
        )
        .not.toBe(0);
      for (const action of ['sources', 'candidates', 'blocks', 'import-file', 'lift'])
        expect(
          (await fetch(`${base}/api/supply/${action}?tenant=${supplyTenant}`)).status,
          action,
        ).toBe(404);
      for (const path of [
        '/operator/supply',
        `/operator/supply/missions/${supplyMission}`,
        `/operator/supply/missions/${supplyMission}/candidates/${supplyCandidate}`,
        '/operator/supply/do-not-contact',
      ])
        expect((await fetch(base + path)).status, path).toBe(404);
    } finally {
      server.kill('SIGTERM');
    }
  });
});

test.describe('the hub', () => {
  test('lists the source, locks the other kinds with visible reasons and keeps Verified out', async ({
    page,
  }) => {
    await open(page, 'hub');
    await expect(page.getByRole('tablist', { name: 'Supply sections' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Supply sources' })).toContainText(
      'Trade register of Spain',
    );
    await expect(page.getByText('Versions (2)')).toBeVisible();
    await page.getByText('New Source', { exact: true }).click();
    await expect(page.getByText('Step 1 of 2')).toBeVisible();
    const partner = page.getByRole('radio', { name: 'Partner Organisation' });
    await expect(partner).toBeDisabled();
    await expect(
      page
        .getByText(
          "Locked. Partner sources are not open yet. They need an agreement on record and the owner's approval.",
        )
        .first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Describe the source' })).toBeFocused();
    await expect(page.getByLabel('Keep records for (months)')).toHaveValue('12');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/Verified/);
    expect(text).not.toContain('—');
  });

  test('creating a source sends an active staff research source and says so', async ({ page }) => {
    const w = await open(page, 'hub');
    await page.getByText('New Source', { exact: true }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Source label').fill('Company register of Portugal');
    await page.getByRole('button', { name: 'Create Source' }).click();
    await expect(page.getByText('Source created. It is active and can be used now.')).toBeVisible();
    expect(w.sent[0]).toMatchObject({
      action: 'create-source',
      body: {
        kind: 'staff_research',
        status: 'active',
        label: 'Company register of Portugal',
        defaultRetentionMonths: 12,
      },
    });
  });

  test('pausing a source asks one reason and sends the next version', async ({ page }) => {
    const w = await open(page, 'hub');
    await page.getByRole('button', { name: 'Pause Source' }).click();
    await page.getByLabel('Reason (3 to 160 characters)').fill('Register is being rebuilt');
    await page.getByRole('button', { name: 'Pause Source' }).click();
    await expect.poll(() => w.sent.length).toBe(1);
    expect(w.sent[0]!.body).toMatchObject({
      expectedVersion: 2,
      status: 'paused',
    });
  });

  test('the route kinds tab says Offered, locked for an offered kind and Always for staff research', async ({
    page,
  }) => {
    await open(page, 'hub');
    await page.getByRole('tab', { name: 'Route Kinds' }).click();
    await expect(page.getByRole('cell', { name: 'Offered, locked' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Always' })).toBeVisible();
  });

  test('a paused module shows the paused notice and disables the create button with a reason', async ({
    page,
  }) => {
    await open(page, 'hub', { moduleOpen: false });
    await expect(
      page
        .getByText(
          'Supply sources are paused. Records stay readable. New entries wait until the team resumes them.',
        )
        .first(),
    ).toBeVisible();
  });

  test('a viewer can read but is told why there is no form', async ({ page }) => {
    await open(page, 'hub', {}, 'viewer');
    await expect(page.getByRole('list', { name: 'Supply sources' })).toBeVisible();
    await expect(
      page.getByText(
        'Your role can read this but not change it. Ask an owner or admin if you need to add records.',
      ),
    ).toBeVisible();
    await expect(page.getByText('New Source', { exact: true })).toHaveCount(0);
  });
});

test.describe('candidates', () => {
  test('one company is added by hand in three steps and the name check is raised', async ({
    page,
  }) => {
    const w = await open(page, 'mission');
    await expect(page.getByRole('heading', { name: /^Candidates for / })).toBeVisible();
    await expect(page.getByText('Profile version 3', { exact: true })).toBeVisible();
    await expect(
      page.getByText('1 qualified', { exact: false }).or(page.getByText('0 qualified')),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Add One' }).click();
    await expect(
      page.getByText(
        'Adding to source: Trade register of Spain, version 2. For profile version 3.',
      ),
    ).toBeVisible();
    await page.getByLabel('Company name').fill('Lin Wei Trading');
    await page.getByLabel('Country').selectOption('ES');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'What do you know about it?' })).toBeFocused();
    await page.getByRole('checkbox', { name: 'Importer' }).check();
    await expect(page.getByText('1 of 8 chosen')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Observed date').fill('2026-11-01');
    await page.getByLabel('Source locator').fill('https://registro.example.es/entry/17');
    await page.getByRole('button', { name: 'Add Candidate' }).click();
    await expect(
      page.getByText('Added. Lin Wei Trading is on the list and not yet reviewed.'),
    ).toBeVisible();
    await expect(
      page.getByText('Name check raised. Look at the name before you qualify it.'),
    ).toBeVisible();
    expect(w.sent[0]).toMatchObject({
      action: 'add-candidate',
      body: {
        companyName: 'Lin Wei Trading',
        country: 'ES',
        counterpartyTypes: ['importer'],
        sourceLocator: 'https://registro.example.es/entry/17',
        profileVersionId: '00000000-0000-4000-8000-0000000000e1',
        sourceVersionId: source.versionId,
      },
    });
    await expect(page.getByRole('button', { name: 'Add Another Company' })).toBeVisible();
  });

  test('the personal data line is exact and the file import shows the server refusal as the locked panel', async ({
    page,
  }) => {
    await open(page, 'mission');
    await expect(
      page
        .getByText(
          "This list holds company details only. Contact details are refused. A company name can still be a person's name, so names are checked.",
        )
        .first(),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Import File' }).click();
    await page.getByText('What the file needs').click();
    for (const column of [
      'company_name',
      'country',
      'website_host',
      'public_identifier',
      'size_band',
      'counterparty_types',
      'observed_at',
      'source_locator',
    ])
      await expect(page.locator('code', { hasText: new RegExp(`^${column}$`) })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check and Import' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByLabel('File (CSV or XLSX)').setInputFiles({
      name: 'rows.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('company_name,country\r\n'),
    });
    await page.getByRole('button', { name: 'Check and Import' }).click();
    await expect(page.getByText('File import is not open yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add One Company' })).toBeVisible();
  });

  test('a candidate record shows source-reported facts, the review form and a locked match hint', async ({
    page,
  }) => {
    await open(page, 'candidate');
    await expect(page.getByRole('heading', { name: 'Ibérica Frutas SL' })).toBeVisible();
    await expect(
      page.getByText(
        'Source-reported. These details are as stated by the source. Corridra has not verified them.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Decision' })).toBeVisible();
    await expect(
      page.getByText('Qualify this candidate before matching it to a company.'),
    ).toBeVisible();
  });

  test('only the match that still stands offers a reversal', async ({ page }) => {
    const matches = [
      {
        id: 'm3',
        decision: 'NO_MATCH',
        organisationId: 'o2',
        organisationName: 'Nope SL',
        reverseOf: null,
        at: now,
        reversed: false,
      },
      {
        id: 'm2',
        decision: 'MATCH',
        organisationId: 'o1',
        organisationName: 'Frutas Unidas SL',
        reverseOf: null,
        at: now,
        reversed: false,
      },
      {
        id: 'm1',
        decision: 'MATCH',
        organisationId: 'o1',
        organisationName: 'Frutas Unidas SL',
        reverseOf: null,
        at: now,
        reversed: true,
      },
    ];
    await open(page, 'candidate', {
      candidates: [
        candidateRow('Ibérica Frutas SL', {
          matches,
          latestMatch: { id: 'm3', decision: 'NO_MATCH', organisationId: 'o2', at: now },
          currentMatch: { id: 'm2', decision: 'MATCH', organisationId: 'o1', at: now },
        }),
      ],
    });
    await page.getByText('Match history (3)').click();
    await expect(page.getByRole('button', { name: 'Reverse This Match' })).toHaveCount(1);
    await expect(
      page.getByText('Reverse the match to Frutas Unidas SL recorded on', { exact: false }),
    ).toBeVisible();
  });
});

test.describe('do not contact', () => {
  test('a company is blocked in two steps and the owner sees Lift Block, an operator does not', async ({
    page,
  }) => {
    const w = await open(page, 'dnc');
    await expect(
      page.getByText('Blocks already recorded still apply while supply is paused.'),
    ).toBeVisible();
    await expect(
      page.getByText('No blocks recorded. Add one if a company must not be contacted.'),
    ).toBeVisible();
    await page.getByText('Block a Company', { exact: true }).click();
    await page.getByRole('radio', { name: 'Not in the catalogue yet' }).check();
    await page.getByLabel('Company name').fill('Acme Imports');
    await page.getByLabel('Country').selectOption('DE');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Why?' })).toBeFocused();
    await page.getByLabel('Reason', { exact: true }).fill('Asked in writing');
    await page.getByLabel('Reference (3 to 120 characters)').fill('CASE-204');
    await page.getByRole('button', { name: 'Block Company' }).click();
    await expect(
      page.getByText(
        'Blocked. Acme Imports will be refused for new candidates, matches and introductions.',
      ),
    ).toBeVisible();
    expect(w.sent[0]).toMatchObject({
      action: 'block',
      body: { companyName: 'Acme Imports', country: 'DE', reference: 'CASE-204' },
    });
    await expect(page.getByRole('button', { name: 'Lift Block' })).toBeVisible();
    // Lift and block again name the entry itself, never the stored name key, which is not a company name.
    await page.getByRole('button', { name: 'Lift Block' }).click();
    const entry = page.getByRole('list', { name: 'Do-not-contact entries' });
    await entry.getByLabel('Reason', { exact: true }).fill('They agreed to be listed');
    await entry.getByLabel(/^Reference/).fill('CASE-205');
    await entry.getByRole('button', { name: 'Lift Block' }).click();
    await expect(page.getByRole('button', { name: 'Block Again' })).toBeVisible();
    expect(w.sent[1]).toMatchObject({ action: 'lift', body: { blockId: 'blk1' } });
    expect(w.sent[1].body.companyName).toBeUndefined();
    expect(w.sent[1].body.country).toBeUndefined();
  });

  test('Enter in the first step of Block a Company goes to the next step instead of saving', async ({
    page,
  }) => {
    const w = await open(page, 'dnc');
    await page.getByText('Block a Company', { exact: true }).click();
    await page.getByRole('radio', { name: 'Not in the catalogue yet' }).check();
    await page.getByLabel('Company name').fill('Acme Imports');
    await page.getByLabel('Country').selectOption('DE');
    await page.getByLabel('Company name').press('Enter');
    await expect(page.getByRole('heading', { name: 'Why?' })).toBeVisible();
    expect(w.sent).toEqual([]);
  });

  test('a full list says that older entries are kept', async ({ page }) => {
    await open(page, 'dnc', {
      blocks: Array.from({ length: 100 }, (_, i) => ({
        id: `b${i}`,
        state: 'BLOCKED',
        organisationId: null,
        organisationName: null,
        nameKey: `acme${i}`,
        country: 'DE',
        reason: 'Asked in writing',
        reference: `CASE-${i}`,
        at: now,
        by: 'u',
        current: true,
      })),
    });
    await expect(
      page.getByText(
        'Showing 100 entries. Companies blocked now come first, and older history is kept.',
      ),
    ).toBeVisible();
  });

  test('an operator is told only an owner or admin can lift a block', async ({ page }) => {
    await open(
      page,
      'dnc',
      {
        blocks: [
          {
            id: 'b1',
            state: 'BLOCKED',
            organisationId: null,
            organisationName: null,
            nameKey: 'acme',
            country: 'DE',
            reason: 'x',
            reference: 'CASE-1',
            at: now,
            by: 'u',
            current: true,
          },
        ],
      },
      'operator',
    );
    await expect(page.getByText('Only an owner or admin can lift a block.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lift Block' })).toHaveCount(0);
  });
});

for (const width of [390, 1440]) {
  test(`axe is clean on the hub, a mission and the do not contact screen at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of ['hub', 'mission', 'dnc']) {
      await open(page, screen);
      await expect(page.locator('main h1')).toHaveCount(1);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(results.violations, screen).toEqual([]);
    }
  });
}
