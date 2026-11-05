// The one place an approved mission's offers are put through the comparison engine. The report page and
// Home both call it, so a count on Home can never disagree with the cards the person opens. It adds no
// verdict of its own: `compareOffers` decides, and "current" means exactly what the report page says.
import type { MissionExperience } from '@corridra/delivery/report';
import { compareOffers } from '@corridra/domain/commercial-missions';

type Offer = MissionExperience['quotations'][number];

/** An offer that answers the current request: not superseded, on the current assignment and requirements. */
export function isCurrentOffer(e: MissionExperience, q: Offer) {
  return !!e.requirements?.current && !q.superseded && q.assignmentCurrent;
}

/** One verdict per offer, in the same order, exactly as `compareOffers` returns them. */
export function compareExperienceOffers(e: MissionExperience, calculatedAt?: string) {
  const r = e.requirements;
  return compareOffers(
    e.quotations.map((q) => ({
      id: q.id,
      currency: q.currency,
      terms: q.terms,
      requirementId: String(r?.version ?? 'missing'),
      uncertainties: q.uncertainties,
      evidenceCurrent:
        !!r?.current &&
        !q.superseded &&
        q.assignmentCurrent &&
        (!r.fields.specifications || r.fields.specifications === q.terms.specification) &&
        (!r.fields.quantity || r.fields.quantity === q.terms.quantity) &&
        (!r.fields.unit || r.fields.unit === q.terms.unit),
    })),
    calculatedAt,
    r?.fields.machinery ? 'MACHINERY' : 'GENERAL',
  );
}
