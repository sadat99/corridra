import { z } from 'zod';
import {
  customerProblemReportInput,
  problemReportListQuery,
} from '@corridra/domain/problem-report';
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
    if ('reference' in query)
      return Response.json(
        await s.customerProblemReports.get(
          one.parse(query).reference,
          subject(request),
          issuer(request),
        ),
        { headers: deliveryHeaders },
      );
    const { pageSize } = problemReportListQuery.parse(query);
    const items = await s.customerProblemReports.list(query, subject(request), issuer(request));
    return Response.json(
      { items, nextBefore: items.length === pageSize ? items[items.length - 1]!.number : null },
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return problemReportFailure(error);
  }
}

// Files a problem report. The command id makes a retry safe: the same id with the same words answers again.
export async function POST(request: Request) {
  try {
    const s = await problemReportServices();
    problemReportOrigin(request, s.config.APP_ORIGIN);
    const input = customerProblemReportInput.parse(await problemReportBody(request));
    const client = process.env.VERCEL
      ? (request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local';
    await s.missions.budget(client);
    return Response.json(
      await s.customerProblemReports.file(input, subject(request), issuer(request)),
      { headers: deliveryHeaders },
    );
  } catch (error) {
    return problemReportFailure(error);
  }
}
