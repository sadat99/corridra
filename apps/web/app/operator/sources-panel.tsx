import type { FormEvent } from 'react';
import { PhoneFold } from '../../components/phone-fold';
import { PanelHeading } from './panel-heading';
import type { OperatorSnapshot } from './workspace-types';

// Extracted unchanged from workspace.tsx on 31 Oct 2026 (commercial readiness program, Wave 0) so
// the team-control stream (WS-D) owns this section in its own file.
export function SourcesPanel({
  data,
  view,
  busy,
  source,
  claim,
}: {
  data: OperatorSnapshot;
  view: string;
  busy: boolean;
  source: (event: FormEvent<HTMLFormElement>) => void;
  claim: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      id="workspace-sources"
      tabIndex={-1}
      className="detail-grid workspace-panel ux-panel"
      hidden={view !== 'workspace-sources'}
    >
      <div className="ux-sources-heading">
        <PanelHeading
          title="Sources and claims"
          icon="document"
          description="Record where information came from, review its claims and keep verified facts separate."
        />
      </div>
      <section className="detail-card">
        <h3>Sources</h3>
        <ul>
          {data.sources.map((r) => (
            <li key={r.id}>
              {r.locator}
              <details>
                <summary>Source reference</summary>
                <p>Source reference: {r.id}</p>
              </details>
            </li>
          ))}
        </ul>
        {data.role !== 'viewer' && (
          <PhoneFold summary="Record a new source (4 fields)">
            <form className="operator-form" onSubmit={source}>
              <label className="field">
                Source type
                <select name="kind" defaultValue="observation">
                  <option value="observation">Observed information</option>
                  <option value="public_record">Existing public record</option>
                  <option value="self_declaration">Original declaration</option>
                </select>
              </label>
              <label className="field">
                Source visibility
                <select name="classification" defaultValue="INTERNAL">
                  <option value="INTERNAL">Internal</option>
                  <option value="PUBLIC">Already public</option>
                </select>
              </label>
              <label className="field">
                Source AI permission
                <select name="aiPolicy" defaultValue="DENY">
                  <option value="DENY">Do not use for AI</option>
                  <option value="REVIEW_REQUIRED">Requires a separate rights review</option>
                </select>
              </label>
              <p>
                Public visibility describes an already public source. A separate rights review and
                approved provider policy are required before inference.
              </p>
              <label className="field">
                Source description
                <input name="locator" required maxLength={500} />
              </label>
              <button className="primary-link" disabled={busy}>
                Record source
              </button>
            </form>
          </PhoneFold>
        )}
      </section>
      <section className="detail-card">
        <h3>Claims</h3>
        <ul>
          {data.claims.map((r) => (
            <li key={r.id}>
              {r.statement} <span className="evidence-label">Self-declared</span>
              <details>
                <summary>Claim reference</summary>
                <p>Claim reference: {r.id}</p>
              </details>
            </li>
          ))}
        </ul>
        {data.role !== 'viewer' && (
          <PhoneFold summary="Record a new claim (2 fields)">
            <form className="operator-form" onSubmit={claim}>
              <label className="field">
                Source
                <select name="source" required>
                  <option value="">Choose a source</option>
                  {data.sources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.locator}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Claim
                <textarea name="statement" required maxLength={2000} />
              </label>
              <button className="primary-link" disabled={busy}>
                Record claim
              </button>
            </form>
          </PhoneFold>
        )}
      </section>
      <section className="detail-card">
        <h3>Verified facts</h3>
        {data.facts.length ? (
          data.facts.map((r) => <p key={r.id}>{r.statement}</p>)
        ) : (
          <p>No current verified facts.</p>
        )}
      </section>
    </div>
  );
}
