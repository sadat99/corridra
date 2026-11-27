import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startP5cFixture } from './p5c-desk-fixture';
import { answerReads, routeIds, type FactsWorld, type World } from './p5c-desk-world';
import {
  standardFieldByKey,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';

// ADR-093 Phase 3, PR 2b: editing route facts (docs/revamp/specs/route-pack-editor.md, sections 8.8, 9, 9.1 and 9.2), measured with
// the real stylesheets in the desk fixture. The reads and the one write are answered by the fixture world, which does what the
// server does (the next version or 409, an exact replay is a duplicate) unless a test scripts an answer. Every count is taken from
// the standard or from what the world was built to hold.
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
  query?: string;
  /** Run in the page before it loads. */
  init?: () => void;
  totp?: 'ok' | 'bad';
};
async function open(page: Page, options: Options = {}) {
  const { role = 'owner', width = 1440, height = 900, query = 'route=BD-CN' } = options;
  await page.setViewportSize({ width, height });
  const given: Partial<World> = { role };
  if (options.facts !== null) given.facts = options.facts ?? {};
  if (options.totp) given.totp = options.totp;
  const world = await answerReads(page, given);
  if (options.init) await page.addInitScript(options.init);
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
  if (options.facts !== null && words.has('route') && options.role !== 'none')
    await expect(rows(page).first()).toBeVisible();
  return world;
}
const editor = (page: Page) => page.locator('section.route-editor');
const rows = (page: Page) => editor(page).locator('li.ux-fact-row');
const rowOf = (page: Page, label: string) => rows(page).filter({ hasText: label }).first();
const labelOf = (key: string) => standardFieldByKey.get(key)!.label;
const editButton = (page: Page, label: string) =>
  editor(page).getByRole('button', { name: `Edit ${label}`, exact: true });
const group = (page: Page, label: string) => page.getByRole('group', { name: `Edit ${label}` });
const bar = (page: Page) => page.getByRole('group', { name: 'Unsaved changes' });
const status = (page: Page) => editor(page).locator('.route-editor-status');
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
async function noRepeatedLinks(page: Page) {
  const hrefs = await page
    .locator('main#main a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const twice = hrefs.filter((href, index) => hrefs.indexOf(href) !== index);
  expect(twice, `addresses linked more than once: ${twice.join(', ')}`).toEqual([]);
}

// The fields the world leaves Pending on Bangladesh to China, and one that is filled with plain text.
const sectionOf = (key: string) => standardFieldByKey.get(key)!.section;
const saved = standardFieldsV1.find((f) => f.key === 'identity.summary')!;
const optionalText = standardFieldsV1.find(
  (f) => f.part === 'Content' && f.type === 'text' && !f.core && f.maxLength >= 1000,
)!;
const sectionQuery = (key: string) => `route=BD-CN&section=${sectionOf(key)}`;
async function showAll(page: Page) {
  const more = editor(page).getByRole('button', { name: /^Show all \d+ fields$/ });
  if (await more.count()) await more.click();
}

/** Opens the row, writes a text, goes through both steps and keeps the change. */
async function keepText(page: Page, label: string, text: string) {
  await editButton(page, label).click();
  await group(page, label).getByRole('textbox').first().fill(text);
  await group(page, label).getByRole('button', { name: 'Next', exact: true }).click();
  await group(page, label).getByRole('button', { name: 'Keep Change', exact: true }).click();
}

test.describe('who sees Edit, and what it opens', () => {
  test('the owner has Edit on every content row that offers an answer and the admin has none', async ({
    page,
  }) => {
    await open(page, { query: sectionQuery(saved.key) });
    await showAll(page);
    const items = rows(page);
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      const item = items.nth(index);
      const locked = (await item.getByText('Pack setting', { exact: true }).count()) > 0;
      const buttons = item.getByRole('button', { name: /^Edit / });
      // A pack setting is read only in PR 2; every content row can be edited.
      await expect(buttons).toHaveCount(locked ? 0 : 1);
    }
    await axeClean(page);
    await open(page, { role: 'admin', query: sectionQuery(saved.key) });
    await showAll(page);
    await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
    await expect(editor(page).getByRole('button', { name: /^(Edit|Undo Change)/ })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Unsaved changes' })).toHaveCount(0);
  });

  test('a pack setting row and a section with a Core pack setting have no Edit, and a stale fact has Edit', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-EU&section=3' });
    const packRows = rows(page).filter({ hasText: 'Pack setting' });
    expect(await packRows.count()).toBeGreaterThan(0);
    // PR 3b (spec 8.9) replaces the interim PR 2 rule (8.7, Locked rows read only): no Edit on a pack row, and exactly one
    // Change on each for the owner; an admin gets no button on a pack row.
    await expect(packRows.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    for (const row of await packRows.all()) {
      await expect(row.getByRole('button')).toHaveCount(1);
      await expect(row.getByRole('button', { name: /^Change / })).toHaveCount(1);
    }
    await open(page, { role: 'admin', query: 'route=BD-EU&section=3' });
    const adminRows = rows(page).filter({ hasText: 'Pack setting' });
    expect(await adminRows.count()).toBeGreaterThan(0);
    await expect(adminRows.getByRole('button')).toHaveCount(0);
    await open(page, { query: 'route=BD-CN' });
    const stale = rows(page).filter({ hasText: 'Stale since' });
    await expect(stale).toHaveCount(1);
    await expect(stale.getByRole('button', { name: /^Edit / })).toHaveCount(1);
  });

  test('Edit opens the row in place: focus on the first answer, three answers, Next goes to the source step and focuses the step line', async ({
    page,
  }) => {
    await open(page, { query: sectionQuery(optionalText.key) });
    await showAll(page);
    await editButton(page, optionalText.label).click();
    const box = group(page, optionalText.label);
    await expect(box).toBeVisible();
    await expect(box.getByRole('button', { name: 'Filled', exact: true })).toBeFocused();
    await expect(box.getByText('Step 1 of 2: Answer · Next: Source')).toBeVisible();
    for (const word of ['Filled', 'Not applicable', 'Pending'])
      await expect(box.getByRole('button', { name: word, exact: true })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Filled', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      box.getByRole('group', { name: `Answer for ${optionalText.label}` }),
    ).toBeVisible();
    // The row keeps its label and hides its value while it is open; one row is open at a time.
    await expect(rowOf(page, optionalText.label)).toContainText(optionalText.label);
    await box.getByRole('textbox').first().fill('A short answer');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(box.getByText('Step 2 of 2: Source')).toBeFocused();
    await expect(box.getByRole('button', { name: 'Staff knowledge', exact: true })).toBeVisible();
    await expect(box.getByRole('group', { name: 'Dates' })).toBeVisible();
    await expect(box.getByLabel('Observed on')).toBeVisible();
    await expect(box.getByLabel('Valid until (optional)')).toBeVisible();
    await axeClean(page);
    await box.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(box.getByText('Step 1 of 2: Answer · Next: Source')).toBeFocused();
  });

  test('Keep Change stages the edit, says so, returns focus to Edit and shows the unsaved bar; Undo Change takes it back', async ({
    page,
  }) => {
    await open(page, { query: sectionQuery(optionalText.key) });
    await showAll(page);
    await keepText(page, optionalText.label, 'A short answer');
    await expect(page.getByText('Change kept. 1 change not saved.')).toHaveCount(1);
    await expect(editButton(page, optionalText.label)).toBeFocused();
    await expect(rowOf(page, optionalText.label)).toContainText('Changed, not saved');
    await expect(rowOf(page, optionalText.label)).toContainText('A short answer');
    await expect(bar(page)).toContainText('1 change not saved');
    await expect(bar(page).getByRole('button', { name: 'Review and Save (1)' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Discard Changes' })).toBeVisible();
    await axeClean(page);
    await rowOf(page, optionalText.label)
      .getByRole('button', { name: `Undo Change to ${optionalText.label}` })
      .click();
    await expect(editButton(page, optionalText.label)).toBeFocused();
    await expect(bar(page)).toHaveCount(0);
    await expect(rowOf(page, optionalText.label)).not.toContainText('Changed, not saved');
    // Keep Change with nothing different says so and stages nothing.
    await editButton(page, optionalText.label).click();
    await group(page, optionalText.label)
      .getByRole('button', { name: 'Pending', exact: true })
      .click();
    await group(page, optionalText.label)
      .getByRole('button', { name: 'Keep Change', exact: true })
      .click();
    await expect(status(page)).toContainText('No change to keep.');
    await expect(bar(page)).toHaveCount(0);
  });
});

// ---- Saving ---------------------------------------------------------------------------------------------------------------------

const summaryKey = 'identity.summary';
const summaryLabel = labelOf(summaryKey);
const coverageKey = 'identity.service_coverage';
const coverageLabel = labelOf(coverageKey);
const reasonText = 'Updated the summary after the spring visit';
/** The document the world holds for the open route now, read through the same mocked route the page uses. */
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
const withFact = (document: ContentDocument, key: string, value: string): ContentDocument => ({
  ...document,
  facts: document.facts.map((fact) => (fact.key === key ? { ...fact, value } : fact)),
});
const stageKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) =>
      key.startsWith('corridra:route-pack-stage:'),
    ),
  );
const saveDialog = (page: Page) => page.getByRole('dialog', { name: 'Save Route Facts' });
async function stageSummary(page: Page, text = 'Mine') {
  await keepText(page, summaryLabel, text);
  await expect(bar(page)).toBeVisible();
}
async function reviewAndSave(page: Page, count = 1) {
  await bar(page)
    .getByRole('button', { name: `Review and Save (${count})` })
    .click();
  await expect(saveDialog(page)).toBeVisible();
}
async function fillReason(page: Page, text = reasonText) {
  await saveDialog(page).getByRole('textbox', { name: 'Reason' }).fill(text);
}
const saveFacts = (page: Page) => saveDialog(page).getByRole('button', { name: 'Save Facts' });

test.describe('Save Route Facts', () => {
  test('the dialog states what it does, lists the change, needs a reason, and sends the whole staged document at the next version', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1' });
    const before = await savedDocument(page);
    await stageSummary(page, 'A new summary');
    await reviewAndSave(page);
    const dialog = saveDialog(page);
    await expect(dialog).toContainText(
      'This saves a new version of the facts for Bangladesh to China. It does not change the pack, so readiness stays as it is. Only your team can see route facts.',
    );
    // The route is named in plain words inside the sentence: no flag or region mark breaks its line.
    await expect(
      dialog
        .locator('p', { hasText: 'This saves a new version of the facts' })
        .locator('.ux-flagged'),
    ).toHaveCount(0);
    await expect(dialog).toContainText('Added 0, changed 1, removed 0');
    await expect(dialog).toContainText(`Changed: ${summaryLabel}`);
    await expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveAttribute(
      'placeholder',
      'For example: added the 2027 public holidays from the official notice',
    );
    await expect(dialog.getByText('0 of 500')).toBeVisible();
    // No reason: refused in words, focus on the reason, nothing sent.
    await saveFacts(page).click();
    await expect(dialog.getByRole('alert')).toHaveText('Give a reason of at least 3 characters.');
    await expect(dialog.getByRole('textbox', { name: 'Reason' })).toBeFocused();
    expect(world.saves).toHaveLength(0);
    await axeClean(page);
    await fillReason(page);
    await expect(dialog.getByText(`${reasonText.length} of 500`)).toBeVisible();
    // The reason is never copied to the tab's storage; the staged edit is.
    const kept = await page.evaluate(() =>
      Object.entries(window.sessionStorage)
        .filter(([key]) => key.startsWith('corridra:route-pack-stage:'))
        .map(([, value]) => value),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toContain('A new summary');
    expect(kept[0]).not.toContain(reasonText);
    await saveFacts(page).click();
    await expect(dialog).toBeHidden();
    // One request, the whole document at version 5 + 1, the reason trimmed, a command id.
    expect(world.saves).toHaveLength(1);
    const sent = world.saves[0]!.body as {
      id: string;
      routeId: string;
      version: number;
      reason: string;
      document: ContentDocument;
    };
    expect(sent.version).toBe(before.version + 1);
    expect(sent.routeId).toBe(routeIds.bdCn);
    expect(sent.reason).toBe(reasonText);
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.document).toEqual(withFact(before.document, summaryKey, 'A new summary'));
    expect(world.saves[0]!.path).toContain(`tenant=${fixtureTenant}`);
    // The status line says so and takes focus; the bar and the staged edit and the copy are gone; the rows show the saved value.
    await expect(status(page)).toHaveText(
      `Saved. Route facts are now version ${before.version + 1}.`,
    );
    await expect(status(page)).toBeFocused();
    await expect(status(page)).toHaveAttribute('role', 'status');
    await expect(bar(page)).toHaveCount(0);
    expect(await stageKeys(page)).toEqual([]);
    await expect(rowOf(page, summaryLabel)).toContainText('A new summary');
    await expect(rowOf(page, summaryLabel)).not.toContainText('Changed, not saved');
    await expect(editor(page)).toContainText(`Route facts version ${before.version + 1}`);
    // The Routes list is asked again, so its words follow the new facts.
    await expect
      .poll(
        () =>
          world.asked.filter(
            (line) => line.includes('route-pack-overview') && !line.includes('routeId='),
          ).length,
      )
      .toBeGreaterThan(1);
    await axeClean(page);
    await noRepeatedLinks(page);
  });

  test('the authenticator check: a 401 opens it in place and the same body and command id are sent again after the code', async ({
    page,
  }) => {
    const world = await open(page, {
      query: 'route=BD-CN&section=1',
      facts: { saveScript: [{ status: 401, code: 'STEP_UP_REQUIRED' }] },
    });
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    const check = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(check).toBeVisible();
    await check.getByLabel('Six-digit code').fill('123456');
    await check.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(saveDialog(page)).toBeHidden();
    await expect(status(page)).toContainText('Saved. Route facts are now version 6.');
    expect(world.saves).toHaveLength(2);
    expect(world.saves[1]!.body).toEqual(world.saves[0]!.body);
  });

  test('closing the authenticator check keeps the dialog, the reason and the edits and says so; the next send keeps the command id', async ({
    page,
  }) => {
    const world = await open(page, {
      query: 'route=BD-CN&section=1',
      facts: { saveScript: [{ status: 401, code: 'STEP_UP_REQUIRED' }] },
    });
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    await page
      .getByRole('dialog', { name: 'Confirm it is you' })
      .getByRole('button', { name: 'Not now' })
      .click();
    await expect(saveDialog(page).getByRole('alert')).toHaveText(
      'Confirm your authenticator code to finish this. Your changes are kept.',
    );
    await expect(saveDialog(page).getByRole('textbox', { name: 'Reason' })).toHaveValue(reasonText);
    await expect(saveFacts(page)).toBeEnabled();
    expect(world.saves).toHaveLength(1);
    await saveFacts(page).click();
    await expect(saveDialog(page)).toBeHidden();
    expect(world.saves).toHaveLength(2);
    expect((world.saves[1]!.body as { id: string }).id).toBe(
      (world.saves[0]!.body as { id: string }).id,
    );
  });
});

