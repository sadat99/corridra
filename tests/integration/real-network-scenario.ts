import { randomUUID } from 'node:crypto';
import { realNetworkFixture, realNetworkIssuer } from './real-network-fixture';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { MissionService } from '../../packages/missions/src/index';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { EvidenceService } from '../../packages/evidence/src/index';
import type { RequestContext } from '../../packages/db/src/index';
const reason = 'Reviewed real-work fixture; no external legal approval or payment asserted';
const later = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
export async function prepareRealNetworkTask(
  f: Awaited<ReturnType<typeof realNetworkFixture>>,
  contributor: () => Promise<{ principalId: string; ctx: RequestContext }>,
) {
  const missions = new MissionService(f.runtime, 'real-network-intake-local-fixture', 'real');
  const subject = randomUUID();
  const customer = new CustomerRequestService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer: realNetworkIssuer,
      dataMode: 'real',
      openAdmission: true,
    },
    async () => ({
      subject,
      email: 'network-request-owner@business.test',
      emailVerified: true,
      expiresAt: new Date(Date.now() + 60000),
    }),
  );
  const brief = {
    objective: 'Sell in a new market',
    market: 'Spain',
    attendance: 'No',
    startDate: '',
    endDate: '',
    timezone: 'Europe/Madrid',
    offer: 'Warehouse equipment supplier research',
    website: 'https://business.test/equipment',
    outcomes: ['Relevant meetings'],
    notes: '',
    name: 'Request owner',
    company: 'Equipment supplier',
    email: 'network-request-owner@business.test',
    acknowledged: true,
  };
  const staged = await missions.stagePendingRequest(randomUUID(), brief);
  const claimed = await customer.claimPending(
    missions.pendingRequestCapability(staged.cookie),
    (ctx, input) => missions.prepareCustomerIntake(ctx, input),
  );
  const owned = (
    await f.owner.query(
      'SELECT mission_id,mission_tenant_id FROM customer_private.owned_request WHERE id=$1',
      [claimed.id],
    )
  ).rows[0];
  if (owned.mission_tenant_id !== f.realTenant) throw new Error('Real mission tenant mismatch');
  for (const [i, action] of ['qualify', 'activate', 'targeting'].entries())
    await missions.command(f.ctx('operator'), {
      id: owned.mission_id,
      version: i + 1,
      commandId: randomUUID(),
      action,
      ownerId: f.users.operator.id,
      reason,
      nextAction: 'Review the disclosed supplier research',
      dueAt: later(1),
      marketCode: 'ES',
      targetProfile: 'Equipment suppliers in the reviewed market',
    });
  const routes = new CorridorService(f.runtime);
  await routes.installTemplates(f.ctx());
  const catalogue = await routes.catalogue(f.ctx());
  const routeId = randomUUID(),
    packId = randomUUID(),
    assignmentId = randomUUID();
  await routes.createRoute(f.ctx(), { id: routeId, origin: 'DE', destination: 'ES', reason });
  const type = 'machinery_procurement';
  await routes.appendPack(f.ctx(), {
    id: packId,
    routeId,
    version: 1,
    status: 'LIMITED',
    effectiveFrom: new Date().toISOString(),
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: [type],
      requirements: [catalogue.requirements.find((x) => x.schema.typeKey === type)!.id],
      assessments: [catalogue.assessments.find((x) => x.schema.typeKey === type)!.id],
      requiredCapabilities: ['supplier_research'],
      aiPolicyRef: null,
    },
    reason,
  });
  await routes.assign(f.ctx(), {
    id: assignmentId,
    missionId: owned.mission_id,
    packId,
    missionTypeId: catalogue.types.find((x) => x.key === type)!.id,
    version: 1,
    reason,
  });
  const evidence = new EvidenceService(
    f.runtime,
    {
      async put() {
        throw new Error('Not used by this source fixture');
      },
      async get() {
        throw new Error('Not used by this source fixture');
      },
    },
    {
      async scan() {
        return { verdict: 'ERROR', engine: 'not-used' };
      },
    },
  );
  const source = await evidence.createSource(f.ctx(), {
    kind: 'observation',
    locator: 'Reviewed fixture identity and scoped operating-country evidence',
    observedAt: new Date().toISOString(),
    classification: 'INTERNAL',
    purpose: 'commercial_qualification',
    retentionUntil: later(20),
    aiPolicy: 'DENY',
  });
  const worker = await contributor();
  const profile = {
    id: randomUUID(),
    principalId: worker.principalId,
    version: 1,
    alias: 'Invited research contributor',
    categories: ['technical_adviser'],
    capabilities: ['supplier_research'],
    markets: ['ES'],
    languages: ['en'],
    sectors: ['machinery'],
    workCountries: ['DE'],
    available: true,
    status: 'ACTIVE',
    eligibilitySourceId: source.id,
    expiresAt: later(10),
    reason,
  };
  await f.network.profile(f.ctx(), profile);
  const ruleId = randomUUID();
  await f.network.rule(f.ctx(), {
    id: ruleId,
    key: 'reviewed_task_reward',
    version: 1,
    amountMinor: '1001',
    currency: 'EUR',
    effectiveFrom: new Date().toISOString(),
    effectiveUntil: later(20),
    reason,
  });
  const id = randomUUID();
  await f.network.task(f.ctx('operator'), {
    id,
    missionId: owned.mission_id,
    routeAssignmentId: assignmentId,
    kind: 'supplier_research',
    market: 'ES',
    workCountry: 'DE',
    location: 'Disclosed research work location',
    language: 'en',
    sector: 'machinery',
    capabilities: ['supplier_research'],
    instructions:
      'Review only the disclosed equipment supply question and report the observed source.',
    deadline: later(2),
    expiresAt: later(3),
    evidenceRequired: 'Source-reported findings with clear unknowns',
    effort: 'Two hours expected; no guaranteed earnings',
    dataHandling: 'Use only disclosed task data; do not share private contacts',
    cancellationTerms: 'Owner may cancel open work with a reason',
    disputeTerms: 'Request independent review of the submitted evidence',
    reviewerId: f.users.reviewer.id,
    rewardRuleId: ruleId,
    reason,
  });
  await f.network.event(f.ctx(), {
    commandId: randomUUID(),
    taskId: id,
    version: 0,
    action: 'ASSIGN',
    reason,
    details: {
      kind: 'assignment',
      profileId: profile.id,
      relationshipDisclosure: 'No undisclosed relationship in this fixture',
    },
  });
  return { id, worker, profile, sourceId: source.id, missionId: owned.mission_id };
}
