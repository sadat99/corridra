import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import type { DeliveryReport } from '../../packages/delivery/src/report';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { offerContext } from '../../packages/domain/src/commercial-missions';
import {
  experienceOfferContext,
  compareExperienceOffers,
} from '../../apps/web/lib/experience-offers';

// Real-use 0019: the buyer's detail carries the mission type, the visit kind and a reference to the original quotation, each copied
// from the record that holds it, so the buyer and the team choose the comparison context from the same fact.
const reason = 'Synthetic offer context validation';
const sql = (name: string) =>
  readFile(
    new URL(`../../packages/db/customer-real-use-migrations/${name}`, import.meta.url),
    'utf8',
  );
let f: Awaited<ReturnType<typeof commercialFixture>>,
  delivery: DeliveryService,
  experience: DeliveryExperienceService,
  routes: CorridorService,
  commercial: CommercialMissionService;
beforeAll(async () => {
  f = await commercialFixture();
  delivery = new DeliveryService(f.runtime, f.mission, 'offer-context-delivery-test-secret');
  experience = new DeliveryExperienceService(f.runtime);
  routes = new CorridorService(f.runtime);
  commercial = new CommercialMissionService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  await f.owner.query(await sql('0017_experience_outreach_counts.sql'));
  await f.owner.query(await sql('0019_offer_context.sql'));
});
afterAll(async () => {
  await f?.close();
});

async function journey(typeKey: string, extraFields: Record<string, unknown> = {}) {
  const t = await f.target('ES'),
    cat = await routes.catalogue(f.users.owner.ctx);
  let route = (
    await f.owner.query(
      "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='ES'",
      [f.tenantA],
    )
  ).rows[0];
  if (!route) {
    route = { id: randomUUID() };
    await routes.createRoute(f.users.owner.ctx, {
      ...route,
      origin: 'BD',
      destination: 'ES',
      reason,
    });
  }
  const req = cat.requirements.find((r) => r.schema.typeKey === typeKey)!,
    a = cat.assessments.find((r) => r.schema.typeKey === typeKey)!,
    type = cat.types.find((r) => r.key === typeKey)!;
  const packId = randomUUID(),
    assignmentId = randomUUID(),
    version =
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
      ...initialRouteConfiguration(initialRoutes[0]),
      missionTypes: [typeKey],
      currencies: ['CNY'],
      requirements: [req.id],
      assessments: [a.id],
    },
  });
  await routes.assign(f.users.owner.ctx, {
    id: assignmentId,
    missionId: t.missionId,
    packId,
    missionTypeId: type.id,
    version: 1,
    reason,
  });
  const source = await f.source(),
    claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source.id,
      statement: 'Invented original requirement and quotation declaration',
    }),
    base = { missionId: t.missionId, sourceId: source.id, claimId: claim.id, reason };
  const r = await commercial.command(
    f.ctx,
    command('requirements', {
      ...base,
      assignmentId,
      definitionId: req.id,
      version: 1,
      schemaVersion: 1,
      declaration: 'Original supplied synthetic requirement',
      fields: {
        objective: 'Find suitable components',
        role: 'IMPORTER',
        product: 'Synthetic component',
        quantity: '100',
        unit: 'pieces',
        ...extraFields,
      },
    }),
  );
  const rfq = await commercial.command(
    f.ctx,
    command('rfq', {
      ...base,
      requirementId: r.id,
      targetIds: [t.targetId],
      buyerContext: 'Explicitly shareable invented buying context',
      requestedTerms: 'Original unit price, quantity and delivery conditions',
      dueAt: future(),
    }),
  );
  const observedAt = new Date(Date.now() - 86400000).toISOString();
  const q = await commercial.command(
    f.ctx,
    command('quotation', {
      ...base,
      rfqId: rfq.id,
      targetId: t.targetId,
      revision: 1,
      observedAt,
      currency: 'CNY',
      terms: { unitPriceMinor: '1200', quantity: '100', unit: 'pieces' },
      uncertainties: 'Logistics and specifications remain unconfirmed',
    }),
  );
  return { t, r, q, source, observedAt };
}
async function view(j: Awaited<ReturnType<typeof journey>>) {
  const p = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: j.t.missionId,
    title: 'Approved mission',
    company: 'Synthetic Company',
    objective: 'Review a source-reported commercial requirement',
    brief: 'Approved synthetic context. No private contact or relationship owner is disclosed.',
    nextAction: 'Review the explicitly scoped mission detail',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [p.id],
    audience: 'CLIENT_PROGRESS',
    purpose: reason,
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  await experience.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId: p.id,
    requirementId: j.r.id,
    targetIds: [j.t.targetId],
    quotationIds: [j.q.id],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  const report = (await delivery.external({
    action: 'view',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
  })) as DeliveryReport;
  return report.missions[0].experience!;
}
const team = async (missionId: string) =>
  offerContext(
    (await commercial.workspace(f.ctx, missionId)).assignments[0]?.type_key as string | undefined,
  );

