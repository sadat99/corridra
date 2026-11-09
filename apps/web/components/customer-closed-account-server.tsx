import type { ReactNode } from 'react';
import { ClosedAccountGate } from './customer-closed-account';

/**
 * The closed-account gate for a page, told which person the page is drawn for so its reads and the Reopen and Erasure
 * commands go back with that person. Without a signed-in person there is nothing to gate and the page decides.
 */
export async function IdentifiedClosedAccountGate({ children }: { children: ReactNode }) {
  // Loaded only when the account module is on, so the frame itself carries no server-only import.
  const { customerIdentity } = await import('../lib/customer-page-session');
  const identity = await customerIdentity();
  return identity ? (
    <ClosedAccountGate subject={identity.subject} issuer={identity.issuer}>
      {children}
    </ClosedAccountGate>
  ) : (
    <>{children}</>
  );
}
