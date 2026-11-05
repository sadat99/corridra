'use client';

// The Sell room's buyers view (approved work rooms, 5 Nov 2026): where the buyers stand, then the buyers. The
// model is lib/sell-board.ts; nothing here adds a number or a meeting the report does not hold.
import type { DeliveryReport, MissionExperience } from '@corridra/delivery/report';
import { useMemo, useState, type ReactNode } from 'react';
import { sellBoard } from '../lib/sell-board';
import { CorridraIcon } from './corridra-icon';
import './sell-board.css';

const firstShown = 6;

export function SellBoard({
  experience,
  outcomes,
  more,
}: {
  experience: MissionExperience;
  outcomes: DeliveryReport['missions'][number]['outcomes'] | null;
  /** One more action for the foot (the Room's "Show the requirement..." control). */
  more?: ReactNode;
}) {
  const { funnel, buyers } = useMemo(() => sellBoard(experience, outcomes), [experience, outcomes]);
  const [all, setAll] = useState(false);
  const shown = all ? buyers : buyers.slice(0, firstShown);
  const steps: [number, string][] = [
    [funnel.shortlisted, funnel.shortlisted === 1 ? 'buyer shortlisted' : 'buyers shortlisted'],
    [funnel.proposed, 'meetings proposed'],
    [funnel.confirmed, 'confirmed'],
    [funnel.held, 'held'],
    [funnel.followUps, 'RFQs, samples or agreements'],
  ];
  return (
    <section className="sellb" aria-label="Buyers">
      <dl className="sellb-funnel" aria-label="Where your buyers stand">
        {steps.map(([value, label]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="sellb-card">
        {buyers.length === 0 ? (
          <p className="sellb-empty" role="status">
            No buyer shortlist has been approved for this report yet.
          </p>
        ) : (
          <table className="sellb-table">
            <thead>
              <tr>
                <th scope="col">Buyer</th>
                <th scope="col">Fit</th>
                <th scope="col">How it is backed</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((buyer) => (
                <tr key={buyer.id}>
                  <th scope="row">
                    <b lang={buyer.companyLang}>{buyer.company}</b>
                    <small>{buyer.place}</small>
                  </th>
                  <td>{buyer.fit}</td>
                  <td>
                    <small>{buyer.backing}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="sellb-foot">
          <p>
            <CorridraIcon name="shield" />
            Your buyer contacts and prices stay yours.
          </p>
          <span className="sellb-foot-actions">
            {buyers.length > firstShown ? (
              <button
                type="button"
                className="text-link"
                aria-pressed={all}
                onClick={() => setAll((v) => !v)}
              >
                {all ? 'Show Fewer Buyers' : `Show All ${buyers.length} Buyers`}
              </button>
            ) : null}
            {more}
          </span>
        </div>
      </div>
    </section>
  );
}
