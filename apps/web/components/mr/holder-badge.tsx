import './holder-badge.css';
import { mrLabels } from './labels';

import type { Holder } from './types';
export { holders, type Holder } from './types';

export function HolderBadge({
  holder,
  labels = mrLabels.holder,
}: {
  holder: Holder;
  labels?: Record<Holder, string>;
}) {
  return (
    <span className="mr-holder" data-holder={holder}>
      <i className="mr-holder-shape" data-holder={holder} aria-hidden="true" />
      {labels[holder]}
    </span>
  );
}
