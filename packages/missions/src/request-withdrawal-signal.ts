import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';

// The Corridra team's read-only view of a customer's withdrawal (CRUD G1). One mission, two facts: whether the request
// behind it is withdrawn right now and when that was recorded. The customer's reason never leaves the customer's own
// list, and nothing is written. Where the withdrawal module is not installed the answer is simply "not withdrawn".
export type WithdrawalSignal = { withdrawn: boolean; at: string | null };

export class RequestWithdrawalSignalService {
  constructor(private pool: DatabasePool) {}

  read(ctx: RequestContext, missionId: string): Promise<WithdrawalSignal> {
    return withTenant(this.pool, ctx, 'missions.read', async ({ db }) => {
      const installed = await db.query(
        "SELECT to_regprocedure('app.mission_request_withdrawal(uuid)') IS NOT NULL AS present",
      );
      if (!installed.rows[0]?.present) return { withdrawn: false, at: null };
      const {
        rows: [row],
      } = await db.query('SELECT app.mission_request_withdrawal($1) AS signal', [missionId]);
      const value = row?.signal as { withdrawn?: unknown; at?: unknown } | undefined;
      return value?.withdrawn === true && typeof value.at === 'string'
        ? { withdrawn: true, at: new Date(value.at).toISOString() }
        : { withdrawn: false, at: null };
    });
  }
}
