import Link from 'next/link';
import { SubTabs } from '../../../components/ux/sub-tabs';
import { supplyBase, withWorkspace } from '../../../lib/supply-screens';
import { MissionsView } from './missions-view';
import { RouteKinds } from './route-kinds';
import { SourcesView } from './sources-view';

/** The hub body: one line of intro with the way to Do Not Contact, then the three sections. The page and the layout fixture share it. */
export function SupplyHub({
  tenant,
  role,
  desk = false,
}: {
  tenant: string;
  role: string;
  /** Team desk v4.1 (unit D19): the intro line is the purpose line under the page title, so it is not said twice. */
  desk?: boolean;
}) {
  const doNotContact = (
    <Link
      prefetch={false}
      className="text-link"
      href={withWorkspace(`${supplyBase}/do-not-contact`, tenant)}
    >
      Do Not Contact
    </Link>
  );
  const tabs = (
    <SubTabs
      label="Supply sections"
      tabs={[
        { id: 'sources', label: 'Sources', panel: <SourcesView tenant={tenant} role={role} /> },
        { id: 'missions', label: 'Missions', panel: <MissionsView tenant={tenant} /> },
        { id: 'route-kinds', label: 'Route Kinds', panel: <RouteKinds tenant={tenant} /> },
      ]}
    />
  );
  // Team desk v4.1: the link sits at the end of the tab row's own line, so the page has one row under its title.
  if (desk)
    return (
      <div className="supply-hub-desk">
        <p className="supply-hub-link">{doNotContact}</p>
        {tabs}
      </div>
    );
  return (
    <>
      <div className="supply-head">
        <p className="supply-quiet">
          Where candidate companies come from, and the rules each source follows.
        </p>
        <p className="supply-head-end">{doNotContact}</p>
      </div>
      {tabs}
    </>
  );
}
