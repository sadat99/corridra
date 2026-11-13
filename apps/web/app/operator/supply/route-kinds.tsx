'use client';
import { EmptyState } from '../../../components/ux/empty-state';
import { formatDate } from '../../../lib/ux/format';
import { supplyGet } from '../../../lib/supply-screens';
import { Loading, ReadFailure, useLoad } from './supply-ui';

type RouteRow = {
  id: string;
  status: string;
  nextAction: string;
  createdAt: string;
  kinds: string[];
};

// Partner and data platform controls are closed in this build, so a kind a route offers reads "Offered, locked".
const lockedKinds: [string, string][] = [
  ['partner_organisation', 'Partner Organisation'],
  ['partner_person', 'Partner Person'],
  ['data_platform', 'Data Platform'],
];

export function RouteKinds({ tenant }: { tenant: string }) {
  const routes = useLoad<{ routes: RouteRow[] }>(() => supplyGet(tenant, 'route-kinds'), tenant);
  const rows = routes.data?.routes ?? [];
  return (
    <section aria-labelledby="supply-routes-heading">
      <h2 id="supply-routes-heading">Route Kinds</h2>
      <p className="supply-quiet">
        Which kinds of source each route can use. Staff Research is always allowed. Other kinds
        appear only when the route&apos;s pack lists them. Change this by publishing a new route
        pack, not here.
      </p>
      {routes.loading && !routes.data ? <Loading words="Loading routes." /> : null}
      {routes.error ? <ReadFailure error={routes.error} onRetry={routes.reload} /> : null}
      {routes.data && rows.length === 0 ? (
        <EmptyState icon="mission">No routes are set up yet.</EmptyState>
      ) : null}
      {rows.length > 0 ? (
        <div className="supply-table" role="region" aria-label="Route kinds" tabIndex={0}>
          <table>
            <caption className="sr-only">Source kinds offered for each mission route</caption>
            <thead>
              <tr>
                <th scope="col">Mission</th>
                <th scope="col">Staff Research</th>
                <th scope="col">Partner Organisation</th>
                <th scope="col">Partner Person</th>
                <th scope="col">Data Platform</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    Mission of {formatDate(row.createdAt)}
                    <span className="supply-quiet"> {row.nextAction}</span>
                  </th>
                  <td>Always</td>
                  {lockedKinds.map(([kind]) => (
                    <td key={kind}>
                      {row.kinds.includes(kind) ? 'Offered, locked' : 'Not offered'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
