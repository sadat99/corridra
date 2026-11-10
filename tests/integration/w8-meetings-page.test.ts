import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingRow, MeetingsRead } from '../../apps/web/lib/meetings/load';
import type { WorkItem } from '../../apps/web/lib/work-items/types';

// W8: the Meetings page renders the right sentences for each state. The page is mounted with its reads answered by
// the test and the real list components, and written out as HTML, so what is asserted is what a person reads.
// The two lines that point at meetings ("Open a meeting in its Request..." and "Meetings above come from...")
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
const sourceLine = 'Meetings above come from the reports you have saved.';
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
