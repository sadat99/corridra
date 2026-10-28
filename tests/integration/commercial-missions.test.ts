import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { rawContext } from './support';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { initialRoutes } from '../../packages/domain/src/corridors';
import {
  commercialMissionCommand,
  compareOffers,
  missionCatalogue,
  machineryFields,
} from '../../packages/domain/src/commercial-missions';
import { assertBranchBudget } from '../../scripts/branch-budget';
import { migrate } from '../../packages/db/src/migrate';
let f: Awaited<ReturnType<typeof commercialFixture>>,
  routes: CorridorService,
  service: CommercialMissionService;
const reason = 'Synthetic Part 2 validation only';
beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
  service = new CommercialMissionService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
});
afterAll(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
async function journey(
  origin: string,
  destination: string,
  typeKey: string,
  code: string,
  options: {
    target?: Awaited<ReturnType<typeof f.target>>;
    fields?: Record<string, unknown>;
    reviewed?: boolean;
    declaration?: string;
  } = {},
) {
  const t = options.target ?? (await f.target(destination)),
    catalogue = await routes.catalogue(f.users.owner.ctx);
  let route = (
    await f.owner.query(
      'SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market=$2 AND destination_market=$3',
      [f.tenantA, origin, destination],
    )
  ).rows[0];
  if (!route) {
    route = { id: randomUUID() };
    await routes.createRoute(f.users.owner.ctx, { ...route, origin, destination, reason });
  }
  const definition = catalogue.requirements.find((r) => r.schema.typeKey === typeKey)!;
  const assessment = catalogue.assessments.find((r) => r.schema.typeKey === typeKey)!;
  const type = catalogue.types.find((r) => r.key === typeKey)!;
  const packId = randomUUID(),
    assignmentId = randomUUID();
  const version =
    (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE route_id=$1',
        [route.id],
      )
    ).rows[0].n + 1;
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: route.id,
    version,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: {
      ...initialRouteConfiguration(initialRoutes[2]),
      missionTypes: [typeKey],
      currencies: [code],
      requirements: [definition.id],
      assessments: [assessment.id],
    },
  });
  await routes.assign(f.users.owner.ctx, {
    id: assignmentId,
    missionId: t.missionId,
    packId: packId,
    missionTypeId: type.id,
    version: 1,
    reason,
  });
  const sourceId = (await f.source()).id,
    claimId = (
      await f.evidence.createClaim(f.ctx, {
        sourceId,
        statement:
          'Declared synthetic requirement and supplier response, no independent verification',
      })
    ).id;
  const provenance = { sourceId, claimId },
    base = { missionId: t.missionId, reason, ...provenance };
  const requirementInput = command('requirements', {
    ...base,
    assignmentId,
    definitionId: definition.id,
    version: 1,
    schemaVersion: 1,
    declaration: options.declaration ?? 'Original synthetic customer request retained unchanged',
    ...(options.reviewed ? { reviewerId: f.users.owner.id } : {}),
    fields: {
      objective: 'Assess suppliers against actual declared requirements',
      role: 'IMPORTER',
      product: 'Synthetic production equipment',
      quantity: '100',
      unit: 'pieces',
      budgetMinor: '200000',
      currency: code,
      budgetBasis: 'One hundred pieces',
      ...(typeKey === 'machinery_procurement'
        ? {
            machinery: {
              application: 'Synthetic manufacturing',
              capacity: '100 pieces per hour',
              utilities: 'Site electricity not yet confirmed',
              acceptance: 'FAT and SAT require qualified engineering review',
            },
          }
        : {}),
      ...options.fields,
    },
  });
  const requirement = await service.command(
    options.reviewed ? f.users.owner.ctx : f.ctx,
    requirementInput,
  );
  const assess = async (targetId = t.targetId, version = 1) =>
    service.command(
      f.ctx,
      command('assessment', {
        ...base,
        requirementId: requirement.id,
        definitionId: assessment.id,
        targetId,
        version,
        method: 'Human declared-evidence review v1',
        observedAt: new Date().toISOString(),
        results: [
          ...missionCatalogue.find((v) => v.key === typeKey)!.criteria,
          'evidence_completeness',
        ].map((criterion) => ({
          criterion,
          result: 'UNKNOWN',
          requirement: 'Declared capacity and suitability',
          basis: 'Supplier claim is recorded; independent evidence remains missing',
        })),
        technicalResults:
          typeKey === 'machinery_procurement'
            ? machineryFields.map((field) => ({
                field,
                result: 'UNKNOWN',
                basis: 'Not assessed, independent supplier evidence absent',
              }))
            : [],
        unknowns: 'Independent confirmation is absent',
        gaps: 'Need documentation and actual evidence',
        rationale: 'Review supports discussion only, no certification',
      }),
    );
  return {
    ...t,
    base,
    provenance,
    requirement,
    requirementInput,
    assess,
    code,
    assessmentDefinition: assessment.id,
  };
}
// Reuse an already recorded counterparty on an ACTIVE mission: no new discovery,
// outreach, RFQ or offer is needed to organise work with a known supplier.
async function knownTargetMission(destination: string) {
  const known = await f.target(destination);
  const intake = await f.mission.submit(randomUUID(), {
    objective: 'Make an upcoming business trip more productive',
    market: destination,
    attendance: 'Yes',
    startDate: '2026-11-01',
    endDate: '2026-11-07',
    timezone: 'Etc/UTC',
    offer: `Synthetic visit to an existing supplier ${randomUUID()}`,
    website: '',
    outcomes: ['Supplier visits'],
    notes: 'Supplier is already known; no supplier discovery is requested',
    name: 'Synthetic Buyer',
    company: 'Synthetic Importer',
    email: `${randomUUID()}@example.invalid`,
    acknowledged: true,
  });
  for (const [index, action] of ['qualify', 'activate'].entries())
    await f.mission.command(f.ctx, {
      id: intake.id,
      version: index + 1,
      commandId: randomUUID(),
      action,
      marketCode: destination,
      targetProfile: 'Previously recorded supplier selected by the customer',
      ...f.next(),
    });
  const target = await f.research.command(
    f.ctx,
    command('target', {
      missionId: intake.id,
      relationshipId: known.relationshipId,
      contactId: known.contactId,
      claimIds: [known.claimId],
      fit: 'POSSIBLE',
      rationale: 'Customer already knows this supplier',
      uncertainty: 'Recorded identity is not independent supplier approval',
      gaps: 'Need visit evidence and customer decisions',
      nextAction: 'Arrange the requested supplier visit',
      dueAt: future(),
    }),
  );
  return { ...known, missionId: intake.id!, targetId: String(target.id) };
}
async function offers(
  j: Awaited<ReturnType<typeof journey>>,
  specification = 'Synthetic requirement specification v1',
) {
  const second = await f.target('CN');
  const target = (
    await f.research.command(
      f.ctx,
      command('target', {
        missionId: j.missionId,
        relationshipId: second.relationshipId,
        contactId: second.contactId,
        claimIds: [second.claimId],
        fit: 'RESEARCH',
        rationale: 'Synthetic alternative candidate',
        uncertainty: 'Supplier evidence incomplete',
        gaps: 'Need supplier documentation',
        nextAction: 'Request the missing evidence',
        dueAt: future(),
      }),
    )
  ).id;
  const assessment = await j.assess(),
    secondAssessment = await j.assess(String(target));
  const rfq = await service.command(
    f.ctx,
    command('rfq', {
      ...j.base,
      requirementId: j.requirement.id,
      targetIds: [j.targetId, target],
      buyerContext: 'Original synthetic importer relationship',
      requestedTerms: 'Same specification, hundred pieces, explicit shipping and costs',
      dueAt: future(),
    }),
  );
  const terms = {
    specification,
    quantity: '100',
    unit: 'pieces',
    unitPriceMinor: '1000',
    totalPriceMinor: '100000',
    toolingMinor: '0',
    setupMinor: '0',
    packagingMinor: '0',
    leadTime: 'Thirty days after confirmation',
    validUntil: future(3),
    incoterm: 'FOB',
    shipping: 'EXCLUDED',
    paymentTerms: 'Terms remain subject to human acceptance',
  };
  const input = command('quotation', {
    ...j.base,
    rfqId: rfq.id,
    targetId: j.targetId,
    revision: 1,
    currency: j.code,
    terms,
    uncertainties: 'No engineering or audit approval is established',
    observedAt: new Date().toISOString(),
  });
  const quote = await service.command(f.ctx, input);
  const incomplete = await service.command(
    f.ctx,
    command('quotation', {
      ...j.base,
      rfqId: rfq.id,
      targetId: target,
      revision: 1,
      currency: j.code,
      terms: { unitPriceMinor: '900' },
      uncertainties: 'Quantity, scope and shipping not supplied',
      observedAt: new Date().toISOString(),
    }),
  );
  return { target, assessment, secondAssessment, rfq, quote, incomplete, input, terms };
}
async function sourcingOpportunity(j: Awaited<ReturnType<typeof journey>>) {
  const originId = randomUUID();
  await f.service.registerOrigin(f.ctx, {
    id: originId,
    ...j.base,
    targetId: j.targetId,
    kind: 'SUPPLIER_RESPONSE',
    summary: 'Documented original supplier response',
  });
  const o = await f.service.command(
    f.ctx,
    command('createFromOrigin', {
      originId,
      title: 'Observed synthetic sourcing opportunity',
      attribution: 'Supplier response, no held meeting is inferred',
      ...f.next(),
    }),
  );
  await f.transition(o.id, 'QUALIFIED_OPPORTUNITY');
  return o;
}
test('A BD to China machinery: requirements, two suppliers, scoped comparisons, factory visit and observed outcome', async () => {
  const j = await journey('BD', 'CN', 'machinery_procurement', 'CNY'),
    q = await offers(j);
  const workspace = await service.workspace(f.ctx, j.missionId);
  expect(workspace.comparison.find((o) => o.id === q.incomplete.id)?.status).toBe('NOT COMPARABLE');
  expect(workspace.comparison.find((o) => o.id === q.quote.id)?.derivedTotal?.amountMinor).toBe(
    '100000',
  );
  const m = await f.meetings.command(
    f.ctx,
    command('proposeActivity', {
      targetId: j.targetId,
      activityKind: 'FACTORY_VISIT',
      context: {
        purpose: 'Discuss machine technical requirements',
        checklist: ['Review utility and installation prerequisites'],
        evidenceRequests: ['Request reference installations'],
      },
      title: 'Synthetic factory visit',
      brief: 'Operator review is not an engineering certificate',
      participants: ['Synthetic Supplier', 'Synthetic Buyer'],
      ...f.next(),
    }),
  );
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.id,
      version: 1,
      status: 'ACCEPTED',
      acceptance: 'Both synthetic parties explicitly accepted the proposed visit',
      ...f.next(),
    }),
  );
  const start = new Date(Date.now() - 3600000);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + 1800000);
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.id,
      version: 2,
      status: 'SCHEDULED',
      schedule: {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timezone: 'Etc/UTC',
        localStart: start.toISOString().slice(0, 16),
        localEnd: end.toISOString().slice(0, 16),
        location: 'Declared synthetic factory location',
      },
      ...f.next(),
    }),
  );
  await service.command(
    f.ctx,
    command('schedule', {
      missionId: j.missionId,
      reason,
      version: 1,
      entries: [
        {
          kind: 'APPOINTMENT',
          label: 'Confirmed factory visit',
          timezone: 'Etc/UTC',
          meetingId: m.id,
          note: 'Actual schedule stays in the meeting record',
        },
      ],
    }),
  );
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: m.id,
      version: 3,
      status: 'HELD',
      outcome: 'Both attended; machine utilities remain unresolved. Request documents.',
      ...f.next(),
    }),
  );
  await service.command(
    f.ctx,
    command('decision', {
      ...j.base,
      requirementId: j.requirement.id,
      targetId: j.targetId,
      assessmentId: q.assessment.id,
      quotationId: q.quote.id,
      decision: 'NEED_INFORMATION',
      rationale: 'Site prerequisites remain unconfirmed',
      ...f.next(),
    }),
  );
  const o = await sourcingOpportunity(j);
  await f.record(o.id, 'RFQ', j.base.sourceId);
  await f.record(o.id, 'SAMPLE', j.base.sourceId);
  await f.record(o.id, 'PROPOSAL', j.base.sourceId, undefined, '100000', 'CNY');
  await f.transition(o.id, 'PROPOSAL');
  await f.mission.command(f.ctx, {
    id: j.missionId,
    version: 4,
    commandId: randomUUID(),
    action: 'pipeline',
    marketCode: 'CN',
    targetProfile: 'Machine technical requirements',
    ...f.next(),
  });
  expect((await service.workspace(f.ctx, j.missionId)).meetings[0].status).toBe('HELD');
  expect(
    (await f.owner.query('SELECT meeting_id FROM app.opportunity WHERE id=$1', [o.id])).rows[0]
      .meeting_id,
  ).toBeNull();
});
test('B BD to China sourcing: offers, sample and justified selection or decline', async () => {
  const j = await journey('BD', 'CN', 'sourcing', 'CNY'),
    q = await offers(j),
    o = await sourcingOpportunity(j);
  await f.record(o.id, 'SAMPLE', j.base.sourceId);
  for (const [targetId, assessmentId, quotationId, decision] of [
    [j.targetId, q.assessment.id, q.quote.id, 'SELECT'],
    [q.target, q.secondAssessment.id, q.incomplete.id, 'DECLINE'],
  ])
    await service.command(
      f.ctx,
      command('decision', {
        ...j.base,
        requirementId: j.requirement.id,
        targetId,
        assessmentId,
        quotationId,
        decision,
        rationale: 'Human selection records explicit remaining commercial uncertainty',
        ...f.next(),
      }),
    );
  expect((await service.workspace(f.ctx, j.missionId)).decisions).toHaveLength(2);
});
test('C BD to Spain preserves buyer introduction, held meeting and commercial progression', async () => {
  const j = await journey('BD', 'ES', 'buyers', 'EUR');
  await j.assess();
  const held = await f.held(undefined, j);
  const o = await f.service.command(
    f.ctx,
    command('create', {
      meetingId: held.meetingId,
      title: 'Existing buyer mission',
      attribution: 'Actual synthetic held meeting',
      ...f.next(),
    }),
  );
  await f.transition(o.id, 'QUALIFIED_OPPORTUNITY');
  await f.record(o.id, 'PROPOSAL', j.base.sourceId);
  await f.transition(o.id, 'PROPOSAL');
  expect(
    (await f.owner.query('SELECT meeting_id,origin_id FROM app.opportunity WHERE id=$1', [o.id]))
      .rows[0],
  ).toEqual({ meeting_id: held.meetingId, origin_id: null });
});
test('D Spain to Bangladesh distributor search uses the same versioned requirements and qualification', async () => {
  const j = await journey('ES', 'BD', 'distributors', 'BDT');
  await j.assess();
  const w = await service.workspace(f.ctx, j.missionId);
  expect(w.assignments[0].origin_market).toBe('ES');
  expect(
    (w.assessments[0].results as { criterion: string }[]).map(
      (r: { criterion: string }) => r.criterion,
    ),
  ).toEqual(['distributor_capability', 'evidence_completeness']);
});
test('E Japan to Kenya sourcing has no country-specific code and retains original KES offer', async () => {
  const j = await journey('JP', 'KE', 'sourcing', 'KES'),
    q = await offers(j),
    o = await sourcingOpportunity(j);
  await f.record(o.id, 'SAMPLE', j.base.sourceId);
  expect(
    (await service.workspace(f.ctx, j.missionId)).comparison.find((v) => v.id === q.quote.id)
      ?.currency,
  ).toBe('KES');
});
test('a known supplier is evaluated by staff without new discovery, quotations or network contributors', async () => {
  const target = await knownTargetMission('CN');
  const before = (
    await f.owner.query(
      'SELECT (SELECT count(*)::int FROM app.organisation) organisations,(SELECT count(*)::int FROM app.relationship) relationships',
    )
  ).rows[0];
  const j = await journey('BD', 'CN', 'supplier_evaluation', 'CNY', {
    target,
    fields: {
      objective: 'Evaluate the supplier already selected by the customer',
      product: 'Synthetic existing umbrella supplier',
      requiredEvidence: ['Check current registration and production evidence'],
    },
  });
  const assessment = await j.assess();
  await service.command(
    f.ctx,
    command('decision', {
      ...j.base,
      requirementId: j.requirement.id,
      targetId: j.targetId,
      assessmentId: assessment.id,
      decision: 'NEED_INFORMATION',
      rationale: 'A prior relationship is not proof of current supplier capability',
      ...f.next(),
    }),
  );
  const w = await service.workspace(f.ctx, j.missionId);
  expect(w.mission.status).toBe('ACTIVE');
  expect(w.targets).toHaveLength(1);
  expect(w.targets[0].relationship_id).toBe(target.relationshipId);
  expect(w.assessments[0].target_id).toBe(target.targetId);
  expect(w.rfqs).toHaveLength(0);
  expect(w.quotations).toHaveLength(0);
  expect(w.decisions[0].quotation_id).toBeNull();
  expect(
    (
      await f.owner.query(
        'SELECT (SELECT count(*)::int FROM app.organisation) organisations,(SELECT count(*)::int FROM app.relationship) relationships',
      )
    ).rows[0],
  ).toEqual(before);
  expect((await f.owner.query('SELECT count(*)::int n FROM app.network_task')).rows[0].n).toBe(0);
});

