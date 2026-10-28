import { z } from 'zod';
import {
  specificationConfirmationInput,
  specificationReviewList,
} from '@corridra/domain/specification-confirmation';
import { CustomerSessionBoundary } from './customer-session';
import { customerSavedMissionsEnabled } from './customer-saved-missions';

export function customerSpecificationConfirmationEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerSavedMissionsEnabled(env) &&
    env.CORRIDRA_CUSTOMER_SPECIFICATION_CONFIRMATION_ENABLED === 'true'
  );
}
export class CustomerSpecificationConfirmationService extends CustomerSessionBoundary {
  async read(resourceId: unknown, subject?: string, issuer?: string) {
    this.requireRealReports();
    const id = z.uuid().parse(resourceId);
    return this.transaction(
      async (db) =>
        specificationReviewList.parse(
          (await db.query('SELECT customer.specification_confirmation_requests($1) result', [id]))
            .rows[0].result,
        ),
      subject,
      issuer,
    );
  }
  async confirm(input: unknown, subject?: string, issuer?: string) {
    this.requireRealReports();
    const v = specificationConfirmationInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.confirm_specification($1,$2,$3,$4,$5,$6,$7) result', [
            v.resourceId,
            v.commandId,
            v.requestId,
            v.requirementId,
            v.requirementVersion,
            v.requirementDigest,
            v.acknowledged,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
