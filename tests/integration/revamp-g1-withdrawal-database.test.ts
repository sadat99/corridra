import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { sessionHash, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureRequestWithdrawal } from '../../packages/auth/src/customer-request-withdrawal-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';

// CRUD G1, real database, real roles: a person can withdraw a request they sent and take it back. Closed by default,
// owner only, one command id per decision, the reason is the person's own and never reaches an event or the audit
// trail, nothing of the team's is written, and the module needs no mail module.
const issuer = 'https://ep-withdrawal.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const reason = 'Owner approved request withdrawal for the local fixture tests';
const why = 'I sent this to the wrong team and will send it again';
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;

type Person = {
  subject: string;
  email: string;
  requestId: string;
  missionId: string;
  missionTenantId: string;
};
const briefFor = (email: string) => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: 'Hotel towels for hospitality distributors',
  website: 'https://business.test/catalogue',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Request owner',
  company: 'Hospitality supplier',
  email,
  acknowledged: true,
});

async function person(email = `owner-${randomUUID()}@acme-textiles.com`): Promise<Person> {
  const subject = randomUUID();
  const service = new CustomerRequestService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      dataMode: 'real',
      openAdmission: true,
    },
    async () => ({ subject, email, emailVerified: true, expiresAt: new Date(Date.now() + 60000) }),
  );
  const staged = await missions.stagePendingRequest(randomUUID(), briefFor(email));
  const claimed = await service.claimPending(
    missions.pendingRequestCapability(staged.cookie),
    (ctx, input) => missions.prepareCustomerIntake(ctx, input),
  );
  const requestId = claimed.id as string;
  const owned = (
    await f.owner.query(
      'SELECT mission_id,mission_tenant_id FROM customer_private.owned_request WHERE id=$1',
      [requestId],
    )
  ).rows[0];
  return {
    subject,
    email,
    requestId,
    missionId: owned.mission_id as string,
    missionTenantId: owned.mission_tenant_id as string,
  };
}

