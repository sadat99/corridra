// One plain sentence above the comparison when a current quote leaves out a term the comparison engine needs. It
// adds no verdict of its own: the missing terms are exactly the engine's (`compareExperienceOffers`), the supplier
// names and their words are as written, and amounts stay in their original currency and exact minor units. It
// never converts, ranks or recommends.
import type { ReactNode } from 'react';
import type { MissionExperience } from '@corridra/delivery/report';
import { displayMoney } from '@corridra/domain/locale';
import { compareExperienceOffers, isCurrentOffer } from '../lib/experience-offers';
import { reasonFor } from '../lib/quote-cards';
import './missing-term-notice.css';

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

export function MissingTermNotice({
  experience,
  action,
}: {
  experience: MissionExperience;
  /** The existing question action, placed beside the notice by the caller only where it is allowed. */
  action?: ReactNode;
}) {
  const view = missingTermNotice(experience);
  if (!view) return null;
  return (
    <section className="missing-term-notice" aria-labelledby="missing-term-notice-title">
      <div className="missing-term-notice-words">
        <h3 id="missing-term-notice-title">{view.title}</h3>
        {view.lines.map((line) => (
          <p key={line.key}>
            <span lang={line.lang} dir="auto">
              {line.supplier}
            </span>{' '}
            {line.words}
          </p>
        ))}
        {view.samePrice ? <p>{view.samePrice}</p> : null}
      </div>
      {action ? <div className="missing-term-notice-action">{action}</div> : null}
    </section>
  );
}
