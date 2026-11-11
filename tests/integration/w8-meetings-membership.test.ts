import { beforeAll, afterAll, afterEach, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { accessFixture, command, future } from './access-fixture';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerAssignedMissionService } from '../../packages/auth/src/customer-assigned-missions';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';
import { InboxService } from '../../packages/communications/src/inbox';
import { EvidenceService } from '../../packages/evidence/src/index';
import { loadMeetings } from '../../apps/web/lib/meetings/load';
import { loadWorkItems } from '../../apps/web/lib/work-items/load';

// W8 on PostgreSQL: a person who made a request in a workspace stops seeing that workspace's meetings on the Meetings
// page when the owner removes them, and keeps the meetings of a workspace they still belong to. The page reads the
// person's requests with loadWorkItems, which keeps only workspaces the person belongs to, then the saved report of
// each with loadMeetings. Both are the real web loaders over the real services and database; only the way the web
// app reaches the services (`foundations`) is stood in, with the services of the person being checked.
// This runs in the sample (synthetic) mode of the same services, as customer-delivery.test.ts does: a meeting can
// only be published through a reviewed introduction, and introductions are synthetic only in real-use mode
// ("Synthetic communications only"), so a real-mode report with a meeting cannot be built from the services.
// The membership rules are the same functions in both modes.
type Services = Record<string, unknown> & { ready: Promise<void> };
let services: Services | null = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));

const issuer =
  'https://ep-meetings-membership-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const owner = 'meetings-alice';
const member = 'meetings-bob';
const sessionFor = (who: string) => async () => ({
  subject: `synthetic-${who}`,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const subjectOf = (who: string) => `synthetic-${who}`;

type Delivered = { requestId: string; savedId: string; label: string };
let f: Awaited<ReturnType<typeof accessFixture>>;
let delivery: DeliveryService;
let staff: CustomerDeliveryService;
let evidence: EvidenceService;
let sharedWorkspace: string;
let memberWorkspace: string;
let memberId: string;
let sharedDelivery: Delivered;
let ownWorkspaceDelivery: Delivered;

const workspaces = (who: string) =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, sessionFor(who));
const saved = (who: string) =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, sessionFor(who));
const assigned = (who: string) =>
  new CustomerAssignedMissionService(f.runtime, f.auth, options, sessionFor(who));
/** The services the web app would hold for this person's own session. */
function servicesFor(who: string) {
  services = {
    ready: Promise.resolve(),
    customerWorkspaces: workspaces(who),
    customerRequests: new CustomerRequestService(f.runtime, f.auth, options, sessionFor(who)),
    customerAssignedMissions: assigned(who),
    customerSavedMissions: saved(who),
  };
}
const brief = () => ({
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'No',
  startDate: '',
  endDate: '',
  timezone: 'Europe/Madrid',
  offer: `Fictional towels ${randomUUID()}`,
  website: 'https://example.invalid/private-catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic private input; not approved commercial evidence',
  name: 'Fictional Test Person',
  company: 'Fictional Customer',
  email: 'private-customer@example.invalid',
  acknowledged: true,
});

