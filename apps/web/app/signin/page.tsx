import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountAccess } from '../../components/account-access';
import { accountAccessPath, accountReturnTo } from '../../lib/account-return';
import { emailReturnPagesOn } from '../../lib/ux-switches';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in | Corridra',
  robots: { index: false, follow: true },
};
type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);

/**
 * `/signin?next=<path>` (CQ-45): a page that needs sign-in can send the person here with the path they wanted.
 * The path goes through the same reviewed list as `returnTo` (ADR-067): only an exact internal page is kept,
 * anything else falls back to the account. A kept path becomes `returnTo`, which the sign-in form honours.
 */
export default async function Page({ searchParams }: { searchParams?: Promise<Query> }) {
  const query = (await searchParams) ?? {};
  const next = one(query.next);
  if (next !== null && one(query.returnTo) === null) {
    const emailPages = emailReturnPagesOn();
    const kept = accountReturnTo(next, emailPages);
    redirect(
      accountAccessPath(
        '/signin',
        kept,
        one(query.method) === 'code' ? 'code' : undefined,
        emailPages,
      ),
    );
  }
  if (!readNeonAuthConfig() && process.env.CORRIDRA_FOUNDATIONS_ENABLED === 'true') redirect('/operator/signin');
  return <AccountAccess title="Sign in." mode="signin" />;
}
