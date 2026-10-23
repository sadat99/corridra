import { handleCustomerAuthMail } from '@corridra/auth/customer-auth-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called by the identity provider, not by a browser. The signature is the only authority, so there
// is no origin check. Returns 404 until CORRIDRA_CUSTOMER_AUTH_MAIL_ENABLED is true.
export async function POST(request: Request) {
  return handleCustomerAuthMail(request);
}
