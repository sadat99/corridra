import type { DatabasePool } from '../../../../packages/db/src/index';

// WS-C seed hook for the verification server (scripts/qa/verification-server.ts). Only WS-C edits
// this file. Write only "QA test (madeup)" records or @example.invalid addresses, and return what the
// WS-C tests need (ids, never secrets other than local test passwords).
export async function seed(
  _db: DatabasePool,
  _base: { tenantId: string; principalId: string },
): Promise<Record<string, unknown>> {
  void _db;
  void _base;
  return {};
}
