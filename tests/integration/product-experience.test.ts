import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { accessFixture } from './access-fixture';
import { writeFile } from 'node:fs/promises';
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
const account = vi.hoisted(() => ({ session: null as unknown, services: null as unknown }));
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({ getSession: async () => account.session }),
}));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => account.services }));
import { POST as customerPost } from '../../apps/web/app/api/customer-missions/route';
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
  await f.a.changeMember(f.users.owner.ctx, {
    userId: f.users.reviewer.id,
    role: 'owner',
    revoked: false,
  });
  await f.a.changeMember(f.users.reviewer.ctx, {
    userId: f.users.owner.id,
    role: 'owner',
    revoked: true,
  });
  await expect(
    delivery.external({ action: 'view', token: link.token, audience: 'CLIENT_PROGRESS' }),
  ).rejects.toThrow();
});
