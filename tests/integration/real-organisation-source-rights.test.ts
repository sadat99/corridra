import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { World } from './organisation-link-support';
import {
  SOURCE_RIGHTS_FILE,
  Staff,
  between,
  rightsSql,
  sourceTypes,
  unavailable,
} from './source-rights-support';
import { sourceRightsHidden } from './source-rights-hide';

// ADR-079 slice B (ADR-082 S1), part one: the source rights record, the ingest wrapper and rights adjust and read.
// RIGHTS_BASE_CHECK=1 keeps the new ladder file away from the migrator, which is how each test is shown to fail on main.
vi.hoisted(() => {
  (globalThis as { __linkHide?: boolean }).__linkHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const base =
      (globalThis as { __linkHide?: boolean }).__linkHide &&
      String(path).includes('customer-real-use-migrations');
    return names.filter(
      (n) =>
        !sourceRightsHidden(String(path), String(n)) &&
        !(
          base &&
          /^(0013_organisation_link_provenance_and_search|0014_|0015_|0016_|0017_|0018_|0019_|0020_|0021_)/.test(
            String(n),
          )
        ),
    );
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
let s: Staff;
const owner = 'owner' as const;
beforeAll(async () => {
  w = await World.build('corridra_integration');
  await w.install();
  s = new Staff(w);
}, 300000);
afterAll(async () => {
  await w?.close();
});

// The expected defaults of ADR-079 section 2.
const expected: Record<string, { note: string; months: number; warnings: string[] }> = {
  government_registry: {
    note: 'Public register entry. Register reuse terms not checked here.',
    months: 12,
    warnings: [],
  },
  company_website: { note: "The company's own public website.", months: 6, warnings: [] },
  trade_body_list: {
    note: 'Member list published by a trade body or association.',
    months: 12,
    warnings: [],
  },
  event_list: {
    note: 'Exhibitor or attendee list published for an event.',
    months: 6,
    warnings: [],
  },
  staff_research: { note: 'Other public research by Corridra staff.', months: 6, warnings: [] },
  licensed_dataset: {
    note: 'Dataset used under a licence. Licence terms not checked here.',
    months: 12,
    warnings: ['licence_not_checked'],
  },
  other: { note: 'Source not classified.', months: 3, warnings: ['source_not_classified'] },
};
const monthsAhead = async (id: string, months: number) =>
  (
    await w.f.owner.query(
      `SELECT review_by BETWEEN now()+make_interval(months=>$2)-interval '1 day' AND now()+make_interval(months=>$2)+interval '1 day' AS ok
       FROM customer_private.organisation_source_rights WHERE organisation_id=$1`,
      [id, months],
    )
  ).rows[0].ok as boolean;

test('every source type writes its default basis note, review date and warnings in version 1 with the source and the actor', async () => {
  for (const type of sourceTypes) {
    const sid = await s.source('real');
    const made = await s.ingest(
      'real',
      s.identity('real', `Wrapper ${type} GmbH`),
      type,
      owner,
      sid,
    );
    expect(made.warnings, type).toEqual(expected[type]!.warnings);
    const rows = await s.rightsRows(made.id);
    expect(rows, type).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      source_type: type,
      basis_note: expected[type]!.note,
      personal_name_flag: false,
      warnings: expected[type]!.warnings,
      source_tenant_id: w.intake,
      source_record_id: sid,
      staff_actor: w.f.users.owner!.id,
      reason: null,
      command_id: null,
      request: null,
    });
    expect(await monthsAhead(made.id, expected[type]!.months), type).toBe(true);
  }
});

test('an omitted, unknown or null source type is stored as other and never refused', async () => {
  const omitted = await s.ingest('real', s.identity('real', 'Omitted Type GmbH'), undefined);
  expect(omitted.warnings).toEqual(['source_not_classified']);
  expect((await s.rightsRows(omitted.id))[0]).toMatchObject({ source_type: 'other' });
  for (const type of ['banana', null, '']) {
    const id = s.identity('real', `Raw ${String(type)} GmbH`);
    const [row] = await s.call(
      s.ctx(owner, 'real'),
      'SELECT * FROM app.ingest_public_organisation_with_rights($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        w.intake,
        await s.source('real'),
        id.name,
        id.country,
        id.domain,
        id.address,
        'registry',
        id.identifier,
        type,
      ],
    );
    expect(row.warnings, String(type)).toEqual(['source_not_classified']);
    expect((await s.rightsRows(row.id))[0], String(type)).toMatchObject({ source_type: 'other' });
  }
});

