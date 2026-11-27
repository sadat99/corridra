import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startP5cFixture } from './p5c-desk-fixture';
import { answerReads, routeIds, type FactsWorld, type World } from './p5c-desk-world';
import {
  routePackSections,
  standardFieldByKey,
  type ContentDocument,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';

// ADR-093 Phase 3, PR 2c: the More menu of the route header and its two dialogs (docs/revamp/specs/route-pack-editor.md, sections
// 8.1, 8.6, 8.8 and 9), measured with the real stylesheets in the desk fixture. A mark and a custom field are staged like any
// other edit and saved with the facts in the one Save Route Facts body. The world answers the reads and the one write as the
// server does; every count and label is taken from the standard or from what the world was built to hold.
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
  facts?: FactsWorld;
  query?: string;
};
async function open(page: Page, options: Options = {}) {
  const { role = 'owner', width = 1440, height = 900, query = 'route=BD-CN' } = options;
  await page.setViewportSize({ width, height });
  const world = await answerReads(page, { role, facts: options.facts ?? {} });
  const words = new URLSearchParams({
    workspace: fixtureTenant,
    v41: 'on',
    role,
    reports: 'on',
    applications: 'on',
  });
  for (const [name, value] of new URLSearchParams(query)) words.set(name, value);
  await page.goto(`${fixture.origin}/operator/settings?${words}`);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  if (!query.includes('view=sections')) await expect(rows(page).first()).toBeVisible();
  else await expect(editor(page).locator('.route-editor-sections')).toBeVisible();
  return world;
}
const editor = (page: Page) => page.locator('section.route-editor');
const rows = (page: Page) => editor(page).locator('li.ux-fact-row');
const rowOf = (page: Page, label: string) => rows(page).filter({ hasText: label }).first();
const bar = (page: Page) => page.getByRole('group', { name: 'Unsaved changes' });
const status = (page: Page) => editor(page).locator('.route-editor-status');
const routeName = 'Bangladesh to China';
const moreButton = (page: Page, route = routeName) =>
  editor(page).getByRole('button', { name: `More actions for ${route}`, exact: true });
const menu = (page: Page, route = routeName) =>
  page.getByRole('menu', { name: `More actions for ${route}`, exact: true });
const item = (page: Page, name: string, route = routeName) =>
  menu(page, route).getByRole('menuitem', { name, exact: true });
