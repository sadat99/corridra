import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { foundations } from '../../../lib/foundations';
import { memberNoticeOn } from '../../../lib/member-notice';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-087 U4, the member notice. GET: the signed-in person's undismissed notices, one per workspace they are a current member
// of whose notice was delivered. POST {workspaceId}: records their own dismissal; the database re-checks that the verified
// person is a current member of that workspace. Identity comes only from the fresh provider session. With the switch off the
// route is not found; with the module missing GET answers an empty list. It opens no read access.
const dismissInput = z.object({ workspaceId: z.uuid() }).strict();
async function services() {
  if (!memberNoticeOn()) throw new DomainError('Not found', 404);
  if (!customerSavedMissionsEnabled()) throw new DomainError('Member notice is unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Member notice is unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Member notice is unavailable', 503)
      : error,
  );
}
export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(
      await s.customerMemberNotice.list(
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = dismissInput.parse(
      JSON.parse((await boundedBody(request, 1024)).toString('utf8')),
    );
    return Response.json(
      await s.customerMemberNotice.dismiss(
        input.workspaceId,
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
