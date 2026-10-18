import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerSavedMissionsEnabled } from './customer-saved-missions';
export function customerCompaniesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerSavedMissionsEnabled(env) && env.CORRIDRA_CUSTOMER_COMPANIES_ENABLED === 'true';
}
const input = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(5).default(5),
  })
  .strict();
export class CustomerCompanyService extends CustomerSessionBoundary {
  async list(value: unknown = {}, expectedSubject?: string, expectedIssuer?: string) {
    const page = input.parse(value);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.company_portfolio($1,$2) result', [
            page.after ?? null,
            page.pageSize,
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
