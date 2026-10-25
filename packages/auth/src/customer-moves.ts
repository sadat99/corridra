import { z } from 'zod';
import type { CustomerMoveList } from '@corridra/domain/moves';
import { CustomerSessionBoundary } from './customer-session';
import { customerRequestsEnabled } from './customer-requests';

// The application switch for Move records. The database control is separate and starts closed; both
// must be on before a customer reads a Move or the Corridra team can set one.
export function customerMovesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerRequestsEnabled(env) && env.CORRIDRA_UX_MOVE_RECORDS === 'true';
}
const pageInput = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

// Server-only: the actual current provider session decides who is acting. A customer can read the open
// Moves of the requests they submitted and nothing else; there is no customer write.
export class CustomerMoveService extends CustomerSessionBoundary {
  async list(
    input: unknown = {},
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerMoveList> {
    const page = pageInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerMoveList }>(
            'SELECT customer.private_request_moves($1,$2) AS result',
            [page.after ?? null, page.pageSize],
          )
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
