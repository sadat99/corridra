import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerRequestDetailService } from '../../packages/auth/src/customer-request-details';
import { CustomerMissionShareService } from '../../packages/auth/src/customer-mission-shares';

// A delegate shares a one-line summary of their own private request with the organiser of a programme they joined.
// The organiser sees only that line; the original stays with its creator. The sample suite (customer-mission-shares)
// proves the same rules for sample workspaces.
const issuer =
  'https://ep-real-shares-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
const organiser = 'share-organiser';
const colleague = 'share-colleague';
const delegate = 'share-delegate';
const other = 'share-other';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let organiserWorkspace: string;
let delegateWorkspace: string;
let programmeId: string;
let registrationId: string;
let requestId: string;
let original: ReturnType<typeof brief>;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const workspaces = (who: string) => new CustomerWorkspaceService(...runtime(), sessionFor(who));
const participants = (who: string) => new CustomerParticipantService(...runtime(), sessionFor(who));
const requests = (who: string) => new CustomerRequestService(...runtime(), sessionFor(who));
const details = (who: string) => new CustomerRequestDetailService(...runtime(), sessionFor(who));
const shares = (who = delegate) => new CustomerMissionShareService(...runtime(), sessionFor(who));
const brief = () => ({
  objective: 'Source suppliers' as const,
  market: 'China',
  attendance: 'Not decided' as const,
  startDate: '',
  endDate: '',
  timezone: 'Asia/Dhaka',
  offer: 'Private machinery requirements ' + randomUUID(),
  website: 'https://business.test/catalogue',
  outcomes: ['Supplier visits' as const],
  notes: 'Private exclusions and support obligations',
  name: 'Delegate Bob',
  company: 'Delegate company',
  email: 'delegate-private@business.test',
  acknowledged: true as const,
});
const share = (summary: string, expectedVersion = 0) => ({
  action: 'share' as const,
  commandId: randomUUID(),
  registrationId,
  requestId,
  expectedVersion,
  summary,
  consented: true as const,
});

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-shares-fixture-secret');
  organiserWorkspace = (
    await workspaces(organiser).provision({
      commandId: randomUUID(),
      name: 'Dhaka Trade Association',
    })
  ).id;
  const colleagueInvite = await workspaces(organiser).access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: organiserWorkspace,
    label: 'Association colleague',
  });
  await workspaces(colleague).access({
    action: 'accept',
    commandId: randomUUID(),
    token: colleagueInvite.token,
  });
  delegateWorkspace = (
    await workspaces(delegate).provision({ commandId: randomUUID(), name: 'Delegate company' })
  ).id;
  await workspaces(other).provision({ commandId: randomUUID(), name: 'Another company' });
  programmeId = (
    await new CustomerProgrammeService(...runtime(), sessionFor(organiser)).create({
      commandId: randomUUID(),
      workspaceId: organiserWorkspace,
      name: 'Autumn supplier delegation',
      reportingPurpose: 'Prepare the autumn supplier delegation',
      acknowledged: true,
    })
  ).id;
  const invitation = await participants(organiser).command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: organiserWorkspace,
    programmeId,
    label: 'Delegate invitation',
    acknowledged: true,
  });
  registrationId = (
    await participants(delegate).command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId,
      token: invitation.token,
      displayLabel: 'Delegate Bob',
      consented: true,
    })
  ).id;
  original = brief();
  requestId = (
    await requests(delegate).submit(
      { commandId: randomUUID(), workspaceId: delegateWorkspace, brief: original },
      (context, b) => s.missions.prepareCustomerIntake(context, b),
    )
  ).id;
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('the delegate sees their own request as a choice, and nobody else does', async () => {
  const choices = await shares().choices({ registrationId });
  expect(choices.requests.some((r: { id: string }) => r.id === requestId)).toBe(true);
  for (const who of [organiser, colleague, other]) {
    await expect(shares(who).choices({ registrationId })).rejects.toThrow();
    await expect(shares(who).summaries({ registrationId, view: 'own' })).rejects.toThrow();
  }
});

test('sharing needs consent, and the organiser then sees only the shared line', async () => {
  const summary = 'We want to meet machinery suppliers in China during the delegation';
  const command = share(summary);
  const saved = await shares().command(command);
  expect(saved.status).toBe('SHARED');
  expect(await shares().command(command)).toMatchObject({ status: 'SHARED' });
  const own = await shares().summaries({ registrationId, view: 'own' });
  expect(own.objectives[0]).toMatchObject({ requestId, summary });
  const manage = await shares(organiser).summaries({ registrationId, view: 'manage' });
  expect(manage.objectives[0]).toMatchObject({ summary, claimStatus: 'Self-declared' });
  const text = JSON.stringify(manage);
  for (const secret of [
    requestId,
    delegateWorkspace,
    s.intakeTenantId,
    original.offer,
    original.email,
    original.notes,
    'receiptHash',
    'missionId',
    'original',
  ])
    expect(text).not.toContain(secret);
  // The original stays with its creator.
  expect((await details(delegate).detail(requestId)).original).toEqual(original);
  await expect(details(organiser).detail(requestId)).rejects.toThrow();
  // Colleagues of the organiser and other delegates cannot read the manage view as delegates, only the organiser can.
  for (const who of [delegate, other])
    await expect(shares(who).summaries({ registrationId, view: 'manage' })).rejects.toThrow();
});

test('a stale edit conflicts, a new edit appends, and a forged registration is refused', async () => {
  await expect(shares().command(share('An outdated edit of the shared line', 0))).rejects.toThrow();
  const next = await shares().command(
    share('We now also want to meet logistics firms in China', 1),
  );
  expect(next.status).toBe('SHARED');
  await expect(
    shares().command({
      ...share('Forged registration attempt text', 2),
      registrationId: randomUUID(),
    }),
  ).rejects.toThrow();
});

test('withdrawing the share removes the line from the organiser and keeps the original', async () => {
  const manage = await shares(organiser).summaries({ registrationId, view: 'manage' });
  const linkId = manage.objectives[0].linkId ?? manage.objectives[0].id;
  const withdrawn = await shares().command({
    action: 'withdraw',
    commandId: randomUUID(),
    linkId,
    expectedVersion: 2,
    reason: 'The company no longer wants to share this request',
    acknowledged: true,
  });
  expect(withdrawn.status).toBe('WITHDRAWN');
  // The organiser keeps only a status marker: no summary text remains visible.
  const after = await shares(organiser).summaries({ registrationId, view: 'manage' });
  expect(after.objectives).toHaveLength(1);
  expect(after.objectives[0]).toMatchObject({ status: 'WITHDRAWN' });
  expect(JSON.stringify(after)).not.toMatch(/machinery suppliers|logistics firms/);
  expect((await details(delegate).detail(requestId)).original).toEqual(original);
});
