import { z } from 'zod';
import { customerProductionLocked } from './customer-production';
import { briefSchema } from '@corridra/domain/missions';
import { CustomerSessionBoundary } from './customer-session';

export const customerRequestInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    brief: briefSchema,
  })
  .strict();
const pageInput = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CustomerRequestContext = {
  issuer: string;
  subject: string;
  workspaceId: string;
  commandId: string;
};
export type CustomerRequestPlan = {
  key: string;
  payloadHash: string;
  receiptHash: string;
  noticeVersion: string;
};
export function customerRequestsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.CORRIDRA_CUSTOMER_REQUESTS_ENABLED === 'true' &&
    env.DATA_ENVIRONMENT === 'synthetic' &&
    !customerProductionLocked(env)
  );
}

// Trusted server composition supplies canonical preparation. No browser key,
// receipt, issuer or subject can become positive authority.
export class CustomerRequestService extends CustomerSessionBoundary {
  async list(input: unknown = {}, expectedSubject?: string, expectedIssuer?: string) {
    const page = pageInput.parse(input);
    return this.transaction(
      async (db) => {
        const result = await db.query('SELECT customer.private_requests($1,$2) AS result', [
          page.after ?? null,
          page.pageSize,
        ]);
        return result.rows[0].result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async submit(
    input: unknown,
    prepare: (context: CustomerRequestContext, brief: unknown) => CustomerRequestPlan,
    expectedSubject?: string,
    expectedIssuer?: string,
  ) {
    const value = customerRequestInput.parse(input);
    return this.transaction(
      async (db, proof) => {
        const body = JSON.stringify(value.brief);
        const retry = await db.query('SELECT customer.request_retry($1,$2,$3::jsonb) AS result', [
          value.commandId,
          value.workspaceId,
          body,
        ]);
        if (retry.rows[0].result) return retry.rows[0].result;
        const plan = prepare(
          {
            issuer: proof.issuer,
            subject: proof.subject,
            workspaceId: value.workspaceId,
            commandId: value.commandId,
          },
          value.brief,
        );
        await this.auth.query(
          'SELECT customer_private.attest_request($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',
          [
            proof.hash,
            value.commandId,
            value.workspaceId,
            body,
            plan.key,
            plan.payloadHash,
            plan.receiptHash,
            plan.noticeVersion,
          ],
        );
        const result = await db.query(
          'SELECT customer.submit_private_request($1,$2,$3::jsonb) AS result',
          [value.commandId, value.workspaceId, body],
        );
        return result.rows[0].result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }
}
