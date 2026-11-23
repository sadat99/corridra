import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { invoiceIssuerEnabled } from '@corridra/auth/customer-invoicing-real-issuer';
import { foundations } from '../../../../lib/foundations';
import { boundedBody, deliveryHeaders } from '../../../../lib/delivery-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-091 (unit B8). The data side of the Owner-only Invoice issuer screen. With CORRIDRA_INVOICE_ISSUER off it answers
// 404 before any session or service is touched. Authority is the staff session; the workspace comes from the query and
// is checked by the database, which also repeats the owner role and, for a save, the authenticator check.
function refused(error: unknown) {
  const status =
    error instanceof DomainError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 500;
  // Fixed words only: an unexpected error can quote a row, so its text is never sent.
  const message =
    error instanceof DomainError
      ? error.message
      : status === 400
        ? 'Check the submitted values'
        : 'The request could not be completed. Please try again.';
  const code = error instanceof DomainError ? error.code : undefined;
  return Response.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: deliveryHeaders },
  );
}
async function handle(request: Request) {
  try {
    if (!invoiceIssuerEnabled()) throw new DomainError('Not found', 404);
    const s = foundations();
    if (!s) throw new DomainError('The protected workspace is not configured', 503);
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const ctx = {
      token: identity.token,
      tenantId: z.uuid().parse(new URL(request.url).searchParams.get('tenant')),
      purpose: 'synthetic_validation',
    };
    if (request.method === 'GET')
      return Response.json(await s.invoiceIssuer.view(ctx), { headers: deliveryHeaders });
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input: unknown = JSON.parse((await boundedBody(request, 8192)).toString('utf8'));
    return Response.json(await s.invoiceIssuer.save(ctx, input), { headers: deliveryHeaders });
  } catch (error) {
    return refused(error);
  }
}
export const GET = handle;
export const POST = handle;
