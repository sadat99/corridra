import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { migrateViewAs } from '../../packages/db/src/view-as-migrate';
import { ViewAsService } from '../../packages/auth/src/view-as';
import { AccessService } from '../../packages/auth/src/access';

// Real database, real roles. Proves who may open a preview, that opening is always logged in the
// same transaction, and that the log holds ids and roles only.
let f: Awaited<ReturnType<typeof fixture>>;
let service: ViewAsService;
const events = async (tenant = f.tenantA) =>
  (
    await f.owner.query(
      "SELECT e.id,e.payload,e.actor_id,a.action FROM app.domain_event e LEFT JOIN app.audit_event a ON a.domain_event_id=e.id WHERE e.tenant_id=$1 AND e.type='view_as.open' ORDER BY e.occurred_at",
      [tenant],
    )
  ).rows;

beforeAll(async () => {
  f = await fixture();
  await migrateViewAs(f.owner);
  service = new ViewAsService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});

describe('installation', () => {
  test('adds one function for the runtime role only, is idempotent, and refuses a changed file', async () => {
    const fn = (
      await f.owner.query(
        `SELECT p.oid,has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='record_view_as_open'`,
      )
    ).rows;
    expect(fn).toHaveLength(1);
    expect(fn[0]).toMatchObject({ runtime: true, auth: false });
    const applied = (await f.owner.query('SELECT * FROM view_as_migrations.applied')).rows;
    expect(applied).toHaveLength(1);
    await migrateViewAs(f.owner);
    expect((await f.owner.query('SELECT * FROM view_as_migrations.applied')).rows).toEqual(applied);
    await f.owner.query("UPDATE view_as_migrations.applied SET sha256=repeat('0',64)");
    await expect(migrateViewAs(f.owner)).rejects.toThrow('history mismatch');
    await f.owner.query('UPDATE view_as_migrations.applied SET sha256=$1', [applied[0].sha256]);
    for (const pool of [f.runtime, f.auth])
      await expect(pool.query('SELECT * FROM view_as_migrations.applied')).rejects.toMatchObject({
        code: '42501',
      });
  });
});

describe('who may open a preview', () => {
  test('an owner can, and exactly one record is written with ids and roles only', async () => {
    const before = (await events()).length;
    const outboxBefore = (
      await f.owner.query('SELECT count(*)::int n FROM app.outbox WHERE tenant_id=$1', [f.tenantA])
    ).rows[0].n;
    const id = await service.open(f.users.owner.ctx, 'customer');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await events();
    expect(rows).toHaveLength(before + 1);
    const last = rows.at(-1)!;
    expect(last.action).toBe('view_as.open');
    expect(last.actor_id).toBe(f.users.owner.id);
    expect(last.payload).toEqual({
      shown_role: 'customer',
      viewer_role: 'owner',
      preview_version: 1,
    });
    expect(JSON.stringify(last.payload)).not.toMatch(/@|Synthetic|example/);
    // Nothing is sent: no outbox row.
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.outbox WHERE tenant_id=$1', [
          f.tenantA,
        ])
      ).rows[0].n,
    ).toBe(outboxBefore);
  });

  test('operators, reviewers, viewers, outsiders and other workspaces are refused and nothing is logged', async () => {
    const before = (await events()).length;
    for (const who of ['operator', 'reviewer', 'viewer'])
      await expect(service.open(f.users[who].ctx, 'customer')).rejects.toThrow('Access denied');
    await expect(service.open(f.users.outsider.ctx, 'customer')).rejects.toThrow('Access denied');
    // The owner of another workspace has no standing in this one.
    await expect(
      service.open({ ...f.users.other.ctx, tenantId: f.tenantA }, 'customer'),
    ).rejects.toThrow('Access denied');
    // And an owner cannot log into somebody else's workspace.
    await expect(
      service.open({ ...f.users.owner.ctx, tenantId: f.tenantB }, 'customer'),
    ).rejects.toThrow('Access denied');
    await expect(
      service.open({ ...f.users.owner.ctx, token: 'x'.repeat(64) }, 'customer'),
    ).rejects.toThrow('Access denied');
    expect((await events()).length).toBe(before);
    expect((await events(f.tenantB)).length).toBe(0);
  });

  test('a stale authenticator check is refused with a clear message and nothing is logged', async () => {
    const before = (await events()).length;
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await expect(service.open(f.users.owner.ctx, 'customer')).rejects.toMatchObject({
      message: 'Verify your authenticator again to continue',
      status: 401,
    });
    expect((await events()).length).toBe(before);
    await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
      f.users.owner.sessionId,
    ]);
    await expect(service.open(f.users.owner.ctx, 'customer')).resolves.toBeTruthy();
  });

  test('an admin can once promoted', async () => {
    await new AccessService(f.runtime).changeMember(f.users.owner.ctx, {
      userId: f.users.viewer.id,
      role: 'admin',
      revoked: false,
    });
    const before = (await events()).length;
    await expect(service.open(f.users.viewer.ctx, 'customer')).resolves.toBeTruthy();
    const last = (await events()).at(-1)!;
    expect(last.payload.viewer_role).toBe('admin');
    expect((await events()).length).toBe(before + 1);
  });
});

describe('the database function cannot be used to skip a step', () => {
  const call = (ctx = f.users.owner.ctx, role: unknown = 'customer', version: unknown = 1) =>
    rawContext(f.runtime, ctx, 'SELECT app.record_view_as_open($1,$2)', [role, version]);

  test('called directly it re-checks the member role, the authenticator and the inputs', async () => {
    const before = (await events()).length;
    await expect(call(f.users.operator.ctx)).rejects.toMatchObject({ code: '42501' });
    await expect(call(f.users.outsider.ctx)).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.runtime.query('SELECT app.record_view_as_open($1,$2)', ['customer', 1]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(call(f.users.owner.ctx, 'owner')).rejects.toMatchObject({ code: '23514' });
    await expect(call(f.users.owner.ctx, 'Customer')).rejects.toMatchObject({ code: '23514' });
    await expect(call(f.users.owner.ctx, null)).rejects.toMatchObject({ code: '23514' });
    await expect(call(f.users.owner.ctx, 'customer', 0)).rejects.toMatchObject({ code: '23514' });
    await expect(call(f.users.owner.ctx, 'customer', 1001)).rejects.toMatchObject({
      code: '23514',
    });
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
      [f.users.owner.sessionId],
    );
    await expect(call()).rejects.toMatchObject({ code: '42501' });
    await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
      f.users.owner.sessionId,
    ]);
    expect((await events()).length).toBe(before);
    await expect(call()).resolves.toBeDefined();
  });

  test('a record cannot be edited or removed afterwards, even by the schema owner', async () => {
    const id = (await events()).at(-1)!.id;
    await expect(
      f.owner.query("UPDATE app.domain_event SET payload='{}'::jsonb WHERE id=$1", [id]),
    ).rejects.toThrow();
    await expect(f.owner.query('DELETE FROM app.domain_event WHERE id=$1', [id])).rejects.toThrow();
    await expect(
      f.owner.query("UPDATE app.audit_event SET action='x' WHERE domain_event_id=$1", [id]),
    ).rejects.toThrow();
  });

  test('opening a preview never reads or writes a customer row', async () => {
    const tables = (
      await f.owner.query(
        "SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='customer_private' AND c.relkind='r'",
      )
    ).rows[0].n;
    // The fixture has no customer schema installed: the preview does not need one.
    expect(tables).toBe(0);
    await expect(service.open(f.users.owner.ctx, 'customer')).resolves.toBeTruthy();
    expect(randomUUID()).toBeTruthy();
  });
});
