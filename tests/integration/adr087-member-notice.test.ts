import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture } from './support';
import { Probe, issuer, options } from './removed-member-support';
import type { DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateMemberNotice } from '../../packages/db/src/member-notice-migrate';
import {
  assertMemberNoticeLive,
  deliverMemberNotice,
  memberNoticeDispatcher,
} from '../../packages/db/src/member-notice-deliver';
import { inventoryDataCleanup } from '../../packages/auth/src/customer-data-cleanup';
import { CustomerInboxService } from '../../apps/web/lib/customer-inbox';
import { InboxService } from '../../packages/communications/src/inbox';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerMemberNoticeService } from '../../apps/web/lib/member-notice';
import { inboxSafePayload } from '../../apps/web/lib/ux/notify-mail';

// ADR-087 U4, the member notice, on a real PostgreSQL database with the real restricted logins and invented synthetic people.
// The tests run in order: the module refuses before its prerequisites and against a changed inbox type check, installs once,
// its rollback text restores the exact original check, then delivery, the customer state and dismissal are proven, and the
// rollback refuses once history exists. Fails on main: the module and its migrator do not exist there.
let f: Awaited<ReturnType<typeof fixture>>;
const moduleFile = (name: string) =>
  readFileSync(resolve('packages/db/member-notice-migrations', name), 'utf8');
const ORIGINAL = '5846e8bd9a5b660413c04d72a9149d909e3f281c16afb548061a660b654dbd90';
const typeCheck = async () =>
  (
    await f.owner.query<{ name: string; hash: string }>(
      `SELECT c.conname AS name,encode(sha256(convert_to(pg_get_constraintdef(c.oid),'UTF8')),'hex') AS hash
       FROM pg_constraint c WHERE c.conrelid='app.inbox_notification'::regclass AND c.contype='c'
        AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='app.inbox_notification'::regclass AND a.attname='type')]`,
    )
  ).rows;
const objects = async () =>
  (
    await f.owner.query(
      `SELECT to_regclass('customer_private.member_notice_delivery') IS NOT NULL AS delivery,
        to_regclass('customer_private.member_notice_dismissal') IS NOT NULL AS dismissal,
        to_regprocedure('customer_private.member_notice_deliver(uuid,text)') IS NOT NULL AS deliver,
        to_regprocedure('customer.member_notice_state(uuid)') IS NOT NULL AS state,
        to_regprocedure('customer.member_notice_dismiss(uuid)') IS NOT NULL AS dismiss`,
    )
  ).rows[0];
const DECISION_4B =
  'Owners and admins of this workspace can read the reports you save and the decision cards you make here, and download the Trip Book and Supplier Book of your saved reports. This includes items you saved before today. They cannot remove or withdraw them. If there is anything you do not want them to see, you can remove it before [date and time].';
const none = { delivery: false, dismissal: false, deliver: false, state: false, dismiss: false };
const all = { delivery: true, dismissal: true, deliver: true, state: true, dismiss: true };

const people = ['olive', 'lena', 'rex', 'stranger'] as const;
type Person = (typeof people)[number];
const session = (person: string) => ({
  subject: `synthetic-member-notice-${person}`,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
  signedInAt: new Date(),
});
const principals = {} as Record<Person, string>;
let W = '',
  W3 = '',
  rexMember = '';
const as = <T>(person: Person, work: (db: DatabaseClient) => Promise<T>) =>
  new Probe(f.runtime, f.auth, options, async () => session(person)).run(work);
const workspaces = (person: Person) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const state = (person: Person, workspace: string) =>
  as(
    person,
    async (db) =>
      (await db.query('SELECT * FROM customer.member_notice_state($1)', [workspace])).rows,
  );
const dismiss = (person: Person, workspace: string) =>
  as(
    person,
    async (db) =>
      (await db.query('SELECT customer.member_notice_dismiss($1) AS ok', [workspace])).rows[0],
  );
