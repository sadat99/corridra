import { inEveryLanguage } from './lang';

// Words for the home page (owner decision of 25 October 2026: the pages follow the chosen language).
// English is the source and this file holds English only; each other language's words are in lang/<code>.ts.
// A page key shows in the chosen language only while `CORRIDRA_LANGUAGES_PAGES` names that language
// (see lib/i18n/pages.ts). The five trust names stay English in every
// language (ADR-066, decision 3), so they are not here. Company names are invented examples.

// Words added for the home page, concept G (owner decision of 6 November 2026). English only: no translation has
// been written or reviewed, so every other language shows these English words (spread into each language below)
// and no screen claims a translation. Company names are invented examples; amounts and codes stay in the page.
const homeLandingEn = {
  'home.country.eu': 'the EU',
  'home.country.uk': 'the UK',
  'home.country.us': 'the US',
  'home.country.au': 'Australia',
  'home.country.asia': 'Key Asian Markets',
  'home.pass.label': 'Bangladesh to {to}',
  // Owner decision, 12 November 2026: the three jobs are unequal and each names its first route (only routes the
  // repository already states, content/corridors.ts), and the example player has a third, Delegation, example
  // built from the request page's own sample (lib/i18n/ws/ws-a.ts). English only until a native review is recorded.
  'home.start.buy.route': 'Bangladesh to China',
  'home.start.trip.route': 'Delegations and trade missions',
  'home.start.sell.route': 'Bangladesh to the EU, the UK, the US, Australia and key Asian markets',
};

