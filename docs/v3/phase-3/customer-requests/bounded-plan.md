# Next bounded customer request authority packet

Status: backend implemented and focused local tests passed; full candidate verification/release pending. Requirement V3-06-004 is PARTIAL; customer request UI and full mission administration remain unverified. This first slice provides privately owned synthetic request discovery and progress. Full customer mission administration needs subsequent acceptance.

Authority design: [ADR-033](../../../adr/0033-private-customer-request-authority.md). The ADR is a design decision, not implementation evidence. New submission requires active selected-workspace membership; independently owned prior requests remain private to their creator after departure while fresh proof, request admission, resource grant and original retention remain valid.

## Inspected existing ports

- `packages/missions/src/index.ts:55`: `MissionService.submit` validates the existing brief, derives a receipt and invokes `app.submit_mission`. It creates the canonical case through the existing engine.
- `packages/db/migrations/0007_mission_core.sql:114`: the factory enforces the configured synthetic destination, notice, fictional contact address, original fields and duplicate/retry rules. A matching payload under another key can return a duplicate without an ID. That must never create an ownership claim.
- `packages/db/migrations/0007_mission_core.sql:139`: `app.mission_receipt` returns status, received time and operator replies only while `retention_until` remains valid. The original default is 30 days. Keep this function, retention and existing receipt behavior unchanged.
- `apps/web/app/api/customer-missions/route.ts`: verified customer identity enables the interface; the supplied client-publication capability independently authorizes its content.
- `apps/web/app/account/customer-missions.tsx`: opened private missions currently remain in page memory. Retain this working path.
- `packages/db/migrations/0001_identity_tenancy.sql:77`: staff authority requires its original session, assurance and MFA. Customer proof must continue to yield no staff actor.

## Required authority design before code

1. Record a forward ADR with exact auth, schema and event blast radius. Reuse the optional customer migration lifecycle; preserve core29/customer0001/0002, old functions/policies/ACLs and all historic records. No cloud change during source design.
2. Add an independently admitted synthetic request capability. Existing workspace membership or signup alone grants no mission authority. Production and real data remain disabled; use a separate default-off request flag.
3. Keep each request private to its creator. Workspace owners, invited members and organisers gain no automatic access to another participant's request, contacts, offers or negotiations. Define workspace departure versus independently owned resource access explicitly.
4. Reuse the canonical factory in the same restricted database transaction as the ownership binding. A server-attested submission plan must bind the fresh customer proof, actual principal, workspace, command, normalized brief digest, factory key and original receipt digest. Runtime cannot mint or alter that plan. Recheck proof after waits and preserve admission/revocation serialization.
5. Derive a namespaced factory key from trusted identity/context. Reject conflicting retries. Never claim an anonymous or another customer's case from matching email, company text or payload. A duplicate result without an ID creates no ownership binding.
6. Keep the original receipt digest privately with the binding; expose no receipt secret through URLs or browser storage. Read through the existing receipt function so original retention remains binding. Existing bindings must survive application signing-key rotation without rewriting source evidence. Do not rederive an old receipt with a new secret.
7. Preserve genuine event provenance: the configured service executes the original case command; the separately recorded customer initiator and binding explain ownership. Never manufacture a staff session, grant customer identities staff memberships, or change `app.actor_id`/`app.member_role` to bridge the engines.
8. Return an honest request result and canonical state. A saved request is not an accepted engagement, confirmed meeting or deal. Missing receipt/publication scope remains unavailable. Full commercial progress access requires its separately authorized publication/mandate.

## Bounded verification and rollout

Implement the backend first, then its customer UI as a separate concern. No new external dependency or second mission backend.

Required fresh/populated upgrade tests must compare every old row, function, policy, ACL and receipt. Test owner/member/other-tenant denial, missing request admission, wrong issuer/subject/workspace, expired proof after locks, concurrent duplicate commands, conflicting payload, anonymous duplicate without ID, rollback of both case and binding, signing-key rotation, original retention expiry and independent participant privacy. Preserve all original assertions.

Run full format/lint/types/unit/security/database/public/protected/build checks on the exact head. Keep API/UI flags off during deployment. The isolated child still needs explicit intake-destination readiness and actual private provider/browser acceptance; do not configure it silently or widen real admission. Update the ledger and founder capability truth after verification. Full organisation linking, independent delegation/participant/economics and D01-D06/D08 remain separate gaps.
