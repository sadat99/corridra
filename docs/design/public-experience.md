# Public experience and design system

Part 02 uses the supplied public-experience document and positioning constitution. Their source and working copies remain unchanged. Published copy keeps the approved job framing and evidence semantics, adapts operational promises to clearly identified planned capabilities, and removes em dashes. No invented results, contacts, testimonials or coverage appear.

## Components and tokens

`apps/web/app/globals.css` defines paper, ink, muted, accent and line colours; local serif and sans-serif stacks; shared spacing, focus rings and reduced-motion behavior. Header, footer, corridor illustration and solution-page layout are reusable components. Content in `apps/web/content/public-pages.ts` remains server rendered. Only the navigation disclosure needs custom client state; Next.js supplies link navigation. Prefetch is disabled to avoid requesting unused route content.

The visual sequence is objective, path, relevant company and outcome. Native fonts and an inline corridor illustration avoid third-party font or image dependencies. Solution cards, numbered process steps, detail cards, primary actions, text links and forthcoming field styles share the same tokens. Field focus and invalid states are defined for Part 04; this release has no input fields or submission forms.

Evidence labels are explained as statuses, without applying them to invented company records: self-declared, evidence available, verified, derived and outcome observed. Verification still requires a defined process. Supporting material alone is not verification.

## Route acceptance criteria

| Route             | Visitor can understand                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `/`               | Category, four jobs, planned process, initial corridor, evidence distinction and commercial progression |
| `/sell`           | Before, during and after a visit; qualification beyond attendee lists; no promise of orders             |
| `/source`         | Requirements first, shortlist evidence gaps and purposeful factory visits                               |
| `/enter-market`   | Relevant relationships, market validation and local follow-through; initial corridor limits             |
| `/trade-missions` | Participant objectives, qualified agendas and reporting after a delegation                              |
| `/how-it-works`   | Eight planned stages from intent through observed outcome                                               |
| `/network`        | Task scope, evidence, eligibility, reward terms and relationship attribution; participation not open    |
| `/institutions`   | Programme objectives, agendas and distinct commercial outcomes; relationships retained                  |
| `/trust`          | Five evidence statuses and the limits of AI authority                                                   |
| `/about`          | Purpose, initial corridor and current availability without invented company history                     |
| `/plan`           | Five-step test intake with private status/reply receipts; real customer briefs remain gated             |
| `/signin`         | Live operator sign-in with invite-only identities and real MFA when foundations are enabled             |
| `/coming-soon`    | Original Part 01 launch content remains accessible with the shared public navigation                    |

Every route has one main landmark and heading, meaningful metadata, a skip link and real navigation destinations. No legal pages or legal contact details are fabricated; approved notices must ship before the corresponding data workflow.

## Navigation and accessibility

Desktop solutions use a native disclosure. Narrow screens use an expanded-state menu button, followed by the same job-based navigation. Escape closes disclosures and restores focus. Focus leaving the header closes the menus. Link navigation closes the mobile menu. Hidden navigation cannot receive keyboard focus. Navigation expands in document flow rather than covering or trapping page content.

Browser acceptance checks cover desktop and mobile routes, keyboard skip links, Escape, touch activation, a 320px menu, reduced motion, horizontal overflow, JavaScript errors, internal link resolution, no external assets and axe WCAG A/AA rules through 2.2. Automated checks do not establish complete WCAG conformance; manual keyboard and visual checks supplement them.

Performance budgets are mobile Lighthouse >=90 and accessibility >=95. Field targets, once real traffic permits measurement, are p75 LCP <=2.5s, INP <=200ms and CLS <=0.1. Lab scores cannot establish field performance or INP.

Part 04 adds /privacy with the dated test intake notice. Public availability copy distinguishes operational test intake from customer mission delivery. Anonymous files and phone numbers are not collected; optional catalogue links are recorded without fetching.
