import { z } from 'zod';

// Move records: what a person must do next, set by the Corridra team about one request. The rules for
// the words are here and in the database (the database is the authority; this gives the early, plain
// message). A Move is plain: no link, no markup, no address and nothing that looks like money, so it
// can never become a side channel for a price, a payment instruction or a contact detail.
export const moveVerbs = ['Read', 'Answer', 'Add', 'Confirm', 'Choose', 'Send'] as const;
export type MoveVerbName = (typeof moveVerbs)[number];
/** customer: the person who submitted the request. team: the Corridra team. third: a supplier or buyer. */
export const moveHolders = ['customer', 'team', 'third'] as const;
export type MoveHolderName = (typeof moveHolders)[number];
export const maxOpenMoves = 5;
export const maxMoveObject = 80;

const control = /[\u0000-\u001f\u007f<>]/u;
const link = /(https?:|www\.|@|\.(com|net|org|io|co|cn|bd|es)\b)/i;
const currencyWord = /\b(usd|eur|gbp|bdt|cny|rmb|inr)\b/i;
const money = new RegExp(
  [
    '[$€£৳¥]',
    String.raw`\d[\d,.]*\s?(k|m)\b`,
    String.raw`\d{1,3}(,\d{3})+`,
    String.raw`\d+\.\d{2}\b`,
  ].join('|'),
  'i',
);

/** Why a Move object is refused, or null when it is plain. */
export function moveObjectProblem(value: string): string | null {
  if (control.test(value)) return 'Use plain words, without markup or control characters.';
  if (link.test(value)) return 'Leave out links and email addresses.';
  if (currencyWord.test(value) || money.test(value)) return 'Leave out amounts and prices.';
  return null;
}

export const moveObject = z
  .string()
  .trim()
  .min(3, 'Say what it is in a few words')
  .max(maxMoveObject, `Use at most ${maxMoveObject} characters`)
  .superRefine((value, ctx) => {
    const problem = moveObjectProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as year-month-day');

export const moveInput = z
  .object({
    verb: z.enum(moveVerbs),
    object: moveObject,
    holder: z.enum(moveHolders),
    /** A real date only. Bounded to a year ahead by the database. */
    dueOn: day.nullable().default(null),
  })
  .strict();
export type MoveInput = z.infer<typeof moveInput>;

export const moveCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set'),
      commandId: z.uuid(),
      missionId: z.uuid(),
      moves: z.array(moveInput).min(1).max(maxOpenMoves),
    })
    .strict(),
  z
    .object({
      action: z.literal('done'),
      commandId: z.uuid(),
      missionId: z.uuid(),
      moveId: z.uuid(),
    })
    .strict(),
  z.object({ action: z.literal('clear'), commandId: z.uuid(), missionId: z.uuid() }).strict(),
]);
export type MoveCommand = z.infer<typeof moveCommand>;

/** What the customer reads for one request: the open Moves, in the order the team set them. */
export type CustomerMove = {
  id: string;
  verb: MoveVerbName;
  object: string;
  holder: MoveHolderName;
  dueOn: string | null;
  setAt: string;
};
export type CustomerMoveList = {
  open: boolean;
  requests: { requestId: string; moves: CustomerMove[] }[];
  nextAfter: string | null;
  synthetic: boolean;
};
