import { notFound } from 'next/navigation';
import { foundations } from '../../../lib/foundations';
import { OperatorSignin } from './signin-form';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator sign-in | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  if (!foundations()) notFound();
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">OPERATOR PREVIEW</p>
      <h1>Sign in to your workspace.</h1>
      <OperatorSignin />
    </main>
  );
}
