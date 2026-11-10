import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import {
  CustomerProblemReports,
  StaffProblemReports,
  TeamProblemReports,
  resetProblemReportProbe,
} from '../../packages/auth/src/problem-reports';

// ADR-078 decision 8 and the merge gate: the application treats the module as present only when the catalogue shows its
// command function AND the bodies migration 0002 replaced. A database that has 0001 alone (what production had before the
// second file) has the functions but the narrower plain-text rule and a word removal with no time bound, so both routes
// must answer 503 on every method, change nothing, and start working within a minute of 0002 with no redeploy. The same
// routes over the fully installed module are in problem-report-routes.test.ts.
const live = vi.hoisted(() => ({
  person: 'ann' as string,
  token: '',
  customer: null as unknown,
  team: null as unknown,
  staff: null as unknown,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    provider: { getSession: async () => ({ token: live.token }) },
    missions: { budget: async () => undefined },
    customerProblemReports: live.customer,
    teamProblemReports: live.team,
    staffProblemReports: live.staff,
  }),
}));

let f: Fixture;
let h: ReturnType<typeof harness>;
const origin = 'https://app.corridra.test';
const customerRoute = async () =>
  await import('../../apps/web/app/api/customer-problem-reports/route');
const teamRoute = async () =>
  await import('../../apps/web/app/api/workspace/problem-reports/route');
const post = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
const customerUrl = `${origin}/api/customer-problem-reports`;
const teamUrl = () => `${origin}/api/workspace/problem-reports?tenant=${f.tenantA}`;
const reference = 'RP-000001';
const filing = { category: 'did_not_work', pageKind: 'this_page', page: '/account/requests' };
// Every method of both routes, as a signed-in customer and as the owner of the staff workspace.
const calls = (): [string, () => Promise<Response>][] => [
  ['customer GET list', async () => (await customerRoute()).GET(new Request(customerUrl))],
  [
    'customer GET one',
    async () => (await customerRoute()).GET(new Request(`${customerUrl}?reference=${reference}`)),
  ],
  [
    'customer POST',
    async () =>
      (await customerRoute()).POST(post(customerUrl, { commandId: randomUUID(), ...filing })),
  ],
  ['team GET list', async () => (await teamRoute()).GET(new Request(teamUrl()))],
  [
    'team GET one',
    async () => (await teamRoute()).GET(new Request(`${teamUrl()}&reference=${reference}`)),
  ],
  ['team GET queue', async () => (await teamRoute()).GET(new Request(`${teamUrl()}&view=queue`))],
  [
    'team POST file',
    async () =>
      (await teamRoute()).POST(
        post(teamUrl(), {
          action: 'file',
          commandId: randomUUID(),
          ...filing,
          page: '/operator/requests',
        }),
      ),
  ],
  [
    'team POST transition',
    async () =>
      (await teamRoute()).POST(
        post(teamUrl(), {
          action: 'transition',
          commandId: randomUUID(),
          reportId: randomUUID(),
          expectedState: 'received',
          toState: 'in_review',
        }),
      ),
  ],
  [
    'team POST remove words',
    async () =>
      (await teamRoute()).POST(
        post(teamUrl(), {
          action: 'remove_words',
          commandId: randomUUID(),
          erasureRequestId: randomUUID(),
        }),
      ),
  ],
];
const unavailable = { error: 'Problem reports are not available yet.', code: 'unavailable' };
const expectUnavailable = async () => {
  for (const [name, call] of calls()) {
    const response = await call();
    expect(response.status, name).toBe(503);
    expect(await response.json(), name).toEqual(unavailable);
  }
};
const sql = async (name: string) =>
  await readFile(
    new URL(`../../packages/db/customer-problem-report-migrations/${name}`, import.meta.url),
    'utf8',
  );
const written = async () => {
  const made =
    (
      await f.owner.query(
        "SELECT to_regclass('customer_private.problem_report') IS NOT NULL AS made",
      )
    ).rows[0].made === true;
  return {
    made,
    reports: made
      ? ((await f.owner.query('SELECT count(*)::int AS n FROM customer_private.problem_report'))
          .rows[0].n as number)
      : 0,
  };
};
// What the runtime login sees of the two bodies migration 0002 replaced.
const marked = async () =>
  (
    await f.runtime.query<{ plain: boolean; removal: boolean }>(
      `SELECT coalesce(bool_or(p.proname='problem_report_plain' AND position(chr(92)||'u2066-'||chr(92)||'u2069' IN p.prosrc)>0),false) AS plain,
        coalesce(bool_or(p.proname='problem_report_remove_words' AND position('cutoff' IN p.prosrc)>0),false) AS removal
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('customer','customer_private')`,
    )
  ).rows[0]!;
