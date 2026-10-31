import { SignupAccess } from './signup-access';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Create account | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <SignupAccess />;
}
