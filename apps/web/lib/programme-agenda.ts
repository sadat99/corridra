// Groups a programme's timed agenda by calendar day for the organiser view (GAP-038).
// Pure: no I/O. A day is read in the programme time zone; an item with no programme zone uses its
// own zone. A scheduled item with no zone anywhere is listed apart, never placed on a guessed day.

export type AgendaInput = {
  taskId: string;
  title: string;
  status: string;
  scheduled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  audience: 'ALL' | 'SELECTED';
  attendees: string[];
  needsReview: boolean | null;
};

export type AgendaItem<T extends AgendaInput = AgendaInput> = {
  row: T;
  zone: string;
  /** Titles of the activities this one overlaps for the same attendees. */
  overlapsWith: string[];
};

export type AgendaDay<T extends AgendaInput = AgendaInput> = {
  /** "2026-11-03" in the zone the day was read in. */
  dayKey: string;
  /** Instant of the first item, for formatting the heading in `zone`. */
  headingAt: string;
  zone: string;
  items: AgendaItem<T>[];
};

export type GroupedAgenda<T extends AgendaInput = AgendaInput> = {
  days: AgendaDay<T>[];
  /** Scheduled, but no time zone is recorded on the programme or the item. */
  zoneMissing: T[];
  unscheduled: T[];
};

function validZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function dayKey(iso: string, zone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function groupAgendaByDay<T extends AgendaInput>(
  agenda: readonly T[],
  conflicts: readonly { left: string; right: string }[],
  contextZone: string | null | undefined,
): GroupedAgenda<T> {
  const titleOf = new Map(agenda.map((r) => [r.taskId, r.title] as const));
  const overlaps = new Map<string, string[]>();
  const note = (from: string, to: string) => {
    const title = titleOf.get(to);
    if (title === undefined) return;
    const list = overlaps.get(from) ?? [];
    if (!list.includes(title)) list.push(title);
    overlaps.set(from, list);
  };
  for (const c of conflicts) {
    note(c.left, c.right);
    note(c.right, c.left);
  }

  const unscheduled: T[] = [];
  const zoneMissing: T[] = [];
  const byDay = new Map<string, AgendaDay<T>>();
  for (const row of agenda) {
    if (!row.scheduled || !row.startsAt) {
      unscheduled.push(row);
      continue;
    }
    const zone = validZone(contextZone)
      ? contextZone
      : validZone(row.timezone)
        ? row.timezone
        : null;
    const key = zone ? dayKey(row.startsAt, zone) : null;
    if (!zone || !key) {
      zoneMissing.push(row);
      continue;
    }
    const bucket = zone + '|' + key;
    const day = byDay.get(bucket) ?? { dayKey: key, headingAt: row.startsAt, zone, items: [] };
    day.items.push({ row, zone, overlapsWith: overlaps.get(row.taskId) ?? [] });
    byDay.set(bucket, day);
  }

  const days = [...byDay.values()];
  for (const day of days) {
    day.items.sort(
      (a, b) =>
        new Date(a.row.startsAt!).getTime() - new Date(b.row.startsAt!).getTime() ||
        a.row.title.localeCompare(b.row.title),
    );
    day.headingAt = day.items[0]!.row.startsAt!;
  }
  days.sort(
    (a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      new Date(a.headingAt).getTime() - new Date(b.headingAt).getTime(),
  );
  return { days, zoneMissing, unscheduled };
}
