import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { supplyId, supplyWords } from '@corridra/domain/supply-sources';
import { parseSupplyCandidateFile } from '@corridra/delivery/supply-candidate-file';
import { foundations } from '../../../../lib/foundations';
import { uxSwitchOn } from '../../../../lib/ux-switches';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ADR-082 slice S3: the staff screens of supply sources, candidates and do not contact. Every action answers 404 while
// CORRIDRA_SUPPLY_SOURCES is off. Authority lives in the service: withTenant, the module's command functions and RLS. A lift
// that needs a fresh authenticator check answers 401 with code STEP_UP_REQUIRED.
const maxBody = 16 * 1024;
const maxFile = 1024 * 1024;
const fileMessages = {
  tooLarge: 'This file is over 1 MiB. Split it and try again.',
  unknownType: 'Use a CSV or XLSX file.',
  noFile: 'Choose a file to import.',
};

async function handle(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const correlationId = randomUUID();
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Corridra-Request-ID': correlationId,
  };
  try {
    if (!uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')) throw new DomainError('Not found', 404);
    const s = foundations();
    if (!s) throw new DomainError('Supply sources are unavailable', 503);
    await s.ready;
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(s.config.APP_ORIGIN).origin
    )
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const { action } = await params;
    const query = new URL(request.url).searchParams;
    const tenantId = z.uuid().parse(query.get('tenant'));
    const ctx = { token: identity.token, tenantId, purpose: 'synthetic_validation', correlationId };
    const service = s.supplyCandidates;
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (request.method === 'GET') {
      const mission = () => supplyId.parse(query.get('mission'));
      if (action === 'sources') return json({ sources: await service.listSources(ctx) });
      if (action === 'source-versions')
        return json({ versions: await service.sourceVersions(ctx, query.get('source')) });
      if (action === 'missions') return json({ missions: await service.listMissions(ctx) });
      if (action === 'route-kinds') {
        // Bounded: the 20 newest missions, one route read each.
        const missions = (await service.listMissions(ctx, { limit: 20 })).slice(0, 20);
        const routes = await Promise.all(
          missions.map(async (m) => ({ ...m, kinds: await service.kindsOnRoute(ctx, m.id) })),
        );
        return json({ routes });
      }
      if (action === 'state')
        return json({
          ...(await service.screenState(ctx, query.get('mission') ?? undefined)),
          kinds: query.get('mission') ? await service.kindsOnRoute(ctx, mission()) : [],
        });
      if (action === 'candidates')
        return json({ candidates: await service.listCandidates(ctx, { missionId: mission() }) });
      if (action === 'candidate') {
        const found = await service.candidate(ctx, query.get('id'));
        if (!found) throw new DomainError('Candidate unavailable', 404);
        return json({ candidate: found });
      }
      if (action === 'batches') return json({ batches: await service.listBatches(ctx, mission()) });
      if (action === 'blocks') return json({ blocks: await service.listBlocks(ctx) });
      throw new DomainError('Not found', 404);
    }
    if (request.method !== 'POST') throw new DomainError('Not found', 404);
    if (action === 'import-file') {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0)
        throw new DomainError(fileMessages.noFile, 400);
      if (file.size > maxFile) throw new DomainError(fileMessages.tooLarge, 400);
      const lower = file.name.toLowerCase();
      const format = lower.endsWith('.csv') ? 'CSV' : lower.endsWith('.xlsx') ? 'XLSX' : null;
      if (!format) throw new DomainError(fileMessages.unknownType, 400);
      const parsed = await parseSupplyCandidateFile(Buffer.from(await file.arrayBuffer()), format);
      const field = (name: string) => String(form.get(name) ?? '');
      return json(
        await service.importFile(ctx, {
          commandId: field('commandId'),
          missionId: field('missionId'),
          profileVersionId: field('profileVersionId'),
          sourceVersionId: field('sourceVersionId'),
          digest: parsed.digest,
          rows: parsed.rows,
        }),
        201,
      );
    }
    const text = await request.text();
    if (text.length > maxBody) throw new DomainError('Request is too large', 413);
    const body = JSON.parse(text) as unknown;
    const writes: Record<string, () => Promise<unknown>> = {
      'create-source': () => service.createSource(ctx, body),
      'source-version': () => service.addSourceVersion(ctx, body),
      'add-candidate': () => service.addCandidate(ctx, body),
      review: () => service.review(ctx, body),
      match: () => service.match(ctx, body),
      block: () => service.blockCompany(ctx, body),
      lift: async () => {
        await service.requireFreshLift(ctx);
        return service.liftCompany(ctx, body);
      },
    };
    const write = writes[action];
    if (!write) throw new DomainError('Not found', 404);
    return json(await write(), 201);
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
        : error instanceof z.ZodError &&
            error.issues.some((issue) => issue.message === supplyWords.contactDetails)
          ? supplyWords.contactDetails
          : status === 400
            ? 'Check the submitted values'
            : status === 403
              ? 'Access denied'
              : status === 409
                ? 'The record changed. Refresh and try again.'
                : 'The request could not be completed';
    if (status === 500) console.error(JSON.stringify({ event: 'supply_failed', correlationId }));
    const code = error instanceof DomainError ? error.code : undefined;
    return Response.json(
      code ? { error: message, code, correlationId } : { error: message, correlationId },
      { status, headers },
    );
  }
}
export const GET = handle;
export const POST = handle;
