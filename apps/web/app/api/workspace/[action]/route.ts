import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const correlationId = randomUUID();
  try {
    const s = foundations();
    if (!s)
      return Response.json(
        { error: 'Operator workspace is unavailable' },
        { status: 503, headers },
      );
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const { action } = await params;
    if (action === 'tenants' && request.method === 'GET')
      return Response.json(await s.access.tenants(identity.token), { headers });
    const tenantId = z.uuid().parse(new URL(request.url).searchParams.get('tenant'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    if (request.method === 'GET') {
      const read = {
        workspace: async () => ({
          ...(await s.evidence.workspace(ctx)),
          uploadsConfigured: s.uploadsConfigured,
          scanMode: s.scanMode,
        }),
        members: () => s.access.members(ctx),
        audit: () => s.access.audit(ctx),
        config: () => s.access.config(ctx),
      };
      if (action === 'download') {
        const e = await s.evidence.download(
          ctx,
          z.uuid().parse(new URL(request.url).searchParams.get('id')),
        );
        return new Response(Buffer.from(e.body), {
          headers: {
            ...headers,
            'Content-Type': e.mime,
            'Content-Disposition': 'attachment; filename="evidence"',
            'X-Content-Type-Options': 'nosniff',
            'X-Corridra-Malware-Scan': e.scanStatus,
          },
        });
      }
      if (!Object.hasOwn(read, action)) throw new DomainError('Not found', 404);
      return Response.json(await read[action as keyof typeof read](), { headers });
    }
    const flags = await s.access.config(ctx);
    const enabled = (key: string) => flags.some((f) => f.key === key && f.value.enabled === true);
    if (action === 'upload') {
      if (!enabled('evidence.uploads') || !s.uploadsConfigured)
        throw new DomainError('Uploads are not enabled', 409);
      // Bounded streaming avoids trusting a client-supplied Content-Length.
      const reader = request.body?.getReader();
      if (!reader) throw new DomainError('File required', 400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4194304) {
          await reader.cancel();
          throw new DomainError('File exceeds 4 MiB', 413);
        }
        chunks.push(value);
      }
      const claimId = z.uuid().parse(new URL(request.url).searchParams.get('claim'));
      return Response.json(
        await s.evidence.upload(
          ctx,
          claimId,
          Buffer.concat(chunks),
          request.headers.get('content-type') ?? '',
        ),
        { status: 201, headers },
      );
    }
    const stream = request.body?.getReader();
    if (!stream) throw new DomainError('Request body required', 400);
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 8192) {
        await stream.cancel();
        throw new DomainError('Request is too large', 413);
      }
      parts.push(chunk.value);
    }
    const text = Buffer.concat(parts).toString('utf8');
    const input: unknown = JSON.parse(text);
    const writes = {
      source: () => s.evidence.createSource(ctx, input),
      claim: () => s.evidence.createClaim(ctx, input),
      member: () => s.access.changeMember(ctx, input),
      config: () => s.access.appendConfig(ctx, input),
      scan: () => s.evidence.scan(ctx, z.object({ id: z.uuid() }).parse(input).id),
      verify: () => {
        if (!enabled('evidence.verification'))
          throw new DomainError('Verification is not enabled', 409);
        const v = z
          .object({
            id: z.uuid(),
            decision: z.enum(['VERIFIED', 'REJECTED']),
            method: z.string(),
            scope: z.string(),
            validUntil: z.iso.datetime({ offset: true }),
          })
          .parse(input);
        return s.evidence.verify(ctx, v.id, v);
      },
    };
    if (!Object.hasOwn(writes, action)) throw new DomainError('Not found', 404);
    return Response.json(await writes[action as keyof typeof writes](), { status: 201, headers });
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400
          ? 'Check the submitted values'
          : 'The request could not be completed';
    if (status === 500)
      console.error(JSON.stringify({ event: 'foundation_request_failed', correlationId }));
    return Response.json({ error: message, correlationId }, { status, headers });
  }
}
export const GET = handle;
export const POST = handle;
