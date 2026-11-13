import { privatePageMetadata } from '../../../../lib/ux/page-metadata';
import { SupplyPage } from '../supply-page';
import { DncPanel } from '../dnc-panel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Do Not Contact');

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  return (
    <SupplyPage
      requested={(await searchParams).workspace}
      title="Do Not Contact"
      signedIn={(tenant, role) => <DncPanel tenant={tenant} role={role} />}
    />
  );
}
