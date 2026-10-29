import './owner-page.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { founderActivation } from '@corridra/auth/founder-activation';
import { AccessState, StatusBadge } from '../../../components/access-state';
import { FrontDoor } from '../../../components/front-door';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { founderDoor, withWorkspace } from '../../../lib/front-doors';
import {
  chooseOwnerTenant,
  ownerCapable,
  ownerPageAccess,
  ownerPageEnabled,
} from '../../../lib/owner-access';
import { gapSignal, ownerGaps } from '../../../lib/owner-gaps';
import { describeSwitches, installOnlyModules } from '../../../lib/owner-switches';
import { waitingOnTeam } from '../../../lib/owner-waiting';
import { uxSwitchOn } from '../../../lib/ux-switches';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Owner page | Corridra',
  robots: { index: false, follow: false },
};

function Denied({ children }: { children: string }) {
  return (
    <WorkspaceShell eyebrow="OWNER PAGE" title="Workspace access is unavailable.">
      <AccessState kind="denied">
        <p>{children}</p>
      </AccessState>
      <Link className="text-link" href="/operator">
        Back to your workspace
      </Link>
    </WorkspaceShell>
  );
}

/** Read only. Staff session and fresh authenticator check, then owner or admin membership. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  if (!ownerPageEnabled()) notFound();
  const s = foundations();
  if (!s) return <Denied>The protected workspace is not configured in this environment.</Denied>;
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  const tenants = identity ? await s.access.tenants(identity.token) : [];
  const access = ownerPageAccess({
    enabled: true,
    configured: true,
    signedIn: !!identity,
    tenants,
  });
  if (access === 'sign-in') redirect('/operator/signin?next=' + encodeURIComponent('/operator'));
  if (access !== 'allowed' || !identity)
    return (
      <Denied>
        This page is for workspace owners and admins. Ask your workspace owner to review your role.
      </Denied>
    );
  const tenant = chooseOwnerTenant(tenants, (await searchParams).workspace)!;
  const choices = ownerCapable(tenants);
  const waiting = await waitingOnTeam(s.missions, {
    token: identity.token,
    tenantId: tenant.id,
    purpose: 'synthetic_validation',
    correlationId: randomUUID(),
  });
  const groups = describeSwitches();
  const activation = founderActivation();
  return (
    <WorkspaceShell eyebrow="OWNER PAGE" title="What is on and off." className="ux-owner">
      {uxSwitchOn('CORRIDRA_UX_FRONT_DOORS') && (
        <FrontDoor label="Founder areas" items={withWorkspace(founderDoor, tenant.id)} />
      )}
      <p className="owner-lede">
        This page only reads. It changes nothing. Each state comes from the settings of the
        deployment you are using right now.
      </p>
      <p className="owner-note">{activation.note}</p>
      <p className="owner-count">
        <strong>
          {activation.counts.on} of {activation.counts.total}
        </strong>{' '}
        customer modules are on.
      </p>
      <section aria-labelledby="owner-switches" className="owner-section">
        <h2 id="owner-switches">What is on and off</h2>
        {groups.map((group) => (
          <section
            key={group.group}
            aria-labelledby={'owner-group-' + group.group.replace(/\W+/g, '-').toLowerCase()}
            className="owner-group"
          >
            <h3 id={'owner-group-' + group.group.replace(/\W+/g, '-').toLowerCase()}>
              {group.group}
            </h3>
            <div
              className="owner-scroll"
              role="region"
              tabIndex={0}
              aria-label={group.group + ' table'}
            >
              <table className="owner-table">
                <thead>
                  <tr>
                    <th scope="col">Setting</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.name}>
                      <th scope="row">
                        <span className="owner-label">{row.label}</span>
                        <span className="owner-line">{row.line}</span>
                        <code className="owner-name">{row.name}</code>
                      </th>
                      <td>
                        <StatusBadge tone={row.state.tone}>{row.state.text}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </section>
      <section aria-labelledby="owner-installed-records" className="owner-section">
        <h2 id="owner-installed-records">Optional installed records</h2>
        {installOnlyModules.map((module) => (
          <article key={module.name}>
            <h3>{module.label}</h3>
            <p>{module.line}</p>
            <p>
              <StatusBadge tone="neutral">{module.state}</StatusBadge>
            </p>
            <p>
              Owner install choice: <code className="owner-name">{module.action}</code>
            </p>
            <p>Preview with apply=no first.</p>
          </article>
        ))}
      </section>
      <section aria-labelledby="owner-waiting" className="owner-section">
        <h2 id="owner-waiting">Waiting on the Corridra team</h2>
        <p>
          Counts for the workspace <strong>{tenant.name}</strong>, read with your own access. They
          match the Today list.
        </p>
        {choices.length > 1 && (
          <nav aria-label="Choose workspace" className="owner-choices">
            {choices.map((choice) =>
              choice.id === tenant.id ? (
                <span key={choice.id} aria-current="page">
                  {choice.name}
                </span>
              ) : (
                <Link
                  key={choice.id}
                  className="text-link"
                  href={'/operator/owner?workspace=' + choice.id}
                >
                  {choice.name}
                </Link>
              ),
            )}
          </nav>
        )}
        <ul className="owner-waiting">
          {waiting.map((item) => (
            <li key={item.key}>
              <span className="owner-label">{item.label}</span>
              <span className="owner-line">{item.detail}</span>
              <strong className="owner-figure">
                {item.count === null ? 'Not measurable here yet' : item.count}
              </strong>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="owner-gaps" className="owner-section">
        <h2 id="owner-gaps">Open gaps</h2>
        <p>
          These controls stay open until their evidence exists. Status is copied from the deferred
          controls register. Nothing here is marked closed.
        </p>
        <ul className="owner-gaps">
          {ownerGaps.map((gap) => {
            const signal = gapSignal(gap.id);
            return (
              <li key={gap.id}>
                <span className="owner-label">{gap.id}</span>
                <span className="owner-line">{gap.work}</span>
                <dl className="owner-facts">
                  <dt>Needed before</dt>
                  <dd>{gap.requiredBefore}</dd>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge tone="caution">Open</StatusBadge>
                    <span className="owner-line">{gap.status}</span>
                    <span className="owner-line">
                      {signal ?? 'Status taken from the deferred controls register.'}
                    </span>
                  </dd>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
      <Link className="text-link" href="/operator">
        Back to your workspace
      </Link>
    </WorkspaceShell>
  );
}
