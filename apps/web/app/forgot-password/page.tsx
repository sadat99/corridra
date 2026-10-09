import { AccountAccess } from '../../components/account-access';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Reset password | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AccountAccess title="Reset your password." mode="forgot" />;
}
