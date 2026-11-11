# ADR-051: Team roles and leaving for invited workspace members

Status: bounded implementation, synthetic only, default off (`CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED`). V3-06-003 and V3-06-002 stay PARTIAL for the whole product.

## Context

ADR-032 gave a workspace owner single-use invitations, acceptance by an admitted customer, and revocation. Every invited person stayed a plain member forever, could not leave on their own, and the owner could not hand out the admin rights that the programme and profile modules already recognise (`owner`, `admin`, `member`). An earlier audit found the register still called invitations missing; they exist, with UI and tests. This ADR covers only the real gap.

## Decision

- **Roles are an append-only history.** `customer_private.workspace_member_role` records each change (member, version, role, who changed it). No row means the original role `member`. Rows cannot be updated or deleted and are unreadable to the runtime and auth logins.
- **Only two invited roles: admin and member.** Every other customer module understands exactly owner, admin and member, so a new `viewer` role is deliberately not added. The original owner has no member row and cannot be demoted, removed or made to leave here.
- **Owner-only change, stale-safe.** `customer.workspace_member_command(command, 'set_role', ...)` requires the workspace owner, names the member, the new role and the role the owner saw (`expectedRole`). A stale or repeated request is refused and writes nothing. A repeated command id returns the first answer; the same id with a different request conflicts.
- **Leaving acts on your own membership.** `'leave'` takes only the workspace and records the same revocation row the owner's revoke writes, with the member as the actor. It exposes no member id and cannot be aimed at someone else.
- **One place reads the role.** The three functions that read an invited member's role (`customer.collaborative_workspaces`, `customer.workspace_access_list`, `customer_private.organisation_profile_role`) are replaced with the same text except for the role expression, so a workspace with no role history behaves exactly as before. Tests compare every function, table, record digest, ACL and policy before and after installing the module on a populated database.
- **Same event chain.** Each change writes one domain event, audit event and outbox row through the existing access event helper (`customer.workspace.member.role_changed`, `customer.workspace.member.left`). Nothing is sent.
- **UI.** The owner's team screen shows each member's role and a confirmed "Make admin / regular member" action; a non-owner sees "Leave" with a confirmation. The controls appear only when the flag is on and the module is installed. The access page check now accepts `admin` and still rejects `owner`.

## Not included

Ownership transfer, a read-only `viewer` role, removing the original owner, email notice of a change (outreach is gated), and per-module custom permissions.

## Rollback

Unset the flag. The additive tables and history are kept. Roles already granted stay in force because the replaced readers still read them; to withdraw an admin right, demote the member before turning the flag off.

## Required acceptance

Database tests: installing on a populated database changes only the three role readers and adds only new objects; unchanged behaviour with no history; owner-only change; admin and member refused; other-workspace owner refused; stale, repeated and hostile payloads refused with no writes; replay and conflict; demotion; immutable history; restricted logins denied; leaving, revoked and disabled members; original owner protected; gates; repeatable installer with history-mismatch refusal. Browser protocol tests: confirmation before any request, exact request shape, stale, unavailable, denied and malformed answers, same-command retry, leave flow, absence of controls when off, and accessibility.

## Amendment, 6 November 2026: ownership transfer (CRUD gap G4)

The owner asked to close CRUD gap G4, recorded in [the CRUD summary](../revamp/crud/summary.md) as "Customer workspace: no rename, no archive or close, no ownership transfer", and on 6 November 2026 said "when ready build g4, g5 together". "Ownership transfer" therefore leaves the "Not included" list above. The rest of that list stands: a read-only `viewer` role, removing the original owner, email notice of a change and per-module custom permissions stay out.

Rules, decided by S1 (Conductor and Guardian) for the G4 build and binding on it:

- A workspace has exactly one owner at every moment. A transfer is an offer from the owner to one named active member of the same workspace. The offer holds 7 days. Only that member can accept it, and the owner can cancel it before acceptance.
- Acceptance happens in one transaction: the member becomes owner, the former owner becomes `admin`, and an append-only ownership history row records who, when, the command id and the reason. The member role history of this ADR records the role change. No row is deleted.
- The original owner grant's immutability is relaxed in one way only: the owner to admin change of the former owner, inside that transaction, after the acceptance row exists. Every other update, and every delete, of a membership stays refused. Zero owners or two owners at commit are refused and tested.
- The owner confirms archive and transfer by typing the workspace name, with a fresh provider session. Customers have no two-factor step today, so the screen never claims one (owner choice "Typed name + fresh sign-in (Recommended)").
- Known limit: the new owner cannot remove the former owner, who stays `admin`. A step-down needs a later reviewed change.

The capability ships as an optional module, closed by default, installed only by an owner-approved protected run.

## Amendment, 11 November 2026: leaving and removal end reads of workspace requests

Owner decision, 11 November 2026: "No, remove access (Recommended)" (answer verbatim; question paraphrased; ledger entry by S28). Requests and reports made in a workspace belong to that workspace; once a person is removed or leaves, they see none of them, including the ones they wrote. Items made outside any workspace stay theirs.

Scope line. The decision "Leaving acts on your own membership ... records the same revocation row the owner's revoke writes" stands and is now the single fact the rule reads: no revocation row for the member means a current member, a revocation row means not. The readers of this ADR do not change. Every principal-bound path that read a person's requests and saved reports by authorship alone now also requires that fact, as listed in the [ADR-033 amendment](0033-private-customer-request-authority.md#amendment-11-november-2026-a-removed-member-sees-no-workspace-request-fail-closed). Leaving still deletes nothing.

Consequences. The "Leave" confirmation words should tell the person that requests made in the workspace stop being visible to them (customer copy is the designer's and the owner's to approve; no copy is written here). Re-admission by a new invitation creates a new member row and restores access to requests that were not withdrawn or revoked. Erasure path, DECIDED by the owner on 11 November 2026: "Yes, add an erasure path (Recommended)", not built by the access fix (PR 410). It is built by erasure PR A and installed by the account lifecycle action; before that install the old state holds: A removed member cannot withdraw their former workspace request or start an erasure request reaching it. This widens ADR-078 gap 2. From that install a removed member who ever held a workspace can file the erasure request and staff can route and find it (a person who never held a workspace is still refused); withdrawing stays refused ("No, workspace decides (Recommended)"). See the [ADR-033 amendment](0033-private-customer-request-authority.md#amendment-11-november-2026-a-removed-member-sees-no-workspace-request-fail-closed) and ADR-078 decision 6.
