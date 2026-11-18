import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { customerBooksEnabled } from '@corridra/auth/customer-books';
import { bookPdf } from '@corridra/delivery/report';
import { foundations } from '../../../lib/foundations';
import { memberAccessOn, memberBookInput } from '../../../lib/member-access';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-087 U5, member access. A workspace owner or admin reads, without changing, the saved reports and decision cards of current
// members and downloads their books. GET: the workspaces this person owns or manages and when each opens (no member item is read,
// so nothing is recorded). POST {action,...}: every read of a member item, so no link, prefetch or crawler can start one; the
// database checks the verified person, the workspace and the 24-hour interval, and records one audit event per read or book.
// Identity comes only from the fresh provider session. With CORRIDRA_MEMBER_ACCESS off the route is not found; with saved reports
// off it is unavailable; with the module missing it is unavailable.
const id = z.uuid();
const after = id.nullable().default(null);
const readInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reports'), workspaceId: id, after }).strict(),
  z.object({ action: z.literal('report'), workspaceId: id, resourceId: id }).strict(),
  z.object({ action: z.literal('cards'), workspaceId: id, after }).strict(),
  z.object({ action: z.literal('card'), workspaceId: id, cardId: id }).strict(),
]);
const bookAction = memberBookInput.extend({ action: z.literal('book') }).strict();
const listInput = z.object({}).strict();
async function services() {
  if (!memberAccessOn()) throw new DomainError('Not found', 404);
  if (!customerSavedMissionsEnabled())
    throw new DomainError('Members’ reports are unavailable', 503);
  const s = foundations();
  if (!s) throw new DomainError('Members’ reports are unavailable', 503);
  await s.ready;
  return s;
}
function failure(error: unknown) {
  if (error instanceof DomainError && error.code === 'NOT_OPEN')
    return Response.json(
      { error: error.message, reason: 'NOT_OPEN' },
      { status: 403, headers: deliveryHeaders },
    );
  if (error instanceof DomainError && error.status === 422 && error.code === 'EMPTY')
    return Response.json(
      { error: error.message, reason: 'EMPTY' },
      { status: 422, headers: deliveryHeaders },
    );
  if (error instanceof DomainError && error.status === 422 && error.code === 'UNSUPPORTED_TEXT')
    return Response.json(
      { error: error.message, reason: 'UNSUPPORTED_TEXT' },
      { status: 422, headers: deliveryHeaders },
    );
  return deliveryError(
    ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
      ? new DomainError('Members’ reports are unavailable', 503)
      : error,
  );
}
const who = (request: Request) =>
  [
    request.headers.get('x-corridra-customer-subject') ?? undefined,
    request.headers.get('x-corridra-customer-issuer') ?? undefined,
  ] as const;
export async function GET(request: Request) {
  try {
    const s = await services();
    listInput.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await s.customerMemberAccess.workspaces(...who(request)), {
      headers: deliveryHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const s = await services();
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const body = JSON.parse((await boundedBody(request, 2048)).toString('utf8')) as {
      action?: unknown;
    };
    const [subject, issuer] = who(request);
    // The original shared per-client delivery budget, on every action: each list, open and book is a read that writes an audit
    // event, so none may be repeated without bound. Keyed by the item read, or the workspace for a list.
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    if (body?.action === 'book') {
      if (!customerBooksEnabled())
        throw new DomainError('Trip and Supplier books are unavailable', 503);
      const parsed = bookAction.parse(body);
      const input = {
        workspaceId: parsed.workspaceId,
        resourceId: parsed.resourceId,
        commandId: parsed.commandId,
        kind: parsed.kind,
        acknowledged: parsed.acknowledged,
      };
      await s.delivery.budget(client, input.resourceId);
      const { record: book, file: pdf } = await s.customerMemberAccess.book(
        input,
        bookPdf,
        subject,
        issuer,
      );
      const name = book.kind === 'TRIP' ? 'trip' : 'supplier';
      return new Response(new Uint8Array(pdf), {
        headers: {
          ...deliveryHeaders,
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
          'Content-Disposition': `attachment; filename="corridra-${name}-book-${book.generatedAt.slice(0, 10).replaceAll('-', '')}.pdf"`,
          'X-Corridra-Book-Digest': book.digest,
          'X-Corridra-Book-Replayed': String(book.replayed),
          'X-Corridra-Book-Generated-At': book.generatedAt,
        },
      });
    }
    const input = readInput.parse(body);
    await s.delivery.budget(
      client,
      'resourceId' in input
        ? input.resourceId
        : 'cardId' in input
          ? input.cardId
          : input.workspaceId,
    );
    const service = s.customerMemberAccess;
    const result =
      input.action === 'reports'
        ? await service.savedReports(input.workspaceId, input.after, subject, issuer)
        : input.action === 'report'
          ? await service.report(input.workspaceId, input.resourceId, subject, issuer)
          : input.action === 'cards'
            ? await service.decisionCards(input.workspaceId, input.after, subject, issuer)
            : await service.decisionCard(input.workspaceId, input.cardId, subject, issuer);
    return Response.json(result, { headers: deliveryHeaders });
  } catch (error) {
    return failure(error);
  }
}
