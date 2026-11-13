import Link from 'next/link';
import { SubTabs } from '../../../components/ux/sub-tabs';
import { supplyBase, withWorkspace } from '../../../lib/supply-screens';
import { MissionsView } from './missions-view';
import { RouteKinds } from './route-kinds';
import { SourcesView } from './sources-view';

/** The hub body: one line of intro with the way to Do Not Contact, then the three sections. The page and the layout fixture share it. */
export function SupplyHub({ tenant, role }: { tenant: string; role: string }) {
  return (
    <>
      <div className="supply-head">
        <p className="supply-quiet">
          Where candidate companies come from, and the rules each source follows.
        </p>
        <p className="supply-head-end">
          <Link
            prefetch={false}
            className="text-link"
            href={withWorkspace(`${supplyBase}/do-not-contact`, tenant)}
          >
            Do Not Contact
          </Link>
        </p>
      </div>
      <SubTabs
        label="Supply sections"
        tabs={[
          { id: 'sources', label: 'Sources', panel: <SourcesView tenant={tenant} role={role} /> },
          { id: 'missions', label: 'Missions', panel: <MissionsView tenant={tenant} /> },
          { id: 'route-kinds', label: 'Route Kinds', panel: <RouteKinds tenant={tenant} /> },
        ]}
      />
    </>
  );
}