// Each refusal in the words of the spec, with the dialog, the reason and the edits still there.
const refusals: Array<{
  name: string;
  answer: { status: number; code?: string; error?: string };
  words: string;
}> = [
  {
    name: 'offline or a server error',
    answer: { status: 500 },
    words: 'Not saved. Your changes are still here. Try again.',
  },
  {
    name: '404',
    answer: { status: 404, error: 'Not found' },
    words: 'Not saved. Your changes are still here. Try again.',
  },
  {
    name: '413',
    answer: { status: 413, error: 'Request is too large' },
    words: 'This route content is too large to save. Shorten notes or long lists.',
  },
  {
    name: '403',
    answer: { status: 403, error: 'Access denied' },
    words: 'You can no longer save route facts. Only the owner can.',
  },
  {
    name: 'a session that has ended',
    answer: { status: 401, error: 'Unauthorized' },
    words: 'Your session has ended. Sign in again, then open this route and save again.',
  },
  {
    name: 'an invalid document, with the field named by its label',
    answer: {
      status: 400,
      code: 'ROUTE_PACK_INVALID',
      error: `${summaryKey} needs the date it was observed, written YYYY-MM-DD and not in the future.`,
    },
    words: `The save was refused: ${summaryLabel} needs the date it was observed, written YYYY-MM-DD and not in the future. Nothing was saved. Your changes are still here.`,
  },
  {
    name: 'a custom key that means something else',
    answer: {
      status: 409,
      code: 'ROUTE_PACK_CUSTOM_KEY_CONFLICT',
      error:
        'custom.x already means something else on another route: use the same section, type and allowed values, or a new key.',
    },
    words:
      'custom.x already means something else on another route: use the same section, type and allowed values, or a new key. Undo Change on that field, then add it again with another name.',
  },
  {
    name: 'a command id reused for another body',
    answer: {
      status: 409,
      code: 'ROUTE_PACK_COMMAND_REUSED',
      error: 'Command key reused with different values',
    },
    words:
      'This save could not be repeated because its details changed. Check the summary, then save again.',
  },
];
test.describe('a failed save loses nothing', () => {
  for (const refusal of refusals)
    test(`${refusal.name}: ${refusal.words.slice(0, 40)}…`, async ({ page }) => {
      const world = await open(page, {
        query: 'route=BD-CN&section=1',
        facts: { saveScript: [refusal.answer] },
      });
      await stageSummary(page);
      await reviewAndSave(page);
      await fillReason(page);
      await saveFacts(page).click();
      const dialog = saveDialog(page);
      await expect(dialog.getByRole('alert')).toHaveText(refusal.words);
      await expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue(reasonText);
      await expect(saveFacts(page)).toBeEnabled();
      await expect(dialog.getByText(`Changed: ${summaryLabel}`)).toBeVisible();
      expect(refusal.words).not.toContain(String.fromCharCode(0x2014));
      await axeClean(page);
      // Cancel keeps every edit.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(bar(page)).toContainText('1 change not saved');
      await expect(rowOf(page, summaryLabel)).toContainText('Mine');
      expect(world.saves).toHaveLength(1);
    });

  test('a retry sends the same command id; a changed reason makes a new one; a reused id is replaced', async ({
    page,
  }) => {
    const world = await open(page, {
      query: 'route=BD-CN&section=1',
      facts: {
        saveScript: [
          { status: 500 },
          { status: 500 },
          {
            status: 409,
            code: 'ROUTE_PACK_COMMAND_REUSED',
            error: 'Command key reused with different values',
          },
        ],
      },
    });
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    await expect(saveDialog(page).getByRole('alert')).toBeVisible();
    await saveFacts(page).click();
    await expect.poll(() => world.saves.length).toBe(2);
    const id = (index: number) => (world.saves[index]!.body as { id: string }).id;
    expect(id(1)).toBe(id(0));
    // A changed reason is a different command.
    await fillReason(page, `${reasonText} again`);
    await saveFacts(page).click();
    await expect.poll(() => world.saves.length).toBe(3);
    expect(id(2)).not.toBe(id(0));
    // The server refused to repeat that id: the next send is new again.
    await expect(saveDialog(page).getByRole('alert')).toContainText(
      'This save could not be repeated',
    );
    await saveFacts(page).click();
    await expect(saveDialog(page)).toBeHidden();
    expect(world.saves).toHaveLength(4);
    expect(id(3)).not.toBe(id(2));
  });
});

