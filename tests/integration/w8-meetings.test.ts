import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meetingStatus } from '../../packages/domain/src/access';
import { groupMeetings } from '../../apps/web/lib/meetings/group';
import { meetingCard, meetingHref } from '../../apps/web/lib/meetings/cards';
import { loadMeetings, meetingReportCap } from '../../apps/web/lib/meetings/load';
import { initialLensFor } from '../../apps/web/lib/room';
import {
  meetingsFirstShown,
  orderTrip,
  statusWords,
  tripFirstShown,
} from '../../apps/web/lib/trip';
import type { WorkItem } from '../../apps/web/lib/work-items/types';

// W8, docs/revamp/specs/workflow-intelligence.md. One read-only list of every meeting and visit from the person's
// own saved reports. The browser behaviour is in tests/operator/w8-meetings.spec.ts.
const on = { delivery: true, savedMissions: true };
vi.mock('../../packages/auth/src/customer-assigned-missions.ts', () => ({
  customerDeliveryEnabled: () => on.delivery,
}));
vi.mock('../../packages/auth/src/customer-saved-missions.ts', () => ({
  customerSavedMissionsEnabled: () => on.savedMissions,
}));
type Services = Record<string, unknown> & { ready: Promise<void> };
let services: Services | null = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const requestItem = (n: number, title: string | null = `Request ${n}`): WorkItem => ({
  key: `request:${uuid(n)}`,
  kind: 'request',
  id: uuid(n),
  workspaceId: uuid(900),
  family: 'SELL',
  title,
  status: '',
  at: '2026-10-01T00:00:00.000Z',
  atKind: 'created',
  href: `/account/rooms/${uuid(n)}`,
});
const saved = (n: number) => uuid(1000 + n);
const assignment = (n: number, over: Record<string, unknown> = {}) => ({
  id: uuid(2000 + n),
  requestId: uuid(n),
  available: true,
  savedResourceId: saved(n),
  ...over,
});
type Itinerary = Record<string, unknown>[];
const reportFor = (resourceId: string, itinerary: Itinerary) => ({
  resourceId,
  report: {
    schemaVersion: 1,
    audience: 'CLIENT_PROGRESS',
    allowExport: false,
    expiresAt: '2099-01-01T00:00:00Z',
    purpose: 'Review',
    attribution: 'Prepared by the Corridra team',
    missions: [
      {
        publicationId: 'pub-1',
        title: 'Mission',
        company: 'Atelier Rahman',
        objective: 'Objective',
        brief: 'Brief',
        nextAction: 'Next',
        dueAt: '2026-11-05T00:00:00Z',
        reviewedAt: '2026-10-08T00:00:00Z',
        updatedAt: '2026-10-08T00:00:00Z',
        status: 'MEETINGS',
        itinerary,
        totals: [],
        outcomes: {
          opportunities: 0,
          qualified: 0,
          proposals: 0,
          contracts: 0,
          rfqs: 0,
          samples: 0,
          heldMeetings: 0,
        },
      },
    ],
  },
});
const visit = (label: string, over: Record<string, unknown> = {}) => ({
  label,
  status: 'SCHEDULED',
  scheduleChanged: false,
  startsAt: '2026-12-01T09:00:00Z',
  timezone: 'Asia/Dhaka',
  location: 'Dhaka office',
  ...over,
});

let pages: { assignments: unknown[]; nextAfter?: string | null }[];
const command = vi.fn();
const list = vi.fn();
function install(itineraries: Record<string, Itinerary>) {
  list.mockImplementation(async (input: { after?: string }) => {
    const index = input.after ? Number(input.after) : 0;
    const page = pages[index] ?? { assignments: [] };
    return { assignments: page.assignments, nextAfter: page.nextAfter ?? null };
  });
  command.mockImplementation(async (input: { resourceId: string }) => {
    const itinerary = itineraries[input.resourceId];
    if (!itinerary) throw new Error('not found');
    return reportFor(input.resourceId, itinerary);
  });
  services = {
    ready: Promise.resolve(),
    customerAssignedMissions: { list },
    customerSavedMissions: { command },
  };
}
const SUBJECT = 'user-1';
const ISSUER = 'https://auth.example';

beforeEach(() => {
  on.delivery = true;
  on.savedMissions = true;
  pages = [];
  command.mockReset();
  list.mockReset();
  services = null;
});

