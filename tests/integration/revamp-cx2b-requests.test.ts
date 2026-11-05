import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorkItem, WorkList } from '../../apps/web/lib/work-items/types';

// CX PR 2b, the Requests page (docs/revamp/specs/customer-experience.md): three tabs kept by ?tab= (Requests,
// Workspaces, Saved) on the shared sub-tabs, with every old #id still landing; on the Requests tab a segmented
// filter that applies at once (no Show button) and rows that are each one link. Case ids: CX-04, CX-02.
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
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams('view=work'),
}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const W = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n: number, extra: Partial<WorkItem> = {}): WorkItem => ({
  key: `request:${id(n)}`,
  kind: 'request',
  id: id(n),
  workspaceId: W,
  family: 'SELL',
  title: `Request ${n}`,
  status: 'MEETINGS',
  at: '2026-11-04T10:00:00.000Z',
  atKind: 'updated',
  href: `/account/requests/${id(n)}`,
  ...extra,
});
const list = (items: WorkItem[]): WorkList => ({
  items,
  unreadable: [],
  partial: false,
  skippedWorkspaces: 0,
  workspaces: [{ id: W, name: 'Atelier Rahman' }],
});
const six = [
  item(1),
  item(2, { family: 'SELL' }),
  item(3, { family: 'SOURCE', kind: 'draft', status: 'OPEN' }),
  item(4, { family: 'ORGANISE', kind: 'programme', status: 'ACTIVE' }),
  item(5, { family: 'UNCLASSIFIED' }),
  item(6, { family: 'UNCLASSIFIED' }),
];
const view = async (items: WorkItem[], filter = 'all') => {
  const { WorkListView } = await load('app/account/work-list');
  return render(createElement(WorkListView, { list: list(items), filter }));
};

describe('CX-04 the Requests tab filter', () => {
  it('is a radio group of five segments with counts and has no Show button', async () => {
    const html = await view(six);
    const live = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    expect(html).toContain('class="ux-segments"');
    expect(live.match(/<input[^>]*type="radio"/g)).toHaveLength(5);
    expect(html).toMatch(/All<span class="ux-segment-count"> 6<\/span>/);
    expect(live).not.toContain('work-apply');
    expect(live).not.toMatch(/<button[^>]*type="submit"[^>]*>Show<\/button>/);
  });
  it('still works without a script: a plain form with the same choices sits in noscript', async () => {
    const html = await view(six);
    expect(html).toContain('<noscript>');
    expect(html).toMatch(/<noscript>.*name="work".*<\/noscript>/s);
  });
  it('checks the segment that is chosen', async () => {
    const html = await view(six, 'source');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="source"/);
  });
});

describe('CX-04 the Requests tab rows', () => {
  it('make each row exactly one link, to where the old Open link went', async () => {
    const html = await view(six);
    const rows = html.split('<li class="ux-row"').slice(1);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.split('</li>')[0].match(/<a /g)).toHaveLength(1);
    for (const one of six) expect(html).toContain(`href="${one.href}"`);
    expect(html).not.toContain('work-open');
  });
  it('keep the stored title, the kind, the workspace, the status words and the date', async () => {
    const html = await view([item(1)]);
    expect(html).toContain('Request 1');
    expect(html).toContain('Atelier Rahman');
    expect(html).toContain('Updated');
    expect(html).toContain('Status');
  });
});

describe('CX-04 the three tabs', () => {
  const panels = (extra: Record<string, unknown> = {}) => ({
    requests: createElement('p', { id: 'work-list' }, 'Your work'),
    workspaces: createElement('div', { id: 'customer-workspaces' }, 'Workspaces'),
    saved: createElement('div', { id: 'customer-requests' }, 'Saved requests'),
    ...extra,
  });
  it('shows Requests, Workspaces and Saved on the shared sub-tabs, the first chosen, every panel in the page', async () => {
    const { RequestsTabs } = await load('app/account/requests-tabs');
    const html = render(createElement(RequestsTabs, panels()));
    expect(html).toContain('role="tablist"');
    for (const name of ['Requests', 'Workspaces', 'Saved'])
      expect(html).toMatch(new RegExp(`role="tab"[^>]*>${name}</button>`));
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Requests</);
    expect(html).toContain('id="customer-workspaces"');
    expect(html).toContain('id="customer-requests"');
  });
  it('holds each old element inside its own panel, so an old #id opens the right tab', async () => {
    const { RequestsTabs } = await load('app/account/requests-tabs');
    const html = render(createElement(RequestsTabs, panels()));
    const panel = (key: string) =>
      html.slice(
        html.indexOf(`data-subtab="${key}"`),
        html.indexOf('</div></div>', html.indexOf(`data-subtab="${key}"`)),
      );
    expect(panel('workspaces')).toContain('id="customer-workspaces"');
    expect(panel('saved')).toContain('id="customer-requests"');
    expect(panel('requests')).toContain('id="work-list"');
  });
  it('shows only the tabs that have something, and no tab list for a single one', async () => {
    const { RequestsTabs } = await load('app/account/requests-tabs');
    const two = render(createElement(RequestsTabs, panels({ saved: undefined })));
    expect(two.match(/role="tab"/g)).toHaveLength(2);
    const one = render(
      createElement(RequestsTabs, { requests: createElement('p', null, 'Only this') }),
    );
    expect(one).not.toContain('role="tablist"');
    expect(one).toContain('Only this');
  });
});
