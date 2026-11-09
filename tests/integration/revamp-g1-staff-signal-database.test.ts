import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
type Signal = { missionId: string; withdrawn: boolean; at: string | null };
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
  const none = (missionId: string) => ({ missionId, withdrawn: false, at: null });
  const staffOf = (p: Person, who = f.users.operator) => ({ ...who.ctx, tenantId: p.tenantId });

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
    const staff = staffOf(p);
    expect(await signal(staff, p.missionId)).toEqual(none(p.missionId));
    await withdraw(p);
    const during = await signal(staff, p.missionId);
    expect(during.withdrawn).toBe(true);
    expect(during.missionId).toBe(p.missionId);
    expect(Math.abs(Date.now() - Date.parse(during.at as string))).toBeLessThan(60_000);
    await restore(p);
    expect(await signal(staff, p.missionId)).toEqual(none(p.missionId));
    await withdraw(p);
    expect((await signal(staff, p.missionId)).withdrawn).toBe(true);
  });

  test('carries only the mission id, the answer and the date: no reason, person or workspace id; and writes no record', async () => {
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
    const result = await signal(staffOf(p), p.missionId);
    expect(Object.keys(result).sort()).toEqual(['at', 'missionId', 'withdrawn']);
    const text = JSON.stringify(result);
    expect(text).not.toContain('ZEBRA');
    for (const id of [p.requestId, p.subject]) expect(text).not.toContain(id);
    expect(await counts()).toEqual(before);
  });

  test('is checked against the staff session: owners and operators read it, reviewers and viewers get nothing', async () => {
    const p = await person();
    await withdraw(p);
    for (const who of [f.users.owner, f.users.operator])
      expect((await signal(staffOf(p, who), p.missionId)).withdrawn).toBe(true);
    for (const who of [f.users.reviewer, f.users.viewer])
      await expect(signal(staffOf(p, who), p.missionId)).rejects.toThrow('Mission access denied');
  });

  test('a stale authenticator check gets nothing', async () => {
    const p = await person();
    await withdraw(p);
    await f.owner.query(
      "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
      [f.users.operator.sessionId],
    );
    try {
      await expect(signal(staffOf(p), p.missionId)).rejects.toThrow('Mission access denied');
    } finally {
      await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
        f.users.operator.sessionId,
      ]);
    }
    expect((await signal(staffOf(p), p.missionId)).withdrawn).toBe(true);
  });

  test('a person outside the workspace, or in another workspace, is refused', async () => {
    const p = await person();
    await withdraw(p);
    await expect(signal(staffOf(p, f.users.other), p.missionId)).rejects.toThrow(
      'Mission access denied',
    );
    await expect(signal(staffOf(p, f.users.outsider), p.missionId)).rejects.toThrow(
      'Mission access denied',
    );
  });

  test("another workspace's staff, naming this mission from their own workspace, learn nothing", async () => {
    const p = await person();
    await withdraw(p);
    expect(await signal(f.users.other.ctx, p.missionId)).toEqual(none(p.missionId));
    const unknown = randomUUID();
    expect(await signal(f.users.owner.ctx, unknown)).toEqual(none(unknown));
  });

  test("a sample workspace never learns about a real customer's withdrawal, and real never about sample", async () => {
    const p = await person();
    await withdraw(p);
    const workspace = (
      await f.owner.query('SELECT workspace_id FROM customer_private.owned_request WHERE id=$1', [
        p.requestId,
      ])
    ).rows[0].workspace_id as string;
    const flip = async (value: boolean | null) => {
      const db = await f.owner.connect();
      try {
        await db.query('BEGIN');
        await db.query('ALTER TABLE app.tenant DISABLE TRIGGER USER');
        await db.query(
          value === null
            ? 'UPDATE app.tenant SET synthetic=NOT synthetic WHERE id=$1'
            : 'UPDATE app.tenant SET synthetic=$2 WHERE id=$1',
          value === null ? [workspace] : [workspace, value],
        );
        await db.query('ALTER TABLE app.tenant ENABLE TRIGGER USER');
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    };
    expect((await signal(staffOf(p), p.missionId)).withdrawn).toBe(true);
    await flip(null);
    try {
      expect(await signal(staffOf(p), p.missionId)).toEqual(none(p.missionId));
    } finally {
      await flip(null);
    }
    expect((await signal(staffOf(p), p.missionId)).withdrawn).toBe(true);
  });

  test('a request the schema owner revoked offline shows no signal', async () => {
    const p = await person();
    await withdraw(p);
    await f.owner.query(
      "INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,'Revoked for the signal test')",
      [p.requestId],
    );
    expect(await signal(staffOf(p), p.missionId)).toEqual(none(p.missionId));
  });

  test('the customer session cannot call it, and the auth role cannot execute it', async () => {
    const p = await person();
    await withdraw(p);
    await expect(
      asCustomer(p, (db) => db.query('SELECT app.mission_request_withdrawal($1)', [p.missionId])),
    ).rejects.toThrow();
    await expect(
      f.auth.query('SELECT app.mission_request_withdrawal($1)', [p.missionId]),
    ).rejects.toThrow('permission denied');
    expect(
      (
        await f.owner.query(
          `SELECT has_function_privilege('public','app.mission_request_withdrawal(uuid)','EXECUTE') AS p,
           has_function_privilege('corridra_runtime','app.mission_request_withdrawal(uuid)','EXECUTE') AS r`,
        )
      ).rows[0],
    ).toEqual({ p: false, r: true });
  });

  test('the file reads only: no INSERT, UPDATE, DELETE or TRUNCATE, and every record table is left as it was', async () => {
    const sql = readFileSync(
      resolve(
        'packages/db/customer-request-withdrawal-migrations/0002_staff_withdrawal_signal.sql',
      ),
      'utf8',
    )
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    const recordName =
      /invoice|payment|credit|decision|confirmation|evidence|ledger|billing_|subscription|audit_event|domain_event|request_withdrawal_event/;
    const tables = (
      await f.owner.query(
        `SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND n.nspname IN ('app','customer','customer_private') AND c.relname ~ $1 ORDER BY 1`,
        [recordName.source],
      )
    ).rows.map((row) => row.name as string);
    expect(tables.length).toBeGreaterThan(3);
    const digest = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [
            table,
            (
              await f.owner.query(
                `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS d FROM ${table} t`,
              )
            ).rows[0].d,
          ]),
        ),
      );
    const p = await person();
    await withdraw(p);
    const before = await digest();
    await signal(staffOf(p), p.missionId);
    await signal(staffOf(p, f.users.other), p.missionId).catch(() => undefined);
    expect(await digest()).toEqual(before);
  });
});
