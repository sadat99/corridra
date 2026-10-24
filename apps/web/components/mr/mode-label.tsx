import './mode-label.css';
import { mrLabels } from './labels';

/**
 * One label per tenant for the data mode: "Sample" (invented data only) or "Real". It replaces a
 * per-control "(sample request)" suffix, so a screen reader hears the mode once, not on every
 * button. The word is always shown; colour is never the only clue.
 */
export function ModeLabel({
  real,
  labels = mrLabels.mode,
}: {
  /** True when the tenant holds real data. False is sample data. */
  real: boolean;
  labels?: typeof mrLabels.mode;
}) {
  return (
    <span className="mr-mode" data-mode={real ? 'real' : 'sample'}>
      {real ? labels.real : labels.sample}
    </span>
  );
}
