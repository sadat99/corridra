'use client';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '../../../components/ux/empty-state';
import { formatDate } from '../../../lib/ux/format';
import { supplyBase, supplyGet, withWorkspace } from '../../../lib/supply-screens';
import { Loading, ReadFailure, useLoad } from './supply-ui';

type MissionRow = {
  id: string;
  status: string;
  nextAction: string;
  createdAt: string;
  candidates: number;
  candidatesLive: number;
  profileVersion: number | null;
};

export function MissionsView({ tenant }: { tenant: string }) {
  const missions = useLoad<{ missions: MissionRow[] }>(() => supplyGet(tenant, 'missions'), tenant);
  const [shown, setShown] = useState(5);
  const rows = missions.data?.missions ?? [];
  return (
    <section aria-labelledby="supply-missions-heading">
      <h2 id="supply-missions-heading">Missions</h2>
      {missions.loading && !missions.data ? <Loading words="Loading missions." /> : null}
      {missions.error ? <ReadFailure error={missions.error} onRetry={missions.reload} /> : null}
      {missions.data && rows.length === 0 ? (
        <EmptyState icon="mission">
          No missions yet. A mission appears here once the team creates one.
        </EmptyState>
      ) : null}
      <ul className="supply-list" aria-label="Supply missions">
        {rows.slice(0, shown).map((row) => (
          <li key={row.id} className="supply-item">
            <p className="supply-item-title">
              <Link
                prefetch={false}
                className="text-link"
                href={withWorkspace(`${supplyBase}/missions/${row.id}`, tenant)}
              >
                Mission of {formatDate(row.createdAt)}
              </Link>{' '}
              <span className="ux-badge">{row.status}</span>
            </p>
            <p className="supply-quiet">
              Candidates {row.candidates}
              {row.profileVersion === null
                ? '. No research profile yet.'
                : `. Profile version ${row.profileVersion}.`}
            </p>
          </li>
        ))}
      </ul>
      {rows.length > shown ? (
        <div className="ux-show-more">
          <p role="status">
            Showing {shown} of {rows.length} missions.
          </p>
          <button type="button" className="text-link" onClick={() => setShown(shown + 5)}>
            Show More
          </button>
        </div>
      ) : null}
    </section>
  );
}
