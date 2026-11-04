// Wave 5 organiser room, consent and disclosure cases C-01 to C-08 (docs/revamp/specs/programme-consent.md,
// ADR-075 with its 3 November amendment). Real SQL through the restricted customer services, the same way
// customer-programme-projections.test.ts does it; this file only adds the cases the spec names by id. Each
// test says what an organiser may and may not see. The matching browser cases are C-09 and C-10 in
// tests/operator/revamp-programme-room.spec.ts. Sensitive: consent, tenant scope.
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { commercialFixture } from './commercial-fixture';
import { CustomerMemberRoleService } from '../../packages/auth/src/customer-member-roles';
import { CustomerMissionShareService } from '../../packages/auth/src/customer-mission-shares';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import {
  admitSyntheticCustomerRequests,
  revokeSyntheticCustomerRequest,
} from '../../packages/auth/src/customer-request-admission';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import { CustomerProgrammeTermsService } from '../../packages/auth/src/customer-programme-terms';
import { CustomerProgrammeCoordinationService } from '../../packages/auth/src/customer-programme-coordination';
import { CustomerProgrammeContextService } from '../../packages/auth/src/customer-programme-context';
import { CustomerProgrammeProjectionsService } from '../../packages/auth/src/customer-programme-projections';
const issuer = 'https://ep-consent-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof commercialFixture>>,
  workspaceId: string,
  programmeId: string,
  profileWorkspace: string,
  registrationId: string;
const make =
  <T>(Service: new (...a: never[]) => T) =>
  (person = 'organiser') =>
    new (Service as unknown as new (...a: unknown[]) => T)(
      f.runtime,
      f.auth,
      options,
      async () => ({
        subject: 'consent-' + person,
        emailVerified: true,
        expiresAt: new Date(Date.now() + 3600000),
      }),
    );
const workspaces = make(CustomerWorkspaceService),
  programmes = make(CustomerProgrammeService),
  participants = make(CustomerParticipantService),
  profiles = make(CustomerOrganisationProfileService),
  terms = make(CustomerProgrammeTermsService),
  coord = make(CustomerProgrammeCoordinationService),
  context = make(CustomerProgrammeContextService),
  projections = make(CustomerProgrammeProjectionsService);
const roles = make(CustomerMemberRoleService),
  shares = make(CustomerMissionShareService),
  requests = make(CustomerRequestService);
const scope = () => ({ workspaceId, programmeId });
async function register(person: string) {
  const invitation = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    ...scope(),
    label: 'Synthetic invitation ' + person,
    acknowledged: true,
  });
  return (
    await participants(person).command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId,
      token: invitation.token,
      displayLabel: 'Synthetic ' + person + ' label',
      consented: true,
    })
  ).id as string;
}
async function company(shared: boolean) {
  const own = await projections('participant').own({ registrationId });
  return projections('participant').command({
    action: 'company',
    commandId: randomUUID(),
    registrationId,
    expectedVersion: own.company.version,
    shared,
    ...(shared
      ? {
          profileId: own.profile!.id,
          profileVersion: own.profile!.version,
          objective: 'Synthetic explicitly shared objective',
        }
      : {}),
    acknowledged: true,
  });
}

// Reuse the commercial fixture's genuine workflow, substituting its intake with the real
// restricted customer submission. No ownership/meeting/qualification rows are fabricated.
async function submitMission() {
  let requestId = '';
  const submit = vi.spyOn(f.mission, 'submit').mockImplementation(async (commandId, brief) => {
    const result = await requests('participant').submit(
      { commandId, workspaceId: profileWorkspace, brief },
      (c, b) => f.mission.prepareCustomerIntake(c, b),
    );
    requestId = result.id;
    const row = (
      await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
        requestId,
      ])
    ).rows[0];
    return { id: row.mission_id, receipt: undefined, duplicate: result.duplicate };
  });
  try {
    const lead = await f.lead();
    return { requestId, lead };
  } finally {
    submit.mockRestore();
  }
}
function shareMission(requestId: string, summary: string) {
  return shares('participant').command({
    action: 'share',
    commandId: randomUUID(),
    registrationId,
    requestId,
    expectedVersion: 0,
    summary,
    consented: true,
  });
}

