import { HelperInterestForm } from '../../../components/helper-interest-form';
import { accessDoorMetadata } from '../../../components/access-page';
import { WorkAccess } from '../../../components/work-access';
import { helperInterestCopy as interest, teamDoorPage as page } from '../../../lib/access-doors';
import { foundations } from '../../../lib/foundations';
import { CountryOptions } from '../../operator/country-options';
import { helperInterestEnabled } from '@corridra/auth/helper-interest';

// The form is offered only while both of its switches are on and the register is installed and open; any failure to find
// that out means it is not shown, and the page is exactly what it was.
async function interestOffered() {
  if (!helperInterestEnabled()) return false;
  try {
    const s = foundations();
    if (!s) return false;
    await s.ready;
    return await s.helperInterest.offered();
  } catch {
    return false;
  }
}

// The search-engine setting follows the switch as it is when the page is asked for.
export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return accessDoorMetadata('team', page.title, page.lead);
}

/** The work sign-in for the team and for field helpers: one window, one form (owner canvas board v12). */
export default async function Page() {
  const offerInterest = await interestOffered();
  return (
    <WorkAccess
      initial="team"
      teamReturn="/operator"
      helperReturn="/contributor"
      interestForm={
        offerInterest ? (
          <HelperInterestForm copy={interest}>
            <CountryOptions />
          </HelperInterestForm>
        ) : undefined
      }
    />
  );
}
