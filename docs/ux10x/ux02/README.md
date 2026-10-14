# UX-02 review packet

UX-02 builds the public discovery, test brief and customer access experience on accepted UX-01 (`21bc01327296edb8a5ee988b57918d94defce898`). The complete [master handoff](../master-handoff.md) remains governing. Fusion 01 is visual reference only; fictional prototype identities, quotations, metrics and readiness controls are not adopted.

## Implemented behavior

- A shared public shell and editorial geometry, ivory/forest Atlas and responsive objective controls. The existing job catalogue supplies every selection. Perspective describes an example and grants no identity, membership or permission.
- Three initial forward product directions plus explicitly separate China/Spain reverse examples. The EU remains a trade bloc; all real customer operations remain unavailable. Country/market, shipment and meeting locations remain distinct. The global market selector retains all existing country choices.
- A read-only synthetic walkthrough that explains objectives, missing evidence and the next question. It makes no API writes, creates no record and requires no signup. Selected jobs/directions link to the existing five-step test brief.
- Public job pages retain original scope, metadata, destinations and copy. Native scope disclosures and section anchors make longer pages easier to use. `/coming-soon`, all canonical corridor paths and `/privacy` remain reachable.
- Intake progress and a draft-only context summary. Saved draft choices take precedence over entry hints; 24-hour expiry and corrupt-storage recovery are visible. Validation focuses a summary; original dates, units, currency precision and multilingual offer text remain in the existing schema and service contracts.
- Same-key retry retains the original receipt; identical content with another key does not reissue it. Failed receipt checks clear the preceding result. Existing receipt bytes, expiry, replies and server disclosure rules remain authoritative.
- Shared customer access/recovery shell, own verified-profile presentation and existing My Missions entry. Customer identity remains independent of staff membership and explicit mission invitations. The SDK methods and APIs remain unchanged. In-flight identity requests cannot be duplicated; failures focus their feedback and permit retry.

## Baseline and production continuity

The owner separately authorized UX-01 production deployment in this session. It is READY on `21bc013`, with custom and Vercel aliases mapped to the same deployment. [Release metadata](ux01-production.json) and five-route production browser evidence are included. The custom domain is blocked by the managed HTTP policy; actual browser checks use the official Vercel alias. Anonymous mission read returned 401, and the filtered runtime error query returned no records. No production sign-in, signup, intake, provider activation or financial operation was performed.

Accepted UX-01 public route sources were replayed on an isolated local server for six-width baseline capture, then the saved UX-02 source was restored with concurrent-edit checks. Baseline and after each contain 30 observations at 1440/1280/768/390/360/320: zero axe violations and zero horizontal document overflow. Local median FCP measured 70 ms before and 66 ms after, with maxima 400/404 ms. These are local samples, not production or field Core Web Vitals.

## Traceability and limitations

[Inventory](inventory.md) and [coverage ledger](coverage.json) reconcile accepted UX-01's 43 routes, 746 source controls, 69 endpoint branches and 213 baseline test declarations. Original Gate 0 records remain unchanged in the parent directory. These counts do not expand every repeated runtime control or prove all role/state combinations.

[Verification](verification.json) distinguishes executed scenarios from gaps. Customer received-email signup/OTP/password-reset success is not claimed by the transport-failure tests. Those tests use an unreachable synthetic provider configuration and reject all auth transport requests; no authorization success is mocked. Accepted hosted provider contracts remain unchanged. Whole-programme coverage and external readiness gates stay explicit.

## Validation and rollback

See [validation](validation.md) and saved logs/screenshots for final results. The existing long protected workflows and resettable database fixtures are preserved. The extra intake flow has its own fixed local fixture so it cannot consume the shared six-request budget. Final public and protected suites run serially; focused parallel experiments must use separate artifact directories.

UX-02 branch and main remain opted out of automatic Git deployments. This PR has no migrations, domain/API/auth contract changes, provider credentials, analytics activation, new payment/payout path or real customer operation. Revert this presentation/test/documentation diff to roll back. Merge and UX-02 deployment require separate owner acceptance.

After acceptance, the precise next package is **UX-03 — Customer, buyer, supplier, institution and contributor journeys**. Carry all NOT_YET_VERIFIED and PARTIAL rows forward; do not infer complete functionality from an unchanged backend or passing test count.
