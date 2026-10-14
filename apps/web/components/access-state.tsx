import type { ReactNode } from 'react';

export type AccessStateKind =
  'loading' | 'empty' | 'unknown' | 'denied' | 'expired' | 'revoked' | 'unavailable' | 'complete';
const labels: Record<AccessStateKind, string> = {
  loading: 'Loading',
  empty: 'No records',
  unknown: 'Not established',
  denied: 'Access required',
  expired: 'Access expired',
  revoked: 'Access withdrawn',
  unavailable: 'Temporarily unavailable',
  complete: 'Completed',
};

/** Display the state established by the server/caller. Never infer authority from text. */
export function AccessState({
  kind,
  children,
  actions,
}: {
  kind: AccessStateKind;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ux-state" data-state={kind}>
      <p className="ux-state-label">{labels[kind]}</p>
      <div
        role={['denied', 'expired', 'revoked', 'unavailable'].includes(kind) ? 'alert' : 'status'}
      >
        {children}
      </div>
      {actions && <div className="ux-state-actions">{actions}</div>}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown';
}) {
  return (
    <span className="ux-status" data-tone={tone}>
      {children}
    </span>
  );
}
