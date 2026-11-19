'use client';
import { useEffect, useRef, type ReactNode } from 'react';

// On a phone the bar is fixed, so the page must keep room for its real height (which grows with text size), and a bar
// that would cover more than about a third of the window joins the page flow instead: it must never cover content.
// The two limits differ so a bar near the edge does not flip back and forth.
const phone = '(max-width: 700px) and (min-height: 32rem)';
const joinFlowAbove = 0.34;
const leaveFlowBelow = 0.28;

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
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement;
    const measure = () => {
      const onPhone = window.matchMedia(phone).matches;
      const share = element.offsetHeight / window.innerHeight;
      const inFlow = element.hasAttribute('data-flow');
      const flow = onPhone && (inFlow ? share > leaveFlowBelow : share > joinFlowAbove);
      if (flow !== inFlow) element.toggleAttribute('data-flow', flow);
      // The padding under the page and the scroll padding follow the bar's real height (see plan-v4.css).
      if (onPhone && !flow)
        root.style.setProperty('--plan-action-bar-h', `${element.offsetHeight}px`);
      else root.style.removeProperty('--plan-action-bar-h');
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--plan-action-bar-h');
    };
  }, []);
  return (
    <div ref={bar} className="plan-action-bar" data-waiting={waiting ? '' : undefined}>
      <div className="plan-action-row">{children}</div>
      {note ? <p className="plan-action-note">{note}</p> : null}
    </div>
  );
}
