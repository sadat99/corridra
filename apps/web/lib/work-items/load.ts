// Reads, for one signed-in person, the records the Work screen lists (docs/revamp/specs/work-items.md).
// Server only and read only: it goes through the services the account and Your Move already call, with
// the same session proof, adds no table, route or write, and keeps only items in a workspace the person
// belongs to. A source that is on and fails is named in `unreadable`; a module that is off is a true
// empty; a list longer than the pages read sets `partial`.
import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { foundations } from '../foundations';
import { movePageCap, moveWorkspaceCap } from '../move-constants';
import { followPages } from '../move-pages';
import { requestTitle } from '../../app/account/request-words';
import { classifyDraftFamily, classifyObjective } from './classify';
import { sortWorkItems } from './sort';
import type { WorkItem, WorkList, WorkSource } from './types';

/** Each request detail is its own session-checked read, so the detail reads are bounded. */
export const workDetailCap = 30;

type Obj = Record<string, unknown>;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const seg = encodeURIComponent;

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function loadWorkItems(
  subject: string,
  issuer: string,
  options: {
    /** `CORRIDRA_UX_ROAD`: a request opens in its Room, as Your Move does. */ rooms?: boolean;
  } = {},
): Promise<WorkList> {
  const none: WorkList = {
    items: [],
    unreadable: [],
    partial: false,
    skippedWorkspaces: 0,
    workspaces: [],
  };
  // The workspace module being off is a true empty: there is nothing to read.
  if (!customerWorkspacesEnabled()) return none;
  const services = foundations();
  if (!services) return { ...none, unreadable: ['account'] };
  try {
    await services.ready;
  } catch {
    return { ...none, unreadable: ['account'] };
  }

  // Without the person's workspaces nothing can be scoped, so nothing is listed.
  const listed = await attempt(() => services.customerWorkspaces.list(subject, issuer));
  if (listed === null) return { ...none, unreadable: ['workspaces'] };
  const allowed = new Set(listed.map((workspace) => workspace.id));
  const read = listed.slice(0, moveWorkspaceCap);
  const admin = read.filter(
    (workspace) => workspace.role === 'owner' || workspace.role === 'admin',
  );

  const [drafts, services_, programmes, requests] = await Promise.all([
    customerMissionDraftsEnabled()
      ? Promise.all(
          read.map(async (workspace) => ({
            workspaceId: workspace.id,
            ...(await followPages(async (after) => {
              const page = await services.customerMissionDrafts.list(
                { workspaceId: workspace.id, pageSize: 100, ...(after ? { after } : {}) },
                subject,
                issuer,
              );
              return { items: page.drafts, nextAfter: page.nextAfter };
            }, movePageCap)),
          })),
        )
      : null,
    customerServiceRequestsEnabled()
      ? Promise.all(
          read.map(async (workspace) =>
            followPages(async (after) => {
              const page = await services.customerServiceRequests.list(
                { workspaceId: workspace.id, pageSize: 50, ...(after ? { after } : {}) },
                subject,
                issuer,
              );
              return { items: page.requests, nextAfter: page.nextAfter };
            }, movePageCap),
          ),
        )
      : null,
    customerProgrammesEnabled()
      ? Promise.all(
          admin.map(async (workspace) =>
            followPages(async (after) => {
              const page = await services.customerProgrammes.list(
                { workspaceId: workspace.id, pageSize: 25, ...(after ? { after } : {}) },
                subject,
                issuer,
              );
              return { items: page.programmes as Obj[], nextAfter: page.nextAfter };
            }, movePageCap),
          ),
        )
      : null,
    customerRequestsEnabled()
      ? followPages(async (after) => {
          const page = (await services.customerRequests.list(
            { pageSize: 100, ...(after ? { after } : {}) },
            subject,
            issuer,
          )) as { requests: Obj[]; nextAfter?: string | null };
          return { items: page.requests, nextAfter: page.nextAfter };
        }, movePageCap)
      : null,
  ]);

  const unreadable = new Set<WorkSource>();
  let partial = false;
  const byKey = new Map<string, WorkItem>();
  const add = (item: WorkItem) => {
    // Only a workspace the person belongs to; anything else is dropped without a trace.
    if (allowed.has(item.workspaceId) && !byKey.has(item.key)) byKey.set(item.key, item);
  };

  for (const page of drafts ?? []) {
    if (page.failed) {
      unreadable.add('drafts');
      continue;
    }
    partial ||= !page.complete;
    for (const draft of page.items)
      if (draft.status === 'OPEN')
        add({
          key: `draft:${draft.id}`,
          kind: 'draft',
          id: draft.id,
          workspaceId: page.workspaceId,
          family: classifyDraftFamily(draft.family),
          title: text(draft.title),
          status: draft.status,
          at: draft.updatedAt,
          atKind: 'updated',
          href: `/account/drafts/${seg(page.workspaceId)}`,
        });
  }

  for (const [index, page] of (programmes ?? []).entries()) {
    if (page.failed) {
      unreadable.add('programmes');
      continue;
    }
    partial ||= !page.complete;
    const workspaceId = admin[index]!.id;
    for (const programme of page.items) {
      const id = text(programme.id);
      if (!id) continue;
      add({
        key: `programme:${id}`,
        kind: 'programme',
        id,
        workspaceId,
        family: 'ORGANISE',
        title: text(programme.name),
        // A programme has no status of its own, so none is shown.
        status: '',
        at: text(programme.createdAt) ?? '',
        atKind: 'created',
        href: `/account/delegations/${seg(workspaceId)}`,
      });
    }
  }

  for (const page of services_ ?? []) {
    if (page.failed) {
      unreadable.add('services');
      continue;
    }
    partial ||= !page.complete;
    for (const request of page.items)
      add({
        key: `service_request:${request.id}`,
        kind: 'service_request',
        id: request.id,
        workspaceId: request.workspaceId,
        // Display text such as the context label never classifies.
        family: 'UNCLASSIFIED',
        title: text(request.serviceTitle),
        status: request.status,
        at: request.updatedAt,
        atKind: 'updated',
        href: `/account/service-requests/${seg(request.workspaceId)}/${seg(request.id)}`,
      });
  }

  if (requests?.failed) unreadable.add('requests');
  if (requests && !requests.failed) {
    partial ||= !requests.complete;
    // Newest first, so the detail cap reads the requests the person most likely cares about. The list is
    // ordered by id, which is not by date.
    const created = (row: Obj) => Date.parse(text(row.createdAt) ?? '') || 0;
    const rows = requests.items
      .filter((row) => typeof row.id === 'string' && allowed.has(String(row.workspaceId)))
      .sort((a, b) => created(b) - created(a));
    const readDetails = customerRequestDetailsEnabled();
    // Requests beyond the cap are still listed, but their family and title are not known, so say so.
    if (readDetails && rows.length > workDetailCap) partial = true;
    // The objective and title are in the request's original brief, one session-checked read each. A
    // detail that cannot be read leaves the request UNCLASSIFIED, untitled and listed; it does not make
    // the list unreadable.
    const details = await Promise.all(
      rows.map(async (row, index) => {
        if (!readDetails || index >= workDetailCap) return null;
        return (await attempt(() =>
          services.customerRequestDetails.detail(row.id, subject, issuer),
        )) as {
          original?: unknown;
        } | null;
      }),
    );
    rows.forEach((row, index) => {
      const id = row.id as string;
      const progress = row.progress as { status?: unknown } | null | undefined;
      const original = details[index]?.original;
      add({
        key: `request:${id}`,
        kind: 'request',
        id,
        workspaceId: String(row.workspaceId),
        family: classifyObjective(
          (original as { objective?: unknown } | null | undefined)?.objective,
        ),
        // The same title the requests route derives from the original brief; null when it was not read.
        title: requestTitle(original),
        status: row.available === true ? (text(progress?.status) ?? '') : '',
        at: text(row.createdAt) ?? '',
        atKind: 'created',
        href: options.rooms ? `/account/rooms/${seg(id)}` : `/account/requests/${seg(id)}`,
      });
    });
  }

  return {
    items: sortWorkItems([...byKey.values()]),
    unreadable: [...unreadable],
    partial,
    skippedWorkspaces: Math.max(0, listed.length - read.length),
    workspaces: listed.map(({ id, name }) => ({ id, name })),
  };
}
