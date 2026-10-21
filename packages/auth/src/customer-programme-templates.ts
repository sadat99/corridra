import { customerLabelAllowed, realCustomerInput } from '@corridra/domain/customer-input-mode';
import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerProgrammeCoordinationEnabled } from './customer-programme-coordination';
import { customerProgrammeEconomicsEnabled } from './customer-programme-economics';

// Applying a template seeds coordination tasks and economics planned costs, so both must be on.
export function customerProgrammeTemplatesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerProgrammeCoordinationEnabled(env) &&
    customerProgrammeEconomicsEnabled(env) &&
    env.CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED === 'true'
  );
}
export const templateCostKinds = [
  'ORGANISER_EXPENSE',
  'ORGANISER_OBLIGATION',
  'CORRIDRA_SERVICE_FEE',
] as const;
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const synthetic = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .refine((v) => realCustomerInput() || v.length >= min)
    .max(max)
    .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
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
export const templateTask = z
  .object({
    title: synthetic(11, 160),
    detail: synthetic(11, 1000).nullable(),
    dueOffsetDays: z.number().int().min(0).max(730).nullable(),
    assigneeLabel: synthetic(11, 120).nullable(),
  })
  .strict();
export const templateCost = z
  .object({
    kind: z.enum(templateCostKinds),
    description: synthetic(11, 300),
    currency: z.string().regex(/^[A-Z]{3}$/),
    // Exact whole units as text. A JavaScript number cannot hold the full range without losing digits.
    amountMinor: z.string().regex(/^[1-9][0-9]{0,17}$/),
  })
  .strict();
export const templateContent = z
  .object({
    reportingPurpose: synthetic(11, 500),
    capacity: z.number().int().min(1).max(10000).nullable(),
    tasks: z.array(templateTask).max(50),
    plannedCosts: z.array(templateCost).max(30),
  })
  .strict();
export const templateSaveInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(1000000),
    templateId: z.uuid().nullable(),
    name: synthetic(11, 120),
    description: synthetic(11, 500).nullable(),
    content: templateContent,
    retired: z.boolean(),
  })
  .strict()
  .refine((v) => (v.templateId === null) === (v.expectedVersion === 0), {
    message: 'Version zero is for a new template only',
  })
  .refine((v) => v.templateId !== null || !v.retired, 'A new template starts active');
export const templateApplyInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    templateId: z.uuid(),
    expectedVersion: z.number().int().min(1).max(1000000),
    startDate: day.nullable(),
  })
  .strict();
export const templateListQuery = z
  .object({
    workspaceId: z.uuid(),
    afterSeq: z.coerce.number().int().min(0).max(1000).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const templateCaptureQuery = z
  .object({ workspaceId: z.uuid(), programmeId: z.uuid() })
  .strict();

export type TemplateContent = z.infer<typeof templateContent>;
export type ProgrammeTemplate = {
  id: string;
  seq: number;
  version: number;
  name: string;
  description: string | null;
  retired: boolean;
  content: TemplateContent;
  taskCount: number;
  costCount: number;
  capacity: number | null;
  updatedAt: string;
  provenance: 'ORGANISER_RECORDED';
};
type Receipt = {
  workspaceId: string;
  commandId: string;
  replayed: boolean;
  expiresAt: string;
};

export class CustomerProgrammeTemplateService extends CustomerSessionBoundary {
  private call<T>(sql: string, values: unknown[], subject?: string, issuer?: string) {
    return this.transaction(
      async (db) => (await db.query<{ result: T }>(sql, values)).rows[0].result,
      subject,
      issuer,
    );
  }
  list(input: unknown, subject?: string, issuer?: string) {
    const q = templateListQuery.parse(input);
    return this.call<{
      workspaceId: string;
      expiresAt: string;
      templates: ProgrammeTemplate[];
      nextAfter: number | null;
    }>(
      'SELECT customer.programme_templates($1,$2,$3) AS result',
      [q.workspaceId, q.afterSeq ?? null, q.pageSize],
      subject,
      issuer,
    );
  }
  capture(input: unknown, subject?: string, issuer?: string) {
    const q = templateCaptureQuery.parse(input);
    return this.call<{
      workspaceId: string;
      programmeId: string;
      expiresAt: string;
      content: unknown;
    }>(
      'SELECT customer.programme_template_capture($1,$2) AS result',
      [q.workspaceId, q.programmeId],
      subject,
      issuer,
    );
  }
  save(input: unknown, subject?: string, issuer?: string) {
    const v = templateSaveInput.parse(input);
    return this.call<Receipt & { template: ProgrammeTemplate }>(
      'SELECT customer.programme_template_save($1,$2,$3,$4) AS result',
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
  apply(input: unknown, subject?: string, issuer?: string) {
    const v = templateApplyInput.parse(input);
    return this.call<
      Receipt & {
        programmeId: string;
        templateId: string;
        templateVersion: number;
        tasksCreated: number;
        plannedCostsCreated: number;
        capacity: number | null;
        startDate: string | null;
      }
    >(
      'SELECT customer.programme_template_apply($1,$2,$3,$4,$5) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.programmeId,
        v.expectedVersion,
        JSON.stringify({ templateId: v.templateId, startDate: v.startDate }),
      ],
      subject,
      issuer,
    );
  }
}
