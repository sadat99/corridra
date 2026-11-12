import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index';
import type { RequestContext } from '../../packages/db/src/index';
import { paletteLimits, searchPalette } from '../../apps/web/lib/palette-search';

// The palette's depth and facts (docs/revamp/specs/navigation-v1/command-palette-search.md, section 3 and 4), with
// fake services so the page caps, the page caps, the partial rule and the failure rules are exact. The database
// proof for a role is tests/integration/palette-search.test.ts.
const ctx: RequestContext = {
  token: 't',
  tenantId: '11111111-1111-4111-8111-111111111111',
  purpose: 'synthetic_validation',
  correlationId: 'req-1',
};
const uuid = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mid = (n: number) => uuid('0b5a0001', n);
const cid = (n: number) => uuid('0c5a0001', n);

type MissionRow = Record<string, unknown>;
const mission = (n: number, company: string, over: Partial<MissionRow> = {}): MissionRow => ({
  id: mid(n),
  status: 'TARGETING',
  brief: { company, objective: 'Sell in a new market', market: 'Spain' },
  route_label: null,
  country_code: 'ES',
  ...over,
});
const filler = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, n) => mission(n + offset, `Filler ${n + offset}`));

type Company = Record<string, unknown>;
const company = (
  n: number,
  name: string,
  status = 'UNKNOWN',
  over: Partial<Company> = {},
): Company => ({
  id: cid(n),
  name,
  country: 'ES',
  identity_status: status,
  source_locator: 'https://example.invalid/registry',
  domain: 'secret.example.invalid',
  ...over,
});
const fillerCompanies = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, n) => company(n + offset, `Filler ${n + offset}`));

function fakes(missionRows: MissionRow[], companyRows: Company[]) {
  const calls = { queue: [] as number[], catalogue: [] as unknown[] };
  const services = {
    missions: {
      async queue(_ctx: RequestContext, _filter: 'all', offset: number) {
        calls.queue.push(offset);
        return { missions: missionRows.slice(offset, offset + 100), total: missionRows.length };
      },
    },
    counterparties: {
      async catalogue(_ctx: RequestContext, input: unknown) {
        calls.catalogue.push(input);
        const { q, offset = 0 } = input as { q: string; offset?: number };
        const rows = q
          ? companyRows.filter((row) =>
              String(row.name).toLowerCase().split(/\s+/).includes(q.toLowerCase()),
            )
          : companyRows;
        return { organisations: rows.slice(offset, offset + 50), total: rows.length };
      },
    },
  };
  return { services, calls };
}
const forbidden = () => new DomainError('Access denied', 403);

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => spy.mockRestore());

