import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { accessFixture } from './access-fixture';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { command, future } from './access-fixture';
import { rawContext } from './support';
import { DeliveryService } from '../../packages/delivery/src/index';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { intakeTemplate, parseImport } from '../../packages/delivery/src/import';
import { reportPdf, reportCsv, type DeliveryReport } from '../../packages/delivery/src/report';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { displayMoney, displayDate, originalAmountToMinor } from '../../packages/domain/src/locale';
import { briefSchema } from '../../packages/domain/src/missions';
import { migrate } from '../../packages/db/src/migrate';
import { buildReplyTerms, replyTermKeys, noCharge } from '../../apps/web/lib/reply-terms';
import { ReplyReviewService } from '../../packages/delivery/src/reply-review';
import { migrateReplyReview } from '../../packages/db/src/recipient-reply-review-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';
import { getTeamToday } from '../../packages/auth/src/team-today';
import { configureRecipientRevision } from '../../packages/delivery/src/recipient-revision-configuration';
import { configureReplyReview } from '../../packages/delivery/src/reply-review-configuration';
const account = vi.hoisted(() => ({ session: null as unknown, services: null as unknown }));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({ getSession: async () => account.session }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => account.services }));
import { POST as customerPost } from '../../apps/web/app/api/customer-missions/route';
import { changeMemberNow } from './change-member';
let f: Awaited<ReturnType<typeof commercialFixture>>,
  delivery: DeliveryService,
  experience: DeliveryExperienceService,
  routes: CorridorService,
  commercial: CommercialMissionService;
