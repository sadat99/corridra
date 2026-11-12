import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { future } from './access-fixture';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import type { DeliveryReport } from '../../packages/delivery/src/report';
import { hash } from '../../packages/communications/src/index';
import { SyntheticChannel } from '../../packages/communications/src/adapters';
import { sellBoard } from '../../apps/web/lib/sell-board';

// Real-use 0017: the buyers approached, responded and interested among the approved targets are counted once, inside the
// approving insert, stored on the publication and shown to the client from there. Older approvals carry nothing, and the
// client reads that as "Not shared", never as zero.
const reason = 'Synthetic outreach count validation';
const file = () =>
  readFile(
    new URL(
      '../../packages/db/customer-real-use-migrations/0017_experience_outreach_counts.sql',
      import.meta.url,
    ),
    'utf8',
  );
let f: Awaited<ReturnType<typeof commercialFixture>>,
  delivery: DeliveryService,
  experience: DeliveryExperienceService;
beforeAll(async () => {
  f = await commercialFixture();
  delivery = new DeliveryService(f.runtime, f.mission, 'outreach-delivery-test-secret');
  experience = new DeliveryExperienceService(f.runtime);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
afterAll(async () => {
  await f?.close();
});

type Intro = Awaited<ReturnType<typeof f.introduction>>;
async function deliver(i: Intro) {
  const cap = f.communications.dispatchCapability(i.id),
    capabilityHash = hash(cap),
    leaseId = randomUUID();
  await f.runtime.query('SELECT app.claim_communication($1,$2,$3) AS job', [
    i.id,
    capabilityHash,
    leaseId,
  ]);
  await new SyntheticChannel(f.runtime).deliver({ id: i.id, capabilityHash, leaseId });
}
const respond = (i: Intro, decision: string) =>
  f.communications.buyer({
    action: 'respond',
    token: i.token,
    responseId: randomUUID(),
    decision,
    optOut: false,
  });
async function approve(t: Intro) {
  const p = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: t.missionId,
    title: 'Approved participant mission',
    company: 'Synthetic Company',
    objective: 'Review a source-reported commercial requirement',
    brief: 'Approved synthetic context. No private contact or relationship owner is disclosed.',
    nextAction: 'Review the explicitly scoped mission detail',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [p.id],
    audience: 'CLIENT_PROGRESS',
    purpose: reason,
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  const e = await experience.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId: p.id,
    requirementId: null,
    targetIds: [t.targetId],
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  const report = (await delivery.external({
    action: 'view',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
  })) as DeliveryReport;
  return { p, e, token: link.token, experience: report.missions[0].experience };
}
const stored = async (id: string) =>
  (
    await f.owner.query('SELECT outreach FROM app.delivery_experience_publication WHERE id=$1', [
      id,
    ])
  ).rows[0].outreach;

test('before 0017 an approval carries no counts and the client sees Not shared, never zero', async () => {
  const t = await f.introduction();
  await deliver(t);
  const old = await approve(t);
  expect(old.experience).toBeDefined();
  expect(old.experience).not.toHaveProperty('outreach');
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='app' AND table_name='delivery_experience_publication' AND column_name='outreach'",
      )
    ).rows[0].n,
  ).toBe(0);
  expect(await experience.workspace(f.users.owner.ctx, undefined, t.missionId)).toMatchObject({
    targetOutreach: null,
  });
  const board = sellBoard(old.experience!, null).funnel;
  expect([board.approached, board.responded, board.interested, board.outreachAsOf]).toEqual([
    null,
    null,
    null,
    null,
  ]);
});

