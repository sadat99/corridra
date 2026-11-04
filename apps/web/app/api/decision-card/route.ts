import { DomainError } from '@corridra/domain';
import {
  cardTokenDigest,
  customerDecisionCardsEnabled,
  publicCardRequest,
} from '@corridra/auth/customer-decision-cards';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { ...deliveryHeaders, 'X-Robots-Tag': 'noindex, nofollow' };
// Every answer that is not an open card is this one body. Nothing in it, in its status or in its headers depends
// on why: an unknown, malformed, withdrawn, expired or changed link, a switch that is off, a module not installed.
const unknown = () => Response.json({ state: 'unknown' }, { headers });
const refusal = (error: string, status: number) => Response.json({ error }, { status, headers });
// The public read of one decision card (ADR-076 item 4), for someone without an account. The link secret arrives in
// a POST body (the page takes it from the address fragment), is hashed here, and is never logged or put in a query.
export async function POST(request: Request) {
  try {
    const s = foundations();
    if (!s) return unknown();
    // The transport checks come first and do not depend on the switch, so a request that is not well formed gets the
    // same answer whether the card is switched on or off. Only a well formed request is told "unknown" for a switch.
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      return refusal('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return refusal('JSON required', 415);
    const body = request.body ? await boundedBody(request, 512) : Buffer.alloc(0);
    if (!customerDecisionCardsEnabled()) return unknown();
    await s.ready;
    let digest: string | null = null;
    try {
      const asked = publicCardRequest.safeParse(JSON.parse(body.toString('utf8')));
      if (asked.success) digest = cardTokenDigest(asked.data.token);
    } catch {
      // Not JSON: the same answer as any other link that opens nothing.
    }
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    // Spent before the database is read, for every request alike, so a refusal for rate reveals nothing about a link.
    // A request that is not well formed has no link to count against, so it counts against its own client only; a
    // key shared by everyone would let sixty malformed requests lock every recipient out.
    await s.delivery.budget(
      `decision-card-public:${client}`,
      digest ?? `decision-card-malformed:${client}`,
    );
    return Response.json(await s.decisionCardReader.read(digest), { headers });
  } catch (error) {
    if (error instanceof DomainError)
      return error.status === 429
        ? refusal('Too many requests. Try again in an hour.', 429)
        : refusal(error.message, error.status);
    // Only the error code is logged: never the body, a link secret, its hash or the address.
    console.error(
      JSON.stringify({
        event: 'decision_card_read_failed',
        code: (error as { code?: string }).code,
      }),
    );
    return refusal('This page is unavailable. Try again in a moment.', 503);
  }
}
// A link, a prefetch or a crawler that opens the address with GET or HEAD learns nothing.
export function GET() {
  return Response.json(
    { error: 'Open your private link' },
    { status: 405, headers: { ...headers, Allow: 'POST' } },
  );
}
export const HEAD = GET;
