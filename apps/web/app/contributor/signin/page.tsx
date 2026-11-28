import { ContributorUnavailable } from '../../../components/contributor-unavailable';
import { WorkAccess } from '../../../components/work-access';
import { foundations } from '../../../lib/foundations';
import { isContributorReturn, operatorReturnTo } from '../../../lib/workspace-navigation';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Helper sign-in | Corridra',
  robots: { index: false, follow: false },
};
/**
 * The sign-in door for a field helper. It is the work-account sign-in the helper already used through the
 * team page (same password, same authenticator, same /api/operator-auth), with the helper words and a
 * return to the task page. A return address that is not a helper one is dropped, so this door never sends
 * a person to the staff workspace.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  const checked = operatorReturnTo(next);
  const returnTo = isContributorReturn(checked) ? checked : '/contributor';
  if (!foundations()) return <ContributorUnavailable />;
  return <WorkAccess initial="helper" teamReturn="/operator" helperReturn={returnTo} />;
}
