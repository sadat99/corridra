/** Done, now, later, with the words under every step. The current step is announced to screen readers. */
export function JourneyBar({
  steps,
  current,
  label,
}: {
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  label: string;
}) {
  return (
    <ol className="guide-journey-bar" aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          data-done={index < current}
        >
          <span aria-hidden="true">{index < current ? '✓' : index + 1}</span>
          <b>{step}</b>
        </li>
      ))}
    </ol>
  );
}