test('one rule picks the context: only the machinery procurement type is machinery', () => {
  expect(offerContext('machinery_procurement')).toBe('MACHINERY');
  for (const k of ['sourcing', 'factory_visits', 'buyers', null, undefined])
    expect(offerContext(k)).toBe('GENERAL');
});

test('a payload from before the install has none of the new keys and the old machinery section stands in', () => {
  const requirements = {
    version: 1,
    fields: { machinery: { application: 'Synthetic press line' } },
    sourceKind: 'observation',
    claimStatus: 'SELF_DECLARED',
    current: true,
  } as never;
  expect(experienceOfferContext(requirements)).toBe('MACHINERY');
  expect(
    experienceOfferContext({ ...(requirements as object), assignmentType: null } as never),
  ).toBe('GENERAL');
  expect(
    experienceOfferContext({ ...(requirements as object), assignmentType: 'sourcing' } as never),
  ).toBe('GENERAL');
});

test('buyer and team read the same type: machinery fields on a general mission and the reverse give one verdict', async () => {
  const general = await journey('sourcing', { machinery: { application: 'Synthetic press line' } });
  const machinery = await journey('machinery_procurement');
  for (const [j, expected] of [
    [general, 'GENERAL'],
    [machinery, 'MACHINERY'],
  ] as const) {
    const e = await view(j);
    expect(e.requirements).toHaveProperty('assignmentType');
    expect(experienceOfferContext(e.requirements)).toBe(expected);
    expect(await team(j.t.missionId)).toBe(expected);
    const ws = await commercial.workspace(f.ctx, j.t.missionId);
    const buyerVerdict = compareExperienceOffers(e, new Date().toISOString())[0];
    const teamVerdict = ws.comparison.find((o) => o.id === j.q.id)!;
    expect(buyerVerdict.missing).toEqual(teamVerdict.missing);
    expect(buyerVerdict.status).toBe(teamVerdict.status);
    expect((buyerVerdict.missing as string[]).includes('installation')).toBe(
      expected === 'MACHINERY',
    );
  }
});

test('the payload names the original quotation record and when it was observed, and nothing more of it', async () => {
  const j = await journey('sourcing');
  const e = await view(j);
  const quote = e.quotations[0];
  expect(quote.sourceId).toBe(j.source.id);
  expect(new Date(quote.observedAt!).getTime()).toBe(new Date(j.observedAt).getTime());
  expect(quote.currency).toBe('CNY');
  expect(quote.terms.unitPriceMinor).toBe('1200');
  expect(JSON.stringify(e)).not.toContain('Invented');
  expect(e.documentAccess).toMatch(/No raw document access/);
});

test('a meeting carries its stored activity kind through the agenda view', async () => {
  const j = await journey('machinery_procurement');
  const m = await f.meetings.command(
    f.ctx,
    command('proposeActivity', {
      targetId: j.t.targetId,
      activityKind: 'SHOWROOM_VISIT',
      context: {
        purpose: 'Review the machine on site',
        checklist: ['Check the installation prerequisites'],
        evidenceRequests: ['Ask for reference installations'],
      },
      title: 'Synthetic showroom visit',
      brief: 'An operator visit is not an engineering certificate',
      participants: ['Synthetic Supplier', 'Synthetic Buyer'],
      ownerId: f.users.operator.id,
      nextAction: 'Confirm the visit time',
      dueAt: future(),
      reason,
    }),
  );
  const dto = (
    await f.owner.query(
      `SELECT app.experience_agenda_dto(jsonb_populate_record(null::app.delivery_agenda, jsonb_build_object(
 'id',$1::uuid,'tenant_id',$2::uuid,'programme_id',$1::uuid,'item_id',$1::uuid,'version',1,'created_by',$3::uuid,
 'details',jsonb_build_object('label','Synthetic visit','state','PROPOSED','nextAction','Confirm','dueAt','2030-01-01T00:00:00Z','meetingVersions',jsonb_build_array(jsonb_build_object('id',$4::text,'version',1)))))) r`,
      [randomUUID(), f.tenantA, f.users.operator.id, m.id],
    )
  ).rows[0].r;
  expect(dto.meetings).toHaveLength(1);
  expect(dto.meetings[0].activityKind).toBe('SHOWROOM_VISIT');
});
