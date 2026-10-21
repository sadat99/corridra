import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerProgrammeTemplatesEnabled } from './customer-programme-templates';
import { exportDatasets, type ExportDataset } from './customer-programme-export-csv';

// Pricing seeds the economics ledger and editions are seeded by programme templates, so that whole chain must be on.
export function customerProgrammePricingEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerProgrammeTemplatesEnabled(env) &&
    env.CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED === 'true'
  );
}
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const synthetic = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^Synthetic /)
    .refine((v) => !control.test(v), 'Control characters are not allowed');
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v &&
      v >= '2000-01-01' &&
      v <= '2100-01-01',
    'Enter a valid date',
  );
// Exact minor units as text. A JavaScript number cannot hold the full range without losing digits.
const minor = z.string().regex(/^[1-9][0-9]{0,17}$/);

export const feeTier = z.object({ label: synthetic(11, 120), amountMinor: minor }).strict();
export const earlyBirdRule = z
  .object({ label: synthetic(11, 120), untilDate: day, reductionMinor: minor })
  .strict();
export const groupRule = z
  .object({
    label: synthetic(11, 120),
    minParticipants: z.number().int().min(2).max(10000),
    reductionMinor: minor,
  })
  .strict();
export const feeScheduleContent = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    tiers: z.array(feeTier).min(1).max(12),
    earlyBird: z.array(earlyBirdRule).max(6),
    groupDiscounts: z.array(groupRule).max(6),
  })
  .strict()
  .superRefine((v, ctx) => {
    const unique = (items: unknown[], message: string) => {
      if (new Set(items).size !== items.length) ctx.addIssue({ code: 'custom', message });
    };
    unique(
      v.tiers.map((t) => t.label),
      'Tier names must be different',
    );
    unique(
      v.earlyBird.map((t) => t.untilDate),
      'Early-bird dates must be different',
    );
    unique(
      v.groupDiscounts.map((t) => t.minParticipants),
      'Group sizes must be different',
    );
    const numbers = [
      ...v.tiers.map((t) => t.amountMinor),
      ...v.earlyBird.map((t) => t.reductionMinor),
      ...v.groupDiscounts.map((t) => t.reductionMinor),
    ];
    // Field checks report their own issues; the cross-field sum only makes sense on well-formed amounts.
    if (v.tiers.length === 0 || !numbers.every((n) => /^[1-9][0-9]{0,17}$/.test(n))) return;
    const cheapest = v.tiers.reduce(
      (a, t) => (BigInt(t.amountMinor) < a ? BigInt(t.amountMinor) : a),
      BigInt(v.tiers[0]?.amountMinor ?? '0'),
    );
    const most = (list: { reductionMinor: string }[]) =>
      list.reduce(
        (a, t) => (BigInt(t.reductionMinor) > a ? BigInt(t.reductionMinor) : a),
        BigInt(0),
      );
    if (most(v.earlyBird) + most(v.groupDiscounts) >= cheapest)
      ctx.addIssue({ code: 'custom', message: 'Reductions must stay below the cheapest tier' });
  });
export const pricingTemplateSaveInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(1000000),
    templateId: z.uuid().nullable(),
    name: synthetic(11, 120),
    description: synthetic(11, 500).nullable(),
    content: feeScheduleContent,
    retired: z.boolean(),
  })
  .strict()
  .refine((v) => (v.templateId === null) === (v.expectedVersion === 0), {
    message: 'Version zero is for a new fee schedule only',
  })
  .refine((v) => v.templateId !== null || !v.retired, 'A new fee schedule starts active');
export const pricingTemplateListQuery = z
  .object({
    workspaceId: z.uuid(),
    afterSeq: z.coerce.number().int().min(0).max(1000).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const scheduleApplyInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    expectedScheduleVersion: z.number().int().min(0).max(1000000),
    templateId: z.uuid(),
    templateVersion: z.number().int().min(1).max(1000000),
  })
  .strict();
export const programmeScope = z.object({ workspaceId: z.uuid(), programmeId: z.uuid() }).strict();
const feeRows = z
  .array(z.object({ registrationId: z.uuid(), tier: synthetic(11, 120) }).strict())
  .min(1)
  .max(200)
  .refine((rows) => new Set(rows.map((r) => r.registrationId)).size === rows.length, {
    message: 'Each participant can appear once',
  });
export const bulkFeesPreviewInput = programmeScope.extend({
  scheduleVersion: z.number().int().min(1).max(1000000),
  feeDate: day,
  rows: feeRows,
});
export const bulkFeesRecordInput = bulkFeesPreviewInput.extend({ commandId: z.uuid() }).strict();
export const seriesSaveInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(1000000),
    seriesId: z.uuid().nullable(),
    name: synthetic(11, 120),
    description: synthetic(11, 500).nullable(),
    templateId: z.uuid(),
    startDates: z.array(day).min(1).max(24),
    retired: z.boolean(),
  })
  .strict()
  .refine((v) => (v.seriesId === null) === (v.expectedVersion === 0), {
    message: 'Version zero is for a new series only',
  })
  .refine((v) => v.seriesId !== null || !v.retired, 'A new series starts active')
  .refine((v) => v.startDates.every((d, i) => i === 0 || d > v.startDates[i - 1]!), {
    message: 'Start dates must be in increasing order',
  });
