'use client';
import { useEffect, useRef, type ReactNode } from 'react';

// A secondary section that stays open on wider screens and folds behind its summary on phones,
// so long staff pages keep within the scroll budget (docs/agents/ui-direction.md). The content
// stays mounted at every width; only the open state changes. The server renders it open, so
// nothing is hidden before the script runs or where it cannot run. `fold` picks the rule:
// 'phone' (default) folds below 40rem, 'always' folds at every width and 'off' keeps the section
// open with no summary. The wrapper itself never changes, so switching it keeps any typed draft.
const phone = '(max-width: 39.99rem)';

export function PhoneFold({
  summary,
  className,
  fold = 'phone',
  children,
}: {
  summary: ReactNode;
  className?: string;
  fold?: 'phone' | 'always' | 'off';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const query = window.matchMedia(phone);
    const apply = () => {
      if (ref.current) ref.current.open = fold === 'off' || (fold === 'phone' && !query.matches);
    };
    apply();
    if (fold !== 'phone') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [fold]);
  return (
    <details
      ref={ref}
      open
      data-phone-fold={fold}
      className={['phone-fold', fold === 'off' ? 'phone-fold-off' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
