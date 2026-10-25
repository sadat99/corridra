# Corridra UX charter

**Document status: CURRENT.** Applied as governing for UX work through the owner's delegation of 24 October 2026 (section 0 of the [corrected plan](ux-update-plan-corrected-2026-10-24.md)); the owner has not signed it separately. The V3 contract, product vision and UI direction still govern it. See the [plan status register](../PLAN_STATUS.md).

Status: proposed on 24 October 2026, for the owner's approval. It sets the structure, the principles and the boundaries of the UX revamp. It does not set screens, counts, step names, file lists, build order, language lists or dates. Those change, and they live in dated plans such as [the verification record](ux-update-plan-verification-2026-10-24.md).

Authority: the [V3 contract](../V3_CONTRACT.md), the [product vision v2.1](corridra-product-vision-v2.1.md) and the [UI direction](../agents/ui-direction.md) govern. This charter applies them and never overrides them. Where the charter needs a locked rule in UI direction to change, UI direction is changed first, with the reason and the owner's approval, as that file requires.

## 1. Purpose

Express the whole system, and everything it grows to include, so that a person reaches the commercial result they came for faster. Presenting means ordering, explaining and connecting. It never means removing. The contract's release test applies: a redesign that only moves complexity to another screen fails.

## 2. The shape

The shape is fixed. The names are labels the owner chose on 24 October 2026 and can change in one place if testing shows a label does not read.

| Layer      | Job                                                                                                                          | Fixed rule                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Front door | One landing per audience. It shows what needs the person now, then where each piece of work stands.                          | Next action first. Only real items whose state the person may read. An honest empty state when nothing waits. A way to start a new request is always present.                                        |
| Road       | Where one piece of work stands.                                                                                              | Drawn from real status only. A step with no data reads "not tracked yet", never "done". A legal change of status never moves the marker backward.                                                    |
| Lenses     | Depth on one piece of work. Each lens answers one kind of question: compare offers, check evidence, plan a visit, and so on. | A lens is added only when a new question appears that two or more capabilities share. Every lens keeps trust labels, original currency, original language and source in view.                        |
| Areas      | Standing collections: missions, companies, the library, programmes, service requests, billing.                               | At most five per audience. The rest sit under More.                                                                                                                                                  |
| All tools  | The complete index of everything the person may reach, each with a plain verb.                                               | Generated from the route list. A test fails when a customer page is neither listed nor excluded with a written reason. Nothing is ever unreachable.                                                  |
| Reach      | Language, read aloud, accessibility, email, the sample or real label.                                                        | Each reach feature opens only after its recorded review: a language after a native reviewer, email after the owner's privacy review, a sample or real label always telling the truth for the tenant. |

## 3. Principles

| #   | Principle                                                                                                                                                                                                                                                                                              | Source                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Express, never shrink. Hide, never delete. Reduce load by order, grouping and folding. Every panel stays mounted and every action stays reachable.                                                                                                                                                     | Contract section 5; UI direction, cognitive load rule 5                |
| 2   | Truth first. Every state, date, holder, count, rank and urgency comes from real data. Unknown shows as unknown. A control with no working backend is marked missing.                                                                                                                                   | Contract section 7 law 6; UI direction, content rules                  |
| 3   | One job per screen. Next action first. At most five choices at any level.                                                                                                                                                                                                                              | V3-07-018, V3-07-019                                                   |
| 4   | Money path first. Order content along request, qualified mission, introduction, meeting, outcome, fee.                                                                                                                                                                                                 | UI direction, cognitive load rule 6                                    |
| 5   | Plain words for a global reader. One word per idea. The five trust names are fixed. A figure of speech is explained at first use and translated by meaning, never word for word. Use the real role (buyer, supplier) in interface text. Names, Chinese text and original amounts are never translated. | UI direction, plain language and glossary                              |
| 6   | Authority does not move. Navigation never changes permissions. Customer, staff and contributor identities stay separate. One tenant never sees another's data.                                                                                                                                         | Contract section 5, V3-05-055                                          |
| 7   | Reuse before invention. Use the owned parts (customer shell, journey bar, next-step card, fact label, icon family) and the existing engines (comparison, mission status) before building another. A new part needs a new job.                                                                          | UI direction, consistency rules; vision section 23                     |
| 8   | Off until reviewed. Every new capability sits behind its own server-read switch, default off, with a plain label on the owner switch list. With all new switches unset the product behaves exactly as main does. Designed, built, enabled and live are different states.                               | Contract section 8                                                     |
| 9   | Measured, not claimed. Each change records its scroll budget and accessibility result, and names the objective measure it should move. No multiplier claim ("10x", "100x") is made without measurement against an agreed baseline. Targets are agreed by the owner before any improvement is claimed.  | Contract section 7 (last bullet) and section 9, objective measurements |

