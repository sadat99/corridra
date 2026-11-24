'use client';
// Small parts shared by the supply source screens: the loader, the read failure answer, the paused and not installed
// notices and the two standing lines. Presentation only. The server decides what a person may read and change.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CorridraIcon } from '../../../components/corridra-icon';
import { ModeLabel } from '../../../components/mr/mode-label';
import { isNotInstalled, refusalWords, supplyGet } from '../../../lib/supply-screens';
import Link from 'next/link';
import '../../../components/ux/ux-kit.css';
import { useOperatorFlags } from '../operator-flags';
import { readFailureKind, readFailureWords } from '../read-failure';

export type Loaded<T> = {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
};

/** Loads once, and again when `reload` is called or the key changes. A stale answer is dropped. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    let current = true;
    latest
      .current()
      .then((value) => {
        if (!current) return;
        setData(value);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (current) setError(failure);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [key, revision]);
  const reload = useCallback(() => {
    setLoading(true);
    setRevision((value) => value + 1);
  }, []);
  return { data, error, loading, reload };
}

export function Loading({ words }: { words: string }) {
  return (
    <p role="status" className="supply-quiet">
      {words}
    </p>
  );
}

/** The one answer for a read that failed: the not installed state, or the shared failure words and one retry. */
export function ReadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (isNotInstalled(error))
    return (
      <p role="status" className="supply-notice">
        <CorridraIcon name="lock" className="supply-notice-icon" /> {refusalWords.notInstalled}
      </p>
    );
  return (
    <div role="alert" className="supply-failure">
      <p>{readFailureWords(readFailureKind(error))}</p>
      <button type="button" className="text-link" onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}

export type ScreenState = {
  moduleOpen: boolean;
  profile: { id: string; version: number; role: string } | null;
  kinds: string[];
};

/** Whether the module is open for new entries, and the mission's newest profile. A failed read leaves it unknown. */
export function useScreenState(tenant: string, mission?: string) {
  return useLoad<ScreenState>(
    () => supplyGet<ScreenState>(tenant, 'state', mission ? { mission } : {}),
    `${tenant}:${mission ?? ''}`,
  );
}

/** The paused notice. Reads keep working; a form says why its main button waits. */
export function PausedNotice({ paused }: { paused: boolean }) {
  if (!paused) return null;
  return (
    <p role="status" className="supply-notice">
      <CorridraIcon name="lock" className="supply-notice-icon" /> {refusalWords.paused}
    </p>
  );
}

export function DeniedNote() {
  return <p className="supply-quiet">{refusalWords.denied}</p>;
}

export const personalDataLine =
  "This list holds company details only. Contact details are refused. A company name can still be a person's name, so names are checked.";
export function PersonalDataLine() {
  return <p className="supply-quiet supply-wide">{personalDataLine}</p>;
}

export const sourceLabelLine =
  'Source-reported. These details are as stated by the source. Corridra has not verified them.';
export function SourceLabelLine() {
  // Team desk v4.1: the line takes the width of the column, like the line above it. Off, as it was.
  const { teamDeskV41 } = useOperatorFlags();
  return (
    <p className={teamDeskV41 ? 'supply-quiet supply-wide' : 'supply-quiet'}>{sourceLabelLine}</p>
  );
}

/**
 * The way back on a Supply page deeper than one level (team desk v4.1): the shared breadcrumb pattern, each
 * earlier level a link and the page in view named last, marked as the current page and not a link.
 */
export function SupplyCrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav className="ux-kit-crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((item, index) => (
          <li key={item.label}>
            {item.href && index < trail.length - 1 ? (
              <Link prefetch={false} href={item.href}>
                {item.label}
              </Link>
            ) : (
              <span aria-current={index === trail.length - 1 ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A step form's heading takes focus when the step changes (guided rule: focus moves to the question). */
export function StepHeading({ children, step }: { children: ReactNode; step: number }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);
  return (
    <h3 ref={heading} tabIndex={-1}>
      {children}
    </h3>
  );
}

/** The one mode label every supply screen starts with. The page and the layout fixture share it. */
export function SupplyModeLine({ real }: { real: boolean }) {
  return (
    <p className="supply-mode">
      <ModeLabel real={real} />
    </p>
  );
}
