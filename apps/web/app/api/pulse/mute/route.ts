import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
export const dynamic = 'force-dynamic';
// No sign-in. The database accepts only the link token that belongs to this request, and answers
// every refusal the same way. It stays available if the sending switch is later turned off, so an
// older email's Mute link keeps working.
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const refusal = () =>
    Response.json({ error: 'This link is not valid or has expired.' }, { status: 400, headers });
  try {
    const s = foundations();
    if (!s) throw new DomainError('Unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed');
    if (Number(request.headers.get('content-length') ?? 0) > 1024)
      throw new DomainError('Request too large', 413);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError('Body required', 400);
    let length = 0;
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1024) {
        await reader.cancel();
        throw new DomainError('Request too large', 413);
      }
      parts.push(value);
    }
    const v = z
      .object({ requestId: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
    const result = await s.pulse.mute(v.requestId, v.token);
    return Response.json({ muted: result.muted === true }, { headers });
  } catch {
    return refusal();
  }
}
