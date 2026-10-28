import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerSpecificationConfirmation } from '../../packages/db/src/customer-specification-confirmation-migrate';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { SpecificationConfirmationService } from '../../packages/delivery/src/specification-confirmation';
import {
  CustomerSpecificationConfirmationService,
  customerSpecificationConfirmationEnabled,
} from '../../packages/auth/src/customer-specification-confirmation';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { specificationConfirmationInput } from '../../packages/domain/src/specification-confirmation';

const issuer =
  'https://ep-specification-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const session = (who = 'alice') => ({
  subject: 'synthetic-specification-' + who,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let f: Awaited<ReturnType<typeof commercialFixture>>;
let delivery: DeliveryService,
  staff: SpecificationConfirmationService,
  commercial: CommercialMissionService;
let publicationId: string, resourceId: string, link: { id: string; token: string };
let requirementCommand: Record<string, unknown>;
const customer = (who = 'alice') =>
  new CustomerSpecificationConfirmationService(f.runtime, f.auth, options, async () =>
    session(who),
  );
const saved = (who = 'alice') =>
  new CustomerSavedMissionService(f.runtime, f.auth, options, async () => session(who));
const request = async () => {
  const viewed = await staff.options(f.users.owner.ctx, publicationId);
  if (!viewed.requirement) throw new Error('Fixture requires current reviewed requirements');
  const input = {
    commandId: randomUUID(),
    publicationId,
    ...viewed.requirement,
    ownerId: f.users.operator.id,
    dueAt: future(),
    approved: true,
  };
  const { declaration, fields, ...command } = input;
  void declaration;
  void fields;
  await staff.request(f.users.owner.ctx, command);
  return {
    input: command,
    confirm: {
      resourceId,
      commandId: randomUUID(),
      requestId: command.commandId,
      requirementId: command.requirementId,
      requirementVersion: command.requirementVersion,
      requirementDigest: command.requirementDigest,
      acknowledged: true,
    },
  };
};
async function preserved() {
  return (
    await f.owner.query(`SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f'),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('app','customer','customer_private')),
    'core',(SELECT jsonb_agg(to_jsonb(m) ORDER BY name) FROM migrations.applied m),
    'requests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app.delivery_request r),
    'responses',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app.delivery_response r),
    'requirements',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app.mission_requirements r),
    'events',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM app.domain_event r)) result`)
  ).rows[0].result;
}
beforeAll(async () => {
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
  commercial = new CommercialMissionService(f.runtime);
  staff = new SpecificationConfirmationService(f.runtime);
  delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-specification-fixture');
  const routes = new CorridorService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  for (const who of ['alice', 'bob'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(who).subject,
      executorId: f.serviceId,
      reason: 'Synthetic specification acceptance fixture only',
    });
  const target = await f.target('CN');
  const catalogue = await routes.catalogue(f.users.owner.ctx);
  const definition = catalogue.requirements.find((r) => r.schema.typeKey === 'sourcing')!;
  const assessment = catalogue.assessments.find((r) => r.schema.typeKey === 'sourcing')!;
  const type = catalogue.types.find((r) => r.key === 'sourcing')!;
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
      reason: 'Synthetic route configuration',
    });
  }
  const packId = randomUUID(),
    assignmentId = randomUUID();
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: route.id,
    version: 1,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason: 'Synthetic sourcing specification test',
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
    missionId: target.missionId,
    packId,
    missionTypeId: type.id,
    version: 1,
    reason: 'Synthetic sourcing specification test',
  });
  const sourceId = (await f.source()).id;
  const claimId = (
    await f.evidence.createClaim(f.ctx, {
      sourceId,
      statement: 'Synthetic original customer specification, not independently verified',
    })
  ).id;
  requirementCommand = command('requirements', {
    missionId: target.missionId,
    assignmentId,
    definitionId: definition.id,
    version: 1,
    schemaVersion: 1,
    declaration: 'Synthetic tire request in original customer wording',
    fields: {
      objective: 'Compare suitable tire quotations',
      role: 'IMPORTER',
      product: 'Synthetic truck tires',
      specifications: '315/80 R22.5, load index 156/150',
      quantity: '100',
      unit: 'pieces',
    },
    sourceId,
    claimId,
    reason: 'Preserve the original specification',
  });
  const req = await commercial.command(f.ctx, requirementCommand);
  publicationId = (
    await delivery.publication(f.users.owner.ctx, {
      commandId: randomUUID(),
      missionId: target.missionId,
      title: 'Synthetic sourcing requirement review',
      company: 'Synthetic tire buyer',
      objective: 'Review a proposed tire specification',
      brief: 'Synthetic approved review, no private supplier contacts',
      nextAction: 'Confirm the intended specification',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    })
  ).id;
  await new DeliveryExperienceService(f.runtime).publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId,
    requirementId: req.id,
    targetIds: [],
    quotationIds: [],
    agendaItemIds: [],
    approved: true,
    reason: 'Synthetic approved specification disclosure',
  });
  link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic customer specification confirmation',
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
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
afterAll(async () => {
  await f?.close();
});

