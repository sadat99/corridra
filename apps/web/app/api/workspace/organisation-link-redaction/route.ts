import { deliveryHeaders } from '../../../../lib/delivery-http';
import {
  staffCatalogueBody,
  staffCatalogueDoor,
  staffCatalogueError,
} from '../../../../lib/organisation-catalogue-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff redaction of the customer text of one closed company link claim (ADR-079 slice B). Owner or admin
// link reviewers (trust.verify) with a fresh authenticator check; the claim id is typed twice. Irreversible. Not behind
// the customer link switch.
async function handle(request: Request) {
  try {
    const { s, ctx } = await staffCatalogueDoor(request);
    return Response.json(
      await s.staffOrganisationCatalogue.redact(ctx, await staffCatalogueBody(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return staffCatalogueError(error, 'Company link redaction is unavailable');
  }
}
export const POST = handle;
