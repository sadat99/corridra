import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  OWNER_WORDS,
  buildWorld,
  sameBytes,
  type Outcome,
  type Row,
  type World,
} from './removed-member-support';

// Removed members, requests (owner decision, 11 Nov 2026: "No, remove access (Recommended)"; ADR-033 amendment).
// Requests belong to the workspace. A person who has left, or whom the owner removed, sees none of the requests they made in
// it: not in a list, not by id, not by an old link, and cannot act on them. Each refusal is byte for byte the refusal of an
// id that does not exist, so nothing here tells a removed person which ids are real. Items made outside any workspace stay
// theirs, other members and the owners are untouched, a new invitation gives access back, and no history is rewritten.
// Every case fails on main (run with REMOVED_BASE_CHECK=1 to see it).
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
const replay: Record<string, ReturnType<World['submitInput']>> = {};
const replayId: Record<string, string> = {};
const reason = 'A reason that is long enough to be accepted';

// Every request path that takes a request id, with the refusal an unknown id gets on it.
const paths: {
  name: string;
  sql: string;
  args: (id: string) => unknown[];
  message: string;
}[] = [
  {
    name: 'private_request_detail',
    sql: 'SELECT customer.private_request_detail($1) AS r',
    args: (id) => [id],
    message: 'Private request unavailable',
  },
  {
    name: 'record_request_received',
    sql: 'SELECT customer.record_request_received($1) AS r',
    args: (id) => [id],
    message: 'Private request unavailable',
  },
  {
    name: 'withdraw_request',
    sql: 'SELECT customer.withdraw_request($1,$2,$3) AS r',
    args: (id) => [id, randomUUID(), reason],
    message: 'Request is not available',
  },
  {
    name: 'restore_request',
    sql: 'SELECT customer.restore_request($1,$2) AS r',
    args: (id) => [id, randomUUID()],
    message: 'Request is not available',
  },
  {
    name: 'set_mission_mail_mute',
    sql: 'SELECT customer.set_mission_mail_mute($1,$2,true) AS r',
    args: (id) => [id, randomUUID()],
    message: 'Request is not available',
  },
  {
    name: 'set_notification_mute',
    sql: 'SELECT customer.set_notification_mute($1,$2,true) AS r',
    args: (id) => [id, randomUUID()],
    message: 'Request is not available',
  },
];
const call = (person: string, path: (typeof paths)[number], id: string) =>
  w.attempt(person, path.sql, path.args(id));
const list = async (person: string) => (await w.listRequests(person)).ids;
const sorted = (ids: string[]) => [...ids].sort();
const text = (outcome: Outcome) => (outcome.ok ? 'ok' : `${outcome.code} ${outcome.message}`);
const moveRequests = async (person: string) =>
  (
    (await w.row(person, 'SELECT customer.private_request_moves(NULL,25) AS r')).r as {
      requests: { requestId: string }[];
    }
  ).requests.map((r) => r.requestId);

beforeAll(async () => {
  w = await buildWorld();
  // A command each of lena and rex can replay later.
  for (const person of ['lena', 'rex']) {
    replay[person] = w.submitInput(w.W);
    replayId[person] = (await w.requestService(person).submit(replay[person]!, w.prepare)).id;
  }
}, 900000);
afterAll(async () => {
  await w?.f.close();
});

describe('while everyone is a member', () => {
  test('each person lists exactly the requests they made, and a stranger lists none', async () => {
    expect(sorted(await list('sam'))).toEqual(sorted(w.requests.sam!));
    expect(sorted(await list('lena'))).toEqual(
      sorted([...w.requests.lena!, replayId.lena!, w.ownWorkspaceRequest.lena!]),
    );
    expect(sorted(await list('rex'))).toEqual(
      sorted([...w.requests.rex!, replayId.rex!, w.ownWorkspaceRequest.rex!]),
    );
    expect(await list('stranger')).toEqual([]);
  });

  test('the member helpers agree with the rule: the set and the single answer give the same result for every pair', async () => {
    for (const person of w.people)
      for (const workspace of [w.W, w.W2, ...Object.values(w.personal)]) {
        const set = (
          await w.f.owner.query(
            'SELECT $2::uuid IN (SELECT customer_private.workspace_ids_current($1)) AS member',
            [w.principals[person], workspace],
          )
        ).rows[0].member as boolean;
        const one = (
          await w.f.owner.query(
            'SELECT customer_private.workspace_member_current($2,$1) AS member',
            [w.principals[person], workspace],
          )
        ).rows[0].member as boolean;
        expect(one, `${person} in ${workspace}`).toBe(set);
      }
  });
});

