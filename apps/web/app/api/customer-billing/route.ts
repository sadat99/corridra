import { DomainError } from '@corridra/domain';
import {
  customerBillingCommandInput,
  customerBillingEnabled,
} from '@corridra/auth/customer-billing';
import { customerInvoicingEnabled } from '@corridra/auth/customer-invoicing';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function services() {
  if (!customerBillingEnabled()) throw new DomainError('Plans are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Plans are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Plans are unavailable', 503)
      : error,
  );
}
function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
// Sample invoices are read-only for customers and have their own switch on top of the billing switch.
async function invoices(
  s: Awaited<ReturnType<typeof services>>,
  query: Record<string, string>,
  who: readonly [string | undefined, string | undefined],
) {
  if (!customerInvoicingEnabled()) throw new DomainError('Plans are unavailable', 503);
  return s.customerInvoicing.overview(query, ...who);
}
// Reads: ?scope=overview|plans|invoices&workspaceId=...
export async function GET(request: Request) {
  try {
    const s = await services(),
      { scope, ...query } = Object.fromEntries(new URL(request.url).searchParams);
    const body =
      scope === 'plans'
        ? await s.customerBilling.plans(query, ...context(request))
        : scope === 'invoices'
          ? await invoices(s, query, context(request))
          : scope === 'overview' || scope === undefined
            ? await s.customerBilling.overview(query, ...context(request))
            : null;
    if (body === null) throw new DomainError('Unknown scope', 400);
    return Response.json(body, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
// Every change is a same-origin JSON POST naming one command id.
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerBilling.command(
        customerBillingCommandInput.parse(input),
        ...context(request),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