const reason = 'Synthetic Part 3 permission and experience validation';
beforeAll(async () => {
  f = await commercialFixture();
  delivery = new DeliveryService(f.runtime, f.mission, 'part03-delivery-test-secret');
  experience = new DeliveryExperienceService(f.runtime);
  routes = new CorridorService(f.runtime);
  commercial = new CommercialMissionService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  vi.stubEnv('CORRIDRA_DELIVERY_ENABLED', 'true');
  account.services = {
    delivery,
    ready: Promise.resolve(),
    config: { APP_ORIGIN: 'https://corridra.example.invalid' },
  };
});
afterAll(async () => {
  await f?.close();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  account.session = {
    data: {
      user: {
        id: 'a-separate-managed-customer',
        email: 'owner@example.invalid',
        emailVerified: true,
      },
    },
    error: null,
  };
});
async function publication(
  missionId: string,
  title = 'Approved participant mission',
  meetings: { id: string; version: number; label: string }[] = [],
) {
  return delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId,
    title,
    company: 'Synthetic Company',
    objective: 'Review a source-reported commercial requirement',
    brief: 'Approved synthetic context. No private contact or relationship owner is disclosed.',
    nextAction: 'Review the explicitly scoped mission detail',
    dueAt: future(),
    meetings,
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
}
async function share(publicationId: string) {
  return delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publicationId],
    audience: 'CLIENT_PROGRESS',
    purpose: reason,
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
}
async function sourceJourney(expiresInSeconds?: number) {
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
    a = cat.assessments.find((r) => r.schema.typeKey === 'sourcing')!,
    type = cat.types.find((r) => r.key === 'sourcing')!;
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
      missionTypes: ['sourcing'],
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
  const source = expiresInSeconds
      ? await f.evidence.createSource(f.ctx, {
          kind: 'observation',
          locator: 'Invented expiring Part 3 source',
          observedAt: new Date(Date.now() - 1000).toISOString(),
          classification: 'INTERNAL',
          purpose: 'synthetic_validation',
          retentionUntil: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
          aiPolicy: 'DENY',
        })
      : await f.source(),
    claim = await f.evidence.createClaim(f.ctx, {
      sourceId: source.id,
      statement: 'Invented original sourcing requirement and quotation declaration',
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
        objective: 'Find suitable machinery components',
        role: 'IMPORTER',
        product: '原始机械部件',
        quantity: '100',
        unit: 'pieces',
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
  const q = await commercial.command(
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
  return { t, r, rfq, q, source, base };
}
async function programme() {
  const p = await delivery.programme(f.ctx, {
    commandId: randomUUID(),
    name: 'Synthetic China delegation',
    reportingPurpose: reason,
  });
  const rows = intakeTemplate().split('\r\n');
  const csv = `${rows[0]}\r\n${rows[1]}\r\n${rows[1].replace('participant-001', 'participant-002').replace('participant@example.invalid', 'participant2@example.invalid')}\r\n`;
  const preview = await delivery.preview(f.ctx, p.id, randomUUID(), Buffer.from(csv), 'CSV');
  const accepted = await delivery.confirm(f.ctx, {
    commandId: randomUUID(),
    importId: preview.id,
    ownerId: f.users.operator.id,
    counts: preview.counts,
    acknowledged: true,
  });
  return {
    p,
    accepted,
    participants: (await delivery.workspace(f.users.owner.ctx, p.id)).participants,
  };
}

test('locale formatting preserves original minor units, large amounts, negative zero fractions and registered precision', () => {
  expect(originalAmountToMinor('1.234', 'BHD')).toBe('1234');
  expect(originalAmountToMinor('9007199254740993.12', 'USD')).toBe('900719925474099312');
  expect(() => originalAmountToMinor('1.234', 'CNY')).toThrow();
  expect(displayMoney('1200', 'CNY')).toContain('12.00');
  expect(displayMoney('1200', 'JPY')).toContain('1,200');
  expect(displayMoney('1234', 'BHD')).toContain('1.234');
  expect(displayMoney('900719925474099312', 'USD')).toContain('9,007,199,254,740,993.12');
  expect(displayMoney('-1', 'USD')).toContain('-');
  expect(displayMoney('1234', 'BHD', 'bn-BD')).toContain('১.২৩৪');
  expect(() => displayMoney('12.3', 'CNY')).toThrow();
  expect(() => displayMoney('1200', 'OTHER')).toThrow();
  expect(() => displayDate('invalid')).toThrow();
  expect(displayDate('2026-11-01T10:00:00Z', 'Asia/Shanghai')).toContain('Asia/Shanghai');
});

test('adaptive short briefs retain Chinese original text, explicit country/job and synthetic admission controls', async () => {
  const input = {
    objective: 'Source suppliers',
    market: 'China',
    attendance: 'No',
    startDate: '',
    endDate: '',
    timezone: 'Asia/Shanghai',
    offer: '原始机械部件的采购需求',
    website: '',
    outcomes: ['Supplier visits'],
    notes: '',
    name: 'Synthetic participant',
    company: 'Synthetic Company',
    email: 'brief@example.invalid',
    acknowledged: true,
    experience: {
      schemaVersion: 1,
      companyCountry: 'BD',
      marketCode: 'CN',
      job: 'machinery_procurement',
      requirements: {
        objective: 'Evaluate equipment suitability',
        role: 'BUYER',
        product: '原始机械部件',
        machinery: { application: 'Synthetic production requirement' },
        budgetMinor: '1234',
        currency: 'BHD',
        budgetBasis: 'Original equipment budget',
      },
    },
  };
  expect(briefSchema.parse(input).experience?.requirements.product).toBe('原始机械部件');
  const saved = await f.mission.submit(randomUUID(), input);
  const stored = (
    await f.owner.query('SELECT brief FROM app.mission_intake WHERE id=$1', [saved.id])
  ).rows[0].brief;
  expect(stored.experience.marketCode).toBe('CN');
  expect(stored.experience.requirements.budgetMinor).toBe('1234');
  await expect(
    f.mission.submit(randomUUID(), { ...input, email: 'real@example.com' }),
  ).rejects.toThrow();
  expect(() =>
    briefSchema.parse({ ...input, experience: { ...input.experience, companyCountry: 'EU' } }),
  ).toThrow();
  const key = randomUUID();
  await expect(
    f.runtime.query('SELECT app.submit_mission($1,$2,$3,$4::jsonb,$5)', [
      key,
      'a'.repeat(64),
      'b'.repeat(64),
      JSON.stringify({ ...input, experience: { ...input.experience, schemaVersion: 99 } }),
      'synthetic-intake-2026-10-05-v1',
    ]),
  ).rejects.toThrow();
  const csv = intakeTemplate().split('\r\n');
  const global = await parseImport(
    Buffer.from(`${csv[0]}\r\n${csv[1]},BD,CN,machinery_procurement\r\n`),
    'CSV',
  );
  expect(global[0].brief?.experience?.marketCode).toBe('CN');
});

test('supplier disclosure and declaration reuse expiring recipient capability without leaking contacts or conferring authority', async () => {
  const j = await sourceJourney(),
    intro = await f.introduction(j.t);
  const disclosure = {
    commandId: randomUUID(),
    linkId: intro.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: j.rfq.id,
    allowQuotation: true,
    allowMeetingInterest: true,
    approved: true,
    reason,
  };
  await expect(experience.disclosure(f.ctx, disclosure)).rejects.toThrow();
  await experience.disclosure(f.users.owner.ctx, disclosure);
  await experience.disclosure(f.users.owner.ctx, disclosure);
  const view = await f.communications.buyer({ action: 'read', token: intro.token });
  expect(view.role).toBe('SUPPLIER');
  expect(view.sharedRequirements).toBe(disclosure.sharedRequirements);
  const text = JSON.stringify(view);
  expect(text).not.toContain('Private negotiation');
  expect(text).not.toContain('@example.invalid');
  expect(text).not.toContain(j.q.id);
  const reply = {
    action: 'detail-response',
    token: intro.token,
    responseId: randomUUID(),
    body: '原始供应商答复：请确认技术参数。',
    meetingInterest: true,
    quotation: {
      currency: 'CNY',
      terms: { unitPriceMinor: '1200' },
      uncertainties: 'Shipping and acceptance conditions not supplied',
    },
    acknowledged: true,
  };
  expect(await f.communications.buyer(reply)).toMatchObject({
    recorded: true,
    sourceKind: 'SELF_DECLARATION',
  });
  expect(await f.communications.buyer(reply)).toMatchObject({ recorded: true });
  await expect(f.communications.buyer({ ...reply, body: 'Changed later' })).rejects.toThrow();
  expect(
    (await experience.workspace(f.users.owner.ctx)).responses.some((r) => r.link_id === intro.id),
  ).toBe(true);
  expect(
    (
      await f.owner.query('SELECT count(*)::int n FROM app.mission_quotation WHERE mission_id=$1', [
        j.t.missionId,
      ])
    ).rows[0].n,
  ).toBe(1);
  await f.communications.command(f.ctx, command('revoke', { linkId: intro.id, reason }));
  await expect(f.communications.buyer({ action: 'read', token: intro.token })).rejects.toThrow();
  await expect(f.communications.buyer(reply)).rejects.toThrow();
});

test('the Reply Page form sends all eighteen terms the database function accepts, leaves blanks out, and records exactly what was typed', async () => {
  const j = await sourceJourney(),
    intro = await f.introduction(j.t);
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: intro.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: j.rfq.id,
    allowQuotation: true,
    allowMeetingInterest: true,
    approved: true,
    reason,
  });
  const built = buildReplyTerms(
    {
      specification: 'Polyester curtain track, 4 m, white',
      quantity: '1200',
      moq: '200',
      unit: 'pieces',
      unitPriceMinor: '12.50',
      totalPriceMinor: '15000',
      toolingMinor: noCharge,
      setupMinor: '300',
      packagingMinor: '45.5',
      leadTime: '6 weeks after the deposit',
      validUntil: '2099-12-31',
      incoterm: 'FOB',
      paymentTerms: '30 percent deposit, balance before shipping',
      shipping: 'EXCLUDED',
      warranty: 'Two years on parts',
      installation: 'Not included',
      training: 'One day on site',
      spares: 'Ten percent spare parts shipped free',
    },
    'USD',
  );
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(Object.keys(built.terms).sort()).toEqual([...replyTermKeys].sort());
  const reply = {
    action: 'detail-response',
    token: intro.token,
    responseId: randomUUID(),
    body: '您好，附上我们的报价。',
    meetingInterest: false,
    quotation: { currency: 'USD', terms: built.terms, uncertainties: 'Freight is not yet known' },
    acknowledged: true,
  };
  expect(await f.communications.buyer(reply)).toMatchObject({
    recorded: true,
    sourceKind: 'SELF_DECLARATION',
  });
  const stored = (
    await f.owner.query('SELECT body FROM app.recipient_detail_response WHERE link_id=$1', [
      intro.id,
    ])
  ).rows[0].body;
  expect(stored).toEqual({
    body: reply.body,
    meetingInterest: false,
    quotation: reply.quotation,
    acknowledged: true,
  });
  // A blank stays out of the record: nothing is stored as zero.
  expect(stored.quotation.terms.warrantyMinor).toBeUndefined();
  // A term the form does not offer is still refused.
  const other = await sourceJourney(),
    link = await f.introduction(other.t);
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: other.rfq.id,
    allowQuotation: true,
    allowMeetingInterest: true,
    approved: true,
    reason,
  });
  await expect(
    f.communications.buyer({
      ...reply,
      token: link.token,
      responseId: randomUUID(),
      quotation: {
        currency: 'USD',
        terms: { discount: '5' },
        uncertainties: 'Freight is not yet known',
      },
    }),
  ).rejects.toThrow();
});

// Reply review (ADR-069): the Corridra team's append-only decision about one supplier reply.
async function replyFor() {
  const j = await sourceJourney(),
    link = await f.introduction(j.t);
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: j.rfq.id,
    allowQuotation: true,
    allowMeetingInterest: false,
    approved: true,
    reason,
  });
  const responseId = randomUUID();
  await f.communications.buyer({
    action: 'detail-response',
    token: link.token,
    responseId,
    body: 'Original supplier reply, quote follows.',
    meetingInterest: false,
    quotation: {
      currency: 'USD',
      terms: { specification: 'Polyester curtain track', unitPriceMinor: '1250' },
      uncertainties: 'Lead time and validity not yet known',
    },
    acknowledged: true,
  });
  return { linkId: link.id, responseId };
}
const reviewReason = 'Owner approved reply review for the local fixture tests';
const ask = (responseId: string, commandId = randomUUID()) => ({
  commandId,
  responseId,
  decision: 'ASK' as const,
  askTerms: ['leadTime', 'validUntil'],
  note: 'Please state the lead time and how long the quote is valid',
});

