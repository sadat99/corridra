import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, rawContext } from './support';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { briefSchema, noticeVersion } from '../../packages/domain/src/missions';
let f: Awaited<ReturnType<typeof fixture>>, s: MissionService;
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels for hospitality distributors',
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
});
beforeAll(async () => {
  f = await fixture();
  s = new MissionService(f.runtime, 'unit-test-only-secret');
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
});
afterAll(async () => {
  await f?.close();
});
async function create() {
  return s.submit(randomUUID(), { ...brief(), offer: `Test mission ${randomUUID()}` });
}
const command = (id: string, version = 1, action = 'qualify') => ({
  id,
  version,
  action,
  commandId: randomUUID(),
  reason: 'Reviewed the synthetic brief',
  ownerId: f.users.operator.id,
  nextAction: 'Confirm target requirements',
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  marketCode: 'ES',
  targetProfile: 'Hospitality distributors interested in hotel towels',
});
test('anonymous concurrent retries create one complete mission and one atomic event', async () => {
  const key = randomUUID(),
    body = brief();
  const results = await Promise.all([
    s.submit(key, body),
    s.submit(key, body),
    s.submit(key, body),
  ]);
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  expect(new Set(results.map((r) => r.receipt)).size).toBe(1);
  const id = results[0].id;
  for (const table of [
    'mission',
    'mission_intake',
    'mission_objective',
    'mission_participant',
    'mission_market',
    'mission_window',
    'commercial_intent',
  ])
    expect((await f.owner.query(`SELECT count(*)::int n FROM app.${table}`)).rows[0].n).toBe(1);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type='mission' AND aggregate_id=$1",
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect((await f.runtime.query('SELECT * FROM app.mission')).rowCount).toBe(0);
  const queue = await s.queue(f.users.operator.ctx);
  expect(queue.missions[0].brief).toEqual(body);
  expect(queue.missions[0].notice_version).toBe(noticeVersion);
  expect(queue.missions[0].claim_status).toBe('self_declared');
  expect(await s.receipt(results[0].receipt!)).toMatchObject({ status: 'DRAFT', replies: [] });
  await expect(s.receipt('0'.repeat(64))).rejects.toThrow('unavailable');
  await expect(s.submit(key, { ...body, market: 'Germany' })).rejects.toThrow('Retry key reused');
  const duplicate = await s.submit(randomUUID(), body);
  expect(duplicate).toEqual({ duplicate: true, receipt: undefined });
});
test('server validation rejects real email, invalid windows, unsafe URLs and missing acknowledgement', () => {
  expect(briefSchema.safeParse({ ...brief(), website: '' }).success).toBe(true);
  expect(briefSchema.safeParse({ ...brief(), website: 'garbage' }).success).toBe(false);
  for (const patch of [
    { email: 'real@example.com' },
    { endDate: '2026-10-01' },
    { startDate: '2026-02-30' },
    { timezone: 'Wrong/Timezone' },
    { website: 'javascript:alert(1)' },
    { acknowledged: false },
    { outcomes: [] },
  ])
    expect(briefSchema.safeParse({ ...brief(), ...patch }).success).toBe(false);
});
test('operator commands enforce state, source provenance, idempotency and atomic event/outbox', async () => {
  const { id } = await create();
  await expect(s.command(f.users.operator.ctx, command(id!, 1, 'activate'))).rejects.toThrow(
    'Qualify',
  );
  const v = command(id!);
  const [first, retry] = await Promise.all([
    s.command(f.users.operator.ctx, v),
    s.command(f.users.operator.ctx, v),
  ]);
  expect(first).toEqual({ version: 2 });
  expect(retry).toEqual(first);
  const intake = (await f.owner.query('SELECT brief FROM app.mission_intake WHERE id=$1', [id]))
    .rows[0];
  const claim = (
    await f.owner.query(
      'SELECT c.*,s.kind,s.locator,s.ai_policy FROM app.commercial_intent i JOIN app.claim c ON c.id=i.claim_id JOIN app.source_record s ON s.id=c.source_id WHERE i.mission_id=$1',
      [id],
    )
  ).rows[0];
  expect(claim.statement).toBe(intake.brief.offer);
  expect(claim.status).toBe('self_declared');
  expect(claim.kind).toBe('self_declaration');
  expect(claim.locator).toContain(noticeVersion);
  expect(claim.ai_policy).toBe('DENY');
  await expect(s.command(f.users.operator.ctx, command(id!, 1, 'activate'))).rejects.toThrow(
    'changed',
  );
  await s.command(f.users.operator.ctx, {
    ...command(id!, 2, 'activate'),
    targetProfile: 'Revised distributor profile after qualification',
  });
  const afterActivation = await s.queue(f.users.operator.ctx);
  expect(afterActivation.missions.find((m) => m.id === id)?.target_profile).toBe(
    'Revised distributor profile after qualification',
  );
  expect(
    afterActivation.history.find((h) => h.mission_id === id && h.resulting_version === 3)?.details
      .targetProfile,
  ).toBe('Revised distributor profile after qualification');
  await s.command(f.users.operator.ctx, command(id!, 3, 'pause'));
  expect((await s.queue(f.users.operator.ctx)).missions.find((m) => m.id === id)?.status).toBe(
    'ON_HOLD',
  );
  await s.command(f.users.operator.ctx, command(id!, 4, 'resume'));
  expect((await s.queue(f.users.operator.ctx)).missions.find((m) => m.id === id)?.status).toBe(
    'ACTIVE',
  );
  await s.command(f.users.operator.ctx, command(id!, 5, 'cancel'));
  await expect(s.command(f.users.operator.ctx, command(id!, 6, 'assign'))).rejects.toThrow(
    'closed',
  );
  const events = await f.owner.query(
    "SELECT e.id,e.payload,a.id audit,o.id outbox FROM app.domain_event e JOIN app.audit_event a ON a.domain_event_id=e.id JOIN app.outbox o ON o.event_id=e.id WHERE e.aggregate_type='mission' AND e.aggregate_id=$1",
    [id],
  );
  expect(events.rowCount).toBe(6);
  expect(events.rows.every((r) => !JSON.stringify(r.payload).includes('example.invalid'))).toBe(
    true,
  );
});
test('tenant isolation, viewer/reviewer restrictions and SQL guards reject unauthorized edits', async () => {
  const { id } = await create();
  await expect(s.command(f.users.viewer.ctx, command(id!))).rejects.toThrow('Access denied');
  await expect(s.command(f.users.reviewer.ctx, command(id!))).rejects.toThrow('Access denied');
  await expect(s.queue({ ...f.users.other.ctx, tenantId: f.tenantA })).rejects.toThrow(
    'Access denied',
  );
  expect(
    (await rawContext(f.runtime, f.users.other.ctx, 'SELECT * FROM app.mission WHERE id=$1', [id]))
      .rowCount,
  ).toBe(0);
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      "UPDATE app.mission SET status='ACTIVE',version=2 WHERE id=$1",
      [id],
    ),
  ).rejects.toThrow('Invalid mission transition');
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      'INSERT INTO app.target_profile(tenant_id,mission_id,description,version) VALUES($1,$2,$3,999)',
      [f.tenantA, id, 'Forged future profile'],
    ),
  ).rejects.toThrow('Target profile version mismatch');
  await expect(f.runtime.query('SELECT * FROM app.intake_destination')).rejects.toThrow(
    'permission denied',
  );
  await expect(
    f.runtime.query(
      "INSERT INTO app.mission(tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES($1,$2,'Forged mission',now(),'Forged owner',$2)",
      [f.tenantA, f.users.owner.id],
    ),
  ).rejects.toThrow('permission denied');
  const before = (await f.owner.query('SELECT count(*)::int n FROM app.claim')).rows[0].n;
  await expect(
    s.command(f.users.operator.ctx, { ...command(id!), ownerId: f.users.other.id }),
  ).rejects.toThrow('Active operator owner required');
  expect((await f.owner.query('SELECT count(*)::int n FROM app.claim')).rows[0].n).toBe(before);
  expect(
    (await f.owner.query('SELECT version FROM app.mission WHERE id=$1', [id])).rows[0].version,
  ).toBe(1);
});
test('private receipt replies are idempotent and reveal no contact or other brief', async () => {
  const { id, receipt } = await create();
  const replyId = randomUUID();
  await expect(s.reply(f.users.viewer.ctx, id!, 'Hello', replyId)).rejects.toThrow('Access denied');
  await expect(s.reply(f.users.other.ctx, id!, 'Hello', replyId)).rejects.toThrow();
  await Promise.all([
    s.reply(f.users.operator.ctx, id!, 'Please confirm the test target profile.', replyId),
    s.reply(f.users.operator.ctx, id!, 'Please confirm the test target profile.', replyId),
  ]);
  await expect(s.reply(f.users.operator.ctx, id!, 'Changed reply', replyId)).rejects.toThrow(
    'key reused',
  );
  const response = await s.receipt(receipt!);
  expect(response.replies).toHaveLength(1);
  expect(response.replies[0].body).toBe('Please confirm the test target profile.');
  expect(JSON.stringify(response)).not.toContain('mission@example.invalid');
  await expect(
    rawContext(
      f.runtime,
      f.users.operator.ctx,
      'UPDATE app.mission_reply SET body=$2 WHERE id=$1',
      [replyId, 'Changed'],
    ),
  ).rejects.toThrow();
});
test('public abuse budgets survive replicas and reject the seventh request', async () => {
  const other = new MissionService(f.runtime, 'unit-test-only-secret');
  for (let n = 0; n < 6; n++) await (n % 2 ? s : other).budget('synthetic-client');
  await expect(s.budget('synthetic-client')).rejects.toThrow('Too many requests');
});
test('queue pagination retains every mission and server filters include overdue work', async () => {
  for (let n = 0; n < 105; n++) await create();
  const first = await s.queue(f.users.operator.ctx, 'all', 0);
  const next = await s.queue(f.users.operator.ctx, 'all', 100);
  expect(first.missions).toHaveLength(100);
  expect(next.missions.length).toBe(first.total - 100);
  expect(new Set([...first.missions, ...next.missions].map((m) => m.id)).size).toBe(first.total);
  const open = await s.queue(f.users.operator.ctx, 'open');
  expect(open.missions.every((m) => !['CANCELLED', 'CLOSED'].includes(m.status))).toBe(true);
  const id = first.missions.find((m) => m.status === 'DRAFT')!.id;
  await s.command(f.users.operator.ctx, {
    ...command(id, 1, 'assign'),
    dueAt: new Date(Date.now() - 3600000).toISOString(),
  });
  const overdue = await s.queue(f.users.operator.ctx, 'overdue');
  expect(overdue.missions.some((m) => m.id === id)).toBe(true);
  expect((await s.queue(f.users.other.ctx)).total).toBe(0);
});
test('ingress rejects malformed database calls and cannot activate a non-synthetic destination', async () => {
  await expect(
    f.runtime.query('SELECT app.submit_mission($1,$2,$3,$4::jsonb,$5)', [
      randomUUID(),
      'a'.repeat(64),
      'b'.repeat(64),
      JSON.stringify({ ...brief(), acknowledged: 'true' }),
      noticeVersion,
    ]),
  ).rejects.toThrow('Invalid intake structure');
  await f.owner.query('UPDATE app.tenant SET synthetic=false WHERE id=$1', [f.tenantA]);
  try {
    await expect(create()).rejects.toThrow('Intake unavailable');
  } finally {
    await f.owner.query('UPDATE app.tenant SET synthetic=true WHERE id=$1', [f.tenantA]);
  }
  await f.owner.query('UPDATE app.intake_destination SET enabled=false');
  try {
    await expect(create()).rejects.toThrow('Intake unavailable');
  } finally {
    await f.owner.query('UPDATE app.intake_destination SET enabled=true');
  }
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM identity.security_event WHERE action LIKE 'intake.destination.%'",
      )
    ).rows[0].n,
  ).toBeGreaterThanOrEqual(3);
});
