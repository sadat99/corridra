import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  cardIssuer,
  cardOptions,
  cardSession,
  cardWorld,
  mutate,
  type CardWorld,
} from './decision-card-world';
import { sessionHash } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { migrateMemberNotice } from '../../packages/db/src/member-notice-migrate';
import { migrateMemberAccess } from '../../packages/db/src/member-access-migrate';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import { CustomerMemberAccessService } from '../../apps/web/lib/member-access';
import { uxSwitchNames } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';

// ADR-087 U5: workspace owners and admins read the saved reports and decision cards of current members and download their books,
// read only and audited, and only 24 hours after the workspace's member notice was delivered. Real PostgreSQL, the restricted
// runtime and auth logins, invented synthetic people. Tests 1 to 8 and 10 of the ADR's U5 list are here, in order; test 9 (the
// real-use writer on a workspace that is not a sample) is in adr087-member-access-real.test.ts. Every test that asserts a success
// fails on main, where the module, its functions and its migrator do not exist.
let w: CardWorld;
const moduleFile = (name: string) =>
  readFileSync(resolve('packages/db/member-access-migrations', name), 'utf8');
const hex = (value: string) => createHash('sha256').update(value).digest('hex');
const principals: Record<string, string> = {};
const memberIds: Record<string, string> = {};
let W = '',
  W2 = '';
// alice: owner of W. bob: admin of W who saves a report and makes a card. carol: plain member of W with a saved report.
// dave: owner of W2, delivered and open. erin: plain member of W, never reads anything.
type Built = Awaited<ReturnType<CardWorld['build']>>;
const items = {} as {
  bob: Built;
  bobCard: string;
  bobSecond: Built;
  bobSecondCard: string;
  carol: Built;
  alice: Built;
  dave: Built;
};

async function as(who: string, sql: string, args: unknown[] = []) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await w.f.auth.query(
    "INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds')",
    [hash, cardIssuer, cardSession(who).subject],
  );
  const db = await w.f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('corridra.customer_proof_hash',$1,true)", [hash]);
    const result = await db.query(sql, args);
    await db.query('COMMIT');
    return result.rows[0]?.result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await w.f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
    return 'allowed';
  } catch (error) {
    const e = error as { code?: string; message: string };
    return `${e.code} ${e.message}`;
  }
};
const list = (who: string, workspace: string, after: string | null = null, size = 25) =>
  as(who, 'SELECT customer.workspace_saved_missions($1,$2,$3) AS result', [workspace, after, size]);
const open = (who: string, workspace: string, resource: string) =>
  as(who, 'SELECT customer.workspace_saved_mission($1,$2) AS result', [workspace, resource]);
const book = (
  who: string,
  workspace: string,
  resource: string,
  kind = 'SUPPLIER',
  command = randomUUID(),
) =>
  as(who, 'SELECT customer.workspace_saved_mission_book($1,$2,$3,$4,true) AS result', [
    workspace,
    resource,
    kind,
    command,
  ]);
const cards = (who: string, workspace: string, after: string | null = null, size = 25) =>
  as(who, 'SELECT customer.workspace_decision_cards($1,$2,$3) AS result', [workspace, after, size]);
const card = (who: string, workspace: string, id: string) =>
  as(who, 'SELECT customer.workspace_decision_card($1,$2) AS result', [workspace, id]);
const workspaces = (who: string) =>
  new CustomerWorkspaceService(w.f.runtime, w.f.auth, cardOptions, async () => cardSession(who));
const roles = (who: string) =>
  new CustomerMemberRoleService(w.f.runtime, w.f.auth, cardOptions, async () => cardSession(who));
async function makeCard(who: string, resourceId: string, decisionId: string) {
  const preview = await as(who, 'SELECT customer.decision_card_preview($1,$2) AS result', [
    resourceId,
    decisionId,
  ]);
  const made = await as(who, 'SELECT customer.create_decision_card($1,$2,$3,$4,$5) AS result', [
    randomUUID(),
    resourceId,
    decisionId,
    preview.digest,
    hex(randomUUID()),
  ]);
  return made.cardId as string;
}
async function join(owner: string, who: string, workspace: string) {
  const invitation = await workspaces(owner).access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: workspace,
    label: `Synthetic invited ${who}`,
  });
  return (
    await workspaces(who).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invitation.token!,
    })
  ).memberId as string;
}
// The events of the U5 kinds, with the audit row joined to each.
const events = async () =>
  (
    await w.f.owner.query(
      `SELECT e.id,e.tenant_id,e.type,e.payload,e.actor_id,a.actor_id AS audit_actor,a.action
       FROM app.domain_event e LEFT JOIN app.audit_event a ON a.domain_event_id=e.id
       WHERE e.aggregate_type='customer_workspace_access' AND e.type IN ('customer.member_item.read','customer.member_item.book')
       ORDER BY e.occurred_at,e.id`,
    )
  ).rows;
