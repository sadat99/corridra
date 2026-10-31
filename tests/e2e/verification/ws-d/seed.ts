import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '../../../../packages/db/src/index';

// WS-D seed hook for the verification server (scripts/qa/verification-server.ts). Only WS-D edits
// this file. Write only "QA test (madeup)" records or @example.invalid addresses, and return what the
// WS-D tests need (ids, never secrets other than local test passwords).
//
// Adds one reviewer with an authenticator to the QA workspace, so the owner can prove the
// authenticator reset (V-03) on someone other than themselves.
export async function seed(
  db: DatabasePool,
  base: { tenantId: string; principalId: string },
): Promise<Record<string, unknown>> {
  const client = await db.connect();
  const serviceId = randomUUID(),
    identityId = randomUUID(),
    reviewerId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO identity.principal(id,kind,operating_country) VALUES($1,'service','DE')",
      [serviceId],
    );
    await client.query(
      "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
      [serviceId, randomUUID(), randomUUID()],
    );
    await client.query(
      'INSERT INTO identity."user"(id,name,email,"emailVerified","twoFactorEnabled") VALUES($1,$2,$3,true,true)',
      [identityId, 'QA test (madeup) Reviewer', 'qa-reviewer@example.invalid'],
    );
    await client.query(
      `INSERT INTO identity."twoFactor"(id,"userId",secret,"backupCodes") VALUES($1,$2,'qa-madeup-secret','qa-madeup-codes')`,
      [randomUUID(), identityId],
    );
    await client.query(
      "INSERT INTO identity.principal(id,identity_id,operating_country) VALUES($1,$2,'DE')",
      [reviewerId, identityId],
    );
    await client.query(
      "INSERT INTO app.membership(tenant_id,user_id,role) VALUES($1,$2,'reviewer')",
      [base.tenantId, reviewerId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { reviewerId, reviewerIdentityId: identityId };
}
