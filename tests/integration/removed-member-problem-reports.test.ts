import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  buildWorld,
  hideNewFiles,
  openNewFiles,
  type Row,
  type World,
} from './removed-member-support';
import { rawContext } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import { refreshInstalledOptionalModules } from '../../packages/db/src/customer-optional-refresh';

// Removed members and problem reports (ADR-078; owner decision, 11 Nov 2026: "No, remove access (Recommended)"). A problem
// report is the person's own words about the product, not a workspace request. A person who has left a workspace can still
// file, list, read and remove the words of their own problem reports, with the account lifecycle control closed and open, and no
// problem_report function is changed by any of the seven files. What the owner decision does widen is recorded here as a test:
// a person who has no workspace left cannot hold an erasure request (ADR-078 gap 2); the follow-up that adds an erasure path
// is a separate pull request, decided by the owner on 11 Nov 2026 ("Yes, add an erasure path (Recommended)"), and the withdrawal
// exception is not decided. Fails on main (the signed-in cases need the new files only for the removal of the workspace
// requests they rely on to be real).
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
let before: Record<string, string>;
const body = (over: Record<string, unknown> = {}) => ({
  category: 'did_not_work',
  pageKind: 'this_page',
  page: '/account/requests',
  ...over,
});
const file = (person: string, input: unknown) =>
  w
    .row(person, 'SELECT customer.problem_report_command($1,$2) AS r', [
      randomUUID(),
      JSON.stringify(input),
    ])
    .then((row) => row.r as Row);
const list = (person: string) =>
  w.row(person, 'SELECT customer.problem_report_list(NULL,25) AS r').then((row) => row.r as Row[]);
const get = (person: string, reference: unknown) =>
  w
    .row(person, 'SELECT customer.problem_report_get($1) AS r', [reference])
    .then((row) => row.r as Row);
const removeOwn = (person: string) =>
  w
    .row(person, 'SELECT customer.problem_report_remove_own_words($1) AS r', [randomUUID()])
    .then((row) => row.r as Row);
const setAccountControl = async (enabled: boolean) => {
  const latest = (
    await w.f.owner.query(
      'SELECT coalesce(max(version),0)::int AS v FROM customer_private.account_lifecycle_control',
    )
  ).rows[0].v as number;
  await w.f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
    [
      latest + 1,
      enabled,
      w.f.serviceId,
      'Fixture control for the removed member problem report tests',
    ],
  );
};
// Every problem_report function, by what is stored: body, settings, security mode, owner and grants.
const reportFunctions = async () =>
  Object.fromEntries(
    (
      await w.f.owner.query(
        `SELECT p.oid::regprocedure::text AS signature,
          md5(concat_ws('|',p.prosrc,p.proconfig::text,p.prosecdef::text,p.provolatile::text,p.proacl::text,p.proowner::regrole::text,p.pronargdefaults::text)) AS h
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('app','customer','customer_private') AND p.proname LIKE 'problem\\_report\\_%' ORDER BY 1`,
      )
    ).rows.map((r) => [r.signature as string, r.h as string]),
  );
const as = (who: 'owner' | 'operator', text: string, params: unknown[] = []) =>
  rawContext(w.f.runtime, w.f.users[who]!.ctx, text, params).then((result) => result.rows[0]);

beforeAll(async () => {
  // The state production is in: problem reports installed, the seven new files not yet there.
  hideNewFiles();
  w = await buildWorld({ requestsPerPerson: 1, extraPeople: ['gone'] });
  await migrateCustomerProblemReports(w.f.owner);
  before = await reportFunctions();
  openNewFiles();
  await migrateCustomerRealUse(w.f.owner);
  await migrateCommercialReadiness(w.f.owner);
  await refreshInstalledOptionalModules(w.f.owner);
  await w.join('olive', 'gone', w.W);
  await w.leave('lena', w.W);
  await w.leave('gone', w.W);
}, 900000);
afterAll(async () => {
  await w?.f.close();
});

