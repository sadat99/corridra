import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseClient, DatabasePool } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  CustomerSessionBoundary,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from './customer-session';
import { customerDecisionsEnabled } from './customer-decisions';
import { customerProductionLocked } from './customer-production';

// ADR-076 item 4: the decision card is off unless the owner sets the switch to exactly 'true', saved reports and
// decisions are on, and production is not locked. The database module must also be installed (see installed()).
export function customerDecisionCardsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerDecisionsEnabled(env) &&
    env.CORRIDRA_SHARE_CARD === 'true' &&
    !customerProductionLocked(env)
  );
}

// The link secret. It is derived, never stored: the same customer and command always give the same 43
// characters, so an exact retry can show the same link again, while the database keeps only its SHA-256.
export function cardToken(secret: string, issuer: string, subject: string, commandId: string) {
  return createHmac('sha256', secret)
    .update(`decision-card:${issuer}:${subject}:${commandId}`)
    .digest('base64url');
}
export const cardTokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');

// Any UUID-shaped value, not only RFC 4122 versions: ids made by the database must never turn into a server error.
const id = z.guid();
const hexDigest = z.string().regex(/^[a-f0-9]{64}$/);
const stateRequest = z.strictObject({ action: z.literal('state'), resourceId: id });
const previewRequest = z.strictObject({
  action: z.literal('preview'),
  resourceId: id,
  decisionId: id,
});
const createRequest = z.strictObject({
  action: z.literal('create'),
  commandId: id,
  resourceId: id,
  decisionId: id,
  digest: hexDigest,
  // The expiry the preview showed, passed back unchanged: the card gets exactly that time.
  expiresAt: z.iso.datetime(),
  acknowledged: z.literal(true),
});
const withdrawRequest = z.strictObject({
  action: z.literal('withdraw'),
  commandId: id,
  cardId: id,
});
export const decisionCardRequest = z.discriminatedUnion('action', [
  stateRequest,
  previewRequest,
  createRequest,
  withdrawRequest,
]);

const text = z.string();
const fields = z.object({
  company: text,
  decision: text,
  rationale: text,
  nextAction: text,
  dueAt: text,
  provenance: z.object({ sourceKind: text, claimStatus: text }),
});
const cardState = z.enum(['ACTIVE', 'WITHDRAWN', 'EXPIRED', 'UNAVAILABLE']);
const stateResult = z.object({
  resourceId: id,
  canShare: z.boolean(),
  maxActive: z.number().int(),
  cards: z.array(
    z.object({
      id,
      decisionId: id,
      state: cardState,
      createdAt: text,
      expiresAt: text,
      opens: z.number().int(),
      lastOpenedAt: text.nullable(),
    }),
  ),
});
const previewResult = z.object({
  resourceId: id,
  decisionId: id,
  fields,
  digest: hexDigest,
  expiresAt: text,
  maxActive: z.number().int(),
});
const createResult = z.object({ cardId: id, expiresAt: text, state: cardState });
const withdrawResult = z.object({ cardId: id, state: z.literal('WITHDRAWN') });
const openResult = z.object({
  state: z.literal('OPEN'),
  card: fields,
  expiresAt: text,
  synthetic: z.literal(true),
});
// The link secret is present only for a card that is active now.
export type CreatedDecisionCard = z.infer<typeof createResult> & { token?: string };
export type OpenDecisionCard = z.infer<typeof openResult>;

const denied = 'Access denied or link unavailable';
// The database refuses with distinct constants; SQLSTATE alone is shared with other functions (53400 is also the
// admission limit, 23514 any validation), so the card answers are told apart by SQLSTATE and message together.
export function mapDecisionCardError(error: unknown) {
  if (error instanceof DomainError) {
    // The boundary answers 409 when the browser's account differs from the signed-in one. Access that changed is
    // never a content conflict, so it is the same refusal as any other loss of access.
    return error.status === 409 ? new DomainError(denied, 403) : error;
  }
  const { code, message } = error as { code?: string; message?: string };
  if (code === '23514' && message === 'DECISION_CARD_CHANGED')
    return new DomainError(
      'This link changed since you reviewed it. Review it again before sharing.',
      409,
      'CHANGED',
    );
  if (code === '53400' && message === 'DECISION_CARD_CAP_REACHED')
    return new DomainError(
      'This report already has the most active links allowed. Withdraw one to make another.',
      409,
      'CAP_REACHED',
    );
  if (code === '54000' && message === 'DECISION_CARD_RATE_LIMITED')
    return new DomainError(
      'Too many new links for this report just now. Try again in a while.',
      429,
    );
  if (code === '42501') return new DomainError(denied, 403);
  if (code === '23514') return new DomainError('Check the submitted values', 400);
  if (code === '40P01' || code === '55P03')
    return new DomainError('Busy right now. Try again in a moment.', 503, 'RETRYABLE');
  return error;
}