// ---- Another save landed first ---------------------------------------------------------------------------------------------------

const conflict = 'ROUTE_PACK_CONTENT_CHANGED';
const clashHeading = (page: Page) =>
  saveDialog(page).getByRole('heading', { level: 3, name: /^Someone saved route facts/ });
const idOf = (world: World, index: number) => (world.saves[index]!.body as { id: string }).id;
async function theirs(page: Page, change: (document: ContentDocument) => ContentDocument) {
  const current = await savedDocument(page);
  return { document: change(current.document), version: current.version + 1 };
}

test.describe('conflict: Someone saved route facts for this route first', () => {
  test('a fact both of you changed asks: two answers, none chosen, Save With These Choices disabled with its reason, then the merged document at the next version', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const wait = await theirs(page, (document) => withFact(document, summaryKey, 'Theirs'));
    world.facts!.saveScript = [{ status: 409, code: conflict, theirs: wait }];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    const dialog = saveDialog(page);
    // Focus goes to the heading, not to a button that could save blind.
    await expect(clashHeading(page)).toHaveText('Someone saved route facts for this route first.');
    await expect(clashHeading(page)).toBeFocused();
    await expect(dialog).toContainText('Facts only one of you changed are kept as they are.');
    await expect(dialog).toContainText(
      'You both changed the facts below. Choose one answer for each.',
    );
    await expect(dialog).toContainText('Step 1 of 1: Choices');
    const mine = dialog.getByRole('button', { name: 'Keep mine: Mine' });
    const other = dialog.getByRole('button', { name: 'Use theirs: Theirs' });
    await expect(mine).toHaveAttribute('aria-pressed', 'false');
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    const primary = dialog.getByRole('button', { name: 'Save With These Choices' });
    await expect(primary).toBeDisabled();
    await expect(dialog.getByText('Choose for Each Fact')).toBeVisible();
    // Nothing was sent again by itself.
    expect(world.saves).toHaveLength(1);
    await axeClean(page);
    await mine.click();
    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await expect(primary).toBeEnabled();
    await expect(dialog.getByText('Choose for Each Fact')).toHaveCount(0);
    await primary.click();
    await expect(dialog).toBeHidden();
    expect(world.saves).toHaveLength(2);
    const sent = world.saves[1]!.body as {
      version: number;
      document: ContentDocument;
      reason: string;
    };
    expect(sent.version).toBe(wait.version + 1);
    expect(sent.reason).toBe(reasonText);
    expect(sent.document.facts.find((fact) => fact.key === summaryKey)?.value).toBe('Mine');
    // A new request with a new command id, because the first id belongs to the document that was refused.
    expect(idOf(world, 1)).not.toBe(idOf(world, 0));
    await expect(status(page)).toHaveText(
      `Saved. Route facts are now version ${wait.version + 1}.`,
    );
  });

  test('Use theirs for the only clash leaves nothing to save: it says so and Close ends it with no edit left', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    world.facts!.saveScript = [
      {
        status: 409,
        code: conflict,
        theirs: await theirs(page, (document) => withFact(document, summaryKey, 'Theirs')),
      },
    ];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    await clashHeading(page).waitFor();
    await saveDialog(page).getByRole('button', { name: 'Use theirs: Theirs' }).click();
    await expect(saveDialog(page).getByText('Nothing is left to save.')).toBeVisible();
    await expect(
      saveDialog(page).getByRole('button', { name: 'Save With These Choices' }),
    ).toHaveCount(0);
    await saveDialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(saveDialog(page)).toBeHidden();
    await expect(bar(page)).toHaveCount(0);
    await expect(rowOf(page, summaryLabel)).toContainText('Theirs');
    expect(world.saves).toHaveLength(1);
  });

  test('nothing clashes: a banner says so, nothing is sent by itself, the summary shows what is left, and the next save is a new command at the next version', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const wait = await theirs(page, (document) => withFact(document, coverageKey, 'Theirs'));
    world.facts!.saveScript = [{ status: 409, code: conflict, theirs: wait }];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    const dialog = saveDialog(page);
    const banner = dialog.locator('.route-save-banner');
    await expect(banner).toBeFocused();
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner.locator('p')).toHaveText([
      `Someone saved route facts for this route first. Their changes do not clash with yours. The latest version is ${wait.version}.`,
      `Your change to ${summaryLabel} is kept. The other save did not change that fact.`,
      'Check the summary, then save again.',
    ]);
    await expect(dialog).toContainText(`Changed: ${summaryLabel}`);
    await expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue(reasonText);
    expect(world.saves).toHaveLength(1);
    await axeClean(page);
    await saveFacts(page).click();
    await expect(dialog).toBeHidden();
    expect(world.saves).toHaveLength(2);
    const sent = world.saves[1]!.body as { version: number; document: ContentDocument };
    expect(sent.version).toBe(wait.version + 1);
    // Their change stays and mine is on top of it.
    expect(sent.document.facts.find((fact) => fact.key === coverageKey)?.value).toBe('Theirs');
    expect(sent.document.facts.find((fact) => fact.key === summaryKey)?.value).toBe('Mine');
    expect(idOf(world, 1)).not.toBe(idOf(world, 0));
  });

  test('everything was already saved: the banner says so and Close is the only action', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    world.facts!.saveScript = [
      {
        status: 409,
        code: conflict,
        theirs: await theirs(page, (document) => withFact(document, summaryKey, 'Mine')),
      },
    ];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    const dialog = saveDialog(page);
    await expect(dialog.locator('.route-save-banner')).toBeFocused();
    await expect(dialog.locator('.route-save-banner')).toHaveText(
      'Someone saved route facts for this route first. It already includes all of your changes. The latest version is 6. There is nothing left to save.',
    );
    await expect(dialog.getByRole('button', { name: 'Save Facts' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeVisible();
    await axeClean(page);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog).toBeHidden();
    // No edit is left, so focus is on the status line.
    await expect(bar(page)).toHaveCount(0);
    await expect(status(page)).toBeFocused();
    expect(world.saves).toHaveLength(1);
  });

  test('another save lands again: the heading says again and the choices start over', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const first = await theirs(page, (document) => withFact(document, summaryKey, 'Theirs'));
    world.facts!.saveScript = [
      { status: 409, code: conflict, theirs: first },
      {
        status: 409,
        code: conflict,
        theirs: {
          document: withFact(first.document, summaryKey, 'Theirs again'),
          version: first.version + 1,
        },
      },
    ];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    await expect(clashHeading(page)).toHaveText('Someone saved route facts for this route first.');
    await saveDialog(page).getByRole('button', { name: 'Keep mine: Mine' }).click();
    await saveDialog(page).getByRole('button', { name: 'Save With These Choices' }).click();
    await expect(clashHeading(page)).toHaveText('Someone saved route facts again first.');
    await expect(
      saveDialog(page).getByRole('button', { name: 'Use theirs: Theirs again' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(
      saveDialog(page).getByRole('button', { name: 'Save With These Choices' }),
    ).toBeDisabled();
  });

  test('four clashes ask three at a time; the last step holds the reason and the primary', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const keys = [summaryKey, coverageKey, 'locale.working_week', 'trade.restricted_goods'];
    const base = await savedDocument(page);
    // Four edits staged on version 5, restored from the tab as a returning person would have them.
    const stage = {
      v: 1,
      baseVersion: base.version,
      facts: Object.fromEntries(
        keys.map((key) => {
          const before = base.document.facts.find((fact) => fact.key === key)!;
          return [key, { base: before, mine: { ...before, value: `Mine ${key}` } }];
        }),
      ),
      marks: {},
    };
    await page.evaluate(
      ({ tenant, route, value }) =>
        window.sessionStorage.setItem(`corridra:route-pack-stage:${tenant}:${route}`, value),
      { tenant: fixtureTenant, route: routeIds.bdCn, value: JSON.stringify(stage) },
    );
    await page.reload();
    await expect(page.getByText('Restored 4 changes that were not saved.')).toBeVisible();
    const wait = await theirs(page, (document) => ({
      ...document,
      facts: document.facts.map((fact) =>
        keys.includes(fact.key) ? { ...fact, value: `Theirs ${fact.key}` } : fact,
      ),
    }));
    world.facts!.saveScript = [{ status: 409, code: conflict, theirs: wait }];
    await reviewAndSave(page, 4);
    await fillReason(page);
    await saveFacts(page).click();
    const dialog = saveDialog(page);
    await expect(clashHeading(page)).toBeFocused();
    await expect(dialog).toContainText('Step 1 of 2: Choices · Next: Choices');
    await expect(dialog.getByRole('button', { name: /^Keep mine: / })).toHaveCount(3);
    await expect(dialog.getByRole('button', { name: 'Save With These Choices' })).toHaveCount(0);
    for (const button of await dialog.getByRole('button', { name: /^Keep mine: / }).all())
      await button.click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog).toContainText('Step 2 of 2: Choices');
    await expect(dialog.getByRole('button', { name: /^Keep mine: / })).toHaveCount(1);
    const primary = dialog.getByRole('button', { name: 'Save With These Choices' });
    await expect(primary).toBeDisabled();
    await dialog.getByRole('button', { name: 'Use theirs: ' + `Theirs ${keys[3]}` }).click();
    await expect(primary).toBeEnabled();
    await axeClean(page);
    await primary.click();
    await expect(dialog).toBeHidden();
    const sent = world.saves[1]!.body as { version: number; document: ContentDocument };
    expect(sent.version).toBe(wait.version + 1);
    const value = (key: string) => sent.document.facts.find((fact) => fact.key === key)?.value;
    expect(value(keys[0]!)).toBe(`Mine ${keys[0]}`);
    expect(value(keys[3]!)).toBe(`Theirs ${keys[3]}`);
  });

  test('a stage restored from an older version always asks, even when nothing clashes, and lists what merged and what was already saved', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const base = await savedDocument(page);
    const factOf = (key: string) => base.document.facts.find((fact) => fact.key === key)!;
    // Edited on version 4: one edit the saved version still agrees with (it merges), one the saved version already holds (it is
    // dropped).
    const stage = {
      v: 1,
      baseVersion: base.version - 1,
      facts: {
        [summaryKey]: { base: factOf(summaryKey), mine: { ...factOf(summaryKey), value: 'Mine' } },
        [coverageKey]: {
          base: { ...factOf(coverageKey), value: 'An older value' },
          mine: factOf(coverageKey),
        },
      },
      marks: {},
    };
    await page.evaluate(
      ({ tenant, route, value }) =>
        window.sessionStorage.setItem(`corridra:route-pack-stage:${tenant}:${route}`, value),
      { tenant: fixtureTenant, route: routeIds.bdCn, value: JSON.stringify(stage) },
    );
    await page.reload();
    await expect(status(page)).toHaveText('Restored 2 changes that were not saved.');
    await expect(bar(page)).toContainText('2 changes not saved');
    await reviewAndSave(page, 2);
    const banner = saveDialog(page).locator('.route-save-banner');
    await expect(banner).toBeFocused();
    await expect(banner.locator('p')).toHaveText([
      `Someone saved route facts for this route first. Their changes do not clash with yours. The latest version is ${base.version}.`,
      `Your change to ${summaryLabel} is kept. The other save did not change that fact.`,
      `The other save already includes your change to ${coverageLabel}, so nothing is left to save for it.`,
      'Check the summary, then save again.',
    ]);
    await expect(saveDialog(page)).toContainText('Added 0, changed 1, removed 0');
    expect(world.saves).toHaveLength(0);
    // Saving now is a new request on the version just read.
    await fillReason(page);
    await saveFacts(page).click();
    await expect(saveDialog(page)).toBeHidden();
    expect((world.saves[0]!.body as { version: number }).version).toBe(base.version + 1);
  });
  test('a restored stage made on an older version is never sent before a check works: the first read fails, nothing is posted, Check Again reads and asks', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const base = await savedDocument(page);
    const saved = base.document.facts.find((fact) => fact.key === summaryKey)!;
    const stage = {
      v: 1,
      baseVersion: base.version - 1,
      facts: { [summaryKey]: { base: saved, mine: { ...saved, value: 'Mine' } } },
      marks: {},
    };
    await page.evaluate(
      ({ tenant, route, value }) =>
        window.sessionStorage.setItem(`corridra:route-pack-stage:${tenant}:${route}`, value),
      { tenant: fixtureTenant, route: routeIds.bdCn, value: JSON.stringify(stage) },
    );
    await page.reload();
    await expect(status(page)).toHaveText('Restored 1 change that was not saved.');
    // The read that checks what changed fails once.
    world.facts!.failDetail = 1;
    await reviewAndSave(page, 1);
    const dialog = saveDialog(page);
    await expect(dialog.getByRole('alert')).toHaveText(
      'The latest route facts could not be read, so nothing was saved. Your changes are still here.',
    );
    // Save Facts is not offered: a stage made on the older version would land on top of the newer save.
    await expect(saveFacts(page)).toHaveCount(0);
    const again = dialog.getByRole('button', { name: 'Check Again' });
    await expect(again).toBeFocused();
    await fillReason(page);
    expect(world.saves).toHaveLength(0);
    await axeClean(page);
    await again.click();
    const banner = dialog.locator('.route-save-banner');
    await expect(banner).toBeFocused();
    await expect(banner).toContainText(
      `Someone saved route facts for this route first. Their changes do not clash with yours. The latest version is ${base.version}.`,
    );
    expect(world.saves).toHaveLength(0);
    await saveFacts(page).click();
    await expect(dialog).toBeHidden();
    expect(world.saves).toHaveLength(1);
    expect((world.saves[0]!.body as { version: number }).version).toBe(base.version + 1);
  });

  test('while Save With These Choices is in flight, Cancel and the choices are locked', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const wait = await theirs(page, (document) => withFact(document, summaryKey, 'Theirs'));
    world.facts!.saveScript = [{ status: 409, code: conflict, theirs: wait }];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    const dialog = saveDialog(page);
    await expect(clashHeading(page)).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep mine: Mine' }).click();
    // The next send waits, then fails: the dialog stays, every control comes back.
    world.facts!.saveScript = [{ status: 500, delay: 1500 }];
    await dialog.getByRole('button', { name: 'Save With These Choices' }).click();
    await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Keep mine: Mine' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Use theirs: Theirs' })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Not saved. Your changes are still here. Try again.',
    );
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Keep mine: Mine' })).toBeEnabled();
  });

  test('a 409 on Save With These Choices whose re-read fails leaves no dead Save button: Check Again takes focus and reads again', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const wait = await theirs(page, (document) => withFact(document, summaryKey, 'Theirs'));
    world.facts!.saveScript = [{ status: 409, code: conflict, theirs: wait }];
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    const dialog = saveDialog(page);
    await expect(clashHeading(page)).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep mine: Mine' }).click();
    // Someone saves again, and the read that would show it fails once.
    const again = {
      document: withFact(wait.document, summaryKey, 'Theirs again'),
      version: wait.version + 1,
    };
    world.facts!.saveScript = [{ status: 409, code: conflict, theirs: again }];
    world.facts!.failDetail = 1;
    await dialog.getByRole('button', { name: 'Save With These Choices' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'The latest route facts could not be read, so nothing was saved. Your changes are still here.',
    );
    await expect(dialog.getByRole('button', { name: 'Save With These Choices' })).toHaveCount(0);
    await expect(saveFacts(page)).toHaveCount(0);
    const check = dialog.getByRole('button', { name: 'Check Again' });
    await expect(check).toBeFocused();
    expect(world.saves).toHaveLength(2);
    await check.click();
    await expect(clashHeading(page)).toHaveText('Someone saved route facts again first.');
    await expect(clashHeading(page)).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Use theirs: Theirs again' })).toBeVisible();
    expect(world.saves).toHaveLength(2);
  });
});

