import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { DomainError } from '../../packages/domain/src/index';
import { plainTextBetween } from '../../packages/domain/src/problem-report';
import type { RequestContext } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import {
  CustomerProblemReports,
  StaffProblemReports,
  TeamProblemReports,
  problemReportError,
  resetProblemReportProbe,
} from '../../packages/auth/src/problem-reports';

// ADR-078 PR2, real database, real restricted roles: the three services behind the problem report routes. Customers and
// team members file and read their own reports, owners and admins triage with a fresh authenticator check, and every
// refusal says the same thing whoever asked. Nothing here is a real account, email or workspace.
let f: Fixture;
let h: ReturnType<typeof harness>;
let ids: Record<string, string>;
let team: TeamProblemReports;
let staff: StaffProblemReports;

const customer = (person: string) =>
  new CustomerProblemReports(f.runtime, f.auth, options, async () => h.session(person));
const body = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  category: 'did_not_work',
  pageKind: 'this_page',
  page: '/account/requests',
  ...over,
});
const teamBody = (over: Record<string, unknown> = {}) =>
  body({ action: 'file', page: '/operator/requests', ...over });
const fileAs = (person: string, input = body()) => customer(person).file(input);
const ctxOf = (who: string): RequestContext => f.users[who]!.ctx;
// The fixture owner of the second workspace, made an admin of the first, so there is an admin to test.
const adminCtx = (): RequestContext => ({ ...f.users.other!.ctx, tenantId: f.tenantA });
const asOwner = (text: string, params: unknown[] = []) =>
  rawContext(f.runtime, ctxOf('owner'), text, params).then((result) => result.rows[0]);
const staleAuthenticator = (who: string, stale: boolean) =>
  f.owner.query(
    `UPDATE identity.assurance SET verified_at=${stale ? "now()-interval '1 hour'" : 'now()'} WHERE session_id=$1`,
    [f.users[who]!.sessionId],
  );
const count = async (table: string) =>
  (await f.owner.query(`SELECT count(*)::int AS n FROM customer_private.${table}`)).rows[0]
    .n as number;
const notFound = { status: 404, message: 'Problem report not found' };

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  h = harness(f, 'prsv');
  ids = await h.admit([
    'alice',
    'bob',
    'carol',
    'dave',
    'erin',
    'nows',
    'gone',
    'limiter',
    'lines',
    'erased',
  ]);
  const workspaces: Record<string, string> = {};
  for (const person of ['alice', 'carol', 'dave', 'erin', 'limiter', 'lines', 'gone', 'erased'])
    workspaces[person] = await h.provision(person, `Synthetic ${person} workspace`);
  await h.join('alice', 'bob', workspaces.alice!);
  await migrateCustomerProblemReports(f.owner);
  await rawContext(
    f.runtime,
    ctxOf('owner'),
    "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [f.tenantA, f.users.other!.id],
  );
  team = new TeamProblemReports(f.runtime);
  staff = new StaffProblemReports(f.runtime);
  resetProblemReportProbe();
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await f?.close();
});

describe('the plain-text rule agrees with the database', () => {
  const check = async (value: string, min = 1, max = 1000) =>
    (
      await f.owner.query('SELECT customer_private.problem_report_plain($1,$2,$3) AS ok', [
        value,
        min,
        max,
      ])
    ).rows[0].ok as boolean;
  // U+0000 and a lone surrogate cannot be sent to the database at all, so the domain rule is stricter there only.
  const codePoints = [
    0x0001, 0x0008, 0x0009, 0x000a, 0x000d, 0x001f, 0x0020, 0x007e, 0x007f, 0x0080, 0x0085, 0x009f,
    0x00a0, 0x00a1, 0x2027, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x202f, 0x2065,
    0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x200b, 0xfeff, 0x1f600,
  ];
  for (const codePoint of codePoints)
    test(`U+${codePoint.toString(16).padStart(4, '0')} is judged the same`, async () => {
      const text = `a${String.fromCodePoint(codePoint)}b`;
      expect(plainTextBetween(text, 1, 1000)).toBe(await check(text));
    });
  test('link and email markers, case, and the length bounds are judged the same', async () => {
    for (const text of [
      'a://b',
      'a@b',
      'www.example',
      'WWW.example',
      'www and more',
      'plain words',
      '',
      'x'.repeat(1000),
      'x'.repeat(1001),
      '😀'.repeat(1000),
      '😀'.repeat(1001),
    ])
      for (const [min, max] of [
        [1, 1000],
        [10, 1000],
        [1, 120],
      ] as const)
        expect(plainTextBetween(text, min, max), `${text.slice(0, 12)} ${min}-${max}`).toBe(
          await check(text, min, max),
        );
  });
});

