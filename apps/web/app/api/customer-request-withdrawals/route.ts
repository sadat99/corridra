import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerRequestsEnabled, requestWithdrawalInput } from '@corridra/auth/customer-requests';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A person sees the requests they withdrew (with the reason they gave, to them only) and can withdraw a request
// they sent or take a withdrawal back. The signed-in session decides who is acting and the database repeats every
// rule: only the owner of the request, one command id per decision, a reason of 10 to 500 characters, and a closed
// control answers "closed" until the owner opens withdrawing. The reason is never logged or echoed in an error.
async function services() {
  if (!customerRequestsEnabled())
    throw new DomainError('Withdrawing a request is unavailable', 503);
  const services = foundations();
  if (!services) throw new DomainError('Withdrawing a request is unavailable', 503);
  await services.ready;
  return services;
}
function failure(error: unknown) {
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError('Withdrawing a request is unavailable', 503));
  if (error instanceof z.ZodError)
    return deliveryError(new DomainError('Check the reason: it needs 10 to 500 characters', 400));
  return deliveryError(error);
}
const subject = (request: Request) =>
  request.headers.get('x-corridra-customer-subject') ?? undefined;
const issuer = (request: Request) => request.headers.get('x-corridra-customer-issuer') ?? undefined;

export async function GET(request: Request) {
  try {
    const s = await services();
    return Response.json(await s.customerRequests.withdrawals(subject(request), issuer(request)), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const value = requestWithdrawalInput.parse(
      JSON.parse((await boundedBody(request, 2000)).toString('utf8')),
    );
    const s = await services();
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed');
    return Response.json(
      await s.customerRequests.setWithdrawal(value, subject(request), issuer(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
