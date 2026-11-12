'use client';
import { useEffect, useRef, useState } from 'react';
import type { StaffApplicationRow } from '@corridra/auth/customer-programme-publication';
import '../../components/problem-reports/problem-reports.css';
import { whenWords } from '../account/workspace-lifecycle-client';
import {
  applicationFailure,
  applicationQueueFragment as fragment,
  applicationStatusLabels,
  applicationWords as words,
  canReadApplications,
  readApplications,
} from '../../lib/programme-application-queue';

// Corridra staff read what people wrote when they applied to public programme pages (ADR-080, owner decision of
// 12 November 2026). A read only list: there is no button that decides, edits, invites or exports. Owners and admins see it;
// the server and the database decide again, with a fresh authenticator check.
export function ProgrammeApplicationQueue({ tenant, role }: { tenant: string; role: string }) {
  return canReadApplications(role) ? <Panel key={tenant} tenant={tenant} /> : null;
}

function Panel({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<StaffApplicationRow[]>([]);
  const [page, setPage] = useState<{ total: number; nextAfter: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const run = useRef(0);

  // The address #programme-application-queue opens the panel, and the workspace scrolls to it.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${fragment}` && details.current) details.current.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  async function load(after: string | null) {
    if (busy) return;
    const token = ++run.current;
    setBusy(true);
    setFailure(null);
    try {
      const fresh = await readApplications(tenant, after);
      if (token !== run.current) return;
      setRows((current) =>
        after === null ? fresh.applications : [...current, ...fresh.applications],
      );
      setPage({ total: fresh.total, nextAfter: fresh.nextAfter });
    } catch (error) {
      if (token !== run.current) return;
      setFailure(applicationFailure(error));
    } finally {
      if (token === run.current) setBusy(false);
    }
  }

  return (
    <details ref={details} id={fragment} tabIndex={-1} className="receipt-disclosure ux-panel">
      <summary>
        <h2>{words.title}</h2>
        {page ? <span className="pr-meta">{words.waiting(page.total)}</span> : null}
      </summary>
      <div className="pr-queue">
        <p>{words.intro}</p>
        <div className="pr-actions">
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => void load(null)}
          >
            {busy && rows.length === 0 ? words.loading : words.load}
          </button>
        </div>
        {failure ? <p role="alert">{failure}</p> : null}
        {!page && !failure ? <p role="status">{words.chooseLoad}</p> : null}
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
                    <strong>{row.displayLabel}</strong>
                    <span className="ux-badge">
                      {applicationStatusLabels[row.status] ?? row.status}
                    </span>
                    <span>{row.programmeTitle}</span>
                    <time dateTime={row.appliedAt}>{whenWords(row.appliedAt)}</time>
                  </p>
                  <details>
                    <summary>{words.showWords}</summary>
                    <dl className="pr-summary">
                      <div>
                        <dt>{words.organiser}</dt>
                        <dd>{row.organiser}</dd>
                      </div>
                      <div>
                        <dt>{words.statement}</dt>
                        <dd>{row.statement}</dd>
                      </div>
                      {row.note ? (
                        <div>
                          <dt>{words.note}</dt>
                          <dd>{row.note}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </details>
                </li>
              ))}
            </ul>
            {page.nextAfter ? (
              <div className="pr-actions">
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => void load(page.nextAfter)}
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
