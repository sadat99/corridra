import { realUseEnabled } from '@corridra/auth/customer-production';
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
          <p className="guide-lead">
            {realUseEnabled()
              ? 'Start with your objective. Create an account at the final step to keep your request and replies private.'
              : 'A short request is enough. No account needed.'}
          </p>
        </header>
        <Intake
          realMode={realUseEnabled()}
          codeSignIn={process.env.CORRIDRA_CUSTOMER_CODE_SIGNIN === 'true'}
        />
      </section>
    </PublicShell>
  );
}
