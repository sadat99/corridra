import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { founderActivation } from '@corridra/auth/founder-activation';
import { queueFilters } from '@corridra/missions';
import { foundations } from '../../../../lib/foundations';
import { communicationOrchestrator } from '../../../../lib/communication-orchestrator';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
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
        'ai-sources': () =>
          s.intelligence.sources(ctx, z.uuid().parse(new URL(request.url).searchParams.get('run'))),
        intelligence: () => s.intelligence.workspace(ctx),
        network: () => s.network.workspace(ctx),
        'network-invitations': () =>
          s.networkInvitations.list(ctx, new URL(request.url).searchParams.get('after')),
        'mission-catalogue': () => s.corridors.catalogue(ctx),
        'founder-activation': async () => ({
          ...(await s.operations.founderAccess(ctx)),
          ...founderActivation(),
        }),
        'operations-controls': () => s.operations.controlCenter(ctx),
        'operations-health': () => s.operations.reliability(ctx),
        'operations-dashboard': () =>
          s.operations.dashboard(
            ctx,
            Object.fromEntries(
              [...new URL(request.url).searchParams].filter(([key]) => key !== 'tenant'),
            ),
          ),
        'commercial-mission': () =>
          s.commercialMissions.workspace(
            ctx,
            z.uuid().parse(new URL(request.url).searchParams.get('mission')),
          ),
        'commercial-records': () =>
          s.opportunities.records(
            ctx,
            z.uuid().parse(new URL(request.url).searchParams.get('id')),
            z.coerce
              .number()
              .int()
              .min(0)
              .max(100000)
              .parse(new URL(request.url).searchParams.get('offset') ?? 0),
          ),
        opportunities: () =>
          s.opportunities.workspace(
            ctx,
            z
              .uuid()
              .optional()
              .parse(new URL(request.url).searchParams.get('mission') ?? undefined),
            z.coerce
              .number()
              .int()
              .min(0)
              .max(100000)
              .parse(new URL(request.url).searchParams.get('offset') ?? 0),
          ),
        communications: () => s.communications.workspace(ctx),
        meetings: () => s.meetings.workspace(ctx),
        research: () =>
          s.counterparties.catalogue(ctx, Object.fromEntries(new URL(request.url).searchParams)),
        counterparty: () =>
          s.counterparties.detail(ctx, z.uuid().parse(new URL(request.url).searchParams.get('id'))),
        shortlist: () =>
          s.counterparties.shortlist(
            ctx,
            z.uuid().parse(new URL(request.url).searchParams.get('mission')),
            z.coerce
              .number()
              .int()
              .min(0)
              .max(100000)
              .parse(new URL(request.url).searchParams.get('offset') ?? 0),
          ),
        missions: () => {
          const query = new URL(request.url).searchParams;
          return s.missions.queue(
            ctx,
            z.enum(['all', 'open', 'overdue']).parse(query.get('filter') ?? 'all'),
            z.coerce
              .number()
              .int()
              .min(0)
              .max(100000)
              .parse(query.get('offset') ?? 0),
            queueFilters.parse({
              owner: query.get('owner') || undefined,
              stage: query.get('stage') || undefined,
              route: query.get('route') || undefined,
              job: query.get('job') || undefined,
            }),
          );
        },
        workspace: async () => ({
          ...(await s.evidence.workspace(ctx)),
          uploadsConfigured: s.uploadsConfigured,
          scanMode: s.scanMode,
        }),
        members: () => s.access.members(ctx),
        audit: () => s.access.audit(ctx),
        config: () => s.access.config(ctx),
      };
      if (action === 'shortlist-export') {
        const list = await s.counterparties.shortlist(
          ctx,
          z.uuid().parse(new URL(request.url).searchParams.get('mission')),
          z.coerce
            .number()
            .int()
            .min(0)
            .max(100000)
            .parse(new URL(request.url).searchParams.get('offset') ?? 0),
        );
        return Response.json(list, {
          headers: {
            ...headers,
            'Content-Disposition': 'attachment; filename="shortlist-page.json"',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
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
      if (size > (['commercial-mission', 'ai-review'].includes(action) ? 32768 : 8192)) {
        await stream.cancel();
        throw new DomainError('Request is too large', 413);
      }
      parts.push(chunk.value);
    }
    const text = Buffer.concat(parts).toString('utf8');
    const input: unknown = JSON.parse(text);
    const writes = {
      operations: () => s.operations.command(ctx, input),
      'operations-preview': () => s.operations.preview(ctx, input),
      'ai-rights': () => s.intelligence.rights(ctx, input),
      'network-rule': () => s.network.rule(ctx, input),
      'ai-policy': () => s.intelligence.configure(ctx, input),
      'ai-run': () => s.intelligence.run(ctx, input),
      'ai-review': () => s.intelligence.review(ctx, input),
      'network-profile': () => s.network.profile(ctx, input),
      'network-invitation': () => s.networkInvitations.command(ctx, input),
      'network-task': () => s.network.task(ctx, input),
      'network-event': () => s.network.event(ctx, input),
      'network-review': () => s.network.reviewSubmission(ctx, input),
      'network-assess': () => s.network.assess(ctx, input),
      'network-reward': () => s.network.reward(ctx, input),
      'network-reverse': () => s.network.reverse(ctx, input),
      'commercial-mission': () => s.commercialMissions.command(ctx, input),
      'commercial-origin': () => s.opportunities.registerOrigin(ctx, input),
      'mission-route': () => s.corridors.assign(ctx, input),
      'mission-templates': () => s.corridors.installTemplates(ctx),
      'corridor-route': () => s.corridors.createRoute(ctx, input),
      'corridor-pack': () => s.corridors.appendPack(ctx, input),
      opportunity: () => s.opportunities.command(ctx, input),
      communication: () => s.communications.command(ctx, input),
      meeting: () => s.meetings.command(ctx, input),
      dispatch: async () => {
        const started: string[] = [];
        for (const job of await s.communications.pending(ctx)) {
          const runId = await communicationOrchestrator.start(job.id);
          await s.communications.started(ctx, job.id, runId);
          started.push(job.id);
        }
        return { started };
      },
      research: () => s.counterparties.command(ctx, input),
      mission: () => s.missions.command(ctx, input),
      'mission-reply': () => {
        const v = z
          .object({ id: z.uuid(), replyId: z.uuid(), body: z.string().trim().min(3).max(2000) })
          .parse(input);
        return s.missions.reply(ctx, v.id, v.body, v.replyId);
      },
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
          : ['23514', '23503', '23505', 'P0001', '54000'].includes(
                (error as { code?: string }).code ?? '',
              )
            ? 409
            : (error as { code?: string }).code === '42501'
              ? 403
              : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400
          ? 'Check the submitted values'
          : status === 409
            ? 'The record or policy changed. Check its status and refresh before retrying.'
            : status === 403
              ? 'Access denied'
              : 'The request could not be completed';
    if (status === 500)
      console.error(JSON.stringify({ event: 'foundation_request_failed', correlationId }));
    const code = error instanceof DomainError ? error.code : undefined;
    return Response.json(
      code ? { error: message, code, correlationId } : { error: message, correlationId },
      { status, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
