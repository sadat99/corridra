import { realUseEnabled } from '@corridra/auth/customer-production';
import { SiteFooterPlace } from './site-footer-place';
import { uxSwitchOn } from '../lib/ux-switches';

export function SiteFooter() {
  return (
    <SiteFooterPlace realUse={realUseEnabled()} shells={uxSwitchOn('CORRIDRA_UX_SHELLS_V2')} />
  );
}