async function snapshot() {
  const tables = await f.owner.query<{ schema: string; name: string }>(
    "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN ('app','customer_private') ORDER BY schemaname,tablename",
  );
  const result: Record<string, unknown> = {};
  for (const table of tables.rows) {
    const id = '"' + table.schema + '"."' + table.name + '"';
    result[id] = (
      await f.owner.query(
        `SELECT count(*)::int n,md5(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text)) digest FROM ${id} t`,
      )
    ).rows[0];
  }
  return result;
}

beforeAll(async () => {
  f = await commercialFixture();
  const existing = await snapshot();
  await migrateCustomerProgrammeProjections(f.owner);
  const installed = await snapshot();
  expect(Object.fromEntries(Object.keys(existing).map((key) => [key, installed[key]]))).toEqual(
    existing,
  );
  await migrateCustomerProgrammeProjections(f.owner);
  for (const person of [
    'organiser',
    'participant',
    'outsider',
    'admin',
    'member',
    'another',
    'second',
  ])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'consent-' + person,
      executorId: f.serviceId,
      reason: 'Explicit synthetic programme projection fixture; no provider or real mail',
    });
  workspaceId = (
    await workspaces().provision({
      commandId: randomUUID(),
      name: 'Synthetic consent programme workspace',
    })
  ).id;
  for (const person of ['admin', 'member']) {
    const invitation = await workspaces().access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic ' + person,
    });
    const membership = await workspaces(person).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invitation.token!,
    });
    if (person === 'admin')
      await roles().command({
        action: 'set_role',
        commandId: randomUUID(),
        workspaceId,
        memberId: membership.memberId,
        role: 'admin',
        expectedRole: 'member',
      });
  }
  profileWorkspace = (
    await workspaces('participant').provision({
      commandId: randomUUID(),
      name: 'Synthetic participant company workspace',
    })
  ).id;
  await profiles('participant').command({
    commandId: randomUUID(),
    workspaceId: profileWorkspace,
    expectedVersion: 0,
    legalName: 'Synthetic participant company',
    countryCode: 'BD',
    website: 'https://company.example',
    commercialRoles: ['SELLER'],
    sectors: ['Textiles'],
    sizeBand: '11-50',
    summary: 'Synthetic private profile summary excluded from organiser projection',
    reason: 'Synthetic projection test profile',
    acknowledged: true,
  });
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic consent programme',
      reportingPurpose: 'Synthetic scoped programme projection acceptance',
      acknowledged: true,
    })
  ).id as string;
  const invite = await participants().command({
    action: 'invite',
    commandId: randomUUID(),
    ...scope(),
    label: 'Synthetic participant invitation',
    acknowledged: true,
  });
  registrationId = (
    await participants('participant').command({
      action: 'accept',
      commandId: randomUUID(),
      programmeId,
      token: invite.token,
      displayLabel: 'Synthetic participant label',
      consented: true,
    })
  ).id as string;
  await terms().publishTerms({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 0,
    included: 'Synthetic programme coordination',
    excluded: null,
    cancellationTerms: 'Synthetic cancellation terms for fixtures',
    changeTerms: 'Synthetic programme changes with notice',
    feesApply: false,
    feeNote: null,
    reason: 'Synthetic first terms',
  });
  await terms().setEligibility({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 0,
    roles: ['SELLER'],
    sectors: [],
    countries: ['BD'],
    sizeBands: [],
    minProfileFields: 6,
    reason: 'Synthetic eligibility criteria',
  });
  await terms().setPlaces({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 0,
    minimum: 1,
    maximum: 10,
    waitlist: true,
    reason: 'Synthetic places for projection tests',
  });
  await terms('participant').enrol({
    action: 'apply',
    commandId: randomUUID(),
    registrationId,
    termsVersion: 1,
    profileWorkspaceId: profileWorkspace,
    acknowledged: true,
  });
  await context().command({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 0,
    marketCode: 'BD',
    startsAt: '2030-07-15T00:00:00Z',
    endsAt: '2030-07-16T00:00:00Z',
    timezone: 'Asia/Dhaka',
    organiser: 'Synthetic organiser',
    purpose: 'Synthetic programme activity planning',
    reason: 'Synthetic initial programme dates',
    shared: true,
    acknowledged: true,
  });
});
afterAll(async () => {
  await f?.runtime.end();
  await f?.auth.end();
  await f?.owner.end();
});

