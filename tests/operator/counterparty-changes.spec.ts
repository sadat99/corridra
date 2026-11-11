import { test, expect, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// CRUD G11 in the operator's company workspace: Withdraw, Correct and Hide for private contacts and notes. The real
// component runs against stubbed workspace routes; the server and database checks live in the integration tests.
const tenant = '00000000-0000-4000-8000-000000000a01';
const org = '00000000-0000-4000-8000-000000000b01';
const rel = '00000000-0000-4000-8000-000000000c01';
const contactId = '00000000-0000-4000-8000-000000000d01';
const newer = '00000000-0000-4000-8000-000000000d02';
const noteId = '00000000-0000-4000-8000-000000000e01';
const source = '00000000-0000-4000-8000-000000000f01';
const owner = '00000000-0000-4000-8000-000000000101';
const mission = '00000000-0000-4000-8000-000000000201';
let server: Server, origin: string;
let bundle = '';
let componentCss = '';
const css = readFileSync(resolve('apps/web/app/globals.css'), 'utf8');

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{Counterparties}from ${JSON.stringify(resolve('apps/web/app/operator/counterparties.tsx'))};
      import{ControlledAccess}from ${JSON.stringify(resolve('apps/web/app/operator/access.tsx'))};
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page">{location.search==='?introductions'
          ?<ControlledAccess tenant=${JSON.stringify(tenant)} revision={0}/>
          :<Counterparties tenant=${JSON.stringify(tenant)}/>}</main>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    outdir: 'out',
    loader: { '.css': 'css' },
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  componentCss = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
    } else if (path === '/app.css') {
      res.setHeader('content-type', 'text/css');
      res.end(`${css}\n${componentCss}`);
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Research</title><link rel="stylesheet" href="/app.css"></head><body><div id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Row = Record<string, unknown>;
const base = {
  relationship_id: rel,
  source_id: source,
  created_by: owner,
  created_at: '2026-11-09T09:00:00Z',
  change_kind: null,
  change_reason: null,
  replacement_id: null,
  changed_by: null,
  changed_at: null,
  redaction_id: null,
  hidden_at: null,
  hidden_by: null,
};
const contact = (extra: Row = {}): Row => ({
  ...base,
  id: contactId,
  chain_id: contactId,
  name: 'Synthetic Buyer',
  job_title: 'Procurement lead',
  email: 'buyer@example.invalid',
  valid_until: '2026-12-01T09:00:00Z',
  status: 'SOURCE_REPORTED',
  ...extra,
});
const note = (extra: Row = {}): Row => ({
  ...base,
  id: noteId,
  chain_id: noteId,
  body: 'Synthetic private procurement context',
  status: 'SOURCE_REPORTED',
  ...extra,
});
type Setup = {
  role?: string;
  changes?: { installed: boolean; open: boolean } | undefined;
  contacts?: Row[];
  notes?: Row[];
  canChange?: boolean;
  shortlistContacts?: Row[];
  answer?: (body: Row, count: number) => { status: number; json: unknown } | undefined;
  after?: { contacts?: Row[]; notes?: Row[] };
  /** Leave the company unselected, so only the shortlist panel reads contact states. */
  noCompany?: boolean;
};
async function open(page: Page, setup: Setup = {}) {
  const sent: Row[] = [];
  let state = { contacts: setup.contacts ?? [contact()], notes: setup.notes ?? [note()] };
  const role = setup.role ?? 'operator';
  await page.route('**/api/workspace/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/').pop();
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Row;
      sent.push(body);
      const reply = setup.answer?.(body, sent.length);
      if (reply) {
        if (setup.after) state = { ...state, ...setup.after };
        return route.fulfill(reply);
      }
      if (setup.after) state = { ...state, ...setup.after };
      return route.fulfill({ status: 201, json: { id: 'x' } });
    }
    const json: Record<string, unknown> = {
      research: {
        role,
        total: 1,
        offset: 0,
        organisations: [
          {
            id: org,
            name: 'Synthetic Mill',
            country: 'ES',
            domain: 'mill.example.invalid',
            identity_status: 'SOURCE_REPORTED',
            canonical_id: org,
          },
        ],
      },
      workspace: {
        sources: [
          {
            id: source,
            locator: 'https://example.invalid/registry',
            kind: 'public_record',
            classification: 'PUBLIC',
          },
        ],
        claims: [],
      },
      missions: {
        missions: [{ id: mission, status: 'TARGETING', brief: { company: 'Synthetic Mission' } }],
        owners: [{ user_id: owner, name: 'Synthetic Owner' }],
      },
      counterparty: {
        role,
        organisation: { id: org, name: 'Synthetic Mill', country: 'ES', canonical_id: org },
        aliasIds: [org],
        identities: [],
        relationships: [
          {
            id: rel,
            organisation_id: org,
            owner_id: owner,
            visibility: 'TEAM',
            note: 'Private context',
            version: 1,
            can_change: setup.canChange ?? true,
          },
        ],
        contacts: state.contacts,
        notes: state.notes,
        attributes: [],
        publicFacts: [],
        candidates: [],
        resolutions: [],
        ...(setup.changes === undefined
          ? { changes: { installed: true, open: true } }
          : setup.changes
            ? { changes: setup.changes }
            : {}),
      },
      shortlist: {
        missionId: mission,
        offset: 0,
        total: 1,
        changes: setup.changes ?? { installed: true, open: true },
        targets: [
          {
            id: 'target-1',
            organisation_name: 'Synthetic Mill',
            fit: 'POSSIBLE',
            version: 1,
            rationale: 'Fit',
            uncertainty: 'Unknown',
            gaps: 'Gaps',
            next_action: 'Next',
            due_at: '2026-11-20T09:00:00Z',
            sources: [],
            history: [],
            contacts: setup.shortlistContacts ?? [],
          },
        ],
      },
    };
    return route.fulfill({ json: json[action ?? ''] ?? {} });
  });
  await page.goto(origin);
  if (setup.noCompany) return sent;
  await page.getByRole('button', { name: /Synthetic Mill/ }).click();
  await expect(page.locator('summary', { hasText: 'Show private relationships' })).toBeVisible();
  return sent;
}
const group = (page: Page, name: string | RegExp) => page.getByRole('group', { name });
const axe = async (page: Page) =>
  (
    await new AxeBuilder({ page })
      .include('.ux-dialog[open], .research-item')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
  ).violations.map((v) => v.id);

