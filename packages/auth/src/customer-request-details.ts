import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerRequestsEnabled } from './customer-requests';
export function customerRequestDetailsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerRequestsEnabled(env) && env.CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED === 'true';
}
export class CustomerRequestDetailService extends CustomerSessionBoundary {
  async detail(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    const id = z.uuid().parse(input);
    return this.transaction(
      async (db) => {
        const result = await db.query('SELECT customer.private_request_detail($1) AS result', [id]);
        return result.rows[0].result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }
}
