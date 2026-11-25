import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureTenant, startPagePatternFixture } from './d4-page-pattern-fixture';

// Team desk v4.1, Phase 5 (units D11, D12, D13), behind CORRIDRA_UX_TEAM_DESK_V41, on the real workspace bundle
// and stylesheets. Off, each of the three screens is the one the desk has today. On:
//   D11 Meetings: five columns, each a group of the eight stored statuses, stacked on a phone; a card shows its
//       exact status word and its change form opens in the shared dialog with the same payload. An introduction is
//       never in a column, and the note written for an outreach email stays in view.
//   D12 Money: five exact amounts per currency, then the list of opportunities.
//   D13 Reports: one list of reports with a status word, and the mission a mission page asked for (?mission=).
let fixture: Awaited<ReturnType<typeof startPagePatternFixture>>;
test.beforeAll(async () => {
  fixture = await startPagePatternFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

const owner = '00000000-0000-4000-8000-0000000000b1';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const due = '2026-12-01T09:00:00.000Z';

const message = (n: number, company: string, extra: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  link_id: id(200 + n),
  presentation: { company },
  channel: 'SYNTHETIC',
  decision: null,
  response_id: null,
  delivery_status: 'DELIVERED',
  attempts: 1,
  revoked: false,
  expires_at: due,
  ...extra,
});
const communications = {
  role: 'owner',
  policies: [],
  templates: [],
  targets: [],
  contacts: [],
  // The second message is a real email sent in test mode: its note must stay in view (ADR-090, PR 620).
  messages: [
    message(1, 'Introduction Only Buyer'),
    message(2, 'Test Mode Buyer', {
      channel: 'EMAIL',
      delivery_note: 'Test, sent to a test address only',
    }),
  ],
  optouts: [],
  targetsTotal: 0,
  targetsNext: null,
  contactsTotal: 0,
  contactsNext: null,
  messagesTotal: 2,
  messagesNext: null,
  optoutsTotal: 0,
  optoutsNext: null,
  attempts: [],
};
const statuses = [
  'PROPOSED',
  'ACCEPTED',
  'SCHEDULED',
  'HELD',
  'DECLINED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULE_REQUIRED',
] as const;
const meeting = (n: number, status: string) => ({
  id: id(300 + n),
  message_id: id(101),
  title: `Meeting ${n} ${status.toLowerCase().replaceAll('_', ' ')}`,
  brief: `Private brief of meeting ${n}.`,
  status,
  version: n,
  owner_id: owner,
  next_action: `Next step of meeting ${n}`,
  due_at: due,
  starts_at: null,
  ends_at: null,
  timezone: null,
  local_start: null,
  local_end: null,
  location: null,
});
const meetings = {
  role: 'owner',
  owners: [{ user_id: owner, name: 'Amina Rahman' }],
  // One meeting in every stored status, and a second proposed one.
  meetings: [
    ...statuses.map((status, index) => meeting(index + 1, status)),
    meeting(9, 'PROPOSED'),
  ],
  meetingsTotal: 9,
  next: null,
  followupsTotal: 0,
  followupsNext: null,
  participants: [{ id: id(400), meeting_id: id(301), name: 'Buyer Lead' }],
  outcomes: [],
  followups: [],
  history: [],
};
const totals = (currency: string, base: number) => ({
  currency,
  proposal_minor: String(base + 1),
  commitment_minor: String(base + 2),
  contract_minor: String(base + 3),
  invoice_minor: String(base + 4),
  reported_cash_minor: String(base + 5),
  confirmed_cash_minor: String(base + 6),
  repeat_cash_minor: String(base + 7),
});
const opportunities = {
  role: 'owner',
  freshMfa: true,
  enabled: true,
  opportunities: [
    {
      id: id(500),
      meeting_id: id(304),
      origin_id: null,
      mission_id: id(700),
      title: 'Knitwear programme',
      status: 'QUALIFIED_OPPORTUNITY',
      version: 2,
      owner_id: owner,
      next_action: 'Send the proposal',
      due_at: due,
      attribution: 'Followed the held meeting.',
      loss_reason: null,
    },
  ],
  total: 1,
  records: [],
  recordsTruncated: false,
  recordCounts: [],
  confirmations: [],
  owners: [{ user_id: owner, name: 'Amina Rahman' }],
  meetings: [],
  origins: [],
  missions: [{ id: id(700), label: 'Dhaka Knit Co' }],
  sources: [],
  evidence: [],
  history: [],
  metrics: {
    opportunities: 1,
    qualified: 1,
    proposals: 0,
    contracts: 0,
    cash: 0,
    recurrence: 0,
    lost: 0,
  },
  activity: {
    targets: 3,
    introductions: 2,
    held_meetings: 1,
    accepted_meetings: 1,
    rfqs: 0,
    samples: 0,
  },
  // 123456701 minor units of USD is exactly USD 1234567.01; JPY has no minor unit.
  totals: [totals('USD', 123456700), totals('JPY', 900)],
  overdue: [],
  meetingFollowups: [],
};
const knownMission = id(700);
const otherMission = id(701);
const delivery = {
  role: 'owner',
  programmes: [],
  programmeTotal: 0,
  participants: [],
  publications: [
    {
      id: id(800),
      mission_id: knownMission,
      copy: { title: 'Progress report', company: 'Dhaka Knit Co' },
      revoked: false,
    },
    {
      id: id(801),
      mission_id: knownMission,
      copy: { title: 'First report', company: 'Dhaka Knit Co' },
      revoked: true,
    },
    {
      id: id(802),
      mission_id: otherMission,
      copy: { title: 'Market report', company: 'Sylhet Leather Ltd' },
      revoked: false,
    },
  ],
  links: [],
  requests: [],
  owners: [{ user_id: owner, name: 'Amina Rahman' }],
};
const experience = {
  organisations: [],
  contexts: [],
  agenda: [],
  requirements: [],
  targets: [],
  quotations: [],
  links: [],
  rfqs: [],
  disclosures: [],
  responses: [],
};
const missionList = {
  total: 2,
  missions: [
    { id: knownMission, brief: { company: 'Dhaka Knit Co' } },
    { id: otherMission, brief: { company: 'Sylhet Leather Ltd' } },
  ],
};

type Options = {
  v41: boolean;
  width?: number;
  height?: number;
  query?: string;
  empty?: boolean;
  /** The server holds more meetings than the page it sent: a next page is named and no total is given. */
  more?: boolean;
  posts?: { url: string; body: unknown }[];
  /** Fixture for the plain-words checks: an approved policy, a reply, a scheduled meeting and one follow-up. */
  rich?: boolean;
  /** A reader who may not manage introductions or meetings (staff-core-25). */
  limited?: boolean;
};
const richCommunications = {
  ...communications,
  policies: [
    {
      id: id(900),
      jurisdiction: 'DE',
      channel: 'SYNTHETIC',
      contact_purpose: 'OFFICIAL_COMPANY_CHANNEL',
      version: 1,
      enabled: true,
      valid_until: '2027-01-01T00:00:00.000Z',
      basis: 'Approved basis.',
    },
  ],
  messages: [
    message(1, 'Introduction Only Buyer', { decision: 'INTERESTED' }),
    message(2, 'Introduction Only Buyer', { decision: 'NOT_RELEVANT' }),
  ],
};
const richMeetings = {
  ...meetings,
  meetings: meetings.meetings.map((m) =>
    // A cancelled meeting keeps the time it had (starts_at is never cleared): its card must not say it "Meets".
    m.status === 'SCHEDULED' || m.status === 'CANCELLED'
      ? {
          ...m,
          starts_at: '2026-12-10T09:00:00.000Z',
          ends_at: '2026-12-10T10:00:00.000Z',
          timezone: 'Europe/Madrid',
          location: 'Video call',
        }
      : m,
  ),
  followups: [
    {
      id: id(950),
      meeting_id: id(303),
      owner_id: owner,
      next_action: 'Follow the meeting plan',
      due_at: due,
      status: 'OPEN',
      version: 1,
    },
  ],
};
async function open(page: Page, path: string, options: Options) {
  const {
    v41,
    width = 1440,
    height = 900,
    query = '',
    empty = false,
    more = false,
    posts,
    rich = false,
    limited = false,
  } = options;
  await page.setViewportSize({ width, height });
  // A script error on the page fails the test at once, with its own words.
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: 'Not part of this fixture' } }),
  );
  await page.route('**/api/team-work/flags', (route) =>
    route.fulfill({ json: { missionsV2: true } }),
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
  await page.route('**/api/workspace/communications?*', (route) =>
    route.fulfill({
      json: {
        ...(rich ? richCommunications : communications),
        ...(limited ? { role: 'viewer' } : {}),
      },
    }),
  );
  await page.route('**/api/workspace/meetings?*', (route) =>
    route.fulfill({
      json: empty
        ? { ...meetings, meetings: [], meetingsTotal: 0 }
        : more
          ? { ...meetings, meetingsTotal: null, next: 'page-2' }
          : rich
            ? richMeetings
            : meetings,
    }),
  );
  await page.route('**/api/workspace/meeting?*', (route) => {
    posts?.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/workspace/opportunities?*', (route) =>
    route.fulfill({ json: empty ? { ...opportunities, totals: [] } : opportunities }),
  );
  await page.route('**/api/workspace/missions?*', (route) => route.fulfill({ json: missionList }));
  await page.route('**/api/workspace/delivery?*', (route) =>
    route.fulfill({
      json: route.request().url().includes('action=options')
        ? { meetings: [], opportunities: [] }
        : route.request().url().includes('action=experience')
          ? experience
          : empty
            ? { ...delivery, publications: [] }
            : delivery,
    }),
  );
  await page.goto(`${fixture.origin}${path}?v41=${v41 ? 'on' : 'off'}&role=owner${query}`);
  await expect(page.getByLabel('Workspace status')).toBeAttached();
  await expect(page.getByText('Loading workspace…')).toHaveCount(0);
}
const panel = (page: Page, section: string) => page.locator(`#workspace-${section}`);
/** The mission select of the publication form (its label also holds the option words). */
const missionSelect = (page: Page) =>
  panel(page, 'delivery')
    .locator('details', { hasText: 'Review client publication' })
    .locator('label', { hasText: 'Mission' })
    .locator('select');
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Opens a tab and waits until its panel is the one shown. */
async function openTab(page: Page, section: string, name: RegExp) {
  const tab = panel(page, section).getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

// D11 Meetings -------------------------------------------------------------------------------------------------

test('D11 switch off: meetings are the cards the desk has today, with the form on the card', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: false });
  const section = panel(page, 'meetings');
  await openTab(page, 'meetings', /^Meetings \(9\)$/);
  await expect(section.locator('.ux-meeting-board')).toHaveCount(0);
  await expect(section.locator('.ux-meeting-column')).toHaveCount(0);
  const card = section.locator('article.meeting-card').first();
  await expect(card.locator('h4')).toHaveText('Meeting 1 proposed');
  await expect(card.getByText('State: Proposed. Version 1.')).toBeVisible();
  await expect(card.getByText('Private brief of meeting 1.')).toBeVisible();
  await expect(card.getByRole('form', { name: 'Update meeting Meeting 1 proposed' })).toBeVisible();
  await expect(section.getByRole('button', { name: /^Update Meeting/ })).toHaveCount(0);
  await expect(section.locator('dialog')).toHaveCount(0);
  await expect(section.locator('article.meeting-card')).toHaveCount(9);
});

