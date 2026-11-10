import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingRow, MeetingsRead } from '../../apps/web/lib/meetings/load';
import type { WorkItem } from '../../apps/web/lib/work-items/types';

// W8: the Meetings page renders the right sentences for each state. The page is mounted with its reads answered by
// the test and the real list components, and written out as HTML, so what is asserted is what a person reads.
// The two lines that point at meetings ("Open a meeting in its Request..." and "Meetings come from...")
// must appear only when at least one meeting is shown.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

const state = {
  readable: true,
  list: { items: [] as WorkItem[], unreadable: [] as string[], partial: false },
  meetings: null as MeetingsRead | null,
};
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
  redirect: () => {
    throw new Error('redirect');
  },
}));
vi.mock('../../packages/auth/src/customer-requests.ts', () => ({
  customerRequestsEnabled: () => state.readable,
}));
vi.mock('../../packages/auth/src/customer-workspaces.ts', () => ({
  customerWorkspacesEnabled: () => state.readable,
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: 'https://auth.example' }),
}));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async () => ({ data: { user: { id: 'user-1', emailVerified: true } } }),
  }),
}));
vi.mock('../../apps/web/lib/ux-switches', () => ({ uxSwitchOn: () => true }));
vi.mock('../../apps/web/components/customer-shell', () => ({
  CustomerShell: ({ children }: { children: unknown }) => createElement('main', null, children),
}));
vi.mock('../../apps/web/components/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: unknown }) => createElement('main', null, children),
}));
vi.mock('../../apps/web/lib/work-items/load', () => ({ loadWorkItems: async () => state.list }));
vi.mock('../../apps/web/lib/meetings/load', () => ({
  meetingReportCap: 12,
  loadMeetings: async () => state.meetings,
}));