test.describe('after a save', () => {
  test('a new edit made before the route is read again stands on the version just saved: no false conflict, sent as the next version', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const before = await savedDocument(page);
    await stageSummary(page, 'First');
    await reviewAndSave(page);
    await fillReason(page);
    // The reads of the route that follow the save fail, so the page still holds the version before it.
    world.facts!.failDetail = 5;
    await saveFacts(page).click();
    await expect(status(page)).toHaveText(
      `Saved. Route facts are now version ${before.version + 1}.`,
    );
    await stageSummary(page, 'Second');
    await reviewAndSave(page);
    const dialog = saveDialog(page);
    await expect(dialog).toContainText('This saves a new version of the facts');
    await expect(dialog).not.toContainText('Someone saved');
    await expect(dialog).not.toContainText('Not saved');
    await expect(dialog).not.toContainText('could not be read');
    await fillReason(page);
    await saveFacts(page).click();
    await expect(dialog).toBeHidden();
    expect(world.saves).toHaveLength(2);
    expect((world.saves[1]!.body as { version: number }).version).toBe(before.version + 2);
    await expect(status(page)).toHaveText(
      `Saved. Route facts are now version ${before.version + 2}.`,
    );
  });

  test('a failed read of the Routes list after a save keeps the open route and its Saved line', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    const before = await savedDocument(page);
    await stageSummary(page, 'Saved once');
    await reviewAndSave(page);
    await fillReason(page);
    world.facts!.overview = 500;
    const listRead = page.waitForResponse(
      (response) =>
        response.url().includes('route-pack-overview') && !response.url().includes('routeId='),
    );
    await saveFacts(page).click();
    expect((await listRead).status()).toBe(500);
    // Two frames after the answer: whatever it changes has been drawn.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(editor(page)).toBeVisible();
    await expect(status(page)).toHaveText(
      `Saved. Route facts are now version ${before.version + 1}.`,
    );
    await expect(rowOf(page, summaryLabel)).toContainText('Saved once');
  });

  test('a save that lands after the person went to another route still clears the edits and the tab copy: nothing comes back as Restored', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=1', facts: {} });
    // In one page: to the other route by its link, and Back, so Forward later leaves this route while the save is out.
    await page
      .getByRole('link', { name: /^Bangladesh to European Union/ })
      .first()
      .click();
    await expect(page).toHaveURL(/route=BD-EU/);
    await page.goBack();
    await expect(page).toHaveURL(/route=BD-CN/);
    await expect(rows(page).first()).toBeVisible();
    await stageSummary(page, 'Saved while away');
    await reviewAndSave(page);
    await fillReason(page);
    // The answer waits, and meanwhile the person goes Forward to the other route (Back and Forward are never blocked).
    world.facts!.saveScript = [{ status: 201, delay: 1500 }];
    await saveFacts(page).click();
    await page.goForward();
    await expect(page).toHaveURL(/route=BD-EU/);
    await expect(editor(page).getByRole('heading', { level: 2 })).toContainText('European Union');
    await expect.poll(() => world.saves.length).toBe(1);
    await expect.poll(() => stageKeys(page), { timeout: 5000 }).toEqual([]);
    await page.goBack();
    await expect(page).toHaveURL(/route=BD-CN/);
    await expect(rows(page).first()).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await expect(editor(page)).not.toContainText('Restored');
  });

  test('a dialog with a long title at 320 keeps Close whole on one line', async ({ page }) => {
    await open(page, { width: 320, height: 568, query: 'route=BD-CN&section=1' });
    await stageSummary(page);
    const fold = page.locator('.settings-routes-fold > summary');
    if (await fold.isVisible()) await fold.click();
    await page
      .getByRole('link', { name: /^Bangladesh to European Union/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'You Have Changes That Are Not Saved' });
    await expect(dialog).toBeVisible();
    const close = dialog.locator('.ux-dialog-close');
    await expect(close).toHaveText('Close');
    // One line: the word is never broken ("Clo / se"), and the button keeps its 44 px target.
    const size = await close.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
      return { lines: lines.size, height: button.getBoundingClientRect().height };
    });
    expect(size.lines).toBe(1);
    expect(size.height).toBeGreaterThanOrEqual(44);
    await axeClean(page);
  });
});

