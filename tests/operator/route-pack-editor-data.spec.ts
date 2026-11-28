import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startP5cFixture } from './p5c-desk-fixture';
import { answerReads, routeIds, type FactsWorld, type World } from './p5c-desk-world';
import {
  answerSheet,
  cleanReport,
  exportName,
  exportText,
  plan,
  savedReport,
  type SheetWorld,
} from './route-pack-sheet-world';
import { standardFieldByKey } from '../../packages/domain/src/route-pack-standard';

// ADR-093 Phase 3, PR 4: Import Route Data, Export Route Data and the History disclosure (docs/revamp/specs/route-pack-editor.md,
// sections 12.1, 12.2, 16 and 8.1 as amended by Guardian G72), measured with the real stylesheets in the desk fixture. The
// sheet requests are answered by the sheet world, which does what the server does unless a test scripts an answer. Red before
// PR 4: none of the controls existed.
let fixture: Awaited<ReturnType<typeof startP5cFixture>>;
test.beforeAll(async () => {
  fixture = await startP5cFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

type Options = {
  role?: string;
  width?: number;
  height?: number;
  facts?: FactsWorld | null;
  sheet?: Partial<SheetWorld>;
  totp?: 'ok' | 'bad';
  /** The route opened; none by default. */
  route?: string;
};
async function open(page: Page, options: Options = {}) {
  const { role = 'owner', width = 1440, height = 900 } = options;
  await page.setViewportSize({ width, height });
  const facts = options.facts === null ? undefined : (options.facts ?? {});
  const given: Partial<World> = { role, ...(facts ? { facts } : {}) };
  if (options.totp) given.totp = options.totp;
  const world = await answerReads(page, given);
  const sheet = await answerSheet(page, options.sheet);
  const words = new URLSearchParams({
    workspace: fixtureTenant,
    v41: 'on',
    role,
    reports: 'on',
    applications: 'on',
  });
  if (options.route) words.set('route', options.route);
  await page.goto(`${fixture.origin}/operator/settings?${words}`);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  if (facts) await expect(routes(page).locator('.route-data-head')).toBeAttached();
  if (options.route) await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
  return { world, sheet };
}
const routes = (page: Page) => page.locator('#workspace-settings .settings-routes');
const editor = (page: Page) => page.locator('section.route-editor');
const button = (scope: Page | ReturnType<Page['locator']>, name: string) =>
  scope.getByRole('button', { name, exact: true });
const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Import Route Data' });
const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export Route Data' });
const stepUpDialog = (page: Page) => page.getByRole('dialog', { name: 'Confirm it is you' });
const headStatus = (page: Page) => routes(page).locator('.route-data-status');
const csvFile = (text = 'route,section\r\nBD-CN,Identity\r\n', name = 'routes.csv') => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
});
async function axeClean(page: Page) {
  const result = await new AxeBuilder({ page }).include('main#main').analyze();
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
}
async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}
async function targets(scope: ReturnType<Page['locator']>, names: string[]) {
  for (const name of names) {
    const box = await scope.getByRole('button', { name, exact: true }).first().boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
}
async function openImport(page: Page) {
  await button(routes(page), 'Import Route Data').click();
  await expect(importDialog(page)).toBeVisible();
}
async function choose(page: Page, file = csvFile()) {
  await importDialog(page).getByLabel('Choose File').setInputFiles(file);
}
async function toReview(page: Page, file = csvFile()) {
  await openImport(page);
  await choose(page, file);
  await expect(
    importDialog(page).getByRole('heading', { name: 'Ready to save 2 routes.' }),
  ).toBeVisible();
}
const reasonBox = (page: Page) => importDialog(page).getByRole('textbox', { name: 'Reason' });
const reasonText = 'Yearly review of the route facts';
async function toSave(page: Page) {
  await toReview(page);
  await button(importDialog(page), 'Next').click();
  await expect(importDialog(page).getByText('Step 4 of 4: Save', { exact: true })).toBeVisible();
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.describe('Import Route Data: the owner', () => {
  test('opens from the Routes list head, checks at once, reviews each route and saves with one reason and one save id', async ({
    page,
  }) => {
    const { sheet } = await open(page, { sheet: { checkDelay: 400, saveDelay: 1500 } });
    await openImport(page);
    const dialog = importDialog(page);
    await expect(dialog.getByText('Step 1 of 4: Choose a file', { exact: true })).toBeVisible();
    await expect(dialog).toContainText(
      'Use a CSV file saved in UTF-8: the template, or an export you changed. Up to 1 MB, 5000 rows and 20 routes.',
    );
    await expect(dialog).toContainText(
      'To copy one route to another, export it, change the route column and import it.',
    );
    await expect(dialog).toContainText(
      'To give one row to several routes, write them in the route cell with | between, for example BD-CN | CN-BD.',
    );
    await expect(dialog.getByLabel('Choose File')).toBeFocused();
    const text = 'route,section\r\nBD-CN,Identity\r\n';
    await choose(page, csvFile(text));
    await expect(dialog.getByText('Step 2 of 4: Check', { exact: true })).toBeFocused();
    // The opener is busy while the check runs, and only then.
    await expect(button(routes(page), 'Import Route Data')).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByText('Checking only. Nothing is saved.')).toBeVisible();
    await expect(dialog.locator('p.sr-only[role="status"]')).toHaveText('Checking the file…');
    await expect(dialog.locator('.route-data')).toHaveAttribute('aria-busy', 'true');
    const ready = dialog.getByRole('heading', { name: 'Ready to save 2 routes.' });
    await expect(ready).toBeFocused();
    await expect(button(routes(page), 'Import Route Data')).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(sheet.bodies).toEqual([{ mode: 'dry-run', csv: text }]);
    await expect(dialog.getByText('Step 3 of 4: Review', { exact: true })).toBeVisible();
    const bdCn = dialog.locator('li.route-data-route').filter({ hasText: 'Bangladesh to China' });
    const cnBd = dialog.locator('li.route-data-route').filter({ hasText: 'China to Bangladesh' });
    await expect(bdCn.getByRole('heading', { level: 4 })).toHaveText('Bangladesh to China');
    await expect(bdCn).not.toContainText('Will be added');
    await expect(cnBd).toContainText('Will be added');
    await expect(bdCn).toContainText('Added 2, changed 1, removed 0');
    await expect(bdCn).toContainText(
      `Pack settings: ${standardFieldByKey.get('pack.languages')!.label}`,
    );
    await expect(bdCn.locator('.route-pack-warning')).toContainText(
      'This publishes pack version 3. Readiness has to be recorded again',
    );
    await expect(bdCn).toContainText('Becomes pack version 3');
    const changes = bdCn.locator('details');
    await expect(changes).not.toHaveAttribute('open', '');
    await changes.locator('summary').click();
    await expect(changes).toContainText('Added: Market notes');
    await expect(changes).toContainText(
      `Changed: ${standardFieldByKey.get('logistics.usual_modes')!.label}`,
    );
    await expect(dialog).toContainText('1 row skipped: new custom fields that are still Pending.');
    await expect(dialog).toContainText(
      'A file never changes a pack status. Every route keeps its status.',
    );
    await expect(dialog).toContainText('A new route starts as Draft, not used yet.');
    await button(dialog, 'Next').click();
    await expect(dialog.getByText('Step 4 of 4: Save', { exact: true })).toBeVisible();
    await expect(reasonBox(page)).toBeFocused();
    // The one-person module is not installed in this world, so its line is not drawn.
    await expect(dialog).not.toContainText('You are proposing and publishing this yourself.');
    await button(dialog, 'Save All Routes').click();
    await expect(dialog.getByText('Give a reason of at least 3 characters.')).toBeVisible();
    expect(sheet.bodies).toHaveLength(1);
    await reasonBox(page).fill(`  ${reasonText}  `);
    await button(dialog, 'Save All Routes').click();
    await expect(dialog.locator('p.sr-only[role="status"]')).toHaveText('Saving 2 routes…');
    await expect(dialog.getByRole('button', { name: 'Saving 2 routes…' })).toBeDisabled();
    await expect(reasonBox(page)).toBeDisabled();
    // Locked while saving: Escape does not close it.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const saved = dialog.getByText('Saved 2 routes, 4 facts.', { exact: true });
    await expect(saved).toBeVisible();
    await expect(saved).toHaveAttribute('role', 'status');
    await expect(saved).toBeFocused();
    expect(sheet.bodies[1]).toEqual({
      mode: 'save',
      csv: text,
      saveId: expect.stringMatching(uuid),
      reason: reasonText,
    });
    await expect(dialog.getByRole('link', { name: 'Open Bangladesh to China' })).toBeVisible();
    await dialog.locator('.route-dialog-actions').getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(headStatus(page)).toHaveText('Saved 2 routes, 4 facts.');
    await expect(headStatus(page)).toBeFocused();
  });

  test('the one-person line shows when the module is installed; Open goes to the first route of the file', async ({
    page,
  }) => {
    await open(page, { facts: { onePerson: true } });
    await toSave(page);
    await expect(importDialog(page)).toContainText(
      'You are proposing and publishing this yourself. Both steps are recorded under your name.',
    );
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await importDialog(page).getByRole('link', { name: 'Open Bangladesh to China' }).click();
    await expect(importDialog(page)).toBeHidden();
    // The route opens once the dialog has closed and returned focus (50 ms later).
    await expect.poll(() => new URL(page.url()).searchParams.get('route')).toBe('BD-CN');
    // Focus goes to the opened route's name, not to the list status line.
    await expect(
      editor(page).getByRole('heading', { level: 2, name: 'Bangladesh to China' }),
    ).toBeFocused();
  });

  test('a wrong file type and a file over 1 MB are refused before any request', async ({
    page,
  }) => {
    const { sheet } = await open(page);
    await openImport(page);
    await choose(page, {
      name: 'routes.xlsx',
      mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from('x'),
    });
    await expect(importDialog(page).getByText('That file is not a CSV.')).toBeVisible();
    await choose(page, csvFile('a'.repeat(1048577)));
    await expect(importDialog(page).getByText('That file is over 1 MB.')).toBeVisible();
    await expect(importDialog(page).getByText('That file is not a CSV.')).toHaveCount(0);
    // PR 4 per G72: "Société" saved in Windows-1252 (é is the byte E9) is not UTF-8 and is refused in the page.
    await choose(page, {
      name: 'routes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9]),
    });
    await expect(
      importDialog(page).getByText('That file is not in UTF-8. Use a CSV file saved in UTF-8.'),
    ).toBeVisible();
    await expect(importDialog(page).getByLabel('Choose File')).toBeFocused();
    expect(sheet.bodies).toEqual([]);
    await expect(importDialog(page).getByText('Step 1 of 4: Choose a file')).toBeVisible();
    // Recovery: a CSV is then checked.
    await choose(page);
    await expect(
      importDialog(page).getByRole('heading', { name: 'Ready to save 2 routes.' }),
    ).toBeVisible();
    expect(sheet.bodies).toHaveLength(1);
  });

  test('problems: ordered by row with route and field label, first 20 then all, a problem list file, no way on, nothing saved', async ({
    page,
  }) => {
    const errors = Array.from({ length: 25 }, (_, i) => ({
      row: 40 - i,
      route: 'BD-CN',
      key: 'pack.languages',
      message: 'use language tags such as en or bn.',
    }));
    const { sheet } = await open(page, {
      sheet: {
        checkScript: [
          {
            status: 200,
            body: {
              ...cleanReport(),
              ok: false,
              errors: [
                { row: null, route: null, key: null, message: 'A file problem.' },
                ...errors,
              ],
            },
          },
        ],
      },
    });
    await openImport(page);
    await choose(page);
    const dialog = importDialog(page);
    const heading = dialog.getByRole('heading', {
      name: '26 problems in 25 rows. Nothing is saved while any problem remains.',
    });
    await expect(heading).toBeFocused();
    const items = dialog.locator('ol.route-data-problems > li');
    await expect(items.first()).toBeVisible();
    await expect(items).toHaveCount(20);
    await expect(items.nth(0)).toHaveText('A file problem.');
    const label = standardFieldByKey.get('pack.languages')!.label;
    await expect(items.nth(1)).toHaveText(
      `Row 16, BD-CN, ${label}: use language tags such as en or bn.`,
    );
    const all = button(dialog, 'Show all 26 problems');
    await expect(all).toHaveAttribute('aria-expanded', 'false');
    await all.click();
    await expect(items).toHaveCount(26);
    await expect(all).toHaveCount(0);
    const download = page.waitForEvent('download');
    await button(dialog, 'Download Problem List').click();
    expect((await download).suggestedFilename()).toBe('route-pack-problems.csv');
    await expect(button(dialog, 'Next')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Continue/ })).toHaveCount(0);
    await expect(button(dialog, 'Save All Routes')).toHaveCount(0);
    expect(sheet.bodies.map((body) => body.mode)).toEqual(['dry-run']);
    await button(dialog, 'Choose Another File').click();
    await expect(dialog.getByText('Step 1 of 4: Choose a file')).toBeVisible();
    await expect(dialog.getByLabel('Choose File')).toBeFocused();
  });

  test('a file problem the server refuses as a whole is one problem in its words', async ({
    page,
  }) => {
    await open(page, {
      sheet: {
        checkScript: [
          {
            status: 413,
            body: { error: 'The file is larger than 1 MiB. Split it into smaller files.' },
          },
        ],
      },
    });
    await openImport(page);
    await choose(page);
    await expect(
      importDialog(page).getByRole('heading', {
        name: '1 problem. Nothing is saved while any problem remains.',
      }),
    ).toBeVisible();
    await expect(importDialog(page).locator('ol.route-data-problems > li')).toHaveText([
      'The file is larger than 1 MiB. Split it into smaller files.',
    ]);
  });

  test('a check that did not finish says so; Try Again checks the same file and goes on', async ({
    page,
  }) => {
    const { sheet } = await open(page, { sheet: { checkScript: [{ status: 500 }] } });
    await openImport(page);
    await choose(page);
    const alert = importDialog(page).getByRole('alert');
    await expect(alert).toHaveText('The check did not finish. Your file was not used. Try again.');
    await expect(alert).toBeFocused();
    await expect(button(importDialog(page), 'Choose Another File')).toBeVisible();
    await button(importDialog(page), 'Try Again').click();
    await expect(
      importDialog(page).getByRole('heading', { name: 'Ready to save 2 routes.' }),
    ).toBeVisible();
    expect(sheet.bodies).toHaveLength(2);
    expect(sheet.bodies[1]).toEqual(sheet.bodies[0]);
  });

  test('Cancel before the save discards the file; the dialog opens again at step 1 and focus returns to the opener', async ({
    page,
  }) => {
    const { sheet } = await open(page);
    await toReview(page);
    await button(importDialog(page), 'Cancel').click();
    await expect(importDialog(page)).toBeHidden();
    await expect(button(routes(page), 'Import Route Data')).toBeFocused();
    await openImport(page);
    await expect(importDialog(page).getByText('Step 1 of 4: Choose a file')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(importDialog(page)).toBeHidden();
    expect(sheet.bodies.filter((body) => body.mode === 'save')).toEqual([]);
  });
});

