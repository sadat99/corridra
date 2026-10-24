import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerSavedMissionsEnabled } from './customer-saved-missions';
export function customerDecisionsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerSavedMissionsEnabled(env) && env.CORRIDRA_CUSTOMER_DECISIONS_ENABLED === 'true';
}
export class CustomerDecisionService extends CustomerSessionBoundary {
  async read(resourceId: unknown, expectedSubject?: string, expectedIssuer?: string) {
    this.requireRealReports();
    const id = z.uuid().parse(resourceId);
    return this.transaction(
      async (db) =>
        (await db.query('SELECT customer.saved_mission_decisions($1) result', [id])).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
