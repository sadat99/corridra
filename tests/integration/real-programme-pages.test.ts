import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture } from './real-staff-fixture';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import {
  CustomerProgrammePublicationService,
  ProgrammePageReader,
  programmePublicationRefusal,
} from '../../packages/auth/src/customer-programme-publication';

// The public programme page and applications (ADR-080) in real data mode, on top of the real-use modules and the real
// programme lifecycle module. The sample suite (customer-programme-publication) proves the full rule set; this one
// proves the same module holds with real words, a real workspace and the real archive.
const issuer =
  'https://ep-real-pages-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
const organiser = 'pages-organiser';
const delegate = 'pages-delegate';
const outsider = 'pages-outsider';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let workspaceId: string;
let programmeId: string;
let address: string;
const runtime = () => [s.f.runtime, s.f.auth, options] as const;
const workspaces = (who: string) => new CustomerWorkspaceService(...runtime(), sessionFor(who));
const programmes = (who = organiser) => new CustomerProgrammeService(...runtime(), sessionFor(who));
const participants = (who = organiser) =>
  new CustomerParticipantService(...runtime(), sessionFor(who));
const pages = (who = organiser) =>
  new CustomerProgrammePublicationService(...runtime(), sessionFor(who));
const reader = () => new ProgrammePageReader(s.f.runtime);
const copy = {
  title: 'China agricultural machinery delegation',
  organiser: 'Dhaka Trade Association',
  summary: 'A ten company buying delegation to compare rice transplanters before the next season.',
  destination: 'Guangzhou and Foshan, China',
  dates: '12 to 18 April 2027, to be confirmed',
  focus: 'Agricultural machinery',
  audience: 'Owners and buyers of importers and dealers.',
  eligibility: 'A registered business that imports or sells farm machinery.',
  activities: [{ label: 'Factory visits in Foshan', status: 'PLANNED' as const }],
  included: ['Programme coordination'],
  excluded: ['Flights'],
};
const publish = (expectedVersion: number) => ({
  action: 'publish' as const,
  commandId: randomUUID(),
  workspaceId,
  programmeId,
  expectedVersion,
  copy,
  closesAt: new Date(Date.now() + 240 * 3600000).toISOString(),
  acknowledged: true as const,
});
const apply = (version: number) => ({
  action: 'apply' as const,
  commandId: randomUUID(),
  address,
  version,
  displayLabel: 'Rahman Agro Imports',
  statement: 'We plan to buy two combine harvesters this year and want factory visits.',
  consented: true as const,
});
const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return programmePublicationRefusal(error) ?? (error as { code?: string }).code ?? 'error';
  }
  return 'no refusal';
};

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-pages-fixture-secret');
  await migrateCustomerProgrammeLifecycle(s.f.owner);
  await migrateCustomerProgrammePublication(s.f.owner);
  workspaceId = (
    await workspaces(organiser).provision({
      commandId: randomUUID(),
      name: 'Dhaka Trade Association',
    })
  ).id;
  await workspaces(delegate).provision({ commandId: randomUUID(), name: 'Rahman Agro Imports' });
  await workspaces(outsider).provision({ commandId: randomUUID(), name: 'Unrelated company' });
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Spring machinery delegation',
      reportingPurpose: 'Prepare the spring machinery delegation',
      acknowledged: true,
    })
  ).id;
}, 240000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('a real organiser publishes real words; the page is not a sample; an outsider cannot publish', async () => {
  expect(await refusal(pages(outsider).publication(publish(0)))).toBe('42501');
  const made = await pages().publication(publish(0));
  expect(made).toMatchObject({ version: 1, state: 'OPEN' });
  address = made.address;
  expect(address).toMatch(/^china-agricultural-machinery-delegation-[a-z0-9]{10}$/);
  const page = await reader().read(address);
  expect(page).toMatchObject({ state: 'OPEN', sample: false, programme: copy });
});

test('with real use switched off the real page is not public; switched back on it is readable again', async () => {
  // The configuration row is immutable for the application; only the database owner can change it, as here.
  const realUse = async (enabled: boolean) => {
    await s.f.owner.query(
      'ALTER TABLE customer_private.real_use_configuration DISABLE TRIGGER USER',
    );
    try {
      await s.f.owner.query('UPDATE customer_private.real_use_configuration SET enabled=$1', [
        enabled,
      ]);
    } finally {
      await s.f.owner.query(
        'ALTER TABLE customer_private.real_use_configuration ENABLE TRIGGER USER',
      );
    }
  };
  expect(await reader().read(address)).toMatchObject({ state: 'OPEN', sample: false });
  await realUse(false);
  try {
    // Nobody can sign in to take the page down while real use is off, so it must not stay public.
    expect(await reader().read(address)).toEqual({ state: 'unknown' });
  } finally {
    await realUse(true);
  }
  expect(await reader().read(address)).toMatchObject({
    state: 'OPEN',
    sample: false,
    programme: copy,
  });
});

test('a real applicant applies, is invited and joins; the registration is the ordinary one', async () => {
  const applied = await pages(delegate).application(apply(1));
  expect(applied).toMatchObject({ status: 'SUBMITTED', displayLabel: 'Rahman Agro Imports' });
  expect(await refusal(pages(outsider).applications({ workspaceId, programmeId }))).toBe('42501');
  const invited = await pages().application({
    action: 'decide',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    applicationId: applied.id,
    expectedVersion: 0,
    decision: 'INVITED',
    acknowledged: true,
  });
  expect(invited).toMatchObject({ status: 'INVITED', decisionVersion: 1 });
  const joined = await pages(delegate).application({
    action: 'join',
    commandId: randomUUID(),
    applicationId: applied.id,
    consented: true,
  });
  expect(joined).toMatchObject({ status: 'JOINED' });
  const own = await participants(delegate).own();
  expect(own.registrations).toHaveLength(1);
  expect(own.registrations[0]).toMatchObject({
    id: joined.registrationId,
    programmeId,
    status: 'REGISTERED',
    displayLabel: 'Rahman Agro Imports',
  });
  const organiserView = await participants().list({ workspaceId, programmeId });
  expect(organiserView.registrations).toHaveLength(1);
  // The organiser learns the chosen name and the statement, never the applicant's email address.
  const list = await pages().applications({ workspaceId, programmeId });
  expect(JSON.stringify(list)).not.toContain('@business.test');
});

test('archiving the programme with the real lifecycle module pauses the page; restoring reopens it', async () => {
  const outsiderApplied = await pages(outsider).application({
    ...apply(1),
    displayLabel: 'Unrelated company',
  });
  const archived = await programmes().change({
    operation: 'archive',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: 0,
  });
  expect(archived).toMatchObject({ archived: true });
  expect(await reader().read(address)).toEqual({ state: 'unknown' });
  expect((await pages().view({ workspaceId, programmeId })).state).toBe('PAUSED');
  expect(await refusal(pages().publication(publish(1)))).toBe('PROGRAMME_PUBLICATION_PAUSED');
  expect(
    await refusal(
      pages().application({
        action: 'decide',
        commandId: randomUUID(),
        workspaceId,
        programmeId,
        applicationId: outsiderApplied.id,
        expectedVersion: 0,
        decision: 'INVITED',
        acknowledged: true,
      }),
    ),
  ).toBe('PROGRAMME_PUBLICATION_PAUSED');
  await programmes().change({
    operation: 'restore',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    expectedVersion: archived.version,
  });
  expect(await reader().read(address)).toMatchObject({ state: 'OPEN', version: 1 });
  expect((await pages().view({ workspaceId, programmeId })).state).toBe('OPEN');
});
