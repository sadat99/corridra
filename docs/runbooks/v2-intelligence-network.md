# Revised V2 Part 4 operations

Module-specific guidance. Read [the current plan](../implementation/current-plan.md), [developer handoff](../START_HERE.md), [identity recovery](neon-auth-accounts.md) and [deployment](deployment.md) for current programme/access/release status. Part-specific counts and dated rollout/settings observations below refer to their own release; inspect the current schema and executed evidence before acting. These instructions never authorize real operations or bypass readiness gates.

Start with the existing work password/TOTP identity and tenant authority. Use isolated synthetic records for validation. Real invited work additionally requires ADR057 installation and both explicit Network controls. Customer Neon identities do not gain execution access through email matching.

## Access Corridra Network

- Public overview: [Corridra Network](https://c.obsidianglobal.studio/network), also linked in the public footer. This is an introduction, not a public task marketplace.
- Invited staff: open [Execution network](https://c.obsidianglobal.studio/operator#workspace-network), sign in with the operator identity and authenticator, then select **Assistance → Execution network**. Navigation is offered to owner/admin/operator/reviewer roles; every API permission still applies. Customer registration grants no staff membership.
- Invited contributors: use `/contributor?workspace=<the-issued-workspace-id>` from the reviewed invitation. The staff panel’s **Open assigned task access** link includes that workspace. Opening `/contributor` alone shows access help, not a workspace chooser or public enrolment.

PR126 is merged as `8865b889` with real invited work under [ADR057](../adr/0057-real-invited-execution-work.md). Its exact-source Production deployment is READY. Production Network activation remains pending protected installation and explicit flag verification. Do not infer activation from the source or this runbook. Genuine production identity/email acceptance remains separate from local browser evidence.

### Prepare contributor access

1. An owner/admin with a current authenticator opens **Assistance → Execution network → Invite a contributor** in the real workspace. Enter the intended name, contact email and an operating country within your authority. This creates a disabled pending work identity, not team membership.
2. Share the **Contributor setup link** (`/contributor/setup`) and the workspace-specific **Assigned task link** manually with that person. Corridra does not email these invitations automatically. They create or sign in to their customer account, verify the same email, then set a separate work password through the setup page. Pending invitations expire after seven days; the owner/admin can cancel before acceptance.
3. They follow the setup confirmation to work sign-in, enroll their authenticator and retain recovery codes privately. An already active work identity keeps its credentials and memberships; use its existing work sign-in instead of attempting a reset.
4. Copy the principal reference from the invitation record into **Contributor eligibility**. Review capabilities, markets, languages, sectors, work countries, availability, expiry and supporting eligibility evidence. A reference is not eligibility approval. Legal/commercial evidence remains independently reviewed.
5. Create the fully disclosed task against its mission/route assignment, including instructions, evidence requirements, deadlines, independent reviewer and any exact conditional reward rule. Explicitly assign it to the reviewed profile. Contributors see only their assigned task disclosures.
6. Contributors accept, submit findings and request corrections/dispute review through their assigned-task page. The independent reviewer reviews the evidence and task decision. Contribution assessment and owner/admin reward approval are separate; no payment or payout provider is activated.
7. Suspend the contributor profile to stop task access. Preserve work, evidence and money history. Accepted identities are not reset or removed through invitation cancellation.

### Install, enable or pause

After exact-head CI and actual CodeQL uploads pass, run the existing protected **Install customer modules** workflow from checked `main`, `apply=yes`, `network_use_action=enable` and an explicit reason. Leave existing authority inputs blank and `real_use_action=unchanged` to preserve them. The Network action installs two optional additive migrations after the existing seven real-use migrations, then appends the real tenant's `network.enabled` control. `install` installs without enabling; `pause` appends a disabled tenant control. The protected environment requires its GitHub reviewer; never bypass it.

After the successful install, independently check both registry hashes, the tenant control and original pinned owner/executor. Set only Production `CORRIDRA_NETWORK_ENABLED=true` and refresh the exact checked deployment for build-time public copy. Verify READY, its commit, aliases and the public/private routes. Retain real intake settings and deferred scanning. This does not enable real AI, outreach, billing or payouts.

To pause, use the protected tenant `pause` action and/or disable the Production environment flag. Do not delete identities, invitations, profiles, tasks, events or financial records. Existing invitation history and pending cancellation remain readable while the environment flag is off. Exact compensating reward reversal remains available to authorized staff; it does not create new work.

## AI preparation and review

1. Record the actual public source and claim with current retention and an AI-permitting source policy. An existing source AI denial cannot be overridden.
2. An owner/admin with fresh MFA appends the source rights through `ai-rights`: exact source, version, licence, reuse, processing countries, transfer approval, retention and rationale. Preserve original Part 1 policy history.
3. Review provider terms and an actual task/model evaluation source. Append `ai-policy` with a strict `modelPolicy`, terms source, daily minor-unit budget, effective date and reason. `SYNTHETIC_ONLY` policies are for isolated validation; deployed SDK adapters require `APPROVED_PROVIDER`. Environment keys are referenced by the approved adapter-specific names; key values belong only in secure environment settings.
4. Append the mission's corridor pack with the exact approved `aiPolicyRef`, retaining all other route controls, then explicitly reassign its mission version. Existing/null/obsolete packs grant no inference access.
5. Enable the independent environment/tenant flags only after provider prerequisites pass. Use the existing AI review panel to request a registered task on exact approved claim identifiers, inspect sources, and accept/edit/reject the draft. Changes to facts or commercial state require separate existing command handlers.
6. An unavailable provider, schema failure, citation failure, cap or circuit returns manual review. A pending received request is not resent after a crash; inspect its persisted run/attempt/result and continue manually. Conservative reservations are retained rather than guessing a provider charge. Token rates produce estimates, not an invoice reconciliation.

Supported adapter secret references: `CORRIDRA_OPENAI_API_KEY`, `CORRIDRA_ANTHROPIC_API_KEY`, `CORRIDRA_GOOGLE_API_KEY`. No default real model identifier is shipped. Each live adapter also requires its reviewed secure-setting country allowlist (`CORRIDRA_OPENAI_PROCESSING_LOCATIONS`, `CORRIDRA_ANTHROPIC_PROCESSING_LOCATIONS` or `CORRIDRA_GOOGLE_PROCESSING_LOCATIONS`, comma-separated ISO countries). Confirm the actual fixed provider endpoint/account arrangement before setting this allowlist; it does not force data residency or infer a provider region. Missing regional readiness keeps inference closed. Approved processing regions must match actual provider arrangements and the source rights. No private input, free-tier exception, arbitrary endpoint or automatic tool action is available.

## Restricted work and rewards

Controlled synthetic invitation uses `provisionSyntheticContributor` from the existing offline identity bootstrap module. It requires a currently authorized owner/admin MFA context, an isolated synthetic tenant and an `@example.invalid` identity, creates no membership, and requires actual authenticator enrollment. Never attach a schema-owner connection to an HTTP handler. Share credentials/invitation links through an approved human-controlled process; this module sends no invitation message. Real invited onboarding uses the reviewed invitation and verified-account setup process above.

Review an exact principal's profile and current eligibility source in the operator network panel. Work country is a reviewed eligibility dimension, separate from market coverage and residence. Neither a reviewed profile nor a corridor status asserts actual immigration, tax, employment or legal approval. Append suspension/retirement to remove task access immediately; renewal requires current eligibility and a new explicit assignment/task scope.

Create a task against the current mission assignment with every disclosure field. A conditional monetary rule uses the existing `reward_rule_version`, created through `network-rule`; its effective window must cover the entire disclosed task period. Task creator, reviewer and actual assignee cannot substitute for one another's approvals. An owner/admin with fresh MFA approves the exact assignment and relationship disclosure. Open `/contributor?workspace=<tenant UUID>` only with that invited identity; the UUID grants no access by itself.

The contributor reads the terms, accepts, submits an original declaration, and can request dispute review. Offline text is not received until acknowledgement; keep the page open, reconnect or reverify in another tab, and retry the same request. Never promise background delivery or store sensitive work in local storage. Late submissions are allowed only until the disclosed cutoff and require timeliness review. No upload permission or raw parent-mission/contact access is granted to the contributor.

The assigned fresh-MFA reviewer inspects the original submission, records reasoned evidence quality/timeliness, and requests correction, rejects or completes the work. Source/claim lineage preserves the actual assignee declaration. Verification requires the existing independent evidence workflow; no task label verifies a fact or proves commercial financial success. Resolve disputes with an explicit uphold/reject/reopen disposition and rationale. Reopening permits evidence correction; history remains immutable.

An operator assesses the completed contribution once. A different owner/admin independently approves the exact disclosed original-currency reward obligation. The Part 1 ledger guard prevents self approval, duplicate credit, changed rule amounts and unreviewed network contributions. `network-reverse` records an exact negative compensation against an unreconciled original; settled international payments cannot be reversed by this workflow. The original third-party reconciliation contract remains, with no automatic payment provider or webhook authority.

Disabling either feature preserves history. Inspect owned blocked tasks, pending AI attempts and expiry; do not reset histories, delete incomplete branches, weaken RLS or change older migration checksums to clear a blocked state.

## Release and Part 5 handoff

Require full database/RLS, provider-mock/golden, migration/replay, regression, build and browser acceptance. Part 4 was merged in PR 34; for future changes use bounded reviewed PRs and the current release runbook; retain a maximum of eight Git branches including main and all unfinished dependency PRs. Verify exact production SHA and actual independent flag states. Clean only accepted completed branches after current PR, ancestry, parent/child and binding checks. Revised Part 5 subsequently merged; follow the ledger’s current sequence. This historical Part 4 receipt does not establish whole V3 readiness.
