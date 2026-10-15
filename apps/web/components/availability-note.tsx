'use client';
import { usePathname } from 'next/navigation';

/**
 * Site-wide availability line. The home page already says the same thing under its main action,
 * so the first screen stays clear of it there.
 */
export function AvailabilityNote() {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <aside className="availability-note" aria-label="Service availability">
      Mission intake is open for example requests. Customer missions are not open yet.
    </aside>
  );
}
