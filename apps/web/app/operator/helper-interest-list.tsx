'use client';
import { useEffect, useRef, useState } from 'react';
import { useInboxOpenLoad } from './inbox/inbox-check';
import type { HelperInterestRow } from '@corridra/auth/helper-interest';
import '../../components/problem-reports/problem-reports.css';
import { whenWords } from '../account/workspace-lifecycle-client';
import { CountryName } from './country-name';
import {
  canReadHelperInterest,
  deleteHelperInterest,
  helperInterestFailure,
  helperInterestFragment as fragment,
  helperInterestInstalled,
  helperInterestWords as words,
  pageAfterDelete,
  readHelperInterest,
} from '../../lib/helper-interest-client';

// Owners and admins read the helper interest register and delete an entry on request (ADR-0085). Nothing else: no edit, no
// export, no message. The panel does not exist while the database module is not installed. The server and the database
// decide who may read or delete, with a fresh authenticator check.
export function HelperInterestList({
  tenant,
  role,
  installed = false,
  tabbed = false,
}: {
  tenant: string;
  role: string;
  /** Team desk v4.1: the list sits under its own tab on the Inbox page, so the tab names it. */
  tabbed?: boolean;
  /** The caller already asked the register and it is installed (the Inbox page), so it is not asked twice. */
  installed?: boolean;
}) {
  return canReadHelperInterest(role) ? (
    <Panel key={tenant} tenant={tenant} known={installed} tabbed={tabbed} />
  ) : null;
}

function Panel({ tenant, known, tabbed }: { tenant: string; known: boolean; tabbed: boolean }) {
  const [installed, setInstalled] = useState(known);
  const [rows, setRows] = useState<HelperInterestRow[]>([]);
  const [page, setPage] = useState<{ total: number; nextOffset: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    if (known) return undefined;
    let live = true;
    void helperInterestInstalled(tenant).then((yes) => {
      if (live) setInstalled(yes);
    });
    return () => {
      live = false;
    };
  }, [tenant, known]);

  // Team desk v4.1 (staff-core-29): in the Inbox, this list loads itself when its tab opens after one passed check.
  const readPassed = useInboxOpenLoad(fragment, () => void load(0), page !== null);

  async function load(offset: number) {
    if (busy) return;
    const token = ++run.current;
    setBusy(true);
    setFailure(null);
    try {
      const fresh = await readHelperInterest(tenant, offset);
      if (token !== run.current) return;
      if (!fresh.installed) {
        setInstalled(false);
        return;
      }
      readPassed();
      setRows((current) => (offset === 0 ? fresh.rows : [...current, ...fresh.rows]));
      setPage({ total: fresh.total, nextOffset: fresh.nextOffset });
    } catch (error) {
      if (token === run.current) setFailure(helperInterestFailure(error, words.loadFailed));
    } finally {
      if (token === run.current) setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await deleteHelperInterest(tenant, id);
      setRows((current) => current.filter((row) => row.id !== id));
      setPage((current) => (current ? pageAfterDelete(current) : current));
      setConfirming(null);
      setNotice(words.deleted);
    } catch (error) {
      setFailure(helperInterestFailure(error, words.deleteFailed));
    } finally {
      setBusy(false);
    }
  }

  if (!installed) return null;
  return (
    <details id={fragment} tabIndex={-1} className="receipt-disclosure ux-panel">
      <summary>
        <h2 className={tabbed ? 'sr-only' : undefined}>{words.title}</h2>
        {page ? <span className="pr-meta">{words.waiting(page.total)}</span> : null}
      </summary>
      <div className="pr-queue">
        <p>{words.intro}</p>
        <div className="pr-actions">
          <button className="text-link" type="button" disabled={busy} onClick={() => void load(0)}>
            {busy && rows.length === 0 ? words.loading : words.load}
          </button>
        </div>
        {failure ? <p role="alert">{failure}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {!page && !failure && !notice ? <p role="status">{words.chooseLoad}</p> : null}
        {page && !failure && rows.length === 0 ? <p role="status">{words.empty}</p> : null}
        {page && rows.length > 0 ? (
          <>
            <p className="pr-queue-summary">
              <span>{words.summary(rows.length, page.total)}</span>
            </p>
            <ul className="pr-queue-rows">
              {rows.map((row) => (
                <li key={row.id} className="pr-queue-row">
                  <p className="pr-facts">
                    <strong>{row.name}</strong>
                    <span>{row.email}</span>
                    <span className="ux-badge">
                      <CountryName code={row.country} />
                    </span>
                    <time dateTime={row.createdAt}>{whenWords(row.createdAt)}</time>
                  </p>
                  <dl className="pr-summary">
                    <div>
                      <dt>{words.reason}</dt>
                      <dd>{row.reason}</dd>
                    </div>
                  </dl>
                  {confirming === row.id ? (
                    <div
                      className="pr-actions"
                      role="group"
                      aria-label={`${words.confirm} ${row.name}`}
                    >
                      <span>{words.confirm}</span>
                      <button
                        className="text-link"
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(row.id)}
                      >
                        {words.confirmYes}
                      </button>
                      <button
                        className="text-link"
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        {words.confirmNo}
                      </button>
                    </div>
                  ) : (
                    <div className="pr-actions">
                      <button
                        className="text-link"
                        type="button"
                        disabled={busy}
                        aria-label={`${words.remove} the entry from ${row.name}`}
                        onClick={() => setConfirming(row.id)}
                      >
                        {words.remove}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {page.nextOffset !== null ? (
              <div className="pr-actions">
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => void load(page.nextOffset!)}
                >
                  {busy ? words.loading : words.more}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
