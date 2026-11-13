import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterWorkItems, workCounts } from '../../apps/web/lib/work-items/view';

// L16: the count beside each Your Journeys link in the signed-in sidebar. It is the Requests page's own number for
// that journey (the same list, so the same workspace and role scoping), a zero is not drawn, an incomplete list says
// "N+", and the sidebar adds no second read of the list on a page that already reads it.
vi.mock('../../packages/auth/src/customer-workspaces.ts', () => ({
  customerWorkspacesEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-mission-drafts.ts', () => ({
  customerMissionDraftsEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-requests.ts', () => ({
  customerRequestsEnabled: () => false,
}));
vi.mock('../../packages/auth/src/customer-request-details.ts', () => ({
  customerRequestDetailsEnabled: () => false,
}));
vi.mock('../../packages/auth/src/customer-programmes.ts', () => ({
  customerProgrammesEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-service-requests.ts', () => ({
  customerServiceRequestsEnabled: () => false,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draft = (n: number, family: string) => ({
  id: id(n),
  version: 1,
  title: `Draft ${n}`,
  family,
  status: 'OPEN',
  requestId: null,
  updatedAt: '2026-11-02T10:00:00.000Z',
});

let calls = { workspaces: 0, drafts: 0, programmes: 0 };
let workspaces: { id: string; name: string; role: string }[] = [];
let draftsBy: Record<string, ReturnType<typeof draft>[]> = {};
let programmesBy: Record<string, { id: string; name: string; createdAt: string }[]> = {};
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    customerWorkspaces: {
      list: async () => {
        calls.workspaces++;
        return workspaces;
      },
    },
    customerMissionDrafts: {
      list: async (input: { workspaceId: string }) => {
        calls.drafts++;
        return { drafts: draftsBy[input.workspaceId] ?? [], nextAfter: null };
      },
    },
    customerProgrammes: {
      list: async (input: { workspaceId: string }) => {
        calls.programmes++;
        return { programmes: programmesBy[input.workspaceId] ?? [], nextAfter: null };
      },
    },
    customerRequests: { list: async () => ({ requests: [], nextAfter: null }) },
    customerRequestDetails: { detail: async () => ({ available: false }) },
    customerServiceRequests: { list: async () => ({ requests: [], nextAfter: null }) },
  }),
}));

beforeEach(() => {
  calls = { workspaces: 0, drafts: 0, programmes: 0 };
  workspaces = [
    { id: A, name: 'Atelier Rahman', role: 'owner' },
    { id: B, name: 'Dhaka Knit', role: 'member' },
  ];
  draftsBy = {
    [A]: [
      draft(1, 'SUPPLIERS_PRODUCTS'),
      draft(2, 'SUPPLIERS_PRODUCTS'),
      draft(3, 'BUYERS_PARTNERS'),
    ],
    [B]: [draft(4, 'SUPPLIERS_PRODUCTS'), draft(5, 'OTHER')],
    // A workspace the person is not in: never counted.
    '99999999-9999-4999-8999-999999999999': [draft(6, 'SUPPLIERS_PRODUCTS')],
  };
  programmesBy = {
    [A]: [{ id: id(50), name: 'Showcase', createdAt: '2026-11-01T10:00:00.000Z' }],
    [B]: [{ id: id(51), name: 'Hidden from a member', createdAt: '2026-11-01T10:00:00.000Z' }],
  };
});

const counts = async () => {
  const { loadWorkItems } = await import('../../apps/web/lib/work-items/load');
  const { journeyCountsOf } = await import('../../apps/web/lib/work-items/journey-counts');
  const list = await loadWorkItems('subject-1', 'https://issuer.example');
  return { list, counts: journeyCountsOf(list) };
};

