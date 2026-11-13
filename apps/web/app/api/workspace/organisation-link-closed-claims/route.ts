import { z } from 'zod';
import { deliveryHeaders } from '../../../../lib/delivery-http';
import {
  staffCatalogueDoor,
  staffCatalogueError,
} from '../../../../lib/organisation-catalogue-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff lookup of the closed company link claims of one workspace: ids, states and times, no text, so a
// redaction can name the claim while the customer link switch is off (ADR-079 slice B). Owner or admin link reviewers
// (trust.verify) with a fresh authenticator check.
async function handle(request: Request) {
  try {
    const { s, ctx, query } = await staffCatalogueDoor(request);
    return Response.json(
      await s.staffOrganisationCatalogue.closedClaims(ctx, z.uuid().parse(query.get('workspace'))),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return staffCatalogueError(error, 'Company link lookup is unavailable');
  }
}
export const GET = handle;
