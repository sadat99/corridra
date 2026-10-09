import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { accessFixture, command, future } from './access-fixture';
import { rawContext } from './support';
import {
  localWallTime,
  schedule,
  meetingTransitions,
  assertMeetingTransition,
} from '../../packages/domain/src/access';
let f: Awaited<ReturnType<typeof accessFixture>>;
beforeAll(async () => {
  f = await accessFixture();
});
afterAll(async () => {
  await f?.close();
});
const next = () => ({
  ownerId: f.users.operator.id,
  nextAction: 'Send the agreed synthetic follow-up',
  dueAt: future(),
  reason: 'Record synthetic meeting progression',
});
function pastSchedule() {
  const start = new Date(Date.now() - 3600000);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + 1800000);
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    timezone: 'Europe/Madrid',
    localStart: localWallTime(start, 'Europe/Madrid'),
    localEnd: localWallTime(end, 'Europe/Madrid'),
    location: 'Synthetic meeting room',
  };
}
async function proposed() {
  const i = await f.introduction();
  const input = command('propose', {
    messageId: i.id,
    title: 'Synthetic commercial discussion',
    brief: 'Discuss declared requirements and remaining evidence gaps.',
    participants: ['Synthetic Supplier Person', 'Synthetic Buyer Person'],
    ...next(),
  });
  const m = await f.meetings.command(f.ctx, input);
  return { ...i, meetingId: m.id, proposal: input };
}
async function accepted() {
  const m = await proposed();
  await f.communications.buyer({
    action: 'respond',
    token: m.token,
    responseId: randomUUID(),
    decision: 'INTERESTED',
    optOut: false,
  });
  const response = (
    await f.owner.query('SELECT id FROM app.buyer_response WHERE link_id=$1', [m.id])
  ).rows[0].id;
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.meetingId,
      version: 1,
      status: 'ACCEPTED',
      acceptance: 'Buyer responded Interested to this introduction',
      responseId: response,
      ...next(),
    }),
  );
  return m;
}
async function scheduled() {
  const m = await accepted();
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.meetingId,
      version: 2,
      status: 'SCHEDULED',
      schedule: pastSchedule(),
      ...next(),
    }),
  );
  return m;
}
test('synthetic introduction reaches accepted/held meeting and owned follow-up with atomic commercial events', async () => {
  const m = await accepted();
  expect(await f.meetings.command(f.ctx, m.proposal)).toEqual({ id: m.meetingId, version: 1 });
  const mission = (action: string, version: number) =>
    f.mission.command(f.ctx, {
      id: m.missionId,
      version,
      commandId: randomUUID(),
      action,
      ...next(),
      marketCode: 'ES',
      targetProfile: 'Synthetic hotel distributor profile',
    });
  await mission('outreach', 4);
  await mission('meetings', 5);
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.meetingId,
      version: 2,
      status: 'SCHEDULED',
      schedule: pastSchedule(),
      ...next(),
    }),
  );
  const held = command('transition', {
    id: m.meetingId,
    version: 3,
    status: 'HELD',
    outcome: 'Both synthetic participants attended and agreed to exchange requirement details.',
    ...next(),
  });
  expect(await f.meetings.command(f.ctx, held)).toEqual({ id: m.meetingId, version: 4 });
  expect(await f.meetings.command(f.ctx, held)).toEqual({ id: m.meetingId, version: 4 });
  const snapshot = await f.meetings.workspace(f.ctx);
  expect(snapshot.meetings.find((r) => r.id === m.meetingId)).toMatchObject({
    status: 'HELD',
    version: 4,
    timezone: 'Europe/Madrid',
  });
  expect(snapshot.followups.find((r) => r.meeting_id === m.meetingId)).toMatchObject({
    status: 'OPEN',
    owner_id: f.users.operator.id,
    next_action: next().nextAction,
  });
  expect(snapshot.outcomes.filter((r) => r.meeting_id === m.meetingId)).toHaveLength(1);
  await mission('followup', 6);
  const rows = await f.owner.query(
    "SELECT e.id,o.event_id,a.domain_event_id FROM app.domain_event e JOIN app.outbox o ON o.event_id=e.id JOIN app.audit_event a ON a.domain_event_id=e.id WHERE e.aggregate_id=$1 AND e.aggregate_type='meeting'",
    [m.meetingId],
  );
  expect(rows.rowCount).toBe(4);
  const completion = command('followup', {
    id: m.meetingId,
    version: 1,
    status: 'COMPLETED',
    reason: 'Sent the agreed invented requirement summary',
  });
  await f.meetings.command(f.ctx, completion);
  await f.meetings.command(f.ctx, completion);
  expect(
    (await f.meetings.workspace(f.ctx)).followups.find((r) => r.id === m.meetingId).status,
  ).toBe('COMPLETED');
});
test('invalid, unauthorized and unrelated acceptance commands cannot advance a meeting', async () => {
  const m = await proposed(),
    other = await accepted();
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.meetingId,
        version: 1,
        status: 'HELD',
        outcome: 'Attempted fabricated outcome',
        ...next(),
      }),
    ),
  ).rejects.toThrow('Invalid meeting transition');
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', { id: m.meetingId, version: 1, status: 'ACCEPTED', ...next() }),
    ),
  ).rejects.toThrow('acceptance source');
  const response = (
    await f.owner.query('SELECT id FROM app.buyer_response WHERE link_id=$1', [other.id])
  ).rows[0].id;
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.meetingId,
        version: 1,
        status: 'ACCEPTED',
        acceptance: 'Wrong introduction response',
        responseId: response,
        ...next(),
      }),
    ),
  ).rejects.toThrow('this introduction');
  await expect(
    f.meetings.command(
      f.users.viewer.ctx,
      command('transition', { id: m.meetingId, version: 1, status: 'DECLINED', ...next() }),
    ),
  ).rejects.toThrow('Access denied');
  await expect(
    f.meetings.command(
      f.users.other.ctx,
      command('transition', { id: m.meetingId, version: 1, status: 'CANCELLED', ...next() }),
    ),
  ).rejects.toThrow('unavailable');
  expect((await f.meetings.workspace(f.users.other.ctx)).meetings).toEqual([]);
  expect((await f.meetings.workspace(f.users.viewer.ctx)).meetings).toEqual([]);
  await expect(
    rawContext(
      f.runtime,
      f.ctx,
      "UPDATE app.meeting SET status='HELD',version=version+1 WHERE id=$1",
      [m.meetingId],
    ),
  ).rejects.toThrow('Invalid meeting transition');
});
test('decline, cancellation, no-show and deliberate rescheduling preserve prior schedule', async () => {
  const declined = await proposed();
  await f.meetings.command(
    f.ctx,
    command('transition', { id: declined.meetingId, version: 1, status: 'DECLINED', ...next() }),
  );
  const cancelled = await accepted();
  await f.meetings.command(
    f.ctx,
    command('transition', { id: cancelled.meetingId, version: 2, status: 'CANCELLED', ...next() }),
  );
  const m = await scheduled();
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.meetingId,
      version: 3,
      status: 'NO_SHOW',
      outcome: 'Synthetic buyer did not attend',
      ...next(),
    }),
  );
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.meetingId,
      version: 4,
      status: 'RESCHEDULE_REQUIRED',
      ...next(),
    }),
  );
  const nextSchedule = {
    startsAt: '2026-11-02T10:00:00+01:00',
    endsAt: '2026-11-02T10:30:00+01:00',
    timezone: 'Europe/Madrid',
    localStart: '2026-11-02T10:00',
    localEnd: '2026-11-02T10:30',
    location: 'Rescheduled synthetic room',
  };
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.meetingId,
      version: 5,
      status: 'SCHEDULED',
      schedule: nextSchedule,
      ...next(),
    }),
  );
  const snapshot = await f.meetings.workspace(f.ctx);
  expect(
    snapshot.history.find((h) => h.meeting_id === m.meetingId && h.details.command.version === 5)
      .details.previous.startsAt,
  ).not.toBeNull();
  expect(snapshot.outcomes.find((o) => o.meeting_id === m.meetingId).status).toBe('NO_SHOW');
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.meetingId,
        version: 6,
        status: 'HELD',
        outcome: 'Future fabricated attendance',
        ...next(),
      }),
    ),
  ).rejects.toThrow('future meeting');
});
test('DST gaps reject mismatched wall times, repeated times require explicit offsets and duration is absolute', () => {
  const common = { timezone: 'Europe/Madrid', location: 'Synthetic test room' };
  expect(
    schedule.safeParse({
      ...common,
      startsAt: '2026-03-29T02:30:00+01:00',
      endsAt: '2026-03-29T04:00:00+02:00',
      localStart: '2026-03-29T02:30',
      localEnd: '2026-03-29T04:00',
    }).success,
  ).toBe(false);
  const early = schedule.parse({
    ...common,
    startsAt: '2026-10-25T02:10:00+02:00',
    endsAt: '2026-10-25T02:40:00+02:00',
    localStart: '2026-10-25T02:10',
    localEnd: '2026-10-25T02:40',
  });
  const late = schedule.parse({
    ...early,
    startsAt: '2026-10-25T02:10:00+01:00',
    endsAt: '2026-10-25T02:40:00+01:00',
  });
  expect(new Date(late.startsAt).getTime() - new Date(early.startsAt).getTime()).toBe(3600000);
  expect(
    schedule.safeParse({ ...early, startsAt: '2026-10-25T02:10:00', endsAt: '2026-10-25T02:40:00' })
      .success,
  ).toBe(false);
  expect(schedule.safeParse({ ...early, timezone: 'Asia/Dhaka' }).success).toBe(false);
  expect(
    schedule.safeParse({
      ...early,
      endsAt: '2026-10-25T02:00:00+02:00',
      localEnd: '2026-10-25T02:00',
    }).success,
  ).toBe(false);
  for (const [from, allowed] of Object.entries(meetingTransitions))
    for (const to of Object.keys(meetingTransitions)) {
      if (allowed.includes(to as never))
        expect(() =>
          assertMeetingTransition(
            from as keyof typeof meetingTransitions,
            to as keyof typeof meetingTransitions,
          ),
        ).not.toThrow();
      else
        expect(() =>
          assertMeetingTransition(
            from as keyof typeof meetingTransitions,
            to as keyof typeof meetingTransitions,
          ),
        ).toThrow();
    }
});
test('held outcome and follow-up fail atomically when missing or not owned', async () => {
  const m = await scheduled(),
    events = (await f.owner.query('SELECT count(*) n FROM app.domain_event')).rows[0].n;
  await expect(
    rawContext(
      f.runtime,
      f.ctx,
      "UPDATE app.meeting SET status='HELD',version=version+1 WHERE id=$1",
      [m.meetingId],
    ),
  ).rejects.toThrow('commit together');
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.meetingId,
        version: 3,
        status: 'HELD',
        outcome: 'Observed test attendance',
        ...next(),
        ownerId: f.users.viewer.id,
      }),
    ),
  ).rejects.toThrow('owner');
  expect((await f.owner.query('SELECT count(*) n FROM app.domain_event')).rows[0].n).toBe(events);
  expect(
    (await f.meetings.workspace(f.ctx)).meetings.find((r) => r.id === m.meetingId).status,
  ).toBe('SCHEDULED');
});
test('simultaneous meeting commands retain one version and a paused mission denies mutations', async () => {
  const m = await proposed(),
    v = command('transition', {
      id: m.meetingId,
      version: 1,
      status: 'ACCEPTED',
      acceptance: 'Synthetic operator recorded verbal acceptance',
      ...next(),
    });
  expect(await Promise.all([f.meetings.command(f.ctx, v), f.meetings.command(f.ctx, v)])).toEqual([
    { id: m.meetingId, version: 2 },
    { id: m.meetingId, version: 2 },
  ]);
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', { id: m.meetingId, version: 1, status: 'CANCELLED', ...next() }),
    ),
  ).rejects.toThrow('changed');
  await f.mission.command(f.ctx, {
    id: m.missionId,
    version: 4,
    commandId: randomUUID(),
    action: 'pause',
    ...next(),
    marketCode: 'ES',
    targetProfile: 'Synthetic requirement profile',
  });
  await expect(
    f.meetings.command(
      f.ctx,
      command('transition', {
        id: m.meetingId,
        version: 2,
        status: 'SCHEDULED',
        schedule: pastSchedule(),
        ...next(),
      }),
    ),
  ).rejects.toThrow('Active introduction mission');
});
