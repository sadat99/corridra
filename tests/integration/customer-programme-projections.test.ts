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
const issuer =
  'https://ep-projections-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
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
        subject: 'projection-' + person,
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
let anotherRegistration: string;
let adminMemberId: string;
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
  for (const person of ['organiser', 'participant', 'outsider', 'admin', 'member', 'another'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'projection-' + person,
      executorId: f.serviceId,
      reason: 'Explicit synthetic programme projection fixture; no provider or real mail',
    });
  workspaceId = (
    await workspaces().provision({
      commandId: randomUUID(),
      name: 'Synthetic projections programme workspace',
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
    if (person === 'admin') adminMemberId = membership.memberId!;
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
      name: 'Synthetic projection programme',
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
test('company sharing is explicit, minimal, pinned and ready only with the complete checklist', async () => {
  let view = await projections().owner(scope());
  expect(view.readiness).toMatchObject({ activeParticipants: 1, readyParticipants: 0 });
  expect(view.companies[0]?.company).toBeNull();
  const own = await projections('participant').own({ registrationId });
  expect(own.profile?.version).toBe(1);
  const command = {
    action: 'company',
    commandId: randomUUID(),
    registrationId,
    expectedVersion: 0,
    shared: true,
    profileId: own.profile!.id,
    profileVersion: 1,
    objective: 'Synthetic export objective',
    acknowledged: true,
  };
  await projections('participant').command(command);
  expect((await projections('participant').command(command)).replayed).toBe(true);
  view = await projections().owner(scope());
  expect(view.readiness.readyParticipants).toBe(1);
  expect(view.companies[0]?.company?.name).toBe('Synthetic participant company');
  expect(JSON.stringify(view)).not.toContain('private profile summary');
  expect(JSON.stringify(view)).not.toContain('company.example');
  expect(JSON.stringify(view)).not.toContain(profileWorkspace);
  await expect(projections('outsider').owner(scope())).rejects.toThrow();
  await expect(projections().own({ registrationId })).rejects.toThrow();
});
test('schedule bounds and attendee intersections use canonical programme times', async () => {
  const saved = await coord().saveTask({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 0,
    task: {
      taskId: null,
      title: 'Synthetic morning activity',
      detail: null,
      status: 'OPEN',
      dueOn: null,
      assigneeLabel: null,
    },
  });
  const taskId = saved.task.id;
  await projections().command({
    action: 'schedule',
    commandId: randomUUID(),
    ...scope(),
    taskId,
    expectedVersion: 0,
    scheduled: true,
    startsAt: '2030-07-15T04:00:00Z',
    endsAt: '2030-07-15T05:00:00Z',
    audience: 'ALL',
    attendees: [],
    acknowledged: true,
  });
  const view = await projections().owner(scope());
  expect(view.agenda[0]).toMatchObject({ taskId, scheduled: true, timezone: 'Asia/Dhaka' });
  expect(view.conflicts).toEqual([]);
  expect(view.meetings).toMatchObject({
    state: 'NOT_SHARED',
    scheduled: null,
    qualifiedHeld: null,
  });
});

test('only owners/admins can read projections; identity/context and direct private access are denied', async () => {
  expect((await projections('admin').owner(scope())).programmeId).toBe(programmeId);
  for (const person of ['member', 'participant', 'outsider'])
    await expect(projections(person).owner(scope())).rejects.toThrow();
  await expect(projections().owner({ ...scope(), programmeId: randomUUID() })).rejects.toThrow();
  await expect(projections().owner(scope(), 'different-subject', issuer)).rejects.toThrow();
  for (const pool of [f.runtime, f.auth]) {
    await expect(
      pool.query('SELECT * FROM customer_private.programme_projection_company'),
    ).rejects.toThrow();
    await expect(
      pool.query('SELECT * FROM customer_private.programme_projection_rows($1,$2)', [
        workspaceId,
        programmeId,
      ]),
    ).rejects.toThrow();
  }
  await expect(
    projections('outsider').command({
      action: 'company',
      commandId: randomUUID(),
      registrationId,
      expectedVersion: 1,
      shared: false,
      acknowledged: true,
    }),
  ).rejects.toThrow();
});

test('sharing withdraws immediately; private profile edits are not silently shared', async () => {
  await company(false);
  let view = await projections().owner(scope());
  expect(view.companies[0]?.company).toBeNull();
  expect(view.readiness.readyParticipants).toBe(0);
  await company(true);
  await profiles('participant').command({
    commandId: randomUUID(),
    workspaceId: profileWorkspace,
    expectedVersion: 1,
    legalName: 'Synthetic changed private name',
    countryCode: 'DE',
    website: 'https://private.example',
    commercialRoles: ['SELLER'],
    sectors: ['Textiles'],
    sizeBand: '11-50',
    summary: 'Synthetic new private summary',
    reason: 'Synthetic private update',
    acknowledged: true,
  });
  view = await projections().owner(scope());
  expect(view.companies[0]?.company?.name).toBe('Synthetic participant company');
  expect(JSON.stringify(view)).not.toContain('changed private name');
  expect(view.readiness.readyParticipants).toBe(0);
  await company(true);
  view = await projections().owner(scope());
  expect(view.companies[0]?.company?.name).toBe('Synthetic changed private name');
  expect(view.readiness.readyParticipants).toBe(0);
  expect(view.companies[0]?.missing).toContain('currentEligibility');
  await profiles('participant').command({
    commandId: randomUUID(),
    workspaceId: profileWorkspace,
    expectedVersion: 2,
    legalName: 'Synthetic current company',
    countryCode: 'BD',
    website: 'https://company.example',
    commercialRoles: ['SELLER'],
    sectors: ['Textiles'],
    sizeBand: '11-50',
    summary: 'Synthetic private summary',
    reason: 'Synthetic current profile',
    acknowledged: true,
  });
  await company(true);
  expect((await projections().owner(scope())).readiness.readyParticipants).toBe(1);
});

test('the current terms version is required, with no inferred acceptance', async () => {
  await terms().publishTerms({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 1,
    included: 'Synthetic revised programme coordination',
    excluded: null,
    cancellationTerms: 'Synthetic cancellation terms for fixtures',
    changeTerms: 'Synthetic changes with notice',
    feesApply: false,
    feeNote: null,
    reason: 'Synthetic revised terms',
  });
  expect((await projections().owner(scope())).companies[0]?.missing).toContain('currentTerms');
  await terms('participant').enrol({
    action: 'accept_terms',
    commandId: randomUUID(),
    registrationId,
    termsVersion: 2,
    acknowledged: true,
  });
  expect((await projections().owner(scope())).readiness.readyParticipants).toBe(1);
});

test('overlaps, adjacency, different attendees, cancellation and bounds use actual task records', async () => {
  anotherRegistration = await register('another');
  const task = (
    await coord().saveTask({
      commandId: randomUUID(),
      ...scope(),
      expectedVersion: 0,
      task: {
        taskId: null,
        title: 'Synthetic second activity',
        detail: null,
        status: 'OPEN',
        dueOn: null,
        assigneeLabel: null,
      },
    })
  ).task;
  const input = {
    action: 'schedule',
    commandId: randomUUID(),
    ...scope(),
    taskId: task.id,
    expectedVersion: 0,
    scheduled: true,
    startsAt: '2030-07-15T04:30:00Z',
    endsAt: '2030-07-15T05:30:00Z',
    audience: 'SELECTED',
    attendees: [registrationId],
    acknowledged: true,
  };
  await projections().command(input);
  expect((await projections().owner(scope())).conflicts).toHaveLength(1);
  await projections().command({
    ...input,
    commandId: randomUUID(),
    expectedVersion: 1,
    startsAt: '2030-07-15T05:00:00Z',
    endsAt: '2030-07-15T06:00:00Z',
  });
  expect((await projections().owner(scope())).conflicts).toHaveLength(0);
  let view = await projections().owner(scope());
  const first = view.agenda.find((t) => t.taskId !== task.id)!;
  await projections().command({
    ...input,
    commandId: randomUUID(),
    taskId: first.taskId,
    expectedVersion: first.version,
    startsAt: first.startsAt,
    endsAt: first.endsAt,
    attendees: [anotherRegistration],
  });
  await projections().command({ ...input, commandId: randomUUID(), expectedVersion: 2 });
  expect((await projections().owner(scope())).conflicts).toHaveLength(0);
  await expect(
    projections().command({
      ...input,
      commandId: randomUUID(),
      expectedVersion: 3,
      attendees: [randomUUID()],
    }),
  ).rejects.toThrow();
  await expect(
    projections().command({
      ...input,
      commandId: randomUUID(),
      expectedVersion: 3,
      startsAt: '2030-07-14T04:00:00Z',
    }),
  ).rejects.toThrow();
  await projections().command({
    ...input,
    commandId: randomUUID(),
    expectedVersion: 3,
    audience: 'ALL',
    attendees: [],
  });
  expect((await projections().owner(scope())).conflicts).toHaveLength(1);
  await coord().saveTask({
    commandId: randomUUID(),
    ...scope(),
    expectedVersion: 1,
    task: {
      taskId: task.id,
      title: task.title,
      detail: null,
      status: 'CANCELLED',
      dueOn: null,
      assigneeLabel: null,
    },
  });
  view = await projections().owner(scope());
  expect(view.conflicts).toHaveLength(0);
  await expect(
    projections().command({ ...input, commandId: randomUUID(), expectedVersion: 4 }),
  ).rejects.toThrow();
});

test('concurrent retries produce one revision/event and changed payloads conflict', async () => {
  const own = await projections('participant').own({ registrationId });
  const input = {
    action: 'company',
    commandId: randomUUID(),
    registrationId,
    expectedVersion: own.company.version,
    shared: true,
    profileId: own.profile!.id,
    profileVersion: own.profile!.version,
    objective: 'Synthetic atomic company consent',
    acknowledged: true,
  };
  const results = await Promise.all([
    projections('participant').command(input),
    projections('participant').command(input),
  ]);
  expect(results.map((x) => x.replayed).sort()).toEqual([false, true]);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_projection_command WHERE command_id=$1',
        [input.commandId],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    projections('participant').command({ ...input, objective: 'Synthetic changed intent' }),
  ).rejects.toThrow();
  const event = (
    await f.owner.query('SELECT payload FROM app.domain_event WHERE correlation_id=$1', [
      input.commandId,
    ])
  ).rows;
  expect(event).toHaveLength(1);
  expect(JSON.stringify(event)).not.toContain('atomic company consent');
});

test('meeting counts require separate consent and genuine canonical qualification, then revoke immediately', async () => {
  const principal = (
    await f.owner.query(
      'SELECT principal_id FROM customer_private.programme_registration WHERE id=$1',
      [registrationId],
    )
  ).rows[0].principal_id;
  await admitSyntheticCustomerRequests(f.owner, {
    principalId: principal,
    reason: 'Synthetic explicit source admission for meeting roll-up',
  });
  const { requestId, lead } = await submitMission();
  const link = await shareMission(requestId, 'Synthetic shared objective only');
  expect((await projections().owner(scope())).meetings.state).toBe('NOT_SHARED');
  const permit = {
    action: 'meetings',
    commandId: randomUUID(),
    linkId: link.id,
    expectedVersion: 0,
    shared: true,
    acknowledged: true,
  };
  await projections('participant').command(permit);
  let view = await projections().owner(scope());
  expect(view.meetings).toMatchObject({ state: 'AVAILABLE', scheduled: 0, qualifiedHeld: 0 });
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
  expect((await projections().owner(scope())).meetings.qualifiedHeld).toBe(0);
  await f.transition(lead.opportunityId, 'QUALIFIED_OPPORTUNITY');
  view = await projections().owner(scope());
  expect(view.meetings.qualifiedHeld).toBe(1);
  const encoded = JSON.stringify(view);
  for (const secret of [
    lead.missionId,
    lead.meetingId,
    lead.opportunityId,
    requestId,
    'Private negotiation',
    'Synthetic towel opportunity',
  ])
    expect(encoded).not.toContain(secret);
  await projections('participant').command({
    ...permit,
    commandId: randomUUID(),
    expectedVersion: 1,
    shared: false,
  });
  expect((await projections().owner(scope())).meetings).toMatchObject({
    state: 'NOT_SHARED',
    qualifiedHeld: null,
  });
  await projections('participant').command({
    ...permit,
    commandId: randomUUID(),
    expectedVersion: 2,
  });
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId,
    reason: 'Synthetic immediate source revocation',
  });
  expect((await projections().owner(scope())).meetings).toMatchObject({
    state: 'UNAVAILABLE',
    qualifiedHeld: null,
  });
});