export const seriesListQuery = z
  .object({
    workspaceId: z.uuid(),
    afterSeq: z.coerce.number().int().min(0).max(1000).optional(),
    pageSize: z.coerce.number().int().min(1).max(30).default(30),
  })
  .strict();
export const editionCreateInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    seriesId: z.uuid(),
    expectedVersion: z.number().int().min(1).max(1000000),
    editionNo: z.number().int().min(1).max(24),
    templateVersion: z.number().int().min(1).max(1000000),
    name: synthetic(11, 160),
  })
  .strict();
export const seriesScope = z.object({ workspaceId: z.uuid(), seriesId: z.uuid() }).strict();
export const exportInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    dataset: z.enum(exportDatasets),
    programmeId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => v.dataset === 'ledger' || !v.programmeId, {
    message: 'Only the ledger export can be limited to one programme',
  });

export type FeeScheduleContent = z.infer<typeof feeScheduleContent>;
export type PricingTemplate = {
  id: string;
  seq: number;
  version: number;
  name: string;
  description: string | null;
  retired: boolean;
  content: FeeScheduleContent;
  currency: string;
  exponent: number;
  tierCount: number;
  updatedAt: string;
  provenance: 'ORGANISER_RECORDED';
};
export type ProgrammeFeeSchedule = {
  version: number;
  templateId: string;
  templateVersion: number;
  currency: string;
  exponent: number;
  content: FeeScheduleContent;
  appliedAt: string;
  provenance: 'ORGANISER_RECORDED';
};
export type FeeBatchRow = {
  registrationId: string;
  tier: string;
  baseMinor: string;
  earlyBirdMinor: string;
  groupMinor: string;
  amountMinor: string;
  entrySeq?: number;
};
export type FeeBatch = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  scheduleVersion: number;
  currency: string;
  exponent: number;
  feeDate: string;
  groupSize: number;
  rowCount: number;
  perCurrency: { currency: string; exponent: number; totalMinor: string }[];
  rows: FeeBatchRow[];
  batchId?: string;
  commandId?: string;
  replayed?: boolean;
  preview?: boolean;
};
export type SeriesEdition = {
  id: string;
  editionNo: number;
  programmeId: string;
  programmeName: string;
  startDate: string;
  seriesVersion: number;
  templateVersion: number;
  createdAt: string;
};
export type ProgrammeSeries = {
  id: string;
  seq: number;
  version: number;
  name: string;
  description: string | null;
  retired: boolean;
  templateId: string;
  templateName: string;
  templateVersion: number;
  templateRetired: boolean;
  startDates: string[];
  editions: SeriesEdition[];
  nextEditionDate: string | null;
  updatedAt: string;
  provenance: 'ORGANISER_RECORDED';
};
type Receipt = { workspaceId: string; commandId: string; replayed: boolean; expiresAt: string };

