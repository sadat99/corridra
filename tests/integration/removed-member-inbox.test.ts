import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, fileSql, type World } from './removed-member-support';
import { rawContext } from './support';

// Removed members and the inbox (owner decision, 11 Nov 2026: "No, remove access (Recommended)"). A customer reads their inbox
// through the row level security policy inbox_customer_read. Commercial readiness 0012 makes it hide a notice that points at a
// request, a delivered report or a service request of a workspace the recipient has left, and nothing else: notices that point at
// no request, notices about requests made outside any workspace, other recipients and every staff notice are as before, and a new
// invitation brings the hidden notices back. Rows are seeded as the table owner in exactly the shape the writers use
// (record_request_received, record_reply_posted, record_report_published, record_quote_sent). Fails on main.
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
const keyOf = (row: { type: string; event_key: string | null }) =>
  `${row.type}:${row.event_key ?? ''}`;
const inbox = (person: string) =>
  w.as(
    person,
    async (db) =>
      (
        await db.query(
          'SELECT type,event_key,payload,read_at FROM app.inbox_notification ORDER BY created_at,id',
        )
      ).rows as {
        type: string;
        event_key: string | null;
        payload: { href?: string };
        read_at: string | null;
      }[],
  );
const seed = (
  recipient: string,
  type: string,
  key: string | null,
  href: string,
  kind: 'customer' | 'staff' = 'customer',
) =>
  w.f.owner.query(
    `INSERT INTO app.inbox_notification(tenant_id,recipient_kind,recipient_account_id,type,event_key,payload)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [
      kind === 'staff' ? w.f.tenantA : null,
      kind,
      recipient,
      type,
      key,
      JSON.stringify({ title: 'Seeded notice', href }),
    ],
  );
// The notices of one person, in the shape the writers use. The first four point at the workspace; the last two do not.
async function seedPerson(person: string) {
  const principal = w.principals[person]!;
  const ws = [
    [
      'REQUEST_RECEIVED',
      `request:${w.requests[person]![0]}`,
      `/account/requests/${w.requests[person]![0]}`,
    ],
    ['REPLY_POSTED', `reply:${randomUUID()}`, `/account/requests/${w.requests[person]![1]}`],
    ['REPORT_PUBLISHED', `assignment:${w.reports[person]!.assignmentId}`, '/account?view=results'],
    ['QUOTE_SENT', `quote:${randomUUID()}`, `/account/service-requests/${w.W}/${randomUUID()}`],
  ] as const;
  for (const [type, key, href] of ws) await seed(principal, type, key, href);
  const keep: string[] = [];
  await seed(principal, 'PARTICIPANT_INVITE', null, '/account/programmes');
  keep.push('PARTICIPANT_INVITE:');
  return { hidden: ws.map(([type, key]) => `${type}:${key}`), keep };
}
const seeded: Record<string, { hidden: string[]; keep: string[] }> = {};

beforeAll(async () => {
  w = await buildWorld({ requestsPerPerson: 2 });
  for (const person of ['lena', 'rex', 'sam', 'rita']) seeded[person] = await seedPerson(person);
  // A notice about a request made outside any workspace, and a staff notice.
  for (const person of ['lena', 'rex'])
    await seed(
      w.principals[person]!,
      'REQUEST_RECEIVED',
      `request:${w.ownWorkspaceRequest[person]}`,
      `/account/requests/${w.ownWorkspaceRequest[person]}`,
    );
  await seed(w.f.users.operator.id, 'TASK_ASSIGNED', `task:${randomUUID()}`, '/operator', 'staff');
}, 900000);
afterAll(async () => {
  await w?.f.close();
});

describe('CONTROLS (they hold on main too)', () => {
  test('while everyone is a member each person sees every notice of their own, and a stranger sees none', async () => {
    for (const person of ['lena', 'rex', 'sam', 'rita']) {
      const keys = (await inbox(person)).map(keyOf);
      for (const key of [...seeded[person]!.hidden, ...seeded[person]!.keep])
        expect(keys, `${person} ${key}`).toContain(key);
    }
    expect(await inbox('stranger')).toEqual([]);
  });

  test('a staff member sees their own staff notice and no customer notice', async () => {
    const rows = (
      await rawContext(
        w.f.runtime,
        w.f.users.operator.ctx,
        'SELECT type,recipient_kind FROM app.inbox_notification',
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.recipient_kind).toBe('staff');
  });
});

describe.each([
  ['leave', 'lena'],
  ['owner revoke', 'rex'],
])('a member removed by %s', (how, person) => {
  test('is removed', async () => {
    if (how === 'leave') await w.leave(person, w.W);
    else await w.revoke('olive', w.W, w.members[person]!);
  });

  test('no longer sees a notice that points at a request, a delivered report or a service request of the workspace', async () => {
    const keys = (await inbox(person)).map(keyOf);
    for (const key of seeded[person]!.hidden) expect(keys, `${how}: ${key}`).not.toContain(key);
  });

  test('still sees the notice that points at no request and the one about a request made outside any workspace', async () => {
    const keys = (await inbox(person)).map(keyOf);
    expect(keys).toContain('PARTICIPANT_INVITE:');
    expect(keys).toContain(`REQUEST_RECEIVED:request:${w.ownWorkspaceRequest[person]}`);
  });

  test('cannot mark a hidden notice as read', async () => {
    const result = await w.as(person, async (db) =>
      db.query(
        "UPDATE app.inbox_notification SET read_at=clock_timestamp() WHERE type='REPLY_POSTED'",
      ),
    );
    expect(result.rowCount).toBe(0);
    expect(
      (
        await w.f.owner.query(
          "SELECT count(*)::int AS n FROM app.inbox_notification WHERE recipient_account_id=$1 AND type='REPLY_POSTED' AND read_at IS NOT NULL",
          [w.principals[person]],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});

describe('everyone else', () => {
  test('other members keep every notice, and the staff notice is untouched', async () => {
    for (const person of ['sam', 'rita']) {
      const keys = (await inbox(person)).map(keyOf);
      for (const key of [...seeded[person]!.hidden, ...seeded[person]!.keep])
        expect(keys, `${person} ${key}`).toContain(key);
    }
    const staff = (
      await rawContext(
        w.f.runtime,
        w.f.users.operator.ctx,
        "SELECT type FROM app.inbox_notification WHERE type='TASK_ASSIGNED'",
      )
    ).rows;
    expect(staff).toHaveLength(1);
  });

  test('the function is no oracle: for anyone else, or for a request the caller did not write, it answers true', async () => {
    const lenaRequest = `request:${w.requests.lena![0]}`;
    const ask = (person: string, recipient: string, key: string) =>
      w
        .row(person, "SELECT app.inbox_notice_visible($1,'REQUEST_RECEIVED',$2,'{}'::jsonb) AS r", [
          recipient,
          key,
        ])
        .then((r) => r.r);
    // sam asks about lena (who has left): true, so nothing is learned.
    expect(await ask('sam', w.principals.lena!, lenaRequest)).toBe(true);
    // sam asks about himself with the id of lena's request: it is not his request, so true.
    expect(await ask('sam', w.principals.sam!, lenaRequest)).toBe(true);
    // lena asks about herself and her own request: false. This is her own information.
    expect(await ask('lena', w.principals.lena!, lenaRequest)).toBe(false);
    // The auth login and PUBLIC have no right to call it.
    await expect(
      w.f.auth.query("SELECT app.inbox_notice_visible($1,'REQUEST_RECEIVED',$2,'{}'::jsonb)", [
        w.principals.lena,
        lenaRequest,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('the staff side cannot reach a customer notice through the policy', async () => {
    const rows = (
      await rawContext(
        w.f.runtime,
        w.f.users.owner.ctx,
        "SELECT count(*)::int AS n FROM app.inbox_notification WHERE recipient_kind='customer'",
      )
    ).rows;
    expect(rows[0].n).toBe(0);
  });
});

describe('a new invitation brings the notices back', () => {
  test('rita leaves and loses them, is invited again and sees every one again', async () => {
    fileSql('inbox');
    await w.leave('rita', w.W);
    const keys = (await inbox('rita')).map(keyOf);
    for (const key of seeded.rita!.hidden) expect(keys, key).not.toContain(key);
    await w.join('olive', 'rita', w.W);
    const back = (await inbox('rita')).map(keyOf);
    for (const key of [...seeded.rita!.hidden, ...seeded.rita!.keep])
      expect(back, key).toContain(key);
  });
});