const walk = (value: unknown, visit: (key: string | null, text: string | null) => void) => {
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      visit(key, null);
      walk(item, visit);
    }
  else if (typeof value === 'string') visit(null, value);
};
const allText = (value: unknown) => {
  const text: string[] = [];
  walk(value, (_key, string) => string !== null && text.push(string));
  return text.join('\n');
};
const allKeys = (value: unknown) => {
  const keys = new Set<string>();
  walk(value, (key) => key !== null && keys.add(key));
  return [...keys].sort();
};
let secondRegistration: string;
let otherWorkspace: string, otherProgramme: string;

test('C-01 a member, an outsider and the organiser of another programme are denied the projection and counts', async () => {
  // A second, unrelated programme workspace with its own organiser.
  otherWorkspace = (
    await workspaces('another').provision({
      commandId: randomUUID(),
      name: 'Synthetic other programme workspace',
    })
  ).id;
  otherProgramme = (
    await programmes('another').create({
      commandId: randomUUID(),
      workspaceId: otherWorkspace,
      name: 'Synthetic other programme',
      reportingPurpose: 'Synthetic unrelated programme for cross-programme denial',
      acknowledged: true,
    })
  ).id as string;
  expect(
    (
      await projections('another').owner({
        workspaceId: otherWorkspace,
        programmeId: otherProgramme,
      })
    ).programmeId,
  ).toBe(otherProgramme);
  for (const person of ['member', 'outsider', 'another', 'participant']) {
    await expect(projections(person).owner(scope()), person).rejects.toThrow();
    // Neither this programme named under their own workspace, nor their programme under this workspace.
    await expect(
      projections(person).owner({ workspaceId: otherWorkspace, programmeId }),
    ).rejects.toThrow();
  }
  await expect(
    projections('another').owner({ workspaceId, programmeId: otherProgramme }),
  ).rejects.toThrow();
  // The denial is the same for a programme that does not exist, so it does not reveal which programmes exist.
  const reasons = new Set<string>();
  for (const attempt of [
    projections('outsider').owner(scope()),
    projections('another').owner(scope()),
    projections('another').owner({ workspaceId, programmeId: randomUUID() }),
  ])
    await attempt.catch((error: Error) => reasons.add(error.message));
  expect(reasons.size).toBe(1);
  // An organiser cannot share or withdraw on a participant's behalf.
  await expect(
    projections().command({
      action: 'company',
      commandId: randomUUID(),
      registrationId,
      expectedVersion: 0,
      shared: false,
      acknowledged: true,
    }),
  ).rejects.toThrow();
});

test('C-07 readiness names each missing criterion and counts from the server', async () => {
  secondRegistration = await register('second');
  const view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.readiness).toMatchObject({ activeParticipants: 2, readyParticipants: 0 });
  const first = view.companies.find((x) => x.registrationId === registrationId)!;
  const second = view.companies.find((x) => x.registrationId === secondRegistration)!;
  // The enrolled participant has place, terms and eligibility; only the company share is missing.
  expect(first.missing).toEqual(['currentSharedCompany']);
  expect(first.ready).toBe(false);
  // The registered but not enrolled participant misses every criterion, each named.
  expect([...second.missing].sort()).toEqual(
    ['confirmedPlace', 'currentEligibility', 'currentSharedCompany', 'currentTerms'].sort(),
  );
  await company(true);
  const after = await projections().owner({ ...scope(), pageSize: 50 });
  expect(after.readiness).toMatchObject({ activeParticipants: 2, readyParticipants: 1 });
  expect(after.readiness.definition).toBe('ACTIVE_ELIGIBLE_PLACED_CURRENT_TERMS_SHARED_COMPANY');
});

