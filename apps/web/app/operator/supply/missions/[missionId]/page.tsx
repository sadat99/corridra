import { privatePageMetadata } from '../../../../../lib/ux/page-metadata';
import { SupplyPage } from '../../supply-page';
import { MissionCandidates } from '../../mission-candidates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Supply Candidates');

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ missionId: string }>;
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { missionId } = await params;
  return (
    <SupplyPage
      requested={(await searchParams).workspace}
      title="Supply Candidates"
      signedIn={(tenant, role) => (
        <MissionCandidates tenant={tenant} role={role} missionId={missionId} />
      )}
    />
  );
}
