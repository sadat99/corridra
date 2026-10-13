import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { command, future } from './access-fixture';
import { rawContext } from './support';
import { migrate } from '../../packages/db/src/migrate';
import { CorridorService, initialRouteConfiguration } from '../../packages/missions/src/corridors';
import { initialRoutes, resolveConfiguration } from '../../packages/domain/src/corridors';
import { countryCode, locale, timeZone } from '../../packages/domain/src/geography';
import { currency, parseMoney, formatMoney } from '../../packages/domain/src/opportunities';
import { authorizeAiTask, authorizeContributorTask } from '../../packages/domain/src/policy';
let f: Awaited<ReturnType<typeof commercialFixture>>;
let routes: CorridorService;
beforeAll(async () => {
  f = await commercialFixture();
  routes = new CorridorService(f.runtime);
});
afterAll(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.owner.query('UPDATE identity.assurance SET verified_at=now()');
});
const reason = 'Explicit synthetic foundation validation';
const configuration = () => ({
  ...initialRouteConfiguration(initialRoutes[2]),
  currencies: ['CNY' as const],
  languages: ['zh-CN'],
  timeZones: ['Asia/Shanghai'],
});
const write = (sql: string, args: unknown[], ctx = f.users.owner.ctx) =>
  rawContext(f.runtime, ctx, sql, args);
