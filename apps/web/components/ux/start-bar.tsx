'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import './start-bar.css';

// The phone bottom action area (board 3c; UI/UX.v4 step 2): one action and its reassurance line, never a tab bar.
// Up to 760 px wide it appears once the element named `after` has scrolled away, and it hides while any element named
// in `hideAt` (the page's own actions, the footer) is on screen. While it shows, the page gains room at its foot so it
// never covers content; while hidden it is inert. No motion under reduced motion.
export function StartBar({
  href,
  label,
  note,
  name,
  after,
  hideAt,
}: {
  href: string;
  label: string;
  /** The reassurance line under the action. */
  note: string;
  /** The group's accessible name. */
  name: string;
  /** Element id: the bar waits until it has left the screen. */
  after: string;
  /** CSS selectors of elements that hide the bar while on screen. */
  hideAt: string[];
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const first = document.getElementById(after);
    const others = hideAt.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const watched = [first, ...others].filter((el): el is Element => el !== null);
    const visible = new Map<Element, boolean>(watched.map((el) => [el, el === first]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target, entry.isIntersecting);
        setOn(![...visible.values()].some(Boolean));
      },
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' },
    );
    for (const el of watched) observer.observe(el);
    return () => observer.disconnect();
  }, [after, hideAt]);
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.setAttribute('data-start-bar', 'on');
    else root.removeAttribute('data-start-bar');
    return () => root.removeAttribute('data-start-bar');
  }, [on]);
  return (
    <div
      className="ux-start-bar"
      role="group"
      aria-label={name}
      data-on={on ? 'true' : undefined}
      inert={!on}
    >
      <Link prefetch={false} className="primary-link" href={href}>
        {label}
      </Link>
      <p className="ux-start-bar-note">{note}</p>
    </div>
  );
}
