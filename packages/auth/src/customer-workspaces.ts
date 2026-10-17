import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  assertRestrictedPool,
  sessionHash,
  type DatabaseClient,
  type DatabasePool,
} from '@corridra/db';

export const customerWorkspaceInput = z
  .object({
    commandId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(11)
      .max(120)
      .startsWith('Synthetic ')
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  })
  .strict();
export const customerIssuer = z.url().refine((value) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname.endsWith('.neonauth.c-5.eu-central-1.aws.neon.tech') &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    url.pathname === '/corridra/auth'
  );
}, 'An isolated Frankfurt customer issuer is required');
export type CustomerSession = { subject: string; expiresAt: Date; emailVerified: boolean };
export type CustomerWorkspace = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  synthetic: true;
  organisationId: null;
};
export type CustomerWorkspaceOptions = {
  enabled: boolean;
  synthetic: boolean;
  production: boolean;
  issuer: string;
};

export const customerAccessInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('invite'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      label: customerWorkspaceInput.shape.name,
    })
    .strict(),
  z
    .object({
      action: z.literal('accept'),
      commandId: z.uuid(),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('revoke'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      kind: z.enum(['invitation', 'membership']),
      targetId: z.uuid(),
    })
    .strict(),
]);
const accessPageInput = z
  .object({
    workspaceId: z.uuid(),
    invitationAfter: z.uuid().optional(),
    memberAfter: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CustomerAccessOutcome = {
  workspaceId: string;
  invitationId?: string;
  memberId?: string;
  expiresAt?: string;
  status?: 'cancelled' | 'revoked';
  issued?: boolean;
  token?: string | null;
  workspace?: CustomerWorkspace;
};
export type CustomerAccessPage = {
  workspaceId: string;
  ownerProtected: true;
  invitations: {
    id: string;
    label: string;
    expiresAt: string;
    memberId: string | null;
    status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  }[];
  memberships: {
    id: string;
    label: string;
    role: 'member';
    createdAt: string;
    status: 'active' | 'revoked' | 'account-disabled';
  }[];
  nextInvitationAfter: string | null;
  nextMemberAfter: string | null;
};

export function customerWorkspacesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.CORRIDRA_CUSTOMER_WORKSPACES_ENABLED === 'true' &&
    env.DATA_ENVIRONMENT === 'synthetic' &&
    env.VERCEL_ENV !== 'production'
  );
}

// This service is server-only: readSession must fetch the actual current provider
// session. No handler may deserialize CustomerSession from a request body/header.
export class CustomerWorkspaceService {
  constructor(
    private runtime: DatabasePool,
    private auth: DatabasePool,
    private options: CustomerWorkspaceOptions,
    private readSession: () => Promise<CustomerSession | null>,
  ) {}

  async list(expectedSubject?: string, expectedIssuer?: string): Promise<CustomerWorkspace[]> {
    return this.transaction(
      async (db) => {
        const result = await db.query('SELECT * FROM customer.collaborative_workspaces()');
        return result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          synthetic: row.synthetic,
          organisationId: row.organisation_id,
        }));
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async provision(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerWorkspace> {
    const value = customerWorkspaceInput.parse(input);
    return this.transaction(
      async (db) => {
        const {
          rows: [row],
        } = await db.query('SELECT customer.provision_workspace($1,$2) AS id', [
          value.commandId,
          value.name,
        ]);
        const result = await db.query('SELECT * FROM customer.workspaces() WHERE id=$1', [row.id]);
        if (!result.rows[0]) throw new DomainError('Customer workspace is unavailable', 403);
        const workspace = result.rows[0];
        return {
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
          synthetic: workspace.synthetic,
          organisationId: workspace.organisation_id,
        };
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async listAccess(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerAccessPage> {
    const value = accessPageInput.parse(input);
    return this.transaction(
      async (db) => {
        const {
          rows: [row],
        } = await db.query<{ result: CustomerAccessPage }>(
          'SELECT customer.workspace_access_list($1,$2,$3,$4) AS result',
          [
            value.workspaceId,
            value.invitationAfter ?? null,
            value.memberAfter ?? null,
            value.pageSize,
          ],
        );
        return row.result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async access(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerAccessOutcome> {
    const value = customerAccessInput.parse(input);
    return this.transaction(
      async (db) => {
        // Only a hash reaches PostgreSQL. A lost first response cannot recover the secret.
        const token = value.action === 'invite' ? randomBytes(32).toString('base64url') : null;
        const payload =
          value.action === 'invite'
            ? { workspaceId: value.workspaceId, label: value.label, tokenHash: sessionHash(token!) }
            : value.action === 'accept'
              ? { tokenHash: sessionHash(value.token) }
              : { workspaceId: value.workspaceId, kind: value.kind, targetId: value.targetId };
        const {
          rows: [row],
        } = await db.query<{ result: CustomerAccessOutcome }>(
          'SELECT customer.workspace_access_command($1,$2,$3) AS result',
          [value.commandId, value.action, JSON.stringify(payload)],
        );
        const result = row.result;
        if (value.action === 'invite')
          return { ...result, token: result.issued === true ? token : null };
        if (value.action === 'accept') {
          const {
            rows: [workspace],
          } = await db.query('SELECT * FROM customer.collaborative_workspaces() WHERE id=$1', [
            result.workspaceId,
          ]);
          if (!workspace) throw new DomainError('Customer workspace is unavailable', 403);
          return {
            ...result,
            workspace: {
              id: workspace.id,
              name: workspace.name,
              role: workspace.role,
              synthetic: workspace.synthetic,
              organisationId: workspace.organisation_id,
            },
          };
        }
        return result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  private async transaction<T>(
    work: (db: DatabaseClient) => Promise<T>,
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
      db = await this.runtime.connect();
      await db.query('BEGIN');
      await db.query(
        `SELECT set_config('corridra.customer_proof_hash',$1,true),set_config('corridra.session_hash','',true),
        set_config('corridra.tenant_id','',true),set_config('corridra.purpose','synthetic_validation',true)`,
        [hash],
      );
      const result = await work(db);
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