test('reply review installs additively and closed, and the staff function refuses until the owner opens it', async () => {
  const reviews = new ReplyReviewService(f.runtime);
  const snapshot = async () =>
    (
      await f.owner.query(
        `SELECT 'f' AS k,p.oid::int AS oid,pg_get_functiondef(p.oid) AS def,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity')
         UNION ALL SELECT 't',c.oid::int,coalesce((SELECT string_agg(pg_get_expr(po.polqual,po.polrelid)||po.polname,'|' ORDER BY po.polname) FROM pg_policy po WHERE po.polrelid=c.oid),''),c.relacl::text||c.relrowsecurity::text
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity') ORDER BY 1,2`,
      )
    ).rows;
  // Its one dependency (the real-use functions the policy pair names) is installed first, as the install job does.
  await migrateCustomerRealUse(f.owner);
  const before = await snapshot();
  await migrateReplyReview(f.owner);
  const after = await snapshot();
  const known = new Set(before.map((r) => `${r.k}${r.oid}`));
  expect(after.filter((r) => known.has(`${r.k}${r.oid}`))).toEqual(before);
  expect(after.length).toBeGreaterThan(before.length);
  const once = (await f.owner.query('SELECT * FROM recipient_reply_review_migrations.applied'))
    .rows;
  expect(once).toHaveLength(1);
  await migrateReplyReview(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM recipient_reply_review_migrations.applied')).rows,
  ).toEqual(once);
  await f.owner.query("UPDATE recipient_reply_review_migrations.applied SET sha256=repeat('0',64)");
  await expect(migrateReplyReview(f.owner)).rejects.toThrow('history mismatch');
  await f.owner.query('UPDATE recipient_reply_review_migrations.applied SET sha256=$1', [
    once[0].sha256,
  ]);

  const r = await replyFor();
  expect((await f.runtime.query('SELECT app.reply_review_status() AS open')).rows[0].open).toBe(
    false,
  );
  expect(await reviews.list(f.users.owner.ctx)).toEqual({ open: false, reviews: [] });
  await expect(reviews.review(f.users.owner.ctx, ask(r.responseId))).rejects.toMatchObject({
    code: '42501',
  });
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.recipient_reply_review')).rows[0].n,
  ).toBe(0);
});

test('reply review is configured only by the offline owner, and runtime and auth roles cannot touch its tables', async () => {
  await expect(
    configureReplyReview(f.runtime, { enabled: true, reason: reviewReason }),
  ).rejects.toThrow();
  await expect(
    configureReplyReview(f.auth, { enabled: true, reason: reviewReason }),
  ).rejects.toThrow();
  await expect(configureReplyReview(f.owner, { enabled: true, reason: 'short' })).rejects.toThrow();
  expect(await configureReplyReview(f.owner, { enabled: false, reason: reviewReason })).toEqual({
    enabled: false,
    changed: false,
  });
  expect(await configureReplyReview(f.owner, { enabled: true, reason: reviewReason })).toEqual({
    enabled: true,
    changed: true,
  });
  expect(await configureReplyReview(f.owner, { enabled: true, reason: reviewReason })).toEqual({
    enabled: true,
    changed: false,
  });
  await expect(
    f.owner.query('UPDATE app.reply_review_control SET enabled=false'),
  ).rejects.toThrow();
  for (const pool of [f.runtime, f.auth]) {
    await expect(pool.query('SELECT * FROM app.reply_review_control')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(pool.query('SELECT app.reply_review_open()')).rejects.toMatchObject({
      code: '42501',
    });
  }
  await expect(f.auth.query('SELECT * FROM app.recipient_reply_review')).rejects.toMatchObject({
    code: '42501',
  });
  // The team may read reviews through its own session, but no role can write one directly.
  await expect(
    f.runtime.query(
      "INSERT INTO app.recipient_reply_review(tenant_id,response_id,command_id,decision,reviewed_by) VALUES($1,$2,$3,'PUBLISH',$4)",
      [f.tenantA, randomUUID(), randomUUID(), f.users.owner.id],
    ),
  ).rejects.toMatchObject({ code: '42501' });
});

test('an owner can ask, then publish; publish and reject are final; a replay is safe and a reused key conflicts', async () => {
  const reviews = new ReplyReviewService(f.runtime);
  const r = await replyFor();
  const first = ask(r.responseId);
  const recorded = await reviews.review(f.users.owner.ctx, first);
  expect(recorded).toMatchObject({ replayed: false });
  expect(await reviews.review(f.users.owner.ctx, first)).toEqual({
    id: recorded.id,
    replayed: true,
  });
  await expect(
    reviews.review(f.users.owner.ctx, { ...first, askTerms: ['unit'] }),
  ).rejects.toMatchObject({ code: '23514' });
  // An ask keeps the reply open; asking again and then publishing both work.
  await reviews.review(f.users.owner.ctx, ask(r.responseId));
  const published = await reviews.review(f.users.owner.ctx, {
    commandId: randomUUID(),
    responseId: r.responseId,
    decision: 'PUBLISH',
  });
  expect(published.replayed).toBe(false);
  for (const attempt of [
    { commandId: randomUUID(), responseId: r.responseId, decision: 'PUBLISH' },
    {
      commandId: randomUUID(),
      responseId: r.responseId,
      decision: 'REJECT',
      reasonCode: 'OTHER',
      note: 'Changed my mind',
    },
    ask(r.responseId),
  ])
    await expect(reviews.review(f.users.owner.ctx, attempt)).rejects.toMatchObject({
      code: '23514',
    });
  const list = await reviews.list(f.users.owner.ctx);
  expect(list.open).toBe(true);
  expect(list.reviews.filter((x) => x.responseId === r.responseId).map((x) => x.decision)).toEqual([
    'ASK',
    'ASK',
    'PUBLISH',
  ]);
  const second = await replyFor();
  await reviews.review(f.users.owner.ctx, {
    commandId: randomUUID(),
    responseId: second.responseId,
    decision: 'REJECT',
    reasonCode: 'NOT_A_FIT',
  });
  await expect(
    reviews.review(f.users.owner.ctx, {
      commandId: randomUUID(),
      responseId: second.responseId,
      decision: 'PUBLISH',
    }),
  ).rejects.toMatchObject({ code: '23514' });
  // The database refuses what the schema would also refuse, even when called straight.
  await expect(
    reviews.review(f.users.owner.ctx, {
      commandId: randomUUID(),
      responseId: second.responseId,
      decision: 'REJECT',
    } as never),
  ).rejects.toBeTruthy();
});

test('only an owner or admin with a fresh authenticator check, in the workspace that holds the reply, can review', async () => {
  const reviews = new ReplyReviewService(f.runtime);
  const r = await replyFor();
  const decision = () => ({
    commandId: randomUUID(),
    responseId: r.responseId,
    decision: 'PUBLISH' as const,
  });
  // Operators, reviewers and viewers read but never review (the permission is refused before the database).
  for (const who of [f.users.operator, f.users.reviewer, f.users.viewer])
    await expect(reviews.review(who.ctx, decision())).rejects.toBeTruthy();
  // Another workspace's owner cannot see or review this reply.
  await expect(reviews.review(f.users.other.ctx, decision())).rejects.toBeTruthy();
  expect((await reviews.list(f.users.other.ctx)).reviews).toEqual([]);
  // A stale authenticator check is refused, in the service and in the database.
  await f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '6 minutes' WHERE session_id=$1",
    [f.users.owner.sessionId],
  );
  try {
    await expect(reviews.review(f.users.owner.ctx, decision())).rejects.toMatchObject({
      status: 401,
    });
  } finally {
    await f.owner.query('UPDATE identity.assurance SET verified_at=now() WHERE session_id=$1', [
      f.users.owner.sessionId,
    ]);
  }
  // A reply that does not exist, or that belongs to another workspace, is not found.
  await expect(
    reviews.review(f.users.owner.ctx, {
      commandId: randomUUID(),
      responseId: randomUUID(),
      decision: 'PUBLISH',
    }),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.recipient_reply_review WHERE response_id=$1',
        [r.responseId],
      )
    ).rows[0].n,
  ).toBe(0);
});

