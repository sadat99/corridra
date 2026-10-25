/**
 * Follows a list's continuation cursor so Your Move never says "nothing is waiting" from the first page
 * alone. Lists are ordered by id, not by date, so what needs the person can be on any page. The bound
 * keeps one slow list from holding the page; a list that is not read to its end is reported, never
 * presented as complete.
 */
export type PageResult<T> = { items: T[]; nextAfter?: string | null };

export async function followPages<T>(
  read: (after?: string) => Promise<PageResult<T>>,
  maxPages: number,
): Promise<{ items: T[]; complete: boolean; failed: boolean }> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    let result: PageResult<T>;
    try {
      result = await read(after);
    } catch {
      // A first page that fails leaves the source out. A later page that fails leaves it partial.
      return { items, complete: false, failed: page === 0 };
    }
    items.push(...result.items);
    if (!result.nextAfter) return { items, complete: true, failed: false };
    after = result.nextAfter;
  }
  return { items, complete: false, failed: false };
}