// ---- Discard, leave, the tab's copy ------------------------------------------------------------------------------------------------

test.describe('Discard Changes and leaving the route', () => {
  test('Discard Changes asks, focuses Keep Editing, and Keep Editing changes nothing; Discard removes the edits and the copy', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    await stageSummary(page);
    expect(await stageKeys(page)).toHaveLength(1);
    await bar(page).getByRole('button', { name: 'Discard Changes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard Changes' });
    await expect(dialog).toContainText(
      'This removes 1 change that is not saved. The saved facts stay as they are.',
    );
    await expect(dialog.getByRole('button', { name: 'Keep Editing' })).toBeFocused();
    await axeClean(page);
    await dialog.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(bar(page)).toContainText('1 change not saved');
    await expect(bar(page).getByRole('button', { name: 'Discard Changes' })).toBeFocused();
    await bar(page).getByRole('button', { name: 'Discard Changes' }).click();
    await dialog.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(bar(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('Changes discarded.');
    await expect(status(page)).toBeFocused();
    expect(await stageKeys(page)).toEqual([]);
    await expect(rowOf(page, summaryLabel)).not.toContainText('Mine');
  });

  test('moving to another route asks first: Keep Editing is focused; Leave Route goes, keeps the copy, and coming back offers the edits again', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    await stageSummary(page);
    // The list folds at this width; the other route's name is a link in it.
    const other = page.getByRole('link', { name: /^Bangladesh to European Union/ });
    await other.click();
    const dialog = page.getByRole('dialog', { name: 'You Have Changes That Are Not Saved' });
    // The copy is kept, so the dialog never says the edits are removed (spec 9, amended after the designer audit).
    await expect(dialog).toContainText(
      'Leaving this route puts your 1 unsaved change aside. Your saved facts are not affected.',
    );
    await expect(dialog).toContainText('Your changes are kept for this tab session.');
    await expect(dialog).not.toContainText('removes');
    await expect(dialog.getByRole('button', { name: 'Keep Editing' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).searchParams.get('route')).toBe('BD-CN');
    await expect(bar(page)).toContainText('1 change not saved');
    await other.click();
    await dialog.getByRole('button', { name: 'Leave Route' }).click();
    await expect(page).toHaveURL(/route=BD-EU/);
    await expect(editor(page).getByRole('heading', { level: 2 })).toContainText('European Union');
    await expect(bar(page)).toHaveCount(0);
    expect(await stageKeys(page)).toHaveLength(1);
    // Back to the first route: the edits come back and say so.
    await page.getByRole('link', { name: /^Bangladesh to China/ }).click();
    await expect(page).toHaveURL(/route=BD-CN/);
    await expect(status(page)).toHaveText('Restored 1 change that was not saved.');
    await expect(bar(page)).toContainText('1 change not saved');
    // The edit is on the row it was made on, in its section.
    await editor(page)
      .getByRole('radio', { name: /^All Sections/ })
      .click();
    await editor(page)
      .getByRole('link', { name: new RegExp(`^${sectionOf(summaryKey)}\\. `) })
      .click();
    await expect(rowOf(page, summaryLabel)).toContainText('Mine');
    await expect(rowOf(page, summaryLabel)).toContainText('Changed, not saved');
  });

  test('Back and Forward are never blocked, a view change is not asked, and the browser asks before closing only while something is staged', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    const askBeforeClosing = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await askBeforeClosing()).toBe(false);
    await stageSummary(page);
    expect(await askBeforeClosing()).toBe(true);
    // A move inside the route goes straight through, with the edit kept.
    await editor(page)
      .getByRole('radio', { name: /^All Sections/ })
      .click();
    await expect(page).toHaveURL(/view=sections/);
    await expect(bar(page)).toContainText('1 change not saved');
    await page.goBack();
    await expect(page).toHaveURL(/section=1/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rowOf(page, summaryLabel)).toContainText('Mine');
    await bar(page).getByRole('button', { name: 'Discard Changes' }).click();
    await page
      .getByRole('dialog', { name: 'Discard Changes' })
      .getByRole('button', { name: 'Discard Changes' })
      .click();
    expect(await askBeforeClosing()).toBe(false);
  });

  test('an open answer that was changed and not kept also asks before leaving, and Review and Save will not drop it silently', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-CN&section=1' });
    await stageSummary(page);
    await editButton(page, coverageLabel).click();
    await group(page, coverageLabel).getByRole('textbox').first().fill('Half written');
    await bar(page).getByRole('button', { name: 'Review and Save (1)' }).click();
    await expect(status(page)).toHaveText(
      `${coverageLabel} is still open and is not included. Keep Change on it first to add it.`,
    );
    await expect(group(page, coverageLabel).getByRole('button', { name: 'Filled' })).toBeFocused();
    await expect(saveDialog(page)).toHaveCount(0);
    // Another Edit while this one is changed is refused in words too.
    await editButton(page, summaryLabel).click();
    await expect(status(page)).toHaveText('Keep Change or Cancel this field first.');
    await expect(group(page, summaryLabel)).toHaveCount(0);
    // Cancel gives the row back, with focus on its Edit.
    await group(page, coverageLabel).getByRole('button', { name: 'Cancel' }).click();
    await expect(editButton(page, coverageLabel)).toBeFocused();
    await expect(rowOf(page, coverageLabel)).not.toContainText('Half written');
  });

  test('a tab storage that throws changes nothing: the editor edits and saves as before', async ({
    page,
  }) => {
    const world = await open(page, {
      query: 'route=BD-CN&section=1',
      init: () => {
        for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
          const original = Storage.prototype[method] as (...args: string[]) => unknown;
          Storage.prototype[method] = function (this: Storage, ...args: string[]) {
            if (String(args[0]).startsWith('corridra:route-pack-stage:'))
              throw new Error('blocked');
            return original.apply(this, args);
          } as never;
        }
      },
    });
    await stageSummary(page);
    await reviewAndSave(page);
    await fillReason(page);
    await saveFacts(page).click();
    await expect(saveDialog(page)).toBeHidden();
    await expect(status(page)).toContainText('Saved. Route facts are now version 6.');
    expect(world.saves).toHaveLength(1);
  });

  test('switch off: no request to route-pack-facts, no stage key in the tab and no editor', async ({
    page,
  }) => {
    const world = await open(page, { facts: null, query: 'route=BD-CN' });
    await expect(page.locator('#workspace-settings .settings-routes li')).toHaveCount(3);
    await expect(editor(page)).toHaveCount(0);
    expect(await stageKeys(page)).toEqual([]);
    expect(world.asked.filter((line) => line.includes('route-pack-facts'))).toEqual([]);
    expect(world.saves).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.outerHTML.includes('Review and Save')),
    ).toBe(false);
  });
});

