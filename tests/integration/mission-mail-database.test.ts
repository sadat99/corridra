import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fixture } from './support';
import { sessionHash, type DatabaseClient } from '../../packages/db/src/index';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { configureMissionMail } from '../../packages/auth/src/customer-mission-mail-configuration';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';
import { signMissionMailMute } from '../../packages/auth/src/mission-mail-mute';

// Real database, real roles. Proves the mission mail module: closed by default, only the verified
// account holder's own request can queue mail, the address lives only in a short-lived table,
// the mute works once and for one request, and nothing here widens an existing grant.
const issuer = 'https://ep-mission-mail.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const secret = 'mission-mail-local-test-secret-0123456789';
const reason = 'Owner approved mission mail for the local fixture tests';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let f: Awaited<ReturnType<typeof fixture>>;
let missions: MissionService;

type Person = {
  subject: string;
  email: string;
  requestId: string;
  capability: string;
  mute: string;
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
  return {
    subject,
    email,
    requestId,
    capability: `capability-${randomBytes(24).toString('hex')}`,
    mute: signMissionMailMute(secret, requestId),
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

const enqueue = (p: Person, over: Partial<Record<string, string>> = {}, email?: string) =>
  asCustomer(
    p,
    async (db) =>
      (
        await db.query('SELECT customer.enqueue_mission_mail($1,$2,$3,$4,$5,$6,$7,$8) AS r', [
          over.request ?? p.requestId,
          over.kind ?? 'request-received',
          over.key ?? 'received',
          over.recipient ?? p.email,
          over.name ?? 'Amina Rahman',
          over.job ?? 'Sell in a new market: Spain',
          over.capability ?? sha(p.capability),
          over.mute ?? sha(p.mute),
        ])
      ).rows[0].r as { queued: boolean; reason?: string; id?: string },
    email,
  );
const claim = async (id: string, capability: string) =>
  (await f.runtime.query('SELECT customer.claim_mission_mail($1,$2) AS r', [id, capability]))
    .rows[0].r;
const finish = async (id: string, capability: string, outcome: string) =>
  (
    await f.runtime.query('SELECT customer.finish_mission_mail($1,$2,$3) AS r', [
      id,
      capability,
      outcome,
    ])
  ).rows[0].r;
const mute = async (request: string, token: string) =>
  (await f.runtime.query('SELECT customer.mute_mission_mail($1,$2) AS r', [request, token])).rows[0]
    .r;
const row = async (id: string) =>
  (await f.owner.query('SELECT * FROM customer_private.mission_mail_queue WHERE id=$1', [id]))
    .rows[0];
const addressRows = async (id: string) =>
  (
    await f.owner.query('SELECT * FROM customer_private.mission_mail_recipient WHERE queue_id=$1', [
      id,
    ])
  ).rows;
const setControl = (enabled: boolean) => configureMissionMail(f.owner, { enabled, reason });

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerMissionMail(f.owner);
  await pinCustomerAuthority(f.owner, { issuer, executorId: f.serviceId });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await configureCustomerRealUse(f.owner, {
    enabled: true,
    reason: 'Owner approved real work for the mission mail fixture tests',
  });
  missions = new MissionService(f.runtime, 'mission-mail-intake-local-secret', 'real');
});
afterAll(async () => {
  await f?.close();
});