test('optional populated install changes no previous function, policy, source, request or event and is repeatable', async () => {
  const before = await preserved();
  await migrateCustomerSpecificationConfirmation(f.owner);
  const after = await preserved();
  expect(
    after.functions.filter((v: { oid: number }) =>
      before.functions.some((b: { oid: number }) => b.oid === v.oid),
    ),
  ).toEqual(before.functions);
  expect(after.policies).toEqual(before.policies);
  for (const key of ['core', 'requests', 'responses', 'requirements', 'events'])
    expect(after[key]).toEqual(before[key]);
  const installed = await preserved();
  await migrateCustomerSpecificationConfirmation(f.owner);
  expect(await preserved()).toEqual(installed);
});
test('staff requests exact approved scope, customer reviews and explicitly confirms through existing response history', async () => {
  const { input, confirm } = await request();
  const review = (await customer().read(resourceId)).reviews.find(
    (r) => r.requestId === input.commandId,
  )!;
  expect(review.state).toBe('OPEN');
  expect(review.fields?.specifications).toBe('315/80 R22.5, load index 156/150');
  expect(await customer().confirm(confirm)).toMatchObject({ confirmed: true, replayed: false });
  expect(await customer().confirm(confirm)).toMatchObject({ confirmed: true, replayed: true });
  expect(
    (await customer().read(resourceId)).reviews.find((r) => r.requestId === input.commandId)?.state,
  ).toBe('CONFIRMED');
  const response = (
    await f.owner.query('SELECT body FROM app.delivery_response WHERE id=$1', [confirm.commandId])
  ).rows[0];
  expect(response.body).toContain('does not authorise a purchase');
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE type='delivery.specification.confirmed' AND aggregate_id=$1",
      [confirm.commandId],
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain('315/80');
  expect(
    (await staff.options(f.users.owner.ctx, publicationId)).requests.find(
      (r) => r.requestId === input.commandId,
    )?.confirmedAt,
  ).toBeTruthy();
});
test('an ordinary self-declared reply never becomes a specification confirmation', async () => {
  const { confirm } = await request();
  await saved().command({
    action: 'respond',
    resourceId,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: confirm.requestId,
    body: 'I agree with these details in a generic reply',
    acknowledged: true,
  });
  expect(
    (await customer().read(resourceId)).reviews.find((r) => r.requestId === confirm.requestId)
      ?.state,
  ).toBe('RESPONDED');
  await expect(customer().confirm(confirm)).rejects.toThrow(/already recorded|retry changed/i);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.delivery_specification_confirmation WHERE request_id=$1',
        [confirm.requestId],
      )
    ).rows[0].n,
  ).toBe(0);
});
test('changed digest, version, requirement, command values and missing acknowledgement are denied', async () => {
  const { input, confirm } = await request();
  for (const change of [
    { requirementDigest: '0'.repeat(64) },
    { requirementVersion: confirm.requirementVersion + 1 },
    { requirementId: randomUUID() },
  ])
    await expect(customer().confirm({ ...confirm, ...change })).rejects.toThrow();
  expect(
    specificationConfirmationInput.safeParse({ ...confirm, acknowledged: false }).success,
  ).toBe(false);
  await expect(
    staff.request(f.users.owner.ctx, { ...input, ownerId: f.users.owner.id }),
  ).rejects.toThrow(/conflict/i);
  await expect(customer().confirm(confirm, 'changed-subject', issuer)).rejects.toThrow(
    /account changed/i,
  );
});
test('another customer, staff viewer/operator, unrelated tenant and direct SQL cannot gain confirmation authority', async () => {
  const { input, confirm } = await request();
  await expect(customer('bob').read(resourceId)).rejects.toThrow();
  await expect(customer('bob').confirm(confirm)).rejects.toThrow();
  for (const who of ['operator', 'reviewer', 'viewer'] as const)
    await expect(
      staff.request(f.users[who].ctx, { ...input, commandId: randomUUID() }),
    ).rejects.toThrow();
  await expect(
    staff.options({ ...f.users.owner.ctx, tenantId: f.tenantB }, publicationId),
  ).rejects.toThrow();
  for (const table of ['delivery_specification_request', 'delivery_specification_confirmation']) {
    await expect(f.runtime.query('SELECT * FROM app.' + table)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(f.auth.query('SELECT * FROM app.' + table)).rejects.toThrow(/permission denied/i);
  }
  await expect(
    f.runtime.query('SELECT app.specification_scope_valid($1,$2,$3,$4,$5)', [
      f.tenantA,
      publicationId,
      input.requirementId,
      input.requirementVersion,
      input.requirementDigest,
    ]),
  ).rejects.toThrow(/permission denied/i);
});
test('expired MFA denies staff requests and revocation immediately denies a saved customer scope', async () => {
  const { input, confirm } = await request();
  await f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '6 minutes'");
  await expect(
    staff.request(f.users.owner.ctx, { ...input, commandId: randomUUID() }),
  ).rejects.toThrow();
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  const temporary = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic temporary review scope',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  const temporaryResource = (
    await saved().command({
      action: 'save',
      commandId: randomUUID(),
      token: temporary.token,
      acknowledged: true,
    })
  ).id;
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: temporary.id,
    publicationId: null,
    reason: 'Synthetic revoked confirmation scope',
  });
  await expect(customer().confirm({ ...confirm, resourceId: temporaryResource })).rejects.toThrow();
  await expect(customer().read(temporaryResource)).rejects.toThrow();
});
test('cancelled question cannot be confirmed and all typed records remain immutable', async () => {
  const { confirm } = await request();
  await delivery.closeRequest(f.users.owner.ctx, {
    commandId: randomUUID(),
    requestId: confirm.requestId,
    status: 'CANCELLED',
    reason: 'Synthetic request needs further clarification',
  });
  await expect(customer().confirm(confirm)).rejects.toThrow(/closed/i);
  expect(
    (await customer().read(resourceId)).reviews.find((r) => r.requestId === confirm.requestId)
      ?.state,
  ).toBe('CANCELLED');
  for (const table of ['delivery_specification_request', 'delivery_specification_confirmation'])
    await expect(f.owner.query('DELETE FROM app.' + table)).rejects.toThrow(
      /append|immutable|rewrit/i,
    );
});
test('concurrent confirmations record only one typed acceptance and one original response', async () => {
  const { confirm } = await request();
  const results = await Promise.allSettled([
    customer().confirm(confirm),
    customer().confirm({ ...confirm, commandId: randomUUID() }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.delivery_specification_confirmation WHERE request_id=$1',
        [confirm.requestId],
      )
    ).rows[0].n,
  ).toBe(1);
});
test('link expiry after a trigger wait rolls back the original response, typed confirmation and events', async () => {
  const { confirm } = await request();
  const temporary = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic short-lived specification confirmation',
    expiresAt: new Date(Date.now() + 2000).toISOString(),
    allowExport: false,
    approved: true,
  });
  const temporaryResource = (
    await saved().command({
      action: 'save',
      commandId: randomUUID(),
      token: temporary.token,
      acknowledged: true,
    })
  ).id;
  await f.owner.query(
    'CREATE FUNCTION app.test_specification_delay() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN PERFORM pg_sleep(2.2);RETURN NEW;END $$;CREATE TRIGGER zz_test_specification_delay BEFORE INSERT ON app.delivery_specification_confirmation FOR EACH ROW EXECUTE FUNCTION app.test_specification_delay()',
  );
  try {
    await expect(customer().confirm({ ...confirm, resourceId: temporaryResource })).rejects.toThrow(
      /expired|changed|unavailable/i,
    );
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.delivery_response WHERE id=$1', [
          confirm.commandId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.delivery_specification_confirmation WHERE id=$1',
          [confirm.commandId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_id=$1 AND type IN ('delivery.response.recorded','delivery.specification.confirmed')",
          [confirm.commandId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.owner.query(
      'DROP TRIGGER zz_test_specification_delay ON app.delivery_specification_confirmation;DROP FUNCTION app.test_specification_delay()',
    );
  }
});

