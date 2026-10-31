import type { factLabels } from '../components/fact-label';

export type PublicPageContent = {
  label: string;
  title: string;
  description: string;
  introduction: { title: string; text: string };
  /** The steps of the approach. With a `tag`, each one is an evidence label row instead. */
  sections: {
    title: string;
    text: string;
    tag?: (typeof factLabels)[number]['label'];
    /** The contract name, kept as a small label under a plain title. */
    name?: string;
  }[];
  /** Splits the steps into named groups of equal size. */
  groups?: string[];
  /** Short statements shown as cards in the closing section. */
  statements?: string[];
  closing: { title: string; text: string };
  /** A last call to action under the closing section. */
  band?: { title: string; text: string };
  cta?: string;
  ctaHref?: string;
  intakeJob?: string;
  /** The commercial direction this page is about, shown next to the main action. */
  route?: { label: string; href: string; linkLabel: string };
  /** The opposite direction, when the route also works in reverse. */
  reverse?: {
    title: string;
    text: string;
    cta: string;
    href: string;
    scopeLabel: string;
    scopeHref: string;
  };
  /** What Corridra records, so a reader can see what can be proved later. */
  record?: { title: string; items: string[] };
  /** The distinct commercial events a mission record follows, in order. */
  progress?: { label: string; title: string[]; text: string; steps: string[] };
  related: { href: string; label: string };
};