test('reviews are append only and their events hold the decision and the reason, never the words', async () => {
  const reviews = new ReplyReviewService(f.runtime);
  const r = await replyFor();
  const note = 'Private note about the supplier price';
  const saved = await reviews.review(f.users.owner.ctx, {
    commandId: randomUUID(),
    responseId: r.responseId,
    decision: 'REJECT',
    reasonCode: 'PRICE_NOT_CREDIBLE',
    note,
  });
  await expect(
    f.owner.query("UPDATE app.recipient_reply_review SET decision='PUBLISH' WHERE id=$1", [
      saved.id,
    ]),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM app.recipient_reply_review WHERE id=$1', [saved.id]),
  ).rejects.toThrow();
  const events = (
    await f.owner.query('SELECT payload FROM app.domain_event WHERE aggregate_id=$1', [saved.id])
  ).rows;
  expect(events.length).toBeGreaterThan(0);
  expect(JSON.stringify(events)).not.toContain(note);
  expect(JSON.stringify(events)).not.toContain('Polyester');
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.audit_event WHERE action='recipient_reply.reject'",
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
  // The reply itself is unchanged: review reads it and writes nothing to it.
  const stored = (
    await f.owner.query('SELECT body FROM app.recipient_detail_response WHERE id=$1', [
      r.responseId,
    ])
  ).rows[0].body;
  expect(stored.body).toBe('Original supplier reply, quote follows.');
});

test('client publication exposes only selected records; a matching account email grants no private mission', async () => {
  const j = await sourceJourney(),
    other = await sourceJourney(),
    p = await publication(j.t.missionId),
    l = await share(p.id);
  const input = {
    commandId: randomUUID(),
    publicationId: p.id,
    requirementId: j.r.id,
    targetIds: [j.t.targetId],
    quotationIds: [j.q.id],
    agendaItemIds: [],
    approved: true,
    reason,
  };
  await expect(
    experience.publication(f.users.owner.ctx, { ...input, quotationIds: [other.q.id] }),
  ).rejects.toThrow();
  await expect(experience.publication(f.ctx, input)).rejects.toThrow();
  await experience.publication(f.users.owner.ctx, input);
  const report = (await delivery.external({
    action: 'view',
    token: l.token,
    audience: 'CLIENT_PROGRESS',
  })) as DeliveryReport;
  expect(report.missions[0].experience?.quotations).toHaveLength(1);
  expect(report.missions[0].experience?.requirements?.fields.product).toBe('原始机械部件');
  expect(JSON.stringify(report)).not.toContain(other.q.id);
  expect(JSON.stringify(report)).not.toContain('Private negotiation');
  expect(JSON.stringify(report)).not.toContain('@example.invalid');
  const request = (
    token: string,
    audience = 'CLIENT_PROGRESS',
    origin = 'https://corridra.example.invalid',
  ) =>
    new Request('https://corridra.example.invalid/api/customer-missions', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'view',
        token,
        audience,
        email: 'owner@example.invalid',
        tenantId: f.tenantA,
      }),
    });
  expect((await customerPost(request('0'.repeat(64)))).status).toBe(403);
  expect((await customerPost(request(l.token))).status).toBe(200);
  expect((await customerPost(request(l.token, 'INSTITUTION_REPORT'))).status).toBe(403);
  expect(
    (await customerPost(request(l.token, 'CLIENT_PROGRESS', 'https://unrelated.example.invalid')))
      .status,
  ).toBe(403);
  account.session = { data: { user: { id: 'customer', emailVerified: false } }, error: null };
  expect((await customerPost(request(l.token))).status).toBe(403);
  account.session = { data: null, error: null };
  expect((await customerPost(request(l.token))).status).toBe(401);
  await delivery.revoke(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: l.id,
    publicationId: null,
    reason,
  });
  await expect(
    delivery.external({ action: 'view', token: l.token, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toThrow();
});

test('delegation context, participant isolation and source-backed distinct-company denominators stay purpose-scoped', async () => {
  const { p, accepted, participants } = await programme();
  const input = {
    commandId: randomUUID(),
    programmeId: p.id,
    version: 1,
    organiser: 'Synthetic chamber organiser',
    marketCode: 'CN',
    purpose: 'Shared invented machinery discussions',
    startsAt: future(),
    endsAt: future(2),
    timezone: 'Asia/Shanghai',
    ownerId: f.users.operator.id,
    reason,
  };
  await experience.context(f.ctx, input);
  await experience.context(f.ctx, input);
  await expect(
    experience.context(f.ctx, { ...input, commandId: randomUUID(), version: 3 }),
  ).rejects.toThrow();
  await expect(
    experience.context(f.users.other.ctx, { ...input, commandId: randomUUID(), version: 2 }),
  ).rejects.toThrow();
  const proposed = {
    commandId: randomUUID(),
    programmeId: p.id,
    itemId: randomUUID(),
    version: 1,
    label: 'Synthetic shared technical discussion',
    missionIds: accepted.rows.map((r: { missionId?: string }) => r.missionId!),
    meetingIds: [],
    state: 'PROPOSED',
    ownerId: f.users.operator.id,
    nextAction: 'Obtain actual participant acceptance and meeting records',
    dueAt: future(),
    reason,
  };
  await experience.agenda(f.ctx, proposed);
  await expect(
    experience.agenda(f.ctx, {
      ...proposed,
      commandId: randomUUID(),
      itemId: randomUUID(),
      state: 'CONFIRMED',
    }),
  ).rejects.toThrow();
  await expect(
    experience.agenda(f.ctx, {
      ...proposed,
      commandId: randomUUID(),
      itemId: randomUUID(),
      missionIds: [randomUUID()],
    }),
  ).rejects.toThrow();
  const pubA = await publication(accepted.rows[0].missionId!),
    pubB = await publication(accepted.rows[1].missionId!),
    client = await share(pubA.id);
  await experience.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId: pubA.id,
    requirementId: null,
    targetIds: [],
    quotationIds: [],
    agendaItemIds: [proposed.commandId],
    approved: true,
    reason,
  });
  const institution = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: p.id,
    publicationIds: [pubA.id, pubB.id],
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
    purpose: reason,
    expiresAt: future(),
    allowExport: true,
    approved: true,
  });
  const report = (await delivery.external({
    action: 'view',
    token: institution.token,
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
  })) as DeliveryReport;
  expect(report.delegation?.context?.organiser).toBe(input.organiser);
  expect(report.delegation?.agenda).toHaveLength(1);
  expect(report.missions.every((m) => !m.experience && !m.requests)).toBe(true);
  const clientReport = (await delivery.external({
    action: 'view',
    token: client.token,
    audience: 'CLIENT_PROGRESS',
  })) as DeliveryReport;
  expect(clientReport.missions).toHaveLength(1);
  expect(clientReport.missions[0].experience?.agenda).toHaveLength(1);
  expect(JSON.stringify(clientReport)).not.toContain(pubB.id);
  const partial = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: p.id,
    publicationIds: [pubA.id],
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
    purpose: reason,
    expiresAt: future(),
    allowExport: false,
    approved: true,
  });
  expect(
    (
      (await delivery.external({
        action: 'view',
        token: partial.token,
        audience: 'INSTITUTION_REPORT',
        includeDelegation: true,
      })) as DeliveryReport
    ).delegation?.agenda,
  ).toHaveLength(0);
  const t = await f.target();
  const organisation = (
    await f.owner.query('SELECT organisation_id FROM app.relationship WHERE id=$1', [
      t.relationshipId,
    ])
  ).rows[0].organisation_id;
  for (const participant of participants)
    await experience.identity(f.users.owner.ctx, {
      commandId: randomUUID(),
      participantId: participant.id,
      organisationId: organisation,
      sourceId: t.sourceId,
      claimId: t.claimId,
      approved: true,
      reason,
    });
  const second = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: p.id,
    publicationIds: [pubA.id, pubB.id],
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
    purpose: reason,
    expiresAt: future(),
    allowExport: true,
    approved: true,
  });
  expect(
    (
      (await delivery.external({
        action: 'view',
        token: second.token,
        audience: 'INSTITUTION_REPORT',
        includeDelegation: true,
      })) as DeliveryReport
    ).approvedCompanies,
  ).toBe(1);
  const exported = (await delivery.external({
    action: 'export',
    token: institution.token,
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
    commandId: randomUUID(),
    format: 'CSV',
    purpose: reason,
  })) as { bytes: Buffer };
  await experience.context(f.ctx, {
    ...input,
    commandId: randomUUID(),
    version: 2,
    organiser: 'Later unapproved-for-this-link context',
  });
  const unchanged = (await delivery.external({
    action: 'view',
    token: institution.token,
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
  })) as DeliveryReport;
  expect(unchanged.delegation?.context?.organiser).toBe(input.organiser);
  expect(exported.bytes.toString('utf8')).not.toContain('Later unapproved');
  expect(
    (await rawContext(f.runtime, f.users.other.ctx, 'SELECT * FROM app.delivery_agenda')).rows,
  ).toHaveLength(0);
  await expect(
    f.owner.query("UPDATE app.delivery_agenda SET details='{}' WHERE id=$1", [proposed.commandId]),
  ).rejects.toThrow();
});

