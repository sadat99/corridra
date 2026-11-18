import type { ReactNode } from 'react';

/**
 * "Know the Exact Job? Choose It": the job select behind one named disclosure. The content stays mounted
 * (hidden, never removed), so the field, its label, its value and its error keep working. The parent opens it when
 * a job is already chosen, when a link asked for one and when the job field has an error.
 */
export function PlanJobFold({
  id,
  open,
  onToggle,
  label,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="plan-job-fold" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="text-link plan-job-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        {label}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
