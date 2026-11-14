import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as allTools from '../../apps/web/lib/all-tools';
import { customerGroupLinks } from '../../apps/web/lib/ux/customer-navigation';
import type { WorkList } from '../../apps/web/lib/work-items/types';

// UI/UX.v3 audit, screens batch A (Home empty state, Requests and Workspaces, All Tools with search and group chips).
// Presentation only: every tool, link, id, route and payload stays; the finder adds a way to narrow the list.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/account/all-tools',
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const app = join(resolve('apps/web'), 'app');
const read = (path: string) => readFileSync(join(app, path), 'utf8');

const { tools, toolGroups } = allTools;
type Finder = {
  filterTools: (
    list: readonly allTools.Tool[],
    options: { query?: string; group?: allTools.ToolGroup },
  ) => allTools.Tool[];
  toolGroupSlug: (group: allTools.ToolGroup) => string;
  parseToolGroup: (value: string | undefined) => allTools.ToolGroup | undefined;
};
const finder = allTools as unknown as Finder;

describe('All Tools: nothing is removed', () => {
  it('still lists the sixteen tools, each with its own address, in the six groups', () => {
    expect(tools).toHaveLength(16);
    expect(new Set(tools.map((tool) => tool.href)).size).toBe(16);
    expect([...toolGroups]).toEqual([
      'Start',
      'Your Move',
      'Missions',
      'Library',
      'Companies',
      'More',
    ]);
  });
});

describe('All Tools: the finder rules', () => {
  it('keeps every tool, in order, when nothing is searched or chosen', () => {
    expect(finder.filterTools(tools, {})).toEqual([...tools]);
    expect(finder.filterTools(tools, { query: '   ' })).toEqual([...tools]);
  });
  it('reaches every one of the sixteen tools by searching its own name', () => {
    for (const tool of tools)
      expect(finder.filterTools(tools, { query: tool.label })).toContain(tool);
  });
  it('reaches every tool through its group chip, and the chips together cover all sixteen', () => {
    const seen = new Set<string>();
    for (const group of toolGroups) {
      const inGroup = finder.filterTools(tools, { group });
      expect(inGroup.length).toBeGreaterThan(0);
      for (const tool of inGroup) {
        expect(tool.group).toBe(group);
        seen.add(tool.href);
      }
    }
    expect(seen.size).toBe(16);
  });
  it('matches words in the name or the line, in any case, and every word must match', () => {
    const billing = finder.filterTools(tools, { query: 'BILLING' });
    expect(billing.map((tool) => tool.href)).toContain('/account/billing');
    for (const tool of billing)
      expect(`${tool.label} ${tool.line} ${allTools.groupLabel(tool.group)}`).toMatch(/billing/i);
    const both = finder.filterTools(tools, { query: 'plan billing' });
    expect(both.map((tool) => tool.href)).toEqual(['/account/billing']);
    expect(finder.filterTools(tools, { query: 'billing zzzz' })).toEqual([]);
  });
  it('finds a group by the word a customer reads (Requests, not Missions)', () => {
    const found = finder.filterTools(tools, { query: 'requests' });
    for (const tool of tools.filter((item) => item.group === 'Missions'))
      expect(found).toContain(tool);
  });
  it('combines a search with a group', () => {
    const both = finder.filterTools(tools, { query: 'delegation', group: 'Missions' });
    expect(both.length).toBeGreaterThan(0);
    for (const tool of both) expect(tool.group).toBe('Missions');
  });
  it('reads a group word from the address and ignores anything else', () => {
    for (const group of toolGroups)
      expect(finder.parseToolGroup(finder.toolGroupSlug(group))).toBe(group);
    expect(finder.toolGroupSlug('Your Move')).toBe('your-move');
    for (const word of ['all', '', undefined, 'nope', 'Missions '])
      expect(finder.parseToolGroup(word)).toBeUndefined();
  });
});

describe('All Tools: the finder on the page', () => {
  const mount = async (props: { initialQuery?: string; initialGroup?: string } = {}) => {
    const { AllToolsFinder } = await load('app/account/all-tools/all-tools-finder.tsx');
    return render(
      createElement(AllToolsFinder, {
        tools: tools.map(({ href, label, line, group }) => ({ href, label, line, group })),
        initialQuery: '',
        initialGroup: 'all',
        ...props,
      }),
    );
  };
  const links = (html: string) => [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

  it('shows all sixteen tools with their addresses before anything is typed', async () => {
    const html = await mount();
    expect(links(html)).toEqual(tools.map((tool) => tool.href));
    expect(html).not.toContain('Showing');
  });
  it('is a search form that works without a script: a GET to this page with q and group', async () => {
    const html = await mount();
    const form = html.match(/<form[^>]*>/)![0];
    expect(form).toContain('role="search"');
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/account/all-tools"');
    expect(html).toMatch(
      /<input[^>]*name="q"[^>]*type="search"|<input[^>]*type="search"[^>]*name="q"/,
    );
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>\s*Find a tool\s*<\/label>/);
    expect(html).toContain('<noscript><button type="submit"');
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(7);
    for (const radio of radios) expect(radio).toContain('name="group"');
    expect(radios.map((radio) => /value="([^"]+)"/.exec(radio)![1])).toEqual([
      'all',
      'start',
      'your-move',
      'missions',
      'library',
      'companies',
      'more',
    ]);
  });
  it('names each chip with the word a customer reads and the number of tools in it', async () => {
    const html = await mount();
    expect(html).toContain('All');
    expect(html).toMatch(/Requests<span class="ux-segment-count"> 4<\/span>/);
    expect(html).toMatch(/All<span class="ux-segment-count"> 16<\/span>/);
  });
  it('narrows to a search from the address and says how many of the sixteen are shown', async () => {
    const html = await mount({ initialQuery: 'billing' });
    expect(links(html)).toEqual(['/account/billing']);
    expect(html).toContain('Showing 1 of 16 tools.');
    expect(html).toContain('Clear Search');
  });
  it('narrows to a group from the address, and an unknown group means all', async () => {
    const group = await mount({ initialGroup: 'missions' });
    expect(links(group)).toEqual(
      tools.filter((tool) => tool.group === 'Missions').map((tool) => tool.href),
    );
    expect(await mount({ initialGroup: 'nope' })).toEqual(await mount());
  });
  it('says so, and offers the way back, when nothing matches', async () => {
    const html = await mount({ initialQuery: 'zzzz' });
    expect(links(html)).toEqual([]);
    expect(html).toMatch(/No tool matches\s*“zzzz”/);
    expect(html).toContain('Clear Search');
    expect(html).toContain('role="search"');
  });
  it('holds the chosen results open on a phone and keeps the group names as headings', async () => {
    const html = await mount({ initialGroup: 'library' });
    expect(html).toContain('Library (1)');
    expect(html).toMatch(/<details[^>]*data-phone-fold/);
  });
  it('the page reads ?q and ?group and uses the page frame', () => {
    const source = read('account/all-tools/page.tsx');
    expect(source).toContain('AllToolsFinder');
    expect(source).toContain('searchParams');
    expect(source).toContain('frame={{ helper: allToolsHelper }}');
    expect(source).toContain("uxSwitchOn('CORRIDRA_UX_NAV')");
  });
});

