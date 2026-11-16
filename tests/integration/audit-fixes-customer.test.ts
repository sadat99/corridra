import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMoveModel, type MoveInput } from '../../apps/web/lib/move-cards';

// Audit fixes 1, customer set (owner-approved packet, 16 Nov 2026). Each case fails on the code before the fix.
//   23  one colour per journey: the sidebar dots, the room tags and the Home tags read the journey tokens;
//   25  the Move switch draws no zero, and a count is spoken as what needs the person;
//   26  "Waiting on others" is newest first, rows without a date last, in a stable order;
//   29  the Reports empty line names the Requests page, not "My Work";
//   32  /plan does not ask a signed-in customer to create an account;
//   34  a real programme says "Planning record only", never a stray "data".
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
  default: ({ children, href, ...rest }: { children: unknown; href: string }) =>
    createElement('a', { href, ...rest }, children as never),
}));
// The public header's answer, which the request page heading reads (no request of its own).
const seen = vi.hoisted(() => ({ who: null as 'customer' | 'staff' | null }));
vi.mock('../../apps/web/components/use-signed-in', () => ({ useSignedInSeen: () => seen.who }));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const render = (type: unknown, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(type, props));
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
};

const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Atelier',
  role: 'owner',
} as const;
const member = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Knits',
  role: 'member',
} as const;
const empty: MoveInput = { workspaces: [], drafts: [], quotes: [], companyLinks: [], requests: [] };
const request = (id: string, receivedAt: string) => ({
  id,
  workspaceId: owner.id,
  createdAt: receivedAt,
  progress: { status: 'OUTREACH', receivedAt, replies: [] },
});

describe('23: one colour per journey', () => {
  it('defines the journey tokens as aliases of existing tokens, inside the design system layer', () => {
    const css = read('apps/web/app/globals.css');
    const layer = css.slice(css.indexOf('Design system layer (Phase 1)'));
    for (const [name, value] of [
      ['--journey-source', 'var(--brand)'],
      ['--journey-sell', 'var(--editorial-accent)'],
      ['--journey-sell-text', 'var(--ac-copper-ink)'],
      ['--journey-organise', 'var(--positive)'],
      ['--journey-organise-surface', 'var(--positive-surface)'],
      ['--journey-organise-text', 'var(--positive)'],
    ])
      expect(layer).toContain(`${name}: ${value};`);
    expect(layer.match(/--journey-[a-z-]+: (?!var\()/g)).toBeNull();
  });

  it('the sidebar dot, the room tag and the Home tag of Organising and Selling read the same journey token', () => {
    const rail = read('apps/web/components/ux/customer-rail.css');
    const room = read('apps/web/app/account/rooms/[requestId]/room-frame.css');
    const move = read('apps/web/app/account/move/move-view.css');
    expect(rule(rail, ".ux-customer-nav-dot[data-tone='positive']")).toContain(
      'var(--journey-organise)',
    );
    expect(rule(rail, ".ux-customer-nav-dot[data-tone='ornament']")).toContain(
      'var(--journey-sell)',
    );
    expect(rule(room, ".room-tag[data-journey='organise']")).toContain(
      'var(--journey-organise-text)',
    );
    expect(rule(room, ".room-tag[data-journey='sell']")).toContain('var(--journey-sell-text)');
    expect(rule(move, ".move-tag[data-journey='organise']::before")).toContain(
      'var(--journey-organise)',
    );
    expect(rule(move, ".move-tag[data-journey='organise']")).toContain(
      'var(--journey-organise-text)',
    );
    expect(rule(move, ".move-tag[data-journey='sell']")).toContain('var(--journey-sell-text)');
  });
});

describe('25: the Move switch counts', () => {
  const model = buildMoveModel({
    ...empty,
    workspaces: [owner],
    requests: [request('r1', '2026-10-30T09:00:00Z')],
  });
  const card = (journey: string, id: string) => ({
    journey,
    id,
    workspaceId: owner.id,
    count: '1',
    title: 'Spinning frames',
    kind: 'request',
    status: 'OUTREACH',
    statusWords: 'Finding companies',
    dateWords: '30 Oct 2026',
    at: '2026-10-30T00:00:00Z',
    href: `/account/rooms/${id}`,
  });

  it('draws no zero when nothing needs the person, while work waits on others', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, {
      model,
      startHref: '/plan',
      journeys: [card('source', 'r1'), card('sell', 'r2')],
    });
    expect(model.waiting.length).toBeGreaterThan(0);
    expect(html).toContain('aria-label="Show work for"');
    const nav = html.slice(html.indexOf('aria-label="Show work for"'), html.indexOf('</nav>'));
    expect(nav).not.toContain('<em>0</em>');
    expect(nav).not.toContain('need you');
  });

  it('shows a count that is not zero, and says it in words', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const busy = buildMoveModel({
      ...empty,
      workspaces: [owner],
      drafts: [{ id: 'd1', workspaceId: owner.id, title: 'Cutting', updatedAt: '2026-10-01' }],
      quotes: [{ id: 'q1', workspaceId: owner.id, title: 'Interpreter', contextLabel: 'Mission' }],
    });
    const html = render(MoveView, {
      model: busy,
      startHref: '/plan',
      taskJourneys: { 'draft:d1': 'source', 'quote:q1': 'source' },
      journeys: [card('sell', 'r2')],
    });
    const nav = html.slice(html.indexOf('aria-label="Show work for"'), html.indexOf('</nav>'));
    expect(nav).toContain('<em>2</em>');
    expect(nav).toContain('<span class="sr-only"> need you</span>');
    // Sell has nothing that needs the person, so it has no number.
    const sell = nav.slice(nav.indexOf('journey=sell'));
    expect(sell.slice(0, sell.indexOf('</a>'))).not.toContain('<em>');
  });

  it('keeps the count out of a capsule: the switch count has no pill radius', () => {
    expect(rule(read('apps/web/app/account/move/move-view.css'), '.move-seg em')).not.toContain(
      '999px',
    );
  });

  it('draws the switch count as a plain number: no fill, box size or padding, selected or not', () => {
    const css = read('apps/web/app/account/move/move-view.css');
    for (const selector of ['.move-seg em', ".move-seg a[aria-current='page'] em"]) {
      const found = css.split(`${selector} {`).slice(1);
      expect(found.length, selector).toBeGreaterThan(0);
      for (const block of found.map((rest) => rest.slice(0, rest.indexOf('}'))))
        expect(block, selector).not.toMatch(/(^|[\s;])(background|min-width|height|padding)\s*:/);
    }
  });
});