describe('P6 depth: a target beyond the first page is found', () => {
  test('250 missions, the target at 205: found within 3 pages, nothing partial', async () => {
    const rows = filler(250);
    rows[205] = mission(205, 'Zebra Target Co');
    const { services, calls } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(found.missions.map((hit) => hit.label)).toEqual(['Zebra Target Co']);
    expect(calls.queue).toEqual([0, 100, 200]);
    expect(found.partial).toEqual([]);
  });
  test('a target past the cap is not found and the scope is partial', async () => {
    const rows = filler(400);
    rows[350] = mission(350, 'Zebra Target Co');
    const { services, calls } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(found.missions).toEqual([]);
    expect(found.partial).toEqual(['missions']);
    expect(calls.queue).toHaveLength(paletteLimits.queuePages);
  });
  test('exactly 300 missions with a total of 300 is read completely and is not partial', async () => {
    const rows = filler(300);
    rows[299] = mission(299, 'Zebra Target Co');
    const { services } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(found.missions).toHaveLength(1);
    expect(found.partial).toEqual([]);
  });
  test('220 companies, the target at 160: found by the scan; more exist, so partial', async () => {
    const rows = fillerCompanies(220);
    rows[160] = company(160, 'Zebra Targets Ltd');
    const { services, calls } = fakes([], rows);
    const found = await searchPalette(services, ctx, 'zebra', 'companies');
    expect(found.companies.map((hit) => hit.label)).toEqual(['Zebra Targets Ltd']);
    expect(found.partial).toEqual(['companies']);
    expect(calls.catalogue).toEqual([
      { q: 'zebra' },
      { q: '', offset: 0 },
      { q: '', offset: 50 },
      { q: '', offset: 100 },
      { q: '', offset: 150 },
    ]);
  });
  test('exactly 200 companies is read completely and is not partial', async () => {
    const rows = fillerCompanies(200);
    rows[199] = company(199, 'Zebra Targets Ltd');
    const { services } = fakes([], rows);
    const found = await searchPalette(services, ctx, 'zebra', 'companies');
    expect(found.companies).toHaveLength(1);
    expect(found.partial).toEqual([]);
  });
  test('a whole-word read with more rows than one page is partial', async () => {
    const rows = Array.from({ length: 60 }, (_, n) => company(n, `Zebra ${n}`)).map((row) => ({
      ...row,
      name: 'Plain Zebra',
    }));
    const { services } = fakes([], rows);
    const found = await searchPalette(services, ctx, 'zebra', 'companies');
    expect(found.partial).toEqual(['companies']);
  });
  test('S1 the Acme probe: an exact label on page 2 of 3 is read and ranked first', async () => {
    const rows = filler(300);
    for (let n = 0; n < 5; n++) rows[n] = mission(n, `Acme ${n}`);
    rows[100] = mission(100, 'Acme');
    const { services, calls } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'acme', 'missions');
    expect(calls.queue).toEqual([0, 100, 200]);
    expect(found.missions[0]!.label).toBe('Acme');
    expect(found.missions.map((hit) => hit.label)).toEqual([
      'Acme',
      'Acme 0',
      'Acme 1',
      'Acme 2',
      'Acme 3',
      'Acme 4',
    ]);
    expect(found.partial).toEqual([]);
  });
  test('five exact labels on page 1 with a total of 400 still read to the cap and are partial', async () => {
    const rows = filler(400);
    for (let n = 0; n < 5; n++) rows[n] = mission(n, `Zebra ${n}`);
    const { services, calls } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(calls.queue).toEqual([0, 100, 200]);
    expect(found.missions).toHaveLength(5);
    expect(found.partial).toEqual(['missions']);
  });
  test('five exact labels on page 1 with a total of 300 are read to the end and are not partial', async () => {
    const rows = filler(300);
    for (let n = 0; n < 5; n++) rows[n] = mission(n, `Zebra ${n}`);
    const { services, calls } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(calls.queue).toEqual([0, 100, 200]);
    expect(found.partial).toEqual([]);
  });
  test('company hits on the first scan page do not stop the scan before the cap', async () => {
    const rows = fillerCompanies(220);
    for (let n = 0; n < 6; n++) rows[n] = company(n, `Zebrax Co ${n}`);
    rows[120] = company(120, 'Zebra');
    const { services, calls } = fakes([], rows);
    const found = await searchPalette(services, ctx, 'zebra', 'companies');
    expect(calls.catalogue).toEqual([
      { q: 'zebra' },
      { q: '', offset: 0 },
      { q: '', offset: 50 },
      { q: '', offset: 100 },
      { q: '', offset: 150 },
    ]);
    expect(found.companies[0]!.label).toBe('Zebra');
    expect(found.partial).toEqual(['companies']);
  });
  test('the call bounds hold with no early stop: 3, 5 and 8 for All', async () => {
    const rows = filler(1000);
    for (let n = 0; n < 8; n++) rows[n] = mission(n, `Zebra ${n}`);
    const orgs = fillerCompanies(1000);
    for (let n = 0; n < 8; n++) orgs[n] = company(n, `Zebra ${n}`);
    const { services, calls } = fakes(rows, orgs);
    await searchPalette(services, ctx, 'zebra', 'all');
    expect(calls.queue).toHaveLength(paletteLimits.queuePages);
    expect(calls.catalogue).toHaveLength(1 + paletteLimits.cataloguePages);
    expect(calls.queue.length + calls.catalogue.length).toBe(8);
  });
});

