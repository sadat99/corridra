'use client';

import type { ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';

// Home page v4.3: one pressed-or-not button of every widget (stage, list view, phase, market, direction, role,
// quote). The pressed state is `aria-pressed`, drawn with a fill, a 2 px edge and a check, so colour is never the
// only sign (docs/revamp/specs/ui-ux-v4-3.md). Nothing here sends or stores anything.
export function Toggle({
  on,
  onPress,
  children,
  className,
  describedBy,
}: {
  on: boolean;
  onPress: () => void;
  children: ReactNode;
  className?: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      className={['hv43-toggle', className].filter(Boolean).join(' ')}
      aria-pressed={on}
      aria-describedby={describedBy}
      onClick={onPress}
    >
      {on ? <CorridraIcon name="check" size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}
