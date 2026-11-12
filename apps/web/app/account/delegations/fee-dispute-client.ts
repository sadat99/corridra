import type {
  FeeDispute,
  FeeDisputeReason,
  OpenFeeDisputes,
  OwnFeeDisputes,
} from '@corridra/auth/customer-programme-economics';
import { TermsError } from './terms-client';

// Fee questions: a participant flags a question about their own fee or payment status, the organiser answers with one word.
// Record only. Nothing here reads or changes an amount.
export const reasonWords: Record<FeeDisputeReason, string> = {
  AMOUNT_WRONG: 'The amount looks wrong',
  ALREADY_PAID: 'I have already paid',
  NOT_ATTENDING: 'I am not attending',
  OTHER: 'Something else',
};
export const statusWords: Record<FeeDispute['status'], string> = {
  OPEN: 'Waiting for the organiser',
  RESOLVED: 'Marked as sorted out by the organiser',
  DECLINED: 'Organiser has not changed anything',
};
const reasons = Object.keys(reasonWords);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function parseDispute(v: unknown) {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !uuid(v.registrationId) ||
    !reasons.includes(String(v.reason)) ||
    typeof v.filedAt !== 'string' ||
    !['OPEN', 'RESOLVED', 'DECLINED'].includes(String(v.status)) ||
    (v.status === 'OPEN') !== (v.decidedAt === null)
  )
    throw Error('Invalid fee question');
}
export function parseOwnDisputes(v: unknown, registrationId: string): OwnFeeDisputes {
  if (
    !object(v) ||
    v.registrationId !== registrationId ||
    v.recordOnly !== true ||
    v.collectsPayments !== false ||
    !Array.isArray(v.disputes) ||
    v.disputes.length > 50
  )
    throw Error('Invalid fee questions');
  v.disputes.forEach(parseDispute);
  return v as unknown as OwnFeeDisputes;
}
export function parseOpenDisputes(
  v: unknown,
  workspaceId: string,
  programmeId: string,
): OpenFeeDisputes {
  if (
    !object(v) ||
    v.workspaceId !== workspaceId ||
    v.programmeId !== programmeId ||
    v.recordOnly !== true ||
    !Array.isArray(v.disputes) ||
    v.disputes.length > 100
  )
    throw Error('Invalid fee questions');
  v.disputes.forEach(parseDispute);
  return v as unknown as OpenFeeDisputes;
}

export type DisputeApi = {
  get(query: Record<string, string>): Promise<unknown>;
  post(input: Record<string, unknown>): Promise<unknown>;
};
export function disputeApi(subject: string, issuer: string): DisputeApi {
  const headers = { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
  const url = '/api/customer-programme-fee-disputes';
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
    async get(query) {
      return settle(
        await fetch(url + '?' + new URLSearchParams(query), {
          cache: 'no-store',
          credentials: 'same-origin',
          headers,
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