const deliver = (workspace: string, hoursAgo: number) =>
  w.f.owner.query(
    `INSERT INTO customer_private.member_notice_delivery(workspace_id,delivered_at,opens_at,delivered_by)
     SELECT $1,t,t+interval '24 hours','member access test' FROM (SELECT clock_timestamp()-make_interval(hours=>$2) AS t) m`,
    [workspace, hoursAgo],
  );

beforeAll(async () => {
  w = await cardWorld();
  W = w.workspaceId;
  Object.assign(principals, w.principals);
  await migrateCustomerRealUse(w.f.owner);
  await migrateCommercialReadiness(w.f.owner);
  await migrateCustomerBooks(w.f.owner);
  for (const who of ['carol', 'dave', 'erin']) {
    principals[who] = (
      await admitSyntheticCustomer(w.f.owner, {
        issuer: cardIssuer,
        subject: cardSession(who).subject,
        executorId: w.f.serviceId,
        reason: 'Fictional customer member access fixture, never real provider data',
      })
    ).id;
    await admitSyntheticCustomerRequests(w.f.owner, {
      principalId: principals[who]!,
      reason: 'Explicit fictional private request admission',
    });
    w.principals[who] = principals[who]!;
  }
  memberIds.carol = await join('alice', 'carol', W);
  memberIds.erin = await join('alice', 'erin', W);
  W2 = (
    await workspaces('dave').provision({
      commandId: randomUUID(),
      name: 'Synthetic second workspace',
    })
  ).id as string;
  await w.setBobRole('admin', 'member');
  const bob = await w.build('bob' as never, W);
  items.bob = bob;
  items.bobCard = await makeCard('bob', bob.resourceId, bob.decisionId);
  const bobSecond = await w.build('bob' as never, W);
  items.bobSecond = bobSecond;
  items.bobSecondCard = await makeCard('bob', bobSecond.resourceId, bobSecond.decisionId);
  items.carol = await w.build('carol' as never, W);
  items.alice = w.main;
  items.dave = await w.build('dave' as never, W2);
}, 600000);
afterAll(async () => {
  await w?.f.close();
});

describe('before the module: the refusals of today', () => {
  test('1, 2, 3 and 4 today: no owner, admin or member reaches another member item, and nothing exists to call', async () => {
    for (const who of ['alice', 'dave', 'carol'])
      expect(await refusal(list(who, W)), who).toMatch(
        /^42883 function customer\.workspace_saved_missions/,
      );
    expect(
      await refusal(
        as('alice', 'SELECT customer.saved_mission_action($1) AS result', [items.bob.resourceId]),
      ),
    ).toBe('42501 Saved mission unavailable');
    expect(
      await refusal(
        as('carol', 'SELECT customer.saved_mission_action($1) AS result', [items.bob.resourceId]),
      ),
    ).toBe('42501 Saved mission unavailable');
    expect(
      await refusal(
        as('alice', 'SELECT customer.saved_mission_book($1,$2,$3,true) AS result', [
          items.bob.resourceId,
          'SUPPLIER',
          randomUUID(),
        ]),
      ),
    ).toBe('42501 Saved mission unavailable');
  });
});

