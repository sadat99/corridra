# ADR-089: Guided AI connection and model policies in real workspaces

Status: Accepted by the owner, 20 November 2026 (relayed in the Guardian 12 handoff, not first hand); proposed 19 November 2026. Owner decisions relayed by Conductor (task "Connect AI", brief stamp `auth-d4ac365282d1`, HEAD `1f5c415`): real workspaces may hold a model policy (relax the sample-only rule for `ai_model_policy` only), keep an "EU" choice alongside explicit countries, one versioned connection per provider, all three existing adapters offered, no display of whether a provider key is set, prefill from the latest version when updating, and both evaluation statuses offered. Built in Connect AI PR 1 (server command, service, route behind its own off switch, database module, installer action, rollback and tests; the screen is PR 2). Nothing is installed, switched on or verified in production. The database tests ran on a local PostgreSQL 16; CI on the pushed head is the check for the rest. No requirement moves to VERIFIED on design alone. The installation is a separate owner-approved run.

Amends ADR-028 forward for one table only. Everything else ADR-028 decides stays in force.

## Context

- A model policy is entered today only as developer JSON (`apps/web/app/operator/review-settings.tsx`, action `ai-policy`, `IntelligenceService.configure` in `packages/intelligence/src/service.ts`).
- `app.guard_ai()` (`packages/db/migrations/0026_governed_intelligence.sql`) guards all six AI tables. Before any table branch it refuses a row unless the actor can access the tenant for `synthetic_validation` and the tenant is synthetic. So a real workspace cannot hold a model policy, even though the real-use module already installed the `real_use_add` and `real_use_read` row policies for `app.ai_model_policy` (`packages/db/customer-real-use-migrations/0002_real_request_authority.sql`).
- The `ai_model_policy` branch requires owner or admin with a fresh authenticator check, the next version (max plus 1) with a strictly later start, exactly 16 configuration keys, 1 to 12 registered tasks, 1 to 20 processing locations that exist in `app.country`, positive integer minor-unit rates, USD, a fixed adapter and secret reference pair, at most one current same-tenant fallback, and a current accessible evaluation source and terms source.
- At run time `app.ai_run_authorized` requires the policy's processing locations to be a subset of each cited source's rights-review processing locations. `SdkInferenceAdapter.ready` (`packages/intelligence/src/adapters.ts`) requires every policy location to be listed in `CORRIDRA_<ADAPTER>_PROCESSING_LOCATIONS`. AI is also off unless `app.part4_enabled(t,'ai.enabled')` is true. As installed by the real Network module, that function returns false for every non-synthetic workspace for any key other than `network.enabled`.
- The EU is recorded as a market scope with 27 member countries (`app.market_member`, `packages/db/migrations/0020_versioned_corridors.sql`). That is more than the 20-location cap.

## Decision

1. **Real workspaces may hold a model policy, and nothing else in AI.** An additive, hash-checked replacement of `app.guard_ai()` changes only the opening check, and only for `TG_TABLE_NAME='ai_model_policy'`:
   - The actor must be `NEW.created_by` and must be able to access the tenant for `app.tenant_processing_purpose(tenant)`.
   - The tenant must be synthetic or `app.real_use_allowed(tenant)`.
   - The opening check for `ai_run`, `ai_attempt`, `ai_result`, `ai_review` and `ai_completion` stays byte-identical, so it remains sample-only. No inference, attempt, result, review or completion can be written for a real workspace.
   - `app.ai_run_authorized`, `app.part4_enabled`, `app.ai_output_grounded`, the RLS policies and the row-rewrite and event triggers are not replaced.
   - Every other rule in the policy branch is unchanged except item 3's cap: owner or admin with a fresh authenticator check, append-only versioning, 16 keys, tasks, rates, USD, the secret reference pair, fallback, evaluation source and terms source.
   - Every inserted row still raises the existing `record_change` event. That event is the audit record of who connected what.
2. **"EU" is a server-resolved shortcut to explicit countries.** The guided command takes either explicit country codes or the market key `EU`. The service resolves `EU` inside the saving transaction from `app.market_member` (rows in force today, sorted by code). It stores only those country codes in `processingLocations`. It refuses if the result is empty or over the cap.
   - No market key is ever stored in a policy, and no runtime check reads markets.
   - The stored list is a snapshot. A later membership change does not alter it; a new version is needed.
