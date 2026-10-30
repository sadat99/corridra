'use client';
import type { ReactNode } from 'react';
import { PublicShell } from '../../components/public-shell';

/**
 * The main region of the request page. The form's words are English here, so the region says so itself and the
 * page is exactly what it was.
 */
export function FormMain({ className, children }: { className: string; children: ReactNode }) {
  return (
    <PublicShell className={className} translated language="en">
      {children}
    </PublicShell>
  );
}
