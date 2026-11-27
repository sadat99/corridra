import { csvCell } from '@corridra/auth/customer-programme-export-csv';
import { blankSheetRows } from '@corridra/domain/route-pack-standard';
import type { ProblemItem } from '../../lib/route-pack-editor-sheet';

// ADR-093 Phase 3, PR 4: the two files the import dialog makes in the page, written exactly as the server writes its export
// (a byte order mark, every cell through csvCell, CRLF line ends), so a spreadsheet opens them the same way and a formula-like
// cell is shown as text. The blank template is the domain's own (spec question 7: built in the page, no request).
export const csvText = (rows: readonly (readonly string[])[]) =>
  '﻿' + rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n') + '\r\n';

export const templateName = 'route-pack-template.csv';
/** The blank template for one route: the header and every standard field, Pending. */
export const blankTemplate = (route: string) => csvText(blankSheetRows(route));

export const problemListName = 'route-pack-problems.csv';
export const problemColumns = ['row', 'route', 'field', 'problem'] as const;
/** The problem list as a file: one line per problem, in the order the dialog lists them. */
export const problemList = (items: readonly ProblemItem[]) =>
  csvText([
    [...problemColumns],
    ...items.map((item) => [
      item.row === null ? '' : String(item.row),
      item.route ?? '',
      item.label ?? '',
      item.message,
    ]),
  ]);
