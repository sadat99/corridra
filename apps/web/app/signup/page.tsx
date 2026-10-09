import { AccountAccess } from '../../components/account-access';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Create account | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AccountAccess title="Create your account." mode="signup" />;
}
