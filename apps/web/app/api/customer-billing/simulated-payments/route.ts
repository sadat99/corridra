import { DomainError } from '@corridra/domain';
import {
  customerSimulatedPaymentsEnabled,
  simulatedPaymentsOffMessage,
} from '@corridra/auth/customer-payments-simulated';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ADR-065: the simulated payment provider "Corridra Pay (madeup)". No money moves and no invoice changes.
async function services() {
  if (!customerSimulatedPaymentsEnabled()) throw new DomainError(simulatedPaymentsOffMessage, 503);
  const s = foundations();
  if (!s) throw new DomainError(simulatedPaymentsOffMessage, 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  const code = (error as { code?: string }).code ?? '';
  return deliveryError(
    code === '55000' || ['42P01', '3F000', '42883'].includes(code)
      ? new DomainError(simulatedPaymentsOffMessage, 503)
      : error,
  );
}
function context(request: Request) {
  return [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
}
// Read: ?workspaceId=...
export async function GET(request: Request) {
  try {
    const s = await services();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(await s.customerSimulatedPayments.overview(query, ...context(request)), {
      headers: deliveryHeaders,
    });
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
    return Response.json(await s.customerSimulatedPayments.command(input, ...context(request)), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}
