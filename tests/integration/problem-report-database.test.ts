import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { digest, harness, type Fixture, type Row } from './revamp-g4-support';
import type { RequestContext } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';

// ADR-078, real database, real restricted roles: customers and team members file problem reports and read only their
// own, owners and admins of a staff workspace triage them with a fresh authenticator check, every report is on exactly
// one staff side, and the words of a customer report can be removed under an erasure request. Nothing here is a real
// account, email or workspace.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
const sampleWorkspace: Record<string, string> = {};

const notFound = { code: '23514', message: 'Problem report not found' };
const changed = {
  code: '23514',
  message: 'This problem report has changed. Reload and try again',
};
const notAllowed = { code: '23514', message: 'That change is not allowed from this status' };
const conflict = { code: '23514', message: 'Command conflicts with original request' };
const tooMany = { code: '54000', message: 'Too many problem reports in the last 24 hours' };
const notInProgress =
  'Words can be removed only for an erasure request that is in progress or completed';
const closedAccount = { code: '23514', message: 'That account is closed' };

const body = (over: Record<string, unknown> = {}) => ({
  category: 'did_not_work',
  pageKind: 'this_page',
  page: '/account/requests',
  ...over,
});
const teamBody = (over: Record<string, unknown> = {}) =>
  body({ page: '/operator/requests', ...over });
const customerFile = (person: string, input: unknown, command: string = randomUUID()) =>
  h
    .sql<{ r: Row }>(person, 'SELECT customer.problem_report_command($1,$2) AS r', [
      command,
      JSON.stringify(input),
    ])
    .then((row) => row.r);
const customerList = (person: string, before: number | null = null, size = 25) =>
  h
    .sql<{ r: Row[] }>(person, 'SELECT customer.problem_report_list($1,$2) AS r', [before, size])
    .then((row) => row.r);
const customerGet = (person: string, reference: unknown) =>
  h
    .sql<{ r: Row }>(person, 'SELECT customer.problem_report_get($1) AS r', [reference])
    .then((row) => row.r);
const as = (ctx: RequestContext, text: string, params: unknown[] = []) =>
  rawContext(f.runtime, ctx, text, params).then((result) => result.rows[0]);
const ctxOf = (who: string): RequestContext => f.users[who]!.ctx;
const realCtx = (): RequestContext => ({
  ...f.users.other!.ctx,
  purpose: 'commercial_qualification',
});
const teamFile = (ctx: RequestContext, input: unknown, command: string = randomUUID()) =>
  as(ctx, 'SELECT app.problem_report_command($1,$2) AS r', [command, JSON.stringify(input)]).then(
    (row) => row.r as Row,
  );
const teamList = (ctx: RequestContext) =>
  as(ctx, 'SELECT app.problem_report_list(NULL,25) AS r').then((row) => row.r as Row[]);
const teamGet = (ctx: RequestContext, reference: unknown) =>
  as(ctx, 'SELECT app.problem_report_get($1) AS r', [reference]).then((row) => row.r as Row);
type Queue = {
  items: Row[];
  total: number;
  counts: Record<string, number>;
  oldestReceivedAt: string | null;
};
const queuePage = (
  ctx: RequestContext,
  filter: string | null = null,
  after: number | null = null,
  size = 100,
) =>
  as(ctx, 'SELECT customer.problem_report_queue($1,$2,$3) AS r', [after, size, filter]).then(
    (row) => row.r as Queue,
  );
// Every page of the queue, merged, so a test never depends on how many reports other tests filed.
const queue = async (ctx: RequestContext, filter: string | null = null) => {
  const merged: Queue = { items: [], total: 0, counts: {}, oldestReceivedAt: null };
  let after: number | null = null;
  for (;;) {
    const page: Queue = await queuePage(ctx, filter, after);
    merged.items.push(...page.items);
    merged.total = page.total;
    merged.counts = page.counts;
    merged.oldestReceivedAt = page.oldestReceivedAt;
    if (page.items.length < 100) return merged;
    after = page.items[page.items.length - 1]!.number as number;
  }
};
const move = (
  ctx: RequestContext,
  report: string,
  expected: string,
  to: string,
  note: string | null = null,
  command: string = randomUUID(),
) =>
  as(ctx, 'SELECT customer.problem_report_transition($1,$2,$3,$4,$5) AS r', [
    command,
    report,
    expected,
    to,
    note,
  ]).then((row) => row.r as Row);
const reportId = async (reference: string) =>
  (
    await f.owner.query('SELECT id FROM customer_private.problem_report WHERE reference=$1', [
      reference,
    ])
  ).rows[0].id as string;
const storedSide = async (reference: string) =>
  (
    await f.owner.query('SELECT side FROM customer_private.problem_report WHERE reference=$1', [
      reference,
    ])
  ).rows[0].side as string;
const counts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.problem_report) reports,
 (SELECT count(*)::int FROM customer_private.problem_report_words) words,
 (SELECT count(*)::int FROM customer_private.problem_report_status_event) statuses,
 (SELECT count(*)::int FROM customer_private.problem_report_erasure) erasures`)
  ).rows[0] as Record<string, number>;
const otherRecords = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM app.domain_event) events,
 (SELECT count(*)::int FROM app.audit_event) audits,
 (SELECT count(*)::int FROM app.outbox) outbox,
 (SELECT count(*)::int FROM app.outbox_delivery) deliveries`)
  ).rows[0] as Record<string, number>;
// Customers with a sample workspace that file the many reports triage needs, eight each so the limit of 10 is never met.
// Customers for the filings that only need somebody, six each at most.
const spares = ['sp0', 'sp1', 'sp2', 'sp3', 'sp4', 'sp5'];
let spent = 0;
const spare = () => spares[Math.floor(spent++ / 6)]!;
// Customers of the self-removal tests, each used by one test (a few have a workspace or one made by the test).
const selfRemovers = [
  'sra',
  'srb',
  'src',
  'srd',
  'sre',
  'srf',
  'srg',
  'srh',
  'sri',
  'srj',
  'srk',
  'srl',
  'srm',
  'srn',
  'sro',
  'srp',
  'srq',
  'srs',
  'srt',
  'srx',
  'srhost',
];
const filers = ['fil0', 'fil1', 'fil2', 'fil3', 'fil4', 'fil5', 'fil6', 'fil7'];
let used = 0;
const filedBy = new Map<string, string>();
const fileSample = async (over: Record<string, unknown> = {}) => {
  const person = filers[Math.floor(used++ / 8)]!;
  const reference = (await customerFile(person, body(over))).reference as string;
  filedBy.set(reference, person);
  return reference;
};
const staleAuthenticator = async (who: string, stale: boolean) => {
  await f.owner.query(
    `UPDATE identity.assurance SET verified_at=${stale ? "now()-interval '1 hour'" : 'now()'} WHERE session_id=$1`,
    [f.users[who]!.sessionId],
  );
};
const flip = async (tenant: string, synthetic: boolean) => {
  await f.owner.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
  await f.owner.query('UPDATE app.tenant SET synthetic=$2 WHERE id=$1', [tenant, synthetic]);
  await f.owner.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
};
const realUse = async (on: boolean) => {
  await f.owner.query('ALTER TABLE customer_private.real_use_configuration DISABLE TRIGGER USER');
  await f.owner.query('DELETE FROM customer_private.real_use_configuration');
  await f.owner.query('ALTER TABLE customer_private.real_use_configuration ENABLE TRIGGER USER');
  if (on)
    await f.owner.query(
      "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES($1,$2,$3,$4,'real-intake-2026-10-21-v1',true)",
      [
        (await f.owner.query('SELECT issuer FROM customer_private.principal LIMIT 1')).rows[0]
          .issuer,
        f.serviceId,
        f.tenantA,
        f.users.owner!.id,
      ],
    );
};
const closeAccount = (person: string) =>
  f.owner.query(
    `WITH t AS (SELECT clock_timestamp() AS at)
     INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
     SELECT $1,'closed',t.at,t.at+interval '720 hours',$2 FROM t`,
    [ids[person], randomUUID()],
  );
const restoreAccount = (person: string) =>
  f.owner.query(
    "INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,command_id) VALUES($1,'restored',clock_timestamp(),$2)",
    [ids[person], randomUUID()],
  );
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [latest + 1, enabled, f.serviceId, 'Fixture control for the problem report tests'],
  );
};
const revoke = (owner: string, target: string, memberId: string) =>
  h.sql(owner, 'SELECT customer.workspace_access_command($1,$2,$3) AS r', [
    randomUUID(),
    'revoke',
    JSON.stringify({ workspaceId: target, kind: 'membership', targetId: memberId }),
  ]);
// The erasure request of a person, its staff moves and the staff removal of words under it (the erasure authority, as the
// owner of the sample staff workspace).
const request = async (person: string) => {
  const filed = await h.sql<{ r: Row }>(
    person,
    'SELECT customer.account_lifecycle_command($1,$2,$3) AS r',
    [randomUUID(), 'file_erasure', '{}'],
  );
  expect(filed.r.changed).toBe(true);
  const row = (await as(ctxOf('owner'), 'SELECT customer.erasure_queue(NULL,100,NULL) AS r')).r as {
    id: string;
    principalId: string;
  }[];
  return row.find((item) => item.principalId === ids[person])!.id;
};
const erasure = (request: string, expected: string, to: string, note: string | null = null) =>
  as(ctxOf('owner'), 'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
    randomUUID(),
    request,
    expected,
    to,
    note,
  ]);
const remove = (ctx: RequestContext, requestId: string, command: string = randomUUID()) =>
  as(ctx, 'SELECT customer.problem_report_remove_words($1,$2) AS r', [command, requestId]).then(
    (row) => row.r as Row,
  );
// One report as the two sample and real staff workspaces see it: the stored side, the one effective side, and whether the
// staff of the sample workspace (tenant A) and of the real workspace (tenant B, made real by the test) see it.
const seen = async (reference: string) => {
  const client = await f.owner.connect();
  try {
    await client.query('BEGIN');
    const row = (
      await client.query(
        'SELECT id,side,customer_private.problem_report_side(id) AS effective FROM customer_private.problem_report WHERE reference=$1',
        [reference],
      )
    ).rows[0] as { id: string; side: string; effective: string };
    const view = { sample: false, real: false };
    for (const [name, tenant] of [
      ['sample', f.tenantA],
      ['real', f.tenantB],
    ] as const) {
      await client.query("SELECT set_config('corridra.tenant_id',$1,true)", [tenant]);
      view[name] = (
        await client.query('SELECT customer_private.problem_report_in_scope($1) AS s', [row.id])
      ).rows[0].s as boolean;
    }
    await client.query('ROLLBACK');
    return { stored: row.side, effective: row.effective, ...view };
  } finally {
    client.release();
  }
};
// The one side every report must be on: the sample staff or the real staff, never both and never neither.
const exactlyOneSide = (view: { effective: string; sample: boolean; real: boolean }) => {
  expect(view.sample !== view.real).toBe(true);
  expect(view.effective).toBe(view.sample ? 'sample' : 'real');
};

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'prdb');
  ids = await h.admit([
    'alice',
    'bob',
    'carol',
    'dave',
    'hank',
    'ivan',
    'jude',
    'kay',
    'lee',
    'zed',
    ...spares,
    'mia',
    'sam',
    'nia',
    'joy',
    'rae',
    'moe',
    'ola',
    'pat',
    'quin',
    'rhea',
    'una',
    'vic',
    'wes',
    'xia',
    'yan',
    'zoe',
    ...filers,
    ...selfRemovers,
  ]);
  for (const person of [
    'alice',
    'dave',
    'hank',
    'ivan',
    'jude',
    'kay',
    'lee',
    'zed',
    'mia',
    'sam',
    'ola',
    'pat',
    'quin',
    'rhea',
    'una',
    'vic',
    'wes',
    'xia',
    'yan',
    'zoe',
    ...filers,
  ])
    sampleWorkspace[person] = await h.provision(person, `Synthetic ${person} workspace`);
  await h.join('alice', 'bob', sampleWorkspace.alice!);
  await migrateCustomerProblemReports(f.owner);
});
afterAll(async () => {
  await f?.close();
});

