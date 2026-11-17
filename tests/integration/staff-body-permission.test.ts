import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { accessFixture, future } from './access-fixture';
import { rawContext } from './support';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { permissions } from '../../packages/domain/src/index';

// ADR-087 U1: staff viewers see that a reply or an evidence answer exists, with its state and dates, but never
// the words the supplier, buyer or participant typed. The services drop the body, so no route can send it.
const route = vi.hoisted(() => ({ services: null as unknown, token: '' }));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => route.services }));
import { GET } from '../../apps/web/app/api/workspace/delivery/route';

const replyText = 'Synthetic supplier reply words that only body readers may see';
const answerText = 'Synthetic participant answer words that only body readers may see';
let f: Awaited<ReturnType<typeof accessFixture>>,
  delivery: DeliveryService,
  experience: DeliveryExperienceService,
  replyLink: string,
  requestId: string;

beforeAll(async () => {
  f = await accessFixture();
  delivery = new DeliveryService(f.runtime, f.mission, 'adr087-u1-delivery-test-secret');
  experience = new DeliveryExperienceService(f.runtime);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  const owner = f.users.owner.ctx;

  // A buyer reply through the recipient link (the S1 body).
  const intro = await f.introduction();
  replyLink = intro.id;
  // Shared with the team, so a viewer may see that the reply exists (0008:31); the body rule is the service's.
  await rawContext(
    f.runtime,
    owner,
    "UPDATE app.relationship SET visibility='TEAM' WHERE tenant_id=$1 AND id=$2",
    [owner.tenantId, intro.relationshipId],
  );
  await experience.disclosure(owner, {
    commandId: randomUUID(),
    linkId: intro.id,
    role: 'BUYER',
    sharedRequirements: 'Only the approved synthetic requirement is shareable.',
    uncertainty: 'Buyer fit is not independently verified.',
    rfqId: null,
    allowQuotation: false,
    allowMeetingInterest: true,
    approved: true,
    reason: 'Synthetic ADR-087 body permission validation',
  });
  await f.communications.buyer({
    action: 'detail-response',
    token: intro.token,
    responseId: randomUUID(),
    body: replyText,
    meetingInterest: true,
    quotation: null,
    acknowledged: true,
  });

  // An evidence answer on a delivery link (the S2 body).
  const programme = await delivery.programme(owner, {
    commandId: randomUUID(),
    name: 'Synthetic body permission programme',
    reportingPurpose: 'Synthetic programme outcome review',
  });
  const preview = await delivery.preview(
    owner,
    programme.id,
    randomUUID(),
    Buffer.from((await import('../../packages/delivery/src/import')).intakeTemplate()),
    'CSV',
  );
  const accepted = await delivery.confirm(owner, {
    commandId: randomUUID(),
    importId: preview.id,
    ownerId: f.users.operator.id,
    counts: preview.counts,
    acknowledged: true,
  });
  const publication = await delivery.publication(owner, {
    commandId: randomUUID(),
    missionId: accepted.rows[0].missionId,
    title: 'Approved synthetic mission',
    company: 'Synthetic Company',
    objective: 'Find relevant conversations',
    brief: 'Approved brief without participant contacts or private notes.',
    nextAction: 'Review the proposed programme',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await delivery.share(owner, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic client mission progress',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  const request = await delivery.request(owner, {
    commandId: randomUUID(),
    publicationId: publication.id,
    ownerId: f.users.operator.id,
    title: 'Confirm test requirements',
    instructions: 'Describe the synthetic requirement.',
    dueAt: future(),
  });
  requestId = request.id;
  await delivery.external({
    action: 'respond',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId,
    body: answerText,
    acknowledged: true,
  });

  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
  route.services = {
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://corridra.example.invalid' },
    provider: { getSession: async () => ({ token: route.token }) },
    delivery,
    deliveryExperience: experience,
    specificationConfirmations: { installed: async () => false },
  };
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f?.close();
});

const bodyReaders = ['owner', 'admin', 'operator', 'reviewer'] as const;

test('the registry gives reply and evidence bodies to every staff role except viewer, and keeps metadata for all five', () => {
  for (const key of ['communications.read_body', 'delivery.read_body'] as const)
    expect([...permissions[key]].sort()).toEqual([...bodyReaders].sort());
  for (const key of ['communications.read', 'delivery.read'] as const)
    expect([...permissions[key]].sort()).toEqual([...bodyReaders, 'viewer'].sort());
});

test('a viewer receives the reply without its body from DeliveryExperienceService.workspace', async () => {
  const seen = (await experience.workspace(f.users.viewer.ctx)).responses.find(
    (r) => r.link_id === replyLink,
  );
  expect(seen).toBeDefined();
  expect(seen!.body).toBeNull();
  expect(seen!.id).toBeTruthy();
  expect(seen!.created_at).toBeTruthy();
  expect(seen!.source_kind).toBeTruthy();
  for (const who of [f.users.operator, f.users.reviewer]) {
    const r = (await experience.workspace(who.ctx)).responses.find((x) => x.link_id === replyLink);
    expect(r?.body?.body).toBe(replyText);
  }
});

test('a viewer receives the evidence request without its answer from DeliveryService.workspace', async () => {
  const seen = (await delivery.workspace(f.users.viewer.ctx)).requests.find(
    (r) => r.id === requestId,
  );
  expect(seen).toBeDefined();
  expect(seen!.response).toBeNull();
  expect(seen!.status).toBe('RESPONDED');
  expect(seen!.answered).toBe(true);
  for (const who of [f.users.operator, f.users.reviewer]) {
    const r = (await delivery.workspace(who.ctx)).requests.find((x) => x.id === requestId);
    expect(r?.response).toBe(answerText);
  }
});

test('the staff delivery route never sends either body to a viewer, and sends both to an operator', async () => {
  const get = async (user: typeof f.users.viewer, action?: string) => {
    route.token = user.ctx.token;
    const url = `https://corridra.example.invalid/api/workspace/delivery?tenant=${user.ctx.tenantId}${action ? `&action=${action}` : ''}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    return response.text();
  };
  const viewerExperience = await get(f.users.viewer, 'experience');
  expect(viewerExperience).toContain(replyLink);
  expect(viewerExperience).not.toContain(replyText);
  const viewerDelivery = await get(f.users.viewer);
  expect(viewerDelivery).toContain(requestId);
  expect(viewerDelivery).not.toContain(answerText);
  expect(await get(f.users.operator, 'experience')).toContain(replyText);
  expect(await get(f.users.operator)).toContain(answerText);
});
