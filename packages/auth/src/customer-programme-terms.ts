import { customerLabelAllowed, realCustomerInput } from '@corridra/domain/customer-input-mode';
import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerProgrammeCoordinationEnabled } from './customer-programme-coordination';
import { customerProgrammeEconomicsEnabled } from './customer-programme-economics';

// Terms read fees from the economics ledger and owners are given coordination tasks, so both must be on.
export function customerProgrammeTermsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerProgrammeCoordinationEnabled(env) &&
    customerProgrammeEconomicsEnabled(env) &&
    env.CORRIDRA_CUSTOMER_PROGRAMME_TERMS_ENABLED === 'true'
  );
}
export const eligibilityRoles = [
  'BUYER',
  'SELLER',
  'SUPPLIER',
  'MANUFACTURER',
  'DISTRIBUTOR',
  'ORGANISER',
] as const;
export const eligibilitySizeBands = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
export const ineligibleReasons = [
  'NO_PROFILE',
  'ROLE',
  'SECTOR',
  'COUNTRY',
  'SIZE',
  'COMPLETENESS',
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
const version = z.number().int().min(0).max(1000000);
const scope = { commandId: z.uuid(), workspaceId: z.uuid(), programmeId: z.uuid() };
const list = (max: number, min: number, len: number) =>
  z
    .array(
      z
        .string()
        .min(min)
        .max(len)
        .refine((v) => v === v.trim() && !control.test(v), 'Plain text only'),
    )
    .max(max)
    .refine((a) => new Set(a.map((v) => v.toLowerCase())).size === a.length, 'No duplicates');

export const termsPublishInput = z
  .object({
    ...scope,
    expectedVersion: version,
    included: synthetic(11, 1000),
    excluded: synthetic(11, 1000).nullable(),
    cancellationTerms: synthetic(11, 1000),
    changeTerms: synthetic(11, 1000),
    feesApply: z.boolean(),
    feeNote: synthetic(11, 500).nullable(),
    reason: synthetic(11, 300),
  })
  .strict()
  .refine((v) => v.feesApply || v.feeNote === null, 'A fee note needs fees to apply');
export const eligibilitySetInput = z
  .object({
    ...scope,
    expectedVersion: version,
    roles: z.array(z.enum(eligibilityRoles)).max(6),
    sectors: list(10, 2, 60),
    countries: list(30, 2, 20),
    sizeBands: z.array(z.enum(eligibilitySizeBands)).max(5),
    minProfileFields: z.number().int().min(0).max(7),
    reason: synthetic(11, 300),
  })
  .strict();
export const placesSetInput = z
  .object({
    ...scope,
    expectedVersion: version,
    minimum: z.number().int().min(1).max(10000),
    maximum: z.number().int().min(1).max(10000),
    waitlist: z.boolean(),
    reason: synthetic(11, 300),
  })
  .strict()
  .refine((v) => v.minimum <= v.maximum, 'The minimum cannot be more than the maximum');
export const placesRefreshInput = z.object(scope).strict();
export const taskAssignInput = z
  .object({
    ...scope,
    taskId: z.uuid(),
    expectedVersion: version,
    assigneeKey: z.uuid().nullable(),
    participantVisible: z.boolean(),
  })
  .strict();
export const taskDoneInput = z
  .object({
    ...scope,
    taskId: z.uuid(),
    expectedVersion: z.number().int().min(1).max(1000000),
  })
  .strict();
export const enrolmentInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('apply'),
      commandId: z.uuid(),
      registrationId: z.uuid(),
      termsVersion: z.number().int().min(1).max(999999).nullable(),
      profileWorkspaceId: z.uuid().nullable(),
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('accept_terms'),
      commandId: z.uuid(),
      registrationId: z.uuid(),
      termsVersion: z.number().int().min(1).max(999999),
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel'),
      commandId: z.uuid(),
      registrationId: z.uuid(),
      acknowledged: z.literal(true),
    })
    .strict(),
]);
export const termsScope = z.object({ workspaceId: z.uuid(), programmeId: z.uuid() }).strict();
export const ownPlaceQuery = z.object({ registrationId: z.uuid() }).strict();
export const remindersQuery = z
  .object({
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type ProgrammeTerms = {
  version: number;
  included: string;
  excluded: string | null;
  cancellationTerms: string;
  changeTerms: string;
  feesApply: boolean;
  feeNote: string | null;
  reason: string;
  publishedAt: string;
};
export type EligibilityCriteria = {
  version: number;
  roles: string[];
  sectors: string[];
  countries: string[];
  sizeBands: string[];
  minProfileFields: number;
  reason: string;
  updatedAt: string;
};
export type TermsState = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  sendsMessages: false;
  terms: { current: ProgrammeTerms | null; history: ProgrammeTerms[] };
  eligibility: { current: EligibilityCriteria | null; history: EligibilityCriteria[] };
  places: {
    version: number;
    minimum: number | null;
    maximum: number | null;
    waitlist: boolean;
    reason: string | null;
    placed: number;
  };
  tasks: {
    id: string;
    seq: number;
    version: number;
    title: string;
    status: string;
    dueOn: string | null;
    plan: {
      version: number;
      assigneeKey: string | null;
      assigneeLabel: string | null;
      assigneeActive: boolean | null;
      participantVisible: boolean;
    };
  }[];
  members: { key: string; label: string; role: string; isYou: boolean }[];
};
export type PlacesReport = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  asOf: string;
  verified: false;
  sendsMessages: false;
  places: {
    version: number;
    minimum: number | null;
    maximum: number | null;
    waitlist: boolean;
    placed: number;
    free: number | null;
    fillPermille: number | null;
    minimumMet: boolean | null;
    waiting: number;
    promotable: number;
  };
  funnel: {
    registered: number;
    notApplied: number;
    placed: number;
    waitlisted: number;
    notEligible: number;
    cancelled: number;
  };
  eligibility: { version: number; notEligibleByReason: Record<string, number> };
  terms: {
    version: number;
    acceptedCurrent: number;
    pendingAcceptance: number;
    acceptanceRatePermille: number | null;
  };
  satisfaction: {
    responses: number;
    ratingCount: number;
    ratingSum: number;
    notShared: number;
    responsesFromPlaced: number;
  };
  outcomes: { shared: number; participantsWithOutcome: number; byKind: Record<string, number> };
  rosterTruncated: boolean;
  roster: {
    registrationId: string;
    label: string;
    status: 'NOT_APPLIED' | 'PLACED' | 'WAITLISTED' | 'NOT_ELIGIBLE' | 'CANCELLED';
    position: number | null;
    reasons: string[];
    termsAcceptedVersion: number | null;
    termsCurrent: boolean;
  }[];
};
export type OwnPlace = {
  registrationId: string;
  programmeId: string;
  programmeName: string;
  expiresAt: string;
  terms: ProgrammeTerms | null;
  acceptedVersion: number | null;
  termsCurrent: boolean | null;
  criteria: EligibilityCriteria | null;
  enrolment: {
    status: 'NOT_APPLIED' | 'PLACED' | 'WAITLISTED' | 'NOT_ELIGIBLE' | 'CANCELLED';
    position: number | null;
    reasons: string[];
  };
  placesAvailable: boolean;
  waitlist: boolean;
  fees: { currency: string; exponent: number; dueMinor: string }[];
  tasks: { title: string; dueOn: string | null }[];
  profileChoices: { workspaceId: string; name: string; hasProfile: boolean }[];
  sendsMessages: false;
};
export type Reminders = {
  asOf: string;
  windowDays: 3;
  expiresAt: string;
  sendsMessages: false;
  assignedToYou: {
    workspaceId: string;
    programmeId: string;
    programmeName: string;
    taskId: string;
    version: number;
    title: string;
    dueOn: string;
    state: 'OVERDUE' | 'DUE_SOON';
  }[];
  forParticipant: {
    registrationId: string;
    programmeName: string;
    title: string;
    dueOn: string;
    state: 'OVERDUE' | 'DUE_SOON';
  }[];
  termsToAccept: { registrationId: string; programmeName: string; version: number }[];
};
type Receipt = {
  workspaceId?: string;
  programmeId?: string;
  commandId: string;
  replayed: boolean;
  expiresAt: string;
};