// Words added for the home page, Two Routes (owner decision of 17 November 2026, design board "Corridra Two Routes",
// revision 3c; docs/revamp/specs/public-home.md). English only: no translation has been written or reviewed, so every
// other language shows these English words (spread into each language below) and no screen claims a translation.
// Native review pending (docs/product/language-review-record.md). Company names, cities and amounts are invented
// examples and stay in lib/home-routes-data.ts. The five trust names stay English (ADR-066, decision 3).
const homeTwoEn = {
  // Hero
  'home.tr.lead':
    'Corridra turns your goal abroad into the right people, trusted talks and progress you can see. We run missions from Bangladesh to China, the EU, the UK, the US, Australia and key Asian markets. Choose yours.',
  'home.tr.q': 'Which way is your business moving?',
  'home.tr.q.sub': 'Choose one. The page below opens that route.',
  'home.tr.side.supply': 'Supply side',
  'home.tr.side.demand': 'Demand side',
  'home.tr.door.china.title': 'Buying from China',
  'home.tr.door.china.text':
    'Many suppliers, technical checks, quotes you can compare, factory visits.',
  'home.tr.door.china.route': 'Bangladesh to China',
  'home.tr.door.sell.title': 'Sell Abroad',
  'home.tr.door.sell.text': 'Who is worth meeting, and how to reach them.',
  'home.tr.door.sell.route':
    'Bangladesh to the EU, the UK, the US, Australia and key Asian markets',
  'home.tr.door.delegation.title': 'Leading a delegation',
  'home.tr.door.delegation.text': 'Many companies, each with its own private plan',
  'home.tr.door.other.title': 'Something else',
  'home.tr.door.other.text': 'Tell us in your own words',
  'home.tr.selected': 'Selected',
  'home.tr.assure.account': 'No account needed',
  'home.tr.assure.send': 'Nothing is sent until you check your request',
  'home.tr.assure.stop': 'Stop any time',
  'home.tr.cta.none': 'Start a Request',
  'home.tr.cta.china': 'Plan My China Sourcing',
  'home.tr.cta.sell': 'Plan My Buyer Meetings',
  'home.tr.cta.delegation': 'Plan My Programme',
  'home.tr.cta.other': 'Describe What I Need',
  'home.tr.opened': 'Opened below: {route}.',
  'home.tr.goto': 'Go to It',
  'home.tr.hint': 'Each door opens its own worked example further down this page.',
  // Route bar and how it works
  'home.tr.bar.aria': 'Choose which route this page shows',
  'home.tr.bar.showing': 'Showing:',
  'home.tr.bar.none': 'shared sections. Choose a route to open it.',
  'home.tr.bar.all': 'All Routes',
  'home.tr.bar.china': 'China Route',
  'home.tr.bar.sell': 'Sell Abroad',
  'home.tr.bar.delegation': 'Delegation',
  'home.tr.bar.other': 'Something Else',
  'home.tr.bar.allText': 'All Routes',
  'home.tr.bar.delegationText': 'Delegation',
  'home.tr.bar.otherText': 'Something Else',
  'home.tr.pick.eyebrow': 'How it works',
  'home.tr.pick.title': 'Choose a door. This page opens that route.',
  'home.tr.pick.1.title': 'Choose your route',
  'home.tr.pick.1.text': 'Buying from China, Sell Abroad, a delegation, or something else.',
  'home.tr.pick.2.title': 'Try a worked example',
  'home.tr.pick.2.text':
    'Quotes that do not compare, or a fair list that is not a buyer list, for your own market.',
  'home.tr.pick.3.title': 'Start a request',
  'home.tr.pick.3.text':
    'A person reads it, asks a few questions, then sends a quote for that work.',
  'home.tr.open.china': 'Open the China Route',
  'home.tr.open.china.text': 'A quote check you can try, and a factory-visit day on two clocks.',
  'home.tr.open.sell': 'Open Sell Abroad',
  'home.tr.open.sell.text':
    'A buyer shortlist and a fair-cost calculator, for the market you pick.',
  'home.tr.open.more': 'Leading a delegation, or something else?',
  'home.tr.open.delegation': 'Open the Delegation Route',
  'home.tr.open.other': 'Something Else',
  'home.tr.open.everything': 'Show Every Route',
  // China Route
  'home.tr.cn.eyebrow': 'China Route · supply side',
  'home.tr.cn.title': 'Too many suppliers. Too few you can compare.',
  'home.tr.cn.lead':
    'Go to China knowing which suppliers, factories and price terms deserve your attention. Guangzhou, Foshan, Shenzhen and Yiwu have more factories than any trip can visit.',
  'home.tr.tests': 'What this route tests',
  'home.tr.cn.t1': 'Many suppliers saying similar things',
  'home.tr.cn.t2': 'Technical qualification of machines and factories',
  'home.tr.cn.t3': 'Quotes that can be compared like for like',
  'home.tr.cn.t4': 'Factory and showroom visits worth the day',
  'home.tr.q.title': 'Three suppliers quote for the same machine. Which one is cheapest?',
  'home.tr.q.lead': 'Read them the way you would read them on WhatsApp. Then pick.',
  'home.tr.q.example': 'Example',
  'home.tr.q.supplier': 'Supplier {letter}',
  'home.tr.q.delivery': 'Delivery terms',
  'home.tr.q.install': 'Installation',
  'home.tr.q.lead.time': 'Lead time',
  'home.tr.q.notStated': 'Not stated',
  'home.tr.q.notConfirmed': 'Not confirmed',
  'home.tr.q.included': 'Included',
  'home.tr.q.notIncluded': 'Not included',
  'home.tr.q.days': '{n} days',
  'home.tr.q.pick': '{letter} Is Cheapest',
  'home.tr.q.unsure': 'I Cannot Tell Yet',
  'home.tr.q.reset': 'Start Over',
  'home.tr.q.covers': 'What the price covers',
  'home.tr.q.inPrice': 'In the price',
  'home.tr.q.notInPrice': 'Not in the price',
  'home.tr.q.cov.machine': 'Machine',
  'home.tr.q.cov.install': 'Installation',
  'home.tr.q.cov.freight': 'Sea freight to Chattogram',
  'home.tr.q.cov.insurance': 'Insurance in transit',
  'home.tr.q.cov.duty': 'Import duty and clearance in Bangladesh',
  'home.tr.q.gap.one': '{n} cost not stated',
  'home.tr.q.gap.many': '{n} costs not stated',
  'home.tr.q.gap.out.one': '{n} known cost not in the price',
  'home.tr.q.gap.out.many': '{n} known costs not in the price',
  'home.tr.q.verdict.a':
    'Not yet comparable. Terms are clear, but freight and insurance after Ningbo are not in the price.',
  'home.tr.q.verdict.b':
    'Not yet comparable. Delivery terms are not stated, and installation is extra at a price not stated.',
  'home.tr.q.verdict.c': 'Not yet comparable. Installation is not confirmed.',
  'home.tr.q.react.kicker': 'What each price leaves out',
  'home.tr.q.react.a.title': 'You picked A, {price}.',
  'home.tr.q.react.a.body':
    "A fair choice: A states every term. But {fob} means sea freight and insurance after Ningbo are yours to pay, so A cannot be set beside C's delivered price yet.",
  'home.tr.q.react.b.title': 'You picked B, {price}, the lowest number.',
  'home.tr.q.react.b.body':
    'It is also the offer with the most gaps: three costs not stated, because there are no delivery terms, and installation not included. The lowest number is not yet the lowest cost.',
  'home.tr.q.react.c.title': 'You picked C, {price}.',
  'home.tr.q.react.c.body':
    'It looks the most expensive, but it is the only price that includes freight and insurance to Chattogram. Installation is not confirmed, so it cannot be ranked yet either.',
  'home.tr.q.react.x.title': 'Right answer. Nobody can tell yet.',
  'home.tr.q.react.x.body':
    'As they stand, none of the three can be ranked on price. The lowest number, B, carries the most gaps: three costs not stated, and installation not included.',
  'home.tr.q.none': 'None of the three can be ranked on price yet.',
  'home.tr.q.ask': 'Before you decide, Corridra would ask, in writing:',
  'home.tr.q.ask.a': 'Supplier A for sea freight and insurance from Ningbo to Chattogram',
  'home.tr.q.ask.b': 'Supplier B for its delivery terms and an installation price',
  'home.tr.q.ask.c': 'Supplier C to confirm whether installation is included',
  'home.tr.q.keep':
    'The original quotes stay untouched. Answers are added beside them, so you always see who said what.',
  'home.tr.q.cta': 'Get My Offers Compared',
  'home.tr.q.rule': 'Rule',
  'home.tr.q.rule.title':
    'Two quotes are not equivalent if one leaves out critical costs or technical obligations.',
  'home.tr.q.rule.text':
    'Example quotes, invented for illustration. They are not market prices, and no cost is guessed here: an unknown stays "Not stated", never zero.',
  'home.tr.visit.title': 'A factory-visit day, on two clocks.',
  'home.tr.visit.lead':
    'You are on the factory floor in Foshan. Your engineer and your finance team are in Dhaka, two hours behind. Choose a stop to see both clocks.',
  'home.tr.visit.day': 'One visit day, Guangzhou and Foshan',
  'home.tr.visit.gz': 'Guangzhou, China',
  'home.tr.visit.dh': 'Dhaka, Bangladesh',
  'home.tr.visit.gz.tz': 'China Standard Time, UTC+8',
  'home.tr.visit.dh.tz': 'Bangladesh Standard Time, UTC+6',
  'home.tr.visit.clock': '{city} clock showing {time}',
  'home.tr.visit.stops': 'Stops in the visit day',
  'home.tr.visit.at': '{gz} in Guangzhou, {dh} in Dhaka: {stop}',
  'home.tr.visit.note':
    'Example day, invented for illustration. Times and stops are not a plan and no travel is arranged: Corridra does not book flights, hotels or visas.',
  'home.tr.visit.s0.title': 'Leave the hotel',
  'home.tr.visit.s0.text':
    'Driver and interpreter confirmed the day before. Foshan is next to Guangzhou, so the first factory is a short drive.',
  'home.tr.visit.s1.title': 'Factory 1: running test',
  'home.tr.visit.s1.text':
    'You watch the quoted machine run on your own fabric sample. Photos and video go into the mission record.',
  'home.tr.visit.s2.title': 'Lunch with sales',
  'home.tr.visit.s2.text':
    'The gaps from the quote comparison are asked in person: freight, installation, training.',
  'home.tr.visit.s3.title': 'Factory 2: site check',
  'home.tr.visit.s3.text':
    'Address and nameplate checked against the business licence it sent. A field check, not an external audit.',
  'home.tr.visit.s4.title': 'Call with Dhaka',
  'home.tr.visit.s4.text':
    'Your engineer joins by video at 14:30 Dhaka time to see the line and ask technical questions.',
  'home.tr.visit.s5.title': 'Notes written up',
  'home.tr.visit.s5.text':
    'Both visits are recorded the same day, so the two factories can be compared like for like.',
  'home.tr.comp.title': 'What "comparable" means here.',
  'home.tr.comp.1.title': 'Same delivery point',
  'home.tr.comp.1.text':
    '{fob} and {cif} are different prices for different jobs. Both are kept as quoted, then the gap is asked about.',
  'home.tr.comp.2.title': 'Same work',
  'home.tr.comp.2.text':
    'Installation, training, spare parts and warranty, each marked In the price, Not in the price, or Not stated.',
  'home.tr.comp.3.title': 'Same kind of proof',
  'home.tr.comp.3.text':
    'A stated capacity is {selfDeclared} until there is evidence or a defined check. The label travels with the number.',
  // Sell Abroad
  'home.tr.sl.eyebrow': 'Sell Abroad · demand side',
  'home.tr.sl.title': 'A fair list is not a buyer list.',
  'home.tr.sl.lead':
    'Know who is worth meeting before you travel, including companies outside the fair list. Pick your market: the example, the currency and the notes below follow it.',
  'home.tr.sl.t1': 'Who is actually worth meeting',
  'home.tr.sl.t2': 'Getting access to them',
  'home.tr.sl.t3': 'Whether a trade fair pays for itself',
  'home.tr.sl.t4': 'Buyers who never appear on the fair list',
  'home.tr.mk.legend': 'Your market',
  'home.tr.mk.eu': 'EU',
  'home.tr.mk.gb': 'UK',
  'home.tr.mk.us': 'US',
  'home.tr.mk.au': 'Australia',
  'home.tr.mk.asia': 'Key Asian Markets',
  'home.tr.mk.side.to': 'to',
  'home.tr.mk.eu.to': 'the EU',
  'home.tr.mk.gb.to': 'the UK',
  'home.tr.mk.us.to': 'the US',
  'home.tr.mk.au.to': 'Australia',
  'home.tr.mk.asia.to': 'key Asian markets',
  'home.tr.mk.eu.brief':
    'Spain first, with a stand at a trade fair in Madrid, then meetings in France and Italy. Capacity about 20,000 pieces a month.',
  'home.tr.mk.gb.brief':
    'A stand at a trade fair in Manchester, then meetings in Leeds, Bristol and Glasgow. Capacity about 20,000 pieces a month.',
  'home.tr.mk.us.brief':
    'A stand at a trade fair in Chicago, then meetings in Atlanta, Dallas and Portland. Capacity about 20,000 pieces a month.',
  'home.tr.mk.au.brief':
    'A stand at a trade fair in Melbourne, then meetings in Sydney, Brisbane and Perth. Capacity about 20,000 pieces a month.',
  'home.tr.mk.asia.brief':
    'A stand at a trade fair in Singapore, then meetings in Tokyo, Seoul and Kuala Lumpur. Capacity about 20,000 pieces a month.',
  'home.tr.mk.eu.line.head': 'The EU is a bloc, not a country.',
  'home.tr.mk.eu.line':
    'National laws stay separate inside it, so a buyer in Lyon and a buyer in Milan are read one country at a time.',
  'home.tr.mk.gb.line.head': 'The UK is read as a market of its own.',
  'home.tr.mk.gb.line':
    'Buyers from Manchester to Glasgow are qualified one by one against your request, not against a list.',
  'home.tr.mk.us.line.head': 'The US is a big country to cover in one trip.',
  'home.tr.mk.us.line':
    'The shortlist starts from the cities and sales channels in your request, not from the whole map.',
  'home.tr.mk.au.line.head': 'From Dhaka, Australia is a long trip.',
  'home.tr.mk.au.line':
    'Knowing who is worth meeting before you fly matters more when each extra day away is expensive.',
  'home.tr.mk.asia.line.head': 'Key Asian Markets are several countries, not one.',
  'home.tr.mk.asia.line':
    'Tell us which, and each is read on its own: Singapore, Tokyo, Seoul and Kuala Lumpur are different conversations.',
  'home.tr.w.title': 'Who is worth meeting?',
  'home.tr.w.brief': 'Example request',
  'home.tr.w.brief.lead': 'Knitwear for mid-price retail.',
  'home.tr.w.steps': 'Step through what changes',
  'home.tr.w.step1': 'The fair list',
  'home.tr.w.step2': 'Checked against your request',
  'home.tr.w.step3': 'Show companies outside the fair list',
  'home.tr.w.sum1':
    'names on the fair list, all presented the same way. A list tells you who paid for a stand, not who buys what you make.',
  'home.tr.w.sum2':
    'of 8 fit this request. The other 6 are not a fit, each with a reason you can check.',
  'home.tr.w.sum3':
    'worth meeting: 2 from the fair list, and 3 that were never on it. Each one says how it is known.',
  'home.tr.w.aria': 'Example companies: fair list compared with a qualified list',
  'home.tr.w.col.company': 'Company',
  'home.tr.w.col.fair': 'On the fair list as',
  'home.tr.w.col.read': "Corridra's read for this request",
  'home.tr.w.notChecked': 'Not checked yet',
  'home.tr.w.worth': 'Worth meeting',
  'home.tr.w.notFit': 'Not a fit',
  'home.tr.w.off': 'Not on the fair list',
  'home.tr.w.example': 'Example.',
  'home.tr.w.note':
    'All company names are invented, for every market. Any likeness to a real company is accidental. Trust labels show how each line would be known: {selfDeclared}, {evidence} or {verified}.',
  'home.tr.w.as.0': 'Retail chain, womenswear',
  'home.tr.w.as.1': 'Yarn spinner',
  'home.tr.w.as.2': 'Knitwear brand',
  'home.tr.w.as.3': 'Fabric wholesaler',
  'home.tr.w.as.4': 'Home textiles',
  'home.tr.w.as.5': 'Printing services',
  'home.tr.w.as.6': 'Fashion agency',
  'home.tr.w.as.7': 'Luxury knitwear',
  'home.tr.w.why.0': 'Buys mid-price knitwear and already sources from South Asia.',
  'home.tr.w.why.1': 'Sells yarn. Does not buy finished knitwear.',
  'home.tr.w.why.2':
    'Owns a brand and outsources production. Its stated minimum order fits your capacity.',
  'home.tr.w.why.3': 'Buys woven fabric, not knitwear.',
  'home.tr.w.why.4': 'Home textiles only. Outside your product.',
  'home.tr.w.why.5': 'Sells a service to brands. Not a buyer.',
  'home.tr.w.why.6': 'Says it is tied to one supplier this season.',
  'home.tr.w.why.7': 'Price point far above your range.',
  'home.tr.w.note.f0': 'Shared recent purchase orders',
  'home.tr.w.note.f2': 'Stated in its first reply',
  'home.tr.w.out.why.0': 'Supplies independent shops and is looking for a second knitwear source.',
  'home.tr.w.out.why.1': 'Private-label importer for department stores. Not exhibiting this year.',
  'home.tr.w.out.why.2': "Children's knitwear brand buying from Asian suppliers today.",
  'home.tr.w.note.o0': 'Stated by the company',
  'home.tr.w.note.o1': 'Registry record and address checked',
  'home.tr.w.note.o2': 'Shared supplier invoices, prices hidden',
  // Fair cost calculator
  'home.tr.fc.title': 'What would one unproductive fair cost you?',
  'home.tr.fc.lead':
    'Put in your own numbers. Nothing is stored or sent. It all stays on this page.',
  'home.tr.fc.currency': 'Currency for every amount',
  'home.tr.fc.cur.eu': 'Set to EUR for the EU.',
  'home.tr.fc.cur.gb': 'Set to GBP for the UK.',
  'home.tr.fc.cur.us': 'Set to USD for the US.',
  'home.tr.fc.cur.au': 'Set to AUD for Australia.',
  'home.tr.fc.cur.change': 'Change it to the currency you budget in. Nothing is converted.',
  'home.tr.fc.cur.asia':
    'Set to USD, because key Asian markets use several currencies. Choose SGD or BDT if that is how you budget. Nothing is converted.',
  'home.tr.fc.cur.kept':
    'Kept in {cur} because you have typed amounts. Nothing is converted. Change the currency yourself if you need to.',
  'home.tr.fc.cur.read': 'Every amount is read as {cur}. Nothing is converted.',
  'home.tr.fc.people': 'People going',
  'home.tr.fc.days': 'Days away, with travel',
  'home.tr.fc.stand': 'Stand and registration, total',
  'home.tr.fc.flight': 'Flights per person',
  'home.tr.fc.hotel': 'Hotel per person per night',
  'home.tr.fc.samples': 'Samples and shipping, total',
  'home.tr.fc.meet': 'Useful buyer meetings you expect',
  'home.tr.fc.help':
    'Enter every amount in the same currency. Nothing is converted between currencies. Hotel is counted for each person on each day away. Lost working days at home are not counted, so the real figure is higher.',
  'home.tr.fc.err.digits': 'Use digits only.',
  'home.tr.fc.err.zero': 'Use 0 or more.',
  'home.tr.fc.err.whole': 'Use a whole number.',
  'home.tr.fc.err.large': 'That looks too large. Check the number.',
  'home.tr.fc.left': 'Left out until fixed: {names}.',
  'home.tr.fc.result': 'Your fair, before any buyer orders',
  'home.tr.fc.total': 'Total',
  'home.tr.fc.total.in': 'Your total, in {cur}',
  'home.tr.fc.add': 'Add your numbers',
  'home.tr.fc.b.stand': 'Stand and registration',
  'home.tr.fc.b.flights': 'Flights',
  'home.tr.fc.b.hotel': 'Hotel',
  'home.tr.fc.b.samples': 'Samples and shipping',
  'home.tr.fc.b.meeting': 'Per useful meeting',
  'home.tr.fc.b.none': 'Not added',
  'home.tr.fc.b.addMeet': 'Add expected meetings',
  'home.tr.fc.frame': 'This is what a fair costs before a single buyer has ordered anything.',
  'home.tr.fc.frame.n': 'That is {amount} spent before a single buyer has ordered anything.',
  'home.tr.fc.half':
    'With {m} useful meetings, each one costs {each}. If only {half} of them turn out to be with the right people, each costs {each2}.',
  'home.tr.fc.one': 'With one useful meeting, that one meeting carries the whole cost.',
  'home.tr.fc.after':
    'A planned mission works on the meetings, so more of them are with companies that fit, on the fair list or off it.',
  'home.tr.fc.cta': 'Plan a Mission for This Fair',
  // Delegation
  'home.tr.dl.eyebrow': 'For organisers · delegations and programmes',
  'home.tr.dl.title': 'One programme. Many companies. Each one private.',
  'home.tr.dl.lead':
    "Chambers, trade bodies and delegation leaders see how the programme is moving, without opening any company's private mission.",
  'home.tr.dl.aria': 'Example programme view for an organiser',
  'home.tr.dl.col.company': 'Company',
  'home.tr.dl.col.defined': 'Defined',
  'home.tr.dl.col.matched': 'Matched',
  'home.tr.dl.col.met': 'Met',
  'home.tr.dl.col.offers': 'Offers',
  'home.tr.dl.col.followed': 'Followed up',
  'home.tr.dl.private': 'Company {n}, private',
  'home.tr.dl.done': 'Done',
  'home.tr.dl.notYet': 'Not yet',
  'home.tr.dl.total': 'Programme total: 4 companies, 3 met at least one counterpart',
  'home.tr.dl.key':
    'Filled circle: stage done. Empty circle: not yet. Names, offers and notes stay with each company.',
  'home.tr.dl.sees': 'The organiser sees',
  'home.tr.dl.sees.1': 'Which stage each company has reached',
  'home.tr.dl.sees.2': 'Programme totals and overall outcomes',
  'home.tr.dl.sees.3': 'Activity each company allows to be shared',
  'home.tr.dl.not': 'The organiser does not see',
  'home.tr.dl.not.1': 'Who each company is talking to',
  'home.tr.dl.not.2': 'Prices, offers and private notes',
  'home.tr.dl.not.3': 'Anything a company has not permitted',
  'home.tr.dl.cta': 'Plan My Programme',
  // Something else
  'home.tr.ot.eyebrow': 'Something else',
  'home.tr.ot.title': 'Tell us what is coming up. We say plainly if we can help.',
  'home.tr.ot.lead':
    'A trip, a purchase, a fair or a first look at a new market. For a route outside the open list, no operating offer is announced. Ask us, and we tell you plainly in the first conversation whether we can help.',
  'home.tr.ot.cta': 'Describe It in a Request',
  // Mission line
  'home.tr.ms.eyebrow': 'How it works, on every route',
  'home.tr.ms.title': 'One mission, from first intent to repeat business.',
  'home.tr.ms.lead':
    'A mission is what Corridra organises around. It has a clear goal, the people who matter, the evidence, the meetings, the offers, and what became of them.',
  'home.tr.ms.list': 'Mission steps',
  'home.tr.ms.s0': 'Intent',
  'home.tr.ms.s1': 'Requirement',
  'home.tr.ms.s2': 'Market',
  'home.tr.ms.s3': 'Discovery',
  'home.tr.ms.s4': 'Qualification',
  'home.tr.ms.s5': 'Access',
  'home.tr.ms.s6': 'Meeting or visit',
  'home.tr.ms.s7': 'Opportunity',
  'home.tr.ms.s8': 'Price quote or price request (RFQ)',
  'home.tr.ms.s9': 'Proposal',
  'home.tr.ms.s10': 'Contract',
  'home.tr.ms.s11': 'Invoice',
  'home.tr.ms.s12': 'Cash',
  'home.tr.ms.s13': 'Repeat',
  'home.tr.ms.optional': 'optional',
  'home.tr.ms.note':
    'Dashed steps are optional. A mission can start from a quote, and it can end well with a decision not to enter.',
  'home.tr.nv.1': 'A scheduled meeting is not a meeting held.',
  'home.tr.nv.1.text': 'Each step has its own record.',
  'home.tr.nv.2': 'An RFQ is not a purchase.',
  'home.tr.nv.2.text': 'Interest and commitment stay apart.',
  'home.tr.nv.3': 'A contract is not cash.',
  'home.tr.nv.3.text': 'Money is counted only when it arrives.',
  'home.tr.nv.4': 'A claim is not proof.',
  'home.tr.nv.4.text': 'A supplier saying it is not Corridra checking it.',
  // Start a request, three goals
  'home.tr.br.eyebrow': 'Small first step',
  'home.tr.br.title': 'Start your request in about a minute.',
  'home.tr.br.lead':
    'Pick the goal that fits. The request opens with that goal chosen. No account, no form wall, and nothing is sent until you press Send.',
  'home.tr.br.goals': 'What is the goal?',
  'home.tr.br.g.china': 'Buy from China',
  'home.tr.br.g.machinery': 'Buy machinery',
  'home.tr.br.g.sell': 'Find buyers abroad',
  'home.tr.br.g.fair': 'Get more from a trade fair abroad',
  'home.tr.br.g.delegation': 'Run a delegation',
  'home.tr.br.g.other': 'Something else',
  'home.tr.br.next': 'What happens next',
  'home.tr.br.next.text':
    'A person reads it, asks a few questions, then sends you a quote for that work. Nothing starts until you agree.',
  // Trust
  'home.tr.tr.eyebrow': 'Trust, on every route',
  'home.tr.tr.title': 'Every fact says how it is known.',
  'home.tr.tr.lead':
    "A supplier's claim in Foshan and a buyer's interest in Manchester or Madrid get the same five labels. Each label is always an icon and a word.",
  'home.tr.tr.derived': 'Worked out from available data.',
  'home.tr.tr.outcome': 'A real result was recorded.',
  'home.tr.tr.ledger': 'Example history ledger',
  'home.tr.tr.ledger.title': 'History: what happened stays what happened',
  'home.tr.tr.day1': 'Day 1',
  'home.tr.tr.day1.text': 'Request received',
  'home.tr.tr.day6': 'Day 6',
  'home.tr.tr.day6.text': 'Offer received, revision 1, USD 36,800',
  'home.tr.tr.day11': 'Day 11',
  'home.tr.tr.day11.text': 'Correction: revision 2, USD 37,400.',
  'home.tr.tr.day11.kept': 'Revision 1 is kept.',
  'home.tr.tr.newEntry': 'New entry',
  // People
  'home.tr.pe.eyebrow': 'Who it is for',
  'home.tr.pe.title': 'Eight people. One clear promise each.',
  'home.tr.pe.aria': 'Who are you?',
  'home.tr.pe.give': 'You give',
  'home.tr.pe.get': 'You get',
  'home.tr.pe.0': 'Exporter',
  'home.tr.pe.1': 'Importer',
  'home.tr.pe.2': 'Machinery buyer',
  'home.tr.pe.3': 'Company entering Bangladesh',
  'home.tr.pe.4': 'Overseas buyer',
  'home.tr.pe.5': 'Supplier',
  'home.tr.pe.6': 'Delegation leader',
  'home.tr.pe.7': 'Local helper',
  'home.tr.pe.0.give':
    'Your product. How much you can make. The market you want and your goals. Travel details if you have them.',
  'home.tr.pe.0.get':
    'A list of who to meet and why. The right people and meetings. A view that shows its proof. Progress you can show.',
  'home.tr.pe.1.give':
    'What you need. The category, quantity, budget and specifications. Optional trip details.',
  'home.tr.pe.1.get':
    'Supplier research and qualification. Original quotations. Side-by-side comparisons. Visit coordination. A structured buying decision.',
  'home.tr.pe.2.give':
    'What the machine is for. The capacity you need. Your technical and commercial limits.',
  'home.tr.pe.2.get':
    'Machinery options you can compare. The evidence still missing. Factory and engineering visit support. Follow-through after.',
  'home.tr.pe.3.give':
    'What you offer. The customers or channels you prefer. What you want from entering Bangladesh.',
  'home.tr.pe.3.get':
    'A structured market assessment. Potential customers and distributors. Local validation. Qualified access. Accountable delivery.',
  'home.tr.pe.4.give': 'The exact supplier you need, and how you screen them.',
  'home.tr.pe.4.get':
    'A shortlist with reasons and doubts. The evidence behind each name. Visit and meeting support.',
  'home.tr.pe.5.give': 'Nothing to start. You do not need to register to consider an introduction.',
  'home.tr.pe.5.get':
    'A specific, permitted requirement or introduction. You can say it is relevant. You can ask for details. You answer within what you can see.',
  'home.tr.pe.6.give': 'Your programme, and the group you lead. Each company brings its own goals.',
  'home.tr.pe.6.get':
    "What is happening across the programme and the overall outcomes, without access to any company's private data.",
  'home.tr.pe.7.give': 'Your skills. Your time. Your location.',
  'home.tr.pe.7.get':
    'Clearly defined tasks, with eligibility, deadline, expected evidence and reward stated first. Plus review, attribution and a way to dispute a decision.',
  // FAQ
  'home.tr.fq.eyebrow': 'Straight answers',
  'home.tr.fq.title': 'Questions people ask before they start.',
  'home.tr.fq.1.q': 'Who is Corridra?',
  'home.tr.fq.1.a1':
    'A cross-border market access service. We run missions for companies in Bangladesh that buy from China or sell to the EU, the UK, the US, Australia and key Asian markets: we find the companies that matter, check what they claim, compare offers and set up meetings and visits.',
  'home.tr.fq.1.a2': 'For any other route, we say plainly whether we can help.',
  'home.tr.fq.2.q': 'Which markets do you work in?',
  'home.tr.fq.2.a1':
    'From Bangladesh, we run missions to China for buying, and to the EU, the UK, the US, Australia and key Asian markets for selling.',
  'home.tr.fq.2.l1': 'Open now: those routes, from Bangladesh.',
  'home.tr.fq.2.l2': 'Selective: the reverse directions, into Bangladesh, taken case by case.',
  'home.tr.fq.2.l3': 'Any other route: ask us. We tell you plainly if we can help.',
  'home.tr.fq.2.a2':
    'The page has two big doors because buying and selling are opposite problems: too many suppliers to compare, or too few buyers worth meeting.',
  'home.tr.fq.3.q': 'What does it cost?',
  'home.tr.fq.3.a1':
    'Missions are paid and planned around what you need. After a short conversation we send you a quote for that mission. We do not publish prices, because checking two suppliers and comparing a full machinery purchase are different pieces of work.',
  'home.tr.fq.3.a2': 'You see the quote and decide before any work starts.',
  'home.tr.fq.4.q': 'Will you replace my agent, my chamber or my fair?',
  'home.tr.fq.4.a1':
    'No. Keep the people you trust. Corridra works alongside your agent, your suppliers, chambers and fairs, and fills the gaps: who else is worth meeting, what an offer leaves out, and what happened after each meeting.',
  'home.tr.fq.5.q': 'Do you work with chambers and trade bodies?',
  'home.tr.fq.5.a1':
    'We want to, and the delegation view is built for them. We do not name any organisation as a partner unless it has agreed, and none is named on this page.',
  'home.tr.fq.6.q': 'Is my data safe?',
  'home.tr.fq.6.a1': 'These are the rules the product is built to:',
  'home.tr.fq.6.l1': 'Your mission is visible only to the people you allow.',
  'home.tr.fq.6.l2': 'Every access is checked on our server, with the least access needed.',
  'home.tr.fq.6.l3': 'Sensitive actions need a person to approve them.',
  'home.tr.fq.6.l4': 'Shared links are limited and expire.',
  'home.tr.fq.6.l5': 'Logs avoid personal details.',
  'home.tr.fq.6.a2':
    'These are principles we hold, not a certification. We will not claim one we do not have.',
  'home.tr.fq.7.q': 'Do you arrange visas or hotels?',
  'home.tr.fq.7.a1':
    'No. We do not arrange visas, hotels or tourism, and we cannot promise any visa outcome. We work on who to meet, what to compare, and what happens next.',
  'home.tr.fq.8.q': 'What happens after I send a request?',
  'home.tr.fq.8.a1':
    'A person reads your request and contacts you with a few questions. After a short conversation you get a quote for that work. Nothing starts until you agree to it, and you can stop at any point before that.',
  // Route statuses and what Corridra is not
  'home.tr.rs.eyebrow': 'Route statuses',
  'home.tr.rs.title': 'Open routes now. Plain answers on the rest.',
  'home.tr.rs.match': 'Matches your route',
  'home.tr.rs.china.text':
    'Buying goods and machines. Quotes set side by side. Factory and showroom visits. Trips to the Canton Fair and other trade shows.',
  'home.tr.rs.sell.text':
    'Reaching export buyers. Help to find distributors. Getting more from trade fairs, one market at a time.',
  'home.tr.rs.rev': 'Into Bangladesh',
  'home.tr.rs.rev.text':
    'The reverse directions are routes of their own, taken case by case. They run from China, or from any of the selling markets, into Bangladesh.',
  'home.tr.rs.other': 'Any other route',
  'home.tr.rs.other.sub': 'No operating offer announced',
  'home.tr.rs.other.text':
    'Routes outside the open list can be added by configuration, not rebuilt. Ask us. We tell you plainly if we can help.',
  'home.tr.rs.open': 'Open now',
  'home.tr.rs.page.china': 'China Route Page',
  'home.tr.rs.page.eu': 'EU Route Page',
  'home.tr.rs.selective': 'Selective',
  'home.tr.rs.ask': 'Ask us',
  'home.tr.rs.and': 'and key Asian markets',
  'home.tr.rs.ready': 'Readiness has separate statuses. It is never one "complete".',
  'home.tr.rs.ready.1': 'Built',
  'home.tr.rs.ready.2': 'Tested',
  'home.tr.rs.ready.3': 'Deployed',
  'home.tr.rs.ready.4': 'Enabled',
  'home.tr.rs.ready.5': 'Legally approved',
  'home.tr.rs.ready.6': 'Commercially operating',
  'home.tr.rs.ready.end':
    '"Open now" means we take and run missions on those routes today. It does not claim any single status above, such as legal approval, for any route.',
  'home.tr.not.title': 'What Corridra is not.',
  'home.tr.not.1': 'Not a directory.',
  'home.tr.not.1.text': 'A list of names is not access.',
  'home.tr.not.2': 'Not a marketplace.',
  'home.tr.not.2.text': 'We are not trying to replace one.',
  'home.tr.not.3': 'Not a CRM or an ERP.',
  'home.tr.not.3.text': 'We feed your tools, we do not replace them.',
  'home.tr.not.4': 'Not a travel agency or visa service.',
  'home.tr.not.4.text': 'Tourism and visas are not our work.',
  'home.tr.not.5': 'Not a mass-outreach engine.',
  'home.tr.not.5.text': 'No unsolicited messages on your behalf.',
  'home.tr.not.6': 'Not an autonomous negotiator.',
  'home.tr.not.6.text': 'People decide, always.',
  'home.tr.not.7': 'Not a payment processor or lender.',
  'home.tr.not.7.text': 'We record money. We do not move it.',
  'home.tr.not.8': 'Not a social network.',
  'home.tr.not.8.text': 'Introductions have a purpose and clear limits.',
  // Close
  'home.tr.fn.eyebrow': 'Start now, decide later',
  'home.tr.fn.title.none': 'Begin with one question: what do you want to do abroad?',
  'home.tr.fn.title.china':
    'The sourcing trip is coming either way. Arrive knowing which suppliers matter.',
  'home.tr.fn.title.sell': 'The fair is coming either way. Arrive knowing who is worth meeting.',
  'home.tr.fn.title.delegation':
    'The programme is coming either way. Give each company its own plan.',
  'home.tr.fn.title.other':
    'Whatever is coming up, start with a plain answer on whether we can help.',
  'home.tr.fn.r1': 'Nothing is sent until you check your request.',
  'home.tr.fn.r1.text': 'Your answers stay with you until then.',
  'home.tr.fn.r2': 'Stop any time.',
  'home.tr.fn.r2.text': 'No account, no commitment to start a request.',
  'home.tr.fn.r3': 'We tell you if we cannot help.',
  'home.tr.fn.r3.text': 'Plainly, and early.',
  'home.tr.more.how': 'See the Full Process',
  'home.tr.fn.jobs': 'Or go straight to your request:',
} as const;

