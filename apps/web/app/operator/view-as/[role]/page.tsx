import '../view-as.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@corridra/domain';
import { viewAsAvailable, viewAsEnabled, viewAsRole } from '@corridra/auth/view-as';
import { AccessState } from '../../../../components/access-state';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { foundations } from '../../../../lib/foundations';
import { chooseOwnerTenant } from '../../../../lib/owner-access';
import { uxSwitchOn } from '../../../../lib/ux-switches';
import { SampleScreens } from './sample-screens';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const role = viewAsRole((await params).role) ?? 'screen';
  return {
    title: `Preview: ${role} screen | Corridra`,
    robots: { index: false, follow: false },
  };
}

/**
 * Stage 1: a read-only preview with fixed sample content. Every failure, including the switch being
 * off, a role that is not built, no staff session and a role without permission, is the same plain
 * "not found" page, so the route does not announce itself. The one exception is an owner or admin whose
 * authenticator check is too old: they are told to verify again.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ workspace?: string }>;
}) {
  if (!viewAsEnabled()) notFound();
  const role = viewAsRole((await params).role);
  if (!role || !viewAsAvailable(role)) notFound();
  const s = foundations();
  if (!s) notFound();
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity) notFound();
  const tenant = chooseOwnerTenant(
    await s.access.tenants(identity.token),
    (await searchParams).workspace,
  );
  if (!tenant) notFound();
  let verify = false;
  try {
    // Written in the same transaction as the permission and authenticator checks. If it fails,
    // nothing below is shown.
    await s.viewAs.open(
      {
        token: identity.token,
        tenantId: tenant.id,
        purpose: 'synthetic_validation',
        correlationId: randomUUID(),
      },
      role,
    );
  } catch (error) {
    if (error instanceof DomainError && error.status === 401) verify = true;
    else notFound();
  }
  if (verify)
    return (
      <WorkspaceShell eyebrow="PREVIEW" title="Verify your authenticator again.">
        <AccessState kind="denied">
          <p>
            Opening a preview needs a recent authenticator check. Verify it from your workspace,
            then open the preview again.
          </p>
        </AccessState>
        <Link className="text-link" href="/operator">
          Back to your workspace
        </Link>
      </WorkspaceShell>
    );
  return (
    <div className="ux-view-as">
      <div className="view-as-bar" role="region" aria-label="Preview notice">
        <p>
          PREVIEW AS CUSTOMER. Sample data. This is not a real account. Nothing here can be saved or
          sent.
        </p>
        <Link className="text-link" href="/operator" prefetch={false}>
          Close preview
        </Link>
      </div>
      <main id="main" lang="en" dir="ltr" tabIndex={-1} className="operator-page ux-workspace">
        <header className="ux-page-heading">
          <p className="label">PREVIEW</p>
          <h1>What a customer sees.</h1>
        </header>
        <div className="view-as-stage">
          {/* Inert: nothing in the preview can be clicked, focused or submitted. */}
          <div className="view-as-content" inert>
            <section className="view-as-card" aria-label="Sample mission one">
              <h2>Sample mission: Hotel towels for Spain</h2>
              <p>Status: waiting on you</p>
              <p>Your next step: confirm the sample size for the first check.</p>
            </section>
            <section className="view-as-card" aria-label="Sample mission two">
              <h2>Sample mission: Packaging suppliers in Germany</h2>
              <p>Status: in progress</p>
              <p>We are checking what each supplier says about itself.</p>
            </section>
            <section className="view-as-card" aria-label="Sample messages">
              <h2>Sample messages</h2>
              <p>No messages yet. Replies from the Corridra team appear here.</p>
            </section>
            {uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS') && <SampleScreens />}
          </div>
        </div>
      </main>
    </div>
  );
}
