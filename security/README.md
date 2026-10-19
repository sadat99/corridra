# Local security analysis

Semgrep Community 1.180.0 runs these reviewed local AST rules with metrics and version checks disabled. No source is uploaded and no registry rules are fetched. Rules cover dynamic execution, disabled TLS validation, raw HTML, direct environment logging and direct request-URL fetches. The scanner test includes unsafe and safe examples for each rule. This deliberately bounded analysis supplements RLS, permission, injection, upload, browser and dependency checks; it does not claim CodeQL parity or comprehensive interprocedural analysis.

Gitleaks 8.30.1 uses the checksum-verified official Linux archive and built-in rules to scan Git history with 100% redaction. Its report stays in ignored local artifacts. A passed local/CI scan does not establish GitHub server-side push protection or prove the absence of every possible secret. D03 and the original D04 entitlement items retain their separately recorded external prerequisites.

See the [current control boundaries](../docs/implementation/deferred-controls.md), [dated V2 control investigation](../docs/implementation/v2-part-05-controls.md) and [developer handoff](../docs/START_HERE.md). Dated entitlement/403 observations require fresh verification; a skipped CodeQL job is not a passed scan. Standing release authority never permits bypassing these checks or silently closing real-launch controls.

## CodeQL setup and evidence

CodeQL is a separate analysis/upload control. The local scanners above are not substitutes. For a private repository, confirm GitHub Code Security entitlement and activation before setting `CODEQL_ENABLED=true`; do not activate a paid plan without the owner's decision.

1. An account administrator opens <https://github.com/sadat99/corridra/settings/security_analysis> and verifies Code Security/code scanning is available and enabled.
2. Open <https://github.com/sadat99/corridra/settings/variables/actions> and create/update the repository variable `CODEQL_ENABLED` to `true`. It is a non-secret activation flag, not a credential. No tokens belong in source, chat or evidence.
3. Run <https://github.com/sadat99/corridra/actions/workflows/security.yml> against the intended source after the workflow's manual trigger reaches main. PRs, main pushes and the existing weekly schedule also trigger it.
4. Inspect the actual `analyze` job, analysis upload and <https://github.com/sadat99/corridra/security/code-scanning>. Record exact source/run, both JavaScript/TypeScript and Python results, and reviewed findings. A configuration summary, skipped job, queued run or successful checkout is not a successful scan. D04 stays open until this evidence exists.

The analysis job needs explicit `contents: read`: its job-level permission map replaces the workflow-level map. Retain `security-events: write` for analysis uploads. The workflow now reports blocked configuration explicitly and supports a manual run; it does not infer entitlement from the flag.

On 19 October 2026 the connected integration returned HTTP403 for Actions variables and code-scanning analyses; the latter said "Code scanning is not enabled for this repository." Repository metadata reported private visibility and omitted security settings. These observations prove an access/setup blocker, not whether the owner has a paid entitlement. Owner-side settings and a successful real analysis are still required.
