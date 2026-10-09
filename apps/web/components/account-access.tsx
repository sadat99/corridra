import { Suspense } from 'react';
import Link from 'next/link';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountForm, type AccountFormMode } from './account-form';
export function AccountAccess({ title, mode }: { title: string; mode: AccountFormMode }) {
  const config = readNeonAuthConfig();
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero status-page">
        <p className="label">YOUR ACCOUNT</p>
        <h1>{title}</h1>
        {config ? (
          <Suspense fallback={<p>Loading account access…</p>}>
            <AccountForm mode={mode} />
          </Suspense>
        ) : (
          <p>Account access is not available yet.</p>
        )}
        {config && mode === 'signup' && (
          <p>
            Your name and email are used for account access, verification and recovery. Read the{' '}
            <Link href="/privacy">account and test intake notice</Link> before creating an account.
            Workspace access requires a separate invitation.
          </p>
        )}
      </section>
    </main>
  );
}