describe('grouping meetings by the server clock', () => {
  const NOW = Date.parse('2026-11-10T12:00:00Z');
  const row = (label: string, startsAt?: string, over: Record<string, unknown> = {}) => ({
    label,
    changed: false,
    ...(startsAt ? { startsAt } : {}),
    ...over,
  });
  const names = (rows: { label: string }[]) => rows.map((r) => r.label);

  it('puts coming-up meetings soonest first and past ones newest first', () => {
    const groups = groupMeetings(
      [
        row('late', '2026-12-20T09:00:00Z'),
        row('old', '2026-09-01T09:00:00Z'),
        row('soon', '2026-11-11T09:00:00Z'),
        row('recent', '2026-11-09T09:00:00Z'),
      ],
      NOW,
    );
    expect(names(groups.upcoming)).toEqual(['soon', 'late']);
    expect(names(groups.past)).toEqual(['recent', 'old']);
  });
  it('treats a meeting that starts exactly now as coming up, and one a moment earlier as past', () => {
    const groups = groupMeetings(
      [row('now', '2026-11-10T12:00:00Z'), row('before', '2026-11-10T11:59:59Z')],
      NOW,
    );
    expect(names(groups.upcoming)).toEqual(['now']);
    expect(names(groups.past)).toEqual(['before']);
  });
  it('keeps a meeting that has started and not ended coming up, and is past only once it ends', () => {
    const groups = groupMeetings(
      [
        row('running', '2026-11-10T10:00:00Z', { endsAt: '2026-11-10T14:00:00Z' }),
        row('over', '2026-11-10T08:00:00Z', { endsAt: '2026-11-10T09:00:00Z' }),
      ],
      NOW,
    );
    expect(names(groups.upcoming)).toEqual(['running']);
    expect(names(groups.past)).toEqual(['over']);
  });
  it('never decides by status: a held meeting in the future is still coming up', () => {
    const groups = groupMeetings([row('held', '2026-12-01T09:00:00Z', { status: 'HELD' })], NOW);
    expect(names(groups.upcoming)).toEqual(['held']);
    expect(groups.past).toEqual([]);
  });
  it('keeps meetings with no start time, or only an end, in the order given, apart from dated ones', () => {
    const groups = groupMeetings(
      [
        row('b'),
        row('only end', undefined, { endsAt: '2026-12-01T09:00:00Z' }),
        row('dated', '2026-12-01T09:00:00Z'),
        row('a'),
        row('bad', 'not a date'),
      ],
      NOW,
    );
    expect(names(groups.undated)).toEqual(['b', 'only end', 'a', 'bad']);
    expect(names(groups.upcoming)).toEqual(['dated']);
  });
  it('puts changed meetings in their own last group whatever time they carry', () => {
    const groups = groupMeetings(
      [
        { label: 'changed', changed: true, startsAt: '2026-12-01T09:00:00Z' },
        row('future', '2026-12-02T09:00:00Z'),
      ],
      NOW,
    );
    expect(names(groups.changed)).toEqual(['changed']);
    expect(names(groups.upcoming)).toEqual(['future']);
  });
  it('agrees with the Room Trip order when every meeting is in the future', () => {
    const itinerary = [
      visit('c', { startsAt: '2026-12-03T09:00:00Z' }),
      visit('a', { startsAt: '2026-12-01T09:00:00Z' }),
      visit('undated', { startsAt: undefined }),
      visit('x', { scheduleChanged: true }),
      visit('b', { startsAt: '2026-12-02T09:00:00Z' }),
    ];
    const room = orderTrip(itinerary as never).map((item) => item.label);
    const rows = itinerary.map((item) => ({
      label: item.label,
      changed: item.scheduleChanged,
      ...(item.startsAt ? { startsAt: item.startsAt } : {}),
    }));
    const groups = groupMeetings(rows, NOW);
    expect(
      [...groups.upcoming, ...groups.past, ...groups.undated, ...groups.changed].map(
        (r) => r.label,
      ),
    ).toEqual(room);
  });
});

