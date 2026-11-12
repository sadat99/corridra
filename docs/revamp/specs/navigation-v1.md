# Navigation system v1: menus and navigation for every audience

Document status: CURRENT.

## Owner directive (6 November 2026, verbatim)

> "update all the menu and navigation section across the system except footer as per the design here 100% correctly, without damaging, orphaning anything https://claude.ai/artifact/LeWuzAw5QX9d4zqgCsv11y#page-dcb81aee8d83"

The design is the canvas "Corridra Navigation System". Its board sources are copied, unchanged, into [navigation-v1/](navigation-v1/) (`*.dc.html`, `canvas.json`). Read the board for your shell before you build. Images in the boards point at canvas uploads; the logo they show is the brand identity v1 lockup (see the brand identity PR and `docs/brand/` once merged).

The footer board (`Footer.dc.html`) is **out of scope**: the owner excluded the footer, which follows the owner's footer decision "A Ledger".

## The six rules (from the Architecture board)

1. **Top tasks first.** The thing most people come for is one tap away; rare things go deeper.
2. **Five at most.** Every level holds five items or fewer. More means regroup, not scroll.
3. **One word per thing.** Customers say Request. The team says Mission. Never both on one screen.
4. **Thumb first on phones.** Bottom tabs, always labelled, 48 px targets, no hamburger for daily work (signed-in shells).
5. **Search beats browsing.** Staff jump with Ctrl K. Customers search inside Requests and Companies. The 12 Nov request for a customer top-bar Search is specified in [customer search](navigation-v1/customer-search.md).
6. **Honest and local.** Bangla and WhatsApp are first class. Unfinished features say Coming soon.

## Audiences and boards

| Audience                   | Boards                                                             | Primary items                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public visitor             | `PublicHeader`, `PublicMobile`                                     | Desktop top bar (80 px): What we do (opens a panel with the six jobs and "Something else? Tell us your business goal"), How it works, Markets, Trust; language as a quiet control; Sign in; Start a Request. Phone: Menu sheet with the same groups, language chips, Sign in and Start a Request in a bottom bar. |
| Customer                   | `CustomerDesktop`, `CustomerMobile`, `UtilityMenus`                | Left sidebar on desktop, bottom tabs on phones: Home, Requests, Companies, Meetings, Reports. New Request button. Account, company profile, plan and billing, language, text size and help live under the avatar, so there is no More tab.                                                                        |
| Corridra team              | `TeamDesktop`, `CommandPalette`, `TeamSecondLevel`, `UtilityMenus` | Dark sidebar: Today, Missions, Companies, Meetings, Money; Admin group (owner and admin only): Health, Readiness, Audit, People and access, Settings. Route switcher and Ctrl K search in the top bar. Second level as sub-tabs (at most five); collapsible icon rail.                                            |
| Field helper (contributor) | `FieldHelper`                                                      | Phone only, bottom tabs: Today, Tasks, Messages, Me. Shows only what was shared with this person.                                                                                                                                                                                                                 |
| Owner and admin            | `TeamDesktop`                                                      | Inside Admin on the team sidebar, never in the daily path.                                                                                                                                                                                                                                                        |

## Binding conditions for every build

1. **Nothing is lost.** Every destination, action, element `id` and `name`, payload and test hook that the current menus reach stays reachable. Each PR includes a table: old menu item and route, new place (item, sub-tab, avatar menu, Admin group, command palette or a page link), and a test that every old route is still reachable from the new navigation. No route is deleted.
2. **Five at most per level.** Overflow is regrouped into sub-tabs or the Admin group, never a long list.
3. **Honest features.** Anything the board shows that does not work yet in this repository (for example WhatsApp help without a configured number, Data saver, Read aloud, Stronger colours, Less movement, Plan and billing, a search scope the backend cannot answer under the person's role) is shown as "Coming soon" or left out until it is real. Never a dead or fake control. A WhatsApp link needs an owner-supplied number in configuration; without it the item says Coming soon. Superseded by W10 in workflow-intelligence.md (owner, 10 Nov 2026) for Data saver and Stronger colours.
4. **Same access.** Navigation never widens access: an item a role cannot open is not shown, and the server still refuses. The Admin group renders only for owner and admin. The command palette searches only what the person's role may open.
5. **Words.** Customer screens say Request; team screens say Mission. Title Case for buttons; menu items as the board writes them. English only for new words (existing Bangla and Chinese code is kept; no reviewed translation is claimed).
6. **Accessibility and size.** 44 px targets (48 px for phone tabs), visible focus, `aria-current="page"`, drawers and sheets trap focus and close on Escape, no sideways scroll at 320, 390, 768 and 1440. Page-length rules are unchanged.
7. **Switches and gates.** The new menus replace the current ones under the existing UX switches. No switch, provider, payment, outreach, AI or migration change. D gates stay closed.

## Ownership and order (to avoid conflicts)

| Order | Session | Scope (files)                                                                                                                                                                                                                                                                                              |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | S1      | Brand identity v1 (logo, favicon, app icons, social images, manifest) from the owner's design-system package. It touches the logo lines of `site-header.tsx`, `ux/app-header.tsx` and `ux/shell-header.tsx`, so it lands first.                                                                            |
| 2a    | S1      | Public header and phone menu: `site-header.tsx`, `site-header.css` and the public header tests.                                                                                                                                                                                                            |
| 2b    | S2      | Customer shell and the shared utility menus: `ux/customer-rail.*`, `ux/customer-bar.*`, `ux/left-nav.*`, `ux/notification-inbox.tsx`, `ux/app-header.tsx`, `ux/shell-header.tsx`, the account, notifications, language and help menus, customer bottom tabs. S2 owns the shared files until its PR merges. |
| 2c    | S4      | Team shell and field helper: `ux/team-sidebar.tsx`, `ux/team-frame.tsx`, `ux/sub-tabs.*`, the new command palette, `ux/contributor-frame.tsx`. S4 does not edit S2's shared files before S2's PR merges; it consumes them, then adapts after merge.                                                        |

Each PR is Sensitive: no unless it touches auth, session, roles or a public unauthenticated route's behaviour (the command palette's search route is Sensitive: yes). Each needs exact-head green CI and a clean Codex receipt; S1 runs a Guardian review on any PR that changes what a role can reach.