describe('what the database refused is what a person is told', () => {
  const code = (value: string, message?: string) => problemReportError({ code: value, message });
  test('every database code maps to one answer', () => {
    expect(code('42501', 'permission denied for function secret_name')).toMatchObject({
      status: 403,
      message: 'You cannot do this with problem reports from this account.',
    });
    expect(code('22023', 'Invalid problem report')).toMatchObject({ status: 400 });
    expect(code('54000')).toMatchObject({ status: 429, code: 'limit' });
    for (const state of ['42P01', '3F000', '42883'])
      expect(code(state)).toMatchObject({
        status: 503,
        code: 'unavailable',
        message: 'Problem reports are not available yet.',
      });
  });
  test('every 23514 message has its own answer and an unknown one leaks nothing', () => {
    expect(code('23514', 'Problem report not found')).toMatchObject({ status: 404 });
    expect(code('23514', 'Erasure request not found')).toMatchObject({ status: 404 });
    expect(code('23514', 'That account is closed')).toMatchObject({
      status: 403,
      code: 'account_closed',
    });
    for (const message of [
      'Command conflicts with original request',
      'This problem report has changed. Reload and try again',
      'That change is not allowed from this status',
      'Words can be removed only for an erasure request that is in progress or completed',
    ])
      expect(code('23514', message)).toMatchObject({ status: 409, message });
    const other = code('23514', 'new row violates check constraint "problem_report_words_check"');
    expect(other).toMatchObject({ status: 409 });
    expect((other as DomainError).message).not.toContain('constraint');
  });
  test('an application error passes through and an unknown error is left alone', () => {
    const own = new DomainError(
      'Verify your authenticator again to continue',
      401,
      'STEP_UP_REQUIRED',
    );
    expect(problemReportError(own)).toBe(own);
    const unknown = new Error('boom');
    expect(problemReportError(unknown)).toBe(unknown);
  });
});

