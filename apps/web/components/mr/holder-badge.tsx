import './holder-badge.css';
import { mrLabels } from './labels';

/** Who is holding a piece of work. Fixed shapes; the word is always shown, never colour alone. */
export type Holder = 'you' | 'team' | 'third';
export const holders: readonly Holder[] = ['you', 'team', 'third'];

export function HolderBadge({
  holder,
  labels = mrLabels.holder,
}: {
  holder: Holder;
  labels?: Record<Holder, string>;
}) {
  return (
    <span className="mr-holder" data-holder={holder}>
      <i className="mr-holder-shape" aria-hidden="true" />
      {labels[holder]}
    </span>
  );
}
