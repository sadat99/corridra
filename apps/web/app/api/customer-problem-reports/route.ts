import { z } from 'zod';
import { problemReportListQuery } from '@corridra/domain/problem-report';
import { deliveryHeaders } from '../../../lib/delivery-http';
import {
  problemReportBody,
  problemReportFailure,
  problemReportOrigin,
  problemReportServices,
} from '../../../lib/problem-report-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A customer's own problem reports (ADR-078). The signed-in customer session decides who acts: no person id, workspace,
// side or reporter is read from the body or the query, a person with no workspace may file, and a closed account can
// read but not file. Until the optional database module is installed every method answers 503 and touches nothing.
const subject = (request: Request) =>
  request.headers.get('x-corridra-customer-subject') ?? undefined;
const issuer = (request: Request) => request.headers.get('x-corridra-customer-issuer') ?? undefined;
const one = z.object({ reference: z.string() }).strict();

export async function GET(request: Request) {
  try {
    const s = await problemReportServices();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    // Nothing the caller sent is checked until the service knows who is asking: the service reads these functions and the
    // query only after the session, so a signed-out caller gets the same 401 whatever the query looks like.
    if ('reference' in query)
      return Response.json(
        await s.customerProblemReports.get(
          () => one.parse(query).reference,
          subject(request),
          issuer(request),
        ),
        { headers: deliveryHeaders },
      );
    const items = await s.customerProblemReports.list(query, subject(request), issuer(request));
    const { pageSize } = problemReportListQuery.parse(query);
    return Response.json(
      { items, nextBefore: items.length === pageSize ? items[items.length - 1]!.number : null },
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return problemReportFailure(error);
  }
}

// Files a problem report. The command id makes a retry safe: the same id with the same words answers again. Only the
// origin is checked before the session; the request budget is spent, and the body is read, limited and checked, after it
// and before any database connection is taken, so a signed-out caller always gets a 401 and a slow body holds no connection.
export async function POST(request: Request) {
  try {
    const s = await problemReportServices();
    problemReportOrigin(request, s.config.APP_ORIGIN);
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    return Response.json(
      await s.customerProblemReports.file(
        () => problemReportBody(request),
        subject(request),
        issuer(request),
        () => s.missions.budget(client),
      ),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return problemReportFailure(error);
  }
}
