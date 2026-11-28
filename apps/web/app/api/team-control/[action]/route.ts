import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { routePackContentOctetBudget } from '@corridra/domain/route-pack-standard';
import { foundations } from '../../../../lib/foundations';
import { notify } from '../../../../lib/notify';
import { uxSwitchOn } from '../../../../lib/ux-switches';
import {
  createRoutePack,
  previewRoutePackChange,
  publishRoutePackChange,
  routePackChangeRequest,
} from '@corridra/missions/route-pack-form';
import { contentAppendItem } from '@corridra/missions/route-pack-content';
import { sheetLimits, sheetWords, type SheetReport } from '@corridra/missions/route-pack-sheet';
import { csvRows } from '@corridra/delivery/import';
import { csvCell } from '@corridra/auth/customer-programme-export-csv';
import { liveStatuses } from '@corridra/domain/route-pack-standard';
import { proposalOctetBudget } from '@corridra/domain/corridors';
import { answerRoutePackRead, isRoutePackReadAction } from '../../../../lib/route-pack-editor-read';
import { factsSavedAnswer, isRoutePackFactsAction } from '../../../../lib/route-pack-editor-write';
import {
  isRoutePackPublishAction,
  packPreviewAnswer,
  packPublishedAnswer,
} from '../../../../lib/route-pack-editor-publish';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Team control (WS-D): Today counts (CQ-34, CQ-73), team invitations behind CORRIDRA_TEAM_INVITES
// (CQ-74, D8) and authenticator reset (V-03). Authority lives in the services: withTenant and RLS.
// A refused action that needs a fresh authenticator check answers 401 with code STEP_UP_REQUIRED.
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), invite: z.unknown() }).strict(),
  z.object({ action: z.literal('resend'), invitationId: z.uuid() }).strict(),
  z.object({ action: z.literal('cancel'), invitationId: z.uuid() }).strict(),
]);
// ADR-093 G: the route pack sheet. The CSV travels inside JSON so the dry run and the save send the same body.
const sheetRequest = z
  .object({
    mode: z.enum(['dry-run', 'save']),
    csv: z.string(),
    saveId: z.uuid().optional(),
    reason: z.string().optional(),
    // Follow-up per G73: the check's plan fingerprint; the sheet service requires it on a save, so a save without one is 400.
    planFingerprint: z.string().optional(),
  })
  .strict();
const sheetBodyOctets = 2 * sheetLimits.octets;
// ADR-093 Phase 3, PR 2a: a facts document may hold up to the content budget of the domain, and the request adds the command id,
// the route, the version and the reason around it. The 4096 octets of body() stay for every other action.
const factsBodyOctets = routePackContentOctetBudget + 8192;
// ADR-093 Phase 3, PR 3a: a pack change is at most a proposal's worth of settings, and the request adds the mode, the command
// id, the route, the version and the reason around it.
const publishBodyOctets = proposalOctetBudget + 8192;
const utf8 = new TextDecoder('utf-8', { fatal: true });
// Every cell goes through csvCell, which puts an apostrophe before a cell a spreadsheet could read as a formula; the import
// takes it off again.
const sheetCsv = (rows: string[][]) =>
  '\uFEFF' + rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n') + '\r\n';
// A plan with errors saved nothing; a save that stopped after writing says so; otherwise the step's own words.
const sheetRefusal = (report: SheetReport) =>
  !report.saved
    ? sheetWords.saveErrors
    : report.saved.length
      ? sheetWords.savePartly
      : (report.errors[0]?.message ?? sheetWords.saveErrors);
// ADR-093: the route pack module acts only while its switch is on and the 2b marker is installed. The switch is read first, so
// with it off nothing else is asked; every caller answers Not found, as for an unknown action, before it reads or parses a word
// of the request.
async function routePackModuleOn(s: { routePackSheet: { available(): Promise<boolean> } }) {
  return uxSwitchOn('CORRIDRA_ROUTE_PACK_FORM') && (await s.routePackSheet.available());
}
// Follow-up per G73: the key the route pack editor names its sessionStorage copy with, one per person and workspace. Keyed
// under AUTH_SECRET with a purpose label, so it is opaque and no actor id leaves the server.
const stageScopeOf = (secret: string, tenantId: string, userId: string) =>
  createHmac('sha256', secret)
    .update(`corridra:route-pack-stage:v1:${tenantId}:${userId}`)
    .digest('base64url')
    .slice(0, 22);