test('D11 switch on: the page opens on five columns of real statuses, every card with its exact status word', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true });
  const section = panel(page, 'meetings');
  // The board is the page: its tab is the first and is the one shown, with the other two beside it.
  await expect(section.getByRole('tab')).toHaveText([
    'Meetings (9)',
    'Introductions (2)',
    'Follow-up (0)',
  ]);
  await expect(section.getByRole('tab', { name: 'Meetings (9)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const columns = section.locator('.ux-meeting-board > section.ux-meeting-column');
  await expect(columns).toHaveCount(5);
  await expect(columns.locator('h4')).toHaveText([
    'Proposed (2)',
    'Accepted (1)',
    'Scheduled (1)',
    'Needs a New Time (2)',
    'Finished (3)',
  ]);
  // From 40rem a column is a heading over its cards: its disclosure line is not shown.
  await expect(columns.locator('summary').first()).toBeHidden();
  const words = (index: number) => columns.nth(index).locator('article.meeting-card .ux-status');
  await expect(words(0)).toHaveText(['Proposed', 'Proposed']);
  await expect(words(1)).toHaveText(['Accepted']);
  await expect(words(2)).toHaveText(['Scheduled']);
  await expect(words(3)).toHaveText(['No show', 'Reschedule required']);
  // The last column holds the three statuses with no next state; each keeps its own word and only Held is
  // shown as positive, so a declined or cancelled meeting never reads as a success.
  await expect(words(4)).toHaveText(['Held', 'Declined', 'Cancelled']);
  expect(
    await words(4).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-tone'))),
  ).toEqual(['positive', 'unknown', 'unknown']);
  // Every meeting is in exactly one column.
  await expect(section.locator('article.meeting-card')).toHaveCount(9);
  // A card is its title, status word, next step and one control. Nothing else is on the card.
  const first = columns.nth(0).locator('article.meeting-card').first();
  await expect(first.locator('h5')).toHaveText('Meeting 1 proposed');
  await expect(first).toContainText('Next: Next step of meeting 1 · Amina Rahman · due');
  await expect(first).not.toContainText('Version');
  await expect(first.locator('> button')).toHaveCount(1);
  await expect(first.locator('> details')).toHaveCount(0);
  // A meeting that can change offers Update Meeting; a finished one can only be viewed.
  await expect(columns.nth(0).getByRole('button', { name: /^Update Meeting/ })).toHaveCount(2);
  await expect(columns.nth(4).getByRole('button', { name: /^Update Meeting/ })).toHaveCount(0);
  await expect(columns.nth(4).getByRole('button', { name: /^View Meeting/ })).toHaveCount(3);
  // The brief, the participants and the history are in the dialog the one control opens.
  await expect(first.getByText('Private brief of meeting 1.')).toBeHidden();
  await first.getByRole('button', { name: 'Update Meeting Meeting 1 proposed' }).click();
  const dialog = page.getByRole('dialog', { name: 'Update Meeting' });
  await expect(dialog.getByText('Private brief of meeting 1.')).toBeVisible();
  await expect(dialog.getByText('Participants: Buyer Lead')).toBeVisible();
  await expect(dialog.getByText('Meeting history')).toBeVisible();
  await page.keyboard.press('Escape');
  // A finished meeting shows the same facts and no form.
  await columns.nth(4).getByRole('button', { name: 'View Meeting Meeting 4 held' }).click();
  const view = page.getByRole('dialog', { name: 'View Meeting' });
  await expect(view.getByText('Private brief of meeting 4.')).toBeVisible();
  await expect(view.getByRole('form')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('h1')).toHaveCount(1);
});

test('F5 switch on: the meeting page speaks plainly, tells cards and replies apart and names each follow-up', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true, rich: true });
  const section = panel(page, 'meetings');
  // One heading per level: the page heading, not a second "Introductions and meetings" or the tab name again.
  // The heading that repeats the page title is for screen readers only; no second one is drawn.
  await expect(section.getByRole('heading', { name: 'Introductions and meetings' })).toHaveClass(
    /sr-only/,
  );
  await expect(section.getByRole('heading', { name: 'Meeting itinerary' })).toHaveClass(/sr-only/);
  await expect(section.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(section.getByText('Briefs and outcomes stay private to authorized')).toHaveCount(0);
  // A card names the buyer and the time of a scheduled meeting; the version number is not on it.
  const cards = section.locator('article.meeting-card');
  await expect(cards.first()).toContainText('With Introduction Only Buyer.');
  await expect(cards.first()).not.toContainText('Version');
  const scheduled = section.locator('.ux-meeting-column').nth(2).locator('article.meeting-card');
  await expect(scheduled).toContainText('Meets');
  await expect(cards.first()).not.toContainText('Meets');
  // A cancelled meeting still holds its old time but is not meeting then: no "Meets" on its card.
  const cancelled = section.locator('article.meeting-card', { hasText: 'Meeting 6 cancelled' });
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled).not.toContainText('Meets');
  // The change button stays on one line.
  const button = cards.first().getByRole('button', { name: /^Update Meeting/ });
  const box = await button.boundingBox();
  expect(box!.height).toBeLessThan(60);
  // The propose list: words, not stored codes, and the same buyer twice is told apart by the reply.
  await section.getByRole('tab', { name: /^Introductions/ }).click();
  await section.getByText('Approved communication policy and templates').click();
  // A06e: the policy list names the country by its mark and name; the policy choice of a new introduction names it
  // in words (an option holds text only). The stored code is unchanged.
  const policy = section.locator('li', {
    hasText: 'Germany / Recorded receipt (no email sent) / Official company channel',
  });
  await expect(policy).toBeVisible();
  // Germany has no mark of its own, so its name is written alone (UI/UX.v4.1 L1: never a code).
  await expect(policy.locator('.ux-flagged')).toHaveText('Germany');
  await expect(
    section.getByRole('option', { name: /^Germany \/ Recorded receipt \(no email sent\) \// }),
  ).toHaveCount(1);
  await section.getByRole('tab', { name: /^Follow-up/ }).click();
  const followup = section.locator('article.detail-card', { hasText: 'Follow the meeting plan' });
  await expect(followup.getByText('Meeting: Meeting 3 scheduled.')).toBeVisible();
  const result = followup.getByLabel('Follow-up result');
  await expect(result.locator('option')).toHaveText(['Completed', 'Cancelled']);
  await expect(result.locator('option').first()).toHaveAttribute('value', 'COMPLETED');
  await section.getByRole('tab', { name: /^Meetings/ }).click();
  await page.locator('.ux-page-heading').getByRole('button', { name: 'Propose Meeting' }).click();
  const options = page
    .getByRole('dialog', { name: 'Propose Meeting' })
    .getByLabel('Meeting introduction')
    .locator('option');
  // staff-core-23: a meeting is proposed on an interested reply only, so the not-relevant reply is not offered.
  await expect(options).toHaveText([/^Introduction Only Buyer, interested, link expires /]);
  await expect(options.first()).toHaveAttribute('value', id(101));
});

