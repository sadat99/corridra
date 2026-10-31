# WS-D status

State: RUNNING
Items: in progress
Gates: not run yet
Integration notes: none yet
Decisions taken: none yet

## Blast radius of auth changes (written before the change)

- CQ-74 team invites: new owner-only handlers under `/api/team-control/invites`, behind `CORRIDRA_TEAM_INVITES`. They reuse the operator invitation model: one disabled `identity.user` and `identity.principal`, one `app.membership` row inserted through the runtime pool under the existing RLS policy (owner with fresh MFA), and one 7-day `identity.verification` row written with the restricted auth pool. Resend replaces the verification row; cancel deletes it and revokes the pending membership. Every step writes `identity.security_event`. Existing operator setup (`OperatorSetup.complete`) consumes the row unchanged. No RLS policy, migration or existing sign-in path changes.
- V-03 authenticator reset: owner-only handler, fresh authenticator check required (STEP_UP_REQUIRED otherwise). It removes the target member's `identity."twoFactor"` rows, sets `twoFactorEnabled=false`, ends that member's sessions and writes `identity.security_event`. The member re-enrols at next sign-in through the existing enrol step. An owner cannot reset their own authenticator here, and only members of the same workspace can be reset.
- Nothing touches customer identity (`neon_auth`, `customer_private`), so customer sign-in and staff MFA stay separate.