test('loss of wall-clock staff MFA after event insertion rolls back the new request and metadata', async () => {
  const viewed = await staff.options(f.users.owner.ctx, publicationId);
  const pinned = viewed.requirement!;
  const input = {
    commandId: randomUUID(),
    publicationId,
    requirementId: pinned.requirementId,
    requirementVersion: pinned.requirementVersion,
    requirementDigest: pinned.requirementDigest,
    ownerId: f.users.operator.id,
    dueAt: future(),
    approved: true,
  };
  await f.owner.query(
    "CREATE FUNCTION app.test_specification_mfa_expiry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN UPDATE identity.assurance SET verified_at=clock_timestamp()-interval '6 minutes';RETURN NEW;END $$;CREATE TRIGGER zz_test_specification_mfa_expiry AFTER INSERT ON app.delivery_specification_request FOR EACH ROW EXECUTE FUNCTION app.test_specification_mfa_expiry()",
  );
  try {
    await expect(staff.request(f.users.owner.ctx, input)).rejects.toThrow(
      /authority|authenticator/i,
    );
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.delivery_request WHERE id=$1', [
          input.commandId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.delivery_specification_request WHERE id=$1',
          [input.commandId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.owner.query('SELECT count(*)::int n FROM app.domain_event WHERE aggregate_id=$1', [
          input.commandId,
        ])
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.owner.query(
      'DROP TRIGGER zz_test_specification_mfa_expiry ON app.delivery_specification_request;DROP FUNCTION app.test_specification_mfa_expiry()',
    );
  }
});

test('a new requirement version makes old confirmation requests non-actionable without rewriting history', async () => {
  const { confirm } = await request();
  await commercial.command(f.ctx, {
    ...requirementCommand,
    commandId: randomUUID(),
    version: 2,
    declaration: 'Synthetic revised tire specification, customer has not confirmed it',
  });
  await expect(customer().confirm(confirm)).rejects.toThrow(/current specification/i);
  const read = await customer().read(resourceId);
  expect(
    read.reviews.every(
      (r) => r.state === 'REVIEW_REQUIRED' && r.fields === null && r.declaration === null,
    ),
  ).toBe(true);
  expect((await staff.options(f.users.owner.ctx, publicationId)).requirement).toBeNull();
});
test('application module defaults closed and cannot be enabled without saved-report gates', () => {
  expect(customerSpecificationConfirmationEnabled({})).toBe(false);
  expect(
    customerSpecificationConfirmationEnabled({
      CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED: 'true',
    }),
  ).toBe(false);
});