describe('CONTROL (ADR-078 is untouched; holds on main too): no problem report function is touched', () => {
  test('body, settings, security mode, owner and grants of every problem_report function are the same after all seven files', async () => {
    const after = await reportFunctions();
    expect(Object.keys(after).length).toBeGreaterThan(10);
    expect(after).toEqual(before);
  });

  test('the files name no problem_report function and the report tables are not read by any new body', async () => {
    const { rows } = await w.f.owner.query(
      `SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('customer','customer_private') AND p.proname IN ('workspace_member_current','workspace_ids_current','request_author_current','link_workspace_current')`,
    );
    expect(rows).toHaveLength(4);
    for (const { signature } of rows) {
      const body = (
        await w.f.owner.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure', [signature])
      ).rows[0].prosrc as string;
      expect(body).not.toMatch(/problem_report/);
    }
  });
});

describe.each([
  ['closed', false],
  ['open', true],
])('CONTROL (ADR-078, holds on main too): with the account lifecycle control %s', (_name, open) => {
  test('a person who left a workspace files, lists, reads and removes the words of their own problem reports', async () => {
    if (open) await setAccountControl(true);
    // lena still has her own workspace; gone has none at all. Both have left the shared one.
    for (const person of ['lena', 'gone']) {
      const filed = await file(person, body({ detail: `Words of ${person}, control ${_name}.` }));
      expect(filed.reference).toBeTruthy();
      const reference = filed.reference as string;
      expect((await list(person)).map((r) => r.reference)).toContain(reference);
      expect((await get(person, reference)).words).toMatchObject({
        detail: `Words of ${person}, control ${_name}.`,
      });
      const removed = await removeOwn(person);
      expect(removed).toMatchObject({ changed: true });
      expect(Number(removed.removed)).toBeGreaterThanOrEqual(1);
      expect((await get(person, reference)).words).toEqual({ removed: true });
      // The report itself is still theirs: reference, category and status stay.
      expect((await list(person)).map((r) => r.reference)).toContain(reference);
    }
  });

  test('another person never reads their reports', async () => {
    const filed = (await file('lena', body({ detail: 'Only for lena.' }))).reference as string;
    await expect(get('sam', filed)).rejects.toMatchObject({
      code: '23514',
      message: 'Problem report not found',
    });
    expect((await list('sam')).map((r) => r.reference)).not.toContain(filed);
  });
});

describe('CONTROL (ADR-078, holds on main too): the staff erasure path and the gap that stays', () => {
  test('staff remove the words of a removed member under an erasure request as before', async () => {
    await setAccountControl(true);
    const reference = (await file('lena', body({ detail: 'Words staff will remove.' })))
      .reference as string;
    const filed = (
      await w.row('lena', 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
        randomUUID(),
        'file_erasure',
        '{}',
      ])
    ).r as Row;
    expect(filed.changed).toBe(true);
    const queue = (await as('owner', 'SELECT customer.erasure_queue(NULL,100,NULL) AS r')).r as {
      id: string;
      principalId: string;
    }[];
    const requestId = queue.find((item) => item.principalId === w.principals.lena)!.id;
    await as('owner', 'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS r', [
      randomUUID(),
      requestId,
      'received',
      'in_progress',
      null,
    ]);
    const removed = (
      await as('owner', 'SELECT customer.problem_report_remove_words($1,$2) AS r', [
        randomUUID(),
        requestId,
      ])
    ).r as Row;
    expect(Number(removed.removed)).toBeGreaterThanOrEqual(1);
    expect((await get('lena', reference)).words).toEqual({ removed: true });
  });

  test('a person with no workspace left still cannot hold an erasure request: ADR-078 gap 2 is unchanged, and the follow-up is a separate change', async () => {
    const requests = async () =>
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.problem_report_erasure',
        )
      ).rows[0].n as number;
    const before = await requests();
    await expect(
      w.row('gone', 'SELECT customer.account_lifecycle_command($1,$2,$3) AS r', [
        randomUUID(),
        'file_erasure',
        '{}',
      ]),
    ).rejects.toThrow();
    expect(await requests()).toBe(before);
  });
});
