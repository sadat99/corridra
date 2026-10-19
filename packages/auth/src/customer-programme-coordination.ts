import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerParticipantsEnabled } from './customer-participants';

export function customerProgrammeCoordinationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerParticipantsEnabled(env) &&
    env.CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED === 'true'
  );
}
export const taskStatuses = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const outcomeKinds = [
  'MEETING_HELD',
  'FOLLOW_UP_AGREED',
  'SAMPLE_OR_QUOTE_REQUESTED',
  'PRELIMINARY_AGREEMENT',
  'NO_PROGRESS',
] as const;
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
const version = z.number().int().min(0).max(1000000);
export const taskInput = z
  .object({
    taskId: z.uuid().nullable(),
    title: synthetic(11, 160),
    detail: synthetic(11, 1000).nullable(),
    status: z.enum(taskStatuses),
    dueOn: day.nullable(),
    assigneeLabel: synthetic(11, 120).nullable(),
  })
  .strict()
  .refine((v) => v.taskId !== null || v.status === 'OPEN', 'A new task starts open');
export const taskSaveInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    expectedVersion: version,
    task: taskInput,
  })
  .strict()
  .refine((v) => (v.task.taskId === null) === (v.expectedVersion === 0), {
    message: 'Version zero is for a new task only',
  });
export const capacitySetInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    expectedVersion: version,
    capacity: z.number().int().min(1).max(10000),
    reason: synthetic(11, 300),
  })
  .strict();
export const attendanceSetInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    registrationId: z.uuid(),
    state: z.enum(['ATTENDED', 'ABSENT']),
  })
  .strict();
export const recordSubmitInput = z
  .object({
    commandId: z.uuid(),
    registrationId: z.uuid(),
    kind: z.enum(['FEEDBACK', 'OUTCOME']),
    recordId: z.uuid().nullable(),
    expectedVersion: version,
    rating: z.number().int().min(1).max(5).nullable(),
    outcomeKind: z.enum(outcomeKinds).nullable(),
    occurredOn: day.nullable(),
    note: synthetic(11, 500).nullable(),
    shared: z.boolean(),
    retracted: z.boolean(),
    acknowledged: z.literal(true),
  })
  .strict()
  .refine((v) => (v.recordId === null) === (v.expectedVersion === 0), {
    message: 'Version zero is for a new record only',
  })
  .refine((v) => !(v.retracted && v.shared), 'A retracted record cannot be shared')
  .refine(
    // An outcome cannot be dated after today. One day of slack covers time zones, SQL is exact.
    (v) =>
      v.occurredOn === null ||
      v.occurredOn <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    'An outcome cannot be dated in the future',
  )
  .refine(
    (v) =>
      v.retracted ||
      (v.kind === 'FEEDBACK'
        ? v.rating !== null && v.outcomeKind === null && v.occurredOn === null
        : v.rating === null && v.outcomeKind !== null && v.occurredOn !== null),
    'Fill in the fields for this kind of record',
  );
export const coordinationScope = z
  .object({ workspaceId: z.uuid(), programmeId: z.uuid() })
  .strict();
