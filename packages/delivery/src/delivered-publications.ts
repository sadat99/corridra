import type { DatabasePool } from '@corridra/db';

// listDeliveredPublications (commercial readiness program, 5.2, CQ-77). Returns approved publications
// for requests the signed-in customer created, so the customer Library, room and Your Move can show
// them. Wave 0 returns an empty list; WS-C implements it on the existing reviewed delivery records,
// scoped by the customer proof (never by an id the browser sends). Owner after Wave 0: WS-C.
export type DeliveredPublication = {
  id: string;
  title: string;
  requestId: string;
  publishedAt: string;
  href: string;
};

export async function listDeliveredPublications(
  _pool: DatabasePool,
  _customerProofHash: string,
  _customerAccountId: string,
): Promise<DeliveredPublication[]> {
  void _pool;
  void _customerProofHash;
  void _customerAccountId;
  return [];
}
