import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';
import { fixture, rawContext } from './support';
import { MissionService } from '../../packages/missions/src/index';
import { DeliveryService } from '../../packages/delivery/src/index';
import { parseImport, importCounts, intakeTemplate } from '../../packages/delivery/src/import';
import {
  csvCell,
  reportPdf,
  reportCsv,
  type DeliveryReport,
} from '../../packages/delivery/src/report';
const future = (days = 1) => new Date(Date.now() + days * 86400000).toISOString();
let f: Awaited<ReturnType<typeof fixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
const file = () => Buffer.from(intakeTemplate());
async function setup() {
  f = await fixture();
  const missions = new MissionService(f.runtime, 'isolated-delivery-test-secret');
  const delivery = new DeliveryService(f.runtime, missions, 'isolated-delivery-test-secret');
  const ctx = f.users.owner.ctx;
  const p = await delivery.programme(ctx, {
    commandId: randomUUID(),
    name: 'Synthetic programme',
    reportingPurpose: 'Synthetic programme outcome review',
  });
  const preview = await delivery.preview(ctx, p.id, randomUUID(), file(), 'CSV');
  const confirmation = {
    commandId: randomUUID(),
    importId: preview.id,
    ownerId: f.users.operator.id,
    counts: preview.counts,
    acknowledged: true,
  };
  const accepted = await delivery.confirm(ctx, confirmation);
  const missionId = accepted.rows[0].missionId;
  const pub = {
    commandId: randomUUID(),
    missionId,
    title: 'Approved synthetic mission',
    company: 'Synthetic Company',
    objective: 'Find relevant conversations',
    brief: 'Approved brief without participant contacts or private notes.',
    nextAction: 'Review the proposed programme',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  };
  const publication = await delivery.publication(ctx, pub);
  return {
    f,
    delivery,
    missions,
    ctx,
    programme: p,
    preview,
    confirmation,
    accepted,
    pub,
    publication,
  };
}
test('CSV preserves empty rows, physical row numbers, quotation, duplicate and conflicting references', async () => {
  const template = intakeTemplate().split('\r\n');
  const rows = await parseImport(
    Buffer.from(`${template[0]}\r\n${template[1]}\r\n\r\n${template[1]}\r\n`),
    'CSV',
  );
  expect(rows.map((r) => [r.row, r.status])).toEqual([
    [2, 'READY'],
    [3, 'EMPTY'],
    [4, 'DUPLICATE_FILE'],
  ]);
  expect(importCounts(rows)).toEqual({ ready: 1, duplicates: 1, empty: 1, errors: 0, total: 3 });
  const conflicts = await parseImport(
    Buffer.from(
      `${template[0]}\n${template[1]}\n${template[1].replace('Synthetic Company', 'Different Company')}`,
    ),
    'CSV',
  );
  expect(conflicts.every((r) => r.status === 'ERROR')).toBe(true);
  const multiline = await parseImport(
    Buffer.from(
      `${template[0]}\n${template[1].replace('Synthetic offer for validation', '"Synthetic offer\nwith a quoted comma, and text"')}\n\n`,
    ),
    'CSV',
  );
  expect(multiline.map((r) => r.row)).toEqual([2, 4]);
  expect(multiline[0].brief?.offer).toContain('\n');
  await expect(parseImport(Buffer.from(`${template[0]}\n"unterminated`), 'CSV')).rejects.toThrow(
    'Unclosed',
  );
  await expect(
    parseImport(Buffer.from(template[0].replace('company', 'email')), 'CSV'),
  ).rejects.toThrow('headers');
  await expect(parseImport(Buffer.from([0xff, 0xfe]), 'CSV')).rejects.toThrow('UTF-8');
  await expect(parseImport(Buffer.alloc(1048577), 'CSV')).rejects.toThrow('MiB');
});
function archive(files: Record<string, string>) {
  const data: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name),
      b = Buffer.from(text),
      local = Buffer.alloc(30),
      dir = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(b), 14);
    local.writeUInt32LE(b.length, 18);
    local.writeUInt32LE(b.length, 22);
    local.writeUInt16LE(n.length, 26);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(b), 16);
    dir.writeUInt32LE(b.length, 20);
    dir.writeUInt32LE(b.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    data.push(local, n, b);
    central.push(dir, n);
    offset += local.length + n.length + b.length;
  }
  const c = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(c.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, c, end]);
}
function workbook() {
  const rows = intakeTemplate()
    .trim()
    .split('\r\n')
    .map((r) => r.split(','));
  return {
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Intake" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((s, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${s}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`,
  };
}
test('Excel accepts normal text workbooks and rejects formulas, XXE, macros, external links and multiple sheets', async () => {
  const files = workbook();
  expect((await parseImport(archive(files), 'XLSX'))[0].status).toBe('READY');
  for (const attack of [
    {
      ...files,
      'xl/worksheets/sheet1.xml': files['xl/worksheets/sheet1.xml'].replace(
        '<is>',
        '<f>HYPERLINK("https://example.invalid")</f><is>',
      ),
    },
    {
      ...files,
      'xl/workbook.xml':
        '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + files['xl/workbook.xml'],
    },
    { ...files, 'xl/vbaProject.bin': 'macro' },
    {
      ...files,
      'xl/_rels/workbook.xml.rels': files['xl/_rels/workbook.xml.rels'].replace(
        'Type="worksheet"',
        'Type="worksheet" TargetMode="External"',
      ),
    },
    {
      ...files,
      'xl/workbook.xml': files['xl/workbook.xml'].replace(
        '</sheets>',
        '<sheet name="Hidden" r:id="rId2"/></sheets>',
      ),
    },
  ])
    await expect(parseImport(archive(attack), 'XLSX')).rejects.toThrow();
});
test('confirmed intake is atomic, idempotent, tenant-scoped and accounts for every row', async () => {
  const s = await setup();
  expect(await s.delivery.confirm(s.ctx, s.confirmation)).toEqual(s.accepted);
  expect((await s.f.owner.query('SELECT count(*)::int n FROM app.mission')).rows[0].n).toBe(1);
  await expect(
    s.delivery.confirm(s.ctx, { ...s.confirmation, ownerId: s.f.users.other.id }),
  ).rejects.toThrow();
  const next = await s.delivery.preview(s.ctx, s.programme.id, randomUUID(), file(), 'CSV');
  expect(next.rows[0].status).toBe('DUPLICATE_EXISTING');
  const again = await s.delivery.confirm(s.ctx, {
    ...s.confirmation,
    commandId: randomUUID(),
    importId: next.id,
    counts: next.counts,
  });
  expect(again.rows[0].missionId).toBe(s.accepted.rows[0].missionId);
  await expect(
    s.delivery.preview(s.f.users.other.ctx, s.programme.id, randomUUID(), file(), 'CSV'),
  ).rejects.toThrow();
  await expect(
    s.delivery.programme(s.f.users.viewer.ctx, {
      commandId: randomUUID(),
      name: 'Denied programme',
      reportingPurpose: 'Synthetic programme outcome review',
    }),
  ).rejects.toThrow();
  const invalid = await s.delivery.preview(
    s.ctx,
    s.programme.id,
    randomUUID(),
    Buffer.from(intakeTemplate().replace('participant-001', 'bad ref')),
    'CSV',
  );
  expect(invalid.counts.errors).toBe(1);
  await expect(
    s.delivery.confirm(s.ctx, {
      ...s.confirmation,
      commandId: randomUUID(),
      importId: invalid.id,
      counts: { ...invalid.counts, errors: 0 },
    }),
  ).rejects.toThrow();
  expect((await s.f.owner.query('SELECT count(*)::int n FROM app.mission')).rows[0].n).toBe(1);
});
test('client scope, declarations, replay, revocation and publisher access are enforced in PostgreSQL', async () => {
  const s = await setup();
  await expect(
    s.delivery.publication(s.f.users.operator.ctx, { ...s.pub, commandId: randomUUID() }),
  ).rejects.toThrow();
  const share = {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [s.publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic client mission progress',
    expiresAt: future(),
    allowExport: false,
    approved: true,
  };
  const link = await s.delivery.share(s.ctx, share);
  expect((await s.delivery.share(s.ctx, share)).token).toBe(link.token);
  const view = { action: 'view', token: link.token, audience: 'CLIENT_PROGRESS' };
  const report = (await s.delivery.external(view)) as DeliveryReport;
  expect(report.approvedParticipants).toBe(1);
  expect(JSON.stringify(report)).not.toContain('@example.invalid');
  expect(JSON.stringify(report)).not.toContain('participant-001');
  await expect(s.delivery.external({ ...view, audience: 'INSTITUTION_REPORT' })).rejects.toThrow();
  const r = await s.delivery.request(s.ctx, {
    commandId: randomUUID(),
    publicationId: s.publication.id,
    ownerId: s.f.users.operator.id,
    title: 'Confirm test requirements',
    instructions: 'Describe the synthetic requirement. Supporting files follow operator review.',
    dueAt: future(),
  });
  const response = {
    action: 'respond',
    token: link.token,
    audience: 'CLIENT_PROGRESS',
    commandId: randomUUID(),
    requestId: r.id,
    body: 'Self-declared synthetic requirement',
    acknowledged: true,
  };
  expect(await s.delivery.external(response)).toEqual(await s.delivery.external(response));
  await expect(
    s.delivery.external({ ...response, body: 'Different requirement' }),
  ).rejects.toThrow();
  await expect(
    s.delivery.external({ ...response, commandId: randomUUID(), requestId: randomUUID() }),
  ).rejects.toThrow();
  await s.delivery.closeRequest(s.ctx, {
    commandId: randomUUID(),
    requestId: r.id,
    status: 'COMPLETED',
    reason: 'Received declaration; verification remains separate',
  });
  await expect(s.delivery.external(response)).rejects.toThrow('closed');
  await s.delivery.revoke(s.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    publicationId: null,
    reason: 'Synthetic access ended',
  });
  await expect(s.delivery.external(view)).rejects.toThrow();
  const other = await s.delivery.share(s.ctx, { ...share, commandId: randomUUID() });
  await rawContext(
    s.f.owner,
    s.ctx,
    'UPDATE app.membership SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [s.f.tenantA, s.f.users.owner.id],
  );
  await expect(s.delivery.external({ ...view, token: other.token })).rejects.toThrow();
});
test('sharing requires fresh MFA even through direct SQL, and raw table writes cannot forge declarations', async () => {
  const s = await setup();
  await expect(
    rawContext(s.f.runtime, s.ctx, 'SELECT app.delivery_subject_access($1,$2,$3,$4)', [
      s.f.tenantA,
      s.f.users.owner.id,
      'INTERNAL',
      'synthetic_validation',
    ]),
  ).rejects.toThrow('permission denied');
  await expect(
    rawContext(s.f.runtime, s.ctx, 'SELECT app.delivery_publication_valid($1)', [s.publication.id]),
  ).rejects.toThrow('permission denied');
  await s.f.owner.query(
    "UPDATE identity.assurance SET verified_at=now()-interval '10 minutes' WHERE session_id=$1",
    [s.f.users.owner.sessionId],
  );
  await expect(
    s.delivery.publication(s.ctx, { ...s.pub, commandId: randomUUID() }),
  ).rejects.toThrow('authenticator');
  await expect(
    rawContext(
      s.f.runtime,
      s.ctx,
      'INSERT INTO app.delivery_publication(id,tenant_id,mission_id,copy,created_by) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), s.f.tenantA, s.pub.missionId, JSON.stringify(s.pub), s.f.users.owner.id],
    ),
  ).rejects.toThrow();
  await expect(
    rawContext(
      s.f.runtime,
      s.f.users.operator.ctx,
      'INSERT INTO app.delivery_response(id,tenant_id,request_id,link_id,body) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), s.f.tenantA, randomUUID(), randomUUID(), 'forged declaration'],
    ),
  ).rejects.toThrow();
  expect(
    (await rawContext(s.f.runtime, s.f.users.other.ctx, 'SELECT * FROM app.delivery_publication'))
      .rows,
  ).toEqual([]);
});
test('institutional exports enforce permission and purpose, exclude client responses, retain identical retries and audit once', async () => {
  const s = await setup();
  await s.delivery.request(s.ctx, {
    commandId: randomUUID(),
    publicationId: s.publication.id,
    ownerId: s.f.users.operator.id,
    title: 'Private evidence request',
    instructions: 'Private client declaration instructions',
    dueAt: future(),
  });
  const share = {
    commandId: randomUUID(),
    programmeId: s.programme.id,
    publicationIds: [s.publication.id],
    audience: 'INSTITUTION_REPORT',
    purpose: 'Synthetic programme outcome review',
    expiresAt: future(),
    allowExport: true,
    approved: true,
  };
  const link = await s.delivery.share(s.ctx, share);
  const unrelated = await s.delivery.programme(s.ctx, {
    commandId: randomUUID(),
    name: 'Unrelated synthetic programme',
    reportingPurpose: share.purpose,
  });
  await expect(
    s.delivery.share(s.ctx, { ...share, commandId: randomUUID(), programmeId: unrelated.id }),
  ).rejects.toThrow();
  const report = (await s.delivery.external({
    action: 'view',
    audience: 'INSTITUTION_REPORT',
    token: link.token,
  })) as DeliveryReport;
  expect(report.missions[0].requests).toBeUndefined();
  expect(JSON.stringify(report)).not.toContain('Private client');
  const input = {
    action: 'export',
    audience: 'INSTITUTION_REPORT',
    token: link.token,
    commandId: randomUUID(),
    purpose: share.purpose,
    format: 'CSV',
  };
  const one = (await s.delivery.external(input)) as { bytes: Buffer };
  const two = (await s.delivery.external(input)) as { bytes: Buffer };
  expect(one.bytes.equals(two.bytes)).toBe(true);
  expect(one.bytes.toString()).toContain('Approved synthetic mission');
  expect(
    (
      await s.f.owner.query(
        "SELECT count(*)::int n FROM app.domain_event WHERE type='delivery.export.generated'",
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(s.delivery.external({ ...input, format: 'PDF' })).rejects.toThrow();
  await expect(
    s.delivery.external({
      ...input,
      commandId: randomUUID(),
      purpose: 'Different reporting purpose',
    }),
  ).rejects.toThrow();
  const denied = await s.delivery.share(s.ctx, {
    ...share,
    commandId: randomUUID(),
    allowExport: false,
  });
  await expect(
    s.delivery.external({ ...input, commandId: randomUUID(), token: denied.token }),
  ).rejects.toThrow();
  const pdf = (await s.delivery.external({ ...input, commandId: randomUUID(), format: 'PDF' })) as {
    bytes: Buffer;
  };
  expect(pdf.bytes.subarray(0, 8).toString()).toMatch(/^%PDF-/);
  await s.delivery.revoke(s.ctx, {
    commandId: randomUUID(),
    linkId: link.id,
    publicationId: null,
    reason: 'Reporting permission withdrawn',
  });
  await expect(s.delivery.external(input)).rejects.toThrow();
});
test('CSV neutralizes formulas and PDF exports paginate, preserve unicode and reject missing glyphs explicitly', async () => {
  for (const attack of [
    '=HYPERLINK("url")',
    ' +CMD()',
    '\t@SUM(1)',
    '\r\n-1+2',
    '\u0001=evil',
    '\u0085=evil',
  ])
    expect(csvCell(attack)).toContain("'");
  expect(csvCell('A "quote", and comma')).toBe('"A ""quote"", and comma"');
  const s = await setup();
  const link = await s.delivery.share(s.ctx, {
    commandId: randomUUID(),
    programmeId: s.programme.id,
    publicationIds: [s.publication.id],
    audience: 'INSTITUTION_REPORT',
    purpose: 'Synthetic programme outcome review',
    expiresAt: future(),
    allowExport: true,
    approved: true,
  });
  const report = (await s.delivery.external({
    action: 'view',
    token: link.token,
    audience: 'INSTITUTION_REPORT',
  })) as DeliveryReport;
  report.missions = Array.from({ length: 30 }, () => ({
    ...report.missions[0],
    title: 'España ও বাংলাদেশ',
    brief: 'বাংলাদেশে বাণিজ্যিক অগ্রগতি পর্যালোচনা।',
    company: '=FORMULA()',
  }));
  expect(reportCsv(report).toString()).toContain("'=FORMULA()");
  const pdf = await reportPdf(report);
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  await expect(reportPdf({ ...report, programme: 'Unsupported 🛸' })).rejects.toThrow('font');
});
