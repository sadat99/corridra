// ADR-087 U5, member access, server side. A workspace owner or admin reads the saved reports and decision cards of current members
// of that workspace and downloads their Trip Book and Supplier Book, read only. Every read goes through the member access module's
// customer functions inside a fresh verified customer transaction; the database decides who may read what, opens each workspace
// only 24 hours after its member notice was delivered, and writes one audit event per list, open or book. Off unless
// CORRIDRA_MEMBER_ACCESS is exactly "true" (separate from CORRIDRA_MEMBER_NOTICE): off, every method refuses as not found.
import { z } from 'zod';
import type { DatabaseClient, DatabasePool } from '@corridra/db';
import { CustomerSessionBoundary } from '@corridra/auth/customer-session';
import { DomainError } from '@corridra/domain';
import { bookKind, bookResult, type BookRecord } from '@corridra/domain/books';
import { uxSwitchOn } from './ux-switches';

export const memberAccessOn = (env: NodeJS.ProcessEnv = process.env) =>
  uxSwitchOn('CORRIDRA_MEMBER_ACCESS', env);

export type MemberAccessLabels = { memberAccess: boolean; memberAccessCards: boolean };
const labelsOff: MemberAccessLabels = { memberAccess: false, memberAccessCards: false };
/**
 * Whether the privacy labels may name workspace owners and admins as readers. The saved report label (S3) needs the switch on
 * and part 1 installed (0001, saved reports); the decision card label (S4) also needs part 2 (0002, decision cards), which waits
 * for the decision card module. Off, not installed or not checkable: both false, so the labels stay exactly as they are
 * without U5. The installation is read only after the switch is on.
 */
