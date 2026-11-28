'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import './acting-for.css';

type Choice = { id: string; name: string; role: 'owner' | 'admin' | 'member' };
const KEY = 'corridra-acting-for';
const roleWord = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

/**
 * The choice is a display preference kept in this browser only; it opens nothing by itself. Start a Request goes to
 * the request page of the chosen business, which checks the person's role again.
 */
export function ActingForMenu({ workspaces }: { workspaces: readonly Choice[] }) {
  const [chosen, setChosen] = useState<string>(workspaces[0]!.id);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved && workspaces.some((w) => w.id === saved)) setChosen(saved);
    } catch {
      /* Storage can be refused; the first business stays chosen. */
    }
  }, [workspaces]);
  const current = workspaces.find((w) => w.id === chosen) ?? workspaces[0]!;
  const pick = (id: string) => {
    setChosen(id);
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
              <button
                type="button"
                aria-pressed={w.id === current.id}
                onClick={() => pick(w.id)}
              >
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