describe('words, caps and links', () => {
  it('has words for every meeting status and no other key', () => {
    expect(Object.keys(statusWords).sort()).toEqual([...meetingStatus.options].sort());
  });
  it('reads at most 12 reports and shows the first 3 meetings, fewer than a Room list shows', () => {
    expect(meetingReportCap).toBe(12);
    expect(meetingsFirstShown).toBe(3);
    expect(meetingsFirstShown).toBeLessThan(tripFirstShown);
  });
  it('opens the Room on Meetings only with Trip, Road and lenses on', () => {
    const row = { requestId: uuid(1), savedResourceId: saved(1) };
    expect(meetingHref(row, { trip: true, road: true, lenses: true })).toBe(
      `/account/rooms/${uuid(1)}?view=meetings`,
    );
    expect(meetingHref(row, { trip: true, road: true, lenses: false })).toBe(
      `/account/rooms/${uuid(1)}`,
    );
  });
  it('opens the saved report in every other case, with no view', () => {
    const row = { requestId: uuid(1), savedResourceId: saved(1) };
    for (const switches of [
      { trip: false, road: true, lenses: true },
      { trip: true, road: false, lenses: true },
      { trip: false, road: false, lenses: false },
    ])
      expect(meetingHref(row, switches)).toBe(`/account/missions/${saved(1)}`);
  });
  it('opens the Room on Meetings only for exactly "meetings", and only with Trip and lenses on', () => {
    const both = { trip: true, lenses: true };
    expect(initialLensFor('meetings', both)).toBe('trip');
    expect(initialLensFor(undefined, both)).toBeUndefined();
    expect(initialLensFor('Meetings', both)).toBeUndefined();
    expect(initialLensFor('trip', both)).toBeUndefined();
    expect(initialLensFor('', both)).toBeUndefined();
    expect(initialLensFor(['meetings'], both)).toBeUndefined();
    expect(initialLensFor(['meetings', 'meetings'], both)).toBeUndefined();
    expect(initialLensFor('meetings', { trip: false, lenses: true })).toBeUndefined();
    expect(initialLensFor('meetings', { trip: true, lenses: false })).toBeUndefined();
  });
});

describe('a meeting card', () => {
  const switches = { trip: true, road: true, lenses: true };
  const base = {
    requestId: uuid(1),
    requestTitle: '出口到西班牙',
    savedResourceId: saved(1),
  };
  it('shows a time in its zone, the place as supplied, the status word and the Chinese language mark', () => {
    const card = meetingCard(
      {
        ...base,
        label: '达卡访问',
        changed: false,
        status: 'SCHEDULED',
        startsAt: '2026-12-01T09:00:00Z',
        endsAt: '2026-12-01T10:00:00Z',
        timezone: 'Asia/Dhaka',
        location: '达卡办公室',
      },
      0,
      switches,
    );
    expect(card.nameLang).toBe('zh');
    expect(card.requestLang).toBe('zh');
    expect(card.badge).toEqual({ text: 'Time confirmed', tone: 'info' });
    expect(card.details?.starts).toEqual({
      iso: '2026-12-01T09:00:00Z',
      text: expect.stringMatching(/15:00.*\(.*\)$/),
    });
    expect(card.details?.ends?.iso).toBe('2026-12-01T10:00:00Z');
    expect(card.details?.place).toBe('达卡办公室');
    expect(card.details?.placeLang).toBe('zh');
  });
  it('says "Not shared yet" with no place, shows an unknown status as supplied, and uses a fallback title', () => {
    const card = meetingCard(
      { ...base, requestTitle: null, label: 'Visit', changed: false, status: 'ON_HOLD' },
      0,
      switches,
    );
    expect(card.details?.place).toBe('Not shared yet');
    expect(card.badge).toEqual({ text: 'ON_HOLD', tone: undefined });
    expect(card.requestTitle).toBe('Your request');
    expect(card.details?.starts).toBeNull();
  });
  it('gives every status its own word', () => {
    const words = meetingStatus.options.map(
      (status) =>
        meetingCard({ ...base, label: 'v', changed: false, status }, 0, switches).badge.text,
    );
    expect(words).toEqual([
      'Suggested',
      'Accepted',
      'Time confirmed',
      'Done',
      'Declined',
      'Cancelled',
      'Missed',
      'New time needed',
    ]);
  });
  it('a changed schedule carries only its name and the Date changed badge, nothing of the old time or place', () => {
    const card = meetingCard({ ...base, label: 'Factory visit', changed: true }, 0, switches);
    expect(card.details).toBeNull();
    expect(card.badge).toEqual({ text: 'Date changed', tone: 'caution' });
    expect(JSON.stringify(card)).not.toMatch(/2026|Dhaka|SCHEDULED|HELD/);
  });
});