export const taskListQuery = coordinationScope.extend({
  afterSeq: z.coerce.number().int().min(0).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export const ownRecordsQuery = z.object({ registrationId: z.uuid() }).strict();

export type ProgrammeTask = {
  id: string;
  seq: number;
  version: number;
  title: string;
  detail: string | null;
  status: (typeof taskStatuses)[number];
  dueOn: string | null;
  assigneeLabel: string | null;
  createdAt: string;
  updatedAt: string;
  provenance: 'ORGANISER_RECORDED';
};
export type ParticipantRecord = {
  recordId: string;
  kind: 'FEEDBACK' | 'OUTCOME';
  version: number;
  shared: boolean;
  retracted: boolean;
  rating: number | null;
  outcomeKind: (typeof outcomeKinds)[number] | null;
  occurredOn: string | null;
  note: string | null;
  updatedAt: string;
  provenance: 'PARTICIPANT_REPORTED';
};
export type ProgrammeReport = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  asOf: string;
  verified: false;
  sendsMessages: false;
  activeParticipants: number;
  capacity: { capacity: number | null; version: number; reason: string | null };
  attendance: {
    attended: number;
    absent: number;
    notRecorded: number;
    withdrawnOrRemoved: number;
    provenance: 'ORGANISER_RECORDED';
  };
  tasks: {
    open: number;
    inProgress: number;
    done: number;
    cancelled: number;
    overdue: number;
    provenance: 'ORGANISER_RECORDED';
  };
  feedback: {
    responses: number;
    shared: number;
    notShared: number;
    ratingCount: number;
    ratingSum: number;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
    comments: string[];
    provenance: 'PARTICIPANT_REPORTED';
  };
  outcomes: {
    total: number;
    shared: number;
    notShared: number;
    byKind: Partial<Record<(typeof outcomeKinds)[number], number>>;
    items: { label: string; outcomeKind: string; occurredOn: string; note: string | null }[];
    provenance: 'PARTICIPANT_REPORTED';
  };
  repeat: { returningParticipants: number; basis: string };
  participants: {
    registrationId: string;
    label: string;
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
    attendance: 'ATTENDED' | 'ABSENT' | null;
    attendanceVersion: number;
  }[];
};
type Receipt = {
  workspaceId?: string;
  programmeId?: string;
  commandId: string;
  replayed: boolean;
  expiresAt: string;
};

export class CustomerProgrammeCoordinationService extends CustomerSessionBoundary {
  private call<T>(sql: string, values: unknown[], subject?: string, issuer?: string) {
    return this.transaction(
      async (db) => (await db.query<{ result: T }>(sql, values)).rows[0].result,
      subject,
      issuer,
    );
  }
  report(input: unknown, subject?: string, issuer?: string) {
    const q = coordinationScope.parse(input);
    return this.call<ProgrammeReport>(
      'SELECT customer.programme_report($1,$2) AS result',
      [q.workspaceId, q.programmeId],
      subject,
      issuer,
    );
  }
  tasks(input: unknown, subject?: string, issuer?: string) {
    const q = taskListQuery.parse(input);
    return this.call<{
      workspaceId: string;
      programmeId: string;
      expiresAt: string;
      tasks: ProgrammeTask[];
      nextAfter: number | null;
    }>(
      'SELECT customer.programme_tasks($1,$2,$3,$4) AS result',
      [q.workspaceId, q.programmeId, q.afterSeq ?? null, q.pageSize],
      subject,
      issuer,
    );
  }
  ownRecords(input: unknown, subject?: string, issuer?: string) {
    const q = ownRecordsQuery.parse(input);
    return this.call<{
      registrationId: string;
      programmeId: string;
      expiresAt: string;
      feedback: ParticipantRecord | null;
      outcomes: ParticipantRecord[];
    }>('SELECT customer.own_programme_records($1) AS result', [q.registrationId], subject, issuer);
  }
  saveTask(input: unknown, subject?: string, issuer?: string) {
    const v = taskSaveInput.parse(input);
    return this.call<Receipt & { task: ProgrammeTask }>(
      'SELECT customer.programme_task_save($1,$2,$3,$4,$5) AS result',
      [v.commandId, v.workspaceId, v.programmeId, v.expectedVersion, JSON.stringify(v.task)],
      subject,
      issuer,
    );
  }
  setCapacity(input: unknown, subject?: string, issuer?: string) {
    const v = capacitySetInput.parse(input);
    return this.call<Receipt & { capacity: number; version: number; reason: string }>(
      'SELECT customer.programme_capacity_set($1,$2,$3,$4,$5) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.programmeId,
        v.expectedVersion,
        JSON.stringify({ capacity: v.capacity, reason: v.reason }),
      ],
      subject,
      issuer,
    );
  }
  setAttendance(input: unknown, subject?: string, issuer?: string) {
    const v = attendanceSetInput.parse(input);
    return this.call<
      Receipt & { registrationId: string; state: 'ATTENDED' | 'ABSENT'; version: number }
    >(
      'SELECT customer.programme_attendance_set($1,$2,$3,$4) AS result',
      [
        v.commandId,
        v.workspaceId,
        v.programmeId,
        JSON.stringify({ registrationId: v.registrationId, state: v.state }),
      ],
      subject,
      issuer,
    );
  }
  submitRecord(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...rest } = recordSubmitInput.parse(input);
    return this.call<Receipt & { registrationId: string; record: ParticipantRecord }>(
      'SELECT customer.programme_record_submit($1,$2) AS result',
      [commandId, JSON.stringify(rest)],
      subject,
      issuer,
    );
  }
}