test('canonical global identifiers reject EU as country, aliases do not create countries, exact currencies work', () => {
  for (const c of ['BD', 'CN', 'ES', 'JP', 'KE', 'BR', 'MX']) expect(countryCode.parse(c)).toBe(c);
  for (const c of ['EU', 'OTHER', 'ZZ', 'China']) expect(() => countryCode.parse(c)).toThrow();
  expect(locale.parse('zh-cn')).toBe('zh-CN');
  expect(() => locale.parse('bad_locale')).toThrow();
  expect(() => timeZone.parse('Mars/City')).toThrow();
  expect(currency.parse('CNY')).toBe('CNY');
  expect(parseMoney('90071992547409.93', 'CNY')).toBe('9007199254740993');
  expect(formatMoney('1234', 'CNY')).toBe('CNY 12.34');
  expect(parseMoney('1.234', 'KWD')).toBe('1234');
  expect(() => parseMoney('1.1', 'JPY')).toThrow();
});
test('global restrictions survive all lower configuration layers and AI/provider self-elevation', () => {
  const root = configuration();
  const requirementId = randomUUID();
  expect(resolveConfiguration(root, { requirements: [requirementId] }).requirements).toEqual([
    requirementId,
  ]);
  for (const override of [
    { channels: ['EMAIL'] },
    { reviewRequired: false },
    { allowedTools: ['PAY'] },
    { aiPolicyRef: randomUUID() },
    { currencies: ['USD'] },
  ])
    expect(() => resolveConfiguration(root, override as never)).toThrow();
  const req = {
    tenantId: randomUUID(),
    sourceTenantId: randomUUID(),
    task: 'SUMMARIZE',
    providerApproved: true,
    humanApproved: true,
    routeReady: true,
    requestedTools: ['READ_SCOPED_SOURCE'],
    allowedTools: ['READ_SCOPED_SOURCE'],
  };
  req.sourceTenantId = req.tenantId;
  const rights = {
    sourceId: randomUUID(),
    licence: 'Reviewed public source',
    permittedReuse: ['AI_REVIEW'],
    role: 'CONTROLLER',
    purpose: 'synthetic_validation',
    classification: 'PUBLIC',
    jurisdictions: ['CN'],
    subjectLocations: ['CN'],
    processingLocations: ['DE'],
    retentionUntil: future(),
    legalHold: false,
    aiPermission: 'REVIEW_REQUIRED',
    transferStatus: 'UNREVIEWED',
    transferMechanism: null,
  };
  expect(() => authorizeAiTask(req, rights)).toThrow();
  const approved = {
    ...rights,
    transferStatus: 'APPROVED',
    transferMechanism: 'Synthetic test review only',
  };
  expect(authorizeAiTask(req, approved).outputAuthority).toBe('UNVERIFIED_DRAFT');
  for (const patch of [
    { sourceTenantId: randomUUID() },
    { task: 'PAY' },
    { requestedTools: ['VERIFY_FACT'] },
    { providerApproved: false },
    { humanApproved: false },
    { routeReady: false },
  ])
    expect(() => authorizeAiTask({ ...req, ...patch }, approved)).toThrow();
  expect(() => authorizeAiTask(req, { ...approved, classification: 'PERSONAL' })).toThrow();
  expect(() =>
    authorizeContributorTask({
      tenantId: req.tenantId,
      taskTenantId: randomUUID(),
      actorId: 'a',
      assigneeId: 'a',
      relationshipDisclosed: true,
      expiresAt: future(),
    }),
  ).toThrow();
});
test('new country pairs configure without migrations; tenant, route, version and MFA boundaries hold', async () => {
  for (const [origin, destination] of [
    ['JP', 'KE'],
    ['BR', 'MX'],
    ['BD', 'CN'],
    ['BD', 'EU'],
  ]) {
    const routeId = randomUUID();
    await routes.createRoute(f.users.owner.ctx, { id: routeId, origin, destination, reason });
    const requirementId = randomUUID();
    await write(
      'INSERT INTO app.requirement_definition(id,tenant_id,key,version,description,created_by,reason) VALUES($1,$2,$3,1,$4,$5,$4)',
      [requirementId, f.tenantA, 'requirement-' + requirementId, reason, f.users.owner.id],
    );
    const pack = {
      id: randomUUID(),
      routeId,
      version: 1,
      status: 'TESTING',
      effectiveFrom: new Date(Date.now() - 2000).toISOString(),
      reason,
      configuration: { ...configuration(), requirements: [requirementId] },
    };
    await expect(
      routes.appendPack(f.users.owner.ctx, {
        ...pack,
        id: randomUUID(),
        configuration: { ...pack.configuration, requirements: [randomUUID()] },
      }),
    ).rejects.toThrow('Exact same-tenant definition versions required');
    await routes.appendPack(f.users.owner.ctx, pack);
    expect(
      (
        await write(
          'SELECT id FROM app.corridor_pack_version WHERE id=$1',
          [pack.id],
          f.users.other.ctx,
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      routes.appendPack(f.users.other.ctx, { ...pack, id: randomUUID(), version: 2 }),
    ).rejects.toThrow();
    await expect(
      routes.appendPack(f.ctx, { ...pack, id: randomUUID(), version: 2 }),
    ).rejects.toThrow();
    await expect(
      write("UPDATE app.corridor_pack_version SET status='ACTIVE' WHERE id=$1", [pack.id]),
    ).rejects.toThrow();
    const target = await f.target();
    const typeId = randomUUID();
    await write(
      'INSERT INTO app.mission_type_definition(id,tenant_id,key,version,description,created_by,reason) VALUES($1,$2,$3,1,$4,$5,$4)',
      [typeId, f.tenantA, 'sourcing', reason, f.users.owner.id],
    ).catch(async (e) => {
      if (e.code !== '23505') throw e;
    });
    const actualType = (
      await write(
        "SELECT id FROM app.mission_type_definition WHERE tenant_id=$1 AND key='sourcing'",
        [f.tenantA],
      )
    ).rows[0].id;
    await routes.assign(f.users.owner.ctx, {
      id: randomUUID(),
      missionId: target.missionId,
      packId: pack.id,
      missionTypeId: actualType,
      version: 1,
      reason,
    });
    await routes.appendPack(f.users.owner.ctx, {
      ...pack,
      id: randomUUID(),
      version: 2,
      status: 'PAUSED',
      effectiveFrom: new Date(Date.now() - 1000).toISOString(),
    });
    const assignments = await write(
      'SELECT pack_id FROM app.mission_route_assignment WHERE mission_id=$1',
      [target.missionId],
    );
    expect(assignments.rows[0].pack_id).toBe(pack.id);
    await expect(
      routes.assign(f.users.owner.ctx, {
        id: randomUUID(),
        missionId: target.missionId,
        packId: pack.id,
        missionTypeId: actualType,
        version: 2,
        reason,
      }),
    ).rejects.toThrow();
  }
  await f.owner.query("UPDATE identity.assurance SET verified_at=now()-interval '10 minutes'");
  await expect(
    routes.createRoute(f.users.owner.ctx, {
      id: randomUUID(),
      origin: 'ES',
      destination: 'CN',
      reason,
    }),
  ).rejects.toThrow();
});
test('supplier-origin opportunity progresses without invented meeting, retains scoped provenance and v2 replay', async () => {
  const t = await f.target(),
    sourceId = (await f.source()).id,
    claim = await f.evidence.createClaim(f.ctx, {
      sourceId,
      statement: 'Documented synthetic supplier quotation in CNY',
    });
  const origin = {
    id: randomUUID(),
    missionId: t.missionId,
    targetId: t.targetId,
    kind: 'SUPPLIER_RESPONSE',
    sourceId,
    claimId: claim.id,
    summary: 'Observed supplier quotation',
    reason,
  };
  await expect(f.service.registerOrigin(f.users.other.ctx, origin)).rejects.toThrow();
  await f.service.registerOrigin(f.ctx, origin);
  const input = command('createFromOrigin', {
    originId: origin.id,
    title: 'Synthetic sourcing opportunity',
    attribution: 'Observed supplier response, no meeting held',
    ...f.next(),
  });
  const o = await f.service.command(f.ctx, input);
  expect(await f.service.command(f.ctx, input)).toEqual(o);
  await expect(f.service.command(f.ctx, { ...input, title: 'Changed replay' })).rejects.toThrow();
  expect(
    (await write('SELECT meeting_id,origin_id FROM app.opportunity WHERE id=$1', [o.id])).rows[0],
  ).toEqual({ meeting_id: null, origin_id: origin.id });
  expect(
    (await write('SELECT id FROM app.opportunity WHERE id=$1', [o.id], f.users.other.ctx)).rowCount,
  ).toBe(0);
  await f.transition(o.id, 'QUALIFIED_OPPORTUNITY');
  await f.record(o.id, 'PROPOSAL', sourceId, undefined, '100000', 'CNY');
  await f.transition(o.id, 'PROPOSAL');
  await f.mission.command(f.ctx, {
    id: t.missionId,
    version: 4,
    commandId: randomUUID(),
    action: 'pipeline',
    marketCode: 'CN',
    targetProfile: 'Synthetic supplier requirement',
    ...f.next(),
  });
  const before = (
    await f.owner.query(
      'SELECT snapshot FROM app.outcome_projection WHERE opportunity_id=$1 ORDER BY entity_id',
      [o.id],
    )
  ).rows;
  await f.service.command(f.users.owner.ctx, command('rebuild', { reason }));
  expect(
    (
      await f.owner.query(
        'SELECT snapshot FROM app.outcome_projection WHERE opportunity_id=$1 ORDER BY entity_id',
        [o.id],
      )
    ).rows,
  ).toEqual(before);
  expect(
    (
      await f.owner.query(
        "SELECT DISTINCT schema_version FROM app.outcome_event WHERE opportunity_id=$1 AND entity_type='opportunity'",
        [o.id],
      )
    ).rows,
  ).toEqual([{ schema_version: 2 }]);
});
test('populated 0018 upgrade retains commercial history, contacts, identities, source text and projections', async () => {
  await f.close();
  f = await commercialFixture(false, '0018_private_publication_guard.sql');
  routes = new CorridorService(f.runtime);
  await f.invoice();
  const tables = [
    'mission',
    'mission_market',
    'source_record',
    'private_contact_data',
    'membership',
    'commercial_record',
    'outcome_event',
    'outcome_projection',
    'domain_event',
    'outbox',
    'meeting',
  ];
  const snapshot = async () =>
    Promise.all(
      tables.map(
        async (t) =>
          (
            await f.owner.query(
              `SELECT ${t === 'meeting' ? "to_jsonb(t)-'target_id'-'activity_kind'-'activity_context'" : 'to_jsonb(t)'} data FROM app.${t} t ORDER BY to_jsonb(t)::text`,
            )
          ).rows,
      ),
    );
  const before = await snapshot();
  await migrate(f.owner);
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await f.owner.query(
        "SELECT count(*)::int n FROM app.mission_route_assignment WHERE status='LEGACY_UNRESOLVED'",
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
  await f.service.command(f.users.owner.ctx, command('rebuild', { reason }));
  expect(
    (
      await f.owner.query(
        'SELECT to_jsonb(t) data FROM app.outcome_projection t ORDER BY to_jsonb(t)::text',
      )
    ).rows,
  ).toEqual(before[7]);
});
test('independent reward approval is exact, append-only, duplicate-safe and separate from customer money', async () => {
  const t = await f.target(),
    sourceId = (await f.source()).id,
    rule = randomUUID(),
    task = randomUUID(),
    ledger = randomUUID();
  await write(
    "INSERT INTO app.reward_rule_version(id,tenant_id,key,version,amount_minor,currency,effective_from,effective_until,reason,created_by) VALUES($1,$2,$3,1,1000,'CNY',now()-interval '1 day',now()+interval '1 day',$4,$5)",
    [rule, f.tenantA, randomUUID(), reason, f.users.owner.id],
  );
  await write(
    'INSERT INTO app.contribution(id,tenant_id,mission_id,contributor_id,source_id,task_key,relationship_disclosure,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$4)',
    [task, f.tenantA, t.missionId, f.users.operator.id, sourceId, 'supplier-review', reason],
    f.ctx,
  );
  const sql =
    "INSERT INTO app.service_ledger(id,tenant_id,mission_id,kind,amount_minor,currency,source_id,contribution_id,rule_id,external_reference,occurred_at,reason,created_by) VALUES($1,$2,$3,'CONTRIBUTOR_REWARD',$4,$5,$6,$7,$8,$9,now(),$10,$11)";
  const values = [
    ledger,
    f.tenantA,
    t.missionId,
    '1000',
    'CNY',
    sourceId,
    task,
    rule,
    randomUUID(),
    reason,
    f.users.owner.id,
  ];
  await expect(write(sql, values, f.ctx)).rejects.toThrow();
  await expect(
    write(sql, [randomUUID(), ...values.slice(1, 4), 'USD', ...values.slice(5)]),
  ).rejects.toThrow();
  await write(sql, values);
  await expect(
    write(sql, [randomUUID(), ...values.slice(1, 8), randomUUID(), ...values.slice(9)]),
  ).rejects.toThrow();
  await expect(
    write('UPDATE app.service_ledger SET amount_minor=2000 WHERE id=$1', [ledger]),
  ).rejects.toThrow();
  expect(
    (
      await write(
        'SELECT * FROM app.service_margin WHERE mission_id=$1',
        [t.missionId],
        f.users.other.ctx,
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await write(
        'SELECT service_fees_minor,reward_obligation_minor,margin_minor FROM app.service_margin WHERE mission_id=$1',
        [t.missionId],
      )
    ).rows[0],
  ).toEqual({ service_fees_minor: '0', reward_obligation_minor: '1000', margin_minor: '-1000' });
  await expect(
    write(
      "INSERT INTO app.reward_reconciliation(id,tenant_id,ledger_id,source_id,status,version,reason,created_by) VALUES($1,$2,$3,$4,'MANUALLY_RECONCILED',1,$5,$6)",
      [randomUUID(), f.tenantA, ledger, sourceId, reason, f.users.owner.id],
    ),
  ).rejects.toThrow();
  await write(
    "INSERT INTO app.service_ledger(id,tenant_id,mission_id,kind,amount_minor,currency,source_id,contribution_id,rule_id,reverse_of,external_reference,occurred_at,reason,created_by) VALUES($1,$2,$3,'CONTRIBUTOR_REWARD',-1000,'CNY',$4,$5,$6,$7,$8,now(),$9,$10)",
    [
      randomUUID(),
      f.tenantA,
      t.missionId,
      sourceId,
      task,
      rule,
      ledger,
      randomUUID(),
      reason,
      f.users.owner.id,
    ],
  );
  expect(
    (await write('SELECT margin_minor FROM app.service_margin WHERE mission_id=$1', [t.missionId]))
      .rows[0].margin_minor,
  ).toBe('0');
});

test('SQL policy rejects unreviewed transfer approval, source AI overrides, forged actors and cross-tenant sources', async () => {
  const sourceId = (await f.source()).id;
  const sql =
    "INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,ai_permission,transfer_status,transfer_mechanism,effective_from,reason,created_by) VALUES($1,$2,$3,1,'Synthetic licence',ARRAY['INTERNAL_REVIEW'],'UNREVIEWED','synthetic_validation','INTERNAL',ARRAY['CN'],ARRAY['CN'],ARRAY['DE'],now()+interval '1 day',$4,$5,$6,now(),$7,$8)";
  const values = [
    randomUUID(),
    f.tenantA,
    sourceId,
    'DENY',
    'UNREVIEWED',
    null,
    reason,
    f.users.owner.id,
  ];
  await expect(write(sql, values, f.ctx)).rejects.toThrow();
  await expect(write(sql, values, f.users.other.ctx)).rejects.toThrow();
  await expect(
    write(sql, [
      randomUUID(),
      f.tenantA,
      sourceId,
      'REVIEW_REQUIRED',
      'UNREVIEWED',
      null,
      reason,
      f.users.owner.id,
    ]),
  ).rejects.toThrow();
  await expect(
    write(sql, [
      randomUUID(),
      f.tenantA,
      sourceId,
      'DENY',
      'APPROVED',
      null,
      reason,
      f.users.owner.id,
    ]),
  ).rejects.toThrow();
  await write(sql, values);
  expect(
    (
      await write(
        'SELECT id FROM app.data_rights_policy WHERE source_id=$1',
        [sourceId],
        f.users.other.ctx,
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    write("UPDATE app.data_rights_policy SET transfer_status='APPROVED' WHERE id=$1", [values[0]]),
  ).rejects.toThrow();
});
test('all six initial directions seed once as unapproved drafts and registries match database truth', async () => {
  const ids = await routes.seedInitialRoutes(f.users.owner.ctx);
  expect(ids).toHaveLength(6);
  expect(await routes.seedInitialRoutes(f.users.owner.ctx)).toEqual(ids);
  expect(
    (
      await write(
        'SELECT DISTINCT status FROM app.corridor_pack_version WHERE route_id=ANY($1::uuid[])',
        [ids],
      )
    ).rows,
  ).toEqual([{ status: 'DRAFT' }]);
  await expect(routes.seedInitialRoutes(f.ctx)).rejects.toThrow();
  const { currencies } = await import('../../packages/domain/src/currencies');
  const { countryCodes } = await import('../../packages/domain/src/countries');
  expect(
    Object.fromEntries(
      (await write('SELECT code,exponent FROM app.currency', [])).rows.map((r) => [
        r.code,
        r.exponent,
      ]),
    ),
  ).toEqual(currencies);
  expect(
    (await write('SELECT code FROM app.country ORDER BY code', [])).rows.map((r) => r.code),
  ).toEqual([...countryCodes]);
  expect((await write("SELECT kind FROM app.market_scope WHERE key='EU'", [])).rows[0].kind).toBe(
    'TRADE_BLOC',
  );
});

test('derived FX keeps exact rational provenance and refuses mixed-currency aggregation', async () => {
  const { deriveConversion, sumSameCurrency } = await import('../../packages/domain/src/economics');
  const fx = {
    source: 'Synthetic observed rate',
    observedAt: new Date().toISOString(),
    from: 'CNY',
    to: 'USD',
    numerator: '1',
    denominator: '2',
    method: 'RATIONAL_HALF_UP',
  };
  expect(deriveConversion('9007199254740993', fx)).toEqual({
    amountMinor: '4503599627370497',
    currency: 'USD',
    fx,
    authority: 'DERIVED_ONLY',
  });
  expect(() =>
    sumSameCurrency([
      { amountMinor: '100', currency: 'CNY' },
      { amountMinor: '100', currency: 'USD' },
    ]),
  ).toThrow();
  expect(
    sumSameCurrency([
      { amountMinor: '100', currency: 'CNY' },
      { amountMinor: '100', currency: 'CNY' },
    ]).amountMinor,
  ).toBe('200');
});

test('every new sensitive SQL write denies viewer, outsider and cross-tenant actors before business validation', async () => {
  const tables = [
    'corridor_definition',
    'corridor_route',
    'mission_type_definition',
    'requirement_definition',
    'assessment_definition',
    'corridor_pack_version',
    'mission_route_assignment',
    'commercial_origin',
    'data_rights_policy',
    'reward_rule_version',
    'contribution',
    'service_ledger',
    'reward_reconciliation',
  ];
  for (const label of ['viewer', 'outsider', 'other']) {
    const actor = f.users[label];
    for (const table of tables) {
      await expect(
        write(
          `INSERT INTO app.${table}(id,tenant_id,created_by) VALUES($1,$2,$3)`,
          [randomUUID(), f.tenantA, actor.id],
          actor.ctx,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  }
  for (const table of ['country', 'currency', 'market_scope', 'market_alias', 'market_member'])
    await expect(write(`INSERT INTO app.${table} DEFAULT VALUES`, [])).rejects.toMatchObject({
      code: '42501',
    });
});
