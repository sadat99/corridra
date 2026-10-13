import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import { DomainError } from '@corridra/domain';
import type { OfferTerms, RequirementFields } from '@corridra/domain/commercial-missions';
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
export async function reportPdf(report: DeliveryReport): Promise<Buffer> {
  const bytes = await fonts();
  const supported = bytes.map((b) => {
    const face = fontkit.create(b);
    if (!('characterSet' in face)) throw new Error('A single report font face is required');
    return new Set(face.characterSet);
  });
  const select = (character: string) => {
    const index = supported.findIndex((set) => set.has(character.codePointAt(0)!));
    if (index < 0)
      throw new DomainError(
        'The PDF font cannot represent this text. Download the complete CSV report instead.',
        422,
      );
    return ['Latin', 'Bengali', 'Chinese'][index];
  };
  const doc = new PDFDocument({
    size: 'A4',
    margin: 45,
    bufferPages: true,
    compress: true,
    info: {
      Title: 'Corridra programme report',
      Author: 'Corridra',
      CreationDate: new Date(report.generatedAt),
      ModDate: new Date(report.generatedAt),
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
        reject(
          new DomainError(
            'The PDF exceeds the report size limit. Download CSV or approve a smaller reporting scope.',
            413,
          ),
        );
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
  try {
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
    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index++) {
      doc.switchToPage(index);
      doc
        .font('Latin')
        .fontSize(8)
        .text(`Corridra | ${index + 1} / ${pages.count}`, 45, doc.page.height - 30, {
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
