// The Sell room's buyers view (approved work rooms, 5 Nov 2026). Pure, so every rule is tested without a
// browser. The funnel uses Home's own counting rules (home-journeys/facts.ts), so Home and the room never
// disagree; what follows the meetings is the recorded commercial outcomes the report already carries, each
// kind on its own: a price request, a sample and a proposal are not an agreement, so they are never added up. A buyer is shown
// as the report states it: the shortlist names no meeting per buyer, so none is guessed.
import type { DeliveryReport, MissionExperience } from '@corridra/delivery/report';
import { sellFacts } from './home-journeys/facts';

type Outcomes = DeliveryReport['missions'][number]['outcomes'];

export type SellFunnel = {
  shortlisted: number;
  proposed: number;
  confirmed: number;
  held: number;
  /**
   * What the report records after the meetings, one count per kind and never a sum. Null when the report
   * carries no outcomes: that is unknown, not zero.
   */
  priceRequests: number | null;
  samples: number | null;
  proposals: number | null;
  agreements: number | null;
  /**
   * Buyers approached, responded and interested, as counted when staff approved this detail. Null when the
   * approval carries no counts: that is not shared, never zero. Each is its own count and none is added to another.
   */
  approached: number | null;
  responded: number | null;
  interested: number | null;
  /** When the three counts above were taken; null with them. */
  outreachAsOf: string | null;
};
export type BuyerRow = {
  id: string;
  company: string;
  companyLang?: string;
  place: string;
  fit: string;
  backing: string;
};

const fitWords: Record<string, string> = {
  STRONG: 'Strong fit',
  POSSIBLE: 'Possible fit',
  RESEARCH: 'Being assessed',
  UNSUITABLE: 'Not suitable',
};
const han = /\p{Script=Han}/u;

export function sellBoard(e: MissionExperience, outcomes: Outcomes | null) {
  const facts = sellFacts([e]);
  // Counts the report carries are shown as written; anything that is not a whole count is treated as not shared.
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  const o = e.outreach;
  const outreach =
    o && whole(o.approached) && whole(o.responded) && whole(o.interested) && o.asOf ? o : null;
  const funnel: SellFunnel = {
    ...facts,
    approached: outreach ? outreach.approached : null,
    responded: outreach ? outreach.responded : null,
    interested: outreach ? outreach.interested : null,
    outreachAsOf: outreach ? outreach.asOf : null,
    priceRequests: outcomes ? outcomes.rfqs : null,
    samples: outcomes ? outcomes.samples : null,
    proposals: outcomes ? outcomes.proposals : null,
    agreements: outcomes ? outcomes.contracts : null,
  };
  const order = ['STRONG', 'POSSIBLE', 'RESEARCH', 'UNSUITABLE'];
  const rank = (fit: string) => {
    const i = order.indexOf(fit);
    return i === -1 ? order.length : i;
  };
  const buyers: BuyerRow[] = [...e.shortlist]
    .sort((a, b) => rank(a.fit) - rank(b.fit))
    .map((t) => ({
      id: t.id,
      company: t.company,
      companyLang: han.test(t.company) ? 'zh' : undefined,
      place: t.country,
      // An unknown value is shown as written, never mapped to a stronger word.
      fit: fitWords[t.fit] ?? t.fit.toLowerCase(),
      backing: t.verification,
    }));
  return { funnel, buyers };
}