test('repeat sourcing reuses owner-reviewed requirement fields while a new price needs its own recorded decision', async () => {
  const j = await journey('BD', 'CN', 'sourcing', 'CNY', {
    reviewed: true,
    declaration: 'Synthetic customer specification retained for a repeat enquiry',
    fields: {
      product: 'Synthetic umbrella',
      specifications: 'Synthetic umbrella, 100 cm canopy, polyester, 8 ribs',
    },
  });
  const q = await offers(j, 'Synthetic umbrella, 100 cm canopy, polyester, 8 ribs');
  const original = (
    await f.owner.query('SELECT * FROM app.mission_requirements WHERE id=$1', [j.requirement.id])
  ).rows[0];
  expect(original.reviewer_id).toBe(f.users.owner.id);
  await service.command(
    f.ctx,
    command('decision', {
      ...j.base,
      requirementId: j.requirement.id,
      targetId: j.targetId,
      assessmentId: q.assessment.id,
      quotationId: q.quote.id,
      decision: 'SELECT',
      rationale: 'First synthetic offer reviewed for its own stated price and scope',
      ...f.next(),
    }),
  );
  const rfq = await service.command(
    f.ctx,
    command('rfq', {
      ...j.base,
      requirementId: j.requirement.id,
      targetIds: [j.targetId],
      buyerContext: 'Repeat enquiry against the same recorded specification',
      requestedTerms:
        'Supply a new price and validity; prior selection does not approve this offer',
      dueAt: future(),
    }),
  );
  const quote = await service.command(
    f.ctx,
    command('quotation', {
      ...j.base,
      rfqId: rfq.id,
      targetId: j.targetId,
      revision: 1,
      currency: 'CNY',
      terms: { ...q.terms, unitPriceMinor: '1200', totalPriceMinor: '120000' },
      uncertainties: 'New price requires a fresh human commercial decision',
      observedAt: new Date().toISOString(),
    }),
  );
  const beforeReview = await service.workspace(f.ctx, j.missionId);
  expect(beforeReview.decisions).toHaveLength(1);
  expect(beforeReview.decisions[0].quotation_id).toBe(q.quote.id);
  expect(beforeReview.decisions.some((d) => d.quotation_id === quote.id)).toBe(false);
  await service.command(
    f.ctx,
    command('decision', {
      ...j.base,
      requirementId: j.requirement.id,
      targetId: j.targetId,
      assessmentId: q.assessment.id,
      quotationId: quote.id,
      decision: 'NEED_INFORMATION',
      rationale: 'New price is higher; request customer review before selecting it',
      ...f.next(),
    }),
  );
  const after = await service.workspace(f.ctx, j.missionId);
  expect(after.requirements).toHaveLength(1);
  expect(after.decisions.find((d) => d.quotation_id === quote.id)?.decision).toBe(
    'NEED_INFORMATION',
  );
  expect(after.quotations.find((v) => v.id === q.quote.id)?.terms).toEqual(q.terms);
  expect(after.quotations.find((v) => v.id === quote.id)?.terms).toMatchObject({
    unitPriceMinor: '1200',
    totalPriceMinor: '120000',
  });
  expect(
    (await f.owner.query('SELECT * FROM app.mission_requirements WHERE id=$1', [j.requirement.id]))
      .rows[0],
  ).toEqual(original);
  // Owner review is not typed customer confirmation or an engineering certificate.
});

