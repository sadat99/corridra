import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startTodayFixture } from './team-today-fixture';

// Report a Problem, the staff side (docs/revamp/specs/problem-reports.md section 6, ADR-078 decisions 6 and 8): the triage
// panel in Settings (#problem-report-queue) and the owner's removal of words under an erasure request, bundled from the
// source with the real stylesheets and the team shell on (so the in-place authenticator dialog is the real one). Every read
// and write is answered here with synthetic rows. The role matrix is held without a browser in
// tests/integration/problem-report-queue.test.ts; this fixture signs in an owner.
const tenant = fixtureTenant;
let fixture: Awaited<ReturnType<typeof startTodayFixture>>;
let origin = '';
test.beforeAll(async () => {
  fixture = await startTodayFixture();
  origin = fixture.origin;
});
test.afterAll(async () => {
  await fixture.close();
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Status = 'received' | 'in_review' | 'resolved' | 'closed';
const row = (n: number, status: Status, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  number: n,
  reference: `RP-00000${n}`,
  reporterKind: n % 2 ? 'customer' : 'team',
  filedAt: new Date(Date.now() - n * 86400000).toISOString(),
  category: 'did_not_work',
  side: 'sample',
  status,
  updatedAt: new Date().toISOString(),
  wordsRemoved: false,
  pageKind: 'this_page',
  page: '/account/requests/:id',
  detail: 'The button did nothing',
  history: [{ state: 'received', note: null, createdAt: new Date().toISOString() }],
  ...extra,
});
const queueOf = (items: ReturnType<typeof row>[], oldest = true) => {
  const counts = { received: 0, in_review: 0, resolved: 0, closed: 0 };
  for (const item of items) counts[item.status as Status] += 1;
  return {
    items,
    total: items.length,
    counts,
    oldestReceivedAt: oldest
      ? (items.find((item) => item.status === 'received')?.filedAt ?? null)
      : null,
    nextAfter: null,
  };
};

type Sent = { url: string; body: Record<string, unknown> };
type Answer = { status?: number; json: unknown };
/** Opens the settings tab with the queue answering from `queue()`, and every POST answered by `answer`, in turn. */
async function open(
  page: Page,
  {
    queue = () => queueOf([row(1, 'received'), row(2, 'in_review')]),
    answer = () => ({
      json: { id: id(1), reference: 'RP-000001', status: 'in_review', note: null, changed: true },
    }),
    erasure = [],
    offered = true,
    shells = true,
    hash = 'problem-report-queue',
  }: {
    queue?: () => unknown;
    answer?: (sent: Sent, count: number) => Answer;
    erasure?: unknown[];
    /** Whether Report a Problem is offered to this workspace (the server's answer, given to the workspace). */
    offered?: boolean;
    /** The team shell switch: off, the workspace is mounted without the team frame. */
    shells?: boolean;
    /** The address the page opens on. */
    hash?: string;
  } = {},
) {
  const sent: Sent[] = [];
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/workspace/workspace?*', (route) =>
    route.fulfill({
      json: {
        purpose: 'synthetic_validation',
        uploadsConfigured: false,
        scanMode: 'bypass',
        role: 'owner',
        sources: [],
        claims: [],
        evidence: [],
        facts: [],
      },
    }),
  );
  await page.route('**/api/workspace/config?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: false } }),
  );
  await page.route('**/api/workspace/customer-erasure-queue?*', (route) =>
    route.fulfill({ json: { items: erasure, nextAfter: null } }),
  );
  await page.route('**/api/workspace/problem-reports?*', (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: queue() });
    const entry = { url: request.url(), body: request.postDataJSON() as Record<string, unknown> };
    sent.push(entry);
    const { status = 200, json } = answer(entry, sent.length);
    return route.fulfill({ status, json });
  });
  await page.goto(
    `${origin}/?workspace=${tenant}&reports=${offered ? 'on' : 'off'}${shells ? '' : '&shells=off'}#${hash}`,
  );
  if (offered)
    await expect(page.getByRole('heading', { name: 'Problem reports', level: 2 })).toBeVisible();
  return sent;
}
const panel = (page: Page) => page.locator('#problem-report-queue');
const loadQueue = async (page: Page) => {
  await panel(page).getByRole('button', { name: 'Load Problem Reports' }).click();
  await expect(panel(page).getByText('RP-000001')).toBeVisible();
};
const rowOf = (page: Page, reference: string) =>
  panel(page).getByRole('listitem').filter({ hasText: reference });