test('G11-01 module not installed: one line says so, no buttons, and the content line is exactly as today', async ({
  page,
}) => {
  await open(page, { changes: { installed: false, open: false } });
  await expect(
    page.getByText('Withdraw, correct and hide are not available in this workspace yet.'),
  ).toBeVisible();
  await expect(page.getByText(/Synthetic Buyer.*buyer@example.invalid/)).toHaveCount(1);
  await expect(page.getByText(/Private note: Synthetic private procurement context/)).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: /Withdraw|Correct|Hide/ })).toHaveCount(0);
});

test('G11-02 installed but closed: the not open line, states and no buttons', async ({ page }) => {
  await open(page, { changes: { installed: true, open: false } });
  await expect(
    page.getByText(
      'Withdraw, correct and hide are not open yet in this workspace. You can still read every contact, note and change.',
    ),
  ).toBeVisible();
  await expect(group(page, 'Contact: Synthetic Buyer')).toContainText('Source-reported');
  await expect(page.getByRole('button', { name: /Withdraw|Correct|Hide/ })).toHaveCount(0);
});

test('G11-03 buttons follow the role: operator with rights gets Correct and Withdraw, owner also Hide, reviewer none', async ({
  page,
}) => {
  await open(page);
  const item = group(page, 'Contact: Synthetic Buyer');
  await expect(item.getByRole('button')).toHaveText(['Correct Contact', 'Withdraw Contact']);
  await page.unrouteAll();
  await open(page, { role: 'owner' });
  await expect(group(page, 'Contact: Synthetic Buyer').getByRole('button')).toHaveText([
    'Correct Contact',
    'Withdraw Contact',
    'Hide Contact Details',
  ]);
  await expect(group(page, /^Private note from/).getByRole('button')).toHaveText([
    'Correct Note',
    'Withdraw Note',
    'Hide Note',
  ]);
  await page.unrouteAll();
  await open(page, { role: 'reviewer', canChange: false });
  await expect(group(page, 'Contact: Synthetic Buyer').getByRole('button')).toHaveCount(0);
});

test('G11-04 withdraw: Cancel has focus, a reason is required, one request per double click, the status is announced and focus returns to the item', async ({
  page,
}) => {
  const sent = await open(page, {
    after: {
      contacts: [
        contact({
          status: 'WITHDRAWN',
          change_kind: 'WITHDRAW',
          change_reason: 'Wrong person',
          changed_by: owner,
          changed_at: '2026-11-10T14:05:00Z',
        }),
      ],
    },
  });
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Withdraw Contact' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw This Contact?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toContainText(
    'The contact stays in the history with your reason. It can no longer be chosen for new targets or messages.',
  );
  await dialog.getByRole('button', { name: 'Confirm Withdrawal' }).click();
  expect(sent).toHaveLength(0);
  await dialog.getByLabel('Why are you withdrawing this contact?').fill('Wrong person');
  await dialog.getByRole('button', { name: 'Confirm Withdrawal' }).dblclick();
  await expect(page.getByRole('status', { name: 'Research status' })).toHaveText(
    'Contact withdrawn. It stays in the history, marked Withdrawn.',
  );
  expect(sent).toEqual([
    {
      action: 'withdraw_contact',
      contactId,
      reason: 'Wrong person',
      commandId: expect.any(String),
    },
  ]);
  const item = page.locator(`[data-chain="${contactId}"]`);
  await expect(item).toBeFocused();
  await expect(item).toContainText(
    'Withdrawn on 10 Nov 2026, 14:05 UTC by Synthetic Owner. Reason: Wrong person',
  );
});

