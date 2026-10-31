import { DomainError } from '@corridra/domain';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { requestTitle } from '../../account/request-words';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function services() {
  if (!customerRequestsEnabled()) throw new DomainError('Customer requests are unavailable', 503);
  const services = foundations();
  if (!services) throw new DomainError('Customer requests are unavailable', 503);
  await services.ready;
  return services;
}
function failure(error: unknown) {
  if (['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? ''))
    return deliveryError(new DomainError('Customer requests are unavailable', 503));
  return deliveryError(error);
}
/**
 * CQ-23: each saved request gets a plain title ("Sell in Spain") from the brief the same customer
 * wrote. The detail is read through the customer's own detail service under the same session proof;
 * only the derived title is added. A detail that cannot be read leaves the title out, never the row.
 */
async function withTitles(
  s: Awaited<ReturnType<typeof services>>,
  page: unknown,
  subject: string | undefined,
  issuer: string | undefined,
) {
  const value = page as { requests?: { id: string; available?: boolean }[] } | null;
  if (!customerRequestDetailsEnabled() || !value || !Array.isArray(value.requests)) return page;
  const requests = await Promise.all(
    value.requests.map(async (row) => {
      if (row.available !== true) return row;
      try {
        const detail = (await s.customerRequestDetails.detail(row.id, subject, issuer)) as {
          original?: unknown;
        } | null;
        const title = requestTitle(detail?.original);
        return title ? { ...row, title } : row;
      } catch {
        return row;
      }
    }),
  );
  return { ...value, requests };
}
export async function GET(request: Request) {
  try {
    const s = await services();
    const subject = request.headers.get('x-corridra-customer-subject') ?? undefined;
    const issuer = request.headers.get('x-corridra-customer-issuer') ?? undefined;
    const page = await s.customerRequests.list(
      Object.fromEntries(new URL(request.url).searchParams),
      subject,
      issuer,
    );
    return Response.json(await withTitles(s, page, subject, issuer), {
      headers: deliveryHeaders,
    });
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
    // Share the original public intake limits; caller-supplied XFF is not authority.
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const input: unknown = JSON.parse((await boundedBody(request, 20000)).toString('utf8'));
    return Response.json(
      await s.customerRequests.submit(
        input,
        (context, brief) => s.missions.prepareCustomerIntake(context, brief),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