describe('ranking in the search', () => {
  test('a label that starts with the word comes before a detail-only containment', async () => {
    const rows = [
      mission(1, 'Nomad Freight'),
      mission(2, 'Buyer', {
        brief: { company: 'Buyer', objective: 'Sell to Mad Hatter', market: 'Spain' },
      }),
      mission(3, 'Madrid Textiles'),
    ];
    const { services } = fakes(rows, []);
    const found = await searchPalette(services, ctx, 'mad', 'missions');
    expect(found.missions.map((hit) => hit.label)).toEqual([
      'Buyer',
      'Madrid Textiles',
      'Nomad Freight',
    ]);
  });
  test('a typo finds the mission and is marked close; an exact word is not', async () => {
    const { services } = fakes([mission(1, 'Distributor Madrid'), mission(2, 'Tributer Cafe')], []);
    const found = await searchPalette(services, ctx, 'tributer', 'missions');
    expect(found.missions.map((hit) => hit.label)).toEqual(['Tributer Cafe', 'Distributor Madrid']);
    expect(found.facts![`mission:${mid(1)}`]).toEqual({ status: 'TARGETING', close: true });
    expect(found.facts![`mission:${mid(2)}`]).toEqual({ status: 'TARGETING' });
  });
  test('"knit france" does not find "Sell knitwear, Spain"', async () => {
    const rows = [
      mission(1, 'Acme', {
        brief: { company: 'Acme', objective: 'Sell knitwear', market: 'Spain' },
      }),
    ];
    const { services } = fakes(rows, []);
    expect((await searchPalette(services, ctx, 'knit france', 'missions')).missions).toEqual([]);
    expect((await searchPalette(services, ctx, 'knit spain', 'missions')).missions).toHaveLength(1);
  });
  test('equal scores keep the order the service gave', async () => {
    const { services } = fakes(
      [mission(3, 'Madrid B'), mission(1, 'Madrid A'), mission(2, 'Madrid C')],
      [],
    );
    const found = await searchPalette(services, ctx, 'madrid', 'missions');
    expect(found.missions.map((hit) => hit.label)).toEqual(['Madrid B', 'Madrid A', 'Madrid C']);
  });
});

