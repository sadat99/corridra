// "Also waiting" on the team Today page (owner mandate F, 11 Nov 2026): problem reports and erasure requests that
// today live only in Settings. Pure functions over the two existing queue reads. Nothing here reads, writes or decides
// access; the server still repeats the role check. A tile whose source is not available is absent, never zero.
import { canTriage } from '../problem-report-queue';

const day = 86_400_000;
/** Overdue erasure rows shown in "Needs you now" before "and N more". */
export const overdueRowCap = 5;

/** Which reads Today may start. Only the roles that already see the queues; module off means no problem report read. */
export function alsoWaitingReads(
  role: string | null | undefined,
  problemReportsInstalled: boolean,
) {
  const allowed = canTriage(role);
  return { problemReports: allowed && problemReportsInstalled, erasure: allowed };
}

export type ProblemReportsTile = {
  count: number;
  oldestAt: string | null;
  oldestDays: number | null;
};
/** Open means received or in review. A malformed answer gives null (the tile is hidden), never zero. */
export function problemReportsTile(queue: unknown, now: Date): ProblemReportsTile | null {
  const q = queue as { counts?: Record<string, unknown>; oldestReceivedAt?: unknown } | null;
  const received = q?.counts?.received;
  const review = q?.counts?.in_review;
  if (typeof received !== 'number' || typeof review !== 'number') return null;
  const oldestAt = typeof q?.oldestReceivedAt === 'string' ? q.oldestReceivedAt : null;
  const oldestDays = oldestAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(oldestAt)) / day))
    : null;
  return { count: received + review, oldestAt, oldestDays };
}

/** Only these fields of an erasure request are read. A name, an email or a workspace name is never copied. */
export type ErasureOverdueRow = {
  id: string;
  reference: string;
  daysOverdue: number;
  dueAt: string;
};
export type ErasureTile = {
  count: number;
  /** True when a page was full, so the real number may be higher. */
  atLeast: boolean;
  overdue: number;
  nearestDueAt: string | null;
  rows: ErasureOverdueRow[];
};
type ErasureItem = {
  id?: unknown;
  reference?: unknown;
  dueAt?: unknown;
  daysLeft?: unknown;
  status?: unknown;
};
/** `items` joins the received and in progress reads; `full` says a page had a next page. */
export function erasureTile(items: unknown[], full: boolean): ErasureTile | null {
  const list: { id: string; reference: string; dueAt: string; daysLeft: number }[] = [];
  for (const raw of items) {
    const i = raw as ErasureItem;
    if (
      typeof i?.id !== 'string' ||
      typeof i.reference !== 'string' ||
      typeof i.dueAt !== 'string' ||
      typeof i.daysLeft !== 'number'
    )
      return null;
    if (i.status === 'received' || i.status === 'in_progress')
      list.push({ id: i.id, reference: i.reference, dueAt: i.dueAt, daysLeft: i.daysLeft });
  }
  const late = list
    .filter((i) => i.daysLeft < 0)
    .sort((a, b) => a.daysLeft - b.daysLeft || (a.id < b.id ? -1 : 1));
  const nearest = list.map((i) => i.dueAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return {
    count: list.length,
    atLeast: full,
    overdue: late.length,
    nearestDueAt: nearest,
    rows: late.map((i) => ({
      id: i.id,
      reference: i.reference,
      daysOverdue: -i.daysLeft,
      dueAt: i.dueAt,
    })),
  };
}

export const overdueChip = (days: number) =>
  days === 1 ? '1 day overdue' : `${days} days overdue`;
/** Rows shown and how many are left for "and N more". */
export function capOverdue(rows: ErasureOverdueRow[]) {
  return { shown: rows.slice(0, overdueRowCap), more: Math.max(0, rows.length - overdueRowCap) };
}
