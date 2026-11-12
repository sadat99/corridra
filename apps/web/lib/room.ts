// The Room: one request in one place. Pure helpers, tested without a browser. The emblem is built from
// the request's own words, never stock imagery, so the same request always looks the same and nothing
// has to be stored or fetched for it.

import type { MissionExperience } from '@corridra/delivery/report';
import { displayMoney } from '@corridra/domain/locale';
import { compareExperienceOffers, isCurrentOffer } from './experience-offers';
import { reasonFor } from './quote-cards';

export type Emblem = { initials: string; tone: 0 | 1 | 2 | 3 };

/** Initials from the first two words (two letters from one word), and one of four fixed tones from a stable hash. */
export function emblemFor(name: string): Emblem {
  const words = name
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const first = [...(words[0] ?? '?')];
  const second = [...(words[1] ?? '')];
  const initials = (
    second.length ? first[0] + second[0] : first.slice(0, 2).join('')
  ).toLocaleUpperCase();
  let hash = 0;
  for (const char of name.normalize('NFKC')) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return { initials, tone: (hash % 4) as Emblem['tone'] };
}

export type RoomLink = {
  /** A delivered report exists for this request and the person may read it. */
  reportAvailable: boolean;
  /** The saved report's id, once the person saved it. */
  savedResourceId: string | null;
};

