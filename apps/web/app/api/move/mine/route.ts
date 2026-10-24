import { DomainError } from '@corridra/domain';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { foundations } from '../../../../lib/foundations';
import { deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The open Moves of the requests the signed-in person submitted. Read only: there is no customer write.
async function services() {
  if (!customerMovesEnabled()) throw new DomainError('Moves are unavailable', 503);
  const services = foundations();
  if (!services) throw new DomainError('Moves are unavailable', 503);
  await services.ready;
  return services;
}
function failure(error: unknown) {
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError('Moves are unavailable', 503));
  return deliveryError(error);
}
export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(
      await s.customerMoves.list(
        Object.fromEntries(new URL(request.url).searchParams),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