describe('26: Waiting on others order', () => {
  it('is newest received first, rows without a date last, whatever order the sources gave', () => {
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner, member],
      quotes: [{ id: 'q1', workspaceId: member.id, title: 'Interpreter', contextLabel: 'Mission' }],
      requests: [
        request('r31', '2026-10-31T09:00:00Z'),
        request('r24', '2026-10-24T09:00:00Z'),
        request('r30', '2026-10-30T09:00:00Z'),
      ],
    });
    expect(model.waiting.map((row) => row.id)).toEqual([
      'request:r31',
      'request:r30',
      'request:r24',
      'quote:q1',
    ]);
  });

  it('breaks a tie on the same day by id, so the order never changes between loads', () => {
    const one = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [request('rb', '2026-10-30T09:00:00Z'), request('ra', '2026-10-30T15:00:00Z')],
    });
    const two = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [request('ra', '2026-10-30T15:00:00Z'), request('rb', '2026-10-30T09:00:00Z')],
    });
    expect(one.waiting.map((row) => row.id)).toEqual(['request:ra', 'request:rb']);
    expect(two.waiting.map((row) => row.id)).toEqual(['request:ra', 'request:rb']);
  });

  it('orders by the received time, not the date text: same-day requests and offset timestamps sort newest first', () => {
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [
        // Same day: the id order (ra before rb) disagrees with the time order.
        request('ra', '2026-10-29T08:00:00Z'),
        request('rb', '2026-10-29T17:00:00Z'),
        // "2026-10-31" as text, but 22:00 on 30 Oct in UTC: older than rd at 23:00 on 30 Oct.
        request('rc', '2026-10-31T03:00:00+05:00'),
        request('rd', '2026-10-30T23:00:00Z'),
      ],
      moves: [
        {
          requestId: 'rb',
          moves: [{ id: 'm1', verb: 'Confirm', object: 'the dates', holder: 'team', dueOn: null }],
        },
      ],
    });
    expect(model.waiting.map((row) => row.id)).toEqual([
      'request:rd',
      'request:rc',
      'move:m1',
      'request:rb',
      'request:ra',
    ]);
  });
});

describe('29 and 34: plain labels', () => {
  it('29: the Reports empty line names the Requests page', () => {
    const text = read('apps/web/app/account/assigned-missions.tsx').replace(/\s+/g, ' ');
    expect(text).toContain(
      'No commercial report has been delivered to this account yet. Your requests are still on the Requests page.',
    );
    expect(text).not.toContain('My Work');
  });

  it('34: a real programme says "Planning record only", and a sample one keeps "Sample data"', () => {
    const source = read('apps/web/app/account/delegations/customer-programmes.tsx');
    expect(source).not.toContain("'Planning record only · data'");
    expect(source.match(/\? 'Planning record only'\n/g)).toHaveLength(2);
    expect(source.match(/: 'Planning record only · Sample data'/g)).toHaveLength(2);
  });
});

describe('32: the /plan lead line', () => {
  it('does not ask a signed-in customer to create an account', async () => {
    const { PlanHead } = await load('app/plan/plan-head');
    seen.who = 'customer';
    const html = render(PlanHead, { realMode: true });
    expect(html).not.toContain('Create an account');
    expect(html).toContain(
      'Start with your objective. You are signed in, so your request and its replies stay private in your account.',
    );
  });

  it('keeps today’s sentence signed out, for staff and before the header has answered', async () => {
    const { PlanHead } = await load('app/plan/plan-head');
    for (const who of [null, 'staff'] as const) {
      seen.who = who;
      expect(render(PlanHead, { realMode: true })).toContain(
        'Create an account at the final step to keep your request and replies private.',
      );
    }
    seen.who = 'customer';
    expect(render(PlanHead, { realMode: false })).not.toContain('You are signed in');
  });
});

describe('28: Shared With Me', () => {
  it('offers Browse Approved Companies on the Shared and Saved tabs where the companies module is on', () => {
    const page = read('apps/web/app/account/page.tsx');
    const reports = page.slice(page.indexOf("view === 'results'"), page.indexOf("view === 'more'"));
    const shared = reports.slice(reports.indexOf('shared={'));
    expect(shared).toContain('customerCompaniesEnabled() &&');
    expect(shared).toContain('href="/account/companies"');
    expect(reports.match(/Browse Approved Companies/g)).toHaveLength(2);
    expect(reports).not.toContain('Browse approved companies');
  });
});
