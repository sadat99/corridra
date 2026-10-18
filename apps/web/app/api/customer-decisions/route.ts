import { DomainError } from '@corridra/domain';
import { customerDecisionsEnabled } from '@corridra/auth/customer-decisions';
import { foundations } from '../../../lib/foundations';
import { deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    if (!customerDecisionsEnabled())
      throw new DomainError('Approved decisions are unavailable', 503);
    const s = foundations();
    if (!s) throw new DomainError('Approved decisions are unavailable', 503);
    await s.ready;
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerDecisions.read(
        new URL(request.url).searchParams.get('resourceId'),
        request.headers.get('x-corridra-customer-subject') ?? undefined,
        request.headers.get('x-corridra-customer-issuer') ?? undefined,
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError('Approved decisions are unavailable', 503)
        : error,
    );
  }
}