export async function memberAccessAvailable(
  readInstalled: () => Promise<{ reports: boolean; cards: boolean }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MemberAccessLabels> {
  if (!memberAccessOn(env)) return labelsOff;
  try {
    const installed = await readInstalled();
    const reports = installed?.reports === true;
    return { memberAccess: reports, memberAccessCards: reports && installed.cards === true };
  } catch {
    return labelsOff;
  }
}

const installedSql =
  "SELECT to_regprocedure('customer.workspace_saved_missions(uuid,uuid,integer)') IS NOT NULL AS present";
const cardsInstalledSql =
  "SELECT to_regprocedure('customer.workspace_decision_cards(uuid,uuid,integer)') IS NOT NULL AS present";

export const memberBookInput = z
  .object({
    workspaceId: z.uuid(),
    resourceId: z.uuid(),
    commandId: z.uuid(),
    kind: bookKind,
    acknowledged: z.literal(true),
  })
  .strict();

export type MemberAccessWorkspace = {
  workspaceId: string;
  name: string;
  role: 'owner' | 'admin';
  opensAt: string | null;
  open: boolean;
  cards: boolean;
  /** Current members other than this person. The Members' Reports tab shows only where some workspace has one or more. */
  others: number;
};
export type MemberSavedReport = {
  id: string;
  available: boolean;
  title: string | null;
  expiresAt: string | null;
  savedAt: string;
  memberLabel: string | null;
};
export type MemberDecisionCard = {
  id: string;
  resourceId: string;
  decisionId: string;
  state: 'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE';
  createdAt: string;
  expiresAt: string;
  company: string | null;
  decision: string | null;
  memberLabel: string | null;
};

/** The verified reader, as the session boundary passes it once the fresh provider session is checked. */
export type MemberAccessIdentity = { issuer: string; subject: string };
/** Spends the request budget for one read, after the session is verified and before any pool connection is taken. */
export type MemberAccessSpend = (identity: MemberAccessIdentity) => Promise<void>;
/**
 * The two budget keys of one member access read. Both are namespaced to member access and to the verified reader, so no member
 * access call can spend the member's own report budget (`delivery-capability:<resourceId>`, used by remove and respond) or
 * another reader's: one per reader, and one per reader and item (the workspace for a list).
 */
export const memberAccessBudgetKeys = (
  identity: MemberAccessIdentity,
  workspaceId: string,
  item: string,
) =>
  [
    `member-access:${identity.issuer}:${identity.subject}`,
    `member-access:${workspaceId}:${item}:${identity.issuer}:${identity.subject}`,
  ] as const;

const unavailable = () => new DomainError('Members’ reports are unavailable', 503);
const notFound = () => new DomainError('Not found', 404);

// The database refuses with 42501; the gate's own refusal names the closed interval so the page can say "not open yet".
function refusal(error: unknown): never {
  const e = error as { code?: string; message?: string };
  if (e.code === '42501' && e.message === 'MEMBER_ACCESS_NOT_OPEN')
    throw new DomainError('Members’ items are not open in this workspace yet', 403, 'NOT_OPEN');
  if (['42P01', '3F000', '42883'].includes(e.code ?? '')) throw unavailable();
  if (e.code === '54000')
    throw new DomainError(
      'Too many downloads for this mission just now. Try again in a while.',
      429,
    );
  // The session boundary answers 409 when the browser's account differs from the signed-in one: a loss of access.
  if (error instanceof DomainError && error.status === 409)
    throw new DomainError('Access denied or link unavailable', 403);
  throw error;
}

export class CustomerMemberAccessService extends CustomerSessionBoundary {
  private readonly runtimePool: DatabasePool;
  constructor(...args: ConstructorParameters<typeof CustomerSessionBoundary>) {
    super(...args);
    this.runtimePool = args[0];
  }
  /** Installation metadata only: whether part 1 (saved reports) and part 2 (decision cards) exist. Reads no customer data. */
  async installedForLabels(): Promise<{ reports: boolean; cards: boolean }> {
    const row = (
      await this.runtimePool.query<{ reports: boolean; cards: boolean }>(
        `SELECT to_regprocedure('customer.workspace_saved_missions(uuid,uuid,integer)') IS NOT NULL AS reports,
          to_regprocedure('customer.workspace_decision_cards(uuid,uuid,integer)') IS NOT NULL AS cards`,
      )
    ).rows[0];
    return { reports: row?.reports === true, cards: row?.cards === true };
  }
  // Off: not found. In real data mode the report switch that guards the member's own saved reports guards these too.
  private guard(env: NodeJS.ProcessEnv) {
    if (!memberAccessOn(env)) throw notFound();
    this.requireRealReports();
  }
  private async installed(db: DatabaseClient, sql = installedSql) {
    return (await db.query<{ present: boolean }>(sql)).rows[0]?.present === true;
  }

  /** The workspaces this person owns or manages, each with the moment it opens (null: no notice delivered, never open yet). */
  async workspaces(subject?: string, issuer?: string, env: NodeJS.ProcessEnv = process.env) {
    this.guard(env);
    try {
      return await this.transaction(
        async (db) => {
          if (!(await this.installed(db))) throw unavailable();
          const cards = await this.installed(db, cardsInstalledSql);
          const rows = await db.query<{
            id: string;
            name: string;
            role: 'owner' | 'admin';
            opens_at: Date | null;
            others: number;
          }>(
            `SELECT w.id,w.name,w.role,s.opens_at,customer.member_access_others(w.id) AS others
             FROM customer.collaborative_workspaces() w
             LEFT JOIN LATERAL customer.member_notice_state(w.id) s ON true
             WHERE w.role IN ('owner','admin') ORDER BY w.id`,
          );
          const now = Date.now();
          return {
            workspaces: rows.rows.map((row): MemberAccessWorkspace => ({
              workspaceId: row.id,
              name: row.name,
              role: row.role,
              opensAt: row.opens_at ? row.opens_at.toISOString() : null,
              open: !!row.opens_at && row.opens_at.getTime() <= now,
              cards,
              others: row.others,
            })),
          };
        },
        subject,
        issuer,
      );
    } catch (error) {
      refusal(error);
    }
  }

  async savedReports(
    workspaceId: string,
    after: string | null,
    subject?: string,
    issuer?: string,
    env: NodeJS.ProcessEnv = process.env,
    spend?: MemberAccessSpend,
  ) {
    this.guard(env);
    try {
      return await this.transaction(
        async (db) =>
          (
            await db.query(
              'SELECT customer.workspace_saved_missions($1::uuid,$2::uuid,25) AS result',
              [workspaceId, after],
            )
          ).rows[0].result as { missions: MemberSavedReport[]; nextAfter: string | null },
        subject,
        issuer,
        spend,
      );
    } catch (error) {
      refusal(error);
    }
  }

  async report(
    workspaceId: string,
    resourceId: string,
    subject?: string,
    issuer?: string,
    env: NodeJS.ProcessEnv = process.env,
    spend?: MemberAccessSpend,
  ) {
    this.guard(env);
    try {
      return await this.transaction(
        async (db) => {
          const result = (
            await db.query('SELECT customer.workspace_saved_mission($1::uuid,$2::uuid) AS result', [
              workspaceId,
              resourceId,
            ])
          ).rows[0].result as { resourceId: string; memberLabel: string | null; report: unknown };
          const name = (
            await db.query<{ name: string }>(
              'SELECT name FROM customer.collaborative_workspaces() WHERE id=$1::uuid',
              [workspaceId],
            )
          ).rows[0]?.name;
          return { ...result, workspaceId, workspaceName: name ?? null };
        },
        subject,
        issuer,
        spend,
      );
    } catch (error) {
      refusal(error);
    }
  }

  async decisionCards(
    workspaceId: string,
    after: string | null,
    subject?: string,
    issuer?: string,
    env: NodeJS.ProcessEnv = process.env,
    spend?: MemberAccessSpend,
  ) {
    this.guard(env);
    try {
      return await this.transaction(
        async (db) => {
          if (!(await this.installed(db, cardsInstalledSql))) throw unavailable();
          return (
            await db.query(
              'SELECT customer.workspace_decision_cards($1::uuid,$2::uuid,25) AS result',
              [workspaceId, after],
            )
          ).rows[0].result as { cards: MemberDecisionCard[]; nextAfter: string | null };
        },
        subject,
        issuer,
        spend,
      );
    } catch (error) {
      refusal(error);
    }
  }

  async decisionCard(
    workspaceId: string,
    cardId: string,
    subject?: string,
    issuer?: string,
    env: NodeJS.ProcessEnv = process.env,
    spend?: MemberAccessSpend,
  ) {
    this.guard(env);
    try {
      return await this.transaction(
        async (db) => {
          if (!(await this.installed(db, cardsInstalledSql))) throw unavailable();
          return (
            await db.query('SELECT customer.workspace_decision_card($1::uuid,$2::uuid) AS result', [
              workspaceId,
              cardId,
            ])
          ).rows[0].result as {
            cardId: string;
            fields: Record<string, unknown>;
            expiresAt: string;
            memberLabel: string | null;
          };
        },
        subject,
        issuer,
        spend,
      );
    } catch (error) {
      refusal(error);
    }
  }

  /** One book of a member's saved report. The file is made inside the transaction that records it, as for the member's own book. */
  async book<File>(
    input: unknown,
    render: (record: BookRecord) => Promise<File>,
    subject?: string,
    issuer?: string,
    env: NodeJS.ProcessEnv = process.env,
    spend?: MemberAccessSpend,
  ): Promise<{ record: BookRecord; file: File }> {
    this.guard(env);
    const v = memberBookInput.parse(input);
    try {
      return await this.transaction(
        async (db) => {
          const checked = bookResult.safeParse(
            (
              await db.query(
                'SELECT customer.workspace_saved_mission_book($1::uuid,$2::uuid,$3,$4::uuid,$5) AS result',
                [v.workspaceId, v.resourceId, v.kind, v.commandId, v.acknowledged],
              )
            ).rows[0].result,
          );
          if (!checked.success) throw new Error('The book record did not have the agreed shape');
          if ('state' in checked.data)
            throw new DomainError('Nothing has been reviewed for this book yet.', 422, 'EMPTY');
          return { record: checked.data, file: await render(checked.data) };
        },
        subject,
        issuer,
        spend,
      );
    } catch (error) {
      refusal(error);
    }
  }
}
