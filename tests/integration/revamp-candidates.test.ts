import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Wave 7 K-01: the candidate report is a report only. This keeps its shape honest for the Guardian review (K-02).
const file = 'docs/revamp/wave-7/candidates.json';
const never = [
  /^docs\/source\//,
  /^docs\/v3\/history\//,
  /^docs\/adr\//,
  /^docs\/qa\//,
  /^docs\/design-system\/evidence\//,
  /^docs\/revamp\/CONTRACT\.md$/,
  /^packages\/db\/.*migrations/,
  /\.sql$/,
];
type Entry = {
  path: string;
  kind: string;
  classification: string;
  reason: string;
  incomingReferences: {
    importers: number;
    code: string[];
    tests: string[];
    documentation: string[];
  };
  replacement: string | null;
  recovery: string;
  proof: { sha256: string; bytes: number; lastCommit: string; method: string };
  approval: null;
  selectors?: { unreferenced: string[]; testOnly: string[] };
};

test('the candidate report exists, deletes nothing and carries the proof each entry needs', () => {
  expect(existsSync(file)).toBe(true);
  const report = JSON.parse(readFileSync(file, 'utf8')) as {
    baseline: string;
    totals: { KEEP: number; REVIEW: number };
    entries: Entry[];
  };
  expect(report.baseline).toMatch(/^[0-9a-f]{40}$/);
  expect(report.entries.length).toBeGreaterThan(0);
  const tracked = new Set(
    execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n'),
  );
  const seen = new Set<string>();
  for (const e of report.entries) {
    // One entry per candidate, never a protected path, never approved by this report.
    expect(seen.has(e.path + '|' + e.kind)).toBe(false);
    seen.add(e.path + '|' + e.kind);
    expect(never.some((r) => r.test(e.path))).toBe(false);
    expect(e.approval).toBeNull();
    expect(['KEEP', 'REVIEW']).toContain(e.classification);
    expect(e.reason.length).toBeGreaterThan(10);
    expect(e.recovery).toMatch(/^git checkout [0-9a-f]{12} -- \S+$/);
    expect(e.proof.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.proof.lastCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(e.proof.method.length).toBeGreaterThan(10);
    expect(e.incomingReferences.importers).toBeGreaterThanOrEqual(0);
    // A file candidate is a real tracked file; a package script or selector set points at one that exists.
    const real = e.path.split('#')[0]!;
    expect(tracked.has(real)).toBe(true);
    // A REVIEW file candidate has no reference in code or tests. A selector entry is the one exception: its file is
    // imported, and it is the selectors that are unreferenced.
    if (
      e.classification === 'REVIEW' &&
      e.kind !== 'css-selectors' &&
      e.kind !== 'package-script'
    ) {
      expect(e.incomingReferences.code).toEqual([]);
      expect(e.incomingReferences.tests).toEqual([]);
    }
    if (e.kind === 'css-selectors')
      expect(e.selectors!.unreferenced.length + e.selectors!.testOnly.length).toBeGreaterThan(0);
  }
  expect(report.totals.KEEP + report.totals.REVIEW).toBe(report.entries.length);
});
