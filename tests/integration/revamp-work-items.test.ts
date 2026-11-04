import { beforeEach, describe, expect, it, vi } from 'vitest';

// Revamp Wave 2, spec docs/revamp/specs/work-items.md. One read-only adapter turns the customer's
// existing records into one list of work items. Each case id below is a case in that spec.
const on = {
  workspaces: true,
  drafts: true,
  requests: true,
  details: true,
  programmes: true,
  services: true,
};
vi.mock('../../packages/auth/src/customer-workspaces.ts', () => ({
  customerWorkspacesEnabled: () => on.workspaces,
}));
vi.mock('../../packages/auth/src/customer-mission-drafts.ts', () => ({
  customerMissionDraftsEnabled: () => on.drafts,
}));
vi.mock('../../packages/auth/src/customer-requests.ts', () => ({
  customerRequestsEnabled: () => on.requests,
}));
vi.mock('../../packages/auth/src/customer-request-details.ts', () => ({
  customerRequestDetailsEnabled: () => on.details,
}));
vi.mock('../../packages/auth/src/customer-programmes.ts', () => ({
  customerProgrammesEnabled: () => on.programmes,
}));
vi.mock('../../packages/auth/src/customer-service-requests.ts', () => ({
  customerServiceRequestsEnabled: () => on.services,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OUTSIDE = '99999999-9999-4999-8999-999999999999';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { id: A, name: 'Atelier Rahman', role: 'owner' as const };
const member = { id: B, name: 'Dhaka Knit', role: 'member' as const };
const fail = () => Promise.reject(new Error('database unavailable'));

type Services = Record<string, unknown> & { ready: Promise<void> };
let services: Services | null = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));

const draft = (n: number, family: string, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  version: 1,
  title: `Draft ${n}`,
  family,
  status: 'OPEN',
  requestId: null,
  updatedAt: `2026-11-0${(n % 9) + 1}T10:00:00.000Z`,
  ...extra,
});
const requestRow = (n: number, workspaceId = A, extra: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  workspaceId,
  createdAt: `2026-10-0${(n % 9) + 1}T09:00:00.000Z`,
  available: true,
  progress: { status: 'ACTIVE', receivedAt: '2026-10-01T09:00:00.000Z', replies: [] },
  ...extra,
});
const detailFor = (objective: string) => ({ available: true, original: { objective } });

function healthy(): Services {
  return {
    ready: Promise.resolve(),
    customerWorkspaces: { list: async () => [owner, member] },
    customerMissionDrafts: { list: async () => ({ drafts: [], nextAfter: null }) },
    customerRequests: { list: async () => ({ requests: [], nextAfter: null }) },
    customerRequestDetails: { detail: async () => detailFor('Something else') },
    customerProgrammes: { list: async () => ({ programmes: [], nextAfter: null }) },
    customerServiceRequests: { list: async () => ({ requests: [], nextAfter: null }) },
  };
}
const patch = (overrides: Record<string, unknown>) => {
  services = { ...healthy(), ...overrides };
};
const loader = async () => (await import('../../apps/web/lib/work-items/load')).loadWorkItems;
const run = async (options?: { rooms?: boolean }) =>
  (await loader())('subject-1', 'https://issuer.example', options);

beforeEach(() => {
  Object.assign(on, {
    workspaces: true,
    drafts: true,
    requests: true,
    details: true,
    programmes: true,
    services: true,
  });
  services = healthy();
});

describe('W-01 draft families', () => {
  it('maps the stored draft family exactly', async () => {
    patch({
      customerMissionDrafts: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          drafts:
            workspaceId === A
              ? [
                  draft(1, 'BUYERS_PARTNERS'),
                  draft(2, 'SUPPLIERS_PRODUCTS'),
                  draft(3, 'DELEGATION'),
                  draft(4, 'OTHER'),
                ]
              : [],
          nextAfter: null,
        }),
      },
    });
    const { items } = await run();
    const family = (n: number) => items.find((i) => i.id === id(n))?.family;
    expect([family(1), family(2), family(3), family(4)]).toEqual([
      'SELL',
      'SOURCE',
      'ORGANISE',
      'UNCLASSIFIED',
    ]);
    expect(items.every((i) => i.kind === 'draft')).toBe(true);
  });
});

