import { CustomerBarIdentityNote } from './customer-bar-note';

/**
 * Tells the customer header who the page is drawn for, once per request (the page already paid for the provider read).
 * Loaded dynamically, as the closed-account gate does, so the frame itself carries no server-only import. It never
 * throws: when the identity cannot be read the header gets none and Search sends none.
 */
export async function CustomerBarIdentity() {
  let identity: { subject: string; issuer: string } | null = null;
  try {
    const { customerIdentity } = await import('../../lib/customer-page-session');
    identity = await customerIdentity();
  } catch {
    identity = null;
  }
  return <CustomerBarIdentityNote subject={identity?.subject} issuer={identity?.issuer} />;
}