test('a projection view never outlives the retention of the mission sources it returns', async () => {
  const at = (view: { expiresAt: string }) => Date.parse(view.expiresAt);
  const permit = async (linkId: string) =>
    projections('participant').command({
      action: 'meetings',
      commandId: randomUUID(),
      linkId,
      expectedVersion: 0,
      shared: true,
      acknowledged: true,
    });
  const noSources = () => projections('another').own({ registrationId: anotherRegistration });
  // Control 1: a participant with no mission link keeps the plain short coordination expiry.
  const plain = at(await noSources());
  // Control 2: a consented source with default retention does not shorten later views.
  const longLived = await submitMission();
  await permit((await shareMission(longLived.requestId, 'Synthetic long retention objective')).id);
  expect(at(await projections().owner(scope()))).toBeGreaterThanOrEqual(plain);
  expect(at(await projections('participant').own({ registrationId }))).toBeGreaterThanOrEqual(
    plain,
  );
  await revokeSyntheticCustomerRequest(f.owner, {
    requestId: longLived.requestId,
    reason: 'Synthetic end of the long retention control',
  });
  // A source whose retention ends within seconds bounds both views. Nothing else runs between its creation
  // and the reads, so the retention window is still open when they happen.
  await f.owner.query(
    "CREATE FUNCTION customer_private.projection_short_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.retention_until:=clock_timestamp()+interval '12 seconds';RETURN NEW;END $$",
  );
  await f.owner.query(
    'CREATE TRIGGER projection_short_retention BEFORE INSERT ON app.mission_intake FOR EACH ROW EXECUTE FUNCTION customer_private.projection_short_retention()',
  );
  let short: Awaited<ReturnType<typeof submitMission>>;
  let owner: Awaited<ReturnType<ReturnType<typeof projections>['owner']>>;
  let own: Awaited<ReturnType<ReturnType<typeof projections>['own']>>;
  try {
    short = await submitMission();
    await permit((await shareMission(short.requestId, 'Synthetic short retention objective')).id);
    owner = await projections().owner(scope());
    own = await projections('participant').own({ registrationId });
  } finally {
    await f.owner.query('DROP TRIGGER projection_short_retention ON app.mission_intake');
    await f.owner.query('DROP FUNCTION customer_private.projection_short_retention()');
  }
  const ceiling = at(await noSources());
  const retention = (
    await f.owner.query<{ retention_until: Date }>(
      'SELECT i.retention_until FROM customer_private.owned_request r JOIN app.mission_intake i ON i.tenant_id=r.mission_tenant_id AND i.id=r.mission_id WHERE r.id=$1',
      [short.requestId],
    )
  ).rows[0]!.retention_until;
  expect(owner.meetings.sharedLinks).toBe(1);
  expect(at(owner)).toBeLessThanOrEqual(retention.getTime());
  expect(at(own)).toBeLessThanOrEqual(retention.getTime());
  // Without the bound these views would have run to the ceiling read after them.
  expect(retention.getTime()).toBeLessThan(ceiling);
  // Once the source ends nothing is returned for it and the view returns to the plain expiry.
  await f.owner.query(
    'SELECT pg_sleep(greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.3)',
    [retention],
  );
  const after = await projections().owner(scope());
  expect(after.meetings).toMatchObject({
    state: 'UNAVAILABLE',
    scheduled: null,
    qualifiedHeld: null,
  });
  expect(at(after)).toBeGreaterThan(retention.getTime());
  expect(at(await projections('participant').own({ registrationId }))).toBeGreaterThan(
    retention.getTime(),
  );
}, 60000);

