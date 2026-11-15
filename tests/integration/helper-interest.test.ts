import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { realStaffFixture } from './real-staff-fixture';
import { rawContext } from './support';
import { migrateHelperInterest } from '../../packages/db/src/helper-interest-migrate';
import {
  HelperInterestService,
  helperInterestEnabled,
} from '../../packages/auth/src/helper-interest';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { DomainError } from '../../packages/domain/src/index';
import { pageAfterDelete } from '../../apps/web/lib/helper-interest-client';

// ADR-0085, the helper interest register, on a real PostgreSQL database in real data mode (the register is anchored to
// the real intake workspace). Each test below fails on a build without the module.
const issuer =
  'https://ep-helper-interest-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let service: HelperInterestService;
let anchor: string;
let executor: string;
const form = (over: Record<string, unknown> = {}) => ({
  name: 'Amina Rahman',
  email: 'Amina.Rahman@Example.test',
  country: 'bd',
  reason: 'I live in Chattogram and know the leather market well.',
  website: '',
  ...over,
});
const rows = async () =>
  (await s.f.owner.query('SELECT * FROM app.helper_interest ORDER BY created_at')).rows;
const events = async (type: string) =>
  (
    await s.f.owner.query(
      "SELECT * FROM app.domain_event WHERE aggregate_type='helper_interest' AND type=$1 ORDER BY occurred_at",
      [type],
    )
  ).rows;
// The table is never edited by the application. A test moves a row back in time as the table owner, with the guard lifted for the update.
async function ageRows(where: string, args: unknown[], days: number) {
  await s.f.owner.query('ALTER TABLE app.helper_interest DISABLE TRIGGER helper_interest_no_edit');
  try {
    await s.f.owner.query(
      `UPDATE app.helper_interest SET created_at=now()-make_interval(days=>${Math.trunc(days)}) WHERE ${where}`,
      args,
    );
  } finally {
    await s.f.owner.query('ALTER TABLE app.helper_interest ENABLE TRIGGER helper_interest_no_edit');
  }
}
const staff = (who: 'owner' | 'operator' | 'reviewer' | 'viewer' | 'other' | 'outsider') => ({
  ...s.f.users[who]!.ctx,
  tenantId: anchor,
  purpose: 'commercial_qualification',
});

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'helper-interest-secret');
  await migrateHelperInterest(s.f.owner);
  service = new HelperInterestService(s.f.runtime, 'helper-interest-secret');
  const config = (
    await s.f.owner.query(
      'SELECT intake_tenant_id,executor_id FROM customer_private.real_use_configuration',
    )
  ).rows[0];
  anchor = config.intake_tenant_id;
  executor = config.executor_id;
  // Staff of the anchor workspace: the fixture owner is an owner there; an operator and a reviewer and a viewer join it.
  for (const who of ['operator', 'reviewer', 'viewer'] as const)
    await s.f.owner.query(
      "INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications) VALUES($1,$2,$3,ARRAY['commercial_qualification'],ARRAY['PUBLIC','INTERNAL']) ON CONFLICT DO NOTHING",
      [anchor, s.f.users[who]!.id, who],
    );
}, 120000);
afterAll(async () => {
  await s?.f.close();
});