const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

beforeAll(async () => {
  f = await fixture('corridra_upgrade');
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerAccountLifecycle(f.owner);
  h = harness(f, 'pr1only');
  await h.admit(['ann']);
  await h.provision('ann', 'Synthetic only-0001 workspace');
  live.customer = new CustomerProblemReports(f.runtime, f.auth, options, async () =>
    h.session('ann'),
  );
  live.team = new TeamProblemReports(f.runtime);
  live.staff = new StaffProblemReports(f.runtime);
  live.token = f.users.owner!.ctx.token;
  resetProblemReportProbe();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterAll(async () => {
  vi.useRealTimers();
  await f?.close();
});

describe('with the module not installed, with 0001 alone, and with 0001 and 0002', () => {
  test('before anything is installed every method answers 503 and nothing is written', async () => {
    expect(await written()).toEqual({ made: false, reports: 0 });
    await expectUnavailable();
    expect(await written()).toEqual({ made: false, reports: 0 });
  });

  test('0001 alone has the command functions but not the rules 0002 made, and the runtime login can see that', async () => {
    await f.owner.query(await sql('0001_problem_reports.sql'));
    expect(
      (
        await f.owner.query(
          "SELECT to_regprocedure('customer.problem_report_command(uuid,jsonb)') IS NOT NULL AS present",
        )
      ).rows[0].present,
    ).toBe(true);
    expect(await marked()).toEqual({ plain: false, removal: false });
  });

  test('right after 0001 the missing module is remembered, then a minute later it is still refused and nothing is written', async () => {
    await expectUnavailable();
    later(61000);
    await expectUnavailable();
    later(61000);
    await expectUnavailable();
    expect(await written()).toEqual({ made: true, reports: 0 });
  });

  test('right after 0002 the answer is still the remembered one, and nothing is written', async () => {
    await f.owner.query(await sql('0002_word_removal_bounds.sql'));
    expect(await marked()).toEqual({ plain: true, removal: true });
    await expectUnavailable();
    expect(await written()).toEqual({ made: true, reports: 0 });
  });

  test('a minute later the check runs again, finds both bodies, and every method works with no redeploy', async () => {
    later(61000);
    const { POST: customerPost, GET: customerGet } = await customerRoute();
    const { POST: teamPost, GET: teamGet } = await teamRoute();
    const filed = await customerPost(post(customerUrl, { commandId: randomUUID(), ...filing }));
    expect(filed.status).toBe(200);
    const mine = (await filed.json()) as { reference: string };
    expect((await customerGet(new Request(customerUrl))).status).toBe(200);
    expect(
      (await customerGet(new Request(`${customerUrl}?reference=${mine.reference}`))).status,
    ).toBe(200);
    const teamFiled = await teamPost(
      post(teamUrl(), {
        action: 'file',
        commandId: randomUUID(),
        ...filing,
        page: '/operator/requests',
      }),
    );
    expect(teamFiled.status).toBe(200);
    expect((await teamGet(new Request(teamUrl()))).status).toBe(200);
    const queue = (await (await teamGet(new Request(`${teamUrl()}&view=queue`))).json()) as {
      items: { id: string; reference: string }[];
    };
    const row = queue.items.find((item) => item.reference === mine.reference)!;
    const moved = await teamPost(
      post(teamUrl(), {
        action: 'transition',
        commandId: randomUUID(),
        reportId: row.id,
        expectedState: 'received',
        toState: 'in_review',
      }),
    );
    expect(moved.status).toBe(200);
    // not unavailable any more: the database answers about the erasure request itself
    const removal = await teamPost(
      post(teamUrl(), {
        action: 'remove_words',
        commandId: randomUUID(),
        erasureRequestId: randomUUID(),
      }),
    );
    expect(removal.status).toBe(404);
    expect(((await removal.json()) as { error: string }).error).toBe('Erasure request not found');
    expect((await written()).reports).toBe(2);
  });

  test('once found it stays found, and a fresh process starts by asking again', async () => {
    expect((await (await customerRoute()).GET(new Request(customerUrl))).status).toBe(200);
    resetProblemReportProbe();
    expect((await (await teamRoute()).GET(new Request(teamUrl()))).status).toBe(200);
  });
});
