/** Tells the header that the sign-in state may have changed, so it asks again without a reload. */
export const sessionChanged = 'corridra-session-changed';
export function announceSessionChange() {
  window.dispatchEvent(new Event(sessionChanged));
}
