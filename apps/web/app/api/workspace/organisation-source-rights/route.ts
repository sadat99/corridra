import { z } from 'zod';
import { deliveryHeaders } from '../../../../lib/delivery-http';
import {
  staffCatalogueBody,
  staffCatalogueDoor,
  staffCatalogueError,
} from '../../../../lib/organisation-catalogue-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Protected staff read and adjustment of the source rights note of one organisation (ADR-079 slice B). Ingest roles only
// (research.manage). Not behind the customer link switch.
async function handle(request: Request) {
  try {
    const { s, ctx, query } = await staffCatalogueDoor(request);
    if (request.method === 'GET')
      return Response.json(
        await s.staffOrganisationCatalogue.readRights(
          ctx,
          z.uuid().parse(query.get('organisation')),
        ),
        { headers: deliveryHeaders },
      );
    return Response.json(
      await s.staffOrganisationCatalogue.adjustRights(ctx, await staffCatalogueBody(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return staffCatalogueError(error, 'Organisation source rights are unavailable');
  }
}
export const GET = handle;
export const POST = handle;
