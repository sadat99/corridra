import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { CommercialMissionService } from '../../packages/missions/src/commercial';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';
import { initialRoutes } from '../../packages/domain/src/corridors';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateReplyReview } from '../../packages/db/src/recipient-reply-review-migrate';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';

// Real-use 0020 with recipient-reply-review 0002 and recipient-response-revision 0002: one more quotation term key, 'commissioning',
// accepted in all four places that list the keys, and nothing else accepted that was refused before.
const reason = 'Synthetic commissioning term validation';
const file = (dir: string, name: string) =>
  readFile(new URL(`../../packages/db/${dir}/${name}`, import.meta.url), 'utf8');
const realUse = () => file('customer-real-use-migrations', '0020_offer_commissioning_term.sql');
const reviewFile = () => file('recipient-reply-review-migrations', '0002_commissioning_term.sql');
const revisionFile = () =>
  file('recipient-response-revision-migrations', '0002_commissioning_term.sql');
const withToken = "'spares','commissioning','paymentTerms'";
const withoutToken = "'spares','paymentTerms'";
let f: Awaited<ReturnType<typeof commercialFixture>>,
  routes: CorridorService,
  commercial: CommercialMissionService,
  experience: DeliveryExperienceService;
beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
  commercial = new CommercialMissionService(f.runtime);
  experience = new DeliveryExperienceService(f.runtime);
  await routes.installTemplates(f.users.owner.ctx);
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
  await migrateCustomerRealUse(f.owner);
  await migrateReplyReview(f.owner);
  await migrateRecipientResponseRevision(f.owner);
}, 300000);
afterAll(async () => {
  await f?.close();
});

const def = async (signature: string) =>
  (await f.owner.query(`SELECT pg_get_functiondef('${signature}'::regprocedure) d`)).rows[0]
    .d as string;
const functions = {
  guard: 'app.guard_commercial_mission()',
  respond: 'app.recipient_detail_respond(text,uuid,jsonb)',
  body: 'app.recipient_detail_body_check(jsonb,app.recipient_disclosure)',
} as const;

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
  const typeKey = 'machinery_procurement',
    req = cat.requirements.find((r) => r.schema.typeKey === typeKey)!,
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
        objective: 'Find suitable machinery',
        role: 'IMPORTER',
        product: 'Synthetic press line',
        quantity: '1',
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
      requestedTerms: 'Original unit price, quantity and commissioning terms',
      dueAt: future(),
    }),
  );
  return { t, rfq, base };
}
const quote = (j: Awaited<ReturnType<typeof journey>>, terms: Record<string, string>) =>
  commercial.command(
    f.ctx,
    command('quotation', {
      ...j.base,
      rfqId: j.rfq.id,
      targetId: j.t.targetId,
      revision: 1,
      observedAt: new Date(Date.now() - 3600000).toISOString(),
      currency: 'CNY',
      terms,
      uncertainties: 'Logistics and specifications remain unconfirmed',
    }),
  );

test('the team can record an offer with a commissioning term, and a key that was refused before still is', async () => {
  const j = await journey();
  // The command schema refuses a key it does not list before the database is reached.
  await expect(quote(j, { unitPriceMinor: '1200', warrantyMinor: '5' })).rejects.toThrow(
    /Unrecognized key/,
  );
  const q = await quote(j, {
    unitPriceMinor: '1200',
    commissioning: 'Included, two engineers for five days',
  });
  const stored = (
    await f.owner.query('SELECT terms FROM app.mission_quotation WHERE id=$1', [q.id])
  ).rows[0].terms;
  expect(stored).toEqual({
    unitPriceMinor: '1200',
    commissioning: 'Included, two engineers for five days',
  });
  const workspace = await commercial.workspace(f.ctx, j.t.missionId);
  const quotations = workspace.quotations as { id: string; terms: Record<string, string> }[];
  expect(quotations.find((o) => o.id === q.id)?.terms.commissioning).toBe(
    'Included, two engineers for five days',
  );
});

test('a supplier can state commissioning in the first answer and the answer check accepts the same keys', async () => {
  const j = await journey();
  const intro = await f.introduction(j.t);
  await experience.disclosure(f.users.owner.ctx, {
    commandId: randomUUID(),
    linkId: intro.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery requirement is shareable.',
    uncertainty: 'Buyer budget and technical fit are not independently verified.',
    rfqId: j.rfq.id,
    allowQuotation: true,
    allowMeetingInterest: false,
    approved: true,
    reason,
  });
  const answer = (terms: Record<string, string>) => ({
    action: 'detail-response',
    token: intro.token,
    responseId: randomUUID(),
    body: 'Original supplier reply, quote follows.',
    meetingInterest: false,
    quotation: { currency: 'USD', terms, uncertainties: 'Freight is not yet known' },
    acknowledged: true,
  });
  await expect(
    f.communications.buyer(answer({ unitPriceMinor: '1250', madeUp: 'x' })),
  ).rejects.toThrow();
  const terms = { unitPriceMinor: '1250', commissioning: 'Two days on site, travel extra' };
  expect(await f.communications.buyer(answer(terms))).toMatchObject({ recorded: true });
  const stored = (
    await f.owner.query('SELECT body FROM app.recipient_detail_response WHERE link_id=$1', [
      intro.id,
    ])
  ).rows[0].body;
  expect(stored.quotation.terms).toEqual(terms);
  // The correction check holds the same rules: a body with commissioning passes, an unknown key does not.
  const check = (terms: Record<string, string>) =>
    f.owner.query(
      `SELECT app.recipient_detail_body_check($1::jsonb,jsonb_populate_record(null::app.recipient_disclosure,$2::jsonb))`,
      [
        JSON.stringify({
          body: 'Corrected supplier reply',
          meetingInterest: false,
          quotation: { currency: 'USD', terms, uncertainties: 'Freight is not yet known' },
          acknowledged: true,
        }),
        JSON.stringify({
          role: 'SUPPLIER',
          allow_quotation: true,
          allow_meeting_interest: false,
          rfq_id: j.rfq.id,
        }),
      ],
    );
  await expect(check({ commissioning: 'Two days on site' })).resolves.toBeDefined();
  await expect(check({ madeUp: 'x' })).rejects.toThrow(/Unknown quotation terms/);
});

