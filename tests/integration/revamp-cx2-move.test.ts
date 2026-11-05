import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMoveModel, type MoveInput } from '../../apps/web/lib/move-cards';

// CX PR 2a, the Move page (/account/move, Home once the front door switch is on): what others hold is a row
// list where each row is one link and the owner is a plain word (no tall card, no repeated chip, no repeated
// "Open"); the newest request's stage is the slim bar, never the six-step stepper with "not tracked yet"; and
// no in-page button competes with the header's one filled action. Case ids: CX-02 (every link stays), CX-06.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className, ...rest }, children as never),
}));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const render = (type: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(type, props));

const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Atelier Rahman',
  role: 'owner',
} as const;
const member = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Dhaka Knits',
  role: 'member',
} as const;
const empty: MoveInput = { workspaces: [], drafts: [], quotes: [], companyLinks: [], requests: [] };
const busy = buildMoveModel({
  ...empty,
  workspaces: [owner, member],
  drafts: [
    {
      id: 'd1',
      workspaceId: owner.id,
      title: 'Cutting machine',
      updatedAt: '2026-10-01T00:00:00Z',
    },
  ],
  quotes: [{ id: 'q2', workspaceId: member.id, title: 'Interpreter', contextLabel: 'Mission' }],
  requests: [
    {
      id: 'r1',
      workspaceId: owner.id,
      createdAt: '2026-10-02T00:00:00Z',
      progress: { status: 'OUTREACH', receivedAt: '2026-10-02T09:00:00Z', replies: [] },
    },
  ],
});

describe('CX PR 2a: Move, what others hold', () => {
  it('lists it as rows, one link each, with the owner as a plain word and no repeated Open link', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: busy, startHref: '/plan' });
    const others = html.slice(html.indexOf('Waiting on others'));
    const rows = others.match(/<li class="ux-row"/g) ?? [];
    expect(rows).toHaveLength(busy.waiting.length);
    expect(busy.waiting.length).toBeGreaterThan(0);
    for (const row of others.split('<li class="ux-row"').slice(1))
      expect(row.split('</li>')[0].match(/<a /g)).toHaveLength(1);
    expect(others).not.toContain('move-wait');
    expect(others).not.toMatch(/>Open</);
    expect(others).toContain('The Corridra team is looking for suppliers or buyers.');
    expect(others).toContain('Workspace owner or admin');
  });
  it('keeps every destination it had: each waiting row links where its Open link went', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: busy, startHref: '/plan' });
    for (const row of busy.waiting) expect(html).toContain(`href="${row.href}"`);
  });
});

describe('CX PR 2a: Move, the stage and the actions', () => {
  const quiet = buildMoveModel({
    ...empty,
    workspaces: [owner],
    requests: [
      {
        id: 'r9',
        workspaceId: owner.id,
        createdAt: '2026-10-02T00:00:00Z',
        progress: { status: 'FOLLOW_UP', receivedAt: '2026-10-02T09:00:00Z', replies: [] },
      },
    ],
  });
  it('shows the newest request as the slim bar, not the stepper, and never says not tracked yet', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: quiet, startHref: '/plan' });
    expect(html).toContain('class="mr-stage"');
    expect(html).not.toContain('mr-road');
    expect(html.toLowerCase()).not.toContain('not tracked');
    expect(html).toContain('aria-current="step"');
  });
  it('has no filled in-page button: card actions and the start link are quiet, the header holds the primary', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const withCards = render(MoveView, { model: busy, startHref: '/plan' });
    expect(withCards).toContain('mr-move-action');
    expect(withCards).not.toMatch(/class="button mr-move-action"/);
    const empty2 = render(MoveView, { model: buildMoveModel(empty), startHref: '/plan' });
    expect(empty2).toContain('href="/plan"');
    expect(empty2).not.toMatch(/class="button"[^>]*href="\/plan"/);
    expect(empty2).not.toMatch(/<a class="button"/);
  });
});

// CX-02: what the Move page linked to before this change (a card's action, each waiting row's Open link, the
// latest request's Open link, Start a request) is what it links to now. Written from the old markup.
describe('CX-02: Move keeps every destination it had', () => {
  it('links every card, every waiting row and the way to start', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: busy, startHref: '/plan/start' });
    for (const card of busy.cards) if (card.href) expect(html).toContain(`href="${card.href}"`);
    for (const row of busy.waiting) expect(html).toContain(`href="${row.href}"`);
    expect(html).toContain('href="/plan/start"');
  });
  it('links the latest request and the way to start when nothing is waiting', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const quiet = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [
        {
          id: 'r9',
          workspaceId: owner.id,
          createdAt: '2026-10-02T00:00:00Z',
          progress: { status: 'FOLLOW_UP', receivedAt: '2026-10-02T09:00:00Z', replies: [] },
        },
      ],
    });
    const html = render(MoveView, { model: quiet, startHref: '/plan/start' });
    expect(quiet.latest).not.toBeNull();
    expect(html).toContain(`href="${quiet.latest!.href}"`);
    expect(html).toContain('href="/plan/start"');
    expect(html).toContain('>Start a Request<');
    expect(html).toContain('>Open<');
  });
});

