import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { countryCodes } from '@corridra/domain/countries';

// ADR-0085. The helper interest register: a person who has not been invited says they would like to become a field helper.
// Off unless BOTH switches are exactly 'true': this module's own CORRIDRA_HELPER_INTEREST and the Network's
// CORRIDRA_NETWORK_ENABLED. Turning it on needs the installed database module, which stays closed until real use is enabled.
export function helperInterestEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_HELPER_INTEREST === 'true' && env.CORRIDRA_NETWORK_ENABLED === 'true';
}

// The words a visitor may send. The limits match the database, which checks them again. The reason is plain text: it is
// stored and shown as text and is never interpreted as HTML or any markup.
const oneLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Plain text only')
    .refine((value) => value.length >= min && value.length <= max, 'Check the length');
export const helperInterestInput = z
  .object({
    name: oneLine(2, 120),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine((code) => (countryCodes as readonly string[]).includes(code), 'Choose a country'),
    // A line break from the text box becomes a space: the reason is one short plain line.
    reason: z.preprocess(
      (value) => (typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ') : value),
      oneLine(10, 500),
    ),
    // A person never sees this field. Anything in it means a program filled the form.
    website: z.string().max(200).default(''),
  })
  .strict();
export type HelperInterestInput = z.infer<typeof helperInterestInput>;

export const helperInterestRemoveInput = z.object({ id: z.uuid() }).strict();
export const helperInterestListQuery = z.object({
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export const helperInterestPageSize = 50;
const unavailable = 'This is not available';
const tooMany = 'Too many requests. Try again later.';

export type HelperInterestRow = {
  id: string;
  name: string;
  email: string;
  country: string;
  reason: string;
  createdAt: string;
};
export type HelperInterestList = {
  installed: boolean;
  total: number;
  rows: HelperInterestRow[];
  nextOffset: number | null;
};

const missing = ['42883', '42P01', '3F000'];

export class HelperInterestService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly secret: string,
  ) {}

  // A key that identifies an email address (or everyone) without ever being one: keyed, one way, never stored with the person.
  private key(kind: string, value: string) {
    return createHmac('sha256', this.secret)
      .update(`helper-interest:${kind}:${value}`)
      .digest('hex');
  }

  /** Whether the form may be shown now: both switches on and the register installed and open. Any failure means no. */
  async offered(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    if (!helperInterestEnabled(env)) return false;
    try {
      const row = (
        await this.pool.query<{ open: boolean }>('SELECT app.helper_interest_open() AS open')
      ).rows[0];
      return row?.open === true;
    } catch {
      return false;
    }
  }

  /**
   * The global budget (60 sign-ups an hour in all), spent before the body is read, so a flood is turned away early. There is no
   * per-client key: no address of any client is read, hashed or kept (the owner control is that only a hashed email address and
   * one global key are ever in the rate limit table).
   */
  async globalBudget() {
    const r = await this.pool.query<{ ok: boolean }>('SELECT app.intake_budget($1,60) AS ok', [
      this.key('all', 'all'),
    ]);
    if (!r.rows[0]?.ok) throw new DomainError(tooMany, 429);
  }

  /**
   * One sign-up. A first sign-up and a repeat of the same address return the same thing, so the answer says nothing about who
   * signed up before. A filled hidden field stores nothing and also returns the same thing. Returns nothing the caller can use.
   */
  async submit(input: unknown): Promise<{ received: true }> {
    const v = helperInterestInput.parse(input);
    if (v.website !== '') return { received: true };
    const budget = await this.pool.query<{ ok: boolean }>('SELECT app.intake_budget($1,6) AS ok', [
      this.key('email', v.email),
    ]);
    if (!budget.rows[0]?.ok) throw new DomainError(tooMany, 429);
    try {
      await this.pool.query('SELECT app.helper_interest_submit($1,$2,$3,$4)', [
        v.name,
        v.email,
        v.country,
        v.reason,
      ]);
    } catch (error) {
      const { code } = error as { code?: string };
      if (code === '55000' || (code && missing.includes(code)))
        throw new DomainError(unavailable, 404);
      if (code === '22023') throw new DomainError('Check the highlighted fields', 400);
      if (code === '54000') throw new DomainError(tooMany, 429);
      throw error;
    }
    return { received: true };
  }

  /** Whether the database module is installed. Reveals nothing about any entry; the operator screen hides itself on false. */
  async installed(): Promise<boolean> {
    try {
      const row = (
        await this.pool.query<{ installed: boolean }>(
          "SELECT to_regprocedure('app.helper_interest_purge()') IS NOT NULL AS installed",
        )
      ).rows[0];
      return row?.installed === true;
    } catch {
      return false;
    }
  }

  /** The owner or admin list. Opening it also deletes what is past its 180 days. Not installed: an empty answer that says so. */
  async list(ctx: RequestContext, query: unknown): Promise<HelperInterestList> {
    const q = helperInterestListQuery.parse(query);
    return withTenant(this.pool, ctx, 'helper.interest.read', async (t) => {
      const installed = (
        await t.db.query<{ installed: boolean }>(
          "SELECT to_regprocedure('app.helper_interest_purge()') IS NOT NULL AS installed",
        )
      ).rows[0]?.installed;
      if (!installed) return { installed: false, total: 0, rows: [], nextOffset: null };
      await t.db.query('SELECT app.helper_interest_purge()');
      const total = Number(
        (await t.db.query<{ n: string }>('SELECT count(*) AS n FROM app.helper_interest')).rows[0]
          ?.n ?? 0,
      );
      const rows = (
        await t.db.query<{
          id: string;
          name: string;
          email: string;
          country: string;
          reason: string;
          created_at: Date;
        }>(
          'SELECT id,name,email,country,reason,created_at FROM app.helper_interest ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2',
          [helperInterestPageSize, q.offset],
        )
      ).rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        country: row.country,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
      }));
      const next = q.offset + rows.length;
      return { installed: true, total, rows, nextOffset: next < total ? next : null };
    });
  }

  /** Deleting one entry on request. An owner or admin, with a fresh authenticator check; one delete event records it. */
  async remove(ctx: RequestContext, input: unknown): Promise<{ removed: boolean }> {
    const v = helperInterestRemoveInput.parse(input);
    try {
      return await withTenant(this.pool, ctx, 'helper.interest.remove', async (t) => ({
        removed:
          (
            await t.db.query<{ removed: boolean }>(
              'SELECT app.helper_interest_remove($1) AS removed',
              [v.id],
            )
          ).rows[0]?.removed === true,
      }));
    } catch (error) {
      const { code } = error as { code?: string };
      if (code && missing.includes(code)) throw new DomainError(unavailable, 404);
      if (code === '42501')
        throw new DomainError('You cannot delete helper interest entries from this account.', 403);
      throw error;
    }
  }
}