test('the four lists hold the same keys: both functions, the answer check and the reply review constraint', async () => {
  const list = (text: string) =>
    [...text.matchAll(/ARRAY\[((?:'[A-Za-z]+'(?:::text)?(?:, ?)?)+)\]/g)]
      .map((m) => m[1].replace(/::text/g, '').replace(/\s/g, ''))
      .find((l) => l.includes("'paymentTerms'") && l.includes("'moq'"))!;
  const respond = list(await def(functions.respond)),
    body = list(await def(functions.body));
  expect(respond).toContain("'commissioning'");
  expect(body).toBe(respond);
  const constraints = (
    await f.owner.query(
      "SELECT conname,pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='app.recipient_reply_review'::regclass AND conname IN ('recipient_reply_review_ask_terms_check','recipient_reply_review_check1')",
    )
  ).rows as { conname: string; d: string }[];
  expect(constraints).toHaveLength(2);
  const askList = list(constraints.find((c) => c.conname.endsWith('ask_terms_check'))!.d);
  expect(askList.split(',').sort()).toEqual(respond.split(',').sort());
  expect(constraints.find((c) => c.conname.endsWith('check1'))!.d).toContain('<= 19');
  // Terms asked for are still limited to the listed keys and to 19 of them.
  const rows = (n: number) =>
    `ARRAY[${Array.from({ length: n }, () => "'moq'").join(',')}]::text[]`;
  const probe = async (arr: string) =>
    (
      await f.owner.query(
        `SELECT ${arr} <@ ARRAY['specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','commissioning','paymentTerms']::text[] ok`,
      )
    ).rows[0].ok;
  expect(await probe(rows(1))).toBe(true);
});

test('each file changes one token, keeps the grants and runs twice without further change', async () => {
  const before = Object.fromEntries(
    await Promise.all(
      Object.entries(functions).map(async ([k, s]) => [
        k,
        {
          d: await def(s),
          acl: (
            await f.owner.query(`SELECT proacl::text a FROM pg_proc WHERE oid='${s}'::regprocedure`)
          ).rows[0].a,
        },
      ]),
    ),
  );
  await f.owner.query(await realUse());
  await f.owner.query(await reviewFile());
  await f.owner.query(await revisionFile());
  for (const [k, s] of Object.entries(functions)) {
    const after = await def(s);
    expect(after).toBe(before[k].d);
    expect(
      (await f.owner.query(`SELECT proacl::text a FROM pg_proc WHERE oid='${s}'::regprocedure`))
        .rows[0].a,
    ).toBe(before[k].acl);
    expect(after).toContain(withToken);
  }
});

test('a changed earlier definition stops each file, and the file then completes once it is restored', async () => {
  for (const [key, signature, run] of [
    ['guard', functions.guard, realUse],
    ['respond', functions.respond, realUse],
    ['body', functions.body, revisionFile],
  ] as const) {
    const current = await def(signature);
    const earlier = current.replace(withToken, withoutToken);
    expect(earlier).not.toBe(current);
    await f.owner.query(earlier.replace('$function$\n', '$function$\n/*x*/'));
    await expect(f.owner.query(await run())).rejects.toThrow(
      new RegExp(
        `prerequisite function differs: app\\.${key === 'guard' ? 'guard_commercial_mission' : key === 'respond' ? 'recipient_detail_respond' : 'recipient_detail_body_check'}`,
      ),
    );
    await f.owner.query(earlier);
    await f.owner.query(await run());
    expect(await def(signature)).toBe(current);
  }
  // The reply review constraint: an unexpected definition stops the file too.
  await f.owner.query(
    'ALTER TABLE app.recipient_reply_review DROP CONSTRAINT recipient_reply_review_ask_terms_check',
  );
  await f.owner.query(
    "ALTER TABLE app.recipient_reply_review ADD CONSTRAINT recipient_reply_review_ask_terms_check CHECK(ask_terms <@ ARRAY['specification']::text[])",
  );
  await expect(f.owner.query(await reviewFile())).rejects.toThrow(/constraint differs/);
  await f.owner.query(
    'ALTER TABLE app.recipient_reply_review DROP CONSTRAINT recipient_reply_review_ask_terms_check',
  );
  await f.owner.query(
    "ALTER TABLE app.recipient_reply_review ADD CONSTRAINT recipient_reply_review_ask_terms_check CHECK(ask_terms <@ ARRAY['specification','quantity','moq','unit','unitPriceMinor','totalPriceMinor','toolingMinor','setupMinor','packagingMinor','leadTime','validUntil','incoterm','shipping','warranty','installation','training','spares','paymentTerms']::text[])",
  );
  await f.owner.query(await reviewFile());
  expect(
    (
      await f.owner.query(
        "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='recipient_reply_review_ask_terms_check'",
      )
    ).rows[0].d,
  ).toContain('commissioning');
});
