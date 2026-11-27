import type { ReactNode } from 'react';
import type { FieldState } from '@corridra/domain/route-pack-standard';
import { CorridraIcon } from '../corridra-icon';
import './fact-mark.css';

// The state of one route fact (ADR-093 Phase 3): a shape and its word, never colour alone. The shapes are the Room stage
// shapes of the visual grammar: a filled circle with a tick (Filled, as Done), a hollow circle (Pending, as Later) and a
// dashed circle (Not applicable, as Not tracked yet). The word always sits beside the shape. They are completeness words,
// never trust labels.
const words: Record<FieldState, string> = {
  FILLED: 'Filled',
  NOT_APPLICABLE: 'Not applicable',
  PENDING: 'Pending',
};
export function FactMark({ state }: { state: FieldState }) {
  return (
    <span className="ux-fact-mark" data-state={state}>
      <span className="ux-fact-mark-shape" aria-hidden="true">
        {state === 'FILLED' ? <CorridraIcon name="check" /> : null}
      </span>
      <span>{words[state]}</span>
    </span>
  );
}
/** A fact that has run past its valid-until date: the clock and its words. It changes no state and hides no value. */
export function StaleMark({ children }: { children: ReactNode }) {
  return (
    <span className="ux-fact-mark ux-fact-mark-stale">
      <CorridraIcon name="clock" />
      <span>{children}</span>
    </span>
  );
}