test('a planned business trip schedules a known supplier visit without discovery, RFQ or quotation preconditions', async () => {
  const target = await knownTargetMission('CN');
  const j = await journey('BD', 'CN', 'business_trips', 'CNY', {
    target,
    fields: {
      objective: 'Organise the already planned supplier visit',
      role: 'BUYER',
      travelDates: '2026-11-01 to 2026-11-07; customer already plans to travel',
      responsiblePersons: ['Synthetic buyer travel lead'],
    },
  });
  const meeting = await f.meetings.command(
    f.ctx,
    command('proposeActivity', {
      targetId: j.targetId,
      activityKind: 'FACTORY_VISIT',
      context: {
        purpose: 'Visit the previously known supplier during an existing trip',
        checklist: ['Confirm the existing appointment and commercial purpose'],
        evidenceRequests: ['Retain the agreed visit agenda and actual field observations'],
      },
      title: 'Synthetic planned supplier visit',
      brief: 'Arrange local coordination for a supplier the customer already knows',
      participants: ['Synthetic Buyer', 'Synthetic Supplier'],
      ...f.next(),
    }),
  );
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: meeting.id,
      version: 1,
      status: 'ACCEPTED',
      acceptance: 'Both synthetic participants expressly accepted this visit',
      ...f.next(),
    }),
  );
  const start = new Date('2026-11-02T06:00:00.000Z');
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + 3600000);
  await f.meetings.command(
    f.ctx,
    command('transition', {
      id: meeting.id,
      version: 2,
      status: 'SCHEDULED',
      schedule: {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timezone: 'Etc/UTC',
        localStart: start.toISOString().slice(0, 16),
        localEnd: end.toISOString().slice(0, 16),
        location: 'Synthetic known supplier factory',
      },
      ...f.next(),
    }),
  );
  await service.command(
    f.ctx,
    command('schedule', {
      missionId: j.missionId,
      reason,
      version: 1,
      entries: [
        {
          kind: 'APPOINTMENT',
          label: 'Previously planned supplier visit',
          timezone: 'Etc/UTC',
          meetingId: meeting.id,
          note: 'Reference the actual accepted and scheduled visit',
        },
      ],
    }),
  );
  const w = await service.workspace(f.ctx, j.missionId);
  expect(w.mission.status).toBe('ACTIVE');
  expect(w.assignments[0].type_key).toBe('business_trips');
  expect(w.meetings[0]).toMatchObject({
    status: 'SCHEDULED',
    message_id: null,
    target_id: target.targetId,
  });
  const scheduledVisit = w.schedules[0].entries[0];
  expect('appointment' in scheduledVisit && scheduledVisit.appointment?.id).toBe(meeting.id);
  expect(w.rfqs).toHaveLength(0);
  expect(w.quotations).toHaveLength(0);
  expect(w.assessments).toHaveLength(0);
});

