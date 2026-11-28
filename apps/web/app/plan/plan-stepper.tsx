'use client';

// The five steps as a row of circles (owner canvas board v10). A finished step shows a tick and takes the person back
// to it. It is a sighted shortcut: screen readers get the same steps from the progress list beside it and keyboard
// users have the Back button, so this row is hidden from both.
export function PlanStepper({
  names,
  current,
  onGo,
}: {
  names: readonly string[];
  current: number;
  onGo: (step: number) => void;
}) {
  return (
    <div className="pv-steps" aria-hidden="true">
      {names.map((name, index) => (
        <div className="pv-step-wrap" key={name}>
          <button
            type="button"
            tabIndex={-1}
            className="pv-step"
            data-state={index < current ? 'done' : index === current ? 'now' : 'next'}
            disabled={index >= current}
            onClick={() => onGo(index)}
          >
            <span className="pv-step-dot">{index < current ? '✓' : index + 1}</span>
            <span className="pv-step-name">{name}</span>
          </button>
          {index < names.length - 1 && <i className="pv-step-line" data-done={index < current ? '' : undefined} />}
        </div>
      ))}
    </div>
  );
}
