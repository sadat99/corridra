import type { ReactNode } from 'react';
import { ClosedAccountGate } from './customer-closed-account';

/**
 * The closed-account gate for a page, told which person the page is drawn for so its reads and the Reopen and Erasure
 * commands go back with that person. When the identity cannot be read just now (a provider hiccup) the gate is still
 * mounted without it: the server verifies the session itself, so a closed account is never shown the pages.
 */
export async function IdentifiedClosedAccountGate({ children }: { children: ReactNode }) {
  // Loaded only when the account module is on, so the frame itself carries no server-only import.
  const { customerIdentity } = await import('../lib/customer-page-session');
  const identity = await customerIdentity();
  return (
    <ClosedAccountGate subject={identity?.subject} issuer={identity?.issuer}>
      {children}
    </ClosedAccountGate>
  );
}
