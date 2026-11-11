import { describe, expect, it } from 'vitest';
import { groupAgendaByDay, type AgendaInput } from '../../apps/web/lib/programme-agenda';

const row = (
  taskId: string,
  startsAt: string | null,
  over: Partial<AgendaInput> = {},
): AgendaInput => ({
  taskId,
  title: 'Activity ' + taskId,
  status: 'OPEN',
  scheduled: startsAt !== null,
  startsAt,
  endsAt: startsAt,
  timezone: 'Asia/Dhaka',
  audience: 'ALL',
  attendees: [],
  needsReview: false,
  ...over,
});

describe('groupAgendaByDay', () => {
  it('splits days at local midnight in the programme zone', () => {
    // 2030-07-15 17:30Z is 23:30 in Dhaka (UTC+6); 18:30Z is 00:30 the next day.
    const late = row('a', '2030-07-15T17:30:00Z');
    const early = row('b', '2030-07-15T18:30:00Z');
    const g = groupAgendaByDay([early, late], [], 'Asia/Dhaka');
    expect(g.days.map((d) => d.dayKey)).toEqual(['2030-07-15', '2030-07-16']);
    expect(g.days[0]!.items.map((i) => i.row.taskId)).toEqual(['a']);
    expect(g.days[1]!.items.map((i) => i.row.taskId)).toEqual(['b']);
  });

  it('sorts by start inside a day', () => {
    const g = groupAgendaByDay(
      [row('b', '2030-07-15T08:00:00Z'), row('a', '2030-07-15T04:00:00Z')],
      [],
      'Asia/Dhaka',
    );
    expect(g.days).toHaveLength(1);
    expect(g.days[0]!.items.map((i) => i.row.taskId)).toEqual(['a', 'b']);
  });

  it('marks both sides of a conflict with the other title', () => {
    const g = groupAgendaByDay(
      [
        row('a', '2030-07-15T04:00:00Z'),
        row('b', '2030-07-15T04:30:00Z'),
        row('c', '2030-07-15T09:00:00Z'),
      ],
      [{ left: 'a', right: 'b' }],
      'Asia/Dhaka',
    );
    const by = Object.fromEntries(g.days[0]!.items.map((i) => [i.row.taskId, i.overlapsWith]));
    expect(by).toEqual({ a: ['Activity b'], b: ['Activity a'], c: [] });
  });

  it('returns unscheduled items separately', () => {
    const g = groupAgendaByDay(
      [row('a', null), row('b', '2030-07-15T04:00:00Z')],
      [],
      'Asia/Dhaka',
    );
    expect(g.unscheduled.map((r) => r.taskId)).toEqual(['a']);
    expect(g.days).toHaveLength(1);
  });

  it('handles an empty agenda', () => {
    expect(groupAgendaByDay([], [], 'Asia/Dhaka')).toEqual({
      days: [],
      zoneMissing: [],
      unscheduled: [],
    });
  });

  it('uses the item zone when the programme has none, and never guesses a zone', () => {
    const own = row('a', '2030-07-15T18:30:00Z', { timezone: 'Asia/Dhaka' });
    const none = row('b', '2030-07-15T18:30:00Z', { timezone: null });
    const g = groupAgendaByDay([own, none], [], null);
    expect(g.days.map((d) => d.dayKey)).toEqual(['2030-07-16']);
    expect(g.zoneMissing.map((r) => r.taskId)).toEqual(['b']);
  });
});