describe('the register', () => {
  test('one submission gives one row and one create event, with no personal words in the event', async () => {
    expect(
      await service.offered({ CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'true' }),
    ).toBe(true);
    await expect(service.submit(form())).resolves.toEqual({ received: true });
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      tenant_id: anchor,
      name: 'Amina Rahman',
      email: 'amina.rahman@example.test',
      country: 'BD',
    });
    const created = await events('helper_interest.created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      tenant_id: anchor,
      actor_id: executor,
      aggregate_id: stored[0].id,
      aggregate_version: 1,
    });
    expect(created[0].payload).toEqual({ id: stored[0].id, initiator_kind: 'visitor' });
    expect(JSON.stringify(created[0])).not.toMatch(/Amina|example\.test|Chattogram/i);
  });

  test('a repeat gives the identical answer, no second row and no second event, whatever the case or spacing', async () => {
    const first = await service.submit(
      form({ name: 'Someone Else', reason: 'A different reason entirely, longer.' }),
    );
    const repeat = await service.submit(form({ email: '  AMINA.RAHMAN@example.test ' }));
    expect(repeat).toEqual(first);
    expect(await rows()).toHaveLength(1);
    expect(await events('helper_interest.created')).toHaveLength(1);
  });

  test('a visitor creates no account, session or membership and nothing is sent', async () => {
    const before = (
      await s.f.owner.query(
        'SELECT (SELECT count(*) FROM identity.principal) p,(SELECT count(*) FROM identity.session) s,(SELECT count(*) FROM app.membership) m',
      )
    ).rows[0];
    await service.submit(form({ email: 'second.person@example.test', name: 'Second Person' }));
    const after = (
      await s.f.owner.query(
        'SELECT (SELECT count(*) FROM identity.principal) p,(SELECT count(*) FROM identity.session) s,(SELECT count(*) FROM app.membership) m',
      )
    ).rows[0];
    expect(after).toEqual(before);
  });

  test('a filled hidden field stores nothing and answers the same', async () => {
    const before = (await rows()).length;
    const eventsBefore = (await events('helper_interest.created')).length;
    await expect(
      service.submit(form({ email: 'bot@example.test', website: 'https://spam.test' })),
    ).resolves.toEqual({ received: true });
    expect(await rows()).toHaveLength(before);
    expect(await events('helper_interest.created')).toHaveLength(eventsBefore);
  });

  test('bad input is refused and nothing is stored', async () => {
    const before = (await rows()).length;
    for (const bad of [
      { email: 'not-an-email' },
      { name: 'A' },
      { country: 'ZZ' },
      { reason: 'too short' },
      { reason: 'x'.repeat(501) },
      { name: 'Bad\u0000Name' },
      { extra: 'field' },
    ])
      await expect(service.submit(form({ email: 'bad@example.test', ...bad }))).rejects.toThrow();
    expect(await rows()).toHaveLength(before);
  });

  test('the reason stays plain text, stored exactly as written', async () => {
    const reason = '<script>alert(1)</script> I want to help in Dhaka.';
    await service.submit(form({ email: 'markup@example.test', name: 'Markup Person', reason }));
    const stored = (await rows()).find((row) => row.email === 'markup@example.test');
    expect(stored.reason).toBe(reason);
  });
});

describe('who can read and delete', () => {
  test('only an owner or admin of the anchor workspace reads the list', async () => {
    const list = await service.list(staff('owner'), {});
    expect(list.installed).toBe(true);
    expect(list.total).toBe((await rows()).length);
    expect(Object.keys(list.rows[0]!).sort()).toEqual([
      'country',
      'createdAt',
      'email',
      'id',
      'name',
      'reason',
    ]);
    for (const who of ['operator', 'reviewer', 'viewer', 'other', 'outsider'] as const)
      await expect(service.list(staff(who), {})).rejects.toThrow();
  });

  test('row level security denies a member, a helper, a signed out visitor and another workspace on the table itself', async () => {
    const visible = async (ctx: Parameters<typeof rawContext>[1]) =>
      (await rawContext(s.f.runtime, ctx, 'SELECT id FROM app.helper_interest')).rows.length;
    expect(await visible(staff('owner'))).toBeGreaterThan(0);
    for (const who of ['operator', 'reviewer', 'viewer'] as const)
      expect(await visible(staff(who))).toBe(0);
    // A helper is invited with no membership of the staff workspace (ADR-057); the outsider is exactly that.
    expect(await visible(staff('outsider'))).toBe(0);
    // An owner of another workspace, even naming the anchor workspace.
    expect(await visible(staff('other'))).toBe(0);
    expect(await visible({ ...staff('other'), tenantId: s.f.tenantB })).toBe(0);
    // Signed out: no session at all.
    expect(
      await visible({
        token: 'no-such-session',
        tenantId: anchor,
        purpose: 'commercial_qualification',
      }),
    ).toBe(0);
    // Nobody can write the table directly, owner of the workspace included.
    await expect(
      rawContext(s.f.runtime, staff('owner'), 'DELETE FROM app.helper_interest'),
    ).rejects.toThrow();
    await expect(
      rawContext(s.f.runtime, staff('owner'), "UPDATE app.helper_interest SET name='x'"),
    ).rejects.toThrow();
    await expect(
      rawContext(
        s.f.runtime,
        staff('owner'),
        "INSERT INTO app.helper_interest(tenant_id,name,email,country,reason) VALUES($1,'Zed Zed','z@example.test','BD','A reason that is long enough')",
        [anchor],
      ),
    ).rejects.toThrow();
  });

  test('deleting on request removes one entry and records one delete event; only an owner or admin may', async () => {
    const target = (await rows()).find((row) => row.email === 'second.person@example.test');
    for (const who of ['operator', 'reviewer', 'viewer', 'other', 'outsider'] as const)
      await expect(service.remove(staff(who), { id: target.id })).rejects.toThrow();
    expect(await rows()).toHaveLength((await rows()).length);
    await expect(service.remove(staff('owner'), { id: target.id })).resolves.toEqual({
      removed: true,
    });
    expect((await rows()).some((row) => row.id === target.id)).toBe(false);
    const deleted = await events('helper_interest.deleted');
    const mine = deleted.filter((event) => event.aggregate_id === target.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ aggregate_version: 2, actor_id: s.f.users.owner!.id });
    expect(mine[0].payload).toEqual({ id: target.id, reason: 'request', initiator_kind: 'staff' });
    await expect(service.remove(staff('owner'), { id: target.id })).resolves.toEqual({
      removed: false,
    });
    expect(
      (await events('helper_interest.deleted')).filter((e) => e.aggregate_id === target.id),
    ).toHaveLength(1);
  });
});

