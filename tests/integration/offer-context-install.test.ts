import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';

// Real-use 0019 on a database that has only real-use 0017: it is repeatable, changes two functions by their anchors only, keeps
// their grants, and stops when the installed definition is not the one it was reviewed against.
const sql = (name: string) =>
  readFile(
    new URL(`../../packages/db/customer-real-use-migrations/${name}`, import.meta.url),
    'utf8',
  );
let f: Awaited<ReturnType<typeof commercialFixture>>;
beforeAll(async () => {
  f = await commercialFixture();
  await f.owner.query(await sql('0017_experience_outreach_counts.sql'));
});
afterAll(async () => {
  await f?.close();
});
const read = async () =>
  (
    await f.owner.query(
      `SELECT pg_get_functiondef('app.delivery_report(text,text)'::regprocedure) d,
 pg_get_functiondef('app.experience_agenda_dto(app.delivery_agenda)'::regprocedure) a,
 pg_get_functiondef('app.delivery_report_v1(text,text)'::regprocedure) v,
 (SELECT proacl::text FROM pg_proc WHERE oid='app.delivery_report(text,text)'::regprocedure) rep_acl,
 (SELECT proacl::text FROM pg_proc WHERE oid='app.experience_agenda_dto(app.delivery_agenda)'::regprocedure) dto_acl`,
    )
  ).rows[0];

test('0019 changes two functions by their anchors only, is repeatable and then refuses a changed definition', async () => {
  const before = await read();
  expect(before.d).not.toContain('assignmentType');
  expect(before.a).not.toContain('activityKind');
  const file = await sql('0019_offer_context.sql');
  await f.owner.query(file);
  await f.owner.query(file);
  const after = await read();
  expect(after.v).toBe(before.v);
  expect(after.rep_acl).toBe(before.rep_acl);
  expect(after.dto_acl).toBe(before.dto_acl);
  expect(after.d).toContain('e.outreach');
  const strip = (s: string) =>
    s
      .replace(/'assignmentType',\(SELECT t\.key FROM .*? LIMIT 1\),/, '')
      .replace("'sourceId',q.source_id,'observedAt',q.observed_at,", '')
      .replace("'activityKind',m.activity_kind,", '');
  expect(after.d).not.toBe(before.d);
  expect(after.a).not.toBe(before.a);
  expect(strip(after.d)).toBe(before.d);
  expect(strip(after.a)).toBe(before.a);
  // Put the earlier definition back with one comment added: the guard must now stop the file.
  await f.owner.query(
    before.a.replace('SELECT jsonb_build_object(', 'SELECT jsonb_build_object(/*x*/'),
  );
  await expect(f.owner.query(file)).rejects.toThrow(/prerequisite function differs/);
});
