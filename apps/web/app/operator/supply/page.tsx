import Link from 'next/link';
import { SubTabs } from '../../../components/ux/sub-tabs';
import { privatePageMetadata } from '../../../lib/ux/page-metadata';
import { supplyBase, withWorkspace } from '../../../lib/supply-screens';
import { MissionsView } from './missions-view';
import { RouteKinds } from './route-kinds';
import { SourcesView } from './sources-view';
import { SupplyPage } from './supply-page';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Supply Sources');

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  return (
    <SupplyPage
      requested={(await searchParams).workspace}
      title="Supply Sources"
      signedIn={(tenant, role) => (
        <>
          <p className="supply-quiet">
            Where candidate companies come from, and the rules each source follows.
          </p>
          <p>
            <Link
              prefetch={false}
              className="text-link"
              href={withWorkspace(`${supplyBase}/do-not-contact`, tenant)}
            >
              Do Not Contact
            </Link>
          </p>
          <SubTabs
            label="Supply sections"
            tabs={[
              {
                id: 'sources',
                label: 'Sources',
                panel: <SourcesView tenant={tenant} role={role} />,
              },
              { id: 'missions', label: 'Missions', panel: <MissionsView tenant={tenant} /> },
              { id: 'route-kinds', label: 'Route Kinds', panel: <RouteKinds tenant={tenant} /> },
            ]}
          />
        </>
      )}
    />
  );
}