describe.each([
  ['leave', 'lena'],
  ['owner revoke', 'rex'],
])('a member removed by %s', (how, person) => {
  const unknown = () => randomUUID();

  test('is removed, and the same revocation row is written in both ways', async () => {
    if (how === 'leave') await w.leave(person, w.W);
    else await w.revoke('olive', w.W, w.members[person]!);
    const rows = (
      await w.f.owner.query(
        `SELECT count(*)::int AS n FROM customer_private.workspace_access_revocation r
         JOIN customer_private.workspace_member m ON m.id=r.member_id WHERE m.principal_id=$1`,
        [w.principals[person]],
      )
    ).rows[0].n;
    expect(rows).toBe(1);
  });

  test('lists none of the requests made in the workspace, even the ones they wrote, and keeps the ones made outside any workspace', async () => {
    const ids = await list(person);
    for (const id of [...w.requests[person]!, replayId[person]!])
      expect(ids, `${how}: ${id}`).not.toContain(id);
    expect(ids).toContain(w.ownWorkspaceRequest[person]);
    expect(ids).toEqual([w.ownWorkspaceRequest[person]]);
  });

  test.each(paths.map((p) => [p.name, p] as const))(
    '%s refuses with the text of an id that does not exist',
    async (_name, path) => {
      for (const id of [...w.requests[person]!, replayId[person]!]) {
        const removed = await call(person, path, id);
        const missing = await call(person, path, unknown());
        expect(text(removed), `${how} ${path.name}`).toBe(`42501 ${path.message}`);
        expect(sameBytes(removed, missing), `${how} ${path.name}`).toBe(true);
      }
    },
  );

  test('the move list and the withdrawal and mute lists show none of them', async () => {
    expect(await moveRequests(person)).toEqual([]);
    const withdrawals = (await w.row(person, 'SELECT customer.my_request_withdrawals() AS r'))
      .r as { items: { requestId: string }[] };
    expect(withdrawals.items).toEqual([]);
    for (const sql of [
      'SELECT customer.my_mission_mail_mutes() AS r',
      'SELECT customer.my_notification_mutes() AS r',
    ])
      expect((await w.row(person, sql)).r).toEqual([]);
  });

  test('replaying a command they made before is refused like any workspace they cannot use, and creates nothing', async () => {
    const before = (
      await w.f.owner.query('SELECT count(*)::int AS n FROM customer_private.owned_request')
    ).rows[0].n;
    const replayed = await w
      .requestService(person)
      .submit(replay[person]!, w.prepare)
      .then(
        () => null,
        (error: { message: string; code?: string; status?: number }) => error,
      );
    const stranger = await w
      .requestService('stranger')
      .submit(w.submitInput(w.W), w.prepare)
      .then(
        () => null,
        (error: { message: string; code?: string; status?: number }) => error,
      );
    expect(replayed?.message).toBe('Workspace access denied');
    expect(stranger?.message).toBe('Workspace access denied');
    expect(Buffer.from(replayed!.message)).toEqual(Buffer.from(stranger!.message));
    expect(replayed?.status).toBe(stranger?.status);
    expect(
      (await w.f.owner.query('SELECT count(*)::int AS n FROM customer_private.owned_request'))
        .rows[0].n,
    ).toBe(before);
  });

  test('cannot start a new request in the workspace either', async () => {
    await expect(w.requestService(person).submit(w.submitInput(w.W), w.prepare)).rejects.toThrow(
      'Workspace access denied',
    );
  });

  test('sees their personal items as before: list, detail and withdrawal of a request made outside any workspace', async () => {
    const own = w.ownWorkspaceRequest[person]!;
    const detail = (await w.row(person, 'SELECT customer.private_request_detail($1) AS r', [own]))
      .r as Row;
    expect(detail).toBeTruthy();
    const withdrawn = (
      await w.row(person, 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
        own,
        randomUUID(),
        reason,
      ])
    ).r as Row;
    expect(withdrawn).toMatchObject({ withdrawn: true, changed: true });
    await w.row(person, 'SELECT customer.restore_request($1,$2) AS r', [own, randomUUID()]);
  });
});