test('UTF-8 programme exports retain Chinese names, Bangla text and every original currency', async () => {
  const { p, accepted } = await programme();
  const pub = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: accepted.rows[0].missionId!,
    title: 'Original supplier context 原始资料',
    company: '华诚机械',
    objective: 'চাহিদা ও প্রমাণ পর্যালোচনা',
    brief: 'Original Chinese business text stays separate from any derived translation.',
    nextAction: 'Review the explicitly approved next step',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const l = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: p.id,
    publicationIds: [pub.id],
    audience: 'INSTITUTION_REPORT',
    purpose: reason,
    expiresAt: future(),
    allowExport: true,
    approved: true,
  });
  const report = (await delivery.external({
    action: 'view',
    token: l.token,
    audience: 'INSTITUTION_REPORT',
  })) as DeliveryReport;
  const copy = structuredClone(report);
  copy.missions[0].totals = [
    {
      currency: 'CNY',
      contractMinor: '1200',
      invoiceMinor: '0',
      confirmedCashMinor: '0',
      repeatCashMinor: '0',
    },
  ];
  const csv = reportCsv(copy).toString('utf8');
  expect(csv).toContain('contract_minor_CNY');
  expect(csv).toContain('华诚机械');
  expect(csv).toContain('1200');
  const bytes = await reportPdf(report);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(5000);
  await writeFile('.cache/part03-unicode-export.pdf', bytes, { mode: 0o600 });
});