test('C-02 with no share, a withdrawn share, a removed registration or a revoked source the organiser sees not shared, never zero or an empty company', async () => {
  const row = async (id: string) =>
    (await projections().owner({ ...scope(), pageSize: 50 })).companies.find(
      (x) => x.registrationId === id,
    );
  // No share yet: the participant is listed, and the company is null, not an empty object.
  expect((await row(secondRegistration))?.company).toBeNull();
  // Shared, then withdrawn: back to null, with the participant still listed.
  await company(true);
  expect((await row(registrationId))?.company).toMatchObject({
    name: 'Synthetic participant company',
  });
  await company(false);
  const withdrawn = await row(registrationId);
  expect(withdrawn?.company).toBeNull();
  expect(withdrawn?.missing).toContain('currentSharedCompany');
  expect(allText(await projections().owner({ ...scope(), pageSize: 50 }))).not.toContain(
    'Synthetic participant company',
  );
  // A removed (withdrawn) registration is no longer a participant at all, and counts no one.
  await participants('second').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: secondRegistration,
    reason: 'Synthetic participant leaves the programme',
    acknowledged: true,
  });
  const view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.companies.some((x) => x.registrationId === secondRegistration)).toBe(false);
  expect(view.readiness.activeParticipants).toBe(1);
  await company(true);
});

test('C-03 after the participant re-enrols with another company the old company never appears', async () => {
  const replacement = (
    await workspaces('participant').provision({
      commandId: randomUUID(),
      name: 'Synthetic re-enrol company workspace',
    })
  ).id;
  await profiles('participant').command({
    commandId: randomUUID(),
    workspaceId: replacement,
    expectedVersion: 0,
    legalName: 'Synthetic second employer company',
    countryCode: 'BD',
    website: 'https://second-employer.example',
    commercialRoles: ['SELLER'],
    sectors: ['Textiles'],
    sizeBand: '11-50',
    summary: 'Synthetic second employer private summary',
    reason: 'Synthetic re-enrol source',
    acknowledged: true,
  });
  await terms('participant').enrol({
    action: 'cancel',
    commandId: randomUUID(),
    registrationId,
    acknowledged: true,
  });
  await terms('participant').enrol({
    action: 'apply',
    commandId: randomUUID(),
    registrationId,
    termsVersion: 1,
    profileWorkspaceId: replacement,
    acknowledged: true,
  });
  const view = await projections().owner({ ...scope(), pageSize: 50 });
  const row = view.companies.find((x) => x.registrationId === registrationId)!;
  expect(row.company).toBeNull();
  expect(row.ready).toBe(false);
  expect(row.missing).toContain('currentSharedCompany');
  const text = allText(view);
  expect(text).not.toContain('Synthetic participant company');
  expect(text).not.toContain('Synthetic second employer company');
  expect(view.readiness.readyParticipants).toBe(0);
  expect((await projections('participant').own({ registrationId })).company).toMatchObject({
    shared: false,
    sourceChanged: true,
  });
});