test('the 8-argument function definition is unchanged and the wrapper refuses exactly what it refuses', async () => {
  const [def] = (
    await w.f.owner.query(
      "SELECT encode(sha256(convert_to(pg_get_functiondef('app.ingest_public_organisation(uuid,uuid,text,text,text,text,text,text)'::regprocedure),'UTF8')),'hex') h",
    )
  ).rows;
  expect(def.h).toBe('69593ae94c97405707615e17e31bd0c23042179a311654edfe7c5eb3dc2747d1');
  const id = s.identity('real', 'Refused Viewer GmbH');
  const args = [
    w.intake,
    await s.source('real'),
    id.name,
    id.country,
    id.domain,
    id.address,
    'registry',
    id.identifier,
  ];
  const viewer = s.ctx('viewer', 'real');
  const direct = await s
    .call(viewer, 'SELECT app.ingest_public_organisation($1,$2,$3,$4,$5,$6,$7,$8)', args)
    .catch((e) => e);
  const wrapped = await s
    .call(
      viewer,
      'SELECT * FROM app.ingest_public_organisation_with_rights($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [...args, 'other'],
    )
    .catch((e) => e);
  expect(direct).toMatchObject({ code: '42501', message: 'Synthetic operator required' });
  expect(wrapped).toMatchObject({ code: '42501', message: 'Synthetic operator required' });
  expect(
    (await w.f.owner.query('SELECT count(*)::int n FROM app.organisation WHERE name=$1', [id.name]))
      .rows[0].n,
  ).toBe(0);
  // A source that is not a current public record is refused by the 8-argument function and so by the wrapper.
  const missing = await s
    .call(
      s.ctx(owner, 'real'),
      'SELECT * FROM app.ingest_public_organisation_with_rights($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        w.intake,
        randomUUID(),
        id.name,
        id.country,
        id.domain,
        id.address,
        'registry',
        id.identifier,
        'other',
      ],
    )
    .catch((e) => e);
  expect(missing.message).toBe('Current synthetic public-record source required');
});

test('the guard fingerprints in the file are the live values of the functions it relies on', async () => {
  const text = between(rightsSql(), 'fingerprint');
  const rows = [...text.matchAll(/\('([^']+)','([0-9a-f]{64})','([^']*)'\)/g)].map((m) => ({
    signature: m[1]!,
    fingerprint: m[2]!,
    grantees: m[3]!,
  }));
  expect(rows).toHaveLength(8);
  const live = (
    await w.f.owner.query(between(rightsSql(), 'fingerprint-query') + ' ORDER BY 1')
  ).rows.map((r) => ({ signature: r.signature, fingerprint: r.fp, grantees: r.grantees }));
  const byName = (a: { signature: string }[]) =>
    [...a].sort((x, y) => x.signature.localeCompare(y.signature));
  expect(byName(live)).toEqual(byName(rows));
  expect(createHash('sha256').update(rightsSql()).digest('hex')).toBe(
    (
      await w.f.owner.query(
        'SELECT sha256 FROM customer_real_use_migrations.applied WHERE name=$1',
        [SOURCE_RIGHTS_FILE],
      )
    ).rows[0].sha256,
  );
});