/** One request by this person in this workspace, with one reviewed meeting on its mission, delivered, assigned and saved. */
async function deliverMeeting(who: string, workspaceId: string, label: string): Promise<Delivered> {
  const { id: requestId } = await new CustomerRequestService(
    f.runtime,
    f.auth,
    options,
    sessionFor(who),
  ).submit({ commandId: randomUUID(), workspaceId, brief: brief() }, (ctx, b) =>
    f.mission.prepareCustomerIntake(ctx, b),
  );
  const missionId = (
    await f.owner.query('SELECT mission_id FROM customer_private.owned_request WHERE id=$1', [
      requestId,
    ])
  ).rows[0].mission_id as string;
  // Staff bring the mission to targeting, add a buyer to it and introduce the buyer; the meeting comes from that.
  const next = () => ({
    ownerId: f.users.operator.id,
    nextAction: 'Review the meeting before it is shared',
    dueAt: future(),
    reason: 'Invented progression for the Meetings page check',
  });
  for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
    await f.mission.command(f.ctx, {
      id: missionId,
      version: i + 1,
      commandId: randomUUID(),
      action,
      marketCode: 'ES',
      targetProfile: 'Synthetic hotel distributor profile',
      ...next(),
    });
  const source = await evidence.createSource(f.ctx, {
    kind: 'public_record',
    locator: 'https://example.invalid/meetings-membership',
    observedAt: new Date().toISOString(),
    classification: 'PUBLIC',
    purpose: 'synthetic_validation',
    retentionUntil: future(7),
    aiPolicy: 'DENY',
  });
  const company = await f.research.command(
    f.ctx,
    command('ingest', {
      sourceId: source.id,
      name: `Synthetic Buyer ${randomUUID()}`,
      country: 'ES',
      domain: `${randomUUID()}.example.invalid`,
      address: 'Synthetic business address',
      identifierType: 'registry',
      identifier: randomUUID(),
    }),
  );
  const relationship = await f.research.command(
    f.ctx,
    command('relationship', {
      organisationId: company.id,
      ownerId: f.users.operator.id,
      visibility: 'OWNER',
      note: 'Private negotiation details never shown to the requester',
    }),
  );
  const contact = await f.research.command(
    f.ctx,
    command('contact', {
      relationshipId: relationship.id,
      sourceId: source.id,
      name: 'Synthetic Buyer Person',
      jobTitle: 'Procurement',
      email: `${randomUUID()}@example.invalid`,
      validUntil: future(6),
    }),
  );
  const claim = await evidence.createClaim(f.ctx, {
    sourceId: source.id,
    statement: 'Synthetic buyer declares interest in towels',
  });
  await f.research.command(
    f.ctx,
    command('attribute', {
      organisationId: company.id,
      kind: 'requirement',
      claimId: claim.id,
      validUntil: future(6),
    }),
  );
  const target = await f.research.command(
    f.ctx,
    command('target', {
      missionId,
      relationshipId: relationship.id,
      contactId: contact.id,
      claimIds: [claim.id],
      fit: 'POSSIBLE',
      rationale: 'Declared needs fit the synthetic offer',
      uncertainty: 'No buyer interest verified',
      gaps: 'Need actual buyer response',
      nextAction: 'Review an introduction',
      dueAt: future(),
    }),
  );
  const introduction = await f.introduction({
    targetId: target.id as string,
    contactId: contact.id as string,
    relationshipId: relationship.id as string,
    missionId,
  });
  const meeting = await f.meetings.command(
    f.ctx,
    command('propose', {
      messageId: introduction.id,
      title: label,
      brief: 'Reviewed meeting for the Meetings page check',
      participants: ['Synthetic Supplier', 'Synthetic Buyer'],
      ...next(),
    }),
  );
  const publication = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId,
    title: `Approved report for ${label}`,
    company: 'Fictional Customer',
    objective: 'Review permitted buyer progress',
    brief: 'Approved report without the original private contact details.',
    nextAction: 'Review qualified evidence with the operator',
    dueAt: future(),
    meetings: [{ id: meeting.id, version: 1, label }],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Private report for the company that made the request',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  const { id: assignmentId } = await staff.assign(f.users.owner.ctx, {
    commandId: randomUUID(),
    requestId,
    linkId: link.id,
    reason: 'Explicit synthetic account report delivery review',
    approved: true,
  });
  const accepted = await assigned(who).accept({
    commandId: randomUUID(),
    assignmentId,
    acknowledged: true,
  });
  return { requestId, savedId: accepted.id, label };
}

/** Exactly what the Meetings page does: the person's requests, then their meetings. */
async function meetingsPageFor(who: string) {
  servicesFor(who);
  const work = await loadWorkItems(subjectOf(who), issuer);
  const requests = work.items.filter((item) => item.kind === 'request');
  return { work, requests, meetings: await loadMeetings(subjectOf(who), issuer, requests) };
}