describe('P5 facts beside the hits', () => {
  const rows = [
    company(1, 'Alpha Trading', 'SOURCE_REPORTED'),
    company(2, 'Beta Trading', 'EXPIRED'),
    company(3, 'Gamma Trading', 'UNKNOWN'),
    company(4, 'Delta Trading', 'EXPIRED'),
    company(4, 'Delta Trading', 'SOURCE_REPORTED'),
  ];
  test('SOURCE_REPORTED and EXPIRED are carried, UNKNOWN is not, a current row wins over an expired one', async () => {
    const { services } = fakes([], rows);
    const found = await searchPalette(services, ctx, 'trading', 'companies');
    expect(found.facts).toEqual({
      [`company:${cid(1)}`]: { source: 'SOURCE_REPORTED' },
      [`company:${cid(2)}`]: { source: 'EXPIRED' },
      [`company:${cid(4)}`]: { source: 'SOURCE_REPORTED' },
    });
  });
  test('no locator, domain, address or identifier reaches the answer', async () => {
    const { services } = fakes([], rows);
    const text = JSON.stringify(await searchPalette(services, ctx, 'trading', 'companies'));
    expect(text).not.toContain('example.invalid');
    expect(text).not.toContain('source_locator');
    expect(text).not.toContain('domain');
  });
  test('a hit has an id, a label and a detail and nothing else; the key sets are exact', async () => {
    const { services } = fakes([mission(1, 'Trading Co')], rows);
    const found = await searchPalette(services, ctx, 'trading', 'all');
    for (const hit of [...found.missions, ...found.companies])
      expect(Object.keys(hit).sort()).toEqual(['detail', 'id', 'label']);
    expect(Object.keys(found).sort()).toEqual([
      'companies',
      'denied',
      'facts',
      'missions',
      'partial',
    ]);
    expect(found.missions[0]!.detail).toBe('Sell in a new market · Spain');
    const none = await searchPalette(services, ctx, 'zzzz', 'all');
    expect(Object.keys(none).sort()).toEqual(['companies', 'denied', 'missions', 'partial']);
    expect(none).toEqual({ missions: [], companies: [], denied: [], partial: [] });
  });
  test('a status that is not a status code is not passed on', async () => {
    const { services } = fakes([mission(1, 'Trading Co', { status: '<img onerror>' })], []);
    const found = await searchPalette(services, ctx, 'trading', 'missions');
    expect(found.facts).toBeUndefined();
    expect(found.missions).toHaveLength(1);
  });
  test('a query under two characters, or with no letter or digit, reads nothing', async () => {
    const { services, calls } = fakes(filler(5), fillerCompanies(5));
    for (const query of ['p', ' ', '&&', '-- ..']) {
      const found = await searchPalette(services, ctx, query, 'all');
      expect(found).toEqual({ missions: [], companies: [], denied: [], partial: [] });
      expect(Object.keys(found)).toHaveLength(4);
    }
    expect(calls.queue).toEqual([]);
    expect(calls.catalogue).toEqual([]);
  });
});

describe('M2 the answer is bounded', () => {
  const many = Array.from({ length: 40 }, (_, n) => mission(n, `Madrid ${n}`));
  const manyCompanies = Array.from({ length: 40 }, (_, n) =>
    company(n, `Madrid ${n}`, 'SOURCE_REPORTED'),
  );
  test('5 per scope under All and 10 for a single scope; facts never outnumber hits', async () => {
    const { services } = fakes(many, manyCompanies);
    const all = await searchPalette(services, ctx, 'madrid', 'all');
    expect(all.missions).toHaveLength(paletteLimits.showAll);
    expect(all.companies).toHaveLength(paletteLimits.showAll);
    expect(Object.keys(all.facts!).length).toBeLessThanOrEqual(10);
    const one = await searchPalette(services, ctx, 'madrid', 'missions');
    expect(one.missions).toHaveLength(paletteLimits.showScope);
    expect(Object.keys(one.facts!).length).toBeLessThanOrEqual(10);
    const onlyCompanies = await searchPalette(services, ctx, 'madrid', 'companies');
    expect(onlyCompanies.companies).toHaveLength(paletteLimits.showScope);
  });
});

describe('D1 and D2 a refused read is denied, never empty', () => {
  test('missions refused: companies still answer', async () => {
    const { services } = fakes([], [company(1, 'Madrid Co')]);
    services.missions.queue = async () => {
      throw forbidden();
    };
    const found = await searchPalette(services, ctx, 'madrid', 'all');
    expect(found.denied).toEqual(['missions']);
    expect(found.companies).toHaveLength(1);
    expect(found.missions).toEqual([]);
  });
  test('companies refused: missions still answer', async () => {
    const { services } = fakes([mission(1, 'Madrid Co')], []);
    services.counterparties.catalogue = async () => {
      throw forbidden();
    };
    const found = await searchPalette(services, ctx, 'madrid', 'all');
    expect(found.denied).toEqual(['companies']);
    expect(found.missions).toHaveLength(1);
  });
  test('both refused (another workspace): both denied in a fixed order, no rows, four keys', async () => {
    const { services } = fakes([], []);
    services.missions.queue = async () => {
      throw forbidden();
    };
    services.counterparties.catalogue = async () => {
      throw forbidden();
    };
    const found = await searchPalette(services, ctx, 'madrid', 'all');
    expect(found).toEqual({
      missions: [],
      companies: [],
      denied: ['missions', 'companies'],
      partial: [],
    });
    expect(Object.keys(found)).toHaveLength(4);
  });
  test('a role refused on a later page gets nothing from that scope', async () => {
    const rows = filler(250);
    rows[10] = mission(10, 'Zebra Early');
    const { services } = fakes(rows, []);
    const real = services.missions.queue;
    services.missions.queue = async (c, f, offset) => {
      if (offset >= 100) throw forbidden();
      return real(c, f, offset);
    };
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(found.denied).toEqual(['missions']);
    expect(found.missions).toEqual([]);
    expect(found.partial).toEqual([]);
    expect(found.facts).toBeUndefined();
  });
});

