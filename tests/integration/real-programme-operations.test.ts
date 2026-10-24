import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerProgrammeContextService } from '../../packages/auth/src/customer-programme-context';
import { CustomerProgrammeEconomicsService } from '../../packages/auth/src/customer-programme-economics';
import { CustomerProgrammeCoordinationService } from '../../packages/auth/src/customer-programme-coordination';

// An organiser runs a programme with real participants: invitations and registration, shared context, the money
// ledger with exact amounts, tasks, places and attendance. The sample suites (customer-participants,
// customer-programme-context, -economics, -coordination) prove the same rules for sample workspaces.
const issuer = 'https://ep-real-ops-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const sessionFor = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const organiser = 'ops-organiser';
const delegate = 'ops-delegate';
const outsider = 'ops-outsider';
// A replayed command returns the same record; only the short session expiry differs between calls.
const stable = <T extends object>(value: T) => ({ ...value, expiresAt: undefined });
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let workspaceId: string;
let programmeId: string;
let registrationId: string;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const workspaces = (who: string) => new CustomerWorkspaceService(...runtime(), sessionFor(who));
const programmes = (who = organiser) => new CustomerProgrammeService(...runtime(), sessionFor(who));
const participants = (who = organiser) =>
  new CustomerParticipantService(...runtime(), sessionFor(who));
const context = (who = organiser) =>
  new CustomerProgrammeContextService(...runtime(), sessionFor(who));
const economics = (who = organiser) =>
  new CustomerProgrammeEconomicsService(...runtime(), sessionFor(who));
const coordination = (who = organiser) =>
  new CustomerProgrammeCoordinationService(...runtime(), sessionFor(who));

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-ops-fixture-secret');
  workspaceId = (
    await workspaces(organiser).provision({
      commandId: randomUUID(),
      name: 'Dhaka Trade Association',
    })
  ).id;
  await workspaces(delegate).provision({ commandId: randomUUID(), name: 'Delegate company' });
  await workspaces(outsider).provision({ commandId: randomUUID(), name: 'Unrelated company' });
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Autumn supplier delegation',
      reportingPurpose: 'Prepare the autumn supplier delegation',
      acknowledged: true,
    })
  ).id;
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('an invitation is accepted once by a real delegate who then sees only their own registration', async () => {
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    label: 'Delegate invitation',
    acknowledged: true,
  });
  expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  const preview = await participants(delegate).preview({ token: invitation.token });
  expect(JSON.stringify(preview)).not.toContain(invitation.token);
  const accept = {
    action: 'accept' as const,
    commandId: randomUUID(),
    programmeId,
    token: invitation.token,
    displayLabel: 'Delegate Bob',
    consented: true as const,
  };
  const accepted = await participants(delegate).command(accept);
  registrationId = accepted.id;
  expect(stable(await participants(delegate).command(accept))).toEqual(stable(accepted));
  // The invitation is single use for a second person.
  await expect(
    participants(outsider).command({ ...accept, commandId: randomUUID() }),
  ).rejects.toThrow();
  const own = await participants(delegate).own();
  expect(JSON.stringify(own)).toContain(programmeId);
  expect((await participants(outsider).own()).registrations ?? []).toEqual([]);
  const roster = await participants().list({ workspaceId, programmeId });
  expect(JSON.stringify(roster)).toContain('Delegate Bob');
  expect(JSON.stringify(roster)).not.toContain(invitation.token);
  await expect(participants(outsider).list({ workspaceId, programmeId })).rejects.toMatchObject({
    code: '42501',
  });
});

test('the organiser sets programme context and shares it; the delegate reads it, an outsider cannot', async () => {
  const input = {
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    marketCode: 'CN',
    startsAt: '2026-11-10T09:00:00+08:00',
    endsAt: '2026-11-14T18:00:00+08:00',
    timezone: 'Asia/Shanghai',
    reason: 'Prepare supplier visits for the autumn delegation',
    organiser: 'Dhaka Trade Association',
    purpose: 'Supplier visits for machinery importers',
    shared: true,
    acknowledged: true as const,
  };
  const saved = await context().command(input);
  expect(stable(await context().command(input))).toEqual(stable(saved));
  const seen = await context(delegate).view({ registrationId });
  expect(JSON.stringify(seen)).toContain('Supplier visits for machinery importers');
  await expect(context(outsider).view({ workspaceId, programmeId })).rejects.toMatchObject({
    code: '42501',
  });
  await expect(context().command({ ...input, commandId: randomUUID() })).rejects.toMatchObject({
    code: '23514',
  });
});

