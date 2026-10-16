import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Initialize once. Later chunks edit the ledger; never regenerate over execution memory.
if (existsSync('docs/V3_LEDGER.md')) throw new Error('Ledger already exists; update it forward.');
const spec = readFileSync('docs/V3_CONTRACT.md', 'utf8').split('\n');
const inventoryPath = 'docs/v3/phase-0/inventory.json';
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
let section = '00',
  heading = 'Preamble';
const counts = {},
  requirements = [];
const add = (text, line) => {
  counts[section] = (counts[section] ?? 0) + 1;
  requirements.push({
    id: `V3-${section}-${String(counts[section]).padStart(3, '0')}`,
    section,
    heading,
    line,
    requirement: text,
    status: 'NOT VERIFIED',
    evidence: [inventoryPath],
    nextAction:
      'Link applicable implementation and positive/denial role-state runtime evidence; retain original actions.',
  });
};
let paragraph = [];
const flush = () => {
  if (paragraph.length) {
    add(paragraph.map((p) => p.text).join(' '), paragraph[0].line);
    paragraph = [];
  }
};
for (const [index, text] of spec.entries()) {
  if (text.startsWith('#')) {
    flush();
    heading = text.replace(/^#+\s*/, '');
    const match = text.match(/^## (\d+)\./);
    if (match) section = match[1].padStart(2, '0');
  } else if (!text.trim() || text === '---') flush();
  else if (/^(?:- |\d+\. |\|)/.test(text)) {
    flush();
    if (
      text.startsWith('|') &&
      (/^\|[ :|\-]+\|$/.test(text) ||
        /^\| (Product|Sourcing context|Audience|Existing V2 capability|New requirement) \|/.test(
          text,
        ))
    )
      continue;
    add(text, index + 1);
  } else paragraph.push({ text, line: index + 1 });
}
flush();
const families = requirements.filter((r) => r.section === '05' && r.requirement.startsWith('|'));
const matrix = JSON.parse(readFileSync('docs/implementation/implementation-matrix.json', 'utf8'));
// Evidence stays conservative: family candidates from existing handoff, plus exact current
// action/API/state locations. These paths do not imply tested functional equivalence.
for (const r of families) {
  r.status = 'PARTIAL';
  r.evidence = ['docs/implementation/implementation-matrix.json', inventoryPath];
  r.nextAction =
    'Map every original action into this V3 home; retain original URLs until all affected authorized roles and states pass.';
}
for (const r of requirements.filter((r) => r.section === '06' && r.requirement.startsWith('|'))) {
  r.status = /Real customer admission|Authorized real communications/.test(r.requirement)
    ? 'GATED'
    : /calendar|Institutional customization/.test(r.requirement)
      ? 'DEFERRED'
      : /Founder overview|Reusable supplier/.test(r.requirement)
        ? 'PARTIAL'
        : 'MISSING';
  r.evidence = ['docs/agents/saas-readiness-audit.md', inventoryPath];
  r.nextAction =
    r.status === 'GATED'
      ? 'Keep disabled; close independent external controls with legal/provider/security evidence.'
      : r.status === 'DEFERRED'
        ? 'Demand-led P2; preserve existing export and integration behavior.'
        : 'Implement separately reviewed additive synthetic-only capability in Phase 3; staff functionality does not establish self-service.';
}
for (const r of requirements)
  if (r.section === '09' && r.heading.startsWith('Phase 5')) {
    r.status = 'GATED';
    r.evidence = ['docs/implementation/deferred-controls.md'];
    r.nextAction =
      'External evidence and independent approvals required; do not activate real operations.';
  }
writeFileSync('docs/v3/phase-0/requirements.json', JSON.stringify(requirements, null, 2) + '\n');
const clean = (s) => s.replaceAll('|', ' / ');
const overview = `# V3 execution ledger

Source of truth: docs/V3_CONTRACT.md, owner-supplied 2026-10-16, saved with Markdown formatting only. Re-read this ledger before every chunk; append exact command results at the end. The contract supplied no requirement IDs. V3-<section>-<ordinal> freezes every paragraph, list item and table row in source order; headings provide context. Exact text and source lines: docs/v3/phase-0/requirements.json. Register statuses describe discovery, never inherited acceptance.

## Current state

- Baseline/fetched main: e9ed2e53d97f543c30bace29d9ef38d568a65236. Existing work checkout; dependency PRs 10 and 32 remain open, no active implementation PR found.
- Production: dpl_Aqz6dLRGuj8ARTJe87CT8SsATeZZ READY at f5e6384da22535c66e6d1a5d943f6f7dccef1a76. V3 is not deployed.
- Phase 0: PARTIAL; static discovery done, runtime expansion/screenshots/tests in progress. No preservation contract conflict established. Exhaustive runtime preservation NOT VERIFIED.
- Phases 1–4: NOT VERIFIED, pending Phase 0 evidence and commit.
- Phase 5: GATED. D01–D06 and D08 remain closed. No real customer mission data, outreach, payment or production inference.
- Preserve prior local root AGENTS.md and work-log edits from the owner's preceding instruction.

## Bounded plan and blast radius

1. P0a: contract, ledger, immutable inventory, preservation mapping, baseline screenshots/tests, catalogue and plan. Commit before structural changes. No application behavior or authority changes.
2. P1a: three product entries and secondary other objective through existing /plan schema. Touch homepage, discovery, intake presentation and add browser tests. Risk: wrong prefill, lost supporting routes, admission notice regression. Preserve all old URLs and controls.
3. P1b: group role-aware operator navigation into at most five choices; retain all 18 expert anchors. Touch workspace-navigation and operator presentation, add navigation tests. Risk: hidden controls, invalid return URLs, role leakage. Backend permissions remain authoritative.
4. P1c: consistent overview/status/error/recovery and landing paths from existing endpoints. Do not ship nonfunctional customer ownership/Companies/Results controls.
5. P2a/b/c: buyer, sourcing/machinery and delegation journeys separately, reusing original commands. Missing self-service remains MISSING until Phase 3.
6. P3a: ADR and additive organisation/membership/customer mission authority with populated upgrade and restricted-role denial tests. State exact auth/RLS blast radius before editing. P3b: delegation/participant self-service on shared programme/mission model. P3c: organiser economics with separate financial domains. No historical migration edit. Communications/billing remain independently gated.
7. P4: founder clarity, explicitly synthetic explorer, role walkthroughs and full regression. P5: close independently approved external gates or stop at legal/provider/security prerequisites.

Before each concern: re-read ledger, list files and failure risks. After: lint, typecheck, unit and permission-denial tests, build and browser checks for UI; record exact results, then commit. Every third chunk: self-audit against Hard Release Conditions and legacy inventory. No new dependencies planned. Rollback presentation with a revert; retain additive schema and immutable history.

## Evidence and limitations

- node scripts/v3-inventory.mjs: ${inventory.routes.length} routes, ${inventory.actions.length} controls, ${inventory.endpoints.length} API dispatch entries, ${inventory.commands.length} service methods, ${inventory.dynamicCollections.length} maps (${inventory.dynamicCollections.filter((c) => c.expanded).length} literal collections expanded), ${inventory.domainStates.length} state declarations, ${inventory.tests.length} test declarations, ${inventory.migrations.length} migrations. Result includes unresolvedRuntimeCoverage: true. Source counts are not runtime action denominators.
- git fetch origin main succeeded with scoped network access; HEAD and origin/main both returned the baseline SHA above.
- Initial lint exited 0 before collector additions. Re-run pending.
- Initial integration run: Test Files 15 failed | 10 passed (25); Tests 3 failed | 80 passed (83). Root causes: missing workspace links and unavailable local ClamAV; no assertions changed. Repaired 19 workspace links from unchanged manifests; scanner startup in progress.
- Local test database only: prepare-local returned Fresh foundation migrations applied; separate restricted runtime and auth identities created. No ambient cloud database used.
- pnpm bootstrap tries unwritable default store when installed metadata differs (allowBuilds). Installed executables run; explicit CLI warn mode identifies metadata drift. No dependency version changed.
- reconciliation.json compares dated ledgers by location; no historical PASS transferred. All dynamic role/state combinations, external identity and measured performance remain NOT VERIFIED.

## Requirement register

EXISTING = inspected implementation; PARTIAL = some capability exists; MISSING = required capability absent; GATED = explicit external prerequisite; DEFERRED = contract P2/demand-led; NOT VERIFIED = insufficient evidence. Runtime acceptance requires linked command output even for EXISTING.

| ID | Requirement | Status | Evidence paths | Next action |
| --- | --- | --- | --- | --- |
`;
writeFileSync(
  'docs/V3_LEDGER.md',
  overview +
    requirements
      .map(
        (r) =>
          `| ${r.id} | ${clean(r.requirement)} | ${r.status} | ${r.evidence.join('; ')}; contract line ${r.line} | ${r.nextAction} |`,
      )
      .join('\n') +
    '\n',
);
const sections = readFileSync('apps/web/lib/workspace-navigation.ts', 'utf8').split(
  '] as const',
)[0];
const tools = [...sections.matchAll(/id: '([^']+)',\s*label: '([^']+)'/g)];
const rows = families.map((r) => {
  const cells = r.requirement.split('|').filter((s) => s.trim());
  return `| ${r.id} | ${cells[0]} | ${cells[1]} | PARTIAL; runtime evidence pending |`;
});
const md = `# V2 to V3 preservation matrix

Baseline: ${inventory.baseline}. Phase 0 removes no functions. Static discovery is not verified preservation.

## Capability families

| ID | Existing capability | Required V3 home | Status |
| --- | --- | --- | --- |
${rows.join('\n')}

Evidence per family: docs/implementation/implementation-matrix.json gives original code, test and ADR paths (${matrix.rows.length} requirement families); inventory.json gives current exact control/API/method/state locations, conditions and dependencies. Every control has its own destination and next action. Do not infer runtime coverage from a family row.

## Every operator section

Keep original /operator fragments and role declarations while regrouping context. Each label below is sourced from apps/web/lib/workspace-navigation.ts, not a replacement permission model.

| Section | Original and retained path | V3 contextual handling |
| --- | --- | --- |
${tools.map((m) => `| ${m[2]} | /operator#${m[1]} | Retain expert panel; group under Missions, Companies, Delivery, Outcomes or More according to role |`).join('\n')}

## Audiences and contextual authority

Anonymous visitor; verified/unverified customer; exporter/seller; importer/procurement; organiser; participant; buyer/supplier recipient; exact-assigned contributor; owner/admin/operator/reviewer/viewer. Commercial job labels grant no authority. Customer identity remains separate from invited staff password/MFA. Capability links retain audience, source rights, publication, expiry and revocation checks. New customer self-service authority is MISSING until separately implemented and denied correctly.

## Action/state mapping and protected operations

inventory.json retains every discovered source control (${inventory.actions.length}), API dispatch (${inventory.endpoints.length}), service method (${inventory.commands.length}), domain vocabulary (${inventory.domainStates.length}), permission call, test declaration, component path and migration/source hash. Each control records original file/line, routes, binding, visibility and intended destination. Original deep links remain until replacement passes affected roles/states. Export, cancellation, compensation, recovery, revocation, expiry, independent reviews, disputes and original evidence must remain available. Every state/role combination remains NOT VERIFIED until actual execution evidence is linked.

## Reconciliation limits and rollback

reconciliation.json compares UX10X snapshots against current source locations. Shifted lines are not proof of lost behavior; matched locations are not proof of preserved behavior. Data-driven maps, external identity and dynamically rendered controls require runtime expansion. No measured usability/performance improvement claimed. Revert UI commits for rollback, retain additive history, never disable denial checks or activation gates.
`;
writeFileSync('docs/v3/phase-0/preservation-matrix.md', md);
console.log(
  JSON.stringify({
    requirements: requirements.length,
    preservationFamilies: families.length,
    operatorSections: tools.length,
  }),
);