test('D11 switch on: a column counts what is loaded and says so while more is to come', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true, more: true });
  const columns = panel(page, 'meetings').locator('.ux-meeting-column');
  await expect(columns.locator('h4')).toHaveText([
    'Proposed (2 shown)',
    'Accepted (1 shown)',
    'Scheduled (1 shown)',
    'Needs a New Time (2 shown)',
    'Finished (3 shown)',
  ]);
});

test('D11 switch on: Propose Meeting is the one primary action in the header and opens the shared dialog', async ({
  page,
}) => {
  const posts: { url: string; body: unknown }[] = [];
  // The rich fixture holds an interested reply; a meeting is proposed on one (staff-core-23).
  await open(page, '/operator/meetings', { v41: true, posts, rich: true });
  const section = panel(page, 'meetings');
  const propose = page.locator('.ux-page-heading').getByRole('button', { name: 'Propose Meeting' });
  await expect(propose).toBeVisible();
  // One primary action on the page, and no second copy of the form on the board.
  await expect(page.locator('.ux-frame-primary').getByRole('button')).toHaveCount(1);
  await expect(section.getByText('Propose a meeting')).toHaveCount(0);
  await propose.click();
  const dialog = page.getByRole('dialog', { name: 'Propose Meeting' });
  await expect(dialog).toBeVisible();
  const form = dialog.getByRole('form', { name: 'Propose meeting' });
  await form.getByLabel('Meeting title').fill('First call');
  await form.getByLabel('Meeting brief').fill('Agree the sample plan');
  await form.getByLabel('Meeting participants, one per line').fill('Buyer Lead\nAmina Rahman');
  // Two steps of one form (staff-core-23): the meeting, then who owns its next step.
  await form.getByRole('button', { name: 'Continue' }).click();
  await form.getByLabel('Meeting next action').fill('Send the agenda');
  await form.getByLabel('Meeting command reason').fill('Buyer asked for a call');
  await form.getByRole('button', { name: 'Propose Meeting' }).click();
  await expect(dialog).toBeHidden();
  await expect(section.getByRole('status', { name: 'Access status' })).toHaveText('Saved.');
  expect(posts).toHaveLength(1);
  const body = posts[0].body as Record<string, unknown>;
  expect({ ...body, commandId: '', dueAt: '', messageId: '', ownerId: '' }).toEqual({
    action: 'propose',
    messageId: '',
    title: 'First call',
    brief: 'Agree the sample plan',
    participants: ['Buyer Lead', 'Amina Rahman'],
    ownerId: '',
    nextAction: 'Send the agenda',
    dueAt: '',
    reason: 'Buyer asked for a call',
    commandId: '',
  });
  expect(body.messageId).toBe(id(101));
});

