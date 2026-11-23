'use client';
// One shared Copy button (owner walk D-048), for a value that sits in a read-only input beside it: a one-time
// invitation code, a member code. It puts the exact text on the clipboard and says so in a polite live region. Where
// the browser has no clipboard, or refuses it, the input's text is selected instead and the person is told which keys
// copy it, so copying never dead-ends. Wrap the field and the button in `.ux-copy-row` to set them side by side.
import './copy-button.css';
import { useState, type RefObject } from 'react';
import { CorridraIcon } from '../corridra-icon';

export function CopyButton({
  value,
  target,
  label = 'Copy Code',
  copiedLabel = 'Copied',
}: {
  /** The exact text that goes on the clipboard. */
  value: string;
  /** The read-only input that shows the same text, as a ref or as its id. It is selected when the clipboard fails. */
  target: RefObject<HTMLInputElement | null> | string;
  label?: string;
  copiedLabel?: string;
}) {
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'selected'>('idle');
  async function copy() {
    // Emptied first, so copying a second time is said a second time.
    setOutcome('idle');
    try {
      await navigator.clipboard.writeText(value);
      setOutcome('copied');
    } catch {
      const input = typeof target === 'string' ? document.getElementById(target) : target.current;
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      setOutcome('selected');
    }
  }
  return (
    <>
      <button type="button" className="secondary-link ux-copy-button" onClick={() => void copy()}>
        <CorridraIcon name="document" />
        {label}
      </button>
      <span role="status" aria-live="polite" className="ux-copy-note">
        {outcome === 'copied'
          ? copiedLabel
          : outcome === 'selected'
            ? 'Copying did not work. The text is selected. Press Ctrl+C or Cmd+C to copy.'
            : ''}
      </span>
    </>
  );
}
