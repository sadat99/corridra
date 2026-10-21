import { DomainError } from '@corridra/domain';
import { customerProgrammePricingEnabled } from '@corridra/auth/customer-programme-pricing';
import { exportCsv, exportFileName } from '@corridra/auth/customer-programme-export-csv';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A server-generated CSV of the caller's own workspace. Owner and admin only, decided in the database, never cached.
export async function POST(request: Request) {
  try {
    if (!customerProgrammePricingEnabled())
      throw new DomainError('Sample exports are unavailable', 503);
    const s = foundations();
    if (!s) throw new DomainError('Sample exports are unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const body: unknown = JSON.parse((await boundedBody(request, 4096)).toString('utf8'));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    const result = await s.customerProgrammePricing.exportRows(
      body,
      request.headers.get('x-corridra-customer-subject') ?? undefined,
      request.headers.get('x-corridra-customer-issuer') ?? undefined,
    );
    return new Response(exportCsv(result.dataset, result.rows), {
      headers: {
        ...deliveryHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + exportFileName(result.dataset) + '"',
      },
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    return deliveryError(
      ['42P01', '3F000', '42883'].includes(code)
        ? new DomainError('Sample exports are unavailable', 503)
        : error,
    );
  }
}
