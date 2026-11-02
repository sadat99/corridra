# Maintaining and comparing the current-plan gap register

Document status: CURRENT.

The [JSON register](findings.json) is the current evidence record; the [review table](README.md) is its human projection. The [1 November baseline](baselines/2026-11-01/README.md) is immutable dated evidence. These records support comparison without replacing the shared ledger or authorising any product work.

## Review before work

1. Fetch current main, inspect open PRs and read the current ledger and authority brief. Apply the latest applicable owner decision. A document's timestamp alone cannot make an unapproved proposal authoritative.
2. Find the stable GAP identifier and read its full original boundary, current scope, prerequisites, six evidence states and history. GAP-001 always means original audit row 1; never reuse or renumber an identifier when sorting, grouping or closing work. New findings start after GAP-060 and require a new dated evidence record, without changing this baseline.
3. Confirm execution scope with `REMAINING.md`, the current plan and accepted decisions. OPEN discrepancies still need scope reconciliation; OWNER_DEPENDENT, REVIEW_REQUIRED and DEFERRED are not active instructions. Do not convert unverified runtime behavior into a missing software claim.
4. Trace current callers, services, SQL, tests, commit dates and executed logs. Check later implementations before retaining an old absence claim. Record observation time, exact tested revision, command exit, receipt/log hash and relevant limitations. Never record credentials, private reset/session tokens, real bank details or production personal information.

## Record an update in one PR

- Preserve every `baseline` object, the baseline bundle and all existing `history` events exactly. Append a uniquely numbered `GAP-NNN-H...` event with the date, evidence revision, decision source, prior/new disposition, reason and evidence references. A correction/refutation is also an appended event; it does not erase the original observation.
- Change only the affected current fields. Keep implementation, verification, deployment, activation, approval and commercialOperation independent. For example an implemented producer can remain unverified live, and a READY deployment is not proof it is enabled. Use UNKNOWN when evidence is unavailable; do not fill unrelated fields by inference.
- Each non-UNKNOWN stage needs its own dated evidence reference. Record product acceptance, positive/denial/retry proof and the owner/provider prerequisites required by `closureAcceptance`; these are criteria for evaluating the finding, not permission to bypass the current authority.
- Keep `closureEvidence` empty until the required proof exists. A resolved disposition records which closure criteria were met and any residual limits. Owner deferral or supersession is a different outcome from implemented/verified resolution and needs the actual later owner decision.
- Update the 60-row README projection from JSON fields `id`, `baseline.category`, `current.disposition` and `title` in the same PR. Keep rows ordered by identifier. Check exact identity/title/category/disposition equality, duplicates, removed baseline IDs and accidental changes to original history before publishing. No permanent generator or validator is introduced by this documentation change.
- Add durable sanitized evidence under a new dated evidence directory, with original revisions and hashes, before linking it; ignored `work/` paths are not portable. Do not edit the fixed 1 November bundle. Update the documentation catalogue/status register for new Markdown evidence. Append the shared work log and a bounded ledger pointer when findings materially change; live configuration/release evidence remains in that ledger.

## Compare evidence across revisions

Run from the repository root, using real discovered revisions in place of BEFORE and AFTER:

```sh
git log --date=iso-strict --format='%h %cI %s' -- docs/qa/current-plan-gaps/findings.json
git diff BEFORE AFTER -- docs/qa/current-plan-gaps/findings.json docs/qa/current-plan-gaps/README.md
git show BEFORE:docs/qa/current-plan-gaps/findings.json
git show AFTER:docs/qa/current-plan-gaps/findings.json
```

For a finding, compare its stable ID, baseline category, current disposition, six states, prerequisites and appended evidence history. Use `git log -S GAP-015 -- docs/qa/current-plan-gaps/findings.json` to locate its introduction; use dated history events and the full diff to identify subsequent changes, because its ID persists. Compare closure evidence and tested/deployed revisions, not just labels or aggregate counts. The dated `baselines/2026-11-01/findings.json` remains the original comparison point even when current main advances.

Before merging an update, verify each baseline manifest file's byte count and SHA-256, resolve local links and evidence mappings, confirm the current README projection matches JSON, preserve all original baseline IDs/categories and check existing history is a prefix of the updated history. Run existing document and authority checks and targeted formatting. A check failure is investigated rather than changing the baseline hashes. This is a documented Git/manual workflow, not a new executable comparison tool.

## Reproduce the archived observational probe

In an isolated local checkout with the audited application source and its installed dependencies, inspect the copied probe/configuration and verify their manifest hashes first. Restore only these two raw files to their mapped original work paths, then run the historical command from the repository root:

The baseline wrapper's warning about old working paths means archived source is not implicitly runnable from docs. This explicit restoration procedure is the reproduction recipe; it restores the mapped paths in an isolated checkout and records whichever revision is actually tested.

```sh
mkdir -p work/current-plan-audit
cp docs/qa/current-plan-gaps/baselines/2026-11-01/originals/team-resend.probe.test.ts.txt work/current-plan-audit/team-resend.probe.test.ts
cp docs/qa/current-plan-gaps/baselines/2026-11-01/originals/probe.vitest.config.mts.txt work/current-plan-audit/probe.vitest.config.mts
node scripts/gate.mjs gap-resend-observation -- node_modules/.bin/vitest run --config work/current-plan-audit/probe.vitest.config.mts
```

The preserved probe mocks service/notification boundaries and observes the handler. It is not an email-provider or production acceptance test, and its passing observation describes the old defect rather than proving a fix. Keep each new receipt with its actual tested revision. Reproducing against later application code is a new observation, not a rewrite of the baseline or its historical passing receipts. Execute from ignored work paths, never from the docs evidence bundle.

## Archiving public configuration metadata

The [2 November scanner control record](verification/2026-11-02-security-controls.json) preserves the seven tested boundaries of the narrow Gitleaks exception for two public feature identifiers. The configuration extends the pinned scanner defaults and requires both an exact extracted value and the exact archived path; it does not ignore the file or disable a rule. Same-path, same-line, other-path, changed-value and other-rule controls still detect representative findings. This record is explicitly pre-commit builder evidence. Future metadata findings need their own inspection and controls; never widen the exception or change immutable evidence to silence a scan.
