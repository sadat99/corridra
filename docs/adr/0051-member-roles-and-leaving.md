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
