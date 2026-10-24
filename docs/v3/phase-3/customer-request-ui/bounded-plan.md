# Private saved request discovery and progress

**Document status: DONE.** Planned and built as source. The capability stays PARTIAL for the whole product, so use this as the design record and the requirement register for status. It is not a to-do list. See the [plan status register](../../../PLAN_STATUS.md).

Status: implemented; focused local verification passed; separate exact-head CI/release pending. V3-06-004 remains PARTIAL.

Bounded packet after backend PR68: expose creator-owned request discovery/progress in /account using unchanged gated GET /api/customer-requests. Add a scoped customer-requests.tsx component and separate server flag wiring/navigation in account/page.tsx; preserve customer-workspaces, customer-missions, public/receipt routes and all original assertions. Update precise founder/ledger truth only. No schema,permissions,money,events or activation changes. API is the already verified backend, not a fixture in product code. Protocol tests use actual compiled React component and invented API responses, separately labelled from real database/provider acceptance.

Show current canonical status, original-script replies, explicit expired-source state, bounded pagination, empty/loading/error/retry/unavailable/denied, and private creator-only copy. No receipt secret or private content in URL/storage, abort on identity change/unmount and clear denied/stale data. Requests stay visible after workspace departure when backend grant remains valid. Server/keyed component scopes issuer+subject, expected headers are rejection context only. Four account sections at most; no advanced legacy action hidden.

This first UI packet is discovery/progress, not a new submission form or full mission workspace. No fake creation button. Private submission UI should reuse the existing contextual Intake after a separately bounded scoped draft/exact-command retry design; anonymous current intake must retain all machinery/structured requirements, original receipt behavior and tests. Full V3 remains PARTIAL; gated actual private-provider walkthrough remains unverified.

Before/after screenshots at1440/768/390,keyboard,axe,overflow; actual component tests for available/expired/original-language replies,pagination,empty/error/retry,denial/malformed response,identity change/in-flight abort,no-storage/no-secret leakage. Full static/unit/integration/build/public/protected checks mandatory, then normal merge/exact-source deploy with both flags off. Branch count remains8 by reusing current name after accepted merge. Roll back flag/application only; retain additive backend/history.

Actual source also clears on page hide/visibility change and rechecks restored pages. The full request reference remains behind a native disclosure. A new restricted-PG pagination case adds coverage without changing any existing assertion.

## Next separate submission packet

Reuse `apps/web/app/plan/intake.tsx` and its existing commercial/machinery requirements rather than another form or backend. An opt-in private mode must leave all anonymous defaults,receipt access,structured fields and old assertions intact. A selected-workspace account route must require both closed server flags,fresh verified provider identity,independent request admission and active selected membership before exposing the form;POST rechecks all authority again. No staff role or email matching.

Keep private drafts/retry snapshots scoped by actual issuer,subject and workspace,versioned and time-bounded. Do not read the anonymous draft/receipt key or expose a receipt bearer. Freeze a possibly submitted normalized payload under its original command;lost-response/reload retries must reuse it exactly,including across signing-key rotation. Conflicting edits need an explicit new request after reviewing the original. Clear denied/stale state and define logout,storage-denied,interrupted navigation and workspace-departure behavior before code. No account submission control is claimed in this discovery packet.

Required new tests:actual canonical private creation/idempotency already covered by restricted SQL;new UI must prove complete existing guided requirements reach the private API,same-command failed/reload retry,scope separation from anonymous/other accounts/workspaces,permission change/no fake acknowledgement,original-language/original money context,keyboard/three-width/axe and all unchanged public/operator regressions. Private provider acceptance and commercial activation stay independently unverified/gated.