// Reads at most `limit` octets, stopping as soon as the body passes it; a client-supplied Content-Length is not trusted.
async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader?.read();
    if (!next || next.done) break;
    length += next.value.length;
    if (length > limit) {
      await reader!.cancel();
      throw new DomainError('Request is too large', 413);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}

async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const correlationId = randomUUID();
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Corridra-Request-ID': correlationId,
  };
  try {
    const s = foundations();
    if (!s) throw new DomainError('Team control is unavailable', 503);
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const { action } = await params;
    const tenantId = z.uuid().parse(new URL(request.url).searchParams.get('tenant'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    const body = async () => {
      const text = await request.text();
      if (text.length > 4096) throw new DomainError('Request is too large', 413);
      return JSON.parse(text) as unknown;
    };
    if (action === 'today' && request.method === 'GET')
      return Response.json(await s.access.today(ctx), { headers });
    if (action === 'invites') {
      if (!uxSwitchOn('CORRIDRA_TEAM_INVITES')) throw new DomainError('Not found', 404);
      if (request.method === 'GET')
        return Response.json({ invitations: await s.access.team().list(ctx) }, { headers });
      const v = command.parse(await body());
      const team = s.access.team();
      const invitationNotice = async (recipient: {
        principalId: string;
        email: string;
        name: string;
        role: string;
      }) => {
        try {
          return await notify({
            recipientAccountId: recipient.principalId,
            recipientKind: 'staff',
            recipientEmail: recipient.email,
            type: 'TEAM_INVITE',
            payload: {
              name: recipient.name,
              role: recipient.role,
              setupPath: '/operator/setup',
              href: '/operator/setup',
            },
            locale: 'en',
            tenantId,
            writer: { kind: 'staff', ctx },
          });
        } catch {
          console.error(
            JSON.stringify({ event: 'team_invitation_notification_failed', correlationId }),
          );
          return { inbox: 'failed' as const, email: 'not_sent' as const };
        }
      };
      if (v.action === 'invite') {
        const result = await team.invite(ctx, v.invite);
        const input = v.invite as { email: string; name: string; role: string };
        const notification = await invitationNotice({ principalId: result.principalId, ...input });
        return Response.json(
          { ...result, notification: { inbox: notification.inbox, email: notification.email } },
          { status: 201, headers },
        );
      }
      if (v.action === 'resend') {
        const { notificationRecipient, ...result } = await team.resend(ctx, {
          invitationId: v.invitationId,
        });
        const notification = await invitationNotice({
          principalId: result.principalId,
          ...notificationRecipient,
        });
        return Response.json(
          { ...result, notification: { inbox: notification.inbox, email: notification.email } },
          { status: 201, headers },
        );
      }
      return Response.json(await team.cancel(ctx, { invitationId: v.invitationId }), {
        status: 201,
        headers,
      });
    }
    if (action === 'authenticator-reset' && request.method === 'POST')
      return Response.json(await s.access.team().resetAuthenticator(ctx, await body()), {
        status: 201,
        headers,
      });
    if (action === 'route-pack-export' || action === 'route-pack-import') {
      // Switch off, or the content module not installed: Not found, before the request is read or parsed.
      if (!(await routePackModuleOn(s))) throw new DomainError('Not found', 404);
      if (action === 'route-pack-export' && request.method === 'GET') {
        const routes = (new URL(request.url).searchParams.get('routes') ?? '').split('|');
        const rows = await s.routePackSheet.export(ctx, { routes });
        return new Response(sheetCsv(rows), {
          headers: {
            ...headers,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename=route-packs-${new Date().toISOString().slice(0, 10)}.csv`,
          },
        });
      }
      if (action === 'route-pack-import' && request.method === 'POST') {
        // Its own body reader: the file is far larger than the 4096 octets every other action allows.
        const bytes = await boundedBody(request, sheetBodyOctets);
        let text: string;
        try {
          text = utf8.decode(bytes);
        } catch {
          throw new DomainError('Send the file as UTF-8 text', 400);
        }
        const v = sheetRequest.parse(JSON.parse(text));
        if (Buffer.byteLength(v.csv, 'utf8') > sheetLimits.octets)
          throw new DomainError(sheetWords.octets, 413);
        const rows = csvRows(v.csv, sheetLimits.rows, 'route pack');
        if (v.mode === 'dry-run')
          return Response.json(await s.routePackSheet.dryRun(ctx, { rows }), { headers });
        const report = await s.routePackSheet.save(ctx, {
          rows,
          saveId: v.saveId,
          reason: v.reason,
          planFingerprint: v.planFingerprint,
        });
        if (report.ok) return Response.json(report, { status: 201, headers });
        return Response.json(
          {
            error: sheetRefusal(report),
            report,
          },
          { status: 409, headers },
        );
      }
      throw new DomainError('Not found', 404);
    }
    if (isRoutePackReadAction(action)) {
      // ADR-093 Phase 3, PR 1: the reads behind the route pack editor. Same gate as export and import, before any query
      // word beyond the tenant is read; reads only, so any other method is Not found too.
      if (!(await routePackModuleOn(s)) || request.method !== 'GET')
        throw new DomainError('Not found', 404);
      return Response.json(
        await answerRoutePackRead(
          s.routePackContent,
          ctx,
          action,
          new URL(request.url).searchParams,
          liveStatuses,
          () => stageScopeOf(s.config.AUTH_SECRET, tenantId, identity.userId),
        ),
        { headers },
      );
    }
    if (isRoutePackFactsAction(action)) {
      // ADR-093 Phase 3, PR 2a: the one write behind the route pack editor, Save Route Facts. The gate comes first and answers
      // Not found as for an unknown action, for every method but POST too, before a word of the body is read; the service then
      // holds the authority (config.manage, the fresh authenticator, the content module active) and this handler adds none.
      if (!(await routePackModuleOn(s)) || request.method !== 'POST')
        throw new DomainError('Not found', 404);
      const bytes = await boundedBody(request, factsBodyOctets);
      let text: string;
      try {
        text = utf8.decode(bytes);
      } catch {
        throw new DomainError('Send the request as UTF-8 text', 400);
      }
      const saved = await s.routePackContent.append(ctx, contentAppendItem.parse(JSON.parse(text)));
      return Response.json(factsSavedAnswer(saved), {
        status: saved.duplicate ? 200 : 201,
        headers,
      });
    }
    if (isRoutePackPublishAction(action)) {
      // ADR-093 Phase 3, PR 3a: the pack settings and status of the route pack editor, previewed or published. The same gate as
      // route-pack-facts comes first, for every method but POST too, before a word of the body is read; the services hold the
      // authority (config.manage and so the fresh authenticator, the content module active) and this handler adds none.
      if (!(await routePackModuleOn(s)) || request.method !== 'POST')
        throw new DomainError('Not found', 404);
      const bytes = await boundedBody(request, publishBodyOctets);
      let text: string;
      try {
        text = utf8.decode(bytes);
      } catch {
        throw new DomainError('Send the request as UTF-8 text', 400);
      }
      const v = routePackChangeRequest.parse(JSON.parse(text));
      const deps = { operations: s.operations, content: s.routePackContent };
      if (v.mode === 'preview')
        return Response.json(packPreviewAnswer(await previewRoutePackChange(deps, ctx, v.change)), {
          headers,
        });
      const published = await publishRoutePackChange(deps, ctx, v.change);
      return Response.json(packPublishedAnswer(published), {
        status: published.duplicate ? 200 : 201,
        headers,
      });
    }
    if (action === 'route-pack') {
      // CQ-66: guided route pack form. The reviewed command is built on the server.
      if (!uxSwitchOn('CORRIDRA_ROUTE_PACK_FORM')) throw new DomainError('Not found', 404);
      // reviewed: the route pack module is active, so the form publishes through the reviewed path and carries unset keys.
      if (request.method === 'GET') {
        const capabilities = await s.routePackContent.capabilities(ctx);
        return Response.json(
          { enabled: true, reviewed: capabilities.routePackForm && capabilities.contentInstalled },
          { headers },
        );
      }
      return Response.json(
        await createRoutePack(
          { corridors: s.corridors, operations: s.operations, content: s.routePackContent },
          ctx,
          await body(),
        ),
        {
          status: 201,
          headers,
        },
      );
    }
    throw new DomainError('Not found', 404);
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : (error as { code?: string }).code === '42501'
            ? 403
            : ['23505', '23514', '23503'].includes((error as { code?: string }).code ?? '')
              ? 409
              : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : status === 400
          ? 'Check the submitted values'
          : status === 403
            ? 'Access denied'
            : status === 409
              ? 'The record changed. Refresh and try again.'
              : 'The request could not be completed';
    if (status === 500)
      console.error(JSON.stringify({ event: 'team_control_failed', correlationId }));
    const code = error instanceof DomainError ? error.code : undefined;
    return Response.json(
      code ? { error: message, code, correlationId } : { error: message, correlationId },
      {
        status,
        headers,
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
