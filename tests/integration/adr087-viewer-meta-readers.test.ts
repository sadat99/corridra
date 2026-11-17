import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { accessFixture, future } from './access-fixture';
import { rawContext } from './support';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { getTeamToday } from '../../packages/auth/src/team-today';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateReplyReview } from '../../packages/db/src/recipient-reply-review-migrate';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';
import { migrateViewerReplyMetadata } from '../../packages/db/src/viewer-reply-metadata-migrate';

// ADR-087 U2, the application side. Once U2 is installed a staff viewer's read policies return no reply or answer row at all,
// so the three staff readers that show existence, state and dates (the delivery experience, the delivery workspace and the
// Today count) read them through app.reply_meta and app.delivery_response_meta for a role without delivery.read_body. Before
// U2 the functions do not exist and the readers fall back to today's queries. The words never reach a viewer either way.
// The "installed" cases fail on the readers before this change (the viewer gets no reply, an OPEN request and a 0 count).
const replyText = 'Synthetic supplier reply words that only body readers may see';
const answerText = 'Synthetic participant answer words that only body readers may see';
let f: Awaited<ReturnType<typeof accessFixture>>,
  delivery: DeliveryService,
  experience: DeliveryExperienceService,
  replyLink: string,
  requestId: string;

beforeAll(async () => {
  f = await accessFixture();
  // The optional modules U2 sits beside: real use (its policies), reply review (the Today count) and answer correction.
  await migrateCustomerRealUse(f.owner);
  await migrateReplyReview(f.owner);
  await migrateRecipientResponseRevision(f.owner);
  delivery = new DeliveryService(f.runtime, f.mission, 'adr087-u2-reader-test-secret');
  experience = new DeliveryExperienceService(f.runtime);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  const owner = f.users.owner.ctx;

  const intro = await f.introduction();
  replyLink = intro.id;
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
    reason: 'Synthetic ADR-087 U2 reader validation',
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

  const programme = await delivery.programme(owner, {
    commandId: randomUUID(),
    name: 'Synthetic U2 reader programme',
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
  requestId = (
    await delivery.request(owner, {
      commandId: randomUUID(),
      publicationId: publication.id,
      ownerId: f.users.operator.id,
      title: 'Confirm test requirements',
      instructions: 'Describe the synthetic requirement.',
      dueAt: future(),
    })
  ).id;
  await delivery.external({
    action: 'respond',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId,
    body: answerText,
    acknowledged: true,
  });
}, 240000);
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
afterAll(async () => {
  await f?.close();
});

const reply = async (who: 'owner' | 'viewer') =>
  (await experience.workspace(f.users[who]!.ctx)).responses.find(
    (r: { link_id: string }) => r.link_id === replyLink,
  );
const request = async (who: 'owner' | 'viewer') =>
  (await delivery.workspace(f.users[who]!.ctx)).requests.find(
    (r: { id: string }) => r.id === requestId,
  );
const waiting = async (who: 'owner' | 'viewer') =>
  (await getTeamToday(f.runtime, f.users[who]!.ctx)).repliesToReview;
const viewerRows = async (table: string) =>
  (
    await rawContext(
      f.runtime,
      f.users.viewer.ctx,
      `SELECT count(*)::int n FROM app.${table} WHERE tenant_id=$1`,
      [f.tenantA],
    )
  ).rows[0].n;

let ownerBefore: { reply: unknown; request: unknown; waiting: number };

// The same proof for both states: the viewer sees existence, state and dates with no words; the owner sees everything.
async function viewerSeesReply() {
  const own = await reply('owner');
  const seen = await reply('viewer');
  expect(seen).toBeDefined();
  expect(seen!.body).toBeNull();
  expect(seen!.id).toBe(own!.id);
  expect(seen!.source_kind).toBe('SELF_DECLARATION');
  expect(new Date(seen!.created_at).getTime()).toBe(new Date(own!.created_at).getTime());
  expect(Object.keys(seen!).sort()).toEqual(Object.keys(own!).sort());
  expect(seen!.revision).toBe(0);
  expect(seen!.revised_at).toBeNull();
  expect(JSON.stringify(await experience.workspace(f.users.viewer.ctx))).not.toContain(replyText);
}
async function viewerSeesAnsweredRequest() {
  const answered = await request('viewer');
  expect(answered).toBeDefined();
  expect(answered!.status).toBe('RESPONDED');
  expect(answered!.answered).toBe(true);
  expect(answered!.response).toBeNull();
  expect(answered!.claim_status).toBe('self_declared');
  expect(JSON.stringify(await delivery.workspace(f.users.viewer.ctx))).not.toContain(answerText);
}
async function viewerCountsReplies() {
  expect(await waiting('viewer')).toBeGreaterThan(0);
  expect(await waiting('viewer')).toBe(await waiting('owner'));
}

describe('U2 not installed (the meta functions do not exist)', () => {
  test('the readers fall back to the read policies, and the viewer still sees metadata only', async () => {
    expect(
      (
        await f.owner.query(
          "SELECT to_regprocedure('app.reply_meta(uuid,uuid)') IS NULL AS a,to_regprocedure('app.delivery_response_meta(uuid,uuid)') IS NULL AS b",
        )
      ).rows[0],
    ).toEqual({ a: true, b: true });
    // Before U2 the viewer's policy still returns the rows; the services drop the words (U1).
    expect(await viewerRows('recipient_detail_response')).toBeGreaterThan(0);
    await viewerSeesReply();
    await viewerSeesAnsweredRequest();
    await viewerCountsReplies();
    ownerBefore = {
      reply: await reply('owner'),
      request: await request('owner'),
      waiting: await waiting('owner'),
    };
    expect((ownerBefore.reply as { body: { body: string } }).body.body).toBe(replyText);
    expect((ownerBefore.request as { response: string }).response).toBe(answerText);
  });
});

describe('U2 installed', () => {
  test('the viewer policy now returns no reply or answer row', async () => {
    await migrateViewerReplyMetadata(f.owner);
    expect(await viewerRows('recipient_detail_response')).toBe(0);
    expect(await viewerRows('delivery_response')).toBe(0);
  });
  test(
    'the delivery experience still gives the viewer the reply row, body null, through app.reply_meta',
    viewerSeesReply,
  );
  test(
    'the delivery workspace still shows the viewer the request as answered, through app.delivery_response_meta',
    viewerSeesAnsweredRequest,
  );
  test(
    'Today still counts the replies waiting for review for the viewer, through app.reply_meta',
    viewerCountsReplies,
  );
  test('the owner reads exactly what they read before', async () => {
    expect(await reply('owner')).toEqual(ownerBefore.reply);
    expect(await request('owner')).toEqual(ownerBefore.request);
    expect(await waiting('owner')).toBe(ownerBefore.waiting);
  });
});