describe('Home summary never claims more than the page could read (Codex review of PR 305)', () => {
  it('says all caught up only when every source was read in full', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: buildMoveModel(empty), startHref: '/plan' });
    expect(html).toContain('You are all caught up.');
  });

  it('does not say all caught up when a source could not be read, a list was cut short or workspaces were left unread', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    for (const extra of [{ unreadable: true }, { partial: true }, { skippedWorkspaces: 2 }]) {
      const html = render(MoveView, { model: buildMoveModel(empty), startHref: '/plan', ...extra });
      expect(html).not.toContain('all caught up');
      expect(html).toContain('This page may not show everything that needs you yet.');
    }
  });

  it('does not say everything else is moving when the list is incomplete', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: busy, startHref: '/plan', partial: true });
    expect(html).not.toContain('Everything else is moving');
    expect(html).toContain('so far. This page may not show everything yet.');
  });

  // Codex review of PR 310: a journey view shows only the tasks the work list could sort into a journey.
  it('never says nothing needs you in a journey while tasks are unsorted or the work list was cut short', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const allSell = Object.fromEntries(busy.cards.map((card) => [card.id, 'sell']));
    const unsorted = render(MoveView, { model: busy, startHref: '/plan', journey: 'source' });
    expect(unsorted).not.toContain('Nothing in this journey needs you right now.');
    expect(unsorted).not.toContain('all caught up');
    expect(unsorted).toMatch(/(One more thing needs|\d+ more things need) you under All\./);
    const cutShort = render(MoveView, {
      model: busy,
      startHref: '/plan',
      journey: 'source',
      taskJourneys: allSell,
      sortIncomplete: true,
    });
    expect(cutShort).toContain('This view may not show everything in sourcing yet.');
    expect(cutShort).not.toContain('Nothing in this journey needs you right now.');
    const sorted = render(MoveView, {
      model: busy,
      startHref: '/plan',
      journey: 'source',
      taskJourneys: allSell,
    });
    expect(sorted).toContain('Nothing in this journey needs you right now.');
    expect(sorted).toContain('href="/account/move"');
  });

  // Owner-approved work rooms (5 Nov 2026): a single-journey Home has nothing to switch between, so the switch
  // is hidden; with two journeys it is there; and while one journey is shown All stays one tap away.
  it('hides the journey switch for a single-journey Home and shows it for two', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const ids = busy.cards.map((card) => card.id);
    const one = render(MoveView, {
      model: busy,
      startHref: '/plan',
      taskJourneys: Object.fromEntries(ids.map((id) => [id, 'sell'])),
    });
    expect(one).not.toContain('aria-label="Show work for"');
    // A journey with no task yet still counts once the person has work in it (its journey card).
    const card = {
      journey: 'source',
      id: 'r1',
      workspaceId: owner.id,
      count: '1',
      title: 'Spinning frames',
      kind: 'request',
      status: 'OUTREACH',
      statusWords: 'Finding companies',
      dateWords: '2 Oct 2026',
      at: '2026-10-02T00:00:00Z',
      href: '/account/rooms/r1',
    };
    const two = render(MoveView, {
      model: busy,
      startHref: '/plan',
      taskJourneys: Object.fromEntries(ids.map((id) => [id, 'sell'])),
      journeys: [card],
    });
    expect(two).toContain('aria-label="Show work for"');
    expect(two).toContain('href="/account/move?journey=sell"');
    expect(two).toContain('href="/account/move?journey=source"');
    const shown = render(MoveView, {
      model: busy,
      startHref: '/plan',
      journey: 'sell',
      taskJourneys: Object.fromEntries(ids.map((id) => [id, 'sell'])),
    });
    expect(shown).toContain('aria-label="Show work for"');
    expect(shown).toContain('href="/account/move"');
  });

  it('remembers the last journey in this browser only, and an address with ?journey= wins', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (path: string) => readFileSync(resolve(path), 'utf8');
    const view = read('apps/web/app/account/move/move-view.tsx');
    expect(view).toContain("const journeyKey = 'corridra.home.journey';");
    expect(view).toContain("onClick={() => remember('all')}");
    expect(view).toContain('onClick={() => remember(j)}');
    // Per signed-in person on a shared browser, and written back into the address (guardian review of PR 314).
    expect(view).toContain('const memoryKey = viewer ? `${journeyKey}:${viewer}` : journeyKey;');
    expect(view).toContain("url.searchParams.set('journey', journey);");
    expect(read('apps/web/app/account/move/page.tsx')).toContain('viewer={session.subject}');
    // The remembered journey applies only while the person still has it and has more than one.
    expect(view).toMatch(
      /asked \?\?\s*\(present\.length > 1 && isJourney\(remembered\) && present\.includes\(remembered\)/,
    );
    expect(view).not.toMatch(/document\.cookie|fetch\(/);
  });

  // Reports became tabs (PR 313): the shortcut for a pasted private link opens Shared With Me, where the
  // invitation input lives, not the first Reports tab.
  it('sends the Open a Shared Mission shortcut to the Shared With Me tab', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model: buildMoveModel(empty), startHref: '/plan' });
    expect(html).toContain('Open a Shared Mission');
    expect(html).toContain('href="/account?view=results&amp;tab=shared"');
  });
});
