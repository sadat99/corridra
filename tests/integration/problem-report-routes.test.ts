import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { tracing, watching } from './problem-report-support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { DomainError } from '../../packages/domain/src/index';
import { limitWords } from '../../apps/web/lib/account-limit';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import {
  CustomerProblemReports,
  StaffProblemReports,
  TeamProblemReports,
  resetProblemReportProbe,
  resetSelfRemovalProbe,
} from '../../packages/auth/src/problem-reports';
import { resetClosedAccountGateCache } from '../../packages/auth/src/customer-account-gate';

// ADR-078 PR2, the two routes over the real services, the real database and the real restricted roles. The customer
// route reads only the customer session and the team route only the operator session, so a session of the other kind is
// signed out for that route. Every refusal leaves the database alone, and only whitelisted fields leave a route.
const live = vi.hoisted(() => ({
  person: null as string | null,
  token: null as string | null,
  customer: null as unknown,
  team: null as unknown,
  staff: null as unknown,
  getSession: vi.fn(),
  readCustomer: vi.fn(),
  budget: vi.fn(),
  lifecycle: true,
}));
const web = createRequire(resolve('apps/web/package.json'));
const lifecycleFile = web.resolve('@corridra/auth/customer-account-lifecycle');
// The existing account lifecycle switch, the one the erasure queue route follows, read at the time of each call.
vi.doMock(lifecycleFile, async () => ({
  ...(await vi.importActual<Record<string, unknown>>(lifecycleFile)),
  customerAccountLifecycleEnabled: () => live.lifecycle,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    provider: { getSession: live.getSession },
    missions: { budget: live.budget },
    customerProblemReports: live.customer,
    teamProblemReports: live.team,
    staffProblemReports: live.staff,
  }),
}));

let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
// Every query that reaches a report function or the catalogue probe, so a test can show none was asked.
const reportQueries: string[] = [];
// Every connection and query of the runtime pool, in order, with a marker pushed when a request body is read.
const trace: string[] = [];
const reportCalls = /problem_report|pg_catalog\.pg_proc/;
const customerRoute = async () =>
  await import('../../apps/web/app/api/customer-problem-reports/route');
const teamRoute = async () =>
  await import('../../apps/web/app/api/workspace/problem-reports/route');