test('personal_name_check is raised when no legal-form word was removed from the name, on both sides', async () => {
  const cases: [string, boolean][] = [
    ['Anna Schmidt', true],
    ['Anna Schmidt GmbH', false],
    ['Smith & Co', false],
    ['Blau Limited', false],
    ['Rossi SRL', false],
    // The word list of the name key has no dotted forms, so the prompt is raised: a prompt to look, not a judgement.
    ['Rossi S.r.l.', true],
  ];
  for (const [name, raised] of cases) {
    const made = await s.ingest('real', s.identity('real', name), 'staff_research');
    expect(made.warnings?.includes('personal_name_check'), name).toBe(raised);
    expect((await s.rightsRows(made.id))[0], name).toMatchObject({ personal_name_flag: raised });
  }
  const both = await s.ingest('real', s.identity('real', 'Maria Weber'), 'licensed_dataset');
  expect(both.warnings).toEqual(['licence_not_checked', 'personal_name_check']);
  const own = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Anna Schmidt'),
    'staff_research',
  );
  expect(own.warnings).toEqual(['personal_name_check']);
  const company = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Acme Werke AG'),
    'staff_research',
  );
  expect(company.warnings).toEqual([]);
});

test('a company hidden earlier is carried over: same name and country, or the same identifier, on the same side only', async () => {
  const first = s.identity('real', 'Carry Over Alpha GmbH');
  const a = await s.ingest('real', first, 'company_website');
  const reviewer = s.ctx('reviewer', 'real');
  const hidden = await s.hide(reviewer, a.id);
  expect(hidden).toMatchObject({ state: 'hidden', version: 1 });
  const [old] = await s.suppressionRows(a.id);
  // Same name key and country, other identifier and domain.
  const again = await s.ingest(
    'real',
    s.identity('real', 'carry over alpha ltd'),
    'company_website',
  );
  expect(again.warnings).toEqual(['previously_hidden']);
  const [carried] = await s.suppressionRows(again.id);
  expect(carried).toMatchObject({
    version: 1,
    state: 'hidden',
    reason: 'Carry-over of an earlier takedown',
    reference: 'Carry-over of suppression row ' + old.id,
    staff_actor: w.f.users.owner!.id,
    request: { carryOver: a.id },
  });
  expect(carried.command_id).not.toBeNull();
  expect((await s.rightsRows(again.id))[0].warnings).toEqual(['previously_hidden']);
  // The takedown event is written in the ingesting tenant with ids, version and state only.
  const events = (await s.events('customer.organisation_catalogue.hidden')).filter(
    (e) => e.aggregate_id === again.id,
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    tenant_id: w.intake,
    aggregate_type: 'customer_organisation_catalogue',
  });
  expect(Object.keys(events[0].payload).sort()).toEqual([
    'initiator_id',
    'initiator_kind',
    'organisationId',
    'state',
    'synthetic',
    'version',
  ]);
  // The same identifier under another name and country.
  const byIdentifier = await s.ingest(
    'real',
    s.identity('real', 'Completely Other Name GmbH', {
      country: 'FR',
      identifier: first.identifier,
    }),
    'other',
  );
  expect(byIdentifier.warnings).toEqual(['source_not_classified', 'previously_hidden']);
  // Neither the name alone in another country nor another identifier type matches.
  const frName = await s.ingest(
    'real',
    s.identity('real', 'Carry Over Alpha GmbH', { country: 'FR' }),
    'company_website',
  );
  expect(frName.warnings).toEqual([]);
  const otherType = await s.ingest(
    'real',
    s.identity('real', 'Unrelated Name GmbH', {
      identifier: first.identifier,
      identifierType: 'tax',
    }),
    'company_website',
  );
  expect(otherType.warnings).toEqual([]);
  expect(await s.suppressionRows(otherType.id)).toHaveLength(0);
});

test('a hidden organisation of the other side is not matched, in either direction', async () => {
  const identifier = randomUUID().toUpperCase();
  const syn = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Mirror Werke AG', { identifier }),
    'other',
  );
  await s.hide(s.ctx('reviewer', 'synthetic'), syn.id);
  const real = await s.ingest(
    'real',
    s.identity('real', 'Mirror Werke AG', { identifier }),
    'other',
  );
  expect(real.warnings).toEqual(['source_not_classified']);
  expect(await s.suppressionRows(real.id)).toHaveLength(0);
  const realId = randomUUID().toUpperCase();
  const hiddenReal = await s.ingest(
    'real',
    s.identity('real', 'Real Hidden Mirror GmbH', { identifier: realId }),
    'other',
  );
  await s.hide(s.ctx('reviewer', 'real'), hiddenReal.id);
  const synthetic = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Other Werke AG', { identifier: realId }),
    'other',
  );
  expect(synthetic.warnings).toEqual(['source_not_classified']);
  expect(await s.suppressionRows(synthetic.id)).toHaveLength(0);
});

