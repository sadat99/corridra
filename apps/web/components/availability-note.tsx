'use client';
import { usePathname } from 'next/navigation';

/**
 * Site-wide availability line. The home page and the request page already say the same thing in
 * their own words, so those two screens stay clear of it.
 */
export function AvailabilityNote() {
  const pathname = usePathname();
  if (pathname === '/' || pathname === '/plan') return null;
  return (
    <aside className="availability-note" aria-label="Service availability">
      Mission intake is open for example requests. Customer missions are not open yet.
    </aside>
  );
}