describe('retention', () => {
  test('a row past 180 days is invisible at once and is deleted, with one delete event, on the next submission', async () => {
    await service.submit(form({ email: 'old.entry@example.test', name: 'Old Entry' }));
    const old = (await rows()).find((row) => row.email === 'old.entry@example.test');
    await ageRows('id=$1', [old.id], 181);
    // Before any purge: the policy already hides it from the owner's table read.
    const seen = (
      await rawContext(s.f.runtime, staff('owner'), 'SELECT email FROM app.helper_interest')
    ).rows.map((row: { email: string }) => row.email);
    expect(seen).not.toContain('old.entry@example.test');
    expect((await rows()).some((row) => row.id === old.id)).toBe(true);
    await service.submit(form({ email: 'fresh.entry@example.test', name: 'Fresh Entry' }));
    expect((await rows()).some((row) => row.id === old.id)).toBe(false);
    const gone = (await events('helper_interest.deleted')).filter((e) => e.aggregate_id === old.id);
    expect(gone).toHaveLength(1);
    expect(gone[0].payload).toEqual({
      id: old.id,
      reason: 'retention',
      initiator_kind: 'retention',
    });
    expect(gone[0].actor_id).toBe(executor);
  });

  test('a row just inside 180 days stays, and opening the list also purges', async () => {
    await service.submit(form({ email: 'edge.entry@example.test', name: 'Edge Entry' }));
    await service.submit(form({ email: 'list.purge@example.test', name: 'List Purge' }));
    await ageRows('email=$1', ['edge.entry@example.test'], 179);
    await ageRows('email=$1', ['list.purge@example.test'], 200);
    const list = await service.list(staff('owner'), {});
    expect(list.rows.map((row) => row.email)).toContain('edge.entry@example.test');
    expect(list.rows.map((row) => row.email)).not.toContain('list.purge@example.test');
    expect((await rows()).map((row) => row.email)).not.toContain('list.purge@example.test');
  });

  test('a person whose entry was deleted can sign up again as a new entry', async () => {
    await service.submit(form());
    expect((await rows()).filter((row) => row.email === 'amina.rahman@example.test')).toHaveLength(
      1,
    );
  });
});

