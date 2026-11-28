'use client';

import { useEffect } from 'react';

// Home page v4.4 motion: each band of the page rises into place once, the first time it scrolls into view (420 ms).
// Nothing is hidden without script, and nothing is hidden or moved when the visitor has asked for reduced motion.
// The route map's own motion (travelling dot, pulse) is stopped by its Pause Motion control.
export function useHomeV44Motion() {
  // One Start a Request on screen at a time: the header's own stays out of sight while the hero's or the close's is in view.
  useEffect(() => {
    const root = document.documentElement;
    const spots = ['home-start', 'final-start']
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (!spots.length || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<Element, boolean>();
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target, entry.isIntersecting);
        root.setAttribute('data-hv7-hero', [...seen.values()].some(Boolean) ? 'in' : 'out');
      },
      { threshold: 0 },
    );
    for (const el of spots) watch.observe(el);
    return () => {
      watch.disconnect();
      root.removeAttribute('data-hv7-hero');
    };
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>('.hv7-band'),
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
      el.setAttribute('data-hv7-r', '');
      seen.observe(el);
    }
    return () => {
      seen.disconnect();
      for (const el of targets) {
        el.removeAttribute('data-hv7-r');
        el.removeAttribute('data-in');
      }
    };
  }, []);
}
