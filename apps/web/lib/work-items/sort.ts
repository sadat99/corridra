import type { WorkItem } from './types';

const time = (iso: string) => {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
};

/** Newest first, then by key, so equal times keep one stable order. */
export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort(
    (a, b) => time(b.updatedAt) - time(a.updatedAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}
