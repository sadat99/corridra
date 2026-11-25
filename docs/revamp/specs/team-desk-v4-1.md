# Team desk in UI/UX.v4.1: fixes first, then the frame and the screens

Document status: CURRENT. Owner-approved plan (24 November 2026). Built behind CORRIDRA_UX_TEAM_DESK_V41 (phases 1 to 5, PRs 635 to 646, 24 November 2026); owner switch pending.

Written 24 Nov 2026 against main `b4d43f1`. Built from the code and from a read of the live database, not from other plans. Every fact below was read in the repository or the database; items under "Not verified" were not. If the Authority Brief of a later run contradicts a fact here, the repository wins and the run says so.

## 1. Owner words (verbatim, all 24 November 2026, first hand in session_0187kU9t1DZMxeSzwuwRqc8A)

- On the three outside QA pages: "investigate 100% correctly"; then "I need u to dig deeper and find out the reality, then we will move to fixing upon review".
- Permission for the database read: "read live" (counts, dates and short ids only; no customer text; nothing written).
- On the proposed screens: "i like the screens and their boundaries etc, over our current raw stuffs like a link on white page, mispositioned and random, etc."
- On how far to follow them: "the person who provided this doesn't have 100% context, so u must conisder the proposal, take inspiration and adopt to maximum possible extent."
- On scope: "we need to align with v4.1, and what we updated in last 30 PRs, but definitely fixing all that still issue".
- On the five choices: "all recommended options in desk choices. finalize the updated plan effectively first."
- On starting: "merge the plan and start phase 1." and "implementation shall be done via existing Corridra Guardian as per its policy". The answers to the three questions are in section 9.

UI/UX.v4.1 lists the signed-in set, Operator Today included, as not locked. The last line above is the owner decision for the team desk. It is added to "Current locked decisions" in `docs/agents/ui-direction.md` by the PR that ships the first visible unit (D3), not by this plan.

## 2. The five decisions

| No  | Decision                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Menu: four visible groups.** Work, People and companies, Results, Admin. Every place is one click away. No second level and no second tab bar. Replaces the five-group desk approved on 20 Nov 2026.  |
| 2   | **Words: keep Missions and Quotes.** Mission is a brand word. "Request" stays the word for what the customer sent. Tabs keep Quotes, Replies and Delivery.                                              |
| 3   | **Route and qualification stay two steps.** The qualification form shows the route state. It never requires a route.                                                                                    |
| 4   | **Actions open in the centred dialog** of the shared kit (PR 611), with the authenticator check in place (`StepUpDialog`). No right-hand panel.                                                         |
| 5   | **One Inbox in the menu** for problem reports, erasure requests, programme applications and helper interest. No count in the menu until the fresh authenticator check those lists need has been passed. |

## 3. What was proven

- **Begin Qualification fails in every real workspace.** Reproduced on a local database with the real-use fixture: the same staff member saves "Update ownership and next action", then "Begin qualification" is refused with `42501 new row violates row-level security policy for table "source_record"`. Cause: `apps/web/app/api/workspace/[action]/route.ts:36` always sends the sample purpose, `withTenant` swaps it for the workspace's real purpose in the session, and the qualify step writes its source record and claim with the unswapped `ctx.purpose` (`packages/missions/src/index.ts:414` and `:423`). With the purpose the tests pass, the step saves, and Activate and Begin Targeting save after it.
- **Why CI missed it.** `tests/integration/real-staff-fixture.ts:42` passes the real purpose directly, so no test goes through the purpose the website sends.
- **Why the message says nothing.** The route maps every `42501` to "Access denied" and logs nothing (`route.ts:370-381`).
- **Live, workspace "Corridra request operations":** 11 missions, all `DRAFT`, all owned by one member who also belongs to a sample workspace; six are 22 to 31 days late; ten are still at version 1. One route (`AL>AU`), no route pack, no route assignment. The company table holds 8 records, all Spain, all flagged sample, created 5 to 9 Oct 2026. The table `customer_private.real_intake_owner_version` does not exist, so the owner switch of PR 607 was never installed. All five active members have the real purpose, the INTERNAL class and a matching country, so membership is not the cause of the refusal.

## 4. Preserve (every unit)

Addresses of all seventeen places and the mission page; element `name` and `id`; form payloads; role gates and the test that holds the union of places per role equal; the fresh authenticator rule and its permission list; RLS and tenant isolation; the five trust labels; exact money; immutable history; closed real-payment gates. No control without a working backend. Copy as live unless a unit names the change.

## 5. Units

Phase 1 changes no layout and needs no switch. Phases 2 to 5 sit behind one new switch, `CORRIDRA_UX_TEAM_DESK_V41`, off by default, so the live desk does not change until the owner has seen each phase. The run pauses for the owner's review after each phase.

### Phase 1: make the path work

| Unit | Class | What                                                                                                                                                                                                                                                                                                              | Files                                                                                                                                      |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1   | A     | Qualify writes under the session's processing purpose. Test first: a real-workspace test that sends the website's purpose and fails on today's code. Same defect in `packages/auth/src/operator-invitation.ts:93` (open in the ledger). Check `packages/auth/src/bootstrap.ts:84` the same way and fix or record. | `packages/missions/src/index.ts`, `packages/auth/src/operator-invitation.ts`, `packages/auth/src/bootstrap.ts`, `tests/integration/**`     |
| D2   | B     | A refusal says what to do and carries a reference; the server logs the code with the correlation id. No database text reaches the page. Mission forms use `withStepUp`, so the code is asked in place and the form is kept.                                                                                       | `apps/web/app/api/workspace/[action]/route.ts`, `apps/web/lib/staff-db-error.ts`, `apps/web/app/operator/missions.tsx`, mission page files |
| D2b  | B     | Words and order: the plain stage label where the shortlist chooser shows raw `DRAFT` (`counterparties.tsx:1074`); helper and assigned work on the Network screen (`network.tsx:476, 516, 926`, `contributor-invitations.tsx:161`); the country list sorted by name (`country-options.tsx`).                       | Those files and their tests                                                                                                                |

