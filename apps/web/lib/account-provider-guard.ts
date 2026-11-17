import 'server-only';
import { DomainError } from '@corridra/domain';
import { readNeonAuthConfig } from '@corridra/config';
import { neonAuth } from './neon-auth';

// ADR-086. The check every account security route makes before it asks the sign-in provider to change anything: a fresh
// provider session (the cookie cache is skipped), a verified email, and the same person the page was drawn for (the
// subject and issuer the browser sends back). It returns the provider client so the route uses exactly this session.
// Errors carry a code the screen maps to words; nothing here logs or returns a name or an email.
export const providerUnavailableCode = 'provider_unavailable';
export async function accountProviderGuard(request: Request) {
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth)
    throw new DomainError('The sign-in service is unavailable', 503, providerUnavailableCode);
  let session: Awaited<ReturnType<typeof auth.getSession>> | null;
  try {
    session = await auth.getSession({ query: { disableCookieCache: true } });
  } catch {
    session = null;
  }
  if (!session || session.error)
    throw new DomainError('The sign-in service is unavailable', 503, providerUnavailableCode);
  const user = session.data?.user;
  if (!user) throw new DomainError('Sign in to continue', 401, 'signed_out');
  if (user.emailVerified !== true)
    throw new DomainError('Verify your email to continue', 403, 'email_unverified');
  if (
    request.headers.get('x-corridra-customer-subject') !== user.id ||
    request.headers.get('x-corridra-customer-issuer') !== issuer
  )
    throw new DomainError(
      'Your account changed. Reload before continuing.',
      409,
      'account_changed',
    );
  return { auth, subject: user.id, issuer };
}
