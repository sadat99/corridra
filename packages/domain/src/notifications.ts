import { z } from 'zod';

// What a person may choose about the email Pulse sends (ADR-067). The database repeats every rule;
// this gives the early, plain message and the shape both screens share. Nothing here sends anything.
export const notificationKinds = ['your-move', 'update', 'countdown', 'complete'] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export const mailLanguages = ['en', 'bn', 'zh', 'es', 'ar'] as const;

const clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a time such as 22:00');

/** True when the runtime knows this IANA name. The database checks its own list again. */
export function knownTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value.length > 0 && value.length <= 64;
  } catch {
    return false;
  }
}

export const notificationPreferencesInput = z
  .object({
    kinds: z.array(z.enum(notificationKinds)).max(4),
    digest: z.boolean(),
    quietStart: clock.nullable(),
    quietEnd: clock.nullable(),
    timeZone: z.string().refine(knownTimeZone, 'Pick a time zone from the list'),
    language: z.enum(mailLanguages).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.kinds).size !== value.kinds.length)
      ctx.addIssue({ code: 'custom', path: ['kinds'], message: 'Each kind can be chosen once' });
    if ((value.quietStart === null) !== (value.quietEnd === null))
      ctx.addIssue({
        code: 'custom',
        path: ['quietEnd'],
        message: 'Set both ends of the quiet hours, or neither',
      });
    if (value.quietStart !== null && value.quietStart === value.quietEnd)
      ctx.addIssue({
        code: 'custom',
        path: ['quietEnd'],
        message: 'Quiet hours need different start and end times',
      });
  });
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesInput>;

export type NotificationPreferences = NotificationPreferencesInput & {
  /** 0 until the person has saved a choice. */
  version: number;
  /** False while the database side is closed: nothing can be saved or sent. */
  open: boolean;
  synthetic: boolean;
};

/** The choices in force when the person has made none. */
export const defaultNotificationPreferences: NotificationPreferencesInput = {
  kinds: [...notificationKinds],
  digest: false,
  quietStart: null,
  quietEnd: null,
  timeZone: 'UTC',
  language: null,
};
