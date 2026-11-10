import { DomainError } from '@corridra/domain';
import {
  customerProblemReportInput,
  problemReportListQuery,
  problemReportQueueQuery,
  problemReportReference,
  problemReportRemoveWordsInput,
  problemReportTransitionInput,
  teamProblemReportFileInput,
  type ProblemReportCategory,
  type ProblemReportPageKind,
  type ProblemReportStatus,
  type ProblemReporterKind,
} from '@corridra/domain/problem-report';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
import { accountClosedCode } from './customer-account-gate';
import { CustomerSessionBoundary } from './customer-session';

// Problem reports (ADR-078, Help > Report a Problem). Three services over the optional database module: a customer files
// and reads their own reports, a team member does the same in the selected staff workspace, and owners and admins of a
// staff workspace read the queue and move a report along with a note the reporter reads. No service here accepts a person
// id, a side or a reporter: the database takes them from the signed-in session, and repeats every rule the domain checks.
// Nothing is sent, so there is no event, email or outbox row. The routes are in apps/web.

export type ProblemReportHistory = {
  state: ProblemReportStatus;
  note: string | null;
  createdAt: string;
};
export type ProblemReportFiled = {
  reference: string;
  status: 'received';
  filedAt: string;
  changed: boolean;
};
export type ProblemReportListItem = {
  reference: string;
  number: number;
  category: ProblemReportCategory;
  filedAt: string;
  status: ProblemReportStatus;
  updatedAt: string;
  wordsRemoved: boolean;
};
export type ProblemReportDetail = {
  reference: string;
  category: ProblemReportCategory;
  filedAt: string;
  status: ProblemReportStatus;
  updatedAt: string;
  // Removed under an erasure request, or what the reporter wrote.
  words:
    { removed: true } | { pageKind: ProblemReportPageKind; page: string; detail: string | null };
  history: ProblemReportHistory[];
};
export type ProblemReportQueueItem = {
  id: string;
  number: number;
  reference: string;
  reporterKind: ProblemReporterKind;
  filedAt: string;
  category: ProblemReportCategory;
  side: 'sample' | 'real';
  status: ProblemReportStatus;
  updatedAt: string;
  wordsRemoved: boolean;
  // Null when the words were removed under an erasure request.
  pageKind: ProblemReportPageKind | null;
  page: string | null;
  detail: string | null;
  history: ProblemReportHistory[];
};
export type ProblemReportQueue = {
  items: ProblemReportQueueItem[];
  total: number;
  counts: Record<ProblemReportStatus, number>;
  oldestReceivedAt: string | null;
  // The number to ask for the next page after, while a full page came back.
  nextAfter: number | null;
};
export type ProblemReportMoved = {
  id: string;
  reference: string;
  status: ProblemReportStatus;
  note: string | null;
  changed: boolean;
};
export type ProblemReportWordsRemoved = { reference: string; removed: number };

// Only these fields leave a service: a field the database adds later is not shown by default.
const history = (rows: ProblemReportHistory[] | null): ProblemReportHistory[] =>
  (rows ?? []).map((row) => ({ state: row.state, note: row.note, createdAt: row.createdAt }));
const listItem = (row: ProblemReportListItem): ProblemReportListItem => ({
  reference: row.reference,
  number: row.number,
  category: row.category,
  filedAt: row.filedAt,
  status: row.status,
  updatedAt: row.updatedAt,
  wordsRemoved: row.wordsRemoved,
});
const reportDetail = (row: ProblemReportDetail): ProblemReportDetail => ({
  reference: row.reference,
  category: row.category,
  filedAt: row.filedAt,
  status: row.status,
  updatedAt: row.updatedAt,
  words:
    'removed' in row.words
      ? { removed: true }
      : { pageKind: row.words.pageKind, page: row.words.page, detail: row.words.detail },
  history: history(row.history),
});
const reportFiled = (row: ProblemReportFiled): ProblemReportFiled => ({
  reference: row.reference,
  status: 'received',
  filedAt: row.filedAt,
  changed: row.changed,
});

const unavailable = 'Problem reports are not available yet.';
const notFound = 'Problem report not found';
const conflicts = new Set([
  'Command conflicts with original request',
  'This problem report has changed. Reload and try again',
  'That change is not allowed from this status',
  'Words can be removed only for an erasure request that is in progress or completed',
]);
// Turns what the database refused into what a person can act on. A message the database wrote is repeated only when this
// list names it; anything else is said in general words, so no internals leave. A DomainError (access, step-up, not
// available) passes through unchanged.
export function problemReportError(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  if (error === null || error === undefined) return error;
  const { code, message } = error as { code?: string; message?: string };
  switch (code) {
    case '42501':
      return new DomainError('You cannot do this with problem reports from this account.', 403);
    case '22023':
      return new DomainError('Check the submitted values.', 400);
    case '23514':
      if (message === notFound || message === 'Erasure request not found')
        return new DomainError(message, 404);
      if (message === 'That account is closed')
        return new DomainError(message, 403, accountClosedCode);
      if (message !== undefined && conflicts.has(message)) return new DomainError(message, 409);
      return new DomainError(
        'The request conflicts with the current state. Reload and try again.',
        409,
      );
    case '54000':
      return new DomainError('Too many problem reports in the last 24 hours', 429, 'limit');
    case '42P01':
    case '3F000':
    case '42883':
      return new DomainError(unavailable, 503, 'unavailable');
    default:
      return error;
  }
}

