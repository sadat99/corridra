import { AccountAccess } from '../../components/account-access';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Choose password | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AccountAccess title="Choose a new password." mode="reset" />;
}
