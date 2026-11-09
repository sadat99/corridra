# Layout budget: left navigation, page length and form steps

Document status: CURRENT.

This is the build contract for the owner's decision of 4 November 2026, recorded verbatim in the [UI direction](../../agents/ui-direction.md). It runs before Wave 7 and Wave 8 and alongside Wave 6. Every revamp rule still applies: keep every action, link destination, element `id` and `name`, form payload and test hook. Hide or regroup, never delete. English only.

## 1. Navigation on the left (signed-in shells)

- **Customer, team and contributor shells.** A left navigation bar holds the shell's main destinations (customer: the locked five; team: the Signal Desk groups; contributor: its own items).
  - At 1024 px and wider it is always visible, 240 to 280 px wide, and can collapse to icons.
  - Below 1024 px it is a left drawer opened from a menu button in the header. The drawer traps focus while open, closes on Escape and on navigation, and returns focus to the button.
  - The current item has `aria-current="page"`. Every target is at least 44 px tall.
  - The team sidebar (PR 275) is the reference; the customer and contributor shells adopt the same component pattern.
- **Public pages** keep the existing top header. A left bar is not used for the marketing site.
- **Sub-tabs.** Anything that does not fit the page budget, or that is a secondary view of the same object, moves into in-page tabs.
  - Tabs use `role="tablist"`, are addressable as `?tab=<key>` so deep links work, and keep every existing section `id` reachable: an old `#id` link opens the tab that holds it.
  - Show at most five tabs, with any more under "More". Tabs are never capsule-shaped.

## 2. Page length

Measured as the full document height (header, content and footer) divided by the viewport height:

| Viewport   | Target      | Hard limit                     |
| ---------- | ----------- | ------------------------------ |
| 390 × 844  | 1.5 screens | 2.0 screens                    |
| 1440 × 900 | 1.0 screen  | 1.0 screen (owner, 5 Nov 2026) |

Public marketing pages (owner, 6 November 2026, verbatim answer: "Up to 2.0 / 3.0 (Recommended)"): every public page except the home page and `/plan` may be up to 2.0 screens at 1440 × 900 and 3.0 screens at 390 × 844, footer included. The home page keeps its own rule (owner, 6 November 2026, with the Ledger footer: up to 3.0 and 4.25, [public home](public-home.md)). The sign-in and account recovery pages (`/signin`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`) show the public footer and follow the public page limits. Every signed-in page keeps the table above. `/plan` has its own limit (owner, 9 November 2026, after the 2.0 and 1.0 limits proved unreachable with the page head and the footer on the page): at most 2.55 screens at 390 × 844 and 1.85 at 1440 × 900 and 1780 × 900, footer included, in the default state, pinned by `tests/browser/layout-budget-plan.spec.ts`. Measured on the production build: 2.53 and 1.80 (evidence in `docs/revamp/evidence/s13-plan-length/`). The owner's targets were 2.4 and 1.8; the phone stays above 2.4 because the test notice's availability sentence stays in view.

6 November 2026, About page (owner, verbatim choice: "A Editorial (Recommended)"): `/about` is one page with no sub-tabs, built to the approved Editorial mockup. The opening, who it is for and the six road steps show in full; the last three sections show their key line and keep the supporting detail behind a native Show Details. On a phone, why and what fold under their headings and the four kinds of work scroll sideways inside their own row. Every section `id` stays, and a link to one opens the disclosures that hold it.

- A page over the hard limit fails. Fix it with tabs, progressive disclosure ("Show more", accordions), a compact mobile footer (collapsed link groups) or tighter spacing within the AC/1 scale. Content is never removed.
- Statutory and legal text (privacy, terms) keeps every word. It is split into sections with an in-page contents list or tabs, plus a "Show the whole notice" option for reading and printing in full.
- Lists and tables page or load more after a fixed count, and never grow the page without limit.

## 3. Forms: one to three fields per step

- Each step shows at most three inputs. A group that a person answers as one (a date range, an amount with its currency) counts as one.
- Every multi-step form has:
  - a step title and "Step N of M";
  - one primary "Continue", with "Back" quieter;
  - inline errors that move focus to the first problem;
  - a final review step listing every answer with an "Edit" link to its step;
  - the draft kept as it is today (device draft or account autosave).
- Required fields are never hidden behind a disclosure. Optional fields may be.
- The payload sent is byte-for-byte unchanged. Each form gets a fixture test like P-11 that compares the request body before and after.

## 4. Global quality bar

- WCAG 2.2 AA: keyboard, visible focus, focus order, 44 px targets up to 768 px, contrast, reflow at 320 px, `prefers-reduced-motion`.
- Core Web Vitals on a production build at 390 with 4x CPU: LCP at or under 2.5 s, CLS at or under 0.1, INP at or under 200 ms. Record measured numbers only.
- Loading uses skeletons or status lines without layout shift. Empty, error, offline and denied states follow contract section 5. There is one primary action per view, and words stay plain.

## Required tests (named by id)

| Id   | Case                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-01 | Every signed-in shell shows the left bar at 1024 and 1440, and the drawer below 1024: open, focus trap, Escape, focus return, `aria-current`. Every existing destination and role rule is still reachable (parity guard).       |
| L-02 | Page length: every route in `docs/revamp/COVERAGE.json` that the track owns is measured at 390 × 844 and 1440 × 900 with a representative fixture. A page over its hard limit fails the test. The measured values are recorded. |
| L-03 | Sub-tabs: every moved section is reachable by `?tab=` and by its old `#id`. Tabs work by keyboard (arrow keys, Home and End), and axe is clean.                                                                                 |
| L-04 | Forms: no step shows more than three inputs. The step counter, the review step with edit links, inline error focus and the kept draft all work, and the payload fixture is unchanged.                                           |
| L-05 | Legal text: every word of the notice is still in the DOM, and "Show the whole notice" renders it in full.                                                                                                                       |
| L-06 | Core Web Vitals recorded for the track's top five routes.                                                                                                                                                                       |

## Ownership and order

| Track | Scope                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2    | The customer shell's left bar and drawer (`customer-nav.tsx`, `customer-shell.tsx`), customer page lengths and tabs, and customer forms (guided request, profile, companies, service requests).   |
| S3    | Public page lengths, the compact mobile footer, legal text sections, `/plan` steps re-cut to one to three fields, and the organiser room and programme forms.                                     |
| S4    | The page-length measuring guard shared by all tracks (`tests/ux/page-length.spec.ts`, which reads `COVERAGE.json`), the contributor shell's left bar, team page lengths and tabs, and team forms. |

Order:

1. S4 lands the measuring guard first, as a report with no failures, so every track sees the baseline.
2. Then each track fixes its own pages.
3. The guard switches to failing over the hard limit in the last of those PRs.

Each PR goes in only after a clean preflight. Any PR touching auth, session, tenant scope, consent, tokens or cookies says `Sensitive: yes`.
