import Link from 'next/link';
import { StatusBadge } from './access-state';
import { FounderActivation } from './founder-activation';

/** Capability descriptions, never live metrics. Mounted only inside the existing admin panel. */
export function FounderOverview({ tenant }: { tenant: string }) {
  return (
    <section aria-labelledby="founder-overview-title" className="detail-card">
      <h4 id="founder-overview-title">Business overview</h4>
      <p>
        These are implementation capabilities. Mission operations use sample records; an account, a
        passing test or a deployment does not approve real commercial activity.
      </p>
      <dl>
        <dt>What can Corridra do?</dt>
        <dd>
          <a href="#workspace-research">Research and qualify companies</a>,{' '}
          <a href="#workspace-meetings">coordinate introductions and meetings</a>,{' '}
          <a href="#workspace-missions">manage sourcing and machinery requirements</a>, and{' '}
          <a href="#workspace-delivery">deliver staff-managed programmes and scoped reports</a>.
          These reuse the shared mission infrastructure.
        </dd>
        <dt>What is activated?</dt>
        <dd>
          Synthetic mission operations only. Real mission admission, outreach, production AI
          inference and contributor payments remain <StatusBadge tone="caution">GATED</StatusBadge>.
          Check the route-specific evidence before making any availability claim. The table below is
          read from this deployment&apos;s configuration, not from memory.
          <FounderActivation tenant={tenant} />
        </dd>
        <dt>What are customers and operators doing?</dt>
        <dd>
          <a href="#ops-dashboard">Source-backed activity and outcomes</a> show recorded work,
          denominators and missing evidence. Sample activity is not live customer demand.
        </dd>
        <dt>What produces results and revenue?</dt>
        <dd>
          Read the service economics and customer trade sections below. Customer trade value,
          Corridra fee revenue, delivery costs and contributor obligations stay separate. Missing
          financial evidence means unknown, not zero. Organiser programme economics, coordination
          and templates are built behind closed gates and stay{' '}
          <StatusBadge tone="caution">PARTIAL</StatusBadge> until verified.
        </dd>
        <dt>What is blocked, and who acts next?</dt>
        <dd>
          Sample customer workspace provisioning and membership have a tested backend. Sample
          workspace screens remain <StatusBadge tone="caution">GATED</StatusBadge>. Private sample
          request progress has a tested backend; its account view is implemented with exposure
          closed. Original submitted requirements can be reopened through a separately gated
          creator-only detail workspace. These are unverified customer inputs, not research or
          accepted commercial outcomes. Account-saved approved commercial reports and self-declared
          evidence replies reuse existing invitation scopes behind a separate gate. Approved company
          continuity across saved reports has another closed gate. Canonical sample programme
          creation and listing have a separate closed gate. Sample participant invitations,
          consented registrations and programme access changes have another synthetic gate. Private
          participant objective sharing has its own closed gate and exposes only expressly consented
          text. Full participant missions, agendas, meetings and financial operations remain
          unavailable there. Full customer mission administration and company linking remain{' '}
          <StatusBadge tone="unknown">MISSING</StatusBadge>. Engineering must implement and verify
          these separately. The owner and relevant legal, infrastructure, security and provider
          reviewers must supply the independent activation evidence in{' '}
          <a href="#ops-gates">Review activation blockers</a>. Existing approved scoped sharing
          remains available.
        </dd>
      </dl>
      <Link prefetch={false} className="text-link" href="/#mission-example">
        Synthetic product explorer
      </Link>
      <p>
        Illustrations only. Explore the existing sample mission without creating company, financial
        or AI records. This is separate from the recorded activity above.
      </p>
    </section>
  );
}