describe('W-02 and W-03 request objectives', () => {
  const objectives: [string, string][] = [
    ['Sell in a new market', 'SELL'],
    ['Find customers or distributors', 'SELL'],
    ['Source suppliers', 'SOURCE'],
    ['Run a multi-company mission', 'ORGANISE'],
    ['Make an upcoming business trip more productive', 'UNCLASSIFIED'],
    ['Something else', 'UNCLASSIFIED'],
  ];
  it.each(objectives)('W-02 %s is %s', async (objective, expected) => {
    patch({
      customerRequests: { list: async () => ({ requests: [requestRow(1)], nextAfter: null }) },
      customerRequestDetails: { detail: async () => detailFor(objective) },
    });
    const { items } = await run();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'request', family: expected });
  });

  it('W-03 computes the map from the table, so a two-family objective is UNCLASSIFIED', async () => {
    const { classifyObjective } = await import('../../apps/web/lib/work-items/classify');
    const table = {
      BUYERS_PARTNERS: ['Sell in a new market', 'Source suppliers'],
      SUPPLIERS_PRODUCTS: ['Source suppliers'],
      DELEGATION: [],
      OTHER: [],
    };
    expect(classifyObjective('Sell in a new market', table)).toBe('SELL');
    expect(classifyObjective('Source suppliers', table)).toBe('UNCLASSIFIED');
    expect(classifyObjective('Not an objective', table)).toBe('UNCLASSIFIED');
    // The real table is the default and gives the documented result today.
    expect(classifyObjective('Source suppliers')).toBe('SOURCE');
  });

  it('W-04 a detail that cannot be read is UNCLASSIFIED, listed, and not unreadable for that alone', async () => {
    patch({
      customerRequests: { list: async () => ({ requests: [requestRow(1)], nextAfter: null }) },
      customerRequestDetails: { detail: fail },
    });
    const list = await run();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.family).toBe('UNCLASSIFIED');
    expect(list.unreadable).toEqual([]);
  });

  it('W-04 a request is UNCLASSIFIED without a read when the detail module is off', async () => {
    on.details = false;
    const detail = vi.fn(async () => detailFor('Sell in a new market'));
    patch({
      customerRequests: { list: async () => ({ requests: [requestRow(1)], nextAfter: null }) },
      customerRequestDetails: { detail },
    });
    const list = await run();
    expect(list.items[0]!.family).toBe('UNCLASSIFIED');
    expect(detail).not.toHaveBeenCalled();
  });
});

describe('W-05 and W-14 other kinds and stored text', () => {
  it('W-05 programmes are ORGANISE and service requests UNCLASSIFIED whatever their words say', async () => {
    patch({
      customerProgrammes: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          programmes:
            workspaceId === A
              ? [
                  {
                    id: id(10),
                    workspaceId: A,
                    name: 'Sell: source delegation',
                    reportingPurpose: 'Source buyers',
                    createdAt: '2026-10-05T00:00:00.000Z',
                  },
                ]
              : [],
          nextAfter: null,
        }),
      },
      customerServiceRequests: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          requests:
            workspaceId === A
              ? [
                  {
                    id: id(20),
                    workspaceId: A,
                    contextKind: 'request',
                    contextRef: id(101),
                    contextLabel: 'Delegation to Source',
                    serviceKey: 'x',
                    serviceTitle: 'Sell more, source more, organise a delegation',
                    status: 'requested',
                    needVersion: 1,
                    region: 'EU',
                    createdAt: '2026-10-06T00:00:00.000Z',
                    updatedAt: '2026-10-07T00:00:00.000Z',
                  },
                ]
              : [],
          nextAfter: null,
        }),
      },
    });
    const { items } = await run();
    expect(items.find((i) => i.kind === 'programme')?.family).toBe('ORGANISE');
    expect(items.find((i) => i.kind === 'service_request')?.family).toBe('UNCLASSIFIED');
  });

  it('W-14 passes title and status through as stored', async () => {
    patch({
      customerMissionDrafts: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          drafts: workspaceId === A ? [draft(1, 'OTHER', { title: '广州家具采购 কারখানা' })] : [],
          nextAfter: null,
        }),
      },
      customerServiceRequests: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          requests:
            workspaceId === A
              ? [
                  {
                    id: id(20),
                    workspaceId: A,
                    contextKind: 'company',
                    contextRef: 'c',
                    contextLabel: 'l',
                    serviceKey: 'k',
                    serviceTitle: 'Quote check',
                    status: 'in_progress',
                    needVersion: 1,
                    region: 'EU',
                    createdAt: '2026-10-06T00:00:00.000Z',
                    updatedAt: '2026-10-07T00:00:00.000Z',
                  },
                ]
              : [],
          nextAfter: null,
        }),
      },
    });
    const { items } = await run();
    expect(items.find((i) => i.kind === 'draft')?.title).toBe('广州家具采购 কারখানা');
    expect(items.find((i) => i.kind === 'service_request')?.status).toBe('in_progress');
    expect(items.find((i) => i.kind === 'draft')?.status).toBe('OPEN');
  });
});

