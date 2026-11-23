import { DomainError } from '@corridra/domain';
import {
  outreachEventFrom,
  outreachWebhookSecret,
  verifyOutreachWebhook,
} from '@corridra/communications/real-outreach';
import { foundations } from '../../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ADR-090. Two public entries for the real email lane. Only POST records anything, so opening a link never changes
// anything: a GET of the opt-out address only sends the reader to the page with the Stop These Emails button.
//  unsubscribe: the opt-out of one message, by its own private token. It is honoured with every switch off. Mail
//    providers call it without a browser (one-click), so there is no origin check; the token is the authority.
//  webhook: signed bounce, complaint and delivery notices from the mail provider. Refused when the signing secret is
//    not set. Nothing from a notice is logged, and no address is kept.
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
async function readCapped(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new DomainError('Request is too large', 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
/** The one-click address opened in a browser: show the opt-out page. The token moves to the fragment; nothing is recorded. */
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if ((await params).action !== 'unsubscribe' || !/^[a-f0-9]{64}$/.test(token))
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  return new Response(null, {
    status: 303,
    headers: { ...headers, Location: `/buyer?stop=1#${token}` },
  });
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    const s = foundations();
    if (!s) throw new DomainError('This service is unavailable', 503);
    await s.ready;
    if (action === 'unsubscribe') {
      const body = await readCapped(request, 2048);
      let token = new URL(request.url).searchParams.get('t') ?? '';
      if (!token && request.headers.get('content-type')?.startsWith('application/json')) {
        const parsed: unknown = JSON.parse(body);
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof (parsed as { t?: unknown }).t === 'string'
        )
          token = (parsed as { t: string }).t;
      }
      if (!/^[a-f0-9]{64}$/.test(token)) throw new DomainError('Not found', 404);
      const client = process.env.VERCEL
        ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
        : 'local';
      await s.communications.optOutBudget(client, token);
      if (!(await s.communications.unsubscribe(token))) throw new DomainError('Not found', 404);
      return Response.json({ stopped: true }, { headers });
    }
    if (action === 'webhook') {
      const secret = outreachWebhookSecret();
      if (!secret) throw new DomainError('This service is unavailable', 503);
      const body = await readCapped(request, 65536);
      if (!verifyOutreachWebhook(secret, request.headers, body))
        throw new DomainError('Not allowed', 401);
      const event = outreachEventFrom(JSON.parse(body));
      const recorded = event
        ? await s.communications.providerEvent(request.headers.get('svix-id') ?? '', event)
        : false;
      return Response.json({ recorded }, { headers });
    }
    throw new DomainError('Not found', 404);
  } catch (e) {
    const status = e instanceof DomainError ? e.status : e instanceof SyntaxError ? 400 : 500;
    // Only the kind of failure is logged: never a token, an address or a notice.
    if (status === 500) console.error(JSON.stringify({ event: 'outreach_route_failed' }));
    return Response.json(
      { error: e instanceof DomainError ? e.message : 'This did not go through' },
      { status, headers },
    );
  }
}
