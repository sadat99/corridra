// Message text. English is the source: its keys define what every other language must provide, and
// a missing or empty entry falls back to English. Brand and company names stay as written. Each other
// language keeps all of its words in one file, lang/<code>.ts; this file holds English only.
import { organiseEntryWords } from './organise-entry-words';
import { sellWords } from './sell-words';
import { consequenceEn } from './consequence-words';
import { privacyEn } from './privacy-words';
import { defaultLocale, type Locale } from './locales';
import { languageWords, type LanguageWords } from './lang';
import { topBarEn } from './top-bar-words';
import { homeEn } from './home-words';
import { programmePagesWords } from './programme-pages-words';
import { wsAEn } from './ws/ws-a';
import { wsBEn } from './ws/ws-b';
import { wsCEn } from './ws/ws-c';
import { wsDEn } from './ws/ws-d';
import { wsEEn } from './ws/ws-e';

/**
 * Trip view words (Room, GAP-034). English placeholder until native review (D16): every catalog carries
 * these English words, so no unreviewed translation is shown. The review replaces them one language at a time.
 */
const tripWords = {
  'mr.road.stepOf': 'Step {n} of {total}',
  'mr.road.join': ', ',
  'room.lens.trip': 'Trip',
  'room.trip.heading': 'Your meetings and visits',
  'room.trip.line':
    'These are the meetings and visits the Corridra team has reviewed for this request. Times are shown in the time zone of each place. Nothing is booked from this page.',
  'room.trip.count.one': '1 meeting or visit',
  'room.trip.count.other': '{count} meetings or visits',
  'room.trip.starts': 'Starts',
  'room.trip.ends': 'Ends',
  'room.trip.place': 'Place',
  'room.trip.noTime': 'No confirmed time yet.',
  'room.trip.noPlace': 'Not shared yet',
  'room.trip.changedBadge': 'Date changed',
  'room.trip.changed':
    'The date or time has changed. We do not show the old time. Ask the Corridra team for the new one.',
  'room.trip.empty':
    'No meetings or visits are ready to show yet. They appear here after the Corridra team reviews them.',
  'room.trip.noReport':
    'Your meetings and visits appear here once the Corridra team delivers a report for this request and you save it.',
  'room.trip.all': 'Show All {count} Meetings and Visits',
  'room.trip.fewer': 'Show Fewer',
  'room.trip.status.proposed': 'Suggested',
  'room.trip.status.accepted': 'Accepted',
  'room.trip.status.scheduled': 'Time confirmed',
  'room.trip.status.held': 'Done',
  'room.trip.status.declined': 'Declined',
  'room.trip.status.cancelled': 'Cancelled',
  'room.trip.status.noShow': 'Missed',
  'room.trip.status.rescheduleRequired': 'New time needed',
} as const;

/**
 * Trip Book and Supplier Book download panel words (saved mission page, ADR-076). English placeholder until
 * native review (D16): every catalog carries these English words, so no unreviewed translation is shown. The
 * panel sits in the page's English frame. The words never say "digest": the person is given a content code.
 */
