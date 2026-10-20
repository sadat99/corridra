'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The sample mission used to open from the home page (`/#mission-example`). It now lives with the
 * route explorer. This keeps every old link and bookmark working.
 */
export function LegacyHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (window.location.hash === '#mission-example') router.replace('/corridors#mission-example');
  }, [router]);
  return null;
}
