// What the Work screen says about a work list (docs/revamp/specs/home-work.md). Pure functions, so every
// state and every count is tested without a browser. Nothing here invents a status word or a number:
// words come from the existing customer status sets and counts from the items read.
import { customerStatusLabel } from '../ux/customer-road';
import { statusLabel } from '../../app/account/service-requests/service-request-client';
import type { ServiceStatus } from '@corridra/auth/customer-service-requests';
import type { WorkFamily, WorkItem, WorkKind, WorkList } from './types';

export const workFilters = ['all', 'sell', 'source', 'organise', 'other'] as const;
export type WorkFilter = (typeof workFilters)[number];

export const workFilterLabels: Record<WorkFilter, string> = {
  all: 'All',
  sell: 'Sell',
  source: 'Source',
  organise: 'Organise',
  other: 'Other',
};

const familyOf: Record<Exclude<WorkFilter, 'all'>, WorkFamily> = {
  sell: 'SELL',
  source: 'SOURCE',
  organise: 'ORGANISE',
  other: 'UNCLASSIFIED',
};

/** Reads `work=` through the closed list. Anything else, including a repeated key, is All. */
export function parseWorkFilter(value: string | string[] | undefined): WorkFilter {
  return typeof value === 'string' ? (workFilters.find((f) => f === value) ?? 'all') : 'all';
}

export function filterWorkItems(items: WorkItem[], filter: WorkFilter): WorkItem[] {
  return filter === 'all' ? items : items.filter((item) => item.family === familyOf[filter]);
}

/** Whether the list may be incomplete: a cut-off list, a source that failed, or workspaces not read. */
export const incomplete = (list: WorkList) =>
  list.partial || list.unreadable.length > 0 || list.skippedWorkspaces > 0;

export function workCounts(list: WorkList): Record<WorkFilter, string> {
  const n = (filter: WorkFilter) => filterWorkItems(list.items, filter).length;
  const text = (filter: WorkFilter) =>
    incomplete(list) ? `${n(filter)} or more` : String(n(filter));
  return Object.fromEntries(workFilters.map((f) => [f, text(f)])) as Record<WorkFilter, string>;
}

export type WorkState = 'unreadable' | 'empty' | 'filtered-empty' | 'list';

export function workState(list: WorkList, filter: WorkFilter): WorkState {
  // Never "nothing here" when a source could not be read, or the list was cut short, or workspaces were
  // left unread: the page cannot prove there is nothing.
  if (list.items.length === 0) return incomplete(list) ? 'unreadable' : 'empty';
  return filterWorkItems(list.items, filter).length === 0 ? 'filtered-empty' : 'list';
}

/** The date word for a row: an update, a request being sent, or a programme being created. */
export function workDateWords(item: WorkItem): string {
  if (!item.at) return '';
  return item.atKind === 'updated' ? 'Updated' : item.kind === 'request' ? 'Sent' : 'Created';
}

/** The language mark for stored text inside the English page: Chinese and Bangla are marked as such. */
export function contentLang(text: string): 'zh' | 'bn' | undefined {
  if (/\p{Script=Han}/u.test(text)) return 'zh';
  return /\p{Script=Bengali}/u.test(text) ? 'bn' : undefined;
}

export const kindWords: Record<WorkKind, string> = {
  draft: 'Draft request',
  request: 'Request',
  programme: 'Programme',
  service_request: 'Service request',
};

/** The source's own status in the customer words that already exist. Empty when it has none. */
export function workStatusWords(item: WorkItem): string {
  if (item.kind === 'draft') return customerStatusLabel('DRAFT', false).label;
  if (item.kind === 'request')
    return item.status ? customerStatusLabel(item.status, true).label : '';
  if (item.kind === 'service_request') return statusLabel[item.status as ServiceStatus]?.text ?? '';
  return '';
}
