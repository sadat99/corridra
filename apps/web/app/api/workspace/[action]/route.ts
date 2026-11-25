import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { founderActivation } from '@corridra/auth/founder-activation';
import { queueFilters } from '@corridra/missions';
import { foundations } from '../../../../lib/foundations';
import { communicationOrchestrator } from '../../../../lib/communication-orchestrator';
import { notify } from '../../../../lib/notify';
import { uxSwitchOn } from '../../../../lib/ux-switches';
import { refusalReference, workspaceRefusal } from '../../../../lib/staff-db-error';
import { stepUpWhenRoleAllows } from '../../../../lib/step-up-refusal';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const correlationId = randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Corridra-Request-ID': correlationId };
  // ADR-081: true only for a reply-bound offer or a reply read, so a missing function there means "unavailable", never a plain 500.
  let replyPath = false;
  try {
    const s = foundations();
    if (!s) {
      const reference = refusalReference(correlationId);
      console.error(
        JSON.stringify({
          event: 'foundation_request_failed',
          code: 'UNAVAILABLE',
          status: 503,
          correlationId,
          reference,
        }),
      );
      return Response.json(
        {
          error: `Operator workspace is unavailable. Try again later. If it continues, quote reference ${reference}.`,
          correlationId,
          reference,
        },
        { status: 503, headers },
      );
    }
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
        'ai-connect': () => {
          if (!uxSwitchOn('CORRIDRA_AI_CONNECT_FORM')) throw new DomainError('Not found', 404);
          return s.intelligence.connectOptions(
            ctx,
            // An empty ?adapter= means no provider was chosen, the same as leaving it out.
            new URL(request.url).searchParams.get('adapter') || undefined,
          );
        },
        network: () => {
          const q = new URL(request.url).searchParams;
          return s.network.workspace(ctx, {
            profilesAfter: q.get('profilesAfter'),
            tasksAfter: q.get('tasksAfter'),
          });
        },
        'network-invitations': () =>
          stepUpWhenRoleAllows(s, ctx, ['owner', 'admin'], () =>
            s.networkInvitations.list(ctx, new URL(request.url).searchParams.get('after')),
          ),
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
        'reply-quotation-prefill': () => {
          replyPath = true;
          return s.commercialMissions.replyPrefill(
            ctx,
            z.uuid().parse(new URL(request.url).searchParams.get('reply')),
            { replyBinding: uxSwitchOn('CORRIDRA_REPLY_PAGE') },
          );
        },
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
        communications: () => {
          const q = new URL(request.url).searchParams;
          return s.communications.workspace(ctx, {
            targetsAfter: q.get('targetsAfter'),
            contactsAfter: q.get('contactsAfter'),
            messagesAfter: q.get('messagesAfter'),
            optoutsAfter: q.get('optoutsAfter'),
          });
        },
        meetings: () => {
          const q = new URL(request.url).searchParams;
          return s.meetings.workspace(ctx, {
            after: q.get('after'),
            followupsAfter: q.get('followupsAfter'),
            missionId: q.get('missionId'),
            missionIds: q.get('missionIds')?.split(',') ?? null,
          });
        },
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
            z.enum(['all', 'open', 'overdue', 'stale']).parse(query.get('filter') ?? 'all'),
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
          ...(await s.evidence.workspace(ctx, {
            sourcesAfter: new URL(request.url).searchParams.get('sourcesAfter'),
            claimsAfter: new URL(request.url).searchParams.get('claimsAfter'),
            evidenceAfter: new URL(request.url).searchParams.get('evidenceAfter'),
          })),
          uploadsConfigured: s.uploadsConfigured,
          scanMode: s.scanMode,
        }),
        members: () => s.access.members(ctx),
        audit: () => s.access.audit(ctx),
        config: () => s.access.config(ctx),
      };
      if (action === 'shortlist-export') {
        const list = await s.counterparties.shortlistExport(
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
      'ai-connect': () => {
        if (!uxSwitchOn('CORRIDRA_AI_CONNECT_FORM')) throw new DomainError('Not found', 404);
        return s.intelligence.connect(ctx, input);
      },
      'ai-run': () => s.intelligence.run(ctx, input),
      'ai-review': () => s.intelligence.review(ctx, input),
      'network-profile': () => s.network.profile(ctx, input),
      'network-invitation': async () => {
        const result = await stepUpWhenRoleAllows(s, ctx, ['owner', 'admin'], () =>
          s.networkInvitations.command(ctx, input),
        );
        const invite = input as { action?: string; email?: string; name?: string };
        const created = result as { principalId?: string; duplicate?: boolean };
        // CQ-65: the invited person gets an inbox item and, when email is on, an email. A failed
        // notification never undoes the invitation; the result says what happened.
        if (invite.action !== 'invite' || !created.principalId || created.duplicate) return result;
        const notification = await notify({
          recipientAccountId: created.principalId,
          recipientKind: 'staff',
          recipientEmail: invite.email,
          type: 'CONTRIBUTOR_INVITE',
          payload: { name: invite.name ?? null, setupPath: '/contributor/setup' },
          locale: 'en',
          tenantId,
          writer: { kind: 'staff', ctx },
        });
        return {
          ...result,
          notification: { inbox: notification.inbox, email: notification.email },
        };
      },
      'network-task': () => s.network.task(ctx, input),
      'network-event': () => s.network.event(ctx, input),
      'network-review': () => s.network.reviewSubmission(ctx, input),
      'network-assess': () => s.network.assess(ctx, input),
      'network-reward': () => s.network.reward(ctx, input),
      'network-reverse': () => s.network.reverse(ctx, input),
      'commercial-mission': () => {
        replyPath = typeof input === 'object' && input !== null && 'replyBinding' in input;
        return s.commercialMissions.command(ctx, input, {
          replyBinding: uxSwitchOn('CORRIDRA_REPLY_PAGE'),
        });
      },
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
        // ADR-090: a real email is started only for the one message the staff member names. A dispatch without a
        // message id starts the waiting sample messages only.
        const one = z.object({ messageId: z.uuid().optional() }).parse(input ?? {}).messageId;
        for (const job of await s.communications.pending(ctx, one)) {
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
    // Unit D2: every refusal carries a short reference, and 403, 409, 503 and 500 leave one log line
    // with the code and the correlation id. The words of the database never reach the answer or the log.
    const reference = refusalReference(correlationId);
    const refusal =
      error instanceof DomainError
        ? { status: error.status, message: error.message, code: error.code ?? 'DOMAIN' }
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? { status: 400, message: 'Check the submitted values', code: 'INPUT' }
          : workspaceRefusal(error, reference, { replyPath });
    if ([403, 409, 500, 503].includes(refusal.status))
      console.error(
        JSON.stringify({
          event: refusal.status >= 500 ? 'foundation_request_failed' : 'foundation_request_refused',
          code: refusal.code,
          status: refusal.status,
          correlationId,
          reference,
        }),
      );
    const code = error instanceof DomainError ? error.code : undefined;
    return Response.json(
      code
        ? { error: refusal.message, code, correlationId, reference }
        : { error: refusal.message, correlationId, reference },
      { status: refusal.status, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