const bookWords = {
  'books.heading': 'Download a Trip Book or Supplier Book',
  'books.intro':
    'A book is a PDF copy of what the Corridra team has reviewed for this mission. It shows no prices, offers or contact details.',
  'books.notice':
    'A downloaded file cannot be recalled. If access is withdrawn later, the file stays on your device and with anyone you send it to.',
  'books.count.line': 'Trip Book: {trip}. Supplier Book: {supplier}.',
  'books.count.trip.one': '1 meeting or visit',
  'books.count.trip.other': '{n} meetings or visits',
  'books.count.supplier.one': '1 company',
  'books.count.supplier.other': '{n} companies',
  'books.count.none': 'none yet',
  'books.name.trip': 'Trip Book',
  'books.name.supplier': 'Supplier Book',
  'books.download.trip': 'Download Trip Book (PDF)',
  'books.download.supplier': 'Download Supplier Book (PDF)',
  'books.empty.trip': 'No meetings or visits have been reviewed yet, so there is no Trip Book.',
  'books.empty.supplier': 'No companies have been reviewed yet, so there is no Supplier Book.',
  'books.busy': 'Preparing your {book}…',
  'books.success':
    'Your {book} was created. Your browser should now save the file. Keep it private.',
  'books.success.detail':
    'Created {time}. Content code {code}. Give this code to the Corridra team if you ask about the file.',
  'books.retry':
    'We could not confirm the download. Try again. It will not create a second record.',
  'books.denied': 'This mission is unavailable or access has changed. Nothing was downloaded.',
  'books.signedOut': 'Your sign-in has ended. Nothing was downloaded.',
  'books.signInAgain': 'Sign in again',
  'books.tooMany': 'Too many downloads for this mission just now. Try again later.',
  'books.changed':
    'The reviewed content changed since you started. This page now shows the latest version. Download again to get it.',
  'books.unavailable':
    'Downloads are not available right now. Nothing was downloaded. Try again later.',
  'books.unsupported':
    'This book cannot be made because it has text the PDF cannot show. Ask the Corridra team for help.',
  'books.emptyStale': 'Nothing has been reviewed for this book yet.',
} as const;

/**
 * Footer words added with the Ledger footer (owner decision of 6 November 2026; regrouped by Option B, owner decision
 * of 12 November 2026, which renamed Groups and Partners to Groups and Trips). These are the English words. The
 * bn, zh, es, ar, fr and de words are in lang/<code>.ts.
 */
const footerWords = {
  'footer.signIn': 'Sign In',
  'footer.already': 'Already working with us?',
  'footer.openWorkspace': 'Open Your Workspace',
  'footer.nav': 'Footer',
  'footer.group.buy': 'Buy Abroad',
  'footer.group.sell': 'Sell and Expand',
  'footer.group.trips': 'Groups and Trips',
  'footer.link.china': 'Bangladesh to China',
  'footer.link.spain': 'Bangladesh to the EU',
  'footer.link.sample': 'See a Sample Mission',
  'footer.link.network': 'Join the Corridra Network',
  'footer.link.routes': 'Explore Every Route',
  'footer.link.howItWorks': 'How It Works',
  'footer.link.privacy': 'Privacy Notice',
  'footer.link.privacyTest': 'Test Intake Notice',
  'footer.facts': 'Every fact says where it comes from:',
  'footer.factsMore': 'How We Label Facts',
  'footer.private': 'Your work stays private to the people given access',
  'footer.routes':
    'Open now from Bangladesh: China, the EU, the UK, the US, Australia, key Asian markets',
} as const;

/**
 * Public header words added with navigation v1 (owner directive of 6 November 2026, boards PublicHeader and
 * PublicMobile). These are the English words, written exactly as the boards write them. The bn, zh, es, ar, fr and
 * de words are in lang/<code>.ts.
 */
const headerWords = {
  'header.whatWeDo': 'What We Do',
  'header.markets': 'Markets',
  'header.trust': 'Trust',
  'header.jobs': 'What Do You Need to Do?',
  'header.job.sell': 'Sell in a New Market',
  'header.job.source': 'Source Products and Suppliers',
  'header.job.machinery': 'Procure Machinery',
  'header.job.machinery.line': 'Find machine makers. Compare quotes.',
  'header.job.tradeMission': 'Run a Trade Mission',
  'header.job.tradeMission.line': 'Plan the programme and the meetings for a group.',
  'header.job.businessTrip': 'Plan a Business Trip',
  'header.job.businessTrip.line': 'Line up the right meetings before you travel.',
  'header.job.enterMarket': 'Enter a New Market',
  'header.job.enterMarket.line': 'Test a market before you commit to it.',
} as const;

// TC1 Today card words. English is the source; the other languages' words are in lang/<code>.ts.
const todayWords = {
  'today.heading': 'Today',
  'today.holds': 'Request held by',
} as const;

