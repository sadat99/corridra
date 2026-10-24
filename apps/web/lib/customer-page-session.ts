import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { neonAuth } from './neon-auth';

export type CustomerPageSession =
  { ok: true; subject: string; issuer: string } | { ok: false; message: string };

/**
 * The same checks the account pages make before they read anything: a signed-out visitor goes to
 * sign-in, an unverified one to verify, and a provider that cannot answer gets a plain message.
 */
export async function customerPageSession(): Promise<CustomerPageSession> {
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) redirect('/signin');
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return {
      ok: false,
      message: 'Your account could not be checked. Please try again in a moment.',
    };
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return { ok: true, subject: session.data.user.id, issuer };
}
