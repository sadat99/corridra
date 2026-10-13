import { test, expect } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { migrate } from '../../packages/db/src/migrate';
test('populated Part 4 upgrade and replay preserve every original table column and financial/event row', async () => {
  const f = await commercialFixture(false, '0027_restricted_execution_network.sql');
  try {
    await f.invoice('EUR', '12345');
    const tables = (
      await f.owner.query(
        "SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('app','identity') ORDER BY 1,2",
      )
    ).rows;
    const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    const before = new Map<string, { columns: string[]; count: number; hash: string }>();
    async function snapshot(t: { table_schema: string; table_name: string }, columns: string[]) {
      return (
        await f.owner.query(
          `SELECT count(*)::int count,md5(coalesce(string_agg(h,'' ORDER BY h),'')) hash FROM(SELECT md5((SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(t)) WHERE key=ANY($1::text[]))::text) h FROM ${quote(t.table_schema)}.${quote(t.table_name)} t) records`,
          [columns],
        )
      ).rows[0];
    }
    for (const t of tables) {
      const columns = (
        await f.owner.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
          [t.table_schema, t.table_name],
        )
      ).rows.map((r) => r.column_name);
      before.set(t.table_schema + '.' + t.table_name, { columns, ...(await snapshot(t, columns)) });
    }
    const hashes = (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name'))
      .rows;
    await migrate(f.owner);
    await migrate(f.owner);
    for (const t of tables) {
      const old = before.get(t.table_schema + '.' + t.table_name)!;
      expect(await snapshot(t, old.columns), t.table_schema + '.' + t.table_name).toEqual({
        count: old.count,
        hash: old.hash,
      });
    }
    expect(
      (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name LIMIT 27'))
        .rows,
    ).toEqual(hashes);
    expect((await f.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n).toBe(
      28,
    );
    expect(
      (
        await f.owner.query(
          "SELECT sum(amount_minor)::text amount FROM app.commercial_record WHERE kind='INVOICE'",
        )
      ).rows[0].amount,
    ).toBe('12345');
  } finally {
    await f.close();
  }
});
