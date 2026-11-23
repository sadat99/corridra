#!/usr/bin/env node
// UI/UX.v4.1 conformance ledger. Spec: docs/revamp/specs/ui-ux-v4-1.md (decisions L1 to L10).
// Ledger: docs/revamp/v4-1-conformance.json (one row per Next.js page route, one status per decision).
//   node scripts/v4-1-conformance.mjs generate   add rows for new routes, drop rows for deleted ones, keep every status
//   node scripts/v4-1-conformance.mjs check      fail when the ledger and the filesystem disagree (also run by tests/v4-1-guard.test.mjs)
//   node scripts/v4-1-conformance.mjs summary    counts by wave and status
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const ledgerPath = join(root, 'docs/revamp/v4-1-conformance.json');
const appDir = join(root, 'apps/web/app');

export const STATUSES = ['n/a', 'not_assessed', 'not_started', 'built', 'verified'];
export const DECISIONS = {
  L1: 'Instant meaning: a flag or compass mark before every place name, never alone',
  L2: 'One owned CorridraIcon per choice, beside its written label',
  L3: 'Chosen state: 2 px cobalt border, selected fill, filled radio; one primary per decision region',
  L4: 'Home: left aligned navy hero, no decorative arc, choices below with flags and icons',
  L5: 'Routes: numbered list in locked order, 40 px mark, Open, one quiet link per row',
  L6: 'Plan: icon goal rows, chosen state, flat navy Your request panel',
  L7: 'Start here: Plan a Mission is the only primary, door cards with icons',
  L8: 'Private link unavailable: warning edge, lock icon, generic copy, retry and help',
  L9: 'Contributor: one next-step card with one primary action',
  L10: 'Source stamp: 12 px mono line with a dot where a fact is shown',
};
// Decisions that belong to one named route. Everywhere else they are n/a.
export const SCOPED = {
  L4: ['/'],
  L5: ['/corridors'],
  L6: ['/plan'],
  L7: ['/workspace'],
  L8: ['/buyer'],
  L9: ['/contributor'],
};
export const WAVES = {
  A: 'Public pages',
  B: 'Customer account pages',
  C: 'Recipient links and contributor',
  D: 'Operator and owner',
};

export function waveOf(route) {
  if (route.startsWith('/account')) return 'B';
  if (route.startsWith('/operator')) return 'D';
  if (route.startsWith('/contributor')) return 'C';
  if (
    [
      '/buyer',
      '/client',
      '/decision-card',
      '/programme',
      '/mute/[requestId]',
      '/pulse/mute/[requestId]',
    ].includes(route)
  )
    return 'C';
  return 'A';
}

export function listRoutes() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'page.tsx') {
        const r = '/' + relative(appDir, dir).split('\\').join('/');
        out.push({
          route: r === '/.' || r === '/' ? '/' : r,
          file: relative(root, p).split('\\').join('/'),
        });
      }
    }
  };
  walk(appDir);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

function freshRow({ route, file }) {
  const decisions = {};
  for (const id of Object.keys(DECISIONS)) {
    if (SCOPED[id]) decisions[id] = SCOPED[id].includes(route) ? 'not_started' : 'n/a';
    else decisions[id] = 'not_assessed';
  }
  return { route, file, wave: waveOf(route), decisions, evidence: [], notes: '' };
}

export function readLedger() {
  return JSON.parse(readFileSync(ledgerPath, 'utf8'));
}

export function generate() {
  const existing = existsSync(ledgerPath) ? readLedger() : { routes: [] };
  const byRoute = new Map(existing.routes.map((r) => [r.route, r]));
  const routes = listRoutes().map((r) => ({
    ...(byRoute.get(r.route) ?? freshRow(r)),
    file: r.file,
    wave: waveOf(r.route),
  }));
  const ledger = {
    version: 'UI/UX.v4.1',
    spec: 'docs/revamp/specs/ui-ux-v4-1.md',
    rollout: 'docs/revamp/specs/ui-ux-v4-1-rollout.md',
    statuses: STATUSES,
    waves: WAVES,
    decisions: DECISIONS,
    routes,
  };
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  return ledger;
}

export function problems() {
  const out = [];
  if (!existsSync(ledgerPath)) return ['ledger file is missing: run generate'];
  const ledger = readLedger();
  const fs = new Map(listRoutes().map((r) => [r.route, r]));
  const rows = new Map(ledger.routes.map((r) => [r.route, r]));
  for (const route of fs.keys())
    if (!rows.has(route))
      out.push(`route ${route} has a page but no ledger row (run generate, then assess it)`);
  for (const route of rows.keys())
    if (!fs.has(route)) out.push(`ledger row ${route} has no page (run generate)`);
  for (const row of ledger.routes) {
    if (fs.has(row.route) && row.file !== fs.get(row.route).file)
      out.push(`${row.route}: file path is stale (run generate)`);
    for (const id of Object.keys(DECISIONS)) {
      const s = row.decisions?.[id];
      if (!STATUSES.includes(s))
        out.push(`${row.route} ${id}: status "${s}" is not one of ${STATUSES.join(', ')}`);
      if (SCOPED[id] && !SCOPED[id].includes(row.route) && s !== 'n/a')
        out.push(
          `${row.route} ${id}: only ${SCOPED[id].join(', ')} may carry this decision, so it must be n/a`,
        );
      if ((s === 'built' || s === 'verified') && !(row.evidence?.length > 0))
        out.push(`${row.route} ${id}: ${s} needs at least one evidence path in the row`);
    }
    if (Object.values(row.decisions ?? {}).includes('verified'))
      for (const e of row.evidence ?? [])
        if (!existsSync(join(root, e))) out.push(`${row.route}: evidence file ${e} does not exist`);
  }
  return out;
}

export function summary() {
  const ledger = readLedger();
  const table = {};
  for (const row of ledger.routes)
    for (const s of Object.values(row.decisions)) {
      table[row.wave] ??= {};
      table[row.wave][s] = (table[row.wave][s] ?? 0) + 1;
    }
  return { routes: ledger.routes.length, byWave: table };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? 'check';
  if (cmd === 'generate') {
    const l = generate();
    console.log(`ledger written: ${l.routes.length} routes`);
  } else if (cmd === 'summary') console.log(JSON.stringify(summary(), null, 2));
  else if (cmd === 'check') {
    const p = problems();
    if (p.length) {
      console.error(p.join('\n'));
      process.exit(1);
    }
    console.log(`v4.1 conformance ledger OK: ${readLedger().routes.length} routes`);
  } else {
    console.error('usage: v4-1-conformance.mjs generate|check|summary');
    process.exit(2);
  }
}
