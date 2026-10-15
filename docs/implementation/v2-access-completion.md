# Revised V2 Parts 1–5 access completion

Historical implementation packet for its named revision. Its scope, acceptance and next-step statements are dated context. Use [the current plan](current-plan.md) and [developer handoff](../START_HERE.md) for present status; old task sequencing or unclosed-at-the-time issues are not current instructions. Do not infer full requirement acceptance from this packet.

The accepted Part 5 baseline is PR #36, main `712a750d48f4a6f9d41fe867346c5c3b6e93c18a`, migration 0028 and the live synthetic environment. This follow-up changes navigation, access recovery and compatible dependencies; it does not migrate data or activate real operations. The accepted follow-up PR records exact final release evidence.

## User-visible fixes

- Public `/workspace` directory, linked from desktop/mobile main navigation, footer, customer sign-in/account and operator workspace, connects all revised V2 Parts 1–5 tools and persona entry paths.
- Operator tool destinations and tenant selection survive sign-in and MFA through a closed return-path list. No external redirect, arbitrary API action or private token is accepted as a destination.
- Role-specific shortcuts point only to mounted sections. Invalid or unauthorized fragments explain recovery instead of leaving an orphan destination. Existing mounted forms and drafts are retained across section navigation.
- Customer accounts, invited operator identities and assigned-task access are explicitly distinguished. An owner-approved first-password invitation is accepted inside the matching verified customer account at `/operator/setup`; separate staff MFA remains mandatory. Ordinary invitations require fresh owner MFA; the one-time first-human-owner bootstrap is documented in ADR 030. No runtime endpoint creates membership or grants a customer an admin role.
- Protected readiness UI and linked operating guide include GitHub settings links and specific release/security prerequisites. Missing source/financial data remains unknown, and AI/network/real-operation gates remain truthful.
- Buyer/supplier private-link pages have access-help and home navigation without disclosing capability links.

## Dependency review

Six original upgrade heads are integrated for exact-head CI acceptance, preserving their ancestry: #4 CodeQL action v4; #5 setup-node v7; #6 upload-artifact v7; #7 checkout v7; #12 Undici 8.11.2; #29 ESLint 10.12.0. Under ESLint 10, explicitly selecting the root configuration retains the existing cross-package provider-import restrictions and generated-file exclusions. The Blob contract fixture uses the dispatcher's actual parameter type after the Undici type rename; its behavior assertions are retained.

Two unfinished PRs must remain open and their branches must remain:

- #10 TypeScript 7.0.2: isolated local upgrade confirmed `typescript-eslint does not support TS 7.0`. Do not merge with failing lint or disable the lint gate. A separately validated compiler/API compatibility upgrade is needed; the attempted unpublished integration was removed without changing the original PR/head.
- #32 Node 26 types: production and `.node-version` are pinned to Node 24. Do not represent Node 26 APIs as the supported production runtime merely to clear a branch. Revisit with a separately supported runtime/toolchain upgrade.

Only after accepted merged CI and exact-SHA production verification may completed dependency/product branches and their exact retired previews be deleted. Preserve the two unfinished PRs, all required production/default branches, sterile parents and current environment bindings. Dependabot concurrency remains bounded; Git and managed Neon creation must refuse an eleventh branch.

## Production prerequisites

A fresh GitHub rulesets response explicitly says this private repository requires GitHub Pro for that feature. Main protection/secret scanning remain inaccessible through the integration; code scanning reports disabled. These are distinct findings, not proof that one paid upgrade enables every security feature. Do not make the repository public as a workaround. See [access and launch guide](../runbooks/v2-access-and-launch.md).

Native cloud Chromium returned `ERR_CERT_AUTHORITY_INVALID` for the environment proxy. Same-origin request routing through the TLS-validated Node transport subsequently passed password/TOTP, unrelated-tenant denial, correctly scoped synthetic programme/mission import, service invoice/receipt/fee/cost/completeness writes and idempotency, exact receipt compensation and sign-out revocation against accepted Part 5 production. No TLS verification, membership, source scope or MFA was bypassed. An initial public-intake attempt could not write a document outside the existing test workspace; scoped import supplied a new authorized synthetic mission instead. Only invented records were added; no real transaction or outreach occurred. The original deferred full production customer-commercial journey remains open. Final follow-up production smoke and exact-SHA evidence belong to the accepted PR.

The original [control register](v2-part-05-controls.md) remains authoritative for real data, storage/scanning, privacy/retention/DSAR, outreach, provider/contributor pilots and recovery. This follow-up does not fabricate legal, financial or real-user acceptance.

## Explicit staff onboarding acceptance

The reported account-access issue was a customer identity with no staff identity or membership. Owner role includes administrative capabilities; one role is assigned per workspace. The owner explicitly selected founder/admin capabilities and Bangladesh as their operating country. Pending invitation preparation is separate from activation: the recipient must privately set their password and enroll MFA. No recipient password or authenticator is collected by the agent. Tests cover owner/country scope, independent verified identity, no automatic grant, first-human-owner refusal after any human owner, invitation expiry/consumption, existing-identity reset denial and actual password-only workspace denial. The accepted PR records actual provisioning and activation state without publishing the email or credentials.