test.describe('Import Route Data: the save answers', () => {
  test('the authenticator check opens in place and the same body is sent again; closing it keeps the reason and the save id', async ({
    page,
  }) => {
    const { sheet } = await open(page, {
      sheet: {
        saveScript: [
          { status: 401, body: { error: 'Confirm', code: 'STEP_UP_REQUIRED' } },
          { status: 401, body: { error: 'Confirm', code: 'STEP_UP_REQUIRED' } },
        ],
      },
    });
    await toSave(page);
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await stepUpDialog(page).getByRole('button', { name: 'Not now' }).click();
    await expect(importDialog(page).getByRole('alert')).toHaveText(
      'Confirm your authenticator code to finish this. Your changes are kept.',
    );
    await expect(reasonBox(page)).toHaveValue(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await stepUpDialog(page).getByLabel('Six-digit code').fill('123456');
    await stepUpDialog(page).getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(
      importDialog(page).getByText('Saved 2 routes, 4 facts.', { exact: true }),
    ).toBeVisible();
    const saves = sheet.bodies.filter((body) => body.mode === 'save');
    expect(saves).toHaveLength(3);
    for (const body of saves) expect(body).toEqual(saves[0]);
  });

  test('part way: facts saved and a pack step not reached are told apart, the dialog survives a failed list read, and Try the Rest Again sends the same save id', async ({
    page,
  }) => {
    const pack = {
      changed: true,
      changedFields: ['languages'],
      status: 'ACTIVE' as const,
      nextVersion: 2,
    };
    const report = cleanReport();
    report.routes.push(plan('EU-BD', { pack }));
    // The server writes every route's facts first, then the packs: it stopped at Bangladesh to China's pack.
    const partWay = {
      ...report,
      mode: 'save',
      ok: false,
      errors: [
        {
          row: null,
          route: 'BD-CN',
          key: null,
          message: 'Saving this route stopped. Save the same file again to finish.',
        },
      ],
      saved: [
        { route: 'BD-CN', routeId: 'a', contentVersion: 6, packVersion: null },
        { route: 'CN-BD', routeId: 'b', contentVersion: 1, packVersion: null },
        { route: 'EU-BD', routeId: 'c', contentVersion: 1, packVersion: null },
      ],
    };
    // The second send plans again against the state the first left: only the two pack steps are left.
    const rest = savedReport({
      ...report,
      routes: report.routes.map((item) => ({
        ...item,
        willBeAdded: false,
        content: { ...item.content, changed: false, added: [], updated: [] },
      })),
    });
    const { sheet, world } = await open(page, {
      sheet: {
        report,
        saveScript: [
          { status: 409, body: { error: 'Stopped', report: partWay } },
          { status: 201, body: rest },
        ],
      },
    });
    await openImport(page);
    await choose(page);
    await button(importDialog(page), 'Next').click();
    await reasonBox(page).fill(reasonText);
    // The list read after the partial save fails: the dialog, its file and its save id stay (spec 12.1).
    world.facts!.overview = 500;
    await button(importDialog(page), 'Save All Routes').click();
    const alert = importDialog(page).getByRole('alert');
    await expect(alert).toHaveText('Saved 1 of 3 routes.');
    await expect(alert).toBeFocused();
    await expect(importDialog(page).locator('ul.route-data-problems > li')).toHaveText([
      'Bangladesh to China: facts saved. Saving this route stopped. Save the same file again to finish.',
      'European Union to Bangladesh: facts saved; pack setting not tried.',
    ]);
    await expect(importDialog(page)).not.toContainText('Not saved');
    await expect
      .poll(() => world.asked.filter((line) => line.includes('mission-catalogue')).length)
      .toBeGreaterThan(1);
    await page.waitForTimeout(300);
    await expect(importDialog(page)).toBeVisible();
    await expect(headStatus(page)).toHaveText('');
    await button(importDialog(page), 'Try the Rest Again').click();
    await expect(
      importDialog(page).getByText('Saved 3 routes, 5 facts.', { exact: true }),
    ).toBeVisible();
    const saves = sheet.bodies.filter((body) => body.mode === 'save');
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual(saves[0]);
  });

  test('a route changed meanwhile after an earlier route saved: the earlier route, the changed one and a later Not tried one, with Try the Rest Again', async ({
    page,
  }) => {
    const report = cleanReport();
    report.routes.push(plan('EU-BD'));
    const changed = {
      ...report,
      mode: 'save',
      ok: false,
      errors: [
        {
          row: null,
          route: 'CN-BD',
          key: null,
          code: 'ROUTE_PACK_CONTENT_CHANGED',
          message: "This route's content changed since you opened it. Reload and try again.",
        },
      ],
      saved: [{ route: 'BD-CN', routeId: 'a', contentVersion: 6, packVersion: 3 }],
    };
    const { sheet } = await open(page, {
      sheet: {
        report,
        saveScript: [
          { status: 409, body: { error: 'Changed', report: changed } },
          {
            status: 201,
            // Planned again: Bangladesh to China has nothing left to write.
            body: savedReport({
              ...report,
              routes: report.routes.map((item) =>
                item.route === 'BD-CN'
                  ? {
                      ...item,
                      content: { ...item.content, changed: false, added: [], updated: [] },
                      pack: { ...item.pack, changed: false, nextVersion: null },
                    }
                  : item,
              ),
            }),
          },
        ],
      },
    });
    await openImport(page);
    await choose(page);
    await button(importDialog(page), 'Next').click();
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(importDialog(page).getByRole('alert')).toHaveText(
      'Saved 1 of 3 routes. Not saved: China to Bangladesh, European Union to Bangladesh.',
    );
    await expect(importDialog(page).locator('ul.route-data-problems > li')).toHaveText([
      'China to Bangladesh changed while you were checking. It was not saved. Choose the file again to check it against the current state.',
      'European Union to Bangladesh: Not tried, because the save stopped before it.',
    ]);
    await expect(button(importDialog(page), 'Choose Another File')).toBeVisible();
    await button(importDialog(page), 'Try the Rest Again').click();
    await expect(
      importDialog(page).getByText('Saved 3 routes, 5 facts.', { exact: true }),
    ).toBeVisible();
    const saves = sheet.bodies.filter((body) => body.mode === 'save');
    expect(saves[1]).toEqual(saves[0]);
  });

  test("a pack changed after the route's facts were written says the facts were saved; an unnamed change after a write never says nothing was saved", async ({
    page,
  }) => {
    const pack = {
      changed: true,
      changedFields: ['languages'],
      status: 'ACTIVE' as const,
      nextVersion: 2,
    };
    const report = cleanReport();
    report.routes[1] = plan('CN-BD', { pack });
    report.routes.push(plan('EU-BD'));
    const factsThenPack = {
      ...report,
      mode: 'save',
      ok: false,
      errors: [
        {
          row: null,
          route: 'CN-BD',
          key: null,
          code: 'ROUTE_PACK_PACK_CHANGED',
          message: "This route's pack changed since you opened it. Reload and try again.",
        },
      ],
      saved: [
        { route: 'BD-CN', routeId: 'a', contentVersion: 6, packVersion: 3 },
        { route: 'CN-BD', routeId: 'b', contentVersion: 1, packVersion: null },
        { route: 'EU-BD', routeId: 'c', contentVersion: 1, packVersion: null },
      ],
    };
    const unnamed = {
      ...factsThenPack,
      errors: [{ ...factsThenPack.errors[0]!, route: null, code: 'ROUTE_PACK_CONTENT_CHANGED' }],
    };
    const { sheet } = await open(page, {
      sheet: {
        report,
        saveScript: [
          { status: 409, body: { error: 'Changed', report: factsThenPack } },
          { status: 409, body: { error: 'Changed', report: unnamed } },
          { status: 409, body: { error: 'Changed', code: 'ROUTE_PACK_CONTENT_CHANGED' } },
        ],
      },
    });
    await openImport(page);
    await choose(page);
    await button(importDialog(page), 'Next').click();
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(importDialog(page).getByRole('alert')).toHaveText('Saved 2 of 3 routes.');
    await expect(importDialog(page).locator('ul.route-data-problems > li')).toHaveText([
      'China to Bangladesh: facts saved. The pack setting was not saved because it changed while you were checking.',
    ]);
    await button(importDialog(page), 'Try the Rest Again').click();
    const alert = importDialog(page).getByRole('alert');
    await expect(alert).toHaveText(
      'A route changed while you were checking. Choose the file again to check it against the current state.',
    );
    await expect(alert).not.toContainText('Nothing was saved');
    // With no report (nothing written), the server named no route: then nothing was saved, and the words say so.
    await button(importDialog(page), 'Choose Another File').click();
    await expect(importDialog(page).getByText('Step 1 of 4: Choose a file')).toBeVisible();
    await choose(page);
    await button(importDialog(page), 'Next').click();
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(importDialog(page).getByRole('alert')).toHaveText(
      'A route changed while you were checking. Nothing was saved. Choose the file again to check it against the current state.',
    );
    const saves = sheet.bodies.filter((body) => body.mode === 'save');
    expect(saves[1]!.saveId).toBe(saves[0]!.saveId);
    expect(saves[2]!.saveId).not.toBe(saves[0]!.saveId);
  });

  test('a save that wrote nothing says Nothing left to save; owner refusals and server words; problems on re-plan go back to the check step', async ({
    page,
  }) => {
    const empty = { ...savedReport(cleanReport()), saved: [] };
    const { sheet } = await open(page, {
      sheet: {
        saveScript: [
          { status: 403, body: { error: 'Access denied' } },
          {
            status: 413,
            body: { error: 'The file is larger than 1 MiB. Split it into smaller files.' },
          },
          { status: 201, body: empty },
        ],
      },
    });
    await toSave(page);
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(importDialog(page).getByRole('alert')).toHaveText(
      'This save was refused. Only the owner can save a route file.',
    );
    await expect(importDialog(page)).not.toContainText('You can check it here');
    await button(importDialog(page), 'Save All Routes').click();
    await expect(importDialog(page).getByRole('alert')).toHaveText(
      'The file is larger than 1 MiB. Split it into smaller files.',
    );
    await button(importDialog(page), 'Save All Routes').click();
    await expect(
      importDialog(page).getByText(
        'Nothing left to save. An earlier try may already have saved these facts; see History.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(sheet.bodies.filter((body) => body.mode === 'save')).toHaveLength(3);
    // Problems found when the save plans again belong to the check step.
    await importDialog(page)
      .locator('.route-dialog-actions')
      .getByRole('button', { name: 'Close' })
      .click();
    sheet.saveScript = [
      {
        status: 409,
        body: {
          error: 'Fix the errors in the dry run first',
          report: {
            ...cleanReport(),
            mode: 'save',
            ok: false,
            errors: [
              { row: 1240, route: 'BD-CN', key: null, message: 'Write dates as YYYY-MM-DD.' },
            ],
          },
        },
      },
    ];
    await toSave(page);
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(
      importDialog(page).getByRole('heading', {
        name: '1 problem in 1 row. Nothing is saved while any problem remains.',
      }),
    ).toBeFocused();
    await expect(importDialog(page).getByText('Step 2 of 4: Check', { exact: true })).toBeVisible();
    await expect(importDialog(page).getByText('Step 4 of 4: Save')).toHaveCount(0);
    await expect(importDialog(page).locator('ol.route-data-problems > li')).toHaveText([
      'Row 1240, BD-CN: Write dates as YYYY-MM-DD.',
    ]);
  });

  test('a save that fails keeps the file; Try Again sends the same save id and saves', async ({
    page,
  }) => {
    const { sheet } = await open(page, { sheet: { saveScript: [{ status: 500 }] } });
    await toSave(page);
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(importDialog(page).getByRole('alert')).toHaveText(
      'Not saved. Your file is still here. Try again.',
    );
    await expect(reasonBox(page)).toHaveValue(reasonText);
    await button(importDialog(page), 'Try Again').click();
    await expect(
      importDialog(page).getByText('Saved 2 routes, 4 facts.', { exact: true }),
    ).toBeVisible();
    const saves = sheet.bodies.filter((body) => body.mode === 'save');
    expect(saves[1]).toEqual(saves[0]);
  });

  test('a save with no fact changed says so', async ({ page }) => {
    const report = cleanReport();
    for (const route of report.routes)
      route.content = { ...route.content, changed: false, added: [], updated: [] };
    await open(page, {
      sheet: { report, saveScript: [{ status: 201, body: savedReport(report) }] },
    });
    await toSave(page);
    await reasonBox(page).fill(reasonText);
    await button(importDialog(page), 'Save All Routes').click();
    await expect(
      importDialog(page).getByText('Saved 2 routes. No fact changed.', { exact: true }),
    ).toBeVisible();
  });
});

test.describe('Import Route Data: the admin', () => {
  test('checks and reviews; the save is off with its reason in words, no reason field and no save request', async ({
    page,
  }) => {
    const { sheet } = await open(page, { role: 'admin' });
    await toSave(page);
    const save = button(importDialog(page), 'Save All Routes');
    await expect(save).toBeDisabled();
    const lock = importDialog(page).getByText(
      'Only the owner can save a route file. You can check it here and nothing is saved.',
    );
    await expect(lock).toBeVisible();
    expect(await save.getAttribute('aria-describedby')).toBe(
      await lock.locator('..').getAttribute('id'),
    );
    await expect(reasonBox(page)).toHaveCount(0);
    await expect(stepUpDialog(page)).toHaveCount(0);
    expect(sheet.bodies.map((body) => body.mode)).toEqual(['dry-run']);
    await button(importDialog(page), 'Back').click();
    await expect(
      importDialog(page).getByRole('heading', { name: 'Ready to save 2 routes.' }),
    ).toBeFocused();
  });
});

test.describe('Export Route Data', () => {
  test('from the list head every route is ticked; the download is named by its date and the page says so', async ({
    page,
  }) => {
    const { sheet } = await open(page, { sheet: { exportDelay: 400 } });
    await button(routes(page), 'Export Route Data').click();
    const dialog = exportDialog(page);
    await expect(dialog).toContainText(
      'One CSV file in UTF-8, which any spreadsheet opens. Every standard field is listed, including the ones still Pending, so the gaps show. Each fact has its source and date.',
    );
    const boxes = dialog.getByRole('group', { name: 'Routes' }).getByRole('checkbox');
    await expect(boxes.first()).toBeFocused();
    await expect(boxes).toHaveCount(3);
    for (const name of [
      'Bangladesh to China',
      'Bangladesh to European Union',
      'Taiwan to Australia',
    ])
      await expect(dialog.getByRole('checkbox', { name })).toBeChecked();
    await expect(dialog).not.toContainText('version');
    const download = page.waitForEvent('download');
    await button(dialog, 'Download CSV').click();
    await expect(dialog.getByRole('button', { name: 'Preparing the file…' })).toBeDisabled();
    await expect(button(routes(page), 'Export Route Data')).toHaveAttribute('aria-busy', 'true');
    const file = await download;
    expect(file.suggestedFilename()).toBe(exportName);
    // PR 4 per G72: the bytes as the server sent them, the byte order mark and every character beyond ASCII included.
    const bytes = readFileSync((await file.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toBe(exportText);
    expect(bytes.toString('utf8')).toContain('Société বাংলা');
    await expect(button(routes(page), 'Export Route Data')).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(dialog).toBeHidden();
    await expect(headStatus(page)).toHaveText(`Downloaded ${exportName} with 3 routes.`);
    await expect(headStatus(page)).toBeFocused();
    expect(sheet.exports).toEqual(['BD-CN|BD-EU|TW-AU']);
  });

  test('none ticked keeps Download CSV off with its reason; a failed file says so and Try Again recovers', async ({
    page,
  }) => {
    const { sheet } = await open(page, { sheet: { exportScript: [{ status: 500 }] } });
    await button(routes(page), 'Export Route Data').click();
    const dialog = exportDialog(page);
    for (const box of await dialog.getByRole('checkbox').all()) await box.uncheck();
    await expect(button(dialog, 'Download CSV')).toBeDisabled();
    await expect(dialog.getByText('Choose at least one route.')).toBeVisible();
    expect(sheet.exports).toEqual([]);
    await dialog.getByRole('checkbox', { name: 'Taiwan to Australia' }).check();
    await button(dialog, 'Download CSV').click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toHaveText('The file could not be made. Nothing was changed. Try again.');
    await expect(alert).toBeFocused();
    const download = page.waitForEvent('download');
    await button(dialog, 'Try Again').click();
    await download;
    await expect(headStatus(page)).toHaveText(`Downloaded ${exportName} with 1 route.`);
    expect(sheet.exports).toEqual(['TW-AU', 'TW-AU']);
  });

  test('more than 20 routes ticked keeps Download CSV off, with the reason in words just before it', async ({
    page,
  }) => {
    const { sheet } = await open(page, { sheet: { manyRoutes: 21 } });
    await button(routes(page), 'Export Route Data').click();
    const dialog = exportDialog(page);
    await expect(dialog.getByRole('checkbox')).toHaveCount(21);
    const download = button(dialog, 'Download CSV');
    await expect(download).toBeDisabled();
    const reason = dialog.getByText('Export at most 20 routes at a time.', { exact: true });
    await expect(reason).toBeVisible();
    expect(await download.getAttribute('aria-describedby')).toBe(await reason.getAttribute('id'));
    // The reason stands before the buttons, so it is read before the button it explains.
    expect(
      await reason.evaluate((node) => {
        const actions = node.parentElement!.querySelector('.route-dialog-actions')!;
        return !!(node.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
    await dialog.getByRole('checkbox').first().uncheck();
    await expect(download).toBeEnabled();
    await expect(reason).toHaveCount(0);
    expect(sheet.exports).toEqual([]);
  });

  for (const role of ['owner', 'admin'])
    test(`${role}: More holds Export This Route first, with only the open route ticked`, async ({
      page,
    }) => {
      const { sheet } = await open(page, { role, route: 'BD-CN' });
      const more = editor(page).getByRole('button', {
        name: 'More actions for Bangladesh to China',
      });
      await more.click();
      const first = editor(page).getByRole('menu').getByRole('menuitem').first();
      await expect(first).toHaveText('Export This Route');
      await first.click();
      const dialog = exportDialog(page);
      await expect(dialog.getByRole('checkbox', { name: 'Bangladesh to China' })).toBeChecked();
      await expect(
        dialog.getByRole('checkbox', { name: 'Bangladesh to European Union' }),
      ).not.toBeChecked();
      await button(dialog, 'Cancel').click();
      await expect(more).toBeFocused();
      await more.click();
      await editor(page).getByRole('menuitem', { name: 'Export This Route' }).click();
      const download = page.waitForEvent('download');
      await button(dialog, 'Download CSV').click();
      await download;
      const status = editor(page).locator('.route-editor-status');
      await expect(status).toHaveText(`Downloaded ${exportName} with 1 route.`);
      await expect(status).toBeFocused();
      expect(sheet.exports).toEqual(['BD-CN']);
    });

  test('the admin has Import and Export at the list head; with the module off neither is drawn', async ({
    page,
  }) => {
    await open(page, { role: 'admin' });
    await expect(button(routes(page), 'Import Route Data')).toBeVisible();
    await expect(button(routes(page), 'Export Route Data')).toBeVisible();
    await open(page, { facts: null });
    await expect(routes(page)).toBeVisible();
    await expect(button(page, 'Import Route Data')).toHaveCount(0);
    await expect(button(page, 'Export Route Data')).toHaveCount(0);
  });
});

test.describe('History', () => {
  test('closed at the foot; opening it reads the fact versions once: who, when and the reason, the last 5 and Show all', async ({
    page,
  }) => {
    const { sheet } = await open(page, { route: 'BD-CN' });
    const history = editor(page).locator('details.route-history');
    await expect(history).not.toHaveAttribute('open', '');
    expect(sheet.factReads).toEqual([]);
    await history.locator('summary').click();
    const facts = history.locator('ul').first();
    await expect(history.getByText('Version 6, 26 Nov 2026, by you')).toBeVisible();
    expect(sheet.factReads).toEqual([routeIds.bdCn]);
    await expect(history.getByRole('heading', { name: 'Route facts' })).toBeVisible();
    await expect(facts.locator('li:visible')).toHaveCount(5);
    await expect(facts.locator('li').first()).toHaveText(
      'Version 6, 26 Nov 2026, by youSample reason for version 6',
    );
    await expect(facts.locator('li').nth(1)).toContainText('Version 5, 25 Nov 2026, by a teammate');
    await expect(facts.locator('li').nth(2)).toContainText('No reason recorded.');
    await button(history, 'Show all 6 fact versions').click();
    await expect(facts.locator('li:visible')).toHaveCount(6);
    await expect(history.getByRole('heading', { name: 'Pack versions' })).toBeVisible();
    const pack = history.locator('ul').nth(1).locator('li').first();
    await expect(pack).toContainText(
      'Pack version 2, proposed and published by you, effective 20 Nov 2026',
    );
    await expect(pack).toContainText('Sample pack change for the route editor');
    // Closed and opened again, it reads nothing more.
    await history.locator('summary').click();
    await expect(history).not.toHaveAttribute('open', '');
    await history.locator('summary').click();
    await expect(history.getByText('Version 6, 26 Nov 2026, by you')).toBeVisible();
    await page.waitForTimeout(200);
    expect(sheet.factReads).toHaveLength(1);
    await expect(history.getByRole('button')).toHaveCount(1);
  });

  test('the admin reads the pack versions; a failed fact read and a failed pack read each say so', async ({
    page,
  }) => {
    await open(page, {
      role: 'admin',
      route: 'BD-EU',
      facts: { packHistory: 500 },
      sheet: { factHistory: 500 },
    });
    const history = editor(page).locator('details.route-history');
    await history.locator('summary').click();
    await expect(history).toContainText('History is not available.');
    await expect(history).toContainText('Pack history is not available.');
  });

  test('the admin reads pack rows: one that did not go through review, and one proposed by one team member and published by another', async ({
    page,
  }) => {
    await open(page, { role: 'admin', route: 'BD-CN', facts: { unreviewedPack: true } });
    let history = editor(page).locator('details.route-history');
    await history.locator('summary').click();
    const unreviewed = history.locator('ul').nth(1).locator('li').first();
    await expect(unreviewed).toContainText(
      'Pack version 2, effective 20 Nov 2026. This change did not go through review, so no proposer is recorded.',
    );
    await expect(unreviewed.locator('.route-history-reason')).toHaveText(
      'Not recorded through review.',
    );
    await open(page, { role: 'admin', route: 'BD-EU' });
    history = editor(page).locator('details.route-history');
    await history.locator('summary').click();
    const split = history.locator('ul').nth(1).locator('li').first();
    await expect(split).toContainText(
      'Pack version 1, proposed by one team member, published by another, effective 19 Nov 2026',
    );
    await expect(split.locator('.route-history-reason')).toHaveText('No reason recorded.');
  });

  test('History says it is loading; a failed fact read offers Try Again, and is read again when History is opened again', async ({
    page,
  }) => {
    const { sheet } = await open(page, {
      route: 'BD-CN',
      sheet: { factHistory: 500, factDelay: 600 },
    });
    const history = editor(page).locator('details.route-history');
    await history.locator('summary').click();
    await expect(history.getByRole('status')).toHaveText('Loading history…');
    await expect(history).toContainText('History is not available.');
    sheet.factHistory = 200;
    sheet.factDelay = 0;
    await button(history, 'Try Again').click();
    await expect(history.getByText('Version 6, 26 Nov 2026, by you')).toBeVisible();
    expect(sheet.factReads).toHaveLength(2);
    // A second page: the read fails, History is closed and opened again, and it is read again.
    const again = await open(page, { route: 'BD-CN', sheet: { factHistory: 500 } });
    const second = editor(page).locator('details.route-history');
    await second.locator('summary').click();
    await expect(second).toContainText('History is not available.');
    again.sheet.factHistory = 200;
    await second.locator('summary').click();
    await second.locator('summary').click();
    await expect(second.getByText('Version 6, 26 Nov 2026, by you')).toBeVisible();
    expect(again.sheet.factReads).toHaveLength(2);
  });

  test('a role refused the pack history sees no pack versions; with nothing recorded it says No history yet.', async ({
    page,
  }) => {
    await open(page, { route: 'TW-AU', facts: { packHistory: 403 }, sheet: { versions: [] } });
    const history = editor(page).locator('details.route-history');
    await history.locator('summary').click();
    await expect(history).toContainText('No history yet.');
    await expect(history.getByRole('heading', { name: 'Pack versions' })).toHaveCount(0);
  });
});

test.describe('layout and accessibility', () => {
  for (const width of [320, 390, 768, 1024, 1440, 1920])
    test(`each step is axe clean with no sideways scroll at ${width}`, async ({ page }) => {
      const height = width === 320 ? 568 : 900;
      const { sheet } = await open(page, { width, height, route: 'BD-CN' });
      await noSidewaysScroll(page);
      await axeClean(page);
      // The list folds below 56 rem of region; its head is then in the fold.
      const fold = page.locator('.settings-routes-fold > summary');
      if (await fold.isVisible()) await fold.click();
      await expect(button(routes(page), 'Import Route Data')).toBeVisible();
      if (width < 1024) await targets(routes(page), ['Import Route Data', 'Export Route Data']);
      await openImport(page);
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024) {
        await targets(importDialog(page), ['Download Blank Template', 'Cancel']);
        const file = await importDialog(page).locator('label.route-data-file').boundingBox();
        expect(file!.height, 'Choose File height').toBeGreaterThanOrEqual(44);
      }
      await choose(page);
      await expect(
        importDialog(page).getByRole('heading', { name: 'Ready to save 2 routes.' }),
      ).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024)
        await targets(importDialog(page), ['Next', 'Choose Another File', 'Cancel']);
      await button(importDialog(page), 'Next').click();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width === 390 || width === 1440)
        await page.screenshot({ path: `test-results/route-pack-import-${width}.png` });
      // Part way, then saved.
      sheet.saveScript = [
        {
          status: 409,
          body: {
            error: 'Stopped',
            report: {
              ...savedReport(cleanReport()),
              ok: false,
              errors: [
                { row: null, route: 'CN-BD', key: null, message: 'Saving this route stopped.' },
              ],
              saved: [{ route: 'BD-CN', routeId: 'a', contentVersion: 6, packVersion: 3 }],
            },
          },
        },
      ];
      await reasonBox(page).fill(reasonText);
      await button(importDialog(page), 'Save All Routes').click();
      await expect(button(importDialog(page), 'Try the Rest Again')).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      await button(importDialog(page), 'Try the Rest Again').click();
      await expect(importDialog(page).getByText(/^Saved 2 routes/)).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      await importDialog(page)
        .locator('.route-dialog-actions')
        .getByRole('button', { name: 'Close' })
        .click();
      // Problems.
      sheet.checkScript = [
        {
          status: 200,
          body: {
            ...cleanReport(),
            ok: false,
            errors: Array.from({ length: 22 }, (_, i) => ({
              row: i + 2,
              route: 'BD-CN',
              key: 'pack.languages',
              message: 'use language tags such as en or bn.',
            })),
          },
        },
      ];
      await openImport(page);
      await choose(page);
      await expect(importDialog(page).locator('ol.route-data-problems > li').first()).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024)
        await targets(importDialog(page), ['Choose Another File', 'Download Problem List']);
      await page.keyboard.press('Escape');
      await expect(importDialog(page)).toBeHidden();
      await button(routes(page), 'Export Route Data').click();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024) await targets(exportDialog(page), ['Download CSV', 'Cancel']);
      await button(exportDialog(page), 'Cancel').click();
      // The More export row.
      await editor(page)
        .getByRole('button', { name: /^More actions for / })
        .click();
      await expect(editor(page).getByRole('menuitem', { name: 'Export This Route' })).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      await page.keyboard.press('Escape');
      const history = editor(page).locator('details.route-history');
      await history.locator('summary').click();
      await expect(history.getByText('Version 6, 26 Nov 2026, by you')).toBeVisible();
      await button(history, 'Show all 6 fact versions').click();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024) {
        const box = await history.locator('summary').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 390 || width === 1440)
        await page.screenshot({ path: `test-results/route-pack-history-${width}.png` });
    });

  test('keyboard: the whole import path works from the keyboard', async ({ page }) => {
    await open(page);
    await button(routes(page), 'Import Route Data').focus();
    await page.keyboard.press('Enter');
    await expect(importDialog(page).getByLabel('Choose File')).toBeFocused();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await (await chooser).setFiles(csvFile());
    await expect(
      importDialog(page).getByRole('heading', { name: 'Ready to save 2 routes.' }),
    ).toBeFocused();
    await button(importDialog(page), 'Next').focus();
    await page.keyboard.press('Enter');
    await expect(reasonBox(page)).toBeFocused();
    await page.keyboard.type(reasonText);
    await button(importDialog(page), 'Save All Routes').focus();
    await page.keyboard.press('Enter');
    await expect(
      importDialog(page).getByText('Saved 2 routes, 4 facts.', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(importDialog(page)).toBeHidden();
  });
});