test('a China supplier seeks Bangladesh buyers through the shared reverse corridor with explicit supplier intent', async () => {
  const declaration =
    'Synthetic Chinese supplier asks for Bangladesh buyers for its umbrella range';
  const j = await journey('CN', 'BD', 'buyers', 'BDT', {
    declaration,
    fields: {
      objective: 'Find Bangladesh buyers for the supplier product range',
      role: 'SUPPLIER',
      product: 'Synthetic supplier umbrella range',
      targetMarkets: ['BD'],
      specifications: 'Declared supplier catalogue; buyer suitability still unknown',
    },
  });
  await j.assess();
  const w = await service.workspace(f.ctx, j.missionId);
  expect(w.assignments[0]).toMatchObject({
    origin_market: 'CN',
    destination_market: 'BD',
    type_key: 'buyers',
  });
  expect(w.requirements[0]).toMatchObject({
    declaration,
    reviewer_id: null,
    fields: { role: 'SUPPLIER', targetMarkets: ['BD'] },
  });
  expect((w.assessments[0].results as { criterion: string }[]).map((r) => r.criterion)).toEqual([
    'commercial_relevance',
    'buyer_fit',
    'evidence_completeness',
  ]);
  expect(w.rfqs).toHaveLength(0);
  expect(w.quotations).toHaveLength(0);
  expect(w.meetings).toHaveLength(0);
});

