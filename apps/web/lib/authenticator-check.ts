import { workspaceSections } from './workspace-navigation';

// What the authenticator panel tells a person after a check. It reads only the shape of the
// answer, never the code itself, and raw server text is never shown.
export type AuthenticatorOutcome =
  'accepted' | 'invalid-code' | 'rate-limited' | 'signed-out' | 'origin-rejected' | 'unknown';

type VerifyResult = { error?: { status?: number; code?: string } | null } | null | undefined;

/**
 * The outcome of a two-factor verify answer. A wrong or expired code is the only "not accepted";
 * a limit, an ended sign-in or a refused origin means the code was not checked; anything else
 * stays unknown, never success.
 */
export function classifyVerifyResult(result: VerifyResult): AuthenticatorOutcome {
  if (!result || typeof result !== 'object') return 'unknown';
  const { error } = result;
  if (error === null || error === undefined) return 'accepted';
  if (error.status === 401) return error.code === 'INVALID_CODE' ? 'invalid-code' : 'signed-out';
  if (error.status === 400 && error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE')
    return 'signed-out';
  if (error.status === 429) return 'rate-limited';
  if (error.status === 403) return 'origin-rejected';
  return 'unknown';
}

/**
 * The section to go back to after a check: the one the person was on just before, if it is a
 * workspace section their role may open. Destinations come from the closed section list only.
 */
export function authenticatorReturnTarget(
  previous: string,
  role: string | undefined,
): { href: string; label: string } | null {
  if (!role || previous === 'workspace-authenticator') return null;
  const section = workspaceSections.find((item) => item.id === previous);
  if (!section || !(section.roles as readonly string[]).includes(role)) return null;
  return { href: '#' + section.id, label: section.label };
}