test('D11 switch on: an introduction is never in a column, and the outreach note stays in view', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true });
  const section = panel(page, 'meetings');
  const board = section.locator('.ux-meeting-board');
  await expect(board).toBeVisible();
  await expect(board.locator('article.introduction-card')).toHaveCount(0);
  // The buyer that only has an introduction is offered in the Propose form, not shown as a meeting.
  // A card may say whom the meeting is with; no card is headed by the buyer, as an introduction would be.
  await expect(board.locator('article > h5', { hasText: 'Introduction Only Buyer' })).toHaveCount(
    0,
  );
  // Stronger than the heading check: the buyer may appear on a meeting card ("With ...") and nowhere else.
  await expect(
    board.locator('article:not(.meeting-card)', { hasText: 'Introduction Only Buyer' }),
  ).toHaveCount(0);
  await expect(board.locator('article', { hasText: 'Test Mode Buyer' })).toHaveCount(0);
  // The Introductions tab is one tap away and the test-mode note of the sent email is written on its card.
  // The sentence about introduction channels is in the Introductions tab, not above the board.
  const note = section.getByText('Each introduction goes out through the channel');
  await expect(note).toHaveCount(1);
  await expect(note).toBeHidden();
  await openTab(page, 'meetings', /^Introductions \(2\)$/);
  await expect(note).toBeVisible();
  const card = section.locator('article.introduction-card', { hasText: 'Test Mode Buyer' });
  await expect(card.getByText(/^Delivery note: /)).toBeVisible();
});

