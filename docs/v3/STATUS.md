# V3 implementation status

Current production source: 720d96ed8606d27c020fd470add1c9c6277faa85, 17 October 2026. Production is READY in Frankfurt at [c.obsidianglobal.studio](https://c.obsidianglobal.studio). Whole V3 is **PARTIAL**. The [contract](../V3_CONTRACT.md) governs scope; the [ledger](../V3_LEDGER.md) records every requirement and per-chunk evidence.

## Visible and verified within bounded scopes

- Three product entry points and guided request prefill: buyers/partners, suppliers/products and delegation organisation, plus other objectives.
- Signup verification code field appears immediately, with resend and failure/retry recovery.
- Protected founder overview and explicitly synthetic product exploration; original staff security and all18 expert destinations retained.
- Owned-domain navigation repaired: signup,sign-in,account,team setup and workflow pages stay on the subdomain. Old hosting-alias links redirect to it. Sign in again if your previous cookies belong to the hosting alias. [Domain repair evidence](phase-1/custom-domain/release.json).

## Implemented and tested, with exposure gated

Synthetic customer workspace creation/listing/retries,owner membership,invitations,member acceptance,cancellation,member revocation and paginated history reuse the existing tenant/backend infrastructure. Their account interfaces and owner team controls pass component protocol,permission-denial,responsive,keyboard and accessibility checks. They are deployed **with the feature flag off**;production hard-disables customer workspace exposure. This is not a released self-service organisation/delegation service.

[PR67 owner release](phase-3/customer-team-ui/release.json) passed30 integration files/249 tests,102 public browser tests and31 protected/browser cases,including5 new owner cases. Full formatting/lint/types/unit/security/build passed;CodeQL was skipped and D04 remains open. The first failed CI attempt and its datetime-driver/shared-fixture limitations are retained. [PR65 backend/cloud evidence](phase-3/customer-collaboration/release.json) and [PR66 invitation UI evidence](phase-1/workspace-invitation/release.json) remain separately scoped.

Actual private provider sign-in,reload,sign-out and revocation acceptance remains **NOT VERIFIED**. Received OTP and a visible code field do not prove those stages. No password,OTP or stored session token was retrieved.

## Remaining implementation and acceptance

| Area                                  | State   | What remains                                                                                                                                                                                  |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase0 preservation                   | PARTIAL | Static inventory/mapping and current regressions verified;exhaustive dynamic role/action/state acceptance unverified.                                                                         |
| Phase1 experience                     | PARTIAL | Bounded public/founder/gated workspace/team controls verified;remaining contextual professional/customer experiences and private walkthroughs.                                                |
| Phase2 three flagship journeys        | PARTIAL | Existing managed buyer/sourcing/machinery/programme backend retained;full independent/self-service journeys not accepted.                                                                     |
| Phase3 customer SaaS                  | PARTIAL | Canonical organisation linking/owner transfer,persistent customer-owned missions,independent delegation administration,participant onboarding/privacy and organiser economics remain missing. |
| Phase4 founder and release acceptance | PARTIAL | Bounded overview/explorer verified;full source-backed venture reporting,accepted measurement targets and all-audience walkthroughs remain.                                                    |
| Phase5 commercial activation          | GATED   | D01-D06/D08:independent legal/privacy/provider/storage/security/delivery/payment and paid pilot evidence. No real missions,outreach,inference,payments or payouts.                            |

Missing code is implementation work. External activation gates do not explain away missing functionality. No unsupported completion percentage is claimed.

Next backend packet: [private customer request plan](phase-3/customer-requests/bounded-plan.md) and [ADR033](../adr/0033-private-customer-request-authority.md). Reuse the canonical mission factory/receipt with creator-only authority and independent admission;the design is documented and implementation remains MISSING. Workspace owners/organisers gain no automatic access to private participant commercial records.

Rollback: keep customer exposure off;restore the prior origin/deploy retained compatible source for domain rollback. Preserve signing material,accounts,MFA,memberships,additive schema,original sources and append-only history. Git branch union remains8/max8;all retained environments/unfinished dependency work remain protected.

18 October forward candidate: V3-06-004 PARTIAL. Private request backend/module3/API is implemented with focused restricted-PG11 and legacy52 focus passing; full candidate checks/release pending. Request UI/full customer mission scope remains missing. No cloud module3 or request admission/flag is activated. See ledger51 and bounded request report; previous release statements above describe their dated deployed source.
