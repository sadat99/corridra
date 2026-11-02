# Current-plan audit baseline: 1 November 2026

Document status: CURRENT, DATED.

This immutable evidence bundle preserves the audit of revision `1e9104a4ac43fa0e66c1ce0ec4929f0f4537bfa2`, authority `auth-280eb7e75bae`. It was imported on 2 November, without re-auditing or closing findings. The audit cutoff is 1 November 14:27 UTC; the original manifest verification was recorded at 14:51 UTC, with the later remote recheck preserved separately.

- [Portable report](REPORT.md): the complete 60-row audit, scope, refutations and verification limits, with fixed GAP identifiers and local evidence links.
- [Original report](originals/REPORT.md.txt): byte-exact original, including its original row numbers and links.
- [Baseline findings](findings.json): immutable mapping from GAP-001 through GAP-060 to original audit rows and categories.
- [Bundle manifest](manifest.json): SHA-256, byte counts and original-to-tracked path mapping. The original nine-artifact manifest is retained as `originals/manifest.json.txt`; its hashes were checked before copying.
- [Current register](../../findings.json), [review index](../../README.md) and [maintenance procedure](../../UPDATE.md).

The `.txt` suffix marks raw source evidence, including the prior probe and configuration. It preserves original bytes while preventing the probe from becoming a maintained executable test or formatter target. No executable audit tool was added. Original relative links inside raw files intentionally retain their historical spelling; resolve them through `originalMappings` in the bundle manifest, never by expecting an ignored `work/` directory in another checkout.

The bundle contains all nine original artifacts, the original manifest and all three receipt/log pairs. Each receipt's original `log` path maps to a tracked raw log. The copied observational probe and its configuration remain historical evidence; their old working paths are not a rerun recipe. A later rerun needs a separately reviewed, current command and its own receipt.

Do not change this baseline or its hashes to record progress. Append current evidence and history to the current register. Preserve original revisions, classifications, refutations and limits; a correction is a new dated history event, not a rewritten baseline. The shared ledger alone records current deployment, settings and next action. The A–G remainder remains the execution queue; owner-dependent and deferred entries are not approved tasks.