export class CustomerProgrammeTermsService extends CustomerSessionBoundary {
  private call<T>(sql: string, values: unknown[], subject?: string, issuer?: string) {
    return this.transaction(
      async (db) => (await db.query<{ result: T }>(sql, values)).rows[0].result,
      subject,
      issuer,
    );
  }
  state(input: unknown, subject?: string, issuer?: string) {
    const q = termsScope.parse(input);
    return this.call<TermsState>(
      'SELECT customer.programme_terms_state($1,$2) AS result',
      [q.workspaceId, q.programmeId],
      subject,
      issuer,
    );
  }
  report(input: unknown, subject?: string, issuer?: string) {
    const q = termsScope.parse(input);
    return this.call<PlacesReport>(
      'SELECT customer.programme_places_report($1,$2) AS result',
      [q.workspaceId, q.programmeId],
      subject,
      issuer,
    );
  }
  ownPlace(input: unknown, subject?: string, issuer?: string) {
    const q = ownPlaceQuery.parse(input);
    return this.call<OwnPlace>(
      'SELECT customer.own_programme_place($1) AS result',
      [q.registrationId],
      subject,
      issuer,
    );
  }
  reminders(input: unknown, subject?: string, issuer?: string) {
    const q = remindersQuery.parse(input);
    return this.call<Reminders>(
      'SELECT customer.my_programme_reminders($1::date) AS result',
      [q.asOf ?? null],
      subject,
      issuer,
    );
  }
  private write<T>(
    fn: string,
    commandId: string,
    payload: Record<string, unknown>,
    subject?: string,
    issuer?: string,
  ) {
    return this.call<T>(
      `SELECT customer.${fn}($1,$2) AS result`,
      [commandId, JSON.stringify(payload)],
      subject,
      issuer,
    );
  }
  publishTerms(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = termsPublishInput.parse(input);
    return this.write<Receipt & { terms: ProgrammeTerms }>(
      'programme_terms_publish',
      commandId,
      rest,
      subject,
      issuer,
    );
  }
  setEligibility(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = eligibilitySetInput.parse(input);
    return this.write<Receipt & { eligibility: EligibilityCriteria }>(
      'programme_eligibility_set',
      commandId,
      rest,
      subject,
      issuer,
    );
  }
  setPlaces(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = placesSetInput.parse(input);
    return this.write<
      Receipt & {
        version: number;
        minimum: number;
        maximum: number;
        waitlist: boolean;
        promoted: number;
      }
    >('programme_places_set', commandId, rest, subject, issuer);
  }
  refreshPlaces(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = placesRefreshInput.parse(input);
    return this.write<Receipt & { promoted: number }>(
      'programme_places_refresh',
      commandId,
      rest,
      subject,
      issuer,
    );
  }
  assignTask(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = taskAssignInput.parse(input);
    return this.write<
      Receipt & {
        taskId: string;
        planVersion: number;
        participantVisible: boolean;
        assigned: boolean;
      }
    >('programme_task_assign', commandId, rest, subject, issuer);
  }
  finishTask(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = taskDoneInput.parse(input);
    return this.write<Receipt & { taskId: string; version: number; status: 'DONE' }>(
      'programme_task_done',
      commandId,
      rest,
      subject,
      issuer,
    );
  }
  enrol(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...rest } = enrolmentInput.parse(input);
    return this.call<
      Receipt & {
        registrationId: string;
        status: string;
        position: number | null;
        reasons?: string[];
        termsVersion?: number | null;
        promoted?: number;
      }
    >(
      'SELECT customer.programme_enrolment_command($1,$2,$3) AS result',
      [commandId, action, JSON.stringify(rest)],
      subject,
      issuer,
    );
  }
}
