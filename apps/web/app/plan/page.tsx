import { realUseEnabled } from '@corridra/auth/customer-production';
import { languagesWithForm } from '../../lib/i18n/pages';
import { uxSwitchOn } from '../../lib/ux-switches';
import { FormMain } from './form-main';
import { Intake } from './intake';
import { PlanHead } from './plan-head';
export const metadata = {
  title: 'Plan a mission | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  return (
    <FormMain className="ux-intake-page" released={languagesWithForm()}>
      <section className="guide-plan">
        <PlanHead realMode={realUseEnabled()} />
        <Intake
          realMode={realUseEnabled()}
          codeSignIn={process.env.CORRIDRA_CUSTOMER_CODE_SIGNIN === 'true'}
          firstQuestion={uxSwitchOn('CORRIDRA_UX_FIRSTQ')}
        />
      </section>
    </FormMain>
  );
}
