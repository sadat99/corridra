import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMoveModel, unreadReplies, type MoveInput } from '../../apps/web/lib/move-cards';
import { fill } from '../../apps/web/lib/i18n/fill';
import { followPages } from '../../apps/web/lib/move-pages';
import { uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// Your Move and the navigation switch (Lane 4 of the UX update). Every rule is checked without a
// browser or a database: what exists is decided by `buildMoveModel`, the words by the message module.
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

describe('what Your Move shows', () => {
  it('has nothing when nothing exists, and invents no card', () => {
    const model = buildMoveModel(empty);
    expect(model.cards).toEqual([]);
    expect(model.waiting).toEqual([]);
    expect(model.replyCandidates).toEqual([]);
    expect(model.latest).toBeNull();
  });

  it('shows an open draft as a card for the person, newest first', () => {
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner],
      drafts: [
        {
          id: 'd1',
          workspaceId: owner.id,
          title: 'Cutting machine',
          updatedAt: '2026-10-01T00:00:00Z',
        },
        {
          id: 'd2',
          workspaceId: owner.id,
          title: 'Zip supplier',
          updatedAt: '2026-10-20T00:00:00Z',
        },
      ],
    });
    expect(model.cards.map((c) => c.id)).toEqual(['draft:d2', 'draft:d1']);
    expect(model.cards[0]).toMatchObject({ kind: 'draft', verb: 'Send', holder: 'you' });
    expect(model.cards[0].href).toBe(`/account/drafts/${owner.id}`);
  });

  it('gives a quote card to an owner or admin only, and a member sees it as waiting on the owner', () => {
    const quotes = [
      { id: 'q1', workspaceId: owner.id, title: 'Visit planning', contextLabel: 'Mission' },
      { id: 'q2', workspaceId: member.id, title: 'Interpreter', contextLabel: 'Mission' },
    ];
    const model = buildMoveModel({ ...empty, workspaces: [owner, member], quotes });
    expect(model.cards.map((c) => c.id)).toEqual(['quote:q1']);
    expect(model.cards[0]).toMatchObject({ verb: 'Answer', holder: 'you' });
    expect(model.waiting).toEqual([
      expect.objectContaining({ id: 'quote:q2', holder: 'owner', kind: 'quote' }),
    ]);
    // A member is never told it is theirs to answer.
    expect(model.cards.some((c) => c.id === 'quote:q2')).toBe(false);
  });

  it('asks for company evidence from an owner or admin, and tells a member who can', () => {
    const companyLinks = [
      { workspaceId: owner.id, organisationName: 'Atelier Rahman Ltd' },
      { workspaceId: member.id, organisationName: null },
    ];
    const model = buildMoveModel({ ...empty, workspaces: [owner, member], companyLinks });
    expect(model.cards).toHaveLength(1);
    expect(model.cards[0]).toMatchObject({ kind: 'company', verb: 'Add', holder: 'you' });
    expect(model.waiting[0]).toMatchObject({ kind: 'company', holder: 'owner' });
  });

  it('names the workspace only when the person has more than one', () => {
    const draft = {
      id: 'd1',
      workspaceId: owner.id,
      title: 'Cutting machine',
      updatedAt: '2026-10-01T00:00:00Z',
    };
    expect(
      buildMoveModel({ ...empty, workspaces: [owner], drafts: [draft] }).cards[0].context,
    ).toBe('Cutting machine');
    expect(
      buildMoveModel({ ...empty, workspaces: [owner, member], drafts: [draft] }).cards[0].context,
    ).toBe('Cutting machine · Atelier Rahman');
  });

  it('puts a request the Corridra team holds under waiting on others, never under the person', () => {
    const request = (id: string, status: string) => ({
      id,
      workspaceId: owner.id,
      createdAt: '2026-10-02T00:00:00Z',
      progress: { status, receivedAt: '2026-10-02T09:00:00Z', replies: [] },
    });
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [
        request('r1', 'OUTREACH'),
        request('r2', 'DRAFT'),
        request('r3', 'CLOSED'),
        request('r4', 'ON_HOLD'),
      ],
    });
    expect(model.waiting.map((w) => w.id)).toEqual(['request:r1']);
    expect(model.waiting[0]).toMatchObject({
      holder: 'team',
      status: 'OUTREACH',
      received: '2026-10-02',
    });
    expect(model.cards).toEqual([]);
  });

  it('ignores a request whose progress cannot be read (retention passed), and still names the latest', () => {
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [
        { id: 'old', workspaceId: owner.id, createdAt: '2026-01-01T00:00:00Z', progress: null },
        { id: 'new', workspaceId: owner.id, createdAt: '2026-10-05T00:00:00Z', progress: null },
      ],
    });
    expect(model.waiting).toEqual([]);
    expect(model.latest).toMatchObject({ id: 'new', status: null, href: '/account/requests/new' });
  });

  it('invents no date: no card carries a due date', () => {
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner],
      drafts: [{ id: 'd1', workspaceId: owner.id, title: 'x', updatedAt: '2026-10-01T00:00:00Z' }],
      quotes: [{ id: 'q1', workspaceId: owner.id, title: 'x', contextLabel: 'y' }],
    });
    for (const card of model.cards) expect(Object.keys(card)).not.toContain('due');
  });
});

