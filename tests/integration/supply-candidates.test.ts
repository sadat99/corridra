import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { candidateWorld, iso, refused, type CandidateWorld } from './supply-support';
import { rawContext } from './support';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { supplyWords } from '../../packages/domain/src/supply-sources';

// ADR-082 slice S3: source registry, candidates (manual and file), review, match and the company do-not-contact record. The
// world is the S2 world with the module open. Controls other than `module` are opened by the table owner, as the plan says.
const day = 86400000;
const notActive = 'This source is not active. Check its status and agreement.';
const contact = 'Remove contact details; personal data cannot be recorded here.';
const blocked = 'This company asked not to be contacted.';
let w: CandidateWorld;
let ids: { missionId: string; profileVersionId: string; sourceVersionId: string };
let sourceId: string;

beforeAll(async () => {
  w = await candidateWorld();
  const source = await w.staffSource();
  sourceId = source.sourceId;
  ids = {
    missionId: w.missionId,
    profileVersionId: await w.profile(),
    sourceVersionId: source.sourceVersionId,
  };
}, 120000);
afterAll(async () => {
  await w?.close();
});

const count = async (table: string, where = 'true', args: unknown[] = []) =>
  (await w.owner.query(`SELECT count(*)::int n FROM app.${table} WHERE ${where}`, args)).rows[0]
    .n as number;
const totals = async () => ({
  candidates: await count('supply_candidate'),
  records: await count('source_record'),
  claims: await count('claim'),
  commands: await count('supply_command'),
});
/** A direct call of a command function in a staff session, for the sentences the schema would stop earlier. */
const sql = (who: keyof typeof w.users, text: string, args: unknown[]) =>
  rawContext(w.runtime, w.users[who].ctx, text, args);
const sqlAdd = (who: keyof typeof w.users, over: Record<string, unknown> = {}, source = ids) => {
  const v = { ...w.candidateInput(), ...over } as Record<string, string | string[] | undefined>;
  return sql(
    who,
    'SELECT app.supply_add_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13,$14::timestamptz,$15) AS r',
    [
      w.tenantA,
      v.commandId,
      'a'.repeat(64),
      source.missionId,
      source.profileVersionId,
      source.sourceVersionId,
      v.companyName,
      v.country,
      v.websiteHost ?? null,
      v.publicIdentifier ?? null,
      v.sizeBand ?? null,
      v.counterpartyTypes ?? [],
      v.nominationNote ?? null,
      v.observedAt,
      v.sourceLocator,
    ],
  );
};
const decided = (who: keyof typeof w.users, candidateId: string, over: Record<string, unknown>) =>
  w.candidates.review(w.users[who].ctx, {
    commandId: randomUUID(),
    candidateId,
    decision: 'WRONG_FIT',
    reasonCode: 'not_a_buyer',
    reason: 'Checked the public page',
    ...over,
  });
const matched = (
  who: keyof typeof w.users,
  candidateId: string,
  over: Record<string, unknown> = {},
) =>
  w.candidates.match(w.users[who].ctx, {
    commandId: randomUUID(),
    candidateId,
    decision: 'MATCH',
    reason: 'Same name and country on the register',
    ...over,
  });
const block = (who: keyof typeof w.users, over: Record<string, unknown> = {}) =>
  w.candidates.blockCompany(w.users[who].ctx, {
    commandId: randomUUID(),
    reason: 'The company asked to be left alone',
    reference: 'ticket 41',
    ...over,
  });
const lift = (who: keyof typeof w.users, over: Record<string, unknown> = {}) =>
  w.candidates.liftCompany(w.users[who].ctx, {
    commandId: randomUUID(),
    reason: 'The company agreed to be listed',
    reference: 'ticket 42',
    ...over,
  });
const setMfa = (who: keyof typeof w.users, fresh: boolean) =>
  w.owner.query(
    `UPDATE identity.assurance SET verified_at=${fresh ? 'now()' : "now()-interval '1 hour'"} WHERE session_id=$1`,
    [w.users[who].sessionId],
  );
const newMission = async () => {
  const missionId = await w.mission(w.tenantA, w.users.operator.id);
  return { missionId, profileVersionId: await w.profile(missionId) };
};