describe('install', () => {
  test('refuses without the member notice module and leaves nothing behind', async () => {
    await expect(migrateMemberAccess(w.f.owner)).rejects.toThrow(
      'Member access needs the member notice module first (field_modules_action=member_notice)',
    );
    expect(
      (
        await w.f.owner.query(
          "SELECT to_regprocedure('customer.workspace_saved_missions(uuid,uuid,integer)') AS f",
        )
      ).rows[0].f,
    ).toBeNull();
  });
  test('refuses a changed access event writer, and leaves nothing behind', async () => {
    await migrateMemberNotice(w.f.owner);
    const client = await w.f.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "COMMENT ON FUNCTION customer_private.workspace_access_event(uuid,uuid,uuid,text,jsonb) IS 'changed'",
      );
      await client.query(
        `CREATE OR REPLACE FUNCTION customer_private.workspace_access_event(target uuid, actor uuid, command uuid, kind text, payload jsonb)
         RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $f$ BEGIN NULL; END $f$`,
      );
      await expect(client.query(moduleFile('0001_member_access.sql'))).rejects.toThrow(
        'Member access: the workspace access event writer differs from the real-use version',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  test('installs both parts once, writes no row, and only the runtime role may call the four readers', async () => {
    const before = (await w.f.owner.query('SELECT count(*)::int AS n FROM app.domain_event'))
      .rows[0].n;
    expect(await migrateMemberAccess(w.f.owner)).toEqual({
      applied: ['0001_member_access.sql', '0002_member_decision_cards.sql'],
      waiting: [],
    });
    expect(await migrateMemberAccess(w.f.owner)).toEqual({ applied: [], waiting: [] });
    expect(
      (await w.f.owner.query('SELECT count(*)::int AS n FROM app.domain_event')).rows[0].n,
    ).toBe(before);
    const grants = (
      await w.f.owner.query(
        `SELECT p.oid::regprocedure::text AS sig,p.prosecdef AS definer,p.proconfig AS config,
          has_function_privilege('corridra_runtime',p.oid,'EXECUTE') AS runtime,has_function_privilege('corridra_auth',p.oid,'EXECUTE') AS auth
         FROM pg_proc p WHERE p.proname IN ('member_access_reader','member_saved_item','member_access_label','member_access_others',
          'workspace_saved_missions','workspace_saved_mission','workspace_saved_mission_book','workspace_decision_cards','workspace_decision_card')
         ORDER BY 1`,
      )
    ).rows;
    expect(grants).toHaveLength(9);
    for (const row of grants) {
      expect(row.definer, row.sig).toBe(true);
      expect(row.config, row.sig).toEqual(['search_path=pg_catalog']);
      expect(row.auth, row.sig).toBe(false);
      expect(row.runtime, row.sig).toBe(row.sig.startsWith('customer.'));
    }
  });
  test('the rollback text, while nothing was read, drops only its own functions', async () => {
    const client = await w.f.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(moduleFile('rollback/0001_drop_member_access.sql'));
      const left = (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('member_access_reader','member_saved_item','member_access_label','member_access_others','workspace_saved_missions','workspace_saved_mission','workspace_saved_mission_book','workspace_decision_cards','workspace_decision_card')",
        )
      ).rows[0].n;
      expect(left).toBe(0);
      expect(
        (
          await client.query(
            "SELECT to_regprocedure('customer.saved_mission_book(uuid,text,uuid,boolean)') IS NOT NULL AS f",
          )
        ).rows[0].f,
      ).toBe(true);
      expect(
        (
          await client.query(
            "SELECT to_regclass('customer_private.member_notice_delivery') IS NOT NULL AS f",
          )
        ).rows[0].f,
      ).toBe(true);
    } finally {
      // Undone here, so the rest of the suite runs on the installed module.
      await client.query('ROLLBACK');
      client.release();
    }
  });
  test('the book projection is the same text as the member book, comments and spacing aside', () => {
    const strip = (sql: string) =>
      sql
        .replace(/^\s*--.*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    const books = readFileSync(
      resolve('packages/db/customer-book-migrations/0001_trip_and_supplier_books.sql'),
      'utf8',
    );
    const original = books.slice(
      books.indexOf(" IF kind='TRIP' THEN\n  projection"),
      books.indexOf(' digest:=encode'),
    );
    const ours = moduleFile('0001_member_access.sql');
    const copy = ours.slice(ours.indexOf('-- projection-begin'), ours.indexOf('-- projection-end'));
    expect(strip(copy)).toBe(strip(original));
    expect(strip(copy).length).toBeGreaterThan(1500);
  });
  test('the migrator reads only the top-level files, so the rollback text is never applied', () => {
    expect(readdirSync(resolve('packages/db/member-access-migrations/rollback'))).toEqual([
      '0001_drop_member_access.sql',
    ]);
  });
});

describe('10. the 24-hour gate, per workspace', () => {
  test('no delivery record: never open, even for the owner', async () => {
    expect(await refusal(list('alice', W))).toBe('42501 MEMBER_ACCESS_NOT_OPEN');
    expect(await refusal(cards('alice', W))).toBe('42501 MEMBER_ACCESS_NOT_OPEN');
  });
  test('another workspace delivered and open has no effect on this one', async () => {
    await deliver(W2, 30);
    expect((await list('dave', W2)).missions).toEqual([]);
    expect(await refusal(list('alice', W))).toBe('42501 MEMBER_ACCESS_NOT_OPEN');
    expect(await refusal(open('alice', W, items.bob.resourceId))).toBe(
      '42501 MEMBER_ACCESS_NOT_OPEN',
    );
  });
  test('delivered 23 hours ago: still refused; past opens_at: allowed', async () => {
    await deliver(W, 23);
    expect(await refusal(list('alice', W))).toBe('42501 MEMBER_ACCESS_NOT_OPEN');
    expect(await refusal(book('alice', W, items.bob.resourceId))).toBe(
      '42501 MEMBER_ACCESS_NOT_OPEN',
    );
    expect(await refusal(card('alice', W, items.bobCard))).toBe('42501 MEMBER_ACCESS_NOT_OPEN');
    await mutate(
      w.f.owner,
      'customer_private.member_notice_delivery',
      "UPDATE customer_private.member_notice_delivery SET delivered_at=delivered_at-interval '2 hours',opens_at=opens_at-interval '2 hours' WHERE workspace_id=$1",
      [W],
    );
    expect((await list('alice', W)).missions.length).toBeGreaterThan(0);
  });
});

describe('1. owners and admins read members items, including older ones', () => {
  test('the owner lists the saved reports of bob and carol, saved before the module existed, and not her own', async () => {
    const page = await list('alice', W);
    const ids = page.missions.map((m: { id: string }) => m.id).sort();
    expect(ids).toEqual(
      [items.bob.resourceId, items.bobSecond.resourceId, items.carol.resourceId].sort(),
    );
    // Bob also holds alice's report by its link; it arrived for alice's request, so it is not his item in this workspace.
    expect(ids).not.toContain(w.memberResource);
    const bob = page.missions.find((m: { id: string }) => m.id === items.bob.resourceId);
    expect(bob).toMatchObject({
      available: true,
      title: 'Approved synthetic commercial decision context',
      memberLabel: 'Synthetic invited bob',
    });
    expect(page.nextAfter).toBeNull();
    const created = (
      await w.f.owner.query(
        'SELECT min(created_at) AS t FROM customer_private.saved_mission WHERE id=ANY($1)',
        [ids],
      )
    ).rows[0].t;
    const installed = (
      await w.f.owner.query('SELECT min(applied_at) AS t FROM member_access_migrations.applied')
    ).rows[0].t;
    expect(created.getTime()).toBeLessThan(installed.getTime());
  });
  test('pages of one, by id, end without a phantom page', async () => {
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await list('alice', W, after, 1);
      seen.push(...page.missions.map((m: { id: string }) => m.id));
      after = page.nextAfter;
      if (!after) break;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
  test('the owner opens a member report: the same document the member reads', async () => {
    const theirs = await as('bob', 'SELECT customer.saved_mission_action($1) AS result', [
      items.bob.resourceId,
    ]);
    const ours = await open('alice', W, items.bob.resourceId);
    expect({ ...ours.report, generatedAt: null }).toEqual({ ...theirs.report, generatedAt: null });
    expect(ours.memberLabel).toBe('Synthetic invited bob');
  });
  test('an admin reads the owner report and another member report', async () => {
    expect((await open('bob', W, items.alice.resourceId)).resourceId).toBe(items.alice.resourceId);
    expect((await open('bob', W, items.carol.resourceId)).resourceId).toBe(items.carol.resourceId);
  });
  test('the owner downloads a member book: the existing record with the reader as principal and the existing event', async () => {
    const command = randomUUID();
    const mine = await as('bob', 'SELECT customer.saved_mission_book($1,$2,$3,true) AS result', [
      items.bob.resourceId,
      'SUPPLIER',
      randomUUID(),
    ]);
    const result = await book('alice', W, items.bob.resourceId, 'SUPPLIER', command);
    expect(result).toMatchObject({
      resourceId: items.bob.resourceId,
      kind: 'SUPPLIER',
      replayed: false,
      digest: mine.digest,
    });
    expect(result.projection).toEqual(mine.projection);
    const record = (
      await w.f.owner.query(
        'SELECT principal_id,resource_id,input FROM customer_private.saved_mission_command WHERE command_id=$1',
        [command],
      )
    ).rows;
    expect(record).toHaveLength(1);
    expect(record[0].principal_id).toBe(principals.alice);
    expect(record[0].input).toMatchObject({
      action: 'book',
      kind: 'SUPPLIER',
      resourceId: items.bob.resourceId,
      workspaceId: W,
    });
    const generated = (
      await w.f.owner.query(
        "SELECT count(*)::int AS n FROM app.domain_event WHERE type='delivery.book.generated' AND causation_id=$1",
        [command],
      )
    ).rows[0].n;
    expect(generated).toBe(1);
    const again = await book('alice', W, items.bob.resourceId, 'SUPPLIER', command);
    expect(again).toMatchObject({
      replayed: true,
      digest: result.digest,
      generatedAt: result.generatedAt,
    });
    expect(await refusal(book('alice', W, items.carol.resourceId, 'SUPPLIER', command))).toBe(
      '23514 Book command conflicts',
    );
  });
  test('the owner lists and opens a member decision card; the open counter is not touched', async () => {
    const page = await cards('alice', W);
    const ids = page.cards.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual([items.bobCard, items.bobSecondCard].sort());
    expect(page.cards.find((c: { id: string }) => c.id === items.bobCard)).toMatchObject({
      state: 'ACTIVE',
      memberLabel: 'Synthetic invited bob',
    });
    const read = await card('alice', W, items.bobCard);
    expect(Object.keys(read.fields).sort()).toEqual([
      'company',
      'decision',
      'dueAt',
      'nextAction',
      'provenance',
      'rationale',
    ]);
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.decision_card_open WHERE card_id=$1',
          [items.bobCard],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});

describe('the application service behind CORRIDRA_MEMBER_ACCESS', () => {
  const on = { CORRIDRA_MEMBER_ACCESS: 'true' } as NodeJS.ProcessEnv;
  const off = {} as NodeJS.ProcessEnv;
  const service = (who: string) =>
    new CustomerMemberAccessService(w.f.runtime, w.f.auth, cardOptions, async () =>
      cardSession(who),
    );
  const status = async (work: Promise<unknown>) => {
    try {
      await work;
      return 'allowed';
    } catch (error) {
      const e = error as { status?: number; code?: string };
      return `${e.status} ${e.code ?? ''}`.trim();
    }
  };
  test('the switch is its own, off unless exactly true, and listed for the owner', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_MEMBER_ACCESS');
    expect(switchRegistry.find((entry) => entry.name === 'CORRIDRA_MEMBER_ACCESS')).toMatchObject({
      kind: 'flag',
    });
  });
  test('off: every method is not found, before any database read and without an event', async () => {
    const before = (await events()).length;
    for (const work of [
      () => service('alice').workspaces(undefined, undefined, off),
      () => service('alice').savedReports(W, null, undefined, undefined, off),
      () => service('alice').report(W, items.bob.resourceId, undefined, undefined, off),
      () => service('alice').decisionCards(W, null, undefined, undefined, off),
      () => service('alice').decisionCard(W, items.bobCard, undefined, undefined, off),
      () =>
        service('alice').book(
          {
            workspaceId: W,
            resourceId: items.bob.resourceId,
            commandId: randomUUID(),
            kind: 'SUPPLIER',
            acknowledged: true,
          },
          async () => new Uint8Array(),
          undefined,
          undefined,
          off,
        ),
    ])
      expect(await status(work())).toBe('404');
    expect((await events()).length).toBe(before);
  });
  test('on: the owner sees her open workspace, a new workspace not yet open, and the not-open refusal by name', async () => {
    const W3 = (
      await workspaces('alice').provision({
        commandId: randomUUID(),
        name: 'Synthetic third workspace',
      })
    ).id as string;
    const listed = (await service('alice').workspaces(undefined, undefined, on))!.workspaces;
    expect(listed.find((x) => x.workspaceId === W)).toMatchObject({
      role: 'owner',
      open: true,
      cards: true,
    });
    expect(listed.find((x) => x.workspaceId === W3)).toMatchObject({
      role: 'owner',
      open: false,
      opensAt: null,
      // Alone in her new workspace: nobody else to read, so /account shows no Members' Reports tab for it.
      others: 0,
    });
    expect(listed.find((x) => x.workspaceId === W)!.others).toBeGreaterThan(0);
    // dave owns W2 alone (no one joined it): every workspace he owns or manages has nobody else, so he gets no tab.
    expect(
      (await service('dave').workspaces(undefined, undefined, on))!.workspaces.map((x) => [
        x.workspaceId,
        x.others,
      ]),
    ).toEqual([[W2, 0]]);
    // The count is for owners and admins only, reads no item and records nothing.
    const counted = (await events()).length;
    expect(
      await refusal(as('carol', 'SELECT customer.member_access_others($1) AS result', [W])),
    ).toBe('42501 Workspace owner or admin required');
    expect(
      await as('alice', 'SELECT customer.member_access_others($1) AS result', [W2]).catch(
        (e) => e.code,
      ),
    ).toBe('42501');
    expect((await events()).length).toBe(counted);
    expect(listed.map((x) => x.workspaceId)).not.toContain(W2);
    expect(await status(service('alice').savedReports(W3, null, undefined, undefined, on))).toBe(
      '403 NOT_OPEN',
    );
    // A plain member owns or manages nothing here, so sees no workspace at all.
    expect((await service('carol').workspaces(undefined, undefined, on))!.workspaces).toEqual([]);
    const page = (await service('alice').savedReports(W, null, undefined, undefined, on))!;
    expect(page.missions.map((m) => m.id)).toContain(items.bob.resourceId);
    const report = (await service('alice').report(
      W,
      items.bob.resourceId,
      undefined,
      undefined,
      on,
    ))!;
    expect(report).toMatchObject({
      workspaceId: W,
      workspaceName: 'Synthetic card service workspace',
      memberLabel: 'Synthetic invited bob',
    });
    const made = await service('alice').book(
      {
        workspaceId: W,
        resourceId: items.bob.resourceId,
        commandId: randomUUID(),
        kind: 'SUPPLIER',
        acknowledged: true,
      },
      async (record) => record.digest,
      undefined,
      undefined,
      on,
    );
    expect(made.file).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await status(service('carol').report(W, items.bob.resourceId, undefined, undefined, on)),
    ).toBe('undefined 42501');
  });
});

// A read that waited for the workspace lock while access changed must not record a read of what it may no longer see. Connection 2
// holds the workspace lock (as every membership, role and card change does) while it changes access; the read in connection 1
// waits on that lock, and once connection 2 commits it is refused and writes no event. Fails on the version before the recheck,
// where the waiting read went on to write its event.
describe('access changed while a read waited for the workspace lock', () => {
  async function raced(
    read: () => Promise<unknown>,
    change: (db: import('pg').PoolClient) => Promise<unknown>,
  ) {
    const held = await w.f.owner.connect();
    try {
      await held.query('BEGIN');
      await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `customer.access.workspace:${W}`,
      ]);
      const before = (await events()).length;
      const waiting = refusal(read());
      // The read is blocked on the lock held here: it does not finish on its own.
      expect(
        await Promise.race([waiting, new Promise((r) => setTimeout(() => r('waiting'), 500))]),
      ).toBe('waiting');
      await change(held);
      await held.query('COMMIT');
      const answer = await waiting;
      expect((await events()).length).toBe(before);
      return answer;
    } catch (error) {
      await held.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      held.release();
    }
  }
  const memberOf = async (who: string) =>
    (
      await w.f.owner.query(
        `SELECT w.id FROM customer_private.workspace_member w WHERE w.tenant_id=$1 AND w.principal_id=$2
          AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation r WHERE r.member_id=w.id)`,
        [W, principals[who]],
      )
    ).rows[0]?.id as string;
  // bob's role history, appended as the owner role, the way customer.workspace_member_command records it.
  const role = async (db: { query: CardWorld['f']['owner']['query'] }, next: string) => {
    const member = await memberOf('bob');
    await db.query(
      `INSERT INTO customer_private.workspace_member_role(tenant_id,member_id,version,role,changed_by)
       SELECT $1,$2,coalesce(max(r.version),0)+1,$3,$4 FROM customer_private.workspace_member_role r WHERE r.member_id=$2`,
      [W, member, next, principals.alice],
    );
  };
  test('a member removed meanwhile: list, open, book, card list and card open are refused, with no event', async () => {
    for (const read of [
      () => list('alice', W),
      () => open('alice', W, items.bob.resourceId),
      () => book('alice', W, items.bob.resourceId),
      () => cards('alice', W),
      () => card('alice', W, items.bobCard),
    ]) {
      const member = await memberOf('bob');
      expect(member).toBeTruthy();
      expect(
        await raced(read, (db) =>
          db.query(
            'INSERT INTO customer_private.workspace_access_revocation(tenant_id,member_id,actor_id) VALUES($1,$2,$3)',
            [W, member, principals.alice],
          ),
        ),
      ).toMatch(/^42501 /);
      // bob is invited again: the same read succeeds, so the refusal above came from the removal.
      // bob is invited again and made admin again (his cards resolve with a writer's authority): the same read succeeds, so the
      // refusal above came from the removal.
      await join('alice', 'bob', W);
      await role(w.f.owner, 'admin');
      expect(await refusal(read())).toBe('allowed');
    }
  });
  test('a reader who stopped being an admin meanwhile is refused, with no event', async () => {
    for (const read of [
      () => list('bob', W),
      () => open('bob', W, items.carol.resourceId),
      () => book('bob', W, items.carol.resourceId),
    ]) {
      // The gate, asked again after the wait, refuses as it refuses any reader who is not an owner or admin.
      expect(await raced(read, (db) => role(db as never, 'member'))).toBe(
        '42501 Workspace owner or admin required',
      );
      await role(w.f.owner, 'admin');
      expect(await refusal(read())).toBe('allowed');
    }
  });
});

describe('2 and 3. no cross-workspace reading, and members read nothing of each other', () => {
  test('the owner of another workspace is refused in this one, and finds nothing of it in her own', async () => {
    expect(await refusal(list('dave', W))).toBe('42501 Workspace owner or admin required');
    expect(await refusal(open('dave', W, items.bob.resourceId))).toBe(
      '42501 Workspace owner or admin required',
    );
    expect(await refusal(open('dave', W2, items.bob.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
    expect(await refusal(book('dave', W2, items.bob.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
    expect(await refusal(card('dave', W2, items.bobCard))).toBe('42501 Decision card unavailable');
    expect((await cards('dave', W2)).cards).toEqual([]);
    expect(await refusal(open('alice', W2, items.dave.resourceId))).toBe(
      '42501 Workspace owner or admin required',
    );
  });
  test('a plain member is refused on every path, and the existing reads still refuse them', async () => {
    for (const work of [
      () => list('carol', W),
      () => open('carol', W, items.bob.resourceId),
      () => book('carol', W, items.bob.resourceId),
      () => cards('carol', W),
      () => card('carol', W, items.bobCard),
    ])
      expect(await refusal(work())).toBe('42501 Workspace owner or admin required');
    expect(
      await refusal(
        as('carol', 'SELECT customer.saved_mission_action($1) AS result', [items.bob.resourceId]),
      ),
    ).toBe('42501 Saved mission unavailable');
  });
});

describe('4. owners and admins cannot remove a save or withdraw a card', () => {
  test('the creator-only functions still refuse the owner, unchanged', async () => {
    expect(
      await refusal(
        as('alice', 'SELECT customer.remove_saved_mission($1,$2) AS result', [
          randomUUID(),
          items.bob.resourceId,
        ]),
      ),
    ).toBe('42501 Saved mission unavailable');
    expect(
      await refusal(
        as('alice', 'SELECT customer.withdraw_decision_card($1,$2) AS result', [
          randomUUID(),
          items.bobCard,
        ]),
      ),
    ).toBe('42501 Decision card unavailable');
    const state = (
      await w.f.owner.query(
        `SELECT (SELECT removed_at FROM customer_private.saved_mission WHERE id=$1) AS removed,
          EXISTS(SELECT FROM customer_private.decision_card_withdrawal WHERE card_id=$2) AS withdrawn`,
        [items.bob.resourceId, items.bobCard],
      )
    ).rows[0];
    expect(state).toEqual({ removed: null, withdrawn: false });
  });
});

describe('6. one audit event per read or download, naming the reader and the item ids', () => {
  test('list, open, card list, card open and book each write exactly one event with the reader, ids only', async () => {
    const steps: [string, () => Promise<unknown>, string, Record<string, unknown>][] = [
      ['list', () => list('alice', W), 'customer.member_item.read', { view: 'saved_list' }],
      [
        'open',
        () => open('alice', W, items.bob.resourceId),
        'customer.member_item.read',
        { view: 'saved_report', resourceId: items.bob.resourceId },
      ],
      ['cards', () => cards('alice', W), 'customer.member_item.read', { view: 'card_list' }],
      [
        'card',
        () => card('alice', W, items.bobCard),
        'customer.member_item.read',
        { view: 'card', cardId: items.bobCard },
      ],
      [
        'book',
        () => book('alice', W, items.bob.resourceId),
        'customer.member_item.book',
        { resourceId: items.bob.resourceId, bookKind: 'SUPPLIER' },
      ],
    ];
    const service = (
      await w.f.owner.query(
        'SELECT executor_id FROM customer_private.configuration WHERE synthetic',
      )
    ).rows[0].executor_id;
    for (const [name, step, kind, payload] of steps) {
      const before = (await events()).length;
      await step();
      const after = await events();
      expect(after.length - before, name).toBe(1);
      const row = after[after.length - 1];
      expect(row.type, name).toBe(kind);
      expect(row.tenant_id, name).toBe(W);
      expect(row.payload, name).toMatchObject({
        ...payload,
        initiator_kind: 'customer',
        initiator_id: principals.alice,
      });
      expect(row.audit_actor, name).toBe(service);
      expect(row.action, name).toBe(kind);
      // Ids only: no title, report, field or label leaves through the event.
      const text = JSON.stringify(row.payload);
      expect(text, name).not.toMatch(
        /Approved synthetic|Synthetic invited|NEED_INFORMATION|rationale|company/,
      );
    }
  });
  test('a list with nothing in it and a refused read write no event', async () => {
    const before = (await events()).length;
    await cards('dave', W2);
    await refusal(open('dave', W2, items.bob.resourceId));
    await refusal(list('carol', W));
    expect((await events()).length).toBe(before);
  });
});

describe('7. an expired or revoked link ends the report for everyone', () => {
  test('staff revoke the link of a member report: the member and the owner both lose it, the list says not available', async () => {
    await w.delivery.revoke(w.f.users.owner.ctx, {
      commandId: randomUUID(),
      linkId: items.carol.link.id,
      publicationId: null,
      reason: 'Synthetic revocation for the member access test',
    });
    expect(
      await refusal(
        as('carol', 'SELECT customer.saved_mission_action($1) AS result', [items.carol.resourceId]),
      ),
    ).toMatch(/^42501 /);
    expect(await refusal(open('alice', W, items.carol.resourceId))).toMatch(/^42501 /);
    expect(await refusal(book('alice', W, items.carol.resourceId))).toMatch(/^42501 /);
    const row = (await list('alice', W)).missions.find(
      (m: { id: string }) => m.id === items.carol.resourceId,
    );
    expect(row).toMatchObject({ available: false, title: null, expiresAt: null });
  });
  test('an expired card is listed as expired and cannot be opened', async () => {
    await mutate(
      w.f.owner,
      'customer_private.decision_card',
      "UPDATE customer_private.decision_card SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
      [items.bobSecondCard],
    );
    expect(
      (await cards('alice', W)).cards.find((c: { id: string }) => c.id === items.bobSecondCard),
    ).toMatchObject({
      state: 'EXPIRED',
      company: null,
      decision: null,
    });
    expect(await refusal(card('alice', W, items.bobSecondCard))).toBe(
      '42501 Decision card unavailable',
    );
  });
});

describe('8. a removed save and a withdrawn card are unreadable to owners and admins', () => {
  test('bob withdraws his card: gone from the list, refused on open', async () => {
    await as('bob', 'SELECT customer.withdraw_decision_card($1,$2) AS result', [
      randomUUID(),
      items.bobCard,
    ]);
    expect((await cards('alice', W)).cards.map((c: { id: string }) => c.id)).not.toContain(
      items.bobCard,
    );
    expect(await refusal(card('alice', W, items.bobCard))).toBe('42501 Decision card unavailable');
  });
  test('bob removes a save: gone from the list, refused on open and book, and its cards are gone too', async () => {
    await as('bob', 'SELECT customer.remove_saved_mission($1,$2) AS result', [
      randomUUID(),
      items.bobSecond.resourceId,
    ]);
    expect((await list('alice', W)).missions.map((m: { id: string }) => m.id)).not.toContain(
      items.bobSecond.resourceId,
    );
    expect(await refusal(open('alice', W, items.bobSecond.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
    expect(await refusal(book('alice', W, items.bobSecond.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
    expect((await cards('alice', W)).cards.map((c: { id: string }) => c.id)).not.toContain(
      items.bobSecondCard,
    );
  });
});

describe('book limit', () => {
  test('30 books an hour per reader and report, as for the member', async () => {
    const recent = (
      await w.f.owner.query(
        "SELECT count(*)::int AS n FROM customer_private.saved_mission_command WHERE principal_id=$1 AND resource_id=$2 AND input->>'action'='book' AND created_at>clock_timestamp()-interval '1 hour'",
        [principals.alice, items.bob.resourceId],
      )
    ).rows[0].n;
    for (let i = recent; i < 30; i++) await book('alice', W, items.bob.resourceId);
    expect(await refusal(book('alice', W, items.bob.resourceId))).toBe(
      '54000 Too many books for this mission just now',
    );
    // Another reader keeps their own allowance, and the member keeps theirs.
    expect((await book('bob', W, items.alice.resourceId)).replayed).toBe(false);
    expect(
      (
        await as('bob', 'SELECT customer.saved_mission_book($1,$2,$3,true) AS result', [
          items.bob.resourceId,
          'SUPPLIER',
          randomUUID(),
        ])
      ).replayed,
    ).toBe(false);
  });
});

describe('5. a removed member is read by nobody', () => {
  test('carol is removed: her items leave every list and open, and she reads nothing herself', async () => {
    const fresh = await w.build('erin' as never, W);
    expect((await list('alice', W)).missions.map((m: { id: string }) => m.id)).toContain(
      fresh.resourceId,
    );
    await workspaces('alice').access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId: W,
      kind: 'membership',
      targetId: memberIds.erin!,
    });
    expect((await list('alice', W)).missions.map((m: { id: string }) => m.id)).not.toContain(
      fresh.resourceId,
    );
    expect(await refusal(open('alice', W, fresh.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
    expect(await refusal(book('alice', W, fresh.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
    expect(await refusal(open('bob', W, fresh.resourceId))).toBe('42501 Saved mission unavailable');
    expect(await refusal(list('erin', W))).toBe('42501 Workspace owner or admin required');
  });
  test('an admin who leaves stops reading at once', async () => {
    await roles('bob').command({ action: 'leave', commandId: randomUUID(), workspaceId: W });
    expect(await refusal(list('bob', W))).toBe('42501 Workspace owner or admin required');
    expect((await list('alice', W)).missions.map((m: { id: string }) => m.id)).not.toContain(
      items.bob.resourceId,
    );
    expect(await refusal(open('alice', W, items.bob.resourceId))).toBe(
      '42501 Saved mission unavailable',
    );
  });
});

describe('rollback', () => {
  test('refuses once reads exist, and deletes nothing', async () => {
    const before = (await events()).length;
    await expect(
      w.f.owner.query(moduleFile('rollback/0001_drop_member_access.sql')),
    ).rejects.toThrow('Member access rollback refused');
    expect((await events()).length).toBe(before);
    expect(
      (
        await w.f.owner.query(
          "SELECT to_regprocedure('customer.workspace_saved_missions(uuid,uuid,integer)') IS NOT NULL AS f",
        )
      ).rows[0].f,
    ).toBe(true);
  });
});
