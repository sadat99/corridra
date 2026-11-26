'use client';

import { useLanguage } from './language-provider';

// Home page v4.3, shown only while CORRIDRA_UX_HOME_V43 is exactly "true" (docs/revamp/specs/ui-ux-v4-3.md). This is a
// placeholder composition: the sections arrive in later steps of the plan. It holds the page heading and the eyebrow
// so the page is never empty while the switch is on.
export function HomeV43({ whatsapp = null }: { whatsapp?: string | null }) {
  const { t } = useLanguage();
  return (
    <div className="hv43" data-whatsapp={whatsapp ? 'on' : 'off'}>
      <p className="tr-brandline">{t('home.eyebrow')}</p>
      <h1 id="home-title">{t('home.title')}</h1>
    </div>
  );
}