describe('Sidebar groups keep their exact icons (owner, 14 November 2026)', () => {
  it('Programmes and Registrations keep their key, words, address and icon', () => {
    expect(customerGroupLinks({ programmes: true, registrations: true })).toEqual([
      {
        key: 'programmes',
        label: 'Programmes',
        href: '/account/delegations/organise',
        icon: 'trip',
      },
      {
        key: 'registrations',
        label: 'Registrations',
        href: '/account/delegations',
        icon: 'people',
      },
    ]);
  });
});

describe('Home empty state', () => {
  const list = (extra: Partial<WorkList> = {}): WorkList => ({
    items: [],
    unreadable: [],
    partial: false,
    skippedWorkspaces: 0,
    workspaces: [],
    ...extra,
  });
  it('is one quiet line with the way on, and the section keeps its name for assistive technology', async () => {
    const { HomeWorkView } = await load('app/account/home-work.tsx');
    const html = render(createElement(HomeWorkView, { list: list() }));
    expect(html).toContain('home-work-empty');
    expect(html).toMatch(/<h2[^>]*class="sr-only"[^>]*>Active work<\/h2>/);
    expect(html).toContain('You have no work here yet.');
    expect(html).toContain('href="/account?view=work"');
    expect(html).toContain('See all your work');
    expect(html.match(/<p/g)).toHaveLength(1);
  });
  it('keeps the visible Active work heading when there is work or a list that could not be read', async () => {
    const { HomeWorkView } = await load('app/account/home-work.tsx');
    const unread = render(
      createElement(HomeWorkView, { list: list({ unreadable: ['requests'] }) }),
    );
    expect(unread).toMatch(/<h2 id="home-work-title">Active work<\/h2>/);
    expect(unread).toContain('We could not check everything just now.');
  });
  it('Home and Requests use the page frame with one helper line each, and no second primary action', () => {
    const source = read('account/page.tsx');
    expect(source).toMatch(/view === 'home'\s*\?\s*\{ helper: homeHelper \}/);
    expect(source).toMatch(/view === 'work'\s*\?\s*\{ helper: requestsHelper \}/);
    const copy = read('account/frame-copy.ts');
    for (const line of [
      /homeHelper = '([^']+)'/,
      /requestsHelper = '([^']+)'/,
      /allToolsHelper = '([^']+)'/,
    ]) {
      const words = line.exec(copy)![1]!;
      expect(words).not.toMatch(/[–—]/);
      expect(words.length).toBeLessThan(80);
    }
  });
});

describe('Requests and Workspaces: no duplicate headings', () => {
  it('the Requests list heading is for assistive technology only once the page frame names it', async () => {
    const { WorkListView } = await load('app/account/work-list.tsx');
    const list: WorkList = {
      items: [],
      unreadable: [],
      partial: false,
      skippedWorkspaces: 0,
      workspaces: [],
    };
    const framed = render(createElement(WorkListView, { list, filter: 'all', framed: true }));
    expect(framed).toMatch(/<h2[^>]*class="sr-only"[^>]*>Your work<\/h2>/);
    const alone = render(createElement(WorkListView, { list, filter: 'all' }));
    expect(alone).toMatch(/<h2 id="work-list-title">Your work<\/h2>/);
  });
  it('the Workspaces card heading follows the same rule, and the page passes framed to both', async () => {
    const { CustomerWorkspaces } = await load('app/account/customer-workspaces.tsx');
    const props = { subject: 's', issuer: 'https://x.test/auth' };
    const framed = render(createElement(CustomerWorkspaces, { ...props, framed: true }));
    expect(framed).toMatch(/<h2[^>]*class="sr-only"[^>]*>Workspaces<\/h2>/);
    expect(render(createElement(CustomerWorkspaces, props))).toMatch(/<h2>Workspaces<\/h2>/);
    const source = read('account/page.tsx');
    expect(source.match(/\bframed\b/g)).toHaveLength(2);
  });
});