const noticesOf = async (person: Person) =>
  (
    await f.owner.query(
      `SELECT event_key,payload,created_at FROM app.inbox_notification
       WHERE recipient_kind='customer' AND recipient_account_id=$1 AND type='MEMBER_NOTICE'`,
      [principals[person]],
    )
  ).rows;

beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.close();
});

describe('install', () => {
  test('refuses without the customer real-use modules and leaves nothing behind', async () => {
    await expect(migrateMemberNotice(f.owner)).rejects.toThrow(
      'The customer real-use modules are not installed, so member notice was not installed.',
    );
    expect(await objects()).toEqual(none);
  });
  test('delivery refuses while the module is not installed, and writes nothing', async () => {
    await expect(
      deliverMemberNotice(f.owner, { targets: 'all', deliveredBy: 'before install' }),
    ).rejects.toThrow(
      'The member notice module is not installed, so no notice was delivered. Run field_modules_action=member_notice first.',
    );
    expect(await objects()).toEqual(none);
  });
  test('refuses without the inbox and leaves nothing behind', async () => {
    await migrateCustomerRealUse(f.owner);
    await expect(migrateMemberNotice(f.owner)).rejects.toThrow(
      'Member notice needs the commercial readiness inbox',
    );
    expect(await objects()).toEqual(none);
  });
  test('refuses without the inbox event key index, and leaves nothing behind', async () => {
    await migrateCommercialReadiness(f.owner);
    await f.owner.query('ALTER INDEX app.inbox_notification_event_idx RENAME TO hidden_event_idx');
    try {
      await expect(migrateMemberNotice(f.owner)).rejects.toThrow(
        'Member notice needs commercial readiness 0002 first: app.inbox_notification.event_key and inbox_notification_event_idx',
      );
      expect(await objects()).toEqual(none);
    } finally {
      await f.owner.query(
        'ALTER INDEX app.hidden_event_idx RENAME TO inbox_notification_event_idx',
      );
    }
  });
  test('refuses a changed inbox type check, found by its column and not its name', async () => {
    expect(await typeCheck()).toEqual([{ name: 'inbox_notification_type_check', hash: ORIGINAL }]);
    // The same definition under another name is accepted by the guard; a changed definition is not.
    await f.owner.query(
      'ALTER TABLE app.inbox_notification RENAME CONSTRAINT inbox_notification_type_check TO renamed_type_check',
    );
    await f.owner.query(
      `ALTER TABLE app.inbox_notification DROP CONSTRAINT renamed_type_check,
       ADD CONSTRAINT renamed_type_check CHECK(type IN ('TEAM_INVITE','CONTRIBUTOR_INVITE','PARTICIPANT_INVITE','TASK_ASSIGNED','QUOTE_SENT','QUOTE_ACCEPTED','REPORT_PUBLISHED','REQUEST_RECEIVED','REPLY_POSTED','SOMETHING_ELSE'))`,
    );
    await expect(migrateMemberNotice(f.owner)).rejects.toThrow(
      'the inbox type check differs from the one this file was written against',
    );
    expect(await objects()).toEqual(none);
    await f.owner.query(
      `ALTER TABLE app.inbox_notification DROP CONSTRAINT renamed_type_check,
       ADD CONSTRAINT renamed_type_check CHECK(type IN ('TEAM_INVITE','CONTRIBUTOR_INVITE','PARTICIPANT_INVITE','TASK_ASSIGNED','QUOTE_SENT','QUOTE_ACCEPTED','REPORT_PUBLISHED','REQUEST_RECEIVED','REPLY_POSTED'))`,
    );
    expect(await typeCheck()).toEqual([{ name: 'renamed_type_check', hash: ORIGINAL }]);
  });
  test('installs once, keeps the check name, adds only MEMBER_NOTICE, and a second run applies nothing', async () => {
    expect(await migrateMemberNotice(f.owner)).toEqual({
      applied: ['0001_member_notice.sql'],
      waiting: [],
    });
    expect(await migrateMemberNotice(f.owner)).toEqual({ applied: [], waiting: [] });
    expect(await objects()).toEqual(all);
    const [check] = await typeCheck();
    expect(check!.name).toBe('renamed_type_check');
    expect(check!.hash).not.toBe(ORIGINAL);
    const def = (
      await f.owner.query(
        "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='renamed_type_check'",
      )
    ).rows[0].d as string;
    expect(def).toContain("'MEMBER_NOTICE'::text");
    expect(def.replace(", 'MEMBER_NOTICE'::text", '')).toBe(
      "CHECK ((type = ANY (ARRAY['TEAM_INVITE'::text, 'CONTRIBUTOR_INVITE'::text, 'PARTICIPANT_INVITE'::text, 'TASK_ASSIGNED'::text, 'QUOTE_SENT'::text, 'QUOTE_ACCEPTED'::text, 'REPORT_PUBLISHED'::text, 'REQUEST_RECEIVED'::text, 'REPLY_POSTED'::text])))",
    );
    // Installing writes no row.
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int AS n FROM app.inbox_notification WHERE type='MEMBER_NOTICE'",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.member_notice_delivery',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  test('the rollback text, while nothing was delivered, restores the exact original check and drops only its own objects', async () => {
    const client = await f.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(moduleFile('rollback/0001_drop_member_notice.sql'));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await typeCheck()).toEqual([{ name: 'renamed_type_check', hash: ORIGINAL }]);
    expect(await objects()).toEqual(none);
    // Put the module back exactly as recorded, so the rest of the suite runs on it.
    await f.owner.query(moduleFile('0001_member_notice.sql'));
    expect(await objects()).toEqual(all);
    expect(await migrateMemberNotice(f.owner)).toEqual({ applied: [], waiting: [] });
  });
});

