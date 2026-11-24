// The team Today page's "Needs you now" list and its one-line summary (owner, 6 Nov 2026: "today page
// redesign"). Pure functions over the two mission reads the page already makes (new requests and
// missions past their due date). Nothing here reads, writes or decides access; it only orders and
// words what was loaded, and never claims more than the loaded totals show.

export type TodayMission = {
  id: string;
  status: string;
  due_at: string;
  brief: { company: string; objective: string; market: string };
  /** The short request reference (RQ-000001), only when the mission read itself carries one. */
  reference?: unknown;
};
/** One page of a mission read: the rows returned and the server's total for the same filter. */
export type MissionPage = { missions: TodayMission[]; total: number };

export type NeedsRow = {
  mission: TodayMission;
  /** In the new requests read (open drafts). */
  fresh: boolean;
  /** In the past-due read. */
  overdue: boolean;
};
export type NeedsFilter = 'all' | 'new' | 'overdue';

/** The query parameter that keeps the Home list filter across reload and back. */
export const NEEDS_FILTER_PARAM = 'needs';

/** The filter named by a URL query string; anything missing or unknown opens on All. */
export function needsFilterFromSearch(search: string): NeedsFilter {
  const value = new URLSearchParams(search).get(NEEDS_FILTER_PARAM);
  return value === 'new' || value === 'overdue' ? value : 'all';
}

/** The query string for a filter on top of an existing one: All leaves no parameter behind. */
export function searchWithNeedsFilter(search: string, filter: NeedsFilter): string {
  const params = new URLSearchParams(search);
  if (filter === 'all') params.delete(NEEDS_FILTER_PARAM);
  else params.set(NEEDS_FILTER_PARAM, filter);
  const text = params.toString();
  return text ? `?${text}` : '';
}

const day = 24 * 60 * 60 * 1000;

/**
 * New requests and late missions as one list, each mission once. Late missions come first, the most
 * overdue at the top; the rest follow with the newest due date first. Ties keep a stable order by id.
 */
export function needsYouNow(fresh: MissionPage, overdue: MissionPage): NeedsRow[] {
  const rows = new Map<string, NeedsRow>();
  for (const mission of fresh.missions)
    rows.set(mission.id, { mission, fresh: true, overdue: false });
  for (const mission of overdue.missions) {
    const known = rows.get(mission.id);
    if (known) known.overdue = true;
    else rows.set(mission.id, { mission, fresh: false, overdue: true });
  }
  return [...rows.values()].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const due = Date.parse(a.mission.due_at) - Date.parse(b.mission.due_at);
    if (due !== 0) return a.overdue ? due : -due;
    return a.mission.id < b.mission.id ? -1 : a.mission.id > b.mission.id ? 1 : 0;
  });
}

/** Whole days between the due date and the moment the page was read; 0 within the first day. */
export function daysLate(dueAt: string, observedAt: string): number {
  return Math.floor((Date.parse(observedAt) - Date.parse(dueAt)) / day);
}

/**
 * The chip for a late mission. The server decided it is late; when the browser's clock disagrees (the due
 * moment has not passed here yet) the chip only says "Late" rather than inventing a number.
 */
export function lateLabel(dueAt: string, observedAt: string): string {
  if (Date.parse(observedAt) <= Date.parse(dueAt)) return 'Late';
  const days = daysLate(dueAt, observedAt);
  if (days === 0) return 'Due today';
  return days === 1 ? '1 day late' : `${days} days late`;
}

/** True when every row of both reads was loaded, so the merged list is the whole set. */
function complete(fresh: MissionPage, overdue: MissionPage): boolean {
  return fresh.missions.length >= fresh.total && overdue.missions.length >= overdue.total;
}

/**
 * How many missions need a person. Exact when both reads are complete; otherwise the smallest number the
 * totals prove (a mission can be both new and late, so the two totals cannot simply be added).
 */
export function needsCount(fresh: MissionPage, overdue: MissionPage, rows: NeedsRow[]) {
  const whole = complete(fresh, overdue);
  return {
    count: whole ? rows.length : Math.max(fresh.total, overdue.total, rows.length),
    exact: whole,
  };
}

export function filterRows(rows: NeedsRow[], filter: NeedsFilter): NeedsRow[] {
  if (filter === 'new') return rows.filter((row) => row.fresh);
  if (filter === 'overdue') return rows.filter((row) => row.overdue);
  return rows;
}

/** The total behind a filter: the server's total for New and Past due, the merged count for All. */
export function filterTotal(
  filter: NeedsFilter,
  fresh: MissionPage,
  overdue: MissionPage,
  rows: NeedsRow[],
) {
  if (filter === 'new') return { count: fresh.total, exact: true };
  if (filter === 'overdue') return { count: overdue.total, exact: true };
  return needsCount(fresh, overdue, rows);
}