Live steps, each only on the owner's word, prepared completely beforehand: install the owner switch (PR 607) and run it; reassign the 11 missions; create the launch routes and one reviewed pack each; retire the 8 sample companies and the `AL>AU` route with the report step of PR 612. Old "Review submitted brief" text is stored data and clears on reassignment.

### Phase 2: the frame

| Unit | Class | What                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D3   | A     | Menu v3 in `lib/ux/team-map.ts` and `components/ux/team-sidebar.tsx`. Work: Today, Missions, Meetings, Inbox. People and companies: Companies, Helpers, Supply. Results: Money, Reports. Admin: Team and access, Settings, Status. Navy sidebar, owned icons (PR 615), the sidebar scrolls with the page. Workspace switcher at the top of the menu; Help and Sign Out in the avatar menu; the scanning line moves to Status. Second tab bar removed. |
| D4   | B     | One page pattern from `PageHeader`, `PageFrame` and `SubTabs`: serif title, one purpose line, one primary action, segments under the title. "Jump to" chips and mono eyebrows (OPS HOME, CONTROLLED ACCESS, TEAM WORKSPACE) removed. Pages open at the top.                                                                                                                                                                                           |

Where the seventeen places go: Sources and claims and Evidence review become segments of Companies; Operations, Dashboard, Health and Readiness become segments of Status; Audit and People and access become segments of Team and access; Assistance, Control Center and the owner page sit under Settings; Network is shown as Helpers. Every address stays.

### Phase 3: the daily path

| Unit | Class | What                                                                                                                                                                                                                     |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D5   | B     | Today: "Needs your decision" and "Waiting on others", late pill, short reference (RQ-000001, PR 617), one primary Review in the region and quiet ones after it. The headline says what to do, never "at least".          |
| D6   | B     | Mission page: the existing `StageBar` (same marker as the customer's Road), one "Next step" card with one primary action, a read-only "What the customer sees" panel. One primary button, not two.                       |
| D7   | B     | Each action opens in the centred `Dialog` with only its fields, a one-line statement of what changes and what the customer will see, the route state shown (decision 3), the code check in place, the reason on refusal. |

### Phase 4: inside a mission

| Unit | Class | What                                                                                                                                                         |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D8   | B     | Quotes: what the customer asked for beside the replies to review. Ask, Publish and Reject only where the reply-review backend supports them today.           |
| D9   | B     | Replies: one timeline the customer can read, one message box. The delegation block shows only on programme missions; its address under Reports is unchanged. |
| D10  | B     | Add companies: the mission is preselected from the address and named at the top; each company needs its reason. Record names shown short, ids hidden.        |

### Phase 5: the rest

D11 Meetings as five columns that stack on a phone, columns equal to real statuses, the note written for outreach open in test mode (PR 620). D12 Money as five figures then the list. D13 Reports as one list with status. D14 Helpers with an example task in the empty state. D15 Status. D16 Team and access. D17 Settings with routes first and their pack state; no line saying qualification needs a pack. D18 Inbox (decision 5). D19 Supply on the shared header. All Class B; a unit that meets a Class A trigger stops and says so.

## 6. Proof for every unit

New tests fail on the old code. Checks through `node scripts/gate.mjs`: format:check, lint, typecheck, test, test:integration for D1 and D2, build, test:e2e, test:operator for visible units. Visible units: screenshots at 320, 390, 768, 1024, 1440 and 1920 with the switch off and on, axe clean, the design guard and the v4.1 guard with no baseline raised, and the "Definition of done for any visible change". D1 and D3 take the Class A review route and state their rollback.

## 7. Not verified

- Which switches are on in production. The QA screenshots show the five-group desk, which suggests `CORRIDRA_UX_OPERATOR_DESK` is on; it was not read.
- That the reply-review backend offers Ask, Publish and Reject as D8 draws them; that meeting statuses map to five columns; that the shortlist form already stores a reason.
- The reported name-case difference between the Missions list and the mission page (OP-12). No `text-transform` was found on those screens; it may be stored data.
- `packages/auth/src/bootstrap.ts` in a real workspace.
- Any signed-in pass on the live site. The three QA pages were read; their live observations that the database could not confirm stay the author's word.

## 8. Coordination

A Guardian run is live on this repository (the commercial-ready run; Guardian 42 at the last work-log entry). It owns the ledger, the work log and the lanes table, and its units have touched `app/operator/**`. Units here start only after that Guardian places them in the lanes table. This plan adds no ledger or work-log entry of its own.

## 9. Owner answers (24 November 2026, verbatim, first hand in the same session)

The three questions were asked once, together. The owner's message: "merge the plan and start phase 1."

1. Which launch routes get a route pack first, from Bangladesh: "China, EU, UK, US". Australia and Key Asian Markets follow later.
2. Where real companies come from before launch: "Staff Research." No import is planned for launch.
3. Who owns the 11 live missions once the owner switch is installed: "Whoever is needed." The Guardian proposes the owner per mission when it prepares that live step.

On who builds: "implementation shall be done via existing Corridra Guardian as per its policy". Section 8 stands: the live Guardian places, launches, reviews and merges every unit.