test('G11-05 a 429 keeps the values and resends the same command id', async ({ page }) => {
  const sent = await open(page, {
    answer: (_, count) => (count === 1 ? { status: 429, json: { error: 'Too many' } } : undefined),
  });
  await group(page, /^Private note from/)
    .getByRole('button', { name: 'Withdraw Note' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw This Note?' });
  await dialog.getByLabel('Why are you withdrawing this note?').fill('Wrong fair');
  await dialog.getByRole('button', { name: 'Confirm Withdrawal' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'The request limit was reached. Try again later.',
  );
  await expect(dialog.getByLabel('Why are you withdrawing this note?')).toHaveValue('Wrong fair');
  await dialog.getByRole('button', { name: 'Send the Same Request Again' }).click();
  await expect(page.getByRole('status', { name: 'Research status' })).toHaveText(
    'Note withdrawn. It stays in the history, marked Withdrawn.',
  );
  expect(sent).toHaveLength(2);
  expect(sent[1]!.commandId).toBe(sent[0]!.commandId);
});

test('G11-06 hide: the honest sentence before the fields, Cancel focused, typed id, and a refused step-up keeps the values', async ({
  page,
}) => {
  const sent = await open(page, {
    role: 'admin',
    answer: () => ({
      status: 401,
      json: {
        error: 'Verify your authenticator again to hide contact details.',
        code: 'STEP_UP_REQUIRED',
      },
    }),
  });
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Hide Contact Details' })
    .click();
  const dialog = page.getByRole('dialog', { name: "Hide This Contact's Details?" });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toContainText(
    'The record stays. Its text will be hidden from every screen and export in this workspace. This cannot be undone. Text already included in a message, and backups, are not changed.',
  );
  await expect(dialog).not.toContainText(/erase|delete|removed|permanently/i);
  await dialog
    .getByLabel('Why are these details being hidden?')
    .fill('Request from the person to stop showing');
  await dialog.getByLabel('Ticket reference').fill('REQ-2026-0142');
  await dialog.getByLabel('Type the contact id to confirm').fill(contactId.toUpperCase());
  await dialog.getByRole('button', { name: 'Confirm and Hide' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Confirm your authenticator code to finish this. Your changes are kept.',
  );
  await expect(dialog.getByLabel('Ticket reference')).toHaveValue('REQ-2026-0142');
  expect(sent[0]).toMatchObject({
    action: 'redact_contact',
    contactId,
    confirmId: contactId.toUpperCase(),
    ticketReference: 'REQ-2026-0142',
  });
  expect(await axe(page)).toEqual([]);
});

test('G11-07 a hidden contact and note read Hidden everywhere, never null, and the picker offers only current contacts', async ({
  page,
}) => {
  const hiddenRow = {
    status: 'HIDDEN',
    name: null,
    job_title: null,
    email: null,
    redaction_id: 'r',
    hidden_at: '2026-11-10T14:05:00Z',
    hidden_by: owner,
  };
  await open(page, {
    contacts: [contact(hiddenRow), contact({ id: newer, chain_id: newer, name: 'Current Buyer' })],
    notes: [note({ ...hiddenRow, body: null })],
    shortlistContacts: [
      { target_id: 'target-1', name: null, job_title: null, email: null, status: 'HIDDEN' },
    ],
  });
  const item = group(page, 'Contact: details hidden');
  await expect(item).toContainText('Hidden · Hidden · Hidden · Hidden');
  await expect(item).toContainText('Hidden on 10 Nov 2026, 14:05 UTC by Synthetic Owner.');
  await expect(group(page, /^Private note from/)).toContainText('Private note: Hidden');
  await expect(item.getByRole('button')).toHaveCount(0);
  const picker = page.getByLabel('Optional target contact');
  await expect(picker.locator('option')).toHaveText(['Choose a record', 'Current Buyer']);
  await page.getByLabel('Shortlist mission').selectOption(mission);
  await expect(page.getByText('Hidden · Hidden · Hidden', { exact: true })).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\bnull\b|\bundefined\b/);
});

test('G11-08 correct: two steps, save waits for a change, a discard prompt guards edits, and a conflict shows the latest details with the edits kept', async ({
  page,
}) => {
  const latest = contact({ id: newer, name: 'Changed Elsewhere', status: 'SOURCE_REPORTED' });
  const sent = await open(page, {
    answer: (_, count) =>
      count === 1
        ? {
            status: 409,
            json: { error: 'This contact changed. Refresh to see the latest.', code: 'CHANGED' },
          }
        : undefined,
    after: {
      contacts: [
        contact({
          status: 'CORRECTED',
          change_kind: 'CORRECT',
          replacement_id: newer,
          changed_by: owner,
          changed_at: '2026-11-10T14:05:00Z',
          change_reason: 'Other edit',
        }),
        latest,
      ],
    },
  });
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Correct Contact' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Correct This Contact' });
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Correct Contact' })
    .click();
  await dialog.getByLabel('Job title').fill('Head of procurement');
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('Discard your changes to this contact?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep Editing' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Step 2 of 2: Source and reason' }),
  ).toBeFocused();
  await expect(dialog.getByText('You changed: Job title.')).toBeVisible();
  await dialog.getByLabel('Why are you correcting this contact?').fill('Title was wrong');
  await dialog.getByRole('button', { name: 'Save Correction' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Someone changed this contact after you opened it. Nothing was saved.',
  );
  await expect(dialog.getByRole('heading', { name: 'Latest saved details' })).toBeVisible();
  await expect(dialog).toContainText('Changed Elsewhere');
  // U-02: compared with the latest saved version, saving would overwrite both the other person's name and the title.
  await expect(dialog.getByText('You changed: Name, Job title.')).toBeVisible();
  await expect(dialog.getByLabel('Why are you correcting this contact?')).toHaveValue(
    'Title was wrong',
  );
  await dialog.getByRole('button', { name: 'Save Correction' }).click();
  await expect(page.getByRole('status', { name: 'Research status' })).toHaveText(
    'Correction saved. The earlier version stays in the history, marked Corrected.',
  );
  expect(sent.map((s) => s.contactId)).toEqual([contactId, newer]);
  expect(sent[1]!.commandId).not.toBe(sent[0]!.commandId);
});

/**
 * Every control in the open dialog meets A-03 (buttons at least 44 x 44 px, fields at least 44 px tall), the dialog
 * fits the viewport width, each button can be scrolled into view inside it, and the keyboard focus ring shows.
 */
async function dialogFits(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  for (const button of await dialog.getByRole('button').all()) {
    await button.scrollIntoViewIfNeeded();
    const b = (await button.boundingBox())!;
    const name = await button.innerText();
    expect(b.height, name).toBeGreaterThanOrEqual(44);
    expect(b.width, name).toBeGreaterThanOrEqual(44);
    expect(b.y, name).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height, name).toBeLessThanOrEqual(viewport.height);
  }
  for (const control of await dialog
    .locator('input:visible, textarea:visible, select:visible')
    .all())
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement;
      const style = getComputedStyle(focused);
      return (
        focused.closest('dialog') !== null &&
        ((style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
          style.boxShadow !== 'none')
      );
    }),
  ).toBe(true);
}