describe('installation', () => {
  test('is idempotent and records exactly one applied file with its hash', async () => {
    const before = (await f.owner.query('SELECT * FROM customer_mission_mail_migrations.applied'))
      .rows;
    expect(before).toHaveLength(1);
    await migrateCustomerMissionMail(f.owner);
    expect(
      (await f.owner.query('SELECT * FROM customer_mission_mail_migrations.applied')).rows,
    ).toEqual(before);
    await f.owner.query(
      "UPDATE customer_mission_mail_migrations.applied SET sha256=repeat('0',64)",
    );
    await expect(migrateCustomerMissionMail(f.owner)).rejects.toThrow('history mismatch');
    await f.owner.query('UPDATE customer_mission_mail_migrations.applied SET sha256=$1', [
      before[0].sha256,
    ]);
  });

  test('the control starts closed, so nothing is queued and the request is unaffected', async () => {
    const p = await person();
    expect(await enqueue(p)).toEqual({ queued: false, reason: 'closed' });
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM customer_private.mission_mail_queue'))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.owned_request WHERE id=$1',
          [p.requestId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('runtime and auth roles cannot read or write any of the tables, or run the internal functions', async () => {
    for (const pool of [f.runtime, f.auth]) {
      for (const table of [
        'mission_mail_control',
        'mission_mail_queue',
        'mission_mail_recipient',
        'mission_mail_mute',
      ])
        for (const sql of [
          `SELECT * FROM customer_private.${table}`,
          `DELETE FROM customer_private.${table}`,
        ])
          await expect(pool.query(sql)).rejects.toMatchObject({ code: '42501' });
      for (const fn of [
        'customer_private.mission_mail_open()',
        'customer_private.mission_mail_expire()',
      ])
        await expect(pool.query(`SELECT ${fn}`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      f.auth.query('SELECT customer.claim_mission_mail($1,$2)', [randomUUID(), 'x'.repeat(30)]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('configuration is an offline owner operation, idempotent, and keeps every record when closed', async () => {
    await expect(configureMissionMail(f.runtime, { enabled: true, reason })).rejects.toThrow();
    await expect(configureMissionMail(f.auth, { enabled: true, reason })).rejects.toThrow();
    await expect(
      configureMissionMail(f.owner, { enabled: true, reason: 'short' }),
    ).rejects.toThrow();
    expect(await setControl(false)).toEqual({ enabled: false, changed: false });
    expect(await setControl(true)).toEqual({ enabled: true, changed: true });
    expect(await setControl(true)).toEqual({ enabled: true, changed: false });
    expect(
      (
        await f.owner.query(
          'SELECT version,enabled FROM customer_private.mission_mail_control ORDER BY version',
        )
      ).rows,
    ).toEqual([{ version: 1, enabled: true }]);
    await expect(
      f.owner.query('UPDATE customer_private.mission_mail_control SET enabled=false'),
    ).rejects.toThrow();
  });
});

describe('queueing', () => {
  test('queues one message for the verified account holder, keeping the address only in the short table', async () => {
    const p = await person();
    const result = await enqueue(p);
    expect(result.queued).toBe(true);
    const queued = await row(result.id!);
    expect(queued).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      kind: 'request-received',
      request_id: p.requestId,
    });
    expect(JSON.stringify(queued)).not.toContain(p.email);
    expect(queued.capability_hash).toBe(sha(p.capability));
    expect(queued.mute_token_hash).toBe(sha(p.mute));
    expect((await addressRows(result.id!))[0]).toMatchObject({
      address: p.email.toLowerCase(),
      recipient_name: 'Amina Rahman',
    });
    // The expiry is 24 hours at most.
    expect(
      new Date(queued.expires_at).getTime() - new Date(queued.created_at).getTime(),
    ).toBeLessThanOrEqual(86401000);
    const events = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='customer.mission_mail.queued' AND aggregate_id=$1",
        [result.id],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(p.email);
    expect(JSON.stringify(events)).not.toContain('Amina');
  });

  test('a repeat is a no-op, not a second message', async () => {
    const p = await person();
    const first = await enqueue(p);
    expect(await enqueue(p)).toEqual({ queued: false, reason: 'duplicate' });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM customer_private.mission_mail_queue WHERE request_id=$1',
          [p.requestId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await row(first.id!)).status).toBe('PENDING');
  });

  test('refuses an address that is not the verified one, however it is written', async () => {
    const p = await person();
    await expect(enqueue(p, { recipient: 'someone-else@business.test' })).rejects.toMatchObject({
      code: '42501',
    });
    await expect(enqueue(p, { recipient: ` ${p.email.toUpperCase()} ` })).resolves.toMatchObject({
      queued: true,
    });
    const q = await person();
    // Proof for a different address than the one asked for.
    await expect(
      enqueue(q, {}, 'a-different-verified-address@business.test'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test("refuses another person's request, an unknown request and unavailable kinds", async () => {
    const a = await person();
    const b = await person();
    await expect(enqueue(a, { request: b.requestId })).rejects.toMatchObject({ code: '42501' });
    await expect(enqueue(a, { request: randomUUID() })).rejects.toMatchObject({ code: '42501' });
    await expect(enqueue(a, { kind: 'your-move' })).rejects.toMatchObject({ code: '23514' });
    await expect(enqueue(a, { kind: 'anything-else' })).rejects.toMatchObject({ code: '23514' });
    await expect(enqueue(a, { capability: 'not-hex' })).rejects.toMatchObject({ code: '23514' });
    await expect(enqueue(a, { mute: 'x'.repeat(64) })).rejects.toMatchObject({ code: '23514' });
  });

  test('a request that belongs to a sample workspace is never queued', async () => {
    const p = await person();
    const workspace = (
      await f.owner.query('SELECT workspace_id FROM customer_private.owned_request WHERE id=$1', [
        p.requestId,
      ])
    ).rows[0].workspace_id as string;
    await f.owner.query('UPDATE app.tenant SET synthetic=true WHERE id=$1', [workspace]);
    try {
      expect(await enqueue(p)).toEqual({ queued: false, reason: 'sample-workspace' });
      expect(
        (
          await f.owner.query(
            'SELECT count(*)::int n FROM customer_private.mission_mail_queue WHERE request_id=$1',
            [p.requestId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [workspace]);
    }
    expect(await enqueue(p)).toMatchObject({ queued: true });
  });

  test('a caller with no customer session cannot queue', async () => {
    const p = await person();
    await expect(
      f.runtime.query('SELECT customer.enqueue_mission_mail($1,$2,$3,$4,$5,$6,$7,$8)', [
        p.requestId,
        'request-received',
        'received',
        p.email,
        'Name',
        'Job',
        sha(p.capability),
        sha(p.mute),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  test('an address that can never receive mail is not queued, and says so without failing', async () => {
    const reserved = await person('owner-invalid@example.invalid');
    expect(await enqueue(reserved)).toEqual({ queued: false, reason: 'address-not-usable' });
    const sample = await person('owner-example@example.com');
    expect(await enqueue(sample)).toEqual({ queued: false, reason: 'address-not-usable' });
  });
});

describe('sending', () => {
  test('claim needs the capability, gives the address once to the holder, retries with a cap, then dies', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    const bad = await claim(id!, 'capability-wrong-0123456789').catch((e) => e);
    const unknown = await claim(randomUUID(), p.capability).catch((e) => e);
    expect(bad.code).toBe('42501');
    expect(unknown.code).toBe('42501');
    expect(bad.message).toBe(unknown.message);
    const first = await claim(id!, p.capability);
    expect(first).toMatchObject({
      status: 'CLAIMED',
      attempt: 1,
      address: p.email.toLowerCase(),
      name: 'Amina Rahman',
      kind: 'request-received',
      requestId: p.requestId,
    });
    expect(await claim(id!, p.capability)).toEqual({ status: 'LEASED' });
    expect((await finish(id!, p.capability, 'TRANSIENT')).status).toBe('PENDING');
    expect((await claim(id!, p.capability)).status).toBe('WAIT');
    await f.owner.query(
      'UPDATE customer_private.mission_mail_queue SET available_at=clock_timestamp() WHERE id=$1',
      [id],
    );
    expect((await claim(id!, p.capability)).attempt).toBe(2);
    await finish(id!, p.capability, 'TRANSIENT');
    await f.owner.query(
      'UPDATE customer_private.mission_mail_queue SET available_at=clock_timestamp() WHERE id=$1',
      [id],
    );
    expect((await claim(id!, p.capability)).attempt).toBe(3);
    expect((await finish(id!, p.capability, 'TRANSIENT')).status).toBe('DEAD');
    expect(await addressRows(id!)).toHaveLength(0);
    expect(await claim(id!, p.capability)).toEqual({ status: 'DEAD' });
  });

  test('a sent message loses its address and cannot be sent again', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    await claim(id!, p.capability);
    expect((await finish(id!, p.capability, 'SENT')).status).toBe('SENT');
    expect(await addressRows(id!)).toHaveLength(0);
    expect(await claim(id!, p.capability)).toEqual({ status: 'SENT' });
    expect((await finish(id!, p.capability, 'SENT')).status).toBe('SENT');
    await expect(
      f.owner.query("UPDATE customer_private.mission_mail_queue SET status='PENDING' WHERE id=$1", [
        id,
      ]),
    ).rejects.toThrow('cannot change');
  });

  test('a permanent failure ends at once and removes the address', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    await claim(id!, p.capability);
    expect((await finish(id!, p.capability, 'PERMANENT')).status).toBe('DEAD');
    expect(await addressRows(id!)).toHaveLength(0);
  });

  test('finishing needs a claim and the capability, and only known outcomes', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    await expect(finish(id!, p.capability, 'SENT')).rejects.toMatchObject({ code: '42501' });
    await claim(id!, p.capability);
    await expect(finish(id!, 'capability-wrong-0123456789', 'SENT')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(finish(id!, p.capability, 'DONE')).rejects.toMatchObject({ code: '42501' });
  });

  test('an expired message is ended and its address removed, even if never claimed', async () => {
    const p = await person();
    const id = randomUUID();
    await f.owner.query(
      `INSERT INTO customer_private.mission_mail_queue(id,request_id,kind,dedupe_key,capability_hash,mute_token_hash,created_at,expires_at)
      VALUES($1,$2,'request-received','old',$3,$4,clock_timestamp()-interval '48 hours',clock_timestamp()-interval '24 hours')`,
      [id, p.requestId, sha('capability-old-0123456789'), sha(p.mute)],
    );
    await f.owner.query(
      "INSERT INTO customer_private.mission_mail_recipient(queue_id,address,recipient_name,job) VALUES($1,'old@business.test','Old','')",
      [id],
    );
    expect(await claim(id, 'capability-old-0123456789')).toEqual({ status: 'DEAD' });
    expect(await addressRows(id)).toHaveLength(0);
    expect((await row(id)).finished_at).not.toBeNull();
  });

  test('a stale address is purged when the next message is queued, without a claim', async () => {
    const p = await person();
    const id = randomUUID();
    await f.owner.query(
      `INSERT INTO customer_private.mission_mail_queue(id,request_id,kind,dedupe_key,capability_hash,mute_token_hash,created_at,expires_at)
      VALUES($1,$2,'request-received','stale',$3,$4,clock_timestamp()-interval '48 hours',clock_timestamp()-interval '24 hours')`,
      [id, p.requestId, sha('capability-stale-0123456789'), sha(p.mute)],
    );
    await f.owner.query(
      "INSERT INTO customer_private.mission_mail_recipient(queue_id,address,recipient_name,job) VALUES($1,'stale@business.test','Stale','')",
      [id],
    );
    const other = await person();
    await enqueue(other);
    expect(await addressRows(id)).toHaveLength(0);
    expect((await row(id)).status).toBe('DEAD');
  });
});

describe('muting', () => {
  test('the link token mutes one request, once, with no sign-in, and stops pending mail', async () => {
    const a = await person();
    const b = await person();
    const qa = await enqueue(a);
    const qb = await enqueue(b);
    await expect(mute(a.requestId, 'x'.repeat(43))).rejects.toMatchObject({ code: '42501' });
    await expect(mute(a.requestId, 'short')).rejects.toMatchObject({ code: '42501' });
    // The other person's token does not work on this request, and an unknown request is refused alike.
    const wrongRequest = await mute(a.requestId, b.mute).catch((e) => e);
    const unknownRequest = await mute(randomUUID(), a.mute).catch((e) => e);
    expect(wrongRequest.code).toBe('42501');
    expect(unknownRequest.message).toBe(wrongRequest.message);
    expect(await mute(a.requestId, a.mute)).toEqual({ muted: true, already: false });
    expect(await mute(a.requestId, a.mute)).toEqual({ muted: true, already: true });
    expect((await row(qa.id!)).status).toBe('SUPPRESSED');
    expect(await addressRows(qa.id!)).toHaveLength(0);
    expect(await claim(qa.id!, a.capability)).toEqual({ status: 'SUPPRESSED' });
    expect(await enqueue(a, { key: 'later' })).toEqual({ queued: false, reason: 'muted' });
    // The other request is untouched.
    expect((await row(qb.id!)).status).toBe('PENDING');
    expect((await claim(qb.id!, b.capability)).status).toBe('CLAIMED');
    const muteEvents = (
      await f.owner.query(
        "SELECT payload FROM app.domain_event WHERE type='customer.mission_mail.muted' AND aggregate_id=$1",
        [a.requestId],
      )
    ).rows;
    expect(muteEvents).toHaveLength(1);
    await expect(
      f.owner.query('DELETE FROM customer_private.mission_mail_mute WHERE request_id=$1', [
        a.requestId,
      ]),
    ).rejects.toThrow();
  });

  test('a mute that arrives while a message is being sent wins at the next step', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    await claim(id!, p.capability);
    await mute(p.requestId, p.mute);
    expect((await row(id!)).status).toBe('SUPPRESSED');
    expect((await finish(id!, p.capability, 'SENT')).status).toBe('SUPPRESSED');
  });
});

describe('the control and the history', () => {
  test('closing the control stops queueing and sending but keeps every record', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    expect(await setControl(false)).toEqual({ enabled: false, changed: true });
    expect(await claim(id!, p.capability)).toEqual({ status: 'CLOSED' });
    expect(await enqueue(await person())).toEqual({ queued: false, reason: 'closed' });
    expect((await row(id!)).status).toBe('PENDING');
    expect(await addressRows(id!)).toHaveLength(1);
    await setControl(true);
    expect((await claim(id!, p.capability)).status).toBe('CLAIMED');
  });

  test('queue rows can never be deleted, and identity columns never change, even by the owner', async () => {
    const p = await person();
    const { id } = await enqueue(p);
    await expect(
      f.owner.query('DELETE FROM customer_private.mission_mail_queue WHERE id=$1', [id]),
    ).rejects.toThrow('append only');
    for (const set of [
      "kind='your-move'",
      "request_id='" + randomUUID() + "'",
      "capability_hash=repeat('a',64)",
      "expires_at=expires_at+interval '1 second'",
    ])
      await expect(
        f.owner.query(`UPDATE customer_private.mission_mail_queue SET ${set} WHERE id=$1`, [id]),
      ).rejects.toThrow();
    await expect(
      f.owner.query(
        "UPDATE customer_private.mission_mail_queue SET attempts=0, status='PENDING' WHERE id=$1 AND false",
        [id],
      ),
    ).resolves.toBeDefined();
    await expect(
      f.owner.query("UPDATE customer_private.mission_mail_queue SET status='SENT' WHERE id=$1", [
        id,
      ]),
    ).rejects.toThrow();
  });

  test('installing this module changed no existing grant: customers still cannot read private tables', async () => {
    for (const pool of [f.runtime, f.auth])
      await expect(
        pool.query('SELECT * FROM customer_private.owned_request'),
      ).rejects.toMatchObject({ code: '42501' });
    const executable = (
      await f.owner.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='customer' AND p.proname LIKE '%mission_mail%' AND has_function_privilege('corridra_runtime',p.oid,'EXECUTE') ORDER BY 1`,
      )
    ).rows.map((r) => r.proname);
    expect(executable).toEqual([
      'claim_mission_mail',
      'enqueue_mission_mail',
      'finish_mission_mail',
      'mute_mission_mail',
    ]);
    const authExecutable = (
      await f.owner.query(
        `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('customer','customer_private') AND p.proname LIKE '%mission_mail%' AND has_function_privilege('corridra_auth',p.oid,'EXECUTE')`,
      )
    ).rows[0].n;
    expect(authExecutable).toBe(0);
  });
});
