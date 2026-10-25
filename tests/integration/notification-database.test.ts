import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture } from './support';
import { sessionHash, withTenant, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMoveRecords } from '../../packages/auth/src/customer-move-configuration';
import {
  configureNotifications,
  emailAddressSourceReady,
} from '../../packages/auth/src/customer-notification-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';
import { MissionMoveService } from '../../packages/missions/src/moves';
import { signPulseMute } from '../../packages/auth/src/pulse-mute';
import {
  PulseService,
  databaseRecipientSource,
  pulseCapability,
  type PulseJob,
  type RecipientPort,
} from '../../packages/auth/src/customer-notifications';
import type { MailSender } from '../../packages/auth/src/customer-auth-mail';

// Real database, real roles. Proves Pulse notification records (ADR-067): closed by default, additive,
// only the Corridra team's own Move can queue a message and only for the person who owns the request,
// no address and no free text is ever stored, quiet hours and digests only delay, a stale message is
// suppressed rather than sent, and a mute works once and for one request.
const issuer = 'https://ep-pulse-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const secret = 'pulse-local-test-secret-0123456789abcdef';
const reason = 'Owner approved Pulse notification records for the local fixture tests';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;
let moves: MissionMoveService;

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
  offer: 'Hotel towels for hospitality distributors ' + randomUUID(),
  website: 'https://business.test/catalogue',
  outcomes: ['Relevant meetings'],
  notes: '',
  name: 'Request owner',
  company: 'Hospitality supplier',
  email,
  acknowledged: true,
});

// The Corridra team acts in the tenant that holds the request's mission.
const staff = (who: Person, user: 'operator' | 'owner' | 'viewer' | 'other' = 'operator') => ({
  ...f.users[user].ctx,
  tenantId: who.missionTenantId,
});

// Email is off until a person switches it on (migration 0002), so most tests start from someone who has.
// Pass optedIn false for the person who has made no choice.
async function person(
  email = `owner-${randomUUID()}@acme-textiles.com`,
  subject: string = randomUUID(),
  optedIn = true,
): Promise<Person> {
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
  const who = {
    subject,
    email,
    requestId,
    missionId: owned.mission_id as string,
    missionTenantId: owned.mission_tenant_id as string,
  };
  // While the control is closed this saves nothing, which is what the closed-control tests expect.
  if (optedIn && (await prefs(who)).version === 0) await savePrefs(who);
  return who;
}

// The same shape as the application's customer session boundary: a short proof, then one transaction.
async function asCustomer<T>(
  who: { subject: string; email: string },
  work: (db: DatabaseClient) => Promise<T>,
) {
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
const prefs = (who: Person) =>
  asCustomer(
    who,
    async (db) => (await db.query('SELECT customer.notification_preferences() AS r')).rows[0].r,
  );
const savePrefs = (
  who: Person,
  over: Partial<{
    kinds: string[];
    digest: boolean;
    from: string | null;
    to: string | null;
    zone: string;
    language: string | null;
  }> = {},
) =>
  asCustomer(who, async (db) => {
    const v = {
      kinds: ['your-move', 'update', 'countdown', 'complete'],
      digest: false,
      from: null,
      to: null,
      zone: 'UTC',
      language: null,
      ...over,
    };
    return (
      await db.query('SELECT customer.set_notification_preferences($1,$2,$3,$4,$5,$6) AS r', [
        v.kinds,
        v.digest,
        v.from,
        v.to,
        v.zone,
        v.language,
      ])
    ).rows[0].r;
  });

type Job = { queueId: string; requestId: string; kind: string; key: string };
/** The Corridra team sets Moves; the same staff transaction then queues and seals, as the application does. */
async function setMoves(
  who: Person,
  list: { verb?: string; object: string; holder?: string; dueOn?: string | null }[],
  seal = true,
) {
  const commandId = randomUUID();
  await moves.command(staff(who), {
    action: 'set',
    commandId,
    missionId: who.missionId,
    moves: list.map((m) => ({ verb: 'Add', holder: 'customer', dueOn: null, ...m })),
  });
  const result = await withTenant(f.runtime, staff(who), 'missions.manage', async ({ db }) => {
    const r = (await db.query('SELECT customer.enqueue_move_notifications($1) AS r', [commandId]))
      .rows[0].r as {
      queued: number;
      jobs: Job[];
      reason: string | null;
    };
    if (seal)
      for (const job of r.jobs)
        await db.query('SELECT customer.seal_notification($1,$2,$3)', [
          job.queueId,
          sha(pulseCapability(secret, job.queueId)),
          sha(signPulseMute(secret, job.requestId)),
        ]);
    return r;
  });
  return { commandId, ...result };
}
const claim = async (id: string) =>
  (
    await f.runtime.query('SELECT customer.claim_notification($1,$2) AS r', [
      id,
      pulseCapability(secret, id),
    ])
  ).rows[0].r;
const finish = async (id: string, outcome: string) =>
  (
    await f.runtime.query('SELECT customer.finish_notification($1,$2,$3) AS r', [
      id,
      pulseCapability(secret, id),
      outcome,
    ])
  ).rows[0].r;
const mute = async (request: string, token: string) =>
  (await f.runtime.query('SELECT customer.mute_notifications($1,$2) AS r', [request, token]))
    .rows[0].r;
const row = async (id: string) =>
  (await f.owner.query('SELECT * FROM customer_private.notification_outbox WHERE id=$1', [id]))
    .rows[0];
const setControl = (enabled: boolean) => configureNotifications(f.owner, { enabled, reason });
const dueAt = async (
  at: string,
  zone: string,
  from: string | null,
  to: string | null,
  digest: boolean,
) =>
  new Date(
    (
      await f.owner.query(
        'SELECT customer_private.notification_due_at($1::timestamptz,$2,$3::time,$4::time,$5) AS due',
        [at, zone, from, to, digest],
      )
    ).rows[0].due,
  ).toISOString();

// Everything that exists before this module: functions with their ACLs, tables with RLS, ACLs and policies.
async function snapshot(oids?: { fn: number[]; tb: number[] }) {
  const fn = (
    await f.owner.query(
      `SELECT p.oid::int AS oid,pg_get_functiondef(p.oid) AS def,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('app','identity','customer','customer_private') AND ($1::oid[] IS NULL OR p.oid=ANY($1)) ORDER BY p.oid`,
      [oids?.fn ?? null],
    )
  ).rows;
  const tb = (
    await f.owner.query(
      `SELECT c.oid::int AS oid,c.relacl::text AS acl,c.relrowsecurity AS rls,
        (SELECT coalesce(jsonb_agg(pg_get_expr(po.polqual,po.polrelid) || '|' || coalesce(pg_get_expr(po.polwithcheck,po.polrelid),'') || '|' || po.polname ORDER BY po.polname),'[]'::jsonb) FROM pg_policy po WHERE po.polrelid=c.oid) AS policies
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private') AND ($1::oid[] IS NULL OR c.oid=ANY($1)) ORDER BY c.oid`,
      [oids?.tb ?? null],
    )
  ).rows;
  return { fn, tb };
}
let before: Awaited<ReturnType<typeof snapshot>>;
// A real date inside the one-year window the database allows.
const inThirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
/** Makes a message due now, as a day passing would. Only the test may change what the guard protects. */
async function makeDue(id: string) {
  await f.owner.query(
    'ALTER TABLE customer_private.notification_outbox DISABLE TRIGGER notification_outbox_guard',
  );
  try {
    await f.owner.query(
      "UPDATE customer_private.notification_outbox SET available_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours' WHERE id=$1",
      [id],
    );
  } finally {
    await f.owner.query(
      'ALTER TABLE customer_private.notification_outbox ENABLE TRIGGER notification_outbox_guard',
    );
  }
}

beforeAll(async () => {
  f = await fixture();
  // Moves are installed and open before Pulse, as the install job does: Pulse needs them.
  await migrateCustomerMoves(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the Pulse fixture tests',
  });
  await configureMoveRecords(f.owner, {
    enabled: true,
    reason: 'Owner approved Move records for the Pulse tests',
  });
  missions = new MissionService(f.runtime, 'pulse-intake-local-secret', 'real');
  moves = new MissionMoveService(f.runtime);
  // Staff reach real-use missions through the processing purpose the application derives from this switch.
  process.env.CORRIDRA_REAL_USE_ENABLED = 'true';
  before = await snapshot();
  await migrateCustomerNotifications(f.owner);
});
afterAll(async () => {
  delete process.env.CORRIDRA_REAL_USE_ENABLED;
  await f?.close();
});