for (const width of [320, 360, 768, 1024, 1440])
  test(`G11-09 at ${width} px the buttons, fields and history summary are at least 44 pixels, every dialog fits, and there are no axe violations`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, {
      role: 'owner',
      contacts: [
        contact({
          status: 'CORRECTED',
          change_kind: 'CORRECT',
          replacement_id: newer,
          change_reason: 'Title',
          changed_by: owner,
          changed_at: '2026-11-10T14:05:00Z',
        }),
        contact({ id: newer, name: 'Synthetic Buyer' }),
      ],
      answer: () => ({ status: 401, json: { error: 'Sign in to continue' } }),
    });
    if (width < 640)
      await page.locator('summary', { hasText: 'Show private relationships' }).click();
    const item = group(page, 'Contact: Synthetic Buyer');
    for (const target of [...(await item.getByRole('button').all()), item.locator('summary')]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    await expect(item.locator('summary')).toHaveText('Earlier versions and changes (2)');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await axe(page)).toEqual([]);

    await item.getByRole('button', { name: 'Correct Contact' }).click();
    const correct = page.getByRole('dialog', { name: 'Correct This Contact' });
    await dialogFits(page, correct);
    expect(await axe(page)).toEqual([]);
    await correct.getByLabel('Job title').fill('Head of procurement');
    await correct.getByRole('button', { name: 'Next' }).click();
    await expect(
      correct.getByRole('heading', { name: 'Step 2 of 2: Source and reason' }),
    ).toBeVisible();
    await dialogFits(page, correct);
    expect(await axe(page)).toEqual([]);
    await correct.getByLabel('Why are you correcting this contact?').fill('Title was wrong');
    await page.keyboard.press('Escape');
    await expect(correct.getByRole('group', { name: 'Discard changes' })).toBeVisible();
    await dialogFits(page, correct);
    expect(await axe(page)).toEqual([]);
    await correct.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await item.getByRole('button', { name: 'Hide Contact Details' }).click();
    const hide = page.getByRole('dialog', { name: "Hide This Contact's Details?" });
    await dialogFits(page, hide);
    expect(await axe(page)).toEqual([]);
    await hide
      .getByLabel('Why are these details being hidden?')
      .fill('Request from the person to stop showing');
    await hide.getByLabel('Ticket reference').fill('REQ-2026-0142');
    await hide.getByLabel('Type the contact id to confirm').fill(newer);
    await hide.getByRole('button', { name: 'Confirm and Hide' }).click();
    await expect(hide.getByRole('alert')).toHaveText(
      'Your session has ended. Sign in again, then send the same request again.',
    );
    await dialogFits(page, hide);
    expect(await axe(page)).toEqual([]);
    await hide.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await item.getByRole('button', { name: 'Withdraw Contact' }).click();
    await dialogFits(page, page.getByRole('dialog', { name: 'Withdraw This Contact?' }));
    expect(await axe(page)).toEqual([]);
    // With no edits, Escape closes the change dialog at once (a dialog without confirmClose is covered by
    // revamp-cx2-components.spec.ts CX-05, lines 139-170).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(item.getByRole('button', { name: 'Withdraw Contact' })).toBeFocused();
  });