// Module 0001 alone has the filing and reading functions, but its plain-text rule is the narrower one and its word
// removal has no time bound. Migration 0002 only replaces the bodies of two functions, so the one thing the catalogue
// shows of it is those bodies: the plain-text rule names the direction characters U+2066 to U+2069 and the word removal
// has a cutoff. Both are read from pg_proc.prosrc, which every login may read and which is the same on every PostgreSQL
// major version (pg_get_functiondef is not). A later module file keeps both words. Until both are there the service
// refuses before it reads or writes anything. An installed module is remembered for the life of the process; a missing
// one is checked again after a minute, so the routes work soon after the install without a redeploy.
const reprobeAfterMs = 60000;
let probe: { installed: boolean; at: number } | undefined;
export function resetProblemReportProbe() {
  probe = undefined;
}
async function installed(db: DatabaseClient) {
  const now = Date.now();
  if (probe && (probe.installed || now - probe.at < reprobeAfterMs)) return probe.installed;
  const row = (
    await db.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='customer' AND p.proname='problem_report_command' AND p.pronargs=2
          AND p.proargtypes[0]='uuid'::regtype AND p.proargtypes[1]='jsonb'::regtype)
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='customer_private' AND p.proname='problem_report_plain' AND p.pronargs=3
          AND position(chr(92)||'u2066-'||chr(92)||'u2069' IN p.prosrc)>0)
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='customer' AND p.proname='problem_report_remove_words' AND p.pronargs=2
          AND position('cutoff' IN p.prosrc)>0) AS installed`,
    )
  ).rows[0];
  probe = { installed: row?.installed === true, at: now };
  return probe.installed;
}
async function requireInstalled(db: DatabaseClient) {
  if (!(await installed(db))) throw new DomainError(unavailable, 503, 'unavailable');
}
// A reference the database could not hold is answered like an unknown one, without asking it.
function readReference(value: unknown) {
  const reference = problemReportReference.safeParse(value);
  if (!reference.success) throw new DomainError(notFound, 404);
  return reference.data;
}

// A customer's own reports. A person with no workspace may file, and a closed account can read but not file (the database
// says so), so the closed-account gate of the boundary is not used. The signed-in provider session decides who acts.
export class CustomerProblemReports extends CustomerSessionBoundary {
  private async run<T>(
    work: (db: DatabaseClient) => Promise<T>,
    subject?: string,
    issuer?: string,
  ) {
    try {
      return await this.transaction(
        async (db) => {
          await requireInstalled(db);
          return work(db);
        },
        subject,
        issuer,
        undefined,
        { allowClosedAccount: true },
      );
    } catch (error) {
      throw problemReportError(error);
    }
  }

  async file(input: unknown, subject?: string, issuer?: string): Promise<ProblemReportFiled> {
    const { commandId, ...words } = customerProblemReportInput.parse(input);
    return reportFiled(
      await this.run(
        async (db) =>
          (
            await db.query<{ result: ProblemReportFiled }>(
              'SELECT customer.problem_report_command($1,$2) AS result',
              [commandId, JSON.stringify(words)],
            )
          ).rows[0]!.result,
        subject,
        issuer,
      ),
    );
  }

  async list(query: unknown, subject?: string, issuer?: string): Promise<ProblemReportListItem[]> {
    const { beforeNumber, pageSize } = problemReportListQuery.parse(query);
    const rows = await this.run(
      async (db) =>
        (
          await db.query<{ rows: ProblemReportListItem[] }>(
            'SELECT customer.problem_report_list($1,$2) AS rows',
            [beforeNumber ?? null, pageSize],
          )
        ).rows[0]!.rows,
      subject,
      issuer,
    );
    return rows.map(listItem);
  }

  async get(reference: unknown, subject?: string, issuer?: string): Promise<ProblemReportDetail> {
    const wanted = readReference(reference);
    return reportDetail(
      await this.run(
        async (db) =>
          (
            await db.query<{ result: ProblemReportDetail }>(
              'SELECT customer.problem_report_get($1) AS result',
              [wanted],
            )
          ).rows[0]!.result,
        subject,
        issuer,
      ),
    );
  }
}

// A team member's own reports, filed in the selected staff workspace. Any of the five roles; the database repeats the
// role, the live session and the sample or real rule.
export class TeamProblemReports {
  constructor(private runtime: DatabasePool) {}

  private async run<T>(ctx: RequestContext, work: (db: DatabaseClient) => Promise<T>) {
    try {
      return await withTenant(this.runtime, ctx, 'problems.report', async (t) => {
        await requireInstalled(t.db);
        return work(t.db);
      });
    } catch (error) {
      throw problemReportError(error);
    }
  }

  async file(ctx: RequestContext, input: unknown): Promise<ProblemReportFiled> {
    const value = teamProblemReportFileInput.parse(input);
    return reportFiled(
      await this.run(
        ctx,
        async (db) =>
          (
            await db.query<{ result: ProblemReportFiled }>(
              'SELECT app.problem_report_command($1,$2) AS result',
              [
                value.commandId,
                JSON.stringify({
                  category: value.category,
                  pageKind: value.pageKind,
                  page: value.page,
                  detail: value.detail,
                }),
              ],
            )
          ).rows[0]!.result,
      ),
    );
  }

  async list(ctx: RequestContext, query: unknown): Promise<ProblemReportListItem[]> {
    const { beforeNumber, pageSize } = problemReportListQuery.parse(query);
    const rows = await this.run(
      ctx,
      async (db) =>
        (
          await db.query<{ rows: ProblemReportListItem[] }>(
            'SELECT app.problem_report_list($1,$2) AS rows',
            [beforeNumber ?? null, pageSize],
          )
        ).rows[0]!.rows,
    );
    return rows.map(listItem);
  }

  async get(ctx: RequestContext, reference: unknown): Promise<ProblemReportDetail> {
    const wanted = readReference(reference);
    return reportDetail(
      await this.run(
        ctx,
        async (db) =>
          (
            await db.query<{ result: ProblemReportDetail }>(
              'SELECT app.problem_report_get($1) AS result',
              [wanted],
            )
          ).rows[0]!.result,
      ),
    );
  }
}

// Owners and admins of a staff workspace with a fresh authenticator check (problems.triage), through the support
// authority of the module, which is separate from the privacy authority. Removing words under an erasure request keeps
// the erasure queue's own permission (members.manage), because it runs under the erasure authority.
export class StaffProblemReports {
  constructor(private runtime: DatabasePool) {}

  async queue(ctx: RequestContext, query: unknown): Promise<ProblemReportQueue> {
    const { afterNumber, pageSize, status } = problemReportQueueQuery.parse(query);
    try {
      const page = await withTenant(this.runtime, ctx, 'problems.triage', async (t) => {
        await requireInstalled(t.db);
        return (
          await t.db.query<{ result: Omit<ProblemReportQueue, 'nextAfter'> }>(
            'SELECT customer.problem_report_queue($1,$2,$3) AS result',
            [afterNumber ?? null, pageSize, status ?? null],
          )
        ).rows[0]!.result;
      });
      const items: ProblemReportQueueItem[] = page.items.map((row) => ({
        id: row.id,
        number: row.number,
        reference: row.reference,
        reporterKind: row.reporterKind,
        filedAt: row.filedAt,
        category: row.category,
        side: row.side,
        status: row.status,
        updatedAt: row.updatedAt,
        wordsRemoved: row.wordsRemoved,
        pageKind: row.pageKind,
        page: row.page,
        detail: row.detail,
        history: history(row.history),
      }));
      return {
        items,
        total: page.total,
        counts: {
          received: page.counts.received,
          in_review: page.counts.in_review,
          resolved: page.counts.resolved,
          closed: page.counts.closed,
        },
        oldestReceivedAt: page.oldestReceivedAt,
        nextAfter: items.length === pageSize ? items[items.length - 1]!.number : null,
      };
    } catch (error) {
      throw problemReportError(error);
    }
  }

  async transition(ctx: RequestContext, input: unknown): Promise<ProblemReportMoved> {
    const value = problemReportTransitionInput.parse(input);
    try {
      const done = await withTenant(this.runtime, ctx, 'problems.triage', async (t) => {
        await requireInstalled(t.db);
        return (
          await t.db.query<{ result: ProblemReportMoved }>(
            'SELECT customer.problem_report_transition($1,$2,$3,$4,$5) AS result',
            [
              value.commandId,
              value.reportId,
              value.expectedState,
              value.toState,
              value.note ?? null,
            ],
          )
        ).rows[0]!.result;
      });
      return {
        id: done.id,
        reference: done.reference,
        status: done.status,
        note: done.note,
        changed: done.changed,
      };
    } catch (error) {
      throw problemReportError(error);
    }
  }

  async removeWords(ctx: RequestContext, input: unknown): Promise<ProblemReportWordsRemoved> {
    const value = problemReportRemoveWordsInput.parse(input);
    try {
      const done = await withTenant(this.runtime, ctx, 'members.manage', async (t) => {
        await requireInstalled(t.db);
        return (
          await t.db.query<{ result: ProblemReportWordsRemoved }>(
            'SELECT customer.problem_report_remove_words($1,$2) AS result',
            [value.commandId, value.erasureRequestId],
          )
        ).rows[0]!.result;
      });
      return { reference: done.reference, removed: done.removed };
    } catch (error) {
      throw problemReportError(error);
    }
  }
}
