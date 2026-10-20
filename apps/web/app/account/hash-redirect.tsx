'use client';
import { useEffect } from 'react';

const homes: Record<string, string> = {
  'my-work': 'work',
  'customer-workspaces': 'work',
  'customer-requests': 'work',
  results: 'results',
  'customer-missions': 'results',
  'saved-commercial-missions': 'results',
  more: 'more',
};

/** Older links point at a section of one long page. Send them to the tab that now holds it. */
export function AccountHashRedirect({ view }: { view: string }) {
  useEffect(() => {
    const target = homes[window.location.hash.slice(1)];
    if (target && target !== view)
      window.location.replace('/account?view=' + target + window.location.hash);
  }, [view]);
  return null;
}
