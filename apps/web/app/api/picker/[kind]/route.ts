import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
import { pickerKinds } from '../../../../lib/ux/picker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

// Search behind ReferencePicker (commercial readiness program, 5.2). Results are scoped to the
// signed-in team member's workspace. Wave 0 answers an empty list for every kind; WS-D fills each kind
// from the existing tenant-scoped services. Never returns another workspace's records.
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = z.enum(pickerKinds).parse((await params).kind);
    const s = foundations();
    if (!s) throw new DomainError('Search is unavailable', 503);
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const url = new URL(request.url);
    z.uuid().parse(url.searchParams.get('tenant'));
    z.string()
      .max(100)
      .parse(url.searchParams.get('q') ?? '');
    return Response.json(
      { kind, options: [] as { value: string; label: string; hint?: string }[] },
      { headers },
    );
  } catch (error) {
    const status =
      error instanceof DomainError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return Response.json(
      { error: error instanceof DomainError ? error.message : 'Search could not be completed' },
      { status, headers },
    );
  }
}
