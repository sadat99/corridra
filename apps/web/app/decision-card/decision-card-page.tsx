import {
  decisionLabel,
  dueLabel,
  provenanceLabel,
  unavailableWords,
  type CardFields,
} from '../../lib/decision-card-page';
import './decision-card.css';

export type CardPageState =
  { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'open'; card: CardFields };

/** What a visitor sees. Read only: nothing here can be clicked, typed into or sent. */
export function DecisionCardPage({ state }: { state: CardPageState }) {
  return (
    <main id="main" className="decision-card" lang="en">
      {state.kind === 'loading' && <p role="status">Checking this link…</p>}
      {state.kind === 'unavailable' && (
        <>
          <h1>{unavailableWords}</h1>
        </>
      )}
      {state.kind === 'open' && (
        <>
          <h1>Shared decision</h1>
          <p className="decision-card-note">
            A Corridra customer chose to share this. It is read only.
          </p>
          <dl>
            <div>
              <dt>Company</dt>
              <dd dir="auto">{state.card.company}</dd>
            </div>
            <div>
              <dt>Decision</dt>
              <dd>{decisionLabel(state.card.decision)}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd dir="auto">{state.card.rationale}</dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd dir="auto">{state.card.nextAction}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd dir="auto">{dueLabel(state.card.dueAt)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{provenanceLabel(state.card.provenance)}</dd>
            </div>
          </dl>
        </>
      )}
    </main>
  );
}