test('0017 is repeatable, replaces the report function only by the one line and keeps its grants and the lifecycle guard target', async () => {
  const sql = await file();
  const before = (
    await f.owner.query(
      "SELECT pg_get_functiondef('app.delivery_report(text,text)'::regprocedure) d, pg_get_functiondef('app.delivery_report_v1(text,text)'::regprocedure) v, (SELECT proacl::text FROM pg_proc WHERE oid='app.delivery_report(text,text)'::regprocedure) acl",
    )
  ).rows[0];
  await f.owner.query(sql);
  await f.owner.query(sql);
  const after = (
    await f.owner.query(
      "SELECT pg_get_functiondef('app.delivery_report(text,text)'::regprocedure) d, pg_get_functiondef('app.delivery_report_v1(text,text)'::regprocedure) v, (SELECT proacl::text FROM pg_proc WHERE oid='app.delivery_report(text,text)'::regprocedure) acl",
    )
  ).rows[0];
  expect(after.v).toBe(before.v);
  expect(after.acl).toBe(before.acl);
  const anchor = "item:=item||jsonb_build_object('experience',extended);";
  expect(before.d.split(anchor)).toHaveLength(2);
  expect(
    after.d.replace(
      /item:=item\|\|jsonb_build_object\('experience',CASE WHEN e\.outreach IS NULL THEN extended ELSE extended\|\|jsonb_build_object\('outreach',e\.outreach\) END\);/,
      anchor,
    ),
  ).toBe(before.d);
  const acl = (
    await f.owner.query(
      `SELECT has_function_privilege('corridra_runtime','app.experience_outreach_preview(uuid[])','EXECUTE') preview,
 has_function_privilege('corridra_runtime','app.experience_outreach_rows_for(uuid,uuid[])','EXECUTE') rows,
 has_function_privilege('corridra_runtime','app.experience_outreach_count(uuid,uuid[])','EXECUTE') count,
 has_function_privilege('corridra_runtime','app.experience_outreach_freeze()','EXECUTE') freeze,
 has_function_privilege('corridra_auth','app.experience_outreach_preview(uuid[])','EXECUTE') auth,
 has_function_privilege('public','app.experience_outreach_preview(uuid[])','EXECUTE') pub`,
    )
  ).rows[0];
  expect(acl).toEqual({
    preview: true,
    rows: false,
    count: false,
    freeze: false,
    auth: false,
    pub: false,
  });
});

test('an approval made before 0017 still has no counts after it is installed', async () => {
  const rows = (
    await f.owner.query('SELECT id FROM app.delivery_experience_publication WHERE outreach IS NULL')
  ).rows;
  expect(rows.length).toBeGreaterThan(0);
});

test('counts are taken once at approval: approached by receipt or reply, responded by any reply, interested by interest only', async () => {
  const none = await f.introduction(),
    sent = await f.introduction(),
    interested = await f.introduction(),
    needInfo = await f.introduction(),
    lone = await f.target('ES');
  await deliver(sent);
  await deliver(interested);
  await respond(interested, 'INTERESTED');
  // A reply with no delivery receipt still proves the buyer was reached; need-for-information is a reply, not interest.
  await respond(needInfo, 'NEED_INFO');
  const expected: [Intro | typeof lone, unknown][] = [
    [none as Intro, [0, 0, 0]],
    [sent, [1, 0, 0]],
    [interested, [1, 1, 1]],
    [needInfo, [1, 1, 0]],
  ];
  for (const [t, counts] of expected) {
    const a = await approve(t as Intro),
      o = await stored(a.e.id);
    expect([o.approached, o.responded, o.interested]).toEqual(counts);
    expect(new Date(o.asOf).toString()).not.toBe('Invalid Date');
    expect(a.experience?.outreach).toEqual(o);
    const funnel = sellBoard(a.experience!, null).funnel;
    expect([funnel.approached, funnel.responded, funnel.interested, funnel.outreachAsOf]).toEqual([
      ...(counts as number[]),
      o.asOf,
    ]);
  }
  // A target with no message at all is a real zero for that approval, and a target nobody listed is never counted.
  const total = (
    await f.owner.query('SELECT app.experience_outreach_count($1,$2) c', [
      f.tenantA,
      [none, sent, interested, needInfo, lone].map((x) => x.targetId),
    ])
  ).rows[0].c;
  expect([total.approached, total.responded, total.interested]).toEqual([3, 2, 1]);
});