## 4. Boundaries

No UX change may cross these lines.

- Gates D01 to D06 and D08 stay closed: no real outreach, payments, payouts, production AI inference, billing activation or real-file processing.
- Corridra is not a travel, hotel or visa service (vision sections 6 and 20; contract section 8). Trip features show the commercial itinerary: meetings, visits and programme days. They do not book, sell or advise on flights, hotels or visas.
- The four money domains never mix. Customer trade value is never shown as Corridra revenue. The original currency is always visible.
- Evidence keeps its five trust names, their plain lines and their distinctions. "Verified" appears only when it is true.
- Legal, privacy and consent text changes only after the owner's review.
- Migrations are additive and need an ADR first. For auth, row-level security, money and event records the blast radius is stated before any change.
- No new dependency without the owner's written approval.
- Shared files (the ledger, the owner switch list, the header configuration, the documentation map) have one writer or fixed rules, so parallel work cannot collide.

## 5. How any capability finds its home

The system keeps growing. This rule keeps the UX aligned without waiting for a plan revision.

Whoever meets a route, module, switch, status, message or document that the current plan does not place does four things.

1. **Flag it.** Name it, give the file path that proves it exists, and say what is unplaced. Put it in the pull request description and in the "unplaced" list of the current verification record. Tell the owner in the report.
2. **Place it by default** with the table below. A default is a proposal about labels and position only. It is reversible and changes no data and no permission.
3. **Guard it** with a test that fails when a new item has no home (list below).
4. **Record it.** The placement stays "proposed" until the owner confirms it.

| If the capability...                                                         | Its home                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Asks something of the signed-in person now, and the source state is readable | A front door card                                                          |
| Shows how one piece of work is progressing                                   | The Road and the message strip                                             |
| Answers a question about one piece of work                                   | A lens (an existing one first)                                             |
| Is a standing list of records                                                | An area. If the audience already has five, it goes under More              |
| Is a setting, account, billing, legal or privacy page                        | More                                                                       |
| Belongs to a delegation or programme                                         | The programme room for the organiser, the participant's own view otherwise |
| Is a response from someone outside the app (supplier, buyer, bank)           | A no-registration page with an expiring, revocable link                    |
| Is for staff only                                                            | The operator areas, never the customer navigation                          |
| Fits none of these                                                           | All tools only, flagged for the owner                                      |

Guards. A customer page with no All tools entry (to add). A switch with no label (exists: the owner page test). A mission status with no Road position (to add: an unknown status shows as a plain status line with no marker). A fact shown without a trust label (reviewer check). A new screen with no scroll budget class (pull request check).

## 6. What every change shows

This restates the contract's per-PR acceptance for UX work.

- The requirement IDs it touches, and the original and destination paths.
- A parity table: action, route, component, service, permission, test. Nothing a user can do today is reduced.
- Switch off equals main, proved by the existing suites run unchanged.
- The four states: loading, nothing here yet, something went wrong, no internet.
- Scroll budget measured on a production build at 390 and 1440 wide, in the default state with every disclosure closed.
- Axe clean at the standard widths, keyboard walk, 200 percent text zoom, reduced motion.
- The words check against the glossary, and the flags raised under section 5.
- Remaining gaps and blockers, stated exactly.

## 7. Tying the UX to the objectives

The contract asks five questions. Each has a place in the shape and a measure to agree before any improvement is claimed.

| Question                                   | Where the UX answers it                | Measure to agree (contract section 9)                                                |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| Who should we do business with?            | Compare lens, companies area           | Quality of qualification; time to first useful result                                |
| Why are they relevant and credible?        | Evidence lens, trust labels            | Share of shown facts that carry a trust label; supplier response quality             |
| How can we meet or engage them?            | Visit lens, reply page, programme room | Meetings actually held; time from introduction to reply                              |
| What must happen for business to progress? | Front door, Road                       | Ability to resume unfinished work; task completion and error rate; navigation effort |
| What results did we actually achieve?      | Library and closing records            | Commercial progress recorded; repeat use                                             |

New modules reach people through the same shape. Billing, programmes, service requests, the Corridra Network and later modules each get a front door card when something waits on a person, a place in an area, a lens when they answer a question about one piece of work, and an All tools entry.

## 8. What this charter leaves open

Screens and layouts, label names, step lists, counts, the language list and its order, build order, lane structure and dates. A dated plan may change any of them without changing this charter, as long as it respects sections 2 to 5.
