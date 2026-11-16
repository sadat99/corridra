// A workspace was archived, restored or otherwise changed on this page. The signed-in menus (avatar menu,
// switcher, New Request in the rail) read the person's workspaces once; this event tells them to read again so
// they match without a reload. It carries no data: every reader asks the server.

export const workspacesChangedEvent = 'corridra:workspaces-changed';

export function announceWorkspacesChanged() {
  window.dispatchEvent(new Event(workspacesChangedEvent));
}
