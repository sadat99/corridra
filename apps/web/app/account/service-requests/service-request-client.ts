import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import type {
  ServiceCatalogueEntry,
  ServiceRequestDetail,
  ServiceRequestSummary,
  ServiceStatus,
} from '@corridra/auth/customer-service-requests';

export type { ServiceCatalogueEntry, ServiceRequestDetail, ServiceRequestSummary, ServiceStatus };
export type Scope = { subject: string; issuer: string };
export type Outcome<T> =
  { ok: true; data: T } | { ok: false; status: number | 'network' | 'malformed' };
export type ListResult = {
  workspaceId: string;
  canRequest: boolean;
  requests: ServiceRequestSummary[];
  nextAfter: string | null;
  expiresAt: string;
};
export type CatalogueResult = { services: ServiceCatalogueEntry[]; expiresAt: string };

const endpoint = '/api/customer-service-requests';
// Identity comes from the server session. These headers only let the server refuse a switched account.
export async function callServiceApi<T>(
  scope: Scope,
  query: Record<string, string> | null,
  body: Record<string, unknown> | null,
  check: (value: unknown) => boolean,
  signal?: AbortSignal,
): Promise<Outcome<T>> {
  try {
    const response = await fetch(
      endpoint + (query ? '?' + new URLSearchParams(query).toString() : ''),
      {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'x-corridra-customer-subject': scope.subject,
          'x-corridra-customer-issuer': scope.issuer,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const data: unknown = await response.json();
    return check(data) ? { ok: true, data: data as T } : { ok: false, status: 'malformed' };
  } catch {
    return { ok: false, status: 'network' };
  }
}

// A network failure, an unreadable answer or a server fault leaves it unknown whether the change was saved.
// The caller then retries with the same command id, which can never apply twice.
export function unconfirmed(status: number | 'network' | 'malformed') {
  return typeof status === 'string' || (status >= 500 && status !== 503);
}
// Plain wording for every failure. The server never explains which rule fired, so neither do we.
export function problemText(status: number | 'network' | 'malformed', doing: string): string {
  if (status === 401 || status === 403)
    return 'You no longer have access here, or your sign-in ended. Return to your account and try again.';
  if (status === 409)
    return 'That could not be saved because something has changed, or an open request for this service already exists here. Reload and check.';
  if (status === 400)
    return 'Some details need another look. Every text field must start with the word Synthetic.';
  if (status === 503) return 'Paid-service requests are not switched on here.';
  return 'Could not ' + doing + '. Check your connection and try again.';
}

export const statusLabel: Record<
  ServiceStatus,
  { text: string; tone: 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown' }
> = {
  requested: { text: 'Waiting for a quote', tone: 'info' },
  quoted: { text: 'Quote ready for you', tone: 'caution' },
  accepted: { text: 'Accepted, work not started', tone: 'positive' },
  declined: { text: 'Quote declined', tone: 'unknown' },
  withdrawn: { text: 'Request withdrawn', tone: 'unknown' },
  expired: { text: 'Quote expired', tone: 'caution' },
  in_progress: { text: 'In progress', tone: 'info' },
  delivered: { text: 'Delivered', tone: 'positive' },
  closed: { text: 'Closed', tone: 'unknown' },
};
export const kindText: Record<string, string> = {
  requested: 'You asked for help',
  revised: 'The request was updated',
  quoted: 'A quote was prepared',
  question: 'A question was asked',
  answer: 'The team answered',
  accepted: 'Quote accepted. No payment taken.',
  declined: 'Quote declined',
  withdrawn: 'Request withdrawn',
  expired: 'The quote ran out of time',
  started: 'Work started',
  update: 'Progress update',
  delivered: 'Delivered',
  closed: 'Closed',
};
export const contextText: Record<string, string> = {
  request: 'Private request',
  programme: 'Delegation programme',
  company: 'Company',
};
export const treatmentText: Record<string, string> = {
  included: 'Included in the price',
  estimate: 'Estimate, added on top',
  not_included: 'Not included',
};
export const componentKindText: Record<string, string> = {
  service_fee: 'Service fee',
  local_cost: 'Local cost',
  pass_through: 'Passed through at cost',
  tax: 'Tax',
};
export const basisText: Record<string, string> = {
  per_day: 'Priced per day',
  per_visit: 'Priced per visit',
  per_item: 'Priced per item',
  fixed_scope: 'Priced for a fixed scope',
};
export function validList(value: unknown): value is ListResult {
  const v = value as ListResult | null;
  return (
    !!v &&
    typeof v.workspaceId === 'string' &&
    typeof v.canRequest === 'boolean' &&
    Array.isArray(v.requests) &&
    v.requests.every((r) => typeof r.id === 'string' && typeof r.status === 'string') &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}
export function validCatalogue(value: unknown): value is CatalogueResult {
  const v = value as CatalogueResult | null;
  return (
    !!v &&
    Array.isArray(v.services) &&
    v.services.every(
      (s) => typeof s.key === 'string' && Array.isArray(s.included) && Array.isArray(s.regions),
    )
  );
}
export function validDetail(value: unknown): value is ServiceRequestDetail {
  const v = value as ServiceRequestDetail | null;
  return (
    !!v &&
    customerProvenanceAllowed(v.synthetic) &&
    typeof v.workspaceId === 'string' &&
    !!v.request &&
    typeof v.request.id === 'string' &&
    !!v.need &&
    Array.isArray(v.timeline) &&
    Array.isArray(v.actions) &&
    (v.quote === null ||
      (Array.isArray(v.quote.components) && Array.isArray(v.quote.exclusions))) &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}
export function dayText(day: string | null) {
  if (!day) return null;
  const parsed = new Date(day.slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
}
export function dateTimeText(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' UTC';
}
