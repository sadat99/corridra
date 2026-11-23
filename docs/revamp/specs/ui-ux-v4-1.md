# UI/UX.v4.1: instant-meaning amendment (owner decision, 23 November 2026)

Document status: CURRENT. A design amendment inside UI/UX.v4, named by the owner as UI/UX.v4.1. It is a design lock only. **Nothing in this file is built.** Every UI/UX.v4 rule that this file does not change stays in force. It is not UI/UX.v5.

## Owner words (verbatim)

- 23 November 2026: "nice. i liked proposed options, but i dont see self-explanatory things like flag etc, that gets visitor/users instant catch/understandings. like a flag makes quickest point than the name of of the country only"
- 23 November 2026: "nice. lock ir as v4.1" (the owner's spelling kept).

## What was reviewed

Side-by-side mockups, live site (captured 23 November 2026) against the proposal, with the live copy unchanged: [evidence folder](../evidence/owner-2026-11-23-v4-1/). They are design mockups with sample data. They are not screenshots of built code. Source pack: the UX/UI Upgrade Execution Pack of 21 November 2026, which stays a proposed plan and is not an authority over UI/UX.v4.

## Locked decisions (UI/UX.v4.1)

| ID  | Decision                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Instant meaning.** A place name always has its mark before it, by the existing flag policy: a flag for a sovereign state or the EU, the compass mark for a region, nothing for a contested place. Never a flag alone. Only the nine files in `public/flags`. Flags are 22 px inline and 40 px in route rows. |
| L2  | **One owned icon per choice.** Every choice row or card in a guided or public choice (job, goal, door) carries one `CorridraIcon` in a 42 to 44 px soft square (`--surface-subtle`, `--surface-selected` when chosen), beside its written label. No second icon family, no emoji, no icon-only control. |
| L3  | **Choice state.** A chosen row has a 2 px cobalt border, the `--ac-surface-selected` fill and a filled radio. An unchosen row has a hollow radio. One primary action per decision region, left aligned.                                                                                        |
| L4  | **Home.** Left aligned navy hero band, the live headline and copy unchanged, the reversed halftone mark uncropped, no decorative copper arc. The four choices sit below on the porcelain surface with flags and icons. One primary "Start a Request" below them.                                  |
| L5  | **Routes.** A numbered list in the owner's locked order (China, EU, UK, US, Australia, Key Asian Markets), a 40 px mark per row, the word Open, and one quiet "See This Route" link per row. No six boxed buttons.                                                                              |
| L6  | **Plan.** Goal rows with icons and the chosen state. "Your request" is a flat navy summary panel (no gradient). Step words unchanged.                                                                                                                                                          |
| L7  | **Start here.** "Plan a Mission" is the only primary button. The three "Already working with us" doors are equal cards, each with an icon and its own route.                                                                                                                                   |
| L8  | **Private link unavailable.** Warning left edge, lock icon, generic copy that leaks nothing about the introduction, one retry and one help link.                                                                                                                                              |
| L9  | **Contributor.** One "next step" card with one primary action. The page still says a customer account does not grant task access.                                                                                                                                                              |
| L10 | **Source stamp.** Where a screen shows a fact, a 12 px Geist Mono line with a small dot may give its source and date. It is a label, not a trust label, and the five trust labels stay exactly five.                                                                                           |

Constraints that hold for all of them: existing tokens only, copy exactly as live unless the owner approves wording, no gradient, glass, glow or copper text, every symbol keeps a visible word or the Explain rule, 44 px touch targets, reduced motion respected, no route, payload, id or permission changes.

## Not locked (each needs its own owner decision)

- The signed-in set: Customer Home, My Work, Workroom, Compare Offers, Operator Today, Owner gates, Delegation organiser. They were mocked up but not compared against live screens.
- **Decision Record**, a new export view of existing data.
- **Two on-navy text colours** (`#c7d3e3`, `#9db8f7`) have no token in `globals.css`. Until the owner decides on tokens, only `--on-brand` white is allowed on navy.
- A data-true halftone sphere, a confirmed-only relationship map, a read-only status link.
- A Singapore flag: the repo has none, and adding one is a flag-policy decision.
- Currency chips, time zone strips, holder marker shapes beyond the existing grammar, and every item under "Proposed direction, not locked" in the visual grammar section of [ui-direction.md](../../agents/ui-direction.md).

## Build route

Not part of this change. A later PR per screen, each behind its existing flag, with the screen checklist, the CI design guard, axe, and screenshots at 320, 390, 768, 1024, 1440 and 1920, as UI/UX.v4 requires.
