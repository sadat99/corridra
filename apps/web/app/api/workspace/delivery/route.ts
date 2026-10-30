import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { intakeTemplate } from '@corridra/delivery/import';
import { foundations } from '../../../../lib/foundations';
import { specificationConfirmationAvailable } from '../../../../lib/specification-availability';
import {
  boundedBody,
  deliveryEnabled,
  deliveryError,
  deliveryHeaders,
} from '../../../../lib/delivery-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    deliveryEnabled();
    const s = foundations();
    if (!s) throw new DomainError('Workspace unavailable', 503);
    await s.ready;
    if (request.method === 'POST' && request.headers.get('origin') !== s.config.APP_ORIGIN)
      throw new DomainError('Request origin is not allowed');
    const identity = await s.provider.getSession(request.headers);
    if (!identity) throw new DomainError('Sign in to continue', 401);
    const query = new URL(request.url).searchParams;
    const ctx = {
      token: identity.token,
      tenantId: z.uuid().parse(query.get('tenant')),
      purpose: 'synthetic_validation',
    };
    if (request.method === 'GET') {
      if (query.get('action') === 'experience') {
        const experience = await s.deliveryExperience.workspace(
          ctx,
          z
            .uuid()
            .optional()
            .parse(query.get('programme') ?? undefined),
          z
            .uuid()
            .optional()
            .parse(query.get('mission') ?? undefined),
        );
        return Response.json(
          {
            ...experience,
            specificationConfirmationsAvailable: await specificationConfirmationAvailable(() =>
              s.specificationConfirmations.installed(),
            ),
          },
          { headers: deliveryHeaders },
        );
      }
      if (query.get('action') === 'options')
        return Response.json(await s.delivery.options(ctx, z.uuid().parse(query.get('mission'))), {
          headers: deliveryHeaders,
        });
      const data = await s.delivery.workspace(
        ctx,
        z
          .uuid()
          .optional()
          .parse(query.get('programme') ?? undefined),
        z.coerce
          .number()
          .int()
          .min(0)
          .max(100000)
          .parse(query.get('offset') ?? 0),
      );
      if (query.get('template') === 'true')
        return new Response(intakeTemplate(), {
          headers: {
            ...deliveryHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="corridra-intake-template.csv"',
          },
        });
      return Response.json(data, { headers: deliveryHeaders });
    }
    if (query.get('action') === 'preview') {
      const format = z.enum(['CSV', 'XLSX']).parse(query.get('format'));
      const result = await s.delivery.preview(
        ctx,
        z.uuid().parse(query.get('programme')),
        z.uuid().parse(request.headers.get('idempotency-key')),
        await boundedBody(request, 1048576),
        format,
      );
      return Response.json(result, { headers: deliveryHeaders });
    }
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new DomainError('JSON required', 415);
    const { action, input } = z
      .object({
        action: z.enum([
          'context',
          'agenda',
          'experience-publication',
          'participant-identity',
          'recipient-disclosure',
          'programme',
          'confirm',
          'publication',
          'share',
          'request',
          'closeRequest',
          'revoke',
        ]),
        input: z.unknown(),
      })
      .parse(JSON.parse((await boundedBody(request, 65536)).toString('utf8')));
    const extended = {
      context: () => s.deliveryExperience.context(ctx, input),
      agenda: () => s.deliveryExperience.agenda(ctx, input),
      'experience-publication': () => s.deliveryExperience.publication(ctx, input),
      'participant-identity': () => s.deliveryExperience.identity(ctx, input),
      'recipient-disclosure': () => s.deliveryExperience.disclosure(ctx, input),
    };
    if (action in extended)
      return Response.json(await extended[action as keyof typeof extended](), {
        headers: deliveryHeaders,
      });
    return Response.json(
      await s.delivery[action as Exclude<typeof action, keyof typeof extended>](ctx, input),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return deliveryError(error);
  }
}
export const GET = handle;
export const POST = handle;
