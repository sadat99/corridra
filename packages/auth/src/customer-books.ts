import type { DatabasePool } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { bookInput, bookResult, type BookRecord } from '@corridra/domain/books';
import {
  CustomerSessionBoundary,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from './customer-session';
import { customerSavedMissionsEnabled } from './customer-saved-missions';

// ADR-076: the Trip Book and Supplier Book are off unless the owner sets the switch to exactly 'true' and the
// saved-mission module they read from is on. The database module must also be installed (see installed()).
export function customerBooksEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerSavedMissionsEnabled(env) && env.CORRIDRA_UX_BOOKS === 'true';
}
export class CustomerBookService extends CustomerSessionBoundary {
  constructor(
    private readonly runtimePool: DatabasePool,
    authPool: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
  ) {
    super(runtimePool, authPool, options, readSession);
  }
  // True once the owner's protected install run has added the database function. Reads the catalogue only,
  // through the runtime role that will run it (the authentication role cannot see the customer schema).
  async installed(): Promise<boolean> {
    const result = await this.runtimePool.query(
      "SELECT to_regprocedure('customer.saved_mission_book(uuid,text,uuid,boolean)') IS NOT NULL AS installed",
    );
    return result.rows[0]?.installed === true;
  }
  // The signed-in customer who owns the saved mission, and nobody else, gets one book as a validated projection.
  // A retry with the same command id returns the first record; the file itself is made by the caller.
  async generate(input: unknown, subject?: string, issuer?: string): Promise<BookRecord> {
    this.requireRealReports();
    const v = bookInput.parse(input);
    let result: unknown;
    try {
      result = await this.transaction(
        async (db) =>
          (
            await db.query('SELECT customer.saved_mission_book($1,$2,$3,$4) AS result', [
              v.resourceId,
              v.kind,
              v.commandId,
              v.acknowledged,
            ])
          ).rows[0].result,
        subject,
        issuer,
      );
    } catch (error) {
      if ((error as { code?: string }).code === '54000')
        throw new DomainError(
          'Too many downloads for this mission just now. Try again in a while.',
          429,
        );
      // The session boundary answers 409 when the browser's account differs from the signed-in one. Access that
      // changed is never a content conflict, so it is the same refusal as any other loss of access.
      if (error instanceof DomainError && error.status === 409)
        throw new DomainError('Access denied or link unavailable', 403);
      throw error;
    }
    const parsed = bookResult.parse(result);
    if ('state' in parsed)
      throw new DomainError('Nothing has been reviewed for this book yet.', 422);
    return parsed;
  }
}