describe('new replies, kept on this device', () => {
  const candidates = [
    {
      requestId: 'r1',
      latestReplyAt: '2026-10-10T10:00:00Z',
      received: '2026-10-01',
      href: '/account/requests/r1',
    },
    {
      requestId: 'r2',
      latestReplyAt: '2026-10-12T10:00:00Z',
      received: '2026-10-02',
      href: '/account/requests/r2',
    },
  ];
  it('treats every reply as new until a mark exists, then only a newer one', () => {
    expect(unreadReplies(candidates, {}).map((c) => c.requestId)).toEqual(['r1', 'r2']);
    expect(
      unreadReplies(candidates, { r1: '2026-10-10T10:00:00Z', r2: '2026-10-11T00:00:00Z' }).map(
        (c) => c.requestId,
      ),
    ).toEqual(['r2']);
  });
  it('takes the latest reply of a request as its mark', () => {
    const model = buildMoveModel({
      ...empty,
      workspaces: [owner],
      requests: [
        {
          id: 'r1',
          workspaceId: owner.id,
          createdAt: '2026-10-01T00:00:00Z',
          progress: {
            status: 'MEETINGS',
            receivedAt: '2026-10-01T09:00:00Z',
            replies: [{ createdAt: '2026-10-05T00:00:00Z' }, { createdAt: '2026-10-09T00:00:00Z' }],
          },
        },
      ],
    });
    expect(model.replyCandidates[0].latestReplyAt).toBe('2026-10-09T00:00:00Z');
  });
});

