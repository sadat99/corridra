import { legacyMarketCode } from './geography';
import { z } from 'zod';
import { DomainError } from './index';

const words = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .refine((v) => !v.includes('—'), 'Use plain punctuation');
export const channel = z.enum(['SYNTHETIC', 'MANUAL', 'EMAIL']);
export const contactPurpose = z.enum([
  'institutional_introduction',
  'referral',
  'event_introduction',
  'buyer_opt_in',
  'official_company_channel',
  'manual_outreach',
  'platform_message',
  'network_introduction',
]);
export const timezone = z
  .string()
  .min(1)
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA timezone');
const timestamp = z.iso.datetime({ offset: true });
export const introduction = z
  .object({
    company: words(160),
    country: legacyMarketCode,
    capability: words(600),
    fit: words(1000),
    evidence: words(1000),
    uncertainty: words(1000),
    conversationPurpose: words(600),
    availableDates: words(300),
  })
  .strict();
export type Introduction = z.infer<typeof introduction>;
const command = { commandId: z.uuid() };
export const communicationCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('policy'),
      jurisdiction: legacyMarketCode,
      channel,
      contactPurpose,
      basis: words(1000),
      validUntil: timestamp,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('template'),
      name: words(120),
      contactPurpose,
      body: words(1500),
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('introduce'),
      targetId: z.uuid(),
      contactId: z.uuid(),
      policyId: z.uuid(),
      templateId: z.uuid(),
      introduction,
      expiresAt: timestamp,
    })
    .strict(),
  z
    .object({ ...command, action: z.literal('revoke'), linkId: z.uuid(), reason: words(500) })
    .strict(),
  z
    .object({ ...command, action: z.literal('optout'), contactId: z.uuid(), reason: words(500) })
    .strict(),
  z
    .object({ ...command, action: z.literal('retry'), messageId: z.uuid(), reason: words(500) })
    .strict(),
]);
export const buyerRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z
    .object({
      action: z.literal('respond'),
      token: z.string().regex(/^[a-f0-9]{64}$/),
      responseId: z.uuid(),
      decision: z.enum(['INTERESTED', 'NEED_INFO', 'NOT_RELEVANT']),
      optOut: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('optout'), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export const meetingStatus = z.enum([
  'PROPOSED',
  'ACCEPTED',
  'SCHEDULED',
  'HELD',
  'DECLINED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULE_REQUIRED',
]);
export type MeetingStatus = z.infer<typeof meetingStatus>;
export const meetingTransitions: Record<MeetingStatus, readonly MeetingStatus[]> = {
  PROPOSED: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
  ACCEPTED: ['SCHEDULED', 'DECLINED', 'CANCELLED'],
  SCHEDULED: ['HELD', 'CANCELLED', 'NO_SHOW', 'RESCHEDULE_REQUIRED'],
  HELD: [],
  DECLINED: [],
  CANCELLED: [],
  NO_SHOW: ['RESCHEDULE_REQUIRED'],
  RESCHEDULE_REQUIRED: ['SCHEDULED', 'DECLINED', 'CANCELLED'],
};
export function assertMeetingTransition(from: MeetingStatus, to: MeetingStatus) {
  if (!meetingTransitions[from].includes(to))
    throw new DomainError('Invalid meeting transition', 409);
}
export function localWallTime(instant: string | Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const schedule = z
  .object({
    startsAt: timestamp,
    endsAt: timestamp,
    timezone,
    localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    localEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    location: words(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Date(v.endsAt) <= new Date(v.startsAt) ||
      new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() > 8 * 3600000
    )
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'A meeting must last between one minute and eight hours',
      });
    for (const [field, instant] of [
      ['localStart', v.startsAt],
      ['localEnd', v.endsAt],
    ] as const) {
      if (
        new Date(instant).getUTCSeconds() ||
        new Date(instant).getUTCMilliseconds() ||
        localWallTime(instant, v.timezone) !== v[field]
      )
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message:
            'The local time and explicit UTC offset must match this timezone, including daylight saving',
        });
    }
  });
const ownership = { ownerId: z.uuid(), nextAction: words(300), dueAt: timestamp };
export const meetingCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      ...ownership,
      action: z.literal('proposeActivity'),
      targetId: z.uuid(),
      activityKind: z.enum([
        'BUYER_MEETING',
        'SUPPLIER_MEETING',
        'FACTORY_VISIT',
        'SHOWROOM_VISIT',
        'TECHNICAL_EVALUATION',
        'INSTITUTIONAL_MEETING',
        'TRADE_FAIR_MEETING',
      ]),
      context: z
        .object({
          purpose: words(1000),
          checklist: z.array(words(160)).max(15),
          evidenceRequests: z.array(words(160)).max(15),
        })
        .strict(),
      title: words(160),
      brief: words(2000),
      participants: z.array(words(160)).min(2).max(8),
      reason: words(500),
    })
    .strict(),
  z
    .object({
      ...command,
      ...ownership,
      action: z.literal('propose'),
      messageId: z.uuid(),
      title: words(160),
      brief: words(2000),
      participants: z.array(words(160)).min(2).max(8),
      reason: words(500),
    })
    .strict(),
  z
    .object({
      ...command,
      ...ownership,
      action: z.literal('transition'),
      id: z.uuid(),
      version: z.int().positive(),
      status: meetingStatus,
      reason: words(500),
      acceptance: words(1000).optional(),
      responseId: z.uuid().optional(),
      schedule: schedule.optional(),
      outcome: words(2000).optional(),
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('followup'),
      id: z.uuid(),
      version: z.int().positive(),
      status: z.enum(['COMPLETED', 'CANCELLED']),
      reason: words(1000),
    })
    .strict(),
]);
