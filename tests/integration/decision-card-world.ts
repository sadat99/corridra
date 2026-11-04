import { createHash, randomUUID } from 'node:crypto';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { missionCatalogue } from '../../packages/domain/src/commercial-missions';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { DecisionDisclosureService } from '../../packages/delivery/src/decision-disclosures';
import { CustomerDeliveryService } from '../../packages/delivery/src/customer-delivery';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';

// A small synthetic world for the decision card service and route tests (ADR-076 item 4): one workspace owned by
// alice, bob as a plain member, and one complete reviewed report for alice with a second decision, a priced
// quotation and an evidence record seeded so that field exclusion can be shown through the HTTP routes. It is
// a trimmed copy of the world in customer-decision-cards.test.ts, which proves the database module itself.
export const cardIssuer =
  'https://ep-cards-service.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
export const cardOptions = {
  enabled: true,
  synthetic: true,
  production: false,
  issuer: cardIssuer,
};
export const cardSecret = 'synthetic-card-service-secret-0123456789abcdef';
const reason = 'Synthetic decision card service acceptance';
export const markers = {
  quotation: 'MARKER-QUOTE-3b7e',
  price: '918273645',
  second: 'MARKER-SECOND-DECISION-8d1c',
  evidence: 'MARKER-EVIDENCE-6a02',
  brief: 'MARKER-BRIEF-51ef',
  request: 'MARKER-REQUEST-c94b',
};
export const people = ['alice', 'bob'] as const;
export type Person = (typeof people)[number];
export const cardSession = (who: string) => ({
  subject: 'synthetic-card-service-' + who,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const hex = (value: string) => createHash('sha256').update(value).digest('hex');
export type CardWorld = Awaited<ReturnType<typeof cardWorld>>;

export async function cardWorld() {
  const f = await commercialFixture();
  const routes = new CorridorService(f.runtime);
  const commercial = new CommercialMissionService(f.runtime);
  const delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-card-fixture');
  const disclosure = new DecisionDisclosureService(f.runtime);
  const staff = new CustomerDeliveryService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  await migrateCustomerDecisionCards(f.owner);
  const principals: Record<string, string> = {};
  const workspaces = (who: string) =>
    new CustomerWorkspaceService(f.runtime, f.auth, cardOptions, async () => cardSession(who));
  const saved = (who: string) =>
    new CustomerSavedMissionService(f.runtime, f.auth, cardOptions, async () => cardSession(who));
  for (const who of people) {
    principals[who] = (
      await admitSyntheticCustomer(f.owner, {
        issuer: cardIssuer,
        subject: cardSession(who).subject,
        executorId: f.serviceId,
        reason: 'Fictional customer decision card service fixture, never real provider data',
      })
    ).id;
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[who]!,
      reason: 'Explicit fictional private request admission',
    });
  }
  const workspaceId = (
    await workspaces('alice').provision({
      commandId: randomUUID(),
      name: 'Synthetic card service workspace',
    })
  ).id as string;
  const invited = await workspaces('alice').access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic invited bob',
  });
  await workspaces('bob').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invited.token!,
  });

  async function journey() {
    const t = await f.target('CN'),
      catalogue = await routes.catalogue(f.users.owner.ctx);
    let route = (
      await f.owner.query(
        "SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND origin_market='BD' AND destination_market='CN'",
        [f.tenantA],
      )
    ).rows[0];
    if (!route) {
      route = { id: randomUUID() };
      await routes.createRoute(f.users.owner.ctx, {
        ...route,
        origin: 'BD',
        destination: 'CN',
        reason,
      });
    }
    const definition = catalogue.requirements.find((r) => r.schema.typeKey === 'sourcing')!;
    const assessment = catalogue.assessments.find((r) => r.schema.typeKey === 'sourcing')!;
    const type = catalogue.types.find((r) => r.key === 'sourcing')!;
    const packId = randomUUID(),
      assignmentId = randomUUID();
    await routes.appendPack(f.users.owner.ctx, {
      id: packId,
      routeId: route.id,
      version:
        (
          await f.owner.query(
            'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE route_id=$1',
            [route.id],
          )
        ).rows[0].n + 1,
      status: 'TESTING',
      effectiveFrom: new Date().toISOString(),
      reason,
      configuration: {
        ...initialRouteConfiguration(initialRoutes[2]),
        missionTypes: ['sourcing'],
        currencies: ['CNY'],
        requirements: [definition.id],
        assessments: [assessment.id],
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
    const source = await f.evidence.createSource(f.ctx, {
      kind: 'observation',
      locator: 'Synthetic evidence ' + markers.evidence,
      observedAt: new Date().toISOString(),
      classification: 'INTERNAL',
      purpose: 'synthetic_validation',
      retentionUntil: future(30),
      aiPolicy: 'DENY',
    });
    const claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source.id,
      statement:
        'Declared synthetic requirement and supplier response, no independent verification',
    });
    const base = { missionId: t.missionId, reason, sourceId: source.id, claimId: claim.id };
    const requirement = await commercial.command(
      f.ctx,
      command('requirements', {
        ...base,
        assignmentId,
        definitionId: definition.id,
        version: 1,
        schemaVersion: 1,
        declaration: 'Original synthetic customer request ' + markers.request,
        fields: {
          objective: 'Assess suppliers against actual declared requirements',
          role: 'IMPORTER',
          product: 'Synthetic production equipment',
          quantity: '100',
          unit: 'pieces',
          budgetMinor: '200000',
          currency: 'CNY',
          budgetBasis: 'One hundred pieces',
        },
      }),
    );
    const assess = async (version: number) =>
      commercial.command(
        f.ctx,
        command('assessment', {
          ...base,
          requirementId: requirement.id,
          definitionId: assessment.id,
          targetId: t.targetId,
          version,
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
          technicalResults: [],
          unknowns: 'Independent confirmation is absent',
          gaps: 'Need documentation and actual evidence',
          rationale: 'Review supports discussion only, no certification',
        }),
      );
    return { ...t, base, requirement, assess, sourceId: source.id, claimId: claim.id };
  }

  async function build(
    who: Person,
    where: string,
    extras: { second?: boolean; days?: number } = {},
  ) {
    const j = await journey();
    const decide = async (
      assessmentId: string,
      decision: string,
      rationale: string,
      quotationId?: string,
    ) =>
      (
        await commercial.command(
          f.ctx,
          command('decision', {
            ...j.base,
            requirementId: j.requirement.id,
            targetId: j.targetId,
            assessmentId,
            ...(quotationId ? { quotationId } : {}),
            decision,
            rationale,
            ...f.next(),
          }),
        )
      ).id as string;
    const decisionId = await decide(
      (await j.assess(1)).id,
      'NEED_INFORMATION',
      'Independent supplier evidence remains missing ' + randomUUID().slice(0, 8),
    );
    const decisions = [decisionId];
    const quotationIds: string[] = [];
    let otherDecisionId: string | null = null;
    if (extras.second) {
      const rfq = await commercial.command(
        f.ctx,
        command('rfq', {
          ...j.base,
          requirementId: j.requirement.id,
          targetIds: [j.targetId],
          buyerContext: 'Shareable invented buying context',
          requestedTerms: 'Original unit price, quantity and delivery conditions',
          dueAt: future(),
        }),
      );
      const quotation = await commercial.command(
        f.ctx,
        command('quotation', {
          ...j.base,
          rfqId: rfq.id,
          targetId: j.targetId,
          revision: 1,
          observedAt: new Date().toISOString(),
          currency: 'CNY',
          terms: { unitPriceMinor: markers.price },
          uncertainties: 'Quantity and logistics remain unconfirmed ' + markers.quotation,
        }),
      );
      quotationIds.push(quotation.id);
      otherDecisionId = await decide(
        (await j.assess(2)).id,
        'SELECT',
        'Selected for discussion ' + markers.second,
        quotation.id,
      );
      decisions.push(otherDecisionId);
    }
    const publicationId = (
      await delivery.publication(f.users.owner.ctx, {
        commandId: randomUUID(),
        missionId: j.missionId,
        title: 'Approved synthetic commercial decision context',
        company: 'Fictional requesting company',
        objective: 'Review actual recorded commercial decisions',
        brief: 'Original approved fictional commercial requirement ' + markers.brief,
        nextAction: 'Review the scoped decision and missing evidence',
        dueAt: future(),
        meetings: [],
        opportunityIds: [],
        includeFinancials: false,
        approved: true,
      })
    ).id as string;
    await new DeliveryExperienceService(f.runtime).publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      publicationId,
      requirementId: j.requirement.id,
      targetIds: [j.targetId],
      quotationIds,
      agendaItemIds: [],
      approved: true,
      reason,
    });
    const link = await delivery.share(f.users.owner.ctx, {
      commandId: randomUUID(),
      programmeId: null,
      publicationIds: [publicationId],
      audience: 'CLIENT_PROGRESS',
      purpose: 'Explicitly scoped fictional decision reporting',
      expiresAt: future(extras.days ?? 3),
      allowExport: false,
      approved: true,
    });
    const approve = (version: number, ids: string[]) =>
      disclosure.approve(f.users.owner.ctx, {
        commandId: randomUUID(),
        publicationId,
        version,
        decisionIds: ids,
        reason,
        approved: true,
      });
    await approve(1, decisions);
    const requestId = randomUUID();
    await f.owner.query(
      `INSERT INTO customer_private.owned_request(id,principal_id,command_id,workspace_id,mission_tenant_id,mission_id,request_key,brief_digest,receipt_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        requestId,
        principals[who],
        randomUUID(),
        where,
        f.tenantA,
        j.missionId,
        randomUUID(),
        hex(randomUUID()),
        hex(randomUUID()),
      ],
    );
    await staff.assign(f.users.owner.ctx, {
      commandId: randomUUID(),
      requestId,
      linkId: link.id,
      reason: 'Explicit synthetic account report delivery review',
      approved: true,
    });
    const resourceId = (
      await saved(who).command({
        action: 'save',
        commandId: randomUUID(),
        token: link.token,
        acknowledged: true,
      })
    ).id as string;
    return {
      who,
      ...j,
      decisionId,
      otherDecisionId,
      publicationId,
      link,
      resourceId,
      requestId,
      approve,
      decisions,
    };
  }

  const main = await build('alice', workspaceId, { second: true });
  // The same report held by a plain member: someone who has the link but may not share it.
  const memberResource = (
    await saved('bob').command({
      action: 'save',
      commandId: randomUUID(),
      token: main.link.token,
      acknowledged: true,
    })
  ).id as string;
  // The limit of five and the hourly limit are proved on reports of their own, so the other cases keep room.
  const spare = () => build('alice', workspaceId);
  return { f, principals, workspaceId, main, memberResource, spare, build };
}

// Mutations the product never makes (a revoked member, a lapsed source, an edited decision) are made as the
// owner connection with the table's guard triggers off for that one statement, then put back.
export async function mutate(
  owner: {
    connect(): Promise<{ query(sql: string, args?: unknown[]): Promise<unknown>; release(): void }>;
  },
  table: string,
  sql: string,
  args: unknown[] = [],
) {
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await client.query(sql, args);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Test housekeeping: the limit of five live cards is proved on reports of their own, so the cases that share the
// main report withdraw what they made, as the owner connection, to leave room for the next one.
export async function retireCards(
  owner: { query(sql: string, args?: unknown[]): Promise<unknown> },
  resourceId: string,
) {
  await owner.query(
    `INSERT INTO customer_private.decision_card_withdrawal(card_id,principal_id,command_id)
     SELECT c.id,c.principal_id,gen_random_uuid() FROM customer_private.decision_card c
     WHERE c.saved_mission_id=$1 AND NOT EXISTS(SELECT FROM customer_private.decision_card_withdrawal w WHERE w.card_id=c.id)`,
    [resourceId],
  );
}