export class CustomerProgrammePricingService extends CustomerSessionBoundary {
  private call<T>(sql: string, values: unknown[], subject?: string, issuer?: string) {
    return this.transaction(
      async (db) => (await db.query<{ result: T }>(sql, values)).rows[0].result,
      subject,
      issuer,
    );
  }
  async templates(input: unknown, subject?: string, issuer?: string) {
    const q = pricingTemplateListQuery.parse(input);
    return this.call<{
      workspaceId: string;
      expiresAt: string;
      templates: PricingTemplate[];
      nextAfter: number | null;
    }>(
      'SELECT customer.pricing_templates($1,$2,$3) AS result',
      [q.workspaceId, q.afterSeq ?? null, q.pageSize],
      subject,
      issuer,
    );
  }
  async saveTemplate(input: unknown, subject?: string, issuer?: string) {
    const v = pricingTemplateSaveInput.parse(input);
    return this.call<Receipt & { template: PricingTemplate }>(
      'SELECT customer.pricing_template_save($1,$2,$3,$4) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.expectedVersion,
        JSON.stringify({
          templateId: v.templateId,
          name: v.name,
          description: v.description,
          content: v.content,
          retired: v.retired,
        }),
      ],
      subject,
      issuer,
    );
  }
  async overview(input: unknown, subject?: string, issuer?: string) {
    const q = programmeScope.parse(input);
    return this.call<{
      workspaceId: string;
      programmeId: string;
      expiresAt: string;
      schedule: ProgrammeFeeSchedule | null;
      history: {
        version: number;
        templateId: string;
        templateVersion: number;
        currency: string;
        appliedAt: string;
      }[];
      participants: {
        registrationId: string;
        label: string;
        state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
        hasFee: boolean;
        fees: { currency: string; exponent: number; dueMinor: string }[];
      }[];
      counts: { registered: number; active: number };
    }>(
      'SELECT customer.programme_pricing_overview($1,$2) AS result',
      [q.workspaceId, q.programmeId],
      subject,
      issuer,
    );
  }
  async applySchedule(input: unknown, subject?: string, issuer?: string) {
    const v = scheduleApplyInput.parse(input);
    return this.call<Receipt & { programmeId: string; schedule: ProgrammeFeeSchedule }>(
      'SELECT customer.programme_fee_schedule_apply($1,$2,$3,$4,$5) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.programmeId,
        v.expectedScheduleVersion,
        JSON.stringify({ templateId: v.templateId, templateVersion: v.templateVersion }),
      ],
      subject,
      issuer,
    );
  }
  async previewFees(input: unknown, subject?: string, issuer?: string) {
    const v = bulkFeesPreviewInput.parse(input);
    return this.call<FeeBatch>(
      'SELECT customer.programme_bulk_fees_preview($1,$2,$3,$4) AS result',
      [
        v.workspaceId,
        v.programmeId,
        v.scheduleVersion,
        JSON.stringify({ feeDate: v.feeDate, rows: v.rows }),
      ],
      subject,
      issuer,
    );
  }
  async recordFees(input: unknown, subject?: string, issuer?: string) {
    const v = bulkFeesRecordInput.parse(input);
    return this.call<FeeBatch>(
      'SELECT customer.programme_bulk_fees_record($1,$2,$3,$4,$5) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.programmeId,
        v.scheduleVersion,
        JSON.stringify({ feeDate: v.feeDate, rows: v.rows }),
      ],
      subject,
      issuer,
    );
  }
  async seriesList(input: unknown, subject?: string, issuer?: string) {
    const q = seriesListQuery.parse(input);
    return this.call<{
      workspaceId: string;
      expiresAt: string;
      series: ProgrammeSeries[];
      nextAfter: number | null;
    }>(
      'SELECT customer.programme_series_list($1,$2,$3) AS result',
      [q.workspaceId, q.afterSeq ?? null, q.pageSize],
      subject,
      issuer,
    );
  }
  async saveSeries(input: unknown, subject?: string, issuer?: string) {
    const v = seriesSaveInput.parse(input);
    return this.call<Receipt & { series: ProgrammeSeries }>(
      'SELECT customer.programme_series_save($1,$2,$3,$4) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.expectedVersion,
        JSON.stringify({
          seriesId: v.seriesId,
          name: v.name,
          description: v.description,
          templateId: v.templateId,
          startDates: v.startDates,
          retired: v.retired,
        }),
      ],
      subject,
      issuer,
    );
  }
  async createEdition(input: unknown, subject?: string, issuer?: string) {
    const v = editionCreateInput.parse(input);
    return this.call<
      Receipt & {
        seriesId: string;
        edition: {
          id: string;
          editionNo: number;
          programmeId: string;
          startDate: string;
          seriesVersion: number;
          templateVersion: number;
        };
        tasksCreated: number;
        plannedCostsCreated: number;
      }
    >(
      'SELECT customer.programme_series_edition_create($1,$2,$3,$4,$5) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.seriesId,
        v.expectedVersion,
        JSON.stringify({
          name: v.name,
          templateVersion: v.templateVersion,
          editionNo: v.editionNo,
        }),
      ],
      subject,
      issuer,
    );
  }
  async revenue(input: unknown, subject?: string, issuer?: string) {
    const q = seriesScope.parse(input);
    return this.call<{
      workspaceId: string;
      seriesId: string;
      expiresAt: string;
      provenance: 'ORGANISER_RECORDED';
      verified: false;
      projection: false;
      editions: {
        editionNo: number;
        programmeId: string;
        programmeName: string;
        startDate: string;
        registered: number;
        active: number;
        figures: {
          currency: string;
          exponent: number;
          feesDue: string;
          paymentsRecorded: string;
          outstanding: string;
          plannedCosts: string;
          actualCosts: string;
          marginOnActual: string;
          cashMargin: string;
          feesDueChange: string | null;
        }[];
      }[];
      totals: {
        currency: string;
        exponent: number;
        editions: number;
        feesDue: string;
        paymentsRecorded: string;
        outstanding: string;
        plannedCosts: string;
        actualCosts: string;
        marginOnActual: string;
        cashMargin: string;
      }[];
    }>(
      'SELECT customer.programme_series_revenue($1,$2) AS result',
      [q.workspaceId, q.seriesId],
      subject,
      issuer,
    );
  }
  // Owner and admin only. The rows come back from one audited database call; the route turns them into the file.
  async exportRows(input: unknown, subject?: string, issuer?: string) {
    const v = exportInput.parse(input);
    return this.call<{
      workspaceId: string;
      dataset: ExportDataset;
      rowCount: number;
      rows: Record<string, unknown>[];
      replayed: boolean;
      expiresAt: string;
    }>(
      'SELECT customer.programme_export($1,$2,$3,$4) AS result',
      [v.commandId, v.workspaceId, v.dataset, v.programmeId ?? null],
      subject,
      issuer,
    );
  }
}
