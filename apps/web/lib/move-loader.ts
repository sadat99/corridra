// Reads, for one signed-in person, the records Your Move is built from. Server only. Every source is
// read only when its own module is on (a closed gate must not touch provider state or private data),
// and a source that fails is left out but named in `unreadable`, so Your Move shows what it can prove,
// never guesses, and never says "nothing is waiting" when it could not look.
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import type { CustomerDeliveredReportService } from '@corridra/auth/customer-delivered-reports';
import { foundations } from './foundations';
import type { MoveInput } from './move-cards';

import { movePageCap, moveWorkspaceCap } from './move-constants';
import { followPages } from './move-pages';

/** A record source that is switched on but could not be read for this page. */
export type MoveSource =
  'account' | 'workspaces' | 'drafts' | 'quotes' | 'companies' | 'requests' | 'moves' | 'reports';

type Loaded = {
  input: MoveInput;
  /** Workspaces beyond the cap, whose drafts and quotes were not read. */
  skippedWorkspaces: number;
  /** True when a request can be started from a workspace (the same test the account page uses). */
  requestCreationEnabled: boolean;
  /** True when a list was longer than the pages read, so what is shown may not be everything. */
  partial: boolean;
  /** Sources that are on but failed to answer. Empty means every source that is on was read. */
  unreadable: MoveSource[];
};

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function loadMoveInput(subject: string, issuer: string): Promise<Loaded> {
  const empty: Loaded = {
    input: { workspaces: [], drafts: [], quotes: [], companyLinks: [], requests: [] },
    skippedWorkspaces: 0,
    requestCreationEnabled: false,
    partial: false,
    unreadable: [],
  };
  // The workspace module being off is a true empty: there is nothing to read.
  if (!customerWorkspacesEnabled()) return empty;
  const services = foundations();
  if (!services) return { ...empty, unreadable: ['account'] };
  try {
    await services.ready;
  } catch {
    return { ...empty, unreadable: ['account'] };
  }

  const unreadable = new Set<MoveSource>();
  const listed = await attempt(() => services.customerWorkspaces.list(subject, issuer));
  if (listed === null) unreadable.add('workspaces');
  const workspaces = listed ?? [];
  const read = workspaces.slice(0, moveWorkspaceCap);
  const input: MoveInput = {
    workspaces: workspaces.map(({ id, name, role }) => ({ id, name, role })),
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [],
  };

  const [drafts, quotes, links, requests, moveRecords] = await Promise.all([
    Promise.all(
      customerMissionDraftsEnabled()
        ? read.map(async (workspace) => ({
            workspaceId: workspace.id,
            ...(await followPages(async (after) => {
              const page = await services.customerMissionDrafts.list(
                { workspaceId: workspace.id, pageSize: 100, ...(after ? { after } : {}) },
                subject,
                issuer,
              );
              return { items: page.drafts, nextAfter: page.nextAfter };
            }, movePageCap)),
          }))
        : [],
    ),
    Promise.all(
      customerServiceRequestsEnabled()
        ? read.map(async (workspace) =>
            followPages(async (after) => {
              const page = await services.customerServiceRequests.list(
                { workspaceId: workspace.id, pageSize: 50, ...(after ? { after } : {}) },
                subject,
                issuer,
              );
              return { items: page.requests, nextAfter: page.nextAfter };
            }, movePageCap),
          )
        : [],
    ),
    customerOrganisationLinksEnabled()
      ? attempt(() => services.customerOrganisationLinks.overview(subject, issuer))
      : null,
    customerRequestsEnabled()
      ? followPages(async (after) => {
          const page = (await services.customerRequests.list(
            { pageSize: 100, ...(after ? { after } : {}) },
            subject,
            issuer,
          )) as { requests: unknown[]; nextAfter?: string | null };
          return { items: page.requests, nextAfter: page.nextAfter };
        }, movePageCap)
      : null,
    customerMovesEnabled()
      ? attempt(() => services.customerMoves.list({ pageSize: 100 }, subject, issuer))
      : null,
  ]);

  let partial = false;
  for (const page of drafts) {
    if (page.failed) {
      unreadable.add('drafts');
      continue;
    }
    partial ||= !page.complete;
    for (const draft of page.items)
      if (draft.status === 'OPEN')
        input.drafts.push({
          id: draft.id,
          workspaceId: page.workspaceId,
          title: draft.title,
          updatedAt: draft.updatedAt,
        });
  }
  for (const page of quotes) {
    if (page.failed) {
      unreadable.add('quotes');
      continue;
    }
    partial ||= !page.complete;
    for (const request of page.items)
      if (request.status === 'quoted')
        input.quotes.push({
          id: request.id,
          workspaceId: request.workspaceId,
          title: request.serviceTitle,
          contextLabel: request.contextLabel,
        });
  }
  if (customerOrganisationLinksEnabled() && links === null) unreadable.add('companies');
  for (const link of links?.workspaces ?? [])
    if (link.status === 'needs_evidence')
      input.companyLinks.push({
        workspaceId: link.workspaceId,
        organisationName: link.organisationName,
      });
  if (requests?.failed) unreadable.add('requests');
  if (requests && !requests.failed) {
    partial ||= !requests.complete;
    for (const row of requests.items as {
      id: string;
      workspaceId: string;
      createdAt: string;
      available: boolean;
      progress: MoveInput['requests'][number]['progress'];
    }[])
      input.requests.push({
        id: row.id,
        workspaceId: row.workspaceId,
        createdAt: row.createdAt,
        progress: row.available ? row.progress : null,
      });
  }

  if (customerMovesEnabled() && moveRecords === null) unreadable.add('moves');
  input.moves = (moveRecords?.requests ?? []) as NonNullable<MoveInput['moves']>;

  // CQ-77: published reports, once the service wiring provides the delivered-reports service.
  const delivered = (
    services as unknown as { customerDeliveredReports?: CustomerDeliveredReportService }
  ).customerDeliveredReports;
  if (delivered) {
    const reports = await attempt(() => delivered.list(subject, issuer));
    if (reports === null) unreadable.add('reports');
    input.reports = reports ?? [];
  }

  return {
    input,
    skippedWorkspaces: Math.max(0, workspaces.length - read.length),
    // Same test as the account page: the request list answers, so a request can be started.
    requestCreationEnabled: requests !== null && !requests.failed,
    partial,
    unreadable: [...unreadable],
  };
}
