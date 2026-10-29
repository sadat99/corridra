import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import {
  specificationOptions,
  specificationRequestInput,
} from '@corridra/domain/specification-confirmation';

// The existing owner/admin publication and MFA authority applies in SQL, including after waits.
export class SpecificationConfirmationService {
  constructor(private pool: DatabasePool) {}
  async installed(): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT to_regprocedure('customer.specification_confirmation_requests(uuid)') IS NOT NULL AND to_regprocedure('app.specification_confirmation_options(uuid)') IS NOT NULL AS installed",
    );
    return result.rows[0]?.installed === true;
  }
  options(ctx: RequestContext, publicationId: unknown) {
    const id = z.uuid().parse(publicationId);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db }) =>
      specificationOptions.parse(
        (await db.query('SELECT app.specification_confirmation_options($1) result', [id])).rows[0]
          .result,
      ),
    );
  }
  request(ctx: RequestContext, input: unknown) {
    const v = specificationRequestInput.parse(input);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (
          await db.query(
            'SELECT app.request_specification_confirmation($1,$2,$3,$4,$5,$6,$7) result',
            [
              v.commandId,
              v.publicationId,
              v.requirementId,
              v.requirementVersion,
              v.requirementDigest,
              v.ownerId,
              v.dueAt,
            ],
          )
        ).rows[0].result,
    );
  }
}
