'use client';
// Scoped action feedback and the form error summary (commercial readiness program, 5.2, CQ-01).
// Owner after Wave 0: WS-E (internals only; props are fixed).
import './ux-kit.css';
import { useEffect, useId, useRef, useState } from 'react';
import { fieldAnchor, summaryFocusDue } from '../../lib/ux/focus';

export type Feedback = { kind: 'success' | 'error'; text: string } | null;

/**
 * Shows one message next to the action that caused it. `scope` names the panel; a message from
 * another panel is never passed in, so messages never pile up across panels. Success clears after
 * 6 seconds; errors stay until the next attempt.
 */
export function ActionFeedback({
  scope,
  feedback,
  onClear,
}: {
  scope: string;
  feedback: Feedback;
  onClear?: () => void;
}) {
  useEffect(() => {
    if (feedback?.kind !== 'success') return;
    const timer = window.setTimeout(() => onClear?.(), 6000);
    return () => window.clearTimeout(timer);
  }, [feedback, onClear]);
  return (
    <div
      data-feedback-scope={scope}
      role={feedback?.kind === 'error' ? 'alert' : 'status'}
      aria-live={feedback?.kind === 'error' ? 'assertive' : 'polite'}
    >
      {feedback ? (
        <p className="ux-kit-feedback" data-kind={feedback.kind}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}

/** A small hook for one panel's feedback state. */
export function useActionFeedback() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  return {
    feedback,
    success: (text: string) => setFeedback({ kind: 'success', text }),
    error: (text: string) => setFeedback({ kind: 'error', text }),
    clear: () => setFeedback(null),
  };
}

export type FieldError = { field: string; message: string };

/**
 * Lists errors as links to their fields. Takes focus once per submit attempt (`attempt` changes on
 * each submit), never while the person types, so focus is not stolen on each keystroke (CQ-01).
 */
export function ErrorSummary({
  errors,
  attempt,
  title = 'Check these fields',
}: {
  errors: FieldError[];
  attempt: number;
  title?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const focusedFor = useRef(0);
  const titleId = `${useId()}-summary-title`;
  useEffect(() => {
    if (summaryFocusDue(attempt, focusedFor.current, errors.length)) {
      focusedFor.current = attempt;
      box.current?.focus();
    }
  }, [attempt, errors.length]);
  if (errors.length === 0) return null;
  return (
    <div
      className="ux-kit-summary"
      ref={box}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.field + e.message}>
            <a
              href={`#${fieldAnchor(e.field)}`}
              onClick={(event) => {
                const target = document.getElementById(fieldAnchor(e.field));
                if (target) {
                  event.preventDefault();
                  target.focus();
                  target.scrollIntoView({ block: 'center' });
                }
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
