// Words of the home page v4.3, first half: hero, route choice, solutions, worked example and how it works.
// Owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly" (docs/revamp/specs/ui-ux-v4-3.md).
// English only. No translation has been written or reviewed, so every other language shows these English words
// (home-words.ts spreads them into the one English block and `inEveryLanguage` lays each language over it) and no
// screen claims a translation. A missing or empty entry shows English, never blank (ADR-066, ADR-074). Native review
// stays OPEN (docs/product/language-review-record.md).
//
// Rules for every value here:
// - A place is a slot, never written: {bd} {cn} {eu} {gb} {us} {au} {asia}. components/place-words.tsx draws each
//   with its mark and its name from the existing keys (home.country.*, home.tr.mk.*).
// - Title Case for what a person presses (button, button-styled link, text action, menu item); sentence case for
//   headings and questions.
// - No brief, draft, synthetic, contributor or operator word (owner, 23 Nov 2026; tests/vocabulary-guard.test.mjs).
//   The pack words became: request, summary, plan, agendas (listed in the v4.3 record).
// - Straight apostrophes, no em dashes. Amounts are invented, USD as written, never converted.
export const homeV43En = {
  // Hero
  'home.v43.hero.title.a': 'Find the right',
  'home.v43.hero.title.b': 'business partners.',
  'home.v43.hero.lead':
    'Source products or machinery from {cn}, meet buyers abroad, or organise a business delegation. Corridra helps you check who fits, set up the right meetings and follow through.',
  'home.v43.hero.start': 'Start a Request',
  'home.v43.hero.example': 'See a Worked Example',
  // The note inside main for a visitor without scripts
  'home.v43.noscript.lead': 'The on-page examples and route explorer require JavaScript.',
  'home.v43.noscript.start': 'Start a Request on Corridra',
  'home.v43.noscript.or': 'or',
  'home.v43.noscript.routes': 'View Routes',

  // Route choice (the legend is the existing home.tr.q)
  'home.v43.q.sub': 'Choose what you need. The example and request will update to match.',
  'home.v43.q.note': 'Explore freely. Review your request before you send it.',
  'home.v43.brief.go': 'Build My Request',
  'home.v43.door.china.title': 'Source from {cn}',
  'home.v43.door.china.line': 'Products and machinery',
  'home.v43.door.sell.title': 'Sell abroad',
  'home.v43.door.sell.line': 'Buyers and distributors',
  'home.v43.door.delegation.title': 'Organise a delegation',
  'home.v43.door.delegation.line': 'Business meetings and visits',
  'home.v43.door.other.title': 'Another goal',
  'home.v43.door.other.line': '{bd} entry or a different route',

  // The one polite announcement (fix walk m5): a door choice, then the short answer of a widget action
  'home.v43.live.door': '{route} chosen. The example, steps and request now follow it.',
  'home.v43.live.chosen': '{item} chosen.',
  'home.v43.live.shown': '{item} shown.',

  // Solutions
  'home.v43.sol.eyebrow': 'Solutions',
  'home.v43.sol.title': 'What Corridra can do for you.',
  'home.v43.sol.lead': 'Choose a focused assignment or get help running the whole programme.',
  'home.v43.sol.get': 'What you can get',
  'home.v43.sol.source.text':
    'Find manufacturers, check their fit against your specifications, compare quote terms and plan what to inspect on factory visits.',
  'home.v43.sol.source.get':
    'A supplier shortlist, a side-by-side quote comparison or a visit plan.',
  'home.v43.sol.source.go': 'Explore a Sourcing Example',
  'home.v43.sol.sell.text':
    'Find buyers or distributors who fit your offer. Check category fit, buying authority and timing. Arrange targeted meetings at a fair or on a separate trip.',
  'home.v43.sol.sell.get': 'A buyer shortlist, meeting agendas and named owners for follow-up.',
  'home.v43.sol.sell.go': 'Explore a Selling Example',
  'home.v43.sol.delegation.text':
    "Build a programme around each company's goals. Find relevant hosts, coordinate factory visits and business meetings, and record what each meeting leads to.",
  'home.v43.sol.delegation.get':
    'A shared programme, company-specific objectives and a follow-up record.',
  'home.v43.sol.delegation.go': 'Explore a Delegation Example',
  'home.v43.sol.delegation.walk': 'Walk Through a Sample Programme',

  // Worked example
  'home.v43.ex.eyebrow': 'Worked example',
  'home.v43.ex.sample': 'Sample data',
  'home.v43.ex.cta': 'Build a Request for This Work',
  'home.v43.ex.full': 'See the Full Example',
  'home.v43.ex.next': 'Next step',
  'home.v43.ex.region': 'Interactive worked example',
  'home.v43.place.other': 'Other or undecided',
  'home.v43.ex.china.title': 'Find out what the quote really covers.',
  'home.v43.ex.china.desc':
    "Three suppliers quote for the same machine. Pick an offer to see what's included and what still needs checking.",
  'home.v43.ex.china.console': 'Compare machinery offers',
  'home.v43.ex.sell.title': 'Find the buyers worth meeting.',
  'home.v43.ex.sell.desc':
    'An apparel exporter is planning meetings around a trade fair. Compare the event list with a shortlist built around what the company can supply.',
  'home.v43.ex.sell.console': 'Build a buyer shortlist',
  'home.v43.ex.delegation.title': 'Give every meeting a job to do.',
  'home.v43.ex.delegation.desc':
    'Move through an example visit. Follow the commercial objective from the original request to the action someone owns after the meeting.',
  'home.v43.ex.delegation.console': 'Follow a delegation',
  'home.v43.ex.other.title': 'Start with the outcome you need.',
  'home.v43.ex.other.desc':
    'An overseas business wants to explore {bd}. A clear first request lets the team assess the route and the work before an introduction is made.',
  'home.v43.ex.other.console': 'Shape an initial request',
  // china: three offers, no total, no ranking. The amounts and delivery codes are the page's own data
  // (lib/home-v43-data.ts), USD as written and never converted; {code} is the delivery code.
  'home.v43.ex.china.offer.a.name': 'Supplier A',
  'home.v43.ex.china.offer.a.terms': '{code} · Installation included',
  'home.v43.ex.china.offer.a.detail':
    'Freight and insurance are outside the quoted scope. Ask for the cost to reach Chattogram before comparing totals.',
  'home.v43.ex.china.offer.b.name': 'Supplier B',
  'home.v43.ex.china.offer.b.terms': 'Delivery terms unstated · Installation excluded',
  'home.v43.ex.china.offer.b.detail':
    'This is the lowest figure on the page. Delivery terms and the extra installation cost must be confirmed before it can be ranked.',
  'home.v43.ex.china.offer.c.name': 'Supplier C',
  'home.v43.ex.china.offer.c.terms': '{code} · Installation unconfirmed',
  'home.v43.ex.china.offer.c.detail':
    'The quote includes freight and insurance to Chattogram. Ask for written confirmation of installation and record any extra charges.',
  'home.v43.ex.china.start.title': 'Can you compare the total costs?',
  'home.v43.ex.china.start.line':
    'Choose a supplier to see what its quoted price includes and what Corridra would ask about.',
  'home.v43.ex.china.result': '{name} · Comparison pending',
  'home.v43.ex.china.next': 'Ask both suppliers for written quotes that cover the same costs.',
  // What a visitor without scripts reads; {amount} is the figure above, in bold
  'home.v43.ex.fallback.a': '{amount} excludes installation and leaves delivery terms open.',
  'home.v43.ex.fallback.b':
    '{amount} includes freight and insurance to Chattogram. Installation is unconfirmed.',
  // sell: the fair list against the qualified shortlist
  'home.v43.ex.sell.group': 'List view',
  'home.v43.ex.sell.view.fair': 'Fair List',
  'home.v43.ex.sell.view.short': 'Qualified Shortlist',
  'home.v43.ex.sell.row.1.name': 'Private-label knitwear buyer',
  'home.v43.ex.sell.row.1.status': 'Potential fit',
  'home.v43.ex.sell.row.1.line':
    'The current range fits. Confirm its buying window and order size.',
  'home.v43.ex.sell.row.2.name': 'Fabric mill',
  'home.v43.ex.sell.row.2.status': 'Outside the request',
  'home.v43.ex.sell.row.2.line':
    'The company supplies material. This mission requires a buyer of finished garments.',
  'home.v43.ex.sell.row.3.name': 'Fashion buying office',
  'home.v43.ex.sell.row.3.status': 'Needs confirmation',
  'home.v43.ex.sell.row.3.line': 'Ask who controls supplier selection before requesting a meeting.',
  'home.v43.ex.sell.row.4.name': 'Retail sourcing team outside the fair',
  'home.v43.ex.sell.row.4.status': 'Potential fit',
  'home.v43.ex.sell.row.4.line':
    'The product category aligns. Confirm decision-maker access first.',
  'home.v43.ex.sell.res.fair.title': 'Start with a reason to meet',
  'home.v43.ex.sell.res.fair.line':
    'Attendance gives you a starting point. Corridra checks product fit, authority and timing.',
  'home.v43.ex.sell.res.short.title': 'The shortlist extends beyond the fair',
  'home.v43.ex.sell.res.short.line':
    'The retail sourcing team merits outreach. Its buying authority and availability still need confirmation.',
  // delegation: before, on the ground and after the visit
  'home.v43.ex.dl.group': 'Programme phase',
  'home.v43.ex.dl.phase.1.label': 'Before the Visit',
  'home.v43.ex.dl.phase.1.title': 'Agree what each company needs',
  'home.v43.ex.dl.phase.1.line':
    'Gather participant objectives. Look for hosts who can address at least one of them.',
  'home.v43.ex.dl.phase.2.label': 'On the Ground',
  'home.v43.ex.dl.phase.2.title': 'Test the right thing at the factory',
  'home.v43.ex.dl.phase.2.line':
    'Use the same technical questions on each visit and record what the team actually observes.',
  'home.v43.ex.dl.phase.3.label': 'After the Visit',
  'home.v43.ex.dl.phase.3.title': 'Put a name and deadline on the follow-up',
  'home.v43.ex.dl.phase.3.line':
    'The sourcing lead requests itemised quotes within two working days. The organiser sees shared progress.',
  // other: an initial request
  'home.v43.ex.other.group': 'Request question',
  'home.v43.ex.other.q.1.label': 'Goal',
  'home.v43.ex.other.q.1.title': 'What should happen?',
  'home.v43.ex.other.q.1.line':
    'Find a Bangladeshi manufacturing partner able to produce an initial run.',
  'home.v43.ex.other.q.2.label': 'Direction',
  'home.v43.ex.other.q.2.title': 'Where is the work?',
  'home.v43.ex.other.q.2.line':
    'An overseas company is looking into {bd}. Corridra assesses inbound work case by case.',
  'home.v43.ex.other.q.3.label': 'Next Step',
  'home.v43.ex.other.q.3.title': 'What would help Corridra assess it?',
  'home.v43.ex.other.q.3.line':
    'Share a specification, the target timeline and what has already been tried.',

  // How it works: the four-stage record of each route (the shipped 14 stages stay under "See the Full Process")
  'home.v43.process.eyebrow': 'How it works',
  'home.v43.process.title': 'How an assignment moves forward.',
  'home.v43.process.lead':
    'Agree the scope with the team. Then use the evidence, meeting notes and outstanding questions to decide what happens next.',
  'home.v43.process.group': 'Explore a mission stage',
  'home.v43.process.full': 'See the Full Process',
  'home.v43.process.step.1': 'Set the Request',
  'home.v43.process.step.2': 'Check the Fit',
  'home.v43.process.step.3': 'Make Contact',
  'home.v43.process.step.4': 'Follow Through',
  'home.v43.process.rec.china.1.title': 'Agree the requirement',
  'home.v43.process.rec.china.1.line':
    'Specify the product or machine, when you need it and which costs and obligations the offers must cover.',
  'home.v43.process.rec.china.2.title': 'Compare before choosing',
  'home.v43.process.rec.china.2.line':
    'Check technical fit and evidence. Keep the original quotes and currencies visible beside gaps in scope.',
  'home.v43.process.rec.china.3.title': 'Arrange a focused visit',
  'home.v43.process.rec.china.3.line':
    'Ask the shortlisted supplier to show the operations or tests that matter to your decision.',
  'home.v43.process.rec.china.4.title': 'Keep a record of the decision',
  'home.v43.process.rec.china.4.line':
    'Record what the visit established, clarify remaining terms and assign the next action.',
  'home.v43.process.rec.sell.1.title': 'Define your buyer',
  'home.v43.process.rec.sell.1.line':
    'Share your offer, minimum order, capacity, target market, and any fair or visit dates.',
  'home.v43.process.rec.sell.2.title': 'Qualify a shortlist',
  'home.v43.process.rec.sell.2.line':
    'Look for category fit, buying authority and timing, including leads outside the fair.',
  'home.v43.process.rec.sell.3.title': 'Request the right meeting',
  'home.v43.process.rec.sell.3.line':
    'Approach the appropriate contact with a reason to meet and a clear agenda.',
  'home.v43.process.rec.sell.4.title': 'Turn interest into a next step',
  'home.v43.process.rec.sell.4.line':
    'Record who attended, what they requested, and who owns the sample, RFQ or follow-up.',
  'home.v43.process.rec.delegation.1.title': 'Agree why the group is going',
  'home.v43.process.rec.delegation.1.line':
    "Capture the organiser's objective and the separate commercial goals of each company.",
  'home.v43.process.rec.delegation.2.title': 'Match hosts to the request',
  'home.v43.process.rec.delegation.2.line':
    'Assess potential hosts, meeting access and relevance before the agenda is confirmed.',
  'home.v43.process.rec.delegation.3.title': 'Run the programme',
  'home.v43.process.rec.delegation.3.line':
    "Coordinate the company meetings and visits. Keep personal work in each company's private view.",
  'home.v43.process.rec.delegation.4.title': 'Follow the commercial outcomes',
  'home.v43.process.rec.delegation.4.line':
    'Record meetings held, follow-ups and their owners, with shared progress visible to the organiser.',
  'home.v43.process.rec.other.1.title': 'Describe the result you need',
  'home.v43.process.rec.other.1.line':
    'Tell Corridra the goal and the origin, target market and deadline you know.',
  'home.v43.process.rec.other.2.title': 'Establish whether the route fits',
  'home.v43.process.rec.other.2.line':
    'The team reviews whether it can take on the work and asks what still needs to be clarified.',
  'home.v43.process.rec.other.3.title': 'Agree the scope',
  'home.v43.process.rec.other.3.line':
    'A person discusses what can be delivered and quotes for the work before it starts.',
  'home.v43.process.rec.other.4.title': 'Agree how progress will be tracked',
  'home.v43.process.rec.other.4.line':
    'Set expectations for updates, the decisions you need to make and who owns the next actions.',
};
