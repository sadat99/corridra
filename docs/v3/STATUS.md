# V3 implementation status

Verified application revision: `bc845512f54a5b079def8546c5c7632f9a531150`, 17 October 2026. Full V3 remains **PARTIAL**. [Contract](../V3_CONTRACT.md) governs requirements; [ledger](../V3_LEDGER.md) records all507 requirement IDs, evidence and next actions.

## Reflected in the live UI

- Three prominent product entries and guided request prefill: buyers/partners, suppliers/products and delegation organisation, plus other objectives.
- Protected founder clarity: implemented versus missing/gated capabilities and explicitly synthetic product exploration.
- Existing customer identity/private-invitation flows, staff security and all18 expert operation destinations remain accessible within their existing permissions.
- Signup email verification now shows the code field immediately, with separate resend and failure/retry recovery. The production and isolated preview routes both confirm the input is visible.

PR64 adds a gated customer workspace list/create/retry interface and issuer/subject rejection for stale pages. Its full CI passed236 integration,100 public browser and22 protected browser tests. Workspace exposure remains off; canonical company linking,team invitations and independent delegation SaaS remain missing.

## Verified backend foundation

Admitted synthetic customer tenant provisioning, initial immutable owner membership, owner workspace listing, fresh bounded provider proofs, retry/conflict handling and accurate event/audit/outbox recording. Existing canonical tenants and infrastructure are reused. Canonical organisation linking is absent and the response explicitly returns `organisationId:null`.

PR62 passed **226 integration tests,100 public browser tests and17 protected browser tests**, plus formatting/lint/typecheck/unit/build and required security checks. Its normal merge has the exact tested tree and an explicit READY Frankfurt production deployment. The customer API returns503 in production: its flag is off and it is hard-disabled there.

The isolated nonproduction customer-auth child has29 preserved core migrations plus the explicitly inventoried customer module. Repeat installation and actual separate runtime/auth login restrictions passed. No customer admission,workspace or provider identity was created during this acceptance.

## What remains and why

| Area                              | State        | Remaining work and reason                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase0 preservation               | PARTIAL      | Original static bindings/routes/states/commands retained; complete dynamic role/action/state runtime acceptance remains unverified.                                                                                                                                                                                                           |
| Phase1 experience                 | PARTIAL      | Entry/founder scope is verified; gated customer workspace screens are implemented and protocol-tested; actual private customer walkthroughs and wider professional navigation remain unverified.                                                                                                                                              |
| Phase2 flagship journeys          | PARTIAL      | Existing managed backend flows are preserved; the complete independent customer/organiser experiences are not yet implemented.                                                                                                                                                                                                                |
| Phase3 SaaS                       | PARTIAL      | Synthetic invitation/member/revocation backend is verified and installed on the isolated child,with exposure off. Organisation linking,persistent mission access,independent delegation/participant/economics and owner team UI remain missing;invitation acceptance UI is under separate verification.                                       |
| Customer identity acceptance      | NOT VERIFIED | Existing signup/sign-in screens are available on the isolated preview; OTP delivery is owner-observed and the initial code field is fixed; private code consumption,authenticated reload/sign-out/revocation and subsequent customer walkthrough remain unverified. Anonymous checks and database fixtures cannot replace these observations. |
| Phase4 founder/release acceptance | PARTIAL      | Founder clarity is present; full source-backed customer/activity/economics reporting and comprehensive role-specific journeys depend on the missing workflows and verification.                                                                                                                                                               |
| Phase5 activation                 | GATED        | D01-D06/D08 remain independently closed. Legal/privacy/provider/storage/security/delivery/payment prerequisites are not overridden by a UI,deployment or passing test.                                                                                                                                                                        |

Missing code is implementation work. Activation gates are separate constraints; they do not explain away missing functionality.

Recipient update, 17 October 2026: the owner confirms signup delivered an OTP on the isolated preview. PR63 fixed the hidden code field, passed full CI226 integration/100 public/18 protected tests, and originally merged/deployed d35ab920e3cd6aa4321e6e921040a168342f99f7. The latest revision above retains that fix. See [OTP release evidence](phase-1/customer-verification/release.json). Private code consumption and authenticated reload/sign-out/revocation remain unverified.

## Next bounded packets

In progress:synthetic workspace collaboration backend with additive module2,hashed single-use invitations,admitted member acceptance,owner cancellation/revocation and paginated history. Static checks pass;database/build/browser acceptance is pending. No collaboration UI or new company/mission authority is exposed. See [packet report](phase-3/customer-collaboration/report.json).

1. Keep the verified workspace interface gated until actual private customer identity acceptance. The existing private-invitation path remains available. Continue independent synthetic SaaS implementation while that provider walkthrough remains unverified.
2. Implement rights-aware company linking,collaboration/invitations/revocation and persistent mission authority in separately tested additions.
3. Reuse the shared commercial engine for independent delegation,participant privacy and exact-currency organiser economics. Keep real communications and payments gated.
4. Finish source-backed founder reporting,legacy role/state walkthroughs and the Hard Release Conditions audit.

The isolated identity preview is [available here](https://corridra-git-feat-v3-customer-acceptance-sadat-os.vercel.app/signup). It uses separate signing/database credentials and an exact trusted origin; mandatory OTP verification remains enabled. Its customer-workspace flag is off. It is an acceptance environment,not a commercially activated service. Keep passwords and OTPs private; record only observed outcomes/errors.

Rollback: disable customer exposure and redeploy the retained compatible application; retain additive schema,canonical records and append-only history. See [release evidence](phase-3/customer-authority/release.json),[cloud acceptance](phase-3/customer-authority/cloud-upgrade.json) and [runbook](../runbooks/neon-auth-accounts.md#v3-synthetic-customer-workspace-authority).

Verified bounded customer workspace packet:PR64 merged 5e2c095331b392f590315d595f89e9055c19f175; exact-source production and isolated preview READY. Existing account/private-mission paths remain. The list/create/same-command retry interface and issuer/subject stale-page guards pass the mandatory checks, but the workspace flag stays off; production also hard-disables it. Actual private provider acceptance and missing company/team/mission/delegation capabilities remain separate gaps. Evidence:[release receipt](phase-3/customer-workspace-ui/release.json).

Latest bounded backend release:PR65 merged89c9d07 after full required CI249 integration/102 public/22 protected tests and build. Production and configured acceptance preview READY/fra1 at that exact source;actual aliases and route/privacy-header checks verified. Optional customer module2 is installed only on the isolated child,with old rows/functions/ACL/RLS/policies/receipts retained and three restricted-login denials verified. One provider account is stored verified,two sessions unexpired,zero customer admissions;no secret or identity record retrieved. This does not establish actual authenticated browser reload/sign-out/revocation. Workspace exposure remains off and production hard-disabled. [Release evidence](phase-3/customer-collaboration/release.json). New invitation-acceptance UI is committed separately and still pending its own full CI;owner issuing/management UI remains missing.

Latest invitation acceptance release:PR66 merged/deployedbc845512 with full249 integration/102 public/26 protected tests,including four new component cases and1440/768/390 before/after/keyboard/axe/overflow. Production/configured preview READY/fra1,actual aliases/public/denial/OTP routes verified. Customer exposure off;actual private provider reload/sign-out/revocation unverified. [Release evidence](phase-1/workspace-invitation/release.json). Owner issuance/history/cancellation/revocation UI and founder capability clarification are separate committed source under verification;organisation/mission/independent delegation/participant/economics remain missing.
