import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { realStaffFixture, future } from './real-staff-fixture';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { missionCatalogue, machineryFields } from '../../packages/domain/src/commercial-missions';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { DecisionDisclosureService } from '../../packages/delivery/src/decision-disclosures';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerDecisionService } from '../../packages/auth/src/customer-decisions';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';

// A recorded commercial decision reaches a real customer only after staff explicitly approve its disclosure.
// The sample suite (customer-decisions) proves the same rules for sample workspaces.
const issuer =
  'https://ep-real-decisions-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = {
  enabled: true,
  synthetic: false,
  production: false,
  issuer,
  openAdmission: true,
  dataMode: 'real' as const,
};
const reason = 'Staff review of the recorded decision before disclosure';
const sessionFor = (subject: string) => async () => ({
  subject,
  email: subject + '@business.test',
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let disclosure: DecisionDisclosureService;
let publicationId: string;
let decisionId: string;
let resourceId: string;
const customer = (who = 'decisions-alice') =>
  new CustomerDecisionService(s.f.runtime, s.f.auth, options, sessionFor(who));
const saved = (who = 'decisions-alice') =>
  new CustomerSavedMissionService(s.f.runtime, s.f.auth, options, sessionFor(who));
const approval = (version = 1) => ({
  commandId: randomUUID(),
  publicationId,
  version,
  decisionIds: [decisionId],
  reason,
  approved: true,
});

beforeAll(async () => {
  s = await realStaffFixture(issuer, 'real-decisions-fixture-secret');
  const { f, ctx } = s;
  disclosure = new DecisionDisclosureService(f.runtime);
  const commercial = new CommercialMissionService(f.runtime);
  const routes = new CorridorService(f.runtime);
  for (const who of ['decisions-alice', 'decisions-bob'])
    await new CustomerWorkspaceService(f.runtime, f.auth, options, sessionFor(who)).provision({
      commandId: randomUUID(),
      name: 'Workspace of ' + who,
    });
  const missionId = await s.mission();
  const target = await s.target(missionId);
  // A route and a testing pack for sourcing from Bangladesh to China, then the mission is assigned to it.
  await routes.installTemplates(ctx);
  const catalogue = await routes.catalogue(ctx);
  const definition = catalogue.requirements.find((r) => r.schema.typeKey === 'sourcing')!;
  const assessmentDefinition = catalogue.assessments.find((r) => r.schema.typeKey === 'sourcing')!;
  const type = catalogue.types.find((r) => r.key === 'sourcing')!;
  const route = { id: randomUUID() };
  await routes.createRoute(ctx, { ...route, origin: 'BD', destination: 'CN', reason });
  const packId = randomUUID();
  await routes.appendPack(ctx, {
    id: packId,
    routeId: route.id,
    version: 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: ['sourcing'],
      currencies: ['CNY'],
      requirements: [definition.id],
      assessments: [assessmentDefinition.id],
    },
  });
  const assignmentId = randomUUID();
  await routes.assign(ctx, {
    id: assignmentId,
    missionId,
    packId,
    missionTypeId: type.id,
    version: 1,
    reason,
  });
  const base = {
    missionId,
    reason,
    sourceId: target.sourceId,
    claimId: target.claimId,
  };
  const command = (action: string, data: Record<string, unknown>) => ({
    action,
    commandId: randomUUID(),
    ...data,
  });
  const requirement = await commercial.command(
    ctx,
    command('requirements', {
      ...base,
      assignmentId,
      definitionId: definition.id,
      version: 1,
      schemaVersion: 1,
      declaration: 'Original customer request retained unchanged',
      fields: {
        objective: 'Assess suppliers against the declared requirements',
        role: 'IMPORTER',
        product: 'Production equipment',
        quantity: '100',
        unit: 'pieces',
        budgetMinor: '200000',
        currency: 'CNY',
        budgetBasis: 'One hundred pieces',
      },
    }),
  );
  const assessment = await commercial.command(
    ctx,
    command('assessment', {
      ...base,
      requirementId: requirement.id,
      definitionId: assessmentDefinition.id,
      targetId: target.targetId,
      version: 1,
      method: 'Human declared-evidence review v1',
      observedAt: new Date().toISOString(),
      results: [
        ...missionCatalogue.find((v) => v.key === 'sourcing')!.criteria,
        'evidence_completeness',
      ].map((criterion) => ({
        criterion,
        result: 'UNKNOWN',
        requirement: 'Declared capacity and suitability',
        basis: 'Supplier claim is recorded; independent evidence remains missing',
      })),
      technicalResults: machineryFields.slice(0, 0),
      unknowns: 'Independent confirmation is absent',
      gaps: 'Need documentation and actual evidence',
      rationale: 'Review supports discussion only, no certification',
    }),
  );
  decisionId = (
    await commercial.command(
      ctx,
      command('decision', {
        ...base,
        requirementId: requirement.id,
        targetId: target.targetId,
        assessmentId: assessment.id,
        decision: 'NEED_INFORMATION',
        rationale: 'Independent supplier evidence remains missing',
        ownerId: f.users.owner.id,
        nextAction: 'Ask the supplier for factory documentation',
        dueAt: future(),
        reason,
      }),
    )
  ).id;
  publicationId = (
    await s.delivery.publication(ctx, {
      commandId: randomUUID(),
      missionId,
      title: 'Approved machinery decision context',
      company: 'Machinery participant',
      objective: 'Review the recorded commercial decisions',
      brief: 'Approved requirement without private contacts.',
      nextAction: 'Review the scoped decision and the missing evidence',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  await new DeliveryExperienceService(f.runtime).publication(ctx, {
    commandId: randomUUID(),
    publicationId,
    requirementId: requirement.id,
    targetIds: [target.targetId],
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  const link = await s.delivery.share(ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Scoped decision reporting for the participating company',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  resourceId = (
    await saved().command({
      action: 'save',
      commandId: randomUUID(),
      token: link.token,
      acknowledged: true,
    })
  ).id;
}, 300000);
afterAll(async () => {
  await s?.f.close();
  vi.unstubAllEnvs();
});

test('before staff approve, the real customer sees no decision data', async () => {
  const data = await customer().read(resourceId);
  expect(data.state).toBe('NOT_APPROVED');
  expect(data.decisions).toEqual([]);
  expect(data.synthetic).toBe(false);
  expect(JSON.stringify(data)).not.toContain('Independent supplier evidence');
});

test('staff approve the disclosure once; the real customer then reads the decision and nothing private', async () => {
  const value = approval();
  const a = await disclosure.approve(s.ctx, value);
  expect(await disclosure.approve(s.ctx, value)).toEqual(a);
  const result = await customer().read(resourceId);
  expect(result.state).toBe('APPROVED');
  expect(result.synthetic).toBe(false);
  expect(result.decisions).toHaveLength(1);
  expect(result.decisions[0]).toMatchObject({
    id: decisionId,
    decision: 'NEED_INFORMATION',
    rationale: 'Independent supplier evidence remains missing',
    nextAction: 'Ask the supplier for factory documentation',
    claimStatus: 'self_declared',
  });
  expect(result.decisions[0]).not.toHaveProperty('ownerId');
  const text = JSON.stringify(result);
  expect(text).not.toMatch(/Private negotiation details|sales@supplier|Supplier contact/i);
  const events = (
    await s.f.owner.query(
      "SELECT id,actor_id FROM app.domain_event WHERE aggregate_type='delivery_decision_publication' AND aggregate_id=$1",
      [a.id],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0].actor_id).toBe(s.f.users.owner.id);
  await expect(
    disclosure.approve(s.ctx, { ...value, reason: 'A conflicting second review' }),
  ).rejects.toMatchObject({ status: 409 });
});

test('another real customer cannot read the decisions of a saved report they do not hold', async () => {
  await expect(customer('decisions-bob').read(resourceId)).rejects.toMatchObject({ code: '42501' });
});

test('staff roles without publisher authority cannot approve a disclosure', async () => {
  for (const role of ['operator', 'reviewer', 'viewer'] as const)
    await expect(
      disclosure.approve(
        { ...s.f.users[role].ctx, tenantId: s.intakeTenantId, purpose: 'commercial_qualification' },
        approval(2),
      ),
    ).rejects.toThrow();
});
