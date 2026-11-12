import type {
  OwnPaymentDeclarations,
  PaymentDeclaration,
  PendingPaymentDeclarations,
} from '@corridra/auth/customer-programme-economics';
import { TermsError } from './terms-client';

// Payment declarations: a participant says they paid, the organiser checks. A declaration is not proof of bank receipt.
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const maybeText = (v: unknown, max: number) =>
  v === null || (typeof v === 'string' && v.length >= 1 && v.length <= max);
const statuses = ['AWAITING_REVIEW', 'ACKNOWLEDGED', 'REJECTED'];

function parseDeclaration(v: unknown): PaymentDeclaration {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !uuid(v.registrationId) ||
    !/^[A-Z]{3}$/.test(String(v.currency)) ||
    typeof v.exponent !== 'number' ||
    !Number.isInteger(v.exponent) ||
    v.exponent < 0 ||
    v.exponent > 4 ||
    !/^[1-9][0-9]{0,17}$/.test(String(v.amountMinor)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(v.paidOn)) ||
    !maybeText(v.payerReference, 120) ||
    !maybeText(v.note, 500) ||
    typeof v.declaredAt !== 'string' ||
    !statuses.includes(String(v.status)) ||
    !maybeText(v.reason, 300) ||
    v.verified !== false ||
    (v.status === 'ACKNOWLEDGED') !== (v.acknowledgedAmountMinor !== null) ||
    (v.status === 'ACKNOWLEDGED') !== (v.acknowledgedOn !== null) ||
    (v.acknowledgedAmountMinor !== null &&
      !/^[1-9][0-9]{0,17}$/.test(String(v.acknowledgedAmountMinor))) ||
    (v.acknowledgedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.acknowledgedOn))) ||
    (v.status === 'REJECTED') !== (typeof v.reason === 'string') ||
    (v.outstandingMinor !== undefined && !/^-?[0-9]{1,40}$/.test(String(v.outstandingMinor)))
  )
    throw Error('Invalid payment declaration');
  return v as unknown as PaymentDeclaration;
}
export function parseOwnDeclarations(v: unknown, registrationId: string): OwnPaymentDeclarations {
  if (
    !object(v) ||
    v.registrationId !== registrationId ||
    v.provenance !== 'PARTICIPANT_DECLARED' ||
    v.verified !== false ||
    v.collectsPayments !== false ||
    !Array.isArray(v.declarations) ||
    v.declarations.length > 50
  )
    throw Error('Invalid payment declarations');
  v.declarations.forEach(parseDeclaration);
  return v as unknown as OwnPaymentDeclarations;
}
export function parsePending(
  v: unknown,
  workspaceId: string,
  programmeId: string,
): PendingPaymentDeclarations {
  if (
    !object(v) ||
    v.workspaceId !== workspaceId ||
    v.programmeId !== programmeId ||
    v.provenance !== 'PARTICIPANT_DECLARED' ||
    v.verified !== false ||
    !Array.isArray(v.declarations) ||
    v.declarations.length > 100
  )
    throw Error('Invalid payment declarations');
  v.declarations.forEach(parseDeclaration);
  return v as unknown as PendingPaymentDeclarations;
}

export type DeclarationApi = {
  get(query: Record<string, string>, signal?: AbortSignal): Promise<unknown>;
  post(input: Record<string, unknown>): Promise<unknown>;
};
export function declarationApi(subject: string, issuer: string): DeclarationApi {
  const headers = { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
  const url = '/api/customer-programme-payment-declarations';
  async function settle(r: Response) {
    const body: unknown = await r.json().catch(() => null);
    const changed =
      r.status === 409 &&
      object(body) &&
      typeof body.error === 'string' &&
      body.error.includes('account changed');
    if ([401, 403].includes(r.status) || changed) throw new TermsError('denied', 'Access changed');
    if (r.status === 503) throw new TermsError('unavailable', 'Unavailable');
    if (r.status === 409) throw new TermsError('conflict', 'Conflict');
    if (r.status === 400) throw new TermsError('invalid', 'Invalid');
    if (!r.ok) throw new TermsError('failed', 'Failed');
    return body;
  }
  return {
    async get(query, signal) {
      return settle(
        await fetch(url + '?' + new URLSearchParams(query), {
          cache: 'no-store',
          credentials: 'same-origin',
          headers,
          signal,
        }),
      );
    },
    async post(input) {
      let r: Response;
      try {
        r = await fetch(url, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(input),
        });
      } catch {
        throw new TermsError('retry', 'Not confirmed');
      }
      return settle(r);
    },
  };
}
export function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
