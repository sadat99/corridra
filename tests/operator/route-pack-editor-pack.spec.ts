import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startP5cFixture } from './p5c-desk-fixture';
import { answerReads, type FactsWorld, type World } from './p5c-desk-world';
import { answerPublish, type PublishWorld } from './route-pack-publish-world';
import { standardFieldsV1 } from '../../packages/domain/src/route-pack-standard';

// ADR-093 Phase 3, PR 3b: the pack dialogs of the route pack editor (docs/revamp/specs/route-pack-editor.md, sections 8.9, 10,
// 11.1 to 11.5 and 17A), measured with the real stylesheets in the desk fixture. route-pack-publish is answered by the publish
// world, which does what the server does unless a test scripts an answer. Bangladesh to China has pack version 2, Active, with
// Core fields still Pending.
let fixture: Awaited<ReturnType<typeof startP5cFixture>>;
test.beforeAll(async () => {
  fixture = await startP5cFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const previewReason = 'Preview of a pack change';
const reasonText = 'Added Chinese after the buyers asked for it';
const lockedFields = standardFieldsV1.filter((field) => field.configurationKey);
const labelOfConfig = (key: string) =>
  lockedFields.find((field) => field.configurationKey === key)!.label;

type Options = {
  role?: string;
  width?: number;
  height?: number;
  facts?: FactsWorld | null;
  publish?: Partial<PublishWorld>;
  totp?: 'ok' | 'bad';
  /** The route opened; Bangladesh to China by default. */
  route?: string;
};
async function open(page: Page, options: Options = {}) {
  const { role = 'owner', width = 1440, height = 900 } = options;
  await page.setViewportSize({ width, height });
  const facts = options.facts === null ? undefined : (options.facts ?? {});
  const given: Partial<World> = { role, ...(facts ? { facts } : {}) };
  if (options.totp) given.totp = options.totp;
  const world = await answerReads(page, given);
  const publish = facts ? await answerPublish(page, facts, options.publish) : null;
  const words = new URLSearchParams({
    workspace: fixtureTenant,
    v41: 'on',
    role,
    reports: 'on',
    applications: 'on',
    route: options.route ?? 'BD-CN',
    view: 'sections',
  });
  await page.goto(`${fixture.origin}/operator/settings?${words}`);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
  if (facts)
    await expect(
      editor(page).getByText(options.route === 'TW-AU' ? 'No pack yet' : 'Pack version 2', {
        exact: true,
      }),
    ).toBeVisible();
  return { world, publish: publish!, facts: facts! };
}
const editor = (page: Page) => page.locator('section.route-editor');
const status = (page: Page) => editor(page).locator('.route-editor-status');
const section = (page: Page, number: number) => {
  const url = new URL(page.url());
  url.searchParams.delete('view');
  url.searchParams.set('section', String(number));
  return page.goto(url.toString());
};
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const settingDialog = (page: Page) => dialog(page, 'Change Pack Setting');
const statusDialog = (page: Page) => dialog(page, 'Change Pack Status');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function openLanguages(page: Page) {
  await section(page, 3);
  await button(page, `Change ${labelOfConfig('languages')}`).click();
  await expect(settingDialog(page)).toBeVisible();
}
async function toReview(page: Page) {
  await settingDialog(page).getByRole('checkbox', { name: 'Chinese' }).check();
  await settingDialog(page).getByRole('button', { name: 'Next' }).click();
  await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
}
const reason = (page: Page, name = 'Change Pack Setting') =>
  dialog(page, name).getByRole('textbox', { name: 'Reason' });
const stepUpDialog = (page: Page) => page.getByRole('dialog', { name: 'Confirm it is you' });
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

test.describe('who sees the pack controls', () => {
  test('the owner sees Change on every pack setting and Change Pack Status', async ({ page }) => {
    await open(page);
    await expect(button(page, 'Change Pack Status')).toBeVisible();
    for (const number of [...new Set(lockedFields.map((field) => field.section))]) {
      await section(page, number);
      for (const field of lockedFields.filter((item) => item.section === number))
        await expect(button(page, `Change ${field.label}`)).toBeVisible();
    }
    // Each pack row holds exactly one button, its Change, and nothing else.
    await section(page, 3);
    const packRows = editor(page).locator('li.ux-fact-row').filter({ hasText: 'Pack setting' });
    await expect(packRows.first()).toBeVisible();
    for (const row of await packRows.all()) {
      await expect(row.getByRole('button')).toHaveCount(1);
      await expect(row.getByRole('button', { name: /^Change / })).toHaveCount(1);
    }
    // There is no sourcing profile on this pack, so there is nothing to remove.
    await expect(button(page, 'Remove Sourcing Profile')).toHaveCount(0);
  });
  test('an admin reads the same pack and gets no pack control, where the owner has them', async ({
    page,
  }) => {
    await open(page);
    await section(page, 3);
    await expect(button(page, `Change ${labelOfConfig('languages')}`)).toBeVisible();
    await open(page, { role: 'admin' });
    await expect(button(page, 'Change Pack Status')).toHaveCount(0);
    await section(page, 3);
    await expect(editor(page).getByText(labelOfConfig('languages'))).toBeVisible();
    await expect(button(page, `Change ${labelOfConfig('languages')}`)).toHaveCount(0);
  });
  test('with the module on the owner has Change Pack Status; with the switch off or the 2b marker absent there is none', async ({
    page,
  }) => {
    await open(page);
    await expect(button(page, 'Change Pack Status')).toBeVisible();
    await open(page, { facts: null });
    await expect(page.getByText('Change Pack Status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Change / })).toHaveCount(0);
  });
});

test.describe('Change Pack Setting', () => {
  test('the first step says the current setting in plain words, and an empty list is nothing set', async ({
    page,
  }) => {
    await open(page);
    await openLanguages(page);
    await expect(settingDialog(page).getByText(/^Current setting: .+/)).toBeVisible();
    await expect(settingDialog(page)).not.toContainText('Now:');
    await expect(settingDialog(page)).not.toContainText('Current setting: none');
    await page.keyboard.press('Escape');
    // A route with no pack has no mission types yet.
    await open(page, { route: 'TW-AU' });
    const missions = lockedFields.find((item) => item.configurationKey === 'missionTypes')!;
    await section(page, missions.section);
    await button(page, `Change ${missions.label}`).click();
    await expect(settingDialog(page).getByText('Current setting: nothing is set')).toBeVisible();
    await expect(settingDialog(page)).not.toContainText('Now: none');
  });
  test('a route with no pack offers Change only on Mission types, which starts pack version 1 as Draft', async ({
    page,
  }) => {
    const { publish } = await open(page, { route: 'TW-AU' });
    await expect(button(page, 'Change Pack Status')).toHaveCount(0);
    await section(page, 3);
    await expect(editor(page).getByText(labelOfConfig('languages'))).toBeVisible();
    const missions = lockedFields.find((item) => item.configurationKey === 'missionTypes')!;
    // Every section the standard has: none but the one holding Mission types shows a Change.
    const sections = [...new Set(standardFieldsV1.map((field) => field.section))];
    expect(sections.length).toBeGreaterThan(1);
    for (const number of sections) {
      await section(page, number);
      await expect(editor(page).locator('li.ux-fact-row').first()).toBeVisible();
      await expect(
        editor(page).getByRole('button', { name: /^Change / }),
        `section ${number}`,
      ).toHaveCount(number === missions.section ? 1 : 0);
    }
    await section(page, missions.section);
    await button(page, `Change ${missions.label}`).click();
    await expect(
      settingDialog(page).getByText('This starts the pack as Draft, not used yet.'),
    ).toBeVisible();
    await settingDialog(page).getByRole('checkbox').first().check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(settingDialog(page).getByText('This starts pack version 1')).toBeVisible();
    await reason(page).fill('Start the pack for this route');
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    expect(publish.bodies[1]!.change).toMatchObject({ kind: 'settings', version: 1 });
    expect(publish.bodies[1]!.change.missionTypes).toHaveLength(1);
    await expect(status(page)).toContainText('Pack version 1 is published.');
  });

  test('while Next is checking, the first step cannot change, and Publish sends exactly what was previewed', async ({
    page,
  }) => {
    const { publish } = await open(page, { publish: { previewDelay: 1500 } });
    await openLanguages(page);
    await settingDialog(page).getByRole('checkbox', { name: 'Chinese' }).check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(settingDialog(page).getByRole('checkbox', { name: 'Spanish' })).toBeDisabled();
    await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
    await reason(page).fill(reasonText);
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    expect(publish.bodies[1]!.change.languages).toEqual(publish.bodies[0]!.change.languages);
    expect(publish.bodies[1]!.change.languages).toEqual(['en', 'bn', 'zh']);
  });

  test('Next previews under its own id and the internal reason; Publish sends one new id with the typed reason', async ({
    page,
  }) => {
    const { publish } = await open(page);
    await openLanguages(page);
    await expect(settingDialog(page).getByText('Step 1 of 2: Value · Next: Review')).toBeVisible();
    const next = settingDialog(page).getByRole('button', { name: 'Next' });
    await expect(next).toBeDisabled();
    await expect(settingDialog(page).getByText('Change the value to continue.')).toBeVisible();
    await toReview(page);
    expect(publish.bodies).toHaveLength(1);
    const preview = publish.bodies[0]!;
    expect(preview.mode).toBe('preview');
    expect(preview.change).toMatchObject({
      kind: 'settings',
      version: 3,
      reason: previewReason,
      languages: ['en', 'bn', 'zh'],
    });
    const review = settingDialog(page);
    await expect(review.getByText('Based on pack version 2')).toBeVisible();
    await expect(review.getByText('Becomes pack version 3')).toBeVisible();
    await expect(review.getByText('Mission assignments kept: 4')).toBeVisible();
    await expect(
      review.getByText(
        'This publishes pack version 3. Readiness has to be recorded again for every dimension before this route can be released. Route facts, sources and dates are not affected.',
      ),
    ).toBeVisible();
    await expect(
      review.getByText(
        'A pack status is not clearance. Real payments, outreach and payouts stay closed until the owner decides each gate.',
      ),
    ).toBeVisible();
    await expect(
      review.getByText(
        'You are proposing and publishing this yourself. Both steps are recorded under your name.',
      ),
    ).toBeVisible();
    // A reason too short is refused in place, and nothing is sent.
    await reason(page).fill('ok');
    await review.getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(review.getByText('Give a reason of at least 3 characters.')).toBeVisible();
    expect(publish.bodies).toHaveLength(1);
    await reason(page).fill(reasonText);
    await review.getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    expect(publish.bodies).toHaveLength(2);
    const sent = publish.bodies[1]!;
    expect(sent.mode).toBe('publish');
    expect(sent.change.reason).toBe(reasonText);
    expect(sent.change.commandId).not.toBe(preview.change.commandId);
    expect(JSON.stringify(sent)).not.toContain(previewReason);
    await expect(status(page)).toContainText(
      'Pack version 3 is published. Readiness is not recorded for it yet.',
    );
    await expect(status(page)).toBeFocused();
    await expect(editor(page).getByText('Pack version 3', { exact: true })).toBeVisible();
    await expect(
      editor(page).getByText('Readiness: not recorded for pack version 3.'),
    ).toBeVisible();
  });

  test('every Next is a fresh preview id; Back keeps nothing of the previous preview', async ({
    page,
  }) => {
    const { publish } = await open(page);
    await openLanguages(page);
    await toReview(page);
    await settingDialog(page).getByRole('button', { name: 'Back' }).click();
    await settingDialog(page).getByRole('checkbox', { name: 'Spanish' }).check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
    expect(publish.bodies).toHaveLength(2);
    expect(publish.bodies[1]!.change.commandId).not.toBe(publish.bodies[0]!.change.commandId);
    expect(publish.bodies[1]!.change.languages).toEqual(['en', 'bn', 'zh', 'es']);
  });

  test('the authenticator check on Next opens in place and the same preview is sent again after the code', async ({
    page,
  }) => {
    const { publish } = await open(page, {
      publish: { script: [{ status: 401, code: 'STEP_UP_REQUIRED' }] },
    });
    await openLanguages(page);
    await settingDialog(page).getByRole('checkbox', { name: 'Chinese' }).check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(stepUpDialog(page)).toBeVisible();
    await stepUpDialog(page).getByLabel('Six-digit code').fill('123456');
    await stepUpDialog(page).getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
    expect(publish.bodies).toHaveLength(2);
    expect(publish.bodies[1]).toEqual(publish.bodies[0]);
  });

  test('closing the check on Publish keeps the step, the choice and the reason; the next press keeps the publish id', async ({
    page,
  }) => {
    const { publish } = await open(page);
    await openLanguages(page);
    await toReview(page);
    publish.script = [{ status: 401, code: 'STEP_UP_REQUIRED' }];
    await reason(page).fill(reasonText);
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await stepUpDialog(page).getByRole('button', { name: 'Not now' }).click();
    await expect(
      settingDialog(page).getByText(
        'Confirm your authenticator code to finish this. Your changes are kept.',
      ),
    ).toBeVisible();
    await expect(reason(page)).toHaveValue(reasonText);
    await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    expect(publish.bodies).toHaveLength(3);
    expect(publish.bodies[2]!.change.commandId).toBe(publish.bodies[1]!.change.commandId);
  });

  test('saved but not published: Try Publishing Again sends the same id; a new reason is a new id', async ({
    page,
  }) => {
    const { publish } = await open(page);
    await openLanguages(page);
    await toReview(page);
    // Follow-up per G73: the page knows this case by the code alone, not by the ending of the server's words.
    publish.script = [
      { status: 409, code: 'ROUTE_PACK_NOT_PUBLISHED', error: 'Expired policy.' },
      { status: 409, code: 'ROUTE_PACK_NOT_PUBLISHED', error: 'Expired policy.' },
    ];
    await reason(page).fill(reasonText);
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(
      settingDialog(page).getByText('The change is saved as a proposal but not published yet.'),
    ).toBeVisible();
    const again = settingDialog(page).getByRole('button', { name: 'Try Publishing Again' });
    await expect(again).toBeFocused();
    await again.click();
    await expect(again).toBeVisible();
    expect(publish.bodies[2]!.change.commandId).toBe(publish.bodies[1]!.change.commandId);
    await reason(page).fill(`${reasonText} today`);
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    expect(publish.bodies[3]!.change.commandId).not.toBe(publish.bodies[1]!.change.commandId);
  });

  test('a pack published first: the words, nothing published, and Reload Route reads the route again', async ({
    page,
  }) => {
    const { publish, world } = await open(page, {
      publish: {
        script: [{ status: 409, code: 'ROUTE_PACK_PACK_CHANGED', error: 'Changed' }],
      },
    });
    await openLanguages(page);
    await settingDialog(page).getByRole('checkbox', { name: 'Chinese' }).check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(
      settingDialog(page).getByText(
        'Another change to this pack was published first. Nothing was published. Open the route again to see the current pack, then make your change again.',
      ),
    ).toBeVisible();
    const reads = world.asked.length;
    await settingDialog(page).getByRole('button', { name: 'Reload Route' }).click();
    await expect(settingDialog(page)).toBeHidden();
    await expect.poll(() => world.asked.length).toBeGreaterThan(reads);
    expect(publish.bodies).toHaveLength(1);
  });

  test('a preview that would empty a Locked Core list on a live route names it and offers no Publish', async ({
    page,
  }) => {
    const { publish } = await open(page, { publish: { blocked: ['pack.languages'] } });
    await openLanguages(page);
    for (const name of ['English', 'Bengali'])
      await settingDialog(page).getByRole('checkbox', { name }).uncheck();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(
      settingDialog(page).getByText(
        `The route is live, so these fields cannot be emptied: ${labelOfConfig('languages')}.`,
      ),
    ).toBeVisible();
    await expect(
      settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }),
    ).toBeDisabled();
    await reason(page).fill(reasonText);
    expect(publish.bodies.filter((body) => body.mode === 'publish')).toHaveLength(0);
  });

  test('only the owner: a role changed while the dialog is open shows the words', async ({
    page,
  }) => {
    await open(page, { publish: { script: [{ status: 403, error: 'Access denied' }] } });
    await openLanguages(page);
    await settingDialog(page).getByRole('checkbox', { name: 'Chinese' }).check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(
      settingDialog(page).getByText('Only the owner can publish pack changes.'),
    ).toBeVisible();
  });

  test('before one-person publishing: Propose Pack Change, the second-owner line, then the proposed words', async ({
    page,
  }) => {
    const { publish } = await open(page, { publish: { onePerson: false } });
    await openLanguages(page);
    await toReview(page);
    await expect(
      settingDialog(page).getByText(
        'A second owner has to publish this. One-person publishing is not installed yet.',
      ),
    ).toBeVisible();
    await expect(
      settingDialog(page).getByText('Both steps are recorded under your name.'),
    ).toHaveCount(0);
    publish.script = [
      {
        status: 409,
        code: 'ROUTE_PACK_NOT_PUBLISHED',
        error:
          'A second owner must decide. The proposal was saved but not published. Send the same request again to publish it.',
      },
    ];
    await reason(page).fill(reasonText);
    await settingDialog(page).getByRole('button', { name: 'Propose Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    await expect(status(page)).toContainText(
      'Pack version 3 is proposed. It waits in Control Center for a second owner to publish it.',
    );
  });

  test('a key list: each key is checked as typed, and the list can be emptied', async ({
    page,
  }) => {
    const { publish } = await open(page);
    const field = lockedFields.find((item) => item.configurationKey === 'localities')!;
    await section(page, field.section);
    await button(page, `Change ${field.label}`).click();
    const box = settingDialog(page).getByRole('textbox', { name: 'Add a key' });
    await box.fill('Dhaka');
    await expect(
      settingDialog(page).getByText(
        'Use lowercase letters, digits, underscore, dot and hyphen only.',
      ),
    ).toBeVisible();
    await expect(settingDialog(page).getByRole('button', { name: 'Add Key' })).toBeDisabled();
    await box.fill('dhaka');
    await box.press('Enter');
    await expect(settingDialog(page).getByText('1 of 50 keys', { exact: true })).toBeVisible();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
    expect(publish.bodies[0]!.change.localities).toEqual(['dhaka']);
    await settingDialog(page).getByRole('button', { name: 'Back' }).click();
    await settingDialog(page).getByRole('button', { name: 'Remove dhaka' }).click();
    await expect(
      settingDialog(page).getByText('No keys. Saving this empties the list.'),
    ).toBeVisible();
  });

  test('the channel is one box sent as manualChannel; mission types cannot be emptied', async ({
    page,
  }) => {
    const { publish } = await open(page);
    const channel = lockedFields.find((item) => item.configurationKey === 'channels')!;
    await section(page, channel.section);
    await button(page, `Change ${channel.label}`).click();
    await settingDialog(page)
      .getByRole('checkbox', { name: 'The team contacts companies by hand (manual channel)' })
      .check();
    await settingDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(settingDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
    expect(publish.bodies[0]!.change).toMatchObject({ manualChannel: true });
    expect(JSON.stringify(publish.bodies[0])).not.toMatch(/channels|SYNTHETIC|"MANUAL"/);
    await settingDialog(page).getByRole('button', { name: 'Cancel' }).click();

    const missions = lockedFields.find((item) => item.configurationKey === 'missionTypes')!;
    await section(page, missions.section);
    await button(page, `Change ${missions.label}`).click();
    for (const box of await settingDialog(page).getByRole('checkbox', { checked: true }).all())
      await box.uncheck();
    await expect(settingDialog(page).getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(
      settingDialog(page).getByText('Choose at least one mission type.').first(),
    ).toBeVisible();
  });

  test('a staged fact edit survives a publish and the reason is never stored', async ({ page }) => {
    await open(page);
    await section(page, 3);
    const week = standardFieldsV1.find((field) => field.key === 'locale.working_week')!.label;
    await button(page, `Edit ${week}`).click();
    const editing = page.getByRole('group', { name: `Edit ${week}` });
    await editing.getByRole('textbox').first().fill('Sunday to Thursday, Monday to Friday');
    await editing.getByRole('button', { name: 'Next', exact: true }).click();
    await editing.getByRole('button', { name: 'Keep Change', exact: true }).click();
    const bar = page.getByRole('group', { name: 'Unsaved changes' });
    await expect(bar).toBeVisible();
    const stagedBefore = await page.evaluate(() => JSON.stringify(sessionStorage));
    await button(page, `Change ${labelOfConfig('languages')}`).click();
    await toReview(page);
    await reason(page).fill(reasonText);
    await settingDialog(page).getByRole('button', { name: 'Publish Pack Change' }).click();
    await expect(settingDialog(page)).toBeHidden();
    await expect(bar).toBeVisible();
    const stored = await page.evaluate(() => ({
      session: JSON.stringify(sessionStorage),
      local: JSON.stringify(localStorage),
      url: location.href,
    }));
    for (const place of Object.values(stored)) expect(place).not.toContain(reasonText);
    expect(stored.session).toBe(stagedBefore);
  });
});

test.describe('Change Pack Status and Remove Sourcing Profile', () => {
  test('the Review step with eight Pending Core keys fits the dialog without scrolling, with room to spare', async ({
    page,
  }) => {
    const keys = standardFieldsV1
      .filter((field) => field.core)
      .slice(0, 8)
      .map((field) => field.key);
    for (const [width, height] of [
      [1440, 900],
      [320, 568],
    ] as const) {
      await open(page, {
        width,
        height,
        publish: { warnings: [{ code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE', keys }] },
      });
      await button(page, 'Change Pack Status').click();
      const d = statusDialog(page);
      await d.getByRole('button', { name: /^Limited use/ }).click();
      await d.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(d.getByText('Step 2 of 2: Review')).toBeVisible();
      await expect(d.getByText(/^These Core fields are still Pending/)).toBeVisible();
      const measured = await d.evaluate((element) => ({
        scroll: element.scrollHeight,
        client: element.clientHeight,
        height: Math.round(element.getBoundingClientRect().height),
      }));
      test.info().annotations.push({
        type: `review-${width}`,
        description: `${measured.height} px high, scroll ${measured.scroll} of ${measured.client}`,
      });
      // The desktop budget: no scroll inside the dialog, and room for a longer blocked line under the 868 px cap. A 568 px high
      // phone cannot hold the step by design (it scrolls inside the dialog), so there it only has to stay inside the screen.
      if (width === 1440) {
        expect(measured.scroll, `${width}x${height}`).toBeLessThanOrEqual(measured.client);
        expect(measured.height).toBeLessThanOrEqual(800);
      } else expect(measured.height).toBeLessThanOrEqual(height);
      await noSidewaysScroll(page);
    }
  });
  test('five choices, Now cannot be chosen, Pending Core only warns, and the status body is sent', async ({
    page,
  }) => {
    const { publish } = await open(page, {
      publish: { warnings: [{ code: 'ROUTE_PACK_GO_LIVE_PENDING_CORE', keys: [] }] },
    });
    await button(page, 'Change Pack Status').click();
    const d = statusDialog(page);
    await expect(d.getByText('Current status: Active')).toBeVisible();
    for (const word of ['Draft, not used yet', 'Testing', 'Limited use', 'Paused'])
      await expect(d.getByRole('button', { name: new RegExp(`^${word}`) })).toBeEnabled();
    await expect(d.getByRole('button', { name: /^Active/ })).toBeDisabled();
    await expect(d.getByRole('button', { name: 'Next' })).toBeDisabled();
    await d.getByRole('button', { name: /^Limited use/ }).click();
    await expect(
      d.getByText(
        /These Core fields are still Pending: .*This does not mean the route is cleared\./,
      ),
    ).toBeVisible();
    await expect(d.getByRole('alert')).toHaveCount(0);
    await d.getByRole('button', { name: 'Next' }).click();
    await expect(d.getByText('Status: Active to Limited use')).toBeVisible();
    await expect(d.getByText('Every pack setting stays as it is')).toBeVisible();
    await reason(page, 'Change Pack Status').fill('Back to limited use while gaps are filled');
    await d.getByRole('button', { name: 'Publish Status Change' }).click();
    await expect(d).toBeHidden();
    expect(publish.bodies.map((body) => body.change.kind)).toEqual(['status', 'status']);
    expect(publish.bodies[1]!.change).toMatchObject({ status: 'LIMITED', version: 3 });
  });

  test('Remove Sourcing Profile shows on a filled profile and sends removeSourcingProfile only', async ({
    page,
  }) => {
    const facts: FactsWorld = {
      packs: {
        'BD-CN': {
          status: 'ACTIVE',
          version: 2,
          configuration: {
            missionTypes: ['supplier_discovery'],
            languages: ['en', 'bn'],
            currencies: ['USD'],
            timeZones: ['Asia/Dhaka'],
            channels: ['SYNTHETIC'],
            sourcing: { sample: true },
          },
        },
      },
    };
    const { publish } = await open(page, { facts });
    const sourcing = standardFieldsV1.find((field) => field.key === 'sourcing.profile')!;
    await section(page, sourcing.section);
    await button(page, 'Remove Sourcing Profile').click();
    const d = dialog(page, 'Remove Sourcing Profile');
    await expect(
      d.getByText(
        "This removes the buying profile from the pack. Buyers' comparison for this route stops using it.",
      ),
    ).toBeVisible();
    await expect(d.getByRole('textbox', { name: 'Reason' })).toBeVisible();
    expect(publish.bodies[0]!.change).toMatchObject({
      kind: 'settings',
      removeSourcingProfile: true,
    });
    expect('sourcing' in publish.bodies[0]!.change).toBe(false);
    await d.getByRole('textbox', { name: 'Reason' }).fill('The buyers stopped using this profile');
    await d.getByRole('button', { name: 'Remove Sourcing Profile' }).click();
    await expect(d).toBeHidden();
    await expect(status(page)).toContainText('Pack version 3 is published.');
  });
});

const sourcingFacts = (): FactsWorld => ({
  packs: {
    'BD-CN': {
      status: 'ACTIVE',
      version: 2,
      configuration: {
        missionTypes: ['supplier_discovery'],
        languages: ['en', 'bn'],
        currencies: ['USD'],
        timeZones: ['Asia/Dhaka'],
        channels: ['SYNTHETIC'],
        sourcing: { sample: true },
      },
    },
  },
});
/** Every visible button in `scope` is at least 44 px high and wide. */
async function targets(page: Page, names: string[]) {
  for (const name of names) {
    const found = page.getByRole('button', { name, exact: true });
    for (const one of await found.all()) {
      const box = await one.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
    }
  }
}

test.describe('layout and accessibility', () => {
  for (const width of [320, 390, 768, 1024, 1440, 1920])
    test(`each step is axe clean with no sideways scroll at ${width}`, async ({ page }) => {
      await open(page, { width, height: width === 320 ? 568 : 900 });
      await openLanguages(page);
      await noSidewaysScroll(page);
      await axeClean(page);
      await toReview(page);
      await noSidewaysScroll(page);
      await axeClean(page);
      await settingDialog(page).getByRole('button', { name: 'Cancel' }).click();
      await button(page, 'Change Pack Status').click();
      await noSidewaysScroll(page);
      await axeClean(page);
      await statusDialog(page)
        .getByRole('button', { name: /^Limited use/ })
        .click();
      await statusDialog(page).getByRole('button', { name: 'Next' }).click();
      await expect(statusDialog(page).getByText('Step 2 of 2: Review')).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      await statusDialog(page).getByRole('button', { name: 'Cancel' }).click();
      const field = lockedFields.find((item) => item.configurationKey === 'localities')!;
      await section(page, field.section);
      await button(page, `Change ${field.label}`).click();
      const box = settingDialog(page).getByRole('textbox', { name: 'Add a key' });
      await box.fill('dhaka');
      await box.press('Enter');
      await box.fill('Bad');
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024) await targets(page, ['Add Key', 'Remove dhaka', 'Next', 'Cancel']);
      await settingDialog(page).getByRole('button', { name: 'Cancel' }).click();
      if (width < 1024) await targets(page, [`Change ${field.label}`, 'Change Pack Status']);
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `test-results/route-pack-pack-${width}.png`,
          fullPage: false,
        });
    });
  for (const width of [320, 768, 1440])
    test(`Remove Sourcing Profile and the stale and denied end states are axe clean at ${width}`, async ({
      page,
    }) => {
      await open(page, { width, height: width === 320 ? 568 : 900, facts: sourcingFacts() });
      const sourcing = standardFieldsV1.find((item) => item.key === 'sourcing.profile')!;
      await section(page, sourcing.section);
      await button(page, 'Remove Sourcing Profile').click();
      const remove = dialog(page, 'Remove Sourcing Profile');
      await expect(remove.getByRole('textbox', { name: 'Reason' })).toBeVisible();
      await noSidewaysScroll(page);
      await axeClean(page);
      if (width < 1024) await targets(page, ['Remove Sourcing Profile', 'Cancel']);
      await remove.getByRole('button', { name: 'Cancel' }).click();
      for (const [answer, words] of [
        [
          { status: 409, code: 'ROUTE_PACK_PACK_CHANGED', error: 'Changed' },
          'Another change to this pack was published first.',
        ],
        [{ status: 403, error: 'Access denied' }, 'Only the owner can publish pack changes.'],
      ] as const) {
        const { publish } = await open(page, { width, height: width === 320 ? 568 : 900 });
        publish.script = [answer];
        await openLanguages(page);
        await settingDialog(page).getByRole('checkbox', { name: 'Chinese' }).check();
        await settingDialog(page).getByRole('button', { name: 'Next' }).click();
        await expect(settingDialog(page).getByText(words)).toBeVisible();
        await noSidewaysScroll(page);
        await axeClean(page);
      }
    });
});