test('stale versions, incorrect supplier association, false verification, cross-tenant quotes and unauthorized cash fail', async () => {
  const j = await journey('BD', 'CN', 'sourcing', 'CNY'),
    q = await offers(j),
    unrelated = await f.target();
  expect(await service.command(f.ctx, q.input)).toEqual(q.quote);
  await expect(
    service.command(f.ctx, { ...q.input, uncertainties: 'Changed replay values' }),
  ).rejects.toThrow('Command key reused');
  await expect(
    service.command(f.users.other.ctx, { ...q.input, commandId: randomUUID() }),
  ).rejects.toThrow();
  await expect(
    service.command(f.ctx, { ...q.input, commandId: randomUUID(), targetId: unrelated.targetId }),
  ).rejects.toThrow();
  await expect(
    service.command(f.ctx, { ...q.input, commandId: randomUUID(), currency: 'USD' }),
  ).rejects.toThrow('Unsupported route currency');
  await expect(
    service.command(f.ctx, { ...q.input, commandId: randomUUID(), currency: 'ZZZ' }),
  ).rejects.toThrow();
  await expect(
    service.command(f.ctx, {
      ...q.input,
      commandId: randomUUID(),
      revision: 2,
      previousId: q.incomplete.id,
    }),
  ).rejects.toThrow();
  expect(() =>
    commercialMissionCommand.parse(
      command('assessment', {
        ...j.base,
        results: [{ criterion: 'supplier_fit', result: 'VERIFIED' }],
      }),
    ),
  ).toThrow();
  await service.command(f.ctx, { ...j.requirementInput, commandId: randomUUID(), version: 2 });
  await expect(j.assess(j.targetId, 2)).rejects.toThrow('Current requirement version');
  await expect(
    service.command(
      f.ctx,
      command('decision', {
        ...j.base,
        requirementId: j.requirement.id,
        targetId: j.targetId,
        assessmentId: q.assessment.id,
        decision: 'SELECT',
        rationale: 'Stale decision must fail',
        ...f.next(),
      }),
    ),
  ).rejects.toThrow();
  const o = await sourcingOpportunity(j);
  await expect(
    f.service.command(
      f.ctx,
      command('transition', { id: o.id, version: 2, status: 'CASH_COLLECTED', ...f.next() }),
    ),
  ).rejects.toThrow();
  await expect(service.workspace(f.users.other.ctx, j.missionId)).rejects.toThrow(
    'Mission unavailable',
  );
});
test('raw SQL does not permit direct quote forgery or any new table writes by viewers', async () => {
  const j = await journey('BD', 'CN', 'sourcing', 'CNY'),
    q = await offers(j);
  for (const table of [
    'mission_requirements',
    'mission_assessment',
    'mission_rfq',
    'mission_quotation',
    'mission_selection',
    'mission_schedule',
    'commercial_mission_command',
  ])
    await expect(
      rawContext(
        f.runtime,
        f.users.viewer.ctx,
        `INSERT INTO app.${table}(id,tenant_id,mission_id,created_by) VALUES($1,$2,$3,$4)`,
        [randomUUID(), f.tenantA, j.missionId, f.users.viewer.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  await expect(
    rawContext(f.runtime, f.ctx, 'UPDATE app.mission_quotation SET terms=$2 WHERE id=$1', [
      q.quote.id,
      { unitPriceMinor: '1' },
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    service.command(
      f.ctx,
      command('schedule', {
        missionId: j.missionId,
        reason,
        version: 1,
        entries: [
          {
            kind: 'APPOINTMENT',
            label: 'Fabricated confirmed visit',
            timezone: 'Etc/UTC',
            meetingId: randomUUID(),
            note: 'No schedule or acceptance exists',
          },
        ],
      }),
    ),
  ).rejects.toThrow();
  const count = await f.owner.query(
    'SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type IN ($1,$2)',
    ['mission_quotation', 'mission_requirements'],
  );
  expect(count.rows[0].n).toBeGreaterThan(0);
});
test('comparison preserves missing values, mixed currencies, exact large totals and branch cap', () => {
  const offer = {
    id: 'a',
    requirementId: 'r',
    currency: 'CNY',
    terms: { unitPriceMinor: '9007199254740993', quantity: '100' },
    uncertainties: 'Missing specifications',
  };
  const result = compareOffers([offer, { ...offer, id: 'b', currency: 'USD' }]);
  expect(result.every((r) => r.status === 'NOT COMPARABLE')).toBe(true);
  expect(result[0].derivedTotal?.amountMinor).toBe('900719925474099300');
  expect(result[0].missing).toContain('shipping');
  expect(() => assertBranchBudget(9)).not.toThrow();
  for (const n of [10, 11, -1, NaN]) expect(() => assertBranchBudget(n)).toThrow();
});

test('quotation corrections retain originals and reject stale decisions, unsupported routes and private reads', async () => {
  const j = await journey('BD', 'CN', 'sourcing', 'CNY'),
    q = await offers(j);
  const corrected = await service.command(f.ctx, {
    ...q.input,
    commandId: randomUUID(),
    revision: 2,
    previousId: q.quote.id,
    terms: { ...q.terms, unitPriceMinor: '1100', totalPriceMinor: '110000' },
  });
  const original = (
    await rawContext(f.runtime, f.ctx, 'SELECT terms FROM app.mission_quotation WHERE id=$1', [
      q.quote.id,
    ])
  ).rows[0];
  expect(original.terms.unitPriceMinor).toBe('1000');
  expect(
    (await service.workspace(f.ctx, j.missionId)).comparison.find((o) => o.id === corrected.id)
      ?.derivedTotal?.amountMinor,
  ).toBe('110000');
  const decision = {
    ...j.base,
    action: 'decision',
    commandId: randomUUID(),
    requirementId: j.requirement.id,
    targetId: j.targetId,
    assessmentId: q.assessment.id,
    quotationId: q.quote.id,
    decision: 'SELECT',
    rationale: 'Corrected offer needs another human decision',
    ...f.next(),
  };
  await expect(service.command(f.ctx, decision)).rejects.toThrow('Latest matching supplier offer');
  await j.assess(j.targetId, 2);
  await expect(
    service.command(f.ctx, { ...decision, commandId: randomUUID(), quotationId: corrected.id }),
  ).rejects.toThrow('Current matching assessment');
  await expect(
    routes.createRoute(f.users.owner.ctx, {
      id: randomUUID(),
      origin: 'ZZ',
      destination: 'CN',
      reason,
    }),
  ).rejects.toThrow();
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.viewer.ctx,
        'SELECT id FROM app.mission_quotation WHERE mission_id=$1',
        [j.missionId],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await rawContext(
        f.runtime,
        f.users.viewer.ctx,
        'SELECT id FROM app.mission_rfq WHERE id=$1',
        [q.rfq.id],
      )
    ).rowCount,
  ).toBe(0);
});
test('populated Part 1 upgrade preserves old mission, money, evidence, identity and event history', async () => {
  await f.close();
  f = await commercialFixture(false, '0022_policy_and_service_economics.sql');
  await f.invoice();
  const tables = [
    'mission',
    'meeting',
    'commercial_record',
    'source_record',
    'claim',
    'domain_event',
    'outbox',
    'membership',
    'opportunity',
  ];
  const snapshot = () =>
    Promise.all(
      tables.map(
        async (t) =>
          (await f.owner.query(`SELECT to_jsonb(t) row FROM app.${t} t ORDER BY to_jsonb(t)::text`))
            .rows,
      ),
    );
  const before = await snapshot();
  await migrate(f.owner);
  const after = await snapshot();
  for (let i = 0; i < tables.length; i++) {
    if (tables[i] === 'meeting') {
      for (const r of after[i]) {
        delete r.row.target_id;
        delete r.row.activity_kind;
        delete r.row.activity_context;
      }
    }
    expect(after[i]).toEqual(before[i]);
  }
});
