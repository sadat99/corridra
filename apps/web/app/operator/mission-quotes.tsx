'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MissionBrief } from '@corridra/domain/missions';
import { EmptyState } from '../../components/ux/empty-state';
import { PhoneFold } from '../../components/phone-fold';
import { bodyNotAvailable } from '../../lib/body-access';
import { formatDateTime } from '../../lib/ux/format';
import { formatMoney } from '../../lib/ux/money';
import { useOperatorFlags } from './operator-flags';
import { ReplyReview } from './reply-review';
import './reply-review.css';

// Team desk v4.1, unit D8 (CORRIDRA_UX_TEAM_DESK_V41): the Quotes tab of one mission. What the customer
// asked for sits beside the supplier replies waiting for review, then the offers already recorded. It
// reads the same two answers the mission page and the Reports section read today and adds no request of
// its own kind. Publish, Ask and Reject are the reply review's own controls (ADR-069): they show only
// where reply review is switched on, to an owner or admin, while the review control is open. Nothing here
// reaches a customer.
type Row = Record<string, unknown> & { id: string };
type Commercial = {
  quotations: Row[];
  targets: { id: string; name: string }[];
  requirements?: Row[];
};
type Experience = {
  links: { id: string; company: string; mission_id: string }[];
  disclosures: { link_id: string; role: string; shared_requirements: string }[];
  responses: {
    id: string;
    link_id: string;
    created_at?: string;
    revision?: number;
    revised_at?: string;
    body: Parameters<typeof ReplyReview>[0]['responses'][number]['body'];
  }[];
};

async function read<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? 'Could not load this part.');
  return body as T;
}

/** The reply read answers at most this many links and this many replies for the whole workspace. */
const replyReadLimit = 100;
const repliesNotLoaded = 'The replies could not be loaded. Reload the page to try again.';

function OpenReports({ href }: { href: string }) {
  return (
    <a className="text-link" href={href}>
      Open Reports
    </a>
  );
}

function safeMoney(minor: string, currency: string) {
  try {
    return formatMoney(minor, currency);
  } catch {
    return `${currency} (amount kept as recorded)`;
  }
}

