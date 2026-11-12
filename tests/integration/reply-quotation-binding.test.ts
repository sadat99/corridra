import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { changeMemberNow } from './change-member';
import { fixture, rawContext } from './support';
import { readFile } from 'node:fs/promises';
import type { DatabasePool } from '../../packages/db/src/index';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';
import { migrateReplyReview } from '../../packages/db/src/recipient-reply-review-migrate';
import { configureRecipientRevision } from '../../packages/delivery/src/recipient-revision-configuration';
import { configureReplyReview } from '../../packages/delivery/src/reply-review-configuration';
import { hash } from '../../packages/communications/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { ReplyReviewService } from '../../packages/delivery/src/reply-review';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { initialRoutes } from '../../packages/domain/src/corridors';

// ADR-081: a published supplier reply carried into the supplier offer command, bound in the same transaction. Local throwaway
// database only; the module files are applied by the same installer functions the protected install job uses.
const session = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/communication-orchestrator', () => ({ communicationOrchestrator: {} }));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
const services = { commercialMissions: undefined as unknown };
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: session },
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    access: { config: async () => [] },
    commercialMissions: services.commercialMissions,
  }),
}));

let f: Awaited<ReturnType<typeof commercialFixture>>,
  experience: DeliveryExperienceService,
  routes: CorridorService,
  commercial: CommercialMissionService,
  reviews: ReplyReviewService,
  selfSource: { sourceId: string; claimId: string },
  observedSource: { sourceId: string; claimId: string };
