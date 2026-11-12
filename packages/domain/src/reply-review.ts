import { z } from 'zod';
import { compareOffers, offerTerms, type OfferTerms } from './commercial-missions';
import { currency } from './opportunities';

// Reply review (ADR-069): the Corridra team's decision about one supplier reply. The words and limits
// here repeat what the database enforces, so the team gets the early, plain message.
export const replyReviewReasons = [
  'NOT_A_FIT',
  'PRICE_NOT_CREDIBLE',
  'TOO_INCOMPLETE',
  'DUPLICATE',
  'UNCLEAR',
  'OTHER',
] as const;
export type ReplyReviewReason = (typeof replyReviewReasons)[number];

/** The nineteen terms a supplier reply may hold. */
export const replyTermNames = [
  'specification',
  'quantity',
  'moq',
  'unit',
  'unitPriceMinor',
  'totalPriceMinor',
  'toolingMinor',
  'setupMinor',
  'packagingMinor',
  'leadTime',
  'validUntil',
  'incoterm',
  'shipping',
  'warranty',
  'installation',
  'training',
  'spares',
  'commissioning',
  'paymentTerms',
] as const;
export type ReplyTermName = (typeof replyTermNames)[number];

const note = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine((value) => !/[\u0000-\u001f\u007f<>]/u.test(value), 'Use plain words');

export const replyReviewCommand = z.discriminatedUnion('decision', [
  z
    .object({
      commandId: z.uuid(),
      responseId: z.uuid(),
      // The answer version the reviewer read (0 is the first answer). Needed once corrections are installed.
      seen: z.int().min(0).max(20).optional(),
      decision: z.literal('PUBLISH'),
      note: note.optional(),
    })
    .strict(),
  z
    .object({
      commandId: z.uuid(),
      responseId: z.uuid(),
      // The answer version the reviewer read (0 is the first answer). Needed once corrections are installed.
      seen: z.int().min(0).max(20).optional(),
      decision: z.literal('ASK'),
      askTerms: z.array(z.enum(replyTermNames)).min(1).max(19),
      note: note.optional(),
    })
    .strict(),
  z
    .object({
      commandId: z.uuid(),
      responseId: z.uuid(),
      // The answer version the reviewer read (0 is the first answer). Needed once corrections are installed.
      seen: z.int().min(0).max(20).optional(),
      decision: z.literal('REJECT'),
      reasonCode: z.enum(replyReviewReasons),
      note: note.optional(),
    })
    .strict(),
]);
export type ReplyReviewCommand = z.infer<typeof replyReviewCommand>;

export type StoredReview = {
  id: string;
  responseId: string;
  decision: 'PUBLISH' | 'ASK' | 'REJECT';
  reasonCode: ReplyReviewReason | null;
  askTerms: ReplyTermName[] | null;
  note: string | null;
  createdAt: string;
};

/** Publish and reject are final; the latest ask keeps the reply open for a later decision. */
export function reviewState(reviews: readonly StoredReview[]) {
  const finals = reviews.filter((r) => r.decision !== 'ASK');
  return {
    final: finals.at(-1) ?? null,
    asked: reviews.filter((r) => r.decision === 'ASK').at(-1) ?? null,
    open: finals.length === 0,
  };
}

export type ReplyBody = {
  body?: unknown;
  meetingInterest?: unknown;
  quotation?: null | { currency?: string; terms?: Record<string, string>; uncertainties?: string };
};

/**
 * What the existing comparison engine would say about this reply, so the team sees the gaps beside the
 * requirement and no new verdict is invented. A reply with no quotation has no terms to compare.
 */
export function replyGaps(reply: ReplyBody, now = new Date().toISOString()) {
  const quotation = reply.quotation;
  if (!quotation || !quotation.terms)
    return {
      hasQuote: false as const,
      missing: [] as string[],
      expired: false,
      inconsistentTotal: false,
      comparable: false,
    };
  const parsed = offerTerms.safeParse(quotation.terms);
  if (!parsed.success)
    return {
      hasQuote: true as const,
      missing: [] as string[],
      expired: false,
      inconsistentTotal: false,
      comparable: false,
      invalid: true as const,
    };
  const terms: OfferTerms = parsed.data;
  const [result] = compareOffers(
    [
      {
        id: 'reply',
        currency: quotation.currency ?? '',
        terms,
        requirementId: 'reply',
        uncertainties: quotation.uncertainties ?? '',
      },
    ],
    now,
  );
  return {
    hasQuote: true as const,
    missing: result.missing as string[],
    expired: result.expired,
    inconsistentTotal: result.inconsistentTotal,
    comparable: result.status === 'COMPARABLE ON SUPPLIED TERMS',
  };
}

/** The terms a team would ask a supplier for, in the form's order: the ones the engine reports missing. */
export function suggestedAsk(missing: readonly string[]): ReplyTermName[] {
  return replyTermNames.filter((name) => missing.includes(name));
}

/** Why a published reply cannot be carried into the offer form (ADR-081). A refusal carries only this code, never words or terms. */
export const replyPrefillReasons = [
  'NOT_FOUND',
  'NOT_PUBLISHED',
  'REJECTED',
  'ASKED_ONLY',
  'ALREADY_RECORDED',
  'NO_QUOTATION',
  'REVIEW_CLOSED',
  'CURRENCY_NOT_ON_ROUTE',
  'REQUIREMENT_SUPERSEDED',
  'MISSION_CLOSED',
  'TERM_NOT_RECORDABLE',
] as const;
export type ReplyPrefillReason = (typeof replyPrefillReasons)[number];

const id = z.uuid();
/**
 * What `app.reply_quotation_prefill` returns. Terms are the supplier's exact strings (minor units are integer strings, never numbers)
 * under the nineteen known names only, and the currency is the one the supplier stated.
 */
export const replyQuotationPrefill = z.discriminatedUnion('eligible', [
  z.object({ eligible: z.literal(false), reason: z.enum(replyPrefillReasons) }).strict(),
  z
    .object({
      eligible: z.literal(true),
      reason: z.null(),
      responseId: id,
      seen: z.int().min(0).max(20),
      digest: z.string().regex(/^[0-9a-f]{64}$/),
      missionId: id,
      rfqId: id,
      requirementId: id,
      targetId: id,
      currency,
      terms: z.partialRecord(z.enum(replyTermNames), z.string().max(1000)),
      uncertainties: z.string().min(3).max(1000),
      // Microsecond UTC text, so the database compares the supplier's statement time exactly.
      observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      sourceKind: z.literal('SELF_DECLARATION'),
      revision: z.int().positive(),
      previousId: id.nullable(),
    })
    .strict(),
]);
export type ReplyQuotationPrefill = z.infer<typeof replyQuotationPrefill>;
