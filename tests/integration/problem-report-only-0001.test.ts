import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { fixture } from './support';
import { watching } from './problem-report-support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import {
  CustomerProblemReports,
  StaffProblemReports,
  TeamProblemReports,
  resetProblemReportProbe,
  resetSelfRemovalProbe,
  selfRemovalAvailable,
} from '../../packages/auth/src/problem-reports';

// ADR-078 decision 8 and the merge gate: the application treats the module as present only when the catalogue shows its
// command function AND the bodies migration 0002 replaced. A database that has 0001 alone (what production had before the
// second file) has the functions but the narrower plain-text rule and a word removal with no time bound, so both routes
// must answer 503 on every method, change nothing, and start working within a minute of 0002 with no redeploy. Migration
// 0003 adds the customer's own removal of their words, behind a second, separate availability check: with 0001 and 0002
// everything works except that removal (503), and within a minute of 0003 the removal works too, again with no redeploy.
// The same routes over the fully installed module are in problem-report-routes.test.ts.
const live = vi.hoisted(() => ({
  person: 'ann' as string | null,
  token: '',
  customer: null as unknown,
  team: null as unknown,
  staff: null as unknown,
}));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    provider: { getSession: async () => (live.token ? { token: live.token } : null) },
    missions: { budget: async () => undefined },
    customerProblemReports: live.customer,
    teamProblemReports: live.team,
    staffProblemReports: live.staff,
  }),
}));

