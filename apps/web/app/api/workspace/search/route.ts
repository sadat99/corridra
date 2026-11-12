import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
import { spendPaletteSearch } from '../../../../lib/palette-limit';
import { paletteScopes, searchPalette } from '../../../../lib/palette-search';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The team command palette's search. Staff only: it needs a signed-in session and a workspace the person is
// a member of, and it reads through the same role-checked services as the workspace lists, so it can show
// nothing the person could not already open. GET only; it writes nothing.
export async function GET(request: Request) {
  const correlationId = randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Corridra-Request-ID': correlationId };
  try {
    const s = foundations();
    if (!s)
      return Response.json(
        { error: 'Operator workspace is unavailable' },
        { status: 503, headers },
      );
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const params = new URL(request.url).searchParams;
    const tenantId = z.uuid().parse(params.get('tenant'));
    const q = z
      .string()
      .max(80)
      .parse(params.get('q') ?? '');
    const scope = z.enum(paletteScopes).parse(params.get('scope') ?? 'all');
    // The key is the signed-in person only (from the server-side session): the workspace id is a client-supplied
    // value, so keying on it would let a person start a fresh allowance by changing it.
    // After the session and the input are checked and before any page is read: a person who searches too fast is
    // told to wait, which the palette shows as "try again" and never as an empty result.
    const allowance = spendPaletteSearch(identity.userId ?? identity.token);
    if (!allowance.allowed)
      return Response.json(
        { error: 'Searching is paused for a few seconds. Try again.', correlationId },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': String(allowance.retryAfterSeconds) },
        },
      );
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    return Response.json(await searchPalette(s, ctx, q, scope), { headers });
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (error as { code?: string }).code === '42501'
            ? 403
            : 500;
    if (status === 500)
      console.error(JSON.stringify({ event: 'palette_search_failed', correlationId }));
    return Response.json(
      {
        error:
          status === 400
            ? 'Check the submitted values'
            : status === 500
              ? 'The request could not be completed'
              : error instanceof DomainError
                ? error.message
                : 'Access denied',
        correlationId,
      },
      { status, headers },
    );
  }
}