describe('manual entry and the records it writes (P2, P3)', () => {
  test('a staff research candidate lands with its nomination source, one claim per fact and the source-reported label', async () => {
    const before = await totals();
    const made = await w.addCandidate('operator', ids, {
      companyName: 'Hotel Linen Importers Ltd',
      nominationNote: 'Found on the trade body list',
    });
    expect(made.warnings).toEqual([]);
    const after = await totals();
    expect(after.candidates).toBe(before.candidates + 1);
    expect(after.records).toBe(before.records + 1);
    expect(after.claims).toBe(before.claims + 6);
    expect(after.commands).toBe(before.commands + 1);
    const row = (
      await w.owner.query(
        `SELECT c.*,s.kind AS record_kind,s.classification,s.ai_policy,s.locator,s.retention_until AS record_retention,s.observed_at AS record_observed
         FROM app.supply_candidate c JOIN app.source_record s ON s.id=c.nomination_source_id WHERE c.id=$1`,
        [made.candidateId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      method: 'manual',
      company_name: 'Hotel Linen Importers Ltd',
      country: 'DE',
      website_host: 'acme.example',
      public_identifier: 'HRB 123456',
      size_band: 'small',
      counterparty_types: ['importer'],
      nomination_note: 'Found on the trade body list',
      name_key: 'hotellinenimporters',
      licence_scope: 'publication',
      record_kind: 'document',
      classification: 'PUBLIC',
      ai_policy: 'DENY',
      locator: 'https://registry.example/entry/1',
      created_by: w.users.operator.id,
      import_batch_id: null,
      network_task_id: null,
      sync_run_id: null,
      source_version_id: ids.sourceVersionId,
      profile_version_id: ids.profileVersionId,
    });
    expect(row.command_id).toBeTruthy();
    expect(row.retention_until.getTime()).toBe(row.record_retention.getTime());
    expect(row.observed_at.getTime()).toBe(row.record_observed.getTime());
    const claims = (
      await w.owner.query(
        'SELECT statement,status FROM app.claim WHERE source_id=$1 ORDER BY created_at,statement',
        [row.nomination_source_id],
      )
    ).rows;
    expect(claims.map((c) => c.statement).sort()).toEqual(
      [
        'Company name: Hotel Linen Importers Ltd',
        'Country: DE',
        'Website host: acme.example',
        'Public identifier: HRB 123456',
        'Size band: small',
        'Counterparty types: importer',
      ].sort(),
    );
    expect(new Set(claims.map((c) => c.status))).toEqual(new Set(['self_declared']));
  });

  test('every read says source-reported; nothing in the module says verified', async () => {
    const rows = await w.candidates.listCandidates(w.users.viewer.ctx, { missionId: w.missionId });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.state).toBe('source-reported');
      expect(supplyWords.sourceReported).toBe('source-reported');
      expect(r).toMatchObject({
        sourceKind: 'staff_research',
        method: 'manual',
        licenceScope: 'publication',
      });
      expect(r.observedAt).toBeTruthy();
      expect(r.retentionUntil).toBeTruthy();
    }
    for (const table of [
      'supply_source',
      'supply_source_version',
      'supply_import_batch',
      'supply_candidate',
      'supply_candidate_review',
      'supply_candidate_match',
      'supply_do_not_contact',
    ])
      expect(
        (
          await w.owner.query(
            `SELECT count(*)::int n FROM app.${table} t WHERE to_jsonb(t)::text ILIKE '%verified%'`,
          )
        ).rows[0].n,
        table,
      ).toBe(0);
  });

  test('the candidate has no contact columns, and the module adds exactly the seven tables of the plan', async () => {
    const columns = (
      await w.owner.query(
        `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='app'
         AND table_name IN ('supply_source','supply_source_version','supply_import_batch','supply_candidate','supply_candidate_review','supply_candidate_match','supply_do_not_contact')`,
      )
    ).rows;
    expect(
      columns.filter((c) =>
        /email|phone|mobile|contact_|person|principal|organisation_name|legal_name/i.test(
          c.column_name,
        ),
      ),
    ).toEqual([]);
    const tables = (
      await w.owner.query(
        "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND c.relname LIKE 'supply\\_%' ORDER BY 1",
      )
    ).rows.map((r) => r.relname);
    expect(tables).toEqual([
      'supply_candidate',
      'supply_candidate_match',
      'supply_candidate_review',
      'supply_command',
      'supply_do_not_contact',
      'supply_import_batch',
      'supply_source',
      'supply_source_control',
      'supply_source_version',
    ]);
    // No table that looks like an organisation record: every new table is a registry, a decision or a batch.
    expect(tables.some((t) => /organisation|company|member/.test(t))).toBe(false);
  });

  test('events carry ids and status only, never the words', async () => {
    const events = JSON.stringify(
      (
        await w.owner.query(
          "SELECT aggregate_type,payload FROM app.domain_event WHERE aggregate_type LIKE 'supply\\_%'",
        )
      ).rows,
    );
    expect(events).toContain('supply_candidate');
    for (const word of ['Hotel Linen', 'acme.example', 'HRB 123456', 'trade body list'])
      expect(events).not.toContain(word);
    expect(
      (
        await w.owner.query(
          "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type='supply_candidate'",
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  });

  test('an exact retry returns the same ids and writes nothing; changed content with the same id is refused', async () => {
    const input = { ...w.candidateInput(), ...ids };
    const first = await w.candidates.addCandidate(w.users.operator.ctx, input);
    const before = await totals();
    expect(await w.candidates.addCandidate(w.users.operator.ctx, input)).toEqual(first);
    expect(await totals()).toEqual(before);
    expect(
      await refused(
        w.candidates.addCandidate(w.users.operator.ctx, {
          ...input,
          companyName: 'Other Trading Ltd',
        }),
      ),
    ).toBe('Command ID reused with different values');
    expect(await totals()).toEqual(before);
  });

  test('email-shaped and phone-shaped company names and notes are refused with the exact sentence, in the schema and in SQL', async () => {
    const before = await totals();
    for (const over of [
      { companyName: 'jane@acme.example' },
      { companyName: 'Acme 030 1234 5678' },
      { companyName: 'Acme (030) 123-4567 Ltd' },
      { nominationNote: 'write to jane@acme.example' },
      { nominationNote: 'phone +49 30 1234567' },
    ]) {
      expect(await refused(w.addCandidate('operator', ids, over))).toContain(contact);
      expect(await refused(sqlAdd('operator', over))).toBe(contact);
    }
    expect(await refused(sqlAdd('operator', { publicIdentifier: 'a@b.example' }))).toBe(contact);
    expect(
      await refused(sqlAdd('operator', { sourceLocator: 'https://x.example/a@b.example' })),
    ).toBe(contact);
    expect(await totals()).toEqual(before);
    // A registration number that looks like a phone number is allowed in the identifier.
    const made = await w.addCandidate('operator', ids, { publicIdentifier: '12345678' });
    expect(made.candidateId).toBeTruthy();
  });

  test('a name with no legal-form word raises personal_name_check; a company with one does not', async () => {
    expect((await w.addCandidate('operator', ids, { companyName: 'Jane Smith' })).warnings).toEqual(
      ['personal_name_check'],
    );
    expect(
      (await w.addCandidate('operator', ids, { companyName: 'Acme Trading Ltd' })).warnings,
    ).toEqual([]);
    // The synthetic prefix is ignored the way the ADR-079 wrapper ignores it in a synthetic tenant.
    expect(
      (await w.addCandidate('operator', ids, { companyName: 'Synthetic Jane Smith' })).warnings,
    ).toEqual(['personal_name_check']);
  });

  test('the mission and the profile must fit: closed mission, other tenant, other mission profile, unknown source', async () => {
    const closed = randomUUID();
    await w.owned(
      (db) =>
        db.query(
          `INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by,status) VALUES($1,$2,$3,'Closed work',now()+interval '1 day','Closed supply mission',$3,'CLOSED')`,
          [closed, w.tenantA, w.users.operator.id],
        ),
      true,
    );
    await w.owned(
      (db) =>
        db.query(
          `INSERT INTO app.counterparty_profile_version(tenant_id,mission_id,role,version,fields,fields_digest,reason,created_by)
           SELECT $1,$2,'BUYER',1,fields,fields_digest,'Profile on a closed mission',$3 FROM app.counterparty_profile_version LIMIT 1`,
          [w.tenantA, closed, w.users.operator.id],
        ),
      true,
    );
    const closedProfile = (
      await w.owner.query('SELECT id FROM app.counterparty_profile_version WHERE mission_id=$1', [
        closed,
      ])
    ).rows[0].id;
    let before = await totals();
    expect(
      await refused(
        w.addCandidate('operator', { ...ids, missionId: closed, profileVersionId: closedProfile }),
      ),
    ).toBe(supplyWords.missionClosed);
    const other = await newMission();
    before = await totals();
    expect(await refused(w.addCandidate('operator', { ...ids, missionId: other.missionId }))).toBe(
      supplyWords.profileUnavailable,
    );
    expect(await refused(w.addCandidate('operator', { ...ids, missionId: randomUUID() }))).toBe(
      supplyWords.missionUnavailable,
    );
    expect(
      await refused(w.addCandidate('operator', { ...ids, sourceVersionId: randomUUID() })),
    ).toBe(notActive);
    expect(
      await refused(w.addCandidate('operator', { ...ids, missionId: w.otherMissionId })),
    ).toBeTruthy();
    expect(await totals()).toEqual(before);
  });

  test('observed in the future, or long enough ago that its retention has passed, is refused', async () => {
    const before = await totals();
    expect(await refused(sqlAdd('operator', { observedAt: iso(day * 2) }))).toBe(
      supplyWords.futureDate,
    );
    expect(await refused(w.addCandidate('operator', ids, { observedAt: iso(-day * 400) }))).toBe(
      supplyWords.retentionPassed,
    );
    expect(await totals()).toEqual(before);
  });
});

describe('the source registry', () => {
  test('staff research needs no agreement and no source record; a partner source cannot be active without one', async () => {
    const staff = await w.staffSource({ label: 'Staff research, second source' });
    expect(staff.version).toBe(1);
    expect(
      (
        await w.owner.query('SELECT source_record_id FROM app.supply_source_version WHERE id=$1', [
          staff.sourceVersionId,
        ])
      ).rows[0].source_record_id,
    ).toBeNull();
    await w.openControl('partner_kinds');
    // Without a source record: refused even for the owner with fresh MFA.
    expect(
      await refused(
        w.candidates.createSource(w.users.owner.ctx, {
          commandId: randomUUID(),
          kind: 'partner_organisation',
          status: 'active',
          label: 'Partner without record',
          defaultRetentionMonths: 6,
          reason: 'Trying to activate without an agreement',
        }),
      ),
    ).toBe(supplyWords.needsAgreement);
    // A record with no rights policy is not enough either.
    const bare = await w.sourceRecord();
    expect(
      await refused(
        w.candidates.createSource(w.users.owner.ctx, {
          commandId: randomUUID(),
          kind: 'partner_organisation',
          status: 'active',
          label: 'Partner without rights',
          sourceRecordId: bare,
          defaultRetentionMonths: 6,
          reason: 'Record but no rights policy',
        }),
      ),
    ).toBe(supplyWords.needsAgreement);
    // It can exist as no_agreement, made by an operator.
    const waiting = await w.candidates.createSource(w.users.operator.ctx, {
      commandId: randomUUID(),
      kind: 'partner_organisation',
      status: 'no_agreement',
      label: 'Partner waiting for an agreement',
      defaultRetentionMonths: 6,
      reason: 'Registered while the agreement is signed',
    });
    expect(waiting.version).toBe(1);
    await w.openControl('partner_kinds', false);
  });

  test('activating a partner source takes an owner or admin with fresh MFA, and the control, record and rights', async () => {
    await w.openControl('partner_kinds');
    const record = await w.sourceRecord();
    await w.rightsPolicy(record);
    const input = (over = {}) => ({
      commandId: randomUUID(),
      kind: 'partner_organisation',
      status: 'active',
      label: 'Agreement partner',
      sourceRecordId: record,
      defaultRetentionMonths: 6,
      reason: 'Agreement signed with current rights',
      ...over,
    });
    const before = await count('supply_source');
    expect(await refused(w.candidates.createSource(w.users.operator.ctx, input()))).toBe(
      'Access denied',
    );
    await setMfa('owner', false);
    expect(await refused(w.candidates.createSource(w.users.owner.ctx, input()))).toBe(
      'Access denied',
    );
    await setMfa('owner', true);
    await w.openControl('partner_kinds', false);
    expect(await refused(w.candidates.createSource(w.users.owner.ctx, input()))).toBe(
      supplyWords.needsAgreement,
    );
    await w.openControl('partner_kinds');
    const made = await w.candidates.createSource(w.users.owner.ctx, input());
    expect(made.version).toBe(1);
    expect(await count('supply_source')).toBe(before + 1);
    await w.openControl('partner_kinds', false);
  });

  test('pause, resume and retire are new versions; a stale expected version is refused with the reload sentence', async () => {
    const s = await w.staffSource({ label: 'Source to pause' });
    const step = (over: Record<string, unknown>) =>
      w.candidates.addSourceVersion(w.users.operator.ctx, {
        commandId: randomUUID(),
        sourceId: s.sourceId,
        expectedVersion: 1,
        status: 'paused',
        label: 'Source to pause',
        defaultRetentionMonths: 6,
        reason: 'Pause while the page is checked',
        ...over,
      });
    expect((await step({})).version).toBe(2);
    expect(await refused(step({}))).toBe(supplyWords.staleSource);
    expect(
      (await step({ expectedVersion: 2, status: 'active', reason: 'Resume after the check' }))
        .version,
    ).toBe(3);
    expect(
      (await step({ expectedVersion: 3, status: 'retired', reason: 'Retire the source' })).version,
    ).toBe(4);
    const versions = await w.candidates.sourceVersions(w.users.viewer.ctx, s.sourceId);
    expect(
      (versions as { version: number; status: string }[]).map((v) => [v.version, v.status]),
    ).toEqual([
      [4, 'retired'],
      [3, 'active'],
      [2, 'paused'],
      [1, 'active'],
    ]);
    const listed = (await w.candidates.listSources(w.users.viewer.ctx)).find(
      (x) => x.id === s.sourceId,
    )!;
    expect(listed).toMatchObject({ version: 4, status: 'retired', kind: 'staff_research' });
    // The kind never changes and nothing is rewritten.
    expect(
      await refused(w.owner.query("UPDATE app.supply_source SET kind='data_platform'")),
    ).toBeTruthy();
    expect(await refused(w.owner.query('DELETE FROM app.supply_source_version'))).toBeTruthy();
  });

  test('a direct insert is held to the same version order, and a retry returns the first version', async () => {
    const s = await w.staffSource({ label: 'Source for direct insert' });
    expect(
      await refused(
        w.owned((db) =>
          db.query(
            `INSERT INTO app.supply_source_version(tenant_id,source_id,version,status,label,default_retention_months,reason,created_by,command_id)
             VALUES($1,$2,3,'paused','Skips a version',6,'Skipping a version number',$3,gen_random_uuid())`,
            [w.tenantA, s.sourceId, w.users.owner.id],
          ),
        ),
      ),
    ).toBe(supplyWords.staleSource);
    const input = {
      commandId: randomUUID(),
      sourceId: s.sourceId,
      expectedVersion: 1,
      status: 'paused',
      label: 'Source for direct insert',
      defaultRetentionMonths: 6,
      reason: 'Pause for the retry test',
    };
    const first = await w.candidates.addSourceVersion(w.users.operator.ctx, input);
    expect(await w.candidates.addSourceVersion(w.users.operator.ctx, input)).toEqual(first);
    expect(
      await refused(
        w.candidates.addSourceVersion(w.users.operator.ctx, { ...input, status: 'retired' }),
      ),
    ).toBe('Command ID reused with different values');
  });
});

describe('the intake rule (source usable)', () => {
  test('not the latest version, paused, expired, retired and no_agreement all answer the not active sentence and write nothing', async () => {
    const m = await newMission();
    const s = await w.staffSource({ label: 'Source with every status' });
    const first = s.sourceVersionId;
    const before = await totals();
    let expected = 1;
    for (const status of ['paused', 'expired', 'retired', 'no_agreement']) {
      const next = await w.candidates.addSourceVersion(w.users.operator.ctx, {
        commandId: randomUUID(),
        sourceId: s.sourceId,
        expectedVersion: expected,
        status,
        label: 'Source with every status',
        defaultRetentionMonths: 6,
        reason: `Set to ${status}`,
      });
      expected += 1;
      expect(
        await refused(w.addCandidate('operator', { ...m, sourceVersionId: next.sourceVersionId })),
      ).toBe(notActive);
    }
    // The first version is active but no longer the latest.
    expect(await refused(w.addCandidate('operator', { ...m, sourceVersionId: first }))).toBe(
      notActive,
    );
    expect(await totals()).toEqual({ ...before, commands: before.commands + 4 });
  });

  test('a partner source: control closed, agreement ended, rights lapsed, route without the category all refuse', async () => {
    const m = await newMission();
    const a = await w.agreementSource('partner_organisation', m.missionId);
    const ids2 = { ...m, sourceVersionId: a.sourceVersionId };
    expect((await w.addCandidate('operator', ids2)).candidateId).toBeTruthy();
    const before = await totals();
    // Control closed.
    await w.openControl('partner_kinds', false);
    expect(await refused(w.addCandidate('operator', ids2))).toBe(notActive);
    await w.openControl('partner_kinds');
    expect((await w.addCandidate('operator', ids2)).candidateId).toBeTruthy();
    const after = await totals();
    // Rights lapsed: a newer policy version whose retention has passed.
    await w.owned(
      (db) =>
        db.query(
          `INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,effective_from,reason,created_by)
           SELECT gen_random_uuid(),tenant_id,source_id,version+1,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,now()-interval '1 minute',now()-interval '1 hour',reason,created_by
           FROM app.data_rights_policy WHERE source_id=$1 ORDER BY version DESC LIMIT 1`,
          [a.record],
        ),
      true,
    );
    expect(await refused(w.addCandidate('operator', ids2))).toBe(notActive);
    // Agreement ended: a later version of the source, active, with an end in the past (owner insert, guard skipped).
    const ended = await w.agreementSource('partner_person', m.missionId);
    await w.owned(
      (db) =>
        db.query(
          `INSERT INTO app.supply_source_version(tenant_id,source_id,version,status,label,source_record_id,default_retention_months,agreement_ends_at,reason,created_by,command_id)
           SELECT tenant_id,source_id,2,'active',label,source_record_id,default_retention_months,now()-interval '1 minute','Agreement has ended',created_by,command_id FROM app.supply_source_version WHERE id=$1`,
          [ended.sourceVersionId],
        ),
      true,
    );
    const endedLatest = (
      await w.owner.query(
        'SELECT id FROM app.supply_source_version WHERE source_id=$1 AND version=2',
        [ended.sourceId],
      )
    ).rows[0].id;
    expect(await refused(w.addCandidate('operator', { ...m, sourceVersionId: endedLatest }))).toBe(
      notActive,
    );
    // Route without the category: the pack lists only the other kind.
    const other = await newMission();
    const platform = await w.agreementSource('data_platform');
    await w.routePack(other.missionId, 'TESTING', ['supply.partner_person']);
    const settled = await totals();
    expect(
      await refused(
        w.addCandidate('operator', { ...other, sourceVersionId: platform.sourceVersionId }),
      ),
    ).toBe(notActive);
    expect(await totals()).toEqual(settled);
    expect(before.candidates + 1).toBe(after.candidates);
  });
});

describe('route binding (P9)', () => {
  test('a pack that is DRAFT, PAUSED, absent or lists nothing offers staff research only; TESTING, LIMITED and ACTIVE offer the listed kinds', async () => {
    for (const status of ['DRAFT', 'PAUSED', 'TESTING', 'LIMITED', 'ACTIVE']) {
      const m = await newMission();
      const a = await w.agreementSource('partner_organisation');
      await w.routePack(m.missionId, status, ['supply.partner_organisation']);
      const offered = await w.candidates.kindsOnRoute(w.users.viewer.ctx, m.missionId);
      const allowed = ['TESTING', 'LIMITED', 'ACTIVE'].includes(status);
      expect(offered, status).toEqual(
        allowed ? ['staff_research', 'partner_organisation'] : ['staff_research'],
      );
      const result = await refused(
        w.addCandidate('operator', { ...m, sourceVersionId: a.sourceVersionId }),
      );
      expect(result, status).toBe(allowed ? null : notActive);
      // Staff research is always allowed, on every route.
      const staff = await w.staffSource({ label: `Staff on ${status}` });
      expect(
        (await w.addCandidate('operator', { ...m, sourceVersionId: staff.sourceVersionId }))
          .candidateId,
      ).toBeTruthy();
    }
    const none = await newMission();
    expect(await w.candidates.kindsOnRoute(w.users.viewer.ctx, none.missionId)).toEqual([
      'staff_research',
    ]);
  });

  test('a new pack version listing another kind changes only the offered kinds', async () => {
    const m = await newMission();
    await w.routePack(m.missionId, 'TESTING', ['supply.partner_person']);
    expect(await w.candidates.kindsOnRoute(w.users.viewer.ctx, m.missionId)).toEqual([
      'staff_research',
      'partner_person',
    ]);
    await w.routePack(m.missionId, 'ACTIVE', ['supply.partner_person', 'supply.data_platform']);
    expect(await w.candidates.kindsOnRoute(w.users.viewer.ctx, m.missionId)).toEqual([
      'staff_research',
      'partner_person',
      'data_platform',
    ]);
  });
});

describe('retention (R3)', () => {
  test('a candidate whose source record ends in two seconds reads expired with its words masked, and cannot be qualified or matched', async () => {
    const record = await w.sourceRecord(2000);
    const s = await w.staffSource({ label: 'Short lived record', sourceRecordId: record });
    const org = await w.organisation('Quick Expiry Imports Ltd');
    const made = await w.addCandidate(
      'operator',
      { ...ids, sourceVersionId: s.sourceVersionId },
      { companyName: 'Quick Expiry Ltd', nominationNote: 'Seen once' },
    );
    const live = (
      await w.candidates.listCandidates(w.users.viewer.ctx, { missionId: w.missionId })
    ).find((c) => c.id === made.candidateId)!;
    expect(live).toMatchObject({
      expired: false,
      companyName: 'Quick Expiry Ltd',
      websiteHost: 'acme.example',
      nominationNote: 'Seen once',
    });
    await new Promise((done) => setTimeout(done, 2500));
    const gone = (
      await w.candidates.listCandidates(w.users.viewer.ctx, { missionId: w.missionId })
    ).find((c) => c.id === made.candidateId)!;
    expect(gone).toMatchObject({
      expired: true,
      companyName: null,
      websiteHost: null,
      publicIdentifier: null,
      nominationNote: null,
      state: 'source-reported',
    });
    expect(
      (await w.candidates.candidate(w.users.viewer.ctx, made.candidateId))!.companyName,
    ).toBeNull();
    expect(await refused(decided('operator', made.candidateId, { decision: 'QUALIFIED' }))).toBe(
      supplyWords.expired,
    );
    expect(await refused(matched('operator', made.candidateId, { organisationId: org }))).toBe(
      supplyWords.expired,
    );
    // Other decisions can still be recorded on an expired candidate.
    expect(
      (
        await decided('operator', made.candidateId, {
          decision: 'EXPIRED',
          reasonCode: 'retention_over',
        })
      ).reviewId,
    ).toBeTruthy();
    expect(
      await w.owner.query(
        'SELECT count(*)::int n FROM app.supply_candidate_match WHERE candidate_id=$1',
        [made.candidateId],
      ),
    ).toMatchObject({ rows: [{ n: 0 }] });
  });

  test('retention is the earliest of the source record, the rights policy, the agreement end and the default months', async () => {
    const observed = iso(-day);
    const when = (offset: number) => new Date(Date.now() + offset).getTime();
    const tolerance = 5 * 60 * 1000;
    const near = (actual: Date, expected: number) =>
      expect(Math.abs(actual.getTime() - expected)).toBeLessThan(tolerance);
    const retentionOf = async (id: string) =>
      (await w.owner.query('SELECT retention_until FROM app.supply_candidate WHERE id=$1', [id]))
        .rows[0].retention_until as Date;
    // The source record is the shortest.
    const short = await w.staffSource({
      label: 'Record is shortest',
      sourceRecordId: await w.sourceRecord(10 * day),
      agreementEndsAt: iso(50 * day),
    });
    near(
      await retentionOf(
        (
          await w.addCandidate(
            'operator',
            { ...ids, sourceVersionId: short.sourceVersionId },
            { observedAt: observed },
          )
        ).candidateId,
      ),
      when(10 * day),
    );
    // The agreement end is the shortest.
    const agree = await w.staffSource({
      label: 'Agreement is shortest',
      sourceRecordId: await w.sourceRecord(100 * day),
      agreementEndsAt: iso(20 * day),
    });
    near(
      await retentionOf(
        (
          await w.addCandidate(
            'operator',
            { ...ids, sourceVersionId: agree.sourceVersionId },
            { observedAt: observed },
          )
        ).candidateId,
      ),
      when(20 * day),
    );
    // The default months from the observation are the shortest.
    const months = await w.staffSource({
      label: 'Months are shortest',
      defaultRetentionMonths: 1,
      sourceRecordId: await w.sourceRecord(300 * day),
    });
    const monthEnd = new Date(Date.now() - day);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    near(
      await retentionOf(
        (
          await w.addCandidate(
            'operator',
            { ...ids, sourceVersionId: months.sourceVersionId },
            { observedAt: observed },
          )
        ).candidateId,
      ),
      monthEnd.getTime(),
    );
    // The rights policy of an agreement source is the shortest.
    const m = await newMission();
    const partner = await w.agreementSource('partner_organisation', m.missionId);
    await w.owned(
      (db) =>
        db.query(
          `INSERT INTO app.data_rights_policy(id,tenant_id,source_id,version,licence,permitted_reuse,data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,retention_until,effective_from,reason,created_by)
       SELECT gen_random_uuid(),tenant_id,source_id,version+1,licence,ARRAY['INTERNAL_REVIEW'],data_role,data_purpose,data_classification,jurisdictions,subject_locations,processing_locations,now()+interval '30 days',now()-interval '1 minute',reason,created_by
       FROM app.data_rights_policy WHERE source_id=$1 ORDER BY version DESC LIMIT 1`,
          [partner.record],
        ),
      true,
    );
    const viaPartner = await w.addCandidate(
      'operator',
      { ...m, sourceVersionId: partner.sourceVersionId },
      { observedAt: observed },
    );
    near(await retentionOf(viaPartner.candidateId), when(30 * day));
    // The licence scope follows the current policy: this one no longer permits publication.
    expect(
      (
        await w.owner.query('SELECT licence_scope FROM app.supply_candidate WHERE id=$1', [
          viaPartner.candidateId,
        ])
      ).rows[0].licence_scope,
    ).toBe('internal_only');
  });
});

describe('column contract for connector rows', () => {
  test('a connector row may have no command id and needs a run id; every other method needs a command id', async () => {
    await configureSyntheticIntake(w.owner, w.tenantA, w.users.owner.id);
    const service = (await w.owner.query('SELECT service_id FROM app.intake_destination')).rows[0]
      .service_id as string;
    const record = (
      await w.owned((db) =>
        db.query('SELECT nomination_source_id FROM app.supply_candidate LIMIT 1'),
      )
    ).rows[0].nomination_source_id;
    const insert = (over: Record<string, unknown>) => {
      const v = {
        method: 'connector',
        sync_run_id: randomUUID(),
        command_id: null,
        import_batch_id: null,
        ...over,
      };
      return w.owned((db) =>
        db.query(
          `INSERT INTO app.supply_candidate(tenant_id,mission_id,profile_version_id,source_version_id,method,import_batch_id,sync_run_id,external_key,company_name,country,name_key,nomination_source_id,observed_at,retention_until,licence_scope,created_by,command_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Connector Trading Ltd','DE','connectortrading',$9,now()-interval '1 hour',now()+interval '30 days','internal_only',$10,$11)`,
          [
            w.tenantA,
            ids.missionId,
            ids.profileVersionId,
            ids.sourceVersionId,
            v.method,
            v.import_batch_id,
            v.sync_run_id,
            `key-${randomUUID()}`,
            record,
            service,
            v.command_id,
          ],
        ),
      );
    };
    await insert({});
    expect(await refused(insert({ method: 'manual', sync_run_id: null }))).toMatch(
      /check constraint/,
    );
    expect(await refused(insert({ sync_run_id: null }))).toMatch(/check constraint/);
    expect(await refused(insert({ method: 'manual', command_id: randomUUID() }))).toMatch(
      /check constraint/,
    );
    const row = (
      await w.owner.query(
        "SELECT created_by,command_id FROM app.supply_candidate WHERE method='connector'",
      )
    ).rows[0];
    expect(row).toEqual({ created_by: service, command_id: null });
    expect(
      (
        await w.owner.query(
          "SELECT count(*)::int n FROM app.domain_event WHERE aggregate_type='supply_candidate' AND actor_id=$1",
          [service],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('review and match', () => {
  test('a candidate is reviewed append only, and the latest review shows', async () => {
    const made = await w.addCandidate('operator', ids, { companyName: 'Review Me Trading Ltd' });
    await decided('operator', made.candidateId, { decision: 'WRONG_FIT' });
    await decided('owner', made.candidateId, {
      decision: 'QUALIFIED',
      reasonCode: 'fits_brief',
      reason: 'Imports hotel linen',
    });
    const detail = (await w.candidates.candidate(w.users.viewer.ctx, made.candidateId))!;
    expect(detail.latestReview).toMatchObject({ decision: 'QUALIFIED', reasonCode: 'fits_brief' });
    expect(detail.reviews.map((r) => r.decision)).toEqual(['QUALIFIED', 'WRONG_FIT']);
    expect(await w.candidates.candidate(w.users.viewer.ctx, randomUUID())).toBeNull();
    expect(
      await refused(w.owner.query("UPDATE app.supply_candidate_review SET decision='WRONG_FIT'")),
    ).toBeTruthy();
    expect(await refused(decided('operator', randomUUID(), {}))).toBe(
      supplyWords.candidateUnavailable,
    );
    expect(
      await refused(decided('operator', made.candidateId, { reason: 'ask jane@acme.example' })),
    ).toBeTruthy();
  });

  test('a partner candidate cannot be qualified by the person who submitted it', async () => {
    const made = await w.addCandidate('operator', ids, {
      companyName: 'Partner Submitted Trading Ltd',
    });
    const row = (
      await w.owner.query('SELECT * FROM app.supply_candidate WHERE id=$1', [made.candidateId])
    ).rows[0];
    const task = randomUUID();
    const inserted = await w.owned(async (db) => {
      const command = randomUUID();
      await db.query(
        "INSERT INTO app.supply_command(id,tenant_id,command_id,actor_kind,staff_actor,action,request_hash,result) VALUES($1,$2,$3,'staff',$4,'add_candidate',$5,'{}')",
        [command, w.tenantA, randomUUID(), w.users.operator.id, 'b'.repeat(64)],
      );
      const id = randomUUID();
      await db.query(
        `INSERT INTO app.supply_candidate(id,tenant_id,mission_id,profile_version_id,source_version_id,method,network_task_id,company_name,country,name_key,nomination_source_id,observed_at,retention_until,licence_scope,created_by,command_id)
         VALUES($1,$2,$3,$4,$5,'partner_submission',$6,'Partner Sent Trading Ltd','DE','partnersenttrading',$7,$8,$9,'internal_only',$10,$11)`,
        [
          id,
          w.tenantA,
          row.mission_id,
          row.profile_version_id,
          row.source_version_id,
          task,
          row.nomination_source_id,
          row.observed_at,
          row.retention_until,
          w.users.operator.id,
          command,
        ],
      );
      return id;
    }, true);
    expect(
      await refused(
        decided('operator', inserted, { decision: 'QUALIFIED', reasonCode: 'fits_brief' }),
      ),
    ).toBe(supplyWords.independentReview);
    expect(
      (await decided('owner', inserted, { decision: 'QUALIFIED', reasonCode: 'fits_brief' }))
        .reviewId,
    ).toBeTruthy();
  });

  test('a match: licensed and unclassified sources are refused, unrecorded and public ones are allowed', async () => {
    const m = await w.addCandidate('operator', ids, { companyName: 'Matchable Trading Ltd' });
    const cases: [string, string | undefined, string | null][] = [
      ['Licensed Dataset Ltd', 'licensed_dataset', supplyWords.licensed],
      ['Unclassified Source Ltd', 'other', supplyWords.licensed],
      ['Unrecorded Rights Ltd', undefined, null],
      ['Registry Entry Ltd', 'government_registry', null],
      ['Company Website Ltd', 'company_website', null],
    ];
    for (const [name, rights, expected] of cases) {
      const org = await w.organisation(name, 'DE', rights);
      const outcome = await refused(matched('operator', m.candidateId, { organisationId: org }));
      expect(outcome, name).toBe(expected);
      if (expected === null) {
        const current = (await w.candidates.candidate(w.users.viewer.ctx, m.candidateId))!;
        await matched('operator', m.candidateId, {
          decision: 'REVERSE',
          reverseOf: current.latestMatch!.id,
          reason: 'Undo for the next case',
        });
      }
    }
  });

  test('suppressed, other-context and unknown organisations are refused; a blocked one too', async () => {
    const m = await w.addCandidate('operator', ids, { companyName: 'Context Trading Ltd' });
    const hidden = await w.organisation('Hidden Trading Ltd');
    await w.owned(
      (db) =>
        db.query(
          `INSERT INTO customer_private.organisation_suppression(organisation_id,version,state,reason,reference,staff_actor,command_id,request) VALUES($1,1,'hidden','Takedown requested','ticket 9',$2,gen_random_uuid(),'{}')`,
          [hidden, w.users.owner.id],
        ),
      true,
    );
    const real = await w.organisation('Real Side Trading Ltd', 'DE', undefined, false);
    for (const org of [hidden, real, randomUUID()])
      expect(await refused(matched('operator', m.candidateId, { organisationId: org })), org).toBe(
        supplyWords.organisationUnavailable,
      );
    const wall = await w.organisation('Walled Trading Ltd');
    await block('operator', { organisationId: wall });
    expect(await refused(matched('operator', m.candidateId, { organisationId: wall }))).toBe(
      blocked,
    );
    expect(await count('supply_candidate_match', 'candidate_id=$1', [m.candidateId])).toBe(0);
  });

  test('a second match needs the first reversed; a reverse must name the latest match; reverse then match again is allowed', async () => {
    const m = await w.addCandidate('operator', ids, { companyName: 'Rematch Trading Ltd' });
    const a = await w.organisation('Rematch A Ltd');
    const b = await w.organisation('Rematch B Ltd');
    const first = await matched('operator', m.candidateId, { organisationId: a });
    expect(await refused(matched('operator', m.candidateId, { organisationId: b }))).toBe(
      supplyWords.reverseFirst,
    );
    expect(
      await refused(
        matched('operator', m.candidateId, { decision: 'REVERSE', reverseOf: randomUUID() }),
      ),
    ).toBe(supplyWords.reverseLatest);
    const undone = await matched('operator', m.candidateId, {
      decision: 'REVERSE',
      reverseOf: first.matchId,
    });
    expect(undone.matchId).not.toBe(first.matchId);
    expect(
      await refused(
        matched('operator', m.candidateId, { decision: 'REVERSE', reverseOf: first.matchId }),
      ),
    ).toBe(supplyWords.reverseLatest);
    const second = await matched('operator', m.candidateId, { organisationId: b });
    expect(second.matchId).toBeTruthy();
    expect(
      (await matched('operator', m.candidateId, { decision: 'NO_MATCH', organisationId: a }))
        .matchId,
    ).toBeTruthy();
    const detail = (await w.candidates.candidate(w.users.viewer.ctx, m.candidateId))!;
    expect(
      detail.matches
        .filter((x) => x.decision === 'MATCH')
        .map((x) => [x.organisationName, x.reversed]),
    ).toEqual([
      ['Rematch B Ltd', false],
      ['Rematch A Ltd', true],
    ]);
    expect(detail.latestMatch).toMatchObject({ decision: 'NO_MATCH' });
    // The current match is the newest un-reversed MATCH, which is the only decision a reverse may name.
    expect(detail.currentMatch).toMatchObject({ id: second.matchId, decision: 'MATCH' });
    expect(
      (await w.candidates.listCandidates(w.users.viewer.ctx, { missionId: ids.missionId })).find(
        (c) => c.id === m.candidateId,
      )?.currentMatch,
    ).toMatchObject({ id: second.matchId });
    expect(
      await refused(
        matched('operator', m.candidateId, { decision: 'REVERSE', reverseOf: undone.matchId }),
      ),
    ).toBe(supplyWords.reverseLatest);
    expect(
      (await matched('operator', m.candidateId, { decision: 'REVERSE', reverseOf: second.matchId }))
        .matchId,
    ).toBeTruthy();
    expect((await w.candidates.candidate(w.users.viewer.ctx, m.candidateId))!.currentMatch).toBe(
      null,
    );
    expect(
      await refused(w.owner.query("UPDATE app.supply_candidate_match SET reason='x y z'")),
    ).toBeTruthy();
  });

  test('two matches of one candidate at the same time leave one un-reversed match, and the candidate lock holds a second decider', async () => {
    const m = await w.addCandidate('operator', ids, { companyName: 'Racing Trading Ltd' });
    const a = await w.organisation('Racing A Ltd');
    const b = await w.organisation('Racing B Ltd');
    const results = await Promise.allSettled([
      matched('operator', m.candidateId, { organisationId: a }),
      matched('owner', m.candidateId, { organisationId: b }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ message: supplyWords.reverseFirst });
    expect(
      await count(
        'supply_candidate_match',
        "candidate_id=$1 AND decision='MATCH' AND NOT EXISTS(SELECT FROM app.supply_candidate_match u WHERE u.reverse_of=app.supply_candidate_match.id)",
        [m.candidateId],
      ),
    ).toBe(1);
    // The lock is taken on the tenant and candidate: while another session holds that key, the command waits.
    const holder = await w.owner.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1||':supply-candidate:'||$2,0))",
        [w.tenantA, m.candidateId],
      );
      const waiting = decided('operator', m.candidateId, {
        decision: 'DUPLICATE',
        reasonCode: 'same_company',
      });
      const raced = await Promise.race([
        waiting.then(() => 'finished'),
        new Promise((resolve) => setTimeout(() => resolve('waiting'), 500)),
      ]);
      expect(raced).toBe('waiting');
      await holder.query('COMMIT');
      expect((await waiting).reviewId).toBeTruthy();
    } finally {
      holder.release();
    }
  });
});

describe('file import (D6)', () => {
  const row = (n: number, over: Record<string, string> = {}) => ({
    row: n,
    cells: {
      company_name: `File Trading ${n} Ltd`,
      country: 'DE',
      website_host: `file${n}.example`,
      public_identifier: `HRB ${n}`,
      size_band: 'small',
      counterparty_types: 'importer|distributor',
      observed_at: iso(-day),
      source_locator: `https://registry.example/${n}`,
      ...over,
    },
  });
  const digestOf = (label: string) => createHash('sha256').update(label).digest('hex');
  const upload = (
    who: keyof typeof w.users,
    rows: ReturnType<typeof row>[],
    over: Record<string, unknown> = {},
  ) =>
    w.candidates.importFile(w.users[who].ctx, {
      commandId: randomUUID(),
      ...ids,
      digest: digestOf(randomUUID()),
      rows,
      ...over,
    });
  const batches = () => count('supply_import_batch');

  test('refused while staff_file_import is closed, and nothing is written', async () => {
    const before = await totals();
    expect(await refused(upload('operator', [row(2)]))).toBe(supplyWords.fileClosed);
    expect(await batches()).toBe(0);
    expect(await totals()).toEqual(before);
    await w.openControl('staff_file_import');
  });

  test('good rows land, bad rows are reported by row and code, and no row text is stored with the codes', async () => {
    await block('operator', { companyName: 'Blocked File Trading Ltd', country: 'DE' });
    const rows = [
      row(2),
      row(3, { country: 'XX' }),
      row(4, { size_band: 'huge' }),
      row(5, { counterparty_types: 'importer|spaceship' }),
      row(6, { observed_at: 'not a date' }),
      row(7, { company_name: 'x'.repeat(161) }),
      row(8, { company_name: 'jane@acme.example' }),
      row(9, { company_name: 'Blocked File Trading Ltd' }),
      row(10, { company_name: '' }),
      row(11, { website_host: 'bad host!' }),
      row(12, { source_locator: '' }),
      row(13),
      row(14, { company_name: 'Phone 030 1234 5678 Ltd' }),
      row(15, { observed_at: iso(day * 3) }),
    ];
    const before = await totals();
    const done = await upload('operator', rows);
    expect(done).toMatchObject({ accepted: 2, rejected: 12, duplicate: false });
    const batch = (
      await w.owner.query('SELECT * FROM app.supply_import_batch WHERE id=$1', [done.batchId])
    ).rows[0];
    expect(batch).toMatchObject({
      row_count: 14,
      accepted_count: 2,
      rejected_count: 12,
      mission_id: ids.missionId,
      source_version_id: ids.sourceVersionId,
      profile_version_id: ids.profileVersionId,
      created_by: w.users.operator.id,
    });
    expect(batch.row_results).toEqual([
      { row: 2, code: 'ok' },
      { row: 3, code: 'bad_country' },
      { row: 4, code: 'bad_size' },
      { row: 5, code: 'bad_types' },
      { row: 6, code: 'bad_date' },
      { row: 7, code: 'too_long' },
      { row: 8, code: 'contact_details' },
      { row: 9, code: 'dnc_blocked' },
      { row: 10, code: 'bad_name' },
      { row: 11, code: 'bad_host' },
      { row: 12, code: 'bad_locator' },
      { row: 13, code: 'ok' },
      { row: 14, code: 'contact_details' },
      { row: 15, code: 'bad_date' },
    ]);
    const stored = JSON.stringify(batch.row_results);
    for (const text of ['Trading', 'file', 'example', 'HRB', 'registry', 'jane'])
      expect(stored).not.toContain(text);
    const landed = (
      await w.owner.query(
        'SELECT * FROM app.supply_candidate WHERE import_batch_id=$1 ORDER BY external_key',
        [done.batchId],
      )
    ).rows;
    expect(landed.map((c) => c.company_name)).toEqual([
      'File Trading 13 Ltd',
      'File Trading 2 Ltd',
    ]);
    for (const c of landed) {
      expect(c).toMatchObject({
        method: 'file_import',
        nomination_note: null,
        created_by: w.users.operator.id,
        counterparty_types: ['importer', 'distributor'],
      });
      expect(c.external_key).toMatch(/^row-\d+-[a-f0-9]{12}$/);
      expect(c.command_id).toBeTruthy();
    }
    const after = await totals();
    expect(after.candidates).toBe(before.candidates + 2);
    expect(after.records).toBe(before.records + 2);
    expect(after.claims).toBe(before.claims + 12);
    expect(after.commands).toBe(before.commands + 1);
    const listed = await w.candidates.listBatches(w.users.viewer.ctx, ids.missionId);
    expect(listed[0]).toMatchObject({ id: done.batchId, rowCount: 14, accepted: 2, rejected: 12 });
  });

  test('the same file for the same brief returns the first batch; another mission or profile version is a separate batch', async () => {
    const bytes = digestOf('one file');
    const first = await upload('operator', [row(2), row(3)], { digest: bytes });
    expect(first).toMatchObject({ accepted: 2, duplicate: false });
    const before = await totals();
    const again = await upload('operator', [row(2), row(3)], { digest: bytes });
    expect(again).toEqual({ batchId: first.batchId, accepted: 2, rejected: 0, duplicate: true });
    const after = await totals();
    expect(after).toEqual({ ...before, commands: before.commands + 1 });
    // Another mission with the same bytes: a new batch and new candidates.
    const m = await newMission();
    const other = await upload('operator', [row(2), row(3)], { digest: bytes, ...m });
    expect(other.batchId).not.toBe(first.batchId);
    expect(other).toMatchObject({ accepted: 2, duplicate: false });
    // Another profile version of the same mission: a new batch too.
    const second = (await w.save('operator', ids.missionId, { expectedVersion: 1 }))
      .profileVersionId;
    const third = await upload('operator', [row(2), row(3)], {
      digest: bytes,
      profileVersionId: second,
    });
    expect(third.batchId).not.toBe(first.batchId);
    expect(third.duplicate).toBe(false);
    expect(await count('supply_import_batch', 'file_digest=$1', [bytes])).toBe(3);
    // The same candidates come from three batches without colliding: the external key is per mission and batch digest.
    expect(await count('supply_candidate', 'import_batch_id=$1', [first.batchId])).toBe(2);
  });

  test('100 rows are accepted, 101 and none are refused, and the digest must be a digest', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) =>
      row(i + 2, { company_name: `Bulk Trading ${i} Ltd` }),
    );
    const done = await upload('operator', hundred);
    expect(done).toMatchObject({ accepted: 100, rejected: 0 });
    const call = (rows: unknown[]) =>
      sql('operator', 'SELECT app.supply_import_file($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS r', [
        w.tenantA,
        randomUUID(),
        'c'.repeat(64),
        ids.missionId,
        ids.profileVersionId,
        ids.sourceVersionId,
        digestOf(randomUUID()),
        JSON.stringify(rows),
      ]);
    expect(await refused(call(Array.from({ length: 101 }, (_, i) => row(i + 2))))).toBe(
      'Use at most 100 candidate rows',
    );
    expect(await refused(call([]))).toBe('Include at least one candidate row');
    expect(
      await refused(
        upload(
          'operator',
          Array.from({ length: 101 }, (_, i) => row(i + 2)),
        ),
      ),
    ).toBeTruthy();
    expect(await refused(upload('operator', [row(2)], { digest: 'short' }))).toBeTruthy();
  });

  test('a source that is not active refuses the whole file and writes no batch', async () => {
    const retired = await w.staffSource({ label: 'Retired before the file' });
    await w.candidates.addSourceVersion(w.users.operator.ctx, {
      commandId: randomUUID(),
      sourceId: retired.sourceId,
      expectedVersion: 1,
      status: 'retired',
      label: 'Retired before the file',
      defaultRetentionMonths: 6,
      reason: 'Retire it',
    });
    const before = await batches();
    expect(
      await refused(upload('operator', [row(2)], { sourceVersionId: retired.sourceVersionId })),
    ).toBe(notActive);
    expect(await batches()).toBe(before);
  });

  test('files for agreement backed sources land when the kind is offered on the route and its control is open', async () => {
    for (const kind of ['partner_organisation', 'data_platform'] as const) {
      const m = await newMission();
      const source = await w.agreementSource(kind, m.missionId);
      const done = await upload('operator', [row(2, { company_name: `${kind} Trading Ltd` })], {
        ...m,
        sourceVersionId: source.sourceVersionId,
      });
      expect(done, kind).toMatchObject({ accepted: 1, duplicate: false });
      const listed = await w.candidates.listCandidates(w.users.viewer.ctx, {
        missionId: m.missionId,
      });
      expect(listed[0], kind).toMatchObject({
        sourceKind: kind,
        method: 'file_import',
        licenceScope: 'publication',
        state: 'source-reported',
      });
      await w.openControl(kind === 'data_platform' ? 'platform_kind' : 'partner_kinds', false);
      expect(
        await refused(
          upload('operator', [row(3)], { ...m, sourceVersionId: source.sourceVersionId }),
        ),
        kind,
      ).toBe(notActive);
    }
    // Staff roles only.
    expect(await refused(upload('viewer', [row(2)]))).toBeTruthy();
    expect(await refused(upload('reviewer', [row(2)]))).toBeTruthy();
  });
});

describe('do not contact at intake and review (D5)', () => {
  test('a name and country block refuses manual entry, a file row, a second source and QUALIFIED; lifting needs an owner with fresh MFA', async () => {
    const earlier = await w.addCandidate('operator', ids, { companyName: 'Quiet Trading Ltd' });
    const second = await w.staffSource({ label: 'A second source' });
    const put = await block('operator', { companyName: 'Quiet Trading Ltd', country: 'DE' });
    expect(put.blockId).toBeTruthy();
    for (const name of ['Quiet Trading Ltd', 'QUIET TRADING LIMITED', 'Quiet  Trading, Ltd.'])
      expect(await refused(w.addCandidate('operator', ids, { companyName: name })), name).toBe(
        blocked,
      );
    expect(
      await refused(
        w.addCandidate(
          'operator',
          { ...ids, sourceVersionId: second.sourceVersionId },
          { companyName: 'Quiet Trading Ltd' },
        ),
      ),
    ).toBe(blocked);
    const file = await w.candidates.importFile(w.users.operator.ctx, {
      commandId: randomUUID(),
      ...ids,
      digest: createHash('sha256').update(randomUUID()).digest('hex'),
      rows: [
        {
          row: 2,
          cells: {
            company_name: 'Quiet Trading Ltd',
            country: 'DE',
            website_host: '',
            public_identifier: '',
            size_band: '',
            counterparty_types: '',
            observed_at: iso(-day),
            source_locator: 'https://registry.example/q',
          },
        },
      ],
    });
    expect(file).toMatchObject({ accepted: 0, rejected: 1 });
    expect(
      (
        await w.owner.query('SELECT row_results FROM app.supply_import_batch WHERE id=$1', [
          file.batchId,
        ])
      ).rows[0].row_results,
    ).toEqual([{ row: 2, code: 'dnc_blocked' }]);
    expect(
      await refused(
        decided('operator', earlier.candidateId, {
          decision: 'QUALIFIED',
          reasonCode: 'fits_brief',
        }),
      ),
    ).toBe(blocked);
    // The same name in another country is not covered.
    expect(
      (await w.addCandidate('operator', ids, { companyName: 'Quiet Trading Ltd', country: 'ES' }))
        .candidateId,
    ).toBeTruthy();
    // Lift: an operator cannot, an owner without fresh MFA cannot, an owner with fresh MFA can.
    expect(
      await refused(lift('operator', { companyName: 'Quiet Trading Ltd', country: 'DE' })),
    ).toBe('Access denied');
    await setMfa('owner', false);
    expect(await refused(lift('owner', { companyName: 'Quiet Trading Ltd', country: 'DE' }))).toBe(
      'Access denied',
    );
    expect(
      await refused(w.addCandidate('operator', ids, { companyName: 'Quiet Trading Ltd' })),
    ).toBe(blocked);
    await setMfa('owner', true);
    expect(
      (await lift('owner', { companyName: 'Quiet Trading Ltd', country: 'DE' })).blockId,
    ).toBeTruthy();
    expect(
      (await w.addCandidate('operator', ids, { companyName: 'Quiet Trading Ltd' })).candidateId,
    ).toBeTruthy();
    expect(
      (
        await decided('operator', earlier.candidateId, {
          decision: 'QUALIFIED',
          reasonCode: 'fits_brief',
        })
      ).reviewId,
    ).toBeTruthy();
    expect(await refused(lift('owner', { companyName: 'Quiet Trading Ltd', country: 'DE' }))).toBe(
      supplyWords.notBlocked,
    );
    const rows = await w.candidates.listBlocks(w.users.viewer.ctx);
    const quiet = rows.filter((r) => r.nameKey === 'quiettrading');
    expect(quiet.map((r) => [r.state, r.current])).toEqual([
      ['LIFTED', true],
      ['BLOCKED', false],
    ]);
  });

  test("a name block is lifted and blocked again by its row id, whatever the name looks like; another tenant's row is refused", async () => {
    const name = 'A&B Ltd';
    const put = await block('operator', { companyName: name, country: 'DE' });
    expect(
      (
        await w.owner.query('SELECT name_key,country FROM app.supply_do_not_contact WHERE id=$1', [
          put.blockId,
        ])
      ).rows[0],
    ).toEqual({ name_key: 'ab', country: 'DE' });
    expect(await refused(w.addCandidate('operator', ids, { companyName: name }))).toBe(blocked);
    // The name key is not a company name: sending it back as one normalises to nothing and lifts nothing.
    expect(await refused(lift('owner', { companyName: 'ab', country: 'DE' }))).toBe(
      supplyWords.notBlocked,
    );
    const lifted = await lift('owner', { blockId: put.blockId });
    expect(lifted.blockId).toBeTruthy();
    expect((await w.addCandidate('operator', ids, { companyName: name })).candidateId).toBeTruthy();
    // Block again by the same row id: the subject comes from the row, so the same company is covered.
    const again = await block('operator', { blockId: put.blockId, reference: 'ticket 43' });
    expect(
      (
        await w.owner.query(
          'SELECT name_key,country,state FROM app.supply_do_not_contact WHERE id=$1',
          [again.blockId],
        )
      ).rows[0],
    ).toEqual({ name_key: 'ab', country: 'DE', state: 'BLOCKED' });
    expect(await refused(w.addCandidate('operator', ids, { companyName: 'A & B, Ltd.' }))).toBe(
      blocked,
    );
    // A row id that is not of this tenant is no subject at all, and nothing is written for it.
    const before = await count('supply_do_not_contact');
    expect(await refused(lift('owner', { blockId: randomUUID() }))).toBe(
      supplyWords.blockUnavailable,
    );
    expect(await refused(block('operator', { blockId: randomUUID() }))).toBe(
      supplyWords.blockUnavailable,
    );
    expect(await count('supply_do_not_contact')).toBe(before);
    // Tidy: leave the company liftable for the rest of the file.
    await lift('owner', { blockId: again.blockId });
  });

  test('an organisation block: unknown and other-side organisations are refused, the block shows by name, and rows are append only', async () => {
    const org = await w.organisation('Listed Elsewhere Ltd');
    expect(await refused(block('operator', { organisationId: randomUUID() }))).toBe(
      supplyWords.organisationUnavailable,
    );
    expect(
      await refused(
        block('operator', {
          organisationId: await w.organisation('Real Side Ltd', 'DE', undefined, false),
        }),
      ),
    ).toBe(supplyWords.organisationUnavailable);
    await block('operator', { organisationId: org });
    const rows = await w.candidates.listBlocks(w.users.viewer.ctx);
    expect(rows.find((r) => r.organisationId === org)).toMatchObject({
      state: 'BLOCKED',
      organisationName: 'Listed Elsewhere Ltd',
      country: 'DE',
      current: true,
    });
    expect(await refused(lift('operator', { organisationId: org }))).toBe('Access denied');
    await lift('owner', { organisationId: org });
    expect(
      (await w.candidates.listBlocks(w.users.viewer.ctx))
        .filter((r) => r.organisationId === org)
        .map((r) => r.state),
    ).toEqual(['LIFTED', 'BLOCKED']);
    expect(
      await refused(w.owner.query("UPDATE app.supply_do_not_contact SET state='LIFTED'")),
    ).toBeTruthy();
    expect(await refused(w.owner.query('DELETE FROM app.supply_do_not_contact'))).toBeTruthy();
    // A reference with a person's contact is refused.
    expect(
      await refused(block('operator', { organisationId: org, reference: 'jane@acme.example' })),
    ).toBeTruthy();
    expect(
      await refused(block('operator', { organisationId: org, reference: 'call 030 1234 5678' })),
    ).toBeTruthy();
  });

  test('a company blocked now comes before older history, so the list limit can never hide a block that still applies', async () => {
    const kept = await block('operator', { companyName: 'Kept Blocked Ltd', country: 'DE' });
    for (const name of ['Later One Ltd', 'Later Two Ltd']) {
      const later = await block('operator', { companyName: name, country: 'DE' });
      await lift('owner', { blockId: later.blockId });
    }
    const rows = await w.candidates.listBlocks(w.users.viewer.ctx, { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: kept.blockId, state: 'BLOCKED', current: true });
    // Every row of the full read still reads as it did, newest history first after the current blocks.
    const all = await w.candidates.listBlocks(w.users.viewer.ctx);
    expect(all.filter((r) => r.current && r.state === 'BLOCKED').map((r) => r.id)).toContain(
      kept.blockId,
    );
    expect(all.find((r) => r.nameKey === 'latertwo')).toMatchObject({
      state: 'LIFTED',
      current: true,
    });
  });
});

describe('every command: an exact retry, a changed retry (R1)', () => {
  test('each command returns its first result for the same id and content and refuses the same id with other content', async () => {
    const reused = 'Command ID reused with different values';
    const target = await w.addCandidate('operator', ids, { companyName: 'Retry Trading Ltd' });
    const org = await w.organisation('Retry Org Ltd');
    const record = (over: Record<string, unknown> = {}) => over;
    void record;
    const cases: [string, () => Promise<unknown>, () => Promise<unknown>][] = (() => {
      const make = (
        name: string,
        input: Record<string, unknown>,
        run: (input: Record<string, unknown>) => Promise<unknown>,
        change: Record<string, unknown>,
      ) =>
        [name, () => run(input), () => run({ ...input, ...change })] as [
          string,
          () => Promise<unknown>,
          () => Promise<unknown>,
        ];
      const id = () => randomUUID();
      return [
        make(
          'create_source',
          {
            commandId: id(),
            kind: 'staff_research',
            status: 'active',
            label: 'Retry source',
            defaultRetentionMonths: 6,
            reason: 'Retry test',
          },
          (i) => w.candidates.createSource(w.users.operator.ctx, i),
          { label: 'Another label' },
        ),
        make(
          'review_candidate',
          {
            commandId: id(),
            candidateId: target.candidateId,
            decision: 'WRONG_FIT',
            reasonCode: 'not_a_buyer',
            reason: 'Retry test review',
          },
          (i) => w.candidates.review(w.users.operator.ctx, i),
          { decision: 'DUPLICATE' },
        ),
        make(
          'match_candidate',
          {
            commandId: id(),
            candidateId: target.candidateId,
            decision: 'MATCH',
            organisationId: org,
            reason: 'Retry test match',
          },
          (i) => w.candidates.match(w.users.operator.ctx, i),
          { reason: 'Another reason' },
        ),
        make(
          'block_company',
          {
            commandId: id(),
            companyName: 'Retry Block Ltd',
            country: 'DE',
            reason: 'Retry test block',
            reference: 'ticket 77',
          },
          (i) => w.candidates.blockCompany(w.users.operator.ctx, i),
          { country: 'ES' },
        ),
        make(
          'lift_company',
          {
            commandId: id(),
            companyName: 'Retry Block Ltd',
            country: 'DE',
            reason: 'Retry test lift',
            reference: 'ticket 78',
          },
          (i) => w.candidates.liftCompany(w.users.owner.ctx, i),
          { reference: 'ticket 79' },
        ),
        make(
          'import_file',
          {
            commandId: id(),
            ...ids,
            digest: createHash('sha256').update('retry file').digest('hex'),
            rows: [
              {
                row: 2,
                cells: {
                  company_name: 'Retry File Trading Ltd',
                  country: 'DE',
                  website_host: '',
                  public_identifier: '',
                  size_band: '',
                  counterparty_types: '',
                  observed_at: iso(-day),
                  source_locator: 'https://registry.example/r',
                },
              },
            ],
          },
          (i) => w.candidates.importFile(w.users.operator.ctx, i),
          { digest: createHash('sha256').update('other file').digest('hex') },
        ),
      ];
    })();
    for (const [name, run, change] of cases) {
      const first = await run();
      const before = await totals();
      const rows = await count('supply_do_not_contact');
      expect(await run(), name).toEqual(first);
      expect(await totals(), name).toEqual(before);
      expect(await count('supply_do_not_contact'), name).toBe(rows);
      expect(await refused(change()), name).toBe(reused);
    }
    // Another person cannot replay a command id of someone else.
    const input = {
      commandId: randomUUID(),
      candidateId: target.candidateId,
      decision: 'WRONG_FIT',
      reasonCode: 'not_a_buyer',
      reason: 'Owned by the operator',
    };
    await w.candidates.review(w.users.operator.ctx, input);
    expect(await refused(w.candidates.review(w.users.owner.ctx, input))).toBe(reused);
  });
});

describe('tenant and role isolation (D1)', () => {
  const tables = [
    'supply_source',
    'supply_source_version',
    'supply_import_batch',
    'supply_candidate_review',
    'supply_candidate_match',
    'supply_do_not_contact',
    'supply_command',
  ];
  test('another tenant and a person outside every tenant see no row, and every table has the synthetic policy and the real-use pair', async () => {
    for (const table of tables) {
      const own = await rawContext(
        w.runtime,
        w.users.viewer.ctx,
        `SELECT count(*)::int n FROM app.${table}`,
      );
      const theirs = await rawContext(
        w.runtime,
        w.users.other.ctx,
        `SELECT count(*)::int n FROM app.${table}`,
      );
      expect(theirs.rows[0].n, table).toBe(0);
      if (table !== 'supply_command') expect(own.rows[0].n, table).toBeGreaterThan(0);
    }
    const candidates = await rawContext(
      w.runtime,
      w.users.other.ctx,
      'SELECT count(*)::int n FROM app.supply_candidate',
    );
    expect(candidates.rows[0].n).toBe(0);
    expect(
      await w.candidates.listCandidates(w.users.other.ctx, { missionId: ids.missionId }),
    ).toEqual([]);
    expect(await w.candidates.listMissions(w.users.other.ctx)).toHaveLength(1);
    expect(await w.candidates.listSources(w.users.other.ctx)).toEqual([]);
    expect(await w.candidates.listBlocks(w.users.other.ctx)).toEqual([]);
    const made = await w.owner.query('SELECT id FROM app.supply_candidate LIMIT 1');
    expect(await w.candidates.candidate(w.users.other.ctx, made.rows[0].id)).toBeNull();
    expect(await refused(w.candidates.listSources(w.users.outsider.ctx))).toBeTruthy();
    const policies = (
      await w.owner.query(
        "SELECT tablename,array_agg(policyname::text ORDER BY policyname) p FROM pg_policies WHERE schemaname='app' AND tablename LIKE 'supply\\_%' AND tablename<>'supply_source_control' AND tablename<>'supply_command' GROUP BY 1 ORDER BY 1",
      )
    ).rows;
    expect(policies).toHaveLength(7);
    for (const p of policies)
      expect(p.p, p.tablename).toEqual(['add', 'read', 'real_use_add', 'real_use_read']);
  });

  test('a call for one tenant from a session of another is refused, and a real tenant that is not enabled for real use is refused', async () => {
    const call = (text: string, args: unknown[]) =>
      rawContext(w.runtime, w.users.other.ctx, text, args);
    expect(
      await refused(call('SELECT app.supply_candidate_read($1,$2,10)', [w.tenantA, ids.missionId])),
    ).toBe('Access denied');
    expect(await refused(call('SELECT app.supply_blocks_read($1,10)', [w.tenantA]))).toBe(
      'Access denied',
    );
    expect(await refused(call('SELECT app.supply_missions_read($1,10)', [w.tenantA]))).toBe(
      'Access denied',
    );
    expect(
      await refused(call('SELECT app.supply_route_pack($1,$2)', [w.tenantA, ids.missionId])),
    ).toBe('Access denied');
    expect(
      await refused(call('SELECT app.supply_candidate_detail($1,$2)', [w.tenantA, randomUUID()])),
    ).toBe('Access denied');
    expect(
      await refused(
        w.candidates.addCandidate(w.users.other.ctx, { ...w.candidateInput(), ...ids }),
      ),
    ).toBeTruthy();
    const real = randomUUID();
    await w.owned(async (db) => {
      await db.query(
        "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Real Staff Tenant',false)",
        [real],
      );
      await db.query("INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
        real,
        w.users.owner.id,
      ]);
    }, true);
    const ctx = { ...w.users.owner.ctx, tenantId: real };
    expect(
      await refused(
        w.candidates.createSource(ctx, {
          commandId: randomUUID(),
          kind: 'staff_research',
          status: 'active',
          label: 'Real tenant source',
          defaultRetentionMonths: 6,
          reason: 'Real use is not enabled',
        }),
      ),
    ).toBeTruthy();
    expect(await w.candidates.listSources(ctx)).toEqual([]);
    expect(
      await w.owner.query('SELECT count(*)::int n FROM app.supply_source WHERE tenant_id=$1', [
        real,
      ]),
    ).toMatchObject({ rows: [{ n: 0 }] });
  });

  test('the runtime login cannot read the candidate words, cannot write a table and cannot run a private helper; the auth login runs nothing', async () => {
    for (const column of [
      'company_name',
      'website_host',
      'public_identifier',
      'nomination_note',
      'name_key',
    ])
      expect(
        await refused(
          rawContext(w.runtime, w.users.owner.ctx, `SELECT ${column} FROM app.supply_candidate`),
        ),
        column,
      ).toMatch(/permission denied/);
    expect(
      await refused(rawContext(w.runtime, w.users.owner.ctx, 'SELECT * FROM app.supply_candidate')),
    ).toMatch(/permission denied/);
    const safe = await rawContext(
      w.runtime,
      w.users.owner.ctx,
      'SELECT id,method,country,retention_until FROM app.supply_candidate',
    );
    expect(safe.rowCount).toBeGreaterThan(0);
    for (const table of tables.concat('supply_candidate')) {
      expect(
        await refused(rawContext(w.runtime, w.users.owner.ctx, `DELETE FROM app.${table}`)),
        table,
      ).toMatch(/permission denied/);
      expect(
        await refused(
          rawContext(w.runtime, w.users.owner.ctx, `UPDATE app.${table} SET tenant_id=tenant_id`),
        ),
        table,
      ).toMatch(/permission denied/);
    }
    expect(
      await refused(
        rawContext(
          w.runtime,
          w.users.owner.ctx,
          `INSERT INTO app.supply_source(tenant_id,kind,created_by) VALUES($1,'staff_research',$2)`,
          [w.tenantA, w.users.owner.id],
        ),
      ),
    ).toMatch(/permission denied/);
    const secret = randomUUID();
    const helpers = [
      ['app.supply_canonical_org($1,$2)', [w.tenantA, secret]],
      ['app.supply_org_blocked($1,$2)', [w.tenantA, secret]],
      ['app.supply_name_blocked($1,$2,$3)', [w.tenantA, 'quiettrading', 'DE']],
      ['app.supply_source_usable($1,$2,$3)', [w.tenantA, secret, secret]],
      [
        'app.supply_command_enter($1,$2,$3,$4,$5::text[],false,false)',
        [w.tenantA, secret, 'a'.repeat(64), 'add_candidate', ['owner']],
      ],
      [
        'app.supply_command_done($1,$2,$3,$4,$5,$6::jsonb)',
        [w.tenantA, secret, secret, 'add_candidate', 'a'.repeat(64), '{}'],
      ],
      ['app.supply_intake_checks($1,$2,$3,$4)', [w.tenantA, secret, secret, secret]],
      ['app.supply_current_match($1,$2)', [w.tenantA, secret]],
      ['app.supply_read_allowed($1)', [w.tenantA]],
      ['app.supply_contact_guard()', []],
    ] as [string, unknown[]][];
    for (const [call, args] of helpers) {
      expect(
        await refused(rawContext(w.runtime, w.users.owner.ctx, `SELECT ${call}`, args)),
        call,
      ).toMatch(/permission denied/);
      expect(await refused(w.auth.query(`SELECT ${call}`, args)), call).toMatch(
        /permission denied/,
      );
    }
    const commands = [
      'app.supply_add_candidate($1,$1,$2,$1,$1,$1,$2,$2,$2,$2,$2,$3::text[],$2,now(),$2)',
      'app.supply_block_company($1,$1,$2,$1,$2,$2,$2,$2)',
      'app.supply_candidate_read($1,$1,10)',
    ];
    for (const call of commands)
      expect(await refused(w.auth.query(`SELECT ${call}`, [randomUUID(), 'x', []])), call).toMatch(
        /permission denied/,
      );
  });

  test('viewer and reviewer cannot write, in any command, and nothing is written', async () => {
    const before = await totals();
    const blocks = await count('supply_do_not_contact');
    const target = (await w.owner.query('SELECT id FROM app.supply_candidate LIMIT 1')).rows[0]
      .id as string;
    const org = await w.organisation('Denied Org Ltd');
    for (const who of ['viewer', 'reviewer'] as const) {
      const ctx = w.users[who].ctx;
      const attempts = [
        () =>
          w.candidates.createSource(ctx, {
            commandId: randomUUID(),
            kind: 'staff_research',
            status: 'active',
            label: 'Denied source',
            defaultRetentionMonths: 6,
            reason: 'Not allowed',
          }),
        () =>
          w.candidates.addSourceVersion(ctx, {
            commandId: randomUUID(),
            sourceId,
            expectedVersion: 1,
            status: 'paused',
            label: 'Denied version',
            defaultRetentionMonths: 6,
            reason: 'Not allowed',
          }),
        () => w.candidates.addCandidate(ctx, { ...w.candidateInput(), ...ids }),
        () =>
          w.candidates.review(ctx, {
            commandId: randomUUID(),
            candidateId: target,
            decision: 'WRONG_FIT',
            reasonCode: 'not_a_buyer',
            reason: 'Not allowed',
          }),
        () =>
          w.candidates.match(ctx, {
            commandId: randomUUID(),
            candidateId: target,
            decision: 'NO_MATCH',
            organisationId: org,
            reason: 'Not allowed',
          }),
        () =>
          w.candidates.blockCompany(ctx, {
            commandId: randomUUID(),
            organisationId: org,
            reason: 'Not allowed',
            reference: 'ticket 1',
          }),
        () =>
          w.candidates.liftCompany(ctx, {
            commandId: randomUUID(),
            organisationId: org,
            reason: 'Not allowed',
            reference: 'ticket 1',
          }),
        () =>
          w.candidates.importFile(ctx, {
            commandId: randomUUID(),
            ...ids,
            digest: createHash('sha256').update(who).digest('hex'),
            rows: [{ row: 2, cells: { company_name: 'Denied Ltd', country: 'DE' } }],
          }),
      ];
      for (const attempt of attempts) expect(await refused(attempt()), who).toBeTruthy();
      // They can read.
      expect(
        (await w.candidates.listCandidates(ctx, { missionId: ids.missionId })).length,
      ).toBeGreaterThan(0);
    }
    expect(await totals()).toEqual(before);
    expect(await count('supply_do_not_contact')).toBe(blocks);
  });
});
