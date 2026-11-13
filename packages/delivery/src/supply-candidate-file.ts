import { createHash } from 'node:crypto';
import { DomainError } from '@corridra/domain';
import {
  classifySupplyHeaders,
  supplyFileColumns,
  supplyMaxRows,
  supplyWords,
} from '@corridra/domain/supply-sources';
import { tableRows } from './import';

// ADR-082 section 6: the supply candidate file. It reuses the participant import's strict CSV and safe XLSX readers through
// the generic `tableRows`, and adds only the header rules. The whole file is refused for a personal or unknown header, for a
// missing or repeated column, for no rows and for more than 100 rows. Each row's own fields are judged later, one row at a
// time, by the import command, which reports a reason code per row and never the row's text.
export type SupplyFileRow = {
  row: number;
  cells: Record<(typeof supplyFileColumns)[number], string>;
};
export type SupplyFile = { digest: string; rows: SupplyFileRow[] };

const refuse = (message: string): never => {
  throw new DomainError(message, 400);
};

export async function parseSupplyCandidateFile(
  bytes: Buffer,
  format: 'CSV' | 'XLSX',
): Promise<SupplyFile> {
  const table = await tableRows(bytes, { format, rows: supplyMaxRows, label: 'candidate' });
  const header = (table.shift()?.cells ?? []).map((value) => value.trim());
  if (!header.length || header.every((value) => !value)) return refuse(supplyWords.noColumns);
  const { personal, unknown } = classifySupplyHeaders(header);
  if (personal.length) return refuse(supplyWords.personalColumns);
  if (unknown.length) return refuse(supplyWords.unknownColumns(unknown));
  if (
    new Set(header).size !== header.length ||
    supplyFileColumns.some((column) => !header.includes(column))
  )
    return refuse(supplyWords.exactColumns);
  const rows: SupplyFileRow[] = [];
  for (const { row, cells } of table) {
    if (!cells.some((value) => value.trim())) continue;
    if (cells.length > header.length) return refuse(supplyWords.extraValues(row));
    rows.push({
      row,
      cells: Object.fromEntries(
        header.map((column, index) => [column, cells[index]?.trim() ?? '']),
      ) as SupplyFileRow['cells'],
    });
  }
  if (!rows.length) return refuse(supplyWords.noRows);
  return { digest: createHash('sha256').update(bytes).digest('hex'), rows };
}

/** The header row of the template a person can download. Eight columns, no example person. */
export const supplyFileTemplate = () => `${supplyFileColumns.join(',')}\r\n`;