// Words added for the home page as the owner's board 3c in full (LP3, owner, 18 November 2026: "why didnt we implement
// ... with all the provided feedbacks and updates here?"). English is the source. The board's Bangla, Chinese and
// Spanish hero lines (homeBoardDrafts below) are shown only while that language's page words are released, with no
// note on the page (owner, 23 November 2026); every other language shows these English words.
const homeBoardEn = {
  'home.b3.hero.china.title': 'Go to China knowing which suppliers deserve your time.',
  'home.b3.hero.china.sub':
    'Many suppliers, few you can compare. We find and check suppliers, put their original quotes side by side, and plan factory visits in Guangzhou, Foshan, Shenzhen or Yiwu.',
  'home.b3.hero.sell.title': 'Know who is worth meeting before you travel.',
  'home.b3.hero.sell.sub':
    'Including companies outside the fair list. We research buyers and distributors in the EU, the UK, the US, Australia and key Asian markets, check what they claim, and help you set up meetings worth the flight.',
  'home.b3.hero.delegation.title': 'Give every company in your delegation its own plan.',
  'home.b3.hero.delegation.sub':
    'Each company keeps a private mission with its own targets and meetings. You see programme activity and overall outcomes, never their private data.',
  'home.b3.hero.other.title': 'Tell us what is coming up. We say plainly if we can help.',
  'home.b3.hero.other.sub':
    'A trip, a purchase, a fair or a first look at a new market. Describe it in your own words. If it is not something we do well, we tell you.',
  'home.b3.to': 'to',
  'home.b3.talk': 'Talk to a Person',
  'home.b3.talk.where': '(opens WhatsApp)',
  'home.b3.mbar': 'Quick start',
  'home.b3.mbar.note': 'No account needed. Stop any time.',
  'home.b3.mine': 'Matches your route',
  'home.b3.fc.tooLarge': 'That total looks too large. Check the numbers.',
  'home.b3.rs.ready': 'Each part of being ready is tracked on its own, never as one "complete":',
  // The brief: three answers that build a draft the visitor owns, then open the real request form with them.
  'home.b3.br.title': 'Your first request in 60 seconds.',
  'home.b3.br.lead':
    'Three answers. Watch your request build as you answer. No account, no form wall.',
  'home.b3.br.need': 'What do you need?',
  'home.b3.br.need.help':
    'In your own words, any language. Product, quantity, budget, places, people. Rough is fine.',
  'home.b3.br.when': 'When is it happening?',
  'home.b3.br.when.1': 'Within a month',
  'home.b3.br.when.2': 'In 1 to 3 months',
  'home.b3.br.when.3': 'In 3 to 6 months',
  'home.b3.br.when.4': 'Not decided yet',
  'home.b3.br.stamp': 'Not sent yet',
  'home.b3.br.card': 'Your request',
  'home.b3.br.count': '{n} of 3 answered',
  'home.b3.br.dt.chosen': 'Route chosen',
  'home.b3.br.dt.goal': 'Goal',
  'home.b3.br.dt.route': 'Route',
  'home.b3.br.dt.need': 'What you need',
  'home.b3.br.dt.when': 'Timing',
  'home.b3.br.dt.next': 'What happens next',
  'home.b3.br.next':
    'A person reads it, asks a few questions, then sends you a quote for that work. Nothing starts until you agree.',
  'home.b3.br.ns': 'Not stated yet',
  'home.b3.br.stated': 'stated by you',
  'home.b3.br.send':
    'Nothing is sent from this page. Start a Request opens the request form with these answers, and you send it from there.',
  'home.b3.br.whatsapp': 'Message Us on WhatsApp',
  'home.b3.br.goal.china': 'Buy from China on a sourcing trip',
  'home.b3.br.goal.machinery': 'Buy machinery and compare offers like for like',
  'home.b3.br.goal.sell': 'Find buyers or distributors abroad',
  'home.b3.br.goal.fair': 'Get more from a trade fair abroad',
  'home.b3.br.goal.delegation': 'Run a delegation or programme',
  'home.b3.br.goal.other': 'Something else',
  'home.b3.br.route.china': 'Bangladesh to China',
  'home.b3.br.route.sell': 'Bangladesh to {market}',
  'home.b3.br.route.sellAny': 'Bangladesh to one of the open markets. Tell us which comes first.',
  'home.b3.br.route.delegation': 'To agree with you',
  'home.b3.br.route.other': 'Tell us. We say plainly if we can help.',
  'home.b3.br.ph.none': 'Example: what you want to buy or sell, how much, and where.',
  'home.b3.br.ph.china':
    'Example: 5,000 cotton tote bags with our logo. Samples first, then visit two factories.',
  'home.b3.br.ph.machinery':
    'Example: two dyeing machines, installed, with staff training at our factory.',
  'home.b3.br.ph.sell':
    'Example: knitwear for mid-price retail. We want meetings outside the fair list too.',
  'home.b3.br.ph.fair':
    'Example: we have a stand at a trade fair in {city} and want meetings with buyers who fit, before we fly.',
  'home.b3.br.ph.delegation':
    'Example: twelve companies from different sectors. Each needs its own meetings.',
  'home.b3.br.ph.other': 'Describe it in your own words.',
  'home.b3.mkto.eu': 'the EU',
  'home.b3.mkto.gb': 'the UK',
  'home.b3.mkto.us': 'the US',
  'home.b3.mkto.au': 'Australia',
  'home.b3.mkto.asia': 'key Asian markets',
  // The visitor's answers, written into the request form's notes field (they read and can change them there).
  'home.b3.note.route': 'Route',
  'home.b3.note.need': 'What I need',
  'home.b3.note.when': 'Timing',
} as const;

