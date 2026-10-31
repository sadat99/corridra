import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { foundations } from '../../../../lib/foundations';
import { pickerKinds, type PickerKind } from '../../../../lib/ux/picker';
import { countryName } from '../../../../lib/ux/options';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

type Option = { value: string; label: string; hint?: string };
type Services = NonNullable<ReturnType<typeof foundations>>;
type Context = { token: string; tenantId: string; purpose: string; correlationId: string };

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};
const country = (code: unknown) => {
  const text = String(code ?? '');
  return /^[A-Z]{2}$/.test(text) ? countryName(text) : text;
};

/**
 * Each kind reads through an existing tenant-scoped service, so withTenant and row level security
 * decide what the person may see. Nothing here queries another workspace. Results are names, never
 * bare IDs (D9). At most 50 options.
 */
const readers: Record<PickerKind, (s: Services, ctx: Context) => Promise<Option[]>> = {
  async contributor(s, ctx) {
    const list = await s.networkInvitations.list(ctx);
    return (list.invitations as { principalId: string; name: string; state: string }[])
      .filter((item) => item.state === 'READY_FOR_PROFILE')
      .map((item) => ({ value: item.principalId, label: item.name, hint: 'Contributor' }));
  },
  async source(s, ctx) {
    const w = await s.evidence.workspace(ctx);
    return (w.sources as { id: string; locator: string; kind: string }[]).map((r) => ({
      value: r.id,
      label: r.locator,
      hint: String(r.kind).replaceAll('_', ' '),
    }));
  },
  async mission(s, ctx) {
    const q = await s.missions.queue(ctx, 'all', 0, {});
    return (
      q.missions as { id: string; status: string; brief?: { company?: string; market?: string } }[]
    ).map((m) => ({
      value: m.id,
      label: m.brief?.company ?? 'Mission',
      hint: [m.brief?.market, String(m.status).replaceAll('_', ' ').toLowerCase()]
        .filter(Boolean)
        .join(' · '),
    }));
  },
  async route(s, ctx) {
    const c = await s.corridors.catalogue(ctx);
    return (c.routes as { id: string; origin_market: string; destination_market: string }[]).map(
      (r) => ({
        value: r.id,
        label: `${country(r.origin_market)} to ${country(r.destination_market)}`,
      }),
    );
  },
  async reviewer(s, ctx) {
    // Owners and admins see every active member by name. Others see the people who can own work.
    let people: { id: string; name: string | null; role: string }[];
    try {
      const members = (await s.access.members(ctx)) as {
        user_id: string;
        name?: string | null;
        role: string;
        revoked_at: string | null;
      }[];
      people = members
        .filter((m) => !m.revoked_at)
        .map((m) => ({ id: m.user_id, name: m.name ?? null, role: m.role }));
    } catch {
      const q = await s.missions.queue(ctx, 'all', 0, {});
      people = (q.owners as { user_id: string; name: string; role: string }[]).map((o) => ({
        id: o.user_id,
        name: o.name,
        role: o.role,
      }));
    }
    return people
      .filter((p) => p.role !== 'viewer')
      .map((p) => ({
        value: p.id,
        label: p.name ?? 'Unnamed member',
        hint: roleLabels[p.role] ?? p.role,
      }));
  },
  async publication(s, ctx) {
    const w = await s.delivery.workspace(ctx);
    return (
      w.publications as {
        id: string;
        copy?: { title?: string };
        revoked: boolean;
        created_at: string;
      }[]
    )
      .filter((p) => !p.revoked)
      .map((p) => ({ value: p.id, label: p.copy?.title ?? 'Report', hint: 'Report' }));
  },
};

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

// Search behind ReferencePicker (commercial readiness program, 5.2). Results are scoped to the
// signed-in team member's workspace through the existing services. Never returns another
// workspace's records. A refused read keeps its status: 401 with STEP_UP_REQUIRED stays 401.
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const kind = z.enum(pickerKinds).parse((await params).kind);
    const s = foundations();
    if (!s) throw new DomainError('Search is unavailable', 503);
    await s.ready;
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const url = new URL(request.url);
    const tenantId = z.uuid().parse(url.searchParams.get('tenant'));
    const q = z
      .string()
      .max(100)
      .parse(url.searchParams.get('q') ?? '');
    const ctx = {
      token: identity.token,
      tenantId,
      purpose: 'synthetic_validation',
      correlationId: randomUUID(),
    };
    const all = await readers[kind](s, ctx);
    const text = normalise(q.trim());
    const options = (
      text
        ? all.filter(
            (o) => normalise(o.label).includes(text) || normalise(o.hint ?? '').includes(text),
          )
        : all
    ).slice(0, 50);
    return Response.json({ kind, options }, { headers });
  } catch (error) {
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (error as { code?: string }).code === '42501'
            ? 403
            : 500;
    const code = error instanceof DomainError ? error.code : undefined;
    return Response.json(
      {
        error: error instanceof DomainError ? error.message : 'Search could not be completed',
        ...(code ? { code } : {}),
      },
      { status, headers },
    );
  }
}
