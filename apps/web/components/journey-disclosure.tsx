'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/** Keep every child mounted and preserve legacy links into the directory. */
export function JourneyDisclosure({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function openDestination(fragment: string) {
      const destination = fragment ? document.getElementById(fragment) : null;
      const disclosure = ref.current;
      if (!destination || !disclosure?.contains(destination)) return;
      disclosure.open = true;
      destination.scrollIntoView({ block: 'start' });
      destination.focus({ preventScroll: true });
    }
    function revealDestination() {
      openDestination(window.location.hash.slice(1));
    }
    function followLink(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        !link ||
        link.origin !== window.location.origin ||
        link.pathname !== window.location.pathname ||
        link.search !== window.location.search
      )
        return;
      openDestination(link.hash.slice(1));
    }
    revealDestination();
    window.addEventListener('hashchange', revealDestination);
    document.addEventListener('click', followLink);
    return () => {
      window.removeEventListener('hashchange', revealDestination);
      document.removeEventListener('click', followLink);
    };
  }, []);
  return (
    <details ref={ref} id={id} tabIndex={-1} className="ux-journey-disclosure">
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
