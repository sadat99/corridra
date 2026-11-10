// Puts the person's meetings into the four groups the Meetings page shows. Pure: the server passes its own clock.
// The group never depends on a meeting's status; the status badge tells that. A dated meeting is past when it is
// over (its end, or its start when it has no end, is before now); a meeting that has started and not ended, or
// starts exactly now, is still coming up.

export type Groupable = {
  changed: boolean;
  startsAt?: string;
  endsAt?: string;
};

export type MeetingGroups<T> = {
  /** Soonest first. */
  upcoming: T[];
  /** Newest first. */
  past: T[];
  /** No confirmed time, in the order given. */
  undated: T[];
  /** A changed schedule, in the order given, always last. */
  changed: T[];
};

/** The clock the groups are cut by: the server's, so every viewer sees the same split. */
export const serverNowMs = () => Date.now();

const time = (value: string | undefined) => (value ? Date.parse(value) : Number.NaN);

export function groupMeetings<T extends Groupable>(
  rows: readonly T[],
  nowMs: number,
): MeetingGroups<T> {
  const groups: MeetingGroups<T> = { upcoming: [], past: [], undated: [], changed: [] };
  for (const row of rows) {
    const start = time(row.startsAt);
    if (row.changed) groups.changed.push(row);
    else if (!Number.isFinite(start)) groups.undated.push(row);
    else {
      const end = time(row.endsAt);
      ((Number.isFinite(end) ? end : start) < nowMs ? groups.past : groups.upcoming).push(row);
    }
  }
  const byStart = (a: T, b: T) => time(a.startsAt) - time(b.startsAt);
  groups.upcoming.sort(byStart);
  groups.past.sort((a, b) => byStart(b, a));
  return groups;
}
