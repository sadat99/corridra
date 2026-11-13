'use client';
import { useRef, useState, type FormEvent } from 'react';
import { formatDate } from '../../../lib/ux/format';
import { refusalWords, rowFix, supplyGet, supplyUpload } from '../../../lib/supply-screens';
import { supplyFileColumns, supplyWords } from '@corridra/domain/supply-sources';
import { openSubTab } from '../../../components/ux/sub-tabs';
import type { ActiveSource } from './mission-candidates';
import { PersonalDataLine, ReadFailure, useLoad } from './supply-ui';

type Batch = {
  id: string;
  rowCount: number;
  accepted: number;
  rejected: number;
  rowResults: { row: number; code: string }[];
  createdAt: string;
};
type Imported = { batchId: string; accepted: number; rejected: number; duplicate: boolean };

function ImportResult({ result, batch }: { result: Imported; batch: Batch | undefined }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const done = useRef(false);
  const focus = (node: HTMLHeadingElement | null) => {
    heading.current = node;
    if (node && !done.current) {
      done.current = true;
      node.focus();
    }
  };
  const rejected = (batch?.rowResults ?? []).filter((row) => row.code !== 'ok');
  return (
    <div>
      <h3 ref={focus} tabIndex={-1}>
        Import finished
      </h3>
      <p role="status">
        {result.accepted} of {result.accepted + result.rejected} rows were added. {result.rejected}{' '}
        were rejected.
      </p>
      {result.duplicate ? (
        <p>
          This file was already imported for this mission and profile. This is the first result.
        </p>
      ) : null}
      {rejected.length > 0 ? (
        <div className="supply-table" role="region" aria-label="Rejected rows" tabIndex={0}>
          <table>
            <caption>Rejected rows</caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Code</th>
                <th scope="col">What to fix</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((row) => (
                <tr key={row.row}>
                  <td>{row.row}</td>
                  <td>
                    <code>{row.code}</code>
                  </td>
                  <td>{rowFix(row.code)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function FileImport({
  tenant,
  missionId,
  profileVersionId,
  sources,
  paused,
  onImported,
}: {
  tenant: string;
  missionId: string;
  profileVersionId: string;
  sources: ActiveSource[];
  paused: boolean;
  onImported: () => void;
}) {
  const batches = useLoad<{ batches: Batch[] }>(
    () => supplyGet(tenant, 'batches', { mission: missionId }),
    `${tenant}:${missionId}`,
  );
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<Imported | null>(null);
  const commandId = useRef(crypto.randomUUID());
  const root = useRef<HTMLDivElement>(null);
  const source = sources.find((option) => option.id === sourceId) ?? sources[0];

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy || paused || !source) return;
    setBusy(true);
    setRefusal('');
    setResult(null);
    const form = new FormData();
    form.set('file', file);
    form.set('commandId', commandId.current);
    form.set('missionId', missionId);
    form.set('profileVersionId', profileVersionId);
    form.set('sourceVersionId', source.versionId);
    try {
      const done = await supplyUpload<Imported>(tenant, form);
      commandId.current = crypto.randomUUID();
      setResult(done);
      batches.reload();
      onImported();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message === supplyWords.fileClosed) setLocked(true);
      else setRefusal(message || 'The file was not imported.');
    } finally {
      setBusy(false);
    }
  }
  const sourceChoice =
    sources.length > 1 ? (
      <div className="field">
        <label htmlFor="import-source">Source</label>
        <select
          id="import-source"
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
        >
          {sources.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    ) : null;
  const latest = batches.data?.batches.find((batch) => batch.id === result?.batchId);
  return (
    <div ref={root}>
      <h3>Import a File</h3>
      <p>Add several companies at once from a CSV or XLSX file. Up to 100 rows and 1 MiB.</p>
      <PersonalDataLine />
      <details className="supply-disclosure">
        <summary>What the file needs</summary>
        <ul>
          {supplyFileColumns.map((column) => (
            <li key={column}>
              <code>{column}</code>
            </li>
          ))}
        </ul>
        <p>
          Use only these columns. A file with any other column is refused whole. Internal notes
          cannot be imported.
        </p>
      </details>
      {sources.length === 0 ? (
        <p className="supply-quiet">
          No active source for this mission. Create or resume one first.
        </p>
      ) : locked ? (
        <div role="status" className="supply-notice">
          <p>File import is not open yet.</p>
          <p>
            The owner has not turned file import on. You can add companies one at a time in the
            meantime.
          </p>
          <button
            type="button"
            className="text-link"
            onClick={() => openSubTab(root.current, 'add-one')}
          >
            Add One Company
          </button>
        </div>
      ) : (
        <form className="operator-form" onSubmit={send}>
          <label className="field">
            File (CSV or XLSX)
            <input
              type="file"
              name="file"
              accept=".csv,.xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {sourceChoice}
          {!file ? <p className="supply-quiet">Choose a file to continue.</p> : null}
          {paused ? <p className="supply-quiet">{refusalWords.paused}</p> : null}
          {busy ? <p role="status">Reading the file.</p> : null}
          <button className="primary-link" aria-disabled={!file || busy || paused}>
            Check and Import
          </button>
          {refusal ? <p role="alert">{refusal}</p> : null}
        </form>
      )}
      {result ? <ImportResult result={result} batch={latest} /> : null}
      {batches.error ? <ReadFailure error={batches.error} onRetry={batches.reload} /> : null}
      {batches.data && batches.data.batches.length > 0 ? (
        <details className="research-history">
          <summary>Earlier imports ({batches.data.batches.length})</summary>
          <ul>
            {batches.data.batches.map((batch) => (
              <li key={batch.id}>
                {formatDate(batch.createdAt)}, {batch.rowCount} rows, {batch.accepted} added,{' '}
                {batch.rejected} rejected, reference {batch.id.slice(0, 8)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
