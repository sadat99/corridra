import { notFound } from 'next/navigation';
import { foundations } from '../../../lib/foundations';
import { OperatorSignin } from './signin-form';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator sign-in | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  const returnTo =
    next && /^\/contributor\?workspace=[0-9a-f-]{36}$/i.test(next) ? next : '/operator';
  if (!foundations()) notFound();
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">OPERATOR ACCESS</p>
      <h1>Sign in to your workspace.</h1>
      <OperatorSignin returnTo={returnTo} />
    </main>
  );
}