test('the stored counts do not move when outreach changes later, and only a new approval takes new counts', async () => {
  const t = await f.introduction();
  const first = await approve(t),
    at = await stored(first.e.id);
  expect([at.approached, at.responded, at.interested]).toEqual([0, 0, 0]);
  await deliver(t);
  await respond(t, 'INTERESTED');
  const view = (await delivery.external({
    action: 'view',
    token: first.token,
    audience: 'CLIENT_PROGRESS',
  })) as DeliveryReport;
  expect(view.missions[0].experience?.outreach).toEqual(at);
  expect(await stored(first.e.id)).toEqual(at);
  const second = await approve(t),
    next = await stored(second.e.id);
  expect([next.approached, next.responded, next.interested]).toEqual([1, 1, 1]);
});

test('a supplied value cannot set the counts, the row stays immutable and the shape is enforced', async () => {
  const t = await f.introduction();
  const a = await approve(t);
  await expect(
    f.owner.query('UPDATE app.delivery_experience_publication SET outreach=NULL WHERE id=$1', [
      a.e.id,
    ]),
  ).rejects.toThrow();
  const o = await stored(a.e.id);
  await f.owner.query(`ALTER TABLE app.delivery_experience_publication DISABLE TRIGGER immutable`);
  try {
    await expect(
      f.owner.query(
        `UPDATE app.delivery_experience_publication SET outreach='{"approached":9,"responded":1,"interested":1,"asOf":"2026-11-12T00:00:00Z"}'::jsonb WHERE id=$1`,
        [a.e.id],
      ),
    ).rejects.toThrow(/outreach_shape/);
    await expect(
      f.owner.query(
        `UPDATE app.delivery_experience_publication SET outreach='{"approached":1,"responded":1,"interested":1,"asOf":"2026-11-12T00:00:00Z","name":"x"}'::jsonb WHERE id=$1`,
        [a.e.id],
      ),
    ).rejects.toThrow(/outreach_shape/);
    await expect(
      f.owner.query(
        `UPDATE app.delivery_experience_publication SET outreach='{"approached":1,"responded":2,"interested":0,"asOf":"2026-11-12T00:00:00Z"}'::jsonb WHERE id=$1`,
        [a.e.id],
      ),
    ).rejects.toThrow(/outreach_shape/);
  } finally {
    await f.owner.query(`ALTER TABLE app.delivery_experience_publication ENABLE TRIGGER immutable`);
  }
  expect(await stored(a.e.id)).toEqual(o);
});

test('the preview is for the owner or admin of this workspace only and no login can call the counting functions', async () => {
  const t = await f.introduction();
  await deliver(t);
  const seen = await experience.workspace(f.users.owner.ctx, undefined, t.missionId);
  expect(seen.targetOutreach).toEqual([
    { id: t.targetId, approached: true, responded: false, interested: false },
  ]);
  // Not an owner or admin: no preview rows at all, and the rest of the read is unchanged.
  const other = await experience
    .workspace(f.users.viewer.ctx, undefined, t.missionId)
    .catch(() => null);
  if (other) expect(other.targetOutreach).toBeNull();
  await expect(
    f.runtime.query('SELECT * FROM app.experience_outreach_rows_for($1,$2)', [
      f.tenantA,
      [t.targetId],
    ]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    f.runtime.query('SELECT app.experience_outreach_count($1,$2)', [f.tenantA, [t.targetId]]),
  ).rejects.toThrow(/permission denied/);
  // The other workspace's owner cannot count this workspace's targets: they are not in that workspace.
  const foreign = await experience.workspace(f.users.other.ctx, undefined, t.missionId);
  expect(foreign.targetOutreach).toEqual([]);
  expect(
    (
      await f.owner.query('SELECT app.experience_outreach_count($1,$2) c', [
        f.tenantB,
        [t.targetId],
      ])
    ).rows[0].c,
  ).toMatchObject({ approached: 0, responded: 0, interested: 0 });
});