// The same shape as the application's customer session boundary: a short proof, then one transaction.
async function asCustomer<T>(
  who: { subject: string; email: string },
  work: (db: DatabaseClient) => Promise<T>,
  email = who.email,
) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at,data_mode,verified_email_hash)
    VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds','real',$4)`,
    [hash, issuer, who.subject, sessionHash(email.trim().toLowerCase())],
  );
  const db = await f.runtime.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),
      set_config('corridra.tenant_id','',true),set_config('corridra.customer_workspace_id','',true),set_config('corridra.purpose','synthetic_validation',true)`,
      [hash],
    );
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
    await f.auth.query('DELETE FROM customer_private.session_proof WHERE hash=$1', [hash]);
  }
}

const setControl = (enabled: boolean) => configureRequestWithdrawal(f.owner, { enabled, reason });
const call = <T>(who: Person, sql: string, args: unknown[]) =>
  asCustomer(who, async (db) => (await db.query(sql, args)).rows[0].r as T);
type Result = { withdrawn: boolean; changed: boolean; replayed?: boolean; reason?: string };
const withdraw = (who: Person, request: string, command: string, text = why) =>
  call<Result>(who, 'SELECT customer.withdraw_request($1,$2,$3) AS r', [request, command, text]);
const restore = (who: Person, request: string, command: string) =>
  call<Result>(who, 'SELECT customer.restore_request($1,$2) AS r', [request, command]);
const mine = (who: Person) =>
  call<{ open: boolean; items: { requestId: string; at: string; reason: string }[] }>(
    who,
    'SELECT customer.my_request_withdrawals() AS r',
    [],
  );
const withdrawnNow = async (request: string) =>
  (await f.owner.query('SELECT customer_private.request_withdrawn($1) AS w', [request])).rows[0]
    .w as boolean;
const setMissionStatus = async (who: Person, status: string) => {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query('ALTER TABLE app.mission DISABLE TRIGGER USER');
    await db.query('UPDATE app.mission SET status=$3 WHERE tenant_id=$1 AND id=$2', [
      who.missionTenantId,
      who.missionId,
      status,
    ]);
    await db.query('ALTER TABLE app.mission ENABLE TRIGGER USER');
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
};

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerRequestWithdrawal(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the request withdrawal fixture tests',
  });
  missions = new MissionService(f.runtime, 'withdrawal-intake-local-secret', 'real');
});
afterAll(async () => {
  await f?.close();
});

describe('installation', () => {
  test('installs with no mail module, is idempotent, records its file and refuses a changed history', async () => {
    const before = (
      await f.owner.query('SELECT * FROM customer_request_withdrawal_migrations.applied')
    ).rows;
    expect(before.map((r) => r.name)).toEqual([
      '0001_request_withdrawal.sql',
      '0002_staff_withdrawal_signal.sql',
      '0003_removed_member_withdrawals.sql',
    ]);
    await migrateCustomerRequestWithdrawal(f.owner);
    expect(
      (await f.owner.query('SELECT * FROM customer_request_withdrawal_migrations.applied')).rows,
    ).toEqual(before);
    await f.owner.query(
      "UPDATE customer_request_withdrawal_migrations.applied SET sha256=repeat('0',64)",
    );
    await expect(migrateCustomerRequestWithdrawal(f.owner)).rejects.toThrow('history mismatch');
    for (const row of before)
      await f.owner.query(
        'UPDATE customer_request_withdrawal_migrations.applied SET sha256=$1 WHERE name=$2',
        [row.sha256, row.name],
      );
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM pg_namespace WHERE nspname='customer_mission_mail_migrations' OR nspname='customer_notification_migrations'",
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('the control starts closed: nothing is withdrawn, the person is told why, and a restore needs no control', async () => {
    const p = await person();
    expect(await mine(p)).toEqual({ open: false, items: [] });
    expect(await withdraw(p, p.requestId, randomUUID())).toEqual({
      withdrawn: false,
      changed: false,
      reason: 'closed',
    });
    expect(await withdrawnNow(p.requestId)).toBe(false);
    await setControl(true);
    await withdraw(p, p.requestId, randomUUID());
    await setControl(false);
    expect(await restore(p, p.requestId, randomUUID())).toEqual({
      withdrawn: false,
      changed: true,
    });
    await setControl(true);
  });

  test('runtime and auth roles cannot read or write the tables or call the helpers; the new functions are runtime only', async () => {
    for (const pool of [f.runtime, f.auth]) {
      for (const sql of [
        'SELECT * FROM customer_private.request_withdrawal_event',
        'DELETE FROM customer_private.request_withdrawal_event',
        'SELECT * FROM customer_private.request_withdrawal_control',
        'SELECT customer_private.request_withdrawn(gen_random_uuid())',
        'SELECT customer_private.request_withdrawn_since(gen_random_uuid(),now())',
        'SELECT customer_private.request_withdrawal_open()',
      ])
        await expect(pool.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      f.auth.query('SELECT customer.withdraw_request($1,$2,$3)', [randomUUID(), randomUUID(), why]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.runtime.query('SELECT customer.withdraw_request($1,$2,$3)', [
        randomUUID(),
        randomUUID(),
        why,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('withdrawing and restoring', () => {
  test('withdraw, list, restore and withdraw again follow the newest event, and history is only appended', async () => {
    await setControl(true);
    const p = await person();
    expect(await withdrawnNow(p.requestId)).toBe(false);
    expect(await withdraw(p, p.requestId, randomUUID())).toEqual({
      withdrawn: true,
      changed: true,
    });
    expect(await withdrawnNow(p.requestId)).toBe(true);
    const listed = await mine(p);
    expect(listed.open).toBe(true);
    expect(listed.items).toEqual([{ requestId: p.requestId, at: expect.any(String), reason: why }]);
    expect(await restore(p, p.requestId, randomUUID())).toEqual({
      withdrawn: false,
      changed: true,
    });
    expect((await mine(p)).items).toEqual([]);
    expect(
      await withdraw(p, p.requestId, randomUUID(), 'Changed my mind again, please withdraw it'),
    ).toEqual({
      withdrawn: true,
      changed: true,
    });
    expect(
      (
        await f.owner.query(
          'SELECT state FROM customer_private.request_withdrawal_event WHERE request_id=$1 ORDER BY seq',
          [p.requestId],
        )
      ).rows.map((r) => r.state),
    ).toEqual(['withdrawn', 'restored', 'withdrawn']);
    for (const sql of [
      "UPDATE customer_private.request_withdrawal_event SET state='restored'",
      'DELETE FROM customer_private.request_withdrawal_event',
    ])
      await expect(f.owner.query(sql)).rejects.toThrow();
  });

  test('asking for the state a request already has changes nothing and uses no command id', async () => {
    await setControl(true);
    const p = await person();
    const first = randomUUID();
    await withdraw(p, p.requestId, first);
    const again = randomUUID();
    expect(await withdraw(p, p.requestId, again)).toEqual({ withdrawn: true, changed: false });
    const never = randomUUID();
    await restore(p, p.requestId, randomUUID());
    expect(await restore(p, p.requestId, never)).toEqual({ withdrawn: false, changed: false });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.request_withdrawal_event WHERE command_id=ANY($1)',
          [[again, never]],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('only the person the request belongs to can change it; anyone else gets the refusal an unknown request gets', async () => {
    await setControl(true);
    const a = await person();
    const b = await person();
    const refused = await withdraw(b, a.requestId, randomUUID()).catch((e) => e);
    const unknown = await withdraw(b, randomUUID(), randomUUID()).catch((e) => e);
    expect(refused.code).toBe('42501');
    expect(refused.message).toBe(unknown.message);
    expect(await withdrawnNow(a.requestId)).toBe(false);
    await withdraw(a, a.requestId, randomUUID());
    await expect(restore(b, a.requestId, randomUUID())).rejects.toMatchObject({ code: '42501' });
    expect(await withdrawnNow(a.requestId)).toBe(true);
    // The other person's list holds nothing of a's.
    expect((await mine(b)).items).toEqual([]);
  });

  test('a command id is one decision: a repeat answers with how things stand now, any other use is refused', async () => {
    await setControl(true);
    const p = await person();
    const q = await person();
    const command = randomUUID();
    expect(await withdraw(p, p.requestId, command)).toEqual({ withdrawn: true, changed: true });
    await restore(p, p.requestId, randomUUID());
    expect(await withdraw(p, p.requestId, command)).toEqual({
      withdrawn: false,
      changed: false,
      replayed: true,
    });
    expect(await withdrawnNow(p.requestId)).toBe(false);
    await expect(restore(p, p.requestId, command)).rejects.toMatchObject({ code: '42501' });
    await expect(withdraw(p, randomUUID(), command)).rejects.toMatchObject({ code: '42501' });
    await expect(withdraw(q, q.requestId, command)).rejects.toMatchObject({ code: '42501' });
  });

  test('a reason of 10 to 500 characters is required, is kept only for its owner, and never reaches an event or the audit trail', async () => {
    await setControl(true);
    const p = await person();
    for (const bad of ['', 'too short', ' '.repeat(40), 'x'.repeat(501)])
      await expect(withdraw(p, p.requestId, randomUUID(), bad)).rejects.toMatchObject({
        code: '23514',
      });
    expect(await withdrawnNow(p.requestId)).toBe(false);
    const secretWords = 'My supplier lost the sample batch ' + randomUUID();
    await withdraw(p, p.requestId, randomUUID(), '  ' + secretWords + '  ');
    expect((await mine(p)).items[0].reason).toBe(secretWords);
    const events = (
      await f.owner.query(
        "SELECT type,payload FROM app.domain_event WHERE type IN ('customer.request.withdrawn','customer.request.restored') AND aggregate_id=$1",
        [p.requestId],
      )
    ).rows;
    expect(events.map((e) => e.type)).toEqual(['customer.request.withdrawn']);
    expect(events[0].payload).toEqual({ request_id: p.requestId });
    for (const table of ['app.domain_event', 'app.audit_event'])
      expect(
        (
          await f.owner.query(`SELECT count(*)::int n FROM ${table} t WHERE t::text LIKE $1`, [
            '%' + secretWords + '%',
          ])
        ).rows[0].n,
      ).toBe(0);
    await restore(p, p.requestId, randomUUID());
    expect(
      JSON.stringify(
        (
          await f.owner.query(
            "SELECT * FROM customer_private.request_withdrawal_event WHERE state='restored' AND request_id=$1",
            [p.requestId],
          )
        ).rows,
      ),
    ).not.toContain(secretWords);
  });

  test('nothing of the team is written: the mission and its records are untouched', async () => {
    await setControl(true);
    const p = await person();
    const snapshot = async () =>
      (
        await f.owner.query('SELECT status,version FROM app.mission WHERE tenant_id=$1 AND id=$2', [
          p.missionTenantId,
          p.missionId,
        ])
      ).rows[0];
    const before = await snapshot();
    await withdraw(p, p.requestId, randomUUID());
    await restore(p, p.requestId, randomUUID());
    expect(await snapshot()).toEqual(before);
  });

  test('a revoked request can be neither withdrawn nor restored and is left out of the list', async () => {
    await setControl(true);
    const p = await person();
    await withdraw(p, p.requestId, randomUUID());
    expect((await mine(p)).items).toHaveLength(1);
    await f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the withdrawal test')",
      [p.requestId],
    );
    expect((await mine(p)).items).toEqual([]);
    await expect(restore(p, p.requestId, randomUUID())).rejects.toMatchObject({ code: '42501' });
    const q = await person();
    await f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the withdrawal test')",
      [q.requestId],
    );
    await expect(withdraw(q, q.requestId, randomUUID())).rejects.toMatchObject({ code: '42501' });
  });

  test('a closed or cancelled mission cannot be withdrawn; any other status can; a restore is always allowed', async () => {
    await setControl(true);
    const closed = await person();
    await setMissionStatus(closed, 'CLOSED');
    expect(await withdraw(closed, closed.requestId, randomUUID())).toEqual({
      withdrawn: false,
      changed: false,
      reason: 'not-withdrawable',
    });
    const cancelled = await person();
    await setMissionStatus(cancelled, 'CANCELLED');
    expect((await withdraw(cancelled, cancelled.requestId, randomUUID())).reason).toBe(
      'not-withdrawable',
    );
    const delivered = await person();
    await setMissionStatus(delivered, 'COMMERCIAL_PIPELINE');
    expect((await withdraw(delivered, delivered.requestId, randomUUID())).changed).toBe(true);
    await setMissionStatus(delivered, 'CLOSED');
    expect((await restore(delivered, delivered.requestId, randomUUID())).changed).toBe(true);
  });
});

describe('the since check', () => {
  test('a withdrawn period overlaps the time from a moment until now if it was withdrawn then, later, or is now', async () => {
    await setControl(true);
    const p = await person();
    const at = async (offsetMs: number) =>
      (
        await f.owner.query("SELECT clock_timestamp()+($1||' milliseconds')::interval AS t", [
          offsetMs,
        ])
      ).rows[0].t as Date;
    const since = async (when: Date) =>
      (
        await f.owner.query('SELECT customer_private.request_withdrawn_since($1,$2) AS s', [
          p.requestId,
          when,
        ])
      ).rows[0].s as boolean;
    const beforeAll = await at(-1000);
    expect(await since(beforeAll)).toBe(false);
    await withdraw(p, p.requestId, randomUUID());
    const during = await at(0);
    await restore(p, p.requestId, randomUUID());
    const after = await at(50);
    expect(await since(beforeAll)).toBe(true); // before the withdrawal: a withdrawn period lies after it
    expect(await since(during)).toBe(true); // at a moment inside the withdrawn period
    expect(await since(after)).toBe(false); // after the restore: nothing overlaps
    await withdraw(p, p.requestId, randomUUID());
    expect(await since(after)).toBe(true); // withdrawn again
  });
});

describe('the request as its owner reads it', () => {
  type Row = Record<string, unknown> & { id: string; withdrawn: boolean };
  const listed = async (who: Person, request: string) =>
    (
      await call<{ requests: Row[] }>(who, 'SELECT customer.private_requests(NULL,100) AS r', [])
    ).requests.find((r) => r.id === request);

  test('the request result says whether it is withdrawn and keeps every other key', async () => {
    await setControl(true);
    const p = await person();
    const before = await listed(p, p.requestId);
    expect(before).toMatchObject({ id: p.requestId, withdrawn: false });
    expect(Object.keys(before!).sort()).toEqual(
      ['available', 'createdAt', 'id', 'progress', 'synthetic', 'withdrawn', 'workspaceId'].sort(),
    );
    await withdraw(p, p.requestId, randomUUID());
    expect(await listed(p, p.requestId)).toMatchObject({ id: p.requestId, withdrawn: true });
    await restore(p, p.requestId, randomUUID());
    expect(await listed(p, p.requestId)).toMatchObject({ withdrawn: false });
  });

  test("a withdrawn request stays in the owner's own list, and a revoked one still leaves it", async () => {
    await setControl(true);
    const p = await person();
    await withdraw(p, p.requestId, randomUUID());
    expect(await listed(p, p.requestId)).toMatchObject({ withdrawn: true });
    await f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the withdrawal list test')",
      [p.requestId],
    );
    expect(await listed(p, p.requestId)).toBeUndefined();
  });
});

describe('the application service', () => {
  const serviceFor = (who: Person) =>
    new CustomerRequestService(
      f.runtime,
      f.auth,
      {
        enabled: true,
        synthetic: false,
        production: false,
        issuer,
        dataMode: 'real',
        openAdmission: true,
      },
      async () => ({
        subject: who.subject,
        email: who.email,
        emailVerified: true,
        expiresAt: new Date(Date.now() + 60000),
      }),
    );

  test('lists, withdraws and restores with one command id each, and refuses another person', async () => {
    await setControl(true);
    const p = await person();
    const other = await person();
    const service = serviceFor(p);
    expect(await service.withdrawals(p.subject, issuer)).toEqual({ open: true, items: [] });
    const command = randomUUID();
    const input = { action: 'withdraw', requestId: p.requestId, commandId: command, reason: why };
    expect(await service.setWithdrawal(input, p.subject, issuer)).toEqual({
      withdrawn: true,
      changed: true,
    });
    expect((await service.withdrawals(p.subject, issuer)).items).toEqual([
      { requestId: p.requestId, at: expect.any(String), reason: why },
    ]);
    expect(await service.setWithdrawal(input, p.subject, issuer)).toMatchObject({ replayed: true });
    await expect(
      service.setWithdrawal(
        { ...input, requestId: other.requestId, commandId: randomUUID() },
        p.subject,
        issuer,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      await service.setWithdrawal(
        { action: 'restore', requestId: p.requestId, commandId: randomUUID() },
        p.subject,
        issuer,
      ),
    ).toEqual({ withdrawn: false, changed: true });
    expect((await service.withdrawals(p.subject, issuer)).items).toEqual([]);
  });

  test('a malformed decision never reaches the database', async () => {
    const p = await person();
    const service = serviceFor(p);
    const base = { requestId: p.requestId, commandId: randomUUID() };
    for (const bad of [
      { action: 'withdraw', ...base },
      { action: 'withdraw', ...base, reason: 'too short' },
      { action: 'withdraw', ...base, reason: 'x'.repeat(501) },
      { action: 'restore', ...base, reason: why },
      { action: 'other', ...base },
      { action: 'withdraw', ...base, reason: why, extra: 1 },
      { action: 'withdraw', requestId: 'nope', commandId: base.commandId, reason: why },
    ])
      await expect(service.setWithdrawal(bad, p.subject, issuer)).rejects.toThrow();
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.request_withdrawal_event WHERE request_id=$1',
          [p.requestId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
