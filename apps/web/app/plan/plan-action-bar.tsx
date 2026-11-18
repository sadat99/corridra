import type { ReactNode } from 'react';

/**
 * The phone bottom action area (UI/UX.v4, row "Phone bottom action area"): the one primary action and its
 * reassurance line, fixed under the thumb on a phone and in the flow on wider screens. The button keeps its own
 * markup, so it stays a real submit button with the same validation as before. `waiting` is only a style hook for
 * the state before a choice is made; the button is never disabled by it.
 */
export function PlanActionBar({
  children,
  note,
  waiting,
}: {
  children: ReactNode;
  /** The reassurance line under the buttons. Omitted while there is nothing true to say. */
  note?: ReactNode;
  waiting?: boolean;
}) {
  return (
    <div className="plan-action-bar" data-waiting={waiting ? '' : undefined}>
      <div className="plan-action-row">{children}</div>
      {note ? <p className="plan-action-note">{note}</p> : null}
    </div>
  );
}