function share(count: number, whole: number, exact: boolean, singular: string, plural: string) {
  const amount = exact && count === whole && count > 1 ? `All ${count}` : `${count}`;
  return `${amount} ${count === 1 ? singular : plural}`;
}

/**
 * The one line under the Today heading, for example "6 missions need you." and "All 6 are new and past
 * their due date." Only the loaded totals are used; when not every row was loaded the count says "At least".
 */
export function needsSummary(
  fresh: MissionPage,
  overdue: MissionPage,
  rows: NeedsRow[],
): { lead: string; detail: string } {
  const { count, exact } = needsCount(fresh, overdue, rows);
  if (count === 0) return { lead: 'No missions need you now.', detail: '' };
  const lead = `${exact ? '' : 'At least '}${count} ${count === 1 ? 'mission needs' : 'missions need'} you.`;
  const newCount = fresh.total;
  const lateCount = overdue.total;
  if (exact && newCount === count && lateCount === count)
    return {
      lead,
      detail:
        count === 1
          ? 'It is new and past its due date.'
          : `All ${count} are new and past their due date.`,
    };
  if (exact && count === 1)
    return {
      lead,
      detail: newCount === 1 ? 'It is a new request.' : 'It is past its due date.',
    };
  const parts = [
    newCount > 0 ? share(newCount, count, exact, 'is new', 'are new') : null,
    lateCount > 0
      ? share(lateCount, count, exact, 'is past its due date', 'are past their due date')
      : null,
  ].filter((part): part is string => part !== null);
  return { lead, detail: `${parts.join(' and ')}.` };
}

// Operator desk (CORRIDRA_UX_OPERATOR_DESK): Today as one table. The set is new requests, late missions and overdue
// erasure requests, each once. The sentence and the filter counts are worked out from the same set as the rows, so
// the number said is the number listed. A count that rests on an unfinished read says "At least".

export type DeskRow = {
  /** Unique in the table: the mission id, or `erasure:` and the request id. */
  key: string;
  kind: 'mission' | 'erasure';
  /** The mission read, for a mission row. */
  mission: TodayMission | null;
  /** The erasure reference, for an erasure row. */
  reference: string | null;
  dueAt: string;
  fresh: boolean;
  late: boolean;
  /** Whole days late for an erasure row (the server counted them); a mission row counts from the moment read. */
  erasureDaysLate: number | null;
};
export type DeskErasureRow = { id: string; reference: string; daysOverdue: number; dueAt: string };

/** The chip words. Late always names its days; the browser's clock disagreeing leaves the plain word. */
export function deskChip(row: DeskRow, observedAt: string): string {
  if (!row.late) return 'New';
  const days =
    row.kind === 'erasure'
      ? (row.erasureDaysLate ?? 0)
      : Date.parse(observedAt) <= Date.parse(row.dueAt)
        ? null
        : daysLate(row.dueAt, observedAt);
  if (days === null) return 'Late';
  if (days === 0) return 'Late, due today';
  return days === 1 ? 'Late, 1 day' : `Late, ${days} days`;
}

function lateDays(row: DeskRow, observedAt: string): number {
  if (!row.late) return -1;
  if (row.kind === 'erasure') return row.erasureDaysLate ?? 0;
  return Date.parse(observedAt) <= Date.parse(row.dueAt) ? 0 : daysLate(row.dueAt, observedAt);
}

