# Team desk v4.1: switch OFF audit

Document status: audit record, 25 November 2026. Read only: no application code changed.

**Verdict: OFF equals today's desk: yes** (no v4.1 element reaches the OFF desk and nothing new breaks; three small unscoped style rules differ, see R1; every defect below was already in the desk before v4.1).

## How it was checked

- Code: `origin/audit/v41-env` at `11f7b24` (main `40c5d9a`, which holds P5c `7e5dd73`). Local preview from `docs/revamp/audits/preview-env/` on port 3200, database `corridra_browser`, `serve.sh off` (`CORRIDRA_UX_TEAM_DESK_V41` unset), synthetic data only.
- Roles: owner, admin, operator (ordinary member), reviewer, viewer, helper. Widths 390 and 1440 for every role; owner also at 320, 720 (the same as 200% browser zoom at 1440) and with 200% text (root font size) on Today, Missions and one mission.
- Walk: every address the menu and the second row of tabs offer, every tab on each page, one mission page with its eight tabs, plus `/operator/owner`, `/operator/supply`, `/operator/supply/do-not-contact`, `/operator/problem-reports` and `/operator/inbox` by address. 59 page states for the owner, 56 admin, 44 operator, 37 reviewer, 30 viewer, 7 helper, at each width.
- Each state recorded: console errors, every 4xx/5xx, page width against the viewport, controls outside the viewport, overlapping controls, repeated headings and links in `<main>`, empty or error words, and v4.1 markers (`[data-menu="v3"]`, `.ux-team-menu*`, `.ux-desk-frame`, `.ux-desk-segments`, `.ux-desk-primary-slot`, `.ux-desk-lone-tab`, `.settings-head-desk`, and the 60 class names that exist only in CSS added since `c05b30c1^`).
- Regression check without a second preview: `git diff c05b30c1^..origin/main` (c05b30c1 is the first commit that names the switch) for CSS selectors and for the markup of each screen with a defect.

## What holds

- No v4.1 marker or v4.1-only class on any OFF screen, any role, any width. The menu is the old sidebar (Today, Missions, Companies, Meetings, Money, Admin).
- `/operator/inbox` answers 404 with the switch off, as designed, and no OFF screen links to it.
- No 5xx anywhere. No page-wide horizontal scroll at 320, 390, 720 or 1440 at normal text size.
- Role access matches the menu: owner sees Admin with People and access; admin sees Admin without it; operator, reviewer and viewer get no Admin; non-owners get "This page is for workspace owners and admins" on `/operator/owner`; the helper gets "Workspace access is unavailable" on `/operator` and keeps `/contributor`.

## Findings

Severity is for the person using the desk. "Before v4.1" means the markup and styles of that part are unchanged since `c05b30c1^`.