describe('everyone else', () => {
  test('other members and the owner still list and open every request they made', async () => {
    expect(sorted(await list('sam'))).toEqual(sorted(w.requests.sam!));
    expect(sorted(await list('olive'))).toEqual(sorted([...w.requests.olive!, w.w2Requests.olive]));
    expect(sorted(await list('rita'))).toEqual(sorted(w.requests.rita!));
    for (const [person, id] of [
      ['sam', w.requests.sam![0]!],
      ['olive', w.requests.olive![0]!],
      ['rita', w.requests.rita![1]!],
    ] as const)
      expect((await w.attempt(person, paths[0]!.sql, [id])).ok, `${person} ${id}`).toBe(true);
    expect(sorted(await moveRequests('sam'))).toEqual(sorted([w.requests.sam![0]!]));
  });

  test('the original owner, the transferred owner and the former owner who is now an admin are all unaffected', async () => {
    const roles = (
      await w.f.owner.query(
        `SELECT p.subject,m.role FROM customer.membership m JOIN customer_private.principal p ON p.id=m.principal_id WHERE m.tenant_id=$1 ORDER BY p.subject`,
        [w.W2],
      )
    ).rows.map((r) => `${r.subject}:${r.role}`);
    expect(roles).toEqual(['synthetic-removed-hana:owner', 'synthetic-removed-olive:admin']);
    // olive made her W2 request as the original owner, hana hers as an invited member who now owns the workspace.
    expect(await list('olive')).toContain(w.w2Requests.olive);
    expect(await list('hana')).toEqual([w.w2Requests.hana]);
    for (const [person, id] of [
      ['olive', w.w2Requests.olive],
      ['hana', w.w2Requests.hana],
    ] as const)
      expect((await w.attempt(person, paths[0]!.sql, [id])).ok, `${person} ${id}`).toBe(true);
  });

  test('staff still read the removed authors requests and their Moves', async () => {
    for (const person of ['lena', 'rex']) {
      const mission = await w.missionOf(w.requests[person]![0]!);
      expect(await w.moves.version(w.operatorCtx, mission)).toBeGreaterThan(0);
      const options = await w.staff.options(w.staffCtx, mission);
      expect(options.request.id).toBe(w.requests[person]![0]);
    }
  });

  test('the provenance of what is shown does not change: sample stays sample, and equals the tenant flag', async () => {
    const page = (await w.row('sam', 'SELECT customer.private_requests(NULL,25) AS r')).r as {
      synthetic: boolean;
      requests: { id: string; synthetic: boolean; workspaceId: string }[];
    };
    expect(page.synthetic).toBe(true);
    for (const request of page.requests) {
      expect(request.synthetic).toBe(true);
      expect(
        (await w.f.owner.query('SELECT app.tenant_is_synthetic($1) AS s', [request.workspaceId]))
          .rows[0].s,
      ).toBe(true);
    }
  });
});

