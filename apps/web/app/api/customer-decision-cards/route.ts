import { DomainError } from '@corridra/domain';
import {
  customerDecisionCardsEnabled,
  decisionCardRequest,
} from '@corridra/auth/customer-decision-cards';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const unavailable = 'Decision cards are unavailable';
// The signed-in owner's side of the decision card (ADR-076 item 4): see the cards of a saved report, preview the
// exact fields, make a card and withdraw one. POST only, so no link, prefetch or crawler can start anything.
// The database decides who may share; the route only shapes the request and the refusals.
export async function POST(request: Request) {
  try {
    if (!customerDecisionCardsEnabled()) throw new DomainError(unavailable, 503);
    const s = foundations();
    if (!s) throw new DomainError(unavailable, 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = decisionCardRequest.parse(
      JSON.parse((await boundedBody(request, 2048)).toString('utf8')),
    );
    const subject = request.headers.get('x-corridra-customer-subject') ?? undefined;
    const issuer = request.headers.get('x-corridra-customer-issuer') ?? undefined;
    // Making and withdrawing cards write; reading and previewing do not.
    if (input.action === 'create' || input.action === 'withdraw') {
      const client = process.env.VERCEL
        ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
        : 'local';
      await s.delivery.budget(`decision-card:${client}`, `decision-card-customer:${subject ?? ''}`);
    }
    const value =
      input.action === 'state'
        ? await s.customerDecisionCards.state(input.resourceId, subject, issuer)
        : input.action === 'preview'
          ? await s.customerDecisionCards.preview(
              input.resourceId,
              input.decisionId,
              subject,
              issuer,
            )
          : input.action === 'create'
            ? await s.customerDecisionCards.create(input, subject, issuer)
            : await s.customerDecisionCards.withdraw(input, subject, issuer);
    return Response.json(value, { headers: deliveryHeaders });
  } catch (error) {
    // Two different 409s, so the page can say which: reviewed fields changed, or the report's limit is reached.
    if (
      error instanceof DomainError &&
      error.status === 409 &&
      (error.code === 'CHANGED' || error.code === 'CAP_REACHED')
    )
      return Response.json(
        { error: error.message, reason: error.code },
        { status: 409, headers: deliveryHeaders },
      );
    if (error instanceof DomainError && error.code === 'RETRYABLE')
      return Response.json(
        { error: error.message },
        { status: 503, headers: { ...deliveryHeaders, 'Retry-After': '2' } },
      );
    const code = (error as { code?: string }).code;
    const answer = deliveryError(
      ['42P01', '3F000', '42883'].includes(code ?? '') ? new DomainError(unavailable, 503) : error,
    );
    // Only the error code is logged: never the message, the request or a link.
    if (answer.status >= 500 && answer.status !== 503)
      console.error(JSON.stringify({ event: 'decision_card_failed', code }));
    return answer;
  }
}