export const publicPages: Record<string, PublicPageContent> = {
  sell: {
    label: 'Sell in a new market',
    title: 'Make the trip commercially useful.',
    description:
      'We are building a way to find and qualify buyers in Spain and the EU before you arrive, and to follow up after you leave.',
    introduction: {
      title: 'A booth gives visibility. It does not decide who you meet.',
      text: 'Start with your offer and the buyer you want. An attendee list is only one place to look.',
    },
    sections: [
      {
        title: 'Before the trip',
        text: 'Define your target buyer. Check fit and evidence. Prepare a reason to meet.',
      },
      {
        title: 'While you are there',
        text: 'Meet the right people. Note what was said, what is open and the next step.',
      },
      {
        title: 'After you return',
        text: 'Follow quotes, samples and proposals to a decision. Give each next step one owner.',
      },
    ],
    closing: {
      title: 'Fewer irrelevant meetings. More reason to meet.',
      text: 'Corridra does not promise orders.',
    },
    cta: 'Plan my mission',
    route: {
      label: 'Bangladesh to Spain and the EU',
      href: '/corridors/bangladesh-eu',
      linkLabel: 'Read the Spain and EU scope',
    },
    reverse: {
      title: 'It also works the other way.',
      text: 'A Spanish or EU seller can reach suitable buyers in Bangladesh. Each case is set up and reviewed separately.',
      cta: 'Plan a mission from Spain or the EU',
      href: '/plan?companyCountry=ES&marketCode=BD&job=buyers',
      scopeLabel: 'Read the Spain to Bangladesh scope',
      scopeHref: '/corridors/bangladesh-spain',
    },
    record: {
      title: 'What we record for every introduction',
      items: [
        'Who the buyer is and why they fit your offer.',
        'What the buyer stated, and what has evidence.',
        'What was discussed and what is still open.',
        'Who owns the next step, and what became business.',
      ],
    },
    related: { href: '/how-it-works', label: 'See how it works' },
  },
  source: {
    label: 'Source suppliers',
    title: 'Visit fewer suppliers. Visit the ones that fit.',
    description:
      'Start with your requirements. We are building sourcing around a short list worth visiting, not a directory.',
    introduction: {
      title: 'Requirements before introductions.',
      text: 'A supplier can look right on paper and still be wrong for the work.',
    },
    sections: [
      {
        title: 'Define what fits',
        text: 'Set the product, volume, delivery window and evidence you need.',
      },
      {
        title: 'Understand the shortlist',
        text: 'See why a supplier fits, what it claims and what is still unverified.',
      },
      {
        title: 'Make factory days count',
        text: 'Plan visits around the right factories. Record samples, gaps and next steps.',
      },
    ],
    closing: {
      title: 'A visit should answer a question.',
      text: 'Qualification cannot remove every risk. We make the gaps visible.',
    },
    cta: 'Plan a sourcing mission',
    route: {
      label: 'Bangladesh to China',
      href: '/corridors/bangladesh-china',
      linkLabel: 'Read the China scope',
    },
    record: {
      title: 'What we record for every supplier',
      items: [
        'What the supplier states about product, capacity and price.',
        'Which supporting evidence is available.',
        'What is still unverified.',
        'What you decided after the visit, and the next step.',
      ],
    },
    related: { href: '/trust', label: 'Understand the evidence labels' },
  },
  'enter-market': {
    label: 'Enter a new market',
    title: 'Enter an unfamiliar market without entering it blind.',
    description:
      'We are building support for finding customers and partners, with local help when remote research is not enough.',
    introduction: {
      title: 'You do not need a local office to start learning.',
      text: 'A first visit should test something concrete: who needs your offer, how buying works and which partners fit.',
    },
    sections: [
      {
        title: 'Find the right relationships',
        text: 'Define the customer or distributor you need. Check fit before calling it an opportunity.',
      },
      {
        title: 'Validate the market',
        text: 'Use a visit to test assumptions. Keep what you saw apart from what you conclude.',
      },
      {
        title: 'Follow the opportunity',
        text: 'Keep the conversation and the next action connected after the visit.',
      },
    ],
    closing: {
      title: 'Bangladesh without the usual black box.',
      text: 'Reverse directions are set up case by case. Each offer needs its own reviewed scope.',
    },
    cta: 'Plan a market-entry mission',
    route: {
      label: 'Spain and the EU to Bangladesh',
      href: '/corridors/bangladesh-spain',
      linkLabel: 'Read the Spain to Bangladesh scope',
    },
    record: {
      title: 'What we record for every market visit',
      items: [
        'What you set out to test, and what was observed.',
        'Who you met and why they fit.',
        'What you concluded, kept apart from what you observed.',
        'Who owns the next step.',
      ],
    },
    related: { href: '/about', label: 'See where Corridra is starting' },
  },
  'trade-missions': {
    label: 'Run a trade mission',
    title: 'Give every participant a reason to be in the room.',
    description:
      'We are building missions around each participant’s goal, a qualified agenda and follow-up after the trip.',
    introduction: {
      title: 'A shared itinerary is not a shared objective.',
      text: 'Each participant has a different goal. A good programme links each goal to the right companies.',
    },
    sections: [
      {
        title: 'Start with each participant',
        text: 'Learn each goal, then define who they should meet.',
      },
      {
        title: 'Build the commercial agenda',
        text: 'Check fit, prepare introductions and plan meetings with a reason for both sides.',
      },
      {
        title: 'Report what followed',
        text: 'Track meetings, quotes and proposals. Keep contracts, invoices and cash separate.',
      },
    ],
    closing: {
      title: 'A trade mission should produce more than attendance.',
      text: 'Organisers see commercial progress without replacing their own relationships.',
    },
    cta: 'Plan a trade mission',
    route: {
      label: 'Starting with Bangladesh to China',
      href: '/corridors/bangladesh-china',
      linkLabel: 'Read the China scope',
    },
    record: {
      title: 'What we record for every delegation',
      items: [
        'Each participant’s own objective.',
        'Which meetings were held and who attended.',
        'Opportunities, quotation requests and proposals.',
        'Contracts, invoices and collected cash, kept as separate outcomes.',
      ],
    },
    related: { href: '/institutions', label: 'Explore the institutional approach' },
  },
  'how-it-works': {
    label: 'How it works',
    title: 'One commercial objective. One mission. A clear record of what happens next.',
    description: 'How a request moves from your first goal to a recorded result, in six steps.',
    introduction: {
      title: 'Begin with a decision you need to make.',
      text: 'A mission gives the work a clear goal, scope and window.',
    },
    groups: ['Before you meet', 'Meet and follow up'],
    sections: [
      {
        title: 'Define what you need',
        name: 'Define',
        text: 'Say what you want to buy, sell or organise, in which market and by when.',
      },
      {
        title: 'Find companies that fit',
        name: 'Find',
        text: 'We research companies beyond event lists and old contacts.',
      },
      {
        title: 'Compare what is proven',
        name: 'Compare',
        text: 'See offers side by side, with what is claimed, what has evidence and what is still open.',
      },
      {
        title: 'Visit and meet',
        name: 'Visit',
        text: 'We plan introductions and meetings. A proposed meeting is not a confirmed one.',
      },
      {
        title: 'Decide with the facts in view',
        name: 'Decide',
        text: 'Choose who to work with, with the evidence and the open questions in front of you.',
      },
      {
        title: 'Follow through',
        name: 'Follow through',
        text: 'Keep owners, dates, quotes and samples visible until the result is recorded.',
      },
    ],
    statements: [
      'A database contact is not a buyer.',
      'A meeting is not a sale.',
      'A contract is not cash.',
    ],
    closing: {
      title: 'A meeting is a start. What follows matters.',
      text: 'Progress needs a clear record of what happened.',
    },
    band: {
      title: 'Ready to start?',
      text: 'Tell us your goal. You can start without an account and create one at the last step to send it.',
    },
    related: { href: '/trust', label: 'See how claims and evidence differ' },
  },
  network: {
    label: 'Corridra Network',
    title: 'Your local knowledge can have commercial value.',
    description:
      'We are building a network for scoped local work, with a clear task, evidence and reward before you accept.',
    introduction: {
      title: 'Some market intelligence cannot be collected from a desk.',
      text: 'A local check, visit or introduction can answer what remote research cannot.',
    },
    sections: [
      {
        title: 'See the task before you say yes',
        text: 'Each task will state place, timing, evidence and reward. No vague promises.',
      },
      {
        title: 'Contribute what you can support',
        text: 'Work may include checks, visits, samples or introductions. Eligibility depends on the task.',
      },
      {
        title: 'Your relationship remains your relationship',
        text: 'You control who sees your contacts, and you keep the credit for introductions.',
      },
    ],
    closing: {
      title: 'Useful work. Clear terms.',
      text: 'There are no open tasks or published rewards yet. Paid work will depend on local law and tax.',
    },
    cta: 'See what is coming',
    related: { href: '/trust', label: 'Read the evidence approach' },
  },
  institutions: {
    label: 'For institutions',
    title: 'Stop measuring trade missions by attendance.',
    description:
      'We are building a way to turn participant goals into qualified agendas and to track business progress after the programme.',
    introduction: {
      title: 'A programme can be busy and still produce little business.',
      text: 'Attendance shows activity. It does not show whether opportunities progressed or cash was collected.',
    },
    sections: [
      {
        title: 'Before the programme',
        text: 'Capture each participant’s goal. Research and qualify companies before setting the agenda.',
      },
      {
        title: 'During and after',
        text: 'Record meetings, owners and open decisions. Stay connected to what participants do next.',
      },
      {
        title: 'Measure the progression',
        text: 'Report meetings, qualified opportunities, quotes, proposals and contracts. Cash needs its own evidence.',
      },
    ],
    closing: {
      title: 'Keep your institutional relationships. Add execution visibility.',
      text: 'We support delivery and reporting. We do not promise sales or claim results from programmes that have not taken place.',
    },
    cta: 'Plan an institutional mission',
    related: { href: '/trade-missions', label: 'Explore trade missions' },
  },
  trust: {
    label: 'Trust and evidence',
    title: 'Know what is claimed. Know what is evidenced. Know the difference.',
    description: 'A repeated claim does not become a verified fact.',
    introduction: {
      title: 'Claims are not the same as evidence.',
      text: 'Every label shows the status of a fact. It does not replace your judgement.',
    },
    sections: [
      {
        title: 'Self-declared',
        tag: 'Self-declared',
        text: 'The company said so. Nobody independent has checked.',
      },
      {
        title: 'Evidence available',
        tag: 'Evidence available',
        text: 'Proof was provided. That alone does not make the claim verified.',
      },
      {
        title: 'Verified',
        tag: 'Verified',
        text: 'A defined check was completed. Its scope and limits still matter.',
      },
      {
        title: 'Derived',
        tag: 'Derived',
        text: 'Worked out from other information. It is an inference, not an observed fact.',
      },
      {
        title: 'Outcome observed',
        tag: 'Outcome observed',
        text: 'A real commercial event was recorded with proof. A meeting, contract, invoice and cash receipt are different events.',
      },
    ],
    progress: {
      label: 'Commercial outcome stages (each needs its own evidence)',
      title: ['A meeting is not a sale.', 'A contract is not cash.'],
      text: 'Each step needs its own evidence.',
      steps: [
        'Identified',
        'Qualified',
        'Engaged',
        'Meeting held',
        'Opportunity',
        'Quotation / sample',
        'Proposal',
        'Commitment',
        'Contract',
        'Invoice',
        'Cash collected',
      ],
    },
    closing: {
      title: 'AI can help reason. It cannot redefine reality.',
      text: 'AI can support research. It cannot decide permissions, handle money or declare a fact verified. Consequential actions need human review.',
    },
    related: { href: '/how-it-works', label: 'See how it works' },
  },
  about: {
    label: 'About Corridra',
    title: 'Make market entry deliberate.',
    description:
      'Corridra is being built for cross-border market access: find the right companies, get access, follow the relationship.',
    introduction: {
      title: 'The hard work sits between intention and outcome.',
      text: 'Companies travel, attend fairs and collect contacts. Who is worth meeting, and what happens next?',
    },
    sections: [
      {
        title: 'Start with a commercial objective',
        text: 'Selling, sourcing and entering a market are different jobs.',
      },
      {
        title: 'Earn depth before claiming breadth',
        text: 'We start with Bangladesh to China, Spain and the EU. Each needs its own reviewed scope. We claim no global coverage.',
      },
      {
        title: 'Keep the evidence close',
        text: 'Record why a company was chosen, what is known and what is open.',
      },
    ],
    closing: {
      title: 'Start with one objective.',
      text: 'Explore the approach, then plan a mission when you are ready.',
    },
    related: { href: '/how-it-works', label: 'See how it works' },
  },
};

