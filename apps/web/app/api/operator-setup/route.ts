import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../lib/foundations';
import { neonAuth } from '../../../lib/neon-auth';
import { boundedBody } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  const kind =
    new URL(request.url).searchParams.get('kind') === 'contributor' ? 'contributor' : 'operator';
  const label = kind === 'contributor' ? 'Contributor' : 'Operator';
  try {
    const services = foundations(),
      customer = neonAuth();
    if (!services || !customer)
      throw new DomainError(`${label} invitation setup is unavailable in this environment.`, 503);
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(services.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed.', 403);
    await services.ready;
    const { data, error } = await customer.getSession({ query: { disableCookieCache: true } });
    if (error || !data?.user)
      throw new DomainError('Sign in to your customer account to check an invitation.', 401);
    if (!data.user.emailVerified)
      throw new DomainError(
        `Verify your customer account email before accepting ${kind === 'operator' ? 'an operator' : 'a contributor'} invitation.`,
        403,
      );
    const proof = { email: data.user.email, emailVerified: true };
    return Response.json(
      request.method === 'GET'
        ? await services.operatorSetup.status(proof)
        : await services.operatorSetup.complete(
            proof,
            JSON.parse((await boundedBody(request, 2048)).toString('utf8')),
          ),
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    return Response.json(
      {
        error:
          error instanceof DomainError
            ? error.message
            : status === 400
              ? `Use ${kind === 'operator' ? 'an operator' : 'a contributor'} password between 14 and 128 characters.`
              : `${label} invitation setup is temporarily unavailable.`,
      },
      { status, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
