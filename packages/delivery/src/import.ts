import { createHash } from 'node:crypto';
import { fromBuffer, type ZipFile } from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DomainError } from '@corridra/domain';
import { briefSchema, type MissionBrief } from '@corridra/domain/missions';

export const importLimits = {
  bytes: 1048576,
  rows: 100,
  columns: 17,
  expandedBytes: 8388608,
  entryBytes: 4194304,
  entries: 100,
} as const;
export const importColumns = [
  'participant_reference',
  'company',
  'name',
  'email',
  'objective',
  'market',
  'offer',
  'attendance',
  'startDate',
  'endDate',
  'timezone',
  'website',
  'outcomes',
  'notes',
  'companyCountry',
  'marketCode',
  'missionJob',
] as const;
const required = importColumns.slice(0, 7);
export type ImportRow = {
  row: number;
  reference: string;
  status: 'READY' | 'DUPLICATE_FILE' | 'DUPLICATE_EXISTING' | 'EMPTY' | 'ERROR';
  errors: string[];
  brief?: MissionBrief;
  hash?: string;
  missionId?: string;
};
export const canonicalHash = (brief: MissionBrief) =>
  createHash('sha256').update(JSON.stringify(brief)).digest('hex');
function invalid(message: string): never {
  throw new DomainError(message, 400);
}
const textDecoder = new TextDecoder('utf-8', { fatal: true });
function decode(bytes: Uint8Array) {
  try {
    return textDecoder.decode(bytes);
  } catch {
    return invalid('Use a UTF-8 CSV or an XLSX workbook');
  }
}

// Strict RFC 4180 parser. Physical source rows remain visible across quoted newlines.
export function csvRows(text: string): { row: number; cells: string[] }[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: { row: number; cells: string[] }[] = [];
  let cells: string[] = [],
    cell = '',
    quoted = false,
    afterQuote = false,
    physical = 1,
    start = 1,
    pending = false;
  const finish = () => {
    cells.push(cell);
    rows.push({ row: start, cells });
    cells = [];
    cell = '';
    afterQuote = false;
    pending = false;
    if (rows.length > importLimits.rows + 1) invalid('Use at most 100 participant rows');
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    pending = true;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += ch;
        if (ch === '\n') physical++;
      }
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      afterQuote = false;
      if (cells.length >= importLimits.columns) invalid('Too many columns');
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      finish();
      physical++;
      start = physical;
    } else if (ch === '"' && !cell && !afterQuote) quoted = true;
    else {
      if (afterQuote || ch === '"') invalid(`Malformed CSV quotation at row ${physical}`);
      cell += ch;
    }
  }
  if (quoted) invalid(`Unclosed quotation at row ${start}`);
  if (pending || cells.length || cell) finish();
  return rows;
}

async function unzip(bytes: Buffer) {
  const entries = new Map<string, Buffer>();
  let expanded = 0,
    count = 0;
  await new Promise<void>((resolve, reject) => {
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, archive) => {
        if (error || !archive) {
          reject(new DomainError('Invalid XLSX archive', 400));
          return;
        }
        const zip: ZipFile = archive;
        let settled = false;
        const fail = () => {
          if (!settled) {
            settled = true;
            zip.close();
            reject(new DomainError('Unsupported or unsafe XLSX archive', 400));
          }
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });
        zip.on('entry', (entry) => {
          if (
            ++count > importLimits.entries ||
            entries.has(entry.fileName) ||
            /(?:^|\/)\.\.(?:\/|$)/.test(entry.fileName) ||
            entry.fileName.startsWith('/') ||
            entry.generalPurposeBitFlag & 1 ||
            entry.uncompressedSize > importLimits.entryBytes ||
            entry.uncompressedSize > Math.max(65536, entry.compressedSize * 200) ||
            /(?:vbaProject|externalLinks|embeddings|activeX|calcChain)/i.test(entry.fileName)
          ) {
            fail();
            return;
          }
          if (entry.fileName.endsWith('/')) {
            entries.set(entry.fileName, Buffer.alloc(0));
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              fail();
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              expanded += chunk.length;
              if (size > importLimits.entryBytes || expanded > importLimits.expandedBytes) {
                stream.destroy();
                fail();
                return;
              }
              chunks.push(chunk);
            });
            stream.on('end', () => {
              if (!settled) {
                entries.set(entry.fileName, Buffer.concat(chunks));
                zip.readEntry();
              }
            });
          });
        });
        zip.readEntry();
      },
    );
  });
  return entries;
}
type Xml = Record<string, unknown>;
const array = (value: unknown): Xml[] =>
  value === undefined ? [] : ((Array.isArray(value) ? value : [value]) as Xml[]);
