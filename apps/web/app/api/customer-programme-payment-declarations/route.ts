import { DomainError } from '@corridra/domain';
import {
  customerProgrammeEconomicsEnabled,
  paymentDeclareInput,
  paymentDecideInput,
} from '@corridra/auth/customer-programme-economics';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Participant payment declarations. Same switch as the organiser finances: CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED.
async function services() {
  if (!customerProgrammeEconomicsEnabled())
    throw new DomainError('Payment declarations are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Payment declarations are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Payment declarations are unavailable', 503)
      : error,
  );
}
function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
export async function GET(request: Request) {
  try {
    const s = await services();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const view = query.view;
    delete query.view;
    if (view !== 'own' && view !== 'pending')
      throw new DomainError('Unknown declaration view', 400);
    return Response.json(
      view === 'own'
        ? await s.customerProgrammeEconomics.ownPaymentDeclarations(query, ...context(request))
        : await s.customerProgrammeEconomics.pendingPaymentDeclarations(query, ...context(request)),
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
    const body = JSON.parse((await boundedBody(request, 8192)).toString('utf8')) as Record<
      string,
      unknown
    >;
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const { action, ...input } = body;
    if (action === 'declare')
      return Response.json(
        await s.customerProgrammeEconomics.declarePayment(
          paymentDeclareInput.parse(input),
          ...context(request),
        ),
        { headers: deliveryHeaders },
      );
    if (action === 'decide')
      return Response.json(
        await s.customerProgrammeEconomics.decidePayment(
          paymentDecideInput.parse(input),
          ...context(request),
        ),
        { headers: deliveryHeaders },
      );
    throw new DomainError('Unknown declaration action', 400);
  } catch (error) {
    return failure(error);
  }
}
