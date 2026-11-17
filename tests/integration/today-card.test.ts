import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildMoveModel,
  pickTodayMove,
  requestHolder,
  type MoveInput,
} from '../../apps/web/lib/move-cards';

// TC1: the Today card. One move is chosen from the existing Move model; nothing is invented, a member never
// gets a move they cannot act on, and the card is a pure function of the model so every rule is tested here.
const base: MoveInput = {
  workspaces: [{ id: 'w1', name: 'Studio', role: 'owner' }],
  drafts: [],
  quotes: [],
  companyLinks: [],
  requests: [],
};
const request = (id: string, status = 'ACTIVE') => ({
  id,
  workspaceId: 'w1',
  createdAt: '2026-11-01T00:00:00Z',
  progress: { status, receivedAt: '2026-11-01T00:00:00Z', replies: [] },
});
const move = (
  id: string,
  dueOn: string | null,
  holder: 'customer' | 'team' | 'third' = 'customer',
) => ({
  id,
  verb: 'Answer' as const,
  object: `question ${id}`,
  holder,
  dueOn,
});

describe('requestHolder', () => {
  it('names the team for every status the team holds, and nobody for unknown words', () => {
    for (const status of ['DRAFT', 'ACTIVE', 'OUTREACH', 'FOLLOW_UP'])
      expect(requestHolder(status)).toBe('team');
    expect(requestHolder('SOMETHING_NEW')).toBeNull();
    expect(requestHolder(null)).toBeNull();
  });
});

describe('pickTodayMove', () => {
  it('returns null when nothing is open, so there is no card', () => {
    expect(pickTodayMove(buildMoveModel(base))).toBeNull();
  });

  it('picks the open move with the earliest real due date, with its real title and request', () => {
    const model = buildMoveModel({
      ...base,
      requests: [request('r1'), request('r2')],
      moves: [
        { requestId: 'r1', moves: [move('a', '2026-12-10'), move('b', null)] },
        { requestId: 'r2', moves: [move('c', '2026-11-20')] },
      ],
    });
    const today = pickTodayMove(model);
    expect(today?.id).toBe('move:c');
    expect(today?.title).toBe('Answer question c');
    expect(today?.dueOn).toBe('2026-11-20');
    expect(today?.holder).toBe('team');
  });

  it('omits fields that are missing instead of inventing them', () => {
    const model = buildMoveModel({
      ...base,
      requests: [],
      moves: [{ requestId: 'rX', moves: [move('z', null)] }],
    });
    const today = pickTodayMove(model);
    expect(today?.dueOn).toBeUndefined();
    expect(today?.holder).toBeUndefined();
  });

  it('never picks something a member cannot act on', () => {
    const member: MoveInput = {
      ...base,
      workspaces: [{ id: 'w1', name: 'Studio', role: 'member' }],
      quotes: [{ id: 'q1', workspaceId: 'w1', title: 'Quote', contextLabel: '' }],
      companyLinks: [{ workspaceId: 'w1', organisationName: 'Acme' }],
    };
    expect(pickTodayMove(buildMoveModel(member))).toBeNull();
    const owner = pickTodayMove(
      buildMoveModel({ ...member, workspaces: [{ id: 'w1', name: 'Studio', role: 'owner' }] }),
    );
    expect(owner?.card?.kind).toBe('quote');
  });

  it('never picks a move the team or a third party holds', () => {
    const model = buildMoveModel({
      ...base,
      requests: [request('r1')],
      moves: [
        {
          requestId: 'r1',
          moves: [move('t', '2026-11-18', 'team'), move('x', '2026-11-19', 'third')],
        },
      ],
    });
    expect(pickTodayMove(model)).toBeNull();
  });

  it('keeps the card order when no move has a date', () => {
    const model = buildMoveModel({
      ...base,
      drafts: [{ id: 'd1', workspaceId: 'w1', title: 'Draft', updatedAt: '2026-11-10T00:00:00Z' }],
    });
    expect(pickTodayMove(model)?.id).toBe('draft:d1');
  });
});

