import { DomainError } from '@corridra/domain';
import { problemReportError } from '@corridra/auth/problem-reports';
import { limitWords } from './account-limit';
import { boundedBody, deliveryError, deliveryHeaders } from './delivery-http';
import { foundations } from './foundations';

// What the two problem report routes share (ADR-078): the services, the guarded JSON body of a POST and the one way a
// refusal is answered. The routes themselves only say which session they read and which service they call.
const unavailable = 'Problem reports are not available yet.';

export async function problemReportServices() {
  const s = foundations();
  if (!s) throw new DomainError(unavailable, 503, 'unavailable');
  await s.ready;
  return s;
}

// A POST must come from this application, carry JSON and stay small. The refusals leave the database alone.
export function problemReportOrigin(request: Request, appOrigin: string) {
  if (request.headers.get('origin') !== new URL(appOrigin).origin)
    throw new DomainError('Request origin is not allowed', 403);
}
export async function problemReportBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new DomainError('JSON required', 415);
  return JSON.parse((await boundedBody(request, 8192)).toString('utf8')) as unknown;
}

// The module's own mapper first, because the shared delivery mapper turns every 23514 into a 409. A step-up request
// keeps its code, and the limit is said in the one sentence every account action uses.
export function problemReportFailure(error: unknown) {
  const mapped = problemReportError(error);
  if (!(mapped instanceof DomainError)) return deliveryError(mapped);
  return Response.json(
    {
      error: mapped.status === 429 ? limitWords : mapped.message,
      ...(mapped.code ? { code: mapped.code } : {}),
    },
    { status: mapped.status, headers: deliveryHeaders },
  );
}
