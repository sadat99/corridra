import { realUseEnabled } from '@corridra/auth/customer-production';
import { SiteFooterView } from './site-footer-view';

export function SiteFooter() {
  return <SiteFooterView realUse={realUseEnabled()} />;
}
