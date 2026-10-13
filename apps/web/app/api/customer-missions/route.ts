import { DomainError } from '@corridra/domain';
import { publicDeliveryInput } from '@corridra/domain/delivery';
import { neonAuth } from '../../../lib/neon-auth';
import { foundations } from '../../../lib/foundations';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    deliveryEnabled();
    const auth = neonAuth();
    if (!auth) throw new DomainError('Customer account access is unavailable', 503);
    const { data, error } = await auth.getSession({ query: { disableCookieCache: true } });
    if (error) throw new DomainError('Account service is unavailable', 503);
    if (!data?.user) throw new DomainError('Sign in to continue', 401);
    if (!data.user.emailVerified) throw new DomainError('Verify your email to continue', 403);
    const s = foundations();
    if (!s) throw new DomainError('Mission delivery is unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = publicDeliveryInput.parse(
      JSON.parse((await boundedBody(request, 8192)).toString('utf8')),
    );
    if (input.audience !== 'CLIENT_PROGRESS')
      throw new DomainError('A client mission invitation is required', 403);
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.delivery.budget(client, input.token);
    // The verified account enables this interface. Only the supplied expiring capability
    // authorizes a mission; identity/email is never mapped to an operator or tenant.
    return Response.json(await s.delivery.external(input), { headers: deliveryHeaders });
  } catch (e) {
    return deliveryError(e);
  }
}
export function GET() {
  return Response.json(
    { error: 'Open a scoped mission invitation' },
    { status: 405, headers: deliveryHeaders },
  );
}