test('active totals are independent of the loaded participant page', async () => {
  const before = (await projections().owner(scope())).readiness.activeParticipants;
  for (let i = 0; i < 25; i++) {
    const person = 'page-' + i;
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: 'projection-' + person,
      executorId: f.serviceId,
      reason: 'Explicit synthetic paged participant fixture',
    });
    await register(person);
  }
  const page = await projections().owner({ ...scope(), pageSize: 1 });
  expect(page.companies).toHaveLength(1);
  expect(page.nextAfter).not.toBeNull();
  expect(page.readiness.activeParticipants).toBe(before + 25);
  const next = await projections().owner({ ...scope(), after: page.nextAfter!, pageSize: 1 });
  expect(next.companies[0]?.registrationId).not.toBe(page.companies[0]?.registrationId);
  expect(next.readiness).toEqual(page.readiness);
});

test('disabled source identities and expired sessions cannot retain a projection', async () => {
  const prior = await projections().owner(scope());
  try {
    await f.owner.query(
      'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE issuer=$1 AND subject=$2',
      [issuer, 'projection-participant'],
    );
    const view = await projections().owner(scope());
    expect(view.readiness.activeParticipants).toBe(prior.readiness.activeParticipants - 1);
    expect(view.companies.some((x) => x.registrationId === registrationId)).toBe(false);
    await expect(projections('participant').own({ registrationId })).rejects.toThrow();
  } finally {
    await f.owner.query(
      'UPDATE customer_private.principal SET disabled_at=NULL WHERE issuer=$1 AND subject=$2',
      [issuer, 'projection-participant'],
    );
  }
  const expired = new CustomerProgrammeProjectionsService(f.runtime, f.auth, options, async () => ({
    subject: 'projection-organiser',
    emailVerified: true,
    expiresAt: new Date(Date.now() - 1000),
  }));
  await expect(expired.owner(scope())).rejects.toThrow();
});