describe('lists filter in the query and in the next-page probe, and never raise', () => {
  const visible: string[] = [];
  const hidden: string[] = [];
  test('a person with 30 hidden and 3 visible requests gets the 3 on the first page and no next page', async () => {
    const own = await w.provision('bea', 'Synthetic own workspace of bea');
    const member = await w.join('olive', 'bea', w.W);
    for (let i = 0; i < 3; i++) visible.push(await w.submit('bea', own));
    for (let i = 0; i < 30; i++) hidden.push(await w.submit('bea', w.W));
    expect(sorted(await list('bea'))).toEqual(sorted([...visible, ...hidden]));
    await w.revoke('olive', w.W, member);
    const page = (await w.row('bea', 'SELECT customer.private_requests(NULL,25) AS r')).r as {
      requests: { id: string }[];
      nextAfter: string | null;
    };
    expect(sorted(page.requests.map((r) => r.id))).toEqual(sorted(visible));
    expect(page.nextAfter).toBeNull();
  });

  test.each([1, 2, 3])(
    'pages of %i over hidden and visible rows return every visible request once and never a phantom next page',
    async (size) => {
      const { ids, pages } = await w.listRequests('bea', size);
      expect(sorted(ids)).toEqual(sorted(visible));
      expect(new Set(ids).size).toBe(ids.length);
      // A page that says there is more is followed by a page that has something on it.
      for (const [index, page] of pages.entries()) {
        if (page.nextAfter)
          expect(pages[index + 1]!.count, `page ${index + 1} of size ${size}`).toBeGreaterThan(0);
        else expect(index).toBe(pages.length - 1);
      }
      const hiddenSeen = ids.filter((id) => hidden.includes(id));
      expect(hiddenSeen).toEqual([]);
    },
  );
});

describe('a new invitation gives access back, and nothing that was ended comes back', () => {
  test('rita withdraws one request, leaves, sees nothing, is invited again and sees the same requests', async () => {
    const [first, second] = w.requests.rita!;
    const withdrawn = (
      await w.row('rita', 'SELECT customer.withdraw_request($1,$2,$3) AS r', [
        second,
        randomUUID(),
        reason,
      ])
    ).r as Row;
    expect(withdrawn).toMatchObject({ withdrawn: true, changed: true });
    const before = (await w.row('rita', 'SELECT customer.private_requests(NULL,25) AS r')).r as {
      requests: { id: string; withdrawn: boolean }[];
    };
    await w.leave('rita', w.W);
    expect(await list('rita')).toEqual([]);
    expect((await call('rita', paths[0]!, first!)).ok).toBe(false);
    const rows = (
      await w.f.owner.query(
        'SELECT count(*)::int AS n FROM customer_private.workspace_member WHERE principal_id=$1 AND tenant_id=$2',
        [w.principals.rita, w.W],
      )
    ).rows[0].n;
    expect(rows).toBe(1);
    await w.join('olive', 'rita', w.W);
    // The old member row is still there and still revoked; the new invitation is a new row.
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.workspace_member WHERE principal_id=$1 AND tenant_id=$2',
          [w.principals.rita, w.W],
        )
      ).rows[0].n,
    ).toBe(2);
    const after = (await w.row('rita', 'SELECT customer.private_requests(NULL,25) AS r')).r as {
      requests: { id: string; withdrawn: boolean }[];
    };
    expect(sorted(after.requests.map((r) => r.id))).toEqual(
      sorted(before.requests.map((r) => r.id)),
    );
    expect(after.requests.find((r) => r.id === second)?.withdrawn).toBe(true);
    expect(after.requests.find((r) => r.id === first)?.withdrawn).toBe(false);
    const withdrawals = (await w.row('rita', 'SELECT customer.my_request_withdrawals() AS r'))
      .r as {
      items: { requestId: string }[];
    };
    expect(withdrawals.items.map((i) => i.requestId)).toEqual([second]);
  });

  test('a person who was removed and invited again can act on the old requests again', async () => {
    const first = w.requests.rita![0]!;
    for (const path of paths.slice(0, 2))
      expect((await call('rita', path, first)).ok, path.name).toBe(true);
    await expect(
      w.requestService('rita').submit(w.submitInput(w.W), w.prepare),
    ).resolves.toMatchObject({
      workspaceId: w.W,
    });
  });
});

test(`the owner's words are the rule here: "${OWNER_WORDS}"`, () => {
  expect(OWNER_WORDS).toBe('No, remove access (Recommended)');
});