const origin = 'https://app.corridra.test';
const customerUrl = (query = '') => `${origin}/api/customer-problem-reports${query}`;
const teamUrl = (query = '', tenant: string = f.tenantA) =>
  `${origin}/api/workspace/problem-reports?tenant=${tenant}${query}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const filing = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  category: 'did_not_work',
  pageKind: 'this_page',
  page: '/account/requests',
  ...over,
});
const teamFiling = (over: Record<string, unknown> = {}) =>
  filing({ action: 'file', page: '/operator/requests', ...over });
const customerAs = (person: string | null) => {
  live.person = person;
};
const teamAs = (who: string | null) => {
  live.token = who ? f.users[who]!.token : null;
};
const answer = async (response: Response) => ({
  status: response.status,
  headers: response.headers,
  body: await response.json(),
});
const count = async () =>
  (await f.owner.query('SELECT count(*)::int AS n FROM customer_private.problem_report')).rows[0]
    .n as number;
const staleAuthenticator = (who: string, stale: boolean) =>
  f.owner.query(
    `UPDATE identity.assurance SET verified_at=${stale ? "now()-interval '1 hour'" : 'now()'} WHERE session_id=$1`,
    [f.users[who]!.sessionId],
  );

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'prrt');
  ids = await h.admit([
    'ann',
    'ben',
    'cat',
    'dan',
    'eve',
    'fay',
    'gus',
    'hal',
    'ivy',
    'jon',
    'kim',
  ]);
  for (const person of ['ann', 'cat', 'dan', 'eve', 'fay'])
    await h.provision(person, `Synthetic ${person} workspace`);
  await migrateCustomerProblemReports(f.owner);
  live.readCustomer.mockImplementation(async () => (live.person ? h.session(live.person) : null));
  const runtime = tracing(watching(f.runtime, reportQueries, undefined, reportCalls), trace);
  live.customer = new CustomerProblemReports(runtime, f.auth, options, live.readCustomer);
  live.team = new TeamProblemReports(runtime);
  live.staff = new StaffProblemReports(runtime);
  resetProblemReportProbe();
  resetSelfRemovalProbe();
});
beforeEach(() => {
  trace.length = 0;
  live.lifecycle = true;
  customerAs(null);
  teamAs(null);
  live.getSession
    .mockReset()
    .mockImplementation(async () => (live.token ? { token: live.token } : null));
  live.budget.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  await f?.close();
});

describe('the customer route', () => {
  test('signed out, every method answers 401 and nothing is filed', async () => {
    const { GET, POST } = await customerRoute();
    const before = await count();
    for (const response of [
      await GET(new Request(customerUrl())),
      await GET(new Request(customerUrl('?reference=RP-000001'))),
      await POST(post(customerUrl(), filing())),
    ])
      expect(response.status).toBe(401);
    expect(await count()).toBe(before);
  });

  test('signed out is a 401 whatever the request looks like: nothing the caller sent is checked first', async () => {
    const { GET, POST } = await customerRoute();
    const before = await count();
    const long = 'x'.repeat(65);
    for (const response of [
      await GET(new Request(customerUrl(`?reference=${long}`))),
      await GET(new Request(customerUrl('?reference='))),
      await GET(new Request(customerUrl('?reference=RP-1%00'))),
      await GET(new Request(customerUrl('?reference=RP-1&pageSize=2'))),
      await GET(new Request(customerUrl('?pageSize=0'))),
      await GET(new Request(customerUrl('?personId=x'))),
      await POST(post(customerUrl(), '{not json')),
      await POST(post(customerUrl(), filing({ personId: 'x' }))),
      await POST(post(customerUrl(), filing({ detail: 'x'.repeat(9000) }))),
      await POST(post(customerUrl(), filing(), { 'content-type': 'text/plain' })),
    ])
      expect(response.status).toBe(401);
    // the request budget is spent only for a signed-in caller
    expect(live.budget).not.toHaveBeenCalled();
    expect(await count()).toBe(before);
  });

  test('signed in, a malformed reference is the same 404 as an unknown one and asks the database nothing', async () => {
    const { GET } = await customerRoute();
    customerAs('ann');
    const unknown = await answer(await GET(new Request(customerUrl('?reference=RP-999999'))));
    expect(unknown.status).toBe(404);
    reportQueries.length = 0;
    for (const reference of ['x'.repeat(65), '', 'RP-1%00']) {
      const malformed = await answer(
        await GET(new Request(customerUrl(`?reference=${reference}`))),
      );
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual(unknown.body);
    }
    expect(reportQueries).toEqual([]);
    // a well-formed reference does reach the database, so the empty list above is not an artefact
    await GET(new Request(customerUrl('?reference=RP-999999')));
    expect(reportQueries.length).toBeGreaterThan(0);
  });

  describe('the body is read before any database connection is taken', () => {
    // A body that writes down in the trace when something starts to read it. highWaterMark 0 means it is not pulled early.
    const watched = (text: string, headers: Record<string, string> = {}) => {
      const bytes = new TextEncoder().encode(text);
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            trace.push('body');
            controller.enqueue(bytes);
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      return new Request(customerUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, ...headers },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
    };

    test('an invalid body ends the request with no connection and no query', async () => {
      customerAs('ann');
      const { POST } = await customerRoute();
      const before = await count();
      const cases: [string, Request, number][] = [
        ['bad JSON', post(customerUrl(), '{not json'), 400],
        ['an unknown key', post(customerUrl(), filing({ personId: 'x' })), 400],
        ['a wrong type', post(customerUrl(), filing({ category: 5 })), 400],
        ['an empty page', post(customerUrl(), filing({ page: '' })), 400],
        ['an oversized body', post(customerUrl(), filing({ detail: 'x'.repeat(9000) })), 413],
        ['not JSON', post(customerUrl(), filing(), { 'content-type': 'text/plain' }), 415],
      ];
      for (const [name, request, status] of cases) {
        trace.length = 0;
        expect((await POST(request)).status, name).toBe(status);
        expect(trace, name).toEqual([]);
      }
      expect(await count()).toBe(before);
    });

    test('the body is consumed before the first connection, and a valid body files as before', async () => {
      customerAs('ann');
      const { POST } = await customerRoute();
      const response = await answer(await POST(watched(JSON.stringify(filing()))));
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'received', changed: true });
      expect(trace.indexOf('body')).toBeGreaterThanOrEqual(0);
      expect(trace.indexOf('connect')).toBeGreaterThan(trace.indexOf('body'));
      expect(trace.indexOf('query')).toBeGreaterThan(trace.indexOf('body'));
      // the budget was spent after the session and before the body
      expect(live.budget).toHaveBeenCalledTimes(1);
    });

    test('signed out is a 401 and the body is never read, valid or not', async () => {
      const { POST } = await customerRoute();
      for (const text of ['{not json', JSON.stringify(filing()), 'x'.repeat(9000)]) {
        trace.length = 0;
        expect((await POST(watched(text))).status).toBe(401);
        expect(trace).toEqual([]);
      }
      expect(live.budget).not.toHaveBeenCalled();
    });

    test('a refused origin is answered before the session and the body', async () => {
      customerAs('ann');
      const { POST } = await customerRoute();
      expect(
        (await POST(watched(JSON.stringify(filing()), { origin: 'https://evil.invalid' }))).status,
      ).toBe(403);
      expect(trace).toEqual([]);
    });
  });

  test('a team session does not sign a customer in: the customer route never reads the operator session', async () => {
    teamAs('owner');
    const { GET, POST } = await customerRoute();
    expect((await GET(new Request(customerUrl()))).status).toBe(401);
    expect((await POST(post(customerUrl(), filing()))).status).toBe(401);
    expect(live.getSession).not.toHaveBeenCalled();
  });

  test('files, answers with private headers, and a retry is the same report', async () => {
    customerAs('ann');
    const { POST } = await customerRoute();
    const input = filing({ detail: 'The save button did nothing.' });
    const first = await answer(await POST(post(customerUrl(), input)));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('referrer-policy')).toBe('no-referrer');
    expect(first.body).toEqual({
      reference: expect.stringMatching(/^RP-\d{6}$/),
      status: 'received',
      filedAt: expect.any(String),
      changed: true,
    });
    const before = await count();
    const again = await answer(await POST(post(customerUrl(), input)));
    expect(again.body).toEqual({ ...first.body, changed: false });
    expect(await count()).toBe(before);
    const conflict = await answer(
      await POST(post(customerUrl(), { ...input, category: 'words_wrong' })),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('Command conflicts with original request');
    expect(await count()).toBe(before);
  });

  test('the list and the detail carry exactly the whitelisted fields', async () => {
    customerAs('ann');
    const { GET, POST } = await customerRoute();
    const filed = await answer(
      await POST(post(customerUrl(), filing({ detail: 'Words the reporter wrote.' }))),
    );
    const list = await answer(await GET(new Request(customerUrl())));
    expect(list.status).toBe(200);
    expect(Object.keys(list.body).sort()).toEqual(['items', 'nextBefore']);
    expect(Object.keys(list.body.items[0]).sort()).toEqual([
      'category',
      'filedAt',
      'number',
      'reference',
      'status',
      'updatedAt',
      'wordsRemoved',
    ]);
    const detail = await answer(
      await GET(new Request(customerUrl(`?reference=${filed.body.reference}`))),
    );
    expect(detail.status).toBe(200);
    expect(Object.keys(detail.body).sort()).toEqual([
      'category',
      'filedAt',
      'history',
      'reference',
      'status',
      'updatedAt',
      'words',
    ]);
    expect(detail.body.words).toEqual({
      pageKind: 'this_page',
      page: '/account/requests',
      detail: 'Words the reporter wrote.',
    });
    expect(Object.keys(detail.body.history[0]).sort()).toEqual(['createdAt', 'note', 'state']);
    const text = JSON.stringify([list.body, detail.body]);
    for (const secret of [ids.ann!, f.tenantA, 'side', 'principal'])
      expect(text).not.toContain(secret);
  });

  test('pages with a cursor while a full page came back', async () => {
    customerAs('eve');
    const { GET, POST } = await customerRoute();
    for (let n = 0; n < 3; n++) await POST(post(customerUrl(), filing()));
    const first = await answer(await GET(new Request(customerUrl('?pageSize=2'))));
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextBefore).toBe(first.body.items[1].number);
    const next = await answer(
      await GET(new Request(customerUrl(`?pageSize=2&beforeNumber=${first.body.nextBefore}`))),
    );
    expect(next.body.items).toHaveLength(1);
    expect(next.body.nextBefore).toBeNull();
  });

  test('another person, an unknown and a malformed reference answer the same 404 body', async () => {
    customerAs('ann');
    const { GET, POST } = await customerRoute();
    const mine = await answer(await POST(post(customerUrl(), filing())));
    customerAs('fay');
    const answers = [
      await answer(await GET(new Request(customerUrl(`?reference=${mine.body.reference}`)))),
      await answer(await GET(new Request(customerUrl('?reference=RP-999999')))),
      await answer(await GET(new Request(customerUrl(`?reference=${'x'.repeat(65)}`)))),
      await answer(await GET(new Request(customerUrl('?reference=')))),
    ];
    for (const item of answers) {
      expect(item.status).toBe(404);
      expect(item.body).toEqual({ error: 'Problem report not found' });
    }
  });

  test('a person with no workspace files and reads; a closed account reads and cannot file', async () => {
    const { GET, POST } = await customerRoute();
    customerAs('ben');
    expect((await POST(post(customerUrl(), filing()))).status).toBe(200);
    expect((await answer(await GET(new Request(customerUrl())))).body.items).toHaveLength(1);
    customerAs('dan');
    expect((await POST(post(customerUrl(), filing()))).status).toBe(200);
    await f.owner.query(
      `WITH t AS (SELECT clock_timestamp() AS at)
       INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       SELECT $1,'closed',t.at,t.at+interval '720 hours',$2 FROM t`,
      [ids.dan, randomUUID()],
    );
    const before = await count();
    const refused = await answer(await POST(post(customerUrl(), filing())));
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'That account is closed', code: 'account_closed' });
    expect(await count()).toBe(before);
    expect((await answer(await GET(new Request(customerUrl())))).body.items).toHaveLength(1);
  });

  test('refuses another origin, a body that is not JSON, a large body, bad JSON and any key that names a person', async () => {
    customerAs('ann');
    const { POST } = await customerRoute();
    const before = await count();
    expect(
      (await POST(post(customerUrl(), filing(), { origin: 'https://evil.invalid' }))).status,
    ).toBe(403);
    expect(
      (await POST(post(customerUrl(), filing(), { 'content-type': 'text/plain' }))).status,
    ).toBe(415);
    expect((await POST(post(customerUrl(), filing({ detail: 'x'.repeat(9000) })))).status).toBe(
      413,
    );
    expect((await POST(post(customerUrl(), '{not json'))).status).toBe(400);
    for (const key of ['personId', 'principalId', 'reporterKind', 'side', 'tenantId'])
      expect((await POST(post(customerUrl(), filing({ [key]: ids.ann })))).status).toBe(400);
    expect(
      (await POST(post(customerUrl(), filing({ category: 'something_else', detail: 'short' }))))
        .status,
    ).toBe(400);
    expect(await count()).toBe(before);
  });

  test('refuses an unknown query key', async () => {
    customerAs('ann');
    const { GET } = await customerRoute();
    for (const query of [
      '?personId=x',
      '?reference=RP-1&pageSize=2',
      '?pageSize=0',
      '?pageSize=101',
    ])
      expect((await GET(new Request(customerUrl(query)))).status).toBe(400);
  });

  test('the eleventh filing is a 429 that says the shared limit words, and the limit is checked before filing', async () => {
    customerAs('cat');
    const { POST } = await customerRoute();
    for (let n = 0; n < 10; n++)
      expect((await POST(post(customerUrl(), filing()))).status).toBe(200);
    const before = await count();
    const refused = await answer(await POST(post(customerUrl(), filing())));
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: limitWords, code: 'limit' });
    expect(await count()).toBe(before);
    // the request budget of the route is the same budget the account lifecycle uses
    expect(live.budget).toHaveBeenCalledWith('local');
    live.budget.mockRejectedValueOnce(new DomainError('Too many requests', 429));
    const budgeted = await answer(await POST(post(customerUrl(), filing())));
    expect(budgeted.status).toBe(429);
    expect(budgeted.body.error).toBe(limitWords);
  });
});

describe('the team route', () => {
  test('signed out, every method answers 401 and nothing is filed', async () => {
    const { GET, POST } = await teamRoute();
    const before = await count();
    for (const response of [
      await GET(new Request(teamUrl())),
      await GET(new Request(teamUrl('&view=queue'))),
      await POST(post(teamUrl(), teamFiling())),
    ])
      expect(response.status).toBe(401);
    expect(await count()).toBe(before);
  });

  test('signed out is a 401 whatever the request looks like: the tenant, the query and the body are read after the session', async () => {
    const { GET, POST } = await teamRoute();
    const before = await count();
    const long = 'x'.repeat(65);
    for (const response of [
      await GET(new Request(`${origin}/api/workspace/problem-reports`)),
      await GET(new Request(teamUrl(`&reference=${long}`))),
      await GET(new Request(teamUrl('&reference='))),
      await GET(new Request(teamUrl('&view=queue&pageSize=0'))),
      await GET(new Request(teamUrl('&view=other'))),
      await GET(new Request(teamUrl('', 'not-a-uuid'))),
      await POST(post(teamUrl(), '{not json')),
      await POST(post(teamUrl(), { action: 'delete' })),
      await POST(post(teamUrl(), teamFiling({ detail: 'x'.repeat(9000) }))),
      await POST(post(teamUrl(), teamFiling(), { 'content-type': 'text/plain' })),
    ])
      expect(response.status).toBe(401);
    expect(await count()).toBe(before);
  });

  test('signed in, a malformed reference is the same 404 as an unknown one and asks the database nothing', async () => {
    const { GET } = await teamRoute();
    teamAs('operator');
    const unknown = await answer(await GET(new Request(teamUrl('&reference=RP-999999'))));
    expect(unknown.status).toBe(404);
    reportQueries.length = 0;
    for (const reference of ['x'.repeat(65), '', 'RP-1%00']) {
      const malformed = await answer(await GET(new Request(teamUrl(`&reference=${reference}`))));
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual(unknown.body);
    }
    expect(reportQueries).toEqual([]);
    await GET(new Request(teamUrl('&reference=RP-999999')));
    expect(reportQueries.length).toBeGreaterThan(0);
  });

  test('a customer session does not sign a team member in: the team route never reads the customer session', async () => {
    customerAs('ann');
    const { GET, POST } = await teamRoute();
    expect((await GET(new Request(teamUrl()))).status).toBe(401);
    expect((await POST(post(teamUrl(), teamFiling()))).status).toBe(401);
    expect(live.readCustomer).not.toHaveBeenCalled();
  });

  test('a team member files, lists and reads; the shapes are whitelisted', async () => {
    teamAs('operator');
    const { GET, POST } = await teamRoute();
    const filed = await answer(
      await POST(post(teamUrl(), teamFiling({ detail: 'The meetings page was empty.' }))),
    );
    expect(filed.status).toBe(200);
    expect(filed.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(filed.body).sort()).toEqual(['changed', 'filedAt', 'reference', 'status']);
    const list = await answer(await GET(new Request(teamUrl())));
    expect(list.status).toBe(200);
    expect(list.body.items[0].reference).toBe(filed.body.reference);
    expect(Object.keys(list.body.items[0]).sort()).toEqual([
      'category',
      'filedAt',
      'number',
      'reference',
      'status',
      'updatedAt',
      'wordsRemoved',
    ]);
    const detail = await answer(
      await GET(new Request(teamUrl(`&reference=${filed.body.reference}`))),
    );
    expect(detail.body.words).toEqual({
      pageKind: 'this_page',
      page: '/operator/requests',
      detail: 'The meetings page was empty.',
    });
    expect(JSON.stringify([list.body, detail.body])).not.toContain(f.users.operator!.id);
    teamAs('reviewer');
    expect(
      (await answer(await GET(new Request(teamUrl(`&reference=${filed.body.reference}`))))).status,
    ).toBe(404);
  });

  test('the customer path is not a team path: a customer page address is refused for a team member', async () => {
    teamAs('operator');
    const { POST } = await teamRoute();
    expect((await POST(post(teamUrl(), teamFiling({ page: '/account/requests' })))).status).toBe(
      400,
    );
  });

  test('the queue and the moves belong to owners and admins; the queue carries only whitelisted fields', async () => {
    const { GET, POST } = await teamRoute();
    teamAs('operator');
    const filed = await answer(await POST(post(teamUrl(), teamFiling())));
    for (const who of ['operator', 'reviewer', 'viewer']) {
      teamAs(who);
      expect((await GET(new Request(teamUrl('&view=queue')))).status).toBe(403);
      expect(
        (
          await POST(
            post(teamUrl(), {
              action: 'transition',
              commandId: randomUUID(),
              reportId: randomUUID(),
              expectedState: 'received',
              toState: 'in_review',
            }),
          )
        ).status,
      ).toBe(403);
    }
    teamAs('owner');
    const queue = await answer(await GET(new Request(teamUrl('&view=queue&pageSize=100'))));
    expect(queue.status).toBe(200);
    expect(Object.keys(queue.body).sort()).toEqual([
      'counts',
      'items',
      'nextAfter',
      'oldestReceivedAt',
      'total',
    ]);
    const item = queue.body.items.find(
      (row: { reference: string }) => row.reference === filed.body.reference,
    );
    expect(item).toMatchObject({ reporterKind: 'team', side: 'sample', status: 'received' });
    expect(Object.keys(item).sort()).toEqual([
      'category',
      'detail',
      'filedAt',
      'history',
      'id',
      'number',
      'page',
      'pageKind',
      'reference',
      'reporterKind',
      'side',
      'status',
      'updatedAt',
      'wordsRemoved',
    ]);
    const move = (over: Record<string, unknown>) =>
      post(teamUrl(), {
        action: 'transition',
        commandId: randomUUID(),
        reportId: item.id,
        expectedState: 'received',
        toState: 'in_review',
        ...over,
      });
    const reviewed = await answer(await POST(move({})));
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toEqual({
      id: item.id,
      reference: filed.body.reference,
      status: 'in_review',
      note: null,
      changed: true,
    });
    const stale = await answer(await POST(move({})));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('This problem report has changed. Reload and try again');
    expect((await POST(move({ expectedState: 'in_review', toState: 'resolved' }))).status).toBe(
      400,
    );
    const resolved = await answer(
      await POST(
        move({
          expectedState: 'in_review',
          toState: 'resolved',
          note: 'Fixed in the latest release.',
        }),
      ),
    );
    expect(resolved.body).toMatchObject({
      status: 'resolved',
      note: 'Fixed in the latest release.',
    });
    teamAs('operator');
    const read = await answer(
      await GET(new Request(teamUrl(`&reference=${filed.body.reference}`))),
    );
    expect(read.body.history.map((row: { state: string }) => row.state)).toEqual([
      'received',
      'in_review',
      'resolved',
    ]);
  });

  test('a stale authenticator answers 401 with the step-up code on the queue, a move and a word removal', async () => {
    const { GET, POST } = await teamRoute();
    teamAs('owner');
    await staleAuthenticator('owner', true);
    for (const response of [
      await GET(new Request(teamUrl('&view=queue'))),
      await POST(
        post(teamUrl(), {
          action: 'transition',
          commandId: randomUUID(),
          reportId: randomUUID(),
          expectedState: 'received',
          toState: 'in_review',
        }),
      ),
      await POST(
        post(teamUrl(), {
          action: 'remove_words',
          commandId: randomUUID(),
          erasureRequestId: randomUUID(),
        }),
      ),
    ]) {
      const refused = await answer(response);
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('STEP_UP_REQUIRED');
    }
    await staleAuthenticator('owner', false);
    expect((await GET(new Request(teamUrl('&view=queue')))).status).toBe(200);
  });

  test('word removal is refused for an unknown erasure request and for an admin', async () => {
    const { POST } = await teamRoute();
    teamAs('owner');
    const missing = await answer(
      await POST(
        post(teamUrl(), {
          action: 'remove_words',
          commandId: randomUUID(),
          erasureRequestId: randomUUID(),
        }),
      ),
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('Erasure request not found');
    await rawContext(
      f.runtime,
      f.users.owner!.ctx,
      "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [f.tenantA, f.users.other!.id],
    );
    teamAs('other');
    const denied = await answer(
      await POST(
        post(teamUrl('', f.tenantA), {
          action: 'remove_words',
          commandId: randomUUID(),
          erasureRequestId: randomUUID(),
        }),
      ),
    );
    expect(denied.status).toBe(403);
  });

  describe('removing words follows the account lifecycle switch, and nothing else does', () => {
    const removal = () =>
      post(teamUrl(), {
        action: 'remove_words',
        commandId: randomUUID(),
        erasureRequestId: randomUUID(),
      });
    const staff = () => live.staff as StaffProblemReports;

    test('with the switch off it answers 503 before any service call', async () => {
      const removeWords = vi.spyOn(staff(), 'removeWords');
      live.lifecycle = false;
      teamAs('owner');
      const { POST } = await teamRoute();
      const refused = await answer(await POST(removal()));
      expect(refused.status).toBe(503);
      expect(refused.body).toEqual({ error: 'Word removal is unavailable' });
      expect(removeWords).not.toHaveBeenCalled();
      removeWords.mockRestore();
    });

    test('signed out still answers 401 and another origin 403 with the switch off', async () => {
      const removeWords = vi.spyOn(staff(), 'removeWords');
      live.lifecycle = false;
      const { POST } = await teamRoute();
      expect((await POST(removal())).status).toBe(401);
      teamAs('owner');
      expect((await POST(post(teamUrl(), {}, { origin: 'https://evil.invalid' }))).status).toBe(
        403,
      );
      expect(removeWords).not.toHaveBeenCalled();
      removeWords.mockRestore();
    });

    test('with the switch on the service is called and the database answers', async () => {
      const removeWords = vi.spyOn(staff(), 'removeWords');
      teamAs('owner');
      const { POST } = await teamRoute();
      const answered = await answer(await POST(removal()));
      expect(removeWords).toHaveBeenCalledTimes(1);
      expect(answered.status).toBe(404);
      expect(answered.body.error).toBe('Erasure request not found');
      removeWords.mockRestore();
    });

    test('filing, reading and triage work with the switch off', async () => {
      live.lifecycle = false;
      const { GET, POST } = await teamRoute();
      teamAs('operator');
      const filed = await answer(await POST(post(teamUrl(), teamFiling())));
      expect(filed.status).toBe(200);
      expect((await GET(new Request(teamUrl()))).status).toBe(200);
      teamAs('owner');
      expect((await GET(new Request(teamUrl('&view=queue')))).status).toBe(200);
      const queue = await answer(await GET(new Request(teamUrl('&view=queue&pageSize=100'))));
      const row = queue.body.items.find(
        (item: { reference: string }) => item.reference === filed.body.reference,
      );
      const moved = await answer(
        await POST(
          post(teamUrl(), {
            action: 'transition',
            commandId: randomUUID(),
            reportId: row.id,
            expectedState: 'received',
            toState: 'in_review',
          }),
        ),
      );
      expect(moved.status).toBe(200);
    });
  });

  test('refuses another origin, a body that is not JSON, a large body, unknown actions and any key that names a person', async () => {
    teamAs('operator');
    const { GET, POST } = await teamRoute();
    const before = await count();
    expect(
      (await POST(post(teamUrl(), teamFiling(), { origin: 'https://evil.invalid' }))).status,
    ).toBe(403);
    expect(
      (await POST(post(teamUrl(), teamFiling(), { 'content-type': 'text/plain' }))).status,
    ).toBe(415);
    expect((await POST(post(teamUrl(), teamFiling({ detail: 'x'.repeat(9000) })))).status).toBe(
      413,
    );
    expect((await POST(post(teamUrl(), '{not json'))).status).toBe(400);
    expect((await POST(post(teamUrl(), { action: 'delete' }))).status).toBe(400);
    expect((await POST(post(teamUrl(), filing()))).status).toBe(400);
    for (const key of ['personId', 'reporterKind', 'side', 'staffTenantId'])
      expect((await POST(post(teamUrl(), teamFiling({ [key]: ids.ann })))).status).toBe(400);
    expect((await GET(new Request(`${origin}/api/workspace/problem-reports`))).status).toBe(400);
    expect((await GET(new Request(teamUrl('', 'not-a-uuid')))).status).toBe(400);
    expect((await GET(new Request(teamUrl('&view=other')))).status).toBe(400);
    expect((await GET(new Request(teamUrl('&view=queue&reference=RP-1')))).status).toBe(400);
    expect((await GET(new Request(teamUrl('&personId=x')))).status).toBe(400);
    expect(await count()).toBe(before);
  });

  test('the eleventh filing in 24 hours is a 429 that says the shared limit words', async () => {
    teamAs('viewer');
    const { POST } = await teamRoute();
    const filedAlready = (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM customer_private.problem_report WHERE staff_principal_id=$1',
        [f.users.viewer!.id],
      )
    ).rows[0].n as number;
    for (let n = filedAlready; n < 10; n++)
      expect((await POST(post(teamUrl(), teamFiling()))).status).toBe(200);
    const refused = await answer(await POST(post(teamUrl(), teamFiling())));
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: limitWords, code: 'limit' });
  });
});

// ADR-078 decision 6 as amended by migration 0003: the customer route's POST also removes the words of the signed-in
// person's own reports (action remove_words, a command id and nothing else). It follows the order of a filing: the origin,
// the session, the request budget, the body read and checked, and only then a database connection. The stages of the install
// (503 until 0003) are in problem-report-only-0001.test.ts, and the service in problem-report-services.test.ts.
describe('the customer route removes the words of the person own reports', () => {
  const removal = (over: Record<string, unknown> = {}) => ({
    action: 'remove_words',
    commandId: randomUUID(),
    ...over,
  });
  const wordsOf = async (person: string) =>
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM customer_private.problem_report_words w JOIN customer_private.problem_report r ON r.id=w.report_id WHERE r.customer_principal_id=$1',
        [ids[person]],
      )
    ).rows[0].n as number;
  const selfRows = async () =>
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM customer_private.problem_report_self_removal',
      )
    ).rows[0].n as number;
  const file = async (person: string, detail: string) => {
    customerAs(person);
    const { POST } = await customerRoute();
    const response = await POST(post(customerUrl(), filing({ detail })));
    expect(response.status).toBe(200);
    return ((await response.json()) as { reference: string }).reference;
  };

  test('signed out is a 401 whatever the body, and the body is never read and the budget never spent', async () => {
    await file('gus', 'Words of gus.');
    const { POST } = await customerRoute();
    customerAs(null);
    live.budget.mockClear();
    const before = { words: await wordsOf('gus'), rows: await selfRows() };
    for (const text of [
      JSON.stringify(removal()),
      '{not json',
      'x'.repeat(9000),
      JSON.stringify(removal({ personId: 'x' })),
    ]) {
      trace.length = 0;
      const response = await POST(
        new Request(customerUrl(), {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          body: text,
        }),
      );
      expect(response.status).toBe(401);
      expect(trace).toEqual([]);
    }
    expect(live.budget).not.toHaveBeenCalled();
    expect({ words: await wordsOf('gus'), rows: await selfRows() }).toEqual(before);
  });

  test('a team session does not sign a customer in for a removal either', async () => {
    teamAs('owner');
    const { POST } = await customerRoute();
    expect((await POST(post(customerUrl(), removal()))).status).toBe(401);
    expect(live.getSession).not.toHaveBeenCalled();
  });

  test('removes every word of the person, answers with private headers and exactly the count and the flag, and a retry is the same count', async () => {
    const references = [await file('gus', 'One of gus.'), await file('gus', 'Two of gus.')];
    const { GET, POST } = await customerRoute();
    live.budget.mockClear();
    const command = randomUUID();
    const first = await answer(await POST(post(customerUrl(), removal({ commandId: command }))));
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('referrer-policy')).toBe('no-referrer');
    // the report filed by the signed-out test above and the two filed here
    expect(first.body).toEqual({ removed: 3, changed: true });
    // the budget was spent once, for this caller, after the session
    expect(live.budget).toHaveBeenCalledTimes(1);
    expect(live.budget).toHaveBeenCalledWith('local');
    expect(await wordsOf('gus')).toBe(0);
    for (const reference of references) {
      const read = await answer(await GET(new Request(customerUrl(`?reference=${reference}`))));
      expect(read.body.words).toEqual({ removed: true });
    }
    const listed = await answer(await GET(new Request(customerUrl())));
    expect(listed.body.items.every((row: { wordsRemoved: boolean }) => row.wordsRemoved)).toBe(
      true,
    );
    const again = await answer(await POST(post(customerUrl(), removal({ commandId: command }))));
    expect(again.body).toEqual({ removed: first.body.removed, changed: false });
    // nothing left: a new command removes nothing and says so
    expect((await answer(await POST(post(customerUrl(), removal())))).body).toEqual({
      removed: 0,
      changed: false,
    });
  });

  test('another person is untouched, and the same command id from another person acts only on their own', async () => {
    await file('hal', 'Words of hal.');
    await file('ivy', 'Words of ivy.');
    const { POST } = await customerRoute();
    const command = randomUUID();
    customerAs('hal');
    expect(
      (await answer(await POST(post(customerUrl(), removal({ commandId: command }))))).body,
    ).toEqual({
      removed: 1,
      changed: true,
    });
    expect(await wordsOf('ivy')).toBe(1);
    customerAs('ivy');
    expect(
      (await answer(await POST(post(customerUrl(), removal({ commandId: command }))))).body,
    ).toEqual({
      removed: 1,
      changed: true,
    });
    expect(await wordsOf('ivy')).toBe(0);
  });

  describe('an invalid request ends it with no connection and no query', () => {
    test('another origin is a 403 before the session, a body that is not JSON a 415, a large one a 413, bad JSON a 400', async () => {
      await file('jon', 'Words of jon.');
      customerAs('jon');
      const { POST } = await customerRoute();
      const before = { words: await wordsOf('jon'), rows: await selfRows() };
      const cases: [string, Request, number][] = [
        ['another origin', post(customerUrl(), removal(), { origin: 'https://evil.invalid' }), 403],
        ['not JSON', post(customerUrl(), removal(), { 'content-type': 'text/plain' }), 415],
        ['an oversized body', post(customerUrl(), removal({ padding: 'x'.repeat(9000) })), 413],
        ['bad JSON', post(customerUrl(), '{not json'), 400],
      ];
      for (const [name, request, status] of cases) {
        trace.length = 0;
        expect((await POST(request)).status, name).toBe(status);
        expect(trace, name).toEqual([]);
      }
      expect({ words: await wordsOf('jon'), rows: await selfRows() }).toEqual(before);
    });

    test('a key that names a person, a report, an erasure request or anything else, a missing or malformed command id and an unknown action are a 400', async () => {
      customerAs('jon');
      const { POST } = await customerRoute();
      const before = { words: await wordsOf('jon'), rows: await selfRows() };
      for (const key of [
        'personId',
        'principalId',
        'reportId',
        'reference',
        'erasureRequestId',
        'side',
        'tenantId',
      ])
        for (const text of [removal({ [key]: ids.jon })]) {
          trace.length = 0;
          expect((await POST(post(customerUrl(), text))).status, key).toBe(400);
          expect(trace, key).toEqual([]);
        }
      for (const bad of [
        { action: 'remove_words' },
        { commandId: randomUUID() },
        removal({ commandId: 'not-a-uuid' }),
        removal({ commandId: 5 }),
        { action: 'delete', commandId: randomUUID() },
        { action: 'file', ...filing() },
        [],
        'remove_words',
      ]) {
        trace.length = 0;
        expect((await POST(post(customerUrl(), bad as never))).status, JSON.stringify(bad)).toBe(
          400,
        );
        expect(trace, JSON.stringify(bad)).toEqual([]);
      }
      expect({ words: await wordsOf('jon'), rows: await selfRows() }).toEqual(before);
    });
  });

  test('a budget that is spent is a 429 with the shared words, and nothing is removed', async () => {
    await file('kim', 'Words of kim.');
    customerAs('kim');
    const { POST } = await customerRoute();
    live.budget.mockRejectedValueOnce(new DomainError('Too many requests', 429));
    const before = await wordsOf('kim');
    const refused = await answer(await POST(post(customerUrl(), removal())));
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe(limitWords);
    expect(await wordsOf('kim')).toBe(before);
  });

  test('a closed account removes its words with the closed account gate on, where its filing is still refused', async () => {
    await file('eve', 'Words of eve.');
    await f.owner.query(
      `WITH t AS (SELECT clock_timestamp() AS at)
       INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       SELECT $1,'closed',t.at,t.at+interval '720 hours',$2 FROM t`,
      [ids.eve, randomUUID()],
    );
    vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
    vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
    vi.stubEnv('CORRIDRA_CUSTOMER_ACCOUNT_LIFECYCLE_ENABLED', 'true');
    resetClosedAccountGateCache();
    try {
      customerAs('eve');
      const { POST } = await customerRoute();
      const removed = await answer(await POST(post(customerUrl(), removal())));
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ removed: expect.any(Number), changed: true });
      expect(await wordsOf('eve')).toBe(0);
      const refused = await answer(await POST(post(customerUrl(), filing())));
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({ error: 'That account is closed', code: 'account_closed' });
    } finally {
      vi.unstubAllEnvs();
      resetClosedAccountGateCache();
    }
  });

  test('is a 503 until migration 0003 is there, and filing, reading and the team route are not affected', async () => {
    await file('fay', 'Words of fay.');
    await f.owner.query(
      'ALTER FUNCTION customer.problem_report_remove_own_words(uuid) RENAME TO problem_report_remove_own_words_held',
    );
    try {
      resetSelfRemovalProbe();
      customerAs('fay');
      const { GET, POST } = await customerRoute();
      const before = { words: await wordsOf('fay'), rows: await selfRows() };
      const unavailable = await answer(await POST(post(customerUrl(), removal())));
      expect(unavailable.status).toBe(503);
      expect(unavailable.body).toEqual({
        error: 'Problem reports are not available yet.',
        code: 'unavailable',
      });
      expect({ words: await wordsOf('fay'), rows: await selfRows() }).toEqual(before);
      expect((await POST(post(customerUrl(), filing()))).status).toBe(200);
      expect((await GET(new Request(customerUrl()))).status).toBe(200);
      teamAs('owner');
      const team = await teamRoute();
      expect((await team.GET(new Request(teamUrl()))).status).toBe(200);
      expect((await team.GET(new Request(teamUrl('&view=queue')))).status).toBe(200);
    } finally {
      await f.owner.query(
        'ALTER FUNCTION customer.problem_report_remove_own_words_held(uuid) RENAME TO problem_report_remove_own_words',
      );
      resetSelfRemovalProbe();
    }
    customerAs('fay');
    const { POST } = await customerRoute();
    expect((await answer(await POST(post(customerUrl(), removal())))).body.changed).toBe(true);
  });
});