test('a direct call to the 8-argument function gets neither the warning nor the carry-over', async () => {
  const id = s.identity('real', 'Direct Hidden GmbH');
  const a = await s.ingest('real', id, 'other');
  await s.hide(s.ctx('reviewer', 'real'), a.id);
  const again = s.identity('real', 'Direct Hidden GmbH');
  const [row] = await s.call(
    s.ctx(owner, 'real'),
    'SELECT app.ingest_public_organisation($1,$2,$3,$4,$5,$6,$7,$8) AS id',
    [
      w.intake,
      await s.source('real'),
      again.name,
      again.country,
      again.domain,
      again.address,
      again.identifierType,
      again.identifier,
    ],
  );
  expect(await s.suppressionRows(row.id)).toHaveLength(0);
  expect(await s.rightsRows(row.id)).toHaveLength(0);
  expect(
    (await s.fn(s.ctx(owner, 'real'), 'app.organisation_source_rights_read', row.id)).status,
  ).toBe('unrecorded');
});

test('only owner or admin can show a carried row; a reviewer is denied and a shown company is no longer matched', async () => {
  const a = await s.ingest('real', s.identity('real', 'Carry Show Beta GmbH'), 'other');
  await s.hide(s.ctx('reviewer', 'real'), a.id);
  const again = await s.ingest('real', s.identity('real', 'Carry Show Beta GmbH'), 'other');
  expect(again.warnings).toContain('previously_hidden');
  const show = (who: 'reviewer' | 'owner' | 'operator', id: string) =>
    s.fn(
      s.ctx(who, 'real'),
      'app.customer_organisation_suppress',
      randomUUID(),
      JSON.stringify({
        organisationId: id,
        state: 'shown',
        reason: 'The company withdrew its request',
        reference: 'TICKET-2002',
      }),
    );
  await expect(show('reviewer', again.id)).rejects.toMatchObject({
    code: '42501',
    message: 'Owner or admin required to show an organisation again',
  });
  await expect(show('operator', again.id)).rejects.toMatchObject({ code: '42501' });
  expect(await show('owner', again.id)).toMatchObject({ state: 'shown', version: 2 });
  await show('owner', a.id);
  const third = await s.ingest('real', s.identity('real', 'Carry Show Beta GmbH'), 'other');
  expect(third.warnings).toEqual(['source_not_classified']);
});

test('ingestion is one atomic step: a failing rights insert leaves no organisation, identifier, source link or rights row', async () => {
  const id = s.identity('real', 'Atomic Probe GmbH');
  const sid = await s.source('real');
  const args = [
    w.intake,
    sid,
    id.name,
    id.country,
    id.domain,
    id.address,
    'registry',
    id.identifier,
    'other',
  ];
  const o = w.f.owner;
  await o.query(
    `CREATE FUNCTION customer_private.test_reject_rights() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Rights insert failed on purpose'; END $$`,
  );
  await o.query(
    'CREATE TRIGGER test_reject_rights BEFORE INSERT ON customer_private.organisation_source_rights FOR EACH ROW EXECUTE FUNCTION customer_private.test_reject_rights()',
  );
  try {
    await expect(
      s.call(
        s.ctx(owner, 'real'),
        'SELECT * FROM app.ingest_public_organisation_with_rights($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        args,
      ),
    ).rejects.toThrow('Rights insert failed on purpose');
    const left = async () =>
      (
        await o.query(
          `SELECT (SELECT count(*) FROM app.organisation WHERE name=$1)::int orgs,(SELECT count(*) FROM app.public_identifier WHERE identifier=$2)::int ids,
            (SELECT count(*) FROM app.organisation_source WHERE source_id=$3)::int sources,
            (SELECT count(*) FROM customer_private.organisation_source_rights WHERE source_record_id=$3)::int rights`,
          [id.name, id.identifier, sid],
        )
      ).rows[0];
    expect(await left()).toEqual({ orgs: 0, ids: 0, sources: 0, rights: 0 });
  } finally {
    await o.query('DROP TRIGGER test_reject_rights ON customer_private.organisation_source_rights');
    await o.query('DROP FUNCTION customer_private.test_reject_rights()');
  }
  const [row] = await s.call(
    s.ctx(owner, 'real'),
    'SELECT * FROM app.ingest_public_organisation_with_rights($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    args,
  );
  expect(await s.rightsRows(row.id)).toHaveLength(1);
});

