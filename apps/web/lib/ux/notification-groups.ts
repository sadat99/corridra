// Groups the inbox for the customer notifications panel (navigation v1, UtilityMenus): Needs You first, then
// Updates, then Earlier. Pure and order preserving; nothing here reads or writes anything.
export type InboxItem = {
  id: string;
  type: string;
  payload: { title?: string; href?: string };
  readAt: string | null;
  createdAt: string;
};

/** Unread items of these kinds ask something of the person: an invitation to answer, a task, a quote to decide. */
export const needsYouTypes: ReadonlySet<string> = new Set([
  'TEAM_INVITE',
  'CONTRIBUTOR_INVITE',
  'PARTICIPANT_INVITE',
  'TASK_ASSIGNED',
  'QUOTE_SENT',
]);

export function groupNotifications<T extends InboxItem>(items: readonly T[]) {
  const needsYou: T[] = [];
  const updates: T[] = [];
  const earlier: T[] = [];
  for (const item of items) {
    if (item.readAt) earlier.push(item);
    else if (needsYouTypes.has(item.type)) needsYou.push(item);
    else updates.push(item);
  }
  return { needsYou, updates, earlier, unread: needsYou.length + updates.length };
}
