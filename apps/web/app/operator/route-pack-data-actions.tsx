'use client';
import { useRef, useState } from 'react';
import type { RouteSummary } from '../../lib/route-pack-editor-read';
import { exportWords, importWords } from './route-pack-data-words';
import { RouteDataExportDialog } from './route-pack-export-dialog';
import { RouteDataImportDialog } from './route-pack-import-dialog';
import './route-pack-data.css';

// ADR-093 Phase 3, PR 4: the two quiet actions at the head of the Routes list (spec 12.1, 12.2). Import Route Data for the owner
// and the admin (the check is read only; only the owner saves), Export Route Data for every reader of route facts while there is
// a route to export. One status line under them takes the result and takes focus after the dialog has closed.

export function RouteDataActions({
  tenant,
  role,
  routes,
  onePersonPublication,
  onImported,
}: {
  tenant: string;
  role: string;
  routes: RouteSummary[];
  onePersonPublication: boolean;
  /** A save wrote something: the page reads the routes and the catalogue again. */
  onImported: () => void;
}) {
  const [dialog, setDialog] = useState<'import' | 'export' | null>(null);
  const [status, setStatus] = useState('');
  const pending = useRef('');
  const statusLine = useRef<HTMLParagraphElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const canImport = role === 'owner' || role === 'admin';
  const focusStatusSoon = () => window.setTimeout(() => statusLine.current?.focus(), 50);
  const closeImport = () => {
    setDialog(null);
    if (pending.current) {
      setStatus(pending.current);
      pending.current = '';
      focusStatusSoon();
    }
  };
  return (
    <>
      <div className="route-data-head">
        {canImport ? (
          <button
            type="button"
            ref={importButton}
            className="text-link"
            aria-busy={dialog === 'import' || undefined}
            onClick={() => {
              setStatus('');
              setDialog('import');
            }}
          >
            {importWords.title}
          </button>
        ) : null}
        {routes.length ? (
          <button
            type="button"
            ref={exportButton}
            className="text-link"
            aria-busy={dialog === 'export' || undefined}
            onClick={() => {
              setStatus('');
              setDialog('export');
            }}
          >
            {exportWords.title}
          </button>
        ) : null}
      </div>
      <p
        className="settings-routes-quiet route-data-status"
        role="status"
        tabIndex={-1}
        ref={statusLine}
      >
        {status}
      </p>
      {canImport ? (
        <RouteDataImportDialog
          open={dialog === 'import'}
          onClose={closeImport}
          tenant={tenant}
          role={role}
          onePersonPublication={onePersonPublication}
          routes={routes}
          onSaved={(words) => {
            if (words) pending.current = words;
            onImported();
          }}
          returnFocusTo={() => importButton.current}
        />
      ) : null}
      {routes.length ? (
        <RouteDataExportDialog
          open={dialog === 'export'}
          onClose={() => setDialog(null)}
          tenant={tenant}
          routes={routes}
          initial="all"
          onDone={(name, count) => {
            setDialog(null);
            setStatus(exportWords.downloaded(name, count));
            focusStatusSoon();
          }}
          returnFocusTo={() => exportButton.current}
        />
      ) : null}
    </>
  );
}
