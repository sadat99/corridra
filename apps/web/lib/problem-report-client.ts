import {
  oneLine,
  plainTextAllowed,
  problemReportLimits,
  problemReportReference,
  sanitiseProblemPath,
  trimEdges,
  type ProblemReportCategory,
  type ProblemReportPageKind,
} from '@corridra/domain/problem-report';
import type {
  ProblemReportDetail,
  ProblemReportFiled,
  ProblemReportListItem,
  ProblemReportOwnWordsRemoved,
} from '@corridra/auth/problem-reports';
import { limitWords } from './account-limit';
import { failureWords, formWords, type ReportSide } from './problem-report-words';

// What the Report a Problem screens say to the two routes, and what each answer means to a person. The screens hold no
// rule of their own: the server and the database decide, and every rule checked here is the domain's, so a person is not
// sent to the server with what it would refuse. Types only come from the services: nothing server-side is bundled.

/** Who is asking: a customer (the session headers the account pages send) or a team member (the chosen workspace). */
export type ReportTarget =
  { side: 'customer'; headers: Record<string, string> } | { side: 'team'; tenant: string };

type Fetcher = typeof fetch;
type Call = { method: 'GET'; params: Record<string, string> } | { method: 'POST'; body: object };

/** One answer: the value, or the status the server gave (null when nothing usable came back) and its code. */
export type Reply<T> =
  { ok: true; value: T } | { ok: false; status: number | null; code: string | null };

// The code the server gives a closed account (accountClosedCode in packages/auth; a test holds the two together). Not
// imported: that module is server code and this one is bundled for the browser.
export const closedAccountCode = 'account_closed';

const routes = {
  customer: '/api/customer-problem-reports',
  team: '/api/workspace/problem-reports',
};

