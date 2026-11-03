import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import { DomainError } from '@corridra/domain';
import type { OfferTerms, RequirementFields } from '@corridra/domain/commercial-missions';
import type { BookRecord } from '@corridra/domain/books';
export type AgendaItem = {
  id: string;
  itemId: string;
  version: number;
  label: string;
  state: string;
  nextAction: string;
  dueAt: string;
  responsibility: string;
  meetings: {
    id: string;
    status: string;
    scheduleChanged: boolean;
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
    location?: string;
  }[];
};
export type MissionExperience = {
  schemaVersion: 1;
  requirements: null | {
    version: number;
    fields: RequirementFields;
    sourceKind: string;
    claimStatus: string;
    current: boolean;
  };
  shortlist: {
    id: string;
    company: string;
    country: string;
    fit: string;
    rationale: string;
    uncertainty: string;
    gaps: string;
    verification: string;
  }[];
  quotations: {
    id: string;
    targetId: string;
    currency: string;
    terms: OfferTerms;
    revision: number;
    uncertainties: string;
    sourceKind: string;
    claimStatus: string;
    superseded: boolean;
    assignmentCurrent: boolean;
  }[];
  agenda: AgendaItem[];
  documentAccess: string;
};
export type DeliveryMission = {
  experience?: MissionExperience;
  publicationId: string;
  title: string;
  company: string;
  objective: string;
  brief: string;
  nextAction: string;
  dueAt: string;
  reviewedAt: string;
  status: string;
  updatedAt: string;
  itinerary: {
    label: string;
    status: string;
    scheduleChanged: boolean;
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
    location?: string;
  }[];
  requests?: {
    id: string;
    title: string;
    instructions: string;
    dueAt: string;
    status: string;
    response?: string;
    responseAt?: string;
    claimStatus?: string;
  }[];
  outcomes: {
    opportunities: number;
    qualified: number;
    proposals: number;
    contracts: number;
    rfqs: number;
    samples: number;
    heldMeetings: number;
  };
  totals: {
    currency: string;
    contractMinor: string;
    invoiceMinor: string;
    confirmedCashMinor: string;
    repeatCashMinor: string;
  }[];
};
export type DeliveryReport = {
  heldMeetingsDistinct?: number;
  companyCountBasis?: string;
  delegation?: {
    context: null | {
      organiser: string;
      marketCode: string;
      purpose: string;
      startsAt: string;
      endsAt: string;
      timezone: string;
    };
    agenda: AgendaItem[];
  };
  schemaVersion: 1;
  scopeId: string;
  audience: 'CLIENT_PROGRESS' | 'INSTITUTION_REPORT';
  purpose: string;
  programme: string | null;
  generatedAt: string;
  expiresAt: string;
  allowExport: boolean;
  approvedParticipants: number;
  approvedCompanies: number;
  qualifiedCounterparties: number;
  totals: DeliveryMission['totals'];
  missions: DeliveryMission[];
  attribution: string;
};
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  // Sheets/Excel may ignore leading controls and whitespace before a formula.
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+@-]/u.test(text)) text = `'${text}`;
  text = text.replace(/\u0000/g, '');
  return `"${text.replace(/"/g, '""')}"`;
}
export function reportCsv(report: DeliveryReport): Buffer {
  const currencies = [
    'BDT',
    'USD',
    'EUR',
    'GBP',
    'JPY',
    ...Array.from(new Set(report.missions.flatMap((m) => m.totals.map((t) => t.currency))))
      .filter((c) => !['BDT', 'USD', 'EUR', 'GBP', 'JPY'].includes(c))
      .sort(),
  ];
  const header = [
    'scope_id',
    'schema_version',
    'generated_at',
    'purpose',
    'programme',
    'approved_participants',
    'approved_companies',
    'scope_qualified_counterparties',
    'company',
    'mission_title',
    'objective',
    'brief',
    'itinerary',
    'mission_status',
    'next_action',
    'due_at',
    'reviewed_at',
    'qualified_opportunities',
    'held_meetings',
    'rfqs',
    'samples',
    'proposals',
    'contracts',
    ...currencies.flatMap((c) => [
      `contract_minor_${c}`,
      `invoice_minor_${c}`,
      `confirmed_cash_minor_${c}`,
      `repeat_cash_minor_included_in_confirmed_${c}`,
    ]),
    'attribution',
  ];
  const rows: unknown[][] = [header];
  for (const m of report.missions) {
    rows.push([
      report.scopeId,
      report.schemaVersion,
      report.generatedAt,
      report.purpose,
      report.programme,
      report.approvedParticipants,
      report.approvedCompanies,
      report.qualifiedCounterparties,
      m.company,
      m.title,
      m.objective,
      m.brief,
      JSON.stringify(m.itinerary),
      m.status,
      m.nextAction,
      m.dueAt,
      m.reviewedAt,
      m.outcomes.qualified,
      m.outcomes.heldMeetings,
      m.outcomes.rfqs,
      m.outcomes.samples,
      m.outcomes.proposals,
      m.outcomes.contracts,
      ...currencies.flatMap((c) => {
        const total = m.totals.find((t) => t.currency === c);
        return [
          total?.contractMinor,
          total?.invoiceMinor,
          total?.confirmedCashMinor,
          total?.repeatCashMinor,
        ];
      }),
      report.attribution,
    ]);
  }
  return Buffer.from(
    `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
    'utf8',
  );
}
let fontFiles: Promise<Buffer[]> | undefined;
async function fonts() {
  // Literal, narrowly scoped paths keep Next's file tracing away from secrets and scratch files.
  fontFiles ??= process.cwd().endsWith('/apps/web')
    ? Promise.all([
        readFile(resolve(process.cwd(), '../../packages/delivery/assets/NotoSans.ttf')),
        readFile(resolve(process.cwd(), '../../packages/delivery/assets/NotoSansBengali.ttf')),
        readFile(
          resolve(process.cwd(), '../../packages/delivery/assets/NotoSansCJKsc-Regular.otf'),
        ),
      ])
    : Promise.all([
        readFile(resolve(process.cwd(), 'packages/delivery/assets/NotoSans.ttf')),
        readFile(resolve(process.cwd(), 'packages/delivery/assets/NotoSansBengali.ttf')),
        readFile(resolve(process.cwd(), 'packages/delivery/assets/NotoSansCJKsc-Regular.otf')),
      ]);
  return fontFiles;
}
type PdfWriter = {
  doc: PDFKit.PDFDocument;
  write: (text: string, size?: number) => void;
  // Starts a new page unless this much height is left, so a heading is never the last thing on a page.
  keepRoom: (height: number) => void;
};
type PdfOptions = {
  title: string;
  generatedAt: string;
  // Both messages name what the reader can do next, so each document says its own.
  unsupportedText: string;
  oversized: string;
  footer: (page: number, pages: number) => string;
};
// The one place a report PDF is written: fonts, text runs, size cap, pagination and footer. Each document
// supplies only its own words. No character is ever substituted: unsupported text is refused.
async function renderPdf(
  options: PdfOptions,
  compose: (writer: PdfWriter) => void,
): Promise<Buffer> {
  const bytes = await fonts();
  const supported = bytes.map((b) => {
    const face = fontkit.create(b);
    if (!('characterSet' in face)) throw new Error('A single report font face is required');
    return new Set(face.characterSet);
  });
  const select = (character: string) => {
    const index = supported.findIndex((set) => set.has(character.codePointAt(0)!));
    if (index < 0) throw new DomainError(options.unsupportedText, 422);
    return ['Latin', 'Bengali', 'Chinese'][index];
  };
  const doc = new PDFDocument({
    size: 'A4',
    margin: 45,
    bufferPages: true,
    compress: true,
    info: {
      Title: options.title,
      Author: 'Corridra',
      CreationDate: new Date(options.generatedAt),
      ModDate: new Date(options.generatedAt),
    },
  });
  doc.registerFont('Latin', bytes[0]);
  doc.registerFont('Bengali', bytes[1]);
  doc.registerFont('Chinese', bytes[2]);
  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    doc.on('error', reject);
    doc.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 8388608) {
        reject(new DomainError(options.oversized, 413));
        doc.destroy();
        return;
      }
      chunks.push(chunk);
    });
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const write = (text: string, size = 10) => {
    const clean = text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\t/g, ' ');
    const runs: { text: string; font: string }[] = [];
    for (const character of clean) {
      const font =
        /\s/u.test(character) && runs.length ? runs[runs.length - 1].font : select(character);
      const last = runs[runs.length - 1];
      if (last?.font === font) last.text += character;
      else runs.push({ text: character, font });
    }
    if (doc.y + size * 2 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    doc.fontSize(size).fillColor('#192633');
    if (!runs.length) doc.moveDown(0.3);
    runs.forEach((run, index) =>
      doc.font(run.font).text(run.text, { continued: index < runs.length - 1, lineGap: 4 }),
    );
    doc.moveDown(0.4);
  };
  const keepRoom = (height: number) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  try {
    compose({ doc, write, keepRoom });
    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index++) {
      doc.switchToPage(index);
      doc
        .font('Latin')
        .fontSize(8)
        .text(options.footer(index + 1, pages.count), 45, doc.page.height - 30, {
          lineBreak: false,
        });
    }
    doc.end();
  } catch (error) {
    doc.destroy();
    void output.catch(() => {});
    throw error;
  }
  return output;
}
export async function reportPdf(report: DeliveryReport): Promise<Buffer> {
  return renderPdf(
    {
      title: 'Corridra programme report',
      generatedAt: report.generatedAt,
      unsupportedText:
        'The PDF font cannot represent this text. Download the complete CSV report instead.',
      oversized:
        'The PDF exceeds the report size limit. Download CSV or approve a smaller reporting scope.',
      footer: (page, pages) => `Corridra | ${page} / ${pages}`,
    },
    ({ doc, write }) => {
      write('Corridra programme report', 18);
      write(report.programme ?? 'Approved programme', 14);
      write(`Generated: ${report.generatedAt}`);
      write(`Scope: ${report.scopeId}; report version: ${report.schemaVersion}`);
      write(`Purpose: ${report.purpose}`);
      write(`Approved participants: ${report.approvedParticipants}`);
      write(
        `Approved companies: ${report.approvedCompanies}; qualified counterparties: ${report.qualifiedCounterparties}`,
      );
      for (const t of report.totals)
        write(
          `Programme total ${t.currency}: contract ${t.contractMinor}; invoice ${t.invoiceMinor}; confirmed cash ${t.confirmedCashMinor}; repeat cash ${t.repeatCashMinor} (included).`,
        );
      if (report.companyCountBasis) write(report.companyCountBasis);
      if (report.heldMeetingsDistinct !== undefined)
        write(
          `Distinct held meetings: ${report.heldMeetingsDistinct}. Shared agenda activities count once; participant engagements are separate.`,
        );
      if (report.delegation?.context)
        write(
          `Delegation organiser: ${report.delegation.context.organiser}; shared purpose: ${report.delegation.context.purpose}`,
        );
      for (const a of report.delegation?.agenda ?? [])
        write(`Agenda: ${a.label}; ${a.state}; next: ${a.nextAction}; due: ${a.dueAt}`);
      write(report.attribution);
      write(
        'Amounts use registered integer minor currency units in their original currency. Precision varies by currency. No FX conversion or cross-currency total is implied. Repeat cash is a subset of confirmed cash.',
      );
      for (const m of report.missions) {
        doc.moveDown(0.7);
        write(`${m.company}: ${m.title}`, 13);
        write(`Progress: ${m.status}; reviewed: ${m.reviewedAt}; updated: ${m.updatedAt}`);
        write(`Objective: ${m.objective}`);
        write(m.brief);
        write(`Next: ${m.nextAction}; due: ${m.dueAt}`);
        write(
          `Qualified opportunities: ${m.outcomes.qualified}; held meetings: ${m.outcomes.heldMeetings}; RFQs: ${m.outcomes.rfqs}; samples: ${m.outcomes.samples}; proposals: ${m.outcomes.proposals}; contracts: ${m.outcomes.contracts}`,
        );
        for (const t of m.totals)
          write(
            `${t.currency}: contract ${t.contractMinor}; invoice ${t.invoiceMinor}; confirmed cash ${t.confirmedCashMinor}; repeat cash ${t.repeatCashMinor} (included).`,
          );
        for (const mt of m.itinerary)
          write(
            `${mt.label}: ${mt.status}. ${mt.scheduleChanged ? 'Schedule changed; await an updated itinerary.' : `${mt.startsAt ?? 'Time to be confirmed'} ${mt.timezone ?? ''} ${mt.location ?? ''}`}`,
          );
      }
    },
  );
}

// ADR-076 items 1 to 3. The Trip Book and the Supplier Book are rendered from the validated projection
// alone, never from the saved report, so a field that the database function did not name cannot reach a
// file. Words are fixed English; names and places are printed as written.
type BookBlock = { text: string; size?: number; keep?: number };
const bookNotice =
  'This file is a copy as of the time above. A copy that has left Corridra cannot be recalled, and later changes or withdrawal do not update it. Check the current status in your account.';
const bookChangedSchedule =
  'The date or time has changed. The old time is not shown. Ask the Corridra team for the new one.';
const bookNotStated = 'Not stated yet';
const bookMeetingStatus: Record<string, string> = {
  PROPOSED: 'Suggested',
  ACCEPTED: 'Accepted',
  SCHEDULED: 'Time confirmed',
  HELD: 'Done',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Missed',
  RESCHEDULE_REQUIRED: 'New time needed',
};
const bookFit: Record<string, string> = {
  RESEARCH: 'Still being researched',
  POSSIBLE: 'Possible fit',
  STRONG: 'Strong fit',
  UNSUITABLE: 'Not a fit',
};
// Room for an item's first lines, so a heading or a company name is never the last line of a page.
const bookItemRoom = 140;
const bookZone = (zone: string | undefined) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone ?? 'UTC';
  } catch {
    return 'UTC';
  }
};
const bookClock = (iso: string, zone: string) => {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: zone,
  }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).format(at);
  return { date, time };
};
// "3 Nov 2026, 14:05 UTC": the moment the file or its review was made, always in UTC.
const bookInstant = (iso: string) => {
  const { date, time } = bookClock(iso, 'UTC');
  return `${date}, ${time} UTC`;
};
// "9 Nov 2026, 10:00 (Dhaka, UTC+6)": a meeting in the time zone of its place, as the Trip view shows it.
const bookMeetingTime = (iso: string, timezone: string | undefined) => {
  const zone = bookZone(timezone);
  const { date, time } = bookClock(iso, zone);
  if (zone === 'UTC' || zone === 'Etc/UTC') return `${date}, ${time} (UTC)`;
  const offset = (
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(iso))
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  ).replace(/^GMT/, '');
  const city = (zone.split('/').pop() ?? zone).replaceAll('_', ' ');
  return `${date}, ${time} (${city}, UTC${offset})`;
};
const bookCode = (book: BookRecord) => book.digest.slice(0, 16);
function bookBlocks(book: BookRecord): BookBlock[] {
  const { projection } = book;
  const trip = projection.kind === 'TRIP';
  const name = trip ? 'Trip Book' : 'Supplier Book';
  const blocks: BookBlock[] = [
    { text: `Corridra ${name}`, size: 18 },
    { text: projection.title, size: 14 },
  ];
  if (projection.kind === 'TRIP')
    blocks.push(
      { text: `Company: ${projection.company}` },
      { text: `Objective: ${projection.objective || bookNotStated}` },
    );
  blocks.push(
    { text: `Reviewed by the Corridra team: ${bookInstant(projection.reviewedAt)}` },
    { text: `Created: ${bookInstant(book.generatedAt)}. Content code: ${bookCode(book)}` },
    { text: 'Important', size: 12 },
    { text: bookNotice },
  );
  if (projection.kind === 'TRIP') {
    blocks.push({
      text: `Meetings and visits (${projection.itinerary.length})`,
      size: 14,
      keep: bookItemRoom + 30,
    });
    projection.itinerary.forEach((item, index) => {
      blocks.push({ text: `${index + 1}. ${item.label}`, size: 11, keep: bookItemRoom });
      if (item.changed) {
        blocks.push({ text: 'Status: Date changed' }, { text: bookChangedSchedule });
        return;
      }
      blocks.push({ text: `Status: ${bookMeetingStatus[item.status] ?? item.status}` });
      if (item.startsAt) {
        blocks.push({ text: `Starts: ${bookMeetingTime(item.startsAt, item.timezone)}` });
        if (item.endsAt)
          blocks.push({ text: `Ends: ${bookMeetingTime(item.endsAt, item.timezone)}` });
      } else blocks.push({ text: 'No confirmed time yet.' });
      blocks.push({ text: `Place: ${item.location ?? 'Not shared yet'}` });
    });
    const count = projection.itinerary.length;
    blocks.push({
      text: `End of Trip Book. ${count === 1 ? '1 meeting or visit' : `${count} meetings and visits`}.`,
    });
  } else {
    blocks.push({
      text: `Companies reviewed (${projection.shortlist.length})`,
      size: 14,
      keep: bookItemRoom + 30,
    });
    projection.shortlist.forEach((item, index) => {
      blocks.push(
        { text: `${index + 1}. ${item.company} (${item.country})`, size: 11, keep: bookItemRoom },
        { text: `Fit: ${bookFit[item.fit] ?? item.fit}` },
        { text: `Reason: ${item.rationale || bookNotStated}` },
        { text: `What is uncertain: ${item.uncertainty || bookNotStated}` },
        { text: `What is missing: ${item.gaps || bookNotStated}` },
        { text: `Verification: ${item.verification}` },
      );
    });
    const count = projection.shortlist.length;
    blocks.push({
      text: `End of Supplier Book. ${count === 1 ? '1 company' : `${count} companies`}.`,
    });
  }
  return blocks;
}
/** Every line of text a book prints, in order, without the page footer. Pure, so a test reads what a file says. */
export function bookLines(book: BookRecord): string[] {
  return bookBlocks(book).map((block) => block.text);
}
export async function bookPdf(book: BookRecord): Promise<Buffer> {
  const name = book.projection.kind === 'TRIP' ? 'Trip Book' : 'Supplier Book';
  return renderPdf(
    {
      title: `Corridra ${name}`,
      generatedAt: book.generatedAt,
      unsupportedText:
        'This book cannot be made because it has text the PDF cannot show. Ask the Corridra team for help.',
      oversized: 'This book is too large to make as a PDF. Ask the Corridra team for help.',
      footer: (page, pages) =>
        `Corridra ${name} | Content code ${bookCode(book)} | Page ${page} of ${pages}`,
    },
    ({ write, keepRoom }) => {
      for (const block of bookBlocks(book)) {
        if (block.keep) keepRoom(block.keep);
        write(block.text, block.size);
      }
    },
  );
}
