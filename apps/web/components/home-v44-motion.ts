'use client';

import { useEffect } from 'react';

// Home page v4.4 motion: each band of the page rises into place once, the first time it scrolls into view (420 ms).
// Nothing is hidden without script, and nothing is hidden or moved when the visitor has asked for reduced motion.
// The route map's own motion (travelling dot, pulse) is stopped by its Pause Motion control.
export function useHomeV44Motion() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>('.hv43 .hv43-band, .hv44-closing, .hv44-status-card'),
    );
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-in', '');
          seen.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const el of targets) {
      el.setAttribute('data-hv44-r', '');
      seen.observe(el);
    }
    return () => {
      seen.disconnect();
      for (const el of targets) {
        el.removeAttribute('data-hv44-r');
        el.removeAttribute('data-in');
      }
    };
  }, []);
}