describe('R2 and D6 other failures', () => {
  test('a later page failing keeps the earlier hits, marks the scope partial and logs no query', async () => {
    const rows = filler(250);
    rows[10] = mission(10, 'Zebra Early');
    const { services } = fakes(rows, []);
    const real = services.missions.queue;
    services.missions.queue = async (c, f, offset) => {
      if (offset >= 100) throw new Error('database timeout for zebra');
      return real(c, f, offset);
    };
    const found = await searchPalette(services, ctx, 'zebra', 'missions');
    expect(found.missions.map((hit) => hit.label)).toEqual(['Zebra Early']);
    expect(found.partial).toEqual(['missions']);
    expect(found.denied).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({
      event: 'palette_search_page_failed',
      scope: 'missions',
      page: 1,
      correlationId: 'req-1',
      errorName: 'Error',
    });
    expect(line).not.toContain('zebra');
  });
  test('N11 the log line names the kind of error and its code, never its message or the query', async () => {
    const rows = filler(250);
    rows[10] = mission(10, 'Zebra Early');
    const { services } = fakes(rows, []);
    const real = services.missions.queue;
    services.missions.queue = async (c, f, offset) => {
      if (offset >= 100)
        throw Object.assign(new TypeError('relation of zebra is missing'), { code: '57014' });
      return real(c, f, offset);
    };
    await searchPalette(services, ctx, 'zebra', 'missions');
    const line = String(spy.mock.calls[0]![0]);
    expect(JSON.parse(line)).toEqual({
      event: 'palette_search_page_failed',
      scope: 'missions',
      page: 1,
      correlationId: 'req-1',
      errorName: 'TypeError',
      errorCode: '57014',
    });
    expect(line).not.toContain('zebra');
    expect(line).not.toContain('missing');
  });
  test('a company scan page failing keeps the whole-word hits and marks companies partial', async () => {
    const { services } = fakes([], [company(1, 'Zebra Ltd'), ...fillerCompanies(120, 10)]);
    const real = services.counterparties.catalogue;
    services.counterparties.catalogue = async (c, input) => {
      if ((input as { offset?: number }).offset === 50) throw new Error('boom');
      return real(c, input);
    };
    const found = await searchPalette(services, ctx, 'zebra', 'companies');
    expect(found.companies.map((hit) => hit.label)).toEqual(['Zebra Ltd']);
    expect(found.partial).toEqual(['companies']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).not.toContain('zebra');
  });
  test('a failure on the first read of a scope is thrown, not hidden', async () => {
    const { services } = fakes([], []);
    services.missions.queue = async () => {
      throw new Error('boom');
    };
    await expect(searchPalette(services, ctx, 'zebra', 'all')).rejects.toThrow('boom');
    const second = fakes([], []);
    second.services.counterparties.catalogue = async () => {
      throw new Error('boom');
    };
    await expect(searchPalette(second.services, ctx, 'zebra', 'companies')).rejects.toThrow('boom');
  });
});
