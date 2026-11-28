import { realUseEnabled } from '@corridra/auth/customer-production';
import { SiteFooterPlace } from './site-footer-place';
import { uxSwitchOn } from '../lib/ux-switches';

export function SiteFooter() {
  return (
    <SiteFooterPlace
      realUse={realUseEnabled()}
      shells={uxSwitchOn('CORRIDRA_UX_SHELLS_V2')}
      accessDoors={uxSwitchOn('CORRIDRA_UX_ACCESS_DOORS')}
      homeV42={uxSwitchOn('CORRIDRA_UX_HOME_V42')}
      {...(uxSwitchOn('CORRIDRA_UX_HOME_V43') ? { homeV43: true } : {})}
      homeV44={uxSwitchOn('CORRIDRA_UX_HOME_V44')}
    />
  );
}
