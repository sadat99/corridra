'use client';
// The Journey switcher (docs/revamp/specs/journey-modes.md 3.4): the first thing in the signed-in sidebar. An inline
// disclosure, not a floating panel, so it works the same in the phone drawer and in the icons-only bar and adds no
// second Escape. It is drawn at once from the mode the server read; the counts are decoration that arrive later
// (rule L16: a quiet badge, a zero not drawn, "N+" when a list was not read in full, a spoken name).
import './journey-switch.css';
import { Suspense, use, useRef, type HTMLAttributes } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CorridraIcon } from '../corridra-icon';
import {
  elsewhereCount,
  hrefForJourneySwitch,
  journeyModes,
  journeyModeTone,
  journeyModeWords,
  type JourneyMode,
} from '../../lib/ux/journey-mode';
import {
  journeyCountText,
  journeyCountWords,
  type JourneyCount,
  type JourneyCounts,
} from '../../lib/work-items/journey-counts';
import { rememberJourneyMode } from './journey-mode-context';

type Counts = Promise<JourneyCounts | null>;

function Badge({ count, words }: { count: JourneyCount | undefined; words?: string }) {
  const text = journeyCountText(count);
  if (!text) return null;
  return (
    <span className="ux-leftnav-count" data-journey-count="">
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">
        {journeyCountWords(count)}
        {words}
      </span>
    </span>
  );
}

/** One journey's own count, once read. Everything has none. */
function ChoiceCount({ counts, mode }: { counts: Counts; mode: JourneyMode }) {
  const read = use(counts);
  return mode === 'all' ? null : <Badge count={read?.[mode]} />;
}

/** Work in the journeys that are not the current one, on the closed switcher. */
function ElsewhereCount({ counts, mode }: { counts: Counts; mode: JourneyMode }) {
  return <Badge count={elsewhereCount(use(counts), mode)} words=" in other journeys" />;
}

function Dot({ mode }: { mode: JourneyMode }) {
  return (
    <i
      className="ux-customer-nav-dot"
      data-tone={mode === 'all' ? undefined : journeyModeTone[mode]}
      data-everything={mode === 'all' ? '' : undefined}
      aria-hidden="true"
    />
  );
}

export function JourneySwitch({
  mode,
  counts,
  summaryProps,
}: {
  mode: JourneyMode;
  /** Read on the server and never awaited by the frame. With none the control is drawn without counts. */
  counts?: Counts;
  /** The icons-only bar's hover and focus name (customer-rail.tsx). */
  summaryProps?: HTMLAttributes<HTMLElement> & { ref?: (el: HTMLElement | null) => void };
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const details = useRef<HTMLDetailsElement>(null);
  const choose = (next: JourneyMode) => {
    if (details.current) details.current.open = false;
    rememberJourneyMode(next);
    const here = window.location.pathname + window.location.search + window.location.hash;
    const href = hrefForJourneySwitch(
      pathname,
      window.location.search + window.location.hash,
      next,
    );
    // Home and Requests carry the journey in their address; every other page reads the cookie again in place.
    if (href && href !== here) router.push(href);
    else router.refresh();
  };
  return (
    <details ref={details} className="ux-journey-switch" lang="en">
      <summary aria-label={`Journey, ${journeyModeWords[mode]}`} {...summaryProps}>
        <Dot mode={mode} />
        <span className="ux-rail-label">
          <span className="ux-journey-switch-kicker">Journey</span>
          <span className="ux-journey-switch-name">{journeyModeWords[mode]}</span>
        </span>
        {counts ? (
          <Suspense fallback={null}>
            <ElsewhereCount counts={counts} mode={mode} />
          </Suspense>
        ) : null}
        <CorridraIcon name="chevron" size={16} className="ux-journey-switch-chevron" />
      </summary>
      <ul aria-label="Choose a journey">
        {journeyModes.map((choice) => (
          <li key={choice}>
            <button
              type="button"
              aria-current={choice === mode ? 'true' : undefined}
              onClick={() => choose(choice)}
            >
              <Dot mode={choice} />
              <span>{journeyModeWords[choice]}</span>
              {counts ? (
                <Suspense fallback={null}>
                  <ChoiceCount counts={counts} mode={choice} />
                </Suspense>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