const adjustInput = (organisationId: string, over: Record<string, unknown> = {}) => ({
  organisationId,
  sourceType: 'government_registry',
  reason: 'Checked against the national register entry',
  ...over,
});
const adjust = (
  who: 'owner' | 'operator' | 'reviewer' | 'viewer' | 'other',
  side: 'real' | 'synthetic',
  input: unknown,
  command: string = randomUUID(),
) =>
  s.fn(s.ctx(who, side), 'app.adjust_organisation_source_rights', command, JSON.stringify(input));
const read = (
  who: 'owner' | 'operator' | 'reviewer' | 'viewer' | 'other',
  side: 'real' | 'synthetic',
  id: string,
) => s.fn(s.ctx(who, side), 'app.organisation_source_rights_read', id);
const failure = async (work: Promise<unknown>) => {
  const e = (await work.then(
    () => ({ code: 'none', message: 'succeeded' }),
    (error: { code: string; message: string }) => error,
  )) as { code: string; message: string };
  return `${e.code}|${e.message}`;
};

test('an organisation made by a direct call reads as unrecorded; adjusting it writes version 1 with the tenant and source of its source link', async () => {
  const id = s.identity('real', 'Unrecorded Probe GmbH');
  const sid = await s.source('real');
  const [row] = await s.call(
    s.ctx(owner, 'real'),
    'SELECT app.ingest_public_organisation($1,$2,$3,$4,$5,$6,$7,$8) AS id',
    [w.intake, sid, id.name, id.country, id.domain, id.address, id.identifierType, id.identifier],
  );
  expect(await read('operator', 'real', row.id)).toEqual({
    organisationId: row.id,
    status: 'unrecorded',
  });
  const command = randomUUID();
  const input = adjustInput(row.id, { sourceType: 'licensed_dataset' });
  const made = await adjust('operator', 'real', input, command);
  expect(made).toMatchObject({
    organisationId: row.id,
    commandId: command,
    version: 1,
    sourceType: 'licensed_dataset',
    warnings: ['licence_not_checked'],
  });
  const [stored] = await s.rightsRows(row.id);
  expect(stored).toMatchObject({
    version: 1,
    source_tenant_id: w.intake,
    source_record_id: sid,
    staff_actor: w.f.users.operator!.id,
    reason: input.reason,
    command_id: command,
    request: input,
    personal_name_flag: false,
  });
  const current = await read('owner', 'real', row.id);
  expect(current).toMatchObject({
    status: 'recorded',
    current: { version: 1, sourceType: 'licensed_dataset' },
  });
  expect(current.history).toHaveLength(1);
});

