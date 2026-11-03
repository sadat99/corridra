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
      ? { profileVersion: own.profile!.version, objective: 'Synthetic explicitly shared objective' }
      : {}),
    acknowledged: true,
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
  let requestId = '';
  // Reuse the commercial fixture's genuine workflow, substituting its intake with the real
  // restricted customer submission. No ownership/meeting/qualification rows are fabricated.
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
  let lead: Awaited<ReturnType<typeof f.lead>>;
  try {
    lead = await f.lead();
  } finally {
    submit.mockRestore();
  }
  const link = await shares('participant').command({
    action: 'share',
    commandId: randomUUID(),
    registrationId,
    requestId,
    expectedVersion: 0,
    summary: 'Synthetic shared objective only',
    consented: true,
  });
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
  const registry = (
    await f.owner.query('SELECT sha256 FROM customer_programme_projection_migrations.applied')
  ).rows[0].sha256;
  try {
    await f.owner.query(
      "UPDATE customer_programme_projection_migrations.applied SET sha256=repeat('0',64)",
    );
    await expect(migrateCustomerProgrammeProjections(f.owner)).rejects.toThrow(/history mismatch/);
  } finally {
    await f.owner.query('UPDATE customer_programme_projection_migrations.applied SET sha256=$1', [
      registry,
    ]);
  }
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