test('the panel is one closed disclosure opened by its address, shows no figure before Load and then n of total waiting', async ({
  page,
}) => {
  await open(page);
  await expect(panel(page)).toHaveJSProperty('open', true);
  // The summary of the panel itself (each report row has a Show Details and History summary of its own).
  await expect(panel(page).locator(':scope > summary')).not.toContainText('waiting');
  await expect(panel(page).getByRole('group', { name: 'Show' })).toBeVisible();
  await loadQueue(page);
  await expect(panel(page).locator(':scope > summary')).toContainText('1 of 2 waiting');
  await expect(panel(page).getByText('Showing 2 of 2 problem reports.')).toBeVisible();
  await expect(
    panel(page).getByText(/^Oldest waiting: filed .* \(UTC\), 1 day ago\.$/),
  ).toBeVisible();
  for (const label of ['All 2', 'Received 1', 'In review 1', 'Resolved 0', 'Closed 0'])
    await expect(panel(page).locator('.ux-segment').filter({ hasText: label })).toHaveCount(1);
  await expect(panel(page)).not.toContainText(/@|email/i);
});

test('Received offers Start Review (note optional) and Mark Closed; In review offers Mark Resolved and Mark Closed', async ({
  page,
}) => {
  await open(page);
  await loadQueue(page);
  const received = rowOf(page, 'RP-000001');
  const names = async (item: ReturnType<typeof rowOf>) =>
    item
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')));
  expect(await names(received)).toEqual(['Start Review RP-000001', 'Mark Closed RP-000001']);
  expect(await names(rowOf(page, 'RP-000002'))).toEqual([
    'Mark Resolved RP-000002',
    'Mark Closed RP-000002',
  ]);
  await received.getByText('Show Details and History').click();
  await expect(received).toContainText('The button did nothing');
});

test('Start Review needs no note; Mark Resolved needs 10 to 1000 characters and says the reporter reads it', async ({
  page,
}) => {
  const sent = await open(page);
  await loadQueue(page);
  await rowOf(page, 'RP-000001').getByRole('button', { name: 'Start Review RP-000001' }).click();
  const form = panel(page).getByRole('form', { name: 'Start Review RP-000001' });
  await expect(form).toContainText(
    'The reporter will read this note. You cannot change or delete it after you save.',
  );
  await expect(form).toContainText(
    "Do not copy a reporter's words into a note; notes stay after the words are removed.",
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(
    panel(page)
      .getByRole('status')
      .filter({ hasText: 'Problem report RP-000001 is now In review.' }),
  ).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body).toMatchObject({
    action: 'transition',
    toState: 'in_review',
    expectedState: 'received',
  });
  expect(sent[0]!.body).not.toHaveProperty('note');

  await rowOf(page, 'RP-000002').getByRole('button', { name: 'Mark Resolved RP-000002' }).click();
  const resolve = panel(page).getByRole('form', { name: 'Mark Resolved RP-000002' });
  await resolve.getByLabel('Note to the reporter').fill('too short');
  await resolve.getByRole('button', { name: 'Save' }).click();
  await expect(resolve.getByRole('alert')).toHaveText(
    'Write 10 to 1000 characters for the reporter.',
  );
  expect(sent).toHaveLength(1);
  await resolve
    .getByLabel('Note to the reporter')
    .fill('We fixed the button on the requests page.');
  await resolve.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body).toMatchObject({
    toState: 'resolved',
    expectedState: 'in_review',
    note: 'We fixed the button on the requests page.',
  });
});

test('a dropped answer keeps the note and the retry carries the same command id', async ({
  page,
}) => {
  const sent = await open(page, {
    answer: (_s, count) =>
      count === 1
        ? { status: 503, json: { error: 'x' } }
        : {
            json: {
              id: id(2),
              reference: 'RP-000002',
              status: 'closed',
              note: 'ok',
              changed: true,
            },
          },
  });
  await loadQueue(page);
  await rowOf(page, 'RP-000002').getByRole('button', { name: 'Mark Closed RP-000002' }).click();
  const form = panel(page).getByRole('form', { name: 'Mark Closed RP-000002' });
  await form.getByLabel('Note to the reporter').fill('Not a fault: the page was working as built.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toHaveText('Problem reports are not available yet.');
  await expect(form.getByLabel('Note to the reporter')).toHaveValue(
    'Not a fault: the page was working as built.',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body.commandId).toBe(sent[0]!.body.commandId);
});

test('409 keeps the note, offers Reload, and the reload shows the new status', async ({ page }) => {
  let moved = false;
  const sent = await open(page, {
    queue: () => queueOf([row(1, moved ? 'in_review' : 'received')]),
    answer: (_s, count) => {
      if (count === 1) {
        moved = true;
        return {
          status: 409,
          json: { error: 'This problem report has changed. Reload and try again' },
        };
      }
      return {
        json: { id: id(1), reference: 'RP-000001', status: 'closed', note: 'ok', changed: true },
      };
    },
  });
  await loadQueue(page);
  await rowOf(page, 'RP-000001').getByRole('button', { name: 'Mark Closed RP-000001' }).click();
  const form = panel(page).getByRole('form', { name: 'Mark Closed RP-000001' });
  await form
    .getByLabel('Note to the reporter')
    .fill('Closed: a duplicate of an older problem report.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'This problem report has changed. Reload and try again.',
  );
  await form.getByRole('button', { name: 'Reload' }).click();
  await expect(rowOf(page, 'RP-000001')).toContainText('In review');
  await expect(form.getByLabel('Note to the reporter')).toHaveValue(
    'Closed: a duplicate of an older problem report.',
  );
  await form.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body).toMatchObject({ expectedState: 'in_review', toState: 'closed' });
  // Another move is another command: the changed one does not reuse the first command id.
  expect(sent[1]!.body.commandId).not.toBe(sent[0]!.body.commandId);
});