test('version 2 keeps the history, needs a reason, carries the name and hidden warnings and is idempotent by command', async () => {
  const made = await s.ingest('real', s.identity('real', 'Anna Weber'), 'other');
  expect(made.warnings).toEqual(['source_not_classified', 'personal_name_check']);
  const command = randomUUID();
  const input = adjustInput(made.id, { sourceType: 'company_website' });
  const v2 = await adjust('owner', 'real', input, command);
  expect(v2).toMatchObject({ version: 2, sourceType: 'company_website' });
  // The new type's default warnings replace the old type's; the name prompt stays.
  expect(v2.warnings).toEqual(['personal_name_check']);
  expect(v2.personalNameFlag).toBe(true);
  const rows = await s.rightsRows(made.id);
  expect(rows.map((r) => [r.version, r.source_type])).toEqual([
    [1, 'other'],
    [2, 'company_website'],
  ]);
  expect(rows[1]).toMatchObject({
    source_tenant_id: w.intake,
    source_record_id: rows[0].source_record_id,
    command_id: command,
  });
  // Retry of the same command returns the same answer and writes nothing.
  expect(await adjust('owner', 'real', input, command)).toEqual(v2);
  expect(await s.rightsRows(made.id)).toHaveLength(2);
  // The same command with other content conflicts.
  await expect(
    adjust(
      'owner',
      'real',
      adjustInput(made.id, { sourceType: 'company_website', reason: 'A different reason' }),
      command,
    ),
  ).rejects.toMatchObject({
    code: '23514',
    message: 'Command conflicts with original request',
  });
  const history = (await read('owner', 'real', made.id)).history as {
    version: number;
    reason: string | null;
  }[];
  expect(history.map((h) => [h.version, h.reason])).toEqual([
    [1, null],
    [2, input.reason],
  ]);
  // A later version needs a reason: not by the function, and not by a row written as table owner.
  for (const bad of [
    { reason: 'ab' },
    { reason: ' padded ' },
    { reason: 'Line\nbreak' },
    { sourceType: 'banana' },
    { organisationId: 'not-a-uuid' },
  ]) {
    await expect(adjust('owner', 'real', adjustInput(made.id, bad))).rejects.toMatchObject({
      code: '23514',
      message: 'Invalid source rights request',
    });
  }
  await expect(
    adjust('owner', 'real', { organisationId: made.id, sourceType: 'other' }),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    adjust('owner', 'real', { ...adjustInput(made.id), extra: 1 }),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    w.f.owner.query(
      `INSERT INTO customer_private.organisation_source_rights(organisation_id,version,source_type,basis_note,personal_name_flag,review_by,source_tenant_id,source_record_id,staff_actor)
       SELECT organisation_id,3,source_type,basis_note,personal_name_flag,review_by,source_tenant_id,source_record_id,staff_actor FROM customer_private.organisation_source_rights WHERE organisation_id=$1 AND version=1`,
      [made.id],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(await s.rightsRows(made.id)).toHaveLength(2);
});

test('rights authority: the ingest roles of the ingesting tenant act; every other caller gets the same refusal as an unknown organisation', async () => {
  const made = await s.ingest('real', s.identity('real', 'Authority Probe GmbH'), 'event_list');
  const synthetic = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Authority Werke AG'),
    'event_list',
  );
  expect(await adjust('operator', 'real', adjustInput(made.id))).toMatchObject({ version: 2 });
  expect(
    await adjust('owner', 'real', adjustInput(made.id, { sourceType: 'event_list' })),
  ).toMatchObject({ version: 3 });
  expect(await adjust('operator', 'synthetic', adjustInput(synthetic.id))).toMatchObject({
    version: 2,
  });
  const denied = [
    ['reviewer of the same tenant', () => adjust('reviewer', 'real', adjustInput(made.id))],
    ['viewer of the same tenant', () => adjust('viewer', 'real', adjustInput(made.id))],
    ['staff of another tenant', () => adjust('other', 'synthetic', adjustInput(made.id))],
    ['staff of the other side', () => adjust('owner', 'synthetic', adjustInput(made.id))],
    [
      'the real side asking about a sample organisation',
      () => adjust('owner', 'real', adjustInput(synthetic.id)),
    ],
    ['an unknown organisation', () => adjust('owner', 'real', adjustInput(randomUUID()))],
  ] as const;
  const answers = new Set<string>();
  for (const [label, run] of denied) {
    const got = await failure(run());
    expect(got, label).toBe('42501|' + unavailable);
    answers.add(got);
  }
  expect(answers.size).toBe(1);
  const readers = new Set<string>();
  for (const run of [
    () => read('reviewer', 'real', made.id),
    () => read('other', 'synthetic', made.id),
    () => read('owner', 'synthetic', made.id),
    () => read('owner', 'real', synthetic.id),
    () => read('owner', 'real', randomUUID()),
  ])
    readers.add(await failure(run()));
  expect([...readers]).toEqual(['42501|' + unavailable]);
  // Nothing was written by a refused call.
  expect(await s.rightsRows(made.id)).toHaveLength(3);
  // A hidden organisation stays readable and adjustable by its staff: hiding is not a rights matter.
  await s.hide(s.ctx('reviewer', 'real'), made.id);
  expect((await read('operator', 'real', made.id)).status).toBe('recorded');
});

test('the rights table cannot be updated or deleted, and the logins have no direct access or private helper', async () => {
  const made = await s.ingest('real', s.identity('real', 'Rewrite Probe GmbH'), 'other');
  for (const sql of [
    'UPDATE customer_private.organisation_source_rights SET reason=reason',
    'DELETE FROM customer_private.organisation_source_rights',
  ])
    await expect(
      w.f.owner.query(sql + ' WHERE organisation_id=$1', [made.id]),
      sql,
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Immutable record; append a new record',
    });
  expect(await s.rightsRows(made.id)).toHaveLength(1);
  for (const pool of [w.f.runtime, w.f.auth]) {
    for (const sql of [
      'SELECT * FROM customer_private.organisation_source_rights',
      'INSERT INTO customer_private.organisation_source_rights DEFAULT VALUES',
      'UPDATE customer_private.organisation_source_rights SET reason=reason',
      'DELETE FROM customer_private.organisation_source_rights',
      "SELECT * FROM customer_private.organisation_rights_defaults('other')",
      `SELECT customer_private.organisation_catalogue_visible('${randomUUID()}')`,
      `SELECT customer_private.organisation_rights_authority('${randomUUID()}')`,
      `SELECT customer_private.organisation_catalogue_domain_event('${w.intake}','${randomUUID()}','hidden','${randomUUID()}',1,'hidden')`,
    ])
      await expect(pool.query(sql), sql).rejects.toMatchObject({ code: '42501' });
  }
  const flags = await w.f.owner.query(
    `SELECT c.relrowsecurity,(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::int policies FROM pg_class c WHERE c.oid='customer_private.organisation_source_rights'::regclass`,
  );
  expect(flags.rows[0]).toEqual({ relrowsecurity: true, policies: 0 });
  // Grants by ACL: only the six entry points are executable by the runtime login, nothing by PUBLIC or the auth login.
  const acl = await w.f.owner.query(
    `SELECT p.oid::regprocedure::text sig,
       has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth,
       has_function_privilege('public',p.oid,'EXECUTE') pub
     FROM pg_proc p WHERE p.proname = ANY($1) ORDER BY 1`,
    [
      [
        'ingest_public_organisation_with_rights',
        'adjust_organisation_source_rights',
        'organisation_source_rights_read',
        'customer_organisation_suppress',
        'customer_organisation_link_redact',
        'customer_organisation_link_closed_claims',
        'organisation_rights_defaults',
        'organisation_catalogue_visible',
        'organisation_rights_authority',
        'organisation_catalogue_domain_event',
        'organisation_source_rights_json',
      ],
    ],
  );
  expect(acl.rows).toHaveLength(11);
  const entry =
    /with_rights|adjust_organisation|source_rights_read|link_redact|closed_claims|customer_organisation_suppress/;
  for (const r of acl.rows)
    expect([r.sig, r.runtime, r.auth, r.pub], r.sig).toEqual([
      r.sig,
      entry.test(r.sig),
      false,
      false,
    ]);
});