describe('reading the meetings of the person’s own requests', () => {
  it('reads only the saved report of each listed request, and never a request or report that is not theirs', async () => {
    pages = [
      {
        assignments: [
          assignment(1),
          assignment(2),
          // Another person's request: not in the list, so it is never asked for.
          assignment(77),
          // Not readable: never counts.
          assignment(3, { available: false }),
        ],
      },
    ];
    install({
      [saved(1)]: [visit('One')],
      [saved(2)]: [visit('Two')],
      [saved(77)]: [visit('Foreign')],
    });
    const result = await loadMeetings(SUBJECT, ISSUER, [
      requestItem(1),
      requestItem(2),
      requestItem(3),
    ]);
    expect(command.mock.calls.map((call) => call[0].resourceId).sort()).toEqual(
      [saved(1), saved(2)].sort(),
    );
    for (const call of command.mock.calls) {
      expect(call[0]).toMatchObject({ action: 'view', audience: 'CLIENT_PROGRESS' });
      expect(call[1]).toBe(SUBJECT);
      expect(call[2]).toBe(ISSUER);
    }
    expect(result.rows.map((r) => r.label).sort()).toEqual(['One', 'Two']);
    expect(result.rows.find((r) => r.label === 'One')).toMatchObject({
      requestId: uuid(1),
      requestTitle: 'Request 1',
      savedResourceId: saved(1),
    });
    expect(result).toMatchObject({ partial: false, capped: false, notSaved: 0, reportsOff: false });
  });
  it('never reads the 13th report and says the list is capped', async () => {
    const requests = Array.from({ length: 13 }, (_, i) => requestItem(i + 1));
    pages = [{ assignments: requests.map((_, i) => assignment(i + 1)) }];
    install(Object.fromEntries(requests.map((_, i) => [saved(i + 1), [visit(`M${i + 1}`)]])));
    const result = await loadMeetings(SUBJECT, ISSUER, requests);
    expect(command).toHaveBeenCalledTimes(12);
    expect(command.mock.calls.map((call) => call[0].resourceId)).not.toContain(saved(13));
    expect(result.capped).toBe(true);
    expect(result.rows).toHaveLength(12);
  });
  it('is not capped at exactly 12 reports', async () => {
    const requests = Array.from({ length: 12 }, (_, i) => requestItem(i + 1));
    pages = [{ assignments: requests.map((_, i) => assignment(i + 1)) }];
    install(Object.fromEntries(requests.map((_, i) => [saved(i + 1), [visit(`M${i + 1}`)]])));
    expect((await loadMeetings(SUBJECT, ISSUER, requests)).capped).toBe(false);
  });
  it('is partial, and keeps the other meetings, when one report cannot be read', async () => {
    pages = [{ assignments: [assignment(1), assignment(2)] }];
    install({ [saved(1)]: [visit('One')] });
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1), requestItem(2)]);
    expect(result.partial).toBe(true);
    expect(result.rows.map((r) => r.label)).toEqual(['One']);
  });
  it('is partial when a report fails the same check the report page applies', async () => {
    pages = [{ assignments: [assignment(1)] }];
    install({ [saved(1)]: [visit('One')] });
    command.mockResolvedValueOnce({ ...reportFor(uuid(5555), []) });
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1)]);
    expect(result.partial).toBe(true);
    expect(result.rows).toEqual([]);
  });
  it('is partial and calls no request unsaved when the assignment list is cut short', async () => {
    // Every page says there is another one, so the bounded read ends incomplete.
    pages = Array.from({ length: 8 }, (_, i) => ({
      assignments: i === 0 ? [assignment(1)] : [],
      nextAfter: String(i + 1),
    }));
    install({ [saved(1)]: [visit('One')] });
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1), requestItem(2)]);
    expect(result.partial).toBe(true);
    expect(result.notSaved).toBe(0);
    expect(result.rows.map((r) => r.label)).toEqual(['One']);
  });
  it('is partial when the assignment list cannot be read at all', async () => {
    install({});
    list.mockRejectedValue(new Error('down'));
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1)]);
    expect(result).toMatchObject({ partial: true, rows: [], notSaved: 0 });
    expect(command).not.toHaveBeenCalled();
  });
  it('is partial when the services are not there', async () => {
    expect(await loadMeetings(SUBJECT, ISSUER, [requestItem(1)])).toMatchObject({
      partial: true,
      rows: [],
    });
  });
  it('counts a delivered report that is not saved, without reading it', async () => {
    pages = [{ assignments: [assignment(1, { savedResourceId: null }), assignment(2)] }];
    install({ [saved(2)]: [visit('Two')] });
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1), requestItem(2)]);
    expect(result.notSaved).toBe(1);
    expect(command).toHaveBeenCalledTimes(1);
    expect(result.partial).toBe(false);
  });
  it('reads nothing and says the reports are off when delivery or saved missions is off', async () => {
    pages = [{ assignments: [assignment(1)] }];
    install({ [saved(1)]: [visit('One')] });
    for (const key of ['delivery', 'savedMissions'] as const) {
      on[key] = false;
      const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1)]);
      expect(result).toMatchObject({ reportsOff: true, rows: [], partial: false });
      on[key] = true;
    }
    expect(command).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
  it('reads nothing when the person has no requests', async () => {
    install({});
    expect(await loadMeetings(SUBJECT, ISSUER, [])).toMatchObject({ rows: [], partial: false });
    expect(list).not.toHaveBeenCalled();
  });
  it('drops every old detail of a changed schedule on the server', async () => {
    pages = [{ assignments: [assignment(1)] }];
    install({
      [saved(1)]: [
        visit('Moved', { scheduleChanged: true }),
        visit('Needs time', { status: 'RESCHEDULE_REQUIRED' }),
        visit('Normal'),
      ],
    });
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1)]);
    const changed = result.rows.filter((r) => r.changed);
    expect(changed.map((r) => r.label)).toEqual(['Moved', 'Needs time']);
    for (const r of changed) {
      expect(Object.keys(r).sort()).toEqual(
        ['changed', 'label', 'requestId', 'requestTitle', 'savedResourceId'].sort(),
      );
    }
    expect(JSON.stringify(changed)).not.toMatch(/2026|Dhaka|SCHEDULED|RESCHEDULE_REQUIRED/);
    expect(result.rows.find((r) => r.label === 'Normal')).toMatchObject({
      status: 'SCHEDULED',
      startsAt: '2026-12-01T09:00:00Z',
      timezone: 'Asia/Dhaka',
      location: 'Dhaka office',
    });
  });
  it('keeps no price, offer or contact from the report: a row holds only the meeting', async () => {
    pages = [{ assignments: [assignment(1)] }];
    install({ [saved(1)]: [visit('One', { contact: 'a@b.test', price: '99' })] });
    const result = await loadMeetings(SUBJECT, ISSUER, [requestItem(1)]);
    expect(JSON.stringify(result.rows)).not.toMatch(/a@b\.test|"99"/);
  });
});

