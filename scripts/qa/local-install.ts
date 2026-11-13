import type { DatabasePool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import { migrateViewAs } from '../../packages/db/src/view-as-migrate';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCustomerRequestDetails } from '../../packages/db/src/customer-detail-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../../packages/db/src/customer-mission-draft-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerParticipants } from '../../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeContext } from '../../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerProgrammeEconomics } from '../../packages/db/src/customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from '../../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerProgrammeTemplates } from '../../packages/db/src/customer-programme-templates-migrate';
import { migrateCustomerProgrammePricing } from '../../packages/db/src/customer-programme-pricing-migrate';
import { migrateCustomerMissionShares } from '../../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerAdmission } from '../../packages/db/src/customer-admission-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerOrganisationLinks } from '../../packages/db/src/customer-organisation-link-migrate';
import { migrateCustomerRequestAdmission } from '../../packages/db/src/customer-request-admission-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { migrateCustomerServiceRequests } from '../../packages/db/src/customer-service-request-migrate';
import { migrateCustomerBilling } from '../../packages/db/src/customer-billing-migrate';
import { migrateCustomerInvoicing } from '../../packages/db/src/customer-invoicing-migrate';
import { migrateCommercialReadiness } from '../../packages/db/src/commercial-readiness-migrate';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerRequestWithdrawal } from '../../packages/db/src/customer-request-withdrawal-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerParticipantLabels } from '../../packages/db/src/customer-participant-label-migrate';
import { migrateCustomerProgrammePublication } from '../../packages/db/src/customer-programme-publication-migrate';
import { migrateRecipientResponseRevision } from '../../packages/db/src/recipient-response-revision-migrate';
import { migrateCustomerSpecificationConfirmation } from '../../packages/db/src/customer-specification-confirmation-migrate';
import { migrateCustomerCommercialArrangements } from '../../packages/db/src/customer-commercial-arrangement-migrate';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { migrateCustomerMissionMail } from '../../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerMoves } from '../../packages/db/src/customer-move-migrate';
import { migrateReplyReview } from '../../packages/db/src/recipient-reply-review-migrate';
import { migrateCustomerNotifications } from '../../packages/db/src/customer-notification-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerProblemReports } from '../../packages/db/src/customer-problem-report-migrate';
import { migrateCustomerProgrammeErasure } from '../../packages/db/src/customer-programme-erasure-migrate';
import { migrateCounterpartyChanges } from '../../packages/db/src/counterparty-change-migrate';
import { migrateSupplySources } from '../../packages/db/src/supply-source-migrate';
import { migrateCustomerPaymentsSimulated } from '../../packages/db/src/customer-payments-simulated-migrate';
import {
  migrateCustomerWorkspaceLifecycle,
  refreshCustomerWorkspaceLifecycle,
} from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { configureReplyReview } from '../../packages/delivery/src/reply-review-configuration';
import { configureRecipientRevision } from '../../packages/delivery/src/recipient-revision-configuration';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';