type Assignment = {
  id?: unknown;
  requestId?: unknown;
  available?: unknown;
  savedResourceId?: unknown;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/**
 * What the assigned missions say about one request. Only a readable, available assignment for this
 * exact request counts; a malformed row is ignored, never trusted. A saved report is preferred.
 */
export function roomLinkFor(requestId: string, assignments: unknown): RoomLink {
  const rows = Array.isArray(assignments) ? (assignments as Assignment[]) : [];
  let reportAvailable = false;
  let savedResourceId: string | null = null;
  for (const row of rows) {
    if (!row || row.requestId !== requestId || row.available !== true) continue;
    reportAvailable = true;
    if (typeof row.savedResourceId === 'string' && uuid.test(row.savedResourceId))
      savedResourceId ??= row.savedResourceId;
  }
  return { reportAvailable, savedResourceId };
}

/** Pages of 25 assignments followed to find a request's report: 200 pages is 5,000 assignments. */
export const assignmentPageCap = 200;

/**
 * Assignments are listed by id, not by request, so a request's report can be on any page. This stops as
 * soon as it is found and otherwise follows every page before it declares the report absent. The bound
 * only guards against a provider that never ends.
 */
export async function followAssignments(
  requestId: string,
  page: (after?: string) => Promise<{ assignments?: unknown[]; nextAfter?: string | null }>,
  maxPages = assignmentPageCap,
): Promise<RoomLink> {
  const rows: unknown[] = [];
  let after: string | undefined;
  for (let n = 0; n < maxPages; n += 1) {
    const result = await page(after);
    rows.push(...(result.assignments ?? []));
    if (roomLinkFor(requestId, rows).reportAvailable || !result.nextAfter) break;
    after = result.nextAfter;
  }
  return roomLinkFor(requestId, rows);
}

/**
 * The same answer as `followAssignments`, from assignment pages already read: rows are added page by page and the
 * reading stops at the first page after which a report is available, so a later page never changes the report the
 * Room opens. The Meetings page uses it to open the report the Room would.
 */
export function roomLinkFromPages(requestId: string, pages: readonly unknown[][]): RoomLink {
  const rows: unknown[] = [];
  for (const page of pages) {
    rows.push(...page);
    if (roomLinkFor(requestId, rows).reportAvailable) break;
  }
  return roomLinkFor(requestId, rows);
}

/** The records the Road may read for Compare and Decide. A decision is not readable here, so it is never claimed. */
export function roadRecords(link: RoomLink) {
  return { compare: link.reportAvailable, decide: false };
}

/**
 * The lens a Room link may open on, from the `view` in its address. Exactly "meetings" counts only where the Trip
 * lens exists (the Trip and lenses switches both on); exactly "compare" only where the lenses exist, and the Room
 * still opens the comparison only once the saved report shows something to compare. An array, an unknown word or a
 * switch off opens the Overview as always. It only chooses what is shown first and reads nothing.
 */
export function initialLensFor(
  view: string | string[] | undefined,
  on: { trip: boolean; lenses: boolean },
): 'trip' | 'compare' | undefined {
  if (on.lenses && view === 'compare') return 'compare';
  return on.trip && on.lenses && view === 'meetings' ? 'trip' : undefined;
}

/** One delivered report the person may read for this request, as the assignment list states it. */
export type RoomReport = {
  assignmentId: string;
  savedResourceId: string | null;
  title: string;
  expiresAt: string;
};

type ListedAssignment = Assignment & { title?: unknown; expiresAt?: unknown };

/**
 * Every report for one request in list order: the readable ones, and the ids of rows that are listed but no
 * longer open. A row for another request, a malformed row and a report whose access has already ended are left
 * out, never trusted. The list says only available or not, so expired, revoked and changed stay one state.
 */
export function roomReportsFor(
  requestId: string,
  assignments: unknown,
  now = Date.now(),
): { reports: RoomReport[]; closed: string[] } {
  const rows = Array.isArray(assignments) ? (assignments as ListedAssignment[]) : [];
  const reports: RoomReport[] = [];
  const closed: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || row.requestId !== requestId) continue;
    if (typeof row.id !== 'string' || !uuid.test(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    const expiresAt = typeof row.expiresAt === 'string' ? Date.parse(row.expiresAt) : NaN;
    if (
      row.available !== true ||
      typeof row.title !== 'string' ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now
    ) {
      closed.push(row.id);
      continue;
    }
    reports.push({
      assignmentId: row.id,
      savedResourceId:
        typeof row.savedResourceId === 'string' && uuid.test(row.savedResourceId)
          ? row.savedResourceId
          : null,
      title: row.title,
      expiresAt: row.expiresAt as string,
    });
  }
  return { reports, closed };
}

/**
 * Follows every assignment page, unlike `followAssignments`, which stops at the first report: a newer report for
 * the same request may be on a later page, and the Room must never pick one for the person while another is
 * unseen. `complete` is false only when the page bound was reached with more pages left.
 */
export async function followRoomReports(
  requestId: string,
  page: (after?: string) => Promise<{ assignments?: unknown[]; nextAfter?: string | null }>,
  maxPages = assignmentPageCap,
  now = Date.now(),
): Promise<{ reports: RoomReport[]; closed: string[]; complete: boolean }> {
  const rows: unknown[] = [];
  let after: string | undefined;
  for (let n = 0; n < maxPages; n += 1) {
    const result = await page(after);
    rows.push(...(result.assignments ?? []));
    if (!result.nextAfter) return { ...roomReportsFor(requestId, rows, now), complete: true };
    // A page that points back at itself can never end: stop, and say the list was not read to the end.
    if (result.nextAfter === after) break;
    after = result.nextAfter;
  }
  return { ...roomReportsFor(requestId, rows, now), complete: false };
}

/**
 * What the Room asks of the person about delivered reports.
 * - `none`: no report is open to them.
 * - `saved`: nothing to save; the saved report shown is `savedResourceId`.
 * - `save`: exactly one report is the task, and it is not saved yet.
 * - `choose`: more than one report could be meant; the person chooses, the Room never does.
 */
export type RoomTask =
  | { kind: 'none' }
  | { kind: 'saved' }
  | { kind: 'save'; report: RoomReport }
  | { kind: 'choose'; reports: RoomReport[] };

export type RoomResolution = {
  link: RoomLink;
  task: RoomTask;
  /** The address named a report that is not open to this person for this request. Its reason is not known. */
  hintClosed: boolean;
  /** How many reports are open for this request, so the address after a save can name the one saved. */
  count: number;
};

/**
 * Resolves the report an address hints at against the reports just read for this person and request. The hint
 * only chooses among those; it never grants anything, and one that matches nothing is said plainly. Without a
 * settling hint, one report that is the only one is the task; several are a choice; an unread rest of the list
 * is never treated as settled.
 */
export function resolveRoomTask(
  read: { reports: RoomReport[]; complete: boolean },
  hint?: string,
): RoomResolution {
  const { reports, complete } = read;
  const match = hint ? reports.find((report) => report.assignmentId === hint) : undefined;
  const hintClosed = !!hint && !match;
  const firstSaved = reports.find((report) => report.savedResourceId)?.savedResourceId ?? null;
  // A hinted saved report is the one shown; otherwise the first saved one, as before, so a hint for a report still to
  // save never hides one the person already saved for this request.
  const savedResourceId = match?.savedResourceId ?? firstSaved;
  const link: RoomLink = { reportAvailable: reports.length > 0, savedResourceId };
  const count = reports.length;
  if (match)
    return {
      link,
      task: match.savedResourceId ? { kind: 'saved' } : { kind: 'save', report: match },
      hintClosed,
      count,
    };
  const unsaved = reports.filter((report) => !report.savedResourceId);
  if (unsaved.length === 0)
    return { link, task: count ? { kind: 'saved' } : { kind: 'none' }, hintClosed, count };
  if (count === 1 && complete)
    return { link, task: { kind: 'save', report: unsaved[0]! }, hintClosed, count };
  return { link, task: { kind: 'choose', reports: unsaved }, hintClosed, count };
}

/**
 * Where the Room goes after a confirmed save: the comparison of this request. The saved report is named only when
 * the request has more than one, so the Room opens the one just saved and not an older one.
 */
export function afterSaveHref(requestId: string, assignmentId: string, count: number) {
  const base = `/account/rooms/${requestId}?view=compare`;
  return count > 1 ? `${base}&report=${assignmentId}` : base;
}

// One plain sentence above the comparison when a current quote leaves out a term the comparison engine needs. It
// adds no verdict of its own: the missing terms are exactly the engine's (`compareExperienceOffers`), the supplier
// names and their words are as written, and amounts stay in their original currency and exact minor units. It
// never converts, ranks or recommends.
type Offer = MissionExperience['quotations'][number];
type Line = { key: string; supplier: string; lang?: string; words: string };
export type MissingTermNoticeView = { title: string; lines: Line[]; samePrice: string | null };

const han = /\p{Script=Han}/u;
const stated = (value: unknown) =>
  value !== undefined && value !== null && value !== '' && value !== 'NOT_SUPPLIED';

/** The engine's term labels for these keys, in its order ("Lead time, Payment terms"). */
function termWords(missing: string[]) {
  return reasonFor({ missing, status: 'NOT COMPARABLE' })
    .replace(/^Missing: /, '')
    .replace(/\.$/, '');
}

/** What the notice says for these offers, or null when no current offer leaves out a term. Pure, for tests. */
export function missingTermNotice(
  experience: MissionExperience,
  calculatedAt?: string,
): MissingTermNoticeView | null {
  const verdicts = compareExperienceOffers(experience, calculatedAt);
  const current = experience.quotations
    .map((offer, index) => ({ offer, verdict: verdicts[index]! }))
    .filter(({ offer }) => isCurrentOffer(experience, offer));
  const short = current.filter(({ verdict }) => verdict.missing.length > 0);
  if (!short.length) return null;
  const name = (offer: Offer) => {
    const company = experience.shortlist.find((t) => t.id === offer.targetId)?.company;
    return company
      ? { supplier: company, lang: han.test(company) ? 'zh' : undefined }
      : { supplier: 'One supplier' };
  };
  const lines: Line[] = [];
  let title: string;
  const leaveOut = short.filter(({ verdict }) => verdict.missing.includes('commissioning'));
  if (leaveOut.length) {
    title =
      leaveOut.length === 1
        ? 'One quote leaves out the machine set-up'
        : `${leaveOut.length} quotes leave out the machine set-up`;
    for (const { offer } of leaveOut)
      lines.push({
        key: offer.id,
        ...name(offer),
        words: 'has not said who will set up and test the machine at your site.',
      });
    for (const { offer } of current)
      if (stated(offer.terms.commissioning))
        lines.push({
          key: offer.id + ':stated',
          ...name(offer),
          words: `quotes ${String(offer.terms.commissioning)}.`,
        });
  } else {
    title =
      short.length === 1 ? 'One quote leaves out terms' : `${short.length} quotes leave out terms`;
    for (const { offer, verdict } of short)
      lines.push({
        key: offer.id,
        ...name(offer),
        words: `has not stated: ${termWords(verdict.missing)}.`,
      });
  }
  // Only two current quotes in the same currency, unit and Incoterm with the same exact unit price in minor units are
  // called equal; a price per set is never called the same as a price per piece.
  const [a, b] = current;
  const samePrice =
    current.length === 2 &&
    a &&
    b &&
    a.offer.currency === b.offer.currency &&
    a.offer.terms.unit === b.offer.terms.unit &&
    a.offer.terms.incoterm === b.offer.terms.incoterm &&
    typeof a.offer.terms.unitPriceMinor === 'string' &&
    a.offer.terms.unitPriceMinor === b.offer.terms.unitPriceMinor
      ? `Both quotes are ${displayMoney(a.offer.terms.unitPriceMinor, a.offer.currency)} a unit.`
      : null;
  return { title, lines, samePrice };
}