// ---- The words of the refusals, one by one ----------------------------------------------------------------------------------------

test.describe('inline refusals: each in its words, with focus on the first invalid control', () => {
  const email =
    'This looks like an email address. Route facts name organisations, places and rules, never people. Remove it.';
  async function openField(page: Page, key: string, query?: string) {
    await open(page, { query: query ?? `route=BD-CN&section=${sectionOf(key)}` });
    await showAll(page);
    await editButton(page, labelOf(key)).click();
    return group(page, labelOf(key));
  }
  const alertOf = (box: Locator) => box.getByRole('alert');

  test('text: the counter, the limit as one types, the minimum and an email address', async ({
    page,
  }) => {
    const box = await openField(page, 'identity.display_name');
    const input = box.getByRole('textbox').first();
    await input.fill('ab');
    await expect(box.getByText('2 of 120')).toBeVisible();
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(alertOf(box)).toHaveText('Write at least 3 characters.');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = await input.getAttribute('aria-describedby');
    expect(described).toContain((await alertOf(box).getAttribute('id'))!);
    // Typing again takes the refusal away; the limit shows as one types, no maxlength stops it.
    await input.fill('x'.repeat(130));
    await expect(alertOf(box)).toHaveText('That is 130 characters. The limit is 120. Shorten it.');
    await expect(input).not.toHaveAttribute('maxlength', /.*/);
    await input.fill('Write to a@b.example');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(alertOf(box)).toHaveText(email);
    await axeClean(page);
  });

  test('Not applicable: a reason is needed and counted; the words say why', async ({ page }) => {
    const box = await openField(page, optionalText.key);
    await box.getByRole('button', { name: 'Not applicable', exact: true }).click();
    await expect(box.getByText('0 of 1000')).toBeVisible();
    await box.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(alertOf(box)).toHaveText('Say why this does not apply to this route.');
    await expect(box.getByRole('textbox', { name: 'Reason' })).toBeFocused();
    await box.getByRole('textbox', { name: 'Reason' }).fill('Not part of this route');
    await box.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(group(page, optionalText.label)).toHaveCount(0);
    await expect(rowOf(page, optionalText.label)).toContainText(
      'Not applicable: Not part of this route',
    );
    await expect(bar(page)).toContainText('1 change not saved');
  });

  test('number: whole days with a minimum of 0, a number in words, and the control keeps the standard minimum', async ({
    page,
  }) => {
    const key = 'travel.visa_lead_time_days';
    const box = await openField(page, key);
    const input = box.getByRole('spinbutton');
    await expect(input).toHaveAttribute('min', '0');
    await expect(input).toHaveAttribute('step', '1');
    await input.fill('2.5');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    // The number field draws its own refusal line (a polite live region under the field).
    await expect(box.getByText('Use a whole number.')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('30');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(box.getByText('Step 2 of 2: Source')).toBeFocused();
  });

  test('link, a list with its entry named, and the | sign', async ({ page }) => {
    let box = await openField(page, 'trade.customs_link');
    await box.getByRole('textbox').first().fill('customs.example.org');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(alertOf(box)).toHaveText('Give a web address that starts with https://.');
    await box.getByRole('button', { name: 'Cancel' }).click();
    box = await openField(page, 'locale.public_holidays', 'route=BD-CN&section=3');
    await box.getByRole('textbox', { name: 'Entry 1' }).fill('2027-01-01 New Year');
    await box.getByRole('button', { name: 'Add Another' }).click();
    await expect(box.getByRole('textbox', { name: 'Entry 2' })).toBeFocused();
    await box.getByRole('textbox', { name: 'Entry 2' }).fill('not a date');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(alertOf(box)).toContainText('Check entry 2.');
    await expect(box.getByRole('textbox', { name: 'Entry 2' })).toBeFocused();
    await expect(box.getByRole('textbox', { name: 'Entry 1' })).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await box.getByRole('textbox', { name: 'Entry 2' }).fill('a|b');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(alertOf(box)).toHaveText(
      'Do not use the | sign in an entry. The route file uses it to separate values.',
    );
    // Remove names the entry and puts focus on the one before.
    await box.getByRole('button', { name: 'Remove entry 2' }).click();
    await expect(box.getByRole('textbox', { name: 'Entry 1' })).toBeFocused();
    await expect(box.getByRole('button', { name: /^Remove entry/ })).toHaveCount(0);
    await axeClean(page);
  });

  test('money (a custom field): decimals as one types, in the currency, and the amount kept exactly', async ({
    page,
  }) => {
    const box = await openField(page, 'events.trade_fairs', 'route=BD-CN&section=5');
    await box.getByRole('button', { name: 'Cancel' }).click();
    await showAll(page);
    await editButton(page, 'Typical stand cost').click();
    const money = group(page, 'Typical stand cost');
    await expect(money.getByRole('combobox', { name: 'Currency' })).toHaveValue('USD');
    const amount = money.getByRole('textbox', { name: /^Amount \(/ });
    await expect(amount).toHaveValue('45.00');
    await amount.fill('45.001');
    await expect(money.getByRole('alert')).toHaveText('Use at most 2 decimals for USD.');
    await money.getByRole('combobox', { name: 'Currency' }).selectOption('JPY');
    await amount.fill('1200.5');
    await expect(money.getByRole('alert')).toHaveText('Use a whole amount for JPY.');
    await money.getByRole('combobox', { name: 'Currency' }).selectOption('USD');
    await amount.fill('50.5');
    await expect(money.getByText('Amount: USD 50.50')).toBeVisible();
    // A custom field has a third answer, Remove Field, and no Pending.
    await expect(money.getByRole('button', { name: 'Remove Field', exact: true })).toBeVisible();
    await expect(money.getByRole('button', { name: 'Pending', exact: true })).toHaveCount(0);
    await money.getByRole('button', { name: 'Next', exact: true }).click();
    await money.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(rowOf(page, 'Typical stand cost')).toContainText('USD 50.50');
  });

  test('the source and the dates: an address, an observed day in the future, a valid until before it, a day that has passed', async ({
    page,
  }) => {
    const box = await openField(page, optionalText.key);
    await box.getByRole('textbox').first().fill('Fine');
    await box.getByRole('button', { name: 'Next', exact: true }).click();
    await box.getByRole('button', { name: 'A web address', exact: true }).click();
    const address = box.getByRole('textbox', { name: 'Web address' });
    await expect(address).toHaveAttribute('placeholder', 'https://');
    await address.fill('example.org');
    await box.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(alertOf(box)).toHaveText(
      'Give a web address that starts with https://, or choose Staff knowledge.',
    );
    await expect(address).toBeFocused();
    await address.fill('https://example.org/rules');
    await box.getByLabel('Valid until (optional)').fill('2020-01-01');
    await expect(box.getByText('This date has passed, so the fact stays Stale.')).toBeVisible();
    await box.getByLabel('Observed on').fill('2021-01-01');
    await box.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(alertOf(box)).toHaveText('Valid until must be on or after the observed date.');
    await expect(box.getByLabel('Valid until (optional)')).toBeFocused();
    await expect(box.getByLabel('Observed on')).toHaveAttribute('max', /^\d{4}-\d{2}-\d{2}$/);
    await axeClean(page);
  });
});

// ---- Custom fields and covered rows ---------------------------------------------------------------------------------------------------

test.describe('a custom field row and a row under a section marked Not applicable', () => {
  test('Remove Field is staged, listed as Removed without "now Pending", saved without the fact, and Undo Change brings it back', async ({
    page,
  }) => {
    const world = await open(page, { query: 'route=BD-CN&section=5' });
    await showAll(page);
    await editButton(page, 'Typical stand cost').click();
    const box = group(page, 'Typical stand cost');
    await box.getByRole('button', { name: 'Remove Field', exact: true }).click();
    await expect(
      box.getByText(
        'This field is no longer listed on this route after you save. Earlier versions keep it.',
      ),
    ).toBeVisible();
    await expect(box.getByRole('button', { name: 'Keep Change', exact: true })).toBeVisible();
    await expect(box.getByText('Step 1 of 1: Answer')).toBeVisible();
    await box.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(rowOf(page, 'Typical stand cost')).toContainText('Changed, not saved');
    await expect(rowOf(page, 'Typical stand cost')).toContainText('Not filled yet');
    await reviewAndSave(page);
    await expect(saveDialog(page)).toContainText('Removed: Typical stand cost');
    await expect(saveDialog(page)).not.toContainText('(now Pending)');
    await fillReason(page);
    await saveFacts(page).click();
    await expect(saveDialog(page)).toBeHidden();
    const sent = world.saves[0]!.body as { document: ContentDocument };
    expect(sent.document.facts.some((fact) => fact.key === 'custom.fair_stand_cost')).toBe(false);
    // Undo before saving: nothing is left staged.
    await open(page, { query: 'route=BD-CN&section=5' });
    await showAll(page);
    await editButton(page, 'Typical stand cost').click();
    await group(page, 'Typical stand cost')
      .getByRole('button', { name: 'Remove Field', exact: true })
      .click();
    await group(page, 'Typical stand cost')
      .getByRole('button', { name: 'Keep Change', exact: true })
      .click();
    await rowOf(page, 'Typical stand cost')
      .getByRole('button', { name: 'Undo Change to Typical stand cost' })
      .click();
    await expect(rowOf(page, 'Typical stand cost')).toContainText('USD 45.00');
    await expect(bar(page)).toHaveCount(0);
  });

  test('under a section marked Not applicable Pending is not offered and the row says why', async ({
    page,
  }) => {
    await open(page, { query: 'route=BD-EU&section=3' });
    await showAll(page);
    const content = standardFieldsV1.find(
      (f) => f.section === 3 && f.part === 'Content' && f.core,
    )!;
    await editButton(page, content.label).click();
    const box = group(page, content.label);
    await expect(box.getByRole('button', { name: 'Pending', exact: true })).toHaveCount(0);
    await expect(box.getByRole('button', { name: 'Filled', exact: true })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Not applicable', exact: true })).toBeVisible();
    await expect(
      box.getByText(
        'This section is marked Not applicable. Unmark the section to make this field Pending.',
      ),
    ).toBeVisible();
    await axeClean(page);
  });
});

// ---- Warn only ------------------------------------------------------------------------------------------------------------------------

test.describe('a Core fact turned Pending on a live route is a caution, never a refusal', () => {
  test('the row editor and the save dialog say so before saving, and the words of the server follow the save', async ({
    page,
  }) => {
    const world = await open(page, {
      query: 'route=BD-CN&section=1',
      facts: { saveWarnings: [{ code: 'ROUTE_PACK_CORE_TURNS_PENDING', keys: [summaryKey] }] },
    });
    const words = `These Core fields are now Pending on a live route: ${summaryLabel}. This does not mean the route is cleared.`;
    await editButton(page, summaryLabel).click();
    const box = group(page, summaryLabel);
    await box.getByRole('button', { name: 'Pending', exact: true }).click();
    await expect(
      box.getByText(
        'Pending clears the saved value from the next version. Earlier versions keep it.',
      ),
    ).toBeVisible();
    await expect(box.getByRole('status').filter({ hasText: words })).toBeVisible();
    // Nothing is disabled.
    await expect(box.getByRole('button', { name: 'Keep Change', exact: true })).toBeEnabled();
    await axeClean(page);
    await box.getByRole('button', { name: 'Keep Change', exact: true }).click();
    await expect(rowOf(page, summaryLabel)).toContainText('Pending');
    await reviewAndSave(page);
    await expect(saveDialog(page)).toContainText(`Removed: ${summaryLabel} (now Pending)`);
    await expect(saveDialog(page).getByRole('status').filter({ hasText: words })).toBeVisible();
    await fillReason(page);
    await saveFacts(page).click();
    await expect(saveDialog(page)).toBeHidden();
    expect(world.saves).toHaveLength(1);
    expect(
      (world.saves[0]!.body as { document: ContentDocument }).document.facts.some(
        (f: ContentFact) => f.key === summaryKey,
      ),
    ).toBe(false);
    await expect(status(page)).toContainText('Saved. Route facts are now version 6.');
    await expect(status(page)).toContainText(words);
  });
});

// ---- Widths ------------------------------------------------------------------------------------------------------------------------

const widths = [320, 390, 768, 1024, 1440, 1920];
const box = async (locator: Locator) => (await locator.boundingBox())!;
test.describe('widths: no sideways scroll, axe clean, targets, the bar never covers what has focus', () => {
  for (const width of widths) {
    test(`at ${width}: an open row, the unsaved bar and the save dialog`, async ({ page }) => {
      await open(page, { width, height: width < 700 ? 800 : 900, query: 'route=BD-CN' });
      await expect(rows(page).first()).toBeVisible();
      // Edit is a 44 px target up to 768 px and compact (28 px) from 1440 px.
      const edit = editor(page)
        .getByRole('button', { name: /^Edit / })
        .first();
      const editHeight = (await box(edit)).height;
      test
        .info()
        .annotations.push({ type: 'edit-height', description: `${width}: ${editHeight} px` });
      // 1024 is stacked (a region under 56 rem) and 1440 side by side: 44 px stacked, compact from 1440 px.
      expect(editHeight).toBeGreaterThanOrEqual(width >= 1440 ? 28 : width === 1024 ? 36 : 44);
      await noSidewaysScroll(page);
      await axeClean(page);
      // The row editor: the answers are rows of 64 px on a phone and 72 px from 768 px.
      await edit.click();
      const editing = page.getByRole('group', { name: /^Edit / });
      const answer = editing.getByRole('button', { name: 'Filled', exact: true });
      const answerHeight = (await box(answer)).height;
      test
        .info()
        .annotations.push({ type: 'answer-height', description: `${width}: ${answerHeight} px` });
      // 64 px on a phone and 72 px at 768; from 1024 px the desk's laptop density applies (a row is still above 44 px).
      expect(answerHeight).toBeGreaterThanOrEqual(width >= 1024 ? 44 : width >= 768 ? 72 : 64);
      await noSidewaysScroll(page);
      await axeClean(page);
      await editing
        .getByRole('textbox')
        .first()
        .fill('An answer that is long enough to wrap on a narrow screen and keep wrapping');
      await editing.getByRole('button', { name: 'Next', exact: true }).click();
      await noSidewaysScroll(page);
      await editing.getByRole('button', { name: 'Keep Change', exact: true }).click();
      // The bar: 60 px at least, one line of count and actions from a wide region, growing as the words wrap.
      await expect(bar(page)).toBeVisible();
      const barBox = await box(bar(page));
      test.info().annotations.push({
        type: 'bar-height',
        description: `${width}: ${Math.round(barBox.height)} px`,
      });
      expect(barBox.height).toBeGreaterThanOrEqual(60);
      // 44 px targets up to 1023 px; from 1024 px the desk's laptop density (a 36 px control) applies.
      for (const button of await bar(page).getByRole('button').all())
        expect((await box(button)).height).toBeGreaterThanOrEqual(width >= 1024 ? 36 : 44);
      // A control that takes focus by keyboard is not under the bar. The first Edit below the window is scrolled to stand just
      // behind the bar (the bar stands over the list there; the last row is never under it, the bar being the editor's last
      // block), then reached with Tab: the page must move it clear of the bar.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const edits = editor(page).getByRole('button', { name: /^Edit / });
      const fold = page.viewportSize()!.height;
      let target = edits.last();
      for (const candidate of await edits.all())
        if ((await box(candidate)).y > fold) {
          target = candidate;
          break;
        }
      const before = await box(target);
      await page.evaluate(
        (top) => window.scrollTo({ top, behavior: 'instant' }),
        Math.ceil(before.y + before.height - fold + 8),
      );
      // A script's focus() does not scroll; Shift Tab then Tab reaches the same button as a person would.
      await target.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(target).toBeFocused();
      // The page may scroll smoothly to what has focus, so the position is read once it has settled.
      await expect
        .poll(async () => {
          const [focused, now] = [await box(target), await box(bar(page))];
          return Math.round(now.y - (focused.y + focused.height));
        })
        .toBeGreaterThanOrEqual(-1);
      await noSidewaysScroll(page);
      await axeClean(page);
      await noRepeatedLinks(page);
      // The save dialog fits the window and its primary can be reached.
      await bar(page).getByRole('button', { name: 'Review and Save (1)' }).click();
      const dialog = saveDialog(page);
      await dialog.getByRole('textbox', { name: 'Reason' }).fill('Because the team confirmed it');
      const dialogBox = await box(dialog);
      expect(dialogBox.width).toBeLessThanOrEqual(width - 31);
      if (width === 320 || width === 390) expect(dialogBox.width).toBeGreaterThan(width - 40);
      await saveFacts(page).scrollIntoViewIfNeeded();
      const primary = await box(saveFacts(page));
      expect(primary.y + primary.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await noSidewaysScroll(page);
      await axeClean(page);
    });
  }

  test('the save dialog at 320 by 568 scrolls inside itself and keeps the primary after the reason', async ({
    page,
  }) => {
    await open(page, { width: 320, height: 568, query: 'route=BD-CN&section=1' });
    await stageSummary(page);
    await reviewAndSave(page);
    const dialog = saveDialog(page);
    const dialogBox = await box(dialog);
    expect(dialogBox.height).toBeLessThanOrEqual(568);
    expect(dialogBox.width).toBeLessThanOrEqual(320);
    const reason = await box(dialog.getByRole('textbox', { name: 'Reason' }));
    const primary = await box(saveFacts(page));
    expect(primary.y).toBeGreaterThan(reason.y);
    await saveFacts(page).scrollIntoViewIfNeeded();
    await expect(saveFacts(page)).toBeInViewport();
    await noSidewaysScroll(page);
    await axeClean(page);
  });

  test('text at 200 percent: nothing scrolls sideways and the bar grows with its words', async ({
    page,
  }) => {
    await open(page, { width: 1280, height: 900, query: 'route=BD-CN&section=1' });
    await stageSummary(page);
    const normal = (await box(bar(page))).height;
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await expect(bar(page)).toBeVisible();
    const larger = (await box(bar(page))).height;
    test.info().annotations.push({
      type: 'bar-200',
      description: `${Math.round(normal)} -> ${Math.round(larger)} px`,
    });
    expect(larger).toBeGreaterThan(normal);
    await noSidewaysScroll(page);
    await reviewAndSave(page);
    await noSidewaysScroll(page);
    await axeClean(page);
  });

  test('a long word in any script wraps and values keep their own direction', async ({ page }) => {
    await open(page, { width: 320, query: 'route=BD-CN&section=1' });
    await showAll(page);
    await editButton(page, summaryLabel).click();
    const input = group(page, summaryLabel).getByRole('textbox').first();
    await expect(input).toHaveAttribute('dir', 'auto');
    await input.fill(
      '孟加拉国到中国：样品供应商路线 مسار تجريبي ' + 'বাংলাদেশ'.repeat(12) + ' ' + 'x'.repeat(80),
    );
    await noSidewaysScroll(page);
    await group(page, summaryLabel).getByRole('button', { name: 'Next', exact: true }).click();
    await group(page, summaryLabel)
      .getByRole('button', { name: 'Keep Change', exact: true })
      .click();
    await noSidewaysScroll(page);
    await expect(rowOf(page, summaryLabel).locator('.ux-fact-value')).toHaveAttribute(
      'dir',
      'auto',
    );
    await axeClean(page);
  });

  test('Edit adds at most one wrapped line to a row side by side, and the route region stays inside its budget (900 px side by side, 1688 px stacked)', async ({
    page,
  }) => {
    for (const width of widths) {
      const measure = async (role: string, route: string) => {
        await open(page, { role, width, query: `route=${route}` });
        await expect(rows(page).first()).toBeVisible();
        const found = await editor(page)
          .locator('li.ux-fact-row:visible')
          .evaluateAll((items) =>
            items.map((item) => {
              const mark = item.querySelector('.ux-fact-state > .ux-fact-mark');
              const action = item.querySelector('.ux-fact-state > .ux-fact-action');
              const [m, a] = [mark?.getBoundingClientRect(), action?.getBoundingClientRect()];
              return {
                height: Math.round(item.getBoundingClientRect().height),
                label:
                  (item.querySelector('.ux-fact-label') as HTMLElement | null)?.innerText ?? '',
                // The action stands in the line of the state mark: its middle is within the mark (null: the row has no action).
                onMarkLine:
                  m && a ? a.top + a.height / 2 > m.top && a.top + a.height / 2 < m.bottom : null,
              };
            }),
          );
        const shell = page.locator('.settings-routes-shell');
        return {
          heights: found.map((row) => row.height),
          rows: found,
          region: Math.round((await box(editor(page))).height),
          wide: (await shell.getAttribute('data-wide')) === 'true',
        };
      };
      // Bangladesh to China is the route PR 1 measured (859 px side by side); Taiwan to Australia has eight To Do rows.
      for (const route of ['BD-CN', 'TW-AU']) {
        const withEdit = await measure('owner', route);
        // What is measured is the owner's route with its Edit buttons.
        await expect(
          editor(page)
            .getByRole('button', { name: /^Edit / })
            .first(),
        ).toBeVisible();
        const without = await measure('admin', route);
        // Side by side Edit stands in the state line right after the state mark, where the line always has room, so whatever the
        // font it never takes a line of its own (after a long stale mark it once did, on CI's metrics, by 40 px): a row grows at most
        // by the button's height over the text line. Stacked it may take a line of its own under the value, which is why the
        // stacked budget has room.
        if (withEdit.wide)
          withEdit.rows.forEach((row, index) => {
            const where = `${route} at ${width}, row ${index} (${row.label.split('\n')[0]})`;
            if (row.onMarkLine !== null) expect(row.onMarkLine, where).toBe(true);
            expect(row.height, where).toBeLessThanOrEqual(without.heights[index]! + 16);
          });
        test.info().annotations.push({
          type: `region-${route}`,
          description: `${width}: ${withEdit.region} px with Edit (owner), ${without.region} px read only (admin, with its note); ${withEdit.wide ? 'side by side' : 'stacked'}`,
        });
        // Only the route PR 1 measured is held to the length budget: eight rows of a route with nothing saved are longer than it by
        // design, and Edit is not what makes them so.
        if (route === 'BD-CN')
          expect(withEdit.region).toBeLessThanOrEqual(withEdit.wide ? 900 : 1688);
        await noSidewaysScroll(page);
      }
    }
  });
});