test('a replacement profile with the same version cannot reuse prior reviewed company consent', async () => {
  const reviewed = await projections('participant').own({ registrationId });
  const replacement = (
    await workspaces('participant').provision({
      commandId: randomUUID(),
      name: 'Synthetic replacement company workspace',
    })
  ).id;
  for (let version = 0; version < reviewed.profile!.version; version++)
    await profiles('participant').command({
      commandId: randomUUID(),
      workspaceId: replacement,
      expectedVersion: version,
      legalName: 'Synthetic replacement private company',
      countryCode: 'BD',
      website: 'https://replacement.example',
      commercialRoles: ['SELLER'],
      sectors: ['Textiles'],
      sizeBand: '11-50',
      summary: 'Synthetic unreviewed replacement company profile',
      reason: 'Synthetic replacement source fixture',
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
    termsVersion: 2,
    profileWorkspaceId: replacement,
    acknowledged: true,
  });
  await expect(
    projections('participant').command({
      action: 'company',
      commandId: randomUUID(),
      registrationId,
      expectedVersion: reviewed.company.version,
      shared: true,
      profileId: reviewed.profile!.id,
      profileVersion: reviewed.profile!.version,
      objective: 'Synthetic objective reviewed for the original company',
      acknowledged: true,
    }),
  ).rejects.toThrow();
  const current = await projections('participant').own({ registrationId });
  expect(current.profile!.version).toBe(reviewed.profile!.version);
  expect(current.profile!.id).not.toBe(reviewed.profile!.id);
  // The earlier consent names the old company. Until the participant reviews and shares again it is dormant:
  // organisers receive nothing from it and the participant is told sharing is off.
  const dormant = await projections().owner({ ...scope(), pageSize: 50 });
  const dormantRow = dormant.companies.find((x) => x.registrationId === registrationId)!;
  expect(dormantRow.company).toBeNull();
  expect(dormantRow.ready).toBe(false);
  expect(dormantRow.missing).toContain('currentSharedCompany');
  expect(JSON.stringify(dormant)).not.toContain('Synthetic participant company');
  expect(JSON.stringify(dormant)).not.toContain('Synthetic replacement private company');
  expect(dormant.readiness.readyParticipants).toBe(0);
  expect(current.company).toMatchObject({ shared: false, sourceChanged: true });
  // Withdrawing the dormant permission is allowed and clears the indicator; nothing is shared by doing so.
  await company(false);
  const cleared = await projections('participant').own({ registrationId });
  expect(cleared.company).toMatchObject({ shared: false, sourceChanged: false });
  expect(
    (await projections().owner({ ...scope(), pageSize: 50 })).companies.find(
      (x) => x.registrationId === registrationId,
    )?.company,
  ).toBeNull();
  await company(true);
  expect((await projections('participant').own({ registrationId })).company).toMatchObject({
    shared: true,
    sourceChanged: false,
  });
  expect(
    (await projections().owner({ ...scope(), pageSize: 50 })).companies.find(
      (x) => x.registrationId === registrationId,
    )?.company?.name,
  ).toBe('Synthetic replacement private company');
});