export function MissionQuotes({
  tenant,
  missionId,
  role,
  brief,
  revision,
  onRecord,
  moneyHref,
  reportsHref,
}: {
  tenant: string;
  missionId: string;
  /** The signed-in person's role in this workspace, as the mission read gives it. The server checks again. */
  role: string;
  brief: MissionBrief;
  /** Raised by the mission page when an offer was recorded, so the list is read again. */
  revision: number;
  /** Opens the existing offer form on the Requirements tab. */
  onRecord: () => void;
  /** The existing Money section address for this mission. */
  moneyHref: string;
  /** The existing Reports section address, where every reply of the workspace is listed. */
  reportsHref: string;
}) {
  const { replyReview } = useOperatorFlags();
  const q = `tenant=${encodeURIComponent(tenant)}`;
  const [commercial, setCommercial] = useState<Commercial | null>(null),
    [commercialError, setCommercialError] = useState(''),
    [experience, setExperience] = useState<Experience | null>(null),
    [experienceError, setExperienceError] = useState('');
  useEffect(() => {
    let active = true;
    read<Commercial>(`/api/workspace/commercial-mission?${q}&mission=${missionId}`)
      .then((v) => active && setCommercial(v))
      .catch((e) => active && setCommercialError(e.message));
    return () => {
      active = false;
    };
  }, [q, missionId, revision]);
  const loadExperience = useCallback(
    () => read<Experience>(`/api/workspace/delivery?${q}&action=experience&mission=${missionId}`),
    [q, missionId],
  );
  useEffect(() => {
    if (!replyReview) return;
    let active = true;
    loadExperience()
      .then((v) => active && setExperience(v))
      .catch(() => active && setExperienceError(repliesNotLoaded));
    return () => {
      active = false;
    };
  }, [replyReview, loadExperience]);

  // The reply read covers the workspace; only replies that came through this mission's links belong here.
  const links = experience?.links.filter((l) => l.mission_id === missionId) ?? [];
  const companies = Object.fromEntries(links.map((l) => [l.id, l.company]));
  const responses = experience?.responses.filter((r) => Object.hasOwn(companies, r.link_id)) ?? [];
  // The read is cut off at its limit, so past it this mission's replies may be missing: say so, never "none".
  const capped =
    (experience?.links.length ?? 0) >= replyReadLimit ||
    (experience?.responses.length ?? 0) >= replyReadLimit;
  const cappedNote = capped && (
    <div className="mission-quotes-capped">
      <p>
        Only the latest {replyReadLimit} supplier replies in this workspace are read here, so this
        list may not show everything. Every reply is under Reports.
      </p>
      <OpenReports href={reportsHref} />
    </div>
  );
  const requirement = commercial?.requirements?.[0];
  const product = (requirement?.fields as { product?: unknown } | undefined)?.product;

  return (
    <div className="mission-quotes">
      <h3>Quotes</h3>
      <p>
        Original supplier offers in their own currency, every revision kept. A quote is not an
        order, a contract or a payment.
      </p>
      <div className="mission-quotes-columns">
        <section className="mission-quotes-asked" aria-labelledby="mission-quotes-asked">
          {/* Open beside the replies on a wide screen; on a phone it folds behind the offer it names. */}
          <PhoneFold
            summary={
              <>
                <span id="mission-quotes-asked">What the customer asked for</span>: {brief.offer}
              </>
            }
          >
            <dl>
              <dt>Goal</dt>
              <dd>{brief.objective}</dd>
              <dt>Market</dt>
              <dd>{brief.market}</dd>
              {brief.outcomes.length > 0 && (
                <>
                  <dt>Wanted outcomes</dt>
                  <dd>{brief.outcomes.join(', ')}</dd>
                </>
              )}
              {typeof product === 'string' && product && (
                <>
                  <dt>Reviewed requirement, version {String(requirement?.version)}</dt>
                  <dd>{product}</dd>
                </>
              )}
            </dl>
            <p className="reply-review-note">
              Self-declared by the customer. The team writes the reviewed requirement.
            </p>
          </PhoneFold>
        </section>
        <div className="mission-quotes-replies">
          {!replyReview ? (
            <section aria-labelledby="mission-quotes-review">
              <h4 id="mission-quotes-review">Replies to review</h4>
              <p>
                Reply review is not switched on in this workspace, so no reply can be published,
                asked about or rejected here. You can read supplier replies under Reports.
              </p>
              <OpenReports href={reportsHref} />
            </section>
          ) : !experience ? (
            <section aria-labelledby="mission-quotes-review">
              <h4 id="mission-quotes-review">Replies to review</h4>
              <p role={experienceError ? 'alert' : 'status'}>
                {experienceError || 'Loading the replies…'}
              </p>
            </section>
          ) : responses.length === 0 ? (
            <section aria-labelledby="mission-quotes-review">
              <h4 id="mission-quotes-review">Replies to review</h4>
              {cappedNote || (
                <EmptyState icon="inbox">
                  No supplier has replied on this mission yet. A reply shows here as soon as it
                  arrives.
                </EmptyState>
              )}
            </section>
          ) : (
            <>
              {cappedNote}
              <ReplyReview
                desk
                tenant={tenant}
                role={role}
                responses={responses}
                disclosures={experience.disclosures}
                companies={companies}
                onRefresh={async () => setExperience(await loadExperience())}
              />
            </>
          )}
        </div>
      </div>
      <section className="mission-quotes-recorded" aria-labelledby="mission-quotes-recorded">
        <details>
          <summary>
            <span id="mission-quotes-recorded">Offers recorded on this mission</span>
            {commercial ? `: ${commercial.quotations.length}` : ''}
          </summary>
          {!commercial ? (
            <p role={commercialError ? 'alert' : 'status'}>{commercialError || 'Loading…'}</p>
          ) : commercial.quotations.length ? (
            <ul>
              {commercial.quotations.map((quote) => {
                const terms = (quote.terms ?? {}) as Record<string, string>;
                const total = terms.totalPriceMinor ?? terms.unitPriceMinor;
                return (
                  <li key={quote.id}>
                    {commercial.targets.find((t) => t.id === quote.target_id)?.name ?? 'Supplier'} ·
                    revision {String(quote.revision)}
                    {/* ADR-087 U1q: a staff viewer receives the quotation with its terms null. */}
                    {quote.terms === null
                      ? ` · ${String(quote.currency)} · ${bodyNotAvailable}`
                      : ''}
                    {total ? ` · ${safeMoney(total, String(quote.currency))}` : ''}
                    {terms.totalPriceMinor ? ' total' : total ? ' per unit' : ''}
                    {quote.created_at
                      ? ` · recorded ${formatDateTime(String(quote.created_at))}`
                      : ''}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No supplier offers recorded yet.</p>
          )}
        </details>
        <div className="mission-quotes-links">
          <button type="button" className="text-link" onClick={onRecord}>
            Record or Revise a Supplier Offer
          </button>
          <a className="text-link" href={moneyHref}>
            Open Money
          </a>
        </div>
      </section>
    </div>
  );
}