describe('journey counts', () => {
  it('are the Requests page counts for Source, Organise and Sell, exactly', async () => {
    const { list, counts: c } = await counts();
    const requestsPage = workCounts(list);
    expect(String(c.source.n)).toBe(requestsPage.source);
    expect(String(c.organise.n)).toBe(requestsPage.organise);
    expect(String(c.sell.n)).toBe(requestsPage.sell);
    // 3 supplier drafts in the two workspaces (the outside one is not counted), 1 buyer draft, 1 programme.
    expect(c.source.n).toBe(3);
    expect(c.sell.n).toBe(1);
    expect(c.organise.n).toBe(1);
    // Unclassified work is on the Requests page under Other and in no journey.
    expect(filterWorkItems(list.items, 'other')).toHaveLength(1);
  });

  it('follow the person role: a member does not count programmes that only an owner or admin can open', async () => {
    const { counts: c } = await counts();
    expect(c.organise.n).toBe(1);
    workspaces = [{ id: B, name: 'Dhaka Knit', role: 'member' }];
    const { loadWorkItems } = await import('../../apps/web/lib/work-items/load');
    const { journeyCountsOf } = await import('../../apps/web/lib/work-items/journey-counts');
    const memberOnly = journeyCountsOf(await loadWorkItems('subject-2', 'https://issuer.example'));
    expect(memberOnly.organise.n).toBe(0);
    expect(memberOnly.source.n).toBe(1);
  });

  it('count nothing in a workspace the person is not in, even if a source returns it', async () => {
    workspaces = [{ id: B, name: 'Dhaka Knit', role: 'member' }];
    const { counts: c } = await counts();
    expect(c.source.n).toBe(1);
  });

  it('draw nothing for a zero and "N+" for a list that may be longer', async () => {
    const { journeyCountText, journeyCountWords } =
      await import('../../apps/web/lib/work-items/journey-counts');
    expect(journeyCountText({ n: 0, partial: false })).toBe('');
    expect(journeyCountText(undefined)).toBe('');
    expect(journeyCountText({ n: 4, partial: false })).toBe('4');
    expect(journeyCountText({ n: 12, partial: true })).toBe('12+');
    expect(journeyCountWords({ n: 1, partial: false })).toBe('1 piece of work');
    expect(journeyCountWords({ n: 12, partial: true })).toBe('12 or more pieces of work');
    expect(journeyCountWords({ n: 0, partial: false })).toBe('');
  });

  it('mark a count partial when a source could not be read in full', async () => {
    const { journeyCountsOf } = await import('../../apps/web/lib/work-items/journey-counts');
    const list = (await counts()).list;
    expect(journeyCountsOf(list).source.partial).toBe(false);
    expect(journeyCountsOf({ ...list, unreadable: ['drafts'] }).source.partial).toBe(true);
    expect(journeyCountsOf({ ...list, skippedWorkspaces: 2 }).sell.partial).toBe(true);
  });

  it('cost one read of the list, measured: 1 workspace list, 1 draft page each workspace, 1 programme page each admin workspace', async () => {
    await counts();
    expect(calls).toEqual({ workspaces: 1, drafts: 2, programmes: 1 });
  });

  it('share the Requests page read inside one request: the sidebar adds no read beyond it', () => {
    const load = readFileSync(
      new URL('../../apps/web/lib/work-items/load.ts', import.meta.url),
      'utf8',
    );
    expect(load).toContain("import { cache } from 'react'");
    expect(load).toMatch(/const loadOnce = cache\(/);
    // The sidebar asks through the same loader with the same switch the pages use, so the key matches.
    const server = readFileSync(
      new URL('../../apps/web/lib/work-items/journey-counts-server.ts', import.meta.url),
      'utf8',
    );
    expect(server).toContain("rooms: uxSwitchOn('CORRIDRA_UX_ROAD')");
    // The frame never awaits the counts: they are a promise the nav reads inside a Suspense.
    const shell = readFileSync(
      new URL('../../apps/web/components/customer-shell.tsx', import.meta.url),
      'utf8',
    );
    expect(shell).toContain('journeyCounts={journeys.length ? readJourneyCounts() : undefined}');
    expect(shell).not.toMatch(/await readJourneyCounts/);
  });
});
