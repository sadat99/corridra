'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { Dialog } from '../../components/ux/dialog';
import type { RouteSummary } from '../../lib/route-pack-editor-read';
import { sheetRouteLimit } from '../../lib/route-pack-editor-sheet';
import { CountryName } from './country-name';
import { exportWords } from './route-pack-data-words';
import { downloadExport } from './route-pack-sheet-send';
import './route-pack-pack.css';
import './route-pack-data.css';

// ADR-093 Phase 3, PR 4: Export Route Data (spec 12.2). Any staff role that reads route facts (missions.read) downloads one CSV
// of the routes ticked: from the Routes list head every route is ticked, from More only the open one. The file is made by the
// server and named by its date; the dialog says nothing about versions, because an export imported unchanged changes nothing.

export function RouteDataExportDialog({
  open,
  onClose,
  tenant,
  routes,
  initial,
  onDone,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  tenant: string;
  routes: RouteSummary[];
  /** 'all' from the list head; a route key from More. */
  initial: 'all' | string;
  /** The download went through: the page says so on its status line. */
  onDone: (name: string, count: number) => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const startWith = () =>
    initial === 'all' ? routes.map((route) => route.key) : [initial].filter(Boolean);
  const [ticked, setTicked] = useState<string[]>(startWith);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const banner = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    target()?.focus();
  });
  // Every opening starts from its own ticks; nothing of an earlier opening is kept.
  const [shown, setShown] = useState({ open, initial });
  if (shown.open !== open || shown.initial !== initial) {
    setShown({ open, initial });
    if (open) {
      setTicked(startWith());
      setBusy(false);
      setFailed(false);
    }
  }

  const tooMany = ticked.length > sheetRouteLimit;
  const offReason =
    ticked.length === 0 ? exportWords.chooseOne : tooMany ? exportWords.tooMany : null;
  const download = async () => {
    if (busy || offReason) return;
    setBusy(true);
    setFailed(false);
    // In the list's order, so the file reads as the page does.
    const keys = routes.map((route) => route.key).filter((key) => ticked.includes(key));
    const result = await downloadExport(tenant, keys);
    setBusy(false);
    if (result.ok) {
      onDone(result.name, keys.length);
      return;
    }
    setFailed(true);
    focusAfter.current = () => banner.current;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={exportWords.title}
      locked={busy}
      returnFocusTo={returnFocusTo}
    >
      <div className="route-dialog route-pack route-data" aria-busy={busy || undefined}>
        <p className="sr-only" role="status">
          {busy ? exportWords.preparing : ''}
        </p>
        <div className="route-pack-banner" role="alert" tabIndex={-1} ref={banner}>
          {failed ? (
            <p>
              <CorridraIcon name="alert" />
              <span>{exportWords.failed}</span>
            </p>
          ) : null}
        </div>
        <p>{exportWords.intro}</p>
        <fieldset className="route-pack-boxes" disabled={busy}>
          <legend>{exportWords.legend}</legend>
          {routes.map((route, index) => (
            <label key={route.key} className="ux-check">
              <input
                type="checkbox"
                value={route.key}
                checked={ticked.includes(route.key)}
                data-autofocus={index === 0 || undefined}
                onChange={(event) =>
                  setTicked((now) =>
                    event.target.checked
                      ? [...now, route.key]
                      : now.filter((key) => key !== route.key),
                  )
                }
              />{' '}
              <span>
                <CountryName code={route.origin} /> to <CountryName code={route.destination} />
              </span>
            </label>
          ))}
        </fieldset>
        <div className="route-dialog-actions">
          <button
            type="button"
            ref={primary}
            className="primary-link"
            disabled={busy || !!offReason}
            aria-busy={busy || undefined}
            aria-describedby={offReason ? `${id}-off` : undefined}
            onClick={() => void download()}
          >
            {busy ? exportWords.preparing : failed ? exportWords.tryAgain : exportWords.download}
          </button>
          <button type="button" className="text-link" disabled={busy} onClick={onClose}>
            {exportWords.cancel}
          </button>
          {offReason ? (
            <span className="route-edit-quiet" id={`${id}-off`}>
              {offReason}
            </span>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