describe('W-06 to W-08 scope, joins and duplicates', () => {
  it('W-06 drops a record whose workspace is not the person’s, and never lists it', async () => {
    patch({
      customerRequests: {
        list: async () => ({
          requests: [requestRow(1, A), requestRow(2, OUTSIDE)],
          nextAfter: null,
        }),
      },
      customerServiceRequests: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          requests:
            workspaceId === A
              ? [
                  {
                    id: id(20),
                    workspaceId: OUTSIDE,
                    contextKind: 'company',
                    contextRef: 'c',
                    contextLabel: 'l',
                    serviceKey: 'k',
                    serviceTitle: 'Leaked',
                    status: 'requested',
                    needVersion: 1,
                    region: 'EU',
                    createdAt: '2026-10-06T00:00:00.000Z',
                    updatedAt: '2026-10-07T00:00:00.000Z',
                  },
                ]
              : [],
          nextAfter: null,
        }),
      },
    });
    const list = await run();
    expect(list.items.map((i) => i.id)).toEqual([id(101)]);
    expect(list.workspaces).toEqual([
      { id: A, name: 'Atelier Rahman' },
      { id: B, name: 'Dhaka Knit' },
    ]);
    expect(JSON.stringify(list)).not.toContain(OUTSIDE);
    expect(JSON.stringify(list)).not.toContain('Leaked');
  });

  it('W-07 keeps same title, company, email and country from two sources as two items', async () => {
    const same = 'Acme Ltd, buyer@acme.example, Spain';
    patch({
      customerMissionDrafts: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          drafts: workspaceId === A ? [draft(1, 'BUYERS_PARTNERS', { title: same })] : [],
          nextAfter: null,
        }),
      },
      customerServiceRequests: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          requests:
            workspaceId === A
              ? [
                  {
                    id: id(20),
                    workspaceId: A,
                    contextKind: 'company',
                    contextRef: 'c',
                    contextLabel: same,
                    serviceKey: 'k',
                    serviceTitle: same,
                    status: 'requested',
                    needVersion: 1,
                    region: 'Spain',
                    createdAt: '2026-10-06T00:00:00.000Z',
                    updatedAt: '2026-10-07T00:00:00.000Z',
                  },
                ]
              : [],
          nextAfter: null,
        }),
      },
    });
    const { items } = await run();
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it('W-08 lists only OPEN drafts, so a submitted one is never shown as a draft', async () => {
    patch({
      customerMissionDrafts: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          drafts:
            workspaceId === A
              ? [
                  draft(1, 'BUYERS_PARTNERS'),
                  draft(2, 'BUYERS_PARTNERS', { status: 'SUBMITTED', requestId: id(101) }),
                  draft(3, 'BUYERS_PARTNERS', { status: 'SUBMITTED', requestId: id(555) }),
                  draft(4, 'BUYERS_PARTNERS', { status: 'DISCARDED' }),
                ]
              : [],
          nextAfter: null,
        }),
      },
      customerRequests: { list: async () => ({ requests: [requestRow(1)], nextAfter: null }) },
    });
    const { items } = await run();
    expect(items.filter((i) => i.kind === 'draft').map((i) => i.id)).toEqual([id(1)]);
    expect(items.filter((i) => i.kind === 'request')).toHaveLength(1);
  });
});

describe('W-09 and W-10 truth states', () => {
  it('W-09 names each failing source, never a source that is off', async () => {
    on.services = false;
    patch({
      customerMissionDrafts: { list: fail },
      customerProgrammes: { list: fail },
    });
    const list = await run();
    expect([...list.unreadable].sort()).toEqual(['drafts', 'programmes']);
    expect(list.unreadable).not.toContain('services');
  });

  it('W-09 every source failing gives no items and a non-empty unreadable list', async () => {
    patch({
      customerMissionDrafts: { list: fail },
      customerRequests: { list: fail },
      customerProgrammes: { list: fail },
      customerServiceRequests: { list: fail },
    });
    const list = await run();
    expect(list.items).toEqual([]);
    expect([...list.unreadable].sort()).toEqual(['drafts', 'programmes', 'requests', 'services']);
  });

  it('W-09 an unreadable workspace list and a missing service are named and list nothing', async () => {
    patch({ customerWorkspaces: { list: fail } });
    expect(await run()).toMatchObject({ items: [], unreadable: ['workspaces'] });
    services = null;
    expect(await run()).toMatchObject({ items: [], unreadable: ['account'] });
  });

  it('W-09 the workspace module being off is a true empty', async () => {
    on.workspaces = false;
    expect(await run()).toEqual({
      items: [],
      unreadable: [],
      partial: false,
      skippedWorkspaces: 0,
      workspaces: [],
    });
  });

  it('W-10 a list longer than the page cap sets partial, and extra workspaces are counted', async () => {
    const many = Array.from({ length: 10 }, (_, n) => ({
      id: id(900 + n),
      name: `Workspace ${n}`,
      role: 'member' as const,
    }));
    patch({
      customerWorkspaces: { list: async () => many },
      customerMissionDrafts: {
        list: async () => ({ drafts: [], nextAfter: id(777) }),
      },
    });
    const list = await run();
    expect(list.partial).toBe(true);
    expect(list.skippedWorkspaces).toBe(2);
  });
});

