'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type Entry = {
  key: string;
  version: number;
  title: string;
  summary: string;
  included: string[];
  excluded: string[];
  regions: string[];
  quoteBasis: string;
  active: boolean;
};
const bases: [string, string][] = [
  ['per_day', 'Priced per day'],
  ['per_visit', 'Priced per visit'],
  ['per_item', 'Priced per item'],
  ['fixed_scope', 'Priced for a fixed scope'],
];
const blank = {
  key: '',
  version: 0,
  title: '',
  summary: '',
  included: '',
  excluded: '',
  regions: '',
  quoteBasis: 'per_visit',
  active: true,
};
const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export function CustomerServiceCatalogue({ tenant }: { tenant: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null),
    [form, setForm] = useState<typeof blank | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const task = useRef<AbortController | null>(null);
  const endpoint = '/api/workspace/customer-service-requests?tenant=' + encodeURIComponent(tenant);
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    try {
      const r = await fetch(endpoint + '&scope=catalogue', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!r.ok) throw new Error('catalogue');
      const body = (await r.json()) as { services?: Entry[] };
      if (!Array.isArray(body.services)) throw new Error('catalogue');
      setEntries(body.services);
    } catch {
      if (!controller.signal.aborted) setMessage('The service list could not be loaded.');
    }
  }, [endpoint]);
  useEffect(() => {
    void Promise.resolve().then(() => load());
    return () => task.current?.abort();
  }, [load]);
  function edit(entry: Entry | null) {
    setPending(null);
    setMessage('');
    setForm(
      entry
        ? {
            key: entry.key,
            version: entry.version,
            title: entry.title,
            summary: entry.summary,
            included: entry.included.join('\n'),
            excluded: entry.excluded.join('\n'),
            regions: entry.regions.join('\n'),
            quoteBasis: entry.quoteBasis,
            active: entry.active,
          }
        : blank,
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    const body = pending ?? {
      action: 'catalogue',
      commandId: crypto.randomUUID(),
      serviceKey: form.key,
      expectedVersion: form.version,
      title: form.title.trim(),
      summary: form.summary.trim(),
      included: lines(form.included),
      excluded: lines(form.excluded),
      regions: lines(form.regions),
      quoteBasis: form.quoteBasis,
      active: form.active,
    };
    setPending(body);
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        if (r.status < 500 || r.status === 503) setPending(null);
        setMessage(
          r.status === 409
            ? 'The service changed or the text was refused. Reload and check it. Text must be plain, with no links or contact details.'
            : r.status === 400
              ? 'Check the details. The key uses lower-case letters, digits and hyphens.'
              : 'Saving failed. Try again.',
        );
        return;
      }
      setPending(null);
      setForm(null);
      setMessage('Saved.');
      await load();
    } catch {
      setMessage('Could not confirm that this was saved. Save again; it cannot be applied twice.');
    } finally {
      setBusy(false);
    }
  }
  const change = (patch: Partial<typeof blank>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setPending(null);
  };
  return (
    <section aria-label="Paid-service catalogue">
      <h4>Services customers can ask for</h4>
      <p>
        Customers read this list and cannot change it. A change makes a new version; requests that
        already exist keep the wording they were made against.
      </p>
      {message && <p role={message === 'Saved.' ? 'status' : 'alert'}>{message}</p>}
      {entries === null && !message && <p role="status">Loading the services…</p>}
      {entries && (
        <ul>
          {entries.map((s) => (
            <li key={s.key}>
              <strong>{s.title}</strong> · version {s.version} ·{' '}
              {s.active ? 'offered' : 'not offered'} · {s.regions.join(', ')}{' '}
              <button type="button" className="text-link" onClick={() => edit(s)}>
                Edit {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!form && (
        <button type="button" className="text-link" onClick={() => edit(null)}>
          Add a service
        </button>
      )}
      {form && (
        <form onSubmit={(e) => void save(e)} aria-label="Service details">
          <fieldset disabled={busy}>
            <legend>{form.version ? 'Edit ' + form.title : 'Add a service'}</legend>
            <label className="field">
              Key (lower case, hyphens)
              <input
                required
                pattern="[a-z][a-z0-9-]{2,59}"
                readOnly={form.version > 0}
                value={form.key}
                onChange={(e) => change({ key: e.target.value })}
              />
            </label>
            <label className="field">
              Plain title
              <input
                required
                minLength={3}
                maxLength={120}
                value={form.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </label>
            <label className="field">
              What it is, in one or two sentences
              <textarea
                required
                minLength={10}
                maxLength={400}
                rows={2}
                value={form.summary}
                onChange={(e) => change({ summary: e.target.value })}
              />
            </label>
            <label className="field">
              What is included, one per line
              <textarea
                required
                rows={3}
                value={form.included}
                onChange={(e) => change({ included: e.target.value })}
              />
            </label>
            <label className="field">
              What is not included, one per line
              <textarea
                required
                rows={3}
                value={form.excluded}
                onChange={(e) => change({ excluded: e.target.value })}
              />
            </label>
            <label className="field">
              Places it is offered, one per line
              <textarea
                required
                rows={2}
                value={form.regions}
                onChange={(e) => change({ regions: e.target.value })}
              />
            </label>
            <label className="field">
              How it is priced
              <select
                value={form.quoteBasis}
                onChange={(e) => change({ quoteBasis: e.target.value })}
              >
                {bases.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => change({ active: e.target.checked })}
              />
              Offer this service to customers
            </label>
          </fieldset>
          <button type="submit" className="button" disabled={busy}>
            {pending ? 'Save the same change again' : 'Save service'}
          </button>{' '}
          <button type="button" className="text-link" onClick={() => setForm(null)}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