describe('limits and switches', () => {
  test('the global budget answers 429 after 60 an hour, and the per-email budget after 6, with no client key', async () => {
    const limited = new HelperInterestService(s.f.runtime, 'rate-secret-one');
    let last: unknown;
    for (let i = 0; i < 61; i++) {
      try {
        await limited.globalBudget();
      } catch (error) {
        last = error;
      }
    }
    expect(last).toBeInstanceOf(DomainError);
    expect((last as DomainError).status).toBe(429);
    // The service has no way to take a client address at all.
    expect(limited.globalBudget.length).toBe(0);
    expect((limited as unknown as Record<string, unknown>).clientBudget).toBeUndefined();
    const perAddress = new HelperInterestService(s.f.runtime, 'rate-secret-two');
    let status = 0;
    for (let i = 0; i < 8; i++) {
      try {
        await perAddress.submit(form({ email: 'busy@example.test', name: 'Busy Person' }));
      } catch (error) {
        status = (error as DomainError).status;
      }
    }
    expect(status).toBe(429);
  });

  test('no raw email or address is kept in any rate limit key', async () => {
    const keys = (await s.f.owner.query('SELECT key FROM app.intake_rate_limit')).rows.map(
      (row: { key: string }) => row.key,
    );
    expect(keys.every((key: string) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(keys.join(' ')).not.toMatch(/example|203\.0\.113/);
  });

  test('both switches are needed, each exactly "true"', () => {
    expect(helperInterestEnabled({})).toBe(false);
    expect(helperInterestEnabled({ CORRIDRA_HELPER_INTEREST: 'true' })).toBe(false);
    expect(helperInterestEnabled({ CORRIDRA_NETWORK_ENABLED: 'true' })).toBe(false);
    expect(
      helperInterestEnabled({ CORRIDRA_HELPER_INTEREST: 'TRUE', CORRIDRA_NETWORK_ENABLED: 'true' }),
    ).toBe(false);
    expect(
      helperInterestEnabled({ CORRIDRA_HELPER_INTEREST: 'true', CORRIDRA_NETWORK_ENABLED: 'true' }),
    ).toBe(true);
  });

  test('while real use is paused the register is closed and stores nothing', async () => {
    await configureCustomerRealUse(s.f.owner, {
      enabled: false,
      reason: 'Fixture pause to prove the register closes with real use',
    });
    try {
      expect(
        await service.offered({
          CORRIDRA_HELPER_INTEREST: 'true',
          CORRIDRA_NETWORK_ENABLED: 'true',
        }),
      ).toBe(false);
      const before = (await rows()).length;
      await expect(
        service.submit(form({ email: 'closed@example.test', name: 'Closed Door' })),
      ).rejects.toMatchObject({ status: 404 });
      expect(await rows()).toHaveLength(before);
    } finally {
      await configureCustomerRealUse(s.f.owner, {
        enabled: true,
        reason: 'Fixture reopen after the pause test',
      });
    }
  });
});

describe('paging the list while entries are deleted', () => {
  test('after a delete the next page starts one earlier, so no entry is ever skipped', async () => {
    for (let i = 0; i < 55; i++)
      await s.f.owner.query(
        "INSERT INTO app.helper_interest(tenant_id,name,email,country,reason,created_at) VALUES($1,$2,$3,'BD','A reason that is long enough to store',now()-make_interval(mins=>$4))",
        [anchor, `Paged Person ${i}`, `paged${i}@example.test`, i + 1],
      );
    const all = (await rows()).map((row) => row.email as string);
    const first = await service.list(staff('owner'), { offset: 0 });
    expect(first.rows).toHaveLength(50);
    expect(first.nextOffset).toBe(50);
    // Delete one loaded entry, then load the next page at the offset the screen now holds.
    await service.remove(staff('owner'), { id: first.rows[3]!.id });
    const state = pageAfterDelete({ total: first.total, nextOffset: first.nextOffset });
    expect(state.nextOffset).toBe(49);
    const second = await service.list(staff('owner'), { offset: state.nextOffset! });
    const seen = new Set([...first.rows.map((r) => r.email), ...second.rows.map((r) => r.email)]);
    const deleted = first.rows[3]!.email;
    const expected = all.filter((email) => email !== deleted);
    for (const email of expected) expect(seen.has(email), email).toBe(true);
    // Without the adjustment the first entry after the first page would have been skipped.
    const unadjusted = await service.list(staff('owner'), { offset: 50 });
    expect(unadjusted.rows.length).toBeLessThan(second.rows.length);
  });

  test('the paging state after a delete: one earlier, none left to read, never below zero', () => {
    expect(pageAfterDelete({ total: 51, nextOffset: 50 })).toEqual({ total: 50, nextOffset: 49 });
    expect(pageAfterDelete({ total: 50, nextOffset: null })).toEqual({
      total: 49,
      nextOffset: null,
    });
    expect(pageAfterDelete({ total: 1, nextOffset: 0 })).toEqual({ total: 0, nextOffset: null });
    expect(pageAfterDelete({ total: 100, nextOffset: 50 })).toEqual({ total: 99, nextOffset: 49 });
  });
});

vi.setConfig({ testTimeout: 60000 });
