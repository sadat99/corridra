import type { ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';

/** The five fact labels. Icon plus word, so colour is never the only clue. */
export const factLabels = [
  {
    label: 'Self-declared',
    tone: 'unknown',
    line: 'Stated by the company.',
    icon: 'selfDeclared',
  },
  {
    label: 'Evidence available',
    tone: 'info',
    line: 'Proof was provided.',
    icon: 'evidence',
  },
  {
    label: 'Verified',
    tone: 'positive',
    line: 'Checked by a defined process.',
    icon: 'verified',
  },
  {
    label: 'Derived',
    tone: 'caution',
    line: 'Worked out from available data.',
    icon: 'derived',
  },
  {
    label: 'Outcome observed',
    tone: 'positive',
    line: 'A real result was recorded.',
    icon: 'outcome',
  },
] as const;

export type FactTone = (typeof factLabels)[number]['tone'];

export function FactLabel({
  label,
  as: Tag = 'span',
  english = false,
  children,
}: {
  label: (typeof factLabels)[number]['label'];
  as?: 'span' | 'h2' | 'h3';
  /** The five trust names stay English in every language; on a translated page they say so. */
  english?: boolean;
  children?: ReactNode;
}) {
  const fact = factLabels.find((item) => item.label === label)!;
  return (
    <Tag className="guide-tag" data-tone={fact.tone} lang={english ? 'en' : undefined}>
      <CorridraIcon name={fact.icon} />
      {children ?? fact.label}
    </Tag>
  );
}
