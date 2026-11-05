# Customer experience redesign

Document status: CURRENT.

This is the owner's request of 5 November 2026, recorded verbatim in the [UI direction](../../agents/ui-direction.md). It comes with screenshots of the live customer area in `docs/revamp/evidence/owner-2026-11-05/`. The target is an agency-grade finish within AC/1: same brand, tokens, fonts and icons, with far less noise. It builds on the [layout budget](layout-budget.md): left navigation, every page at most one desktop screen and two phone screens, and one to three fields per form step. Every revamp rule still holds: keep every action, link destination, element `id` and `name`, payload and test hook, and move rather than delete. English only. Art direction gets the owner's named review on before and after screenshots in each PR.

## What is wrong today (from the screenshots)

| Where              | Problem                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every page, chrome | About 300 px of chrome before any content: a header with three bordered buttons (Inbox, English, Corridra website), an eyebrow, a large title, an amber privacy banner and a tab row. Amber means caution, and this line is not a warning.                               |
| Home               | A six-step stepper with "NOT TRACKED YET" in mono capitals. An orphan "Open" button. Three tall cards under "Waiting on others", each repeating a "Corridra team" chip and an "Open" button.                                                                             |
| Requests           | The filter needs a separate "Show" button. Every row has its own "Open" button. Below the list sit links that repeat the Account page, a full Workspaces panel with an inline create form, and "Saved requests" repeating the same requests: four or more phone screens. |
| Companies          | A back link that repeats the navigation, a verbose empty state, and a "Refresh" button in an empty state.                                                                                                                                                                |
| Reports            | Three panels with three Refresh buttons. "Save an invitation", "Open an original shared mission invitation" and a paste field compete for the same job.                                                                                                                  |
| Account            | Repeats "Manage your work" from Requests. Mixes settings, tools and entry points ("Local helper tasks", "Start page") in one long column. Sign out sits in a card.                                                                                                       |
| Throughout         | Bordered buttons everywhere, mono capitals for states, several weights on one row, and the help dock overlapping content.                                                                                                                                                |

## Target

### Frame (all customer pages)

- **Left navigation:** the shared component (`components/ux/left-nav.tsx`) with Home, Requests (My Work), Companies, Reports (Results) and Account, in the locked names and order. "All tools" sits at the bottom of the bar.
- **Top bar, one row, slim:**
  - workspace switcher on the left (the context selector);
  - one primary "New request" on the right;
  - Inbox as an icon with an unread count;
  - an account menu holding name and email, language, "Corridra website", the privacy notice and Sign out.
  - No bordered text buttons in the header.
- **Owner-approved frame, 5 November 2026 (supersedes the header placement above from 1024 px):**
  - the left bar is fixed to the window edge with the brand at its top, the person's workspace card under it and, at its foot, Help and the signed-in person (initials, name, email) holding the same account menu;
  - the slim header over the content shows the page path ("Workspace / Home"), Inbox with its count and the one primary "New Request";
  - below 1024 px the header keeps the account menu and Help, and the bar is the drawer.
- **Page header:** a Newsreader title, at most one line of description, and the page's one primary action on the right. No eyebrow.
- **Privacy line:** "Your work stays private to the people given access" becomes a quiet line in the account menu and the footer, never an amber banner.
- **Help dock:** stays, but never covers content. Reserve its space, or move Help into the account menu on wide screens.

### Pages

| Page      | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home      | **Your move:** the one thing waiting for the person, or a calm empty line. **Active work:** up to five rows covering own work and work waiting on others, as one list with columns for title, kind, status, owner (You, Corridra team, a company) and updated. Each whole row is the link. **Stage:** shown for the newest request as a slim six-segment bar. A stage with no data is a plain grey segment, never "NOT TRACKED YET".                                                                                                                                                                                         |
| Requests  | **Sub-tabs:** Requests, Workspaces and Saved, all kept by `?tab=`. **Requests tab:** a segmented filter (All 6, Sell 2, Source 1, Organise 1, Other 2) that applies at once, no Show button. Rows link as above. The list is paginated so the page fits one desktop screen. **Workspaces tab:** a compact table (name, role, company link) with an overflow menu per row (New request, More, Manage team). "Create workspace" and "Join a workspace" open dialogs. **Saved tab:** the private saved requests, with their replies and reference on the request's own page. The "Manage your work" links move to Account only. |
| Companies | An empty state with an icon, one sentence and one action ("Manage company profiles"). No back link and no Refresh in an empty state. When companies exist, a list table.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Reports   | **Sub-tabs:** Delivered, Saved missions and Shared with me. A single "Open an invitation" action opens one dialog with the paste field, replacing the three competing controls. Data loads on open; one quiet refresh sits in the page header where a manual refresh is still needed.                                                                                                                                                                                                                                                                                                                                        |
| Account   | **A settings layout with sub-tabs:** Profile (name, email, verified state), Workspaces and team, Notifications, Plan and billing, and Security (sign out). **Tools and entry points:** "Plan a mission", "Check a request receipt", "Accept a team invitation", "Start page" and "Local helper tasks" move to "All tools", which stays reachable from the left bar.                                                                                                                                                                                                                                                          |

**Home, role-aware (owner-approved role mockup, 5 Nov 2026; built in Phase 2).** A switch (All, Sourcing,
Selling, Organising, each with its count, `?journey=`) filters what waits for the person. Each task carries its
journey tag under All. Three tasks show first and the rest are behind one control. What others hold sits in the
side column. One card per journey shows three numbers read from records the person can already open:

- **Sourcing:** current quotes, not comparable (the report page's own comparison engine, shared) and verified.
- **Selling:** companies shortlisted on the stage line, then visits proposed, confirmed and held.
- **Organising:** participants, meetings scheduled and qualified. "Not shared" is used where participants have not shared, never zero.

A "Taking part" card appears only after the person registers for a programme. Four journeys scroll sideways with
the fourth showing at the edge. No count of quotes needing evidence is shown; each quote card in the report shows
its own trust level. Read only. The places report is never called from Home because it records enrolments when
read. With work on the page, the three shortcut tiles give way to the "Start a Request" link in the card head;
"Check a Request Receipt" and "Open a Shared Mission" stay in All tools. Measured on 5 Nov 2026 with every role:
1.00 desktop screen and 1.91 phone screens.

Owner, 5 Nov 2026, approving the Source, Sell and Organise room mockups (desktop and phone), verbatim: "mockups
approved. finishi and continue finishing of v3 revamp 100% correct in alighnment with the latest decision".

**Work rooms (owner-approved mockups, 5 Nov 2026; Source built first in Wave 4).** Every room has the same
four parts:

1. A header: journey tag, route chip, title, received date and the named stage bar. The route chip is the
   brief's company country to its market, such as "Bangladesh → China".
2. One next step, with one main action.
3. The journey's views as tabs.
4. The open view.

What each room shows:

- **Source:** Overview, Compare Quotes, Evidence and Visit. Compare Quotes opens on the side-by-side
  comparison: one column per supplier (one card each on a phone) and prices in the currency quoted, never
  converted. The machinery obligations come first, and a missing term reads "Not stated". Each column shows
  how the quote is backed and the comparison engine's own verdict with its reason. The requirement, the
  shortlist, every offer, the cards and the original table stay one tap below.
- **Sell:** buyers and meetings.
- **Organise:** at a glance, plus what needs the organiser. The stage bar reads the invitations and consented
  registrations only, and a stage with no record is plain grey. The one next step comes from those counts. "At a
  glance" counts registered places, open invitations, ready participants (N of M), scheduled meetings and
  qualified held meetings. A count that cannot be given says "Not measured yet", and meetings no participant
  allowed to be counted say "Not shared", never zero. "Needs your attention" lists the projection's own flags:
  overlapping activities, activities to review after a date change, and participants not ready yet. Each flag
  opens the view that resolves it. The five groups of the programme consent spec (C-09) stay as the room's tabs.
  With the room on, the delegations page has its own tabs (Programmes, Templates, Pricing, Series and Exports, New
  Programme) and shows one programme at a time, chosen in a picker and kept in
  `?programme=` (an old `#<programme id>-<view>` link opens that programme). Measured: 1.00 desktop screen and 1.66 phone screens on the Overview.

The room reads the saved report once and adds no data. The page links stay on the Overview, and a stage with no
record is a plain grey segment. Measured with a BD-China sample: 1.00 desktop screen in every view and 1.13 to
1.58 phone screens.

### Components (shared, in `components/ux/`, reused by every track)

- Row-link list and table: the whole row is the target, with a visible focus ring, 44 px minimum rows, and status as a badge (a capsule is allowed for status only).
- Segmented filter: a radio group, keyboard arrows, applies at once, counts in tabular numerals.
- Sub-tabs, as in the layout budget.
- Dialog: focus trap, Escape, return focus, labelled.
- Overflow menu: a menu button, with roles, keyboard and Escape.
- Empty state: icon, one sentence, one action.
- Skeleton rows for loading, with no layout shift.

### Visual rules (AC/1)

- Button and action labels in Title Case (owner, 5 November 2026; see the UI direction), and actions aligned to the content's left edge.

- One primary (cobalt) action per view; secondary actions are quiet text or ghost buttons.
- Fewer borders: surfaces separate by porcelain and white tiers and the spacing scale.
- Mono only for references, ids and table heads, never for states.
- At most two weights per row.
- Copper is editorial only, never a banner.

## Required tests (S2, named by id)

| Id    | Case                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CX-01 | Every customer page is at most 1.0 screen at 1440 × 900 and at most 2.0 screens at 390 × 844, with the representative fixture (six requests, three workspaces).                                   |
| CX-02 | Action parity: every action, link destination, `id` and `name` from before is reachable after, through a tab, menu or dialog. This is a snapshot of ids, hrefs and button names before and after. |
| CX-03 | Header: no bordered text buttons. The account menu holds language, website, privacy and Sign out, and works by keyboard. Inbox shows its unread count to assistive technology.                    |
| CX-04 | Requests: the filter applies without a submit; each row is one link; tabs keep `?tab=`; old `#id` links open the right tab.                                                                       |
| CX-05 | Dialogs and overflow menus pass keyboard, Escape, focus return and axe at 390 and 1440.                                                                                                           |
| CX-06 | No amber banner, no "NOT TRACKED YET" and no mono capitals for state anywhere in the customer area. The help dock never overlaps an interactive element.                                          |
| CX-07 | Before and after screenshots at 390 and 1440 for every page go in the PR, for the owner's named review.                                                                                           |

## Order (S2)

1. Shell: left bar, top bar and account menu (L-01 and CX-03).
2. Home and Requests (CX-01, 02, 04).
3. Companies, Reports and Account (CX-01, 02, 05).
4. Forms at one to three fields per step (L-04).

Each is one PR, with tests failing first and a clean preflight before the push. New shared components land in the first PR that needs them, and the other tracks reuse them.
