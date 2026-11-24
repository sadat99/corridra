import { describe, expect, it } from 'vitest';
import { meetingStatus, meetingTransitions } from '../../packages/domain/src/access';
import {
  finishedMeetingStatuses,
  meetingColumnOf,
  meetingColumns,
  meetingStatusTone,
} from '../../apps/web/app/operator/meeting-columns';
import { missionFromAddress, takeMissionHint } from '../../apps/web/app/operator/mission-hint';

// Team desk v4.1, unit D11: the five columns of the Meetings board are groups of the stored meeting statuses.
// This closes the plan's open point "that meeting statuses map to five columns" (section 7): the code has eight
// statuses, and the mapping below is the one the Guardian confirmed against packages/domain/src/access.ts.
describe('D11 meeting columns', () => {
  it('has five columns, in the order a meeting moves through them', () => {
    expect(meetingColumns.map((column) => column.title)).toEqual([
      'Proposed',
      'Accepted',
      'Scheduled',
      'Needs a new time',
      'Finished',
    ]);
  });

  it('places every stored status in exactly one column', () => {
    const placed = meetingColumns.flatMap((column) => column.statuses);
    expect([...placed].sort()).toEqual([...meetingStatus.options].sort());
    expect(new Set(placed).size).toBe(placed.length);
    for (const status of meetingStatus.options)
      expect(meetingColumns.some((column) => column.id === meetingColumnOf(status))).toBe(true);
  });

  it('names a column after a status only when it holds that status alone', () => {
    expect(meetingColumns.slice(0, 3).map((column) => column.statuses)).toEqual([
      ['PROPOSED'],
      ['ACCEPTED'],
      ['SCHEDULED'],
    ]);
  });

  it('keeps the last column to the statuses with no next state, and the fourth to those that need a new time', () => {
    expect([...meetingColumns[4].statuses].sort()).toEqual([...finishedMeetingStatuses].sort());
    for (const status of meetingColumns[4].statuses) expect(meetingTransitions[status]).toEqual([]);
    for (const status of meetingColumns[3].statuses)
      expect(meetingTransitions[status].length).toBeGreaterThan(0);
    expect(meetingTransitions.NO_SHOW).toEqual(['RESCHEDULE_REQUIRED']);
    expect(meetingTransitions.RESCHEDULE_REQUIRED).toContain('SCHEDULED');
  });

  it('never shows a declined or cancelled meeting as a success', () => {
    expect(meetingStatusTone('HELD')).toBe('positive');
    for (const status of meetingStatus.options)
      if (status !== 'HELD') expect(meetingStatusTone(status)).not.toBe('positive');
    expect(meetingStatusTone('DECLINED')).toBe('unknown');
    expect(meetingStatusTone('CANCELLED')).toBe('unknown');
  });
});

// Unit D13: Reports reads `?mission=` through the same helper Money and Companies use.
describe('D13 mission hint for Reports', () => {
  const mission = '00000000-0000-4000-8000-000000000700';
  it('answers for the Reports address only, once', () => {
    const address = { pathname: '/operator/delivery', search: `?mission=${mission}`, hash: '' };
    expect(takeMissionHint('workspace-commercial', address)).toBeNull();
    expect(takeMissionHint('workspace-delivery', address)).toBe(mission);
    expect(takeMissionHint('workspace-delivery', address)).toBeNull();
  });
  it('ignores anything that is not a well-formed id', () => {
    for (const value of ['', 'not-a-mission', '<script>', `${mission}x`, '../etc'])
      expect(missionFromAddress(`?mission=${encodeURIComponent(value)}`)).toBeNull();
  });
});