const obj = (value: unknown): Xml => (value && typeof value === 'object' ? value : {}) as Xml;
function xml(text: string): Xml {
  if (/<!DOCTYPE|<!ENTITY|<\w+:/i.test(text) || XMLValidator.validate(text) !== true)
    invalid('Unsupported or unsafe workbook XML');
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
  }).parse(text) as Xml;
}
function stringValue(value: unknown): string {
  if (typeof value === 'string')
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(
        /&#(?:x([a-f\d]+)|(\d+));/gi,
        (_, hex: string | undefined, decimal: string | undefined) => {
          const code = parseInt(hex ?? decimal!, hex ? 16 : 10);
          if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
            invalid('Invalid XML character');
          return String.fromCodePoint(code);
        },
      )
      .replace(/&amp;/g, '&');
  if (value === undefined) return '';
  if (typeof value === 'object') return stringValue(obj(value)['#text']);
  return invalid('Unsupported cell value');
}
function richText(value: unknown): string {
  const v = obj(value);
  return v.t !== undefined
    ? stringValue(v.t)
    : array(v.r)
        .map((r) => stringValue(r.t))
        .join('');
}
async function excelRows(bytes: Buffer) {
  const files = await unzip(bytes);
  const documents = new Map<string, Xml>();
  for (const [name, bytes] of files)
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const text = decode(bytes);
      if (/macroEnabled|TargetMode\s*=\s*["']External|<f(?:\s|>)/i.test(text))
        invalid('Workbooks with formulas, macros or external links are not accepted');
      const document = xml(text);
      if (
        name.endsWith('.rels') &&
        array(obj(document.Relationships).Relationship).some(
          (r) => stringValue(r['@TargetMode']).toLowerCase() === 'external',
        )
      )
        invalid('External workbook relationships are not accepted');
      documents.set(name, document);
    }
  const sheets = array(obj(obj(documents.get('xl/workbook.xml')?.workbook).sheets).sheet);
  if (sheets.length !== 1) invalid('Use a workbook with exactly one worksheet');
  if (sheets[0]['@state'] && sheets[0]['@state'] !== 'visible') invalid('Use a visible worksheet');
  const relations = array(
    obj(documents.get('xl/_rels/workbook.xml.rels')?.Relationships).Relationship,
  );
  const sheetRelation = relations.find((r) => r['@Id'] === sheets[0]['@r:id']);
  if (!sheetRelation || typeof sheetRelation['@Target'] !== 'string')
    invalid('Workbook worksheet is missing');
  const target = sheetRelation['@Target'] as string;
  const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) invalid('Unsupported worksheet location');
  const worksheet = obj(documents.get(path)?.worksheet);
  if (!Object.keys(worksheet).length) invalid('Worksheet is missing');
  if (worksheet.mergeCells || worksheet.hyperlinks)
    invalid('Merged cells and hyperlinks are not accepted');
  if (array(obj(worksheet.cols).col).some((c) => ['true', '1'].includes(String(c['@hidden']))))
    invalid('Hidden columns are not accepted');
  const shared = array(obj(documents.get('xl/sharedStrings.xml')?.sst).si).map(richText);
  const source = array(obj(worksheet.sheetData).row);
  const rows: { row: number; cells: string[] }[] = [];
  let last = 0;
  for (const row of source) {
    const n = Number(row['@r']);
    if (
      !Number.isInteger(n) ||
      n <= last ||
      n > importLimits.rows + 1 ||
      row['@hidden'] === '1' ||
      row['@hidden'] === 'true'
    )
      invalid('Rows must be visible, ordered and within the 100 row limit');
    while (last + 1 < n) {
      rows.push({ row: ++last, cells: [] });
    }
    const cells: string[] = [];
    const seen = new Set<number>();
    for (const cell of array(row.c)) {
      const ref = String(cell['@r'] ?? '').match(/^([A-Z]+)(\d+)$/);
      if (!ref || Number(ref[2]) !== n || cell.f !== undefined) invalid('Invalid or formula cell');
      const col = [...ref[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      if (col >= importLimits.columns || seen.has(col)) invalid('Unsupported or duplicate column');
      seen.add(col);
      const t = cell['@t'];
      if (t !== undefined && !['s', 'inlineStr', 'str', 'n'].includes(String(t)))
        invalid('Use text cells without errors or boolean values');
      let value = t === 'inlineStr' ? richText(cell.is) : stringValue(cell.v);
      if (t === 's') {
        const index = Number(value);
        if (!/^\d+$/.test(value) || shared[index] === undefined) invalid('Invalid shared string');
        value = shared[index];
      }
      cells[col] = value;
    }
    rows.push({ row: n, cells: Array.from({ length: cells.length }, (_, i) => cells[i] ?? '') });
    last = n;
  }
  return rows;
}

export async function parseImport(bytes: Buffer, format: 'CSV' | 'XLSX'): Promise<ImportRow[]> {
  if (!bytes.length || bytes.length > importLimits.bytes)
    invalid('Use a file between 1 byte and 1 MiB');
  const rows = format === 'CSV' ? csvRows(decode(bytes)) : await excelRows(bytes);
  const header = rows.shift()?.cells.map((v) => v.trim());
  if (
    !header?.length ||
    new Set(header).size !== header.length ||
    header.some((v) => !importColumns.includes(v as (typeof importColumns)[number])) ||
    required.some((v) => !header.includes(v))
  )
    invalid(
      'Use the intake template headers; include all seven required columns and no duplicate or unknown headers',
    );
  if (!rows.length) invalid('Include at least one participant row');
  const result: ImportRow[] = rows.map(({ row, cells }) => {
    if (!cells.some((v) => v.trim())) return { row, reference: '', status: 'EMPTY', errors: [] };
    if (cells.length > header.length)
      return { row, reference: '', status: 'ERROR', errors: ['More values than headers'] };
    const input = Object.fromEntries(header.map((key, i) => [key, cells[i]?.trim() ?? '']));
    const reference = input.participant_reference;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(reference))
      return {
        row,
        reference,
        status: 'ERROR',
        errors: [
          'Use a participant reference of 1 to 80 letters, numbers, dots, underscores or hyphens',
        ],
      };
    const parsed = briefSchema.safeParse({
      ...input,
      attendance: input.attendance || 'Not decided',
      timezone: input.timezone || 'Asia/Dhaka',
      outcomes: input.outcomes
        ? input.outcomes.split('|').map((v) => v.trim())
        : ['Relevant meetings'],
      acknowledged: true,
      experience:
        input.companyCountry || input.marketCode || input.missionJob
          ? {
              schemaVersion: 1,
              companyCountry: input.companyCountry,
              marketCode: input.marketCode,
              job: input.missionJob,
              requirements: {
                objective: input.objective,
                role:
                  input.missionJob === 'delegations'
                    ? 'INSTITUTION'
                    : ['sourcing', 'machinery_procurement', 'supplier_evaluation'].includes(
                          input.missionJob,
                        )
                      ? 'IMPORTER'
                      : 'EXPORTER',
                product: input.offer,
              },
            }
          : undefined,
    });
    if (!parsed.success)
      return {
        row,
        reference,
        status: 'ERROR',
        errors: parsed.error.issues.map((v) => `${v.path.join('.')}: ${v.message}`),
      };
    return {
      row,
      reference,
      status: 'READY',
      errors: [],
      brief: parsed.data,
      hash: canonicalHash(parsed.data),
    };
  });
  const refs = new Map<string, ImportRow>();
  for (const row of result)
    if (row.status === 'READY') {
      const old = refs.get(row.reference);
      if (old) {
        if (old.hash === row.hash && old.status !== 'ERROR') row.status = 'DUPLICATE_FILE';
        else {
          old.status = row.status = 'ERROR';
          old.errors = row.errors = ['Participant reference has conflicting briefs in this file'];
        }
      } else refs.set(row.reference, row);
    }
  return result;
}

export function importCounts(rows: ImportRow[]) {
  return {
    ready: rows.filter((r) => r.status === 'READY').length,
    duplicates: rows.filter((r) => r.status.startsWith('DUPLICATE')).length,
    empty: rows.filter((r) => r.status === 'EMPTY').length,
    errors: rows.filter((r) => r.status === 'ERROR').length,
    total: rows.length,
  };
}
export function intakeTemplate() {
  return `${importColumns.join(',')}\r\nparticipant-001,Synthetic Company,Synthetic Participant,participant@example.invalid,Find customers or distributors,Germany,Synthetic offer for validation,Not decided,,,Asia/Dhaka,,Relevant meetings,\r\n`;
}
