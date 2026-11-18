'use client';

import { useLanguage } from './language-provider';

/**
 * "Talk to a Person" opens the owner's support WhatsApp. It is drawn only when that number is set
 * (CORRIDRA_SUPPORT_WHATSAPP_NUMBER), so it is never a dead button.
 */
export function TalkLink({
  href,
  className = 'secondary-link',
}: {
  href: string | null;
  className?: string;
}) {
  const t = useLanguage().t;
  if (!href) return null;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {t('home.b3.talk')}
      <span className="sr-only"> {t('home.b3.talk.where')}</span>
    </a>
  );
}