const nameOf = (section: number) => routePackSections.find((s) => s.number === section)!.name;
const markName = (section: number) => `Mark Section Not Applicable, ${nameOf(section)}`;
const unmarkName = (section: number) => `Unmark Section, ${nameOf(section)}`;
const markDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Mark Section Not Applicable' });
const customDialog = (page: Page) => page.getByRole('dialog', { name: 'Add Custom Field' });
const saveDialog = (page: Page) => page.getByRole('dialog', { name: 'Save Route Facts' });
const discardDialog = (page: Page) => page.getByRole('dialog', { name: 'Discard Changes' });
const stageKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) =>
      key.startsWith('corridra:route-pack-stage:'),
    ),
  );
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
async function box(locator: Locator) {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}
async function choose(page: Page, name: string, route = routeName) {
  await moreButton(page, route).click();
  await item(page, name, route).click();
}
/** The document the world holds for a route now, read through the same mocked route the page uses. */
async function savedDocument(page: Page, routeId = routeIds.bdCn) {
  return page.evaluate(
    async ({ id, tenant }) => {
      const response = await fetch(
        `/api/team-control/route-pack-overview?${new URLSearchParams({ tenant, routeId: id })}`,
      );
      const body = (await response.json()) as {
        route: { content: { version: number; document: ContentDocument } };
      };
      return body.route.content;
    },
    { id: routeId, tenant: fixtureTenant },
  );
}
const saveReason = 'Checked the section with the trade office';
async function saveAll(page: Page, count: number) {
  await bar(page)
    .getByRole('button', { name: `Review and Save (${count})` })
    .click();
  await saveDialog(page).getByRole('textbox', { name: 'Reason' }).fill(saveReason);
  await saveDialog(page).getByRole('button', { name: 'Save Facts' }).click();
}
type Sent = { id: string; version: number; reason: string; document: ContentDocument };
const sentOf = (world: World, index = 0) => world.saves[index]!.body as Sent;
const markNote = 'No trade fairs are held on this route';
async function markSection(page: Page, section: number, note = markNote) {
  await choose(page, markName(section));
  await markDialog(page).getByRole('textbox', { name: 'Reason' }).fill(note);
  await markDialog(page).getByRole('button', { name: 'Mark Not Applicable' }).click();
  await expect(markDialog(page)).toBeHidden();
}
async function addTextField(page: Page, label: string, value: string) {
  await choose(page, 'Add Custom Field');
  const dialog = customDialog(page);
  await dialog.getByRole('textbox', { name: 'Label' }).fill(label);
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('textbox').first().fill(value);
  await dialog.getByRole('button', { name: 'Add Field', exact: true }).click();
  await expect(dialog).toBeHidden();
}
const summaryKey = 'identity.summary';
const summaryLabel = standardFieldByKey.get(summaryKey)!.label;
async function stageSummary(page: Page, text: string) {
  await editor(page)
    .getByRole('button', { name: `Edit ${summaryLabel}`, exact: true })
    .click();
  const group = page.getByRole('group', { name: `Edit ${summaryLabel}` });
  await group.getByRole('textbox').first().fill(text);
  await group.getByRole('button', { name: 'Next', exact: true }).click();
  await group.getByRole('button', { name: 'Keep Change', exact: true }).click();
}

test.describe('who sees More, and what it holds', () => {
  test('the owner has More on a section view with Add Custom Field and Mark Section Not Applicable; nothing staged, no Discard', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=5' });
    await expect(moreButton(page)).toBeVisible();
    await expect(moreButton(page)).toContainText('More');
    await moreButton(page).click();
    await expect(menu(page)).toBeVisible();
    const names = await menu(page)
      .getByRole('menuitem')
      .evaluateAll((items) =>
        items.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
      );
    expect(names).toEqual(['Add Custom Field', markName(5)]);
    await expect(item(page, markName(5))).toHaveText('Mark Section Not Applicable');
    await axeClean(page);
    // With nothing staged and no section, More would hold no row, so it is absent (never disabled).
    await open(page, { query: 'route=BD-CN' });
    await expect(moreButton(page)).toHaveCount(0);
    await open(page, { query: 'route=BD-CN&view=sections' });
    await expect(moreButton(page)).toHaveCount(0);
  });

  test('the admin has no More, on a section view and in To Do', async ({ page }) => {
    await open(page, { role: 'admin', query: 'route=BD-CN&section=5' });
    await expect(moreButton(page)).toHaveCount(0);
    await expect(editor(page).getByRole('menu')).toHaveCount(0);
    await open(page, { role: 'admin', query: 'route=BD-CN' });
    await expect(moreButton(page)).toHaveCount(0);
    await open(page, { role: 'admin', query: 'route=BD-EU&section=3' });
    await expect(moreButton(page, 'Bangladesh to European Union')).toHaveCount(0);
  });

  test('a marked section offers Unmark Section, and a pack setting row never offers Mark or Not applicable', async ({
    page,
  }) => {
    const route = 'Bangladesh to European Union';
    await open(page, { query: 'route=BD-EU&section=3' });
    const packRows = rows(page).filter({ hasText: 'Pack setting' });
    expect(await packRows.count()).toBeGreaterThan(0);
    await expect(packRows.getByRole('button')).toHaveCount(0);
    await moreButton(page, route).click();
    const names = await menu(page, route)
      .getByRole('menuitem')
      .evaluateAll((items) =>
        items.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
      );
    expect(names).toEqual(['Add Custom Field', unmarkName(3)]);
    await expect(menu(page, route).getByRole('menuitem', { name: markName(3) })).toHaveCount(0);
  });
});

