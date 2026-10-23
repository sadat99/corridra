# ADR 059: View-as preview for owners and admins

Status: accepted on 23 October 2026 by the owner's answer "yes to both, as long as safe" to `docs/product/phase0-view-as-proposal.md`. Stage 1 only. The ten decisions in that proposal were taken at their proposed defaults, listed below. Each later stage is a separate change.

## Decision

Owners and admins may open a read-only preview of what a customer sees, drawn from fixed sample content, in the real product frame. It is never a way to act as a real person.

Rejected, and still rejected: signing in as a person, borrowing a person's session, or showing a person's real data to staff. That would break ADR-020 (separate identity stores) and ADR-033 (no staff actor from customer proof), make every click a real action, and make the audit trail say a person did something they did not do.

## Rules

1. **Own switch.** `CORRIDRA_VIEW_AS_ENABLED`, exactly `true`, default off, independent of every customer flag. With it off the route does not exist (the plain not found page).
2. **Who.** Permission `viewas.open` for owner and admin only, with the existing fresh authenticator check (five minutes). Operators, reviewers, viewers, customers and contributors cannot open it.
3. **Always logged, and logged first.** The audit record is written by the database function `app.record_view_as_open` in the same transaction as the permission and authenticator checks. If the record cannot be written, nothing is shown. The record holds the shown role, the viewer's workspace role and a preview version. It holds no name, address, address of the device or content.
4. **Read only, in layers.** No server action, route handler or client script in the preview folder (a test fails if one appears). Any method other than GET or HEAD under `/operator/view-as/` is answered 405 before the application sees it. The sample content is inert: nothing can be clicked, focused or submitted. The page makes no network request of its own (checked in the browser). Its only link goes back to the workspace.
5. **Cannot be mistaken for a real session.** A bar above the content in the caution status colour, which is never used for an action: "PREVIEW AS CUSTOMER. Sample data. This is not a real account. Nothing here can be saved or sent." A diagonal "SAMPLE PREVIEW" mark, a page title starting "Preview:", no real name or email, no sign-out. Not indexed, not cached, no referrer.
6. **Same answer for every refusal.** A switch that is off, a role that is not built, no staff session, no permission and an unknown role all give the same plain not found page. The one exception is an owner or admin whose authenticator check is too old: they are told to verify again.
7. **Reads no person.** The preview reads no customer, delegate, supplier or mission row and starts no customer session. It adds no policy, grant, trigger or change to any existing function.

## Decisions taken at the proposed defaults

| Question                        | Decision                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Who may use it                  | Owner and admin                                                                                                           |
| Allowed in production           | Yes, off by default                                                                                                       |
| Authenticator window            | The existing five minutes                                                                                                 |
| Which role first                | Customer. Delegate and supplier are refused, and not logged, until built                                                  |
| Content                         | Inert at first                                                                                                            |
| Viewer's name on the page       | Not shown                                                                                                                 |
| Audit function                  | One additive database function, installed by the owner-run workflow with `view_as_action = install`                       |
| Refused attempts                | Not logged in stage 1. The page answers with the same plain not found. A reason-only application log line is a later step |
| Which screens count as supplier | Not decided. Stage 4                                                                                                      |

## What stage 1 contains

The switch, the permission, the database function and its installer input, a service that opens a preview, the method gate, the customer preview with fixed sample content, and tests: a real-database denial matrix (every role, no session, other workspaces, a stale authenticator check, direct calls to the function), source checks on the preview folder, and an operator browser journey (marked, inert, logged on every open, no network, axe at three widths).

Stage 1 is reached by address only (`/operator/view-as/customer`). No link to it is added to the workspace yet.

## Not in stage 1

Real components and data answers (stage 2), delegate (stage 3), supplier (stage 4), shared sample data with tests (stage 5). A path-scoped content security policy is not added: stage 1 has no form or script to restrict, and how Next merges two header rules for one path is not confirmed.

## Rollout and rollback

Install the database function with the owner-run workflow (`view_as_action = install`). Installing shows nothing to anyone. Set the switch to open the route. Rollback: unset the switch. The audit records stay; they are append-only and hold nothing private.

## Consequences

An owner can see a customer screen without any real person's data or session, and every open is on the record. The cost is one new permission, one function and one route family to keep in step with the real screens, which later stages address by sharing page bodies.