test('provenance cells for the rights writers: real staff on a real organisation, sample staff on a sample one, and no cross-over', async () => {
  const real = await s.ingest('real', s.identity('real', 'Cell Real GmbH'), 'other');
  const sample = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Cell Werke AG'),
    'other',
  );
  expect((await read('owner', 'real', real.id)).status).toBe('recorded');
  expect((await read('owner', 'synthetic', sample.id)).status).toBe('recorded');
  await expect(read('owner', 'synthetic', real.id)).rejects.toMatchObject({ message: unavailable });
  await expect(read('owner', 'real', sample.id)).rejects.toMatchObject({ message: unavailable });
  // A session with no staff identity at all reaches the function and is refused the same way.
  await expect(
    w.f.runtime.query('SELECT app.organisation_source_rights_read($1)', [real.id]),
  ).rejects.toMatchObject({ message: unavailable });
  await expect(
    w.f.runtime.query('SELECT app.adjust_organisation_source_rights($1,$2)', [
      randomUUID(),
      JSON.stringify(adjustInput(real.id)),
    ]),
  ).rejects.toMatchObject({ message: unavailable });
});

test('rights adjust writes no event, and no new payload carries a reason, reference or note', async () => {
  const made = await s.ingest('real', s.identity('real', 'Privacy Probe GmbH'), 'other');
  const before = (await w.f.owner.query('SELECT count(*)::int n FROM app.domain_event')).rows[0].n;
  const secretReason = 'SECRET-REASON-' + randomUUID();
  await adjust('owner', 'real', adjustInput(made.id, { reason: secretReason }));
  expect((await w.f.owner.query('SELECT count(*)::int n FROM app.domain_event')).rows[0].n).toBe(
    before,
  );
  const secretRef = 'SECRET-REF-' + randomUUID();
  const secretWhy = 'SECRET-WHY-' + randomUUID();
  await s.hide(s.ctx('reviewer', 'real'), made.id, { reason: secretWhy, reference: secretRef });
  const everything = (
    await w.f.owner.query(
      `SELECT (SELECT coalesce(string_agg(payload::text,' '),'') FROM app.domain_event)||' '||(SELECT coalesce(string_agg(action,' '),'') FROM app.audit_event)||' '||
        (SELECT coalesce(string_agg(t::text,' '),'') FROM app.outbox t)||' '||(SELECT coalesce(string_agg(t::text,' '),'') FROM app.outbox_delivery t) AS text`,
    )
  ).rows[0].text as string;
  for (const secret of [
    secretReason,
    secretRef,
    secretWhy,
    'Takedown requested',
    'Checked against',
  ])
    expect(everything, secret).not.toContain(secret);
  const [event] = (await s.events('customer.organisation_catalogue.hidden')).filter(
    (e) => e.aggregate_id === made.id,
  );
  expect(event.payload).toMatchObject({
    organisationId: made.id,
    version: 1,
    state: 'hidden',
    synthetic: false,
  });
});

