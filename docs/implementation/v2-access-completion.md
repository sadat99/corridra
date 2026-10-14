# Revised V2 Parts 1–5 access completion

The accepted Part 5 baseline is PR #36, main `712a750d48f4a6f9d41fe867346c5c3b6e93c18a`, migration 0028 and the live synthetic environment. This follow-up changes navigation, access recovery and compatible dependencies; it does not migrate data or activate real operations. The accepted follow-up PR records exact final release evidence.

## User-visible fixes

- Public `/workspace` directory, linked from desktop/mobile main navigation, footer, customer sign-in/account and operator workspace, connects all revised V2 Parts 1–5 tools and persona entry paths.
- Operator tool destinations and tenant selection survive sign-in and MFA through a closed return-path list. No external redirect, arbitrary API action or private token is accepted as a destination.
- Role-specific shortcuts point only to mounted sections. Invalid or unauthorized fragments explain recovery instead of leaving an orphan destination. Existing mounted forms and drafts are retained across section navigation.
- Customer accounts, invited operator identities and assigned-task access are explicitly distinguished. No invitation, membership, MFA or RLS check is weakened.
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

Current cloud Chromium returns `ERR_CERT_AUTHORITY_INVALID` for the environment proxy before reaching sign-in. HTTP/Node production smoke checks are independent. No credentials were submitted by that diagnostic and TLS verification was not disabled. Live browser write acceptance remains open until supported browser trust is corrected and the complete synthetic acceptance actually passes.

The original [control register](v2-part-05-controls.md) remains authoritative for real data, storage/scanning, privacy/retention/DSAR, outreach, provider/contributor pilots and recovery. This follow-up does not fabricate legal, financial or real-user acceptance.