beforeAll(async () => {
  f = await accessFixture();
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  for (const name of [
    'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
    'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
    'CORRIDRA_DELIVERY_ENABLED',
    'CORRIDRA_CUSTOMER_DELIVERY_ENABLED',
  ])
    vi.stubEnv(name, 'true');
  await migrateCustomerSavedMissions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCommercialReadiness(f.owner);
  // No file is stored or scanned here: only a source and a claim are recorded.
  evidence = new EvidenceService(
    f.runtime,
    {
      async put() {},
      async get() {
        return new Uint8Array();
      },
    },
    {
      async scan() {
        return { verdict: 'ERROR', engine: 'not-used' };
      },
    },
  );
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-meetings-membership');
  staff = new CustomerDeliveryService(f.runtime, async (db, id) => {
    await new InboxService(f.runtime).recordReportPublished(db, id);
    return async () => {};
  });
  for (const who of [owner, member]) {
    const principal = await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subjectOf(who),
      executorId: f.serviceId,
      reason: 'Fictional Meetings page fixture; not managed-provider acceptance',
    });
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principal.id,
      reason: 'Explicit fictional private request admission',
    });
  }

  // The owner's workspace, with the person invited into it; the person also has a workspace of their own.
  sharedWorkspace = (
    await workspaces(owner).provision({
      commandId: randomUUID(),
      name: 'Synthetic shared company workspace',
    })
  ).id;
  const invitation = await workspaces(owner).access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: sharedWorkspace,
    label: 'Synthetic colleague who makes requests',
  });
  memberWorkspace = (
    await workspaces(member).provision({
      commandId: randomUUID(),
      name: 'Synthetic own workspace',
    })
  ).id;
  memberId = (
    await workspaces(member).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invitation.token,
    })
  ).memberId!;
  // The member makes one request in each workspace and has a saved report with one meeting for each.
  sharedDelivery = await deliverMeeting(member, sharedWorkspace, 'Shared workspace meeting');
  ownWorkspaceDelivery = await deliverMeeting(member, memberWorkspace, 'Own workspace meeting');
}, 240000);
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});
afterEach(() => {
  services = null;
});

test('a member who made a request in the shared workspace sees the meetings of both workspaces while they belong to it', async () => {
  const { requests, meetings } = await meetingsPageFor(member);
  expect(requests.map((r) => r.id).sort()).toEqual(
    [sharedDelivery.requestId, ownWorkspaceDelivery.requestId].sort(),
  );
  expect(meetings).toMatchObject({ partial: false, notSaved: 0, capped: false });
  expect(meetings.rows.map((r) => [r.requestId, r.label, r.savedResourceId]).sort()).toEqual(
    [
      [sharedDelivery.requestId, sharedDelivery.label, sharedDelivery.savedId],
      [ownWorkspaceDelivery.requestId, ownWorkspaceDelivery.label, ownWorkspaceDelivery.savedId],
    ].sort(),
  );
  // The meetings belong to the person who made the requests: the workspace owner made none and sees none.
  expect((await meetingsPageFor(owner)).meetings.rows).toEqual([]);
});

test('after the owner removes the member, the Meetings page shows no meeting from that workspace and no false claim', async () => {
  expect(
    await workspaces(owner).access({
      action: 'revoke',
      commandId: randomUUID(),
      workspaceId: sharedWorkspace,
      kind: 'membership',
      targetId: memberId,
    }),
  ).toMatchObject({ status: 'revoked' });
  const { work, requests, meetings } = await meetingsPageFor(member);
  // The person still belongs to their own workspace, and that workspace is read, so nothing is hidden or partial.
  expect(work.workspaces.map((w) => w.id)).toEqual([memberWorkspace]);
  expect(work.unreadable).toEqual([]);
  expect(requests.map((r) => r.id)).toEqual([ownWorkspaceDelivery.requestId]);
  expect(meetings.rows.map((r) => r.label)).toEqual([ownWorkspaceDelivery.label]);
  expect(meetings).toMatchObject({ partial: false, notSaved: 0, capped: false, reportsOff: false });
  expect(JSON.stringify(meetings)).not.toContain(sharedDelivery.label);
  expect(JSON.stringify(meetings)).not.toContain(sharedDelivery.savedId);
  expect(JSON.stringify(meetings)).not.toContain(sharedDelivery.requestId);
});
