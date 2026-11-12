import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryHeaders } from '../../../lib/delivery-http';
import { customerSearchScopes, searchCustomer } from '../../../lib/customer-search';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The customer search (docs/revamp/specs/navigation-v1/customer-search.md). POST only, so the typed words travel in the
// body and never in an address. It reads through the services the person's own pages use, each under their own
// session, and writes nothing. The words are never logged: a failure logs only the request id.
const body = z
  .object({ q: z.string().max(80), scope: z.enum(customerSearchScopes).default('all') })
  .strict();
const bodyLimit = 8192;

export async function POST(request: Request) {
  const correlationId = randomUUID();
  const answer = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: { ...deliveryHeaders, 'X-Corridra-Request-ID': correlationId },
    });
  try {
    const s = foundations();
    if (!s) return answer({ error: 'Search is not available right now', correlationId }, 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = body.parse(JSON.parse((await boundedBody(request, bodyLimit)).toString('utf8')));
    const result = await searchCustomer(
      {
        requests: s.customerRequests,
        details: s.customerRequestDetails,
        companies: s.customerCompanies,
      },
      {
        requests: customerRequestsEnabled(),
        details: customerRequestDetailsEnabled(),
        companies: customerCompaniesEnabled(),
        provenance: customerProvenanceAllowed,
      },
      {
        subject: request.headers.get('x-corridra-customer-subject') ?? undefined,
        issuer: request.headers.get('x-corridra-customer-issuer') ?? undefined,
        correlationId,
        signal: request.signal,
      },
      input.q,
      input.scope,
    );
    const states = Object.values(result.scopes);
    // Every scope asked for is switched off or missing: the search as a whole is not available.
    if (states.length > 0 && states.every((state) => state === 'unavailable'))
      return answer({ error: 'Search is not available right now', correlationId }, 503);
    return answer(result);
  } catch (error) {
    if (error instanceof DomainError)
      return answer({ error: error.message, code: error.code, correlationId }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return answer({ error: 'Check the submitted values', correlationId }, 400);
    console.error(JSON.stringify({ event: 'customer_search_failed', correlationId }));
    return answer({ error: 'The request could not be completed', correlationId }, 500);
  }
}