test('D11 switch on: the change form opens in the shared dialog and sends the same payload', async ({
  page,
}) => {
  const posts: { url: string; body: unknown }[] = [];
  await open(page, '/operator/meetings', { v41: true, posts });
  const section = panel(page, 'meetings');
  await openTab(page, 'meetings', /^Meetings \(9\)$/);
  const opener = section.getByRole('button', { name: 'Update Meeting Meeting 1 proposed' });
  await expect(opener).toHaveText('Update Meeting');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Update Meeting' });
  await expect(dialog).toBeVisible();
  const form = dialog.getByRole('form', { name: 'Update meeting Meeting 1 proposed' });
  // The choices read in plain words; the value sent is the stored code.
  await expect(form.getByLabel('Next meeting state')).toHaveValue('ACCEPTED');
  await expect(form.getByLabel('Next meeting state').locator('option')).toHaveText([
    'Accepted',
    'Declined',
    'Cancelled',
  ]);
  await expect(form.getByLabel('Meeting next action')).toHaveValue('Next step of meeting 1');
  // Escape closes it and focus returns to the button that opened it; what was typed is kept.
  await form.getByLabel('Meeting command reason').fill('Buyer agreed by phone');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(form.getByLabel('Meeting command reason')).toHaveValue('Buyer agreed by phone');
  await form.getByLabel('Acceptance source').fill('Phone call with the buyer');
  await form.getByRole('button', { name: 'Record Meeting Change' }).click();
  await expect(dialog).toBeHidden();
  await expect(section.getByRole('status', { name: 'Access status' })).toHaveText('Saved.');
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toContain(`/api/workspace/meeting?tenant=${fixtureTenant}`);
  const body = posts[0].body as Record<string, unknown>;
  expect(typeof body.commandId).toBe('string');
  expect(typeof body.dueAt).toBe('string');
  expect({ ...body, commandId: '', dueAt: '' }).toEqual({
    action: 'transition',
    id: id(301),
    version: 1,
    status: 'ACCEPTED',
    reason: 'Buyer agreed by phone',
    ownerId: owner,
    nextAction: 'Next step of meeting 1',
    dueAt: '',
    acceptance: 'Phone call with the buyer',
    commandId: '',
  });
});

test('D11 switch on: a refused change is said inside the dialog and the dialog stays open', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true });
  await page.route('**/api/workspace/meeting?*', (route) =>
    route.fulfill({ status: 409, json: { error: 'Invalid meeting transition' } }),
  );
  const section = panel(page, 'meetings');
  await openTab(page, 'meetings', /^Meetings \(9\)$/);
  await section.getByRole('button', { name: 'Update Meeting Meeting 2 accepted' }).click();
  const dialog = page.getByRole('dialog', { name: 'Update Meeting' });
  await dialog.getByLabel('Next meeting state').selectOption('CANCELLED');
  await dialog.getByLabel('Meeting command reason').fill('Buyer withdrew');
  await dialog.getByRole('button', { name: 'Record Meeting Change' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Invalid meeting transition');
  await expect(dialog).toBeVisible();
});

test('D11 switch on: five columns side by side on a desktop, stacked in order on a phone', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true, width: 1440 });
  await openTab(page, 'meetings', /^Meetings \(9\)$/);
  const columns = panel(page, 'meetings').locator('.ux-meeting-column');
  const boxes = async () =>
    columns.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) };
      }),
    );
  const wide = await boxes();
  expect(new Set(wide.map((box) => box.y)).size, 'one row at 1440').toBe(1);
  for (let index = 1; index < wide.length; index += 1)
    expect(wide[index].x).toBeGreaterThan(wide[index - 1].x);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await open(page, '/operator/meetings', { v41: true, width: 390, height: 844 });
  await expect(columns).toHaveCount(5);
  const narrow = await boxes();
  expect(new Set(narrow.map((box) => box.x)).size, 'one column at 390').toBe(1);
  for (let index = 1; index < narrow.length; index += 1)
    expect(narrow[index].y).toBeGreaterThan(narrow[index - 1].y);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // On a phone each column is a closed disclosure that shows its count, and its heading is not repeated.
  const folds = columns.locator('details.phone-fold');
  await expect(folds.locator('> summary')).toHaveText([
    'Proposed (2)',
    'Accepted (1)',
    'Scheduled (1)',
    'Needs a New Time (2)',
    'Finished (3)',
  ]);
  expect(
    await folds.evaluateAll((nodes) => nodes.map((n) => (n as HTMLDetailsElement).open)),
  ).toEqual(Array(5).fill(false));
  await expect(columns.locator('h4').first()).toBeHidden();
  await expect(columns.locator('article.meeting-card').first()).toBeHidden();
  // Closed, the whole Meetings page is at most two screens of a phone, on a tall one and on a short one.
  const lengthInScreens = () =>
    page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
  expect(await lengthInScreens(), 'page length at 390x844').toBeLessThanOrEqual(2);
  await open(page, '/operator/meetings', { v41: true, width: 375, height: 667 });
  await expect(columns).toHaveCount(5);
  expect(await lengthInScreens(), 'page length at 375x667').toBeLessThanOrEqual(2);
  await open(page, '/operator/meetings', { v41: true, width: 390, height: 844 });
  await folds.first().locator('> summary').click();
  const button = columns
    .first()
    .getByRole('button', { name: /^Update Meeting/ })
    .first();
  await expect(button).toBeVisible();
  // The button of a card is a 44 px target on a phone.
  expect(
    await button.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
});

test('D11 switch on: with no meeting every column says so', async ({ page }) => {
  await open(page, '/operator/meetings', { v41: true, empty: true });
  await openTab(page, 'meetings', /^Meetings \(0\)$/);
  const columns = panel(page, 'meetings').locator('.ux-meeting-column');
  await expect(columns).toHaveCount(5);
  await expect(columns.locator('.ux-meeting-none')).toHaveText(Array(5).fill('No meetings.'));
});

