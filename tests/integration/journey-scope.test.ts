import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  journeyReportScope,
  meetingRequests,
  reportsInJourney,
  requestsInJourney,
  requestsOutsideJourney,
} from '../../apps/web/lib/work-items/journey-scope';
import type { WorkItem } from '../../apps/web/lib/work-items/types';

// Journey modes, one journey at a time on Reports and Meetings (docs/revamp/specs/journey-modes.md 3.7). A report is
// left out only when its request is known to be in ANOTHER journey. A request no journey claims (its brief could not
// be read, or it is beyond the detail cap) and a request the list does not hold stay visible, and the list says it
// holds reports that are not sorted. Nothing is hidden silently.
const web = (path: string) => readFileSync(`apps/web/${path}`, 'utf8');
const renderToStaticMarkup = createRequire(resolve('apps/web/package.json'))('react-dom/server')
  .renderToStaticMarkup as (element: unknown) => string;
const item = (kind: WorkItem['kind'], id: string, family: WorkItem['family']): WorkItem => ({
  key: `${kind}:${id}`,
  kind,
  id,
  workspaceId: 'w',
  family,
  title: null,
  status: '',
  at: '2026-11-01T00:00:00.000Z',
  atKind: 'created',
  href: `/account/rooms/${id}`,
});
const list = {
  items: [
    item('request', 'r-source', 'SOURCE'),
    item('request', 'r-sell', 'SELL'),
    item('request', 'r-organise', 'ORGANISE'),
    item('request', 'r-unsorted', 'UNCLASSIFIED'),
    item('draft', 'd-sell', 'SELL'),
    item('programme', 'p-organise', 'ORGANISE'),
  ],
};
const report = (requestId: string) => ({ id: `report-${requestId}`, requestId });

describe('Reports in a journey: which requests are left out', () => {
  it('names only requests the list places in another journey, never one no journey claims', () => {
    expect(requestsOutsideJourney(list, 'source')).toEqual(['r-sell', 'r-organise']);
    expect(requestsOutsideJourney(list, 'sell')).toEqual(['r-source', 'r-organise']);
    expect(requestsOutsideJourney(list, 'organise')).toEqual(['r-source', 'r-sell']);
    expect(requestsInJourney(list, 'source')).toEqual(['r-source']);
    expect(requestsOutsideJourney({ items: [] }, 'source')).toEqual([]);
  });

  it('keeps the reports of requests beyond the detail cap, and says they are not sorted', () => {
    // The list reads the brief of the newest 30 requests only; every later one is listed with no journey.
    const workDetailCap = 30;
    expect(web('lib/work-items/load.ts')).toContain('export const workDetailCap = 30;');
    const many = {
      items: Array.from({ length: workDetailCap + 5 }, (_, n) =>
        item('request', `r-${n}`, n < workDetailCap ? (n % 2 ? 'SELL' : 'SOURCE') : 'UNCLASSIFIED'),
      ),
    };
    const scope = journeyReportScope(many, 'source');
    const beyond = many.items.slice(workDetailCap).map((request) => request.id);
    expect(beyond).toHaveLength(5);
    for (const id of beyond) expect(scope.outside).not.toContain(id);
    const result = reportsInJourney(
      many.items.map((request) => report(request.id)),
      scope,
    );
    const shown = result.shown.map((r) => r.requestId);
    for (const id of beyond) expect(shown).toContain(id);
    expect(shown).toContain('r-0');
    expect(shown).not.toContain('r-1');
    expect(result.unsorted).toBe(true);
  });

  it('keeps every report when the briefs could not be read, and says they are not sorted', () => {
    // A failed detail read leaves each request listed with no journey.
    const failed = {
      items: ['a', 'b', 'c'].map((id) => item('request', id, 'UNCLASSIFIED')),
    };
    const scope = journeyReportScope(failed, 'sell');
    expect(scope).toEqual({ outside: [], inJourney: [] });
    const result = reportsInJourney(['a', 'b', 'c'].map(report), scope);
    expect(result.shown).toHaveLength(3);
    expect(result.unsorted).toBe(true);
  });

  it('keeps a report whose request the list does not hold, and says so', () => {
    const result = reportsInJourney([report('r-source'), report('not-listed')], {
      outside: ['r-sell'],
      inJourney: ['r-source'],
    });
    expect(result.shown.map((r) => r.requestId)).toEqual(['r-source', 'not-listed']);
    expect(result.unsorted).toBe(true);
  });

  it('says nothing about sorting when every shown report is in the journey, or no journey is chosen', () => {
    const scope = journeyReportScope(list, 'source');
    expect(reportsInJourney([report('r-source'), report('r-sell')], scope)).toEqual({
      shown: [report('r-source')],
      unsorted: false,
    });
    expect(reportsInJourney([report('r-sell')], undefined)).toEqual({
      shown: [report('r-sell')],
      unsorted: false,
    });
  });
});