publicPages.machinery = {
  label: 'Procure machinery',
  title: 'A machine is useful only if it fits the work.',
  description: 'Define the application, capacity and site limits before comparing suppliers.',
  introduction: {
    title: 'Specification before price.',
    text: 'Keep original offers apart from comparisons. Keep installation, spares, warranty and open questions visible.',
  },
  sections: [
    {
      title: 'Define the requirement',
      text: 'Start with purpose, key parameters, budget and timing.',
    },
    {
      title: 'Compare the actual offers',
      text: 'Keep each original currency and term. Missing scope makes a comparison incomplete.',
    },
    {
      title: 'Use visits to resolve questions',
      text: 'A visit needs a named owner, a purpose and a confirmed meeting. Interest alone is not a visit.',
    },
  ],
  closing: {
    title: 'A documented decision, with its limits.',
    text: 'Record the evidence behind a choice and what is unknown. Corridra does not certify a machine or place an order.',
  },
  intakeJob: 'machinery_procurement',
  cta: 'Plan a machinery request',
  related: { href: '/corridors/bangladesh-china', label: 'Explore Bangladesh to China sourcing' },
};
publicPages['business-trips'] = {
  label: 'Plan a business trip',
  title: 'Give each day a commercial purpose.',
  description: 'Work backwards from the conversations and decisions the trip should produce.',
  introduction: {
    title: 'An itinerary is part of a mission.',
    text: 'Company location, target market, venue and shipment route are different facts. Keep each separate.',
  },
  sections: [
    {
      title: 'Before departure',
      text: 'Set the objective, shortlist companies and list the questions to answer.',
    },
    {
      title: 'During the visit',
      text: 'Separate proposed from confirmed meetings. Record who owns each next action.',
    },
    {
      title: 'After the trip',
      text: 'Follow requests, offers and outcomes. Attendance is not progress.',
    },
  ],
  closing: {
    title: 'Plan the work around the journey.',
    text: 'We do not book travel or guarantee meetings. Tell us the purpose of the trip and we plan the conversations around it.',
  },
  intakeJob: 'business_trips',
  cta: 'Plan a business trip',
  related: { href: '/how-it-works', label: 'See the mission process' },
};

publicPages.source.intakeJob = 'sourcing';
publicPages.sell.intakeJob = 'buyers';
publicPages['enter-market'].intakeJob = 'market_entry';
publicPages['trade-missions'].intakeJob = 'delegations';
