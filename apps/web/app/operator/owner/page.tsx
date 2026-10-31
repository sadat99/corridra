import './owner-page.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { founderActivation } from '@corridra/auth/founder-activation';
import {
  blockedItems,
  DEFERRED_LABEL,
  deferredControls,
  LIVE_STATE,
} from '@corridra/auth/deferred-controls';
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

const groupId = (group: string) => 'owner-group-' + group.replace(/\W+/g, '-').toLowerCase();

/**
 * Read only. Staff session and fresh authenticator check, then owner or admin membership.
 * The status board comes first (UX-03, CQ-39): live state, what is waiting, what is blocked, which
 * controls are deferred and who acts. The setting tables sit under "Technical details".
 */
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
  const deployment = activation.environment.deployment;
  return (
    <WorkspaceShell eyebrow="OWNER PAGE" title="What is on and off." className="ux-owner">
      {uxSwitchOn('CORRIDRA_UX_FRONT_DOORS') && (
        <FrontDoor label="Founder areas" items={withWorkspace(founderDoor, tenant.id)} />
      )}
      <section aria-labelledby="owner-status" className="owner-board">
        <h2 id="owner-status">Status</h2>
        <p className="owner-live">
          <StatusBadge tone="positive">{LIVE_STATE}</StatusBadge>
          <span className="owner-line">
            Corridra is live for a small number of customers. This page only reads; it changes
            nothing.
          </span>
        </p>
        <p className="owner-count">
          <strong>
            {activation.counts.on} of {activation.counts.total}
          </strong>{' '}
          customer modules are switched on in the settings of this deployment
          {deployment === 'unknown' ? '' : ` (${deployment})`}. Each one also needs its database
          install, which is checked separately.
        </p>
        <section aria-labelledby="owner-waiting" className="owner-section owner-section-tight">
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
        <section aria-labelledby="owner-blocked" className="owner-section owner-section-tight">
          <h2 id="owner-blocked">Blocked</h2>
          <ul className="owner-gaps">
            {blockedItems.map((item) => (
              <li key={item.id}>
                <span className="owner-label">{item.name}</span>
                <span className="owner-state">
                  <StatusBadge tone="critical">Blocked</StatusBadge>
                </span>
                <span className="owner-line">{item.reason}</span>
                <span className="owner-line">Who acts: {item.whoActs}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="owner-gaps" className="owner-section owner-section-tight">
          <h2 id="owner-gaps">Open gaps</h2>
          <p>
            These {deferredControls.length} controls are open. Each one is deferred by your decision
            to launch at small scale. None of them is passed or approved.
          </p>
          <ul className="owner-gaps owner-gap-cards">
            {deferredControls.map((control) => {
              const gap = ownerGaps.find((g) => g.id === control.id);
              const signal = gap ? gapSignal(gap.id) : null;
              return (
                <li key={control.id}>
                  <span className="owner-label">
                    <code className="owner-code">{control.id}</code> {control.name}
                  </span>
                  <span className="owner-state">
                    <StatusBadge tone="caution">Open</StatusBadge>
                    <span>{DEFERRED_LABEL}</span>
                  </span>
                  <span className="owner-line">Risk: {control.risk}</span>
                  <span className="owner-line">Who acts: {control.whoActs}</span>
                  {gap && (
                    <span className="owner-line">
                      Register: {gap.status}.{signal ? ` ${signal}` : ''}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </section>
      <details className="owner-technical">
        <summary>Technical details</summary>
        <p className="owner-note">{activation.note}</p>
        <section aria-labelledby="owner-switches" className="owner-section">
          <h2 id="owner-switches">What is on and off</h2>
          {groups.map((group) => (
            <section
              key={group.group}
              aria-labelledby={groupId(group.group)}
              className="owner-group"
            >
              <h3 id={groupId(group.group)}>{group.group}</h3>
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
            </article>
          ))}
          <p>
            Install steps for these records are in the owner technical setup runbook,
            docs/runbooks/owner-technical-setup.md in the repository.
          </p>
        </section>
      </details>
      <Link className="text-link" href="/operator">
        Back to your workspace
      </Link>
    </WorkspaceShell>
  );
}
