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
 * One keyset page of a list: at most `limit` rows after the cursor in a stable order (sort time, then id),
 * the exact total, and the cursor of the next page. `select` must give the rows an `id` column and may
 * not use the names `sort_at`, `page_key` or `total`. The caller's `where` and `values` are applied before
 * paging, so a filter never shrinks a page after it was read. The base set is read once for both the page
 * and the total.
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
  },
) {
  const n = q.values.length,
    compare = q.direction === 'asc' ? '>' : '<',
    order = q.direction.toUpperCase();
  const rows = (
    await db.query(
      `WITH base AS MATERIALIZED (SELECT ${q.select},${q.sortExpression} AS sort_at FROM ${q.from} WHERE ${q.where})
       SELECT base.*,${keyOf('sort_at')} AS page_key,(SELECT count(*)::int FROM base) AS total FROM base
       WHERE $${n + 1}::timestamptz IS NULL OR (sort_at,id)${compare}($${n + 1}::timestamptz,$${n + 2}::uuid)
       ORDER BY sort_at ${order},id ${order} LIMIT $${n + 3}`,
      [...q.values, q.cursor?.k ?? null, q.cursor?.id ?? null, q.limit + 1],
    )
  ).rows as { page_key: string; id: string; total: number }[];
  const { page, next } = splitPage(rows, q.limit);
  // A cursor past the last row gives an empty page; the total is still exact.
  const total = rows.length
    ? Number(rows[0]!.total)
    : q.cursor
      ? Number(
          (await db.query(`SELECT count(*)::int AS n FROM ${q.from} WHERE ${q.where}`, q.values))
            .rows[0]!.n,
        )
      : 0;
  return {
    rows: page.map((r) => withoutPageFields(r, ['sort_at'])) as PageRow[],
    total,
    next,
  };
}
