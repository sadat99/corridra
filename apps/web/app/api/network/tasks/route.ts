import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
async function handle(request: Request) {
  const correlationId = randomUUID();
  try {
    const s = foundations();
    if (!s) throw new DomainError('Task access is unavailable', 503);
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin denied');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in with your authenticator', 401);
    const tenantId = z.uuid().parse(new URL(request.url).searchParams.get('workspace'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    if (request.method === 'GET') return Response.json(await s.network.mine(ctx), { headers });
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError('Request body required', 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 8192) {
        await reader.cancel();
        throw new DomainError('Request exceeds limit', 413);
      }
      chunks.push(chunk.value);
    }
    return Response.json(
      await s.network.event(ctx, JSON.parse(Buffer.concat(chunks).toString('utf8'))),
      { headers },
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    const status =
      e instanceof DomainError
        ? e.status
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? 400
          : code === '42501'
            ? 403
            : ['P0001', '23505', '23514', '23503'].includes(code ?? '')
              ? 409
              : 500;
    return Response.json(
      {
        error:
          e instanceof DomainError
            ? e.message
            : status === 409
              ? 'Task changed or eligibility expired. Refresh before continuing.'
              : status === 400
                ? 'Check the task submission.'
                : 'Task access could not be completed.',
        correlationId,
      },
      { status, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
