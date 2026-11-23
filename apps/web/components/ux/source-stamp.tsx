import type { ReactNode } from 'react';
import './source-stamp.css';

// Source stamp (UI/UX.v4.1 L10): where a screen shows a fact, one 12 px Geist Mono line with a small dot may give the
// source of the fact and its date. It is a label, not one of the five trust labels, and it claims nothing about how
// far the source was checked. It formats nothing: the date is the words `formatDateTime` (lib/ux/format.ts) made.
export function SourceStamp({
  source,
  date,
}: {
  /** Where the fact comes from, in plain words. */
  source: ReactNode;
  /** The date of the source, already formatted by `formatDateTime`. Left out, the line gives the source alone. */
  date?: string;
}) {
  return (
    <span className="ux-source-stamp">
      <span className="ux-source-stamp-dot" aria-hidden="true" />
      <span className="ux-source-stamp-words">
        {source}
        {date ? ` · ${date}` : null}
      </span>
    </span>
  );
}