describe('the Meetings page source', () => {
  const dir = 'apps/web/app/account/meetings';
  it('no longer carries the Coming soon line, and has no loading file that would drop the shell', () => {
    const page = read(`${dir}/page.tsx`);
    expect(page).not.toMatch(/Coming soon|ux-soon/);
    expect(existsSync(resolve(`${dir}/loading.tsx`))).toBe(false);
  });
  it('keeps the shells guard before the session proof, and the session proof before any read', () => {
    const page = read(`${dir}/page.tsx`);
    const guard = page.indexOf("if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2')) notFound();");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(page.indexOf('getSession('));
    expect(page).toContain('disableCookieCache: true');
    expect(page.indexOf('emailVerified !== true')).toBeLessThan(page.indexOf('loadWorkItems('));
    expect(page.indexOf('loadWorkItems(')).toBeLessThan(page.indexOf('loadMeetings('));
  });
  it('reads the Room view after the Road switch and the session proof, never before', () => {
    const page = read('apps/web/app/account/rooms/[requestId]/page.tsx');
    expect(page.indexOf('await searchParams')).toBeGreaterThan(
      page.indexOf('await customerPageSession('),
    );
    expect(page).toContain('initialLens={initialLens}');
  });
  it('the list component writes nothing, books nothing and links no map', () => {
    const list = read(`${dir}/meetings-list.tsx`);
    expect(list).not.toMatch(/fetch\(|\.ics|mailto:|maps\.|navigator\.share|method:/);
  });
});
