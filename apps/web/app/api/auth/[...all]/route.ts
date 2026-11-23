import { readNeonAuthConfig } from '@corridra/config';
import { characters, personalTextRefused } from '@corridra/auth/customer-personal-profiles';
import { neonAuth } from '../../../../lib/neon-auth';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const paths = new Set([
  'sign-in/email',
  'sign-in/email-otp',
  'sign-up/email',
  'sign-out',
  'get-session',
  'email-otp/send-verification-otp',
  'email-otp/verify-email',
  'request-password-reset',
  'reset-password',
]);
// Sign in with a code (B1, 23 Nov 2026). The path answers 404 unless CORRIDRA_CUSTOMER_CODE_SIGNIN is 'true'.
// The provider would create an account for an address that has none (better-auth email-otp, sign-in handler),
// and such an account would skip the name and the privacy notice of the sign-up page. So this proxy first asks
// the provider's own check, server side only, and forwards the sign-in only when that check passes, with the
// address and the code and nothing else: a code never creates an account.
// One answer for every refusal (security review, 23 Nov 2026): a wrong code, an expired code, too many tries on
// a code and an address with no account all get the same status and body, so the answer never says whether an
// address has an account. A provider fault or no answer is 503 and a provider rate limit is 429; neither
// depends on the address. One attempt per address runs at a time in this server process, so parallel guesses
// cannot race the provider's try counter here (other server instances are not covered by this).
const codeSignIn = 'sign-in/email-otp';
const codeCheck = 'email-otp/check-verification-otp';
function parsed(body: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null;
function toProvider(request: Request, path: string, body: Record<string, unknown>) {
  const url = new URL(request.url);
  url.pathname = url.pathname.slice(0, url.pathname.length - codeSignIn.length) + path;
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete('content-length');
  forwardHeaders.set('content-type', 'application/json');
  return new Request(url, { method: 'POST', headers: forwardHeaders, body: JSON.stringify(body) });
}
const refused = () =>
  Response.json({ error: 'Sign-in refused', code: 'CODE_REFUSED' }, { status: 400, headers });
const tooMany = () =>
  Response.json(
    { error: 'Too many requests', code: 'TOO_MANY_REQUESTS' },
    { status: 429, headers },
  );
const unavailable = () =>
  Response.json(
    { error: 'Account service is unavailable. Please try again.' },
    { status: 503, headers },
  );
const answered = (response: Response) =>
  response.status === 429
    ? tooMany()
    : response.status >= 400 && response.status < 500 && response.status !== 404
      ? refused()
      : response.ok
        ? null
        : unavailable();
const attempting = new Set<string>();
async function signInByCode(
  request: Request,
  auth: NonNullable<ReturnType<typeof neonAuth>>,
  email: string,
  otp: string,
) {
  const address = email.toLowerCase();
  if (attempting.has(address)) return tooMany();
  attempting.add(address);
  try {
    const check = await auth
      .handler()
      .POST(toProvider(request, codeCheck, { email, type: 'sign-in', otp }), {
        params: Promise.resolve({ path: codeCheck.split('/') }),
      });
    const stopped = answered(check);
    if (stopped) return stopped;
    const response = await auth.handler().POST(toProvider(request, codeSignIn, { email, otp }), {
      params: Promise.resolve({ path: codeSignIn.split('/') }),
    });
    const failed = answered(response);
    if (failed) return failed;
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally {
    attempting.delete(address);
  }
}
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
    const path = all.join('/');
    if (
      !paths.has(path) ||
      (path === codeSignIn &&
        (request.method !== 'POST' || process.env.CORRIDRA_CUSTOMER_CODE_SIGNIN !== 'true'))
    )
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
      const body = Buffer.concat(chunks);
      forwarded = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
      if (path === 'sign-up/email') {
        // D-028: the same name rule as the account name route (1 to 100 characters, no control characters).
        const name = parsed(body)?.name;
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed || characters(trimmed) > 100 || personalTextRefused.test(trimmed))
          return Response.json(
            { error: 'Name is not valid', code: 'INVALID_NAME' },
            { status: 400, headers },
          );
      }
      if (path === codeSignIn) {
        const input = parsed(body);
        const email = text(input?.email, 254);
        const otp = text(input?.otp, 12);
        if (!email || !otp)
          return Response.json({ error: 'Request is not valid' }, { status: 400, headers });
        return await signInByCode(request, auth, email, otp);
      }
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
