'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PhoneFold } from '../../components/phone-fold';
import { ActionFeedback, useActionFeedback } from '../../components/ux/feedback';
import { ReferencePicker } from '../../components/ux/reference-picker';
import { SearchSelect } from '../../components/ux/search-select';
import type { PickerOption } from '../../lib/ux/options';
import { PanelHeading } from './panel-heading';
import type { OperatorSnapshot } from './workspace-types';

type SourceRow = {
  id: string;
  locator?: string;
  kind?: string;
  mission_name?: string | null;
  organisation_name?: string | null;
};

/** Company search over the existing research catalogue (CQ-80). Names only, never IDs. */
function CompanyPicker({
  tenant,
  value,
  onChange,
}: {
  tenant: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const call = ++latest.current;
    const timer = window.setTimeout(() => {
      fetch(`/api/workspace/research?${new URLSearchParams({ tenant, q: query.slice(0, 100) })}`, {
        cache: 'no-store',
      })
        .then(async (r) => {
          if (!r.ok) throw new Error('search failed');
          const body = (await r.json()) as {
            organisations: { id: string; name: string; country: string }[];
          };
          if (call !== latest.current) return;
          setFailed(false);
          setOptions((current) => {
            const chosen = current.find((o) => o.value === value);
            const next = body.organisations.map((o) => ({
              value: o.id,
              label: o.name,
              hint: o.country,
            }));
            return chosen && !next.some((o) => o.value === chosen.value) ? [chosen, ...next] : next;
          });
        })
        .catch(() => {
          if (call === latest.current) setFailed(true);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [tenant, query, value]);
  return (
    <SearchSelect
      label="Company (optional)"
      hint="The company this source is about."
      name="organisationId"
      options={options}
      value={value}
      onChange={onChange}
      onQuery={setQuery}
      error={failed ? 'Company search is not available right now. Try again.' : undefined}
      emptyText={query ? 'No matches. Try another word.' : 'Start typing to search.'}
    />
  );
}

/** A reference with a copy button (CQ-80). */
function CopyReference({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState('');
  return (
    <span className="ux-copy-reference">
      <span>
        {label}: <code>{value}</code>
      </span>{' '}
      <button
        type="button"
        className="text-link"
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => setCopied('Copied.'))
            .catch(() => setCopied('Copy did not work. Select the reference and copy it.'));
        }}
      >
        Copy reference
      </button>
      <span role="status" aria-live="polite">
        {copied}
      </span>
    </span>
  );
}

// Sources and claims (moved from workspace.tsx in Wave 0; WS-D owns it). A source can be linked to a
// mission and a company, chosen from pickers (CQ-80). The source reference is shown with a copy
// button. When the workspace passes `request` and `act`, saving refreshes the shared lists; without
// them the panel saves on its own and lists the new source here until the next refresh.
export function SourcesPanel({
  data,
  view,
  busy,
  source,
  claim,
  tenant: tenantProp,
  act,
  request,
}: {
  data: OperatorSnapshot;
  view: string;
  busy: boolean;
  source: (event: FormEvent<HTMLFormElement>) => void;
  claim: (event: FormEvent<HTMLFormElement>) => void;
  tenant?: string;
  act?: (work: () => Promise<unknown>) => Promise<boolean>;
  request?: (action: string, body?: unknown) => Promise<unknown>;
}) {
  const snapshot = data as OperatorSnapshot & { tenantId?: string };
  const tenant = tenantProp ?? snapshot.tenantId ?? '';
  const [mission, setMission] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [recent, setRecent] = useState<SourceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const feedback = useActionFeedback();
  const sources = [
    ...recent.filter((r) => !data.sources.some((s) => s.id === r.id)),
    ...(data.sources as SourceRow[]),
  ];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const body = {
      kind: f.get('kind'),
      locator: f.get('locator'),
      observedAt: new Date().toISOString(),
      classification: f.get('classification'),
      purpose: data.purpose ?? 'synthetic_validation',
      retentionUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      aiPolicy: f.get('aiPolicy'),
      missionId: mission,
      organisationId: company,
    };
    feedback.clear();
    const post = async () => {
      if (request) return (await request('source', body)) as { id: string };
      const r = await fetch(`/api/workspace/source?${new URLSearchParams({ tenant })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? 'The source could not be saved.');
      return result as { id: string };
    };
    setSaving(true);
    try {
      let created: { id: string } | null = null;
      const ok = act
        ? await act(async () => {
            created = await post();
          })
        : await post().then((r) => {
            created = r;
            return true;
          });
      if (ok && created) {
        const id = (created as { id: string }).id;
        setRecent((list) => [{ id, locator: String(body.locator) }, ...list]);
        feedback.success('Source recorded.');
        form.reset();
        setMission(null);
        setCompany(null);
      } else if (!ok) feedback.error('The source could not be saved. Check the fields and retry.');
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : 'The source could not be saved.');
    } finally {
      setSaving(false);
    }
  }

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
          {sources.map((r) => (
            <li key={r.id}>
              {r.locator}
              {(r.mission_name || r.organisation_name) && (
                <span className="ux-source-links">
                  {r.mission_name ? ` · Mission: ${r.mission_name}` : ''}
                  {r.organisation_name ? ` · Company: ${r.organisation_name}` : ''}
                </span>
              )}
              <details>
                <summary>Source reference</summary>
                <CopyReference label="Source reference" value={r.id} />
              </details>
            </li>
          ))}
        </ul>
        {data.role !== 'viewer' && (
          <PhoneFold summary="Record a new source (6 fields)">
            {/* `source` stays the workspace's original handler; this form adds the optional links. */}
            <form
              className="operator-form"
              onSubmit={(event) =>
                tenant && (act || mission || company) ? void save(event) : source(event)
              }
            >
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
              {tenant && (
                <>
                  <ReferencePicker
                    kind="mission"
                    tenant={tenant}
                    label="Mission (optional)"
                    hint="The mission this source supports."
                    name="missionId"
                    value={mission}
                    onChange={setMission}
                  />
                  <CompanyPicker tenant={tenant} value={company} onChange={setCompany} />
                </>
              )}
              <button className="primary-link" disabled={busy || saving}>
                Record source
              </button>
              <ActionFeedback
                scope="sources"
                feedback={feedback.feedback}
                onClear={feedback.clear}
              />
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
                <CopyReference label="Claim reference" value={r.id} />
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
                  {sources.map((r) => (
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
