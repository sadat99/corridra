import { AccountAccess } from '../../components/account-access';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Verify email | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AccountAccess title="Verify your email." mode="verify" />;
}
