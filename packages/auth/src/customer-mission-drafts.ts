import {
  customerLabelAllowed,
  customerWebsiteAllowed,
  realCustomerInput,
} from '@corridra/domain/customer-input-mode';
import { z } from 'zod';
import { objectiveOptions, outcomeOptions } from '@corridra/domain/missions';
import { missionDraftObjectives } from '@corridra/domain/mission-drafts';
import { CustomerSessionBoundary } from './customer-session';
import { customerRequestsEnabled } from './customer-requests';
import { customerOrganisationProfilesEnabled } from './customer-organisation-profiles';

export function customerMissionDraftsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerRequestsEnabled(env) &&
    customerOrganisationProfilesEnabled(env) &&
    env.CORRIDRA_CUSTOMER_MISSION_DRAFTS_ENABLED === 'true'
  );
}
export const missionDraftFamilies = [
  'BUYERS_PARTNERS',
  'SUPPLIERS_PRODUCTS',
  'DELEGATION',
  'OTHER',
] as const;
const control = /[\u0000-\u001f\u007f]/u;
const plain = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !control.test(v), 'Control characters are not allowed')
    .refine((v) => v === '' || v.length >= min, 'Too short');
// Free text stays synthetic while real-data gates are closed. An empty value means "not yet written".
const syntheticOrEmpty = (max: number) =>
  plain(max).refine(
    (v) => v === '' || customerLabelAllowed(v),
    'Start with Synthetic and use at least 11 characters',
  );
const date = z
  .string()
  .refine(
    (v) =>
      v === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    'Enter a valid date',
  );
export const missionDraftRequirement = z
  .object({
    label: z.string().trim().min(2).max(60),
    value: z
      .string()
      .trim()
      .min(2)
      .max(300)
      .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
      .refine((v) => !control.test(v)),
  })
  .strict()
  .refine((v) => !control.test(v.label), 'Control characters are not allowed');
export const missionDraftDetails = z
  .object({
    title: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
      .refine((v) => !control.test(v)),
    family: z.enum(missionDraftFamilies),
    objective: z.enum(objectiveOptions).nullable(),
    market: plain(120),
    attendance: z.enum(['Yes', 'No', 'Not decided']),
    startDate: date,
    endDate: date,
    timezone: z.string().min(1).max(80),
    offer: syntheticOrEmpty(2000),
    website: z
      .string()
      .trim()
      .max(200)
      .refine(
        (v) =>
          v === '' ||
          customerWebsiteAllowed(v) ||
          /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(\/[A-Za-z0-9._~/-]*)?$/.test(
            v,
          ),
        'Use a reserved example, test or invalid host',
      ),
    outcomes: z
      .array(z.enum(outcomeOptions))
      .max(7)
      .refine((v) => new Set(v).size === v.length, 'Outcomes must be unique'),
    notes: syntheticOrEmpty(1000),
    requirements: z
      .array(missionDraftRequirement)
      .max(20)
      .refine(
        (rows) => new Set(rows.map((r) => r.label.toLowerCase())).size === rows.length,
        'Requirement labels must be unique',
      ),
    contactName: plain(120, 2),
    contactEmail: z
      .string()
      .max(254)
      .refine(
        (v) =>
          v === '' ||
          (realCustomerInput() && z.email().safeParse(v).success) ||
          /^[a-z0-9._+-]+@example\.invalid$/.test(v),
        'Use a test address',
      ),
    profileVersion: z.number().int().min(1).max(999999999).nullable(),
    sourcingContext: z
      .enum([
        'MACHINERY',
        'FINISHED_PRODUCTS',
        'MATERIALS_COMPONENTS',
        'OEM_CUSTOM',
        'OTHER_PROCUREMENT',
      ])
      .nullable(),
    companyName: syntheticOrEmpty(160),
  })
  .strict()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, 'End must follow start')
  .refine((v) => v.sourcingContext === null || v.family === 'SUPPLIERS_PRODUCTS', {
    message: 'Sourcing details belong to supplier and product requests',
  })
  .refine(
    (v) =>
      v.objective === null ||
      v.objective === 'Something else' ||
      missionDraftObjectives[v.family].includes(v.objective),
    { message: 'Choose an objective that fits this kind of request' },
  );
export const missionDraftSaveInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    draftId: z.uuid().nullable(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    details: missionDraftDetails,
    acknowledged: z.literal(true),
  })
  .strict()
  .refine((v) => (v.draftId === null ? v.expectedVersion === 0 : v.expectedVersion >= 1), {
    message: 'A new draft starts at version 0',
  });
export const missionDraftCloseInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    draftId: z.uuid(),
    outcome: z.enum(['SUBMITTED', 'DISCARDED']),
    requestId: z.uuid().nullable(),
  })
  .strict()
  .refine((v) => (v.outcome === 'SUBMITTED') === (v.requestId !== null), {
    message: 'A submitted draft names its request',
  });
export const missionDraftViewQuery = z
  .object({ workspaceId: z.uuid(), draftId: z.uuid() })
  .strict();
export const missionDraftListQuery = z
  .object({
    workspaceId: z.uuid(),
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type MissionDraftDetails = z.infer<typeof missionDraftDetails>;
export type MissionDraftView = {
  workspaceId: string;
  expiresAt: string;
  commandId?: string;
  replayed?: boolean;
  currentVersion: number;
  superseded: boolean;
  draft: {
    id: string;
    version: number;
    status: 'OPEN' | 'SUBMITTED' | 'DISCARDED';
    requestId: string | null;
    updatedAt: string;
    details: MissionDraftDetails;
  };
};
export type MissionDraftList = {
  workspaceId: string;
  expiresAt: string;
  drafts: {
    id: string;
    version: number;
    title: string;
    family: (typeof missionDraftFamilies)[number];
    status: 'OPEN' | 'SUBMITTED' | 'DISCARDED';
    requestId: string | null;
    updatedAt: string;
  }[];
  nextAfter: string | null;
};
export class CustomerMissionDraftService extends CustomerSessionBoundary {
  async view(input: unknown, subject?: string, issuer?: string) {
    const q = missionDraftViewQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: MissionDraftView }>(
            'SELECT customer.mission_draft_view($1,$2) AS result',
            [q.workspaceId, q.draftId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async list(input: unknown, subject?: string, issuer?: string) {
    const q = missionDraftListQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: MissionDraftList }>(
            'SELECT customer.mission_draft_list($1,$2,$3) AS result',
            [q.workspaceId, q.after ?? null, q.pageSize],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async save(input: unknown, subject?: string, issuer?: string) {
    const { commandId, workspaceId, draftId, expectedVersion, details, acknowledged } =
      missionDraftSaveInput.parse(input);
    void acknowledged;
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: MissionDraftView }>(
            'SELECT customer.mission_draft_save($1,$2,$3,$4,$5) AS result',
            [commandId, workspaceId, draftId, expectedVersion, JSON.stringify(details)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async close(input: unknown, subject?: string, issuer?: string) {
    const { commandId, workspaceId, draftId, outcome, requestId } =
      missionDraftCloseInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: MissionDraftView }>(
            'SELECT customer.mission_draft_close($1,$2,$3,$4,$5) AS result',
            [commandId, workspaceId, draftId, outcome, requestId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