async function participantMeeting(missionId: string, startsAt: Date) {
  const t = await f.target();
  for (const [index, action] of ['qualify', 'activate', 'targeting'].entries())
    await f.mission.command(f.ctx, {
      id: missionId,
      version: index + 1,
      commandId: randomUUID(),
      action,
      ownerId: f.users.operator.id,
      reason,
      nextAction: 'Review actual shared discussions',
      dueAt: future(),
      marketCode: 'ES',
      targetProfile: 'Synthetic commercial distributor',
    });
  const target = await f.research.command(
    f.ctx,
    command('target', {
      missionId,
      relationshipId: t.relationshipId,
      contactId: t.contactId,
      claimIds: [t.claimId],
      fit: 'POSSIBLE',
      rationale: 'Source-reported fit with this participant mission',
      uncertainty: 'No independent verification is asserted',
      gaps: 'Review the actual commercial discussion',
      nextAction: 'Arrange a controlled discussion',
      dueAt: future(),
    }),
  );
  return f.held(undefined, { ...t, missionId, targetId: target.id as string }, startsAt);
}
test('confirmed shared activity uses actual participant meetings once and cannot be duplicated or borrowed', async () => {
  const { p, accepted } = await programme();
  // Both participants attended the same activity, even if setup crosses a minute boundary.
  const startsAt = new Date(Date.now() - 3600000);
  const a = await participantMeeting(accepted.rows[0].missionId!, startsAt),
    b = await participantMeeting(accepted.rows[1].missionId!, startsAt);
  const agenda = {
    commandId: randomUUID(),
    programmeId: p.id,
    itemId: randomUUID(),
    version: 1,
    label: 'Observed shared synthetic participant discussion',
    missionIds: [a.missionId, b.missionId],
    meetingIds: [a.meetingId, b.meetingId],
    state: 'CONFIRMED',
    ownerId: f.users.operator.id,
    nextAction: 'Review each participant follow-up independently',
    dueAt: future(),
    reason,
  };
  await experience.agenda(f.ctx, agenda);
  await experience.agenda(f.ctx, agenda);
  await expect(
    experience.agenda(f.ctx, { ...agenda, commandId: randomUUID(), itemId: randomUUID() }),
  ).rejects.toThrow();
  const pubA = await publication(a.missionId, 'Participant A approved meeting', [
      { id: a.meetingId, version: 4, label: 'Shared observed discussion' },
    ]),
    pubB = await publication(b.missionId, 'Participant B approved meeting', [
      { id: b.meetingId, version: 4, label: 'Shared observed discussion' },
    ]);
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: p.id,
    publicationIds: [pubA.id, pubB.id],
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
    purpose: reason,
    expiresAt: future(),
    allowExport: true,
    approved: true,
  });
  const report = (await delivery.external({
    action: 'view',
    token: link.token,
    audience: 'INSTITUTION_REPORT',
    includeDelegation: true,
  })) as DeliveryReport;
  expect(report.heldMeetingsDistinct).toBe(1);
  expect(report.missions.reduce((n, m) => n + m.outcomes.heldMeetings, 0)).toBe(2);
  expect(report.delegation?.agenda[0].state).toBe('CONFIRMED');
  await experience.agenda(f.ctx, {
    ...agenda,
    commandId: randomUUID(),
    version: 2,
    state: 'CANCELLED',
  });
  expect(
    (
      (await delivery.external({
        action: 'view',
        token: link.token,
        audience: 'INSTITUTION_REPORT',
        includeDelegation: true,
      })) as DeliveryReport
    ).delegation?.agenda[0].state,
  ).toBe('REVIEW_REQUIRED');
  await expect(
    experience.agenda(f.ctx, {
      ...agenda,
      commandId: randomUUID(),
      itemId: randomUUID(),
      missionIds: [a.missionId],
      meetingIds: [b.meetingId],
    }),
  ).rejects.toThrow();
});
test('expired source rights independently close selected client detail and supplier disclosure', async () => {
  const j = await sourceJourney(5),
    p = await publication(j.t.missionId),
    l = await share(p.id),
    intro = await f.introduction(j.t);
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
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: intro.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only this current source-backed requirement is shareable',
    uncertainty: 'Technical suitability is not independently verified',
    rfqId: j.rfq.id,
    allowQuotation: true,
    allowMeetingInterest: false,
    approved: true,
    reason,
  });
  expect(
    (
      (await delivery.external({
        action: 'view',
        token: l.token,
        audience: 'CLIENT_PROGRESS',
      })) as DeliveryReport
    ).missions[0].experience?.quotations,
  ).toHaveLength(1);
  await f.communications.buyer({
    action: 'detail-response',
    token: intro.token,
    responseId: randomUUID(),
    body: 'Original response while the request source is current',
    quotation: null,
    meetingInterest: false,
    acknowledged: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 5500));
  expect(
    (await experience.workspace(f.users.owner.ctx)).responses.some((r) => r.link_id === intro.id),
  ).toBe(false);
  await expect(
    delivery.external({ action: 'view', token: l.token, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toThrow();
  await expect(f.communications.buyer({ action: 'read', token: intro.token })).rejects.toThrow();
});

test('populated Part 2 upgrade preserves every original row and historical export, then supports short units', async () => {
  const g = await accessFixture(false, '0024_typed_meeting_activities.sql', 'corridra_upgrade');
  try {
    const oldDelivery = new DeliveryService(g.runtime, g.mission, 'part03-upgrade-test-secret');
    await g.target();
    const programme = await oldDelivery.programme(g.ctx, {
      commandId: randomUUID(),
      name: 'Legacy synthetic delegation',
      reportingPurpose: reason,
    });
    const importPreview = await oldDelivery.preview(
      g.ctx,
      programme.id,
      randomUUID(),
      Buffer.from(intakeTemplate()),
      'CSV',
    );
    const imported = await oldDelivery.confirm(g.ctx, {
      commandId: randomUUID(),
      importId: importPreview.id,
      ownerId: g.users.operator.id,
      counts: importPreview.counts,
      acknowledged: true,
    });
    const p = await oldDelivery.publication(g.users.owner.ctx, {
      commandId: randomUUID(),
      missionId: imported.rows[0].missionId!,
      title: 'Accepted legacy publication',
      company: 'Legacy Synthetic Company',
      objective: 'Review an accepted legacy mission',
      brief: 'Existing reviewed copy must stay unchanged after the upgrade.',
      nextAction: 'Continue the original delivery process',
      dueAt: future(),
      meetings: [],
      opportunityIds: [],
      includeFinancials: false,
      approved: true,
    });
    const link = await oldDelivery.share(g.users.owner.ctx, {
      commandId: randomUUID(),
      programmeId: null,
      publicationIds: [p.id],
      audience: 'CLIENT_PROGRESS',
      purpose: reason,
      expiresAt: future(),
      allowExport: false,
      approved: true,
    });
    const beforeView = (await oldDelivery.external({
      action: 'view',
      token: link.token,
      audience: 'CLIENT_PROGRESS',
    })) as DeliveryReport;
    const institution = await oldDelivery.share(g.users.owner.ctx, {
      commandId: randomUUID(),
      programmeId: programme.id,
      publicationIds: [p.id],
      audience: 'INSTITUTION_REPORT',
      purpose: reason,
      expiresAt: future(),
      allowExport: true,
      approved: true,
    });
    const exportInput = {
      action: 'export',
      token: institution.token,
      audience: 'INSTITUTION_REPORT',
      commandId: randomUUID(),
      format: 'CSV',
      purpose: reason,
    };
    const oldExport = (await oldDelivery.external(exportInput)) as { bytes: Buffer };
    const tables = (
      await g.owner.query(
        "SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('app','identity') ORDER BY 1,2",
      )
    ).rows;
    const digests = async () => {
      const result: Record<string, unknown> = {};
      for (const t of tables) {
        const name = `${t.table_schema}.${t.table_name}`;
        result[name] = (
          await g.owner.query(
            `SELECT md5(coalesce(string_agg(md5((to_jsonb(t)-'include_delegation')::text),'' ORDER BY md5((to_jsonb(t)-'include_delegation')::text)),'')) digest,count(*)::int count FROM ${[t.table_schema, t.table_name].map((part: string) => '"' + part.replaceAll('"', '""') + '"').join('.')} t`,
          )
        ).rows[0];
      }
      return result;
    };
    const before = await digests();
    await migrate(g.owner);
    await migrate(g.owner);
    expect(await digests()).toEqual(before);
    expect(
      (
        await g.owner.query('SELECT include_delegation FROM app.delivery_link WHERE id=$1', [
          link.id,
        ])
      ).rows[0].include_delegation,
    ).toBe(false);
    expect(((await oldDelivery.external(exportInput)) as { bytes: Buffer }).bytes).toEqual(
      oldExport.bytes,
    );
    const afterView = (await oldDelivery.external({
      action: 'view',
      token: link.token,
      audience: 'CLIENT_PROGRESS',
    })) as DeliveryReport;
    // Only the request timestamp is newly observed. Every accepted publication field is retained.
    expect({ ...afterView, generatedAt: beforeView.generatedAt }).toEqual(beforeView);
    const row = (await g.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0];
    expect(row.n).toBe(29);
    await expect(
      g.runtime.query('SELECT app.delivery_report_v1($1,$2)', ['0'.repeat(64), 'CLIENT_PROGRESS']),
    ).rejects.toThrow();
  } finally {
    await g.close();
  }
  const j = await sourceJourney();
  const current = (await commercial.workspace(f.users.owner.ctx, j.t.missionId)).requirements[0];
  await commercial.command(
    f.ctx,
    command('requirements', {
      ...j.base,
      assignmentId: current.assignment_id,
      definitionId: current.definition_id,
      version: 2,
      schemaVersion: 1,
      declaration: 'Standard unit symbol retained explicitly',
      fields: {
        objective: 'Source materials with a standard short unit',
        role: 'IMPORTER',
        product: 'Synthetic industrial component',
        quantity: '100',
        unit: 'kg',
      },
    }),
  );
  expect(
    (
      (await commercial.workspace(f.users.owner.ctx, j.t.missionId)).requirements[0].fields as {
        unit: string;
      }
    ).unit,
  ).toBe('kg');
});

// Recipient response revision (CRUD gap G7, module 3): a recipient may correct their answer through the same private link.
const revisionReason = 'Owner opened answer correction for the local fixture tests';
async function answeredWithToken(allowMeetingInterest = false, open = true) {
  // Installing is idempotent, so every test below can run on its own; the control is opened unless the test is about it being closed.
  await migrateCustomerRealUse(f.owner);
  await migrateRecipientResponseRevision(f.owner);
  if (open) await configureRecipientRevision(f.owner, { enabled: true, reason: revisionReason });
  const j = await sourceJourney(),
    link = await f.introduction(j.t);
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: j.rfq.id,
    allowQuotation: true,
    allowMeetingInterest,
    approved: true,
    reason,
  });
  const responseId = randomUUID();
  await f.communications.buyer({
    action: 'detail-response',
    token: link.token,
    responseId,
    body: 'Original supplier reply, quote follows.',
    meetingInterest: false,
    quotation: {
      currency: 'USD',
      terms: { specification: 'Polyester curtain track', unitPriceMinor: '1250' },
      uncertainties: 'Lead time and validity not yet known',
    },
    acknowledged: true,
  });
  return { linkId: link.id, token: link.token, responseId };
}
const revision = (token: string, expectedVersion: number, over: Record<string, unknown> = {}) => ({
  action: 'detail-revision' as const,
  token,
  responseId: randomUUID(),
  expectedVersion,
  body: 'Corrected supplier reply, quote follows.',
  meetingInterest: false,
  quotation: {
    currency: 'USD',
    terms: { specification: 'Polyester curtain track', unitPriceMinor: '1300' },
    uncertainties: 'Validity still not known',
  },
  acknowledged: true,
  ...over,
});