const reason = 'Synthetic reply to supplier offer binding validation';
const enableReason = 'Owner opened reply review for the local fixture tests';
const revisionReason = 'Owner opened answer correction for the local fixture tests';
const on = { replyBinding: true };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const lockKey = (tenant: string, reply: string) => `app.reply_review:${tenant}:${reply}`;
const instants = (ts: string) =>
  `to_char(${ts} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

beforeAll(async () => {
  f = await commercialFixture();
  experience = new DeliveryExperienceService(f.runtime);
  routes = new CorridorService(f.runtime);
  commercial = new CommercialMissionService(f.runtime);
  reviews = new ReplyReviewService(f.runtime);
  services.commercialMissions = commercial;
  await routes.installTemplates(f.users.owner.ctx);
  const provenance = async (kind: string) => {
    const source = await f.source(kind);
    const claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source.id,
      statement: 'Invented supplier statement recorded as the original offer declaration',
    });
    return { sourceId: source.id, claimId: claim.id };
  };
  selfSource = await provenance('self_declaration');
  observedSource = await provenance('observation');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f?.close();
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});

// ---- scenario helpers -------------------------------------------------------------------------------------------------------

const supplierTerms = {
  specification: 'Polyester curtain track',
  quantity: '100',
  moq: '10',
  unit: 'pieces',
  unitPriceMinor: '1250',
  totalPriceMinor: '900719925474099312',
  toolingMinor: '0',
  leadTime: '30 days from order',
  validUntil: '2027-03-31T00:00:00+08:00',
  incoterm: 'FOB',
  shipping: 'EXCLUDED',
  commissioning: 'Commissioning on site is included',
};
const replyQuotation = (over: Record<string, unknown> = {}) => ({
  currency: 'CNY',
  terms: supplierTerms,
  uncertainties: 'Lead time depends on raw material delivery',
  ...over,
});

/** One mission with a current requirement, an RFQ and a first recorded offer (revision 1) for its one supplier. */
async function journey() {
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
  const req = cat.requirements.find((r) => r.schema.typeKey === 'sourcing')!,
    assessment = cat.assessments.find((r) => r.schema.typeKey === 'sourcing')!,
    type = cat.types.find((r) => r.key === 'sourcing')!;
  const version =
    (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int n FROM app.corridor_pack_version WHERE route_id=$1',
        [route.id],
      )
    ).rows[0].n + 1;
  const packId = randomUUID(),
    assignmentId = randomUUID();
  await routes.appendPack(f.users.owner.ctx, {
    id: packId,
    routeId: route.id,
    version,
    status: 'TESTING',
    effectiveFrom: new Date().toISOString(),
    reason,
    configuration: {
      ...initialRouteConfiguration(initialRoutes[0]),
      missionTypes: ['sourcing'],
      currencies: ['CNY', 'USD'],
      requirements: [req.id],
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
  const source = await f.source(),
    claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source.id,
      statement: 'Invented original sourcing requirement and quotation declaration',
    }),
    base = { missionId: t.missionId, sourceId: source.id, claimId: claim.id, reason };
  const requirementInput = command('requirements', {
    ...base,
    assignmentId,
    definitionId: req.id,
    version: 1,
    schemaVersion: 1,
    declaration: 'Original supplied synthetic requirement',
    fields: {
      objective: 'Find suitable machinery components',
      role: 'IMPORTER',
      product: 'Machinery components',
      quantity: '100',
      unit: 'pieces',
    },
  });
  const requirement = await commercial.command(f.ctx, requirementInput);
  const rfq = await commercial.command(
    f.ctx,
    command('rfq', {
      ...base,
      requirementId: requirement.id,
      targetIds: [t.targetId],
      buyerContext: 'Explicitly shareable invented buying context',
      requestedTerms: 'Original unit price, quantity and delivery conditions',
      dueAt: future(),
    }),
  );
  const first = await commercial.command(
    f.ctx,
    command('quotation', {
      ...base,
      rfqId: rfq.id,
      targetId: t.targetId,
      revision: 1,
      observedAt: new Date().toISOString(),
      currency: 'CNY',
      terms: { unitPriceMinor: '1200' },
      uncertainties: 'Quantity, logistics and specifications remain unconfirmed',
    }),
  );
  return { t, rfq, first, base, requirementInput };
}
type Journey = Awaited<ReturnType<typeof journey>>;

/** A supplier link, its disclosure for the RFQ, and the supplier's first answer. */
async function reply(
  j: Journey,
  options: {
    quotation?: ReturnType<typeof replyQuotation> | null;
    rfqId?: string;
    /** Store the words exactly as typed: the supplier page trims text before the database sees it, the database function does not. */
    exact?: boolean;
  } = {},
) {
  const rfqId = options.rfqId ?? j.rfq.id;
  const link = await f.introduction(j.t);
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId,
    allowQuotation: true,
    allowMeetingInterest: false,
    approved: true,
    reason,
  });
  const responseId = randomUUID();
  const answer = {
    body: 'Original supplier reply, quote follows.',
    meetingInterest: false,
    quotation: options.quotation === undefined ? replyQuotation() : options.quotation,
    acknowledged: true,
  };
  if (options.exact)
    await f.runtime.query('SELECT app.recipient_detail_respond($1,$2,$3::jsonb)', [
      hash(link.token),
      responseId,
      JSON.stringify(answer),
    ]);
  else
    await f.communications.buyer({
      action: 'detail-response',
      token: link.token,
      responseId,
      ...answer,
    });
  return { j, link, token: link.token, responseId, rfqId };
}
type Reply = Awaited<ReturnType<typeof reply>>;

const decide = (
  responseId: string,
  decision: 'PUBLISH' | 'ASK' | 'REJECT',
  seen = 0,
  ctx = f.users.owner.ctx,
) =>
  reviews.review(ctx, {
    commandId: randomUUID(),
    responseId,
    decision,
    seen,
    ...(decision === 'ASK'
      ? { askTerms: ['validUntil'], note: 'Please state how long the quote is valid' }
      : {}),
    ...(decision === 'REJECT' ? { reasonCode: 'NOT_A_FIT' } : {}),
  });
const publishedReply = async (
  options: Parameters<typeof reply>[1] = {},
  j?: Journey,
): Promise<Reply> => {
  const r = await reply(j ?? (await journey()), options);
  await decide(r.responseId, 'PUBLISH');
  return r;
};

/** What the published reply says, read straight from the tables by the owner connection (an oracle for the database functions). */
async function stated(responseId: string) {
  const revisions = (
    await f.owner.query(
      "SELECT to_regclass('app.recipient_detail_response_revision') IS NOT NULL AS y",
    )
  ).rows[0].y;
  const sql = revisions
    ? `SELECT coalesce(x.version,0) AS seen,coalesce(x.body,o.body)::text AS text,coalesce(x.body,o.body) AS body,${instants('coalesce(x.created_at,o.created_at)')} AS at
       FROM app.recipient_detail_response o LEFT JOIN LATERAL (SELECT y.version,y.body,y.created_at FROM app.recipient_detail_response_revision y WHERE y.response_id=o.id ORDER BY y.version DESC LIMIT 1) x ON true WHERE o.id=$1`
    : `SELECT 0 AS seen,o.body::text AS text,o.body AS body,${instants('o.created_at')} AS at FROM app.recipient_detail_response o WHERE o.id=$1`;
  const row = (await f.owner.query(sql, [responseId])).rows[0];
  return {
    seen: row.seen as number,
    digest: sha(row.text),
    observedAt: row.at as string,
    quotation: row.body.quotation as {
      currency: string;
      terms: Record<string, string>;
      uncertainties: string;
    },
  };
}
/** The offer the form would send for this reply: its own statement, a given revision and source, plus any override. */
async function offerFor(
  r: Reply,
  over: Record<string, unknown> = {},
  provenance = selfSource,
  chain: { revision: number; previousId?: string } | undefined = undefined,
) {
  const said = await stated(r.responseId);
  const previous = (
    await f.owner.query(
      'SELECT id,revision FROM app.mission_quotation WHERE rfq_id=$1 AND target_id=$2 ORDER BY revision DESC LIMIT 1',
      [r.rfqId, r.j.t.targetId],
    )
  ).rows[0];
  return command('quotation', {
    missionId: r.j.t.missionId,
    reason,
    ...provenance,
    rfqId: r.rfqId,
    targetId: r.j.t.targetId,
    revision: chain?.revision ?? (previous?.revision ?? 0) + 1,
    previousId: chain ? chain.previousId : previous?.id,
    currency: said.quotation.currency,
    terms: said.quotation.terms,
    uncertainties: said.quotation.uncertainties,
    observedAt: said.observedAt,
    replyBinding: { responseId: r.responseId, seen: said.seen, digest: said.digest },
    ...over,
  });
}
const bindingFor = (input: Record<string, unknown>, over: Record<string, unknown>) => ({
  ...(input.replyBinding as Record<string, unknown>),
  ...over,
});

const tables = [
  'mission_quotation',
  'commercial_mission_command',
  'reply_quotation_binding',
  'domain_event',
  'audit_event',
  'outbox',
] as const;
async function counts() {
  const out: Record<string, number> = {};
  for (const table of tables)
    out[table] = (await f.owner.query(`SELECT count(*)::int n FROM app.${table}`)).rows[0].n;
  return out;
}
/** The command is refused with exactly this message and leaves no offer, binding, command record or event behind. */
async function refusedWith(input: Record<string, unknown>, message: string, status?: number) {
  const before = await counts();
  const failure = commercial.command(f.ctx, input, on);
  await expect(failure).rejects.toThrow(message);
  if (status !== undefined) await expect(failure).rejects.toMatchObject({ status });
  expect(await counts()).toEqual(before);
}
const bindingOf = async (responseId: string) =>
  (
    await f.owner.query('SELECT * FROM app.reply_quotation_binding WHERE response_id=$1', [
      responseId,
    ])
  ).rows;
const prefillOf = (responseId: string, ctx = f.ctx) => commercial.replyPrefill(ctx, responseId, on);
async function expectEligible(responseId: string) {
  const result = await prefillOf(responseId);
  if (!result.eligible) throw new Error(`Expected an eligible reply, got ${result.reason}`);
  return result;
}
async function expectReason(responseId: string, code: string, ctx = f.ctx) {
  const result = await prefillOf(responseId, ctx);
  expect(result).toEqual({ eligible: false, reason: code });
}
const setReview = (enabled: boolean) =>
  configureReplyReview(f.owner, { enabled, reason: enableReason });
async function expireReply(responseId: string) {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query('ALTER TABLE app.recipient_detail_response DISABLE TRIGGER immutable');
    await db.query(
      "UPDATE app.recipient_detail_response SET retention_until=created_at+interval '1 microsecond' WHERE id=$1",
      [responseId],
    );
    await db.query('ALTER TABLE app.recipient_detail_response ENABLE TRIGGER immutable');
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function addTarget(missionId: string) {
  const source = await f.evidence.createSource(f.ctx, {
    kind: 'public_record',
    locator: 'https://example.invalid/second-supplier',
    observedAt: new Date().toISOString(),
    classification: 'PUBLIC',
    purpose: 'synthetic_validation',
    retentionUntil: future(7),
    aiPolicy: 'DENY',
  });
  const company = await f.research.command(
    f.ctx,
    command('ingest', {
      sourceId: source.id,
      name: `Synthetic Second Supplier ${randomUUID()}`,
      country: 'ES',
      domain: `${randomUUID()}.example.invalid`,
      address: 'Synthetic business address',
      identifierType: 'registry',
      identifier: randomUUID(),
    }),
  );
  const relationship = await f.research.command(
    f.ctx,
    command('relationship', {
      organisationId: company.id,
      ownerId: f.users.operator.id,
      visibility: 'OWNER',
      note: 'Private negotiation details never shown to buyer',
    }),
  );
  const contact = await f.research.command(
    f.ctx,
    command('contact', {
      relationshipId: relationship.id,
      sourceId: source.id,
      name: 'Synthetic Second Person',
      jobTitle: 'Procurement',
      email: `${randomUUID()}@example.invalid`,
      validUntil: future(6),
    }),
  );
  const claim = await f.evidence.createClaim(f.ctx, {
    sourceId: source.id,
    statement: 'Synthetic second supplier declares interest',
  });
  await f.research.command(
    f.ctx,
    command('attribute', {
      organisationId: company.id,
      kind: 'requirement',
      claimId: claim.id,
      validUntil: future(6),
    }),
  );
  const target = await f.research.command(
    f.ctx,
    command('target', {
      missionId,
      relationshipId: relationship.id,
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
    targetId: target.id as string,
    contactId: contact.id as string,
    relationshipId: relationship.id as string,
    missionId,
    claimId: claim.id,
    sourceId: source.id,
  };
}
/** A second admin of workspace A, added the way the fixture adds its members (the schema owner acts as the service). */
async function addAdmin(userId: string) {
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [f.serviceId, randomUUID(), randomUUID()],
    );
    await db.query("INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'admin')", [
      f.tenantA,
      userId,
    ]);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
const revision = (token: string, expectedVersion: number, over: Record<string, unknown> = {}) => ({
  action: 'detail-revision' as const,
  token,
  responseId: randomUUID(),
  expectedVersion,
  body: 'Corrected supplier reply, quote follows.',
  meetingInterest: false,
  quotation: replyQuotation({
    terms: { ...supplierTerms, unitPriceMinor: '1300' },
    uncertainties: 'Validity still not known',
  }),
  acknowledged: true,
  ...over,
});

// ---- installation -------------------------------------------------------------------------------------------------------------

describe('installation (without the correction module)', () => {
  const snapshot = async () =>
    (
      await f.owner.query(
        `SELECT 'f' AS k,p.oid::int AS oid,pg_get_functiondef(p.oid) AS def,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity')
         UNION ALL SELECT 't',c.oid::int,coalesce((SELECT string_agg(pg_get_expr(po.polqual,po.polrelid)||po.polname,'|' ORDER BY po.polname) FROM pg_policy po WHERE po.polrelid=c.oid),''),c.relacl::text||c.relrowsecurity::text
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity') ORDER BY 1,2`,
      )
    ).rows;
  test('installs additively and repeatably, and a changed file stops it', async () => {
    await migrateCustomerRealUse(f.owner);
    const before = await snapshot();
    await migrateReplyReview(f.owner);
    const after = await snapshot();
    const known = new Set(before.map((row) => `${row.k}${row.oid}`));
    expect(after.filter((row) => known.has(`${row.k}${row.oid}`))).toEqual(before);
    const added = after.filter((row) => !known.has(`${row.k}${row.oid}`));
    expect(added.some((row) => row.def.includes('bind_reply_quotation'))).toBe(true);
    const once = (
      await f.owner.query('SELECT * FROM recipient_reply_review_migrations.applied ORDER BY name')
    ).rows;
    expect(once.map((row) => row.name)).toEqual([
      '0001_reply_review.sql',
      '0002_commissioning_term.sql',
      '0003_reply_quotation_binding.sql',
    ]);
    await migrateReplyReview(f.owner);
    expect(
      (await f.owner.query('SELECT * FROM recipient_reply_review_migrations.applied ORDER BY name'))
        .rows,
    ).toEqual(once);
    await f.owner.query(
      "UPDATE recipient_reply_review_migrations.applied SET sha256=repeat('0',64) WHERE name='0003_reply_quotation_binding.sql'",
    );
    await expect(migrateReplyReview(f.owner)).rejects.toThrow('history mismatch');
    await f.owner.query(
      'UPDATE recipient_reply_review_migrations.applied SET sha256=$1 WHERE name=$2',
      [once[2].sha256, once[2].name],
    );
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM app.reply_quotation_binding')).rows[0].n,
    ).toBe(0);
    await configureReplyReview(f.owner, { enabled: true, reason: enableReason });
  });

  test('the reply binding is not available to anyone else: runtime reads only, auth has nothing, nothing can be written directly', async () => {
    const insert =
      "INSERT INTO app.reply_quotation_binding(tenant_id,quotation_id,response_id,review_id,reply_version,body_sha256,mission_id,rfq_id,target_id,created_by) VALUES($1,$2,$3,$4,0,repeat('a',64),$5,$6,$7,$8)";
    const args = [
      f.tenantA,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      f.users.owner.id,
    ];
    await expect(f.runtime.query(insert, args)).rejects.toMatchObject({ code: '42501' });
    await expect(f.auth.query(insert, args)).rejects.toMatchObject({ code: '42501' });
    for (const statement of [
      'SELECT * FROM app.reply_quotation_binding',
      'UPDATE app.reply_quotation_binding SET reply_version=1 WHERE id=gen_random_uuid()',
      'DELETE FROM app.reply_quotation_binding WHERE id=gen_random_uuid()',
    ]) {
      await expect(f.auth.query(statement)).rejects.toMatchObject({ code: '42501' });
      if (!statement.startsWith('SELECT'))
        await expect(f.runtime.query(statement)).rejects.toMatchObject({ code: '42501' });
    }
    expect((await f.runtime.query('SELECT * FROM app.reply_quotation_binding')).rows).toEqual([]);
    for (const signature of [
      'app.bind_reply_quotation(uuid,uuid,integer,text)',
      'app.reply_quotation_prefill(uuid)',
    ]) {
      const privileges = (
        await f.owner.query(
          `SELECT has_function_privilege('corridra_runtime',$1,'EXECUTE') AS runtime,has_function_privilege('corridra_auth',$1,'EXECUTE') AS auth,
                  (SELECT bool_or(a.grantee=0) FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid=$1::regprocedure) AS everyone`,
          [signature],
        )
      ).rows[0];
      expect(privileges).toEqual({ runtime: true, auth: false, everyone: false });
    }
    await expect(
      f.auth.query('SELECT app.reply_quotation_prefill($1)', [randomUUID()]),
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      f.auth.query('SELECT app.bind_reply_quotation($1,$2,0,repeat($3,64))', [
        randomUUID(),
        randomUUID(),
        'a',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('installation on a database that already has answer correction, and on one that has neither module', () => {
  test('it installs after correction and still stops on a changed file; the file refuses to run without the review module', async () => {
    const other = await fixture('corridra_upgrade');
    try {
      const sql = await readFile(
        'packages/db/recipient-reply-review-migrations/0003_reply_quotation_binding.sql',
        'utf8',
      );
      await expect(other.owner.query(sql)).rejects.toThrow(
        'Reply quotation binding prerequisites are missing',
      );
      // Without the reply module, a reply-bound offer is unavailable, never recorded as a plain offer.
      const unavailable = new CommercialMissionService(other.runtime);
      const attempt = command('quotation', {
        missionId: randomUUID(),
        reason,
        sourceId: randomUUID(),
        claimId: randomUUID(),
        rfqId: randomUUID(),
        targetId: randomUUID(),
        revision: 1,
        currency: 'CNY',
        terms: { unitPriceMinor: '1' },
        uncertainties: 'Not recorded',
        observedAt: new Date().toISOString(),
        replyBinding: { responseId: randomUUID(), seen: 0, digest: 'a'.repeat(64) },
      });
      await expect(
        unavailable.command(other.users.operator.ctx, attempt, on),
      ).rejects.toMatchObject({
        status: 503,
        message: 'Reply binding is unavailable',
      });
      await expect(
        unavailable.replyPrefill(other.users.operator.ctx, randomUUID(), on),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        (await other.owner.query('SELECT count(*)::int n FROM app.mission_quotation')).rows[0].n,
      ).toBe(0);
      await migrateRecipientResponseRevision(other.owner);
      await migrateReplyReview(other.owner);
      const applied = (
        await other.owner.query(
          'SELECT * FROM recipient_reply_review_migrations.applied ORDER BY name',
        )
      ).rows;
      expect(applied).toHaveLength(3);
      await migrateReplyReview(other.owner);
      expect(
        (
          await other.owner.query(
            'SELECT * FROM recipient_reply_review_migrations.applied ORDER BY name',
          )
        ).rows,
      ).toEqual(applied);
      await other.owner.query(
        "UPDATE recipient_reply_review_migrations.applied SET sha256=repeat('1',64) WHERE name='0003_reply_quotation_binding.sql'",
      );
      await expect(migrateReplyReview(other.owner)).rejects.toThrow('history mismatch');
      expect(
        (
          await other.owner.query(
            "SELECT to_regprocedure('app.bind_reply_quotation(uuid,uuid,integer,text)') IS NOT NULL AS y",
          )
        ).rows[0].y,
      ).toBe(true);
    } finally {
      await other.close();
    }
  });
});

// ---- the reply is carried into the offer (answers that were never corrected) -------------------------------------------------

describe('a published reply, never corrected, is recorded as an offer', () => {
  test('the prefill gives the exact words and the command records the reply as the next revision with one binding', async () => {
    const r = await publishedReply();
    const prefill = await expectEligible(r.responseId);
    const said = await stated(r.responseId);
    expect(prefill).toMatchObject({
      responseId: r.responseId,
      seen: 0,
      digest: said.digest,
      missionId: r.j.t.missionId,
      rfqId: r.j.rfq.id,
      targetId: r.j.t.targetId,
      currency: 'CNY',
      uncertainties: 'Lead time depends on raw material delivery',
      observedAt: said.observedAt,
      sourceKind: 'SELF_DECLARATION',
      revision: 2,
      previousId: r.j.first.id,
    });
    // Exact strings: a 18 digit total, a zero amount and the nineteenth term name all come through untouched.
    expect(prefill.terms).toEqual(supplierTerms);
    expect(prefill.observedAt).toMatch(/\.\d{6}Z$/);
    const input = command('quotation', {
      missionId: prefill.missionId,
      reason,
      ...selfSource,
      rfqId: prefill.rfqId,
      targetId: prefill.targetId,
      revision: prefill.revision,
      previousId: prefill.previousId ?? undefined,
      currency: prefill.currency,
      terms: prefill.terms,
      uncertainties: prefill.uncertainties,
      observedAt: prefill.observedAt,
      replyBinding: { responseId: prefill.responseId, seen: prefill.seen, digest: prefill.digest },
    });
    const published = (
      await f.owner.query(
        "SELECT id FROM app.recipient_reply_review WHERE response_id=$1 AND decision='PUBLISH'",
        [r.responseId],
      )
    ).rows[0];
    const result = await commercial.command(f.ctx, input, on);
    expect(result).toEqual({ id: input.commandId });
    const offer = (
      await f.owner.query('SELECT * FROM app.mission_quotation WHERE id=$1', [input.commandId])
    ).rows[0];
    expect(offer).toMatchObject({
      revision: 2,
      previous_id: r.j.first.id,
      currency: 'CNY',
      created_by: f.users.operator.id,
    });
    expect(offer.terms).toEqual(supplierTerms);
    const [binding] = await bindingOf(r.responseId);
    expect(binding).toMatchObject({
      quotation_id: input.commandId,
      review_id: published.id,
      reply_version: 0,
      body_sha256: said.digest,
      mission_id: r.j.t.missionId,
      rfq_id: r.j.rfq.id,
      target_id: r.j.t.targetId,
      created_by: f.users.operator.id,
    });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.commercial_mission_command WHERE id=$1',
          [input.commandId],
        )
      ).rows[0].n,
    ).toBe(1);
    // A replay with the same command and values is the same answer and writes nothing; the prefill now says it is recorded.
    const before = await counts();
    expect(await commercial.command(f.ctx, input, on)).toEqual(result);
    expect(await commercial.command(f.ctx, input)).toEqual(result);
    expect(await counts()).toEqual(before);
    // The same command key with different values conflicts.
    await expect(
      commercial.command(f.ctx, { ...input, reason: 'A different reason entirely' }, on),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      commercial.command(f.ctx, { ...input, replyBinding: bindingFor(input, { seen: 1 }) }, on),
    ).rejects.toMatchObject({ status: 409 });
    expect(await counts()).toEqual(before);
    await expectReason(r.responseId, 'ALREADY_RECORDED');
    // The binding is immutable, even for the schema owner, and the team can read it.
    await expect(
      f.owner.query('UPDATE app.reply_quotation_binding SET reply_version=1'),
    ).rejects.toThrow('Immutable');
    await expect(f.owner.query('DELETE FROM app.reply_quotation_binding')).rejects.toThrow(
      'Immutable',
    );
    const read = await rawContext(
      f.runtime,
      f.users.operator.ctx,
      'SELECT id FROM app.reply_quotation_binding WHERE response_id=$1',
      [r.responseId],
    );
    expect(read.rows).toHaveLength(1);
  });

  test('a second offer for the same reply is refused, one confirmation at a time and when two race', async () => {
    const r = await publishedReply();
    const first = await offerFor(r);
    await commercial.command(f.ctx, first, on);
    const second = await offerFor(r);
    await refusedWith(second, 'This reply is already recorded as an offer', 409);
    expect((await bindingOf(r.responseId)).length).toBe(1);

    const racing = await publishedReply();
    const a = await offerFor(racing);
    // The second command is a correct next revision after the first (its id is the first offer's id), so only the reply is in the way.
    const b = await offerFor(racing, {}, selfSource, {
      revision:
        (
          await f.owner.query(
            'SELECT max(revision)::int n FROM app.mission_quotation WHERE rfq_id=$1 AND target_id=$2',
            [racing.j.rfq.id, racing.j.t.targetId],
          )
        ).rows[0].n + 2,
      previousId: a.commandId as string,
    });
    const settled = await Promise.allSettled([
      commercial.command(f.ctx, a, on),
      commercial.command(f.ctx, b, on),
    ]);
    expect(settled.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(settled[0].status).toBe('fulfilled');
    expect((await bindingOf(racing.responseId)).length).toBe(1);
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.mission_quotation WHERE rfq_id=$1 AND target_id=$2',
          [racing.j.rfq.id, racing.j.t.targetId],
        )
      ).rows[0].n,
    ).toBe(2);
    // The same command confirmed twice at once is one offer and one answer.
    const double = await publishedReply();
    const input = await offerFor(double);
    const both = await Promise.all([
      commercial.command(f.ctx, input, on),
      commercial.command(f.ctx, input, on),
    ]);
    expect(both[0]).toEqual(both[1]);
    expect((await bindingOf(double.responseId)).length).toBe(1);
  });

  test('events carry ids only, and nothing visible to a customer is written', async () => {
    const r = await publishedReply();
    const watched = [
      'delivery_publication',
      'delivery_experience_publication',
      'mission_selection',
      'buyer_response',
    ];
    const visible = async () => {
      const out: number[] = [];
      for (const table of watched)
        out.push((await f.owner.query(`SELECT count(*)::int n FROM app.${table}`)).rows[0].n);
      return out;
    };
    const before = await visible();
    const input = await offerFor(r);
    await commercial.command(f.ctx, input, on);
    expect(await visible()).toEqual(before);
    const [binding] = await bindingOf(r.responseId);
    const events = (
      await f.owner.query('SELECT payload FROM app.domain_event WHERE aggregate_id=$1', [
        binding.id,
      ])
    ).rows;
    expect(events).toHaveLength(1);
    // The generic event trigger adds its own fixed `revoked` flag; nothing from the reply or the digest is in it.
    expect(events[0].payload).toEqual({ id: binding.id, version: 1, revoked: false });
    const all = JSON.stringify((await f.owner.query('SELECT payload FROM app.domain_event')).rows);
    expect(all).not.toContain(binding.body_sha256);
    expect(all).not.toContain('Polyester');
    expect(all).not.toContain('900719925474099312');
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int n FROM app.outbox WHERE event_id IN (SELECT id FROM app.domain_event WHERE aggregate_id=$1)',
          [binding.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('every other reply is refused with a fixed message and leaves nothing behind', async () => {
    // No Publish at all, an Ask only, and a Reject.
    const open = await reply(await journey());
    await refusedWith(await offerFor(open), 'This reply has not been published', 409);
    await expectReason(open.responseId, 'NOT_PUBLISHED');
    const asked = await reply(await journey());
    await decide(asked.responseId, 'ASK');
    await refusedWith(await offerFor(asked), 'This reply has not been published', 409);
    await expectReason(asked.responseId, 'ASKED_ONLY');
    const rejected = await reply(await journey());
    await decide(rejected.responseId, 'REJECT');
    await refusedWith(await offerFor(rejected), 'This reply has not been published', 409);
    await expectReason(rejected.responseId, 'REJECTED');

    const r = await publishedReply();
    const good = await offerFor(r);
    const mismatch = 'Offer does not match the published reply';
    // A wrong digest, and a version the reviewer did not read.
    await refusedWith(
      { ...good, replyBinding: bindingFor(good, { digest: 'b'.repeat(64) }) },
      'Reply version changed; reload before confirming',
      409,
    );
    await refusedWith(
      { ...good, replyBinding: bindingFor(good, { seen: 1 }) },
      'Reply version changed; reload before confirming',
      409,
    );
    // Changed term, amount, added term, removed term, currency, uncertainties and statement time.
    const terms = (patch: Record<string, string | undefined>) =>
      Object.fromEntries(
        Object.entries({ ...supplierTerms, ...patch }).filter(([, v]) => v !== undefined),
      );
    await refusedWith({ ...good, terms: terms({ leadTime: '29 days from order' }) }, mismatch, 409);
    await refusedWith({ ...good, terms: terms({ unitPriceMinor: '1251' }) }, mismatch, 409);
    await refusedWith(
      { ...good, terms: terms({ warranty: 'Two years on all parts' }) },
      mismatch,
      409,
    );
    await refusedWith({ ...good, terms: terms({ moq: undefined }) }, mismatch, 409);
    await refusedWith({ ...good, currency: 'USD' }, mismatch, 409);
    await refusedWith(
      { ...good, uncertainties: 'Lead time depends on something else' },
      mismatch,
      409,
    );
    await refusedWith({ ...good, observedAt: new Date().toISOString() }, mismatch, 409);
    // A supplier statement cannot be recorded under an observation source.
    await refusedWith(
      { ...good, ...observedSource },
      'Offer source must be a self-declared source',
      409,
    );
    // A reply id that does not exist in this workspace, whatever workspace it might belong to, is one message.
    await refusedWith(
      { ...good, replyBinding: bindingFor(good, { responseId: randomUUID() }) },
      'Reply not found',
      404,
    );
    expect(await bindingOf(r.responseId)).toHaveLength(0);
    // And the unchanged offer still goes through afterwards: the refusals left no state behind.
    await commercial.command(f.ctx, good, on);
    expect(await bindingOf(r.responseId)).toHaveLength(1);
  });

  test('a reply carried into the wrong mission, RFQ or supplier is refused', async () => {
    const r = await publishedReply();
    const other = await journey();
    const wrongMission = await offerFor(r, {
      missionId: other.t.missionId,
      rfqId: other.rfq.id,
      targetId: other.t.targetId,
      revision: 2,
      previousId: other.first.id,
    });
    await refusedWith(wrongMission, 'Offer does not match the published reply', 409);
    // A second RFQ in the same mission for the same supplier.
    const second = await commercial.command(
      f.ctx,
      command('rfq', {
        ...r.j.base,
        requirementId: (
          await f.owner.query('SELECT id FROM app.mission_requirements WHERE mission_id=$1', [
            r.j.t.missionId,
          ])
        ).rows[0].id,
        targetIds: [r.j.t.targetId],
        buyerContext: 'A different explicitly shareable invented buying context',
        requestedTerms: 'Different unit price, quantity and delivery conditions',
        dueAt: future(),
      }),
    );
    const wrongRfq = await offerFor(r, { rfqId: second.id, revision: 1, previousId: undefined });
    await refusedWith(wrongRfq, 'Offer does not match the published reply', 409);
    // A second supplier in the same RFQ: the reply was sent to the first supplier only.
    const journeyTwo = await journey();
    const added = await addTarget(journeyTwo.t.missionId);
    const widened = await commercial.command(
      f.ctx,
      command('rfq', {
        ...journeyTwo.base,
        requirementId: (
          await f.owner.query('SELECT id FROM app.mission_requirements WHERE mission_id=$1', [
            journeyTwo.t.missionId,
          ])
        ).rows[0].id,
        targetIds: [journeyTwo.t.targetId, added.targetId],
        buyerContext: 'Explicitly shareable invented buying context for two suppliers',
        requestedTerms: 'Original unit price, quantity and delivery conditions',
        dueAt: future(),
      }),
    );
    const twoSuppliers = await reply(journeyTwo, { rfqId: widened.id });
    await decide(twoSuppliers.responseId, 'PUBLISH');
    const wrongSupplier = await offerFor(twoSuppliers, {
      rfqId: widened.id,
      targetId: added.targetId,
      revision: 1,
      previousId: undefined,
    });
    await refusedWith(wrongSupplier, 'Offer does not match the published reply', 409);
    // The reply's own supplier, in the same two-supplier RFQ, is accepted.
    await commercial.command(
      f.ctx,
      await offerFor(twoSuppliers, { rfqId: widened.id, revision: 1, previousId: undefined }),
      on,
    );
    expect(await bindingOf(twoSuppliers.responseId)).toHaveLength(1);
  });

  test('a reply bound offer needs the right role, an unrevoked member and a readable target', async () => {
    const r = await publishedReply();
    const good = await offerFor(r);
    for (const who of ['viewer', 'reviewer', 'other'] as const) {
      const before = await counts();
      const ctx =
        who === 'other' ? { ...f.users.other.ctx, tenantId: f.tenantA } : f.users[who].ctx;
      await expect(commercial.command(ctx, good, on)).rejects.toThrow();
      await expect(commercial.replyPrefill(ctx, r.responseId, on)).rejects.toThrow();
      expect(await counts()).toEqual(before);
    }
    // Calling the function directly, as a role that may not record offers, is refused inside the database too.
    await expect(
      rawContext(
        f.runtime,
        f.users.reviewer.ctx,
        'SELECT app.bind_reply_quotation($1,$2,0,repeat($3,64))',
        [good.commandId, r.responseId, 'a'],
      ),
    ).rejects.toMatchObject({ code: '42501', message: 'Access denied' });
    await expect(
      rawContext(
        f.runtime,
        f.users.operator.ctx,
        'SELECT app.bind_reply_quotation($1,$2,0,repeat($3,64))',
        [randomUUID(), r.responseId, 'a'],
      ),
    ).rejects.toMatchObject({ message: 'Offer must be recorded in this request' });
    // A member who loses the role, or is removed, can no longer carry the reply.
    await addAdmin(f.users.outsider.id);
    const admin = f.users.outsider.ctx;
    expect((await commercial.replyPrefill(admin, r.responseId, on)).eligible).toBe(true);
    await changeMemberNow(f.a, f.users.owner.ctx, {
      userId: f.users.outsider.id,
      role: 'viewer',
      revoked: false,
    });
    await expect(commercial.command(admin, await offerFor(r), on)).rejects.toThrow();
    await expect(commercial.replyPrefill(admin, r.responseId, on)).rejects.toThrow();
    await changeMemberNow(f.a, f.users.owner.ctx, {
      userId: f.users.outsider.id,
      role: 'viewer',
      revoked: true,
    });
    await expect(commercial.command(admin, await offerFor(r), on)).rejects.toThrow();
    // Losing access to the supplier hides the reply and refuses the offer.
    await rawContext(
      f.runtime,
      f.users.owner.ctx,
      'UPDATE app.relationship SET owner_id=$2 WHERE id=$1',
      [r.j.t.relationshipId, f.users.owner.id],
    );
    await expectReason(r.responseId, 'NOT_FOUND');
    const hidden = await counts();
    await expect(commercial.command(f.ctx, await offerFor(r), on)).rejects.toThrow();
    expect(await counts()).toEqual(hidden);
    await rawContext(
      f.runtime,
      f.users.owner.ctx,
      'UPDATE app.relationship SET owner_id=$2 WHERE id=$1',
      [r.j.t.relationshipId, f.users.operator.id],
    );
    expect((await prefillOf(r.responseId)).eligible).toBe(true);
    expect(await bindingOf(r.responseId)).toHaveLength(0);
  });

  test('the prefill checks authority before reading anything and shows no words when a reply cannot be carried', async () => {
    const queries: string[] = [];
    const watched = {
      connect: async () => {
        const client = await f.runtime.connect();
        return new Proxy(client, {
          get(target, key) {
            if (key === 'query')
              return (sql: unknown, ...rest: unknown[]) => {
                queries.push(typeof sql === 'string' ? sql : JSON.stringify(sql));
                return (target.query as (...args: unknown[]) => unknown)(sql, ...rest);
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    } as unknown as DatabasePool;
    const watching = new CommercialMissionService(watched);
    const r = await publishedReply();
    await expect(watching.replyPrefill(f.users.viewer.ctx, r.responseId, on)).rejects.toThrow();
    expect(
      queries.filter((q) =>
        /reply_quotation_prefill|to_regprocedure|recipient_detail_response/.test(q),
      ),
    ).toEqual([]);
    await watching.replyPrefill(f.ctx, r.responseId, on);
    expect(queries.some((q) => q.includes('reply_quotation_prefill'))).toBe(true);

    // Unknown, another workspace's and an unpublished reply all give a bare reason: no words, no ids, no terms.
    const unpublished = await reply(await journey());
    const bare = async (id: string, ctx = f.ctx) => {
      const result = await prefillOf(id, ctx);
      expect(Object.keys(result).sort()).toEqual(['eligible', 'reason']);
      expect(JSON.stringify(result)).not.toMatch(/Polyester|1250|CNY/);
      return result;
    };
    expect(await bare(randomUUID())).toEqual({ eligible: false, reason: 'NOT_FOUND' });
    expect(await bare(unpublished.responseId)).toEqual({
      eligible: false,
      reason: 'NOT_PUBLISHED',
    });
    // Another workspace's owner, signed in to their own workspace, cannot see this reply's existence.
    const elsewhere = await rawContext(
      f.runtime,
      f.users.other.ctx,
      'SELECT app.reply_quotation_prefill($1) AS prefill',
      [r.responseId],
    );
    expect(elsewhere.rows[0].prefill).toEqual({ eligible: false, reason: 'NOT_FOUND' });
    await expect(commercial.replyPrefill(f.ctx, 'not-a-uuid', on)).rejects.toThrow();
    // Retention ended: the reply is no longer readable or recordable.
    const expired = await publishedReply();
    await expireReply(expired.responseId);
    expect(await bare(expired.responseId)).toEqual({ eligible: false, reason: 'NOT_FOUND' });
    await refusedWith(await offerFor(expired), 'Reply not found', 404);
  });

  test('a reply with no offer, a currency off the route, terms that would be altered, a superseded requirement or a closed mission cannot be carried', async () => {
    const noOffer = await publishedReply({ quotation: null });
    await expectReason(noOffer.responseId, 'NO_QUOTATION');
    const usd = await publishedReply({ quotation: replyQuotation({ currency: 'EUR' }) });
    await expectReason(usd.responseId, 'CURRENCY_NOT_ON_ROUTE');
    for (const [patch, label] of [
      [{ leadTime: ' 30 days ' }, 'padded text'],
      [{ specification: 'ab' }, 'too short'],
      [{ unit: 'x'.repeat(81) }, 'unit too long'],
      [{ validUntil: '2027-03-31 00:00:00' }, 'no offset'],
    ] as const) {
      const odd = await publishedReply({
        quotation: replyQuotation({ terms: { ...supplierTerms, ...patch } }),
        exact: true,
      });
      await expectReason(odd.responseId, 'TERM_NOT_RECORDABLE');
      expect(label).toBeTruthy();
    }
    const padded = await publishedReply({
      quotation: replyQuotation({ uncertainties: ' padded ' }),
      exact: true,
    });
    await expectReason(padded.responseId, 'TERM_NOT_RECORDABLE');

    const superseded = await publishedReply();
    await commercial.command(f.ctx, {
      ...superseded.j.requirementInput,
      commandId: randomUUID(),
      version: 2,
    });
    await expectReason(superseded.responseId, 'REQUIREMENT_SUPERSEDED');
    await refusedWith(await offerFor(superseded), 'Current requirement version required');

    const closed = await publishedReply();
    const mission = (
      await f.owner.query('SELECT version FROM app.mission WHERE id=$1', [closed.j.t.missionId])
    ).rows[0];
    await f.mission.command(f.ctx, {
      id: closed.j.t.missionId,
      version: mission.version,
      commandId: randomUUID(),
      action: 'cancel',
      reason: 'The buyer withdrew the synthetic request',
      ownerId: f.users.operator.id,
      nextAction: 'Close out the synthetic mission',
      dueAt: future(),
      marketCode: 'ES',
      targetProfile: 'Synthetic hotel distributor profile',
    });
    await expectReason(closed.responseId, 'MISSION_CLOSED');
    await refusedWith(await offerFor(closed), 'Current mission required');
  });

  test('pausing reply review stops the binding and the prefill says so; opening it again restores both', async () => {
    const r = await publishedReply();
    await setReview(false);
    try {
      await expectReason(r.responseId, 'REVIEW_CLOSED');
      await refusedWith(await offerFor(r), 'Reply review is not open', 409);
    } finally {
      await setReview(true);
    }
    await commercial.command(f.ctx, await offerFor(r), on);
    expect(await bindingOf(r.responseId)).toHaveLength(1);
  });

  test('a reply bound offer is refused, not recorded plain, when the switch option is off', async () => {
    const r = await publishedReply();
    const input = await offerFor(r);
    const before = await counts();
    await expect(commercial.command(f.ctx, input)).rejects.toMatchObject({
      status: 503,
      message: 'Reply binding is unavailable',
    });
    await expect(commercial.command(f.ctx, input, { replyBinding: false })).rejects.toMatchObject({
      status: 503,
    });
    await expect(commercial.replyPrefill(f.ctx, r.responseId)).rejects.toMatchObject({
      status: 503,
    });
    expect(await counts()).toEqual(before);
    // The plain offer path does not change: no reply field, no option.
    const plain = await offerFor(r, { replyBinding: undefined });
    await commercial.command(f.ctx, plain);
    expect(await bindingOf(r.responseId)).toHaveLength(0);
  });

  test('the lock order holds: a held reply lock makes the confirmation wait, and a correction racing it cannot deadlock', async () => {
    const r = await publishedReply();
    const input = await offerFor(r);
    const holder = await f.owner.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        lockKey(f.tenantA, r.responseId),
      ]);
      const racing = commercial.command(f.ctx, input, on);
      let settled = false;
      racing.then(
        () => (settled = true),
        () => (settled = true),
      );
      const waiting = async () =>
        (
          await f.owner.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND wait_event='advisory' AND query LIKE '%bind_reply_quotation%'",
          )
        ).rows[0].n;
      for (let i = 0; i < 100 && (await waiting()) === 0; i++)
        await new Promise((done) => setTimeout(done, 50));
      expect(await waiting()).toBe(1);
      expect(settled).toBe(false);
      await holder.query('COMMIT');
      expect(await racing).toEqual({ id: input.commandId });
    } finally {
      holder.release();
    }
    expect(await bindingOf(r.responseId)).toHaveLength(1);
  });
});

// ---- answers that were corrected before they were published -----------------------------------------------------------------

describe('with answer correction installed', () => {
  beforeAll(async () => {
    await migrateRecipientResponseRevision(f.owner);
    await configureRecipientRevision(f.owner, { enabled: true, reason: revisionReason });
  });
  const corrected = async () => {
    const r = await reply(await journey());
    await decide(r.responseId, 'ASK');
    expect(await f.communications.buyer(revision(r.token, 0))).toMatchObject({
      recorded: true,
      version: 1,
    });
    await decide(r.responseId, 'PUBLISH', 1);
    return r;
  };

  test('a corrected then published reply is carried at version 1 with the correction time and digest', async () => {
    const r = await corrected();
    const prefill = await expectEligible(r.responseId);
    const said = await stated(r.responseId);
    expect(prefill).toMatchObject({ seen: 1, digest: said.digest, observedAt: said.observedAt });
    expect(prefill.terms.unitPriceMinor).toBe('1300');
    expect(prefill.uncertainties).toBe('Validity still not known');
    const input = await offerFor(r);
    await commercial.command(f.ctx, input, on);
    const [binding] = await bindingOf(r.responseId);
    expect(binding).toMatchObject({ reply_version: 1, body_sha256: said.digest });
    // The original answer, the first version, cannot be carried in its place.
    const original = await corrected();
    const old = await offerFor(original);
    await refusedWith(
      {
        ...old,
        terms: supplierTerms,
        uncertainties: 'Lead time depends on raw material delivery',
        replyBinding: bindingFor(old, { seen: 0 }),
      },
      'Reply version changed; reload before confirming',
      409,
    );
    const v0 = sha(
      (
        await f.owner.query('SELECT body::text t FROM app.recipient_detail_response WHERE id=$1', [
          original.responseId,
        ])
      ).rows[0].t,
    );
    await refusedWith(
      { ...old, replyBinding: bindingFor(old, { digest: v0 }) },
      'Reply version changed; reload before confirming',
      409,
    );
  });

  test('an answer that was never corrected can still be carried once the module is installed', async () => {
    const r = await publishedReply();
    expect(await expectEligible(r.responseId)).toMatchObject({ seen: 0 });
    await commercial.command(f.ctx, await offerFor(r), on);
    expect((await bindingOf(r.responseId))[0]).toMatchObject({ reply_version: 0 });
  });

  test('a correction written after the Publish row is refused by the binding even with a matching digest', async () => {
    const r = await corrected();
    await f.owner.query(
      "INSERT INTO app.recipient_detail_response_revision(id,tenant_id,response_id,link_id,version,body,retention_until,created_by) SELECT $1,tenant_id,id,link_id,2,jsonb_set(body,'{body}','\"Later words that nobody reviewed\"'),retention_until,created_by FROM app.recipient_detail_response WHERE id=$2",
      [randomUUID(), r.responseId],
    );
    const said = await stated(r.responseId);
    expect(said.seen).toBe(2);
    await refusedWith(await offerFor(r), 'This reply changed after it was published', 409);
  });

  test('a correction racing a confirmation cannot deadlock and cannot change what was confirmed', async () => {
    const r = await corrected();
    const input = await offerFor(r);
    const holder = await f.owner.connect();
    let late: PromiseSettledResult<unknown>, bound: PromiseSettledResult<unknown>;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        lockKey(f.tenantA, r.responseId),
      ]);
      const confirming = commercial.command(f.ctx, input, on);
      const correcting = f.communications.buyer(revision(r.token, 1));
      await new Promise((done) => setTimeout(done, 400));
      await holder.query('COMMIT');
      [bound, late] = await Promise.allSettled([confirming, correcting]);
    } finally {
      holder.release();
    }
    expect(bound.status).toBe('fulfilled');
    expect(late.status).toBe('rejected');
    expect(String((late as PromiseRejectedResult).reason?.code)).not.toBe('40P01');
    expect((await bindingOf(r.responseId))[0]).toMatchObject({ reply_version: 1 });
  });
});

// ---- the routes ---------------------------------------------------------------------------------------------------------------

describe('the workspace route', () => {
  const url = (action: string, extra = '') =>
    `https://app.corridra.test/api/workspace/${action}?tenant=${f.tenantA}${extra}`;
  const get = async (action: string, extra: string) => {
    const { GET } = await import('../../apps/web/app/api/workspace/[action]/route');
    return GET(new Request(url(action, extra)), { params: Promise.resolve({ action }) });
  };
  const post = async (action: string, body: unknown) => {
    const { POST } = await import('../../apps/web/app/api/workspace/[action]/route');
    return POST(
      new Request(url(action), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://app.corridra.test' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ action }) },
    );
  };
  beforeEach(() => {
    session.mockResolvedValue({ token: f.users.operator.token });
  });
  // Restore the environment even when an assertion fails, so a switch value never leaks into a later test.
  afterEach(() => {
    vi.unstubAllEnvs();
    session.mockResolvedValue({ token: f.users.operator.token });
  });

  test('the reply read and the bound offer are unavailable until the switch is on, then work and stay private', async () => {
    const r = await publishedReply();
    vi.stubEnv('CORRIDRA_REPLY_PAGE', 'false');
    const off = await get('reply-quotation-prefill', `&reply=${r.responseId}`);
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ error: 'Reply binding is unavailable' });
    const input = await offerFor(r);
    const refused = await post('commercial-mission', input);
    expect(refused.status).toBe(503);
    expect(await bindingOf(r.responseId)).toHaveLength(0);
    vi.stubEnv('CORRIDRA_REPLY_PAGE', 'true');
    const read = await get('reply-quotation-prefill', `&reply=${r.responseId}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(await read.json()).toMatchObject({ eligible: true, responseId: r.responseId });
    expect((await get('reply-quotation-prefill', '&reply=not-a-uuid')).status).toBe(400);
    session.mockResolvedValue(null);
    expect((await get('reply-quotation-prefill', `&reply=${r.responseId}`)).status).toBe(401);
    session.mockResolvedValue({ token: f.users.operator.token });
    const stale = await post('commercial-mission', {
      ...input,
      replyBinding: bindingFor(input, { digest: 'c'.repeat(64) }),
    });
    expect(stale.status).toBe(409);
    const refusal = JSON.stringify(await stale.json());
    expect(refusal).toContain('Reply version changed; reload before confirming');
    expect(refusal).not.toMatch(/Polyester|1250|c{20}/);
    const created = await post('commercial-mission', input);
    expect(created.status).toBe(201);
    expect(await bindingOf(r.responseId)).toHaveLength(1);
    const again = await post('commercial-mission', input);
    expect(again.status).toBe(201);
  });

  test('a plain offer through the route is unchanged and records no binding while the switch is off', async () => {
    const r = await publishedReply();
    const plain = await offerFor(r, { replyBinding: undefined });
    vi.stubEnv('CORRIDRA_REPLY_PAGE', 'false');
    expect((await post('commercial-mission', plain)).status).toBe(201);
    expect(await bindingOf(r.responseId)).toHaveLength(0);
  });
});
