'use client';

import { useT } from './language-provider';

export function SkipLink() {
  const t = useT();
  return (
    <a className="skip-link" href="#main">
      {t('skip')}
    </a>
  );
}
