import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { accessFixture } from './access-fixture';
import { SyntheticChannel, OutreachChannel } from '../../packages/communications/src/adapters';
import { OutboxDispatcher } from '../../packages/workflows/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateOutreachReal } from '../../packages/db/src/outreach-real-migrate';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';

// ADR-090. The sample lane gives the same results before and after the real outreach module is installed: queueing, the
// sample receipt, the page read, an answer with an opt-out, the opt-out alone, and the events each of them records.
let f: Awaited<ReturnType<typeof accessFixture>>;
beforeAll(async () => {
  f = await accessFixture();
  await migrateCustomerRealUse(f.owner);
}, 240000);
afterAll(async () => {
  await f?.close();
});
async function sampleRun(adapter: SyntheticChannel | OutreachChannel) {
  const dispatcher = new OutboxDispatcher(f.runtime, adapter);
  const a = await f.introduction();
  const b = await f.introduction();
  const responseId = randomUUID();
  const events = async () =>
    (
      await f.owner.query(
        `SELECT e.type,p.kind FROM app.domain_event e JOIN identity.principal p ON p.id=e.actor_id
         WHERE e.aggregate_id=ANY($1::text[]) OR e.aggregate_id IN (SELECT o.id::text FROM app.communication_optout o WHERE o.contact_id=ANY($2::uuid[]))
         ORDER BY e.type`,
        [
          [a.id, b.id, responseId],
          [a.contactId, b.contactId],
        ],
      )
    ).rows;
  const sent = await dispatcher.attempt(a.id, f.communications.dispatchCapability(a.id));
  const receipt = (
    await f.owner.query('SELECT provider FROM app.communication_receipt WHERE id=$1', [a.id])
  ).rows;
  // The expiry is a time of this run, so it is left out of the comparison.
  const { expiresAt: _expiresAt, ...read } = (await f.communications.buyer({
    action: 'read',
    token: a.token,
  })) as Record<string, unknown>;
  void _expiresAt;
  const decided = await f.communications.buyer({
    action: 'respond',
    token: a.token,
    responseId,
    decision: 'NOT_RELEVANT',
    optOut: true,
  });
  // The full reply form of a sample recipient (app.recipient_detail_respond), with its own recorded event.
  const c = await f.introduction();
  await new DeliveryExperienceService(f.runtime).disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: c.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved sample requirement is shared.',
    uncertainty: 'Nothing here is independently verified.',
    rfqId: null,
    allowQuotation: false,
    allowMeetingInterest: true,
    approved: true,
    reason: 'Sample disclosure for the reply form comparison',
  });
  const form = {
    action: 'detail-response',
    token: c.token,
    responseId: randomUUID(),
    body: 'A sample answer to the shared requirement.',
    meetingInterest: true,
    quotation: null,
    acknowledged: true,
  };
  const { createdAt: _createdAt, ...formAnswer } = (await f.communications.buyer(form)) as Record<
    string,
    unknown
  >;
  void _createdAt;
  const formExecutor = (
    await f.owner.query(
      'SELECT p.kind FROM app.recipient_detail_response r JOIN identity.principal p ON p.id=r.created_by WHERE r.id=$1',
      [form.responseId],
    )
  ).rows;
  const optedOut = await f.communications.buyer({ action: 'optout', token: b.token });
  const afterOptOut = await dispatcher.attempt(b.id, f.communications.dispatchCapability(b.id));
  return {
    sent,
    receipt,
    read,
    decided,
    formAnswer,
    formExecutor,
    optedOut,
    afterOptOut,
    events: await events(),
  };
}

test('the sample lane is the same before and after the real outreach module is installed', async () => {
  const before = await sampleRun(new SyntheticChannel(f.runtime));
  expect(before).toMatchObject({
    sent: 'DELIVERED',
    receipt: [{ provider: 'synthetic' }],
    read: { synthetic: true, decision: null },
    decided: { decision: 'NOT_RELEVANT', recorded: true },
    formAnswer: { recorded: true, sourceKind: 'SELF_DECLARATION' },
    formExecutor: [{ kind: 'service' }],
    optedOut: { optedOut: true },
    afterOptOut: 'SUPPRESSED',
  });
  expect(before.events.length).toBeGreaterThanOrEqual(3);
  await migrateOutreachReal(f.owner);
  expect(await sampleRun(new SyntheticChannel(f.runtime))).toEqual(before);
  // The routing adapter with every real setting present still sends a sample message only down the sample lane.
  const env = {
    CORRIDRA_REAL_OUTREACH: 'true',
    CORRIDRA_REAL_OUTREACH_MODE: 'live',
    REAL_OUTREACH_MAIL_KEY: 'k'.repeat(24),
    REAL_OUTREACH_MAIL_FROM: 'introductions@mail.business.test',
    REAL_OUTREACH_MAIL_REPLY_TO: 'team@mail.business.test',
    REAL_OUTREACH_WEBHOOK_SECRET: 'whsec_' + Buffer.from('s'.repeat(24)).toString('base64'),
    APP_ORIGIN: 'https://app.business.test',
  } as NodeJS.ProcessEnv;
  expect(
    await sampleRun(new OutreachChannel(f.runtime, 'part06-integration-secret', () => env)),
  ).toEqual(before);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.communication_receipt WHERE provider IN ('email','email_test')",
      )
    ).rows[0].n,
  ).toBe(0);
});