export class CustomerDecisionCardService extends CustomerSessionBoundary {
  constructor(
    private readonly runtimePool: DatabasePool,
    authPool: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
    private readonly secret: string,
  ) {
    super(runtimePool, authPool, options, readSession);
  }
  // True once the owner's protected install run has added the five database functions. Reads the catalogue only,
  // through the runtime role that will run them (the authentication role cannot see the customer schema).
  async installed(): Promise<boolean> {
    const result = await this.runtimePool.query(
      `SELECT to_regprocedure('customer.decision_card_state(uuid)') IS NOT NULL
        AND to_regprocedure('customer.decision_card_preview(uuid,uuid)') IS NOT NULL
        AND to_regprocedure('customer.create_decision_card(uuid,uuid,uuid,text,text,timestamp with time zone)') IS NOT NULL
        AND to_regprocedure('customer.withdraw_decision_card(uuid,uuid)') IS NOT NULL
        AND to_regprocedure('app.read_decision_card(text)') IS NOT NULL AS installed`,
    );
    return result.rows[0]?.installed === true;
  }
  private async run<T>(
    work: (db: DatabaseClient, proof: { issuer: string; subject: string }) => Promise<T>,
    subject?: string,
    issuer?: string,
  ): Promise<T> {
    this.requireRealReports();
    try {
      return await this.transaction(work, subject, issuer);
    } catch (error) {
      throw mapDecisionCardError(error);
    }
  }
  private call<T>(
    schema: z.ZodType<T>,
    sql: string,
    values: unknown[],
    subject?: string,
    issuer?: string,
  ): Promise<T> {
    return this.run(
      async (db) => this.shaped(schema, (await db.query(sql, values)).rows[0].result),
      subject,
      issuer,
    );
  }
  // A record the database function made that does not have the agreed shape is our fault, not the caller's.
  private shaped<T>(schema: z.ZodType<T>, value: unknown): T {
    const checked = schema.safeParse(value);
    if (!checked.success) throw new Error('The decision card record did not have the agreed shape');
    return checked.data;
  }
  // The signed-in customer's own cards for one saved report, and whether they may share from it.
  async state(resourceId: unknown, subject?: string, issuer?: string) {
    const v = stateRequest.shape.resourceId.parse(resourceId);
    return this.call(
      stateResult,
      'SELECT customer.decision_card_state($1) AS result',
      [v],
      subject,
      issuer,
    );
  }
  // The exact six fields, their digest and the latest expiry. Writes nothing.
  async preview(resourceId: unknown, decisionId: unknown, subject?: string, issuer?: string) {
    const v = previewRequest.parse({ action: 'preview', resourceId, decisionId });
    return this.call(
      previewResult,
      'SELECT customer.decision_card_preview($1,$2) AS result',
      [v.resourceId, v.decisionId],
      subject,
      issuer,
    );
  }
  // Makes one card. The link secret is derived from the fresh session and the command, only its SHA-256 goes to
  // the database, and the secret is returned only while the card is active.
  // `beforeCreate` is the caller's rate limit. It runs inside the transaction, after the fresh session has been
  // verified, and receives the VERIFIED issuer and subject, so an unauthenticated request can never spend or
  // exhaust a customer's allowance. A refusal from it stops the create.
  // Two behaviours worth knowing. (1) The secret depends on AUTH_SECRET: after that secret is rotated an exact retry
  // of an earlier command derives a different secret, and the database answers CHANGED. That is safe (no second
  // card, no wrong link) but misleading, and the owner then makes a new card. (2) `acknowledged: true` is enforced
  // here, at the HTTP layer, only; the digest already binds the fields the owner previewed.
  async create(
    input: unknown,
    subject?: string,
    issuer?: string,
    beforeCreate?: (customer: { issuer: string; subject: string }) => Promise<void>,
  ): Promise<CreatedDecisionCard> {
    const v = createRequest.parse(input);
    return this.run(
      async (db, proof) => {
        await beforeCreate?.({ issuer: proof.issuer, subject: proof.subject });
        const token = cardToken(this.secret, proof.issuer, proof.subject, v.commandId);
        const card = this.shaped(
          createResult,
          (
            await db.query('SELECT customer.create_decision_card($1,$2,$3,$4,$5,$6) AS result', [
              v.commandId,
              v.resourceId,
              v.decisionId,
              v.digest,
              cardTokenDigest(token),
              v.expiresAt,
            ])
          ).rows[0].result,
        );
        return card.state === 'ACTIVE' ? { ...card, token } : card;
      },
      subject,
      issuer,
    );
  }
  // Only the creator can withdraw. A repeat is the same answer.
  async withdraw(input: unknown, subject?: string, issuer?: string) {
    const v = withdrawRequest.parse(input);
    return this.call(
      withdrawResult,
      'SELECT customer.withdraw_decision_card($1,$2) AS result',
      [v.commandId, v.cardId],
      subject,
      issuer,
    );
  }
}

// What the public page sends: the 43 characters of the link secret and nothing else.
export const publicCardRequest = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

const unknown = { state: 'unknown' } as const;
// The anonymous read. The database function counts the open, so this is a plain statement on the primary pool:
// never a read-only transaction and never a secondary copy of the database.
export class DecisionCardReader {
  constructor(private readonly pool: DatabasePool) {}
  // `digest` is the SHA-256 of the link secret, or null for a request that was not well formed. Every answer
  // that is not an open card, including a module that is not installed, is the same single value.
  async read(digest: string | null): Promise<OpenDecisionCard | typeof unknown> {
    if (digest === null) return unknown;
    try {
      const result = await this.pool.query('SELECT app.read_decision_card($1) AS result', [digest]);
      const open = openResult.safeParse(result.rows[0]?.result);
      return open.success ? open.data : unknown;
    } catch (error) {
      if (['42883', '42P01', '3F000'].includes((error as { code?: string }).code ?? ''))
        return unknown;
      throw error;
    }
  }
}
