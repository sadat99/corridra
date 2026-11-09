import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { sessionHash, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureRequestWithdrawal } from '../../packages/auth/src/customer-request-withdrawal-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';

// CRUD G1 follow-up, real database, real roles: the Corridra team can see that the customer withdrew a request, as one
// read-only fact (yes or no, and the date). It never carries the customer's reason, never writes anything, and only a
// signed-in member of the mission's own workspace can read it.
const issuer = 'https://ep-withdrawal-signal.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const secretReason = 'Private reason ZEBRA-7731 that the team must never see';
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;

type Person = {
  subject: string;
  email: string;
  requestId: string;
  missionId: string;
  tenantId: string;
};
const brief = (email: string) => ({
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

async function person(): Promise<Person> {
  const subject = randomUUID();
  const email = `owner-${randomUUID()}@acme-textiles.com`;
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
  const staged = await missions.stagePendingRequest(randomUUID(), brief(email));
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
    missionId: owned.mission_id,
    tenantId: owned.mission_tenant_id,
  };
}

async function asCustomer<T>(who: Person, work: (db: DatabaseClient) => Promise<T>) {
  const hash = sessionHash(randomBytes(32).toString('hex'));
  await f.auth.query(
    `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at,data_mode,verified_email_hash)
    VALUES($1,$2,$3,clock_timestamp()+interval '25 seconds','real',$4)`,
    [hash, issuer, who.subject, sessionHash(who.email.trim().toLowerCase())],
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
const withdraw = (who: Person) =>
  asCustomer(who, (db) =>
    db.query('SELECT customer.withdraw_request($1,$2,$3) AS r', [
      who.requestId,
      randomUUID(),
      secretReason,
    ]),
  );
const restore = (who: Person) =>
  asCustomer(who, (db) =>
    db.query('SELECT customer.restore_request($1,$2) AS r', [who.requestId, randomUUID()]),
  );
type Signal = { withdrawn: boolean; at: string | null };
const signal = async (ctx: Parameters<typeof rawContext>[1], mission: string): Promise<Signal> => {
  // Real use: staff read a workspace under its own processing purpose, as the application's tenant transaction does.
  const purpose = (
    await f.owner.query('SELECT app.tenant_processing_purpose($1) AS p', [ctx.tenantId])
  ).rows[0].p as string;
  return (
    await rawContext(
      f.runtime,
      { ...ctx, purpose },
      'SELECT app.mission_request_withdrawal($1) AS r',
      [mission],
    )
  ).rows[0].r;
};

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerRequestWithdrawal(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the withdrawal signal fixture tests',
  });
  await configureRequestWithdrawal(f.owner, {
    enabled: true,
    reason: 'Owner approved request withdrawal for the signal fixture tests',
  });
  missions = new MissionService(f.runtime, 'withdrawal-signal-local-secret', 'real');
});
afterAll(async () => {
  await f?.close();
});

describe('the team signal for a withdrawn request', () => {
  test('is a second additive file in the same module, recorded once and idempotent', async () => {
    const names = (
      await f.owner.query(
        'SELECT name FROM customer_request_withdrawal_migrations.applied ORDER BY name',
      )
    ).rows.map((row) => row.name);
    expect(names).toEqual(['0001_request_withdrawal.sql', '0002_staff_withdrawal_signal.sql']);
    await migrateCustomerRequestWithdrawal(f.owner);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_request_withdrawal_migrations.applied',
        )
      ).rows[0].n,
    ).toBe(2);
  });

  test('says nothing is withdrawn, then withdrawn with the date, then not withdrawn after a restore', async () => {
    const p = await person();
    const staff = { ...f.users.viewer.ctx, tenantId: p.tenantId };
    expect(await signal(staff, p.missionId)).toEqual({ withdrawn: false, at: null });
    await withdraw(p);
    const during = await signal(staff, p.missionId);
    expect(during.withdrawn).toBe(true);
    expect(Math.abs(Date.now() - Date.parse(during.at as string))).toBeLessThan(60_000);
    await restore(p);
    expect(await signal(staff, p.missionId)).toEqual({ withdrawn: false, at: null });
    await withdraw(p);
    expect((await signal(staff, p.missionId)).withdrawn).toBe(true);
  });

  test('never carries the reason, and the call writes nothing', async () => {
    const p = await person();
    await withdraw(p);
    const counts = async () =>
      (
        await f.owner.query(
          `SELECT (SELECT count(*) FROM customer_private.request_withdrawal_event)::int e,
           (SELECT count(*) FROM app.domain_event)::int d,(SELECT count(*) FROM app.audit_event)::int a`,
        )
      ).rows[0];
    const before = await counts();
    const result = await signal({ ...f.users.viewer.ctx, tenantId: p.tenantId }, p.missionId);
    expect(Object.keys(result).sort()).toEqual(['at', 'withdrawn']);
    expect(JSON.stringify(result)).not.toContain('ZEBRA');
    expect(await counts()).toEqual(before);
    expect(
      (
        await f.owner.query(
          "SELECT provolatile FROM pg_proc WHERE oid='app.mission_request_withdrawal(uuid)'::regprocedure",
        )
      ).rows[0].provolatile,
    ).toBe('s');
  });

  test('every staff role with mission read access can see it; a person outside the workspace cannot', async () => {
    const p = await person();
    await withdraw(p);
    for (const who of [f.users.owner, f.users.operator, f.users.reviewer, f.users.viewer])
      expect((await signal({ ...who.ctx, tenantId: p.tenantId }, p.missionId)).withdrawn).toBe(
        true,
      );
    await expect(
      signal({ ...f.users.other.ctx, tenantId: p.tenantId }, p.missionId),
    ).rejects.toThrow();
    await expect(
      signal({ ...f.users.outsider.ctx, tenantId: p.tenantId }, p.missionId),
    ).rejects.toThrow();
  });

  test("another workspace's staff, naming this mission from their own workspace, learn nothing", async () => {
    const p = await person();
    await withdraw(p);
    expect(await signal(f.users.other.ctx, p.missionId)).toEqual({ withdrawn: false, at: null });
    expect(await signal(f.users.owner.ctx, randomUUID())).toEqual({ withdrawn: false, at: null });
  });

  test('a request the schema owner revoked offline shows no signal', async () => {
    const p = await person();
    await withdraw(p);
    await f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the signal test')",
      [p.requestId],
    );
    expect(await signal({ ...f.users.viewer.ctx, tenantId: p.tenantId }, p.missionId)).toEqual({
      withdrawn: false,
      at: null,
    });
  });

  test('the customer session cannot call it, and the auth role cannot execute it', async () => {
    const p = await person();
    await withdraw(p);
    await expect(
      asCustomer(p, (db) => db.query('SELECT app.mission_request_withdrawal($1)', [p.missionId])),
    ).rejects.toThrow();
    await expect(
      f.auth.query('SELECT app.mission_request_withdrawal($1)', [p.missionId]),
    ).rejects.toThrow();
  });
});
