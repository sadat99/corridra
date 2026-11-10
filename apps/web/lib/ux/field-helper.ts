// The field helper's phone navigation (Navigation v1, FieldHelper board): four bottom tabs, Today, Tasks, Messages and
// Me, shown on a phone or tablet for a helper who opened the task page with a workspace link. Today is the same task
// list narrowed to what is due today (no new read); Tasks is the whole list; Messages says Coming soon until a real
// way to message exists (it stays unlinked: the signed-in Help menus carry the WhatsApp link when the owner sets a
// number, and this tab does not); Me holds language, reading aloud,
// the private-link note and Sign Out. Navigation only: the page and the server still decide what a helper may see.
// Owner: S4.
const workspaceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FieldTabKey = 'today' | 'tasks' | 'messages' | 'me';
export type FieldTab = {
  key: FieldTabKey;
  label: string;
  icon: string;
  /** Absent while the feature is not real yet: the tab then says Coming soon and is never a link. */
  href?: string;
};

/** A valid workspace id from the address, or null: the tabs are shown only for a helper who has one. */
export function fieldWorkspace(value: string | null | undefined): string | null {
  return value && workspaceId.test(value) ? value : null;
}

export function fieldTabs(workspace: string): FieldTab[] {
  const query = '?workspace=' + workspace;
  return [
    { key: 'today', label: 'Today', icon: 'home', href: '/contributor' + query + '&view=today' },
    { key: 'tasks', label: 'Tasks', icon: 'list', href: '/contributor' + query },
    { key: 'messages', label: 'Messages', icon: 'inbox' },
    { key: 'me', label: 'Me', icon: 'people', href: '/contributor/me' + query },
  ];
}

/** Which tab is current for an address: the Me page, the Today view of the task page, or Tasks. */
export function currentFieldTab(pathname: string, view: string | null): FieldTabKey | null {
  if (/^\/contributor\/me(?:\/|$)/.test(pathname)) return 'me';
  if (pathname === '/contributor') return view === 'today' ? 'today' : 'tasks';
  return null;
}

/** The pages that show the tabs: the task page and the Me page (not the invitation steps). */
export function fieldTabsShown(pathname: string): boolean {
  return pathname === '/contributor' || /^\/contributor\/me(?:\/|$)/.test(pathname);
}

/** Whether a task deadline falls on the person's current day. An unreadable date is never "today". */
export function dueToday(deadline: string, now: Date = new Date()): boolean {
  const at = new Date(deadline);
  if (Number.isNaN(at.getTime())) return false;
  return (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  );
}