describe('the Your Move screen', () => {
  const model = buildMoveModel({
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

  it('draws the cards, the holders and the way to start, in English by default', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const html = render(MoveView, { model, startHref: '/plan' });
    expect(html).toContain('Waiting for you');
    expect(html).toContain('Send your draft request');
    expect(html).toContain('Open the draft');
    expect(html).toContain('Waiting on others');
    expect(html).toContain('The Corridra team is looking for suppliers or buyers.');
    expect(html).toContain('Workspace owner or admin');
    expect(html).toContain('A quote is waiting for a workspace owner or admin');
    expect(html).toContain('href="/plan"');
    expect(html).toContain('lang="en"');
  });

  it('says honestly that nothing is waiting, shows where the latest request stands and offers Start a request', async () => {
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
    const html = render(MoveView, {
      model: quiet,
      startHref: '/account?view=work#customer-workspaces',
    });
    expect(html).toContain('Nothing is waiting for you right now.');
    expect(html).toContain('Your most recent request');
    expect(html).toContain('aria-current="step"');
    expect(html).toMatch(
      /class="button"[^>]*>Start a request|href="\/account\?view=work#customer-workspaces"/,
    );
  });

  it('shows five cards and puts the rest behind one control', async () => {
    const { MoveView } = await load('app/account/move/move-view');
    const drafts = Array.from({ length: 7 }, (_, i) => ({
      id: `d${i}`,
      workspaceId: owner.id,
      title: `Draft ${i}`,
      updatedAt: `2026-10-0${i + 1}T00:00:00Z`,
    }));
    const html = render(MoveView, {
      model: buildMoveModel({ ...empty, workspaces: [owner], drafts }),
      startHref: '/plan',
    });
    expect(html).toContain('Show 2 more');
    expect(html.match(/class="mr-move"/g)).toHaveLength(7);
    expect(html).toContain('<details class="move-more">');
  });

  it('keeps no read mark on the server: the component reads it only in the browser', () => {
    const source = readFileSync(resolve('apps/web/app/account/move/move-view.tsx'), 'utf8');
    expect(source).toContain("'use client'");
    expect(source).toContain('localStorage');
    expect(source).not.toMatch(/fetch\(/);
  });
});

describe('words and messages', () => {
  it('fills a pattern and leaves an unknown name as written', () => {
    expect(fill('Show {count} more', { count: 3 })).toBe('Show 3 more');
    expect(fill('Hello {name}', {})).toBe('Hello {name}');
  });
});

describe('the switches', () => {
  it('are on only when the setting is exactly true', () => {
    expect(uxSwitchOn('CORRIDRA_UX_NAV', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_NAV', { CORRIDRA_UX_NAV: 'TRUE' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_NAV', { CORRIDRA_UX_NAV: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_NAV', { CORRIDRA_UX_NAV: 'true' })).toBe(true);
  });
  it('are described to the owner as real switches once they ship', () => {
    for (const name of ['CORRIDRA_UX_NAV', 'CORRIDRA_UX_MOVE'])
      expect(switchRegistry.find((s) => s.name === name)?.kind, name).toBe('flag');
  });
});

describe('the customer navigation', () => {
  const labels = (html: string) => [...html.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  it('with the switch off is exactly the navigation it always was', async () => {
    const { CustomerNav } = await load('components/customer-nav');
    const html = render(CustomerNav, { current: 'work', companies: true });
    expect(labels(html)).toEqual(['Home', 'My Work', 'Companies', 'Results', 'More']);
    expect(hrefs(html)).toEqual([
      '/account',
      '/account?view=work',
      '/account/companies',
      '/account?view=results',
      '/account?view=more',
    ]);
    expect(html).toContain('aria-label="Customer navigation"');
    expect(html).toContain('aria-current="page"');
    expect(
      render(CustomerNav, { current: 'work', companies: true, plainNames: false, move: true }),
    ).toBe(html);
    expect(labels(render(CustomerNav, { current: 'home' }))).toEqual([
      'Home',
      'My Work',
      'Results',
      'More',
    ]);
  });

  it('with the switch on names the five places in plain words', async () => {
    const { CustomerNav } = await load('components/customer-nav');
    const html = render(CustomerNav, {
      current: 'move',
      companies: true,
      plainNames: true,
      move: true,
    });
    expect(labels(html)).toEqual(['Your Move', 'Missions', 'Companies', 'Library', 'More']);
    expect(hrefs(html)[0]).toBe('/account/move');
    expect(hrefs(html)).toContain('/account?view=results');
    expect(labels(html)).toHaveLength(5);
  });

  it('keeps the word Home until Your Move is on, and never links a page that is not there', async () => {
    const { CustomerNav } = await load('components/customer-nav');
    const html = render(CustomerNav, { current: 'home', plainNames: true, move: false });
    expect(labels(html)[0]).toBe('Home');
    expect(hrefs(html)).not.toContain('/account/move');
  });

  it('reads the older Home view as Your Move when Your Move is the first tab', async () => {
    const { CustomerNav } = await load('components/customer-nav');
    const html = render(CustomerNav, { current: 'home', plainNames: true, move: true });
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(
      /href="\/account\/move"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/account\/move"/,
    );
  });

  it('is wired to the two switches through the shell and never touches the global style file', () => {
    const shell = readFileSync(resolve('apps/web/components/customer-shell.tsx'), 'utf8');
    expect(shell).toContain("uxSwitchOn('CORRIDRA_UX_NAV')");
    expect(shell).toContain("uxSwitchOn('CORRIDRA_UX_MOVE')");
  });
});

describe('the bare address and the old links', () => {
  const account = readFileSync(resolve('apps/web/app/account/page.tsx'), 'utf8');
  it('redirects only the bare address, and only when both switches are on', () => {
    expect(account).toMatch(
      /requested === undefined && uxSwitchOn\('CORRIDRA_UX_NAV'\) && uxSwitchOn\('CORRIDRA_UX_MOVE'\)/,
    );
    expect(account).toContain("redirect('/account/move')");
    // The four views and the hash redirect are still there.
    expect(account).toContain("const views = ['home', 'work', 'results', 'more'] as const;");
    expect(account).toContain('AccountHashRedirect');
  });
  it('Your Move keeps the old hashes working', () => {
    const page = readFileSync(resolve('apps/web/app/account/move/page.tsx'), 'utf8');
    expect(page).toContain('AccountHashRedirect');
    expect(page).toContain('notFound()');
    expect(page).toContain("uxSwitchOn('CORRIDRA_UX_MOVE')");
  });
});

describe('reading a whole list before saying nothing is waiting', () => {
  const pages = (sizes: number[], failAt?: number) => {
    const calls: (string | undefined)[] = [];
    const read = async (after?: string) => {
      calls.push(after);
      const n = after ? Number(after) : 0;
      if (n === failAt) throw new Error('provider down');
      return {
        items: Array.from({ length: sizes[n] }, (_, i) => `${n}-${i}`),
        nextAfter: n + 1 < sizes.length ? String(n + 1) : null,
      };
    };
    return { read, calls };
  };
  it('follows the cursor to the end and reports a complete list', async () => {
    const { read, calls } = pages([100, 100, 3]);
    const result = await followPages(read, 5);
    expect(result).toMatchObject({ complete: true, failed: false });
    expect(result.items).toHaveLength(203);
    expect(calls).toEqual([undefined, '1', '2']);
  });
  it('stops at the bound and says the list was not read in full', async () => {
    const { read, calls } = pages([100, 100, 100, 100, 100, 100, 100]);
    const result = await followPages(read, 5);
    expect(result).toMatchObject({ complete: false, failed: false });
    expect(result.items).toHaveLength(500);
    expect(calls).toHaveLength(5);
  });
  it('leaves a source out when its first page fails, and keeps a partial list when a later page fails', async () => {
    expect(await followPages(pages([10, 10], 0).read, 5)).toEqual({
      items: [],
      complete: false,
      failed: true,
    });
    const later = await followPages(pages([10, 10, 10], 1).read, 5);
    expect(later).toMatchObject({ complete: false, failed: false });
    expect(later.items).toHaveLength(10);
  });
  it('the loader follows pages for requests, drafts and quotes and tells the page when a list was partial', () => {
    const loader = readFileSync(resolve('apps/web/lib/move-loader.ts'), 'utf8');
    expect(loader.match(/followPages\(/g)).toHaveLength(3);
    expect(loader).toContain('partial ||= !');
    const page = readFileSync(resolve('apps/web/app/account/move/page.tsx'), 'utf8');
    expect(page).toContain('partial={loaded.partial}');
  });
  it('Your Move keeps the saved-request recovery notice that Home shows', () => {
    const page = readFileSync(resolve('apps/web/app/account/move/page.tsx'), 'utf8');
    expect(page).toContain('<PendingRequestNotice where="account" />');
  });
});
