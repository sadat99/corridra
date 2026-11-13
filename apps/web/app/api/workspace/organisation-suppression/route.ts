import { deliveryHeaders } from '../../../../lib/delivery-http';
import {
  staffCatalogueBody,
  staffCatalogueDoor,
  staffCatalogueError,
} from '../../../../lib/organisation-catalogue-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff takedown of one organisation: hide it, or show it again (ADR-079 slice B). Link reviewers (trust.verify)
// with a fresh authenticator check. Not behind the customer link switch.
async function handle(request: Request) {
  try {
    const { s, ctx } = await staffCatalogueDoor(request);
    return Response.json(
      await s.staffOrganisationCatalogue.suppress(ctx, await staffCatalogueBody(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return staffCatalogueError(error, 'Organisation takedown is unavailable');
  }
}
export const POST = handle;