test('C-04 C-05 C-06 C-08 meeting counts need their own consent, scheduled and qualified-held stay separate, and nothing private reaches the organiser', async () => {
  const principal = (
    await f.owner.query(
      'SELECT principal_id FROM customer_private.programme_registration WHERE id=$1',
      [registrationId],
    )
  ).rows[0].principal_id;
  await admitSyntheticCustomerRequests(f.owner, {
    principalId: principal,
    reason: 'Synthetic explicit source admission for consent roll-up',
  });
  const { requestId, lead } = await submitMission();
  // C-04: sharing the mission objective is not consent to meeting counts.
  const link = await shareMission(requestId, 'Synthetic shared objective only');
  let view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.meetings.state).toBe('NOT_SHARED');
  expect(view.meetings.scheduled ?? null).toBeNull();
  expect(view.meetings.qualifiedHeld ?? null).toBeNull();
  const permit = {
    action: 'meetings',
    commandId: randomUUID(),
    linkId: link.id,
    expectedVersion: 0,
    shared: true,
    acknowledged: true,
  };
  await projections('participant').command(permit);
  view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.meetings.state).toBe('AVAILABLE');
  // C-05: a held meeting that is not qualified is neither scheduled nor qualified-held, and a
  // participant-reported outcome never makes it qualified.
  expect(view.meetings).toMatchObject({ scheduled: 0, qualifiedHeld: 0 });
  await coord('participant').submitRecord({
    commandId: randomUUID(),
    registrationId,
    kind: 'OUTCOME',
    recordId: null,
    expectedVersion: 0,
    rating: null,
    outcomeKind: 'MEETING_HELD',
    occurredOn: '2026-11-03',
    note: 'Synthetic participant-reported meeting only',
    shared: true,
    retracted: false,
    acknowledged: true,
  });
  view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.meetings).toMatchObject({ scheduled: 0, qualifiedHeld: 0 });
  await f.transition(lead.opportunityId, 'QUALIFIED_OPPORTUNITY');
  view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.meetings).toMatchObject({ scheduled: 0, qualifiedHeld: 1 });
  expect(typeof view.meetings.scheduled).toBe('number');
  expect(typeof view.meetings.qualifiedHeld).toBe('number');

  // C-06: no meeting title, counterparty, contact, note, opportunity value or mission id anywhere in the
  // organiser's body, by key and by text, however deep.
  const forbiddenText = [
    'Synthetic commercial meeting',
    'Synthetic Buyer',
    'Synthetic Seller',
    'Synthetic meeting room',
    'Review observed requirement details',
    'Both invented participants attended',
    'Synthetic towel opportunity',
    'Mission arranged the meeting',
    'Synthetic participant-reported meeting only',
    'Synthetic shared objective only',
    'Private negotiation',
    lead.missionId,
    lead.meetingId,
    lead.opportunityId,
    requestId,
    link.id,
  ];
  const body = await projections().owner({ ...scope(), pageSize: 50 });
  const text = allText(body);
  for (const secret of forbiddenText) expect(text, secret).not.toContain(secret);
  // The walkers read the body: the participant's own label and the meetings keys are found by them.
  expect(text).toContain('Synthetic participant label');
  expect(allKeys(body)).toEqual(expect.arrayContaining(['meetings', 'readiness', 'companies']));
  expect(Object.keys(body.meetings).sort()).toEqual(
    [
      'participantsSharing',
      'qualifiedHeld',
      'scheduled',
      'sharedLinks',
      'state',
      'unavailableLinks',
    ].sort(),
  );
  // C-08: nothing a participant holds privately about price, quote or economics is in the organiser body.
  expect(
    allKeys(body).filter((key) =>
      /quot|price|amount|currency|budget|value|deal|cost|margin|revenue|fee/i.test(key),
    ),
  ).toEqual([]);

  // Withdrawing the count consent returns to not shared, with no count at all.
  await projections('participant').command({
    ...permit,
    commandId: randomUUID(),
    expectedVersion: 1,
    shared: false,
  });
  view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.meetings.state).toBe('NOT_SHARED');
  expect(view.meetings.qualifiedHeld ?? null).toBeNull();
  // A revoked source is unavailable, which is not the same as zero meetings.
  await projections('participant').command({
    ...permit,
    commandId: randomUUID(),
    expectedVersion: 2,
  });
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId,
    reason: 'Synthetic revocation for the C-02 unavailable source case',
  });
  view = await projections().owner({ ...scope(), pageSize: 50 });
  expect(view.meetings.state).toBe('UNAVAILABLE');
  expect(view.meetings.qualifiedHeld ?? null).toBeNull();
  expect(view.meetings.scheduled ?? null).toBeNull();
});
