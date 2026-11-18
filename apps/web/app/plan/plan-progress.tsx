/**
 * Request progress as words (UI/UX.v4, owner 18 November 2026, row "Progress as words"):
 * "Step 1 of 5: Goal · Next: Where". It replaces the numbered circles. The step list and the progress element stay
 * for screen readers, so the current step is still announced and counted.
 */

/** The visible line. `stepTemplate` uses {step}, {total} and {name}; `nextTemplate` uses {name}. The last step has no Next. */
export function progressLine({
  step,
  total,
  names,
  stepTemplate,
  nextTemplate,
}: {
  /** Zero-based index of the current step. */
  step: number;
  total: number;
  names: readonly string[];
  stepTemplate: string;
  nextTemplate: string;
}) {
  const fill = (template: string, values: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
  const head = fill(stepTemplate, {
    step: String(step + 1),
    total: String(total),
    name: names[step] ?? '',
  });
  const next = names[step + 1];
  return next ? `${head} · ${fill(nextTemplate, { name: next })}` : head;
}

export function PlanProgress({
  line,
  names,
  current,
  listLabel,
  progressLabel,
}: {
  line: string;
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
