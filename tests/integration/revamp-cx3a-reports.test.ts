import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// CX PR 3a, the Reports page (docs/revamp/specs/customer-experience.md): sub-tabs Delivered, Saved Missions and
// Shared With Me on the shared sub-tabs, kept by ?tab=, with every old #id still landing in the right panel.
// Case ids: CX-02 (action parity: nothing is removed from any panel) and CX-04 (tabs keep ?tab=).
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) =>
    createElement('a', { href }, children as never),
}));
vi.doMock(web.resolve('next/navigation'), () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams('view=results'),
}));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const panels = (extra: Record<string, unknown> = {}) => ({
  delivered: createElement('h2', { id: 'delivered-reports-heading' }, 'Reports for your requests'),
  saved: createElement('div', { id: 'saved-commercial-missions' }, 'Saved missions'),
  shared: createElement('section', { 'aria-label': 'Shared missions' }, 'Shared missions'),
  ...extra,
});

describe('CX-04 the Reports tabs', () => {
  it('shows Delivered, Saved Missions and Shared With Me, the first chosen, every panel in the page', async () => {
    const { ReportsTabs } = await load('app/account/reports-tabs');
    const html = render(createElement(ReportsTabs, panels()));
    expect(html).toContain('role="tablist"');
    for (const name of ['Delivered', 'Saved Missions', 'Shared With Me'])
      expect(html).toMatch(new RegExp(`role="tab"[^>]*>${name}</button>`));
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Delivered</);
  });

  it('holds each old element inside its own panel, so an old #id opens the right tab', async () => {
    const { ReportsTabs } = await load('app/account/reports-tabs');
    const html = render(createElement(ReportsTabs, panels()));
    const panel = (key: string) =>
      html.slice(
        html.indexOf(`data-subtab="${key}"`),
        html.indexOf('</div></div>', html.indexOf(`data-subtab="${key}"`)),
      );
    expect(panel('delivered')).toContain('id="delivered-reports-heading"');
    expect(panel('saved')).toContain('id="saved-commercial-missions"');
    expect(panel('shared')).toContain('Shared missions');
  });

  it('shows only the tabs that have something, and no tab list for a single one', async () => {
    const { ReportsTabs } = await load('app/account/reports-tabs');
    const two = render(createElement(ReportsTabs, panels({ delivered: undefined })));
    expect(two.match(/role="tab"/g)).toHaveLength(2);
    const one = render(
      createElement(ReportsTabs, { shared: createElement('p', null, 'Only shared') }),
    );
    expect(one).not.toContain('role="tablist"');
    expect(one).toContain('Only shared');
    expect(render(createElement(ReportsTabs, {}))).toBe('');
  });
});

describe('the Reports page uses the tabs and keeps every old id', () => {
  // Codex review of PR 313: "My shared missions" and the invitation links go to #customer-missions, so that
  // old address opens Shared With Me, where the invitation input lives, never Delivered.
  it('sends #customer-missions to Shared With Me', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(resolve('apps/web/app/account/reports-tabs.tsx'), 'utf8');
    const tab = (id: string) => source.slice(source.indexOf(`id: '${id}'`)).split('});')[0]!;
    expect(tab('shared')).toContain("aliases: ['customer-missions']");
    expect(tab('delivered')).not.toContain('customer-missions');
    for (const caller of ['saved-missions.tsx', 'missions/saved-commercial-report.tsx'])
      expect(readFileSync(resolve(`apps/web/app/account/${caller}`), 'utf8')).toContain(
        'href="/account#customer-missions"',
      );
  });
  it('wraps the three groups in ReportsTabs and keeps the results and customer-missions ids', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(resolve('apps/web/app/account/page.tsx'), 'utf8');
    const reports = page.slice(page.indexOf("view === 'results'"), page.indexOf("view === 'more'"));
    expect(reports).toContain('<ReportsTabs');
    for (const needle of [
      'id="results"',
      'id="customer-missions"',
      'id="saved-commercial-missions"',
      '<DeliveredReports',
      '<AssignedMissions',
      '<SavedMissions',
      '<CustomerMissions',
      'href="/account/companies"',
    ])
      expect(reports).toContain(needle);
  });
});
