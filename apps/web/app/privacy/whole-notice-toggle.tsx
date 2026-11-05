'use client';

import { useState } from 'react';

/**
 * "Show the whole notice" (layout budget, L-05). The notice shows one section at a time; this shows every
 * section, in full, for reading and searching on the page. Nothing is removed either way: all sections are in
 * the page, and printing always shows the whole notice. The frame carries the choice as data-whole.
 */
export function WholeNoticeToggle() {
  const [whole, setWhole] = useState(false);
  return (
    <button
      type="button"
      className="text-link privacy-whole-toggle"
      aria-pressed={whole}
      aria-controls="privacy-doc"
      onClick={() => {
        const next = !whole;
        setWhole(next);
        const frame = document.getElementById('privacy-notice');
        if (frame) frame.dataset.whole = String(next);
      }}
    >
      Show the whole notice
    </button>
  );
}
