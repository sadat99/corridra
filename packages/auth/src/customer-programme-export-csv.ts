// Server-side CSV for the organiser exports. Pure functions so the escaping rules are tested on their own.
export const exportDatasets = ['programmes', 'ledger'] as const;
export type ExportDataset = (typeof exportDatasets)[number];

type Row = Record<string, unknown>;
type Column = { header: string; cell: (row: Row) => string; numeric?: boolean };

const BOM = '﻿';
const formulaStart = /^[=+\-@\t\r\n]/;
const plainNumber = /^-?\d+(\.\d+)?$/;

// A cell that a spreadsheet could read as a formula is prefixed with a single quote so it is shown as text.
// Genuine numbers are left alone: a spreadsheet reads "-500" as a number, never as a formula.
export function csvCell(value: unknown, numeric = false): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (numeric && plainNumber.test(text)) return text;
  const safe = formulaStart.test(text) ? "'" + text : text;
  return /[",\r\n]|^\s|\s$/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

// Exact decimal rendering of an integer count of minor units, with no floating point.
export function decimalAmount(minor: unknown, exponent: unknown): string {
  const text = String(minor ?? '');
  const places = Number(exponent);
  if (!/^-?\d+$/.test(text) || !Number.isInteger(places) || places < 0 || places > 6) return '';
  const negative = text.startsWith('-');
  const digits = (negative ? text.slice(1) : text).replace(/^0+(?=\d)/, '');
  if (places === 0) return (negative ? '-' : '') + digits;
  const padded = digits.padStart(places + 1, '0');
  return (
    (negative ? '-' : '') + padded.slice(0, padded.length - places) + '.' + padded.slice(-places)
  );
}

const text = (key: string, header = key): Column => ({
  header,
  cell: (row) => String(row[key] ?? ''),
});
const num = (key: string, header = key): Column => ({
  header,
  numeric: true,
  cell: (row) => String(row[key] ?? ''),
});
const money = (minorKey: string, header: string): Column => ({
  header,
  numeric: true,
  cell: (row) => decimalAmount(row[minorKey], row.exponent),
});

const columns: Record<ExportDataset, Column[]> = {
  programmes: [
    text('programmeId', 'programme_id'),
    text('name', 'programme_name'),
    text('createdAt', 'created_at'),
    num('registered', 'participants_registered'),
    num('active', 'participants_active'),
    text('currency', 'currency'),
    num('feesDueMinor', 'fees_due_minor'),
    money('feesDueMinor', 'fees_due'),
    num('paymentsRecordedMinor', 'payments_recorded_minor'),
    money('paymentsRecordedMinor', 'payments_recorded'),
    num('plannedCostsMinor', 'planned_costs_minor'),
    money('plannedCostsMinor', 'planned_costs'),
    num('actualCostsMinor', 'actual_costs_minor'),
    money('actualCostsMinor', 'actual_costs'),
  ],
  ledger: [
    text('programmeId', 'programme_id'),
    num('seq', 'entry_number'),
    text('kind', 'kind'),
    text('costBasis', 'cost_basis'),
    text('registrationId', 'participant_reference'),
    num('amountMinor', 'amount_minor'),
    money('amountMinor', 'amount'),
    text('currency', 'currency'),
    text('occurredOn', 'date'),
    text('description', 'description'),
    num('reversesSeq', 'corrects_entry_number'),
    text('recordedAt', 'recorded_at'),
  ],
};

export function exportCsv(dataset: ExportDataset, rows: Row[]): string {
  const cols = columns[dataset];
  const lines = [cols.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(c.cell(row), c.numeric)).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

// The file name never carries a workspace, programme or person name. Only the dataset and the date.
export function exportFileName(dataset: ExportDataset, now = new Date()): string {
  return 'corridra-' + dataset + '-' + now.toISOString().slice(0, 10) + '.csv';
}
