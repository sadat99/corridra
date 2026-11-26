'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Where an old home address goes. The sample mission used to open from the home page (`/#mission-example`); it now
 * lives with the route explorer. With the one-job-per-page switch on (`deepPages`, CORRIDRA_UX_HOW_TRUST_V43), the
 * roles, the fourteen steps and Plain Limits left the home, so `/#who` and `/#how` go to /how-it-works and `/#limits`
 * to /trust. Null means the hash stays on the home page.
 */
export function legacyHashTarget(hash: string, deepPages = false): string | null {
  if (hash === '#mission-example') return '/corridors#mission-example';
  if (!deepPages) return null;
  if (hash === '#who' || hash === '#how') return `/how-it-works${hash}`;
  if (hash === '#limits') return '/trust#limits';
  return null;
}

export function LegacyHashRedirect({ deepPages = false }: { deepPages?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const target = legacyHashTarget(window.location.hash, deepPages);
    if (target) router.replace(target);
  }, [router, deepPages]);
  return null;
}
