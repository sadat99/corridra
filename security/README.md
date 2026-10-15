# Local security analysis

Semgrep Community 1.180.0 runs these reviewed local AST rules with metrics and version checks disabled. No source is uploaded and no registry rules are fetched. Rules cover dynamic execution, disabled TLS validation, raw HTML, direct environment logging and direct request-URL fetches. The scanner test includes unsafe and safe examples for each rule. This deliberately bounded analysis supplements RLS, permission, injection, upload, browser and dependency checks; it does not claim CodeQL parity or comprehensive interprocedural analysis.

Gitleaks 8.30.1 uses the checksum-verified official Linux archive and built-in rules to scan Git history with 100% redaction. Its report stays in ignored local artifacts. A passed local/CI scan does not establish GitHub server-side push protection or prove the absence of every possible secret. D03 and the original D04 entitlement items retain their separately recorded external prerequisites.

See the [current control boundaries](../docs/implementation/deferred-controls.md), [dated V2 control investigation](../docs/implementation/v2-part-05-controls.md) and [developer handoff](../docs/START_HERE.md). Dated entitlement/403 observations require fresh verification; a skipped CodeQL job is not a passed scan. Standing release authority never permits bypassing these checks or silently closing real-launch controls.
