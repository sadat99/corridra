import { Suspense } from 'react';
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
      </section>
    </main>
  );
}
