import { clearPrivateRequestStorage } from './private-request-storage';
import { announceSessionChange } from '../components/session-events';
import { forgetDeviceRecents } from './ux/palette-recents';

/**
 * The steps of signing out that need no router: end the provider session, clear what the browser kept for private
 * requests, tell the other tabs. It throws when the provider could not end the session. The sign-in SDK loads only here,
 * so a page that never signs anyone out does not carry it.
 */
export async function endSession() {
  const { accountClient } = await import('./neon-auth-client');
  const result = await accountClient.signOut();
  if (result.error) throw new Error('The session could not be ended.');
  try {
    clearPrivateRequestStorage(sessionStorage);
  } catch {
    /* Logout still clears the provider session. */
  }
  // The command palette's recent items are this person's, on this device: they go with the session.
  forgetDeviceRecents();
  announceSessionChange();
}
