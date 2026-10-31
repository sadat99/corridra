import type { DatabasePool } from '@corridra/db';
import {
  CustomerSessionBoundary,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from './customer-session';

// CQ-77 (customer side): the reports published for requests the signed-in customer created, for the
// Library, the room and Your Move. The lister is `listDeliveredPublications` from the delivery package
// (owned by WS-C), injected by the service wiring so this package takes no new dependency. Identity
// comes only from the fresh session proof this boundary writes; nothing the browser sends selects rows.
export type DeliveredReport = {
  id: string;
  title: string;
  requestId: string;
  publishedAt: string;
  href: string;
};
export type DeliveredReportLister = (
  pool: DatabasePool,
  customerProofHash: string,
  customerAccountId: string,
) => Promise<DeliveredReport[]>;

const maxReports = 50;

/** Keeps only well-formed rows with a same-site link, newest first, capped. Pure, so it is unit tested. */
export function cleanReports(rows: unknown): DeliveredReport[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is DeliveredReport =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as DeliveredReport).id === 'string' &&
        typeof (row as DeliveredReport).title === 'string' &&
        (row as DeliveredReport).title.trim().length > 0 &&
        typeof (row as DeliveredReport).requestId === 'string' &&
        typeof (row as DeliveredReport).publishedAt === 'string' &&
        Number.isFinite(Date.parse((row as DeliveredReport).publishedAt)) &&
        typeof (row as DeliveredReport).href === 'string' &&
        (row as DeliveredReport).href.startsWith('/') &&
        !(row as DeliveredReport).href.startsWith('//'),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, maxReports);
}

export class CustomerDeliveredReportService extends CustomerSessionBoundary {
  private pool: DatabasePool;
  constructor(
    runtime: DatabasePool,
    auth: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
    private lister: DeliveredReportLister,
  ) {
    super(runtime, auth, options, readSession);
    this.pool = runtime;
  }

  async list(expectedSubject?: string, expectedIssuer?: string): Promise<DeliveredReport[]> {
    return this.transaction(
      async (_db, proof) => cleanReports(await this.lister(this.pool, proof.hash, proof.subject)),
      expectedSubject,
      expectedIssuer,
    );
  }
}