describe('W-11 to W-13 shape', () => {
  it('W-11 carries no money, quote, markup or contact field', async () => {
    patch({
      customerMissionDrafts: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          drafts: workspaceId === A ? [draft(1, 'SUPPLIERS_PRODUCTS')] : [],
          nextAfter: null,
        }),
      },
      customerServiceRequests: {
        list: async ({ workspaceId }: { workspaceId: string }) => ({
          requests:
            workspaceId === A
              ? [
                  {
                    id: id(20),
                    workspaceId: A,
                    contextKind: 'company',
                    contextRef: 'c',
                    contextLabel: 'l',
                    serviceKey: 'k',
                    serviceTitle: 'Quote check',
                    status: 'quoted',
                    needVersion: 1,
                    region: 'EU',
                    amount: 12000,
                    currency: 'USD',
                    markup: 0.18,
                    email: 'x@y.example',
                    phone: '+8801000000000',
                    createdAt: '2026-10-06T00:00:00.000Z',
                    updatedAt: '2026-10-07T00:00:00.000Z',
                  },
                ]
              : [],
          nextAfter: null,
        }),
      },
    });
    const { items } = await run();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items)
      expect(Object.keys(item).sort()).toEqual(
        [
          'family',
          'href',
          'id',
          'key',
          'kind',
          'status',
          'title',
          'updatedAt',
          'workspaceId',
        ].sort(),
      );
    const text = JSON.stringify(items);
    for (const word of ['amount', 'currency', 'markup', 'email', 'phone', 'x@y.example', '12000'])
      expect(text).not.toContain(word);
  });

  it('W-12 builds only existing routes and encodes hostile ids', async () => {
    const hostile = 'a/b?c=d#e';
    patch({
      customerWorkspaces: { list: async () => [owner] },
      customerMissionDrafts: {
        list: async () => ({ drafts: [draft(1, 'OTHER')], nextAfter: null }),
      },
      customerRequests: {
        list: async () => ({
          requests: [requestRow(1, A), requestRow(2, A, { id: hostile })],
          nextAfter: null,
        }),
      },
      customerProgrammes: {
        list: async () => ({
          programmes: [
            { id: id(10), workspaceId: A, name: 'P', createdAt: '2026-10-05T00:00:00Z' },
          ],
          nextAfter: null,
        }),
      },
      customerServiceRequests: {
        list: async () => ({
          requests: [
            {
              id: hostile,
              workspaceId: A,
              contextKind: 'company',
              contextRef: 'c',
              contextLabel: 'l',
              serviceKey: 'k',
              serviceTitle: 'T',
              status: 'requested',
              needVersion: 1,
              region: 'EU',
              createdAt: '2026-10-06T00:00:00.000Z',
              updatedAt: '2026-10-07T00:00:00.000Z',
            },
          ],
          nextAfter: null,
        }),
      },
    });
    const plain = await run();
    const rooms = await run({ rooms: true });
    const patterns = [
      /^\/account\/drafts\/[^/?#]+$/,
      /^\/account\/requests\/[^/?#]+$/,
      /^\/account\/delegations\/[^/?#]+$/,
      /^\/account\/service-requests\/[^/?#]+\/[^/?#]+$/,
    ];
    for (const item of plain.items) expect(patterns.some((p) => p.test(item.href))).toBe(true);
    for (const item of rooms.items.filter((i) => i.kind === 'request'))
      expect(item.href).toMatch(/^\/account\/rooms\/[^/?#]+$/);
    expect(plain.items.find((i) => i.kind === 'request' && i.id === hostile)?.href).toBe(
      '/account/requests/' + encodeURIComponent(hostile),
    );
    expect(plain.items.find((i) => i.kind === 'draft')?.href).toBe('/account/drafts/' + A);
  });

  it('W-13 orders newest first and is stable for equal times', async () => {
    const t = '2026-11-01T10:00:00.000Z';
    patch({
      customerWorkspaces: { list: async () => [owner] },
      customerMissionDrafts: {
        list: async () => ({
          drafts: [
            draft(3, 'OTHER', { updatedAt: t }),
            draft(1, 'OTHER', { updatedAt: t }),
            draft(2, 'OTHER', { updatedAt: '2026-11-03T10:00:00.000Z' }),
            draft(4, 'OTHER', { updatedAt: '2026-10-01T10:00:00.000Z' }),
          ],
          nextAfter: null,
        }),
      },
    });
    const { items } = await run();
    expect(items.map((i) => i.id)).toEqual([id(2), id(1), id(3), id(4)]);
    expect((await run()).items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
});
