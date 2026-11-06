// The team Today page's "Needs you now" list and its one-line summary (owner, 6 Nov 2026: "today page
// redesign"). Pure functions over the two mission reads the page already makes (new requests and
// missions past their due date). Nothing here reads, writes or decides access; it only orders and
// words what was loaded, and never claims more than the loaded totals show.

export type TodayMission = {
  id: string;
  status: string;
  due_at: string;
  brief: { company: string; objective: string; market: string };
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
