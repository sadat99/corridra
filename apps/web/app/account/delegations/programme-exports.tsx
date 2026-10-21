'use client';
import { useRef, useState } from 'react';
import { customerHeaders, deniedMessage, useCommandIds } from './pricing-client';

type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmes: { id: string; name: string }[];
};
type Dataset = 'programmes' | 'ledger';

export function ProgrammeExports(props: Props) {
  return (
    <ScopedExports key={props.issuer + ':' + props.subject + ':' + props.workspaceId} {...props} />
  );
}

function ScopedExports({ subject, issuer, workspaceId, programmes }: Props) {
  const headers = customerHeaders(subject, issuer);
  const commands = useCommandIds();
  const [dataset, setDataset] = useState<Dataset>('programmes');
  const [programme, setProgramme] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const writing = useRef(false);

  async function download() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const scope = dataset === 'ledger' && programme ? programme : null;
    try {
      const r = await fetch('/api/customer-programme-exports', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          commandId: commands.forIntent('export' + dataset + (scope ?? '')),
          workspaceId,
          dataset,
          programmeId: scope,
        }),
      });
      if ([401, 403].includes(r.status)) {
        setError('Only owners and admins of this workspace can export. ' + deniedMessage);
        return;
      }
      if (r.status === 503) {
        setError('Exports are unavailable right now.');
        return;
      }
      if (r.status === 409 || r.status === 400) {
        const body: unknown = await r.json().catch(() => null);
        const message =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : '';
        setError(
          message.includes('Too many rows')
            ? 'This export is too large. Choose one programme for the ledger and try again.'
            : 'The export could not be prepared. Check the choices and try again.',
        );
        return;
      }
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('text/csv'))
        throw Error('Unconfirmed export');
      const csv = await r.text();
      const rows = Math.max(0, csv.split('\r\n').filter(Boolean).length - 1);
      const name =
        /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ??
        'corridra-export.csv';
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      commands.clear();
      setNotice(
        'Downloaded ' +
          name +
          ' with ' +
          rows +
          ' row' +
          (rows === 1 ? '' : 's') +
          '. The download was logged.',
      );
    } catch {
      setError('The export could not be confirmed. Try again.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <div aria-busy={busy}>
      <h4>Exports</h4>
      <p>
        Download your own workspace&apos;s records as a spreadsheet file (CSV). Only owners and
        admins can export. Every download is logged. The file holds no participant names, and its
        name carries no personal details.
      </p>
      <form
        className="operator-form"
        onSubmit={(event) => {
          event.preventDefault();
          void download();
        }}
      >
        <label className="field">
          What to export
          <select
            value={dataset}
            disabled={busy}
            onChange={(e) => {
              setDataset(e.target.value as Dataset);
              setNotice('');
              setError('');
            }}
          >
            <option value="programmes">Programmes, participant counts and totals</option>
            <option value="ledger">Fees and costs ledger</option>
          </select>
        </label>
        {dataset === 'ledger' && (
          <label className="field">
            Programme (optional)
            <select
              value={programme}
              disabled={busy}
              onChange={(e) => setProgramme(e.target.value)}
            >
              <option value="">All programmes</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="primary-link" disabled={busy}>
          Download CSV
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        Amounts appear in whole minor units and as decimals, one currency per row. Nothing is
        converted.
      </p>
    </div>
  );
}
