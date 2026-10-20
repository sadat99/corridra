import { PublicShell } from '../../components/public-shell';
import { Intake } from './intake';
export const metadata = {
  title: 'Plan a mission | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  return (
    <PublicShell className="ux-intake-page">
      <section className="guide-plan">
        <header className="guide-plan-head">
          <p className="label">PLAN A MISSION</p>
          <h1>What do you want to do?</h1>
          <p className="guide-lead">A short request is enough. No account needed.</p>
        </header>
        <Intake />
      </section>
    </PublicShell>
  );
}
