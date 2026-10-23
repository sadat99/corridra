import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MuteForm } from './mute-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Mute messages',
  robots: { index: false, follow: false },
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function MutePage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!uuid.test(requestId)) notFound();
  return (
    <main id="main" tabIndex={-1} className="operator-page ux-workspace ux-access">
      <header className="ux-page-heading">
        <p className="label">YOUR REQUEST</p>
        <h1>Mute messages about this request.</h1>
      </header>
      <section className="ux-account-access" aria-label="Mute messages">
        <MuteForm requestId={requestId} />
      </section>
    </main>
  );
}
