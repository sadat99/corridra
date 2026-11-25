'use client';
import { useEffect, useSyncExternalStore } from 'react';

// Team desk v4.1: the mission page's title is the customer's name. The shell draws the page title on the
// server, before the mission is read in the browser, so the title is a slot: it says "Mission" until the
// mission page publishes the name it read, and says it again when that page goes away. Nothing is fetched here.
let current = '';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(next: string) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** The mission page calls this with the customer's name once it has read the mission. */
export function useMissionTitle(name: string | null) {
  useEffect(() => {
    if (!name) return;
    publish(name);
    const before = document.title;
    document.title = `${name} | Corridra`;
    return () => {
      publish('');
      document.title = before;
    };
  }, [name]);
}

/** The page title: the customer's name, or "Mission" while it is not known. */
export function MissionTitle() {
  const name = useSyncExternalStore(
    subscribe,
    () => current,
    () => '',
  );
  return <span data-mission-title>{name || 'Mission'}</span>;
}
