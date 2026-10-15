'use client';
import { useEffect, useState } from 'react';
import { displayDate } from '@corridra/domain/locale';

type Row = {
  id: string;
  status: string;
  due_at: string;
  brief: { company: string; objective: string; market: string };
};
type Page = { missions: Row[]; total: number };
type Today = { fresh: Page; overdue: Page; open: Page };

/** Existing, role-checked mission list reads. Nothing here writes or adds a new server route. */
async function read(tenant: string, query: string, signal: AbortSignal): Promise<Page> {
  const response = await fetch(
    `/api/workspace/missions?tenant=${encodeURIComponent(tenant)}&${query}&offset=0&view=today`,
    { signal, cache: 'no-store' },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed');
  return { missions: body.missions as Row[], total: body.total as number };
}

function List({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: Row[];
  total: number;
  empty: string;
}) {
  return (
    <section className="ux-today-list" aria-label={title}>
      <h3>{title}</h3>
      {rows.length ? (
        <>
          <ul>
            {rows.slice(0, 5).map((mission) => (
              <li key={mission.id}>
                <strong>{mission.brief.company}</strong>
                <span>
                  {mission.brief.objective} · {mission.brief.market}
                </span>
                <span>
                  {mission.status.replaceAll('_', ' ').toLowerCase()} · due{' '}
                  <time dateTime={mission.due_at}>{displayDate(mission.due_at)}</time>
                </span>
              </li>
            ))}
          </ul>
          {total > 5 && (
            <p className="ux-today-more">
              Showing 5 of {total}. The mission list below has the rest.
            </p>
          )}
        </>
      ) : (
        <p className="ux-today-empty">{empty}</p>
      )}
    </section>
  );
}

/**
 * The first thing an operator sees: what needs a person now, taken from the same mission list that
 * is mounted below. It never blocks the workspace if a read fails.
 */
export function TodayPanel({ tenant, revision }: { tenant: string; revision: number }) {
  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      read(tenant, 'filter=open&stage=DRAFT', controller.signal),
      read(tenant, 'filter=overdue', controller.signal),
      read(tenant, 'filter=open', controller.signal),
    ])
      .then(([fresh, overdue, open]) => {
        setToday({ fresh, overdue, open });
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [tenant, revision]);
  return (
    <section className="ux-today" aria-labelledby="today-title">
      <h2 id="today-title">Today</h2>
      {failed ? (
        <p role="status">
          Today&apos;s list could not be loaded. The mission list below still works.
        </p>
      ) : !today ? (
        <p role="status" aria-live="polite">
          Loading today&apos;s list.
        </p>
      ) : (
        <>
          <ul className="ux-today-tiles" aria-label="Mission counts">
            <li>
              <strong>{today.fresh.total}</strong>
              <span>
                {today.fresh.total === 1 ? 'new request to review' : 'new requests to review'}
              </span>
            </li>
            <li>
              <strong>{today.overdue.total}</strong>
              <span>
                {today.overdue.total === 1
                  ? 'mission past its due date'
                  : 'missions past their due date'}
              </span>
            </li>
            <li>
              <strong>{today.open.total}</strong>
              <span>{today.open.total === 1 ? 'open mission' : 'open missions'}</span>
            </li>
          </ul>
          {today.fresh.total === 0 && today.overdue.total === 0 ? (
            <p className="ux-today-empty">
              Nothing is waiting. New requests and missions past their due date appear here.
            </p>
          ) : (
            <div className="ux-today-lists">
              <List
                title="New requests to review"
                rows={today.fresh.missions}
                total={today.fresh.total}
                empty="No new requests."
              />
              <List
                title="Past their due date"
                rows={today.overdue.missions}
                total={today.overdue.total}
                empty="Nothing is overdue."
              />
            </div>
          )}
          <a className="text-link" href="#workspace-missions">
            Open the mission list
          </a>
        </>
      )}
    </section>
  );
}
