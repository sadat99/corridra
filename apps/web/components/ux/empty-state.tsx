import type { ReactNode } from 'react';
import { CorridraIcon } from '../corridra-icon';
import './empty-state.css';

/** An icon, one sentence and at most one action. No back link and no refresh button belong in it. */
export function EmptyState({
  icon,
  children,
  action,
}: {
  icon: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ux-empty">
      <CorridraIcon name={icon} className="ux-empty-icon" />
      <p>{children}</p>
      {action}
    </div>
  );
}