describe('pickTodayMove order', () => {
  const reportModel = () =>
    buildMoveModel({
      ...base,
      drafts: [{ id: 'd1', workspaceId: 'w1', title: 'Draft', updatedAt: '2026-11-10T00:00:00Z' }],
      reports: [
        {
          id: 'p1',
          title: 'Report',
          requestId: 'r1',
          publishedAt: '2026-11-12T00:00:00Z',
          href: '/x',
        },
      ],
      requests: [request('r1')],
      moves: [{ requestId: 'r1', moves: [move('a', '2026-12-10')] }],
    });
  it('puts a new report before a draft and before a dated move (the result they asked for)', () => {
    expect(pickTodayMove(reportModel())?.card?.kind).toBe('report');
  });
  it('puts an unread reply before every card, as the Move view has always listed it', () => {
    const model = reportModel();
    const today = pickTodayMove(model, {
      unread: [
        {
          requestId: 'r1',
          latestReplyAt: '2026-11-13T00:00:00Z',
          received: '2026-11-01',
          href: '/r',
        },
      ],
    });
    expect(today?.id).toBe('reply:r1');
    expect(today?.reply?.href).toBe('/r');
    expect(today?.card).toBeUndefined();
    expect(today?.holder).toBe('team');
  });
  it('keeps the team order when two moves share a due date', () => {
    const model = buildMoveModel({
      ...base,
      requests: [request('r1')],
      moves: [
        { requestId: 'r1', moves: [move('first', '2026-11-20'), move('second', '2026-11-20')] },
      ],
    });
    expect(pickTodayMove(model)?.id).toBe('move:first');
  });
});

// The rendered Your Move view: one Today card, one filled action, and every link it had before.
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
const view = async (
  model: ReturnType<typeof buildMoveModel>,
  extra: Record<string, unknown> = {},
) => {
  const { MoveView } = await import(
    /* @vite-ignore */ `../../apps/web/${'app/account/move/move-view'}`
  );
  return renderToStaticMarkup(createElement(MoveView, { model, startHref: '/plan', ...extra }));
};
const busy = buildMoveModel({
  ...base,
  drafts: [{ id: 'd1', workspaceId: 'w1', title: 'Draft', updatedAt: '2026-11-10T00:00:00Z' }],
  requests: [request('r1'), request('r2', 'OUTREACH')],
  moves: [
    { requestId: 'r1', moves: [move('a', '2026-12-10'), move('b', null)] },
    { requestId: 'r2', moves: [move('c', '2026-11-20'), move('t', null, 'team')] },
  ],
});
const anchors = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

describe('Your Move with the Today card', () => {
  it('draws one Today card with one filled action, real title, holder and date', async () => {
    const html = await view(busy);
    expect(html.match(/data-testid="today-card"/g)).toHaveLength(1);
    expect(html.match(/primary-link/g)).toHaveLength(1);
    const card = html.slice(html.indexOf('data-testid="today-card"'));
    expect(card.slice(0, card.indexOf('</section>'))).toContain('Answer question c');
    expect(card.slice(0, card.indexOf('</section>'))).toContain('20 Nov 2026');
    expect(card.slice(0, card.indexOf('</section>'))).toContain('Corridra team');
  });
  it('keeps every link the page had: each card, each waiting row and the way to start', async () => {
    const html = await view(busy);
    const links = anchors(html);
    for (const card of busy.cards) expect(links).toContain(card.href);
    for (const row of busy.waiting) expect(links).toContain(row.href);
    expect(links).toContain('/plan');
    // The picked Move moves into the Today card; it is not drawn a second time.
    const today = pickTodayMove(busy)!;
    expect(today.id).toBe('move:c');
    expect(html.match(new RegExp('move-card-link', 'g'))?.length ?? 0).toBeGreaterThan(0);
  });
  it('shows the same number of cards as before: the Today card replaces one list row and one more row waits under Show More', async () => {
    const html = await view(busy);
    const shown = html.slice(0, html.indexOf('move-more'));
    const rows = shown.match(/<article class="mr-move"/g)?.length ?? 0;
    expect(rows + 1).toBe(2);
  });
  it('draws no Today card when nothing is open', async () => {
    const html = await view(buildMoveModel(base));
    expect(html).not.toContain('today-card');
  });
  it('keeps what the row showed: the journey tag and the draft subline', async () => {
    const model = buildMoveModel({
      ...base,
      drafts: [{ id: 'd1', workspaceId: 'w1', title: 'Draft', updatedAt: '2026-11-10T00:00:00Z' }],
    });
    const html = await view(model, { taskJourneys: { 'draft:d1': 'source' } });
    const card = html.slice(html.indexOf('data-testid="today-card"'));
    const inside = card.slice(0, card.indexOf('</section>'));
    expect(inside).toContain('move-tag');
    expect(inside).toContain('Sourcing');
    expect(inside).toContain('The request is saved as a draft.');
  });
});
