import type { ReactNode } from 'react';

/**
 * Request progress as words (UI/UX.v4, owner 18 November 2026, row "Progress as words"):
 * "Step 1 of 5: Goal · Next: Where". It replaces the numbered circles. The step list and the progress element stay
 * for screen readers, so the current step is still announced and counted.
 */

export function PlanProgress({
  line,
  names,
  current,
  listLabel,
  progressLabel,
}: {
  line: ReactNode;
  names: readonly string[];
  current: number;
  listLabel: string;
  progressLabel: string;
}) {
  return (
    <div className="plan-progress">
      <p className="plan-progress-line">{line}</p>
      <ol className="sr-only" aria-label={listLabel}>
        {names.map((name, index) => (
          <li key={name} aria-current={index === current ? 'step' : undefined}>
            {name}
          </li>
        ))}
      </ol>
      <progress
        className="sr-only"
        value={current + 1}
        max={names.length}
        aria-label={progressLabel}
      />
    </div>
  );
}