| id | screen | role | width | severity | what was seen | likely file |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Missions list (`/operator/missions`) | all staff | 320, 390 | high | The mission table is 406 px wide in a 342 px panel. Customer and Route columns shrink to about 32 px, so names print one letter per line, each row is about 550 px tall, the page is about 7,000 px long, and Owner, Due and Next action are cut off at the right with no way to scroll to them. Before v4.1. Screens `f01-missions-390.png`, `f01-missions-320.png`. | `apps/web/app/operator/missions.tsx` (table near line 882) and its panel styles |
| F2 | Today, "Needs you now" and "This week" | all staff | 1440 with 200% text | medium | With text at 200% the mission rows collapse to one letter per line (a three-row list becomes about 5,000 px tall), "This week" lines overlap their links and the account button drops below the top bar. At 720 (true 200% zoom) the page is fine. Before v4.1. Screen `f02-today-1440-text200.png`. | `apps/web/app/operator/operator-overview.css` (`.ux-needs*`), `apps/web/app/operator/today.tsx` |
| F3 | Today, "Needs you now" | owner | 390 with 200% text | low | Page scrolls sideways (409 against 390); the three mission rows run past the right edge. Before v4.1. | `apps/web/app/operator/operator-overview.css` (`.ux-needs`) |
| F4 | Today, Reports (`/operator/delivery`), Helpers (`/operator/network`), mission page | owner, admin | all | medium | About five minutes after sign-in the authenticator check lapses and these reads fail silently: `401 /api/workspace/problem-reports`, `401` (owner) or `403` (admin) `/api/workspace/customer-erasure-queue`, `401 /api/workspace/customer-service-requests`, `401 /api/workspace/customer-billing`, `403 /api/workspace/network-invitations`, `403 /api/picker/contributor`, `403 /api/mission-withdrawal`. Today then shows "Not available" on two tiles and drops "Also waiting" with no prompt to confirm the authenticator; each leaves a console error. A fresh sign-in clears all of them. Before v4.1. Screen `f03-today-stale-authenticator.png`. | `apps/web/app/operator/today.tsx`, `delivery.tsx`, `network.tsx`, `mission-withdrawal-note.tsx` |
| F5 | Mission page | reviewer, viewer | all | low | Every mission page load makes `GET /api/mission-withdrawal`, which answers 403 for these roles, so there is a console error on every visit. Before v4.1. | `apps/web/app/operator/mission-withdrawal-note.tsx` |
| F6 | Today tiles | operator, reviewer, viewer | all | low | "accepted quotes not started" and "paid-service requests to quote" always read "Not available" for these roles: two dead tiles of eight. Before v4.1. | `apps/web/app/operator/today.tsx` |
| F7 | Section pages by address a role may not open (seen: `/operator/settings`, `/operator/audit`, `/operator/controls`, `/operator/control-center` as operator; `/operator/network`, `/operator/assistance`, `/operator/operations` as viewer) | operator, reviewer, viewer | all | low | The page title stays the forbidden one ("Routes and settings", "Network") while the body shows Today. The only explanation ("This section is unavailable for your current workspace role or the link is outdated") is the last line of the lower right card, far from the title. Not reachable from the menu. Before v4.1. Screen `f06-member-settings-address.png`. | `apps/web/app/operator/workspace.tsx`, `apps/web/app/operator/operator-header.ts` |
| F8 | Health and Readiness (`/operator/health`, `/operator/readiness`) | operator | all | low | The menu hides the Admin group from an ordinary member, yet both addresses open and load (all reads 200). Either the menu or the page is wrong about who may see them. Before v4.1; owner decision. | `apps/web/lib/ux/team-map.ts` |
| F9 | Missions, Companies, Sources, Evidence, Settings, People and access | all staff | 390 | low | The page scrolls itself on load (258 px on Missions, 286 px on Companies), so the page title and part of the second row of tabs sit under the sticky top bar and the first thing seen is the workspace picker. Meetings and Money do not do this. Before v4.1. Screen `f05-companies-390-load-scroll.png`. | `apps/web/app/operator/workspace.tsx` (section focus effect) |
| F10 | Health, Audit, People and access, Operations, Sources and claims, Today | owner, admin, operator | all | low | The page title is repeated as a visible heading inside the panel ("Recovery and health", "Access and audit", "Workspace controls", "Global operations", "Sources and claims"); Today has an `h1` and an `h2` both named "Today". v4.1 hides these, OFF keeps them as before. | `apps/web/app/operator/operations.tsx`, `workspace-audit.tsx`, `workspace-controls.tsx`, `today.tsx` |
| F11 | Today, "This week" | all staff | all | low | "Open Meetings" appears twice with the same target (`#workspace-meetings`); lines are cut with an ellipsis at 390 and 1440 ("Synthetic buyer meeting wit..."). Before v4.1. | `apps/web/app/operator/today.tsx` |
| F12 | Meetings, Follow-up tab, Money Opportunities tab | all staff | all | low | Repeated headings with nothing to tell them apart: the same company name three times as card headings, "Follow the meeting plan" four times, "Evidence and accounting history" four times. Before v4.1. | `apps/web/app/operator/access.tsx`, `opportunities.tsx` |
| F13 | Reports (`/operator/delivery`) | all staff | all | low | Title says "Reports", the panel says "Client and programme delivery", and the tab sits under Meetings. Three names for one screen. Before v4.1. | `apps/web/lib/ux/team-map.ts`, `apps/web/app/operator/delivery.tsx` |
| F14 | Companies | all staff | 390 | low | "Search companies" label wraps into a 60 px column and the field shows a cut placeholder ("Company"). Before v4.1. | `apps/web/app/operator/counterparties.tsx` |
| F15 | Sources and claims | all staff | all | low | Each source is titled with a raw record id ("Mission intake 2db88616-465f-4935-...; notice synthetic-intake-2026-10-05-v1"). Before v4.1. | `apps/web/app/operator/workspace.tsx` (sources panel) |
| F16 | Mission page, Overview | all staff | 390 | low | Fact labels and values (Owner, Due, Route...) print as one run of same-weight lines, so label and value cannot be told apart; the `h1` is the word "Mission", not the mission's name. Before v4.1. | `apps/web/app/operator/[section]/[missionId]/mission-page.tsx` |
| F17 | Health, Operations | owner, admin | 1440 | low | "Loading Operations..." stays for 2 to 12 seconds on first load with only two thin lines of content under it. Resolves by itself. Before v4.1. | `apps/web/app/operator/operations.tsx` |

## Differences from the desk before v4.1 that reach OFF

| id | what | severity | file |
| --- | --- | --- | --- |
| R1 | Three style rules added during v4.1 are not tied to a v4.1 class, so they also apply with the switch off: on phones the main button of any `.ux-dialog .operator-form` is now sticky at the bottom and full width; `.reply-review-card h6` gets new size and weight; `.reply-review-columns` minimum column changed from `14rem` to `min(14rem, 100%)`. None caused a visible defect in this walk. | low | `apps/web/app/operator/[section]/[missionId]/mission-page.css` (line 267), `apps/web/app/operator/reply-review.css` |
| R2 | `.supply-head > .ux-kit-crumbs` rules also apply off; they only affect pages under Supply Sources that already had a breadcrumb. | low | `apps/web/app/operator/supply/supply.css` |

## Not covered

- Candidate records, helper interest, real billing, mail and notifications are empty in this preview (see the preview README), so their filled states were not seen.
- The comparison with the desk before v4.1 is by code reading, not by a second running build. Forms were opened but nothing was submitted.
- The preview turns on every other `CORRIDRA_UX_*` switch that `serve.sh` lists; a deployment with a different set may look different.
