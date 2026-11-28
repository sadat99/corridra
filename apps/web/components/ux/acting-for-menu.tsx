'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import './acting-for.css';

type Choice = { id: string; name: string; role: 'owner' | 'admin' | 'member' };
const KEY = 'corridra-acting-for';
const roleWord = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

// The saved choice, read from this browser; another tab's change arrives as a storage event. Storage can be refused,
// and the server has none, so both read as no choice.
function subscribeSaved(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}
function readSaved(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * The choice is a display preference kept in this browser only; it opens nothing by itself. Start a Request goes to
 * the request page of the chosen business, which checks the person's role again.
 */
export function ActingForMenu({ workspaces }: { workspaces: readonly Choice[] }) {
  const saved = useSyncExternalStore(subscribeSaved, readSaved, () => null);
  const [picked, setPicked] = useState<string | null>(null);
  // Only a business in the list the server read can be chosen; anything else falls back to the first one.
  const chosen = [picked, saved].find((id) => id && workspaces.some((w) => w.id === id));
  const current = workspaces.find((w) => w.id === chosen) ?? workspaces[0]!;
  const pick = (id: string) => {
    setPicked(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* Not kept; the choice still applies on this page. */
    }
  };
  return (
    <details className="acting-for" lang="en">
      <summary>
        <span className="acting-for-label">Acting for</span>
        <strong>{current.name}</strong>
      </summary>
      <div className="acting-for-panel">
        <ul>
          {workspaces.map((w) => (
            <li key={w.id}>
              <button type="button" aria-pressed={w.id === current.id} onClick={() => pick(w.id)}>
                <span>{w.name}</span>
                <span className="acting-for-role">{roleWord[w.role]}</span>
              </button>
            </li>
          ))}
        </ul>
        <Link prefetch={false} className="acting-for-go" href={`/account/request/${current.id}`}>
          Start a Request
        </Link>
        <Link prefetch={false} className="text-link" href="/account/businesses">
          My Businesses
        </Link>
      </div>
    </details>
  );
}
