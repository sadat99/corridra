import { beforeAll, afterAll, test, expect } from 'vitest';
import { fixture } from './support';
import {
  EvidenceService,
  type ObjectStorage,
  type MalwareScanner,
} from '../../packages/evidence/src/index';

// CRUD G12: the evidence workspace pages sources, claims and evidence objects on their own cursors.
let f: Awaited<ReturnType<typeof fixture>>, evidence: EvidenceService;
const objects = new Map<string, Uint8Array>();
const storage: ObjectStorage = {
  async put(k, b) {
    objects.set(k, b.slice());
  },
  async get(k) {
    const b = objects.get(k);
    if (!b) throw new Error('Missing object');
    return b;
  },
};
const scanner: MalwareScanner = {
  async scan() {
    return { verdict: 'CLEAN', engine: 'test-adapter' };
  },
};
const source = () => ({
  kind: 'observation',
  locator: 'Synthetic inspection record',
  observedAt: new Date().toISOString(),
  classification: 'INTERNAL',
  purpose: 'synthetic_validation',
  retentionUntil: new Date(Date.now() + 86400000).toISOString(),
  aiPolicy: 'DENY',
});
beforeAll(async () => {
  f = await fixture();
  evidence = new EvidenceService(f.runtime, storage, scanner);
  for (let i = 0; i < 9; i++) {
    const s = await evidence.createSource(f.users.operator.ctx, source());
    const c = await evidence.createClaim(f.users.operator.ctx, {
      sourceId: s.id,
      statement: `Synthetic capacity claim ${i}`,
    });
    await evidence.upload(
      f.users.operator.ctx,
      c.id,
      Buffer.from(`%PDF-1.7\nSynthetic test document ${i}`),
      'application/pdf',
    );
  }
});
afterAll(async () => {
  await f?.close();
});

type Page = Record<string, unknown> & { total?: number | null };
const lists = [
  {
    name: 'sources',
    cursor: 'sourcesAfter',
    total: 'sourcesTotal',
    next: 'sourcesNext',
    table: 'source_record',
  },
  {
    name: 'claims',
    cursor: 'claimsAfter',
    total: 'claimsTotal',
    next: 'claimsNext',
    table: 'claim',
  },
  {
    name: 'evidence',
    cursor: 'evidenceAfter',
    total: 'evidenceTotal',
    next: 'evidenceNext',
    table: 'evidence_object',
  },
] as const;

for (const list of lists)
  test(`${list.name} come in pages with an exact total, newest first, with no loss or duplicate`, async () => {
    const ids: string[] = [];
    let after: string | null = null;
    let total = -1;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const page = (await evidence.workspace(f.users.operator.ctx, {
        [list.cursor]: after,
        limit: 4,
      })) as unknown as Page;
      const rows = page[list.name] as { id: string }[];
      sizes.push(rows.length);
      ids.push(...rows.map((r) => r.id));
      // A continuation carries no total; the first page's stands (G12 follow-up).
      if (guard === 0) total = page[list.total] as number;
      else expect(page[list.total]).toBeNull();
      after = page[list.next] as string | null;
      if (!after) break;
    }
    expect(sizes).toEqual([4, 4, 1]);
    expect(total).toBe(9);
    expect(new Set(ids).size).toBe(9);
    const stored = (
      await f.owner.query(
        `SELECT id FROM app.${list.table} WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC`,
        [f.tenantA],
      )
    ).rows.map((r) => r.id);
    expect(ids).toEqual(stored);
  });

test('a continuation returns only the list it continues', async () => {
  const first = (await evidence.workspace(f.users.operator.ctx, { limit: 4 })) as unknown as Page;
  const next = (await evidence.workspace(f.users.operator.ctx, {
    claimsAfter: first.claimsNext as string,
    limit: 4,
  })) as unknown as Page;
  expect((next.claims as unknown[]).length).toBe(4);
  expect(next.sources).toEqual([]);
  expect(next.evidence).toEqual([]);
  expect(next.sourcesTotal).toBeNull();
});

test('a source added between pages neither repeats nor drops a listed source', async () => {
  const first = (await evidence.workspace(f.users.operator.ctx, { limit: 4 })) as unknown as Page;
  const seen = new Set((first.sources as { id: string }[]).map((r) => r.id));
  const fresh = await evidence.createSource(f.users.operator.ctx, source());
  let after = first.sourcesNext as string | null;
  while (after) {
    const page = (await evidence.workspace(f.users.operator.ctx, {
      sourcesAfter: after,
      limit: 4,
    })) as unknown as Page;
    for (const r of page.sources as { id: string }[]) {
      expect(seen.has(r.id)).toBe(false);
      seen.add(r.id);
    }
    after = page.sourcesNext as string | null;
  }
  // The new source is newest, so it sits before the cursor: the walk does not show it, a fresh read does.
  expect(seen.size).toBe(9);
  expect(seen.has(fresh.id)).toBe(false);
  const again = (await evidence.workspace(f.users.operator.ctx, { limit: 4 })) as unknown as Page;
  expect((again.sources as { id: string }[])[0]!.id).toBe(fresh.id);
  expect(again.sourcesTotal).toBe(10);
});

test('malformed cursors and two cursors at once are refused with 400', async () => {
  for (const bad of ['not-a-cursor', 'x'.repeat(400)])
    await expect(
      evidence.workspace(f.users.operator.ctx, { claimsAfter: bad }),
    ).rejects.toMatchObject({ status: 400 });
  const first = (await evidence.workspace(f.users.operator.ctx, { limit: 4 })) as unknown as Page;
  await expect(
    evidence.workspace(f.users.operator.ctx, {
      sourcesAfter: first.sourcesNext as string,
      claimsAfter: first.claimsNext as string,
    }),
  ).rejects.toMatchObject({ status: 400 });
});

test('the default page holds 50 sources', { timeout: 240000 }, async () => {
  for (let i = 0; i < 41; i++) await evidence.createSource(f.users.operator.ctx, source());
  const page = (await evidence.workspace(f.users.operator.ctx)) as unknown as Page;
  expect((page.sources as unknown[]).length).toBe(50);
  expect(page.sourcesNext).toEqual(expect.any(String));
  expect(page.sourcesTotal).toBe(51);
  expect((page.claims as unknown[]).length).toBe(9);
  expect(page.claimsNext).toBeNull();
});
