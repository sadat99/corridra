import type { ReactNode } from 'react';

/** The five fact labels. Icon plus word, so colour is never the only clue. */
export const factLabels = [
  {
    label: 'Self-declared',
    tone: 'unknown',
    line: 'Stated by the company.',
    icon: <path d="M4 5h16v11H9l-5 4z" />,
  },
  {
    label: 'Evidence available',
    tone: 'info',
    line: 'Proof was provided.',
    icon: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
      </>
    ),
  },
  {
    label: 'Verified',
    tone: 'positive',
    line: 'Checked by a defined process.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  },
  {
    label: 'Derived',
    tone: 'caution',
    line: 'Worked out from available data.',
    icon: <path d="M4 18 9 9l4 5 7-9" />,
  },
  {
    label: 'Outcome observed',
    tone: 'positive',
    line: 'A real result was recorded.',
    icon: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4h12l-2 4 2 4H5" />
      </>
    ),
  },
] as const;

export type FactTone = (typeof factLabels)[number]['tone'];

export function FactLabel({
  label,
  as: Tag = 'span',
  children,
}: {
  label: (typeof factLabels)[number]['label'];
  as?: 'span' | 'h2' | 'h3';
  children?: ReactNode;
}) {
  const fact = factLabels.find((item) => item.label === label)!;
  return (
    <Tag className="guide-tag" data-tone={fact.tone}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {fact.icon}
      </svg>
      {children ?? fact.label}
    </Tag>
  );
}