const pagePath = '../../apps/web/app/account/meetings/page';
async function render() {
  const Page = (await import(/* @vite-ignore */ pagePath)).default as () => Promise<unknown>;
  return renderToStaticMarkup(await Page());
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (n: number): WorkItem => ({
  key: `request:${id(n)}`,
  kind: 'request',
  id: id(n),
  workspaceId: id(900),
  family: 'SELL',
  title: `Request ${n}`,
  status: '',
  at: '2026-10-01T00:00:00.000Z',
  atKind: 'created',
  href: `/account/rooms/${id(n)}`,
});
const row = (label: string): MeetingRow => ({
  requestId: id(1),
  requestTitle: 'Request 1',
  savedResourceId: id(1001),
  label,
  changed: false,
  status: 'SCHEDULED',
  startsAt: '2099-01-01T09:00:00Z',
  timezone: 'Asia/Dhaka',
});
const read = (over: Partial<MeetingsRead> = {}): MeetingsRead => ({
  rows: [],
  notSaved: 0,
  partial: false,
  capped: false,
  reportsOff: false,
  ...over,
});

const lineTwo = 'Open a meeting in its Request to see what to do next.';
const sourceLine = 'Meetings come from the reports you have saved.';
const plainLine = 'Open any request to see all of it.';

beforeEach(() => {
  state.readable = true;
  state.list = { items: [request(1), request(2)], unreadable: [], partial: false };
  state.meetings = read();
});

describe('the lines that point at meetings appear only when a meeting is shown', () => {
  it('shows both lines, and the long requests line, when at least one meeting is shown', async () => {
    state.meetings = read({ rows: [row('Visit one')] });
    const html = await render();
    expect(html).toContain(lineTwo);
    expect(html).toContain(sourceLine);
    expect(html).toContain(
      'Open any request to see all of it, including requests with no meetings yet.',
    );
    expect(html).not.toContain(plainLine);
  });
  const without: [string, () => void, string][] = [
    ['no meeting is ready yet', () => {}, 'No meetings or visits are ready to show yet.'],
    [
      'a report is not saved yet',
      () => {
        state.meetings = read({ notSaved: 1 });
      },
      '1 of your requests has a report that is not saved yet.',
    ],
    [
      'the meetings are not available here',
      () => {
        state.meetings = read({ reportsOff: true });
      },
      'Meetings and visits are not available here yet.',
    ],
    [
      'a read failed and nothing could be shown',
      () => {
        state.meetings = read({ partial: true });
      },
      'We could not check all your requests just now.',
    ],
  ];
  for (const [name, arrange, expected] of without)
    it(`shows neither line, and the plain requests line, when ${name}`, async () => {
      arrange();
      const html = await render();
      expect(html).toContain(expected);
      expect(html).not.toContain(lineTwo);
      expect(html).not.toContain(sourceLine);
      expect(html).toContain(plainLine);
    });
  it('shows neither line when the person has no requests yet', async () => {
    state.list = { items: [], unreadable: [], partial: false };
    const html = await render();
    expect(html).toContain('You have no requests yet.');
    expect(html).not.toContain(lineTwo);
    expect(html).not.toContain(sourceLine);
    expect(html).not.toContain('Your requests');
  });
  it('shows neither line where the modules are off, and says the list is not available', async () => {
    state.readable = false;
    state.list = { items: [], unreadable: [], partial: false };
    const html = await render();
    expect(html).toContain('Your requests list is not available here yet.');
    expect(html).not.toContain(lineTwo);
    expect(html).not.toContain(sourceLine);
  });
});

describe('the not saved note', () => {
  it('has the notice panel without a status role, with its sentence and the Library link in one block', async () => {
    state.meetings = read({ notSaved: 2 });
    const html = await render();
    const note = html.match(/<p class="ux-draft-notice">.*?<\/p>/)?.[0] ?? '';
    expect(note).toContain(
      '2 of your requests have a report that is not saved yet. Save them from your Library to see their meetings here.',
    );
    expect(note).toContain('Open Library');
    expect(note).not.toContain('role=');
  });
});

describe('the list of groups', () => {
  it('lays its group cards out in the same grid and gap as the rest of the page', async () => {
    state.meetings = read({ rows: [row('Visit one')] });
    const html = await render();
    expect(html).toMatch(/<div id="[^"]*" class="room"><section/);
  });
});

// W8 round 3 (layout budget): the page is two tabs, Meetings and Your Requests, on the shared sub-tabs. The server
// always shows the first tab; the panels are all in the HTML, and the second is hidden until chosen.
describe('the tabs', () => {
  const tablist = '<div class="ux-subtabs-list" role="tablist" aria-label="Meetings sections">';
  const panel = (html: string, key: 'meetings' | 'requests') => {
    const start = html.indexOf(`data-subtab="${key}"`);
    const open = html.lastIndexOf('<div', start);
    const next = html.indexOf('data-subtab="', start + 1);
    return html.slice(open, next === -1 ? undefined : html.lastIndexOf('<div', next));
  };

  it('has a labelled tablist with exactly the Meetings and Your Requests tabs, Meetings first and selected', async () => {
    state.meetings = read({ rows: [row('Visit one')] });
    const html = await render();
    expect(html).toContain(tablist);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>(.*?)<\/button>/g)];
    expect(tabs.map((tab) => tab[1])).toEqual(['Meetings', 'Your Requests']);
    expect(tabs[0]?.[0]).toContain('aria-selected="true"');
    expect(tabs[1]?.[0]).toContain('aria-selected="false"');
    expect(html).toMatch(/data-subtab="requests"[^>]*hidden/);
    expect(html).not.toMatch(/data-subtab="meetings"[^>]*hidden/);
  });
  it('keeps every request link in the Your Requests panel, which is in the HTML though hidden', async () => {
    state.meetings = read({ rows: [row('Visit one')] });
    const html = await render();
    const requestsPanel = panel(html, 'requests');
    expect(requestsPanel).toContain('<h2');
    expect(requestsPanel).toContain('Your requests');
    expect(requestsPanel).toContain(`href="/account/rooms/${id(1)}"`);
    expect(requestsPanel).toContain(`href="/account/rooms/${id(2)}"`);
    expect(requestsPanel).toContain(sourceLine);
    expect(panel(html, 'meetings')).not.toContain('Your requests');
  });
  it('holds the intro, the next-step line and the dates sentence inside the closed What Happens Next', async () => {
    state.meetings = read({ rows: [row('Visit one')] });
    const html = await render();
    const meetingsPanel = panel(html, 'meetings');
    const details = meetingsPanel.match(
      /<details class="ux-journey-disclosure">.*?<\/details>/,
    )?.[0];
    expect(details).toBeDefined();
    expect(details).not.toContain('open');
    expect(details).toContain('<summary>What Happens Next</summary>');
    expect(details).toContain(
      'This page lists every meeting and visit the Corridra team has set up for your requests. Each one is a step between your request and your decision.',
    );
    expect(details).toContain(lineTwo);
    expect(details).toContain(
      'Dates and places appear after the Corridra team reviews them. If a time changes, you see a notice. The old time stays hidden until a new one is reviewed. Nothing is booked or changed from this page.',
    );
    // Said once, and not as loose text outside the disclosure.
    expect(html.split('This page lists every meeting').length).toBe(2);
    expect(html.split(lineTwo).length).toBe(2);
  });
  it('merges the count and Show All into one row, with the first meeting only until Show All', async () => {
    state.meetings = read({ rows: [row('Visit one'), row('Visit two'), row('Visit three')] });
    const html = await render();
    const actions = html.match(/<div class="room-actions"><p>.*?<\/div>/)?.[0] ?? '';
    expect(actions).toContain('<p>Showing 1 of 3 meetings and visits.</p>');
    expect(actions).toContain('Show All 3 Meetings and Visits');
    expect(html.match(/<h3/g)?.length).toBe(1);
  });
  it('says one meeting or visit, with no Show All, when there is only one', async () => {
    state.meetings = read({ rows: [row('Visit one')] });
    const html = await render();
    expect(html).toContain('<div class="room-actions"><p>1 meeting or visit</p></div>');
    expect(html).not.toContain('Show All');
  });
  it('puts the partial notice above the tablist, where it shows on both tabs', async () => {
    state.meetings = read({ partial: true, rows: [row('Visit one')] });
    const html = await render();
    const notice = html.indexOf('We could not check all your requests just now.');
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(html.indexOf(tablist));
    expect(html.split('We could not check all your requests just now.').length).toBe(2);
    expect(html).toContain('Try Again');
  });
  it('puts the cap notice inside the Meetings panel only, pointing at the Your Requests tab', async () => {
    state.meetings = read({ capped: true, rows: [row('Visit one')] });
    const html = await render();
    const cap =
      'We show meetings from the first 12 reports only. Some meetings may be missing. Open a request in the Your Requests tab to see all of its meetings.';
    expect(panel(html, 'meetings')).toContain(cap);
    expect(panel(html, 'requests')).not.toContain('first 12 reports');
    expect(html.indexOf(cap)).toBeGreaterThan(html.indexOf(tablist));
    expect(html).not.toContain('Open a request below');
  });
  it('drops the repeated sentence from the cap notice when the partial notice already says it', async () => {
    state.meetings = read({ capped: true, partial: true, rows: [row('Visit one')] });
    const html = await render();
    const cap =
      'We show meetings from the first 12 reports only. Open a request in the Your Requests tab to see all of its meetings.';
    expect(panel(html, 'meetings')).toContain(cap);
    expect(html.split('Some meetings may be missing.').length).toBe(2);
    expect(html.indexOf('Some meetings may be missing.')).toBeLessThan(html.indexOf(tablist));
  });
  it('keeps the whole cap text when the partial notice is not showing', async () => {
    state.meetings = read({ capped: true, rows: [row('Visit one')] });
    const html = await render();
    expect(html.split('Some meetings may be missing.').length).toBe(2);
    expect(html.indexOf('Some meetings may be missing.')).toBeGreaterThan(html.indexOf(tablist));
  });
  it('puts the not saved note inside the Meetings panel only', async () => {
    state.meetings = read({ notSaved: 1 });
    const html = await render();
    expect(panel(html, 'meetings')).toContain(
      '1 of your requests has a report that is not saved yet.',
    );
    expect(panel(html, 'requests')).not.toContain('not saved yet');
    expect(html.indexOf('not saved yet')).toBeGreaterThan(html.indexOf(tablist));
  });
  it('points the empty text at the Your Requests tab, with both tabs still there', async () => {
    const html = await render();
    expect(panel(html, 'meetings')).toContain(
      'No meetings or visits are ready to show yet. They appear here after the Corridra team reviews them. You can open any request in the Your Requests tab.',
    );
    expect(html).toContain(tablist);
    expect(html).not.toContain('open any request below');
  });
  it('writes no em dash and no "listed below" while the tabs are there', async () => {
    state.meetings = read({ rows: [row('Visit one')], notSaved: 1, capped: true, partial: true });
    const html = await render();
    expect(html).not.toContain('—');
    expect(html).not.toContain('listed below');
    expect(html).not.toContain('request below');
  });

  it('has no tablist, only the Meetings panel, when the person has no requests', async () => {
    state.list = { items: [], unreadable: [], partial: false };
    const html = await render();
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('What Happens Next');
    expect(html).toContain('You have no requests yet.');
    expect(html).not.toContain('Your requests');
  });
  it('has no tablist, only the requests, with the not available sentence, when the meetings are off', async () => {
    state.meetings = read({ reportsOff: true });
    const html = await render();
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain(
      'Meetings and visits are not available here yet. Your requests are listed below.',
    );
    expect(html).toContain('<h2');
    expect(html).toContain(`href="/account/rooms/${id(1)}"`);
    expect(html).not.toContain('No meetings or visits are ready to show yet.');
  });
  it('has no tablist, no heading and the intro outside a disclosure where the requests list is not available', async () => {
    state.readable = false;
    state.list = { items: [], unreadable: [], partial: false };
    const html = await render();
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<details');
    expect(html).toContain(
      '<p>This page lists every meeting and visit the Corridra team has set up for your requests.</p>',
    );
    expect(html).not.toContain('Each one is a step');
  });
});
