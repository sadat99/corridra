import { afterEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import {
  customerSearchLimits,
  searchCustomer,
  takeSearchSlot,
  type CustomerSearchServices,
  type CustomerSearchSwitches,
} from '../../apps/web/lib/customer-search';

// The customer search core (docs/revamp/specs/navigation-v1/customer-search.md, sections 2 to 5): a person's own
// Requests and approved Companies, read through fake services that count every call. The words typed are given only to
// the core; no service argument may contain them.
const uuid = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const requestId = (n: number) => `0b5a${String(n).padStart(4, '0')}-0000-4000-8000-000000000001`;
const resourceId = (n: number) => `0c5a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const companyId = (n: number) => n.toString(16).padStart(64, 'a');
const marketBrief = (objective: string, market: string) => ({ objective, market });
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: requestId(n),
  workspaceId: uuid('11111111', 1),
  createdAt: '2026-11-03T09:00:00.000Z',
  synthetic: true,
  available: true,
  progress: { status: 'ACTIVE', receivedAt: '2026-11-03T09:00:00.000Z', replies: [] },
  ...over,
});
const context = { correlationId: 'c0ffee00-0000-4000-8000-000000000000', client: 'local' };
const allOn: CustomerSearchSwitches = {
  requests: true,
  details: true,
  companies: true,
  provenance: (value) => value === true,
};

type Harness = ReturnType<typeof harness>;
function harness(
  options: {
    rows?: unknown[];
    nextAfter?: string | null;
    briefs?: Record<string, unknown>;
    pages?: unknown[];
    detail?: (id: string, call: number) => unknown;
    list?: () => unknown;
    budget?: (call: number) => unknown;
  } = {},
) {
  const calls = {
    requestList: [] as unknown[][],
    detail: [] as unknown[][],
    companyList: [] as unknown[][],
    budget: [] as unknown[][],
    inFlight: 0,
    peak: 0,
  };
  const services: CustomerSearchServices = {
    requests: {
      async list(...args) {
        calls.requestList.push(args);
        if (options.list) return options.list();
        return {
          requests: options.rows ?? [],
          nextAfter: options.nextAfter ?? null,
          synthetic: true,
        };
      },
    },
    details: {
      async detail(...args) {
        calls.detail.push(args);
        const call = calls.detail.length;
        calls.inFlight += 1;
        calls.peak = Math.max(calls.peak, calls.inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (options.detail) return options.detail(String(args[0]), call);
          return { original: options.briefs?.[String(args[0])] };
        } finally {
          calls.inFlight -= 1;
        }
      },
    },
    companyBudget: async (...args) => {
      calls.budget.push(args);
      const refused = options.budget?.(calls.budget.length);
      if (refused) throw refused;
    },
    companies: {
      async list(...args) {
        calls.companyList.push(args);
        const pages = options.pages ?? [];
        const page = pages[Math.min(calls.companyList.length - 1, pages.length - 1)];
        if (typeof page === 'function') return (page as () => unknown)();
        return page ?? { companies: [], nextAfter: null, unavailableScopes: 0, synthetic: true };
      },
    },
  };
  return { services, calls };
}
const search = (
  h: Harness,
  q: string,
  scope: 'all' | 'requests' | 'companies' = 'all',
  switches = allOn,
  extra: Partial<typeof context> & { signal?: AbortSignal; now?: () => number } = {},
) => searchCustomer(h.services, switches, { ...context, ...extra }, q, scope);
const page = (companies: unknown[], nextAfter: string | null = null, over = {}) => ({
  companies,
  nextAfter,
  scopesRead: 5,
  unavailableScopes: 0,
  expiresAt: '2030-01-01T00:00:00.000Z',
  synthetic: true,
  ...over,
});
const company = (n: number, name: string, resource: number, country = 'Spain') => ({
  id: companyId(n),
  contexts: [
    { resourceId: resourceId(resource), targetId: uuid('22222222', n), company: name, country },
  ],
});

afterEach(() => vi.restoreAllMocks());

describe('P1 Requests: the title comes from the brief and the typo is close', () => {
  const rows = [row(1), row(2), row(3)];
  const briefs = {
    [requestId(1)]: marketBrief('Sell in a new market', 'ES'),
    [requestId(2)]: marketBrief('Find customers or distributors', 'DE'),
    [requestId(3)]: marketBrief('Source suppliers', 'PL'),
  };
  test('"spain" finds "Sell in Spain" with its sent date and status, and opens its page', async () => {
    const h = harness({ rows, briefs });
    const found = await search(h, 'spain', 'requests');
    expect(found.scopes).toEqual({ requests: 'ok' });
    expect(found.hits).toEqual([
      {
        id: requestId(1),
        label: 'Sell in Spain',
        detail: '',
        href: `/account/requests/${requestId(1)}`,
        kind: 'request',
        sample: true,
      },
    ]);
    expect(found.facts).toEqual({
      [`request:${requestId(1)}`]: { sent: '2026-11-03T09:00:00.000Z', status: 'ACTIVE' },
    });
  });
  test('"spian" finds it too and marks it close', async () => {
    const h = harness({ rows, briefs });
    const found = await search(h, 'spian', 'requests');
    expect(found.hits.map((hit) => hit.label)).toEqual(['Sell in Spain']);
    expect(found.facts?.[`request:${requestId(1)}`]).toMatchObject({ close: true });
  });
  test('the service is asked for one page of 100 with the claimed subject and issuer, and no words', async () => {
    const h = harness({ rows, briefs });
    await searchCustomer(
      h.services,
      allOn,
      { ...context, subject: 'synthetic-alice', issuer: 'https://issuer.example.invalid/auth' },
      'secret-spain',
      'requests',
    );
    expect(h.calls.requestList).toEqual([
      [{ pageSize: 100 }, 'synthetic-alice', 'https://issuer.example.invalid/auth'],
    ]);
    expect(h.calls.detail.map((call) => call[1])).toEqual([
      'synthetic-alice',
      'synthetic-alice',
      'synthetic-alice',
    ]);
    expect(
      JSON.stringify([h.calls.requestList, h.calls.detail, h.calls.companyList]),
    ).not.toContain('secret');
  });
  test('a Request whose retention has ended is not searched and does not make the scope partial', async () => {
    const h = harness({ rows: [row(1), row(2, { available: false, progress: null })], briefs });
    const found = await search(h, 'germany', 'requests');
    expect(found.scopes).toEqual({ requests: 'ok' });
    expect(found.hits).toEqual([]);
    expect(h.calls.detail).toHaveLength(1);
  });
  test('a withdrawn Request is found and says so (D3: never silently dropped)', async () => {
    const h = harness({ rows: [row(1, { withdrawn: true })], briefs });
    const found = await search(h, 'spain', 'requests');
    expect(found.hits).toHaveLength(1);
    expect(found.facts?.[`request:${requestId(1)}`]).toMatchObject({ withdrawn: true });
  });
  test('a Request with no derivable title is not a hit; a malformed row makes the scope partial', async () => {
    const h = harness({ rows: [row(1), { id: 'nope' }, 'text'], briefs: {} });
    const found = await search(h, 'spain', 'requests');
    expect(found.hits).toEqual([]);
    expect(found.scopes).toEqual({ requests: 'partial' });
  });
  test('ids are given back in lower case', async () => {
    const upper = requestId(1).toUpperCase();
    const h = harness({
      rows: [row(1, { id: upper })],
      briefs: { [requestId(1)]: briefs[requestId(1)] },
    });
    const found = await search(h, 'spain', 'requests');
    expect(found.hits[0]!.id).toBe(requestId(1));
  });
  test('a scope that is switched off, or whose provenance is not allowed, is unavailable with no call', async () => {
    for (const switches of [
      { ...allOn, requests: false },
      { ...allOn, details: false },
    ]) {
      const h = harness({ rows, briefs });
      const found = await search(h, 'spain', 'requests', switches);
      expect(found).toEqual({ hits: [], scopes: { requests: 'unavailable' } });
      expect(h.calls.requestList).toHaveLength(0);
    }
    const h = harness({ rows, briefs });
    const found = await search(h, 'spain', 'requests', { ...allOn, provenance: () => false });
    expect(found.scopes).toEqual({ requests: 'unavailable' });
    expect(h.calls.detail).toHaveLength(0);
  });
});

describe('P2 Companies: from the loaded approved reports', () => {
  test('a company is found by name; the count is of loaded reports and it opens the lowest loaded report', async () => {
    const h = harness({
      pages: [
        page(
          [company(1, 'Acme Iberica SL', 9), company(2, 'Other GmbH', 8, 'Germany')],
          resourceId(9),
        ),
        page([company(1, 'Acme Iberica S.L.', 4), company(3, 'Third Ltd', 7)]),
      ],
    });
    const found = await search(h, 'acme', 'companies');
    expect(found.scopes).toEqual({ companies: 'ok' });
    expect(found.hits).toEqual([
      {
        id: companyId(1),
        label: 'Acme Iberica S.L.',
        detail: 'Spain',
        href: `/account/missions/${resourceId(4)}`,
        kind: 'company',
        sample: true,
      },
    ]);
    expect(found.facts).toEqual({ [`company:${companyId(1)}`]: { reports: 2 } });
    expect(h.calls.companyList).toEqual([
      [{ pageSize: 5 }, undefined, undefined],
      [{ pageSize: 5, after: resourceId(9) }, undefined, undefined],
    ]);
  });
  test('a company is found by its country, and a typo is close', async () => {
    const h = harness({ pages: [page([company(1, 'Acme SL', 1)])] });
    expect((await search(h, 'spain', 'companies')).hits).toHaveLength(1);
    const typo = await search(h, 'acmee', 'companies');
    expect(typo.facts?.[`company:${companyId(1)}`]).toMatchObject({ close: true });
  });
  test('a scope the portfolio could not read in full is partial', async () => {
    const h = harness({
      pages: [page([company(1, 'Acme SL', 1)], null, { unavailableScopes: 1 })],
    });
    expect((await search(h, 'acme', 'companies')).scopes).toEqual({ companies: 'partial' });
  });
  test('a malformed company or next address is partial, not a crash', async () => {
    const h = harness({
      pages: [page([{ id: 'x', contexts: [] }, company(1, 'Acme SL', 1)], 'bad')],
    });
    const found = await search(h, 'acme', 'companies');
    expect(found.hits).toHaveLength(1);
    expect(found.scopes).toEqual({ companies: 'partial' });
    expect(h.calls.companyList).toHaveLength(1);
  });
  test('off means unavailable with no call', async () => {
    const h = harness({ pages: [page([company(1, 'Acme SL', 1)])] });
    const found = await search(h, 'acme', 'companies', { ...allOn, companies: false });
    expect(found).toEqual({ hits: [], scopes: { companies: 'unavailable' } });
    expect(h.calls.companyList).toHaveLength(0);
  });
});

describe('R5 and D7 failures keep what was found and say so', () => {
  test('a failure on a later company page keeps earlier hits, is partial and logs one fixed line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = Object.assign(new Error('relation failed while searching for secret-acme'), {
      code: '57014',
    });
    const h = harness({
      pages: [page([company(1, 'Acme SL', 1)], resourceId(1)), () => Promise.reject(failure)],
    });
    const found = await search(h, 'acme', 'companies');
    expect(found.hits).toHaveLength(1);
    expect(found.scopes).toEqual({ companies: 'partial' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(spy.mock.calls[0]![0]))).toEqual({
      event: 'customer_search_page_failed',
      scope: 'companies',
      page: 2,
      correlationId: context.correlationId,
      errorName: 'Error',
      errorCode: '57014',
    });
    expect(String(spy.mock.calls[0]![0])).not.toContain('secret');
  });
  test('access ended on a later page: denied, and the earlier rows are not shown', async () => {
    const h = harness({
      pages: [
        page([company(1, 'Acme SL', 1)], resourceId(1)),
        () =>
          Promise.reject(Object.assign(new Error('Customer access expired'), { code: '42501' })),
      ],
    });
    expect(await search(h, 'acme', 'companies')).toEqual({
      hits: [],
      scopes: { companies: 'denied' },
    });
  });
  test('a refusal on a later page ends the search', async () => {
    const h = harness({
      pages: [
        page([company(1, 'Acme SL', 1)], resourceId(1)),
        () => Promise.reject(new DomainError('Sign in', 401)),
      ],
    });
    await expect(search(h, 'acme', 'companies')).rejects.toMatchObject({ status: 401 });
  });
  test.each([
    ['a DomainError 503', new DomainError('off', 503), 'unavailable'],
    ['a missing relation', Object.assign(new Error('x'), { code: '42P01' }), 'unavailable'],
    ['a missing schema', Object.assign(new Error('x'), { code: '3F000' }), 'unavailable'],
    ['a missing function', Object.assign(new Error('x'), { code: '42883' }), 'unavailable'],
    ['an expired grant', Object.assign(new Error('x'), { code: '42501' }), 'denied'],
  ])('a first read that fails with %s is %s for its scope', async (_name, error, state) => {
    const h = harness({ list: () => Promise.reject(error), pages: [() => Promise.reject(error)] });
    const found = await search(h, 'spain', 'all');
    expect(found).toEqual({ hits: [], scopes: { requests: state, companies: state } });
  });
  test('an archived workspace is a Requests state and Companies still answer', async () => {
    const archived = Object.assign(
      new Error(
        'This workspace is archived. Restore it to send new private requests, invitations and registrations.',
      ),
      { code: '55000' },
    );
    const h = harness({
      list: () => Promise.reject(archived),
      pages: [page([company(1, 'Spain Foods', 1)])],
    });
    const found = await search(h, 'spain', 'all');
    expect(found.scopes).toEqual({ requests: 'archived', companies: 'ok' });
    expect(found.hits.map((hit) => hit.kind)).toEqual(['company']);
  });
  test('another 55000 refusal is not an archive: it ends the search as a failure', async () => {
    const other = Object.assign(new Error('something else'), { code: '55000' });
    const h = harness({ list: () => Promise.reject(other) });
    await expect(search(h, 'spain', 'requests')).rejects.toBe(other);
  });
  test.each([401, 403, 409, 400])(
    'a DomainError %i from the first read ends the search with no second scope',
    async (status) => {
      const error = new DomainError('refused', status);
      const h = harness({ list: () => Promise.reject(error) });
      await expect(search(h, 'spain', 'all')).rejects.toBe(error);
      expect(h.calls.companyList).toHaveLength(0);
      expect(h.calls.requestList).toHaveLength(1);
    },
  );
  test('a closed account keeps its code', async () => {
    const h = harness({
      list: () => Promise.reject(new DomainError('Account closed', 403, 'account_closed')),
    });
    await expect(search(h, 'spain', 'all')).rejects.toMatchObject({
      status: 403,
      code: 'account_closed',
    });
  });
  test('a refusal during a title lookup ends the search and no company page is read', async () => {
    const h = harness({
      rows: [row(1), row(2), row(3)],
      detail: () => {
        throw new DomainError('Account closed', 403, 'account_closed');
      },
    });
    await expect(search(h, 'spain', 'all')).rejects.toMatchObject({ code: 'account_closed' });
    expect(h.calls.companyList).toHaveLength(0);
  });
  test.each([400, 401, 403, 409])(
    'a %i during a title lookup, or on a later company page, ends the search',
    async (status) => {
      const refusal = new DomainError('refused', status);
      const lookup = harness({
        rows: [row(1), row(2)],
        detail: () => {
          throw refusal;
        },
        pages: [page([company(1, 'Spain Foods', 1)])],
      });
      await expect(search(lookup, 'spain', 'all')).rejects.toBe(refusal);
      expect(lookup.calls.companyList).toHaveLength(0);
      const later = harness({
        pages: [page([company(1, 'Spain Foods', 1)], resourceId(1)), () => Promise.reject(refusal)],
      });
      await expect(search(later, 'spain', 'companies')).rejects.toBe(refusal);
    },
  );
  test('a lookup that fails makes the scope partial and a later success resets the run', async () => {
    const briefs = marketBrief('Sell in a new market', 'ES');
    const h = harness({
      rows: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(n)),
      detail: (_id, call) => {
        if (call === 1 || call === 3 || call === 5) throw new Error('provider hiccup');
        return { original: briefs };
      },
    });
    const found = await search(h, 'spain', 'requests');
    expect(found.scopes).toEqual({ requests: 'partial' });
    expect(h.calls.detail).toHaveLength(8);
    expect(found.hits).toHaveLength(5);
  });
  test('three failures in a row stop the lookups', async () => {
    const h = harness({
      rows: Array.from({ length: 40 }, (_, n) => row(n + 1)),
      detail: () => {
        throw new Error('provider down');
      },
    });
    const found = await search(h, 'spain', 'requests');
    expect(found).toEqual({ hits: [], scopes: { requests: 'partial' } });
    expect(h.calls.detail.length).toBeGreaterThanOrEqual(customerSearchLimits.titleFailureStop);
    expect(h.calls.detail.length).toBeLessThanOrEqual(customerSearchLimits.titleFailureStop + 1);
  });
});

describe('M1 bounded work', () => {
  const brief = marketBrief('Sell in a new market', 'ES');
  const millions = (n: number) => ({
    requests: Array.from({ length: 100 }, (_, i) => row(n * 1000 + i + 1)),
    nextAfter: requestId(999),
    synthetic: true,
  });
  test('services that report millions of rows are read within the caps', async () => {
    const h = harness({
      list: () => millions(1),
      detail: () => ({ original: brief }),
      pages: [() => page([company(1, 'Spain Foods', 1)], resourceId(1))],
    });
    const found = await search(h, 'spain', 'all');
    expect(h.calls.requestList).toHaveLength(1);
    expect(h.calls.detail).toHaveLength(customerSearchLimits.titleCap);
    expect(h.calls.peak).toBeLessThanOrEqual(customerSearchLimits.titleConcurrency);
    expect(h.calls.companyList).toHaveLength(customerSearchLimits.companyPages);
    expect(found.scopes).toEqual({ requests: 'partial', companies: 'partial' });
    expect(found.hits.filter((hit) => hit.kind === 'request')).toHaveLength(
      customerSearchLimits.showAll,
    );
    expect(h.calls.requestList.length + h.calls.detail.length + h.calls.companyList.length).toBe(
      1 + 30 + 4,
    );
  });
  test('a single scope shows ten and reads only its own service', async () => {
    const h = harness({ list: () => millions(2), detail: () => ({ original: brief }) });
    const found = await search(h, 'spain', 'requests');
    expect(found.hits).toHaveLength(customerSearchLimits.showScope);
    expect(h.calls.companyList).toHaveLength(0);
    const other = harness({ pages: [() => page([company(1, 'Spain Foods', 1)], resourceId(1))] });
    await search(other, 'spain', 'companies');
    expect(other.calls.requestList).toHaveLength(0);
    expect(other.calls.detail).toHaveLength(0);
  });
  test('exactly 100 rows and no more pages, with 30 or fewer to look up, is not partial', async () => {
    const h = harness({
      rows: Array.from({ length: 30 }, (_, i) => row(i + 1)),
      detail: () => ({ original: brief }),
    });
    expect((await search(h, 'spain', 'requests')).scopes).toEqual({ requests: 'ok' });
    const more = harness({
      rows: Array.from({ length: 31 }, (_, i) => row(i + 1)),
      detail: () => ({ original: brief }),
    });
    const found = await search(more, 'spain', 'requests');
    expect(found.scopes).toEqual({ requests: 'partial' });
    expect(more.calls.detail).toHaveLength(30);
  });
  test('a service that returns more than a page is cut at a page', async () => {
    const h = harness({
      rows: Array.from({ length: 150 }, (_, i) => row(i + 1)),
      detail: () => ({ original: brief }),
    });
    const found = await search(h, 'spain', 'requests');
    expect(found.scopes).toEqual({ requests: 'partial' });
    expect(h.calls.detail).toHaveLength(30);
  });
  test('two title lookups at most are in flight', async () => {
    const h = harness({
      rows: Array.from({ length: 12 }, (_, i) => row(i + 1)),
      detail: () => ({ original: brief }),
    });
    await search(h, 'spain', 'requests');
    expect(h.calls.peak).toBe(2);
  });
  test('an aborted request stops the lookups and the company pages', async () => {
    const controller = new AbortController();
    const h = harness({
      rows: Array.from({ length: 30 }, (_, i) => row(i + 1)),
      detail: () => {
        controller.abort();
        return { original: brief };
      },
      pages: [() => page([company(1, 'Spain Foods', 1)], resourceId(1))],
    });
    const found = await search(h, 'spain', 'all', allOn, { signal: controller.signal });
    expect(h.calls.detail.length).toBeLessThanOrEqual(customerSearchLimits.titleConcurrency);
    expect(found.scopes.requests).toBe('partial');
    // The request is gone: the Companies scope does not start, and says it was not searched.
    expect(h.calls.companyList).toHaveLength(0);
    expect(found.scopes.companies).toBe('partial');
  });
  test('the time budget stops the lookups (fake clock)', async () => {
    let clock = 0;
    const h = harness({
      rows: Array.from({ length: 30 }, (_, i) => row(i + 1)),
      detail: () => {
        clock += 2000;
        return { original: brief };
      },
    });
    const found = await search(h, 'spain', 'requests', allOn, { now: () => clock });
    expect(found.scopes).toEqual({ requests: 'partial' });
    expect(h.calls.detail.length).toBeGreaterThan(0);
    expect(h.calls.detail.length).toBeLessThan(customerSearchLimits.titleCap);
  });
  test('a long label is cut and the answer stays small', async () => {
    const long = 'x'.repeat(5000);
    const h = harness({
      pages: [page([company(1, `Spain ${long}`, 1, long)])],
      list: () => millions(3),
      detail: () => ({ original: { objective: 'Something else', market: `Spain ${long}` } }),
    });
    const found = await search(h, 'spain', 'all');
    for (const hit of found.hits) {
      expect(hit.label.length).toBeLessThanOrEqual(200);
      expect(hit.detail.length).toBeLessThanOrEqual(200);
    }
    expect(JSON.stringify(found).length).toBeLessThan(10 * 2 * 700 + 2000);
  });
  test('the limits are the agreed numbers', () => {
    expect(customerSearchLimits).toEqual({
      requestPage: 100,
      titleCap: 30,
      titleConcurrency: 2,
      titleBudgetMs: 6000,
      titleFailureStop: 3,
      companyPages: 4,
      companyPageSize: 5,
      showAll: 5,
      showScope: 10,
      maxConcurrentSearches: 4,
      searchDeadlineMs: 12000,
      perPersonSearches: 10,
      perPersonWindowMs: 10000,
      perPersonKeys: 5000,
    });
  });
});

describe('more saved Requests than the page holds', () => {
  test('a next page with only three available rows is still partial: the rest were never read', async () => {
    const brief = marketBrief('Sell in a new market', 'ES');
    const h = harness({
      rows: [row(1), row(2), row(3)],
      nextAfter: requestId(900),
      detail: () => ({ original: brief }),
    });
    const found = await search(h, 'spain', 'requests');
    expect(found.scopes).toEqual({ requests: 'partial' });
    expect(found.hits).toHaveLength(3);
  });
});

describe('the overall deadline', () => {
  const brief = marketBrief('Sell in a new market', 'ES');
  afterEach(() => vi.useRealTimers());
  test('time spent before the lookups leaves both scopes partial and unread (fake clock)', async () => {
    let clock = 0;
    const h = harness({
      list: () => {
        clock += customerSearchLimits.searchDeadlineMs;
        return { requests: [row(1), row(2)], nextAfter: null, synthetic: true };
      },
      pages: [page([company(1, 'Spain Foods', 1)])],
    });
    const found = await search(h, 'spain', 'all', allOn, { now: () => clock });
    expect(found).toEqual({ hits: [], scopes: { requests: 'partial', companies: 'partial' } });
    expect(h.calls.detail).toHaveLength(0);
    expect(h.calls.companyList).toHaveLength(0);
  });
  test('a first read that never answers is given up on at the deadline, and is partial, never ok', async () => {
    vi.useFakeTimers();
    const h = harness({ list: () => new Promise(() => undefined) });
    const running = search(h, 'spain', 'requests', allOn, { now: Date.now });
    await vi.advanceTimersByTimeAsync(customerSearchLimits.searchDeadlineMs - 1);
    let settled = false;
    void running.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toEqual({ hits: [], scopes: { requests: 'partial' } });
  });
  test('a title lookup that never answers is given up on, and the hits already found are kept', async () => {
    vi.useFakeTimers();
    const h = harness({
      rows: [row(1), row(2), row(3)],
      detail: (id) => (id === requestId(1) ? { original: brief } : new Promise(() => undefined)),
    });
    const running = search(h, 'spain', 'requests', allOn, { now: Date.now });
    await vi.advanceTimersByTimeAsync(customerSearchLimits.searchDeadlineMs);
    const found = await running;
    expect(found.scopes).toEqual({ requests: 'partial' });
    expect(found.hits.map((hit) => hit.id)).toEqual([requestId(1)]);
  });
  test('a company page that never answers keeps the earlier hits and is partial', async () => {
    vi.useFakeTimers();
    const h = harness({
      pages: [
        page([company(1, 'Spain Foods', 1)], resourceId(1)),
        () => new Promise(() => undefined),
      ],
    });
    const running = search(h, 'spain', 'companies', allOn, { now: Date.now });
    await vi.advanceTimersByTimeAsync(customerSearchLimits.searchDeadlineMs);
    const found = await running;
    expect(found.scopes).toEqual({ companies: 'partial' });
    expect(found.hits).toHaveLength(1);
  });
  test('one deadline covers both scopes: Companies get what Requests left', async () => {
    vi.useFakeTimers();
    const h = harness({
      list: () => new Promise(() => undefined),
      pages: [page([company(1, 'Spain Foods', 1)])],
    });
    const running = search(h, 'spain', 'all', allOn, { now: Date.now });
    await vi.advanceTimersByTimeAsync(customerSearchLimits.searchDeadlineMs);
    expect(await running).toEqual({
      hits: [],
      scopes: { requests: 'partial', companies: 'partial' },
    });
    expect(h.calls.companyList).toHaveLength(0);
  });
  test('an aborted request gives up on a call in flight at once', async () => {
    const controller = new AbortController();
    const h = harness({ list: () => new Promise(() => undefined) });
    const running = search(h, 'spain', 'requests', allOn, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(await running).toEqual({ hits: [], scopes: { requests: 'partial' } });
  });
});

describe('the search slots', () => {
  test('four searches may run at once, the fifth is refused, and a released slot is free again', () => {
    const slots = Array.from({ length: customerSearchLimits.maxConcurrentSearches }, () =>
      takeSearchSlot(),
    );
    expect(slots.every((slot) => typeof slot === 'function')).toBe(true);
    expect(takeSearchSlot()).toBeNull();
    slots[0]!();
    slots[0]!();
    const again = takeSearchSlot();
    expect(again).not.toBeNull();
    expect(takeSearchSlot()).toBeNull();
    again!();
    for (const slot of slots.slice(1)) slot!();
    const clean = Array.from({ length: 4 }, () => takeSearchSlot());
    expect(clean.every(Boolean)).toBe(true);
    for (const slot of clean) slot!();
  });
});

describe('P5 and ordering', () => {
  test.each(['', ' ', 'a', ' a ', '!!', '--', '  ?  '])('"%s" reads nothing', async (q) => {
    const h = harness({ rows: [row(1)] });
    expect(await search(h, q)).toEqual({ hits: [], scopes: {} });
    expect(h.calls.requestList.length + h.calls.detail.length + h.calls.companyList.length).toBe(0);
  });
  test('Requests come before Companies, each best match first, and only asked scopes appear', async () => {
    const h = harness({
      rows: [row(1), row(2)],
      briefs: {
        [requestId(1)]: marketBrief('Source suppliers', 'ES'),
        [requestId(2)]: marketBrief('Sell in a new market', 'ES'),
      },
      pages: [page([company(1, 'Spaintech Ltd', 1), company(2, 'Spain Foods', 2)])],
    });
    const found = await search(h, 'spain');
    expect(found.hits.map((hit) => hit.label)).toEqual([
      // Equal scores keep the order the service gave; an exact word beats a word that only starts with it.
      'Source suppliers in Spain',
      'Sell in Spain',
      'Spain Foods',
      'Spaintech Ltd',
    ]);
    expect(Object.keys(found.scopes)).toEqual(['requests', 'companies']);
    expect(Object.keys((await search(h, 'spain', 'companies')).scopes)).toEqual(['companies']);
  });
  test('the answer has no facts key when there are no hits', async () => {
    const h = harness({
      rows: [row(1)],
      briefs: { [requestId(1)]: marketBrief('Sell in a new market', 'ES') },
    });
    expect(await search(h, 'zebra', 'requests')).toEqual({ hits: [], scopes: { requests: 'ok' } });
  });
});

describe('the Companies budget, spent before every portfolio page', () => {
  test('one spend per page read, with the client the route derived, before the page', async () => {
    const h = harness({ pages: [page([company(1, 'Spain Foods', 1)], resourceId(1)), page([])] });
    await search(h, 'spain', 'companies', allOn, { client: '203.0.113.7' });
    expect(h.calls.companyList).toHaveLength(2);
    expect(h.calls.budget).toEqual([['203.0.113.7'], ['203.0.113.7']]);
  });
  test('four pages cost four spends', async () => {
    const h = harness({ pages: [() => page([company(1, 'Spain Foods', 1)], resourceId(1))] });
    await search(h, 'spain', 'companies');
    expect(h.calls.budget).toHaveLength(customerSearchLimits.companyPages);
  });
  test('a spent budget refuses the first page: limited, zero portfolio reads, Requests still answer', async () => {
    const h = harness({
      rows: [row(1)],
      briefs: { [requestId(1)]: marketBrief('Sell in a new market', 'ES') },
      pages: [page([company(1, 'Spain Foods', 1)])],
      budget: () => new DomainError('Too many requests. Try again in an hour.', 429),
    });
    const found = await search(h, 'spain', 'all');
    expect(found.scopes).toEqual({ requests: 'ok', companies: 'limited' });
    expect(found.hits.map((hit) => hit.kind)).toEqual(['request']);
    expect(h.calls.companyList).toHaveLength(0);
  });
  test('scope Companies alone is limited, never an empty list, and scope Requests spends nothing', async () => {
    const refused = () => new DomainError('Too many requests. Try again in an hour.', 429);
    const h = harness({ pages: [page([company(1, 'Spain Foods', 1)])], budget: refused });
    expect(await search(h, 'spain', 'companies')).toEqual({
      hits: [],
      scopes: { companies: 'limited' },
    });
    const requests = harness({ rows: [row(1)], budget: refused });
    await search(requests, 'spain', 'requests');
    expect(requests.calls.budget).toHaveLength(0);
  });
  test('a budget that runs out on a later page keeps the earlier companies and is partial', async () => {
    const h = harness({
      pages: [page([company(1, 'Spain Foods', 1)], resourceId(1))],
      budget: (call) => (call === 2 ? new DomainError('Too many requests.', 429) : undefined),
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const found = await search(h, 'spain', 'companies');
    expect(found.scopes).toEqual({ companies: 'partial' });
    expect(found.hits).toHaveLength(1);
    expect(h.calls.companyList).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('sample data is labelled', () => {
  test('a Request and a Company from sample data carry sample: true; real ones do not', async () => {
    const sampleBrief = marketBrief('Sell in a new market', 'ES');
    const h = harness({
      rows: [row(1), row(2, { synthetic: false })],
      briefs: { [requestId(1)]: sampleBrief, [requestId(2)]: sampleBrief },
      pages: [page([company(1, 'Spain Foods', 1)])],
    });
    const found = await search(h, 'spain', 'all', { ...allOn, provenance: () => true });
    expect(found.hits.map((hit) => [hit.kind, hit.sample])).toEqual([
      ['request', true],
      ['request', undefined],
      ['company', true],
    ]);
    const real = harness({
      pages: [page([company(1, 'Spain Foods', 1)], null, { synthetic: false })],
    });
    const hit = (await search(real, 'spain', 'companies', { ...allOn, provenance: () => true }))
      .hits[0]!;
    expect(hit).not.toHaveProperty('sample');
  });
});

describe('failures that must not throw away what was found', () => {
  test('an unexpected Companies failure after Requests answered keeps the Requests hits', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = harness({
      rows: [row(1)],
      briefs: { [requestId(1)]: marketBrief('Sell in a new market', 'ES') },
      pages: [
        () => Promise.reject(Object.assign(new Error('boom secret-words'), { code: '57014' })),
      ],
    });
    const found = await search(h, 'spain', 'all');
    expect(found.scopes).toEqual({ requests: 'ok', companies: 'unavailable' });
    expect(found.hits).toHaveLength(1);
    const lines = spy.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(lines).toEqual([
      {
        event: 'customer_search_scope_failed',
        scope: 'companies',
        correlationId: context.correlationId,
        errorName: 'Error',
        errorCode: '57014',
      },
    ]);
  });
  test('the same failure with Companies alone still ends the search', async () => {
    const error = new Error('boom');
    const h = harness({ pages: [() => Promise.reject(error)] });
    await expect(search(h, 'spain', 'companies')).rejects.toBe(error);
  });
  test('a refusal from Companies still ends the search and drops the Requests hits', async () => {
    const h = harness({
      rows: [row(1)],
      briefs: { [requestId(1)]: marketBrief('Sell in a new market', 'ES') },
      pages: [() => Promise.reject(new DomainError('Account closed', 403, 'account_closed'))],
    });
    await expect(search(h, 'spain', 'all')).rejects.toMatchObject({ code: 'account_closed' });
  });
  test('access that ends while titles are read is denied for Requests, with no rows', async () => {
    const h = harness({
      rows: [row(1), row(2)],
      detail: () => {
        throw Object.assign(new Error('Customer access expired'), { code: '42501' });
      },
    });
    expect(await search(h, 'spain', 'requests')).toEqual({
      hits: [],
      scopes: { requests: 'denied' },
    });
  });
});
