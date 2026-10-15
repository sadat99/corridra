import { foundations } from '../../../../lib/foundations';
import { boundedBody } from '../../../../lib/delivery-http';
import { DomainError } from '@corridra/domain';
export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    const services = foundations();
    if (!services)
      return Response.json({ error: 'Operator sign-in is unavailable' }, { status: 503 });
    await services.ready;
    const recovery =
      request.method === 'POST' &&
      /\/api\/operator-auth\/(request-password-reset|reset-password)$/.test(
        new URL(request.url).pathname,
      );
    if (recovery && request.headers.get('origin') !== new URL(services.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed', 403);
    const input = recovery
      ? new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: (await boundedBody(request, 8192)).toString('utf8'),
        })
      : request;
    const response = await services.handler(input);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) {
    return Response.json(
      { error: error instanceof DomainError ? error.message : 'Operator sign-in is unavailable' },
      {
        status: error instanceof DomainError ? error.status : 503,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
