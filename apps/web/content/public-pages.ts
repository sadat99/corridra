export type PublicPageContent = {
  label: string;
  title: string;
  description: string;
  introduction: { title: string; text: string };
  sections: { title: string; text: string }[];
  closing: { title: string; text: string };
  cta?: string;
  intakeJob?: string;
  related: { href: string; label: string };
};

export const publicPages: Record<string, PublicPageContent> = {
  sell: {
    label: 'SELL IN A NEW MARKET',
    title: 'You are already paying to be in the market. Make the trip commercially useful.',
    description:
      'We’re building a way to identify and qualify buyers, distributors and partners before you arrive, then follow the relationship after you leave.',
    introduction: {
      title: 'A booth can give you visibility. It cannot decide who you should meet.',
      text: 'The right conversation starts with your offer, the market you want to reach and a reason for the other company to take an interest. An attendee list is only one place to look.',
    },
    sections: [
      {
        title: 'Before the trip',
        text: 'Define the target profile. Research beyond the attendee list. Qualify fit, record the evidence and prepare outreach with a clear reason to meet.',
      },
      {
        title: 'While you are there',
        text: 'Build an agenda around relevant conversations. Capture what was discussed, what is still uncertain and the next action.',
      },
      {
        title: 'After you return',
        text: 'Follow requests for quotations, samples and proposals through to a decision. Keep the owner and next step visible.',
      },
    ],
    closing: {
      title: 'Fewer irrelevant meetings. More reason to meet.',
      text: 'Corridra will not promise orders. Research, qualification and execution will be scoped around the objective agreed for each mission.',
    },
    cta: 'Plan my mission',
    related: { href: '/how-it-works', label: 'See the planned process' },
  },
  source: {
    label: 'SOURCE SUPPLIERS',
    title: 'Visit fewer suppliers. Visit the ones that fit.',
    description:
      'Start with your requirements. We’re building sourcing missions around a short list worth investigating, rather than a directory to work through.',
    introduction: {
      title: 'Requirements before introductions.',
      text: 'Product, capacity, order size, evidence and timing all matter. A supplier can look relevant on paper and still be wrong for the work you need done.',
    },
    sections: [
      {
        title: 'Define what fits',
        text: 'Set out the product, volume, delivery window and evidence you need. Keep the requirements specific enough to rule out unsuitable companies.',
      },
      {
        title: 'Understand the shortlist',
        text: 'See why a supplier fits, what it has declared, which supporting evidence is available and what remains unverified.',
      },
      {
        title: 'Make factory days count',
        text: 'Plan visits around relevant factories, travel time and open questions. Record sample decisions, evidence gaps and next steps while the details are fresh.',
      },
    ],
    closing: {
      title: 'A visit should answer a question.',
      text: 'Qualification cannot remove every sourcing risk. The planned process makes the gaps visible so you can decide what to inspect, request or confirm.',
    },
    cta: 'Plan a sourcing mission',
    related: { href: '/trust', label: 'Understand the evidence labels' },
  },
  'enter-market': {
    label: 'ENTER A NEW MARKET',
    title: 'Enter an unfamiliar market without entering it blind.',
    description:
      'We’re building support for finding customers, distributors and local relationships, with local execution when remote research is not enough.',
    introduction: {
      title: 'You do not need a local office to start learning like you have one.',
      text: 'A first market visit should test something concrete: who needs your offer, how buying works, which partners fit and what it will take to move forward.',
    },
    sections: [
      {
        title: 'Find the right relationships',
        text: 'Define the customer or distributor you need. Research the fit before treating an introduction as an opportunity.',
      },
      {
        title: 'Validate the market',
        text: 'Use a business visit to test assumptions and collect useful evidence. Keep observations separate from conclusions.',
      },
      {
        title: 'Follow the opportunity',
        text: 'Keep the conversation, introduction credit and next action connected after the visit. Local follow-through is part of the planned approach.',
      },
    ],
    closing: {
      title: 'Bangladesh without the usual black box.',
      text: 'Reverse market-entry directions can be configured selectively. Define the actual country and commercial objective. Each operating offer needs its own reviewed scope.',
    },
    cta: 'Plan a market-entry mission',
    related: { href: '/about', label: 'See where Corridra is starting' },
  },
  'trade-missions': {
    label: 'RUN A TRADE MISSION',
    title: 'Give every participant a reason to be in the room.',
    description:
      'We’re building trade missions around participant objectives, qualified commercial agendas and follow-through after the delegation returns.',
    introduction: {
      title: 'A shared itinerary is not a shared objective.',
      text: 'Each participant brings a different offer, requirement or target market. A useful programme connects those objectives to relevant companies and clear next steps.',
    },
    sections: [
      {
        title: 'Start with each participant',
        text: 'Understand the commercial objective, then define a target profile. Programme research should follow those profiles.',
      },
      {
        title: 'Build the commercial agenda',
        text: 'Qualify fit, prepare the context for introductions and coordinate meetings around a reason for both sides to participate.',
      },
      {
        title: 'Report what followed',
        text: 'Track held meetings, opportunities, quotation requests and proposals. Keep contracts, invoices and collected cash as distinct outcomes.',
      },
    ],
    closing: {
      title: 'A trade mission should produce more than attendance.',
      text: 'The planned approach gives organisers visibility into commercial progression without requiring them to replace their institutional relationships.',
    },
    cta: 'Plan a trade mission',
    related: { href: '/institutions', label: 'Explore the institutional approach' },
  },
  'how-it-works': {
    label: 'HOW IT WORKS',
    title: 'One commercial objective. One mission. A clear record of what happens next.',
    description:
      'This is the process we’re building. Mission planning and delivery are not open yet.',
    introduction: {
      title: 'Begin with a decision you need to make.',
      text: 'Selling, sourcing and entering a market need different targets. A mission gives the work a clear objective, scope and travel or delivery window.',
    },
    sections: [
      {
        title: '01 / Intent',
        text: 'Define what you want to achieve and what a useful result would look like.',
      },
      {
        title: '02 / Market',
        text: 'Choose the market and window. Record the offer or requirement in enough detail to guide the work.',
      },
      {
        title: '03 / Counterparties',
        text: 'Research companies that could fit. Look beyond event lists and existing contacts.',
      },
      {
        title: '04 / Qualification',
        text: 'Assess relevance. Separate declarations, supporting evidence, completed checks and open questions.',
      },
      {
        title: '05 / Access',
        text: 'Prepare relevant outreach and introductions with context for the other party.',
      },
      {
        title: '06 / Execution',
        text: 'Coordinate meetings and scoped local work. Capture what happened and the next agreed action.',
      },
      {
        title: '07 / Progression',
        text: 'Follow opportunities, quotations, samples and proposals. Keep responsibility and timing visible.',
      },
      {
        title: '08 / Outcome',
        text: 'Record commitments, contracts, invoices and collected cash separately. Report the outcome the evidence supports.',
      },
    ],
    closing: {
      title: 'A meeting is a start. What follows matters.',
      text: 'A database contact is not a buyer. A meeting is not a sale. A contract is not cash. Progress needs a clear record of what actually happened.',
    },
    related: { href: '/trust', label: 'See how claims and evidence differ' },
  },
  network: {
    label: 'CORRIDRA NETWORK',
    title: 'Your local knowledge can have commercial value.',
    description:
      'We’re building a network for scoped local work, with a clear task, evidence requirement and reward before anyone accepts. Participation is not open yet.',
    introduction: {
      title: 'Some market intelligence cannot be collected from a desk.',
      text: 'A local business check, a visit or a relevant introduction can answer questions that remote research cannot. The task needs to be specific enough to know when it is done.',
    },
    sections: [
      {
        title: 'See the task before you say yes',
        text: 'The planned task record will explain the location, timing, required capability, evidence and reward terms. No task should depend on a vague promise.',
      },
      {
        title: 'Contribute what you can support',
        text: 'Work may include business checks, visits, samples, meeting support or introductions. Eligibility and evidence requirements will depend on the task.',
      },
      {
        title: 'Your relationship remains your relationship',
        text: 'The planned approach preserves selective visibility and introduction attribution. Having a valuable relationship should not require handing over a contact list.',
      },
    ],
    closing: {
      title: 'Useful work. Clear terms.',
      text: 'Paid participation will depend on local law, work status and tax requirements. There are no open tasks or published reward terms at this stage.',
    },
    cta: 'See what is coming',
    related: { href: '/trust', label: 'Read the evidence approach' },
  },
  institutions: {
    label: 'FOR INSTITUTIONS',
    title: 'Stop measuring trade missions by attendance.',
    description:
      'We’re building a way to turn participant objectives into qualified agendas and to track commercial progression after the programme ends.',
    introduction: {
      title: 'A programme can be busy and still produce very little business.',
      text: 'Attendance and meetings show activity. They do not explain whether relevant opportunities progressed or whether any cash was collected.',
    },
    sections: [
      {
        title: 'Before the programme',
        text: 'Capture participant objectives, define target profiles and research relevant companies. Qualify fit before setting the meeting agenda.',
      },
      {
        title: 'During and after',
        text: 'Record held meetings, follow-up owners and open decisions. Keep the programme connected to what participants do next.',
      },
      {
        title: 'Measure the progression',
        text: 'Report participation, held meetings, qualified opportunities, quotation requests, proposals and contracts. Attributable cash needs its own evidence and denominator.',
      },
    ],
    closing: {
      title: 'Keep your institutional relationships. Add execution visibility.',
      text: 'The planned service supports programme delivery and outcome reporting. It does not promise sales or claim results from programmes that have not taken place.',
    },
    cta: 'Plan an institutional mission',
    related: { href: '/trade-missions', label: 'Explore trade missions' },
  },
  trust: {
    label: 'TRUST & EVIDENCE',
    title: 'Know what is claimed. Know what is evidenced. Know the difference.',
    description:
      'These are the distinctions Corridra is being built around. A repeated claim does not become a verified fact.',
    introduction: {
      title: 'Claims are not the same as evidence.',
      text: 'The planned record keeps the source, assertion, supporting material and checks visible. An evidence label explains the status of information, rather than replacing your judgement.',
    },
    sections: [
      {
        title: 'Self-declared',
        text: 'A company or person has made an assertion. It has not been established by an independent check.',
      },
      {
        title: 'Evidence available',
        text: 'Supporting material has been identified. Its existence alone does not mean the claim is verified.',
      },
      {
        title: 'Verified',
        text: 'A defined verification process has been completed. The scope, method and limits of that check still matter.',
      },
      {
        title: 'Derived',
        text: 'A conclusion has been drawn from other information. It is an inference, not a directly observed fact.',
      },
      {
        title: 'Outcome observed',
        text: 'A real commercial event has been recorded with supporting evidence. A meeting, contract, invoice and cash receipt remain different events.',
      },
    ],
    closing: {
      title: 'AI can help reason. It cannot redefine reality.',
      text: 'Planned AI assistance can support research and extraction. It cannot decide permissions, control money or declare a fact verified. Consequential actions will require the relevant controls and human review.',
    },
    related: { href: '/how-it-works', label: 'Follow the planned mission process' },
  },
  about: {
    label: 'ABOUT CORRIDRA',
    title: 'Make market entry deliberate.',
    description:
      'Corridra is being built for cross-border market access: finding relevant companies, creating access and following the commercial relationship.',
    introduction: {
      title: 'The difficult work sits between intention and outcome.',
      text: 'Companies already travel, attend fairs and collect contacts. The questions remain: who is worth meeting, why would they meet you and what happens afterwards?',
    },
    sections: [
      {
        title: 'Start with a commercial objective',
        text: 'Selling, sourcing and market entry are different jobs. The work should start with what the company needs to achieve.',
      },
      {
        title: 'Earn depth before claiming breadth',
        text: 'Initial directions include Bangladesh–China, Bangladesh–Spain and Bangladesh–EU. Each requires its own reviewed scope. No operational global coverage is claimed.',
      },
      {
        title: 'Keep the evidence close',
        text: 'Record the reason for a selection, what is known and what remains uncertain. Measure progress using actual commercial events.',
      },
    ],
    closing: {
      title: 'The public site is live. Mission delivery is coming soon.',
      text: 'You can explore the planned approach today. Intake, accounts and network tasks will open as their delivery and data safeguards are ready.',
    },
    related: { href: '/how-it-works', label: 'See how it will work' },
  },
};

