import { DomainError } from '@corridra/domain';
import { bookInput } from '@corridra/domain/books';
import { customerBooksEnabled } from '@corridra/auth/customer-books';
import { bookPdf } from '@corridra/delivery/report';
import { foundations } from '../../../lib/foundations';
import { boundedBody, deliveryError, deliveryHeaders } from '../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const unavailable = 'Trip and Supplier books are unavailable';
// A server-made PDF of one book of the caller's own saved mission (ADR-076). POST only, so no link, prefetch or
// crawler can start a generation. The database decides ownership and records the generation; nothing is stored.
export async function POST(request: Request) {
  try {
    if (!customerBooksEnabled()) throw new DomainError(unavailable, 503);
    const s = foundations();
    if (!s) throw new DomainError(unavailable, 503);
    await s.ready;
    if (request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const input = bookInput.parse(JSON.parse((await boundedBody(request, 2048)).toString('utf8')));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.delivery.budget(client, input.resourceId);
    const book = await s.customerBooks.generate(
      input,
      request.headers.get('x-corridra-customer-subject') ?? undefined,
      request.headers.get('x-corridra-customer-issuer') ?? undefined,
    );
    const pdf = await bookPdf(book);
    const name = book.kind === 'TRIP' ? 'trip' : 'supplier';
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...deliveryHeaders,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        // Fixed ASCII from the recorded day, never from mission text.
        'Content-Disposition': `attachment; filename="corridra-${name}-book-${book.generatedAt.slice(0, 10).replaceAll('-', '')}.pdf"`,
        'X-Corridra-Book-Digest': book.digest,
        'X-Corridra-Book-Replayed': String(book.replayed),
        'X-Corridra-Book-Generated-At': book.generatedAt,
      },
    });
  } catch (error) {
    return deliveryError(
      ['42P01', '3F000', '42883'].includes((error as { code?: string }).code ?? '')
        ? new DomainError(unavailable, 503)
        : error,
    );
  }
}
