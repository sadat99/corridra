'use client';
import { useEffect, useState } from 'react';

export type LinkStatus = 'none' | 'pending' | 'needs_evidence' | 'approved' | 'rejected';
export type LinkOverview = Record<string, { status: LinkStatus; organisationName: string | null }>;
export function linkStatusText(status: LinkStatus, organisationName: string | null) {
  switch (status) {
    case 'pending':
      return 'Waiting for review';
    case 'needs_evidence':
      return 'More evidence needed';
    case 'approved':
      return organisationName ? `Linked to ${organisationName}` : 'Linked';
    case 'rejected':
      return 'Not approved';
    default:
      return 'No company link yet';
  }
}
const statuses = ['none', 'pending', 'needs_evidence', 'approved', 'rejected'];
// Read-only status for the workspace list. A failure simply shows nothing: the list never depends on it.
export function useCompanyLinkOverview(
  enabled: boolean,
  subject: string,
  issuer: string,
  refreshKey: unknown,
) {
  const [overview, setOverview] = useState<LinkOverview | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const r = await fetch('/api/customer-organisation-links?scope=overview', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
        });
        if (!r.ok) throw Error('overview');
        const body = (await r.json()) as {
          workspaces?: {
            workspaceId: string;
            status: LinkStatus;
            organisationName: string | null;
          }[];
        };
        if (
          !Array.isArray(body.workspaces) ||
          !body.workspaces.every(
            (w) => typeof w.workspaceId === 'string' && statuses.includes(w.status),
          )
        )
          throw Error('overview');
        if (!controller.signal.aborted)
          setOverview(
            Object.fromEntries(
              body.workspaces.map((w) => [
                w.workspaceId,
                { status: w.status, organisationName: w.organisationName ?? null },
              ]),
            ),
          );
      } catch {
        if (!controller.signal.aborted) setOverview(null);
      }
    })();
    return () => controller.abort();
  }, [enabled, subject, issuer, refreshKey]);
  return enabled ? overview : null;
}
export function CompanyLinkLine({
  overview,
  workspaceId,
}: {
  overview: LinkOverview | null;
  workspaceId: string;
}) {
  const row = overview?.[workspaceId];
  if (!row) return null;
  return <p>Company link: {linkStatusText(row.status, row.organisationName)}</p>;
}