describe('filing and reading', () => {
  test('a customer files, gets a reference, and reads it back without any side', async () => {
    const before = { ...(await counts()), ...(await otherRecords()) };
    const first = await customerFile(
      'alice',
      body({ detail: 'The save button did nothing when I pressed it.' }),
    );
    expect(first).toMatchObject({ status: 'received', changed: true });
    expect(first.reference).toMatch(/^RP-\d{6}$/);
    const after = { ...(await counts()), ...(await otherRecords()) };
    expect(after).toEqual({
      ...before,
      reports: before.reports! + 1,
      words: before.words! + 1,
      statuses: before.statuses! + 1,
    });
    const listed = await customerList('alice');
    expect(listed[0]).toMatchObject({
      reference: first.reference,
      category: 'did_not_work',
      status: 'received',
      wordsRemoved: false,
    });
    expect(listed[0]).not.toHaveProperty('side');
    const read = await customerGet('alice', first.reference);
    expect(read).toMatchObject({
      reference: first.reference,
      status: 'received',
      words: {
        pageKind: 'this_page',
        page: '/account/requests',
        detail: 'The save button did nothing when I pressed it.',
      },
    });
    expect(read).not.toHaveProperty('side');
    expect(read.history).toEqual([
      { state: 'received', note: null, createdAt: expect.any(String) },
    ]);
  });

  test('a customer with no workspace may file', async () => {
    const made = await customerFile('carol', body({ pageKind: 'another_page', page: 'Requests' }));
    expect(made.reference).toMatch(/^RP-\d{6}$/);
    expect(await customerGet('carol', made.reference)).toMatchObject({
      words: { pageKind: 'another_page', page: 'Requests', detail: null },
    });
  });

  test('every team role files, with a stale authenticator too, and reads only its own', async () => {
    const before = await otherRecords();
    const made: Record<string, string> = {};
    for (const who of ['owner', 'operator', 'reviewer', 'viewer'])
      made[who] = (await teamFile(ctxOf(who), teamBody({ detail: `Filed by the ${who} role` })))
        .reference as string;
    await staleAuthenticator('operator', true);
    try {
      const stale = await teamFile(ctxOf('operator'), teamBody({ category: 'words_wrong' }));
      expect(stale).toMatchObject({ status: 'received', changed: true });
      expect(await teamList(ctxOf('operator'))).toHaveLength(2);
    } finally {
      await staleAuthenticator('operator', false);
    }
    expect(await otherRecords()).toEqual(before);
    for (const who of ['owner', 'operator', 'reviewer', 'viewer']) {
      const read = await teamGet(ctxOf(who), made[who]);
      expect(read).toMatchObject({
        reference: made[who],
        words: { pageKind: 'this_page', page: '/operator/requests' },
      });
      expect(read).not.toHaveProperty('side');
      for (const other of ['owner', 'operator', 'reviewer', 'viewer'].filter((x) => x !== who))
        await expect(teamGet(ctxOf(other), made[who])).rejects.toMatchObject(notFound);
    }
  });

  test('another customer, a co-member, an unknown and a malformed reference all answer identically', async () => {
    const mine = (await customerFile('alice', body())).reference as string;
    const teamMade = (await teamFile(ctxOf('owner'), teamBody())).reference as string;
    const answers: unknown[] = [];
    const attempts: (() => Promise<unknown>)[] = [
      () => customerGet('bob', mine),
      () => customerGet('carol', mine),
      () => customerGet('alice', teamMade),
      () => customerGet('alice', 'RP-999999'),
      () => customerGet('alice', 'not a reference'),
      () => customerGet('alice', ''),
      () => customerGet('alice', "RP-000001'; DROP TABLE x;--"),
      () => customerGet('alice', null),
      () => teamGet(ctxOf('operator'), mine),
      () => teamGet(ctxOf('operator'), teamMade),
      () => teamGet(ctxOf('other'), teamMade),
      () => teamGet(ctxOf('operator'), 'RP-999999'),
      () => teamGet(ctxOf('operator'), 'nonsense'),
    ];
    for (const attempt of attempts)
      await attempt().then(
        () => answers.push('answered'),
        (error: { code: string; message: string }) =>
          answers.push({ code: error.code, message: error.message }),
      );
    expect(answers).toEqual(attempts.map(() => notFound));
    // the co-member's own list holds none of alice's reports
    expect(await customerList('bob')).toEqual([]);
    expect((await customerList('alice')).map((row) => row.reference)).toContain(mine);
    expect((await teamList(ctxOf('operator'))).map((row) => row.reference)).not.toContain(teamMade);
  });

  test('the list pages newest first by number', async () => {
    const all = await customerList('alice');
    expect(all.length).toBeGreaterThanOrEqual(2);
    const numbers = all.map((row) => row.number as number);
    expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
    const older = await customerList('alice', numbers[0]!, 1);
    expect(older.map((row) => row.number)).toEqual([numbers[1]]);
    await expect(customerList('alice', null, 0)).rejects.toMatchObject({ code: '22023' });
    await expect(customerList('alice', null, 101)).rejects.toMatchObject({ code: '22023' });
  });

  test('a closed account reads but cannot file, and recovers when restored', async () => {
    const made = await customerFile('dave', body());
    const replayCommand = randomUUID();
    const first = await customerFile('dave', body({ category: 'words_wrong' }), replayCommand);
    await closeAccount('dave');
    const before = await counts();
    await expect(customerFile('dave', body())).rejects.toMatchObject(closedAccount);
    expect(await counts()).toEqual(before);
    expect(await customerList('dave')).toHaveLength(2);
    expect(await customerGet('dave', made.reference)).toMatchObject({ status: 'received' });
    // a replay is answered from the first result, not refused as a new filing
    expect(await customerFile('dave', body({ category: 'words_wrong' }), replayCommand)).toEqual({
      ...first,
      changed: false,
    });
    await restoreAccount('dave');
    expect((await customerFile('dave', body())).changed).toBe(true);
  });

  test('a disabled customer is refused', async () => {
    await customerFile('zed', body());
    await f.owner.query('ALTER TABLE customer_private.principal DISABLE TRIGGER USER');
    await f.owner.query('UPDATE customer_private.principal SET disabled_at=now() WHERE id=$1', [
      ids.zed,
    ]);
    try {
      await expect(customerFile('zed', body())).rejects.toMatchObject({ code: '42501' });
      await expect(customerList('zed')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await f.owner.query('UPDATE customer_private.principal SET disabled_at=NULL WHERE id=$1', [
        ids.zed,
      ]);
      await f.owner.query('ALTER TABLE customer_private.principal ENABLE TRIGGER USER');
    }
    expect((await customerFile('zed', body())).changed).toBe(true);
  });
});

describe('identities never mix', () => {
  test('a customer session is refused on every staff and team function, and the reverse', async () => {
    const reference = (await customerFile('alice', body())).reference as string;
    const id = await reportId(reference);
    const customerCalls: (() => Promise<unknown>)[] = [
      () =>
        h.sql('alice', 'SELECT app.problem_report_command($1,$2)', [
          randomUUID(),
          JSON.stringify(teamBody()),
        ]),
      () => h.sql('alice', 'SELECT app.problem_report_list(NULL,25)'),
      () => h.sql('alice', 'SELECT app.problem_report_get($1)', [reference]),
      () => h.sql('alice', 'SELECT customer.problem_report_queue(NULL,25,NULL)'),
      () =>
        h.sql('alice', 'SELECT customer.problem_report_transition($1,$2,$3,$4,$5)', [
          randomUUID(),
          id,
          'received',
          'in_review',
          null,
        ]),
      () =>
        h.sql('alice', 'SELECT customer.problem_report_remove_words($1,$2)', [
          randomUUID(),
          randomUUID(),
        ]),
    ];
    for (const call of customerCalls) await expect(call()).rejects.toMatchObject({ code: '42501' });
    const staffCalls: (() => Promise<unknown>)[] = [
      () =>
        as(ctxOf('owner'), 'SELECT customer.problem_report_command($1,$2)', [
          randomUUID(),
          JSON.stringify(body()),
        ]),
      () => as(ctxOf('owner'), 'SELECT customer.problem_report_list(NULL,25)'),
      () => as(ctxOf('owner'), 'SELECT customer.problem_report_get($1)', [reference]),
    ];
    for (const call of staffCalls) await expect(call()).rejects.toMatchObject({ code: '42501' });
    // a person who is staff but belongs to no workspace of the session has no team authority
    await expect(teamFile(ctxOf('outsider'), teamBody())).rejects.toMatchObject({ code: '42501' });
    await expect(
      as({ ...ctxOf('owner'), token: 'no-such-token' }, 'SELECT app.problem_report_list(NULL,25)'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('a team member who is no longer valid is refused', () => {
  const viewer = () => ctxOf('viewer');
  const refusedEverywhere = async (ctx: RequestContext) => {
    const before = await counts();
    await expect(teamFile(ctx, teamBody())).rejects.toMatchObject({ code: '42501' });
    await expect(teamList(ctx)).rejects.toMatchObject({ code: '42501' });
    await expect(teamGet(ctx, 'RP-000001')).rejects.toMatchObject({ code: '42501' });
    expect(await counts()).toEqual(before);
  };
  const allowed = async () => {
    expect(Array.isArray(await teamList(viewer()))).toBe(true);
  };
  const withoutTriggers = async (table: string, work: () => Promise<unknown>) => {
    await f.owner.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    try {
      await work();
    } finally {
      await f.owner.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  };

  test('a revoked membership', async () => {
    await allowed();
    await withoutTriggers('app.membership', async () => {
      await f.owner.query('UPDATE app.membership SET revoked_at=now() WHERE user_id=$1', [
        f.users.viewer!.id,
      ]);
      try {
        await refusedEverywhere(viewer());
      } finally {
        await f.owner.query('UPDATE app.membership SET revoked_at=NULL WHERE user_id=$1', [
          f.users.viewer!.id,
        ]);
      }
    });
    await allowed();
  });

  test('a disabled principal', async () => {
    await allowed();
    await withoutTriggers('identity.principal', async () => {
      await f.owner.query('UPDATE identity.principal SET disabled_at=now() WHERE id=$1', [
        f.users.viewer!.id,
      ]);
      try {
        await refusedEverywhere(viewer());
      } finally {
        await f.owner.query('UPDATE identity.principal SET disabled_at=NULL WHERE id=$1', [
          f.users.viewer!.id,
        ]);
      }
    });
    await allowed();
  });

  test('an expired session and a session older than 24 hours', async () => {
    await allowed();
    const original = (
      await f.owner.query('SELECT "expiresAt","createdAt" FROM identity.session WHERE id=$1', [
        f.users.viewer!.sessionId,
      ])
    ).rows[0] as { expiresAt: Date; createdAt: Date };
    const set = (expires: string, created: string) =>
      f.owner.query(
        `UPDATE identity.session SET "expiresAt"=${expires},"createdAt"=${created} WHERE id=$1`,
        [f.users.viewer!.sessionId],
      );
    await withoutTriggers('identity.session', async () => {
      try {
        await set("now()-interval '1 minute'", "now()-interval '2 hours'");
        await refusedEverywhere(viewer());
        await set("now()+interval '1 hour'", "now()-interval '25 hours'");
        await refusedEverywhere(viewer());
      } finally {
        await f.owner.query(
          'UPDATE identity.session SET "expiresAt"=$2,"createdAt"=$3 WHERE id=$1',
          [f.users.viewer!.sessionId, original.expiresAt, original.createdAt],
        );
      }
    });
    await allowed();
  });

  test('a purpose that the membership does not allow', async () => {
    await allowed();
    await refusedEverywhere({ ...viewer(), purpose: 'commercial_qualification' });
    await allowed();
  });
});

describe('what may be written', () => {
  const invalid: [string, unknown][] = [
    ['an unknown category', body({ category: 'broken' })],
    ['a missing category', { pageKind: 'this_page', page: '/account/requests' }],
    ['a category that is not text', body({ category: 1 })],
    ['an unknown page kind', body({ pageKind: 'elsewhere' })],
    ['a missing page', { category: 'did_not_work', pageKind: 'this_page' }],
    ['a page that is not text', body({ page: 5 })],
    ['a detail that is not text', body({ detail: 7 })],
    ['an extra key', body({ extra: 'x' })],
    ['a person id', body({ principalId: randomUUID() })],
    ['a side', body({ side: 'real' })],
    ['a path of another shell', body({ page: '/operator/requests' })],
    ['a path that only starts like the shell', body({ page: '/accounts' })],
    ['a path with a query', body({ page: '/account/requests?tab=1' })],
    ['a path with a fragment', body({ page: '/account/requests#top' })],
    ['a path with a uuid segment', body({ page: `/account/requests/${randomUUID()}` })],
    ['a path with an upper case uuid', body({ page: `/account/${randomUUID().toUpperCase()}` })],
    ['a path of 201 characters', body({ page: `/account/${'a'.repeat(192)}` })],
    ['a link instead of a path', body({ page: 'https://example.invalid/account' })],
    ['a path with an at sign', body({ page: '/account/a@b' })],
    ['an empty path', body({ page: '' })],
    ['another page of 121 characters', body({ pageKind: 'another_page', page: 'a'.repeat(121) })],
    ['another page that is empty', body({ pageKind: 'another_page', page: '   ' })],
    ['another page with a link', body({ pageKind: 'another_page', page: 'see www.example' })],
    ['another page with a control character', body({ pageKind: 'another_page', page: 'a\u0007b' })],
    ['a detail of 1001 characters', body({ detail: 'a'.repeat(1001) })],
    ['something else with no detail', body({ category: 'something_else' })],
    ['something else with an empty detail', body({ category: 'something_else', detail: '   ' })],
    ['something else with 9 characters', body({ category: 'something_else', detail: '123456789' })],
    ['a detail with a control character', body({ detail: 'a long enough\u0007 detail' })],
    ['a detail with a line break inside', body({ detail: 'first line\nsecond line' })],
    ['a detail with an at sign', body({ detail: 'write to someone@example' })],
    ['a detail with a link', body({ detail: 'see https://example.invalid/x' })],
    ['a detail with www.', body({ detail: 'see www.example for it' })],
    ['an array', [body()]],
    ['a number', 5],
    ['a json null', null],
  ];
  test('the database refuses every invalid customer filing with 22023 and writes nothing', async () => {
    const before = await counts();
    for (const [label, input] of invalid)
      await expect(customerFile('kay', input), label).rejects.toMatchObject({ code: '22023' });
    expect(await counts()).toEqual(before);
    await expect(
      h.sql('kay', 'SELECT customer.problem_report_command($1,NULL)', [randomUUID()]),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      h.sql('kay', 'SELECT customer.problem_report_command(NULL,$1)', [JSON.stringify(body())]),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await counts()).toEqual(before);
  });

  test('the same rules hold for a team filing, which keeps to its own shell', async () => {
    const before = await counts();
    for (const input of [
      body({ page: '/account/requests' }),
      teamBody({ page: '/operatorx' }),
      teamBody({ page: '/operator/requests?x=1' }),
      teamBody({ page: `/operator/${randomUUID()}` }),
      teamBody({ category: 'something_else', detail: 'short' }),
      teamBody({ extra: true }),
      teamBody({ detail: 'mail me at a@b' }),
    ])
      await expect(teamFile(ctxOf('reviewer'), input)).rejects.toMatchObject({ code: '22023' });
    expect(await counts()).toEqual(before);
  });

  test('the limits themselves are accepted, and an empty detail is no detail', async () => {
    const longest = '/account/' + 'a'.repeat(191);
    expect(longest).toHaveLength(200);
    const accepted: [Record<string, unknown>, Row][] = [
      [body({ detail: 'a'.repeat(1000) }), { detail: 'a'.repeat(1000) }],
      [body({ category: 'something_else', detail: '1234567890' }), { detail: '1234567890' }],
      [body({ page: '/account/problem-reports/:id' }), { page: '/account/problem-reports/:id' }],
      [body({ page: '/account' }), { page: '/account' }],
      [body({ page: longest }), { page: longest }],
      [body({ pageKind: 'another_page', page: 'a'.repeat(120) }), { page: 'a'.repeat(120) }],
      [body({ detail: '' }), { detail: null }],
      [body({ detail: null }), { detail: null }],
      [body({ detail: 'Seen on WWW.EXAMPLE only in capitals' }), { detail: expect.any(String) }],
    ];
    for (const [input, expected] of accepted) {
      const made = await customerFile('lee', input);
      expect(made.changed).toBe(true);
      expect((await customerGet('lee', made.reference)).words).toMatchObject(expected);
    }
    const trimmed = await customerFile(
      'lee',
      body({
        pageKind: 'another_page',
        page: '  Meetings  ',
        detail: '\n  ten or more characters \t',
      }),
    );
    expect((await customerGet('lee', trimmed.reference)).words).toMatchObject({
      page: 'Meetings',
      detail: 'ten or more characters',
    });
  });

  test('the table rules hold for the schema owner as well, apart from the function', async () => {
    const reference = (await customerFile('alice', body())).reference as string;
    const id = await reportId(reference);
    const insertWords = (over: Record<string, unknown>) =>
      f.owner.query(
        `INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text,detail)
         SELECT r.id,r.reporter_kind,r.category,$2,$3,$4 FROM customer_private.problem_report r WHERE r.id=$1`,
        [id, over.pageKind, over.page, over.detail ?? null],
      );
    // each of these is a check violation, because the words of this report already exist the first test is the key
    const fresh = async (category: string, kind = 'customer') => {
      const made = await f.owner.query(
        `INSERT INTO customer_private.problem_report(reporter_kind,customer_principal_id,side,category,command_id)
         VALUES($1,$2,'sample',$3,$4) RETURNING id`,
        [kind, kind === 'customer' ? ids.kay : null, category, randomUUID()],
      );
      return made.rows[0].id as string;
    };
    const wordsFor = async (
      reportIdValue: string,
      category: string,
      pageKind: string,
      page: string,
      detail: string | null,
      kind = 'customer',
    ) =>
      f.owner.query(
        `INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text,detail)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [reportIdValue, kind, category, pageKind, page, detail],
      );
    await expect(insertWords({ pageKind: 'this_page', page: '/account/x' })).rejects.toMatchObject({
      code: '23505',
    });
    const r1 = await fresh('did_not_work');
    for (const [kind, page] of [
      ['this_page', '/operator/x'],
      ['this_page', '/account/x?y'],
      ['this_page', '/account/x#y'],
      ['this_page', `/account/${randomUUID()}`],
      ['this_page', '/account/a@b'],
      ['this_page', 'https://example.invalid'],
      ['another_page', ''],
      ['another_page', 'a'.repeat(121)],
      ['another_page', 'a www.b'],
      ['another_page', 'a://b'],
      ['another_page', 'a\u0001b'],
    ])
      await expect(wordsFor(r1, 'did_not_work', kind!, page!, null)).rejects.toMatchObject({
        code: '23514',
      });
    for (const detail of ['a'.repeat(1001), 'x@y.z', 'a://b', 'www.x', 'a\u007fb', ''])
      await expect(
        wordsFor(r1, 'did_not_work', 'this_page', '/account/x', detail),
      ).rejects.toMatchObject({ code: '23514' });
    const r2 = await fresh('something_else');
    await expect(
      wordsFor(r2, 'something_else', 'this_page', '/account/x', '123456789'),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      wordsFor(r2, 'something_else', 'this_page', '/account/x', null),
    ).rejects.toMatchObject({ code: '23514' });
    // the words must name the category and kind of their report
    await expect(
      wordsFor(r2, 'did_not_work', 'this_page', '/account/x', null),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      wordsFor(r2, 'something_else', 'this_page', '/operator/x', 'long enough', 'team'),
    ).rejects.toMatchObject({ code: '23503' });
    // a customer path is not allowed for a team report and the reverse
    const team = await f.owner.query(
      `INSERT INTO customer_private.problem_report(reporter_kind,staff_principal_id,staff_tenant_id,side,category,command_id)
       VALUES('team',$1,$2,'sample','did_not_work',$3) RETURNING id`,
      [f.users.operator!.id, f.tenantA, randomUUID()],
    );
    await expect(
      wordsFor(team.rows[0].id, 'did_not_work', 'this_page', '/account/x', null, 'team'),
    ).rejects.toMatchObject({ code: '23514' });
    await wordsFor(team.rows[0].id, 'did_not_work', 'this_page', '/operator/x', null, 'team');
  });

  test('exactly one reporter is allowed on a report, and the two kinds never mix', async () => {
    const insert = (columns: string, values: unknown[]) =>
      f.owner.query(
        `INSERT INTO customer_private.problem_report(${columns},side,category,command_id)
         VALUES(${values.map((_, index) => `$${index + 1}`).join(',')},'sample','did_not_work',$${values.length + 1})`,
        [...values, randomUUID()],
      );
    await expect(
      insert('reporter_kind,customer_principal_id,staff_principal_id,staff_tenant_id', [
        'customer',
        ids.kay,
        f.users.owner!.id,
        f.tenantA,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('reporter_kind,customer_principal_id,staff_principal_id,staff_tenant_id', [
        'team',
        ids.kay,
        f.users.owner!.id,
        f.tenantA,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(insert('reporter_kind', ['customer'])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('reporter_kind', ['team'])).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('reporter_kind,staff_principal_id', ['team', f.users.owner!.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('reporter_kind,customer_principal_id', ['person', ids.kay]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('idempotency', () => {
  test('the same command and body answers with the same reference and writes nothing', async () => {
    const command = randomUUID();
    const input = body({ category: 'could_not_find', detail: 'I looked for the meetings page.' });
    const first = await customerFile('kay', input, command);
    const before = await counts();
    const again = await customerFile('kay', input, command);
    expect(again).toEqual({ ...first, changed: false });
    // spacing around the words is not a different body
    expect(
      await customerFile(
        'kay',
        body({ category: 'could_not_find', detail: '  I looked for the meetings page.  ' }),
        command,
      ),
    ).toEqual({ ...first, changed: false });
    expect(await counts()).toEqual(before);
  });

  test('the same command with a different body is a conflict and writes nothing', async () => {
    const command = randomUUID();
    await customerFile('kay', body({ detail: 'First words for this report.' }), command);
    const before = await counts();
    for (const other of [
      body({ detail: 'Different words for this report.' }),
      body({ detail: null }),
      body({ category: 'words_wrong', detail: 'First words for this report.' }),
      body({ page: '/account/requests/:id', detail: 'First words for this report.' }),
      body({ pageKind: 'another_page', page: 'Requests', detail: 'First words for this report.' }),
    ])
      await expect(customerFile('kay', other, command)).rejects.toMatchObject(conflict);
    expect(await counts()).toEqual(before);
    // another person may use the same command id, because the key is the reporter and the id
    expect((await customerFile(spare(), body(), command)).changed).toBe(true);
  });

  test('a team replay is answered, a conflict is refused and a customer id does not clash', async () => {
    const command = randomUUID();
    const first = await teamFile(
      ctxOf('viewer'),
      teamBody({ detail: 'Seen on the team page.' }),
      command,
    );
    const before = await counts();
    expect(
      await teamFile(ctxOf('viewer'), teamBody({ detail: 'Seen on the team page.' }), command),
    ).toEqual({ ...first, changed: false });
    await expect(
      teamFile(ctxOf('viewer'), teamBody({ detail: 'Other words altogether.' }), command),
    ).rejects.toMatchObject(conflict);
    expect(await counts()).toEqual(before);
    expect((await customerFile(spare(), body(), command)).changed).toBe(true);
  });
});

describe('the limit of 10 in a rolling 24 hours', () => {
  test('the 10th is filed, the 11th is refused with nothing written, a replay of the 10th is still answered', async () => {
    const commands: string[] = [];
    for (let index = 0; index < 10; index++) {
      commands.push(randomUUID());
      expect((await customerFile('hank', body(), commands[index])).changed).toBe(true);
    }
    const before = { ...(await counts()), ...(await otherRecords()) };
    await expect(customerFile('hank', body())).rejects.toMatchObject(tooMany);
    expect({ ...(await counts()), ...(await otherRecords()) }).toEqual(before);
    const replay = await customerFile('hank', body(), commands[9]);
    expect(replay.changed).toBe(false);
    await expect(
      customerFile('hank', body({ category: 'words_wrong' }), commands[9]),
    ).rejects.toMatchObject(conflict);
    // another person is not held back by this one
    expect((await customerFile(spare(), body())).changed).toBe(true);
    // the limit is read, with the shape of a failed filing, before anything is written
    expect(await customerList('hank', null, 100)).toHaveLength(10);
  });

  test('a report older than 24 hours is not counted, and one inside the window is', async () => {
    const backdate = async (person: string, hours: number) => {
      const made = await f.owner.query(
        `INSERT INTO customer_private.problem_report(reporter_kind,customer_principal_id,side,category,command_id,filed_at)
         VALUES('customer',$1,'sample','did_not_work',$2,clock_timestamp()-make_interval(hours=>$3)) RETURNING id`,
        [ids[person], randomUUID(), hours],
      );
      await f.owner.query(
        `INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text)
         VALUES($1,'customer','did_not_work','this_page','/account')`,
        [made.rows[0].id],
      );
      await f.owner.query(
        "INSERT INTO customer_private.problem_report_status_event(report_id,state) VALUES($1,'received')",
        [made.rows[0].id],
      );
    };
    for (let index = 0; index < 10; index++) await backdate('ivan', 25);
    expect((await customerFile('ivan', body())).changed).toBe(true);
    for (let index = 0; index < 8; index++) await backdate('ivan', 23);
    // 1 new + 8 inside the window = 9, so one more is allowed and the next is not
    expect((await customerFile('ivan', body())).changed).toBe(true);
    await expect(customerFile('ivan', body())).rejects.toMatchObject(tooMany);
  });

  test('concurrent filings by one person hold the cap', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 14 }, () => customerFile('jude', body())),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused).toHaveLength(4);
    for (const result of refused)
      expect((result as PromiseRejectedResult).reason).toMatchObject(tooMany);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report WHERE customer_principal_id=$1',
          [ids.jude],
        )
      ).rows[0].n,
    ).toBe(10);
  });

  test('a team member is held to the same cap', async () => {
    const ctx = ctxOf('reviewer');
    const filed = (await teamList(ctx)).length;
    for (let index = filed; index < 10; index++)
      expect((await teamFile(ctx, teamBody())).changed).toBe(true);
    const before = await counts();
    await expect(teamFile(ctx, teamBody())).rejects.toMatchObject(tooMany);
    expect(await counts()).toEqual(before);
  });
});

describe('triage', () => {
  const owner = () => ctxOf('owner');

  test('every allowed move, with the reporter reading each note in order', async () => {
    const before = await otherRecords();
    const a = await fileSample({ detail: 'First of the four moves.' });
    const b = await fileSample();
    const c = await fileSample();
    const person = (reference: string) => filedBy.get(reference)!;
    const first = await queue(owner());
    const item = (reference: string) => first.items.find((row) => row.reference === reference)!;
    expect(item(a)).toMatchObject({
      status: 'received',
      reporterKind: 'customer',
      category: 'did_not_work',
      pageKind: 'this_page',
      page: '/account/requests',
      detail: 'First of the four moves.',
      side: 'sample',
      wordsRemoved: false,
    });
    // received to in_review, with and without a note
    expect(await move(owner(), item(a).id as string, 'received', 'in_review')).toMatchObject({
      status: 'in_review',
      note: null,
      changed: true,
    });
    expect(
      await move(owner(), item(c).id as string, 'received', 'in_review', 'Looking at this today.'),
    ).toMatchObject({ status: 'in_review', note: 'Looking at this today.' });
    // in_review to resolved, and in_review to closed
    expect(
      await move(
        owner(),
        item(a).id as string,
        'in_review',
        'resolved',
        'We fixed the save button.',
      ),
    ).toMatchObject({ status: 'resolved', note: 'We fixed the save button.' });
    expect(
      await move(
        owner(),
        item(c).id as string,
        'in_review',
        'closed',
        'This is a duplicate of RP-1.',
      ),
    ).toMatchObject({ status: 'closed' });
    // received to closed
    expect(
      await move(owner(), item(b).id as string, 'received', 'closed', 'Nothing to act on here.'),
    ).toMatchObject({ status: 'closed', note: 'Nothing to act on here.' });
    // the reporter reads the notes in order, the staff names never leave
    const read = await customerGet(person(a), a);
    expect(read).toMatchObject({ status: 'resolved' });
    expect((read.history as Row[]).map((row) => [row.state, row.note])).toEqual([
      ['received', null],
      ['in_review', null],
      ['resolved', 'We fixed the save button.'],
    ]);
    expect(JSON.stringify(read)).not.toMatch(/staff|principal|tenant/i);
    const readC = await customerGet(person(c), c);
    expect((readC.history as Row[]).map((row) => [row.state, row.note])).toEqual([
      ['received', null],
      ['in_review', 'Looking at this today.'],
      ['closed', 'This is a duplicate of RP-1.'],
    ]);
    expect(await otherRecords()).toEqual(before);
    // the queue reflects the states, the counts and the oldest waiting
    const after = await queue(owner());
    expect(after.items.find((row) => row.reference === a)).toMatchObject({ status: 'resolved' });
    expect(after.counts.resolved).toBeGreaterThanOrEqual(1);
    expect(after.counts.closed).toBeGreaterThanOrEqual(2);
    expect(after.total).toBe(after.items.length);
    const closedOnly = await queue(owner(), 'closed');
    expect(closedOnly.items.every((row) => row.status === 'closed')).toBe(true);
    expect(closedOnly.total).toBe(closedOnly.items.length);
    expect(closedOnly.counts).toEqual(after.counts);
  });

  test('every refused move, a stale state and the end states', async () => {
    const reference = await fileSample();
    const id = await reportId(reference);
    const before = await counts();
    // received cannot go straight to resolved, and nothing returns to received
    await expect(
      move(owner(), id, 'received', 'resolved', 'Resolved without a review.'),
    ).rejects.toMatchObject(notAllowed);
    await expect(move(owner(), id, 'received', 'received')).rejects.toMatchObject(notAllowed);
    await move(owner(), id, 'received', 'in_review');
    // a stale expected state is a different refusal
    await expect(
      move(owner(), id, 'received', 'closed', 'Closing from a stale screen.'),
    ).rejects.toMatchObject(changed);
    await expect(
      move(owner(), id, 'resolved', 'closed', 'Closing from a stale screen.'),
    ).rejects.toMatchObject(changed);
    await expect(move(owner(), id, 'in_review', 'in_review')).rejects.toMatchObject(notAllowed);
    await expect(move(owner(), id, 'in_review', 'received')).rejects.toMatchObject(notAllowed);
    await move(owner(), id, 'in_review', 'resolved', 'Done and written down.');
    for (const [expected, to] of [
      ['resolved', 'closed'],
      ['resolved', 'in_review'],
      ['resolved', 'resolved'],
      ['resolved', 'received'],
      ['closed', 'resolved'],
      ['closed', 'in_review'],
    ] as const)
      await expect(move(owner(), id, expected, to, 'A long enough note.')).rejects.toMatchObject(
        expected === 'resolved' ? notAllowed : changed,
      );
    expect((await counts()).statuses).toBe(before.statuses! + 2);
    const closed = await fileSample();
    const closedId = await reportId(closed);
    await move(owner(), closedId, 'received', 'closed', 'Closed straight away.');
    for (const to of ['in_review', 'resolved', 'closed', 'received'])
      await expect(
        move(owner(), closedId, 'closed', to, 'A long enough note.'),
      ).rejects.toMatchObject(notAllowed);
    // an unknown state is a malformed change
    await expect(move(owner(), id, 'resolved', 'archived')).rejects.toMatchObject({
      code: '22023',
    });
    await expect(
      move(owner(), id, 'nowhere', 'closed', 'A long enough note.'),
    ).rejects.toMatchObject({
      code: '22023',
    });
  });

  test('the note rules', async () => {
    const reference = await fileSample();
    const id = await reportId(reference);
    const before = await counts();
    const bad: [string, string | null][] = [
      ['no note', null],
      ['a blank note', '    '],
      ['9 characters', '123456789'],
      ['1001 characters', 'a'.repeat(1001)],
      ['a control character', 'a note with a\u0007 bell'],
      ['a line break inside', 'a note with a\nline break'],
      ['an at sign', 'write to me at x@example'],
      ['a link', 'see https://example.invalid for it'],
      ['www.', 'see www.example for it'],
    ];
    for (const [label, note] of bad) {
      await expect(move(owner(), id, 'received', 'closed', note), label).rejects.toMatchObject({
        code: '22023',
      });
      if (note !== null && note.trim() !== '')
        await expect(move(owner(), id, 'received', 'in_review', note), label).rejects.toMatchObject(
          {
            code: '22023',
          },
        );
    }
    expect(await counts()).toEqual(before);
    // the limits, and a note that is optional for in_review
    const first = await move(owner(), id, 'received', 'in_review', 'a'.repeat(1000));
    expect((first.note as string).length).toBe(1000);
    await expect(move(owner(), id, 'in_review', 'resolved')).rejects.toMatchObject({
      code: '22023',
    });
    expect(await move(owner(), id, 'in_review', 'resolved', '1234567890')).toMatchObject({
      note: '1234567890',
    });
    const another = await reportId(await fileSample());
    expect(await move(owner(), another, 'received', 'in_review', '   ')).toMatchObject({
      note: null,
    });
  });

  test('a move is idempotent by command id, and any other use of the id is refused', async () => {
    const id = await reportId(await fileSample());
    const command = randomUUID();
    const first = await move(owner(), id, 'received', 'in_review', 'Taking this one.', command);
    expect(first.changed).toBe(true);
    const second = await reportId(await fileSample());
    const before = await counts();
    expect(await move(owner(), id, 'received', 'in_review', 'Taking this one.', command)).toEqual({
      ...first,
      changed: false,
    });
    await expect(
      move(owner(), id, 'received', 'in_review', 'A different note here.', command),
    ).rejects.toMatchObject(conflict);
    await expect(
      move(owner(), id, 'in_review', 'closed', 'Taking this one.', command),
    ).rejects.toMatchObject(conflict);
    await expect(
      move(owner(), second, 'received', 'in_review', 'Taking this one.', command),
    ).rejects.toMatchObject(conflict);
    expect(await counts()).toEqual(before);
    // two screens moving the same report with different commands: the second sees it changed
    const race = await reportId(await fileSample());
    const results = await Promise.allSettled([
      move(owner(), race, 'received', 'in_review'),
      move(owner(), race, 'received', 'in_review'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject(changed);
  });

  test('operator, reviewer, viewer and a stale authenticator are refused, and recover', async () => {
    const id = await reportId(await fileSample());
    const before = await counts();
    for (const who of ['operator', 'reviewer', 'viewer']) {
      await expect(queue(ctxOf(who))).rejects.toMatchObject({ code: '42501' });
      await expect(move(ctxOf(who), id, 'received', 'in_review')).rejects.toMatchObject({
        code: '42501',
      });
    }
    await expect(queue(ctxOf('outsider'))).rejects.toMatchObject({ code: '42501' });
    await staleAuthenticator('owner', true);
    try {
      await expect(queue(owner())).rejects.toMatchObject({ code: '42501' });
      await expect(move(owner(), id, 'received', 'in_review')).rejects.toMatchObject({
        code: '42501',
      });
      // the same session can still file and read its own team reports
      expect((await teamFile(owner(), teamBody())).changed).toBe(true);
    } finally {
      await staleAuthenticator('owner', false);
    }
    expect(await counts()).toEqual({
      ...before,
      reports: before.reports! + 1,
      words: before.words! + 1,
      statuses: before.statuses! + 1,
    });
    expect(await move(owner(), id, 'received', 'in_review')).toMatchObject({ changed: true });
  });

  test('the queue pages, filters, counts and never shows a name or email', async () => {
    const all = await queue(owner());
    expect(all.items.length).toBeGreaterThan(3);
    expect(all.oldestReceivedAt).toEqual(expect.any(String));
    const numbers = all.items.map((row) => row.number as number);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
    const rest = await queuePage(owner(), null, numbers[1]!, 3);
    expect(rest.items.map((row) => row.number)).toEqual(numbers.slice(2, 5));
    expect(rest.total).toBe(all.total);
    const page = await queuePage(owner(), null, null, 2);
    expect(page.items.map((row) => row.number)).toEqual(numbers.slice(0, 2));
    expect(page.total).toBe(all.total);
    const json = JSON.stringify(all);
    for (const pattern of [/@example\.invalid/, /Synthetic /, /principal/i, /email/i])
      expect(json).not.toMatch(pattern);
    for (const bad of [0, 101, null])
      await expect(
        as(owner(), 'SELECT customer.problem_report_queue(NULL,$1,NULL)', [bad]),
      ).rejects.toMatchObject({ code: '22023' });
    await expect(
      as(owner(), "SELECT customer.problem_report_queue(NULL,10,'archived')"),
    ).rejects.toMatchObject({ code: '22023' });
    const none = await queuePage(owner(), 'received', 2 ** 40);
    expect(none.items).toEqual([]);
  });

  test('a team report is triaged only in the staff workspace it was filed in', async () => {
    const reference = (await teamFile(ctxOf('operator'), teamBody({ detail: 'Seen by the team.' })))
      .reference as string;
    const id = await reportId(reference);
    const listed = (await queue(owner())).items.find((row) => row.reference === reference)!;
    expect(listed).toMatchObject({
      reporterKind: 'team',
      side: 'sample',
      page: '/operator/requests',
    });
    // staff of another workspace cannot see or move it
    await expect(move(ctxOf('other'), id, 'received', 'in_review')).rejects.toMatchObject(notFound);
    expect((await queue(ctxOf('other'))).items.map((row) => row.reference)).not.toContain(
      reference,
    );
    await move(owner(), id, 'received', 'in_review', 'Looking into the team report.');
    expect(await teamGet(ctxOf('operator'), reference)).toMatchObject({
      status: 'in_review',
      history: [
        { state: 'received', note: null },
        { state: 'in_review', note: 'Looking into the team report.' },
      ],
    });
  });
});

describe('every table and function is closed to the runtime', () => {
  const tables = [
    'problem_report',
    'problem_report_words',
    'problem_report_status_event',
    'problem_report_erasure',
    'problem_report_self_removal',
  ];
  test('no role but the owner has any privilege on the five tables, and row security is on', async () => {
    for (const table of tables) {
      for (const role of ['public', 'corridra_runtime', 'corridra_auth'])
        for (const privilege of [
          'SELECT',
          'INSERT',
          'UPDATE',
          'DELETE',
          'TRUNCATE',
          'REFERENCES',
          'TRIGGER',
        ])
          expect(
            (
              await f.owner.query('SELECT has_table_privilege($1,$2,$3) AS yes', [
                role,
                `customer_private.${table}`,
                privilege,
              ])
            ).rows[0].yes,
            `${role} ${privilege} ${table}`,
          ).toBe(false);
      expect(
        (
          await f.owner.query(
            "SELECT relrowsecurity FROM pg_class WHERE oid=('customer_private.'||$1)::regclass",
            [table],
          )
        ).rows[0].relrowsecurity,
      ).toBe(true);
      await expect(
        as(ctxOf('owner'), `SELECT * FROM customer_private.${table}`),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(h.sql('alice', `SELECT * FROM customer_private.${table}`)).rejects.toMatchObject(
        { code: '42501' },
      );
    }
    await expect(
      as(
        ctxOf('owner'),
        "INSERT INTO customer_private.problem_report_status_event(report_id,state) VALUES(gen_random_uuid(),'received')",
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('only the ten intended functions are callable, by the runtime role alone', async () => {
    const intended = [
      'app.problem_report_command',
      'app.problem_report_get',
      'app.problem_report_list',
      'customer.problem_report_command',
      'customer.problem_report_get',
      'customer.problem_report_list',
      'customer.problem_report_queue',
      'customer.problem_report_remove_own_words',
      'customer.problem_report_remove_words',
      'customer.problem_report_transition',
    ];
    const rows = (
      await f.owner.query(
        `SELECT n.nspname||'.'||p.proname AS name,p.oid,
         has_function_privilege('public',p.oid,'EXECUTE') AS pub,
         has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,
         has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('app','customer','customer_private') AND (p.proname LIKE 'problem_report%' OR p.proname='staff_problem_actor')`,
      )
    ).rows as { name: string; pub: boolean; runtime: boolean; auth: boolean }[];
    expect(
      rows
        .filter((row) => row.runtime)
        .map((row) => row.name)
        .sort(),
    ).toEqual(intended);
    for (const row of rows) {
      expect(row.pub, row.name).toBe(false);
      expect(row.auth, row.name).toBe(false);
    }
    expect(
      rows.filter((row) => row.name.startsWith('customer_private.')).length,
    ).toBeGreaterThanOrEqual(10);
    // the module owns no function that takes a person id
    const withPerson = await f.owner.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','customer') AND p.proname LIKE 'problem_report%'
       AND (pg_get_function_arguments(p.oid) ~* '(person|principal|actor|customer_id|user)')`,
    );
    expect(withPerson.rows).toEqual([]);
    for (const call of [
      'SELECT customer_private.problem_report_side($1)',
      'SELECT customer_private.problem_report_in_scope($1)',
    ])
      await expect(as(ctxOf('owner'), call, [randomUUID()])).rejects.toMatchObject({
        code: '42501',
      });
    await expect(
      as(ctxOf('owner'), 'SELECT customer_private.staff_problem_actor()'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('every function has a fixed search path', () => {
  test('all are pinned to pg_catalog and run as the owner, except the three pure helpers', async () => {
    const rows = (
      await f.owner.query(
        `SELECT n.nspname||'.'||p.proname AS name,p.prosecdef,
         coalesce('search_path=pg_catalog'=ANY(p.proconfig),false) AS pinned
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('customer_private','customer','app')
         AND (p.proname LIKE 'problem_report%' OR p.proname='staff_problem_actor')`,
      )
    ).rows as { name: string; prosecdef: boolean; pinned: boolean }[];
    expect(rows.length).toBeGreaterThanOrEqual(19);
    const pure = [
      'customer_private.problem_report_plain',
      'customer_private.problem_report_path_ok',
      'customer_private.problem_report_parse',
    ];
    for (const row of rows) {
      expect(row.pinned, `${row.name} search path`).toBe(true);
      expect(row.prosecdef, `${row.name} security definer`).toBe(!pure.includes(row.name));
    }
    for (const name of pure) expect(rows.map((row) => row.name)).toContain(name);
  });
});

describe('records are append only', () => {
  test('update and removal are rejected through the owner on every table', async () => {
    const reference = (await customerFile(spare(), body())).reference as string;
    const id = await reportId(reference);
    const immutable = { code: '23514', message: 'Immutable record; append a new record' };
    for (const [table, key, value] of [
      ['problem_report', 'id', id],
      ['problem_report_words', 'report_id', id],
      ['problem_report_status_event', 'report_id', id],
    ] as const) {
      await expect(
        f.owner.query(`DELETE FROM customer_private.${table} WHERE ${key}=$1`, [value]),
        `remove ${table}`,
      ).rejects.toMatchObject(immutable);
    }
    await expect(
      f.owner.query(
        "UPDATE customer_private.problem_report SET category='words_wrong' WHERE id=$1",
        [id],
      ),
    ).rejects.toMatchObject(immutable);
    await expect(
      f.owner.query(
        "UPDATE customer_private.problem_report_words SET page_text='/account/x' WHERE report_id=$1",
        [id],
      ),
    ).rejects.toMatchObject(immutable);
    await expect(
      f.owner.query(
        "UPDATE customer_private.problem_report_status_event SET note='A long enough note' WHERE report_id=$1",
        [id],
      ),
    ).rejects.toMatchObject(immutable);
    // even a statement that changes nothing is refused, so the words cannot be re-written with the same text
    await expect(
      f.owner.query(
        'UPDATE customer_private.problem_report_words SET detail=detail WHERE report_id=$1',
        [id],
      ),
    ).rejects.toMatchObject(immutable);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report_words WHERE report_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('the chain of states is linear for the owner as well', async () => {
    const id = await reportId(await fileSample());
    const staff = f.users.owner!.id;
    const add = (
      state: string,
      expected: string | null,
      note: string | null,
      command: string | null = randomUUID(),
    ) =>
      f.owner.query(
        `INSERT INTO customer_private.problem_report_status_event(report_id,state,expected_state,note,staff_principal_id,staff_tenant_id,command_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          state,
          expected,
          note,
          expected ? staff : null,
          expected ? f.tenantA : null,
          expected ? command : null,
        ],
      );
    await expect(add('received', null, null)).rejects.toMatchObject({ code: '23505' });
    await expect(add('resolved', 'received', 'A long enough note.')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(add('in_review', 'in_review', null)).rejects.toMatchObject({ code: '23514' });
    await expect(add('closed', 'resolved', 'A long enough note.')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(add('closed', 'received', null)).rejects.toMatchObject({ code: '23514' });
    await expect(add('closed', 'received', 'short')).rejects.toMatchObject({ code: '23514' });
    await expect(add('in_review', 'received', 'x@example.invalid')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(add('in_review', 'received', null, null)).rejects.toMatchObject({ code: '23514' });
    await add('in_review', 'received', null);
    // one move out of each state, and none from a state the report never reached
    await expect(add('closed', 'received', 'A long enough note.')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(add('in_review', 'received', null)).rejects.toMatchObject({ code: '23505' });
    await add('closed', 'in_review', 'A long enough note.');
    await expect(add('resolved', 'in_review', 'A long enough note.')).rejects.toMatchObject({
      code: '23505',
    });
    const other = await reportId(await fileSample());
    await expect(
      f.owner.query(
        `INSERT INTO customer_private.problem_report_status_event(report_id,state,expected_state,note,staff_principal_id,staff_tenant_id,command_id)
         VALUES($1,'resolved','in_review','A long enough note.',$2,$3,$4)`,
        [other, staff, f.tenantA, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('every report is on exactly one staff side', () => {
  const people = {
    sampleStaff: () => ctxOf('owner'),
    realStaff: () => realCtx(),
  };
  let miaWorkspace: string;
  let olaMoeMember: string;
  let flipped: string[] = [];

  beforeAll(async () => {
    miaWorkspace = sampleWorkspace.mia!;
    // joy joined mia's workspace and was removed; rae joined sam's sample workspace and was removed
    const joyMember = await h.join('mia', 'joy', miaWorkspace);
    await revoke('mia', miaWorkspace, joyMember);
    const raeMember = await h.join('sam', 'rae', sampleWorkspace.sam!);
    await revoke('sam', sampleWorkspace.sam!, raeMember);
    // moe joins ola's workspace, which is still a sample one
    olaMoeMember = await h.join('ola', 'moe', sampleWorkspace.ola!);
  });

  test('with no real-use configuration: filing sides, the two staff sides and the denial of real staff', async () => {
    await flip(miaWorkspace, false);
    await flip(f.tenantB, false);
    flipped.push(miaWorkspace, f.tenantB);
    const filed: Record<string, string> = {};
    for (const person of ['mia', 'sam', 'nia', 'joy', 'rae'])
      filed[person] = (await customerFile(person, body())).reference as string;
    // real workspace: real. sample workspace: sample. nothing: sample while the deployment is not real.
    // joined and removed from a real workspace: still real (held once). joined and removed from a sample one: nothing now, so sample.
    const expected = { mia: 'real', sam: 'sample', nia: 'sample', joy: 'real', rae: 'sample' };
    for (const [person, side] of Object.entries(expected)) {
      expect(await storedSide(filed[person]!), person).toBe(side);
      const view = await seen(filed[person]!);
      exactlyOneSide(view);
      expect(view.effective, person).toBe(side);
    }
    // the real workspace of tenant B cannot act while real use is off, and a sample workspace always can
    await expect(teamFile(realCtx(), teamBody())).rejects.toMatchObject({ code: '42501' });
    await expect(queue(realCtx())).rejects.toMatchObject({ code: '42501' });
    expect((await queue(people.sampleStaff())).items.map((row) => row.reference)).toEqual(
      expect.arrayContaining([filed.sam, filed.nia, filed.rae]),
    );
    expect((await queue(people.sampleStaff())).items.map((row) => row.reference)).not.toEqual(
      expect.arrayContaining([filed.mia]),
    );
  });

  test('with the real-use configuration on: a customer with no workspace is real, and real staff can act', async () => {
    await realUse(true);
    try {
      // tenant B is real, so its staff need the real purpose on their membership
      await f.owner.query('ALTER TABLE app.membership DISABLE TRIGGER USER');
      await f.owner.query(
        "UPDATE app.membership SET allowed_purposes=allowed_purposes||ARRAY['commercial_qualification'] WHERE tenant_id=$1",
        [f.tenantB],
      );
      await f.owner.query('ALTER TABLE app.membership ENABLE TRIGGER USER');
      const filed: Record<string, string> = {};
      for (const person of ['mia', 'sam', 'nia', 'joy', 'rae'])
        filed[person] = (await customerFile(person, body())).reference as string;
      const expected = { mia: 'real', sam: 'sample', nia: 'real', joy: 'real', rae: 'real' };
      for (const [person, side] of Object.entries(expected)) {
        expect(await storedSide(filed[person]!), person).toBe(side);
        const view = await seen(filed[person]!);
        exactlyOneSide(view);
        expect(view.effective, person).toBe(side);
      }
      // the report nia filed while the deployment was sample stays sample
      const earlier = (await customerList('nia')).find(
        (row) => row.status === 'received' && row.reference !== filed.nia,
      )!;
      expect((await seen(earlier.reference as string)).effective).toBe('sample');
      expect(await storedSide(earlier.reference as string)).toBe('sample');
      // each side lists its own, and a report of the other side is not found
      const sampleQueue = (await queue(people.sampleStaff())).items.map((row) => row.reference);
      const realQueue = (await queue(people.realStaff())).items.map((row) => row.reference);
      for (const reference of [filed.sam!, earlier.reference as string]) {
        expect(sampleQueue).toContain(reference);
        expect(realQueue).not.toContain(reference);
      }
      for (const reference of [filed.mia!, filed.nia!, filed.joy!, filed.rae!]) {
        expect(realQueue).toContain(reference);
        expect(sampleQueue).not.toContain(reference);
      }
      const realId = await reportId(filed.nia!);
      const sampleId = await reportId(filed.sam!);
      const unknown = [
        await move(people.sampleStaff(), randomUUID(), 'received', 'in_review').catch(
          (error: Row) => error,
        ),
        await move(people.sampleStaff(), realId, 'received', 'in_review').catch(
          (error: Row) => error,
        ),
        await move(people.realStaff(), sampleId, 'received', 'in_review').catch(
          (error: Row) => error,
        ),
        await move(people.realStaff(), randomUUID(), 'received', 'in_review').catch(
          (error: Row) => error,
        ),
      ];
      for (const error of unknown) expect(error).toMatchObject(notFound);
      expect(
        new Set(unknown.map((error) => `${(error as Row).code}|${(error as Row).message}`)).size,
      ).toBe(1);
      // real staff move a real report
      expect(await move(people.realStaff(), realId, 'received', 'in_review')).toMatchObject({
        status: 'in_review',
      });
      // team filing in a real workspace works while real use is on and freezes the side
      const teamReal = (
        await teamFile(people.realStaff(), teamBody({ detail: 'A real workspace report.' }))
      ).reference as string;
      const teamSample = (await teamFile(ctxOf('operator'), teamBody())).reference as string;
      expect(await storedSide(teamReal)).toBe('real');
      expect(await storedSide(teamSample)).toBe('sample');
      expect(await seen(teamReal)).toMatchObject({ sample: false, real: true, effective: 'real' });
      expect(await seen(teamSample)).toMatchObject({
        sample: true,
        real: false,
        effective: 'sample',
      });
      expect((await teamGet(people.realStaff(), teamReal)).words).toMatchObject({
        detail: 'A real workspace report.',
      });
      await expect(teamGet(ctxOf('owner'), teamReal)).rejects.toMatchObject(notFound);
    } finally {
      await realUse(false);
    }
  });

  test('a report moves to real when its reporter gains a real workspace and never moves back', async () => {
    flipped.push(sampleWorkspace.ola!);
    const first = (await customerFile('moe', body())).reference as string;
    expect(await storedSide(first)).toBe('sample');
    exactlyOneSide(await seen(first));
    expect((await seen(first)).effective).toBe('sample');
    // ola's workspace becomes real: moe, a member of it, now has a real workspace
    await flip(sampleWorkspace.ola!, false);
    const moved = await seen(first);
    expect(moved).toMatchObject({ stored: 'sample', effective: 'real', sample: false, real: true });
    // moe is removed from it: the history cannot be rewritten, so the report stays real
    // (written by the owner role, because the access command refuses a real workspace for a synthetic session)
    await f.owner.query(
      'INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) VALUES($1,$2,$3)',
      [sampleWorkspace.ola, olaMoeMember, ids.ola],
    );
    expect(await seen(first)).toMatchObject({
      stored: 'sample',
      effective: 'real',
      sample: false,
      real: true,
    });
    const later = (await customerFile('moe', body())).reference as string;
    expect(await storedSide(later)).toBe('real');
    exactlyOneSide(await seen(later));
    // the same holds for a person who becomes the owner of a real workspace of their own
    const gained = (await customerFile('sam', body())).reference as string;
    expect((await seen(gained)).effective).toBe('sample');
    await h.makeAdmin('sam', sampleWorkspace.ola!);
    expect(await seen(gained)).toMatchObject({ effective: 'real', sample: false, real: true });
  });

  test('every report in the table is on one side only', async () => {
    const all = (
      await f.owner.query('SELECT reference FROM customer_private.problem_report ORDER BY number')
    ).rows as {
      reference: string;
    }[];
    expect(all.length).toBeGreaterThan(40);
    let sample = 0;
    let real = 0;
    for (const { reference } of all) {
      const view = await seen(reference);
      exactlyOneSide(view);
      if (view.sample) sample++;
      else real++;
    }
    expect(sample).toBeGreaterThan(0);
    expect(real).toBeGreaterThan(0);
    for (const tenant of flipped) await flip(tenant, true);
    flipped = [];
  });
});

// ADR-078 decision 6 as amended by migration 0003: a customer removes the words of their own reports. The first block runs
// with the account lifecycle control never opened (the state straight after the module is installed), so every test here
// shows the new function needs no control. The staff erasure path and the control paused are in the block after the erasure
// tests.
const removeOwn = (person: string, command: string | null = randomUUID()) =>
  h
    .sql<{ r: Row }>(person, 'SELECT customer.problem_report_remove_own_words($1) AS r', [command])
    .then((row) => row.r);
const selfRemovals = async (person: string) =>
  (
    await f.owner.query(
      'SELECT report_id,reporter_kind,customer_principal_id,command_id FROM customer_private.problem_report_self_removal WHERE customer_principal_id=$1 ORDER BY created_at,report_id',
      [ids[person]],
    )
  ).rows;
const wordsLeft = async (person: string) =>
  (
    await f.owner.query(
      'SELECT count(*)::int AS n FROM customer_private.problem_report_words w JOIN customer_private.problem_report r ON r.id=w.report_id WHERE r.customer_principal_id=$1',
      [ids[person]],
    )
  ).rows[0].n as number;
// Everything a removal must leave as it was: reference, category, filing time, side, command, and each status row with its note.
const frozen = async (person: string) =>
  (
    await f.owner.query(
      `SELECT r.reference,r.category,r.filed_at,r.side,r.command_id,
        (SELECT jsonb_agg(to_jsonb(x)-'id'-'seq' ORDER BY x.seq) FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id) AS history
       FROM customer_private.problem_report r WHERE r.customer_principal_id=$1 ORDER BY r.number`,
      [ids[person]],
    )
  ).rows;
const recordTables = [
  'customer_private.problem_report',
  'customer_private.problem_report_status_event',
  'customer_private.problem_report_erasure',
];
const closeAccountAt = (person: string, daysAgo: number) =>
  f.owner.query(
    `WITH t AS (SELECT clock_timestamp()-make_interval(days=>$3::int) AS at)
     INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
     SELECT $1,'closed',t.at,t.at+interval '720 hours',$2 FROM t`,
    [ids[person], randomUUID(), daysAgo],
  );
// Holds the per-person report lock (the one filing takes) on its own connection until released.
const holdReportLock = async (person: string) => {
  const client = await f.owner.connect();
  await client.query('BEGIN');
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('customer.problem_report:'||$1::text,0))",
    [ids[person]],
  );
  return {
    release: async () => {
      await client.query('COMMIT');
      client.release();
    },
  };
};
// True when the call has not finished after a moment (it is waiting for a lock).
const waiting = (pending: Promise<unknown>) =>
  Promise.race([
    pending.then(
      () => false,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 400)),
  ]);

describe('a customer removes the words of their own reports, with the account lifecycle control never opened', () => {
  const hosted: Record<string, string> = {};
  beforeAll(async () => {
    for (const person of ['srhost', 'src', 'sre', 'srf'])
      hosted[person] = await h.provision(person, `Synthetic ${person} workspace`);
  });

  test('the control was never opened, so nothing here depends on it', async () => {
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.account_lifecycle_control',
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await f.owner.query('SELECT customer_private.account_lifecycle_open() AS open')).rows[0]
        .open,
    ).toBe(false);
  });

  test('a customer with no workspace removes the words of all three reports; the rest of each report, its history and notes are byte-identical, and three rows name the person and the command', async () => {
    const mine: string[] = [];
    for (const detail of ['Words one of sra.', 'Words two of sra.'])
      mine.push((await customerFile('sra', body({ detail }))).reference as string);
    mine.push(
      (await customerFile('sra', body({ pageKind: 'another_page', page: 'Meetings' })))
        .reference as string,
    );
    await move(
      ctxOf('owner'),
      await reportId(mine[0]!),
      'received',
      'in_review',
      'We are reading what you wrote.',
    );
    const before = await frozen('sra');
    const tables = await digest(f, recordTables);
    const others = { ...(await counts()), ...(await otherRecords()) };
    const command = randomUUID();
    expect(await wordsLeft('sra')).toBe(3);
    expect(await removeOwn('sra', command)).toEqual({ removed: 3, changed: true });
    expect(await wordsLeft('sra')).toBe(0);
    for (const reference of mine)
      expect((await customerGet('sra', reference)).words).toEqual({ removed: true });
    expect((await customerList('sra')).map((row) => row.wordsRemoved)).toEqual([true, true, true]);
    const seen = (await queue(ctxOf('owner'))).items.filter((item) =>
      mine.includes(item.reference as string),
    );
    expect(seen).toHaveLength(3);
    for (const item of seen)
      expect(item).toMatchObject({ wordsRemoved: true, pageKind: null, page: null, detail: null });
    // the reference, category, filing time, side, status history and the staff note are exactly as they were
    expect(await frozen('sra')).toEqual(before);
    expect(await digest(f, recordTables)).toEqual(tables);
    expect(((await customerGet('sra', mine[0]!)).history as Row[]).map((row) => row.note)).toEqual([
      null,
      'We are reading what you wrote.',
    ]);
    // three rows in the new table, each naming the person and the command, and nothing else was written
    const rows = await selfRemovals('sra');
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row).toMatchObject({
        reporter_kind: 'customer',
        customer_principal_id: ids.sra,
        command_id: command,
      });
    expect(await counts()).toEqual({
      reports: others.reports,
      words: others.words! - 3,
      statuses: others.statuses,
      erasures: others.erasures,
    });
    expect(await otherRecords()).toEqual({
      events: others.events,
      audits: others.audits,
      outbox: others.outbox,
      deliveries: others.deliveries,
    });
  });

  test('a person whose only link is a revoked membership, with no account chain row, removes theirs', async () => {
    const member = await h.join('srhost', 'srb', hosted.srhost!);
    const made = [
      (await customerFile('srb', body({ detail: 'Words of the revoked member.' })))
        .reference as string,
      (await customerFile('srb', body())).reference as string,
    ];
    await revoke('srhost', hosted.srhost!, member);
    // the gap the staff path cannot close: no chain row, so no erasure request can be filed
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.account_chain WHERE principal_id=$1',
          [ids.srb],
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(
      f.owner.query('SELECT customer_private.account_chain_tenant($1)', [ids.srb]),
    ).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('no workspace') });
    expect(await removeOwn('srb')).toEqual({ removed: 2, changed: true });
    for (const reference of made)
      expect((await customerGet('srb', reference)).words).toEqual({ removed: true });
  });

  test('is refused with no signed-in customer, for the owner role, the auth role and a staff session, and writes nothing', async () => {
    const reference = (await customerFile('src', body({ detail: 'Words that must stay.' })))
      .reference as string;
    const before = await counts();
    const command = randomUUID();
    const call = 'SELECT customer.problem_report_remove_own_words($1)';
    await expect(f.owner.query(call, [command])).rejects.toMatchObject({
      code: '42501',
      message: 'Customer access denied',
    });
    await expect(f.runtime.query(call, [command])).rejects.toMatchObject({
      code: '42501',
      message: 'Customer access denied',
    });
    await expect(f.auth.query(call, [command])).rejects.toMatchObject({ code: '42501' });
    for (const who of ['owner', 'operator', 'viewer'])
      await expect(as(ctxOf(who), call, [command])).rejects.toMatchObject({
        code: '42501',
        message: 'Customer access denied',
      });
    await expect(removeOwn('src', null)).rejects.toMatchObject({
      code: '22023',
      message: 'Invalid problem report change',
    });
    expect(await counts()).toEqual(before);
    expect((await customerGet('src', reference)).words).toMatchObject({
      detail: 'Words that must stay.',
    });
    expect(await selfRemovals('src')).toEqual([]);
  });

  test('a disabled customer is refused and keeps the words, then removes them once enabled again', async () => {
    const reference = (await customerFile('srx', body({ detail: 'Words of a disabled person.' })))
      .reference as string;
    await f.owner.query('ALTER TABLE customer_private.principal DISABLE TRIGGER USER');
    await f.owner.query('UPDATE customer_private.principal SET disabled_at=now() WHERE id=$1', [
      ids.srx,
    ]);
    try {
      await expect(removeOwn('srx')).rejects.toMatchObject({ code: '42501' });
      expect(await wordsLeft('srx')).toBe(1);
    } finally {
      await f.owner.query('UPDATE customer_private.principal SET disabled_at=NULL WHERE id=$1', [
        ids.srx,
      ]);
      await f.owner.query('ALTER TABLE customer_private.principal ENABLE TRIGGER USER');
    }
    expect(await removeOwn('srx')).toEqual({ removed: 1, changed: true });
    expect((await customerGet('srx', reference)).words).toEqual({ removed: true });
  });

  test('one customer removes only their own: another customer, a co-member and the team reports keep their words, and another person using the same command id acts only on their own', async () => {
    const member = await h.join('src', 'srd', hosted.src!);
    expect(member).toBeTruthy();
    const kept = {
      src: (await customerFile('src', body({ detail: 'Words of src, second.' })))
        .reference as string,
      srd: (await customerFile('srd', body({ detail: 'Words of the co-member.' })))
        .reference as string,
      sre: (await customerFile('sre', body({ detail: 'Words of the other customer.' })))
        .reference as string,
    };
    const teamMade = (await teamFile(ctxOf('operator'), teamBody({ detail: 'Team words stay.' })))
      .reference as string;
    const command = randomUUID();
    const mineBefore = await wordsLeft('src');
    expect(mineBefore).toBeGreaterThanOrEqual(2);
    expect(await removeOwn('src', command)).toEqual({ removed: mineBefore, changed: true });
    expect(await wordsLeft('src')).toBe(0);
    expect((await customerGet('srd', kept.srd)).words).toMatchObject({ pageKind: 'this_page' });
    expect((await customerGet('sre', kept.sre)).words).toMatchObject({ pageKind: 'this_page' });
    expect((await customerGet('src', kept.src)).words).toEqual({ removed: true });
    expect((await teamGet(ctxOf('operator'), teamMade)).words).toMatchObject({
      detail: 'Team words stay.',
    });
    // the same command id used by another person: they act on their own reports, and src's replay is unchanged
    expect(await removeOwn('srd', command)).toEqual({ removed: 1, changed: true });
    expect((await customerGet('srd', kept.srd)).words).toEqual({ removed: true });
    expect((await customerGet('sre', kept.sre)).words).toMatchObject({ pageKind: 'this_page' });
    expect(await removeOwn('src', command)).toEqual({ removed: mineBefore, changed: false });
    expect((await selfRemovals('srd')).every((row) => row.customer_principal_id === ids.srd)).toBe(
      true,
    );
  });

  test('works for a closed account, inside the undo window and after it, while filing stays refused', async () => {
    for (const [person, daysAgo] of [
      ['srf', 0],
      ['srg', 40],
    ] as const) {
      const reference = (await customerFile(person, body({ detail: `Words of ${person}.` })))
        .reference as string;
      const other = (await customerFile(person, body())).reference as string;
      await closeAccountAt(person, daysAgo);
      expect(
        (await f.owner.query('SELECT customer_private.closed_person($1) AS closed', [ids[person]]))
          .rows[0].closed,
      ).toBe(true);
      await expect(customerFile(person, body())).rejects.toMatchObject(closedAccount);
      expect(await removeOwn(person)).toEqual({ removed: 2, changed: true });
      expect((await customerGet(person, reference)).words).toEqual({ removed: true });
      expect((await customerGet(person, other)).words).toEqual({ removed: true });
      expect(await customerList(person)).toHaveLength(2);
      // restoring is not needed to read, and a closed account can still not file
      await expect(customerFile(person, body())).rejects.toMatchObject(closedAccount);
    }
  });

  test('a double click answers with the first count even after a new report, and the new report keeps its words', async () => {
    await customerFile('srh', body({ detail: 'First words of srh.' }));
    await customerFile('srh', body({ detail: 'Second words of srh.' }));
    const command = randomUUID();
    expect(await removeOwn('srh', command)).toEqual({ removed: 2, changed: true });
    const late = (await customerFile('srh', body({ detail: 'Late words of srh.' })))
      .reference as string;
    const before = await selfRemovals('srh');
    expect(await removeOwn('srh', command)).toEqual({ removed: 2, changed: false });
    expect(await selfRemovals('srh')).toEqual(before);
    expect((await customerGet('srh', late)).words).toMatchObject({ detail: 'Late words of srh.' });
    // a new command takes the late report
    expect(await removeOwn('srh')).toEqual({ removed: 1, changed: true });
    expect((await customerGet('srh', late)).words).toEqual({ removed: true });
  });

  test('a call that finds nothing writes nothing, and the same command runs again after a new filing', async () => {
    const command = randomUUID();
    expect(await removeOwn('sri', command)).toEqual({ removed: 0, changed: false });
    expect(await selfRemovals('sri')).toEqual([]);
    const reference = (await customerFile('sri', body({ detail: 'Words filed afterwards.' })))
      .reference as string;
    expect(await removeOwn('sri', command)).toEqual({ removed: 1, changed: true });
    expect((await customerGet('sri', reference)).words).toEqual({ removed: true });
    expect(await removeOwn('sri', command)).toEqual({ removed: 1, changed: false });
  });

  test('two calls with the same command at the same time give the count and then a replay of it', async () => {
    for (let n = 0; n < 3; n++) await customerFile('srm', body({ detail: `Words ${n} of srm.` }));
    const command = randomUUID();
    const both = await Promise.all([removeOwn('srm', command), removeOwn('srm', command)]);
    expect(both.map((row) => row.removed)).toEqual([3, 3]);
    expect(both.map((row) => row.changed).sort()).toEqual([false, true]);
    expect(await selfRemovals('srm')).toHaveLength(3);
  });

  test('a call waits for the filing lock of the person and goes on when it is released', async () => {
    await customerFile('srn', body({ detail: 'Words held behind the lock.' }));
    const lock = await holdReportLock('srn');
    let pending: Promise<Row> | undefined;
    try {
      pending = removeOwn('srn');
      expect(await waiting(pending)).toBe(true);
      expect(await wordsLeft('srn')).toBe(1);
    } finally {
      await lock.release();
    }
    expect(await pending).toEqual({ removed: 1, changed: true });
    // and the lock is the one filing takes: a filing waits behind it too
    const second = await holdReportLock('srn');
    let filing: Promise<Row> | undefined;
    try {
      filing = customerFile('srn', body({ detail: 'Filed while the lock is held.' }));
      expect(await waiting(filing)).toBe(true);
    } finally {
      await second.release();
    }
    expect((await filing)!.changed).toBe(true);
  });

  test('a filing and a removal at the same time leave no report with both its words and a removal row, and none with neither', async () => {
    await customerFile('sro', body({ detail: 'First words of sro.' }));
    for (let round = 0; round < 4; round++) {
      const [removed, filed] = await Promise.all([
        removeOwn('sro'),
        customerFile('sro', body({ detail: `Round ${round} words of sro.` })),
      ]);
      expect(filed.changed).toBe(true);
      expect(removed.changed).toBe(removed.removed !== 0);
      const reports = (
        await f.owner.query(
          `SELECT r.id,EXISTS(SELECT FROM customer_private.problem_report_words w WHERE w.report_id=r.id) AS words,
            EXISTS(SELECT FROM customer_private.problem_report_self_removal s WHERE s.report_id=r.id) AS removed
           FROM customer_private.problem_report r WHERE r.customer_principal_id=$1`,
          [ids.sro],
        )
      ).rows as { words: boolean; removed: boolean }[];
      for (const report of reports) expect(report.words).toBe(!report.removed);
    }
  });
});

describe('the self-removal record and the words guard hold for the schema owner as well', () => {
  const insertRow = (report: string, person: string) =>
    f.owner.query(
      "INSERT INTO customer_private.problem_report_self_removal(report_id,reporter_kind,customer_principal_id,command_id) VALUES($1,'customer',$2,$3)",
      [report, ids[person], randomUUID()],
    );
  const deleteWords = (report: string) =>
    f.owner.query('DELETE FROM customer_private.problem_report_words WHERE report_id=$1', [report]);
  const immutable = { code: '23514', message: 'Immutable record; append a new record' };

  test('words can be deleted only for a report that has an erasure row or a self-removal row of its own, and never updated', async () => {
    const mine = await reportId(
      (await customerFile('srp', body({ detail: 'Words of srp, one.' }))).reference as string,
    );
    const other = await reportId(
      (await customerFile('srp', body({ detail: 'Words of srp, two.' }))).reference as string,
    );
    const notMine = await reportId(
      (await customerFile('srq', body({ detail: 'Words of srq.' }))).reference as string,
    );
    // no row yet: refused
    await expect(deleteWords(mine)).rejects.toMatchObject(immutable);
    await insertRow(mine, 'srp');
    // an update is refused even with a row, and a row for one report never lets another report's words go
    await expect(
      f.owner.query(
        'UPDATE customer_private.problem_report_words SET detail=detail WHERE report_id=$1',
        [mine],
      ),
    ).rejects.toMatchObject(immutable);
    await expect(deleteWords(other)).rejects.toMatchObject(immutable);
    await expect(deleteWords(notMine)).rejects.toMatchObject(immutable);
    await deleteWords(mine);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report_words WHERE report_id=$1',
          [mine],
        )
      ).rows[0].n,
    ).toBe(0);
    // the report row itself and its status row still cannot be deleted or changed
    await expect(
      f.owner.query('DELETE FROM customer_private.problem_report WHERE id=$1', [mine]),
    ).rejects.toMatchObject(immutable);
    await expect(
      f.owner.query(
        "UPDATE customer_private.problem_report_status_event SET note='A long enough note' WHERE report_id=$1",
        [mine],
      ),
    ).rejects.toMatchObject(immutable);
  });

  test('a self-removal row is immutable, must name the person who filed the report, and cannot be written for a team report', async () => {
    const mine = await reportId(
      (await customerFile('srq', body({ detail: 'Words of srq, again.' }))).reference as string,
    );
    // another person's report: the trigger refuses
    await expect(insertRow(mine, 'srp')).rejects.toMatchObject({
      code: '23514',
      message: 'A self-removal record must name the person who filed the report',
    });
    const team = (
      await f.owner.query(
        "SELECT id FROM customer_private.problem_report WHERE reporter_kind='team' LIMIT 1",
      )
    ).rows[0].id as string;
    // a team report: the key to the report carries the kind, so there is no row to point at
    await expect(insertRow(team, 'srq')).rejects.toMatchObject({ code: '23503' });
    await expect(insertRow(randomUUID(), 'srq')).rejects.toMatchObject({ code: '23503' });
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.problem_report_self_removal(report_id,reporter_kind,customer_principal_id,command_id) VALUES($1,'team',$2,$3)",
        [mine, ids.srq, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await insertRow(mine, 'srq');
    // one row per report, and none can change or go
    await expect(insertRow(mine, 'srq')).rejects.toMatchObject({ code: '23505' });
    await expect(
      f.owner.query(
        'UPDATE customer_private.problem_report_self_removal SET command_id=gen_random_uuid()',
      ),
    ).rejects.toMatchObject(immutable);
    await expect(
      f.owner.query('DELETE FROM customer_private.problem_report_self_removal'),
    ).rejects.toMatchObject(immutable);
  });
});

describe('words are removed under an erasure request', () => {
  const owner = () => ctxOf('owner');
  const snapshot = async (person: string) =>
    (
      await f.owner.query(
        `SELECT r.reference,r.category,r.filed_at,r.side,
          (SELECT jsonb_agg(to_jsonb(x)-'id'-'seq' ORDER BY x.seq) FROM customer_private.problem_report_status_event x WHERE x.report_id=r.id) AS history
         FROM customer_private.problem_report r WHERE r.customer_principal_id=$1 ORDER BY r.number`,
        [ids[person]],
      )
    ).rows;

  beforeAll(async () => {
    await setAccountControl(true);
  });

  test('a received or declined request is refused, an in progress one removes the words and nothing else', async () => {
    const firstCommand = randomUUID();
    const firstFiled = await customerFile(
      'pat',
      body({ detail: 'Pat wrote some private words here.' }),
      firstCommand,
    );
    const first = firstFiled.reference as string;
    const second = (await customerFile('pat', body({ pageKind: 'another_page', page: 'Meetings' })))
      .reference as string;
    const sampleTeam = (
      await teamFile(ctxOf('operator'), teamBody({ detail: 'Operator words stay.' }))
    ).reference as string;
    // a staff move on the first report so the history and the note have something to keep
    await move(
      owner(),
      await reportId(first),
      'received',
      'in_review',
      'We are reading what you wrote.',
    );
    const requestId = await request('pat');
    const before = await snapshot('pat');
    let wordsBefore = (await counts()).words;
    await expect(remove(owner(), requestId)).rejects.toMatchObject({
      code: '23514',
      message: notInProgress,
    });
    expect((await counts()).words).toBe(wordsBefore);
    // a declined request is refused as well
    const declined = await request('rhea');
    await customerFile('rhea', body({ detail: 'Words that must stay.' }));
    await erasure(declined, 'received', 'declined', 'We must keep the records for tax.');
    await expect(remove(owner(), declined)).rejects.toMatchObject({
      code: '23514',
      message: notInProgress,
    });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report_words w JOIN customer_private.problem_report r ON r.id=w.report_id WHERE r.customer_principal_id=$1',
          [ids.rhea],
        )
      ).rows[0].n,
    ).toBe(1);
    wordsBefore = (await counts()).words;
    // customers and the roles below owner and admin cannot remove words
    for (const call of [
      () =>
        h.sql('pat', 'SELECT customer.problem_report_remove_words($1,$2)', [
          randomUUID(),
          requestId,
        ]),
      () => remove(ctxOf('operator'), requestId),
      () => remove(ctxOf('viewer'), requestId),
    ])
      await expect(call()).rejects.toMatchObject({ code: '42501' });
    await expect(remove(owner(), randomUUID())).rejects.toMatchObject({
      code: '23514',
      message: 'Erasure request not found',
    });
    // in progress: both customer reports lose their words
    await erasure(requestId, 'received', 'in_progress');
    const command = randomUUID();
    const done = await remove(owner(), requestId, command);
    expect(done).toMatchObject({ removed: 2 });
    expect((await counts()).words).toBe(wordsBefore! - 2);
    expect((await counts()).erasures).toBe(2);
    expect(await snapshot('pat')).toEqual(before);
    const rows = await f.owner.query(
      'SELECT e.erasure_request_id,e.command_id,e.staff_principal_id FROM customer_private.problem_report_erasure e JOIN customer_private.problem_report r ON r.id=e.report_id WHERE r.customer_principal_id=$1',
      [ids.pat],
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows)
      expect(row).toEqual({
        erasure_request_id: requestId,
        command_id: command,
        staff_principal_id: f.users.owner!.id,
      });
    // the reporter's list says the words were removed, and the detail keeps the history and the note
    const listed = await customerList('pat');
    expect(listed.filter((row) => row.wordsRemoved)).toHaveLength(2);
    const read = await customerGet('pat', first);
    expect(read.words).toEqual({ removed: true });
    expect((read.history as Row[]).map((row) => [row.state, row.note])).toEqual([
      ['received', null],
      ['in_review', 'We are reading what you wrote.'],
    ]);
    expect((await customerGet('pat', second)).words).toEqual({ removed: true });
    // staff see the report without its words
    expect((await queue(owner())).items.find((row) => row.reference === first)).toMatchObject({
      wordsRemoved: true,
      page: null,
      detail: null,
      status: 'in_review',
    });
    // a second call with a new command removes nothing, and a retry of the first command answers with its original count
    expect(await remove(owner(), requestId, randomUUID())).toMatchObject({ removed: 0 });
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 2 });
    expect((await counts()).erasures).toBe(2);
    // the original filing command is still answered after the words are gone, without comparing them
    expect(
      await customerFile(
        'pat',
        body({ detail: 'Pat wrote some private words here.' }),
        firstCommand,
      ),
    ).toEqual({
      ...firstFiled,
      changed: false,
    });
    expect(
      await customerFile(
        'pat',
        body({ page: '/account/other', detail: 'Other words.' }),
        firstCommand,
      ),
    ).toEqual({ ...firstFiled, changed: false });
    await expect(
      customerFile('pat', body({ category: 'words_wrong' }), firstCommand),
    ).rejects.toMatchObject(conflict);
    expect((await counts()).words).toBe(wordsBefore! - 2);
    // a team report is staff data and is not touched
    expect((await teamGet(ctxOf('operator'), sampleTeam)).words).toMatchObject({
      detail: 'Operator words stay.',
    });
    // a report filed while the request is still in progress is not reached by a retry of the first command
    const later = (await customerFile('pat', body({ detail: 'Words written after the removal.' })))
      .reference as string;
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 2 });
    expect((await customerGet('pat', later)).words).toMatchObject({
      detail: 'Words written after the removal.',
    });
    // it was filed before the request was completed, so the next removal reaches it and no other
    await erasure(requestId, 'in_progress', 'completed', 'The erasure was completed in full.');
    expect(await remove(owner(), requestId)).toMatchObject({ removed: 1 });
    expect((await customerGet('pat', later)).words).toEqual({ removed: true });
    // a report filed after the completion keeps its words: it needs a new erasure request
    const afterCompletion = (
      await customerFile('pat', body({ detail: 'Words written after the completion.' }))
    ).reference as string;
    expect(await remove(owner(), requestId)).toMatchObject({ removed: 0 });
    expect(await remove(owner(), requestId, randomUUID())).toMatchObject({ removed: 0 });
    expect((await customerGet('pat', afterCompletion)).words).toMatchObject({
      detail: 'Words written after the completion.',
    });
    // and the retry of the first command still answers with its original count
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 2 });
    expect((await customerGet('pat', afterCompletion)).words).toMatchObject({
      detail: 'Words written after the completion.',
    });
  });

  test('a removal while in progress reaches the reports filed up to that moment, and a retry is answered first whatever was filed since', async () => {
    const requestId = await request('yan');
    await erasure(requestId, 'received', 'in_progress');
    const before = (await customerFile('yan', body({ detail: 'Yan words before the call.' })))
      .reference as string;
    const command = randomUUID();
    const erasuresBefore = (await counts()).erasures;
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 1 });
    expect((await customerGet('yan', before)).words).toEqual({ removed: true });
    const since = (await customerFile('yan', body({ detail: 'Yan words filed since.' })))
      .reference as string;
    // the retry returns the original answer, with the reference of the request, and touches nothing
    expect(await remove(owner(), requestId, command)).toEqual({
      reference: expect.any(String),
      removed: 1,
    });
    expect((await customerGet('yan', since)).words).toMatchObject({
      detail: 'Yan words filed since.',
    });
    expect((await counts()).erasures).toBe(erasuresBefore + 1);
    // even after the request is completed, the retry is answered first, while a new command reaches what was filed before
    await erasure(requestId, 'in_progress', 'completed', 'The erasure was completed in full.');
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 1 });
    expect((await customerGet('yan', since)).words).toMatchObject({
      detail: 'Yan words filed since.',
    });
    expect(await remove(owner(), requestId)).toMatchObject({ removed: 1 });
    expect((await customerGet('yan', since)).words).toEqual({ removed: true });
  });

  test('a retry of a command that removed nothing is not a replay: it runs again and reaches the reports filed since', async () => {
    const requestId = await request('zoe');
    await erasure(requestId, 'received', 'in_progress');
    const command = randomUUID();
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 0 });
    const erasures = (await counts()).erasures;
    const filed = (
      await customerFile('zoe', body({ detail: 'Zoe words filed after an empty call.' }))
    ).reference as string;
    expect((await customerGet('zoe', filed)).words).toMatchObject({
      detail: 'Zoe words filed after an empty call.',
    });
    // no erasure row was written by the empty call, so there is nothing to replay
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 1 });
    expect((await counts()).erasures).toBe(erasures + 1);
    expect((await customerGet('zoe', filed)).words).toEqual({ removed: true });
    // now that it removed something, the same command is a replay with that count
    expect(await remove(owner(), requestId, command)).toMatchObject({ removed: 1 });
  });

  test('a command already used for another erasure request is refused, and nothing is removed', async () => {
    const used = randomUUID();
    const firstRequest = await request('wes');
    await erasure(firstRequest, 'received', 'in_progress');
    await customerFile('wes', body({ detail: 'Wes words for the first request.' }));
    expect(await remove(owner(), firstRequest, used)).toMatchObject({ removed: 1 });
    const otherRequest = await request('xia');
    await erasure(otherRequest, 'received', 'in_progress');
    const words = (await customerFile('xia', body({ detail: 'Xia words that stay.' })))
      .reference as string;
    const erasures = (await counts()).erasures;
    await expect(remove(owner(), otherRequest, used)).rejects.toMatchObject(conflict);
    expect((await counts()).erasures).toBe(erasures);
    expect((await customerGet('xia', words)).words).toMatchObject({
      detail: 'Xia words that stay.',
    });
    // the same command for the right request still answers its original count
    expect(await remove(owner(), firstRequest, used)).toMatchObject({ removed: 1 });
  });

  test('words without an erasure row cannot be removed, even by the owner, and an erasure row is for customers only', async () => {
    const reference = (await customerFile(spare(), body())).reference as string;
    const id = await reportId(reference);
    await expect(
      f.owner.query('DELETE FROM customer_private.problem_report_words WHERE report_id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
    const team = (
      await f.owner.query(
        "SELECT id FROM customer_private.problem_report WHERE reporter_kind='team' LIMIT 1",
      )
    ).rows[0].id as string;
    const anyRequest = (
      await f.owner.query('SELECT id FROM customer_private.erasure_request LIMIT 1')
    ).rows[0].id as string;
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.problem_report_erasure(report_id,reporter_kind,erasure_request_id,staff_principal_id,command_id) VALUES($1,'team',$2,$3,$4)",
        [team, anyRequest, f.users.owner!.id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      f.owner.query(
        "INSERT INTO customer_private.problem_report_erasure(report_id,reporter_kind,erasure_request_id,staff_principal_id,command_id) VALUES($1,'customer',$2,$3,$4)",
        [team, anyRequest, f.users.owner!.id, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      f.owner.query(
        'UPDATE customer_private.problem_report_erasure SET command_id=gen_random_uuid()',
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('staff of a sample workspace cannot remove the words of a person whose workspace is real', async () => {
    const reference = (await customerFile('quin', body({ detail: 'Quin wrote words that stay.' })))
      .reference as string;
    const requestId = await request('quin');
    await erasure(requestId, 'received', 'in_progress');
    await flip(sampleWorkspace.quin!, false);
    try {
      await expect(remove(owner(), requestId)).rejects.toMatchObject({
        code: '23514',
        message: 'Erasure request not found',
      });
      expect((await customerGet('quin', reference)).words).toMatchObject({
        detail: 'Quin wrote words that stay.',
      });
    } finally {
      await flip(sampleWorkspace.quin!, true);
    }
    // back on the sample side the same staff may remove them
    expect(await remove(owner(), requestId)).toMatchObject({ removed: 1 });
    expect((await customerGet('quin', reference)).words).toEqual({ removed: true });
  });

  test('a person whose real workspace access was revoked is erased by sample staff while the report stays on the real side', async () => {
    // una has a sample workspace of her own, joined vic's workspace and was removed from it; vic's workspace then became real
    const member = await h.join('vic', 'una', sampleWorkspace.vic!);
    await revoke('vic', sampleWorkspace.vic!, member);
    const requestId = await request('una');
    await erasure(requestId, 'received', 'in_progress');
    // the members of the real staff workspace that lack the real purpose now, so that exactly those are put back
    const lacking = (
      await f.owner.query(
        "SELECT user_id FROM app.membership WHERE tenant_id=$1 AND NOT 'commercial_qualification'=ANY(allowed_purposes)",
        [f.tenantB],
      )
    ).rows.map((row) => row.user_id as string);
    try {
      await flip(sampleWorkspace.vic!, false);
      await realUse(true);
      await f.owner.query('ALTER TABLE app.membership DISABLE TRIGGER USER');
      await f.owner.query(
        "UPDATE app.membership SET allowed_purposes=allowed_purposes||ARRAY['commercial_qualification'] WHERE tenant_id=$1 AND user_id=ANY($2)",
        [f.tenantB, lacking],
      );
      await f.owner.query('ALTER TABLE app.membership ENABLE TRIGGER USER');
      await flip(f.tenantB, false);
      const reference = (
        await customerFile('una', body({ detail: 'Una wrote words for the real side.' }))
      ).reference as string;
      // the report is on the real side (ever held), and only real staff see it
      expect(await storedSide(reference)).toBe('real');
      expect(await seen(reference)).toMatchObject({ effective: 'real', sample: false, real: true });
      // the person is in the scope of sample staff now (nothing real is held), so real staff do not find the request
      await expect(remove(realCtx(), requestId)).rejects.toMatchObject({
        code: '23514',
        message: 'Erasure request not found',
      });
      expect((await customerGet('una', reference)).words).toMatchObject({
        detail: 'Una wrote words for the real side.',
      });
      // sample staff remove the words of the real-side report
      expect(await remove(owner(), requestId)).toMatchObject({ removed: 1 });
      expect((await customerGet('una', reference)).words).toEqual({ removed: true });
    } finally {
      await f.owner.query('ALTER TABLE app.membership DISABLE TRIGGER USER');
      await f.owner.query(
        "UPDATE app.membership SET allowed_purposes=array_remove(allowed_purposes,'commercial_qualification') WHERE tenant_id=$1 AND user_id=ANY($2)",
        [f.tenantB, lacking],
      );
      await f.owner.query('ALTER TABLE app.membership ENABLE TRIGGER USER');
      await flip(f.tenantB, true);
      await flip(sampleWorkspace.vic!, true);
      await realUse(false);
    }
  });
});

// The self-removal beside the staff erasure path. The account lifecycle control is open for these tests (the erasure tests
// above opened it), and one test pauses it. The two removals are separate authorities and never count one report twice.
describe('a customer removal beside the staff removal under an erasure request', () => {
  beforeAll(async () => {
    await setAccountControl(true);
    for (const person of ['srj', 'srk', 'srs', 'srt'])
      await h.provision(person, `Synthetic ${person} workspace`);
  });

  test('a self-removed report is skipped by the staff removal, which removes only what is left and counts it once', async () => {
    const mine = [
      (await customerFile('srj', body({ detail: 'First words of srj.' }))).reference as string,
      (await customerFile('srj', body({ detail: 'Second words of srj.' }))).reference as string,
    ];
    expect(await removeOwn('srj')).toEqual({ removed: 2, changed: true });
    const requestId = await request('srj');
    await erasure(requestId, 'received', 'in_progress');
    // a report filed after the self-removal is the only one with words left
    const late = (await customerFile('srj', body({ detail: 'Late words of srj.' })))
      .reference as string;
    const command = randomUUID();
    const done = await remove(ctxOf('owner'), requestId, command);
    expect(done).toMatchObject({ removed: 1 });
    expect(await remove(ctxOf('owner'), requestId, command)).toMatchObject({ removed: 1 });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report_erasure e JOIN customer_private.problem_report r ON r.id=e.report_id WHERE r.customer_principal_id=$1',
          [ids.srj],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await selfRemovals('srj')).toHaveLength(2);
    for (const reference of [...mine, late])
      expect((await customerGet('srj', reference)).words).toEqual({ removed: true });
    // a new command finds nothing left, for either kind
    expect(await remove(ctxOf('owner'), requestId)).toMatchObject({ removed: 0 });
    expect(await removeOwn('srj')).toEqual({ removed: 0, changed: false });
    expect(
      (await queue(ctxOf('owner'))).items.filter((item) => item.reference === mine[0])[0],
    ).toMatchObject({
      wordsRemoved: true,
      detail: null,
    });
  });

  test('a report the staff removed is not removed again by the customer, and a person who later gains a workspace stays removed', async () => {
    const reference = (await customerFile('srk', body({ detail: 'Words of srk.' })))
      .reference as string;
    const requestId = await request('srk');
    await erasure(requestId, 'received', 'in_progress');
    expect(await remove(ctxOf('owner'), requestId)).toMatchObject({ removed: 1 });
    expect(await removeOwn('srk')).toEqual({ removed: 0, changed: false });
    expect(await selfRemovals('srk')).toEqual([]);
    expect((await customerGet('srk', reference)).words).toEqual({ removed: true });
    // a person with no workspace removes theirs, then gains a workspace: nothing comes back and nothing is counted again
    const own = (await customerFile('srl', body({ detail: 'Words of srl.' }))).reference as string;
    expect(await removeOwn('srl')).toEqual({ removed: 1, changed: true });
    await h.provision('srl', 'Synthetic srl workspace');
    expect((await customerGet('srl', own)).words).toEqual({ removed: true });
    expect((await customerList('srl'))[0]).toMatchObject({ wordsRemoved: true });
    const later = await request('srl');
    await erasure(later, 'received', 'in_progress');
    expect(await remove(ctxOf('owner'), later)).toMatchObject({ removed: 0 });
    expect(await removeOwn('srl')).toEqual({ removed: 0, changed: false });
  });

  test('works while the account control is paused', async () => {
    const reference = (await customerFile('srs', body({ detail: 'Words of srs.' })))
      .reference as string;
    await setAccountControl(false);
    try {
      expect(
        (await f.owner.query('SELECT customer_private.account_lifecycle_open() AS open')).rows[0]
          .open,
      ).toBe(false);
      expect(await removeOwn('srs')).toEqual({ removed: 1, changed: true });
    } finally {
      await setAccountControl(true);
    }
    expect((await customerGet('srs', reference)).words).toEqual({ removed: true });
  });

  test('the staff removal and the customer removal wait for the same report lock, and between them remove the words once', async () => {
    await customerFile('srt', body({ detail: 'Words of srt.' }));
    const requestId = await request('srt');
    await erasure(requestId, 'received', 'in_progress');
    const lock = await holdReportLock('srt');
    let staff: Promise<Row> | undefined;
    let self: Promise<Row> | undefined;
    try {
      staff = remove(ctxOf('owner'), requestId);
      self = removeOwn('srt');
      expect(await waiting(staff)).toBe(true);
      expect(await waiting(self)).toBe(true);
      expect(await wordsLeft('srt')).toBe(1);
    } finally {
      await lock.release();
    }
    const [byStaff, byCustomer] = [await staff, await self];
    expect((byStaff!.removed as number) + (byCustomer!.removed as number)).toBe(1);
    const erasureRows = (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM customer_private.problem_report_erasure e JOIN customer_private.problem_report r ON r.id=e.report_id WHERE r.customer_principal_id=$1',
        [ids.srt],
      )
    ).rows[0].n as number;
    expect(erasureRows + (await selfRemovals('srt')).length).toBe(1);
    expect(await wordsLeft('srt')).toBe(0);
  });
});

// The plain text rule (customer_private.problem_report_plain) also refuses the C1 controls, the line and paragraph
// separators and the bidirectional override and isolate characters, in every layer: the filing and transition shape
// checks (22023) and the CHECK constraints under them (23514, which hold for the schema owner as well).
describe('the plain text rule refuses control and direction characters', () => {
  const refused = [
    '\u0080',
    '\u0085',
    '\u009f',
    '\u2028',
    '\u2029',
    '\u202a',
    '\u202e',
    '\u2066',
    '\u2069',
  ];
  const neighbours = ['\u00a0', '\u2027', '\u202f', '\u2065', '\u206a'];
  const owner = () => ctxOf('owner');
  const plain = (value: string, min: number, max: number) =>
    f.owner
      .query('SELECT customer_private.problem_report_plain($1,$2,$3) AS ok', [value, min, max])
      .then((result) => result.rows[0].ok as boolean);
  const madeReport = async (person: string) =>
    (
      await f.owner.query(
        `INSERT INTO customer_private.problem_report(reporter_kind,customer_principal_id,side,category,command_id)
         VALUES('customer',$1,'sample','did_not_work',$2) RETURNING id`,
        [ids[person], randomUUID()],
      )
    ).rows[0].id as string;
  const insertWords = (report: string, pageKind: string, page: string, detail: string | null) =>
    f.owner.query(
      `INSERT INTO customer_private.problem_report_words(report_id,reporter_kind,category,page_kind,page_text,detail)
       VALUES($1,'customer','did_not_work',$2,$3,$4)`,
      [report, pageKind, page, detail],
    );

  test('a customer filing is refused with 22023 for each character, in the detail, the other page text and the path, and writes nothing', async () => {
    const before = await counts();
    for (const character of refused) {
      const label = `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
      for (const [where, input] of [
        ['detail', body({ detail: `a long enough${character} detail` })],
        ['detail at the start', body({ detail: `${character}a long enough detail` })],
        ['other page', body({ pageKind: 'another_page', page: `Meet${character}ings` })],
        ['path', body({ page: `/account/a${character}b` })],
      ] as const)
        await expect(customerFile('kay', input), `${label} in ${where}`).rejects.toMatchObject({
          code: '22023',
        });
    }
    expect(await counts()).toEqual(before);
  });

  test('a team filing is refused with 22023 for each character, in the detail, the other page text and the path, and writes nothing', async () => {
    const before = await counts();
    for (const character of refused)
      for (const input of [
        teamBody({ detail: `a long enough${character} detail` }),
        teamBody({ pageKind: 'another_page', page: `Meet${character}ings` }),
        teamBody({ page: `/operator/a${character}b` }),
      ])
        await expect(teamFile(ctxOf('reviewer'), input)).rejects.toMatchObject({ code: '22023' });
    expect(await counts()).toEqual(before);
  });

  test('a transition note is refused with 22023 for each character and the status stays, then a note with their neighbours and an emoji is accepted', async () => {
    const reference = (await customerFile(spare(), body())).reference as string;
    const id = await reportId(reference);
    const statuses = () =>
      f.owner
        .query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report_status_event WHERE report_id=$1',
          [id],
        )
        .then((result) => result.rows[0].n as number);
    expect(await statuses()).toBe(1);
    for (const character of refused)
      await expect(
        move(owner(), id, 'received', 'in_review', `A long enough note${character} here`),
      ).rejects.toMatchObject({ code: '22023' });
    expect(await statuses()).toBe(1);
    const accepted = `Checked ${neighbours.join(' ')} and a smile \u{1F600} today`;
    expect(await move(owner(), id, 'received', 'in_review', accepted)).toMatchObject({
      status: 'in_review',
      note: accepted,
    });
    expect(await statuses()).toBe(2);
  });

  test('the table checks refuse each character for the schema owner as well, in the words and the status note', async () => {
    const report = await madeReport('kay');
    for (const character of refused) {
      for (const [kind, page, detail] of [
        ['this_page', '/account/x', `a${character}b`],
        ['another_page', `Meet${character}ings`, null],
        ['this_page', `/account/a${character}b`, null],
      ] as const)
        await expect(insertWords(report, kind, page, detail)).rejects.toMatchObject({
          code: '23514',
        });
    }
    // the same report accepts the words once, with the neighbours of the new classes
    await insertWords(report, 'another_page', 'Meetings', `a ${neighbours.join(' ')} \u{1F600} b`);
    const reference = (await customerFile(spare(), body())).reference as string;
    const id = await reportId(reference);
    for (const character of refused)
      await expect(
        f.owner.query(
          `INSERT INTO customer_private.problem_report_status_event(report_id,state,expected_state,note,staff_principal_id,staff_tenant_id,command_id)
           VALUES($1,'in_review','received',$2,$3,$4,$5)`,
          [id, `A long enough note${character} here`, f.users.owner!.id, f.tenantA, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23514' });
  });

  test('the neighbours of the new classes and ordinary text with an emoji are accepted, in a customer filing and a team filing', async () => {
    const mixed = `Seen ${neighbours.join(' ')} with a smile \u{1F600} on it`;
    const customer = await customerFile(
      spare(),
      body({ pageKind: 'another_page', page: `Meetings ${neighbours.join('')}`, detail: mixed }),
    );
    expect(customer.changed).toBe(true);
    const team = await teamFile(
      ctxOf('viewer'),
      teamBody({ pageKind: 'another_page', page: `Queue ${neighbours.join('')}`, detail: mixed }),
    );
    expect(team.changed).toBe(true);
    for (const character of neighbours) expect(await plain(`a${character}b`, 1, 100)).toBe(true);
  });

  test('the older rules and the length ranges still hold, and the function agrees with each layer above', async () => {
    const cases: [string, number, number, boolean][] = [
      ['plain words', 1, 1000, true],
      ['a\u0001b', 1, 1000, false],
      ['a\u0007b', 1, 1000, false],
      ['a\u007fb', 1, 1000, false],
      ['a\nb', 1, 1000, false],
      ['a://b', 1, 1000, false],
      ['write a@b', 1, 1000, false],
      ['see www.example', 1, 1000, false],
      ['Seen on WWW.EXAMPLE', 1, 1000, true],
      ['', 1, 120, false],
      ['a'.repeat(120), 1, 120, true],
      ['a'.repeat(121), 1, 120, false],
      ['a'.repeat(1000), 1, 1000, true],
      ['a'.repeat(1001), 1, 1000, false],
      ['a'.repeat(9), 10, 1000, false],
      ['a'.repeat(10), 10, 1000, true],
      ['a'.repeat(1000), 10, 1000, true],
      ['a'.repeat(1001), 10, 1000, false],
    ];
    for (const [value, min, max, expected] of cases)
      expect(await plain(value, min, max), JSON.stringify(value.slice(0, 20))).toBe(expected);
    for (const character of refused) expect(await plain(`a${character}b`, 1, 100)).toBe(false);
  });
});
