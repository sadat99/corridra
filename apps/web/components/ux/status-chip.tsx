// A status label with a tone. The words carry the meaning; colour only supports them.
// Its own file with no Next.js import, so plain bundles (the fixture specs) can render it.
// Owner: WS-E.
import './ux-kit.css';
import type { ChipTone } from '../../lib/ux/customer-road';

export function StatusChip({ status }: { status: { label: string; tone: ChipTone } }) {
  return (
    <span className="ux-kit-chip" data-tone={status.tone}>
      {status.label}
    </span>
  );
}
