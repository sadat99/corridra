import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { realStaffFixture } from './real-staff-fixture';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { InboxService } from '../../packages/communications/src/inbox';
import type { DatabasePool, RequestContext } from '../../packages/db/src/index';

// Unit D1b. The website sends every staff request with the purpose 'synthetic_validation'. In a real workspace the
// staff inbox must work under the workspace's own processing purpose, resolved the same way as the tenant
// transaction in packages/db and the contributor path in packages/network. Nothing here widens a purpose.
let s: Awaited<ReturnType<typeof realStaffFixture>>;
beforeEach(async () => {
  s = await realStaffFixture(
    'https://ep-staff-inbox-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    'staff-inbox-purpose-fixture-secret',
  );
  await migrateCommercialReadiness(s.f.owner);
});
afterEach(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

/** The same pool, with every purpose the service sets on a session written down. */
function watched(pool: DatabasePool) {
  const purposes: string[] = [];
  const resolutions: unknown[] = [];
  const watchedPool = {
    async connect() {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, key) {
          if (key !== 'query') {
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (sql: string, args?: unknown[]) => {
            if (typeof sql === 'string' && sql.includes("set_config('corridra.purpose'"))
              purposes.push(String(args?.[2]));
            if (typeof sql === 'string' && sql.includes('app.tenant_processing_purpose'))
              resolutions.push(args?.[0]);
            return target.query(sql, args);
          };
        },
      });
    },
  } as unknown as DatabasePool;
  return { pool: watchedPool, purposes, resolutions };
}
const website = (ctx: RequestContext, tenantId = ctx.tenantId): RequestContext => ({
  token: ctx.token,
  tenantId,
  purpose: 'synthetic_validation',
});
const invite = (recipientAccountId: string, tenantId: string) => ({
  recipientKind: 'staff',
  recipientAccountId,
  tenantId,
  type: 'TEAM_INVITE',
  payload: { name: 'Invited colleague', role: 'operator' },
});
const workspacePurpose = async (tenantId: string) =>
  (await s.f.owner.query('SELECT app.tenant_processing_purpose($1) AS purpose', [tenantId])).rows[0]
    .purpose as string;

test('a staff inbox in a real workspace records, lists and marks under the workspace purpose', async () => {
  const { f, intakeTenantId } = s;
  expect(await workspacePurpose(intakeTenantId)).toBe('commercial_qualification');
  const w = watched(f.runtime);
  const inbox = new InboxService(w.pool);
  const who = { kind: 'staff' as const, ctx: website(f.users.owner.ctx, intakeTenantId) };
  const id = await inbox.record(who, invite(f.users.owner.id, intakeTenantId));
  expect(
    (
      await f.owner.query(
        'SELECT tenant_id,recipient_kind,recipient_account_id,type FROM app.inbox_notification WHERE id=$1',
        [id],
      )
    ).rows,
  ).toEqual([
    {
      tenant_id: intakeTenantId,
      recipient_kind: 'staff',
      recipient_account_id: f.users.owner.id,
      type: 'TEAM_INVITE',
    },
  ]);
  expect((await inbox.list(who)).filter((item) => item.id === id)).toMatchObject([
    { type: 'TEAM_INVITE', readAt: null },
  ]);
  expect(await inbox.markRead(who, id)).toBe(true);
  expect(await inbox.markRead(who, id)).toBe(false);
  // Every session of the staff path ran under the purpose the workspace itself resolves to, never the one sent.
  expect(w.purposes).toEqual(Array(4).fill(await workspacePurpose(intakeTenantId)));
  expect(w.resolutions).toEqual(Array(4).fill(intakeTenantId));
});

test('a sample workspace keeps its own purpose, and a purpose that is already real is left alone', async () => {
  const { f, intakeTenantId, ctx } = s;
  expect(await workspacePurpose(f.tenantA)).toBe('synthetic_validation');
  const w = watched(f.runtime);
  const inbox = new InboxService(w.pool);
  const sample = { kind: 'staff' as const, ctx: website(f.users.owner.ctx, f.tenantA) };
  const id = await inbox.record(sample, invite(f.users.operator.id, f.tenantA));
  expect(
    (await inbox.list({ kind: 'staff', ctx: f.users.operator.ctx })).some((item) => item.id === id),
  ).toBe(true);
  expect(w.purposes).toEqual(['synthetic_validation', 'synthetic_validation']);
  // The fixture's staff context already names the real purpose: nothing is looked up and nothing is replaced.
  const before = w.resolutions.length;
  await inbox.record({ kind: 'staff', ctx }, invite(f.users.owner.id, intakeTenantId));
  expect(w.purposes.at(-1)).toBe('commercial_qualification');
  expect(w.resolutions).toHaveLength(before);
});

test('a member of another workspace, and a person with no workspace, cannot record into the real workspace', async () => {
  const { f, intakeTenantId } = s;
  const inbox = new InboxService(f.runtime);
  for (const person of [f.users.other, f.users.outsider])
    await expect(
      inbox.record(
        { kind: 'staff', ctx: website(person.ctx, intakeTenantId) },
        invite(f.users.owner.id, intakeTenantId),
      ),
    ).rejects.toMatchObject({ code: '42501', message: 'Workspace access denied' });
  // The real workspace's member cannot use its real purpose to write into a workspace it does not belong to.
  await expect(
    inbox.record(
      { kind: 'staff', ctx: website(f.users.owner.ctx, intakeTenantId) },
      invite(f.users.other.id, f.tenantB),
    ),
  ).rejects.toMatchObject({ code: '42501', message: 'Workspace access denied' });
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int AS n FROM app.inbox_notification WHERE type='TEAM_INVITE'",
      )
    ).rows[0].n,
  ).toBe(0);
});

test('with real use switched off the purpose sent is used as it is, so the real workspace still refuses', async () => {
  const { f, intakeTenantId } = s;
  vi.stubEnv('CORRIDRA_REAL_USE_ENABLED', 'false');
  const w = watched(f.runtime);
  const inbox = new InboxService(w.pool);
  await expect(
    inbox.record(
      { kind: 'staff', ctx: website(f.users.owner.ctx, intakeTenantId) },
      invite(f.users.owner.id, intakeTenantId),
    ),
  ).rejects.toMatchObject({ code: '42501', message: 'Workspace access denied' });
  expect(w.purposes).toEqual(['synthetic_validation']);
  expect(w.resolutions).toEqual([]);
});

test('an account-wide inbox with no workspace selected still reads and marks, with no purpose looked up', async () => {
  const { f, intakeTenantId } = s;
  const id = await new InboxService(f.runtime).record(
    { kind: 'staff', ctx: website(f.users.owner.ctx, intakeTenantId) },
    invite(f.users.owner.id, intakeTenantId),
  );
  const w = watched(f.runtime);
  const inbox = new InboxService(w.pool);
  const who = { kind: 'staff' as const, ctx: website(f.users.owner.ctx, '') };
  expect((await inbox.list(who)).some((item) => item.id === id)).toBe(true);
  expect(await inbox.markRead(who, id)).toBe(true);
  expect(w.purposes).toEqual(['synthetic_validation', 'synthetic_validation']);
  expect(w.resolutions).toEqual([]);
});