// Installs every optional module that scripts/install-customer-modules.ts installs, in the same order, into a LOCAL
// throwaway database, so a signed-in browser run meets the same schema production has. Not installed on purpose: the
// real billing and real invoicing modules (their real-money gates stay closed). Local synthetic runs only.
type Installer = [string, (pool: DatabasePool) => Promise<unknown>];
export const localInstallers: Installer[] = [
  ['customer authority', migrateCustomerAuthority],
  ['saved commercial reports', migrateCustomerSavedMissions],
  ['company continuity', migrateCustomerCompanies],
  ['report decisions', migrateCustomerDecisions],
  ['assigned missions', migrateCustomerDelivery],
  ['request details', migrateCustomerRequestDetails],
  ['organisation profiles', migrateCustomerOrganisationProfiles],
  ['guided request drafts', migrateCustomerMissionDrafts],
  ['programmes', migrateCustomerProgrammes],
  ['participants', migrateCustomerParticipants],
  ['programme context', migrateCustomerProgrammeContext],
  ['programme economics', migrateCustomerProgrammeEconomics],
  ['programme coordination', migrateCustomerProgrammeCoordination],
  ['programme templates', migrateCustomerProgrammeTemplates],
  ['programme pricing', migrateCustomerProgrammePricing],
  ['mission sharing', migrateCustomerMissionShares],
  ['open synthetic admission', migrateCustomerAdmission],
  ['member roles', migrateCustomerMemberRoles],
  ['company links', migrateCustomerOrganisationLinks],
  ['request admission', migrateCustomerRequestAdmission],
  ['programme terms', migrateCustomerProgrammeTerms],
  ['paid-service requests', migrateCustomerServiceRequests],
  ['plans and entitlements', migrateCustomerBilling],
  ['invoices and payment records', migrateCustomerInvoicing],
  ['commercial readiness', migrateCommercialReadiness],
  ['programme projections', migrateCustomerProgrammeProjections],
  ['trip and supplier books', migrateCustomerBooks],
  ['decision cards', migrateCustomerDecisionCards],
  ['real-use schema', migrateCustomerRealUse],
  ['request withdrawal', migrateCustomerRequestWithdrawal],
  ['programme lifecycle', migrateCustomerProgrammeLifecycle],
  ['workspace lifecycle', migrateCustomerWorkspaceLifecycle],
  ['workspace lifecycle refresh', refreshCustomerWorkspaceLifecycle],
  ['participant labels', migrateCustomerParticipantLabels],
  ['programme publication', migrateCustomerProgrammePublication],
  ['answer correction', migrateRecipientResponseRevision],
  ['specification confirmation', migrateCustomerSpecificationConfirmation],
  ['commercial arrangements', migrateCustomerCommercialArrangements],
  ['network real use', migrateNetworkRealUse],
  ['mission mail', migrateCustomerMissionMail],
  ['move records', migrateCustomerMoves],
  ['reply review (all files, ADR-081 0003 included)', migrateReplyReview],
  ['notifications', migrateCustomerNotifications],
  ['account lifecycle', migrateCustomerAccountLifecycle],
  ['problem reports', migrateCustomerProblemReports],
  ['programme erasure', migrateCustomerProgrammeErasure],
  ['counterparty changes', migrateCounterpartyChanges],
  ['supply sources', migrateSupplySources],
  ['simulated payments', migrateCustomerPaymentsSimulated],
  ['view as', migrateViewAs],
];

export async function installLocalModules(
  pool: DatabasePool,
  log: (line: string) => void = () => undefined,
) {
  await migrate(pool);
  for (const [name, install] of localInstallers) {
    await install(pool);
    log(`installed: ${name}`);
  }
}

/** Pins the customer issuer to the one the stand-in answers for, with the seeded service principal as executor. */
export async function pinLocalCustomerIssuer(pool: DatabasePool, issuer: string) {
  const {
    rows: [service],
  } = await pool.query("SELECT id FROM identity.principal WHERE kind='service' LIMIT 1");
  if (!service) throw new Error('No service principal to record customer events under');
  return pinCustomerAuthority(pool, { issuer, executorId: service.id });
}

/**
 * Opens the reply review and answer correction controls in the local throwaway database (ADR-081 needs them). The
 * controls that depend on the real-use configuration (workspace and account lifecycle, notifications, move records)
 * stay closed: initialising that configuration would open real use, which no sweep may do. Mission mail, real billing,
 * real invoicing and the network controls are never opened either.
 */
export async function openLocalControls(pool: DatabasePool) {
  const reason = 'Local signed-in sweep opens this control in a throwaway database';
  const opened: Record<string, (pool: DatabasePool, input: unknown) => Promise<unknown>> = {
    'answer correction': configureRecipientRevision,
    'reply review': configureReplyReview,
  };
  for (const configure of Object.values(opened)) await configure(pool, { enabled: true, reason });
}
