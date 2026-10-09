import { z } from 'zod';
export const objectiveOptions = [
  'Sell in a new market',
  'Find customers or distributors',
  'Source suppliers',
  'Make an upcoming business trip more productive',
  'Run a multi-company mission',
  'Something else',
] as const;
export const outcomeOptions = [
  'Relevant meetings',
  'Buyers / customers',
  'Distributor conversations',
  'Supplier visits',
  'Market validation',
  'Local commercial intelligence',
  'Something else',
] as const;
export const noticeVersion = 'synthetic-intake-2026-10-05-v1';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid date',
  );
const briefFields = z.object({
  objective: z.enum(objectiveOptions, { error: 'Choose what you want to do' }),
  market: z
    .string()
    .trim()
    .min(2, 'Enter your target country or market')
    .max(120, 'Use at most 120 characters'),
  attendance: z.enum(['Yes', 'No', 'Not decided']),
  startDate: z.union([date, z.literal('')]),
  endDate: z.union([date, z.literal('')]),
  timezone: z
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
    }, 'Choose a valid timezone'),
  offer: z
    .string()
    .trim()
    .min(10, 'Describe your offer or requirement in at least 10 characters')
    .max(2000),
  website: z.union([
    z
      .url({ protocol: /^https?$/, error: 'Enter a valid http or https website address' })
      .max(2000, 'Use a shorter website address'),
    z.literal(''),
  ]),
  outcomes: z
    .array(z.enum(outcomeOptions))
    .min(1, 'Choose at least one outcome')
    .max(7)
    .refine((v) => new Set(v).size === v.length),
  notes: z.string().trim().max(1000),
  name: z.string().trim().min(2, 'Enter your name').max(120, 'Use at most 120 characters'),
  company: z.string().trim().min(2, 'Enter your company').max(160, 'Use at most 160 characters'),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase())
    .refine((v) => v.endsWith('@example.invalid'), 'Use a test address ending in @example.invalid'),
  acknowledged: z.literal(true, { error: 'Read and acknowledge the test intake notice' }),
});
function validateWindow(
  v: { attendance: string; startDate: string; endDate: string },
  ctx: z.RefinementCtx,
) {
  if (v.attendance === 'Yes') {
    if (!v.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: 'Enter your visit start date',
      });
    if (!v.endDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Enter your visit end date' });
    if (v.startDate && v.endDate && v.endDate < v.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must follow the start date',
      });
  } else if (v.startDate || v.endDate)
    ctx.addIssue({
      code: 'custom',
      path: ['attendance'],
      message: 'Only provide visit dates when attending in person',
    });
}
export const briefSchema = briefFields.superRefine(validateWindow);
export const intakeSteps = [
  briefFields.pick({ objective: true }),
  briefFields
    .pick({ market: true, attendance: true, startDate: true, endDate: true, timezone: true })
    .superRefine(validateWindow),
  briefFields.pick({ offer: true, website: true }),
  briefFields.pick({ outcomes: true, notes: true }),
  briefFields.pick({ name: true, company: true, email: true, acknowledged: true }),
];
export type MissionBrief = z.infer<typeof briefSchema>;
export const missionStatus = z.enum([
  'DRAFT',
  'QUALIFICATION',
  'ACTIVE',
  'TARGETING',
  'OUTREACH',
  'MEETINGS',
  'FOLLOW_UP',
  'COMMERCIAL_PIPELINE',
  'CLOSED',
  'CANCELLED',
  'ON_HOLD',
]);
export const missionCommand = z.object({
  id: z.uuid(),
  version: z.int().positive(),
  commandId: z.uuid(),
  action: z.enum([
    'assign',
    'qualify',
    'activate',
    'targeting',
    'outreach',
    'meetings',
    'followup',
    'pipeline',
    'close',
    'pause',
    'resume',
    'cancel',
  ]),
  reason: z.string().trim().min(3).max(500),
  ownerId: z.uuid(),
  nextAction: z.string().trim().min(3).max(300),
  dueAt: z.iso.datetime({ offset: true }),
  marketCode: z.enum(['BD', 'ES', 'DE', 'OTHER']),
  targetProfile: z.string().trim().min(3).max(1000),
});
