import { Intake } from './intake';
export const metadata = {
  title: 'Plan a mission | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero intake-page">
        <p className="label">PLAN A MISSION</p>
        <h1>What needs to happen?</h1>
        <p className="page-description">A short brief is enough to start. No account required.</p>
        <Intake />
      </section>
    </main>
  );
}
