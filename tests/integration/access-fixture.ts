import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrate } from '../../packages/db/src/migrate';
import { AccessService } from '../../packages/auth/src/access';
import { MissionService } from '../../packages/missions/src/index';
import { MeetingService } from '../../packages/missions/src/meetings';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { CounterpartyService } from '../../packages/counterparties/src/index';
import { EvidenceService } from '../../packages/evidence/src/index';
import { CommunicationService } from '../../packages/communications/src/index';
export const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();
export const command = (action: string, data: Record<string, unknown>) => ({
  action,
  commandId: randomUUID(),
  ...data,
});
export async function accessFixture(
  upgradeFromPart05 = false,
  through?: string,
  database?: string,
) {
  const f = await fixture(
      database ?? (upgradeFromPart05 ? 'corridra_upgrade' : 'corridra_integration'),
      upgradeFromPart05 ? '0008_counterparty_research.sql' : through,
    ),
    a = new AccessService(f.runtime),
    mission = new MissionService(f.runtime, 'part06-integration-secret'),
    meetings = new MeetingService(f.runtime),
    research = new CounterpartyService(f.runtime),
    communications = new CommunicationService(f.runtime, 'part06-integration-secret');
  const evidence = new EvidenceService(
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
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  const ctx = f.users.operator.ctx;
  async function target(country = 'ES') {
    const source = await evidence.createSource(ctx, {
      kind: 'public_record',
      locator: 'https://example.invalid/part06',
      observedAt: new Date().toISOString(),
      classification: 'PUBLIC',
      purpose: 'synthetic_validation',
      retentionUntil: future(7),
      aiPolicy: 'DENY',
    });
    const company = await research.command(
      ctx,
      command('ingest', {
        sourceId: source.id,
        name: `Synthetic Buyer ${randomUUID()}`,
        country,
        domain: `${randomUUID()}.example.invalid`,
        address: 'Synthetic business address',
        identifierType: 'registry',
        identifier: randomUUID(),
      }),
    );
    const rel = await research.command(
      ctx,
      command('relationship', {
        organisationId: company.id,
        ownerId: f.users.operator.id,
        visibility: 'OWNER',
        note: 'Private negotiation details never shown to buyer',
      }),
    );
    const contact = await research.command(
      ctx,
      command('contact', {
        relationshipId: rel.id,
        sourceId: source.id,
        name: 'Synthetic Buyer Person',
        jobTitle: 'Procurement',
        email: `${randomUUID()}@example.invalid`,
        validUntil: future(6),
      }),
    );
    const claim = await evidence.createClaim(ctx, {
      sourceId: source.id,
      statement: 'Synthetic buyer declares interest in towels',
    });
    await research.command(
      ctx,
      command('attribute', {
        organisationId: company.id,
        kind: 'requirement',
        claimId: claim.id,
        validUntil: future(6),
      }),
    );
    const intake = await mission.submit(randomUUID(), {
      objective: 'Sell in a new market',
      market: country === 'ES' ? 'Spain' : country,
      attendance: 'No',
      startDate: '',
      endDate: '',
      timezone: 'Europe/Madrid',
      offer: `Synthetic hotel towels ${randomUUID()}`,
      website: '',
      outcomes: ['Relevant meetings'],
      notes: 'Private mission commercial notes',
      name: 'Synthetic Seller',
      company: 'Synthetic Supplier',
      email: `${randomUUID()}@example.invalid`,
      acknowledged: true,
    });
    for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
      await mission.command(ctx, {
        id: intake.id,
        version: i + 1,
        commandId: randomUUID(),
        action,
        ownerId: f.users.operator.id,
        reason: 'Synthetic access qualification',
        nextAction: 'Review relevant introduction',
        dueAt: future(),
        marketCode: country,
        targetProfile: 'Synthetic hotel distributor profile',
      });
    const target = await research.command(
      ctx,
      command('target', {
        missionId: intake.id,
        relationshipId: rel.id,
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
    return {
      claimId: claim.id,
      sourceId: source.id,
      targetId: target.id as string,
      contactId: contact.id as string,
      relationshipId: rel.id as string,
      missionId: intake.id!,
    };
  }
  const preUpgradeTarget = upgradeFromPart05 ? await target() : undefined;
  const snapshot = async () =>
    (
      await f.owner.query(`SELECT jsonb_build_object(
    'missions',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM app.mission m),
    'targets',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app.target_account t),
    'contacts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM app.private_contact_data c),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM app.domain_event e),
    'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY event_id) FROM app.outbox o),
    'membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY user_id) FROM app.membership m)) AS data`)
    ).rows[0].data;
  const beforeUpgrade = upgradeFromPart05 ? await snapshot() : undefined;
  if (upgradeFromPart05) await migrate(f.owner);
  const afterUpgrade = upgradeFromPart05 ? await snapshot() : undefined;
  await a.appendConfig(f.users.owner.ctx, { key: 'communications.introductions', enabled: true });
  await a.appendConfig(f.users.owner.ctx, { key: 'communications.dispatch', enabled: true });
  const pol = await communications.command(
    f.users.owner.ctx,
    command('policy', {
      jurisdiction: 'ES',
      channel: 'SYNTHETIC',
      contactPurpose: 'institutional_introduction',
      basis: 'Approved invented test only; no real legal basis is asserted',
      validUntil: future(5),
      enabled: true,
    }),
  );
  const tpl = await communications.command(
    f.users.owner.ctx,
    command('template', {
      name: 'Synthetic reviewed introduction',
      contactPurpose: 'institutional_introduction',
      body: 'Would a short conversation about your requirements be useful?',
    }),
  );
  const presentation = {
    company: 'Synthetic Supplier',
    country: 'BD',
    capability: 'Synthetic hotel towels',
    fit: 'Potential fit with declared hospitality requirements',
    evidence: 'Supplier offer is self-declared; no independently verified evidence',
    uncertainty: 'Capacity and purchasing need remain unverified',
    conversationPurpose: 'Discuss whether requirements fit',
    availableDates: 'Dates subject to agreement',
  };
  async function introduction(
    t = undefined as
      | Pick<
          Awaited<ReturnType<typeof target>>,
          'targetId' | 'contactId' | 'relationshipId' | 'missionId'
        >
      | undefined,
    expiresAt = future(),
  ) {
    const record = t ?? (await target());
    const input = command('introduce', {
      ...{ targetId: record.targetId, contactId: record.contactId },
      policyId: pol.id,
      templateId: tpl.id,
      introduction: presentation,
      expiresAt,
    });
    const result = await communications.command(ctx, input);
    if (!('buyerPath' in result)) throw new Error('Buyer path required');
    const token = String(result.buyerPath).split('#')[1];
    return { ...record, input, id: result.id, token };
  }
  return {
    ...f,
    ctx,
    a,
    mission,
    meetings,
    research,
    communications,
    target,
    introduction,
    presentation,
    pol,
    tpl,
    preUpgradeTarget,
    beforeUpgrade,
    afterUpgrade,
  };
}
