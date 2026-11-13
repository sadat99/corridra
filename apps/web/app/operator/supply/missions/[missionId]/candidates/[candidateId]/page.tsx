import { privatePageMetadata } from '../../../../../../../lib/ux/page-metadata';
import { SupplyPage } from '../../../../supply-page';
import { CandidateRecord } from '../../../../candidate-record';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Candidate');

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ missionId: string; candidateId: string }>;
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { missionId, candidateId } = await params;
  return (
    <SupplyPage
      requested={(await searchParams).workspace}
      title="Candidate"
      signedIn={(tenant, role) => (
        <CandidateRecord
          tenant={tenant}
          role={role}
          missionId={missionId}
          candidateId={candidateId}
        />
      )}
    />
  );
}