describe('filing', () => {
  test('a customer files, reads the reference back, and the replay answers the same without a second row', async () => {
    const input = body({ detail: 'The save button did nothing when I pressed it.' });
    const before = await count('problem_report');
    const first = await fileAs('alice', input);
    expect(first).toMatchObject({ status: 'received', changed: true });
    expect(first.reference).toMatch(/^RP-\d{6}$/);
    const again = await fileAs('alice', input);
    expect(again).toEqual({ ...first, changed: false });
    expect(await count('problem_report')).toBe(before + 1);
    const listed = await customer('alice').list({});
    expect(listed[0]).toEqual({
      reference: first.reference,
      number: expect.any(Number),
      category: 'did_not_work',
      filedAt: expect.any(String),
      status: 'received',
      updatedAt: expect.any(String),
      wordsRemoved: false,
    });
    const read = await customer('alice').get(first.reference);
    expect(read.words).toEqual({
      pageKind: 'this_page',
      page: '/account/requests',
      detail: 'The save button did nothing when I pressed it.',
    });
    expect(read.history).toEqual([
      { state: 'received', note: null, createdAt: expect.any(String) },
    ]);
  });

  test('a team member files in the selected workspace and reads it back; the replay is not a second row', async () => {
    const input = teamBody({ detail: 'The meetings page was empty today.' });
    const first = await team.file(ctxOf('operator'), input);
    expect(first).toMatchObject({ status: 'received', changed: true });
    expect(await team.file(ctxOf('operator'), input)).toEqual({ ...first, changed: false });
    expect((await team.list(ctxOf('operator'), {}))[0]).toMatchObject({
      reference: first.reference,
      wordsRemoved: false,
    });
    expect((await team.get(ctxOf('operator'), first.reference)).words).toEqual({
      pageKind: 'this_page',
      page: '/operator/requests',
      detail: 'The meetings page was empty today.',
    });
  });

  test('every team role may file; a stale authenticator does not matter for filing', async () => {
    await staleAuthenticator('viewer', true);
    for (const who of ['owner', 'operator', 'reviewer', 'viewer'])
      expect((await team.file(ctxOf(who), teamBody())).changed).toBe(true);
    expect((await team.file(adminCtx(), teamBody())).changed).toBe(true);
    await staleAuthenticator('viewer', false);
  });

  test('a replay with other line breaks or spacing is the same command', async () => {
    const command = randomUUID();
    const first = await fileAs(
      'lines',
      body({ commandId: command, category: 'something_else', detail: 'First line\nsecond line' }),
    );
    const again = await fileAs(
      'lines',
      body({
        commandId: command,
        category: 'something_else',
        detail: '  First line second line \r\n',
      }),
    );
    expect(again).toEqual({ ...first, changed: false });
    expect((await customer('lines').get(first.reference)).words).toMatchObject({
      detail: 'First line second line',
    });
  });

  test('the same command id with a different body is a conflict, for a customer and for a team member', async () => {
    const command = randomUUID();
    await fileAs('carol', body({ commandId: command }));
    await expect(
      fileAs('carol', body({ commandId: command, category: 'words_wrong' })),
    ).rejects.toMatchObject({ status: 409, message: 'Command conflicts with original request' });
    await expect(
      fileAs('carol', body({ commandId: command, page: '/account/books' })),
    ).rejects.toMatchObject({ status: 409 });
    const teamCommand = randomUUID();
    await team.file(ctxOf('reviewer'), teamBody({ commandId: teamCommand }));
    await expect(
      team.file(
        ctxOf('reviewer'),
        teamBody({ commandId: teamCommand, detail: 'Other words here.' }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('a refused body never reaches the database', async () => {
    const before = await count('problem_report');
    for (const input of [
      body({ pageKind: 'another_page', page: 'a\nb' }),
      body({ page: '/account/x?y=1' }),
      body({ detail: 'see https://example.invalid' }),
      body({ category: 'something_else' }),
      body({ personId: ids.alice }),
    ])
      await expect(fileAs('dave', input)).rejects.toMatchObject({ name: 'ZodError' });
    expect(await count('problem_report')).toBe(before);
  });

  test('the eleventh filing in 24 hours is a 429, and a replay of an earlier one is not', async () => {
    const commands = Array.from({ length: 10 }, () => randomUUID());
    for (const commandId of commands) await fileAs('limiter', body({ commandId }));
    await expect(fileAs('limiter', body())).rejects.toMatchObject({ status: 429, code: 'limit' });
    expect((await fileAs('limiter', body({ commandId: commands[9] }))).changed).toBe(false);
    const filedByViewer = (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM customer_private.problem_report WHERE staff_principal_id=$1',
        [f.users.viewer!.id],
      )
    ).rows[0].n as number;
    for (let n = filedByViewer; n < 10; n++) await team.file(ctxOf('viewer'), teamBody());
    await expect(team.file(ctxOf('viewer'), teamBody())).rejects.toMatchObject({ status: 429 });
  });

  test('a customer with no workspace can file and read', async () => {
    const first = await fileAs('nows');
    expect(first.changed).toBe(true);
    expect((await customer('nows').list({})).map((row) => row.reference)).toEqual([
      first.reference,
    ]);
    expect((await customer('nows').get(first.reference)).reference).toBe(first.reference);
  });

  test('a closed account lists and reads but cannot file, and filing works again once it is restored', async () => {
    const mine = await fileAs('gone');
    await f.owner.query(
      `WITH t AS (SELECT clock_timestamp() AS at)
       INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,final_at,command_id)
       SELECT $1,'closed',t.at,t.at+interval '720 hours',$2 FROM t`,
      [ids.gone, randomUUID()],
    );
    const before = await count('problem_report');
    await expect(fileAs('gone')).rejects.toMatchObject({
      status: 403,
      code: 'account_closed',
      message: 'That account is closed',
    });
    expect(await count('problem_report')).toBe(before);
    expect((await customer('gone').list({})).map((row) => row.reference)).toContain(mine.reference);
    expect((await customer('gone').get(mine.reference)).reference).toBe(mine.reference);
    await f.owner.query(
      "INSERT INTO customer_private.account_closure_event(principal_id,state,occurred_at,command_id) VALUES($1,'restored',clock_timestamp(),$2)",
      [ids.gone, randomUUID()],
    );
    expect((await fileAs('gone')).changed).toBe(true);
  });

  test('a person with no seat in the staff workspace files nothing', async () => {
    const before = await count('problem_report');
    await expect(
      team.file({ ...ctxOf('outsider'), tenantId: f.tenantB }, teamBody()),
    ).rejects.toMatchObject({ status: 403 });
    expect(await count('problem_report')).toBe(before);
  });
});

describe('reading', () => {
  test('another person, a co-member, an unknown and a malformed reference all answer the same', async () => {
    const alice = await fileAs('alice');
    const teams = await team.file(ctxOf('operator'), teamBody());
    for (const read of [
      () => customer('carol').get(alice.reference),
      () => customer('bob').get(alice.reference),
      () => customer('alice').get('RP-999999'),
      () => customer('alice').get('x'.repeat(64)),
      () => customer('alice').get('x'.repeat(65)),
      () => customer('alice').get('RP-1\u0000'),
      () => customer('alice').get(''),
      () => customer('alice').get(teams.reference),
      () => team.get(ctxOf('reviewer'), teams.reference),
      () => team.get(ctxOf('operator'), alice.reference),
      () => team.get(ctxOf('operator'), 'RP-999999'),
      () => team.get(ctxOf('operator'), 'x'.repeat(65)),
      () => team.get({ ...ctxOf('other') }, teams.reference),
    ])
      await expect(read()).rejects.toMatchObject(notFound);
  });

  test('a list holds only the reporter own reports and pages newest first', async () => {
    const first = await fileAs('erin');
    const second = await fileAs('erin');
    const third = await fileAs('erin');
    const all = await customer('erin').list({});
    expect(all.map((row) => row.reference)).toEqual([
      third.reference,
      second.reference,
      first.reference,
    ]);
    const page = await customer('erin').list({ pageSize: 2 });
    expect(page).toHaveLength(2);
    const next = await customer('erin').list({ beforeNumber: page[1]!.number, pageSize: 2 });
    expect(next.map((row) => row.reference)).toEqual([first.reference]);
    expect(await customer('bob').list({})).toEqual([]);
  });

  test('nothing in a result names a person, a workspace or a side', async () => {
    const mine = await fileAs('alice');
    const text = JSON.stringify([
      mine,
      await customer('alice').list({}),
      await customer('alice').get(mine.reference),
      await team.list(ctxOf('operator'), {}),
    ]);
    for (const secret of [ids.alice, f.tenantA, f.users.operator!.id, 'principal', 'side'])
      expect(text).not.toContain(secret as string);
  });
});

describe('triage', () => {
  const note = 'We looked into it and fixed the page.';
  // Spread over three customers so none of them meets the limit of 10 in 24 hours.
  const reporters = ['dave', 'carol', 'erin'];
  let filings = 0;
  const filedFor = async (over: Record<string, unknown> = {}) => {
    const person = reporters[filings++ % reporters.length]!;
    const reference = (await fileAs(person, body(over))).reference;
    const row = (await staff.queue(ctxOf('owner'), { pageSize: 100 })).items.find(
      (item) => item.reference === reference,
    )!;
    return { reference, id: row.id, person };
  };
  const move = (
    ctx: RequestContext,
    reportId: string,
    expectedState: string,
    toState: string,
    text?: string,
    commandId = randomUUID(),
  ) =>
    staff.transition(ctx, {
      action: 'transition',
      commandId,
      reportId,
      expectedState,
      toState,
      ...(text === undefined ? {} : { note: text }),
    });

  test('owners and admins read the queue; the item carries no person, name or workspace', async () => {
    const { reference, person } = await filedFor({ detail: 'Words only staff may read.' });
    for (const ctx of [ctxOf('owner'), adminCtx()]) {
      const queue = await staff.queue(ctx, { pageSize: 100 });
      const item = queue.items.find((row) => row.reference === reference)!;
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
      expect(item).toMatchObject({
        reporterKind: 'customer',
        side: 'sample',
        status: 'received',
        detail: 'Words only staff may read.',
      });
      expect(queue.counts.received).toBeGreaterThan(0);
      expect(queue.total).toBeGreaterThan(0);
      expect(queue.oldestReceivedAt).toEqual(expect.any(String));
      expect(JSON.stringify(queue)).not.toContain(ids[person]!);
    }
  });

  test('the queue pages oldest first and filters by status', async () => {
    const page = await staff.queue(ctxOf('owner'), { pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextAfter).toBe(page.items[1]!.number);
    const next = await staff.queue(ctxOf('owner'), { afterNumber: page.nextAfter, pageSize: 2 });
    expect(next.items[0]!.number).toBeGreaterThan(page.items[1]!.number);
    expect(
      (await staff.queue(ctxOf('owner'), { status: 'closed', pageSize: 100 })).items.every(
        (row) => row.status === 'closed',
      ),
    ).toBe(true);
    await expect(staff.queue(ctxOf('owner'), { status: 'bogus' })).rejects.toMatchObject({
      name: 'ZodError',
    });
  });

  test('every allowed move works and the reporter reads the notes in order', async () => {
    const { reference, id, person } = await filedFor();
    const review = await move(ctxOf('owner'), id, 'received', 'in_review');
    expect(review).toMatchObject({ reference, status: 'in_review', note: null, changed: true });
    const resolved = await move(adminCtx(), id, 'in_review', 'resolved', note);
    expect(resolved).toMatchObject({ status: 'resolved', note, changed: true });
    const read = await customer(person).get(reference);
    expect(read.status).toBe('resolved');
    expect(read.history.map((row) => [row.state, row.note])).toEqual([
      ['received', null],
      ['in_review', null],
      ['resolved', note],
    ]);
    const closed = await filedFor();
    await move(
      ctxOf('owner'),
      closed.id,
      'received',
      'closed',
      'This is a duplicate of an earlier report.',
    );
    const second = await filedFor();
    await move(ctxOf('owner'), second.id, 'received', 'in_review', 'We have started on it.');
    await move(
      ctxOf('owner'),
      second.id,
      'in_review',
      'closed',
      'We could not repeat the problem.',
    );
    expect(
      (await customer(second.person).get(second.reference)).history.map((row) => row.state),
    ).toEqual(['received', 'in_review', 'closed']);
  });

  test('a moved command is answered again, and used another way it is a conflict', async () => {
    const { id } = await filedFor();
    const command = randomUUID();
    await move(ctxOf('owner'), id, 'received', 'in_review', undefined, command);
    expect(
      await move(ctxOf('owner'), id, 'received', 'in_review', undefined, command),
    ).toMatchObject({
      status: 'in_review',
      changed: false,
    });
    await expect(
      move(ctxOf('owner'), id, 'in_review', 'closed', note, command),
    ).rejects.toMatchObject({ status: 409, message: 'Command conflicts with original request' });
  });

  test('operator, reviewer and viewer are refused with a 403 and nothing moves', async () => {
    const { id } = await filedFor();
    const before = await count('problem_report_status_event');
    for (const who of ['operator', 'reviewer', 'viewer']) {
      await expect(staff.queue(ctxOf(who), {})).rejects.toMatchObject({
        status: 403,
        message: 'Access denied',
      });
      await expect(move(ctxOf(who), id, 'received', 'in_review')).rejects.toMatchObject({
        status: 403,
      });
    }
    expect(await count('problem_report_status_event')).toBe(before);
  });

  test('a stale authenticator gets the step-up, not a 403, and works again once verified', async () => {
    const { id } = await filedFor();
    await staleAuthenticator('owner', true);
    for (const call of [
      () => staff.queue(ctxOf('owner'), {}),
      () => move(ctxOf('owner'), id, 'received', 'in_review'),
      () =>
        staff.removeWords(ctxOf('owner'), {
          action: 'remove_words',
          commandId: randomUUID(),
          erasureRequestId: randomUUID(),
        }),
    ])
      await expect(call()).rejects.toMatchObject({ status: 401, code: 'STEP_UP_REQUIRED' });
    await staleAuthenticator('owner', false);
    expect((await move(ctxOf('owner'), id, 'received', 'in_review')).changed).toBe(true);
  });

  test('a stale expected status is a 409, a move that is not allowed is a 409, and the report is unchanged', async () => {
    const { reference, id, person } = await filedFor();
    await move(ctxOf('owner'), id, 'received', 'in_review');
    await expect(move(ctxOf('owner'), id, 'received', 'closed', note)).rejects.toMatchObject({
      status: 409,
      message: 'This problem report has changed. Reload and try again',
    });
    await expect(move(ctxOf('owner'), id, 'in_review', 'in_review')).rejects.toMatchObject({
      status: 409,
      message: 'That change is not allowed from this status',
    });
    expect((await customer(person).get(reference)).status).toBe('in_review');
    await move(ctxOf('owner'), id, 'in_review', 'resolved', note);
    await expect(move(ctxOf('owner'), id, 'in_review', 'closed', note)).rejects.toMatchObject({
      status: 409,
    });
  });

  test('a report that does not exist, or is on the other side or in another workspace, is not found', async () => {
    const { id } = await filedFor();
    const teamReport = await team.file(ctxOf('operator'), teamBody());
    const teamId = (await staff.queue(ctxOf('owner'), { pageSize: 100 })).items.find(
      (row) => row.reference === teamReport.reference,
    )!.id;
    await expect(move(ctxOf('owner'), randomUUID(), 'received', 'in_review')).rejects.toMatchObject(
      notFound,
    );
    // staff of the second workspace do not see the first workspace team report
    await expect(move(ctxOf('other'), teamId, 'received', 'in_review')).rejects.toMatchObject(
      notFound,
    );
    expect(
      (await staff.queue(ctxOf('other'), { pageSize: 100 })).items.some((row) => row.id === teamId),
    ).toBe(false);
    // a customer report on the sample side is seen by sample staff of either workspace
    expect((await move(ctxOf('other'), id, 'received', 'in_review')).changed).toBe(true);
  });

  test('a blank note, a short note and a note with a link are refused before the database', async () => {
    const { id } = await filedFor();
    await move(ctxOf('owner'), id, 'received', 'in_review');
    const before = await count('problem_report_status_event');
    for (const text of [undefined, ' \n ', 'short', 'See https://example.invalid for details.'])
      await expect(move(ctxOf('owner'), id, 'in_review', 'resolved', text)).rejects.toMatchObject({
        name: 'ZodError',
      });
    expect(await count('problem_report_status_event')).toBe(before);
  });
});

describe('removing words under an erasure request', () => {
  const erasureOf = async (person: string) => {
    await h.sql(person, 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
      randomUUID(),
      'file_erasure',
      '{}',
    ]);
    return (
      await f.owner.query('SELECT id FROM customer_private.erasure_request WHERE principal_id=$1', [
        ids[person],
      ])
    ).rows[0].id as string;
  };
  const erasureMove = (request: string, expected: string, to: string, text?: string) =>
    asOwner('SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      request,
      expected,
      to,
      text ?? null,
    ]);
  const remove = (ctx: RequestContext, erasureRequestId: string, commandId = randomUUID()) =>
    staff.removeWords(ctx, { action: 'remove_words', commandId, erasureRequestId });

  beforeAll(async () => {
    await f.owner.query(
      'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
      [f.serviceId, 'Fixture control for the problem report service tests'],
    );
  });

  test('an owner removes the words; an admin, a received request and an unknown request are refused', async () => {
    const mine = await fileAs('erased', body({ detail: 'Words that will be removed.' }));
    const request = await erasureOf('erased');
    await expect(remove(ctxOf('owner'), request)).rejects.toMatchObject({
      status: 409,
      message: 'Words can be removed only for an erasure request that is in progress or completed',
    });
    await expect(remove(ctxOf('owner'), randomUUID())).rejects.toMatchObject({
      status: 404,
      message: 'Erasure request not found',
    });
    await erasureMove(request, 'received', 'in_progress');
    for (const who of ['operator', 'reviewer', 'viewer'])
      await expect(remove(ctxOf(who), request)).rejects.toMatchObject({ status: 403 });
    await expect(remove(adminCtx(), request)).rejects.toMatchObject({
      status: 403,
      message: 'Access denied',
    });
    const command = randomUUID();
    const done = await remove(ctxOf('owner'), request, command);
    expect(done).toMatchObject({ removed: 1 });
    expect(done.reference).toMatch(/^ER-/);
    expect(await remove(ctxOf('owner'), request, command)).toMatchObject({ removed: 1 });
    expect(await remove(ctxOf('owner'), request)).toMatchObject({ removed: 0 });
    expect((await customer('erased').get(mine.reference)).words).toEqual({ removed: true });
    expect((await customer('erased').list({}))[0]!.wordsRemoved).toBe(true);
    expect(
      (await staff.queue(ctxOf('owner'), { pageSize: 100 })).items.find(
        (row) => row.reference === mine.reference,
      ),
    ).toMatchObject({ wordsRemoved: true, page: null, detail: null, pageKind: null });
  });
});