test('403 says the role cannot manage problem reports', async ({ page }) => {
  await open(page, { answer: () => ({ status: 403, json: { error: 'x' } }) });
  await loadQueue(page);
  await rowOf(page, 'RP-000001').getByRole('button', { name: 'Start Review RP-000001' }).click();
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText(
    'This role cannot manage problem reports.',
  );
});

test('with Report a Problem not offered the panel is absent and its address is an unknown fragment', async ({
  page,
}) => {
  await open(page, { offered: false });
  // The same sentence any unknown address gets.
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Problem reports', level: 2 })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load Problem Reports' })).toHaveCount(0);
});

test('a workspace mounted without the team frame (shells off) shows the panel when offered and nothing when not', async ({
  page,
}) => {
  await open(page, { shells: false });
  // The team frame is not there: the page is the plain operator workspace, as with the switch off.
  await expect(page.getByText('OPERATOR WORKSPACE')).toBeVisible();
  await expect(page.getByText('TEAM WORKSPACE')).toHaveCount(0);
  await expect(panel(page)).toHaveJSProperty('open', true);
  await loadQueue(page);
  await expect(panel(page).locator(':scope > summary')).toContainText('1 of 2 waiting');
});

test('with Report a Problem not offered and the shells off the panel is absent and its address is an unknown fragment', async ({
  page,
}) => {
  await open(page, { offered: false, shells: false });
  await expect(
    page.getByRole('alert').filter({ hasText: 'This section is unavailable' }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load Problem Reports' })).toHaveCount(0);
});

test('with Report a Problem not offered the owner is shown no Remove Words button on erasure requests', async ({
  page,
}) => {
  await open(page, { offered: false, erasure: erasureRows, hash: 'workspace-settings' });
  await loadErasure(page);
  await expect(page.getByRole('button', { name: /Remove Words Under This Request/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Start Work ERA-2026-0072' })).toBeVisible();
});

test('choosing another filter takes away the old summary and Load More until that filter is loaded', async ({
  page,
}) => {
  await open(page, {
    queue: () => ({ ...queueOf([row(1, 'received'), row(2, 'in_review')]), nextAfter: 2 }),
  });
  await loadQueue(page);
  await expect(
    panel(page).getByRole('button', { name: 'Load More Problem Reports' }),
  ).toBeVisible();
  await panel(page)
    .locator('.ux-segment')
    .filter({ hasText: /^Received/ })
    .click();
  await expect(
    panel(page).getByText('Choose Load Problem Reports to show this selection.'),
  ).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Load More Problem Reports' })).toHaveCount(
    0,
  );
  await expect(panel(page).getByText(/^Showing /)).toHaveCount(0);
  await loadQueue(page);
  await expect(
    panel(page).getByRole('button', { name: 'Load More Problem Reports' }),
  ).toBeVisible();
});

test('choosing another filter keeps the counts and the oldest waiting, which do not depend on the filter', async ({
  page,
}) => {
  await open(page, {
    queue: () => ({ ...queueOf([row(1, 'received'), row(2, 'in_review')]), nextAfter: 2 }),
  });
  await loadQueue(page);
  await panel(page)
    .locator('.ux-segment')
    .filter({ hasText: /^Resolved/ })
    .click();
  await expect(
    panel(page).getByText('Choose Load Problem Reports to show this selection.'),
  ).toBeVisible();
  await expect(panel(page).getByText(/^Showing /)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Load More Problem Reports' })).toHaveCount(
    0,
  );
  await expect(panel(page).locator(':scope > summary')).toContainText('1 of 2 waiting');
  await expect(
    panel(page).getByText(/^Oldest waiting: filed .* \(UTC\), 1 day ago\.$/),
  ).toBeVisible();
  for (const label of ['All 2', 'Received 1', 'In review 1', 'Resolved 0', 'Closed 0'])
    await expect(panel(page).locator('.ux-segment').filter({ hasText: label })).toHaveCount(1);
});

test('a note kept for a report that left the list is offered again after the filter is changed', async ({
  page,
}) => {
  let listed = [row(1, 'received'), row(2, 'in_review')];
  await open(page, {
    queue: () => queueOf(listed),
    answer: () => ({
      status: 409,
      json: { error: 'This problem report has changed. Reload and try again' },
    }),
  });
  await loadQueue(page);
  await rowOf(page, 'RP-000002').getByRole('button', { name: 'Mark Closed RP-000002' }).click();
  const form = panel(page).getByRole('form', { name: 'Mark Closed RP-000002' });
  await form.getByLabel('Note to the reporter').fill('Closed: a duplicate of an older report.');
  await form.getByRole('button', { name: 'Save' }).click();
  listed = [row(1, 'received')];
  await form.getByRole('button', { name: 'Reload' }).click();
  await expect(
    panel(page).getByText(
      'This problem report is no longer in this list. Your note is kept if you open it again.',
    ),
  ).toBeVisible();
  // The report is back in the list under another filter; the sentence above stays true.
  listed = [row(1, 'received'), row(2, 'in_review')];
  await panel(page)
    .locator('.ux-segment')
    .filter({ hasText: /^In review/ })
    .click();
  await loadQueue(page);
  await rowOf(page, 'RP-000002').getByRole('button', { name: 'Mark Closed RP-000002' }).click();
  await expect(
    panel(page)
      .getByRole('form', { name: 'Mark Closed RP-000002' })
      .getByLabel('Note to the reporter'),
  ).toHaveValue('Closed: a duplicate of an older report.');
});

test('typing in the note after a failure keeps the focus in the note', async ({ page }) => {
  await open(page, { answer: () => ({ status: 503, json: { error: 'x' } }) });
  await loadQueue(page);
  await rowOf(page, 'RP-000002').getByRole('button', { name: 'Mark Closed RP-000002' }).click();
  const form = panel(page).getByRole('form', { name: 'Mark Closed RP-000002' });
  const note = form.getByLabel('Note to the reporter');
  await note.fill('Not a fault: the page was working as built.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toHaveText('Problem reports are not available yet.');
  await note.focus();
  await page.keyboard.type(' More words.');
  await expect(note).toBeFocused();
  await expect(note).toHaveValue('Not a fault: the page was working as built. More words.');
});

test('a fresh authenticator check opens the dialog; Not now keeps the note and Save tries again with the same command id', async ({
  page,
}) => {
  const sent = await open(page, {
    answer: (_s, count) =>
      count === 1
        ? { status: 401, json: { error: 'Verify again.', code: 'STEP_UP_REQUIRED' } }
        : {
            json: {
              id: id(2),
              reference: 'RP-000002',
              status: 'resolved',
              note: 'ok',
              changed: true,
            },
          },
  });
  await loadQueue(page);
  await rowOf(page, 'RP-000002').getByRole('button', { name: 'Mark Resolved RP-000002' }).click();
  const form = panel(page).getByRole('form', { name: 'Mark Resolved RP-000002' });
  await form.getByLabel('Note to the reporter').fill('We fixed the button on the requests page.');
  await form.getByRole('button', { name: 'Save' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'Confirm your authenticator code to finish this. Your changes are kept.',
  );
  await expect(form.getByLabel('Note to the reporter')).toHaveValue(
    'We fixed the button on the requests page.',
  );
  await expect(form.getByRole('button', { name: 'Save' })).toBeEnabled();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body.commandId).toBe(sent[0]!.body.commandId);
});

const erasureRows = [
  {
    id: id(71),
    number: 1,
    reference: 'ERA-2026-0071',
    filedAt: '2026-11-01T09:00:00Z',
    dueAt: '2026-12-01T09:00:00Z',
    daysLeft: 20,
    status: 'in_progress',
    note: null,
    accountStatus: 'closed',
    closedAt: null,
    undoUntil: null,
  },
  {
    id: id(72),
    number: 2,
    reference: 'ERA-2026-0072',
    filedAt: '2026-11-02T09:00:00Z',
    dueAt: '2026-12-02T09:00:00Z',
    daysLeft: 21,
    status: 'received',
    note: null,
    accountStatus: 'closed',
    closedAt: null,
    undoUntil: null,
  },
  {
    id: id(73),
    number: 3,
    reference: 'ERA-2026-0073',
    filedAt: '2026-11-03T09:00:00Z',
    dueAt: '2026-12-03T09:00:00Z',
    daysLeft: 22,
    status: 'completed',
    note: 'Kept the invoices',
    accountStatus: 'final',
    closedAt: null,
    undoUntil: null,
  },
];
const loadErasure = async (page: Page) => {
  await page.getByRole('button', { name: 'Load Erasure Requests' }).click();
  await expect(page.getByText('ERA-2026-0071')).toBeVisible();
};

test('the owner removes words under an in-progress or completed erasure request; the count is shown only after the answer', async ({
  page,
}) => {
  const sent = await open(page, {
    erasure: erasureRows,
    answer: () => ({ json: { reference: 'ERA-2026-0071', removed: 3 } }),
  });
  await loadErasure(page);
  await expect(page.getByRole('button', { name: /^Remove Words Under This Request/ })).toHaveCount(
    2,
  );
  await expect(
    page.getByRole('button', { name: 'Remove Words Under This Request ERA-2026-0072' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Words Under This Request ERA-2026-0071' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove words under this request?' });
  await expect(dialog).toContainText(
    'This removes the words of every problem report of this person filed up to this request. It cannot be undone. Notes stay.',
  );
  await expect(page.getByText(/Words removed from/)).toHaveCount(0);
  expect(sent).toHaveLength(0);
  await expect(dialog.getByRole('button', { name: 'Keep Words' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Remove Words' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Words removed from 3 problem reports.' }),
  ).toBeVisible();
  expect(sent[0]!.body).toMatchObject({ action: 'remove_words', erasureRequestId: id(71) });
});

test('removal refused for a role that is not owner says so, and 503 says problem reports are not available yet', async ({
  page,
}) => {
  const answers: Answer[] = [
    { status: 403, json: { error: 'x' } },
    { status: 503, json: { error: 'x' } },
  ];
  await open(page, { erasure: erasureRows, answer: (_s, count) => answers[count - 1]! });
  await loadErasure(page);
  await page.getByRole('button', { name: 'Remove Words Under This Request ERA-2026-0071' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove words under this request?' });
  await dialog.getByRole('button', { name: 'Remove Words' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Only an owner can remove words under an erasure request.',
  );
  await dialog.getByRole('button', { name: 'Remove Words' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Problem reports are not available yet.');
  await expect(page.getByText(/Words removed from/)).toHaveCount(0);
});

test('the settings tab with the panel closed adds only its own closed height, has no sideways scroll, 44 px targets and no axe violations', async ({
  page,
}) => {
  await open(page);
  await panel(page).evaluate((element) => ((element as HTMLDetailsElement).open = false));
  // The Settings tab is long before this panel exists (ReviewSettings and the erasure queue alone are about 4.23 screens at
  // 320, 2.97 at 390, 1.83 at 768 and 1.68 at 1440, measured with the panel hidden), so an absolute limit cannot hold here.
  // What this panel owns is the height it adds: its one closed line.
  const closedPanelHeightLimit = 80;
  const widths = [
    [320, 700],
    [390, 844],
    [768, 1000],
    [1440, 900],
  ] as const;
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height });
    const measured = await page.evaluate(() => {
      const element = document.getElementById('problem-report-queue') as HTMLElement;
      element.style.display = 'none';
      const without = document.documentElement.scrollHeight;
      element.style.display = '';
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        added: document.documentElement.scrollHeight - without,
      };
    });
    expect(measured.overflow, `${width} sideways`).toBeLessThanOrEqual(0);
    expect(measured.added, `${width} height added by the closed panel`).toBeLessThanOrEqual(
      closedPanelHeightLimit,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel(page).evaluate((element) => ((element as HTMLDetailsElement).open = true));
  await loadQueue(page);
  const small = await panel(page).evaluate((element) =>
    Array.from(element.querySelectorAll('a[href], button, summary, .ux-segment'))
      .filter((target) => (target as HTMLElement).offsetParent !== null)
      .map((target) => ({
        text: (target.textContent ?? '').trim().slice(0, 40),
        height: Math.round(target.getBoundingClientRect().height),
      }))
      .filter((target) => target.height < 44),
  );
  expect(small).toEqual([]);
  const violations = (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  ).violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.target}`);
  expect(violations).toEqual([]);
});