test('withdrawn registrations disappear from company readiness without deleting history', async () => {
  await participants('participant').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId,
    reason: 'Synthetic participant withdraws the programme',
    acknowledged: true,
  });
  const view = await projections().owner(scope());
  expect(view.companies.some((x) => x.registrationId === registrationId)).toBe(false);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_projection_company WHERE registration_id=$1',
        [registrationId],
      )
    ).rows[0].n,
  ).toBeGreaterThan(1);
  await expect(company(true)).rejects.toThrow();
});

test('optional installer repeats on populated data, preserves existing records, and rejects registry drift', async () => {
  const before = await snapshot();
  await migrateCustomerProgrammeProjections(f.owner);
  expect(await snapshot()).toEqual(before);
  const registry = async () =>
    (
      await f.owner.query<{ name: string; sha256: string }>(
        'SELECT name,sha256 FROM customer_programme_projection_migrations.applied ORDER BY name',
      )
    ).rows;
  const applied = await registry();
  expect(applied.map((row) => row.name)).toEqual([
    '0001_consented_programme_projections.sql',
    '0002_projection_source_and_retention.sql',
  ]);
  const restore = async () => {
    for (const row of applied)
      await f.owner.query(
        'UPDATE customer_programme_projection_migrations.applied SET sha256=$2 WHERE name=$1',
        [row.name, row.sha256],
      );
  };
  // Drift in any one applied file, not only the first, stops the installer and leaves everything unchanged.
  for (const row of applied) {
    try {
      await f.owner.query(
        "UPDATE customer_programme_projection_migrations.applied SET sha256=repeat('0',64) WHERE name=$1",
        [row.name],
      );
      await expect(migrateCustomerProgrammeProjections(f.owner)).rejects.toThrow(
        /history mismatch/,
      );
    } finally {
      await restore();
    }
    expect(await registry()).toEqual(applied);
  }
  // An applied row whose file no longer exists also stops it.
  try {
    await f.owner.query(
      "INSERT INTO customer_programme_projection_migrations.applied(name,sha256) VALUES('9999_missing.sql',repeat('f',64))",
    );
    await expect(migrateCustomerProgrammeProjections(f.owner)).rejects.toThrow(/history mismatch/);
  } finally {
    await f.owner.query(
      "DELETE FROM customer_programme_projection_migrations.applied WHERE name='9999_missing.sql'",
    );
  }
  expect(await registry()).toEqual(applied);
  expect(await snapshot()).toEqual(before);
});
test('removed organisers and disabled participants cannot reuse retained sharing', async () => {
  const own = await projections('participant').own({ registrationId });
  // Registration has been withdrawn above; disabled principals cannot reuse retained receipts/views.
  await f.owner.query(
    'UPDATE customer_private.principal SET disabled_at=clock_timestamp() WHERE issuer=$1 AND subject=$2',
    [issuer, 'projection-participant'],
  );
  await expect(projections('participant').own({ registrationId })).rejects.toThrow();
  expect(own.company.version).toBeGreaterThan(0);
  await workspaces().access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId,
    kind: 'membership',
    targetId: adminMemberId,
  });
  await expect(projections('admin').owner(scope())).rejects.toThrow();
});