test('the ledger keeps exact amounts, corrects by reversal and never takes a future-dated payment', async () => {
  const record = (entry: Record<string, unknown>) =>
    economics().record({
      commandId: randomUUID(),
      workspaceId,
      programmeId,
      entry,
      acknowledged: true,
    });
  const fee = await record({
    kind: 'PARTICIPANT_FEE',
    costBasis: null,
    registrationId,
    amountMinor: '123456789012345',
    currency: 'BDT',
    occurredOn: '2026-11-01',
    description: 'Delegate participation fee',
  });
  expect(fee.entry.amountMinor).toBe('123456789012345');
  await record({
    kind: 'PARTICIPANT_PAYMENT',
    costBasis: null,
    registrationId,
    amountMinor: '100000000000000',
    currency: 'BDT',
    occurredOn: '2026-10-20',
    description: 'Bank transfer received from the delegate',
  });
  await record({
    kind: 'ORGANISER_EXPENSE',
    costBasis: 'ACTUAL',
    registrationId: null,
    amountMinor: '5000',
    currency: 'BDT',
    occurredOn: '2026-11-03',
    description: 'Venue hire for the briefing',
  });
  await expect(
    record({
      kind: 'PARTICIPANT_PAYMENT',
      costBasis: null,
      registrationId,
      amountMinor: '1',
      currency: 'BDT',
      occurredOn: '2099-01-01',
      description: 'Payment dated far in the future',
    }),
  ).rejects.toThrow();
  const summary = await economics().summary({ workspaceId, programmeId });
  expect(summary.verified).toBe(false);
  expect(summary.collectsPayments).toBe(false);
  expect(summary.currencies[0]).toMatchObject({
    currency: 'BDT',
    feesDue: '123456789012345',
    paymentsRecorded: '100000000000000',
    outstanding: '23456789012345',
  });
  const reversed = await record({
    reverseOf: fee.entry.id,
    occurredOn: '2026-11-04',
    description: 'Fee entered in error and reversed',
  });
  expect(reversed.entry.reverseOf).toBe(fee.entry.id);
  const listed = await economics().list({ workspaceId, programmeId });
  expect(listed.entries.length).toBe(4);
  expect(JSON.stringify(listed)).not.toMatch(/synthetic/i);
  await expect(economics(outsider).summary({ workspaceId, programmeId })).rejects.toMatchObject({
    code: '42501',
  });
  await expect(economics(delegate).summary({ workspaceId, programmeId })).rejects.toMatchObject({
    code: '42501',
  });
});

test('tasks, places and attendance are kept with versions; the delegate adds their own feedback', async () => {
  const task = await coordination().saveTask({
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    task: {
      taskId: null,
      title: 'Confirm factory visit times',
      detail: 'Agree the visit schedule with each supplier',
      status: 'OPEN',
      dueOn: '2026-11-05',
      assigneeLabel: 'Programme coordinator',
    },
  });
  expect(JSON.stringify(task)).toContain('Confirm factory visit times');
  await coordination().setCapacity({
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
    capacity: 12,
    reason: 'Twelve places agreed with the venue',
  });
  await coordination().setAttendance({
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    registrationId,
    state: 'ATTENDED',
  });
  await coordination(delegate).submitRecord({
    commandId: randomUUID(),
    registrationId,
    kind: 'FEEDBACK',
    recordId: null,
    expectedVersion: 0,
    rating: 5,
    outcomeKind: null,
    occurredOn: null,
    note: 'The supplier meetings were well prepared',
    shared: true,
    retracted: false,
    acknowledged: true,
  });
  const report = await coordination().report({ workspaceId, programmeId });
  const text = JSON.stringify(report);
  expect(report.tasks).toMatchObject({ open: 1, done: 0 });
  expect(report.capacity).toMatchObject({ capacity: 12 });
  expect(report.attendance).toMatchObject({ attended: 1 });
  expect(text).not.toMatch(/synthetic/i);
  expect(JSON.stringify(await coordination().tasks({ workspaceId, programmeId }))).toContain(
    'Confirm factory visit times',
  );
  const own = await coordination(delegate).ownRecords({ registrationId });
  expect(JSON.stringify(own)).toContain('well prepared');
  await expect(coordination(outsider).report({ workspaceId, programmeId })).rejects.toMatchObject({
    code: '42501',
  });
});

test('a delegate can withdraw, and the organiser then sees them as withdrawn', async () => {
  await participants(delegate).command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId,
    reason: 'The company can no longer travel in November',
    acknowledged: true,
  });
  const roster = await participants().list({ workspaceId, programmeId });
  expect(JSON.stringify(roster)).toMatch(/WITHDRAWN/i);
});
