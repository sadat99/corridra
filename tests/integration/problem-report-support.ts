import type { DatabasePool } from '../../packages/db/src/index';

// A pool that writes down the text of every query the service asks that matches `match` (by default the catalogue probe),
// and can make the next such query fail. Everything else passes through unchanged.
export function watching(
  pool: DatabasePool,
  seen: string[],
  failing: { next: boolean } = { next: false },
  match: RegExp = /pg_catalog\.pg_proc/,
): DatabasePool {
  return {
    query: pool.query.bind(pool),
    end: pool.end.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return new Proxy(client, {
        get(target, key, receiver) {
          if (key !== 'query') return Reflect.get(target, key, receiver);
          return (text: unknown, ...rest: unknown[]) => {
            if (typeof text === 'string' && match.test(text)) {
              seen.push(text);
              if (failing.next) {
                failing.next = false;
                return Promise.reject(new Error('the catalogue could not be read'));
              }
            }
            return Reflect.apply(target.query, target, [text, ...rest]);
          };
        },
      });
    },
  };
}
