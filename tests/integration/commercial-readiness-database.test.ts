import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixture, rawContext } from './support';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';

// Real database, real roles. Proves the commercial readiness module is additive, idempotent and
// refuses a changed file, and that an inbox item is readable and markable by its recipient only.
let f: Awaited<ReturnType<typeof fixture>>;

beforeAll(async () => {
  f = await fixture();
  await migrateCommercialReadiness(f.owner);
});
afterAll(async () => {
  await f?.close();
});

describe('installation', () => {
  test('is idempotent, refuses a changed file and hides its registry from runtime roles', async () => {
    const applied = (await f.owner.query('SELECT * FROM commercial_readiness_migrations.applied'))
      .rows;
    expect(applied.map((row) => row.name)).toEqual([
      '0001_inbox_and_links.sql',
      '0002_request_received.sql',
      '0003_quote_accepted.sql',
      '0004_quote_accepted_processing_purpose.sql',
      '0005_report_published.sql',
      '0006_team_control_owner_audit.sql',
      '0007_task_assigned_notification.sql',
      '0008_quote_sent_notification.sql',
      '0009_reply_posted_notification.sql',
      '0010_team_invitation_cancel_audit.sql',
      '0011_removed_member_request_received.sql',
      '0012_removed_member_inbox.sql',
    ]);
    await migrateCommercialReadiness(f.owner);
    expect(
      (await f.owner.query('SELECT * FROM commercial_readiness_migrations.applied')).rows,
    ).toEqual(applied);
    await f.owner.query(
      "UPDATE commercial_readiness_migrations.applied SET sha256=repeat('0',64) WHERE name=$1",
      [applied[0].name],
    );
    await expect(migrateCommercialReadiness(f.owner)).rejects.toThrow('history mismatch');
    await f.owner.query(
      'UPDATE commercial_readiness_migrations.applied SET sha256=$1 WHERE name=$2',
      [applied[0].sha256, applied[0].name],
    );
    for (const pool of [f.runtime, f.auth])
      await expect(
        pool.query('SELECT * FROM commercial_readiness_migrations.applied'),
      ).rejects.toMatchObject({ code: '42501' });
  });

  test('adds only nullable columns to sources, claims and participant invitations', async () => {
    const columns = (
      await f.owner.query(
        `SELECT table_schema||'.'||table_name||'.'||column_name AS c,is_nullable FROM information_schema.columns
         WHERE (table_schema,table_name,column_name) IN (('app','source_record','mission_id'),('app','source_record','organisation_id'),
         ('app','claim','mission_id'),('app','claim','organisation_id'),('customer_private','programme_invitation','recipient_email'))`,
      )
    ).rows;
    expect(columns).toHaveLength(5);
    for (const column of columns) expect(column.is_nullable).toBe('YES');
  });

  test('the write function is for the runtime role only', async () => {
    const fn = (
      await f.owner.query(
        `SELECT has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='inbox_record'`,
      )
    ).rows;
    expect(fn).toEqual([{ runtime: true, auth: false }]);
  });
});

describe('inbox privacy', () => {
  test('only the recipient reads and marks an item; other people and roles see nothing', async () => {
    const { owner, operator, other, outsider } = f.users;
    const created = (
      await rawContext(
        f.runtime,
        owner.ctx,
        "SELECT app.inbox_record('staff',$1,$2,'TASK_ASSIGNED','{\"title\":\"Check the supplier list\"}'::jsonb) id",
        [operator.id, f.tenantA],
      )
    ).rows[0].id as string;
    expect(created).toMatch(/^[0-9a-f-]{36}$/);
    const read = (user: typeof owner) =>
      rawContext(f.runtime, user.ctx, 'SELECT id,type,read_at FROM app.inbox_notification');
    expect((await read(operator)).rows).toEqual([
      { id: created, type: 'TASK_ASSIGNED', read_at: null },
    ]);
    for (const user of [owner, other, outsider]) expect((await read(user)).rows).toEqual([]);
    const marked = await rawContext(
      f.runtime,
      owner.ctx,
      'UPDATE app.inbox_notification SET read_at=now() WHERE id=$1',
      [created],
    );
    expect(marked.rowCount).toBe(0);
    const own = await rawContext(
      f.runtime,
      operator.ctx,
      'UPDATE app.inbox_notification SET read_at=now() WHERE id=$1',
      [created],
    );
    expect(own.rowCount).toBe(1);
    await expect(
      rawContext(f.runtime, operator.ctx, "UPDATE app.inbox_notification SET type='QUOTE_SENT'"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      rawContext(
        f.runtime,
        operator.ctx,
        "INSERT INTO app.inbox_notification(recipient_kind,recipient_account_id,type) VALUES('staff',$1,'QUOTE_SENT')",
        [operator.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(f.auth.query('SELECT * FROM app.inbox_notification')).rejects.toMatchObject({
      code: '42501',
    });
  });

  test('a signed-out caller or a staff member outside the workspace cannot record an item', async () => {
    const { operator, other } = f.users;
    await expect(
      f.runtime.query("SELECT app.inbox_record('staff',$1,$2,'TASK_ASSIGNED','{}'::jsonb)", [
        operator.id,
        f.tenantA,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      rawContext(
        f.runtime,
        { ...other.ctx, tenantId: f.tenantA },
        "SELECT app.inbox_record('staff',$1,$2,'TASK_ASSIGNED','{}'::jsonb)",
        [operator.id, f.tenantA],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('an unknown type or an oversized payload is refused', async () => {
    const { owner, operator } = f.users;
    await expect(
      rawContext(
        f.runtime,
        owner.ctx,
        "SELECT app.inbox_record('staff',$1,$2,'SALE_CLOSED','{}'::jsonb)",
        [operator.id, f.tenantA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      rawContext(
        f.runtime,
        owner.ctx,
        "SELECT app.inbox_record('staff',$1,$2,'TASK_ASSIGNED',jsonb_build_object('text',repeat('x',9000)))",
        [operator.id, f.tenantA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  test('a contributor identity needs no staff membership or selected team workspace to read its own inbox', async () => {
    const { owner, outsider, operator } = f.users;
    const id = (
      await rawContext(
        f.runtime,
        owner.ctx,
        "SELECT app.inbox_record('staff',$1,$2,'CONTRIBUTOR_INVITE','{\"title\":\"Assigned work invitation\"}'::jsonb) id",
        [outsider.id, f.tenantA],
      )
    ).rows[0].id;
    const { InboxService } = await import('../../packages/communications/src/inbox');
    const inbox = new InboxService(f.runtime);
    expect(
      (await inbox.list({ kind: 'staff', ctx: { ...outsider.ctx, tenantId: '' } })).filter(
        (item) => item.id === id,
      ),
    ).toMatchObject([{ type: 'CONTRIBUTOR_INVITE' }]);
    expect(
      await inbox.markRead({ kind: 'staff', ctx: { ...operator.ctx, tenantId: '' } }, id),
    ).toBe(false);
    expect(
      await inbox.markRead({ kind: 'staff', ctx: { ...outsider.ctx, tenantId: '' } }, id),
    ).toBe(true);
  });
});
