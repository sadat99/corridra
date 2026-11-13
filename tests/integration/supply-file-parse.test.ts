import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  csvRows,
  intakeTemplate,
  parseImport,
  tableRows,
} from '../../packages/delivery/src/import';
import {
  parseSupplyCandidateFile,
  supplyFileTemplate,
} from '../../packages/delivery/src/supply-candidate-file';
import { supplyFileColumns, supplyWords } from '../../packages/domain/src/supply-sources';

// ADR-082 section 6 and D6 (slice S3): the supply candidate file reuses the participant import's readers. The participant
// import keeps every message byte for byte; the candidate file adds the header rules, the 100 row cap and a digest.
const header = supplyFileColumns.join(',');
const row = (n: number) =>
  `Acme Trading ${n} Ltd,DE,acme${n}.example,HRB ${n},small,importer|distributor,2026-11-01T00:00:00Z,https://registry.example/${n}`;
const csv = (lines: string[]) => Buffer.from(lines.join('\r\n') + '\r\n');
const message = async (work: Promise<unknown>) => {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

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
const column = (index: number) => String.fromCharCode(65 + index);
function workbook(table: string[][]) {
  return archive({
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Candidates" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${table
      .map(
        (cells, i) =>
          `<row r="${i + 1}">${cells.map((s, j) => `<c r="${column(j)}${i + 1}" t="inlineStr"><is><t>${s}</t></is></c>`).join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`,
  });
}

describe('the participant import is unchanged', () => {
  test('its row limit message is byte identical, and the generic reader gives the same rows', async () => {
    const header = intakeTemplate().split('\r\n')[0];
    const many = [header, ...Array.from({ length: 101 }, (_, i) => `p${i},${'x,'.repeat(15)}x`)];
    expect(() => csvRows(many.join('\r\n'))).toThrow('Use at most 100 participant rows');
    await expect(parseImport(Buffer.from(many.join('\r\n')), 'CSV')).rejects.toThrow(
      'Use at most 100 participant rows',
    );
    const text = intakeTemplate();
    expect(await tableRows(Buffer.from(text), { format: 'CSV' })).toEqual(csvRows(text));
  });
});

describe('the candidate file', () => {
  test('eight columns, one row: parsed with a digest of the bytes', async () => {
    const bytes = csv([header, row(1)]);
    const file = await parseSupplyCandidateFile(bytes, 'CSV');
    expect(file.digest).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(file.rows).toEqual([
      {
        row: 2,
        cells: {
          company_name: 'Acme Trading 1 Ltd',
          country: 'DE',
          website_host: 'acme1.example',
          public_identifier: 'HRB 1',
          size_band: 'small',
          counterparty_types: 'importer|distributor',
          observed_at: '2026-11-01T00:00:00Z',
          source_locator: 'https://registry.example/1',
        },
      },
    ]);
    expect(supplyFileTemplate().trim()).toBe(header);
  });

  test('the XLSX path gives the same result as the CSV path', async () => {
    const lines = [header, row(1), row(2)];
    const fromCsv = await parseSupplyCandidateFile(csv(lines), 'CSV');
    const fromXlsx = await parseSupplyCandidateFile(
      workbook(lines.map((line) => line.split(','))),
      'XLSX',
    );
    expect(fromXlsx.rows).toEqual(fromCsv.rows);
  });

  test('a personal header refuses the whole file with the exact words', async () => {
    for (const bad of ['email', 'phone', 'contact_person', 'name', 'Contact', 'person_name'])
      expect(
        await message(parseSupplyCandidateFile(csv([`${header},${bad}`, `${row(1)},x`]), 'CSV')),
        bad,
      ).toBe(
        'This file has personal contact columns. Remove them; personal data cannot be imported.',
      );
  });

  test('an unknown header is refused and named; nomination_note is not accepted from a file', async () => {
    expect(
      await message(parseSupplyCandidateFile(csv([`${header},colour`, `${row(1)},red`]), 'CSV')),
    ).toBe(
      'This file has columns Corridra does not accept: colour. Use only the eight listed columns.',
    );
    expect(
      await message(
        parseSupplyCandidateFile(csv([`${header},nomination_note`, `${row(1)},hello`]), 'CSV'),
      ),
    ).toBe(
      'This file has columns Corridra does not accept: nomination_note. Use only the eight listed columns.',
    );
    expect(supplyWords.unknownColumns(['a', 'b'])).toBe(
      'This file has columns Corridra does not accept: a, b. Use only the eight listed columns.',
    );
  });

  test('exactly the eight columns: a missing or repeated one is refused', async () => {
    const seven = supplyFileColumns.slice(0, 7).join(',');
    expect(await message(parseSupplyCandidateFile(csv([seven, 'a,b,c,d,e,f,g']), 'CSV'))).toMatch(
      /^Use exactly the eight listed columns/,
    );
    expect(
      await message(parseSupplyCandidateFile(csv([`${seven},country`, 'a,b,c,d,e,f,g,h']), 'CSV')),
    ).toMatch(/^Use exactly the eight listed columns/);
  });

  test('100 rows are accepted, 101 are refused, an empty file is refused, blank rows are skipped', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => row(i + 1));
    expect((await parseSupplyCandidateFile(csv([header, ...hundred]), 'CSV')).rows).toHaveLength(
      100,
    );
    expect(
      await message(parseSupplyCandidateFile(csv([header, ...hundred, row(101)]), 'CSV')),
    ).toBe('Use at most 100 candidate rows');
    expect(
      await message(
        parseSupplyCandidateFile(
          workbook([header.split(','), ...[...hundred, row(101)].map((r) => r.split(','))]),
          'XLSX',
        ),
      ),
    ).toBeTruthy();
    expect(await message(parseSupplyCandidateFile(csv([header]), 'CSV'))).toBe(
      'Include at least one candidate row',
    );
    const withBlank = await parseSupplyCandidateFile(
      csv([header, row(1), ',,,,,,,', row(2)]),
      'CSV',
    );
    expect(withBlank.rows.map((r) => r.row)).toEqual([2, 4]);
  });

  test('the same bytes give the same digest and other bytes another', async () => {
    const a = await parseSupplyCandidateFile(csv([header, row(1)]), 'CSV');
    const b = await parseSupplyCandidateFile(csv([header, row(1)]), 'CSV');
    const c = await parseSupplyCandidateFile(csv([header, row(2)]), 'CSV');
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
  });

  test('size and encoding limits of the shared reader still apply', async () => {
    expect(await message(parseSupplyCandidateFile(Buffer.alloc(0), 'CSV'))).toBe(
      'Use a file between 1 byte and 1 MiB',
    );
    expect(await message(parseSupplyCandidateFile(Buffer.from([0xff, 0xfe]), 'CSV'))).toBe(
      'Use a UTF-8 CSV or an XLSX workbook',
    );
  });
});