describe('delivery, state and dismissal', () => {
  beforeAll(async () => {
    await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
    await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
    await configureCustomerRealUse(f.owner, {
      enabled: true,
      reason: 'Owner approved real work for the member notice fixture',
    });
    for (const person of people)
      principals[person] = (
        await admitSyntheticCustomer(f.owner, {
          issuer,
          subject: session(person).subject,
          executorId: f.serviceId,
          reason: 'Explicit fictional member notice test principal, never real provider data',
        })
      ).id;
    const provision = async (person: Person, name: string) =>
      (await workspaces(person).provision({ commandId: randomUUID(), name })).id as string;
    const join = async (owner: Person, person: Person, target: string) => {
      const invitation = await workspaces(owner).access({
        action: 'invite',
        commandId: randomUUID(),
        workspaceId: target,
        label: `Synthetic invited ${person}`,
      });
      return (
        await workspaces(person).access({
          action: 'accept',
          commandId: randomUUID(),
          token: invitation.token!,
        })
      ).memberId as string;
    };
    W = await provision('olive', 'Synthetic member notice workspace');
    await join('olive', 'lena', W);
    rexMember = await join('olive', 'rex', W);
    await workspaces('olive').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId: W,
      kind: 'membership',
      targetId: rexMember,
    });
    W3 = await provision('stranger', 'Synthetic other workspace');
  });

  test('with the module missing the app service shows nothing and dismiss is unavailable, switch on', async () => {
    const service = new CustomerMemberNoticeService(f.runtime, f.auth, options, async () =>
      session('olive'),
    );
    const on = { CORRIDRA_MEMBER_NOTICE: 'true' } as NodeJS.ProcessEnv;
    await f.owner.query(
      'ALTER FUNCTION customer.member_notice_state(uuid) RENAME TO member_notice_state_hidden',
    );
    try {
      expect(await service.list(undefined, undefined, on)).toEqual({ notices: [] });
      await expect(service.dismiss(W, undefined, undefined, on)).rejects.toMatchObject({
        status: 503,
      });
    } finally {
      await f.owner.query(
        'ALTER FUNCTION customer.member_notice_state_hidden(uuid) RENAME TO member_notice_state',
      );
    }
  });

  test('the runtime role cannot deliver', async () => {
    await expect(
      f.runtime.query("SELECT * FROM customer_private.member_notice_deliver($1,'runtime')", [W]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.auth.query("SELECT * FROM customer_private.member_notice_deliver($1,'auth')", [W]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.member_notice_delivery',
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('before delivery nobody has a notice and nobody can dismiss', async () => {
    expect(await state('olive', W)).toEqual([]);
    await expect(dismiss('olive', W)).rejects.toMatchObject({ code: '42501' });
  });

  test('every current member gets exactly one notice, a removed member none, opens_at is 24 hours later', async () => {
    const {
      deliveries: [first],
    } = await deliverMemberNotice(f.owner, {
      targets: [W],
      deliveredBy: memberNoticeDispatcher({ GITHUB_ACTOR: 'owner-handle', GITHUB_RUN_ID: '42' }),
    });
    expect(first).toMatchObject({ workspaceId: W, delivered: true, notices: 2 });
    expect(first!.opensAt.getTime() - first!.deliveredAt.getTime()).toBe(24 * 3600 * 1000);
    for (const person of ['olive', 'lena'] as const) {
      const rows = await noticesOf(person);
      expect(rows).toHaveLength(1);
      expect(rows[0].event_key).toBe(`member-notice:${W}`);
      // The row carries the decision 4b words and the switch-on time (ADR-087 U4).
      expect(rows[0].payload).toEqual({
        workspaceId: W,
        opensAt: first!.opensAt.toISOString(),
        words: DECISION_4B,
      });
      expect(new Date(rows[0].created_at).getTime()).toBe(first!.deliveredAt.getTime());
    }
    expect(await noticesOf('rex')).toEqual([]);
    expect(await noticesOf('stranger')).toEqual([]);
  });

  test('the recipient reads the notice through the inbox row security; the removed-member filter keeps it', async () => {
    const mine = await as(
      'lena',
      async (db) =>
        (
          await db.query(
            "SELECT type,payload FROM app.inbox_notification WHERE type='MEMBER_NOTICE'",
          )
        ).rows,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].payload.workspaceId).toBe(W);
    expect(
      await as(
        'stranger',
        async (db) =>
          (await db.query("SELECT 1 FROM app.inbox_notification WHERE type='MEMBER_NOTICE'")).rows,
      ),
    ).toEqual([]);
  });

  test('a second delivery writes nothing and keeps the first time; another workspace is untouched', async () => {
    const before = (await f.owner.query('SELECT * FROM customer_private.member_notice_delivery'))
      .rows;
    const {
      deliveries: [again],
    } = await deliverMemberNotice(f.owner, {
      targets: [W],
      deliveredBy: 'second run',
    });
    expect(again).toMatchObject({ delivered: false, notices: 0 });
    expect(again!.deliveredAt.getTime()).toBe(new Date(before[0].delivered_at).getTime());
    expect(
      (await f.owner.query('SELECT * FROM customer_private.member_notice_delivery')).rows,
    ).toEqual(before);
    expect(before.map((row) => row.workspace_id)).toEqual([W]);
    // The record names who dispatched it (F7).
    expect(before[0].delivered_by).toBe(
      'owner-handle via install-customer-modules member_notice_deliver run 42',
    );
    expect(await noticesOf('olive')).toHaveLength(1);
    expect(await state('stranger', W3)).toEqual([]);
  });

  test('state answers a current member of that workspace only', async () => {
    const [mine] = await state('lena', W);
    expect(mine).toMatchObject({ dismissed: false });
    expect(new Date(mine.opens_at).getTime() - new Date(mine.delivered_at).getTime()).toBe(
      24 * 3600 * 1000,
    );
    expect(await state('stranger', W)).toEqual([]);
    expect(await state('rex', W)).toEqual([]);
    expect(await state('lena', W3)).toEqual([]);
    expect(await state('lena', randomUUID())).toEqual([]);
  });

  test('a non-member, a removed member and a member of another workspace cannot dismiss; dismiss records the caller only', async () => {
    for (const person of ['stranger', 'rex'] as const)
      await expect(dismiss(person, W)).rejects.toMatchObject({
        code: '42501',
        message: 'Workspace access denied',
      });
    await expect(dismiss('lena', W3)).rejects.toMatchObject({ code: '42501' });
    expect(await dismiss('lena', W)).toEqual({ ok: true });
    expect(await dismiss('lena', W)).toEqual({ ok: true });
    const rows = (
      await f.owner.query(
        'SELECT workspace_id,principal_id FROM customer_private.member_notice_dismissal',
      )
    ).rows;
    expect(rows).toEqual([{ workspace_id: W, principal_id: principals.lena }]);
    expect((await state('lena', W))[0].dismissed).toBe(true);
    expect((await state('olive', W))[0].dismissed).toBe(false);
  });

  test('the runtime role reads and writes neither table directly', async () => {
    for (const table of ['member_notice_delivery', 'member_notice_dismissal'])
      await expect(
        f.runtime.query(`SELECT 1 FROM customer_private.${table}`),
      ).rejects.toMatchObject({
        code: '42501',
      });
  });

  test('all delivers every real workspace without a record, and skips synthetic, archived, made-up, demo and QA ones', async () => {
    const run = (classify?: typeof inventoryDataCleanup) =>
      deliverMemberNotice(f.owner, { targets: 'all', deliveredBy: 'all run', classify });
    expect(await run()).toEqual({ deliveries: [], skipped: { listed: 0, archived: 0 } });
    // A real workspace with a QA test name, classified by the existing data cleanup inventory (reused, not copied).
    const qa = (
      await workspaces('stranger').provision({
        commandId: randomUUID(),
        name: 'Synthetic QA Test Real Exporters',
      })
    ).id as string;
    const archived = (
      await workspaces('stranger').provision({
        commandId: randomUUID(),
        name: 'Synthetic archived exporters workspace',
      })
    ).id as string;
    await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id = ANY($1::uuid[])', [
      [W3, qa, archived],
    ]);
    const inventory = await inventoryDataCleanup(f.owner);
    expect([...inventory.qa.kept.map((row) => row.id), ...inventory.qa.listedOnly]).toEqual([qa]);
    // The archived answer comes from customer_private.workspace_archived when the workspace lifecycle is installed; this
    // fixture does not install it, so a stand-in answers true for one workspace only.
    expect(
      (
        await f.owner.query(
          "SELECT to_regprocedure('customer_private.workspace_archived(uuid)') AS f",
        )
      ).rows[0].f,
    ).toBeNull();
    await f.owner.query(
      `CREATE FUNCTION customer_private.workspace_archived(target uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT target='${archived}'::uuid $$`,
    );
    try {
      const done = await run(inventoryDataCleanup);
      expect(done.skipped).toEqual({ listed: 1, archived: 1 });
      expect(done.deliveries.map((row) => [row.workspaceId, row.delivered, row.notices])).toEqual([
        [W3, true, 1],
      ]);
      expect(await noticesOf('stranger')).toHaveLength(1);
      expect(await run(inventoryDataCleanup)).toEqual({
        deliveries: [],
        skipped: { listed: 1, archived: 1 },
      });
    } finally {
      await f.owner.query('DROP FUNCTION customer_private.workspace_archived(uuid)');
    }
  });

  test('an unknown workspace refuses and the whole run writes nothing', async () => {
    const count = async () =>
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.member_notice_delivery',
        )
      ).rows[0].n;
    const before = await count();
    await expect(
      deliverMemberNotice(f.owner, { targets: [W, randomUUID()], deliveredBy: 'bad run' }),
    ).rejects.toThrow('Unknown workspace');
    expect(await count()).toBe(before);
  });

  test('the app service: nothing with the switch off; after switch-on the notice stays until that member dismisses it', async () => {
    const service = (person: Person) =>
      new CustomerMemberNoticeService(f.runtime, f.auth, options, async () => session(person));
    const on = { CORRIDRA_MEMBER_NOTICE: 'true' } as NodeJS.ProcessEnv;
    expect(await service('olive').list(undefined, undefined, {})).toEqual({ notices: [] });
    await expect(service('olive').dismiss(W, undefined, undefined, {})).rejects.toMatchObject({
      status: 503,
    });
    // A workspace whose switch-on time has passed (the record is written that way, never changed): the notice is still
    // there for olive until she dismisses it, and lena (who dismissed W) sees nothing.
    const W4 = (
      await workspaces('olive').provision({
        commandId: randomUUID(),
        name: 'Synthetic opened workspace',
      })
    ).id as string;
    await f.owner.query(
      `INSERT INTO customer_private.member_notice_delivery(workspace_id,delivered_at,opens_at,delivered_by)
       VALUES($1,now()-interval '2 days',now()-interval '1 day','member notice test')`,
      [W4],
    );
    const olive = (await service('olive').list(undefined, undefined, on)).notices;
    expect(olive.map((row) => row.workspaceId).sort()).toEqual([W, W4].sort());
    const opened = olive.find((row) => row.workspaceId === W4)!;
    expect(opened.workspaceName).toBe('Synthetic opened workspace');
    expect(Date.parse(opened.opensAt)).toBeLessThan(Date.now());
    expect((await service('lena').list(undefined, undefined, on)).notices).toEqual([]);
    expect((await service('rex').list(undefined, undefined, on)).notices).toEqual([]);
    await service('olive').dismiss(W4, undefined, undefined, on);
    expect(
      (await service('olive').list(undefined, undefined, on)).notices.map((row) => row.workspaceId),
    ).toEqual([W]);
    await service('olive').dismiss(W, undefined, undefined, on);
    expect((await service('olive').list(undefined, undefined, on)).notices).toEqual([]);
    // A saved report that is not theirs answers nothing.
    expect((await service('olive').list(undefined, undefined, on, randomUUID())).notices).toEqual(
      [],
    );
    await expect(service('rex').dismiss(W, undefined, undefined, on)).rejects.toMatchObject({
      code: '42501',
    });
  });

  test('both tables are history: UPDATE and DELETE are refused, even for the owner', async () => {
    for (const sql of [
      "UPDATE customer_private.member_notice_delivery SET delivered_at=delivered_at-interval '1 day',opens_at=opens_at-interval '1 day'",
      'DELETE FROM customer_private.member_notice_delivery',
      'UPDATE customer_private.member_notice_dismissal SET dismissed_at=now()',
      'DELETE FROM customer_private.member_notice_dismissal',
    ])
      await expect(f.owner.query(sql), sql).rejects.toThrow();
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.member_notice_dismissal',
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  });

  test('CORRIDRA_MEMBER_NOTICE off hides the inbox item from the list, the unread count and Mark All Read', async () => {
    const inbox = new CustomerInboxService(
      f.runtime,
      f.auth,
      options,
      async () => session('stranger'),
      new InboxService(f.runtime),
    );
    const saved = process.env.CORRIDRA_MEMBER_NOTICE;
    try {
      delete process.env.CORRIDRA_MEMBER_NOTICE;
      expect(
        (await inbox.list()).filter((item) => item.type === ('MEMBER_NOTICE' as string)),
      ).toEqual([]);
      expect(await inbox.unreadCount()).toBe(0);
      expect(await inbox.markAllRead()).toBe(0);
      process.env.CORRIDRA_MEMBER_NOTICE = 'true';
      const shown = (await inbox.list()).filter(
        (item) => item.type === ('MEMBER_NOTICE' as string),
      );
      expect(shown).toHaveLength(1);
      expect(shown[0]!.readAt).toBeNull();
      expect(await inbox.unreadCount()).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.CORRIDRA_MEMBER_NOTICE;
      else process.env.CORRIDRA_MEMBER_NOTICE = saved;
    }
  });

  test('the inbox write sanitiser keeps the notice payload whole', async () => {
    const [row] = await noticesOf('olive');
    expect(inboxSafePayload(row.payload)).toEqual(row.payload);
  });

  test('the rollback refuses once notices exist, and deletes nothing', async () => {
    const before = await typeCheck();
    await expect(f.owner.query(moduleFile('rollback/0001_drop_member_notice.sql'))).rejects.toThrow(
      'Member notice rollback refused: notices were delivered or dismissed',
    );
    expect(await objects()).toEqual(all);
    expect(await typeCheck()).toEqual(before);
    expect(await noticesOf('lena')).toHaveLength(1);
  });
});