test('F5c switch on: a reader who may not manage meetings is told the columns hold what they can see', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true, empty: true, limited: true });
  await openTab(page, 'meetings', /^Meetings \(0\)$/);
  const columns = panel(page, 'meetings').locator('.ux-meeting-column');
  await expect(columns.locator('.ux-meeting-none')).toHaveText(
    Array(5).fill('No meetings you can see.'),
  );
  await expect(
    page.locator('.ux-page-heading').getByRole('button', { name: 'Propose Meeting' }),
  ).toHaveCount(0);
});

test('F5c switch on: Propose Meeting goes in two steps, offers interested replies only and says so when there is none', async ({
  page,
}) => {
  await open(page, '/operator/meetings', { v41: true, rich: true });
  await page.locator('.ux-page-heading').getByRole('button', { name: 'Propose Meeting' }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose Meeting' });
  const form = dialog.getByRole('form', { name: 'Propose meeting' });
  await expect(form.getByText('Step 1 of 2: the reply and the meeting.')).toBeVisible();
  await expect(form.getByLabel('Meeting next action')).toBeHidden();
  await expect(form.getByRole('button', { name: 'Propose Meeting' })).toBeHidden();
  // Continue checks the first step and stays on it while a field is missing.
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByLabel('Meeting title')).toBeVisible();
  await expect(form.getByLabel('Meeting next action')).toBeHidden();
  await form.getByLabel('Meeting title').fill('First call');
  await form.getByLabel('Meeting brief').fill('Agree the sample plan');
  await form.getByLabel('Meeting participants, one per line').fill('Buyer Lead');
  await form.getByRole('button', { name: 'Continue' }).click();
  await expect(form.getByText('Step 2 of 2: who owns the next step.')).toBeVisible();
  await expect(form.getByLabel('Meeting title')).toBeHidden();
  await expect(form.getByLabel('Meeting or follow-up owner')).toBeFocused();
  // Back keeps what was typed.
  await form.getByRole('button', { name: 'Back' }).click();
  await expect(form.getByLabel('Meeting title')).toHaveValue('First call');
  await page.keyboard.press('Escape');
  // With no interested reply there is nothing to propose a meeting on, and the dialog says so.
  await open(page, '/operator/meetings', { v41: true });
  await page.locator('.ux-page-heading').getByRole('button', { name: 'Propose Meeting' }).click();
  await expect(page.getByRole('dialog', { name: 'Propose Meeting' }).getByRole('note')).toHaveText(
    'No interested replies yet. A meeting is proposed once a buyer answers Interested to an introduction.',
  );
  await expect(page.getByRole('form', { name: 'Propose meeting' })).toHaveCount(0);
});

test.describe('F5c switch on: the card time', () => {
  test.use({ timezoneId: 'Asia/Dhaka' });
  test("a scheduled card shows the meeting time zone and the reader's, as the line above the board says", async ({
    page,
  }) => {
    await open(page, '/operator/meetings', { v41: true, rich: true });
    const section = panel(page, 'meetings');
    await expect(
      section.getByText("Times show the meeting's time zone and yours.", { exact: false }),
    ).toHaveCount(1);
    const scheduled = section.locator('article.meeting-card', { hasText: 'Meeting 3 scheduled' });
    await expect(scheduled.getByText(/^Meets /)).toHaveText(
      'Meets 10 Dec 2026, 10:00 (Madrid, UTC+1). Your time: 10 Dec 2026, 15:00 (Dhaka, UTC+6).',
    );
  });
});

// D12 Money ----------------------------------------------------------------------------------------------------

