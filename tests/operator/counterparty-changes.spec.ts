import { test, expect, type Page } from '@playwright/test';
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
      createRoot(document.getElementById('fixture')).render(
        <main className="operator-page"><Counterparties tenant=${JSON.stringify(tenant)}/></main>);`,
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

for (const width of [360, 1440])
  test(`G11-09 at ${width} px the buttons and history summary are at least 44 pixels and there are no axe violations`, async ({
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
    });
    if (width < 640)
      await page.locator('summary', { hasText: 'Show private relationships' }).click();
    const item = group(page, 'Contact: Synthetic Buyer');
    for (const target of [...(await item.getByRole('button').all()), item.locator('summary')]) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(item.locator('summary')).toHaveText('Earlier versions and changes (2)');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await axe(page)).toEqual([]);
    await item.getByRole('button', { name: 'Withdraw Contact' }).click();
    expect(await axe(page)).toEqual([]);
    // A dialog without the new confirmClose prop closes on Escape exactly as before.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(item.getByRole('button', { name: 'Withdraw Contact' })).toBeFocused();
  });
