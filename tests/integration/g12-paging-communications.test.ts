import { beforeAll, afterAll, test, expect } from 'vitest';
import { accessFixture } from './access-fixture';

// CRUD G12: the communications workspace pages targets, contacts, messages and opt-outs on their own cursors.
let f: Awaited<ReturnType<typeof accessFixture>>;
const contactIds: string[] = [];
beforeAll(async () => {
  f = await accessFixture();
  for (let i = 0; i < 7; i++) {
    const intro = await f.introduction();
    contactIds.push(intro.contactId);
  }
  const seed = await f.owner.connect();
  try {
    await seed.query("SET session_replication_role = 'replica'");
    await seed.query(
      `INSERT INTO app.communication_optout(tenant_id,contact_id,recipient_key,reason,created_by)
       SELECT $1,c,encode(sha256(gen_random_uuid()::text::bytea),'hex'),'Synthetic opt-out for the paging test',$3
       FROM unnest($2::uuid[]) AS c`,
      [f.ctx.tenantId, contactIds, f.users.operator.id],
    );
  } finally {
    await seed.query('RESET session_replication_role');
    seed.release();
  }
});
afterAll(async () => {
  await f?.close();
});

type Page = Record<string, unknown>;
const lists = [
  { name: 'targets', cursor: 'targetsAfter', table: 'target_account', joined: true },
  { name: 'contacts', cursor: 'contactsAfter', table: 'private_contact_data', joined: false },
  { name: 'messages', cursor: 'messagesAfter', table: 'communication', joined: false },
  { name: 'optouts', cursor: 'optoutsAfter', table: 'communication_optout', joined: false },
] as const;

for (const list of lists)
  test(`${list.name} come in pages with an exact total, newest first, with no loss or duplicate`, async () => {
    const ids: string[] = [];
    const sizes: number[] = [];
    let after: string | null = null;
    let total = -1;
    for (let guard = 0; guard < 10; guard++) {
      const page = (await f.communications.workspace(f.ctx, {
        [list.cursor]: after,
        limit: 3,
      })) as unknown as Page;
      const rows = page[list.name] as { id: string }[];
      sizes.push(rows.length);
      ids.push(...rows.map((r) => r.id));
      total = page[`${list.name}Total`] as number;
      after = page[`${list.name}Next`] as string | null;
      if (!after) break;
    }
    expect(sizes).toEqual([3, 3, 1]);
    expect(total).toBeGreaterThanOrEqual(7);
    expect(new Set(ids).size).toBe(ids.length);
    const stored = (
      await f.owner.query(
        `SELECT id FROM app.${list.table} WHERE tenant_id=$1 ${list.name === 'contacts' ? 'AND valid_until>now()' : ''} ORDER BY created_at DESC,id DESC`,
        [f.ctx.tenantId],
      )
    ).rows.map((r) => r.id);
    expect(ids).toEqual(stored.slice(0, ids.length));
    expect(ids.length).toBe(total);
  });

test('attempts come with the messages of each page and a continuation returns only its list', async () => {
  const first = (await f.communications.workspace(f.ctx, { limit: 3 })) as unknown as Page;
  const messages = first.messages as { id: string }[];
  for (const a of first.attempts as { message_id: string }[])
    expect(messages.some((m) => m.id === a.message_id)).toBe(true);
  const next = (await f.communications.workspace(f.ctx, {
    messagesAfter: first.messagesNext as string,
    limit: 3,
  })) as unknown as Page;
  expect(next.targets).toEqual([]);
  expect(next.contacts).toEqual([]);
  expect(next.optouts).toEqual([]);
  expect(next.targetsTotal).toBeNull();
  expect(next.policies).toEqual([]);
  expect(next.templates).toEqual([]);
  for (const a of next.attempts as { message_id: string }[])
    expect((next.messages as { id: string }[]).some((m) => m.id === a.message_id)).toBe(true);
});

test('a message added between pages neither repeats nor drops a listed message', async () => {
  const first = (await f.communications.workspace(f.ctx, { limit: 3 })) as unknown as Page;
  const seen = new Set((first.messages as { id: string }[]).map((r) => r.id));
  const fresh = await f.introduction();
  let after = first.messagesNext as string | null;
  while (after) {
    const page = (await f.communications.workspace(f.ctx, {
      messagesAfter: after,
      limit: 3,
    })) as unknown as Page;
    for (const r of page.messages as { id: string }[]) {
      expect(seen.has(r.id)).toBe(false);
      seen.add(r.id);
    }
    after = page.messagesNext as string | null;
  }
  expect(seen.has(fresh.id)).toBe(false);
  expect(seen.size).toBe(7);
  const again = (await f.communications.workspace(f.ctx, { limit: 3 })) as unknown as Page;
  expect((again.messages as { id: string }[])[0]!.id).toBe(fresh.id);
  expect(again.messagesTotal).toBe(8);
});

test('malformed cursors and two cursors at once are refused with 400', async () => {
  for (const bad of ['not-a-cursor', 'x'.repeat(400)])
    await expect(f.communications.workspace(f.ctx, { messagesAfter: bad })).rejects.toMatchObject({
      status: 400,
    });
  const first = (await f.communications.workspace(f.ctx, { limit: 3 })) as unknown as Page;
  await expect(
    f.communications.workspace(f.ctx, {
      messagesAfter: first.messagesNext as string,
      targetsAfter: first.targetsNext as string,
    }),
  ).rejects.toMatchObject({ status: 400 });
});
