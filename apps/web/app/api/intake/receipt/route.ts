import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const s = foundations();
    if (!s) throw new DomainError('Intake unavailable', 503);
    await s.ready;
    if (request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin)
      throw new DomainError('Request origin is not allowed');
    if (Number(request.headers.get('content-length') ?? 0) > 1024)
      throw new DomainError('Request too large', 413);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError('Receipt required', 400);
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
      .object({ receipt: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
    return Response.json(await s.missions.receipt(v.receipt), { headers });
  } catch (e) {
    return Response.json(
      { error: 'Receipt unavailable or expired' },
      { status: e instanceof DomainError ? e.status : 400, headers },
    );
  }
}