test('G11-10 with no company selected, the mission shortlist still reads the module state: a hidden contact reads Hidden, never an empty cell', async ({
  page,
}) => {
  await open(page, {
    noCompany: true,
    shortlistContacts: [
      { target_id: 'target-1', name: null, job_title: null, email: null, status: 'HIDDEN' },
      {
        target_id: 'target-1',
        name: 'Gone Buyer',
        job_title: 'Buyer',
        email: 'gone@example.invalid',
        status: 'WITHDRAWN',
      },
    ],
  });
  await page.getByLabel('Shortlist mission').selectOption(mission);
  await expect(page.getByText('Hidden · Hidden · Hidden', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Gone Buyer · gone@example.invalid · Withdrawn · Not usable for new targets or messages',
    ),
  ).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(/ · {2}·|\bHIDDEN\b|\bnull\b/);
});

test('G11-11 typing in the correct dialog keeps focus in the field after the step heading took it', async ({
  page,
}) => {
  await open(page);
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Correct Contact' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Correct This Contact' });
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Step 2 of 2: Source and reason' }),
  ).toBeFocused();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByRole('heading', { name: 'Step 1 of 2: Contact details' })).toBeFocused();
  const name = dialog.getByLabel('Name', { exact: true });
  await name.click();
  await page.keyboard.press('End');
  await page.keyboard.type('XY');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Synthetic BuyerXY');
});

test('G11-12 a hidden chain shows its newest version: corrected, then withdrawn, then hidden', async ({
  page,
}) => {
  const hiddenText = {
    name: null,
    job_title: null,
    email: null,
    status: 'HIDDEN',
    redaction_id: 'r',
    hidden_at: '2026-11-10T15:00:00Z',
    hidden_by: owner,
  };
  await open(page, {
    role: 'owner',
    notes: [],
    contacts: [
      contact({
        ...hiddenText,
        change_kind: 'CORRECT',
        replacement_id: newer,
        changed_by: owner,
        changed_at: '2026-11-10T14:00:00Z',
        valid_until: '2026-11-20T09:00:00Z',
      }),
      contact({
        ...hiddenText,
        id: newer,
        chain_id: contactId,
        source_id: 'second-source',
        created_at: '2026-11-10T14:00:00Z',
        change_kind: 'WITHDRAW',
        changed_by: owner,
        changed_at: '2026-11-10T14:30:00Z',
        valid_until: '2026-12-24T09:00:00Z',
      }),
    ],
  });
  const item = group(page, 'Contact: details hidden');
  await expect(item).toHaveCount(1);
  await expect(item.locator('p').first()).toContainText('Source second-source · Until 24 Dec 2026');
  await item.locator('summary').click();
  await expect(item).toContainText(
    'Withdrawn on 10 Nov 2026, 14:30 UTC by Synthetic Owner. Reason: Hidden',
  );
  await expect(item).toContainText(
    'Corrected on 10 Nov 2026, 14:00 UTC by Synthetic Owner. Reason: Hidden',
  );
});

test('G11-13 a signed-out answer says so, and a 409 in Withdraw shows the latest details without promising kept edits', async ({
  page,
}) => {
  await open(page, {
    answer: (_, count) =>
      count === 1
        ? { status: 401, json: { error: 'Sign in to continue' } }
        : {
            status: 409,
            json: { error: 'This contact changed. Refresh to see the latest.', code: 'CHANGED' },
          },
    after: {
      contacts: [
        contact({
          status: 'CORRECTED',
          change_kind: 'CORRECT',
          replacement_id: newer,
          changed_by: owner,
          changed_at: '2026-11-10T14:05:00Z',
          change_reason: 'Other edit',
        }),
        contact({ id: newer, name: 'Changed Elsewhere', created_at: '2026-11-10T14:05:00Z' }),
      ],
    },
  });
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Withdraw Contact' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw This Contact?' });
  await dialog.getByLabel('Why are you withdrawing this contact?').fill('Wrong person');
  await dialog.getByRole('button', { name: 'Confirm Withdrawal' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Your session has ended. Sign in again, then send the same request again.',
  );
  await dialog.getByRole('button', { name: 'Confirm Withdrawal' }).click();
  await expect(dialog.getByRole('heading', { name: 'Latest saved details' })).toBeVisible();
  await expect(dialog).toContainText('Changed Elsewhere');
  await expect(dialog.getByRole('alert')).toHaveText(
    'Someone changed this contact after you opened it. Nothing was saved. The latest saved details are shown below.',
  );
});

