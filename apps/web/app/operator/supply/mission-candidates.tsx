'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SubTabs } from '../../../components/ux/sub-tabs';
import { formatDate } from '../../../lib/ux/format';
import { canWrite, supplyBase, supplyGet, withWorkspace } from '../../../lib/supply-screens';
import { CandidateForm } from './candidate-form';
import { CandidatesList, type Candidate } from './candidates-list';
import { FileImport } from './file-import';
import {
  DeniedNote,
  Loading,
  PausedNotice,
  ReadFailure,
  useLoad,
  useScreenState,
} from './supply-ui';

export type ActiveSource = {
  id: string;
  versionId: string;
  version: number;
  label: string;
  kind: string;
  status: string;
};

export function MissionCandidates({
  tenant,
  role,
  missionId,
}: {
  tenant: string;
  role: string;
  missionId: string;
}) {
  const screen = useScreenState(tenant, missionId);
  const candidates = useLoad<{ candidates: Candidate[] }>(
    () => supplyGet(tenant, 'candidates', { mission: missionId }),
    `${tenant}:${missionId}`,
  );
  const missions = useLoad<{ missions: { id: string; createdAt: string }[] }>(
    () => supplyGet(tenant, 'missions'),
    tenant,
  );
  const sources = useLoad<{ sources: ActiveSource[] }>(() => supplyGet(tenant, 'sources'), tenant);
  const mission = missions.data?.missions.find((row) => row.id === missionId);
  const name = mission ? `Mission of ${formatDate(mission.createdAt)}` : 'this mission';
  const paused = screen.data ? !screen.data.moduleOpen : false;
  const profile = screen.data?.profile ?? null;
  const active = (sources.data?.sources ?? []).filter(
    (source) => source.kind === 'staff_research' && source.status === 'active',
  );
  const writable = canWrite(role);
  const forms = (children: ReactNode) =>
    !writable ? (
      <DeniedNote />
    ) : screen.loading && !screen.data ? (
      <Loading words="Loading candidates." />
    ) : !profile ? (
      <p className="supply-quiet">
        This mission has no research profile yet, so candidates cannot be added.{' '}
        <Link prefetch={false} className="text-link" href="/operator#workspace-missions">
          Open Missions
        </Link>
      </p>
    ) : (
      children
    );
  return (
    <section aria-labelledby="supply-candidates-heading">
      <nav aria-label="Breadcrumb">
        <Link prefetch={false} className="text-link" href={withWorkspace(supplyBase, tenant)}>
          Supply Sources
        </Link>
      </nav>
      <h2 id="supply-candidates-heading">Candidates for {name}</h2>
      {profile ? <p className="supply-quiet">Profile version {profile.version}</p> : null}
      <PausedNotice paused={paused} />
      {screen.error ? <ReadFailure error={screen.error} onRetry={screen.reload} /> : null}
      <SubTabs
        label="Candidate sections"
        tabs={[
          {
            id: 'candidates',
            label: 'Candidates',
            panel: (
              <CandidatesList
                tenant={tenant}
                missionId={missionId}
                state={candidates}
                hasProfile={!screen.data || profile !== null}
              />
            ),
          },
          {
            id: 'add-one',
            label: 'Add One',
            panel: forms(
              <CandidateForm
                tenant={tenant}
                missionId={missionId}
                profileVersionId={profile?.id ?? ''}
                profileVersion={profile?.version ?? 0}
                sources={active}
                paused={paused}
                onAdded={candidates.reload}
              />,
            ),
          },
          {
            id: 'import-file',
            label: 'Import File',
            panel: forms(
              <FileImport
                tenant={tenant}
                missionId={missionId}
                profileVersionId={profile?.id ?? ''}
                sources={active}
                paused={paused}
                onImported={candidates.reload}
              />,
            ),
          },
        ]}
      />
      <p>
        <Link
          prefetch={false}
          className="text-link"
          href={withWorkspace(`${supplyBase}/do-not-contact`, tenant)}
        >
          Do Not Contact
        </Link>
      </p>
    </section>
  );
}
