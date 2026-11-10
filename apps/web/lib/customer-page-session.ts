import { cache } from 'react';
import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { signInPath } from './account-return';
import { neonAuth } from './neon-auth';

export type CustomerPageSession =
  | {
      ok: true;
      subject: string;
      issuer: string;
      /** The display name the person gave their account, for a greeting only. Never used to decide access. */
      name: string | null;
    }
  | { ok: false; message: string };

// One provider read for each request, shared by the page and the frame around it.
const providerSession = cache(async () => {
  const auth = neonAuth();
  return auth
    ? await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null)
    : null;
});

/**
 * The signed-in person a page is drawn for, as the browser must send it back with a state-changing request, or null when
 * nobody is signed in. It never redirects: the page does that.
 */
export async function customerIdentity(): Promise<{ subject: string; issuer: string } | null> {
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const session = await providerSession();
  return issuer && session && !session.error && session.data?.user
    ? { subject: session.data.user.id, issuer }
    : null;
}

/**
 * The same checks the account pages make before they read anything: a signed-out visitor goes to
 * sign-in, an unverified one to verify, and a provider that cannot answer gets a plain message. A page
 * that can be opened from an email passes its own path, so sign-in can bring the person back to it.
 */
export async function customerPageSession(next?: string): Promise<CustomerPageSession> {
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) redirect('/signin');
  const session = await providerSession();
  if (!session || session.error)
    return {
      ok: false,
      message: 'Your account could not be checked. Please try again in a moment.',
    };
  if (!session.data?.user) redirect(signInPath(next));
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  const name =
    typeof session.data.user.name === 'string' ? session.data.user.name.trim() || null : null;
  return { ok: true, subject: session.data.user.id, issuer, name };
}
