import { DomainError } from './index';

/** CRUD G12: a list read returns at most this many rows; "Show More" asks for the next page. */
export const PAGE_SIZE = 50;

export type PageCursor = { k: string; id: string };

const KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID = ID;

/** Callers outside tests never pass a limit; a smaller one only lets tests cross a page boundary cheaply. */
export function pageLimit(limit?: number | null) {
  if (limit == null) return PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE)
    throw new DomainError('Page size is invalid.', 400);
  return limit;
}

export function optionalUuid(value: string | null | undefined, name: string) {
  if (value == null || value === '') return null;
  if (!UUID.test(value)) throw new DomainError(`${name} is invalid.`, 400);
  return value;
}

/** The sort key is a UTC timestamp with microseconds, written by the database, so no precision is lost. */
export function encodeCursor(cursor: PageCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string | null | undefined): PageCursor | null {
  if (raw == null || raw === '') return null;
  if (raw.length > 200) throw new DomainError('Page cursor is invalid.', 400);
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).sort().join() === 'id,k' &&
      typeof (value as PageCursor).k === 'string' &&
      typeof (value as PageCursor).id === 'string' &&
      KEY.test((value as PageCursor).k) &&
      ID.test((value as PageCursor).id)
    )
      return { k: (value as PageCursor).k, id: (value as PageCursor).id };
  } catch {
    // Falls through to the same refusal for any unreadable value.
  }
  throw new DomainError('Page cursor is invalid.', 400);
}

/** Reads limit + 1 rows: the extra row only says there is a next page and is never returned. */
export function splitPage<T extends { page_key: string; id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    page,
    next: more && last ? encodeCursor({ k: last.page_key, id: last.id }) : null,
  };
}

/** SQL text for a stored timestamp as the cursor key. */
export const keyOf = (expression: string) =>
  `to_char((${expression}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Drops the helper columns the page query adds (cursor key, total and any extra names). */
export function withoutPageFields<T extends object>(row: T, extra: string[] = []) {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of ['page_key', 'total', ...extra]) delete copy[key];
  return copy as T;
}

type Queryable = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

// Database rows keep their column types as the driver returns them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PageRow = any;

/**
 * One keyset page of a list: at most `limit` rows after the cursor in a stable order (sort time, then id)
 * and the cursor of the next page. `select` must give the rows an `id` column and may not use the names
 * `sort_at`, `page_key` or `total`. The caller's `where` and `values` are applied before paging, so a
 * filter never shrinks a page after it was read.
 *
 * Cost (CRUD G12 follow-up): a row policy on the listed table runs once for every row the scan reads, and
 * the database checks a condition before that policy only when the condition is leakproof. So:
 * - The cursor condition sits in the same scan as the caller's filter. `sortExpression` must be leakproof
 *   for that: a plain column, or `CASE WHEN a IS NULL THEN b ELSE a END` in place of `coalesce(a,b)`, which
 *   the planner treats as leaky and would check after the policy on every row before the cursor.
 * - The exact total is counted only when asked (`count`, on by default for the first page, where it is a
 *   window over the same scan, so the policy does not run twice). A continuation returns `total: null`
 *   and the client keeps the total of the first page; `count: true` on a continuation recounts.
 */
export async function keysetPage(
  db: Queryable,
  q: {
    select: string;
    from: string;
    where: string;
    values: unknown[];
    sortExpression: string;
    direction: 'asc' | 'desc';
    cursor: PageCursor | null;
    limit: number;
    count?: boolean;
  },
) {
  if (/\bcoalesce\s*\(/i.test(q.sortExpression))
    throw new Error('A page sort expression must be leakproof: write coalesce(a,b) as a CASE.');
  const n = q.values.length,
    compare = q.direction === 'asc' ? '>' : '<',
    order = q.direction.toUpperCase(),
    count = q.count ?? q.cursor === null,
    // Without a cursor the window counts every filtered row; with one it would count only the rest.
    window = count && !q.cursor;
  const rows = (
    await db.query(
      `SELECT base.*,${keyOf('sort_at')} AS page_key${window ? ',count(*) OVER () AS total' : ''}
       FROM (SELECT ${q.select},${q.sortExpression} AS sort_at FROM ${q.from} WHERE ${q.where}) base
       ${q.cursor ? `WHERE (sort_at,id)${compare}($${n + 1}::timestamptz,$${n + 2}::uuid)` : ''}
       ORDER BY sort_at ${order},id ${order} LIMIT $${n + (q.cursor ? 3 : 1)}`,
      q.cursor ? [...q.values, q.cursor.k, q.cursor.id, q.limit + 1] : [...q.values, q.limit + 1],
    )
  ).rows as { page_key: string; id: string; total?: number }[];
  const { page, next } = splitPage(rows, q.limit);
  let total: number | null = null;
  if (window) total = rows.length ? Number(rows[0]!.total) : 0;
  else if (count)
    total = Number(
      (await db.query(`SELECT count(*)::int AS n FROM ${q.from} WHERE ${q.where}`, q.values))
        .rows[0]!.n,
    );
  return {
    rows: page.map((r) => withoutPageFields(r, ['sort_at'])) as PageRow[],
    total,
    next,
  };
}
