// The work-item adapter's shapes (docs/revamp/specs/work-items.md). A work item is a read-only view of
// one existing record. It carries no amount, price, quote figure, markup or contact detail.
export type WorkFamily = 'SELL' | 'SOURCE' | 'ORGANISE' | 'UNCLASSIFIED';
export type WorkKind = 'draft' | 'request' | 'programme' | 'service_request';

/** A record source that is switched on but could not be read for this list. */
export type WorkSource =
  'account' | 'workspaces' | 'drafts' | 'requests' | 'programmes' | 'services';

export type WorkItem = {
  /** `${kind}:${id}`, unique in the list. */
  key: string;
  kind: WorkKind;
  /** The source record id, unchanged. */
  id: string;
  workspaceId: string;
  family: WorkFamily;
  /** Stored text as written; null when the source has none. */
  title: string | null;
  /** The source's own status value, never renamed. Empty when the source has no status. */
  status: string;
  /** ISO time from the source. */
  updatedAt: string;
  /** An existing route for this record. */
  href: string;
};

export type WorkList = {
  items: WorkItem[];
  /** Sources that are on and failed, as in Your Move. */
  unreadable: WorkSource[];
  /** A list was longer than the pages read. */
  partial: boolean;
  /** Workspaces beyond the cap, not read. */
  skippedWorkspaces: number;
  /** The person's workspaces by id, for display only. A name never classifies or joins anything. */
  workspaces: { id: string; name: string }[];
};