// Installer wiring, like the other ADR-087 modules: reached only through field_modules_action, never by a base run, and only
// with apply. Delivery takes no list (no 25th workflow input): every real workspace not yet delivered. The log prints counts and
// 8-character ids only.
describe('the member notice install wiring', () => {
  const script = readFileSync(resolve('scripts/install-customer-modules.ts'), 'utf8');
  const workflow = readFileSync(resolve('.github/workflows/install-customer-modules.yml'), 'utf8');
  test('the script takes a three-valued action that needs apply, and lists the registry', () => {
    expect(script).toContain(
      "MEMBER_NOTICE_ACTION: z.enum(['unchanged', 'install', 'deliver']).default('unchanged')",
    );
    expect(script).toContain("if (v.MEMBER_NOTICE_ACTION !== 'unchanged' && !apply)");
    expect(script).toContain('Member notice installation or delivery requires INSTALL_APPLY=yes');
    expect(script).toContain("'member_notice_migrations'");
  });
  test('install and delivery run only inside their own blocks, never in a base run, and the list is parsed first', () => {
    const installers = script.slice(
      script.indexOf('const installers'),
      script.indexOf('const pool = databasePool'),
    );
    expect(installers).not.toMatch(/notice/i);
    const report = script.indexOf("await report(apply ? 'Before install'");
    const after = script.indexOf("await report('After install');");
    const install = script.indexOf('const result = await migrateMemberNotice(pool);');
    const deliver = script.indexOf(
      'const { deliveries: done, skipped } = await deliverMemberNotice(pool, {',
    );
    for (const at of [install, deliver]) {
      expect(at).toBeGreaterThan(report);
      expect(at).toBeLessThan(after);
    }
    expect(script.slice(install - 120, install)).toContain("v.MEMBER_NOTICE_ACTION === 'install'");
    expect(script.slice(deliver - 600, deliver)).toContain(
      "if (v.MEMBER_NOTICE_ACTION === 'deliver') {",
    );
    expect(script.split('migrateMemberNotice(pool)').length - 1).toBe(1);
    expect(script.split('deliverMemberNotice(pool').length - 1).toBe(1);
    // F1: the live notice is asked before the report and before anything is written; F6 and F7 in the call.
    const live = script.indexOf(
      "if (v.MEMBER_NOTICE_ACTION === 'deliver') await assertMemberNoticeLive(v.MEMBER_NOTICE_APP_ORIGIN);",
    );
    expect(live).toBeGreaterThan(0);
    expect(live).toBeLessThan(report);
    expect(script.slice(deliver, deliver + 400)).toContain(
      'deliveredBy: memberNoticeDispatcher(),',
    );
    expect(script.slice(deliver, deliver + 400)).toContain('classify: inventoryDataCleanup,');
    expect(script).toContain("targets: 'all',");
    // Counts and short ids only in the public log.
    expect(script).toContain('row.workspaceId.slice(0, 8)');
    expect(script).not.toMatch(/console\.log\([^)]*row\.workspaceId[^.]/);
  });
  test('the workflow derives the action from field_modules_action alone, adds no input, and passes the app origin only to deliver', () => {
    expect(workflow).toMatch(/^\s{12}member_notice,$/m);
    expect(workflow).toMatch(/^\s{12}member_notice_deliver,$/m);
    expect(workflow).not.toMatch(/^\s{6}member_notice[a-z_]*:/m);
    const lines = workflow.split('\n').filter((text) => text.includes('MEMBER_NOTICE_'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      "MEMBER_NOTICE_ACTION: ${{ inputs.field_modules_action == 'member_notice' && 'install' || inputs.field_modules_action == 'member_notice_deliver' && 'deliver' || 'unchanged' }}",
    );
    expect(lines[1]).toContain(
      "MEMBER_NOTICE_APP_ORIGIN: ${{ inputs.field_modules_action == 'member_notice_deliver' && vars.APP_ORIGIN || '' }}",
    );
    expect(workflow).toContain('turn CORRIDRA_MEMBER_NOTICE on in the live app first');
    expect(workflow).toContain(
      'run it only after U5 is merged and its install approved by the owner',
    );
  });
  test('the migrator reads only the top-level files, so the rollback text is never applied', () => {
    const top = readdirSync(resolve('packages/db/member-notice-migrations')).filter((name) =>
      name.endsWith('.sql'),
    );
    expect(top).toEqual(['0001_member_notice.sql']);
    expect(readdirSync(resolve('packages/db/member-notice-migrations/rollback'))).toEqual([
      '0001_drop_member_notice.sql',
    ]);
    const migrator = readFileSync(resolve('packages/db/src/member-notice-migrate.ts'), 'utf8');
    expect(migrator).toContain("import { migrateViewerModule } from './viewer-module-run';");
    expect(migrator).toContain("schema: 'member_notice_migrations'");
  });
});

// F1: the 24-hour clock may start only while the /account notice is live. The installer asks the live app first and refuses,
// with a plain message and before any write, unless a signed-out GET of the notice route answers 401.
describe('the live notice check before delivery', () => {
  const answer = (status: number) => async () => ({ status });
  test('only a 401 from the live route lets delivery go on', async () => {
    const seen: string[] = [];
    await assertMemberNoticeLive('https://app.example.test', async (url) => {
      seen.push(url);
      return { status: 401 };
    });
    expect(seen).toEqual(['https://app.example.test/api/customer-member-notice']);
  });
  test('switch off, notice unavailable, unreachable or no address: refused before anything is written', async () => {
    await expect(assertMemberNoticeLive('https://app.example.test', answer(404))).rejects.toThrow(
      'CORRIDRA_MEMBER_NOTICE is off on the live app',
    );
    for (const status of [503, 200, 500, 403])
      await expect(
        assertMemberNoticeLive('https://app.example.test', answer(status)),
      ).rejects.toThrow(`the live app answered ${status}`);
    await expect(
      assertMemberNoticeLive('https://app.example.test', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('the live app could not be reached');
    for (const origin of [undefined, '', 'not a url'])
      await expect(assertMemberNoticeLive(origin, answer(401))).rejects.toThrow(
        'the live app address is not set',
      );
    for (const origin of ['http://app.example.test', 'https://app.example.test/path'])
      await expect(assertMemberNoticeLive(origin, answer(401))).rejects.toThrow(
        'APP_ORIGIN must be the https origin of the live app',
      );
  });
  test('the record names the dispatcher', () => {
    expect(memberNoticeDispatcher({ GITHUB_ACTOR: 'someone', GITHUB_RUN_ID: '7' })).toBe(
      'someone via install-customer-modules member_notice_deliver run 7',
    );
    expect(memberNoticeDispatcher({})).toBe(
      'install-customer-modules member_notice_deliver (no GitHub actor)',
    );
    expect(memberNoticeDispatcher({ GITHUB_ACTOR: 'x'.repeat(300) })).toHaveLength(200);
  });
});