test('the application call site uses the wrapper when it is installed and the 8-argument function when it is not', async () => {
  const wrapper =
    'app.ingest_public_organisation_with_rights(uuid,uuid,text,text,text,text,text,text,text)';
  const installed = await s.ingest(
    'real',
    s.identity('real', 'Call Site Installed GmbH'),
    'trade_body_list',
  );
  expect(installed.warnings).toEqual([]);
  expect((await s.rightsRows(installed.id))[0]).toMatchObject({ source_type: 'trade_body_list' });
  await w.f.owner.query(
    `ALTER FUNCTION ${wrapper} RENAME TO ingest_public_organisation_with_rights_moved`,
  );
  try {
    const hiddenWrapper = await s.ingest(
      'real',
      s.identity('real', 'Call Site Hidden GmbH'),
      'trade_body_list',
    );
    expect(Object.keys(hiddenWrapper)).toEqual(['id']);
    expect(await s.rightsRows(hiddenWrapper.id)).toHaveLength(0);
    expect(
      (
        await w.f.owner.query('SELECT count(*)::int n FROM app.organisation WHERE id=$1', [
          hiddenWrapper.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await w.f.owner.query(
      'ALTER FUNCTION app.ingest_public_organisation_with_rights_moved(uuid,uuid,text,text,text,text,text,text,text) RENAME TO ingest_public_organisation_with_rights',
    );
  }
  expect(
    (await s.ingest('real', s.identity('real', 'Call Site Back GmbH'), undefined)).warnings,
  ).toEqual(['source_not_classified']);
  // An unknown source type is refused at the service boundary, before the database.
  await expect(
    s.ingest('real', s.identity('real', 'Call Site Bad GmbH'), 'banana'),
  ).rejects.toThrow();
});