async function call<T>(target: ReportTarget, request: Call, fetcher: Fetcher): Promise<Reply<T>> {
  const params = new URLSearchParams(request.method === 'GET' ? request.params : {});
  if (target.side === 'team') params.set('tenant', target.tenant);
  const query = params.toString();
  try {
    const response = await fetcher(routes[target.side] + (query ? `?${query}` : ''), {
      method: request.method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(target.side === 'customer' ? target.headers : {}),
        ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(request.method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (body as { code?: unknown } | null)?.code;
      return { ok: false, status: response.status, code: typeof code === 'string' ? code : null };
    }
    return body === null ? { ok: false, status: null, code: null } : { ok: true, value: body as T };
  } catch {
    return { ok: false, status: null, code: null };
  }
}

export type FileBody = {
  category: ProblemReportCategory;
  pageKind: ProblemReportPageKind;
  page: string;
  detail?: string;
};

/** Files a problem report. A reply that is not a reference is no answer, so the same command is sent again. */
export async function fileProblemReport(
  target: ReportTarget,
  commandId: string,
  body: FileBody,
  fetcher: Fetcher = fetch,
): Promise<Reply<ProblemReportFiled>> {
  const reply = await call<ProblemReportFiled>(
    target,
    {
      method: 'POST',
      body: { ...(target.side === 'team' ? { action: 'file' } : {}), commandId, ...body },
    },
    fetcher,
  );
  return reply.ok && typeof reply.value.reference !== 'string'
    ? { ok: false, status: null, code: null }
    : reply;
}

export type ReportPage = { items: ProblemReportListItem[]; nextBefore: number | null };

export async function readProblemReports(
  target: ReportTarget,
  pageSize: number,
  beforeNumber: number | null,
  fetcher: Fetcher = fetch,
): Promise<Reply<ReportPage>> {
  const params: Record<string, string> = { pageSize: String(pageSize) };
  if (beforeNumber !== null) params.beforeNumber = String(beforeNumber);
  const reply = await call<ReportPage>(
    target,
    { method: 'GET', params: target.side === 'team' ? { view: 'mine', ...params } : params },
    fetcher,
  );
  return reply.ok && !Array.isArray(reply.value.items)
    ? { ok: false, status: null, code: null }
    : reply;
}

export async function readProblemReport(
  target: ReportTarget,
  reference: string,
  fetcher: Fetcher = fetch,
): Promise<Reply<ProblemReportDetail>> {
  const reply = await call<ProblemReportDetail>(
    target,
    { method: 'GET', params: { reference } },
    fetcher,
  );
  return reply.ok && typeof reply.value.reference !== 'string'
    ? { ok: false, status: null, code: null }
    : reply;
}

/** The customer's own removal. The count is read from the answer and from nowhere else. */
export async function removeOwnWords(
  headers: Record<string, string>,
  commandId: string,
  fetcher: Fetcher = fetch,
): Promise<Reply<ProblemReportOwnWordsRemoved>> {
  const reply = await call<ProblemReportOwnWordsRemoved>(
    { side: 'customer', headers },
    { method: 'POST', body: { action: 'remove_words', commandId } },
    fetcher,
  );
  return reply.ok && !(Number.isInteger(reply.value.removed) && reply.value.removed >= 0)
    ? { ok: false, status: null, code: null }
    : reply;
}

/** What to say, and which way out to offer beside it. */
export type FailureLine = { message: string; link: 'sign_in' | 'return' | 'list' | null };

/** Filing. Every status the form can meet, and a dropped connection (status null). */
export function fileFailure(status: number | null, code: string | null): FailureLine {
  if (status === null) return { message: failureWords.fileNetwork, link: null };
  if (status === 400) return { message: formWords.errorPlain, link: null };
  if (status === 401) return { message: failureWords.signedOut, link: 'sign_in' };
  if (status === 403 && code === closedAccountCode)
    return { message: failureWords.closed, link: 'list' };
  if (status === 403) return { message: failureWords.forbidden, link: 'return' };
  if (status === 429) return { message: limitWords, link: null };
  if (status === 503)
    return {
      message: `${failureWords.unavailable} ${failureWords.unavailableFile}`,
      link: null,
    };
  return { message: failureWords.fileServer, link: null };
}

/** Reading the list or one report: `generic` is the line for a connection or server that did not answer. */
export function readFailure(
  status: number | null,
  generic: string,
  notFound?: string,
): FailureLine {
  if (status === 401) return { message: failureWords.signedOut, link: 'sign_in' };
  if (status === 403) return { message: failureWords.readForbidden, link: null };
  if (status === 404 && notFound) return { message: notFound, link: null };
  if (status === 429) return { message: limitWords, link: null };
  if (status === 503) return { message: failureWords.unavailable, link: null };
  return { message: generic, link: null };
}

/** Removing the customer's own words. */
export function removalFailure(status: number | null): FailureLine {
  if (status === 401) return { message: failureWords.signedOutAgain, link: 'sign_in' };
  if (status === 403) return { message: failureWords.removalForbidden, link: null };
  if (status === 429) return { message: limitWords, link: null };
  if (status === 503) return { message: failureWords.unavailable, link: null };
  return { message: failureWords.removalFailed, link: null };
}

/**
 * One command id for one send, reused for every retry of the same words so a dropped connection never files twice. When
 * the words change, a new id is made: the same id with other words is a conflict the server refuses.
 */
export type Attempt = { id: string; key: string };
export function attemptFor(previous: Attempt | null, key: string, make: () => string): Attempt {
  return previous && previous.key === key ? previous : { id: make(), key };
}

export type Draft = {
  category: ProblemReportCategory | '';
  where: ProblemReportPageKind;
  pageText: string;
  detail: string;
};
export type DraftErrors = Partial<Record<'category' | 'page' | 'detail', string>>;

/** The checks of the first step, in the order of the form. Empty means the draft may go on. */
export function draftErrors(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.category) errors.category = formWords.errorCategory;
  if (draft.where === 'another_page') {
    const page = trimEdges(draft.pageText);
    if ([...page].length === 0) errors.page = formWords.errorPage;
    else if (!plainTextAllowed(page)) errors.page = formWords.errorPlain;
  }
  const detail = oneLine(draft.detail);
  if (
    draft.category === 'something_else' &&
    [...detail].length < problemReportLimits.somethingElseDetail
  )
    errors.detail = formWords.errorDetail;
  else if (detail && !plainTextAllowed(detail)) errors.detail = formWords.errorPlain;
  return errors;
}

/** The body for a draft that passed `draftErrors`; the page of "This page" is the masked path of the person's own shell. */
export function fileBody(draft: Draft, maskedPath: string | null): FileBody {
  const detail = oneLine(draft.detail);
  return {
    category: draft.category as ProblemReportCategory,
    pageKind: draft.where,
    page: draft.where === 'this_page' && maskedPath ? maskedPath : trimEdges(draft.pageText),
    ...(detail ? { detail } : {}),
  };
}

/** The page a person came from (the `from` of the address): its stored form and where "Go Back" leads, or null. */
export type FromPage = { masked: string; returnTo: string };
export function readFromPage(
  raw: string | string[] | undefined,
  side: ReportSide,
): FromPage | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const masked = sanitiseProblemPath(value, side);
  // The sanitiser has refused anything that is not a path of the person's own shell, so this stays on this site.
  return masked ? { masked, returnTo: new URL(value, 'https://path.invalid').pathname } : null;
}

/** A reference is asked for only when the database could hold it. */
export const referenceAsked = (reference: string) =>
  problemReportReference.safeParse(reference).success;