// The Delivered list itself, drawn with a delivered report for each request.
let delivered: { id: string; title: string; requestId: string; publishedAt: null; href: string }[];
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    customerDeliveredReports: { list: async () => delivered },
  }),
}));
describe('Reports in a journey: the Delivered list', () => {
  const draw = async (props: Record<string, unknown>) => {
    const { DeliveredReports } = await import('../../apps/web/app/account/delivered-reports');
    return renderToStaticMarkup(
      await DeliveredReports({ subject: 's', issuer: 'i', showEmpty: true, ...props } as never),
    );
  };
  const publish = (...requests: string[]) => {
    delivered = requests.map((requestId) => ({
      id: `report-${requestId}`,
      title: `Report for ${requestId}`,
      requestId,
      publishedAt: null,
      href: `/account/rooms/${requestId}`,
    }));
  };

  it('hides a report in another journey, and shows it in its own journey and in Everything', async () => {
    publish('r-source', 'r-sell');
    const everything = await draw({});
    expect(everything).toContain('Report for r-source');
    expect(everything).toContain('Report for r-sell');
    const sourcing = await draw({ scope: journeyReportScope(list, 'source'), journey: 'Sourcing' });
    expect(sourcing).toContain('Report for r-source');
    expect(sourcing).not.toContain('Report for r-sell');
    expect(sourcing).not.toContain('not sorted by journey');
    const selling = await draw({ scope: journeyReportScope(list, 'sell'), journey: 'Selling' });
    expect(selling).toContain('Report for r-sell');
    expect(selling).not.toContain('Report for r-source');
  });

  it('keeps a report no journey claims in every journey, under one quiet line', async () => {
    publish('r-source', 'r-unsorted');
    for (const [mode, name] of [
      ['source', 'Sourcing'],
      ['sell', 'Selling'],
      ['organise', 'Organising'],
    ] as const) {
      const html = await draw({ scope: journeyReportScope(list, mode), journey: name });
      expect(html).toContain('Report for r-unsorted');
      expect(html).toContain(
        '<p class="ux-journey-note" lang="en">Some reports here are from requests that are not sorted by journey.</p>',
      );
    }
    expect(await draw({})).not.toContain('not sorted by journey');
  });

  it('says the journey has no reports only when every report is known to be in another journey', async () => {
    publish('r-sell');
    const html = await draw({ scope: journeyReportScope(list, 'source'), journey: 'Sourcing' });
    expect(html).toContain('No reports have been delivered in Sourcing yet.');
    expect(html).not.toContain('Report for r-sell');
  });

  it('the deliveries waiting to be saved follow the same rule', () => {
    const assigned = web('app/account/assigned-missions.tsx');
    expect(assigned).toContain(
      'const { shown, unsorted } = reportsInJourney(data?.assignments ?? [], scope);',
    );
    expect(assigned).toContain('{unsorted ? <ReportsNotSorted /> : null}');
    expect(assigned).toContain('No report delivered here is in {journey}.');
  });

  it('the page reads the scope from the list the sidebar already reads, only on Reports in a journey', () => {
    const reader = web('lib/work-items/journey-scope-server.ts');
    expect(reader).toContain('const identity = await customerIdentity();');
    expect(reader).toMatch(
      /loadWorkItems\(identity\.subject, identity\.issuer, \{\s*rooms: uxSwitchOn\('CORRIDRA_UX_ROAD'\),\s*\}\)/,
    );
    expect(reader).toMatch(/catch \{\s*return nothing;/);
    const page = web('app/account/page.tsx');
    expect(page).toMatch(
      /scoped && view === reportsView \? await readJourneyReportScope\(scoped\) : undefined/,
    );
    expect(page).toMatch(
      /delivered=\{[^]*?<JourneyScoped mode=\{scoped\}>\s*\{requestIssuer && \(/,
    );
    expect(page).toContain('journey={!!scoped}');
    expect(web('components/ux/journey-scoped.tsx')).toContain('if (!mode) return children;');
    const tabs = web('app/account/reports-tabs.tsx');
    for (const [what, panel] of [
      ['Saved missions', 'saved'],
      ['Missions shared with you', 'shared'],
      ['Members’ reports', 'members'],
    ])
      expect(tabs).toContain(`panel: journey ? notSorted('${what}', ${panel}) : ${panel},`);
    const note = web('components/ux/journey-not-sorted.tsx');
    expect(note).toContain('{what} are not sorted by journey.');
    expect(note).not.toContain('next/navigation');
  });
});

describe('Meetings in a journey', () => {
  it('shows only the requests of the chosen journey, and every request when none is chosen', () => {
    const ids = (mode: Parameters<typeof meetingRequests>[1]) =>
      meetingRequests(list.items, mode).map((request) => request.id);
    expect(ids(null)).toEqual(['r-source', 'r-sell', 'r-organise', 'r-unsorted']);
    expect(ids('source')).toEqual(['r-source']);
    expect(ids('sell')).toEqual(['r-sell']);
    expect(ids('organise')).toEqual(['r-organise']);
  });
  it('is what the Meetings page uses, with the journey it was given', () => {
    const page = web('app/account/meetings/page.tsx');
    expect(page).toContain('const requests = meetingRequests(list.items, scoped);');
    expect(page).toContain("const scoped = mode && mode !== 'all' ? mode : null;");
    expect(page).not.toMatch(/list\.items\.filter\(/);
  });
});

describe('Home in a journey', () => {
  it('says which journey is shown, with the one way back to Everything', () => {
    const page = web('app/account/move/page.tsx');
    expect(page).toMatch(/<JourneyScoped mode=\{mode \? journey : null\}>\s*<MoveView/);
    const note = web('components/ux/journey-note.tsx');
    expect(note).toMatch(/Showing \{journeyModeWords\[mode\]\}\. <ShowEverything \/>/);
  });
});