/**
 * The site's own name line and description (unit L0). The page is built with the English words (app/layout.tsx
 * metadata), so search and share previews read English; the browser shows the tab title in the chosen language
 * (components/ux/site-title.tsx). Each language's words are in lang/<code>.ts.
 */
export const siteWords = {
  'site.title': 'Corridra | Cross-border market access',
  'site.description':
    'Corridra helps Bangladeshi businesses enter China, the EU, the UK, the US, Australia and key Asian markets with qualified buyers and clear next steps.',
} as const;

export const en = {
  ...homeEn,
  // Commercial readiness stream blocks (one file per stream, so streams never edit the same lines).
  ...wsAEn,
  ...wsBEn,
  ...wsCEn,
  ...wsDEn,
  ...wsEEn,
  skip: 'Skip to content',
  'header.home': 'Corridra home',
  'header.menu': 'Menu',
  'header.menuClose': 'Close',
  'header.nav': 'Main navigation',
  'header.howItWorks': 'How It Works',
  'header.account': 'Your Account',
  'header.workspace': 'Team Workspace',
  'header.signOut': 'Sign Out',
  'header.signingOut': 'Signing Out…',
  'header.signIn': 'Sign In',
  'header.start': 'Start a Request',
  'header.sample': '(Sample Request)',
  'language.label': 'Language',
  'footer.tagline': 'Make market entry deliberate.',
  'footer.companyLabel': 'Corridra',
  'footer.trust': 'Trust and Evidence',
  'footer.about': 'About Corridra',
  'footer.institutions': 'For Institutions',
  'footer.privacy': 'Privacy and request notice',
  'footer.privacyTest': 'Test intake notice',
  'way.source': 'Source Products and Suppliers',
  'way.machinery': 'Procure Machinery',
  'way.tradeMissions': 'Run a Trade Mission',
  'way.businessTrips': 'Plan a Business Trip',
  'way.sell': 'Sell in a New Market',
  'way.enterMarket': 'Enter a New Market',
  'mr.road.title': 'Where this request stands',
  'mr.road.step.define': 'Define',
  'mr.road.step.find': 'Find',
  'mr.road.step.compare': 'Compare',
  'mr.road.step.visit': 'Visit',
  'mr.road.step.decide': 'Decide',
  'mr.road.step.follow': 'Follow through',
  'mr.road.state.done': 'Done',
  'mr.road.state.now': 'Now',
  'mr.road.state.later': 'Later',
  'mr.road.state.notTracked': 'Not tracked yet',
  'mr.road.legend':
    'Done, now, later, or not tracked yet. Not tracked yet means no record exists for that step.',
  'mr.explain.holder.you': 'You need to do the next thing.',
  'mr.explain.holder.team': 'The Corridra team needs to do the next thing.',
  'mr.explain.holder.owner': 'Your workspace owner or an admin needs to do the next thing.',
  'mr.explain.holder.third': 'The supplier or the buyer needs to do the next thing.',
  'mr.explain.state.done': 'This step is finished.',
  'mr.explain.state.now': 'Your request is at this step.',
  'mr.explain.state.later': 'This step has not started.',
  'mr.explain.state.notTracked': 'Nothing has been recorded for this step. That is not zero.',
  'mr.explain.fill.notStated': 'The supplier left this term blank. It is not zero.',
  'mr.explain.fill.notMeasured': 'Corridra has not taken this measure yet.',
  'mr.explain.fill.excluded': 'Shipping is not included in the price.',
  'mr.road.subline.DRAFT': 'The request is saved and not sent yet.',
  'mr.road.subline.QUALIFICATION': 'The Corridra team is checking your requirement.',
  'mr.road.subline.ACTIVE': 'Your request is approved to start.',
  'mr.road.subline.TARGETING': 'The Corridra team is choosing who to approach.',
  'mr.road.subline.OUTREACH': 'The Corridra team is looking for suppliers or buyers.',
  'mr.road.subline.MEETINGS': 'Meetings are being arranged or held.',
  'mr.road.subline.FOLLOW_UP': 'Follow-up is in progress.',
  'mr.road.subline.COMMERCIAL_PIPELINE': 'A commercial step is in progress.',
  'mr.road.subline.CLOSED': 'This request is closed.',
  'mr.road.aside.on_hold':
    'On hold. The Corridra team has paused this request. The step it resumes from is not shown.',
  'mr.road.aside.cancelled': 'This request was cancelled.',
  'mr.road.aside.unknown': 'Status:',
  'mr.holder.you': 'With you',
  'mr.holder.team': 'Corridra team',
  'mr.holder.third': 'Supplier or Buyer',
  'mr.move.due': 'Due',
  'mr.move.explainer': 'A Move is the one thing a person must do next.',
  'mr.move.phrase': '{verb} {object}',
  'mr.verb.read': 'Read',
  'mr.verb.answer': 'Answer',
  'mr.verb.add': 'Add',
  'mr.verb.confirm': 'Confirm',
  'mr.verb.choose': 'Choose',
  'mr.verb.send': 'Send',
  'mr.quote.comparable': 'Comparable on supplied terms',
  'mr.quote.notComparable': 'Not comparable yet',
  'mr.quote.unitPrice': 'Original unit price',
  'mr.quote.total': 'Original total',
  'mr.quote.notStated': 'Not stated',
  'mr.quote.excluded': 'Excluded',
  'mr.quote.notMeasured': 'Not measured yet',
  'mr.quote.revision': 'Offer revision',
  'mr.quote.missing': 'Missing',
  'mr.ghost.example': 'Example',
  'mr.mode.sample': 'Sample',
  'mr.mode.real': 'Real',
  'move.you.heading': 'Waiting for you',
  'move.others.heading': 'Waiting on others',
  'move.card.draft.object': 'your request',
  'move.card.draft.action': 'Open Your Saved Request',
  'move.card.quote.object': 'the quote for your service request',
  'move.card.quote.action': 'Accept or Decline',
  'move.card.company.object': 'evidence for your company link',
  'move.card.company.action': 'Add Evidence',
  'move.card.reply.object': 'the new reply from the Corridra team',
  'move.card.reply.action': 'Open the Request',
  'move.card.reply.read': 'Mark As Read',
  'move.received': 'Request received {date}',
  'move.wait.quote': 'A quote is waiting for a workspace owner or admin to accept or decline it.',
  'move.wait.company':
    'The Corridra team asked for more evidence. A workspace owner or admin can add it.',
  'move.wait.open': 'Open',
  'move.more': 'Show {count} more',
  'move.empty.title': 'Nothing is waiting for you right now.',
  'move.empty.text': 'When something needs you, it will show here.',
  'move.empty.latest': 'Your most recent request',
  'move.start': 'Start a Request',
  'move.forget': 'Forget Which Replies I Have Read on This Device',
  'move.forgotten': 'Done. This device has forgotten which replies you read.',
  'move.wait.owner': 'Workspace owner or admin',
  'move.capped':
    'Showing items from your first {count} workspaces. Open your missions for the rest.',
  'move.partial':
    'Some of your lists were too long to read in full. Open your missions to see everything.',
  'compare.sideBySide': 'Side by Side',
  'compare.table': 'Table',
  'compare.note':
    'The verdict on each quote comes from the comparison itself. The table shows the original terms side by side.',
  'compare.heading': 'Compare quotes',
  'compare.summary':
    '{count} quotes · {comparable} comparable · {notComparable} not comparable yet',
  'compare.summaryOne': '1 quote · {comparable} comparable · {notComparable} not comparable yet',
  'compare.diffOnly': 'Differences Only',
  'compare.sameBoth': '{count} terms are the same in both.',
  'compare.sameBothOne': '1 term is the same in both.',
  'compare.sameAll': '{count} terms are the same in all {total} quotes.',
  'compare.sameAllOne': '1 term is the same in all {total} quotes.',
  'compare.onlyOne': 'There is only one quote so far, so there is nothing to compare yet.',
  'compare.showAll': 'Show Them',
  'compare.shownAll': 'Showing every term',
  'compare.region': 'Quotes side by side',
  'compare.regionReport': 'Quotes side by side in the report',
  'compare.cueScroll': '{total} suppliers. Scroll sideways to see them all.',
  'compare.cueSeen': 'You have seen all {total} suppliers.',
  'compare.terms': 'Terms',
  'compare.comparable': 'Comparable',
  'compare.earlier': 'Earlier quote',
  'compare.notStatedLine': 'Left blank. It is not zero.',
  'compare.excludedLine': 'Not part of the price.',
  'compare.money': 'Prices stay in the currency each supplier quoted. We do not convert them.',
  'compare.shippingBoth': 'Shipping: Excluded in both. Not part of the price.',
  'compare.shippingAll': 'Shipping: Excluded in all {total} quotes. Not part of the price.',
  'compare.shippingSome':
    'Shipping: Excluded in {count} of {total} quotes. Not part of those prices.',
  'compare.ask': 'Ask About Missing Terms',
  'compare.askOne': 'You ask the Corridra team. They can then ask {supplier} for you.',
  'compare.askMany': 'You ask the Corridra team. They can then ask those suppliers for you.',
  'room.received': 'Received {date}',
  'room.replies.heading': 'Replies from the Corridra team',
  'room.replies.none': 'No replies yet.',
  'room.replies.all': 'Read Every Reply',
  // English placeholder until native review (D16)
  ...organiseEntryWords,
  ...sellWords,
  ...tripWords,
  ...programmePagesWords,
  ...bookWords,
  ...privacyEn,
  ...consequenceEn,
  ...footerWords,
  ...headerWords,
  ...topBarEn,
  ...todayWords,
  'room.lens.overview': 'Overview',
  'room.lens.compare': 'Compare',
  'room.lens.evidence': 'Evidence',
  'room.lens.none':
    'Offers and evidence appear here once the Corridra team delivers a report for this request and you save it.',
  'room.open.request': 'Open the saved request',
  'room.open.help': 'Request help with this',
  'room.open.report': 'Open the saved report',
  'room.open.library': 'Find the delivered report in your Library',
  'room.gone': 'The original request is no longer available. Its retention period may have ended.',
  'room.loading': 'Opening your request…',
  'room.failed': 'Your request could not be loaded. Try again.',
  'room.denied':
    'Your private request access could not be confirmed. No request details are shown.',
  'room.evidence.heading': 'What the labels mean',
  'room.evidence.line':
    'Every fact in a report carries one of five labels. The label says how the fact is known, not how good it is.',
  'fq.legend': 'Pick the closest one. You can change it.',
  'fq.buyProducts.label': 'Buy products',
  'fq.buyProducts.hint': 'Find suppliers for goods or materials.',
  'fq.buyMachine.label': 'Buy a machine',
  'fq.buyMachine.hint': 'Find suppliers for machinery.',
  'fq.sellAbroad.label': 'Sell abroad',
  'fq.sellAbroad.hint': 'Find buyers, distributors or partners.',
  'fq.groupTrip.label': 'Lead a group trip',
  'fq.groupTrip.hint': 'Plan the programme and the meetings.',
  // New entry wording uses the existing English fallback until each translation is reviewed.
  'fq.visits.label': 'Trips, visits or fairs',
  'fq.visits.hint': 'Or another business goal abroad.',
  ...siteWords,
} as const;

export type MessageKey = keyof typeof en;
type Catalog = Record<MessageKey, string>;

/** One language's catalogue: the English words with that language's own words (lang/<code>.ts) laid over them. */
const withEnglish = (words: LanguageWords): Catalog => ({ ...en, ...words });

export const catalogs: Record<Locale, Catalog> = {
  en,
  bn: withEnglish(languageWords.bn),
  zh: withEnglish(languageWords.zh),
  es: withEnglish(languageWords.es),
  ar: withEnglish(languageWords.ar),
  fr: withEnglish(languageWords.fr),
  de: withEnglish(languageWords.de),
};

export function translate(locale: Locale, key: MessageKey): string {
  return catalogs[locale][key] || catalogs[defaultLocale][key];
}
