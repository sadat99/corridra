import { describe, expect, it } from 'vitest';
import { groupNotifications, needsYouTypes } from '../../apps/web/lib/ux/notification-groups';

// Navigation v1, the notifications panel (UtilityMenus): Needs You first, then Updates, then Earlier. Unread items
// that ask something of the person come first; other unread items are updates; anything already read is earlier.
const item = (id: string, type: string, readAt: string | null = null) => ({
  id,
  type,
  payload: {},
  readAt,
  createdAt: '2026-11-06T09:00:00.000Z',
});

describe('grouping the inbox', () => {
  it('puts unread items that ask something of the person under Needs You, in the order given', () => {
    const groups = groupNotifications([
      item('1', 'REPORT_PUBLISHED'),
      item('2', 'TEAM_INVITE'),
      item('3', 'QUOTE_SENT'),
    ]);
    expect(groups.needsYou.map((i) => i.id)).toEqual(['2', '3']);
    expect(groups.updates.map((i) => i.id)).toEqual(['1']);
    expect(groups.earlier).toEqual([]);
  });

  it('puts everything already read under Earlier, even an invitation', () => {
    const groups = groupNotifications([
      item('1', 'TEAM_INVITE', '2026-11-05T09:00:00.000Z'),
      item('2', 'REPLY_POSTED', '2026-11-05T09:00:00.000Z'),
    ]);
    expect(groups.needsYou).toEqual([]);
    expect(groups.updates).toEqual([]);
    expect(groups.earlier.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('keeps every item exactly once', () => {
    const list = [
      item('1', 'TEAM_INVITE'),
      item('2', 'REPLY_POSTED'),
      item('3', 'UNKNOWN_KIND'),
      item('4', 'QUOTE_ACCEPTED', '2026-11-05T09:00:00.000Z'),
    ];
    const groups = groupNotifications(list);
    const ids = [...groups.needsYou, ...groups.updates, ...groups.earlier].map((i) => i.id).sort();
    expect(ids).toEqual(['1', '2', '3', '4']);
    expect(groups.unread).toBe(3);
  });

  it('names the types that need the person', () => {
    expect([...needsYouTypes].sort()).toEqual(
      [
        'CONTRIBUTOR_INVITE',
        'PARTICIPANT_INVITE',
        'QUOTE_SENT',
        'TASK_ASSIGNED',
        'TEAM_INVITE',
      ].sort(),
    );
  });
});