describe('installation', () => {
  test('a populated additive upgrade changes no existing function, table, policy or grant', async () => {
    const after = await snapshot({
      fn: before.fn.map((r) => r.oid),
      tb: before.tb.map((r) => r.oid),
    });
    expect(after).toEqual(before);
    expect((await snapshot()).tb.length - before.tb.length).toBeGreaterThanOrEqual(4);
  });

  test('is idempotent, records both applied files with their hashes and refuses a changed history', async () => {
    const was = (await f.owner.query('SELECT * FROM customer_notification_migrations.applied'))
      .rows;
    expect(was.map((r) => r.name)).toEqual([
      '0001_notifications.sql',
      '0002_email_off_until_chosen.sql',
    ]);
    await migrateCustomerNotifications(f.owner);
    expect(
      (await f.owner.query('SELECT * FROM customer_notification_migrations.applied')).rows,
    ).toEqual(was);
    await f.owner.query(
      "UPDATE customer_notification_migrations.applied SET sha256=repeat('0',64) WHERE name='0002_email_off_until_chosen.sql'",
    );
    await expect(migrateCustomerNotifications(f.owner)).rejects.toThrow('history mismatch');
    await f.owner.query(
      "UPDATE customer_notification_migrations.applied SET sha256=$1 WHERE name='0002_email_off_until_chosen.sql'",
      [was.find((r) => r.name === '0002_email_off_until_chosen.sql').sha256],
    );
  });

  test('the control starts closed: nothing is queued, saved or claimed, and the Move is unaffected', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your import licence number' }], false);
    expect(set).toMatchObject({ queued: 0, reason: 'closed' });
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_private.notification_outbox'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.mission_move WHERE mission_id=$1', [
          p.missionId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(await prefs(p)).toMatchObject({ open: false, version: 0 });
    expect(await savePrefs(p)).toEqual({ saved: false, reason: 'closed' });
  });

  test('while the control is closed a person can still switch email off, and nothing else is saved', async () => {
    // The control starts closed here. A yes already given must be withdrawable, but a new yes must not be saved.
    const p = await person(undefined, undefined, false);
    expect(await savePrefs(p, { kinds: ['your-move'] })).toEqual({
      saved: false,
      reason: 'closed',
    });
    expect(await savePrefs(p, { kinds: [] })).toEqual({ saved: true, version: 1 });
    expect(await prefs(p)).toMatchObject({ open: false, version: 1, kinds: [] });
    await expect(savePrefs(p, { kinds: [], zone: 'Mars/Olympus' })).rejects.toMatchObject({
      code: '23514',
    });
  });

  test('runtime and auth roles cannot read or write any table, or run the internal functions', async () => {
    for (const pool of [f.runtime, f.auth]) {
      for (const table of [
        'notification_control',
        'notification_preference',
        'notification_mute',
        'notification_outbox',
      ])
        for (const sql of [
          `SELECT * FROM customer_private.${table}`,
          `DELETE FROM customer_private.${table}`,
        ])
          await expect(pool.query(sql)).rejects.toMatchObject({ code: '42501' });
      for (const fn of [
        'customer_private.notification_open()',
        'customer_private.notification_expire()',
        "customer_private.notification_due_at(now(),'UTC',NULL,NULL,false)",
        'customer_private.notification_preference_of(gen_random_uuid())',
      ])
        await expect(pool.query(`SELECT ${fn}`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      f.auth.query('SELECT customer.claim_notification($1,$2)', [randomUUID(), 'x'.repeat(30)]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(f.auth.query('SELECT customer.notification_preferences()')).rejects.toMatchObject({
      code: '42501',
    });
  });

  test('configuration is an offline owner operation, idempotent, and keeps every record when closed', async () => {
    await expect(configureNotifications(f.runtime, { enabled: true, reason })).rejects.toThrow();
    await expect(configureNotifications(f.auth, { enabled: true, reason })).rejects.toThrow();
    await expect(
      configureNotifications(f.owner, { enabled: true, reason: 'short' }),
    ).rejects.toThrow();
    expect(await setControl(false)).toEqual({ enabled: false, changed: false });
    expect(await setControl(true)).toEqual({ enabled: true, changed: true });
    expect(await setControl(true)).toEqual({ enabled: true, changed: false });
    await expect(
      f.owner.query('UPDATE customer_private.notification_control SET enabled=false'),
    ).rejects.toThrow();
  });
});

describe('when a message can first be sent', () => {
  test('a time that needs no change is returned exactly as given', async () => {
    expect(await dueAt('2026-11-02T10:15:30Z', 'Asia/Dhaka', null, null, false)).toBe(
      '2026-11-02T10:15:30.000Z',
    );
    expect(await dueAt('2026-11-02T10:15:30Z', 'Asia/Dhaka', '22:00', '07:00', false)).toBe(
      '2026-11-02T10:15:30.000Z',
    );
  });
  test("quiet hours across midnight push a time inside them to the end of the window, in the person's zone", async () => {
    // 17:30Z is 23:30 in Dhaka (UTC+6): quiet until 07:00 the next morning there, which is 01:00Z.
    expect(await dueAt('2026-11-02T17:30:00Z', 'Asia/Dhaka', '22:00', '07:00', false)).toBe(
      '2026-11-03T01:00:00.000Z',
    );
    // 22:00Z is 04:00 in Dhaka the next day: still quiet, ends at 07:00 the same day there.
    expect(await dueAt('2026-11-02T22:00:00Z', 'Asia/Dhaka', '22:00', '07:00', false)).toBe(
      '2026-11-03T01:00:00.000Z',
    );
  });
  test('quiet hours within one day', async () => {
    expect(await dueAt('2026-11-02T13:30:00Z', 'UTC', '13:00', '15:00', false)).toBe(
      '2026-11-02T15:00:00.000Z',
    );
    expect(await dueAt('2026-11-02T15:00:00Z', 'UTC', '13:00', '15:00', false)).toBe(
      '2026-11-02T15:00:00.000Z',
    );
  });
  test('a daily digest waits for the next 08:00 local, across both daylight saving changes', async () => {
    // New York leaves daylight saving on 1 November 2026: 08:00 that day is 13:00Z.
    expect(await dueAt('2026-10-31T14:00:00Z', 'America/New_York', null, null, true)).toBe(
      '2026-11-01T13:00:00.000Z',
    );
    // New York enters daylight saving on 8 March 2026: 08:00 that day is 12:00Z.
    expect(await dueAt('2026-03-07T14:00:00Z', 'America/New_York', null, null, true)).toBe(
      '2026-03-08T12:00:00.000Z',
    );
    // Before 08:00 the same local day is used; after it, the next.
    expect(await dueAt('2026-11-02T01:00:00Z', 'UTC', null, null, true)).toBe(
      '2026-11-02T08:00:00.000Z',
    );
    expect(await dueAt('2026-11-02T09:00:00Z', 'UTC', null, null, true)).toBe(
      '2026-11-03T08:00:00.000Z',
    );
  });
  test('a digest that lands in quiet hours waits for them to end', async () => {
    expect(await dueAt('2026-11-02T01:00:00Z', 'UTC', '07:00', '09:00', true)).toBe(
      '2026-11-02T09:00:00.000Z',
    );
  });
});

describe('preferences', () => {
  test('start with email off, are saved as new versions, and every version stays', async () => {
    const p = await person(undefined, undefined, false);
    expect(await prefs(p)).toMatchObject({
      open: true,
      version: 0,
      digest: false,
      timeZone: 'UTC',
      language: null,
      kinds: [],
    });
    expect(
      await savePrefs(p, {
        kinds: ['your-move'],
        digest: true,
        from: '22:00',
        to: '07:00',
        zone: 'Asia/Dhaka',
        language: 'bn',
      }),
    ).toEqual({ saved: true, version: 1 });
    expect(await savePrefs(p, { kinds: ['your-move', 'complete'] })).toEqual({
      saved: true,
      version: 2,
    });
    expect(await prefs(p)).toMatchObject({
      version: 2,
      kinds: ['your-move', 'complete'],
      digest: false,
      quietStart: null,
    });
    const stored = (
      await f.owner.query(
        'SELECT version,language FROM customer_private.notification_preference WHERE principal_id=(SELECT principal_id FROM customer_private.owned_request WHERE id=$1) ORDER BY version',
        [p.requestId],
      )
    ).rows;
    expect(stored).toEqual([
      { version: 1, language: 'bn' },
      { version: 2, language: null },
    ]);
    await expect(
      f.owner.query('UPDATE customer_private.notification_preference SET digest=true'),
    ).rejects.toThrow();
    await expect(
      f.owner.query('DELETE FROM customer_private.notification_preference'),
    ).rejects.toThrow();
  });

  test('refuses every invalid choice with the same error', async () => {
    const p = await person();
    for (const bad of [
      { kinds: ['your-move', 'your-move'] },
      { kinds: ['marketing'] },
      { zone: 'Mars/Olympus' },
      { from: '22:00', to: null },
      { from: '22:00', to: '22:00' },
      { from: '25:00', to: '07:00' },
      { language: 'xx' },
    ])
      await expect(savePrefs(p, bad as never)).rejects.toMatchObject({ code: '23514' });
    expect(await prefs(p)).toMatchObject({ version: 1 });
  });

  test('each person reads and saves only their own, and a signed-out call is refused', async () => {
    const a = await person();
    const b = await person();
    await savePrefs(a, { kinds: ['complete'] });
    expect((await prefs(b)).kinds).toEqual(['your-move', 'update', 'countdown', 'complete']);
    await expect(
      f.runtime.query('SELECT customer.notification_preferences()'),
    ).rejects.toBeTruthy();
    await expect(
      f.runtime.query(
        "SELECT customer.set_notification_preferences(ARRAY['complete'],false,NULL,NULL,'UTC',NULL)",
      ),
    ).rejects.toBeTruthy();
  });
});

describe('queueing from a Move', () => {
  test('queues one sealed message for a Move the customer holds, keeping no address and no free text', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your import licence number', dueOn: inThirtyDays }]);
    expect(set.queued).toBe(1);
    const queued = await row(set.jobs[0].queueId);
    expect(queued).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      kind: 'your-move',
      request_id: p.requestId,
      title: 'Add your import licence number',
    });
    expect(new Date(queued.ref_date).toISOString().slice(0, 10)).toBe(inThirtyDays);
    expect(queued.capability_hash).toBe(sha(pulseCapability(secret, queued.id)));
    expect(queued.mute_token_hash).toBe(sha(signPulseMute(secret, p.requestId)));
    expect(JSON.stringify(queued)).not.toContain(p.email);
    // A message is valid for 24 hours once it can first be sent.
    expect(
      new Date(queued.expires_at).getTime() - new Date(queued.available_at).getTime(),
    ).toBeLessThanOrEqual(86401000);
    const events = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='customer.notification.queued' AND aggregate_id=$1",
        [queued.id],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('import licence');
    expect(JSON.stringify(events)).not.toContain(p.email);
  });

  test('a Move held by the team or by a supplier or buyer queues nothing', async () => {
    const p = await person();
    const set = await setMoves(p, [
      { object: 'the visit dates', holder: 'team' },
      { object: 'the quotation', holder: 'third' },
    ]);
    expect(set.queued).toBe(0);
  });

  test('queueing needs a Corridra team member with the right role, acting on their own command', async () => {
    const p = await person();
    const { commandId } = await setMoves(p, [{ object: 'your trade licence' }], false);
    // A viewer, an outsider and a call with no staff session all fail the same way.
    await expect(
      withTenant(f.runtime, staff(p, 'viewer'), 'missions.read', async ({ db }) =>
        db.query('SELECT customer.enqueue_move_notifications($1)', [commandId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(f.runtime, staff(p, 'other'), 'missions.read', async ({ db }) =>
        db.query('SELECT customer.enqueue_move_notifications($1)', [commandId]),
      ),
    ).rejects.toThrow();
    await expect(
      f.runtime.query('SELECT customer.enqueue_move_notifications($1)', [commandId]),
    ).rejects.toMatchObject({ code: '42501' });
    // Another team member cannot queue for a command they did not make.
    await expect(
      withTenant(f.runtime, staff(p, 'owner'), 'missions.manage', async ({ db }) =>
        db.query('SELECT customer.enqueue_move_notifications($1)', [commandId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(f.runtime, staff(p), 'missions.manage', async ({ db }) =>
        db.query('SELECT customer.enqueue_move_notifications($1)', [randomUUID()]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('a repeat for the same command queues nothing more', async () => {
    const p = await person();
    const first = await setMoves(p, [{ object: 'your trade licence' }]);
    expect(first.queued).toBe(1);
    const again = await withTenant(
      f.runtime,
      staff(p),
      'missions.manage',
      async ({ db }) =>
        (await db.query('SELECT customer.enqueue_move_notifications($1) AS r', [first.commandId]))
          .rows[0].r,
    );
    expect(again).toMatchObject({ queued: 0, reason: 'duplicate' });
  });

  test('seal works once, only for a team member, and an unsealed message cannot be claimed', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your bank letter' }], false);
    const id = set.jobs[0].queueId;
    await expect(claim(id)).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.runtime.query('SELECT customer.seal_notification($1,$2,$3)', [id, sha('a'), sha('b')]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(f.runtime, staff(p, 'viewer'), 'missions.read', async ({ db }) =>
        db.query('SELECT customer.seal_notification($1,$2,$3)', [id, sha('a'), sha('b')]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await withTenant(f.runtime, staff(p), 'missions.manage', async ({ db }) => {
      await db.query('SELECT customer.seal_notification($1,$2,$3)', [
        id,
        sha(pulseCapability(secret, id)),
        sha(signPulseMute(secret, p.requestId)),
      ]);
    });
    await expect(
      withTenant(f.runtime, staff(p), 'missions.manage', async ({ db }) =>
        db.query('SELECT customer.seal_notification($1,$2,$3)', [id, sha('c'), sha('d')]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await claim(id)).status).toBe('CLAIMED');
  });

  test('at most three messages per request and ten per person in a day', async () => {
    const p = await person();
    for (let i = 0; i < 3; i += 1)
      expect((await setMoves(p, [{ object: `document number ${i + 1}` }])).queued).toBe(1);
    expect(await setMoves(p, [{ object: 'document number 4' }])).toMatchObject({
      queued: 0,
      reason: 'cap',
    });
  });

  test('a kind the person left out is not queued, and one turned off later is suppressed at the door', async () => {
    const p = await person();
    await savePrefs(p, { kinds: ['complete'] });
    expect(await setMoves(p, [{ object: 'your trade licence' }])).toMatchObject({
      queued: 0,
      reason: 'kind-off',
    });
    const q = await person();
    const set = await setMoves(q, [{ object: 'your trade licence' }]);
    await savePrefs(q, { kinds: ['update'] });
    expect(await claim(set.jobs[0].queueId)).toEqual({ status: 'SUPPRESSED' });
    expect((await row(set.jobs[0].queueId)).finished_at).not.toBeNull();
  });

  test('a Move that was cleared or done before sending is suppressed, never sent', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    await moves.command(staff(p), {
      action: 'clear',
      commandId: randomUUID(),
      missionId: p.missionId,
    });
    expect(await claim(set.jobs[0].queueId)).toEqual({ status: 'SUPPRESSED' });
  });
});

describe('sending', () => {
  test('claim returns ids, a title and a date and no address; finish records the outcome once', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your import licence number', dueOn: inThirtyDays }]);
    const id = set.jobs[0].queueId;
    const claimed = await claim(id);
    expect(claimed).toMatchObject({ status: 'CLAIMED', attempt: 1, digest: false, language: null });
    expect(claimed.items).toEqual([
      {
        requestId: p.requestId,
        kind: 'your-move',
        title: 'Add your import licence number',
        date: inThirtyDays,
      },
    ]);
    expect(JSON.stringify(claimed)).not.toContain(p.email);
    expect((await claim(id)).status).toBe('LEASED');
    expect(await finish(id, 'SENT')).toEqual({ status: 'SENT' });
    expect((await claim(id)).status).toBe('SENT');
    expect(await finish(id, 'TRANSIENT')).toEqual({ status: 'SENT' });
    await expect(
      f.owner.query(
        "UPDATE customer_private.notification_outbox SET status='PENDING' WHERE id=$1",
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      f.owner.query('DELETE FROM customer_private.notification_outbox WHERE id=$1', [id]),
    ).rejects.toThrow();
  });

  test('a wrong capability, an unknown message and a short capability get the same refusal', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    const id = set.jobs[0].queueId;
    for (const call of [
      () => f.runtime.query('SELECT customer.claim_notification($1,$2)', [id, 'w'.repeat(40)]),
      () =>
        f.runtime.query('SELECT customer.claim_notification($1,$2)', [
          randomUUID(),
          pulseCapability(secret, id),
        ]),
      () => f.runtime.query('SELECT customer.claim_notification($1,$2)', [id, 'short']),
      () =>
        f.runtime.query('SELECT customer.finish_notification($1,$2,$3)', [
          id,
          'w'.repeat(40),
          'SENT',
        ]),
    ])
      await expect(call()).rejects.toMatchObject({ code: '42501' });
  });

  test('a temporary failure waits and retries; three attempts end it; a permanent failure ends it at once', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    const id = set.jobs[0].queueId;
    await claim(id);
    expect(await finish(id, 'TRANSIENT')).toEqual({ status: 'PENDING' });
    expect((await claim(id)).status).toBe('WAIT');
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await f.owner.query(
        'UPDATE customer_private.notification_outbox SET available_at=clock_timestamp() WHERE id=$1',
        [id],
      );
      expect((await claim(id)).attempt).toBe(attempt);
      await finish(id, 'TRANSIENT');
    }
    expect((await row(id)).status).toBe('DEAD');
    const q = await person();
    const second = await setMoves(q, [{ object: 'your trade licence' }]);
    await claim(second.jobs[0].queueId);
    expect(await finish(second.jobs[0].queueId, 'PERMANENT')).toEqual({ status: 'DEAD' });
  });

  test('a Move written at the end of the five minute check is still queued and sealed, and a check older than ten minutes is refused', async () => {
    const p = await person();
    const commandId = randomUUID();
    await moves.command(staff(p), {
      action: 'set',
      commandId,
      missionId: p.missionId,
      moves: [{ verb: 'Add', holder: 'customer', dueOn: null, object: 'your trade licence' }],
    });
    const queueAfter = async (age: string) => {
      await f.owner.query(`UPDATE identity.assurance SET verified_at=now()-interval '${age}'`);
      try {
        return await withTenant(f.runtime, staff(p), 'missions.manage', async ({ db }) => {
          const r = (
            await db.query('SELECT customer.enqueue_move_notifications($1) AS r', [commandId])
          ).rows[0].r as { queued: number; jobs: Job[] };
          for (const job of r.jobs)
            await db.query('SELECT customer.seal_notification($1,$2,$3)', [
              job.queueId,
              sha(pulseCapability(secret, job.queueId)),
              sha(signPulseMute(secret, job.requestId)),
            ]);
          return r;
        });
      } finally {
        await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
      }
    };
    await expect(queueAfter('11 minutes')).rejects.toMatchObject({ code: '42501' });
    const queued = await queueAfter('6 minutes');
    expect(queued.queued).toBe(1);
    expect((await claim(queued.jobs[0].queueId)).status).toBe('CLAIMED');
  });

  test('a retry never moves a message past its own expiry', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    const id = set.jobs[0].queueId;
    expect((await claim(id)).status).toBe('CLAIMED');
    await f.owner.query(
      'ALTER TABLE customer_private.notification_outbox DISABLE TRIGGER notification_outbox_guard',
    );
    try {
      await f.owner.query(
        "UPDATE customer_private.notification_outbox SET available_at=clock_timestamp()-interval '23 hours',expires_at=clock_timestamp()+interval '3 seconds',created_at=clock_timestamp()-interval '24 hours' WHERE id=$1",
        [id],
      );
    } finally {
      await f.owner.query(
        'ALTER TABLE customer_private.notification_outbox ENABLE TRIGGER notification_outbox_guard',
      );
    }
    expect(await finish(id, 'TRANSIENT')).toEqual({ status: 'PENDING' });
    const after = await row(id);
    expect(new Date(after.available_at).getTime()).toBeLessThan(
      new Date(after.expires_at).getTime(),
    );
  });

  test('an expired message is dead and cannot be claimed', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    const id = set.jobs[0].queueId;
    await f.owner.query(
      'ALTER TABLE customer_private.notification_outbox DISABLE TRIGGER notification_outbox_guard',
    );
    try {
      await f.owner.query(
        "UPDATE customer_private.notification_outbox SET available_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 hour',created_at=clock_timestamp()-interval '26 hours' WHERE id=$1",
        [id],
      );
    } finally {
      await f.owner.query(
        'ALTER TABLE customer_private.notification_outbox ENABLE TRIGGER notification_outbox_guard',
      );
    }
    expect((await claim(id)).status).toBe('DEAD');
  });

  test('quiet hours only delay: the message waits and keeps a full day of validity from when it can be sent', async () => {
    const p = await person();
    // A window that covers the present moment in UTC, so the message must wait for it to end.
    const now = new Date();
    const hhmm = (d: Date) => d.toISOString().slice(11, 16);
    await savePrefs(p, {
      from: hhmm(new Date(now.getTime() - 3600000)),
      to: hhmm(new Date(now.getTime() + 3600000)),
    });
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    const queued = await row(set.jobs[0].queueId);
    expect(new Date(queued.available_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(queued.available_at).getTime() - Date.now()).toBeLessThanOrEqual(
      2 * 3600000 + 60000,
    );
    expect(
      new Date(queued.expires_at).getTime() - new Date(queued.available_at).getTime(),
    ).toBeLessThanOrEqual(86401000);
    expect(await claim(queued.id)).toMatchObject({ status: 'WAIT' });
    expect((await row(queued.id)).status).toBe('PENDING');
  });

  test('a daily digest sends everything due for the person in one message', async () => {
    const p = await person();
    await savePrefs(p, { digest: true });
    // The same person with a second request: a second Move on the same request would replace the first.
    const again = await person(p.email, p.subject);
    const first = await setMoves(p, [{ object: 'your trade licence' }]);
    const second = await setMoves(again, [{ object: 'your bank letter' }]);
    const ids = [first.jobs[0].queueId, second.jobs[0].queueId];
    for (const id of ids) {
      expect(new Date((await row(id)).available_at).getTime()).toBeGreaterThan(Date.now());
      await makeDue(id);
    }
    const lead = await claim(ids[0]);
    expect(lead).toMatchObject({ status: 'CLAIMED', digest: true });
    expect(lead.items.map((i: { title: string }) => i.title)).toEqual([
      'Add your trade licence',
      'Add your bank letter',
    ]);
    expect((await claim(ids[1])).status).toBe('LEASED');
    expect(await finish(ids[0], 'SENT')).toEqual({ status: 'SENT' });
    expect((await row(ids[1])).status).toBe('SENT');
  });

  test('two claims for one person at the same moment make one digest, never two', async () => {
    // Found in review: each claim used to lock its own row first, skip the other's, and lead its own group.
    for (let round = 0; round < 8; round += 1) {
      const p = await person();
      await savePrefs(p, { digest: true });
      const again = await person(p.email, p.subject);
      const first = await setMoves(p, [{ object: 'your trade licence' }]);
      const second = await setMoves(again, [{ object: 'your bank letter' }]);
      const ids = [first.jobs[0].queueId, second.jobs[0].queueId];
      for (const id of ids) await makeDue(id);
      const results = await Promise.all(ids.map((id) => claim(id)));
      const claimed = results.filter((r) => r.status === 'CLAIMED');
      expect(claimed, `round ${round}`).toHaveLength(1);
      expect(claimed[0].items, `round ${round}`).toHaveLength(2);
      expect(
        results.filter((r) => r.status === 'LEASED'),
        `round ${round}`,
      ).toHaveLength(1);
      const lead = results[0].status === 'CLAIMED' ? ids[0] : ids[1];
      expect(await finish(lead, 'SENT')).toEqual({ status: 'SENT' });
      for (const id of ids) expect((await row(id)).status).toBe('SENT');
    }
  });
});

describe('muting', () => {
  test('a valid token mutes one request once, suppresses what is waiting and blocks later messages', async () => {
    const p = await person();
    const other = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    const token = signPulseMute(secret, p.requestId);
    expect(await mute(p.requestId, token)).toEqual({ muted: true, already: false });
    expect(await mute(p.requestId, token)).toEqual({ muted: true, already: true });
    expect((await row(set.jobs[0].queueId)).status).toBe('SUPPRESSED');
    expect(await setMoves(p, [{ object: 'your bank letter' }])).toMatchObject({
      queued: 0,
      reason: 'muted',
    });
    // Another request of someone else is unaffected.
    expect((await setMoves(other, [{ object: 'your trade licence' }])).queued).toBe(1);
    const events = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='customer.notification.muted' AND aggregate_id=$1",
        [p.requestId],
      )
    ).rows;
    expect(events).toHaveLength(1);
  });

  test('a wrong token, a token of another request and an unknown request get the same refusal', async () => {
    const a = await person();
    const b = await person();
    await setMoves(a, [{ object: 'your trade licence' }]);
    await setMoves(b, [{ object: 'your trade licence' }]);
    for (const call of [
      () => mute(a.requestId, signPulseMute(secret, b.requestId)),
      () => mute(a.requestId, 'A'.repeat(43)),
      () => mute(randomUUID(), signPulseMute(secret, a.requestId)),
      () => mute(a.requestId, 'short'),
    ])
      await expect(call()).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.notification_mute WHERE request_id=ANY($1)',
          [[a.requestId, b.requestId]],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  test('a muted request stays muted when the control is closed and reopened', async () => {
    const p = await person();
    await setMoves(p, [{ object: 'your trade licence' }]);
    await mute(p.requestId, signPulseMute(secret, p.requestId));
    await setControl(false);
    await setControl(true);
    expect(await setMoves(p, [{ object: 'your bank letter' }])).toMatchObject({
      queued: 0,
      reason: 'muted',
    });
  });
});

describe('the closed control', () => {
  test('stops claiming and queueing, keeps every record, and resumes when reopened', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your trade licence' }]);
    await setControl(false);
    expect((await claim(set.jobs[0].queueId)).status).toBe('CLOSED');
    const q = await person();
    expect(await setMoves(q, [{ object: 'your bank letter' }], false)).toMatchObject({
      queued: 0,
      reason: 'closed',
    });
    await setControl(true);
    expect((await claim(set.jobs[0].queueId)).status).toBe('CLAIMED');
  });
});

describe('the application service', () => {
  const env = {
    DATA_ENVIRONMENT: 'real',
    CORRIDRA_REAL_USE_ENABLED: 'true',
    CORRIDRA_PULSE_ENABLED: 'true',
    APP_ORIGIN: 'https://corridra.test',
    NEON_AUTH_BASE_URL: 'https://ep-flow.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
    CUSTOMER_AUTH_MAIL_KEY: 'resend-test-key-0123456789',
    CUSTOMER_AUTH_MAIL_FROM: 'sender@mail.corridra.test',
    CUSTOMER_AUTH_MAIL_REPLY_TO: 'reply@corridra.test',
  } as NodeJS.ProcessEnv;
  type Sent = { to: string; subject: string; html: string; text: string; key: string };
  const sent: Sent[] = [];
  let failNext = 0;
  const sender: MailSender = async ({ to, message, idempotencyKey }) => {
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('provider down');
    }
    sent.push({
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      key: idempotencyKey,
    });
  };
  const addresses = new Map<string, string>();
  const withSource: RecipientPort = {
    available: true,
    resolve: async (principalId) => {
      const address = addresses.get(principalId);
      return address ? { address, name: 'Amina' } : null;
    },
  };
  const principalOf = async (p: Person) =>
    (
      await f.owner.query('SELECT principal_id FROM customer_private.owned_request WHERE id=$1', [
        p.requestId,
      ])
    ).rows[0].principal_id as string;
  const service = () => new PulseService(f.runtime, secret, withSource, sender);
  /** Sets a Move as the team, then lets the application queue and seal it, as the route does. */
  async function queued(p: Person, object = 'your import licence number') {
    addresses.set(await principalOf(p), p.email);
    const commandId = randomUUID();
    await moves.command(staff(p), {
      action: 'set',
      commandId,
      missionId: p.missionId,
      moves: [{ verb: 'Add', object, holder: 'customer', dueOn: inThirtyDays }],
    });
    return service().enqueueForCommand(staff(p), commandId, env);
  }

  test('with no address source nothing is claimed and the message waits to expire', async () => {
    const p = await person();
    const jobs = await queued(p);
    expect(jobs).toHaveLength(1);
    const unsourced = new PulseService(f.runtime, secret);
    expect(unsourced.canSend).toBe(false);
    expect(await unsourced.send(jobs[0], env)).toBe('UNAVAILABLE');
    expect(await row(jobs[0].queueId)).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  test('sends one email to the verified account holder with titles and dates only', async () => {
    const p = await person();
    const [job] = await queued(p);
    sent.length = 0;
    expect(await service().send(job, env)).toBe('SENT');
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail).toMatchObject({ to: p.email, key: `pulse:${job.queueId}` });
    expect(mail.subject).toBe('One thing needs you');
    expect(mail.text).toContain('Add your import licence number');
    expect(mail.text).toContain(`https://corridra.test/account/requests/${p.requestId}`);
    expect(mail.text).toContain(
      `https://corridra.test/pulse/mute/${p.requestId}#t=${signPulseMute(secret, p.requestId)}`,
    );
    expect(mail.text).toContain('https://corridra.test/account/notifications');
    expect(mail.html).not.toMatch(/<img/i);
    expect((await row(job.queueId)).status).toBe('SENT');
    // A second attempt after the send finds it finished and sends nothing more.
    expect(await service().send(job, env)).toBe('SENT');
    expect(sent).toHaveLength(1);
  });

  test('a provider failure retries later, then sends once', async () => {
    const p = await person();
    const [job] = await queued(p);
    sent.length = 0;
    failNext = 1;
    expect(await service().send(job, env)).toBe('RETRY');
    expect(await service().send(job, env)).toBe('WAIT');
    await makeDue(job.queueId);
    expect(await service().send(job, env)).toBe('SENT');
    expect(sent).toHaveLength(1);
  });

  test('an account with no address ends the message without sending', async () => {
    const p = await person();
    const [job] = await queued(p);
    addresses.delete(await principalOf(p));
    sent.length = 0;
    expect(await service().send(job, env)).toBe('DEAD');
    expect(sent).toHaveLength(0);
  });

  test('a person on a daily digest gets one email for everything that is due', async () => {
    const p = await person();
    await savePrefs(p, { digest: true });
    const again = await person(p.email, p.subject);
    const [first] = await queued(p, 'your trade licence');
    const [second] = await queued(again, 'your bank letter');
    await makeDue(first.queueId);
    await makeDue(second.queueId);
    sent.length = 0;
    expect(await service().send(first, env)).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('What is waiting for you');
    expect(sent[0].text).toContain('Add your trade licence');
    expect(sent[0].text).toContain('Add your bank letter');
    expect(sent[0].text).not.toContain('/pulse/mute/');
    expect(await service().send(second, env)).toBe('SENT');
    expect(sent).toHaveLength(1);
  });

  test('queueing is off with the application switch, and never fails a Move', async () => {
    const p = await person();
    addresses.set(await principalOf(p), p.email);
    const commandId = randomUUID();
    await moves.command(staff(p), {
      action: 'set',
      commandId,
      missionId: p.missionId,
      moves: [{ verb: 'Add', object: 'your trade licence', holder: 'customer', dueOn: null }],
    });
    const off = { ...env, CORRIDRA_PULSE_ENABLED: 'false' } as NodeJS.ProcessEnv;
    expect(await service().enqueueForCommand(staff(p), commandId, off)).toEqual([]);
    expect(await service().enqueueForCommand(staff(p), randomUUID(), env)).toEqual([]);
    expect(await service().enqueueForCommand(staff(p, 'viewer'), commandId, env)).toEqual([]);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.notification_outbox WHERE request_id=$1',
          [p.requestId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await service().enqueueForCommand(staff(p), commandId, env)).length).toBe(1);
  });

  test('muting through the service works once and refuses a wrong token the same way', async () => {
    const p = await person();
    const [job] = (await queued(p)) as PulseJob[];
    await expect(service().mute(p.requestId, 'A'.repeat(43))).rejects.toMatchObject({
      code: '42501',
    });
    expect(await service().mute(p.requestId, signPulseMute(secret, p.requestId))).toEqual({
      muted: true,
      already: false,
    });
    sent.length = 0;
    expect(await service().send(job, env)).toBe('SUPPRESSED');
    expect(sent).toHaveLength(0);
  });
});

describe('email is off until a person switches it on, and the address is read at send time', () => {
  const env = {
    DATA_ENVIRONMENT: 'real',
    CORRIDRA_REAL_USE_ENABLED: 'true',
    CORRIDRA_PULSE_ENABLED: 'true',
    APP_ORIGIN: 'https://corridra.test',
    NEON_AUTH_BASE_URL: 'https://ep-flow.neonauth.eu-central-1.aws.neon.tech/neondb/auth',
    CUSTOMER_AUTH_MAIL_KEY: 'resend-test-key-0123456789',
    CUSTOMER_AUTH_MAIL_FROM: 'sender@mail.corridra.test',
    CUSTOMER_AUTH_MAIL_REPLY_TO: 'reply@corridra.test',
  } as NodeJS.ProcessEnv;
  const sent: { to: string; text: string }[] = [];
  const sender: MailSender = async ({ to, message }) => {
    sent.push({ to, text: message.text });
  };
  const service = () =>
    new PulseService(f.runtime, secret, databaseRecipientSource(f.runtime), sender);
  const recipient = async (
    id: string,
    capability = pulseCapability(secret, id),
    pool = f.runtime,
  ) =>
    (await pool.query('SELECT customer.notification_recipient($1,$2) AS r', [id, capability]))
      .rows[0].r;
  // The sign-in provider keeps its users in neon_auth.user in the same database; this is the shape the
  // lookup reads (id, name, email, emailVerified).
  const addUser = (
    who: Person,
    over: Partial<{ name: string | null; email: string; verified: boolean }> = {},
  ) =>
    f.owner.query(
      'INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,$4)',
      [
        who.subject,
        over.name === undefined ? 'Amina Rahman' : over.name,
        over.email ?? who.email,
        over.verified ?? true,
      ],
    );
  const leased = async (who: Person) => {
    const set = await setMoves(who, [{ object: 'your import licence number' }]);
    expect(set.queued).toBe(1);
    expect((await claim(set.jobs[0].queueId)).status).toBe('CLAIMED');
    return set.jobs[0].queueId as string;
  };
  beforeAll(async () => {
    await f.owner.query('CREATE SCHEMA IF NOT EXISTS neon_auth');
    await f.owner.query(`${providerTable.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')}`);
  });
  const queuedByService = async (who: Person) => {
    const commandId = randomUUID();
    await moves.command(staff(who), {
      action: 'set',
      commandId,
      missionId: who.missionId,
      moves: [
        { verb: 'Add', object: 'your import licence number', holder: 'customer', dueOn: null },
      ],
    });
    return service().enqueueForCommand(staff(who), commandId, env);
  };

  test('a person who has not chosen is never queued, and switching on is what starts it', async () => {
    const p = await person(undefined, undefined, false);
    expect(await setMoves(p, [{ object: 'your import licence number' }])).toMatchObject({
      queued: 0,
      reason: 'kind-off',
    });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.notification_outbox WHERE request_id=$1',
          [p.requestId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await savePrefs(p)).toEqual({ saved: true, version: 1 });
    expect(await setMoves(p, [{ object: 'your bank letter' }])).toMatchObject({ queued: 1 });
  });

  test('switching email off suppresses what is waiting, and the choice is kept as a new version', async () => {
    const p = await person();
    const set = await setMoves(p, [{ object: 'your import licence number' }]);
    expect(set.queued).toBe(1);
    expect(await savePrefs(p, { kinds: [] })).toEqual({ saved: true, version: 2 });
    expect(await prefs(p)).toMatchObject({ version: 2, kinds: [] });
    expect((await claim(set.jobs[0].queueId)).status).toBe('SUPPRESSED');
  });

  const ready = async () =>
    (await f.owner.query('SELECT customer.notification_recipient_ready() AS r')).rows[0].r;
  const providerTable =
    'CREATE TABLE neon_auth."user"(id uuid PRIMARY KEY,name text,email text,"emailVerified" boolean NOT NULL DEFAULT false)';

  test('the sign-in table must be readable with the columns the lookup needs before email can be opened', async () => {
    await f.owner.query('DROP TABLE IF EXISTS neon_auth."user"');
    expect(await ready()).toBe(false);
    expect(await emailAddressSourceReady(f.owner)).toBe(false);
    await expect(
      f.runtime.query('SELECT customer.notification_recipient_ready()'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      f.auth.query('SELECT customer.notification_recipient_ready()'),
    ).rejects.toMatchObject({ code: '42501' });
    await f.owner.query(
      'CREATE TABLE neon_auth."user"(id uuid PRIMARY KEY,email text,"emailVerified" boolean NOT NULL DEFAULT false)',
    );
    expect(await ready()).toBe(false);
    await f.owner.query('ALTER TABLE neon_auth."user" ADD COLUMN name text');
    expect(await ready()).toBe(true);
    expect(await emailAddressSourceReady(f.owner)).toBe(true);
  });

  test('a database owner without access to the provider schema or table gets false, never an error, and a failure to ask counts as not ready', async () => {
    // Run as an owner with no rights: the function is owned by an ordinary role for this one transaction.
    const db = await f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query('CREATE ROLE pulse_probe_owner NOLOGIN');
      await db.query('GRANT CREATE ON SCHEMA customer TO pulse_probe_owner');
      await db.query(
        'ALTER FUNCTION customer.notification_recipient_ready() OWNER TO pulse_probe_owner',
      );
      const answer = async () =>
        (await db.query('SELECT customer.notification_recipient_ready() AS r')).rows[0].r;
      expect(await answer()).toBe(false);
      await db.query('GRANT USAGE ON SCHEMA neon_auth TO pulse_probe_owner');
      expect(await answer()).toBe(false);
      await db.query('GRANT SELECT ON neon_auth."user" TO pulse_probe_owner');
      expect(await answer()).toBe(true);
      await db.query('REVOKE USAGE ON SCHEMA neon_auth FROM pulse_probe_owner');
      expect(await answer()).toBe(false);
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    const failing = {
      query: async () => {
        throw new Error('permission denied');
      },
    };
    expect(await emailAddressSourceReady(failing)).toBe(false);
    expect(await ready()).toBe(true);
  });

  test('the address is returned only for a message leased right now to a sender holding the capability', async () => {
    const p = await person();
    await addUser(p);
    const set = await setMoves(p, [{ object: 'your import licence number' }]);
    const id = set.jobs[0].queueId as string;
    // Queued but not leased: refused.
    await expect(recipient(id)).rejects.toMatchObject({ code: '42501' });
    expect((await claim(id)).status).toBe('CLAIMED');
    expect(await recipient(id)).toEqual({ found: true, address: p.email, name: 'Amina Rahman' });
    await expect(recipient(id, 'x'.repeat(30))).rejects.toMatchObject({ code: '42501' });
    await expect(recipient(id, 'short')).rejects.toMatchObject({ code: '42501' });
    await expect(recipient(randomUUID())).rejects.toMatchObject({ code: '42501' });
    await expect(recipient(id, pulseCapability(secret, id), f.auth)).rejects.toMatchObject({
      code: '42501',
    });
    // Once finished it is no longer leased, so the address cannot be read for it again.
    await finish(id, 'SENT');
    await expect(recipient(id)).rejects.toMatchObject({ code: '42501' });
  });

  test('no address is given while the control is closed or after the lease has run out', async () => {
    const p = await person();
    await addUser(p);
    const id = await leased(p);
    expect((await recipient(id)).found).toBe(true);
    await setControl(false);
    try {
      await expect(recipient(id)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await setControl(true);
    }
    expect((await recipient(id)).found).toBe(true);
    await f.owner.query(
      'ALTER TABLE customer_private.notification_outbox DISABLE TRIGGER notification_outbox_guard',
    );
    try {
      await f.owner.query(
        "UPDATE customer_private.notification_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
    } finally {
      await f.owner.query(
        'ALTER TABLE customer_private.notification_outbox ENABLE TRIGGER notification_outbox_guard',
      );
    }
    await expect(recipient(id)).rejects.toMatchObject({ code: '42501' });
  });

  test('an account with no verified address, a missing account, an odd address or email switched off gets no address', async () => {
    const unverified = await person();
    await addUser(unverified, { verified: false });
    expect(await recipient(await leased(unverified))).toEqual({ found: false });

    const missing = await person();
    expect(await recipient(await leased(missing))).toEqual({ found: false });

    const odd = await person();
    await addUser(odd, { email: 'two words@acme-textiles.com' });
    expect(await recipient(await leased(odd))).toEqual({ found: false });

    const off = await person();
    await addUser(off);
    const id = await leased(off);
    await savePrefs(off, { kinds: [] });
    expect(await recipient(id)).toEqual({ found: false });

    const noName = await person();
    await addUser(noName, { name: null });
    expect(await recipient(await leased(noName))).toMatchObject({ found: true, name: '' });
  });

  test('the address is never written down by the lookup', async () => {
    const p = await person();
    await addUser(p);
    const id = await leased(p);
    expect((await recipient(id)).address).toBe(p.email);
    for (const table of ['notification_outbox', 'notification_preference', 'notification_mute'])
      expect(
        (
          await f.owner.query(
            `SELECT count(*)::int n FROM customer_private.${table} t WHERE to_jsonb(t)::text ILIKE $1`,
            [`%${p.email}%`],
          )
        ).rows[0].n,
      ).toBe(0);
  });

  test('the service sends to the verified address, and ends cleanly or holds back without one', async () => {
    const p = await person();
    await addUser(p);
    const [job] = await queuedByService(p);
    sent.length = 0;
    expect(await service().send(job, env)).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(p.email);
    expect(sent[0].text).toContain('https://corridra.test/account/notifications');

    const unverified = await person();
    await addUser(unverified, { verified: false });
    const [dead] = await queuedByService(unverified);
    sent.length = 0;
    expect(await service().send(dead, env)).toBe('DEAD');
    expect(sent).toHaveLength(0);

    const changedMind = await person();
    await addUser(changedMind);
    const [held] = await queuedByService(changedMind);
    await savePrefs(changedMind, { kinds: [] });
    expect(await service().send(held, env)).toBe('SUPPRESSED');
    expect(sent).toHaveLength(0);
  });
  test('the owner queries in the privacy review record run against the installed tables', async () => {
    const record = readFileSync('docs/product/pulse-privacy-review-2026-10-25.md', 'utf8');
    const block = record.match(/```sql\n([\s\S]*?)```/)?.[1] ?? '';
    const statements = block
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    for (const statement of statements)
      await expect(
        f.owner.query(statement.replaceAll('<sign-in subject>', randomUUID())),
      ).resolves.toBeDefined();
  });
});