/** The table rows: most days late first, then the soonest due; a stable order by key breaks every tie. */
export function deskRows(
  fresh: MissionPage,
  overdue: MissionPage,
  erasure: DeskErasureRow[],
  observedAt: string,
): DeskRow[] {
  const rows: DeskRow[] = needsYouNow(fresh, overdue).map((row) => ({
    key: row.mission.id,
    kind: 'mission',
    mission: row.mission,
    reference: null,
    dueAt: row.mission.due_at,
    fresh: row.fresh,
    late: row.overdue,
    erasureDaysLate: null,
  }));
  for (const item of erasure)
    rows.push({
      key: `erasure:${item.id}`,
      kind: 'erasure',
      mission: null,
      reference: item.reference,
      dueAt: item.dueAt,
      fresh: false,
      late: true,
      erasureDaysLate: item.daysOverdue,
    });
  return rows.sort((a, b) => {
    const days = lateDays(b, observedAt) - lateDays(a, observedAt);
    if (days !== 0) return days;
    const due = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (due !== 0) return due;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export type DeskTotals = { count: number; late: number; fresh: number; exact: boolean };
/**
 * How many things need a person, how many of them are late and how many are new. Exact only when both mission reads
 * and the erasure read were whole; otherwise the smallest number the totals prove. `erasure` is null when the role
 * does not read that queue or the read failed: nothing is added for it.
 */
export function deskTotals(
  fresh: MissionPage,
  overdue: MissionPage,
  erasure: { rows: DeskErasureRow[]; atLeast: boolean } | null,
  rows: NeedsRow[],
  /**
   * True when this role reads the erasure queue and the read failed. That is not "no erasure requests": the total is
   * then a lower bound, never exact, so the page cannot give a false all-clear.
   */
  erasureUnread = false,
): DeskTotals {
  const missions = needsCount(fresh, overdue, rows);
  const extra = erasure?.rows.length ?? 0;
  return {
    count: missions.count + extra,
    late: overdue.total + extra,
    fresh: fresh.total,
    exact: missions.exact && !erasure?.atLeast && !erasureUnread,
  };
}

/** The one sentence under the heading. */
export function deskSentence({ count, late, exact }: DeskTotals): string {
  if (count === 0)
    return exact ? 'Nothing needs you now.' : 'Erasure requests could not be checked just now.';
  const lead = `${exact ? '' : 'At least '}${count} ${count === 1 ? 'thing needs' : 'things need'} you now.`;
  const tail =
    late === 0
      ? 'Nothing is late.'
      : count === 1
        ? 'It is late.'
        : late === 1
          ? '1 is late.'
          : `${late} are late.`;
  return `${lead} ${tail}`;
}

/** Rows for a filter: New is new requests, Past due is everything late (missions and erasure requests). */
export function deskFilter(rows: DeskRow[], filter: NeedsFilter): DeskRow[] {
  if (filter === 'new') return rows.filter((row) => row.fresh);
  if (filter === 'overdue') return rows.filter((row) => row.late);
  return rows;
}

// Team desk v4.1 (CORRIDRA_UX_TEAM_DESK_V41, owner approved 24 Nov 2026): Today as two regions, "Needs your decision"
// and "Waiting on others". Same reads and the same set as the desk above; only the words and the grouping change.

/** The shape of a short request reference (PR 617: RQ- and the number, six digits or more). */
const referenceShape = /^RQ-\d{1,12}$/;
/** The reference a read carried, or null. Nothing is ever made up from an id. */
export function shortReference(value: unknown): string | null {
  return typeof value === 'string' && referenceShape.test(value) ? value : null;
}

/**
 * The headline: what to do first. It never gives a lower bound as a number: when a read was not whole it names the
 * place that holds the full list instead. `others` is the sum of the other queues that need a decision (replies,
 * quotes, follow-ups and so on), or null when one of them could not be read.
 */
export function deskHeadline({ count, late, exact }: DeskTotals, others: number | null): string {
  if (count === 0) {
    if (!exact)
      return 'Erasure requests could not be checked just now. Try again before you rely on this page.';
    if (others === null)
      return 'No new request and nothing late. Some queues could not be checked.';
    return others > 0
      ? 'No new request and nothing late. Work through the queues below.'
      : 'Nothing needs your decision now.';
  }
  if (!exact)
    return late > 0
      ? 'Start with the late ones at the top. This page did not load every one; the full list is in Missions.'
      : 'Start at the top. This page did not load every one; the full list is in Missions.';
  const lead = `${count} ${count === 1 ? 'thing needs' : 'things need'} your decision.`;
  if (late === 0) return `${lead} ${count === 1 ? 'Review it today.' : 'Start at the top.'}`;
  if (count === 1) return `${lead} It is late, so review it first.`;
  return `${lead} Start with the ${late === 1 ? 'one that is' : `${late} that are`} late.`;
}

/** The line under a region's rows when more exist than were loaded. Never a lower bound as a number. */
export function shownLine(shown: number, total: { count: number; exact: boolean }): string | null {
  if (shown >= total.count) return null;
  return total.exact
    ? `Showing ${shown} of ${total.count}. The full list is in Missions.`
    : `Showing ${shown}. More are in Missions.`;
}

/**
 * Open missions that need no decision now: not a new request and not past due at the moment read. They come from
 * the open read the page already makes, soonest due first.
 */
export function waitingMissions(
  open: MissionPage,
  fresh: MissionPage,
  overdue: MissionPage,
  observedAt: string,
): TodayMission[] {
  const needs = new Set([...fresh.missions, ...overdue.missions].map((mission) => mission.id));
  const now = Date.parse(observedAt);
  return open.missions
    .filter(
      (mission) =>
        !needs.has(mission.id) && mission.status !== 'DRAFT' && Date.parse(mission.due_at) >= now,
    )
    .sort((a, b) => {
      const due = Date.parse(a.due_at) - Date.parse(b.due_at);
      if (due !== 0) return due;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
