import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { foundations } from '../../../lib/foundations';
import { customerIdentity } from '../../../lib/customer-page-session';
import { boundedBody, deliveryHeaders } from '../../../lib/delivery-http';
import {
  customerSearchScopes,
  errorFacts,
  failedScope,
  searchCustomer,
  spendPersonSearch,
  takeSearchSlot,
  worthSearching,
} from '../../../lib/customer-search';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The customer search (docs/revamp/specs/navigation-v1/customer-search.md). POST only, so the typed words travel in the
// body and never in an address. It reads through the services the person's own pages use, each under their own
// session, and writes no search data (the session boundary writes its short session proof rows, as for every customer read). The words are never logged: a failure logs only the request id.
const body = z
  .object({ q: z.string().max(80), scope: z.enum(customerSearchScopes).default('all') })
  .strict();
const bodyLimit = 8192;
// The only refusals whose own words may reach the person. Any other status is the generic failure below.
const shownStatuses = [400, 401, 403, 409, 413, 415, 503];

/** The signed-in person as one key (issuer and subject from the provider session), or null when nobody is. Never throws. */
async function signedInPerson() {
  try {
    const identity = await customerIdentity();
    return identity ? `${identity.issuer}\n${identity.subject}` : null;
  } catch {
    return null;
  }
}

/** The client the Companies budget counts, derived exactly as the Companies route derives it. */
const budgetClient = (request: Request) =>
  process.env.VERCEL
    ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
    : 'local';

export async function POST(request: Request) {
  const correlationId = randomUUID();
  const answer = (value: unknown, status = 200, more: Record<string, string> = {}) =>
    Response.json(value, {
      status,
      headers: { ...deliveryHeaders, 'X-Corridra-Request-ID': correlationId, ...more },
    });
  let release: (() => void) | null = null;
  try {
    const s = foundations();
    if (!s) return answer({ error: 'Search is not available right now', correlationId }, 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = body.parse(JSON.parse((await boundedBody(request, bodyLimit)).toString('utf8')));
    // Words that are not worth reading for read nothing, cost nothing and spend no allowance.
    if (!worthSearching(input.q)) return answer({ hits: [], scopes: {} });
    // Who is asking is read first, from the provider session on the server, never from the body, the identity headers the
    // browser sends (those can only make the session boundary refuse) or an address. Nobody signed in, or a provider that
    // does not answer, is a 401 here: no slot is held and no service is read, so an anonymous request costs one identity
    // read and cannot crowd out the people who are signed in.
    const person = await signedInPerson();
    if (!person) return answer({ error: 'Sign in to continue', correlationId }, 401);
    // Then the person's own allowance, keyed on that verified person alone: a workspace, a request id or a header the
    // browser can change would otherwise start a fresh one. Before the slot and before any service call.
    const allowance = spendPersonSearch(person);
    if (!allowance.allowed)
      return answer({ error: 'Too many searches, try again in a moment', correlationId }, 429, {
        'Retry-After': String(allowance.retryAfterSeconds),
      });
    // Only now a slot: past this point a search costs remote identity checks and held connections, so the process runs
    // only a few at once and tells the rest to come back in a moment.
    release = takeSearchSlot();
    if (!release)
      return answer({ error: 'Search is busy, try again in a moment', correlationId }, 503, {
        'Retry-After': '2',
      });
    const result = await searchCustomer(
      {
        requests: s.customerRequests,
        details: s.customerRequestDetails,
        companies: s.customerCompanies,
        // The budget the Companies route spends before a portfolio page, spent here once per search that reaches Companies.
        companyBudget: (client) => s.missions.budget(client),
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
        client: budgetClient(request),
        signal: request.signal,
      },
      input.q,
      input.scope,
    );
    const states = Object.values(result.scopes);
    // Every scope asked for is switched off or missing: the search as a whole is not available.
    if (states.length > 0 && states.every((state) => state === 'unavailable'))
      return answer({ error: 'Search is not available right now', correlationId }, 503);
    // Every scope asked for was refused by the Companies budget: the same 429 the Companies route answers with.
    if (states.length > 0 && states.every((state) => state === 'limited'))
      return answer(
        { error: 'Too many requests. Try again later.', code: 'scope_limited', correlationId },
        429,
      );
    return answer(result);
  } catch (error) {
    if (error instanceof DomainError && shownStatuses.includes(error.status))
      return answer({ error: error.message, code: error.code, correlationId }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return answer({ error: 'Check the submitted values', correlationId }, 400);
    console.error(
      JSON.stringify({
        event: 'customer_search_failed',
        scope: failedScope(error),
        correlationId,
        ...errorFacts(error),
      }),
    );
    return answer({ error: 'The request could not be completed', correlationId }, 500);
  } finally {
    release?.();
  }
}
