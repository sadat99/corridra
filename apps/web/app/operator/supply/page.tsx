import { privatePageMetadata } from '../../../lib/ux/page-metadata';
import { SupplyHub } from './supply-hub';
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
      signedIn={(tenant, role) => <SupplyHub tenant={tenant} role={role} />}
    />
  );
}
