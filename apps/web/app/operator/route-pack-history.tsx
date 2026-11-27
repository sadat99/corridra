'use client';
import { useState } from 'react';
import { ShowMoreList } from '../../components/ux/show-more';
import type { FactVersion, PackVersion } from '../../lib/route-pack-editor-read';
import { packChangeLine } from '../../lib/route-pack-editor-view';
import { formatDate } from '../../lib/ux/format';
import { historyWords } from './route-pack-data-words';
import { readFactHistory, type PackHistoryState } from './route-pack-editor-data';
import './route-pack-data.css';

// ADR-093 Phase 3, PR 4: the History disclosure at the foot of the route view (spec 16), closed and read only. The fact versions
// are read the first time it is opened; the pack versions come from the pack history the route view already read (owner and
// admin only, audit.read), and the newest one carries what the header's last pack change line said before (Guardian G72 ruling
// 2). Each row is two lines: what and when, then the reason as it was written.

type Facts =
  { state: 'idle' | 'loading' } | { state: 'failed' } | { state: 'ready'; versions: FactVersion[] };

/** The second line of a row: the reason as written, or why there is none. */
function Reason({ text, missing }: { text: string | null; missing: string }) {
  return text && text.trim() ? (
    <span className="route-history-reason" dir="auto">
      {text}
    </span>
  ) : (
    <span className="route-history-reason route-edit-quiet">{missing}</span>
  );
}

export function RouteHistory({
  tenant,
  routeId,
  packHistory,
  packState,
}: {
  tenant: string;
  routeId: string;
  packHistory: PackVersion[] | null;
  packState: PackHistoryState;
}) {
  const [facts, setFacts] = useState<Facts>({ state: 'idle' });
  const load = () => {
    setFacts({ state: 'loading' });
    void readFactHistory(tenant, routeId).then((answer) => setFacts(answer));
  };
  const packs = packState === 'ready' ? (packHistory ?? []) : null;
  const factsEmpty = facts.state === 'ready' && facts.versions.length === 0;
  const nothing = factsEmpty && (packs === null || packs.length === 0) && packState !== 'failed';
  return (
    <details
      className="route-history"
      onToggle={(event) => {
        // Read on the first opening, and again on an opening after a failed read.
        const opened = (event.currentTarget as HTMLDetailsElement).open;
        if (opened && (facts.state === 'idle' || facts.state === 'failed')) load();
      }}
    >
      <summary>{historyWords.summary}</summary>
      <div className="route-data" aria-busy={facts.state === 'loading' || undefined}>
        <p className="route-edit-quiet route-data-status" role="status">
          {facts.state === 'loading' ? historyWords.loading : ''}
        </p>
        {nothing ? (
          <p className="route-edit-quiet">{historyWords.empty}</p>
        ) : (
          <>
            <h3>{historyWords.factsHeading}</h3>
            {facts.state === 'failed' ? (
              <div className="route-history-failed">
                <p className="route-edit-quiet">{historyWords.factsFailed}</p>
                <button type="button" className="text-link" onClick={load}>
                  {historyWords.tryAgain}
                </button>
              </div>
            ) : facts.state === 'ready' ? (
              facts.versions.length ? (
                <ShowMoreList limit={5} noun={historyWords.factNoun}>
                  {facts.versions.map((version) => (
                    <li key={version.id}>
                      <span>
                        {historyWords.factRow(
                          version.version,
                          formatDate(version.createdAt),
                          version.createdByYou ? historyWords.by.you : historyWords.by.teammate,
                        )}
                      </span>
                      <Reason text={version.reason} missing={historyWords.noReason} />
                    </li>
                  ))}
                </ShowMoreList>
              ) : (
                <p className="route-edit-quiet">{historyWords.empty}</p>
              )
            ) : null}
            {packState === 'denied' ? null : (
              <>
                <h3>{historyWords.packsHeading}</h3>
                {packs === null ? (
                  <p className="route-edit-quiet">{historyWords.packsFailed}</p>
                ) : packs.length ? (
                  <ShowMoreList limit={5} noun={historyWords.packNoun}>
                    {packs.map((version) => (
                      <li key={version.version}>
                        <span>{packChangeLine(version, formatDate(version.effectiveFrom))}</span>
                        <Reason
                          text={version.reason}
                          missing={
                            // A pack that did not go through review has no publish decision, so no reason to show.
                            version.reviewed ? historyWords.noReason : historyWords.notThroughReview
                          }
                        />
                      </li>
                    ))}
                  </ShowMoreList>
                ) : (
                  <p className="route-edit-quiet">{historyWords.empty}</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