test('G11-14 a hide refused because the chain was hidden meanwhile names the record as Hidden, never null', async ({
  page,
}) => {
  await open(page, {
    role: 'owner',
    answer: () => ({ status: 409, json: { error: 'This contact is hidden.', code: 'HIDDEN' } }),
    after: {
      contacts: [
        contact({
          status: 'HIDDEN',
          name: null,
          job_title: null,
          email: null,
          redaction_id: 'r',
          hidden_at: '2026-11-10T14:05:00Z',
          hidden_by: owner,
        }),
      ],
    },
  });
  await group(page, 'Contact: Synthetic Buyer')
    .getByRole('button', { name: 'Hide Contact Details' })
    .click();
  const dialog = page.getByRole('dialog', { name: "Hide This Contact's Details?" });
  await dialog
    .getByLabel('Why are these details being hidden?')
    .fill('Request from the person to stop showing');
  await dialog.getByLabel('Ticket reference').fill('REQ-2026-0142');
  await dialog.getByLabel('Type the contact id to confirm').fill(contactId);
  await dialog.getByRole('button', { name: 'Confirm and Hide' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    "This contact's details were hidden after you opened it. Nothing was saved.",
  );
  await expect(dialog).toContainText(
    'Hidden, Hidden, Hidden, on the relationship owned by Synthetic Owner.',
  );
  await expect(dialog).not.toContainText(/null|undefined|Synthetic Buyer/);
});

test('G11-15 Cancel and Discard Changes return focus to the button that opened the dialog', async ({
  page,
}) => {
  await open(page);
  const item = group(page, 'Contact: Synthetic Buyer');
  await item.getByRole('button', { name: 'Withdraw Contact' }).click();
  await page
    .getByRole('dialog', { name: 'Withdraw This Contact?' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(item.getByRole('button', { name: 'Withdraw Contact' })).toBeFocused();
  await item.getByRole('button', { name: 'Correct Contact' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct This Contact' });
  await dialog.getByLabel('Job title').fill('Changed title');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(item.getByRole('button', { name: 'Correct Contact' })).toBeFocused();
});

test.describe('in a +05:30 time zone', () => {
  // A half-hour offset, so both an hour and a half-hour time zone mistake change the instant sent.
  test.use({ timezoneId: 'Asia/Kolkata' });
  test('G11-16 a correction that changes only Valid until can be saved, is guarded by the discard prompt, and sends exactly the values seen with the new instant', async ({
    page,
  }) => {
    const sent = await open(page, {
      contacts: [contact({ status: 'EXPIRED', valid_until: '2026-11-09T09:00:00Z' })],
    });
    await group(page, 'Contact: Synthetic Buyer')
      .getByRole('button', { name: 'Correct Contact' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Correct This Contact' });
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByText('You changed nothing yet.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save Correction' })).toBeDisabled();
    await dialog.locator('[data-date-field="validUntil"]').fill('2026-12-15T10:00');
    await expect(dialog.getByText('You changed: Valid until.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.getByText('Discard your changes to this contact?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep Editing' }).click();
    await dialog.getByLabel('Why are you correcting this contact?').fill('Source renewed');
    await dialog.getByRole('button', { name: 'Save Correction' }).click();
    await expect(page.getByRole('status', { name: 'Research status' })).toHaveText(
      'Correction saved. The earlier version stays in the history, marked Corrected.',
    );
    // 10:00 on 15 December in Asia/Kolkata (+05:30) is 04:30 UTC.
    expect(sent).toEqual([
      {
        action: 'correct_contact',
        contactId,
        sourceId: source,
        name: 'Synthetic Buyer',
        jobTitle: 'Procurement lead',
        email: 'buyer@example.invalid',
        validUntil: '2026-12-15T04:30:00.000Z',
        reason: 'Source renewed',
        commandId: expect.any(String),
      },
    ]);
  });
});

test('G11-20 a corrected contact and a corrected note keep their place in the list, in the order the server gives', async ({
  page,
}) => {
  // Regression guard: the server orders each chain by its first version (counterparty-changes.test.ts, CRUD-3 list
  // order); the screen groups versions by chain in that order and never re-sorts them.
  const laterContact = '00000000-0000-4000-8000-000000000d03';
  const laterNote = '00000000-0000-4000-8000-000000000e02';
  const correctedNote = '00000000-0000-4000-8000-000000000e03';
  const corrected = {
    status: 'CORRECTED',
    change_kind: 'CORRECT',
    change_reason: 'Title',
    changed_by: owner,
    changed_at: '2026-11-10T14:05:00Z',
  };
  await open(page, {
    contacts: [
      contact({ id: newer, name: 'Corrected First Buyer', created_at: '2026-11-10T14:05:00Z' }),
      contact({
        id: laterContact,
        chain_id: laterContact,
        name: 'Later Buyer',
        created_at: '2026-11-09T10:00:00Z',
      }),
      contact({ ...corrected, replacement_id: newer }),
    ],
    notes: [
      note({ id: laterNote, chain_id: laterNote, created_at: '2026-11-09T10:00:00Z' }),
      note({ id: correctedNote, body: 'Corrected note', created_at: '2026-11-10T14:05:00Z' }),
      note({ ...corrected, replacement_id: correctedNote }),
    ],
  });
  expect(
    await page
      .locator('[data-chain]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-chain'))),
  ).toEqual([contactId, laterContact, laterNote, noteId]);
  await expect(page.getByRole('group', { name: /^Contact: / })).toHaveText([
    /Corrected First Buyer/,
    /Later Buyer/,
  ]);
});

test('G11-19 a browser close that skips the discard prompt shows the dialog again with the edits, the prompt and focus kept', async ({
  page,
}) => {
  const sent = await open(page);
  const item = group(page, 'Contact: Synthetic Buyer');
  await item.getByRole('button', { name: 'Correct Contact' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct This Contact' });
  await dialog.getByLabel('Job title').fill('Changed title');
  await page.keyboard.press('Escape');
  const prompt = dialog.getByRole('group', { name: 'Discard changes' });
  await expect(prompt).toContainText('Discard your changes to this contact?');
  const keep = dialog.getByRole('button', { name: 'Keep Editing' });
  await expect(keep).toBeFocused();
  const stillOpen = async () => {
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => (d as HTMLDialogElement).open && d.matches(':modal'))).toBe(
      true,
    );
    await expect(dialog.getByLabel('Job title')).toHaveValue('Changed title');
    await expect(prompt).toBeVisible();
    await expect(keep).toBeFocused();
    expect(sent).toHaveLength(0);
  };
  // A second Escape with no click in between, then other code closing the element directly.
  await page.keyboard.press('Escape');
  await stillOpen();
  await page.evaluate(() => document.querySelector<HTMLDialogElement>('dialog[open]')!.close());
  await stillOpen();
  // No trap: Discard Changes still closes it and focus returns to the opener.
  await dialog.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(item.getByRole('button', { name: 'Correct Contact' })).toBeFocused();
  // With no edits, Escape closes it at once and focus returns.
  await item.getByRole('button', { name: 'Correct Contact' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(item.getByRole('button', { name: 'Correct Contact' })).toBeFocused();
});

test('G11-17 a contact whose source passed its keep-until date can still be withdrawn', async ({
  page,
}) => {
  // The contact's own date is still ahead; it reads Expired because its source's keep-until date has passed.
  const sent = await open(page, {
    contacts: [contact({ status: 'EXPIRED', valid_until: '2027-03-01T09:00:00Z' })],
    after: {
      contacts: [
        contact({
          status: 'WITHDRAWN',
          change_kind: 'WITHDRAW',
          change_reason: 'Source ended',
          changed_by: owner,
          changed_at: '2026-11-10T14:05:00Z',
        }),
      ],
    },
  });
  const item = group(page, 'Contact: Synthetic Buyer');
  await expect(item).toContainText(
    "Past its valid-until date or its source's keep-until date. You can still withdraw or correct it.",
  );
  await item.getByRole('button', { name: 'Withdraw Contact' }).click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw This Contact?' });
  await dialog.getByLabel('Why are you withdrawing this contact?').fill('Source ended');
  await dialog.getByRole('button', { name: 'Confirm Withdrawal' }).click();
  await expect(page.getByRole('status', { name: 'Research status' })).toHaveText(
    'Contact withdrawn. It stays in the history, marked Withdrawn.',
  );
  expect(sent).toEqual([
    {
      action: 'withdraw_contact',
      contactId,
      reason: 'Source ended',
      commandId: expect.any(String),
    },
  ]);
});

test('G11-18 a signed-out answer in Correct and in Hide says so and keeps every value typed', async ({
  page,
}) => {
  const sent = await open(page, {
    role: 'owner',
    answer: () => ({ status: 401, json: { error: 'Sign in to continue' } }),
  });
  const item = group(page, 'Contact: Synthetic Buyer');
  const signedOut = 'Your session has ended. Sign in again, then send the same request again.';
  await item.getByRole('button', { name: 'Correct Contact' }).click();
  const correct = page.getByRole('dialog', { name: 'Correct This Contact' });
  await correct.getByLabel('Job title').fill('Head of procurement');
  await correct.getByRole('button', { name: 'Next' }).click();
  await correct.getByLabel('Why are you correcting this contact?').fill('Title was wrong');
  await correct.getByRole('button', { name: 'Save Correction' }).click();
  await expect(correct.getByRole('alert')).toHaveText(signedOut);
  await expect(correct.getByLabel('Why are you correcting this contact?')).toHaveValue(
    'Title was wrong',
  );
  await correct.getByRole('button', { name: 'Back' }).click();
  await expect(correct.getByLabel('Job title')).toHaveValue('Head of procurement');
  await correct.getByRole('button', { name: 'Cancel' }).click();
  await correct.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await item.getByRole('button', { name: 'Hide Contact Details' }).click();
  const hide = page.getByRole('dialog', { name: "Hide This Contact's Details?" });
  await hide
    .getByLabel('Why are these details being hidden?')
    .fill('Request from the person to stop showing');
  await hide.getByLabel('Ticket reference').fill('REQ-2026-0142');
  await hide.getByLabel('Type the contact id to confirm').fill(contactId);
  await hide.getByRole('button', { name: 'Confirm and Hide' }).click();
  await expect(hide.getByRole('alert')).toHaveText(signedOut);
  await expect(hide.getByLabel('Why are these details being hidden?')).toHaveValue(
    'Request from the person to stop showing',
  );
  await expect(hide.getByLabel('Ticket reference')).toHaveValue('REQ-2026-0142');
  await expect(hide.getByLabel('Type the contact id to confirm')).toHaveValue(contactId);
  expect(sent.map((body) => body.action)).toEqual(['correct_contact', 'redact_contact']);
});

for (const width of [320, 1440])
  test(`G11-21 at ${width} px each not-sent reason reads in the introduction line, wraps, and has no axe violations`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const words = [
      'Not sent: the person opted out. It cannot be sent again.',
      'Not sent: contact hidden. It cannot be sent again.',
      'Not sent: contact withdrawn. It cannot be sent again.',
      'Not sent: the contact was corrected after this introduction was created. It cannot be sent again.',
      'Not sent: this contact can no longer be used.',
    ];
    const stopped = { delivery_status: 'DEAD', last_error: 'PERMANENT' };
    const facts: Row[] = [
      { ...stopped, contact_status: 'WITHDRAWN', contact_opted_out: true },
      { ...stopped, contact_status: 'HIDDEN', contact_opted_out: false },
      { ...stopped, contact_status: 'WITHDRAWN', contact_opted_out: false },
      { ...stopped, contact_status: 'CORRECTED', contact_opted_out: false },
      { ...stopped, contact_status: null, contact_opted_out: false },
      { delivery_status: 'SUPPRESSED', last_error: 'POLICY_BLOCKED', contact_opted_out: true },
    ];
    const messages = facts.map((fact, i) => ({
      id: `00000000-0000-4000-8000-00000000100${i}`,
      link_id: `00000000-0000-4000-8000-00000000200${i}`,
      presentation: { company: `Synthetic Supplier ${i + 1}` },
      channel: 'SYNTHETIC',
      decision: null,
      response_id: null,
      attempts: 1,
      revoked: false,
      expires_at: '2026-12-01T09:00:00Z',
      ...fact,
    }));
    await page.route('**/api/workspace/**', (route) => {
      const action = new URL(route.request().url()).pathname.split('/').pop();
      return route.fulfill({
        json:
          action === 'communications'
            ? {
                role: 'operator',
                policies: [],
                templates: [],
                targets: [],
                contacts: [],
                messages,
                optouts: [],
                attempts: [],
                targetsTotal: null,
                targetsNext: null,
                contactsTotal: null,
                contactsNext: null,
                messagesTotal: null,
                messagesNext: null,
                optoutsTotal: null,
                optoutsNext: null,
              }
            : {
                role: 'operator',
                owners: [],
                meetings: [],
                meetingsTotal: null,
                next: null,
                followupsTotal: null,
                followupsNext: null,
                participants: [],
                outcomes: [],
                followups: [],
                history: [],
              },
      });
    });
    await page.goto(`${origin}/?introductions`);
    const cards = page.locator('article.introduction-card');
    await expect(cards).toHaveCount(facts.length);
    for (const [i, text] of words.entries()) await expect(cards.nth(i)).toContainText(text);
    // A message stopped for another reason keeps only its own status words.
    await expect(cards.nth(5)).not.toContainText('Not sent');
    for (const card of await cards.all())
      expect(await card.evaluate((c) => c.scrollWidth <= c.clientWidth)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include('article.introduction-card')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations.map((v) => v.id),
    ).toEqual([]);
  });