publicPages.machinery = {
  label: 'PROCURE MACHINERY',
  title: 'A machine is useful only if it fits the work.',
  description:
    'Define the application, capacity, site constraints and acceptance questions before comparing suppliers or planning a technical visit.',
  introduction: {
    title: 'Specification before price.',
    text: 'Original offers remain separate from derived comparisons. Installation, training, spares, warranty and unanswered technical questions stay visible.',
  },
  sections: [
    {
      title: 'Define the requirement',
      text: 'Start with purpose, key parameters, budget and timing. Add utilities, integration and acceptance criteria as the discussion develops.',
    },
    {
      title: 'Compare the actual offers',
      text: 'Retain the original currency and terms. Missing quantities, specifications or shipping scope make a comparison incomplete.',
    },
    {
      title: 'Use visits to resolve questions',
      text: 'A factory or technical discussion needs a named owner, an agreed purpose and an actual confirmed meeting. Interest alone does not confirm a visit.',
    },
  ],
  closing: {
    title: 'A documented decision, with its limits.',
    text: 'Record the evidence behind a selection and what is still unknown. Corridra does not certify a machine or place an order for you.',
  },
  intakeJob: 'machinery_procurement',
  cta: 'Prepare a machinery example request',
  related: { href: '/corridors/bangladesh-china', label: 'Explore Bangladesh–China sourcing' },
};
publicPages['business-trips'] = {
  label: 'PLAN A BUSINESS TRIP',
  title: 'Give each day a commercial purpose.',
  description:
    'Work backwards from the conversations, evidence and decisions the trip should produce.',
  introduction: {
    title: 'An itinerary is part of a mission.',
    text: 'Company location, target market, meeting venue and shipment route are different facts. Keep each in its proper context.',
  },
  sections: [
    {
      title: 'Before departure',
      text: 'Define the objective, shortlist relevant counterparties and identify the questions that need a conversation or site visit.',
    },
    {
      title: 'During the visit',
      text: 'Separate proposed engagements from confirmed meetings. Record what happened and the person responsible for the next action.',
    },
    {
      title: 'After the trip',
      text: 'Follow the relationship through requests, offers and observed outcomes. Attendance alone is not commercial progress.',
    },
  ],
  closing: {
    title: 'Plan the work around the journey.',
    text: 'No travel booking or guaranteed meeting service is available. The current test flow lets you describe the commercial mission using invented details.',
  },
  intakeJob: 'business_trips',
  cta: 'Prepare a business-trip example request',
  related: { href: '/how-it-works', label: 'See the mission process' },
};

publicPages.source.intakeJob = 'sourcing';
publicPages.sell.intakeJob = 'buyers';
publicPages['enter-market'].intakeJob = 'market_entry';
publicPages['trade-missions'].intakeJob = 'delegations';
