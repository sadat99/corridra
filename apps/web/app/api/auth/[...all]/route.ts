import { readNeonAuthConfig } from '@corridra/config';
import { neonAuth } from '../../../../lib/neon-auth';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const paths = new Set([
  'sign-in/email',
  'sign-up/email',
  'sign-out',
  'get-session',
  'email-otp/send-verification-otp',
  'email-otp/verify-email',
  'request-password-reset',
  'reset-password',
]);
async function handle(request: Request, context: { params: Promise<{ all: string[] }> }) {
  try {
    const config = readNeonAuthConfig();
    const auth = neonAuth();
    if (!config || !auth)
      return Response.json(
        { error: 'Account sign-in is not available yet' },
        { status: 503, headers },
      );
    const all = (await context.params).all;
    if (!paths.has(all.join('/')))
      return Response.json({ error: 'Not found' }, { status: 404, headers });
    if (request.method !== 'GET' && request.headers.get('origin') !== config.APP_ORIGIN)
      return Response.json({ error: 'Request origin is not allowed' }, { status: 403, headers });
    let forwarded = request;
    if (request.method !== 'GET') {
      const reader = request.body?.getReader();
      if (!reader)
        return Response.json({ error: 'Request body required' }, { status: 400, headers });
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 16384) {
          await reader.cancel();
          return Response.json({ error: 'Request is too large' }, { status: 413, headers });
        }
        chunks.push(chunk.value);
      }
      forwarded = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
    }
    const response = await auth
      .handler()
      [request.method as 'GET' | 'POST'](forwarded, { params: Promise.resolve({ path: all }) });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return Response.json(
      { error: 'Account service is unavailable. Please try again.' },
      { status: 503, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