test.describe('Mark Section Not Applicable', () => {
  test('the reason is refused under 3 and over 500 characters in words; 3 stage the mark, the bar counts it, and Save sends it at the next version under the one save reason', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=5' });
    const before = await savedDocument(page);
    await choose(page, markName(5));
    const dialog = markDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Section 5, ${nameOf(5)}.`);
    await expect(dialog).toContainText(
      'Every field in this section that is not Filled becomes Not applicable. Filled facts keep their value. Pack settings that are Core stay required.',
    );
    const reason = dialog.getByRole('textbox', { name: 'Reason' });
    await expect(reason).toBeFocused();
    await expect(dialog.getByText('0 of 500')).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Mark Not Applicable' });
    await reason.fill('ab');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Say why this section does not apply to this route.',
    );
    await expect(reason).toBeFocused();
    await reason.fill('x'.repeat(501));
    await confirm.click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'That is 501 characters. The limit is 500. Shorten it.',
    );
    await expect(reason).toBeFocused();
    await axeClean(page);
    expect(world.saves).toHaveLength(0);
    await reason.fill('n/a');
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(status(page)).toHaveText('Change kept. 1 change not saved.');
    await expect(status(page)).toBeFocused();
    await expect(bar(page)).toContainText('1 change not saved');
    await expect(editor(page)).toContainText('Not applicable: n/a');
    // The menu now offers Unmark Section for the section, and Discard Changes while something is staged.
    await moreButton(page).click();
    await expect(item(page, unmarkName(5))).toBeVisible();
    await expect(item(page, 'Discard Changes')).toBeVisible();
    await expect(item(page, markName(5))).toHaveCount(0);
    await page.keyboard.press('Escape');
    await saveAll(page, 1);
    await expect(saveDialog(page)).toBeHidden();
    expect(world.saves).toHaveLength(1);
    const sent = sentOf(world);
    expect(sent.version).toBe(before.version + 1);
    expect(sent.reason).toBe(saveReason);
    expect(sent.document).toEqual({
      ...before.document,
      sectionMarks: [{ section: 5, note: 'n/a' }],
    });
    await expect(status(page)).toHaveText(
      `Saved. Route facts are now version ${before.version + 1}.`,
    );
    await expect(bar(page)).toHaveCount(0);
  });

  test('an email address in the reason is refused in words', async ({ page }) => {
    await open(page, { query: 'route=BD-CN&section=5' });
    await choose(page, markName(5));
    const dialog = markDialog(page);
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Ask someone@example.org');
    await dialog.getByRole('button', { name: 'Mark Not Applicable' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'This looks like an email address. Route facts name organisations, places and rules, never people. Remove it.',
    );
  });

  test('an open answer that was changed blocks the menu actions until it is kept or cancelled', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    await editor(page)
      .getByRole('button', { name: `Edit ${summaryLabel}`, exact: true })
      .click();
    await page
      .getByRole('group', { name: `Edit ${summaryLabel}` })
      .getByRole('textbox')
      .first()
      .fill('Half typed');
    await choose(page, markName(1));
    await expect(markDialog(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Keep Change or Cancel this field first.');
    await choose(page, 'Add Custom Field');
    await expect(customDialog(page)).toHaveCount(0);
  });
});

test.describe('Unmark Section', () => {
  test('stages the removal at once with no dialog, the Locked Core line goes, marking again with the same reason leaves nothing staged, and Save sends the document with no mark', async ({
    page,
  }) => {
    const route = 'Bangladesh to European Union';
    const world = await open(page, { query: 'route=BD-EU&section=3' });
    const before = await savedDocument(page, routeIds.bdEu);
    const note = before.document.sectionMarks.find((mark) => mark.section === 3)!.note;
    // The saved mark: its note, and the Core pack settings still Pending keep the section Pending.
    await expect(editor(page)).toContainText(`Not applicable: ${note}`);
    await expect(editor(page)).toContainText(
      /This section is marked Not applicable, but .+ (is a Core pack setting and is|and \d+ more pack settings? are Core and) still Pending\./,
    );
    await choose(page, unmarkName(3), route);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(status(page)).toHaveText('Mark removed. 1 change not saved.');
    await expect(status(page)).toBeFocused();
    await expect(bar(page)).toContainText('1 change not saved');
    await expect(editor(page)).not.toContainText(`Not applicable: ${note}`);
    await expect(editor(page)).not.toContainText('This section is marked Not applicable, but');
    // Marking it again with the same reason is no change: the stage is empty and the line is back.
    await moreButton(page, route).click();
    await menu(page, route)
      .getByRole('menuitem', { name: markName(3), exact: true })
      .click();
    await markDialog(page).getByRole('textbox', { name: 'Reason' }).fill(note);
    await markDialog(page).getByRole('button', { name: 'Mark Not Applicable' }).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(editor(page)).toContainText(`Not applicable: ${note}`);
    await axeClean(page);
    await choose(page, unmarkName(3), route);
    await saveAll(page, 1);
    await expect(saveDialog(page)).toBeHidden();
    const sent = sentOf(world);
    expect(sent.version).toBe(before.version + 1);
    expect(sent.document).toEqual({ ...before.document, sectionMarks: [] });
  });
});

test.describe('Add Custom Field', () => {
  test('Define then Value: the key preview, a taken key refused in words, a choice needs two values, and the saved body carries the fact and its definition', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=5' });
    const before = await savedDocument(page);
    await choose(page, 'Add Custom Field');
    const dialog = customDialog(page);
    await expect(dialog.getByText('Step 1 of 2: Define · Next: Value')).toBeVisible();
    await expect(dialog).toContainText('Nothing is saved until you press Review and Save.');
    await expect(dialog).toContainText(`Goes in section 5, ${nameOf(5)}.`);
    const label = dialog.getByRole('textbox', { name: 'Label' });
    await expect(label).toBeFocused();
    await label.fill('Visa notes');
    await expect(dialog.getByText('Saved as custom.visa_notes')).toBeVisible();
    await axeClean(page);
    // A label whose key the route already has is refused, never renamed.
    await label.fill('Fair stand cost');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'A field named custom.fair_stand_cost already exists on this route. Use another name.',
    );
    await expect(label).toBeFocused();
    await label.fill('!!!');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'This name has no letters or numbers the route file can use. Add a word in English letters.',
    );
    await label.fill('Fair season');
    await dialog.getByRole('combobox', { name: 'Type' }).selectOption('choice');
    await dialog.getByRole('textbox', { name: 'Allowed values' }).fill('Spring');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Add at least 2 allowed values, one per line.',
    );
    await dialog.getByRole('combobox', { name: 'Type' }).selectOption('text');
    await label.fill('Visa notes');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog.getByText('Step 2 of 2: Value')).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Pending', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Remove Field', exact: true })).toHaveCount(0);
    await dialog.getByRole('textbox').first().fill('Business visa on arrival for fair visitors');
    await axeClean(page);
    await dialog.getByRole('button', { name: 'Add Field', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(status(page)).toHaveText('Field added. 1 change not saved.');
    await expect(status(page)).toBeFocused();
    // The new row stands last, under Your own fields, as a change not saved.
    const last = rows(page).last();
    await expect(last).toContainText('Visa notes');
    await expect(last).toContainText('Changed, not saved');
    await expect(editor(page).getByRole('heading', { name: 'Your own fields' })).toBeVisible();
    // The same label again is refused: the staged field holds the key.
    await choose(page, 'Add Custom Field');
    await customDialog(page).getByRole('textbox', { name: 'Label' }).fill('Visa notes');
    await customDialog(page).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(customDialog(page).getByRole('alert')).toHaveText(
      'A field named custom.visa_notes already exists on this route. Use another name.',
    );
    await customDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(moreButton(page)).toBeFocused();
    await saveAll(page, 1);
    await expect(saveDialog(page)).toBeHidden();
    const sent = sentOf(world);
    expect(sent.version).toBe(before.version + 1);
    expect(sent.reason).toBe(saveReason);
    const added = sent.document.facts.find((fact) => fact.key === 'custom.visa_notes');
    expect(added).toMatchObject({
      key: 'custom.visa_notes',
      label: 'Visa notes',
      section: 5,
      type: 'text',
      state: 'FILLED',
      value: 'Business visa on arrival for fair visitors',
    } satisfies Partial<ContentFact>);
    expect(sent.document.facts.filter((fact) => fact.key !== 'custom.visa_notes')).toEqual(
      before.document.facts,
    );
    await expect(rowOf(page, 'Visa notes')).not.toContainText('Changed, not saved');
  });

  test('Undo Change on a field just added takes it away', async ({ page }) => {
    await open(page, { query: 'route=BD-CN&section=5' });
    await addTextField(page, 'Visa notes', 'On arrival');
    await rowOf(page, 'Visa notes')
      .getByRole('button', { name: 'Undo Change to Visa notes' })
      .click();
    await expect(bar(page)).toHaveCount(0);
    await expect(rows(page).filter({ hasText: 'Visa notes' })).toHaveCount(0);
  });

  test('Undo Change on a field just added puts focus on the status line, not on the page', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=5' });
    await addTextField(page, 'Visa notes', 'On arrival');
    await rowOf(page, 'Visa notes')
      .getByRole('button', { name: 'Undo Change to Visa notes' })
      .click();
    await expect(rows(page).filter({ hasText: 'Visa notes' })).toHaveCount(0);
    await expect(status(page)).toBeFocused();
  });
});

test.describe('a failed save keeps the mark and the custom field', () => {
  test('a refused save keeps both staged, with the dialog open, and Cancel leaves them on the page', async ({
    page,
  }) => {
    const world = await open(page, {
      query: 'route=BD-CN&section=5',
      facts: { saveScript: [{ status: 500, error: 'Internal error' }] },
    });
    await markSection(page, 5);
    await addTextField(page, 'Visa notes', 'On arrival');
    await expect(bar(page)).toContainText('2 changes not saved');
    await saveAll(page, 2);
    await expect(saveDialog(page).getByRole('alert')).toBeVisible();
    expect(world.saves).toHaveLength(1);
    const sent = sentOf(world);
    expect(sent.document.sectionMarks).toEqual([{ section: 5, note: markNote }]);
    expect(sent.document.facts.some((fact) => fact.key === 'custom.visa_notes')).toBe(true);
    await saveDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(bar(page)).toContainText('2 changes not saved');
    await expect(editor(page)).toContainText(`Not applicable: ${markNote}`);
    await expect(rowOf(page, 'Visa notes')).toContainText('Changed, not saved');
    expect(await stageKeys(page)).toHaveLength(1);
  });
});

test.describe('Discard Changes from More', () => {
  test('at 320 the bar has no Discard and More has it: Keep Editing is focused and returns to More; Discard clears the marks, the custom field, the edit and the tab copy', async ({
    page,
  }) => {
    await open(page, { width: 320, height: 800, query: 'route=BD-CN&section=1' });
    await stageSummary(page, 'Mine');
    await markSection(page, 1, 'Not needed here');
    await addTextField(page, 'Visa notes', 'On arrival');
    await expect(bar(page)).toContainText('3 changes not saved');
    await expect(bar(page).getByRole('button', { name: 'Discard Changes' })).toHaveCount(0);
    expect(await stageKeys(page)).toHaveLength(1);
    await choose(page, 'Discard Changes');
    const dialog = discardDialog(page);
    await expect(dialog).toContainText(
      'This removes 3 changes that are not saved. The saved facts stay as they are.',
    );
    await expect(dialog.getByRole('button', { name: 'Keep Editing' })).toBeFocused();
    await axeClean(page);
    await dialog.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
    await expect(bar(page)).toContainText('3 changes not saved');
    await choose(page, 'Discard Changes');
    await dialog.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(bar(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Changes discarded.');
    await expect(status(page)).toBeFocused();
    expect(await stageKeys(page)).toEqual([]);
    await expect(editor(page)).not.toContainText('Not applicable: Not needed here');
    await expect(rows(page).filter({ hasText: 'Visa notes' })).toHaveCount(0);
    await expect(rowOf(page, summaryLabel)).not.toContainText('Mine');
    await moreButton(page).click();
    await expect(item(page, 'Discard Changes')).toHaveCount(0);
  });

  test('at 320 in To Do, More holds only Discard Changes while something is staged', async ({
    page,
  }) => {
    await open(page, { width: 320, height: 800, query: 'route=BD-CN&section=1' });
    await stageSummary(page, 'Mine');
    await editor(page)
      .getByRole('radio', { name: /^To Do/ })
      .click();
    await expect(moreButton(page)).toBeVisible();
    await moreButton(page).click();
    const names = await menu(page).getByRole('menuitem').allTextContents();
    expect(names).toEqual(['Discard Changes']);
  });

  test('at 1440 the bar keeps Discard Changes, More on a section view also offers it, and in To Do the only-Discard More is not shown', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    await stageSummary(page, 'Mine');
    await expect(bar(page).getByRole('button', { name: 'Discard Changes' })).toBeVisible();
    await moreButton(page).click();
    await expect(item(page, 'Discard Changes')).toBeVisible();
    await page.keyboard.press('Escape');
    await editor(page)
      .getByRole('radio', { name: /^To Do/ })
      .click();
    await expect(moreButton(page)).toBeHidden();
    await expect(bar(page).getByRole('button', { name: 'Discard Changes' })).toBeVisible();
  });
});

test.describe('keyboard', () => {
  test('Enter opens More on its first row, Escape returns focus to More, and Cancel in a dialog returns focus to More', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=5' });
    await moreButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();
    await expect(item(page, 'Add Custom Field')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await expect(item(page, markName(5))).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(markDialog(page)).toBeVisible();
    await expect(markDialog(page).getByRole('textbox', { name: 'Reason' })).toBeFocused();
    await markDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(markDialog(page)).toBeHidden();
    await expect(moreButton(page)).toBeFocused();
    await expect(bar(page)).toHaveCount(0);
  });
});

test.describe('the More button keeps its word on one line and its panel stays on screen', () => {
  for (const width of [320, 1440]) {
    test(`at ${width} the More button is at least 44 px wide and "More" is on one line`, async ({
      page,
    }) => {
      await open(page, { width, height: 900, query: 'route=BD-CN&section=5' });
      const button = await box(moreButton(page));
      expect(button.width).toBeGreaterThanOrEqual(44);
      const word = moreButton(page).getByText('More', { exact: true });
      // The word is one line when it is less than two font sizes high (stacked letters would be four lines).
      const fontSize = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect((await box(word)).height).toBeLessThan(fontSize * 2);
    });
  }
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    test(`at ${width} the open panel lies inside the viewport`, async ({ page }) => {
      await open(page, { width, height: 900, query: 'route=BD-CN&section=5' });
      await moreButton(page).click();
      const panel = await box(menu(page));
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    });
  }
});

test.describe('widths: no sideways scroll, axe clean, 44 px targets', () => {
  for (const [width, height] of [
    [320, 568],
    [1440, 900],
  ] as const) {
    test(`at ${width} by ${height}: the menu, the mark dialog and both steps of Add Custom Field`, async ({
      page,
    }) => {
      await open(page, { width, height, query: 'route=BD-CN&section=5' });
      await noSidewaysScroll(page);
      // 44 px targets up to 1023 px; from 1024 px the desk's laptop density (a 36 px control) applies, as for the unsaved bar.
      const minimum = width >= 1024 ? 36 : 44;
      expect((await box(moreButton(page))).height).toBeGreaterThanOrEqual(minimum);
      await moreButton(page).click();
      for (const row of await menu(page).getByRole('menuitem').all())
        expect((await box(row)).height).toBeGreaterThanOrEqual(minimum);
      expect((await box(menu(page))).width).toBeLessThanOrEqual(width);
      await noSidewaysScroll(page);
      await axeClean(page);
      await item(page, markName(5)).click();
      const mark = markDialog(page);
      await expect(mark).toBeVisible();
      expect((await box(mark)).height).toBeLessThanOrEqual(height);
      expect((await box(mark)).width).toBeLessThanOrEqual(width);
      for (const button of await mark.getByRole('button').all())
        expect((await box(button)).height).toBeGreaterThanOrEqual(minimum);
      await noSidewaysScroll(page);
      await axeClean(page);
      await mark.getByRole('button', { name: 'Cancel', exact: true }).click();
      await choose(page, 'Add Custom Field');
      const custom = customDialog(page);
      await custom.getByRole('combobox', { name: 'Type' }).selectOption('choice');
      const customBox = await box(custom);
      expect(customBox.height).toBeLessThanOrEqual(height);
      expect(customBox.width).toBeLessThanOrEqual(width);
      const next = custom.getByRole('button', { name: 'Next', exact: true });
      await next.scrollIntoViewIfNeeded();
      await expect(next).toBeInViewport();
      expect((await box(next)).height).toBeGreaterThanOrEqual(minimum);
      await noSidewaysScroll(page);
      await axeClean(page);
      await custom.getByRole('combobox', { name: 'Type' }).selectOption('text');
      await custom.getByRole('textbox', { name: 'Label' }).fill('Visa notes');
      await next.click();
      const add = custom.getByRole('button', { name: 'Add Field', exact: true });
      await add.scrollIntoViewIfNeeded();
      await expect(add).toBeInViewport();
      expect((await box(custom)).height).toBeLessThanOrEqual(height);
      await noSidewaysScroll(page);
      await axeClean(page);
    });
  }
});

test.describe('More shares the first line of the route header', () => {
  test('at 1440 More stands on the same line as the pack and route facts versions, and the header gains no line for it', async ({
    page,
  }) => {
    await open(page, { width: 1440, height: 900, query: 'route=BD-CN&section=5' });
    const more = await box(moreButton(page));
    for (const words of [/^Pack version /, /^Route facts version /]) {
      const text = await box(
        editor(page).locator('.route-editor-line span').filter({ hasText: words }).first(),
      );
      // One line: the middle of More lies within the text's own band.
      const middle = more.y + more.height / 2;
      expect(middle).toBeGreaterThan(text.y - 1);
      expect(middle).toBeLessThan(text.y + text.height + more.height / 2 + 1);
      expect(Math.abs(more.y + more.height / 2 - (text.y + text.height / 2))).toBeLessThan(
        more.height / 2,
      );
    }
    // The whole first line is one row of More's own height: the header gains no line for More, so the 900 px budget of the
    // route region (measured in route-pack-editor-edit.spec.ts) is untouched.
    const line = await box(editor(page).locator('.route-editor-line').first());
    expect(line.height).toBeLessThanOrEqual(more.height + 1);
  });
  for (const width of [320, 390]) {
    test(`at ${width} More is one line, 44 px high, and its panel lies inside the viewport`, async ({
      page,
    }) => {
      await open(page, { width, height: 900, query: 'route=BD-CN&section=5' });
      const button = await box(moreButton(page));
      expect(button.height).toBeGreaterThanOrEqual(44);
      const word = moreButton(page).getByText('More', { exact: true });
      const fontSize = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect((await box(word)).height).toBeLessThan(fontSize * 2);
      await moreButton(page).click();
      const panel = await box(menu(page));
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      await noSidewaysScroll(page);
    });
  }
});
