import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerAccountLifecycleEnabled } from '@corridra/auth/customer-account-lifecycle';
import { problemReportListQuery, teamProblemReportAction } from '@corridra/domain/problem-report';
import { deliveryHeaders } from '../../../../lib/delivery-http';
import {
  problemReportBody,
  problemReportFailure,
  problemReportOrigin,
  problemReportServices,
} from '../../../../lib/problem-report-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Problem reports of the team (ADR-078). The operator session and the selected staff workspace are the existing ones, and
// the database repeats them. A customer session is not read here, and the customer route reads no operator session.
// GET: the signed-in member's own reports (view=mine, the default, or one with reference=), or the triage queue
// (view=queue, owners and admins with a fresh authenticator check). POST by action: file, transition, remove_words. There
// is no scope input: the database decides sample or real from the staff workspace. Until the optional module is installed
// every method answers 503 and touches nothing.
const scope = z
  .object({ tenant: z.uuid(), view: z.enum(['mine', 'queue']).default('mine') })
  .catchall(z.string());
const one = z.object({ reference: z.string() }).strict();

async function context(s: Awaited<ReturnType<typeof problemReportServices>>, request: Request) {
  const identity = await s.provider.getSession(request.headers);
  if (!identity) throw new DomainError('Sign in to continue', 401);
  const { tenant, view, ...query } = scope.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return {
    ctx: { token: identity.token, tenantId: tenant, purpose: 'synthetic_validation' },
    view,
    query,
  };
}

export async function GET(request: Request) {
  try {
    const s = await problemReportServices();
    const { ctx, view, query } = await context(s, request);
    if (view === 'queue')
      return Response.json(await s.staffProblemReports.queue(ctx, query), {
        headers: deliveryHeaders,
      });
    if ('reference' in query)
      return Response.json(await s.teamProblemReports.get(ctx, one.parse(query).reference), {
        headers: deliveryHeaders,
      });
    const { pageSize } = problemReportListQuery.parse(query);
    const items = await s.teamProblemReports.list(ctx, query);
    return Response.json(
      { items, nextBefore: items.length === pageSize ? items[items.length - 1]!.number : null },
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return problemReportFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const s = await problemReportServices();
    problemReportOrigin(request, s.config.APP_ORIGIN);
    const { ctx } = await context(s, request);
    const input = teamProblemReportAction.parse(await problemReportBody(request));
    if (input.action === 'remove_words') {
      // Removing words runs under the erasure authority, so it follows the erasure queue's own switch (the account
      // lifecycle), exactly as the sibling erasure queue route does. Filing, reading and triage do not.
      if (!customerAccountLifecycleEnabled())
        throw new DomainError('Word removal is unavailable', 503);
      return Response.json(await s.staffProblemReports.removeWords(ctx, input), {
        headers: deliveryHeaders,
      });
    }
    const done =
      input.action === 'file'
        ? await s.teamProblemReports.file(ctx, input)
        : await s.staffProblemReports.transition(ctx, input);
    return Response.json(done, { headers: deliveryHeaders });
  } catch (error) {
    return problemReportFailure(error);
  }
}
