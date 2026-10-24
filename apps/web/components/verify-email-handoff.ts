// The address a person just signed up with, kept for this tab only so the verify page does not ask for
// it again. It is an address and nothing else: no code, no password, no token. It is removed once the
// address is verified, and it dies with the tab. A storage failure (private mode, blocked storage)
// simply means the person types the address as before.
const key = 'corridra.verify-email';

function usable(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length >= 3 && value.length <= 254 && value.includes('@')
  );
}

export function rememberVerifyEmail(email: string) {
  try {
    const clean = email.trim();
    if (usable(clean)) window.sessionStorage.setItem(key, clean);
  } catch {
    /* Nothing is stored; the verify page asks for the address. */
  }
}

export function recallVerifyEmail(): string {
  try {
    const value = window.sessionStorage.getItem(key);
    return usable(value) ? value : '';
  } catch {
    return '';
  }
}

export function forgetVerifyEmail() {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* Nothing to remove. */
  }
}
