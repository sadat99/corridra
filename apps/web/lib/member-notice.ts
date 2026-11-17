// ADR-087 U4, the member notice, server side. Reads each workspace's notice state for the signed-in person and records their
// own dismissal, only through the member notice module's two customer functions (customer.member_notice_state and
// customer.member_notice_dismiss), inside a fresh verified customer transaction. Off unless CORRIDRA_MEMBER_NOTICE is exactly
// "true" (separate from any U5 switch). With the switch off or the module not installed it answers an empty list and never an
// error, so nothing renders. It opens no read access.
import { CustomerSessionBoundary } from '@corridra/auth/customer-session';
import { DomainError } from '@corridra/domain';
import { uxSwitchOn } from './ux-switches';
import type { MemberNotice } from './member-notice-words';

export const memberNoticeOn = (env: NodeJS.ProcessEnv = process.env) =>
  uxSwitchOn('CORRIDRA_MEMBER_NOTICE', env);

const installedSql =
  "SELECT to_regprocedure('customer.member_notice_state(uuid)') IS NOT NULL AS present";

export class CustomerMemberNoticeService extends CustomerSessionBoundary {
  /** The notices this person has not dismissed, one per workspace they are a current member of and that was delivered. */
  async list(subject?: string, issuer?: string, env: NodeJS.ProcessEnv = process.env) {
    if (!memberNoticeOn(env)) return { notices: [] as MemberNotice[] };
    return this.transaction(
      async (db) => {
        if (!(await db.query<{ present: boolean }>(installedSql)).rows[0]?.present)
          return { notices: [] as MemberNotice[] };
        const rows = await db.query<{
          id: string;
          name: string;
          delivered_at: Date;
          opens_at: Date;
          dismissed: boolean;
        }>(
          `SELECT w.id,w.name,s.delivered_at,s.opens_at,s.dismissed
           FROM customer.collaborative_workspaces() w, LATERAL customer.member_notice_state(w.id) s
           ORDER BY s.delivered_at,w.id`,
        );
        return {
          notices: rows.rows
            .filter((row) => !row.dismissed)
            .map((row) => ({
              workspaceId: row.id,
              workspaceName: row.name,
              deliveredAt: row.delivered_at.toISOString(),
              opensAt: row.opens_at.toISOString(),
            })),
        };
      },
      subject,
      issuer,
    );
  }
  /** Records this person's own dismissal for one workspace. Refused unless they are a current member and it was delivered. */
  async dismiss(
    workspaceId: string,
    subject?: string,
    issuer?: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    if (!memberNoticeOn(env)) throw new DomainError('Member notice is unavailable', 503);
    return this.transaction(
      async (db) => {
        if (!(await db.query<{ present: boolean }>(installedSql)).rows[0]?.present)
          throw new DomainError('Member notice is unavailable', 503);
        await db.query('SELECT customer.member_notice_dismiss($1::uuid)', [workspaceId]);
        return { dismissed: true };
      },
      subject,
      issuer,
    );
  }
}