3. **The location cap rises from 20 to 30**, the smallest bounded value that holds the current EU membership with margin. It changes in both the guard and `modelPolicy` (`packages/intelligence/src/index.ts`).
   - The migration also creates a marker function, `app.ai_model_policy_location_limit()`, returning 30 and executable by the runtime role.
   - The guided screen offers EU and real workspaces only when this marker exists. The marker answers one question: whether this module is installed.
4. **Why this cannot weaken a gate.** Every runtime check is a subset test: policy locations must be a subset of each source's rights review, and a subset of the deployment's configured list. Adding locations can only make fewer runs pass.
   - The cap rise admits only larger sets, which are harder to authorize.
   - The guard still checks every stored code against `app.country`.
   - No wildcard, market key or membership lookup is evaluated at run time.
   - An EU connection therefore authorizes nothing unless the deployment setting lists all of its countries and every cited source's rights review lists all of them too.
5. **Inference stays off.** Connecting writes one `ai_model_policy` row. It does not write `app.config_version` (`ai.enabled`), does not touch deployment settings and does not change any route pack's `aiPolicyRef`. It makes no provider call and does not call `ready`. AI output stays `UNVERIFIED_DRAFT` under ADR-028. In a real workspace, item 1 and `part4_enabled` together keep inference impossible until a further owner decision and ADR.
6. **Guided command, same insert.** The guided command builder in `packages/intelligence` produces exactly the existing `policyCommand`:
   - The server derives `secretRef` from the adapter.
   - The server generates `id` and computes `version` from `max(version)+1` checked against the version the person saw (a 409 on mismatch).
   - `currency` is USD.
   - `approved` is true only with an explicit confirmation.
   - Both source ids are required and never defaulted, prefilled or invented.
   - The connection key is `connect-<adapter>`.
   - API key values never pass through it.
     It is behind its own off switch, `CORRIDRA_AI_CONNECT_FORM`. The developer JSON path stays unchanged under Advanced.
7. **Wording.** Copy must not say or imply "EU data residency", "data stays in the EU", GDPR compliance or any legal status. The EU choice is described as a list of countries Corridra records, not as a check of where a provider processes data. The exact wording is an owner decision (open question 1).
8. **Installation.** The new migration directory and installer action listed under Consequences install it. The installer refuses unless the real-use modules (which define `app.real_use_allowed` and `app.tenant_processing_purpose`) are installed. The SQL refuses unless the sha256 of `pg_get_functiondef('app.guard_ai()')` equals the pinned hash of the definition installed by core migration 0026. A rollback file restores that exact definition, with the cap reset to 20, through a further reviewed forward run. Policies already recorded are append-only and stay.

## Consequences

- The options read (`GET ai-connect`) takes an optional `adapter` query value, validated against the three adapter ids, and returns `fallbackFor`, the connection key it left out of the fallback list. With no adapter every current, latest candidate comes back with its `key`, so the PR 2 screen can filter. A connection cannot be its own fallback, because saving a new version at once supersedes the old one at run time; the service says so plainly. Both additions are read-side only.

- New: `packages/db/ai-model-policy-real-migrations/0001_real_workspace_model_policy.sql`, its `rollback/0001_restore_guard_ai.sql`, `packages/db/src/ai-model-policy-real-migrate.ts`, one new option `ai_model_policy_real` on the existing `field_modules_action` input (no new workflow input), and installer wiring in `scripts/install-customer-modules.ts`.
- An EU connection is usable only if the owner sets `CORRIDRA_<ADAPTER>_PROCESSING_LOCATIONS` to include every resolved country and the rights review of each source lists them all. The screen and runbook say so.
- Adding a version stops AI for route packs pinned to the earlier version, because `ai_run_authorized` accepts only the latest version for a key. The screen says so.
- A real workspace can record provider choices, rates and budgets before AI is allowed there. That is configuration only: no money moves and no run is possible.

## Rejected options

- **Remove the sample-only check from `guard_ai` for every AI table.** That would open runs, attempts and results in real workspaces, which the owner did not decide.
- **Store `EU` as a processing location, or a new key, in the policy.** That breaks the 16-key contract and the country check. It would also need market lookups inside `ai_run_authorized` and in the adapter gate, so a membership change would silently move a gate.
- **Map `EU` to a fixed subset of at most 20 countries.** That records a claim nobody reviewed.
- **Resolve `EU` in the browser.** The membership would be untrusted, and the saved command would not be the reviewed one.
- **Expand `EU` to all 27 while keeping the cap at 20.** Impossible.
