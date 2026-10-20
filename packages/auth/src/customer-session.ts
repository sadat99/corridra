import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { customerProductionUnlocked } from './customer-production';
import { DomainError } from '@corridra/domain';
import {
  assertRestrictedPool,
  sessionHash,
  type DatabaseClient,
  type DatabasePool,
} from '@corridra/db';

// The original isolated acceptance issuer shape.
function isolatedIssuer(url: URL) {
  return (
    url.hostname.endsWith('.neonauth.c-5.eu-central-1.aws.neon.tech') &&
    url.pathname === '/corridra/auth'
  );
}
// Owner opt-in (ADR-049): on an unlocked production deployment the exact issuer the owner configured in
// CORRIDRA_CUSTOMER_ISSUER is accepted too. It must be an https Frankfurt Neon Auth address and equal
// that setting character for character; nothing is derived from the request.
function ownerIssuer(url: URL, value: string, env: NodeJS.ProcessEnv) {
  return (
    customerProductionUnlocked(env) &&
    env.CORRIDRA_CUSTOMER_ISSUER === value &&
    /^[a-z0-9-]+\.neonauth\.c-[56]\.eu-central-1\.aws\.neon\.tech$/.test(url.hostname) &&
    /^\/[a-z0-9_]+\/auth$/.test(url.pathname)
  );
}
export const customerIssuer = z.url().refine((value) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    (isolatedIssuer(url) || ownerIssuer(url, value, process.env))
  );
}, 'An isolated Frankfurt customer issuer is required');
export type CustomerSession = { subject: string; expiresAt: Date; emailVerified: boolean };
export type CustomerWorkspaceOptions = {
  enabled: boolean;
  synthetic: boolean;
  production: boolean;
  issuer: string;
  // Owner opt-in, default off: admit a fresh email-verified account on first use.
  openAdmission?: boolean;
};

// Server-only boundary. Identity comes exclusively from a fresh provider response.
export class CustomerSessionBoundary {
  constructor(
    private runtime: DatabasePool,
    protected auth: DatabasePool,
    private options: CustomerWorkspaceOptions,
    private readSession: () => Promise<CustomerSession | null>,
  ) {}

  protected async transaction<T>(
    work: (
      db: DatabaseClient,
      proof: { hash: string; issuer: string; subject: string },
    ) => Promise<T>,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<T> {
    if (!this.options.enabled || !this.options.synthetic || this.options.production)
      throw new DomainError('Customer workspaces are unavailable', 503);
    if (
      expectedSubject !== undefined &&
      (!expectedSubject ||
        expectedSubject.length > 200 ||
        /[\u0000-\u001f\u007f]/u.test(expectedSubject))
    )
      throw new DomainError('Customer account context is invalid', 400);
    if (
      expectedIssuer !== undefined &&
      (expectedIssuer.length > 500 ||
        expectedIssuer !== expectedIssuer.trim() ||
        /[\u0000-\u001f\u007f]/u.test(expectedIssuer) ||
        !customerIssuer.safeParse(expectedIssuer).success)
    )
      throw new DomainError('Customer account context is invalid', 400);
    const issuer = customerIssuer.parse(this.options.issuer);
    let session: CustomerSession | null;
    try {
      session = await this.readSession();
    } catch {
      throw new DomainError('Customer identity is unavailable', 503);
    }
    if (
      !session ||
      !(session.expiresAt instanceof Date) ||
      !Number.isFinite(session.expiresAt.getTime()) ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new DomainError('Sign in to continue', 401);
    if (session.emailVerified !== true) throw new DomainError('Verify your email to continue', 403);
    if (!session.subject || session.subject.length > 200)
      throw new DomainError('Customer session is invalid', 401);
    // A browser scope is a rejection condition only. The fresh provider session
    // still establishes identity, followed by the unchanged admission/RLS checks.
    if (
      (expectedSubject !== undefined && expectedSubject !== session.subject) ||
      (expectedIssuer !== undefined && expectedIssuer !== issuer)
    )
      throw new DomainError('Your account changed. Reload before continuing.', 409);
    await Promise.all([
      assertRestrictedPool(this.runtime),
      assertRestrictedPool(this.auth, 'corridra_auth'),
    ]);
    for (const pool of [this.runtime, this.auth]) {
      const {
        rows: [role],
      } =
        await pool.query(`SELECT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('customer','customer_private','customer_migrations') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns`);
      if (role?.owns) throw new Error('Customer database identity is not restricted');
    }
    const hash = sessionHash(randomBytes(32).toString('hex'));
    // Use the DB clock for the short TTL and cap it at the actual provider expiry.
    await this.auth.query(
      `INSERT INTO customer_private.session_proof(hash,issuer,subject,expires_at)
      VALUES($1,$2,$3,least(clock_timestamp()+interval '25 seconds',$4::timestamptz))`,
      [hash, issuer, session.subject, session.expiresAt],
    );
    let db: DatabaseClient | undefined;
    try {
      // The admission function re-checks the fresh attestation in the database; the proof is removed below.
      if (this.options.openAdmission === true)
        await this.auth.query('SELECT customer_private.admit_verified_subject($1)', [hash]);
      db = await this.runtime.connect();
      await db.query('BEGIN');
      await db.query(
        `SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),
        set_config('corridra.tenant_id','',true),set_config('corridra.purpose','synthetic_validation',true)`,
        [hash],
      );
      const result = await work(db, { hash, issuer, subject: session.subject });
      await db.query('COMMIT');
      return result;
    } catch (error) {
      if (db) await db.query('ROLLBACK');
      throw error;
    } finally {
      db?.release();
      await this.auth.query(
        'DELETE FROM customer_private.session_proof WHERE hash=$1 OR expires_at<=clock_timestamp()',
        [hash],
      );
    }
  }
}
