# V3 implementation status

Verified application revision: `d35ab920e3cd6aa4321e6e921040a168342f99f7`, 17 October 2026. Full V3 remains **PARTIAL**. [Contract](../V3_CONTRACT.md) governs requirements; [ledger](../V3_LEDGER.md) records all507 requirement IDs, evidence and next actions.

## Reflected in the live UI

- Three prominent product entries and guided request prefill: buyers/partners, suppliers/products and delegation organisation, plus other objectives.
- Protected founder clarity: implemented versus missing/gated capabilities and explicitly synthetic product exploration.
- Existing customer identity/private-invitation flows, staff security and all18 expert operation destinations remain accessible within their existing permissions.
- Signup email verification now shows the code field immediately, with separate resend and failure/retry recovery. The production and isolated preview routes both confirm the input is visible.

The latest customer-authority release adds **no customer-facing screen or creation control**. It must not be presented as a finished self-service delegation or customer-workspace product.

## Verified backend foundation

Admitted synthetic customer tenant provisioning, initial immutable owner membership, owner workspace listing, fresh bounded provider proofs, retry/conflict handling and accurate event/audit/outbox recording. Existing canonical tenants and infrastructure are reused. Canonical organisation linking is absent and the response explicitly returns `organisationId:null`.

PR62 passed **226 integration tests,100 public browser tests and17 protected browser tests**, plus formatting/lint/typecheck/unit/build and required security checks. Its normal merge has the exact tested tree and an explicit READY Frankfurt production deployment. The customer API returns503 in production: its flag is off and it is hard-disabled there.

The isolated nonproduction customer-auth child has29 preserved core migrations plus the explicitly inventoried customer module. Repeat installation and actual separate runtime/auth login restrictions passed. No customer admission,workspace or provider identity was created during this acceptance.

## What remains and why

| Area                              | State        | Remaining work and reason                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase0 preservation               | PARTIAL      | Original static bindings/routes/states/commands retained; complete dynamic role/action/state runtime acceptance remains unverified.                                                                                                                                                     |
| Phase1 experience                 | PARTIAL      | Entry/founder scope is verified; persistent customer workspace screens and wider professional navigation still need implementation and walkthroughs.                                                                                                                                    |
| Phase2 flagship journeys          | PARTIAL      | Existing managed backend flows are preserved; the complete independent customer/organiser experiences are not yet implemented.                                                                                                                                                          |
| Phase3 SaaS                       | PARTIAL      | Organisation linking,invitations/collaborative membership,persistent customer mission access,independent delegation/participant administration and organiser economics still need implementation.                                                                                       |
| Customer identity acceptance      | NOT VERIFIED | Existing signup/sign-in screens are available on the isolated preview; actual received OTP,authenticated reload/sign-out/revocation and subsequent customer walkthrough need a controlled test inbox/session. Anonymous checks and database fixtures cannot replace these observations. |
| Phase4 founder/release acceptance | PARTIAL      | Founder clarity is present; full source-backed customer/activity/economics reporting and comprehensive role-specific journeys depend on the missing workflows and verification.                                                                                                         |
| Phase5 activation                 | GATED        | D01-D06/D08 remain independently closed. Legal/privacy/provider/storage/security/delivery/payment prerequisites are not overridden by a UI,deployment or passing test.                                                                                                                  |

Missing code is implementation work. Activation gates are separate constraints; they do not explain away missing functionality.

Recipient update, 17 October 2026: the owner confirms signup delivered an OTP on the isolated preview. PR63 fixed the hidden code field, passed full CI226 integration/100 public/18 protected tests, and is merged/deployed at the revision above. Production and the existing isolated preview are READY with the exact checked source. See [OTP release evidence](phase-1/customer-verification/release.json). Private code consumption and authenticated reload/sign-out/revocation remain unverified.

## Next bounded packets

1. Add the customer workspace list/create/retry interface over the verified API, preserving the existing private-invitation path. Its stale-account rejection guard is locally tested on a separate branch; the UI is under verification. Keep workspace creation gated until actual controlled customer acceptance.
2. Implement rights-aware company linking,collaboration/invitations/revocation and persistent mission authority in separately tested additions.
3. Reuse the shared commercial engine for independent delegation,participant privacy and exact-currency organiser economics. Keep real communications and payments gated.
4. Finish source-backed founder reporting,legacy role/state walkthroughs and the Hard Release Conditions audit.

The isolated identity preview is [available here](https://corridra-git-feat-v3-customer-acceptance-sadat-os.vercel.app/signup). It uses separate signing/database credentials and an exact trusted origin; mandatory OTP verification remains enabled. Its customer-workspace flag is off. It is an acceptance environment,not a commercially activated service. Keep passwords and OTPs private; record only observed outcomes/errors.

Rollback: disable customer exposure and redeploy the retained compatible application; retain additive schema,canonical records and append-only history. See [release evidence](phase-3/customer-authority/release.json),[cloud acceptance](phase-3/customer-authority/cloud-upgrade.json) and [runbook](../runbooks/neon-auth-accounts.md#v3-synthetic-customer-workspace-authority).