test('D12 switch off: Money is the screen the desk has today', async ({ page }) => {
  await open(page, '/operator/commercial', { v41: false });
  const section = panel(page, 'commercial');
  await expect(section.locator('.ux-money-figures')).toHaveCount(0);
  await expect(section.getByRole('tab')).toHaveText([
    'Mission yield',
    'Follow-up',
    'Opportunities (1)',
  ]);
  await expect(section.getByRole('tab', { name: 'Mission yield' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const card = section.getByLabel('USD commercial totals');
  await expect(card).toContainText('Proposals: USD 1234567.01 · Commitments: USD 1234567.02');
  await expect(card).toContainText('Recorded contracts: USD 1234567.03 · Invoiced: USD 1234567.04');
  await expect(card).toContainText('Reported receipts: USD 1234567.05');
  await expect(card).toContainText('Confirmed cash: USD 1234567.06');
  await expect(card).toContainText('Repeat cash within confirmed cash: USD 1234567.07');
});

test('D12 switch on: five exact figures per currency, then the list', async ({ page }) => {
  await open(page, '/operator/commercial', { v41: true });
  const section = panel(page, 'commercial');
  const figures = section.getByRole('group', { name: 'Recorded amounts' });
  await expect(figures).toBeVisible();
  const usd = figures.locator('dl[aria-label="USD amounts"]');
  await expect(usd.locator('dt')).toHaveText([
    'Proposals',
    'Commitments',
    'Recorded contracts',
    'Invoiced',
    'Confirmed cash',
  ]);
  // Exact stored amounts in their own currency: never rounded, grouped, added up or converted.
  await expect(usd.locator('dd')).toHaveText([
    'USD 1234567.01',
    'USD 1234567.02',
    'USD 1234567.03',
    'USD 1234567.04',
    'USD 1234567.06',
  ]);
  await expect(figures.locator('dl[aria-label="JPY amounts"] dd')).toHaveText([
    'JPY 901',
    'JPY 902',
    'JPY 903',
    'JPY 904',
    'JPY 906',
  ]);
  await expect(figures.locator('dl')).toHaveCount(2);
  // The list comes first; the other two tabs keep their ids and their words.
  await expect(section.getByRole('tab')).toHaveText([
    'Opportunities (1)',
    'Follow-up',
    'Mission yield',
  ]);
  await expect(section.getByRole('tab', { name: 'Opportunities (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const list = section.getByRole('article', { name: 'Knitwear programme' });
  await expect(list).toBeVisible();
  const [figuresBox, listBox] = await Promise.all([figures.boundingBox(), list.boundingBox()]);
  expect(listBox!.y).toBeGreaterThan(figuresBox!.y + figuresBox!.height - 1);
  // The two amounts that are not among the five stay in Mission yield; nothing is shown twice.
  await openTab(page, 'commercial', /^Mission yield$/);
  const card = section.getByLabel('USD commercial totals');
  await expect(card).toContainText('Reported receipts: USD 1234567.05');
  await expect(card).toContainText('Repeat cash within confirmed cash: USD 1234567.07');
  await expect(card).not.toContainText('Proposals:');
  await expect(card).not.toContainText('Confirmed cash: USD');
  await expect(page).toHaveURL(/tab=commercial-yield/);
  await expect(page.locator('h1')).toHaveCount(1);
});

test('D12 switch on: five across on a desktop, no sideways scroll on a phone, and no amount when none is recorded', async ({
  page,
}) => {
  await open(page, '/operator/commercial', { v41: true, width: 1440 });
  const cells = panel(page, 'commercial').locator('dl[aria-label="USD amounts"] > div');
  const rows = async () =>
    new Set(await cells.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y))).size;
  // The figures are drawn once the amounts have loaded: wait for the five before measuring them.
  await expect(cells).toHaveCount(5);
  expect(await rows(), 'five across at 1440').toBe(1);
  await open(page, '/operator/commercial', { v41: true, width: 320, height: 700 });
  await expect(cells).toHaveCount(5);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const inside = await cells.evaluateAll((nodes) =>
    nodes.every((node) => node.scrollWidth <= node.clientWidth + 1),
  );
  expect(inside, 'each amount stays inside its cell at 320').toBe(true);
  // Two across even at 320, and the amount is the smaller size on a phone.
  expect(
    new Set(await cells.evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x))).size,
    'two columns at 320',
  ).toBe(2);
  const size = (width: number) =>
    open(page, '/operator/commercial', { v41: true, width }).then(async () => {
      await expect(cells).toHaveCount(5);
      return cells
        .first()
        .evaluate((node) => [
          getComputedStyle(node.querySelector('dt')!).fontSize,
          getComputedStyle(node.querySelector('dd')!).fontSize,
        ]);
    });
  // The figure styles win over the panel's own dt and dd rule: label 14 px, amount 18 px then 24 px from 40rem.
  expect(await size(390)).toEqual(['14px', '18px']);
  expect(await size(768)).toEqual(['14px', '24px']);
  expect(await size(1440)).toEqual(['14px', '24px']);
  await open(page, '/operator/commercial', { v41: true, empty: true });
  const figures = panel(page, 'commercial').getByRole('group', { name: 'Recorded amounts' });
  await expect(figures).toHaveText('No commercial amounts recorded.');
  await expect(figures.locator('dl')).toHaveCount(0);
  // The sentence is said once, not again inside Mission yield.
  await expect(panel(page, 'commercial').getByText('No commercial amounts recorded.')).toHaveCount(
    1,
  );
});

test('D12 switch on: an opportunity row says its stage and its date in plain words', async ({
  page,
}) => {
  await open(page, '/operator/commercial', { v41: true });
  const card = panel(page, 'commercial').locator('article[aria-label="Knitwear programme"]');
  await expect(card).toContainText('Opportunity state: Qualified opportunity · version 2');
  await expect(card).toContainText('due 1 Dec 2026, 09:00 (UTC)');
  await expect(card).not.toContainText('QUALIFIED_OPPORTUNITY');
  // Switch off, the row is as it was.
  await open(page, '/operator/commercial', { v41: false });
  await expect(card).toContainText('Opportunity state: QUALIFIED_OPPORTUNITY · version 2');
  await expect(card).toContainText('due 01/12/2026, 09:00:00 UTC');
});

// D13 Reports --------------------------------------------------------------------------------------------------

test('D13 switch off: Reports is the screen the desk has today and ?mission= changes nothing', async ({
  page,
}) => {
  await open(page, '/operator/delivery', { v41: false, query: `&mission=${knownMission}` });
  const section = panel(page, 'delivery');
  await expect(section.getByRole('tab')).toHaveText([
    'Programmes',
    'Publication',
    'Access and requests',
    'Mission and delegation experience',
  ]);
  await expect(section.locator('.ux-report-list')).toHaveCount(0);
  await openTab(page, 'delivery', /^Publication$/);
  await section.getByText('Review client publication').click();
  await expect(missionSelect(page)).toHaveValue('');
});

test('D13 switch on: one list of reports, each with its status word', async ({ page }) => {
  await open(page, '/operator/delivery', { v41: true });
  const section = panel(page, 'delivery');
  await expect(section.getByRole('tab')).toHaveText([
    'Reports (3)',
    'Programmes',
    'Publication',
    'Access and requests',
    'Mission and delegation experience',
  ]);
  await expect(section.getByRole('tab', { name: 'Reports (3)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const rows = section.getByRole('list', { name: 'Reports' }).getByRole('listitem');
  await expect(rows).toHaveText([
    'Dhaka Knit Co: Progress reportApproved',
    'Dhaka Knit Co: First reportWithdrawn',
    'Sylhet Leather Ltd: Market reportApproved',
  ]);
  await expect(rows.locator('.ux-status')).toHaveText(['Approved', 'Withdrawn', 'Approved']);
  await expect(section.locator('.ux-report-scope')).toHaveCount(0);
  // The list follows the header: the programme chooser and its pager belong to the Programmes tab.
  const programme = section.locator('select[aria-label="Programme"]');
  await expect(programme).toHaveCount(1);
  await expect(programme).toBeHidden();
  await expect(section.locator('.operator-pager').first()).toBeHidden();
  expect(
    await programme.evaluate((node) => node.closest('[data-subtab]')?.getAttribute('data-subtab')),
  ).toBe('programmes');
  for (const height of await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  ))
    expect(height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('h1')).toHaveCount(1);
});

test('D13 switch on: ?mission= chooses a listed mission, in the list and in the publication form', async ({
  page,
}) => {
  await open(page, '/operator/delivery', { v41: true, query: `&mission=${knownMission}` });
  const section = panel(page, 'delivery');
  await expect(section.locator('.ux-report-scope')).toContainText(
    'Showing reports for Dhaka Knit Co.',
  );
  const rows = section.getByRole('list', { name: 'Reports' }).getByRole('listitem');
  await expect(rows).toHaveText([
    'Dhaka Knit Co: Progress reportApproved',
    'Dhaka Knit Co: First reportWithdrawn',
  ]);
  await section.getByRole('button', { name: 'Show All Missions' }).click();
  await expect(rows).toHaveCount(3);
  await expect(section.locator('.ux-report-scope')).toHaveCount(0);
  // The hint is used once: it does not come back after the person chose otherwise.
  await openTab(page, 'delivery', /^Publication$/);
  await section.getByText('Review client publication').click();
  await expect(missionSelect(page)).toHaveValue('');

  await open(page, '/operator/delivery', { v41: true, query: `&mission=${knownMission}` });
  await openTab(page, 'delivery', /^Publication$/);
  await section.getByText('Review client publication').click();
  await expect(missionSelect(page)).toHaveValue(knownMission);
});

for (const [name, value] of [
  ['an unknown id', id(999)],
  ['a malformed id', 'not-a-mission'],
  ['an id with markup', '%3Cscript%3E'],
  ['an empty value', ''],
] as const) {
  test(`D13 switch on: ?mission= with ${name} chooses nothing and says nothing`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page, '/operator/delivery', { v41: true, query: `&mission=${value}` });
    const section = panel(page, 'delivery');
    await expect(section.getByRole('list', { name: 'Reports' }).getByRole('listitem')).toHaveCount(
      3,
    );
    await expect(section.locator('.ux-report-scope')).toHaveCount(0);
    await expect(section.getByRole('status', { name: 'Delivery status' })).toHaveText('');
    await expect(section.getByRole('alert')).toHaveCount(0);
    await openTab(page, 'delivery', /^Publication$/);
    await section.getByText('Review client publication').click();
    await expect(missionSelect(page)).toHaveValue('');
    expect(errors).toEqual([]);
  });
}

test('D13 switch on: with no report the list says what to do next', async ({ page }) => {
  await open(page, '/operator/delivery', { v41: true, empty: true });
  const section = panel(page, 'delivery');
  await expect(section.getByRole('tab', { name: 'Reports (0)' })).toBeVisible();
  await expect(section.locator('.ux-empty')).toHaveText(
    'No report has been approved yet. Approve one in the Publication tab.',
  );
  await expect(section.locator('.ux-report-list')).toHaveCount(0);
});

// All three screens --------------------------------------------------------------------------------------------

const screens = [
  { slug: 'meetings', section: 'meetings', tab: /^Meetings \(9\)$/ },
  { slug: 'commercial', section: 'commercial', tab: null },
  { slug: 'delivery', section: 'delivery', tab: null },
] as const;
for (const v41 of [false, true]) {
  test(`switch ${v41 ? 'on' : 'off'}: six widths without sideways scroll, axe clean`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    for (const screen of screens)
      for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await open(page, `/operator/${screen.slug}`, { v41, width });
        if (screen.tab) await openTab(page, screen.section, screen.tab);
        await expect(panel(page, screen.section).locator('h2').first()).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`p5a-${screen.slug}-${v41 ? 'on' : 'off'}-${width}.png`),
          fullPage: true,
        });
        expect(await overflow(page), `${screen.slug}: no sideways scroll at ${width}`).toBe(0);
        // The switch-off screens are measured as they are; axe is asked of the screens this unit builds.
        if (v41) {
          const results = await new AxeBuilder({ page })
            .include(`#workspace-${screen.section}`)
            .analyze();
          expect(results.violations, `${screen.slug}: axe at ${width}`).toEqual([]);
        }
      }
  });
}

// One link per address (owner rule, 24 Nov 2026) -----------------------------------------------------------------

/**
 * Every link address inside <main> for the screen on show: all of its tabs count, shown or not, and the other
 * workspace sections (hidden, each its own address) do not.
 */
const linkAddresses = (page: Page) =>
  page.locator('main a[href]').evaluateAll((links) =>
    links
      .filter((link) => {
        for (let node = link.parentElement; node; node = node.parentElement)
          if (node.hidden && !node.hasAttribute('data-subtab')) return false;
        return true;
      })
      .map((link) => link.getAttribute('href') ?? ''),
  );
for (const screen of screens) {
  test(`switch on: ${screen.slug} names no address twice inside main`, async ({ page }) => {
    await open(page, `/operator/${screen.slug}`, { v41: true });
    await expect(panel(page, screen.section).locator('h2').first()).toBeVisible();
    if (screen.tab) await openTab(page, screen.section, screen.tab);
    const addresses = await linkAddresses(page);
    // No named exception: a link that appears twice here is a defect.
    expect(
      addresses.filter((address, index) => addresses.indexOf(address) !== index),
      `${screen.slug}: links in main are ${JSON.stringify(addresses)}`,
    ).toEqual([]);
  });
}