test('response revision installs additively and idempotently, and a changed definition stops it', async () => {
  await migrateCustomerRealUse(f.owner);
  await migrateRecipientResponseRevision(f.owner);
  const once = (await f.owner.query('SELECT * FROM recipient_response_revision_migrations.applied'))
    .rows;
  expect(once).toHaveLength(1);
  await migrateRecipientResponseRevision(f.owner);
  expect(
    (await f.owner.query('SELECT * FROM recipient_response_revision_migrations.applied')).rows,
  ).toEqual(once);
  await f.owner.query(
    "UPDATE recipient_response_revision_migrations.applied SET sha256=repeat('0',64)",
  );
  await expect(migrateRecipientResponseRevision(f.owner)).rejects.toThrow('history mismatch');
  await f.owner.query('UPDATE recipient_response_revision_migrations.applied SET sha256=$1', [
    once[0].sha256,
  ]);
  // The original table is untouched by installation: still immutable, still no revision rows.
  expect(
    (await f.owner.query('SELECT count(*)::int n FROM app.recipient_detail_response_revision'))
      .rows[0].n,
  ).toBe(0);
});

test('a recipient corrects their answer: the original is untouched, the view shows the latest, and a replay is safe', async () => {
  const a = await answeredWithToken();
  const before = (
    await f.owner.query(
      'SELECT body,retention_until FROM app.recipient_detail_response WHERE id=$1',
      [a.responseId],
    )
  ).rows[0];
  let view = await f.communications.buyer({ action: 'read', token: a.token });
  expect(view.detailResponse).toMatchObject({ version: 0, canRevise: true });
  const first = revision(a.token, 0);
  expect(await f.communications.buyer(first)).toMatchObject({
    recorded: true,
    version: 1,
    sourceKind: 'SELF_DECLARATION',
  });
  view = await f.communications.buyer({ action: 'read', token: a.token });
  expect(view.detailResponse.body.body).toBe('Corrected supplier reply, quote follows.');
  expect(view.detailResponse).toMatchObject({ version: 1, canRevise: true });
  // Nothing was rewritten and retention was not extended.
  const after = (
    await f.owner.query(
      'SELECT body,retention_until FROM app.recipient_detail_response WHERE id=$1',
      [a.responseId],
    )
  ).rows[0];
  expect(after).toEqual(before);
  const row = (
    await f.owner.query(
      'SELECT retention_until,version FROM app.recipient_detail_response_revision WHERE response_id=$1',
      [a.responseId],
    )
  ).rows;
  expect(row).toHaveLength(1);
  expect(row[0].retention_until).toEqual(before.retention_until);
  // The same command with the same content is a replay; the same id with other content conflicts.
  expect(await f.communications.buyer(first)).toMatchObject({ recorded: true, version: 1 });
  await expect(
    f.communications.buyer({ ...first, body: 'A different corrected reply' }),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.recipient_detail_response_revision WHERE response_id=$1',
        [a.responseId],
      )
    ).rows[0].n,
  ).toBe(1);
  // A stale version is refused, and the next version works.
  await expect(f.communications.buyer(revision(a.token, 0))).rejects.toThrow(
    'Response changed; reload before saving',
  );
  expect(await f.communications.buyer(revision(a.token, 1))).toMatchObject({ version: 2 });
});

test('a correction can never do more than the link allows or restate less than the first answer did', async () => {
  const a = await answeredWithToken(false);
  // Meeting interest was not disclosed for this link; consent must be restated; terms follow the same rules as the first answer.
  for (const bad of [
    { meetingInterest: true },
    { acknowledged: false },
    { body: 'ab' },
    { quotation: { currency: 'ZZZ', terms: {}, uncertainties: 'Not known at all' } },
    {
      quotation: { currency: 'USD', terms: { unitPriceMinor: '12.5' }, uncertainties: 'Not known' },
    },
    { quotation: { currency: 'USD', terms: { colour: 'red' }, uncertainties: 'Not known' } },
    { quotation: { currency: 'USD', terms: { incoterm: 'XXX' }, uncertainties: 'Not known' } },
    { extra: 'field' },
  ]) {
    await expect(f.communications.buyer(revision(a.token, 0, bad))).rejects.toThrow();
  }
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM app.recipient_detail_response_revision WHERE response_id=$1',
        [a.responseId],
      )
    ).rows[0].n,
  ).toBe(0);
  // Dropping the quotation narrows the answer and is allowed.
  expect(await f.communications.buyer(revision(a.token, 0, { quotation: null }))).toMatchObject({
    version: 1,
  });
  // A link with no disclosure for a quotation cannot gain one by correcting.
  const j = await sourceJourney(),
    plain = await f.introduction(j.t);
  await expect(f.communications.buyer(revision(plain.token, 0))).rejects.toThrow();
  // A correction needs a first answer.
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: plain.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery component requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: j.rfq.id,
    allowQuotation: false,
    allowMeetingInterest: false,
    approved: true,
    reason,
  });
  await expect(
    f.communications.buyer(revision(plain.token, 0, { quotation: null })),
  ).rejects.toThrow('Respond before correcting');
});

