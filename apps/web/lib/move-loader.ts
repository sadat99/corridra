// Reads, for one signed-in person, the records Your Move is built from. Server only. Every source is
// read only when its own module is on (a closed gate must not touch provider state or private data),
// and a source that fails is left out: Your Move shows what it can prove and never guesses.
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { foundations } from './foundations';
import type { MoveInput } from './move-cards';

import { movePageCap, moveWorkspaceCap } from './move-constants';
import { followPages } from './move-pages';

type Loaded = {
  input: MoveInput;
  /** Workspaces beyond the cap, whose drafts and quotes were not read. */
  skippedWorkspaces: number;
  /** True when a request can be started from a workspace (the same test the account page uses). */
  requestCreationEnabled: boolean;
  /** True when a list was longer than the pages read, so what is shown may not be everything. */
  partial: boolean;
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
  };
  if (!customerWorkspacesEnabled()) return empty;
  const services = foundations();
  if (!services) return empty;
  try {
    await services.ready;
  } catch {
    return empty;
  }

  const workspaces = (await attempt(() => services.customerWorkspaces.list(subject, issuer))) ?? [];
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
    if (page.failed) continue;
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
    if (page.failed) continue;
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
  for (const link of links?.workspaces ?? [])
    if (link.status === 'needs_evidence')
      input.companyLinks.push({
        workspaceId: link.workspaceId,
        organisationName: link.organisationName,
      });
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

  input.moves = (moveRecords?.requests ?? []) as NonNullable<MoveInput['moves']>;

  return {
    input,
    skippedWorkspaces: Math.max(0, workspaces.length - read.length),
    // Same test as the account page: the request list answers, so a request can be started.
    requestCreationEnabled: requests !== null && !requests.failed,
    partial,
  };
}