// The keys of the board's own hero lines (revision 3c) in Bangla, Chinese and Spanish. The words are in lang/<code>.ts.
const homeBoardKeys = [
  'home.tr.lead',
  'home.tr.q',
  'home.tr.cta.none',
  'home.tr.cta.china',
  'home.tr.cta.sell',
  'home.tr.cta.delegation',
  'home.tr.cta.other',
  'home.tr.door.china.title',
  'home.tr.door.sell.title',
  'home.tr.door.delegation.title',
  'home.tr.door.other.title',
  'home.b3.talk',
  'home.b3.hero.china.title',
  'home.b3.hero.china.sub',
  'home.b3.hero.sell.title',
  'home.b3.hero.sell.sub',
  'home.b3.hero.delegation.title',
  'home.b3.hero.delegation.sub',
  'home.b3.hero.other.title',
  'home.b3.hero.other.sub',
] as const;

export const homeEn = {
  ...homeBoardEn,
  ...homeLandingEn,
  ...homeTwoEn,
  'home.country.bd': 'Bangladesh',
  'home.country.cn': 'China',
  'home.country.es': 'Spain',
  'home.other.title': 'Another route?',
  'home.other.text': 'No operating offer announced. We tell you plainly if we can help.',
  'home.eyebrow': 'Cross-border market access',
  'home.title': 'Make market entry deliberate.',
  'home.jobs.aria': 'Choose your commercial objective',
  'home.start.sell.title': 'Sell my products',
  'home.start.sell.text': 'Find buyers and partners abroad.',
  'home.start.sell.name': 'Find Buyers & Partners',
  'home.start.buy.title': 'Buy products or machines',
  'home.start.buy.text': 'Find suppliers. Compare price quotes.',
  'home.start.buy.name': 'Find Suppliers & Products',
  'home.start.trip.title': 'Lead a group trip',
  'home.start.trip.text': 'Plan the programme and the meetings.',
  'home.start.trip.name': 'Organise a Delegation',
  'home.else': 'Something else? Tell us your business goal',
  'home.calm.account': 'No account needed to begin',
  'home.value.notConfirmed': 'Not confirmed',
  'home.fact.selfDeclared': 'Stated by the company.',
  'home.fact.evidence': 'Proof was provided.',
  'home.fact.verified': 'Checked by a defined process.',
  'home.facts.more': 'How We Label Facts',
  'home.other.link': 'Explore Every Route',
};

export type HomeKey = keyof typeof homeEn;

/** The home page words in every other language (lang/<code>.ts), English where a language has none yet. */
export const homeWords = inEveryLanguage<Record<HomeKey, string>>(homeEn);

/** The board's hero lines as Bangla, Chinese and Spanish have them. */
export const homeBoardDrafts = Object.fromEntries(
  (['bn', 'zh', 'es'] as const).map((code) => [
    code,
    Object.fromEntries(homeBoardKeys.map((key) => [key, homeWords[code][key]])),
  ]),
) as Record<'bn' | 'zh' | 'es', Record<(typeof homeBoardKeys)[number], string>>;