test("the response revision table cannot be rewritten or written directly, and its body check is the first answer's text", async () => {
  const a = await answeredWithToken();
  await f.communications.buyer(revision(a.token, 0));
  await expect(
    f.owner.query("UPDATE app.recipient_detail_response_revision SET body='{}'::jsonb"),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM app.recipient_detail_response_revision'),
  ).rejects.toThrow();
  for (const pool of [f.runtime, f.auth])
    await expect(
      pool.query(
        "INSERT INTO app.recipient_detail_response_revision(id,tenant_id,response_id,link_id,version,body,retention_until,created_by) VALUES($1,$2,$3,$4,1,'{}'::jsonb,now()+interval '1 day',$5)",
        [randomUUID(), f.tenantA, a.responseId, a.linkId, f.users.owner.id],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  // The rules for a body are copied from the first-answer function: compare the text so they cannot drift apart.
  const core = readFileSync(
    resolve('packages/db/migrations/0025_scoped_product_experience.sql'),
    'utf8',
  );
  const module3 = readFileSync(
    resolve('packages/db/recipient-response-revision-migrations/0001_response_revision.sql'),
    'utf8',
  );
  const from = core.indexOf(
    " IF b IS NULL OR b-ARRAY['body','meetingInterest','quotation','acknowledged']",
  );
  const to = core.indexOf(
    ' SELECT * INTO old FROM app.recipient_detail_response WHERE tenant_id=l.tenant_id',
  );
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  expect(module3).toContain(core.slice(from, to).trimEnd());
});

test('the control starts closed: nothing can be corrected, and the view does not offer it, until the owner opens it', async () => {
  await migrateCustomerRealUse(f.owner);
  await migrateRecipientResponseRevision(f.owner);
  const a = await answeredWithToken(false, false);
  // Installing leaves it closed. If an earlier test opened it, close it for this one.
  await configureRecipientRevision(f.owner, { enabled: false, reason: revisionReason });
  expect(
    (await f.communications.buyer({ action: 'read', token: a.token })).detailResponse,
  ).toMatchObject({
    version: 0,
    canRevise: false,
  });
  await expect(f.communications.buyer(revision(a.token, 0))).rejects.toThrow(
    'Answer correction is not open',
  );
  for (const pool of [f.runtime, f.auth]) {
    await expect(pool.query('SELECT * FROM app.recipient_revision_control')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(pool.query('SELECT app.recipient_revision_open()')).rejects.toMatchObject({
      code: '42501',
    });
  }
  await expect(
    configureRecipientRevision(f.runtime, { enabled: true, reason: revisionReason }),
  ).rejects.toThrow();
  expect(
    await configureRecipientRevision(f.owner, { enabled: true, reason: revisionReason }),
  ).toEqual({
    enabled: true,
    changed: true,
  });
  // The control's history cannot be rewritten.
  await expect(
    f.owner.query('UPDATE app.recipient_revision_control SET enabled=false'),
  ).rejects.toThrow();
  expect(await f.communications.buyer(revision(a.token, 0))).toMatchObject({ version: 1 });
  // Pausing stops new corrections and keeps the ones already made.
  await configureRecipientRevision(f.owner, { enabled: false, reason: revisionReason });
  await expect(f.communications.buyer(revision(a.token, 1))).rejects.toThrow(
    'Answer correction is not open',
  );
  expect(
    (await f.communications.buyer({ action: 'read', token: a.token })).detailResponse.body.body,
  ).toBe('Corrected supplier reply, quote follows.');
  await configureRecipientRevision(f.owner, { enabled: true, reason: revisionReason });
});

test('an Ask is answered by a correction, a final decision locks the answer, and the team sees an answer that came after the Ask', async () => {
  await migrateReplyReview(f.owner);
  await configureReplyReview(f.owner, { enabled: true, reason: reviewReason });
  const reviews = new ReplyReviewService(f.runtime);
  const a = await answeredWithToken();
  const waiting = async () => (await getTeamToday(f.runtime, f.users.owner.ctx)).repliesToReview;
  const unreviewed = await waiting();
  await reviews.review(f.users.owner.ctx, ask(a.responseId));
  // Asked, so no longer waiting for a first review.
  expect(await waiting()).toBe(unreviewed - 1);
  // An Ask invites the supplier to add terms to their own answer: that is a correction, and it is allowed.
  expect(
    (await f.communications.buyer({ action: 'read', token: a.token })).detailResponse,
  ).toMatchObject({ version: 0, canRevise: true });
  expect(await f.communications.buyer(revision(a.token, 0))).toMatchObject({ version: 1 });
  // An answer that came after the Ask is waiting for review again.
  expect(await waiting()).toBe(unreviewed);
  // The decision still points at the original reply, and the team's list shows the correction.
  const mine = (await experience.workspace(f.users.owner.ctx)).responses.find(
    (r) => r.id === a.responseId,
  );
  expect(mine).toMatchObject({ revision: 1 });
  expect(new Date(mine!.revised_at).getTime()).toBeGreaterThan(
    new Date(
      (await reviews.list(f.users.owner.ctx)).reviews.find((r) => r.responseId === a.responseId)!
        .createdAt,
    ).getTime(),
  );
  // A final decision (here a rejection) locks the answer.
  await reviews.review(f.users.owner.ctx, {
    commandId: randomUUID(),
    responseId: a.responseId,
    decision: 'REJECT',
    reasonCode: 'NOT_A_FIT',
  });
  expect(await waiting()).toBe(unreviewed - 1);
  expect(
    (await f.communications.buyer({ action: 'read', token: a.token })).detailResponse,
  ).toMatchObject({ version: 1, canRevise: false });
  await expect(f.communications.buyer(revision(a.token, 1))).rejects.toThrow(
    'The team has already decided on this response',
  );
});

test('the team reads the latest correction with how many were made, and the first answer stays on record', async () => {
  const a = await answeredWithToken();
  await f.communications.buyer(revision(a.token, 0, { body: 'First correction of the reply' }));
  await f.communications.buyer(revision(a.token, 1, { body: 'Second correction of the reply' }));
  const mine = (await experience.workspace(f.users.owner.ctx)).responses.find(
    (r) => r.link_id === a.linkId,
  );
  expect(mine).toMatchObject({ revision: 2 });
  expect(mine!.body.body).toBe('Second correction of the reply');
  // The original is still stored exactly as it was given.
  expect(
    (
      await f.owner.query('SELECT body->>$2 AS b FROM app.recipient_detail_response WHERE id=$1', [
        a.responseId,
        'body',
      ])
    ).rows[0].b,
  ).toBe('Original supplier reply, quote follows.');
});

test('a recipient can correct an answer twenty times and no more', async () => {
  const a = await answeredWithToken();
  for (let i = 0; i < 20; i++)
    await f.communications.buyer(revision(a.token, i, { body: `Corrected supplier reply ${i}` }));
  await expect(f.communications.buyer(revision(a.token, 19))).rejects.toThrow();
  const view = await f.communications.buyer({ action: 'read', token: a.token });
  expect(view.detailResponse).toMatchObject({ version: 20, canRevise: false });
});

test('publisher membership revocation invalidates selected client detail independently of customer identity', async () => {
  const j = await sourceJourney(),
    pub = await publication(j.t.missionId),
    link = await share(pub.id);
  await experience.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    publicationId: pub.id,
    requirementId: j.r.id,
    targetIds: [j.t.targetId],
    quotationIds: [j.q.id],
    agendaItemIds: [],
    approved: true,
    reason,
  });
  // Revoking the publisher's membership is a genuine independent access gate, not a fake capability failure.
  await changeMemberNow(f.a, f.users.owner.ctx, {
    userId: f.users.reviewer.id,
    role: 'owner',
    revoked: false,
  });
  await changeMemberNow(f.a, f.users.reviewer.ctx, {
    userId: f.users.owner.id,
    role: 'owner',
    revoked: true,
  });
  await expect(
    delivery.external({ action: 'view', token: link.token, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toThrow();
});