const web = createRequire(resolve('apps/web/package.json'));
const lifecycleFile = web.resolve('@corridra/auth/customer-account-lifecycle');
vi.doMock(lifecycleFile, async () => ({
  ...(await vi.importActual<Record<string, unknown>>(lifecycleFile)),
  customerAccountLifecycleEnabled: () => true,
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
  [
    'customer POST remove own words',
    async () =>
      (await customerRoute()).POST(
        post(customerUrl, { action: 'remove_words', commandId: randomUUID() }),
      ),
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
    live.person ? h.session(live.person) : null,
  );
  live.team = new TeamProblemReports(f.runtime);
  live.staff = new StaffProblemReports(f.runtime);
  live.token = f.users.owner!.ctx.token;
  resetProblemReportProbe();
  resetSelfRemovalProbe();
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

  test('signed out is a 401 and a malformed reference is a 404, installed or not; a well-formed one is a 503', async () => {
    const long = 'x'.repeat(65);
    const customerGet = async (reference: string) =>
      (await customerRoute()).GET(new Request(`${customerUrl}?reference=${reference}`));
    const teamGet = async (reference: string) =>
      (await teamRoute()).GET(new Request(`${teamUrl()}&reference=${reference}`));
    const token = live.token;
    live.person = null;
    live.token = '';
    for (const response of [
      await customerGet(long),
      await customerGet(reference),
      await teamGet(long),
      await teamGet(reference),
    ])
      expect(response.status).toBe(401);
    live.person = 'ann';
    live.token = token;
    // the shortcut for a malformed reference comes before the probe, so it stays 404 here; this is a choice, not an accident
    for (const response of [
      await customerGet(long),
      await customerGet('%00'),
      await customerGet(''),
      await teamGet(long),
      await teamGet(''),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Problem report not found' });
    }
    expect((await customerGet(reference)).status).toBe(503);
    expect((await teamGet(reference)).status).toBe(503);
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

// The probe has three conditions, and each is shown to matter on its own: the module is present only when the command
// function exists AND the plain-text rule carries the 0002 direction characters AND the word removal has its cutoff. Each
// run replaces one function with its own text from the migration files, or renames the command function, asks again as
// the runtime login, and puts the real definition back.
const backslash = String.fromCharCode(92);
const plainMarker = `${backslash}u2066-${backslash}u2069`;
const removalMarker = 'cutoff';
const migrationFiles = async () => {
  const directory = new URL(
    '../../packages/db/customer-problem-report-migrations/',
    import.meta.url,
  );
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return await Promise.all(
    names.map(async (name) => ({ name, text: await readFile(new URL(name, directory), 'utf8') })),
  );
};
// The text of a function as the migration file that last defines it states it: from its CREATE to the next function.
const latestDefinition = async (signature: string) => {
  let latest = { name: '', text: '' };
  for (const file of await migrationFiles()) {
    const start = file.text.lastIndexOf(`FUNCTION ${signature}(`);
    if (start < 0) continue;
    const rest = file.text.slice(start + 10);
    const next = rest.search(/\bFUNCTION\s/);
    latest = { name: file.name, text: next < 0 ? rest : rest.slice(0, next) };
  }
  return latest;
};
const original = {
  plain: async () =>
    (await sql('0001_problem_reports.sql')).match(
      /CREATE FUNCTION customer_private\.problem_report_plain[\s\S]*?\$\$;/,
    )![0],
  removal: async () =>
    (await sql('0001_problem_reports.sql')).match(
      /CREATE FUNCTION customer\.problem_report_remove_words[\s\S]*?END \$\$;/,
    )![0],
};
const replaced = {
  plain: async () =>
    (await sql('0002_word_removal_bounds.sql')).match(/\$plain\$([\s\S]*?)\$plain\$/)![1]!,
  removal: async () =>
    (await sql('0002_word_removal_bounds.sql')).match(/\$fn\$([\s\S]*?)\$fn\$/)![1]!,
};
const asOriginal = (text: string) => text.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
const stillThere = async () =>
  (
    await f.owner.query('SELECT customer_private.problem_report_plain($1,1,100) AS ok', [
      'plain words',
    ])
  ).rows[0].ok;
const mine = () => new Request(teamUrl());
const asked = async () => (await (await teamRoute()).GET(mine())).status;

describe('each probe condition decides on its own', () => {
  test('the real definitions are in place before each run', async () => {
    expect(await marked()).toEqual({ plain: true, removal: true });
    resetProblemReportProbe();
    expect(await asked()).toBe(200);
  });

  test('the narrower plain-text rule alone makes the module unavailable', async () => {
    await f.owner.query(asOriginal(await original.plain()));
    try {
      expect(await marked()).toEqual({ plain: false, removal: true });
      resetProblemReportProbe();
      expect(await asked()).toBe(503);
    } finally {
      await f.owner.query(await replaced.plain());
    }
    expect(await marked()).toEqual({ plain: true, removal: true });
    resetProblemReportProbe();
    expect(await asked()).toBe(200);
  });

  test('the word removal without its cutoff alone makes the module unavailable', async () => {
    await f.owner.query(asOriginal(await original.removal()));
    try {
      expect(await marked()).toEqual({ plain: true, removal: false });
      resetProblemReportProbe();
      expect(await asked()).toBe(503);
    } finally {
      await f.owner.query(await replaced.removal());
    }
    expect(await marked()).toEqual({ plain: true, removal: true });
    resetProblemReportProbe();
    expect(await asked()).toBe(200);
  });

  test('a missing command function alone makes the module unavailable', async () => {
    await f.owner.query(
      'ALTER FUNCTION customer.problem_report_command(uuid,jsonb) RENAME TO problem_report_command_held',
    );
    try {
      expect(await marked()).toEqual({ plain: true, removal: true });
      resetProblemReportProbe();
      expect(await asked()).toBe(503);
    } finally {
      await f.owner.query(
        'ALTER FUNCTION customer.problem_report_command_held(uuid,jsonb) RENAME TO problem_report_command',
      );
    }
    resetProblemReportProbe();
    expect(await asked()).toBe(200);
    expect(await stillThere()).toBe(true);
  });
});

describe('the probe is remembered and does not remember a failure', () => {
  const owner = () => f.users.owner!.ctx;
  test('a present module is probed once, however many calls follow', async () => {
    const seen: string[] = [];
    const team = new TeamProblemReports(watching(f.runtime, seen, { next: false }));
    resetProblemReportProbe();
    await team.list(owner(), {});
    await team.list(owner(), {});
    await team.get(owner(), 'RP-999999').catch(() => undefined);
    expect(seen).toHaveLength(1);
  });

  test('a missing module is probed again only after a minute', async () => {
    const seen: string[] = [];
    const team = new TeamProblemReports(watching(f.runtime, seen, { next: false }));
    await f.owner.query(asOriginal(await original.removal()));
    try {
      resetProblemReportProbe();
      await expect(team.list(owner(), {})).rejects.toMatchObject({ status: 503 });
      await expect(team.list(owner(), {})).rejects.toMatchObject({ status: 503 });
      expect(seen).toHaveLength(1);
      later(61000);
      await expect(team.list(owner(), {})).rejects.toMatchObject({ status: 503 });
      expect(seen).toHaveLength(2);
    } finally {
      await f.owner.query(await replaced.removal());
    }
    later(61000);
    await team.list(owner(), {});
    expect(seen).toHaveLength(3);
  });

  test('a probe that fails leaves nothing remembered, so the next call probes again', async () => {
    const seen: string[] = [];
    const failing = { next: true };
    const team = new TeamProblemReports(watching(f.runtime, seen, failing));
    resetProblemReportProbe();
    await expect(team.list(owner(), {})).rejects.toThrow('the catalogue could not be read');
    expect(seen).toHaveLength(1);
    await team.list(owner(), {});
    expect(seen).toHaveLength(2);
    await team.list(owner(), {});
    expect(seen).toHaveLength(2);
  });
});

describe('the probe markers follow the migrations', () => {
  const moveWith = (name: string, signature: string) =>
    `The latest definition of ${signature} (in ${name}) no longer carries the probe marker. ` +
    'The probe markers in packages/auth/src/problem-reports.ts must move with it.';
  test('the latest definition of each probed function still carries its marker', async () => {
    const plain = await latestDefinition('customer_private.problem_report_plain');
    expect(plain.name).not.toBe('');
    expect(
      plain.text.includes(plainMarker),
      moveWith(plain.name, 'customer_private.problem_report_plain'),
    ).toBe(true);
    const removal = await latestDefinition('customer.problem_report_remove_words');
    expect(removal.name).not.toBe('');
    expect(
      removal.text.includes(removalMarker),
      moveWith(removal.name, 'customer.problem_report_remove_words'),
    ).toBe(true);
  });
  test('the first definitions do not, which is what lets the probe tell 0001 from 0002', async () => {
    expect((await original.plain()).includes(plainMarker)).toBe(false);
    expect((await original.removal()).includes(removalMarker)).toBe(false);
  });
  test('the service probe still looks for exactly those markers', async () => {
    const source = await readFile(
      new URL('../../packages/auth/src/problem-reports.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("position(chr(92)||'u2066-'||chr(92)||'u2069' IN p.prosrc)");
    expect(source).toContain(`position('${removalMarker}' IN p.prosrc)`);
  });
});

// Migration 0003 is the third stage. The removal of a customer's own words has its own availability check, so with 0001 and
// 0002 alone every method works except that one, which answers 503 and changes nothing; once 0003 is applied it starts
// working within a minute with no redeploy; and each of its two conditions decides on its own without touching the check
// filing, reading and triage depend on.
const thirdRemoval = async () =>
  (await sql('0003_problem_report_self_removal.sql')).match(
    /\$removefn\$\n([\s\S]*?)\n\$removefn\$/,
  )![1]!;
const removal = () => ({ action: 'remove_words', commandId: randomUUID() });
const removeOwn = async () => (await customerRoute()).POST(post(customerUrl, removal()));
const fileOwn = async () =>
  (await customerRoute()).POST(post(customerUrl, { commandId: randomUUID(), ...filing }));
const wordsHeld = async () =>
  (
    await f.owner.query(
      "SELECT count(*)::int AS n FROM customer_private.problem_report_words w JOIN customer_private.problem_report r ON r.id=w.report_id WHERE r.reporter_kind='customer'",
    )
  ).rows[0].n as number;
const selfRemovalMade = async () =>
  (
    await f.owner.query(
      "SELECT to_regclass('customer_private.problem_report_self_removal') IS NOT NULL AS made",
    )
  ).rows[0].made as boolean;
// What the runtime login sees of the two things the removal check asks for.
const selfMarked = async () =>
  (
    await f.runtime.query<{ present: boolean; marker: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='customer' AND p.proname='problem_report_remove_own_words' AND p.pronargs=1) AS present,
        EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='customer' AND p.proname='problem_report_remove_words'
          AND position('problem_report_self_removal' IN p.prosrc)>0) AS marker`,
    )
  ).rows[0]!;
const available = async () => {
  const db = await f.runtime.connect();
  try {
    return await selfRemovalAvailable(db);
  } finally {
    db.release();
  }
};
// Everything but the removal answers as usual.
const othersWork = async () => {
  expect((await fileOwn()).status).toBe(200);
  expect((await (await customerRoute()).GET(new Request(customerUrl))).status).toBe(200);
  expect(await asked()).toBe(200);
  expect(
    (
      await (
        await teamRoute()
      ).POST(
        post(teamUrl(), {
          action: 'file',
          commandId: randomUUID(),
          ...filing,
          page: '/operator/requests',
        }),
      )
    ).status,
  ).toBe(200);
  expect((await (await teamRoute()).GET(new Request(`${teamUrl()}&view=queue`))).status).toBe(200);
};
const removalUnavailable = async () => {
  const before = await wordsHeld();
  const response = await removeOwn();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual(unavailable);
  expect(await wordsHeld()).toBe(before);
};

describe('the third stage: migration 0003 and the check of the removal of a customer own words', () => {
  test('with 0001 and 0002 only, the removal is a 503 that changes nothing, and filing, reading and triage work', async () => {
    resetProblemReportProbe();
    resetSelfRemovalProbe();
    expect(await selfRemovalMade()).toBe(false);
    expect(await selfMarked()).toEqual({ present: false, marker: false });
    expect(await available()).toBe(false);
    resetSelfRemovalProbe();
    await removalUnavailable();
    await othersWork();
  });

  test('right after 0003 the removal is still the remembered 503, and nothing is removed', async () => {
    await f.owner.query(await sql('0003_problem_report_self_removal.sql'));
    expect(await selfRemovalMade()).toBe(true);
    expect(await selfMarked()).toEqual({ present: true, marker: true });
    await removalUnavailable();
    await othersWork();
  });

  test('a minute later the check runs again, finds both, and the removal works with no redeploy', async () => {
    later(61000);
    const response = await removeOwn();
    expect(response.status).toBe(200);
    const done = (await response.json()) as { removed: number; changed: boolean };
    expect(done.changed).toBe(true);
    expect(done.removed).toBeGreaterThan(0);
    expect(await wordsHeld()).toBe(0);
    expect(Object.keys(done).sort()).toEqual(['changed', 'removed']);
    await othersWork();
  });

  test('once found it stays found, and a fresh process starts by asking again', async () => {
    expect(await available()).toBe(true);
    expect(((await (await removeOwn()).json()) as { changed: boolean }).changed).toBe(true);
    expect(await wordsHeld()).toBe(0);
    expect(await (await removeOwn()).json()).toEqual({ removed: 0, changed: false });
    resetSelfRemovalProbe();
    expect(await (await removeOwn()).json()).toEqual({ removed: 0, changed: false });
  });

  test('a missing new function alone makes only the removal unavailable', async () => {
    await f.owner.query(
      'ALTER FUNCTION customer.problem_report_remove_own_words(uuid) RENAME TO problem_report_remove_own_words_held',
    );
    try {
      expect(await selfMarked()).toEqual({ present: false, marker: true });
      resetSelfRemovalProbe();
      await removalUnavailable();
      await othersWork();
    } finally {
      await f.owner.query(
        'ALTER FUNCTION customer.problem_report_remove_own_words_held(uuid) RENAME TO problem_report_remove_own_words',
      );
    }
    resetSelfRemovalProbe();
    expect((await removeOwn()).status).toBe(200);
  });

  test('a word removal without the self-removal marker alone makes only the removal unavailable', async () => {
    await f.owner.query(await replaced.removal());
    try {
      expect(await selfMarked()).toEqual({ present: true, marker: false });
      // the first check still holds: the word removal keeps its cutoff
      expect(await marked()).toEqual({ plain: true, removal: true });
      resetSelfRemovalProbe();
      await removalUnavailable();
      await othersWork();
    } finally {
      await f.owner.query(await thirdRemoval());
    }
    expect(await selfMarked()).toEqual({ present: true, marker: true });
    resetSelfRemovalProbe();
    expect((await removeOwn()).status).toBe(200);
  });

  test('the first check false alone makes everything unavailable while the removal check still holds on its own', async () => {
    await f.owner.query(asOriginal(await original.plain()));
    try {
      expect(await marked()).toEqual({ plain: false, removal: true });
      resetProblemReportProbe();
      resetSelfRemovalProbe();
      expect(await available()).toBe(true);
      expect((await fileOwn()).status).toBe(503);
      await removalUnavailable();
    } finally {
      await f.owner.query(await replaced.plain());
    }
    resetProblemReportProbe();
    resetSelfRemovalProbe();
    await othersWork();
    expect((await removeOwn()).status).toBe(200);
  });

  test('a removal check that fails leaves nothing remembered, so the next call asks again and a found answer is then kept', async () => {
    const seen: string[] = [];
    const pool = watching(f.runtime, seen, { next: true });
    const ask = async () => {
      const db = await pool.connect();
      try {
        return await selfRemovalAvailable(db);
      } finally {
        db.release();
      }
    };
    resetSelfRemovalProbe();
    await expect(ask()).rejects.toThrow('the catalogue could not be read');
    expect(seen).toHaveLength(1);
    expect(await ask()).toBe(true);
    expect(seen).toHaveLength(2);
    expect(await ask()).toBe(true);
    expect(seen).toHaveLength(2);
  });
});

describe('the removal check markers follow the migrations', () => {
  test('the latest definition of the word removal still names the self-removal table, and the first two do not', async () => {
    const latest = await latestDefinition('customer.problem_report_remove_words');
    expect(latest.name).toBe('0003_problem_report_self_removal.sql');
    expect(
      latest.text.includes('problem_report_self_removal'),
      'The latest definition of customer.problem_report_remove_words no longer names problem_report_self_removal. The removal check in packages/auth/src/problem-reports.ts must move with it.',
    ).toBe(true);
    expect((await original.removal()).includes('problem_report_self_removal')).toBe(false);
    expect((await replaced.removal()).includes('problem_report_self_removal')).toBe(false);
  });
  test('the service check still looks for exactly that marker and the one function', async () => {
    const source = await readFile(
      new URL('../../packages/auth/src/problem-reports.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("position('problem_report_self_removal' IN p.prosrc)");
    expect(source).toContain("p.proname='problem_report_remove_own_words' AND p.pronargs=1");
    expect(source).toContain("p.proargtypes[0]='uuid'::regtype");
  });
});
