import { migrateCustomerProgrammeProjections } from '../packages/db/src/customer-programme-projection-migrate';
import { migrateCustomerBooks } from '../packages/db/src/customer-book-migrate';
import { migrateCustomerDecisionCards } from '../packages/db/src/customer-decision-card-migrate';
import { migrateCustomerProgrammeLifecycle } from '../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerParticipantLabels } from '../packages/db/src/customer-participant-label-migrate';
import { migrateCustomerProgrammePublication } from '../packages/db/src/customer-programme-publication-migrate';
import { migrateRecipientResponseRevision } from '../packages/db/src/recipient-response-revision-migrate';
import { databasePool } from './database-pool';
import { migrateCustomerAuthority } from '../packages/db/src/customer-migrate';
import { migrateCustomerSavedMissions } from '../packages/db/src/customer-commercial-migrate';
import { migrateCustomerCompanies } from '../packages/db/src/customer-company-migrate';
import { migrateCustomerDecisions } from '../packages/db/src/customer-decision-migrate';
import { migrateCustomerSpecificationConfirmation } from '../packages/db/src/customer-specification-confirmation-migrate';
import { migrateCustomerCommercialArrangements } from '../packages/db/src/customer-commercial-arrangement-migrate';
import { migrateCustomerDelivery } from '../packages/db/src/customer-delivery-migrate';
import { migrateCustomerRequestDetails } from '../packages/db/src/customer-detail-migrate';
import { migrateCustomerOrganisationProfiles } from '../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../packages/db/src/customer-mission-draft-migrate';
import { migrateCustomerProgrammes } from '../packages/db/src/customer-programme-migrate';
import { migrateCustomerParticipants } from '../packages/db/src/customer-participant-migrate';
import { migrateCustomerProgrammeContext } from '../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerProgrammeEconomics } from '../packages/db/src/customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from '../packages/db/src/customer-programme-coordination-migrate';
import { migrateCustomerProgrammeTemplates } from '../packages/db/src/customer-programme-templates-migrate';
import { migrateCustomerProgrammePricing } from '../packages/db/src/customer-programme-pricing-migrate';
import { migrateCustomerMissionShares } from '../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerMemberRoles } from '../packages/db/src/customer-member-role-migrate';
import { migrateCustomerOrganisationLinks } from '../packages/db/src/customer-organisation-link-migrate';
import { migrateCustomerProgrammeTerms } from '../packages/db/src/customer-programme-terms-migrate';
import { migrateCustomerServiceRequests } from '../packages/db/src/customer-service-request-migrate';
import { migrateCustomerBilling } from '../packages/db/src/customer-billing-migrate';
import { migrateCustomerInvoicing } from '../packages/db/src/customer-invoicing-migrate';
import { migrateCustomerAdmission } from '../packages/db/src/customer-admission-migrate';
import { migrateCustomerRequestAdmission } from '../packages/db/src/customer-request-admission-migrate';
import { pinCustomerAuthority } from '../packages/auth/src/customer-authority-pin';
import { migrateCustomerRealUse } from '../packages/db/src/customer-real-use-migrate';
import { configureCustomerRealUse } from '../packages/auth/src/customer-real-use-configuration';
import { migrateNetworkRealUse } from '../packages/db/src/network-real-use-migrate';
import { configureNetworkRealUse } from '../packages/auth/src/network-real-use-configuration';
import { migrateCustomerMissionMail } from '../packages/db/src/customer-mission-mail-migrate';
import { migrateCustomerRequestWithdrawal } from '../packages/db/src/customer-request-withdrawal-migrate';
import {
  migrateCustomerWorkspaceLifecycle,
  refreshCustomerWorkspaceLifecycle,
} from '../packages/db/src/customer-workspace-lifecycle-migrate';
import { migrateCustomerAccountLifecycle } from '../packages/db/src/customer-account-lifecycle-migrate';
import { migrateCustomerProblemReports } from '../packages/db/src/customer-problem-report-migrate';
import { migrateCustomerRequestReferences } from '../packages/db/src/customer-request-reference-migrate';
import { migrateCustomerProgrammeErasure } from '../packages/db/src/customer-programme-erasure-migrate';
import { migrateCounterpartyChanges } from '../packages/db/src/counterparty-change-migrate';
import { configureCounterpartyChanges } from '../packages/auth/src/counterparty-change-configuration';
import { migrateSourcingWorkflow } from '../packages/db/src/sourcing-workflow-migrate';
import { migrateAiModelPolicyReal } from '../packages/db/src/ai-model-policy-real-migrate';
import { migrateAiRealRuns } from '../packages/db/src/ai-real-runs-migrate';
import { migrateOutreachReal } from '../packages/db/src/outreach-real-migrate';
import { configureSourcingWorkflow } from '../packages/auth/src/sourcing-workflow-configuration';
import { migrateSupplySources } from '../packages/db/src/supply-source-migrate';
import { migrateHelperInterest } from '../packages/db/src/helper-interest-migrate';
import { migrateCustomerPersonalProfiles } from '../packages/db/src/customer-personal-profile-migrate';
import { migrateCustomerProfilePictures } from '../packages/db/src/customer-profile-picture-migrate';
import {
  migrateViewerReplyMetadata,
  refreshViewerReplyMetadata,
} from '../packages/db/src/viewer-reply-metadata-migrate';
import { migrateViewerExportAccess } from '../packages/db/src/viewer-export-access-migrate';
import { migrateQuotationLinkCheck } from '../packages/db/src/quotation-link-check-migrate';
import { migrateMemberNotice } from '../packages/db/src/member-notice-migrate';
import { migrateMemberAccess } from '../packages/db/src/member-access-migrate';
import {
  assertMemberNoticeLive,
  deliverMemberNotice,
  memberNoticeDispatcher,
} from '../packages/db/src/member-notice-deliver';
import { configureSupplySources } from '../packages/auth/src/supply-source-configuration';
import { configureAiRealRuns } from '../packages/auth/src/ai-real-configuration';
import { configureWorkspaceLifecycle } from '../packages/auth/src/customer-workspace-lifecycle-configuration';
import { configureAccountLifecycle } from '../packages/auth/src/customer-account-lifecycle-configuration';
import { migrateCustomerMoves } from '../packages/db/src/customer-move-migrate';
import { configureMoveRecords } from '../packages/auth/src/customer-move-configuration';
import { migrateCustomerNotifications } from '../packages/db/src/customer-notification-migrate';
import { migrateCommercialReadiness } from '../packages/db/src/commercial-readiness-migrate';
import {
  configureNotifications,
  emailAddressSourceReady,
} from '../packages/auth/src/customer-notification-configuration';
import { migrateReplyReview } from '../packages/db/src/recipient-reply-review-migrate';
import { configureReplyReview } from '../packages/delivery/src/reply-review-configuration';
import { configureRecipientRevision } from '../packages/delivery/src/recipient-revision-configuration';
import { configureMissionMail } from '../packages/auth/src/customer-mission-mail-configuration';
import { configureRequestWithdrawal } from '../packages/auth/src/customer-request-withdrawal-configuration';
import { migrateCustomerBillingReal } from '../packages/db/src/customer-billing-real-migrate';
import { configureRealBilling } from '../packages/auth/src/customer-billing-real-configuration';
import { migrateCustomerInvoicingReal } from '../packages/db/src/customer-invoicing-real-migrate';
import { configureRealInvoicing } from '../packages/auth/src/customer-invoicing-real-configuration';
import {
  describeSupplierChange,
  parseSupplierSecret,
  setSupplierFromSecret,
  supplierSecretName,
} from '../packages/auth/src/customer-invoicing-real-supplier-secret';
import { migrateCustomerPaymentsSimulated } from '../packages/db/src/customer-payments-simulated-migrate';
import { configureSimulatedPayments } from '../packages/auth/src/customer-payments-simulated-configuration';
import { migrateViewAs } from '../packages/db/src/view-as-migrate';
import { inventoryDataCleanup } from '../packages/auth/src/customer-data-cleanup';
import { reportQaDataRetire } from '../packages/auth/src/customer-qa-data-retire';
import { migrateCustomerRealIntakeOwner } from '../packages/db/src/customer-real-intake-owner-migrate';
import {
  changeRealIntakeOwner,
  previewCustomerRealIntakeOwnerInstall,
} from '../packages/auth/src/customer-real-intake-owner';
import {
  assertNoneBehind,
  refreshInstalledOptionalModules,
} from '../packages/db/src/customer-optional-refresh';
import { endMigrationRun, startMigrationRun } from '../packages/db/src/migration-run';
import { z } from 'zod';

// Owner-run release job only. It installs the optional customer modules, in dependency order, into the
// approved Frankfurt database. The default is a read-only report; nothing is written without
// INSTALL_APPLY=yes. Every installer is idempotent and refuses a changed or missing applied file.
const v = z
  .object({
    MIGRATION_DATABASE_URL: z.url(),
    MIGRATION_DATABASE_HOST: z.string().min(1),
    INSTALL_APPLY: z.string().optional(),
    REAL_USE_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    NETWORK_USE_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    MISSION_MAIL_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    REQUEST_WITHDRAWAL_ACTION: z.enum(['unchanged', 'enable', 'pause']).default('unchanged'),
    WORKSPACE_LIFECYCLE_ACTION: z
      .enum(['unchanged', 'install', 'enable', 'pause'])
      .default('unchanged'),
    ACCOUNT_LIFECYCLE_ACTION: z
      .enum(['unchanged', 'install', 'enable', 'pause'])
      .default('unchanged'),
    PROBLEM_REPORTS_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    PROGRAMME_PAGES_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    HELPER_INTEREST_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    PROGRAMME_ERASURE_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    PERSONAL_PROFILE_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    PROFILE_PICTURE_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    // ADR-089: real workspaces may hold a model policy only; AI inference stays off.
    AI_MODEL_POLICY_REAL_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    // ADR-091: AI runs, results and reviews in real workspaces. Install leaves the control closed; enable and pause need a reason.
    AI_REAL_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    AI_REAL_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    OUTREACH_REAL_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    VIEWER_REPLY_METADATA_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    VIEWER_EXPORT_ACCESS_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    QUOTATION_LINK_CHECK_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    // ADR-087 U4: install writes no row; deliver writes the notices for the listed workspaces (or all) and starts their 4d clock.
    MEMBER_NOTICE_ACTION: z.enum(['unchanged', 'install', 'deliver']).default('unchanged'),
    MEMBER_ACCESS_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    // Only for deliver: the live app's https origin (repository variable APP_ORIGIN), asked before anything is written.
    MEMBER_NOTICE_APP_ORIGIN: z.string().optional(),
    COUNTERPARTY_CHANGES_ACTION: z
      .enum(['unchanged', 'install', 'enable', 'pause'])
      .default('unchanged'),
    COUNTERPARTY_CHANGES_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    SOURCING_WORKFLOW_ACTION: z
      .enum(['unchanged', 'install', 'enable', 'pause'])
      .default('unchanged'),
    SOURCING_WORKFLOW_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    SUPPLY_SOURCES_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    SUPPLY_SOURCES_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    MOVE_RECORDS_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    MOVE_RECORDS_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    NOTIFICATIONS_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    REPLY_REVIEW_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    SPECIFICATION_CONFIRMATION_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    PROGRAMME_LIFECYCLE_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    PARTICIPANT_LABELS_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    RESPONSE_REVISION_ACTION: z
      .enum(['unchanged', 'install', 'enable', 'pause'])
      .default('unchanged'),
    COMMERCIAL_ARRANGEMENTS_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    REPLY_REVIEW_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    NOTIFICATIONS_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    REAL_BILLING_ACTION: z.enum(['unchanged', 'install', 'enable', 'pause']).default('unchanged'),
    REAL_BILLING_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    REAL_INVOICING_ACTION: z
      .enum([
        'unchanged',
        'install',
        'enable',
        'pause',
        'set_supplier',
        'allow_single_approver',
        'require_second_approver',
      ])
      .default('unchanged'),
    REAL_INVOICING_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    SIMULATED_PAYMENTS_ACTION: z
      .enum(['unchanged', 'install', 'enable', 'pause', 'set_refund_window'])
      .default('unchanged'),
    SIMULATED_PAYMENTS_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    SIMULATED_PAYMENTS_REFUND_DAYS: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.coerce.number().int().min(1).max(90).optional(),
    ),
    VIEW_AS_ACTION: z.enum(['unchanged', 'install']).default('unchanged'),
    DATA_CLEANUP_ACTION: z.enum(['unchanged', 'inventory']).default('unchanged'),
    // B11b: where the QA test data stands and who retires each item on which screen. Read only, so it carries no reason and
    // is refused together with INSTALL_APPLY=yes.
    QA_DATA_RETIRE_ACTION: z.enum(['unchanged', 'report']).default('unchanged'),
    // B11a: the founder becomes the owner of new real requests and the two sample members leave the real workspace only.
    REAL_INTAKE_OWNER_ACTION: z.enum(['unchanged', 'apply']).default('unchanged'),
    REAL_INTAKE_OWNER_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    WORKSPACE_LIFECYCLE_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    ACCOUNT_LIFECYCLE_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    REQUEST_WITHDRAWAL_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    MISSION_MAIL_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    NETWORK_USE_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    // The workflow always passes this input, empty when unused: blank means not provided.
    REAL_USE_REASON: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(10).max(500).optional(),
    ),
    // Optional: pin the customer issuer and event executor after the modules are installed.
    CUSTOMER_ISSUER: z.string().optional(),
    CUSTOMER_EXECUTOR_ID: z.string().optional(),
  })
  .parse(process.env);
// The supplier details for set_supplier come only from the secret REAL_INVOICING_SUPPLIER_JSON of the protected
// customer-modules-install environment (owner, 17 Nov 2026). They are read here, outside the schema above, and removed
// from the environment at once, so no validation error or later step can carry them. Nothing prints any part of them.
const supplierSecret = process.env[supplierSecretName];
delete process.env[supplierSecretName];
const url = new URL(v.MIGRATION_DATABASE_URL);
if (
  url.hostname !== v.MIGRATION_DATABASE_HOST ||
  !url.hostname.endsWith('.eu-central-1.aws.neon.tech') ||
  url.searchParams.get('sslmode') !== 'verify-full' ||
  url.username !== 'corridra_migrator' ||
  url.pathname !== '/corridra'
)
  throw new Error('Install target does not match the approved Frankfurt database');
const apply = v.INSTALL_APPLY === 'yes';
if (v.PROGRAMME_LIFECYCLE_ACTION !== 'unchanged' && !apply)
  throw new Error('PROGRAMME_LIFECYCLE_ACTION needs INSTALL_APPLY=yes');
if (v.PARTICIPANT_LABELS_ACTION !== 'unchanged' && !apply)
  throw new Error('PARTICIPANT_LABELS_ACTION needs INSTALL_APPLY=yes');
if (v.RESPONSE_REVISION_ACTION !== 'unchanged' && !apply)
  throw new Error('RESPONSE_REVISION_ACTION needs INSTALL_APPLY=yes');
if (v.SPECIFICATION_CONFIRMATION_ACTION !== 'unchanged' && !apply)
  throw new Error('Specification confirmation installation requires INSTALL_APPLY=yes');
if (v.COMMERCIAL_ARRANGEMENTS_ACTION !== 'unchanged' && !apply)
  throw new Error('Commercial arrangement installation requires INSTALL_APPLY=yes');
if (v.REAL_USE_ACTION !== 'unchanged' && !apply)
  throw new Error('Real-use changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.REAL_USE_ACTION) && !v.REAL_USE_REASON)
  throw new Error('Real-use admission changes require an explicit reason');
if (v.NETWORK_USE_ACTION !== 'unchanged' && !apply)
  throw new Error('Network changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.NETWORK_USE_ACTION) && !v.NETWORK_USE_REASON)
  throw new Error('Network changes require an explicit reason');
if (v.VIEW_AS_ACTION !== 'unchanged' && !apply)
  throw new Error('View-as changes require INSTALL_APPLY=yes');
if (v.REAL_BILLING_ACTION !== 'unchanged' && !apply)
  throw new Error('Real billing changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.REAL_BILLING_ACTION) && !v.REAL_BILLING_REASON)
  throw new Error('Real billing changes require an explicit reason');
if (v.REAL_INVOICING_ACTION !== 'unchanged' && !apply)
  throw new Error('Real invoicing changes require INSTALL_APPLY=yes');
if (!['unchanged', 'install'].includes(v.REAL_INVOICING_ACTION) && !v.REAL_INVOICING_REASON)
  throw new Error('Real invoicing changes require an explicit reason');
// Fails closed before anything is written: a missing, malformed or invalid secret stops the run here, before the report,
// any migration or any write. The error names the secret, field names and problem codes only.
if (v.REAL_INVOICING_ACTION === 'set_supplier') parseSupplierSecret(supplierSecret);
if (v.SIMULATED_PAYMENTS_ACTION !== 'unchanged' && !apply)
  throw new Error('Simulated payments changes require INSTALL_APPLY=yes');
if (!['unchanged', 'install'].includes(v.SIMULATED_PAYMENTS_ACTION) && !v.SIMULATED_PAYMENTS_REASON)
  throw new Error('Simulated payments changes require an explicit reason');
if (v.SIMULATED_PAYMENTS_ACTION === 'set_refund_window' && !v.SIMULATED_PAYMENTS_REFUND_DAYS)
  throw new Error('Setting the refund window needs the number of days');
// The QA data retirement report (B11b) is read only and never shares a run with an install: refused here, before the
// report and before any installer or migration runs.
if (v.QA_DATA_RETIRE_ACTION !== 'unchanged' && apply)
  throw new Error('The QA data retirement report is read only: run it without INSTALL_APPLY=yes');
// No INSTALL_APPLY guard on purpose: without INSTALL_APPLY=yes this action is its own dry run and writes nothing.
if (v.REAL_INTAKE_OWNER_ACTION === 'apply' && !v.REAL_INTAKE_OWNER_REASON)
  throw new Error('The real intake owner change requires an explicit reason');
if (v.REQUEST_WITHDRAWAL_ACTION !== 'unchanged' && !apply)
  throw new Error('Request withdrawal changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.REQUEST_WITHDRAWAL_ACTION) && !v.REQUEST_WITHDRAWAL_REASON)
  throw new Error('Request withdrawal changes require an explicit reason');
if (v.WORKSPACE_LIFECYCLE_ACTION !== 'unchanged' && !apply)
  throw new Error('Workspace lifecycle changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.WORKSPACE_LIFECYCLE_ACTION) && !v.WORKSPACE_LIFECYCLE_REASON)
  throw new Error('Workspace lifecycle changes require an explicit reason');
if (v.ACCOUNT_LIFECYCLE_ACTION !== 'unchanged' && !apply)
  throw new Error('Account lifecycle changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.ACCOUNT_LIFECYCLE_ACTION) && !v.ACCOUNT_LIFECYCLE_REASON)
  throw new Error('Account lifecycle changes require an explicit reason');
if (v.PROBLEM_REPORTS_ACTION !== 'unchanged' && !apply)
  throw new Error('Problem report installation requires INSTALL_APPLY=yes');
if (v.PROGRAMME_PAGES_ACTION !== 'unchanged' && !apply)
  throw new Error('Programme page installation requires INSTALL_APPLY=yes');
if (v.HELPER_INTEREST_ACTION !== 'unchanged' && !apply)
  throw new Error('Helper interest installation requires INSTALL_APPLY=yes');
if (v.PROGRAMME_ERASURE_ACTION !== 'unchanged' && !apply)
  throw new Error('Programme words erasure installation requires INSTALL_APPLY=yes');
if (v.PERSONAL_PROFILE_ACTION !== 'unchanged' && !apply)
  throw new Error('Personal profile installation requires INSTALL_APPLY=yes');
if (v.PROFILE_PICTURE_ACTION !== 'unchanged' && !apply)
  throw new Error('Profile picture installation requires INSTALL_APPLY=yes');
if (v.AI_MODEL_POLICY_REAL_ACTION !== 'unchanged' && !apply)
  throw new Error('AI model policy for real workspaces requires INSTALL_APPLY=yes');
if (v.AI_REAL_ACTION !== 'unchanged' && !apply)
  throw new Error('AI for real workspaces changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.AI_REAL_ACTION) && !v.AI_REAL_REASON)
  throw new Error('AI for real workspaces changes require an explicit reason');
if (v.OUTREACH_REAL_ACTION !== 'unchanged' && !apply)
  throw new Error('Real outreach installation requires INSTALL_APPLY=yes');
if (v.VIEWER_REPLY_METADATA_ACTION !== 'unchanged' && !apply)
  throw new Error('Viewer reply metadata installation requires INSTALL_APPLY=yes');
if (v.VIEWER_EXPORT_ACCESS_ACTION !== 'unchanged' && !apply)
  throw new Error('Viewer export access installation requires INSTALL_APPLY=yes');
if (v.QUOTATION_LINK_CHECK_ACTION !== 'unchanged' && !apply)
  throw new Error('Quotation link check installation requires INSTALL_APPLY=yes');
if (v.MEMBER_NOTICE_ACTION !== 'unchanged' && !apply)
  throw new Error('Member notice installation or delivery requires INSTALL_APPLY=yes');
if (v.MEMBER_ACCESS_ACTION !== 'unchanged' && !apply)
  throw new Error('Member access installation requires INSTALL_APPLY=yes');
// ADR-087 4d: the clock may start only while the /account notice is live. Asked before the report and before any write.
if (v.MEMBER_NOTICE_ACTION === 'deliver') await assertMemberNoticeLive(v.MEMBER_NOTICE_APP_ORIGIN);
if (v.COUNTERPARTY_CHANGES_ACTION !== 'unchanged' && !apply)
  throw new Error('Contact and note changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.COUNTERPARTY_CHANGES_ACTION) && !v.COUNTERPARTY_CHANGES_REASON)
  throw new Error('Contact and note changes require an explicit reason');
if (v.SOURCING_WORKFLOW_ACTION !== 'unchanged' && !apply)
  throw new Error('Sourcing workflow changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.SOURCING_WORKFLOW_ACTION) && !v.SOURCING_WORKFLOW_REASON)
  throw new Error('Sourcing workflow changes require an explicit reason');
if (v.SUPPLY_SOURCES_ACTION !== 'unchanged' && !apply)
  throw new Error('Supply sources changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.SUPPLY_SOURCES_ACTION) && !v.SUPPLY_SOURCES_REASON)
  throw new Error('Supply sources changes require an explicit reason');
if (v.MISSION_MAIL_ACTION !== 'unchanged' && !apply)
  throw new Error('Mission mail changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.MISSION_MAIL_ACTION) && !v.MISSION_MAIL_REASON)
  throw new Error('Mission mail changes require an explicit reason');
if (v.MOVE_RECORDS_ACTION !== 'unchanged' && !apply)
  throw new Error('Move record changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.MOVE_RECORDS_ACTION) && !v.MOVE_RECORDS_REASON)
  throw new Error('Move record changes require an explicit reason');
if (v.REPLY_REVIEW_ACTION !== 'unchanged' && !apply)
  throw new Error('Reply review changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.REPLY_REVIEW_ACTION) && !v.REPLY_REVIEW_REASON)
  throw new Error('Reply review changes require an explicit reason');
if (v.NOTIFICATIONS_ACTION !== 'unchanged' && !apply)
  throw new Error('Notification changes require INSTALL_APPLY=yes');
if (['enable', 'pause'].includes(v.NOTIFICATIONS_ACTION) && !v.NOTIFICATIONS_REASON)
  throw new Error('Notification changes require an explicit reason');

const registries = [
  'customer_request_withdrawal_migrations',
  'customer_workspace_lifecycle_migrations',
  'customer_account_lifecycle_migrations',
  'customer_problem_report_migrations',
  'counterparty_change_migrations',
  'sourcing_workflow_migrations',
  'ai_model_policy_real_migrations',
  'supply_source_migrations',
  'helper_interest_migrations',
  'customer_migrations',
  'customer_commercial_migrations',
  'customer_company_migrations',
  'customer_decision_migrations',
  'customer_specification_confirmation_migrations',
  'customer_commercial_arrangement_migrations',
  'customer_delivery_migrations',
  'customer_detail_migrations',
  'customer_organisation_profile_migrations',
  'customer_mission_draft_migrations',
  'customer_programme_migrations',
  'customer_participant_migrations',
  'customer_programme_context_migrations',
  'customer_programme_economics_migrations',
  'customer_programme_coordination_migrations',
  'customer_programme_templates_migrations',
  'customer_programme_pricing_migrations',
  'customer_mission_share_migrations',
  'customer_admission_migrations',
  'customer_member_role_migrations',
  'customer_organisation_link_migrations',
  'customer_request_admission_migrations',
  'customer_programme_terms_migrations',
  'customer_programme_projection_migrations',
  'customer_book_migrations',
  'customer_decision_card_migrations',
  'customer_request_reference_migrations',
  'customer_service_request_migrations',
  'customer_billing_migrations',
  'customer_invoicing_migrations',
  'customer_real_use_migrations',
  'customer_programme_lifecycle_migrations',
  'customer_participant_label_migrations',
  'customer_programme_publication_migrations',
  'customer_programme_erasure_migrations',
  'customer_personal_profile_migrations',
  'customer_profile_picture_migrations',
  'viewer_reply_metadata_migrations',
  'viewer_export_access_migrations',
  'quotation_link_check_migrations',
  'member_notice_migrations',
  'member_access_migrations',
  'recipient_response_revision_migrations',
  'network_real_use_migrations',
  'customer_billing_real_migrations',
  'customer_invoicing_real_migrations',
  'customer_payments_simulated_migrations',
  'customer_mission_mail_migrations',
  'customer_move_migrations',
  'customer_notification_migrations',
  'recipient_reply_review_migrations',
  'view_as_migrations',
  'commercial_readiness_migrations',
  'customer_real_intake_owner_migrations',
];
// Order matters only for readability: each installer first installs what it depends on.
const installers: [string, (pool: ReturnType<typeof databasePool>) => Promise<void>][] = [
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
  ['programme pricing, series and exports', migrateCustomerProgrammePricing],
  ['mission sharing', migrateCustomerMissionShares],
  ['open synthetic admission', migrateCustomerAdmission],
  ['member roles and leaving', migrateCustomerMemberRoles],
  ['company links', migrateCustomerOrganisationLinks],
  ['request authority with open admission', migrateCustomerRequestAdmission],
  ['programme terms, eligibility and places', migrateCustomerProgrammeTerms],
  ['paid-service requests', migrateCustomerServiceRequests],
  ['synthetic plans, subscriptions and entitlements', migrateCustomerBilling],
  ['synthetic invoices, payment records and credit notes', migrateCustomerInvoicing],
  ['inbox and optional source links (commercial readiness)', migrateCommercialReadiness],
  ['consented programme projections', migrateCustomerProgrammeProjections],
  ['trip and supplier books', migrateCustomerBooks],
  ['decision cards', migrateCustomerDecisionCards],
  // Installing it changes nothing anyone can see: its own control starts closed. It must be in the base run so
  // mission mail 0003 and notifications 0005, installed later in the same run, find it. It needs no mail module.

  // Short request references (RQ-000001): one side table, one trigger on new requests, one read function. It has
  // no control and no switch, and needs only the customer authority module, which its installer brings.
  ['request references', migrateCustomerRequestReferences],
];

const pool = databasePool(v.MIGRATION_DATABASE_URL);
async function report(label: string) {
  const out: string[] = [];
  for (const schema of registries) {
    const exists = await pool.query<{ present: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [schema + '.applied'],
    );
    if (!exists.rows[0]!.present) {
      out.push(`${schema}: not installed`);
      continue;
    }
    const rows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${schema}.applied`,
    );
    out.push(`${schema}: ${rows.rows[0]!.n} applied`);
  }
  const core = await pool.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM migrations.applied',
  );
  // Read-only blast radius for removed member access (owner decision 11 Nov 2026): how many requests belong to a person who
  // is no longer a member of the workspace they were made in. A number only, no id. Inline SQL on purpose, so it works before
  // and after the helpers are installed; it is skipped while the revocation table does not exist.
  const ready = await pool.query<{ ready: boolean }>(
    `SELECT to_regclass('customer_private.workspace_access_revocation') IS NOT NULL
      AND to_regclass('customer_private.owned_request') IS NOT NULL AS ready`,
  );
  if (!ready.rows[0]!.ready) out.push('requests whose author is no longer a member: not installed');
  else {
    const hidden = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM customer_private.owned_request r
      WHERE NOT EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=r.workspace_id AND m.principal_id=r.principal_id)
      AND NOT EXISTS(SELECT FROM customer_private.workspace_member w WHERE w.tenant_id=r.workspace_id AND w.principal_id=r.principal_id
       AND NOT EXISTS(SELECT FROM customer_private.workspace_access_revocation x WHERE x.member_id=w.id))`,
    );
    out.push(`requests whose author is no longer a member: ${hidden.rows[0]!.n}`);
  }
  console.log(`${label}\ncore migrations applied: ${core.rows[0]!.n}\n${out.join('\n')}`);
}
try {
  await report(apply ? 'Before install' : 'Read-only report (nothing written)');
  // Data cleanup inventory (U2), reached only through field_modules_action=data_cleanup_inventory. Read only, in a read-only
  // transaction, so it runs on a dry run too and writes nothing. The log is public: counts and 8-character ids only, and a
  // workspace name only when it is on the keep list. No email or personal detail is printed.
  if (v.DATA_CLEANUP_ACTION !== 'unchanged')
    console.log(
      `Data cleanup inventory (nothing written)\n${(await inventoryDataCleanup(pool)).lines.join('\n')}`,
    );
  // QA test data retirement (B11b, owner decision 23 Nov 2026), reached only through field_modules_action=qa_data_retire.
  // Read only, and refused above together with INSTALL_APPLY=yes: every lifecycle that retires this data needs a signed-in person as its
  // actor, so the people do it on the existing screens and this step lists how each item stands, who retires it and where.
  // It refuses (and the run fails) unless each name matches exactly one record. The log is public: the fixed names and
  // 8-character ids only. No user, identity or account is read by name, changed or deleted.
  if (v.QA_DATA_RETIRE_ACTION !== 'unchanged')
    console.log(
      `QA test data retirement, read only (nothing written)\n${(await reportQaDataRetire(pool)).lines.join('\n')}`,
    );
  // Real intake owner (B11a), dry run: without INSTALL_APPLY=yes it only reads, in a read-only transaction, and lists exactly
  // what an apply would change. It refuses (and the run fails) unless each name matches exactly one person. The log is public:
  // names and 8-character ids only, never an email address.
  if (v.REAL_INTAKE_OWNER_ACTION === 'apply' && !apply) {
    // What an apply needs before it writes: the real-use schema current and app.submit_mission still the pinned text.
    const install = await previewCustomerRealIntakeOwnerInstall(pool);
    const plan = await changeRealIntakeOwner(pool, {
      apply: false,
      reason: v.REAL_INTAKE_OWNER_REASON,
    });
    console.log(
      `Real intake owner change, dry run\n${install.refusal ? `apply would refuse: ${install.refusal}` : `module: ${install.state}`}\n${plan.lines.join('\n')}`,
    );
  }
  if (apply) {
    // Each migrator runs at most once in this run, instead of once per module that depends on it (KI-51). Ended in the
    // finally below. migrateCustomerWorkspaceLifecycle and refreshCustomerWorkspaceLifecycle are deliberately not covered:
    // they are re-run on purpose, after the programme lifecycle is installed.
    startMigrationRun(pool);
    // Only for an explicit mail install: the real-use schema first (the mail installers include it anyway), then the
    // withdrawal tables, so mission mail 0003 and notifications 0005 find them. Never run by a base run.
    const installWithdrawalFirst = async () => {
      await migrateCustomerRealUse(pool);
      await migrateCustomerRequestWithdrawal(pool);
      console.log('installed or already current: request withdrawal (its control stays closed)');
    };
    for (const [name, install] of installers) {
      await install(pool);
      console.log(`installed or already current: ${name}`);
    }
    if (v.CUSTOMER_ISSUER || v.CUSTOMER_EXECUTOR_ID) {
      if (!v.CUSTOMER_ISSUER || !v.CUSTOMER_EXECUTOR_ID)
        throw new Error('Pinning needs both CUSTOMER_ISSUER and CUSTOMER_EXECUTOR_ID');
      const result = await pinCustomerAuthority(pool, {
        issuer: v.CUSTOMER_ISSUER,
        executorId: v.CUSTOMER_EXECUTOR_ID,
      });
      console.log(`customer issuer and executor: ${result.pinned}`);
    }
    if (v.REAL_USE_ACTION !== 'unchanged') {
      await migrateCustomerRealUse(pool);
      // Removed member access reaches the optional modules that are already installed (request withdrawal, move records,
      // mission mail, notifications). Only for an explicit install: it installs nothing that is absent, calls no configure
      // step and writes no control row. A module that cannot advance is reported here and fails the run at the end.
      if (v.REAL_USE_ACTION === 'install')
        for (const row of await refreshInstalledOptionalModules(pool))
          console.log(
            `optional module ${row.module}: ${row.state}${row.detail ? ' (' + row.detail + ')' : ''}`,
          );
      if (v.REAL_USE_ACTION !== 'install') {
        const result = await configureCustomerRealUse(pool, {
          enabled: v.REAL_USE_ACTION === 'enable',
          reason: v.REAL_USE_REASON,
        });
        console.log(
          `Real-use admission ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.PROGRAMME_LIFECYCLE_ACTION === 'install') {
      await migrateCustomerProgrammeLifecycle(pool);
      console.log(
        'installed or already current: programme lifecycle (needs real-use installed first)',
      );
      // The programme guard just installed gets its workspace archive gate when that module is already here.
      if (await refreshCustomerWorkspaceLifecycle(pool))
        console.log('workspace lifecycle re-run so the programme archive gate is current');
    }
    if (v.RESPONSE_REVISION_ACTION !== 'unchanged') {
      await migrateRecipientResponseRevision(pool);
      // Where ADR-087 U2 is already installed, its answer-correction file waits for this table; bring it current now.
      const viewer = await refreshViewerReplyMetadata(pool);
      if (viewer)
        console.log(
          `viewer reply metadata re-run for answer correction: applied ${viewer.applied.join(', ') || 'nothing new'}`,
        );
      if (v.RESPONSE_REVISION_ACTION === 'install') {
        console.log(
          'installed or already current: recipient response revision, closed (needs real-use installed first)',
        );
      } else {
        const result = await configureRecipientRevision(pool, {
          enabled: v.RESPONSE_REVISION_ACTION === 'enable',
          reason:
            v.RESPONSE_REVISION_ACTION === 'enable'
              ? 'Owner opened answer correction from the install workflow'
              : 'Owner paused answer correction from the install workflow',
        });
        console.log(
          `Recipient answer correction ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.PARTICIPANT_LABELS_ACTION === 'install') {
      await migrateCustomerParticipantLabels(pool);
      console.log(
        'installed or already current: participant labels (needs real-use and the programme lifecycle installed first)',
      );
    }
    if (v.SPECIFICATION_CONFIRMATION_ACTION === 'install') {
      await migrateCustomerSpecificationConfirmation(pool);
      console.log(
        'installed or already current: specification confirmation; application switch unchanged',
      );
    }
    if (v.COMMERCIAL_ARRANGEMENTS_ACTION === 'install') {
      await migrateCustomerCommercialArrangements(pool);
      console.log(
        'installed or already current: commercial arrangement metadata; no money activation',
      );
    }
    if (v.NETWORK_USE_ACTION !== 'unchanged') {
      await migrateNetworkRealUse(pool);
      if (v.NETWORK_USE_ACTION !== 'install') {
        const result = await configureNetworkRealUse(pool, {
          enabled: v.NETWORK_USE_ACTION === 'enable',
          reason: v.NETWORK_USE_REASON,
        });
        console.log(
          `Real Network ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.MISSION_MAIL_ACTION !== 'unchanged') {
      await installWithdrawalFirst();
      await migrateCustomerMissionMail(pool);
      if (v.MISSION_MAIL_ACTION !== 'install') {
        const result = await configureMissionMail(pool, {
          enabled: v.MISSION_MAIL_ACTION === 'enable',
          reason: v.MISSION_MAIL_REASON,
        });
        console.log(
          `Mission mail ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.MOVE_RECORDS_ACTION !== 'unchanged') {
      await migrateCustomerMoves(pool);
      if (v.MOVE_RECORDS_ACTION !== 'install') {
        const result = await configureMoveRecords(pool, {
          enabled: v.MOVE_RECORDS_ACTION === 'enable',
          reason: v.MOVE_RECORDS_REASON,
        });
        console.log(
          `Move records ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.REPLY_REVIEW_ACTION !== 'unchanged') {
      await migrateReplyReview(pool);
      if (v.REPLY_REVIEW_ACTION !== 'install') {
        const result = await configureReplyReview(pool, {
          enabled: v.REPLY_REVIEW_ACTION === 'enable',
          reason: v.REPLY_REVIEW_REASON,
        });
        console.log(
          `Reply review ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.NOTIFICATIONS_ACTION !== 'unchanged') {
      await installWithdrawalFirst();
      await migrateCustomerNotifications(pool);
      // The address is read from the sign-in provider's user table at send time. Opening email without that
      // being readable would queue messages that can never be sent, so opening stops here with a plain message.
      // Install and pause only report it: closing email never depends on this check.
      const addressReady = await emailAddressSourceReady(pool);
      console.log(`Email address source readable: ${addressReady ? 'yes' : 'no'}`);
      if (v.NOTIFICATIONS_ACTION === 'enable' && !addressReady)
        throw new Error(
          'Email was not opened: the database owner cannot read the sign-in provider user table (neon_auth.user). The email control was not changed, and the rest of this run was not applied.',
        );
      if (v.NOTIFICATIONS_ACTION !== 'install') {
        const result = await configureNotifications(pool, {
          enabled: v.NOTIFICATIONS_ACTION === 'enable',
          reason: v.NOTIFICATIONS_REASON,
        });
        console.log(
          `Notifications ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    // Request withdrawal is never part of the base run. Its tables are installed, control closed, only as the first
    // step of an explicit mission mail or notifications install (the two mail files that honour a withdrawal need
    // them). Opening or pausing it is an owner decision with a reason; it is not wired to the install workflow, and
    // it runs after the mail installs because opening is refused until both installed mail modules are upgraded.
    if (['enable', 'pause'].includes(v.REQUEST_WITHDRAWAL_ACTION)) {
      const result = await configureRequestWithdrawal(pool, {
        enabled: v.REQUEST_WITHDRAWAL_ACTION === 'enable',
        reason: v.REQUEST_WITHDRAWAL_REASON,
      });
      console.log(
        `Request withdrawal ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
      );
    }
    // Workspace and account lifecycle are never part of the base run: a run with both actions unchanged installs
    // nothing of them. Each installs with its control closed; opening or pausing is an owner decision with a reason.
    // Account lifecycle installs the workspace lifecycle first (its own migration does it). The install workflow reaches
    // both through field_modules_action (lifecycle_install, lifecycle_enable, lifecycle_pause), which moves them together
    // and supplies the reason, so the workflow stays within its 25-input cap.
    if (v.WORKSPACE_LIFECYCLE_ACTION !== 'unchanged') {
      await migrateCustomerWorkspaceLifecycle(pool);
      if (v.WORKSPACE_LIFECYCLE_ACTION === 'install')
        console.log('Workspace lifecycle installed or already current (its control stays closed)');
      else {
        const result = await configureWorkspaceLifecycle(pool, {
          enabled: v.WORKSPACE_LIFECYCLE_ACTION === 'enable',
          reason: v.WORKSPACE_LIFECYCLE_REASON,
        });
        console.log(
          `Workspace lifecycle ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.ACCOUNT_LIFECYCLE_ACTION !== 'unchanged') {
      await migrateCustomerAccountLifecycle(pool);
      if (v.ACCOUNT_LIFECYCLE_ACTION === 'install')
        console.log('Account lifecycle installed or already current (its control stays closed)');
      else {
        const result = await configureAccountLifecycle(pool, {
          enabled: v.ACCOUNT_LIFECYCLE_ACTION === 'enable',
          reason: v.ACCOUNT_LIFECYCLE_REASON,
        });
        console.log(
          `Account lifecycle ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    // Problem reports are never part of the base run. Installing the database module is the whole activation: there is no
    // control and no application switch. It installs the account lifecycle module first (its own migration does it).
    if (v.PROBLEM_REPORTS_ACTION === 'install') {
      await migrateCustomerProblemReports(pool);
      console.log('installed or already current: problem reports');
    }
    // Public programme pages and applications (ADR-080) are never part of the base run. Installing the database module
    // exposes nothing: the application switch CORRIDRA_PROGRAMME_PAGES is separate, and the install refuses before creating
    // anything unless the three participant tables it writes to have a shape it was proven against.
    if (v.PROGRAMME_PAGES_ACTION === 'install') {
      await migrateCustomerProgrammePublication(pool);
      console.log(
        'installed or already current: programme pages and applications, with the read only staff list (application switch unchanged)',
      );
    }
    // The helper interest register (ADR-0085) is never part of the base run. Installing the database module exposes nothing:
    // the form needs CORRIDRA_HELPER_INTEREST and CORRIDRA_NETWORK_ENABLED, both separate and both the owner's, and nothing
    // is stored until real use is enabled. It installs no other module and refuses, naming the step, unless the real-use
    // modules are installed first. Reached only through field_modules_action=helper_interest.
    if (v.HELPER_INTEREST_ACTION === 'install') {
      await migrateHelperInterest(pool);
      console.log(
        'Helper interest register installed or already current (application switches unchanged)',
      );
    }
    // Redaction of the applicant's and participant's words under an erasure request (privacy). Never part of the base run. It
    // installs the account lifecycle, programme pages and participant label modules it depends on, controls left as they were.
    if (v.PROGRAMME_ERASURE_ACTION === 'install') {
      await migrateCustomerProgrammeErasure(pool);
      console.log('installed or already current: programme words erasure');
    }
    // Private personal details and the account security record (ADR-086) are never part of the base run. Installing the
    // database module exposes nothing until the account page reads it. It installs no other module and refuses, naming the
    // step, unless the account lifecycle modules are installed first. Reached only through field_modules_action=personal_profile.
    if (v.PERSONAL_PROFILE_ACTION === 'install') {
      await migrateCustomerPersonalProfiles(pool);
      console.log('installed or already current: personal profile');
    }
    // The private profile picture references (ADR-088) are never part of the base run. Installing the database module
    // exposes nothing: the picture stays hidden until the reviewed profilePicture code switch is turned on. It installs no
    // other module and refuses, naming the step, unless the personal profile module is installed first. Reached only
    // through field_modules_action=profile_picture.
    if (v.PROFILE_PICTURE_ACTION === 'install') {
      await migrateCustomerProfilePictures(pool);
      console.log('installed or already current: profile picture');
    }
    // ADR-087 U2 and U3 are never part of the base run. Each replaces only named read policies (and U2 adds four meta reads),
    // refuses unless every replaced policy is exactly the one it was written against, and refuses unless the real-use modules
    // are installed. Installing changes what a staff viewer reads at once, so each needs the owner's word. Reached only through
    // field_modules_action=viewer_reply_metadata and field_modules_action=viewer_export_access.
    if (v.VIEWER_REPLY_METADATA_ACTION === 'install') {
      const result = await migrateViewerReplyMetadata(pool);
      console.log(
        `installed or already current: viewer reply metadata (applied ${result.applied.join(', ') || 'nothing new'}; waiting for answer correction: ${result.waiting.join(', ') || 'none'})`,
      );
    }
    if (v.VIEWER_EXPORT_ACCESS_ACTION === 'install') {
      const result = await migrateViewerExportAccess(pool);
      console.log(
        `installed or already current: viewer export access (applied ${result.applied.join(', ') || 'nothing new'})`,
      );
    }
    // ADR-087 quotation link check is never part of the base run either. It adds one SECURITY DEFINER boolean and two indexes,
    // refuses unless the real-use modules are installed, and from then on a staff viewer reads no statement or file of a claim
    // any quotation in the workspace names. Reached only through field_modules_action=quotation_link_check, with the owner's word.
    if (v.QUOTATION_LINK_CHECK_ACTION === 'install') {
      const result = await migrateQuotationLinkCheck(pool);
      console.log(
        `installed or already current: quotation link check (applied ${result.applied.join(', ') || 'nothing new'})`,
      );
    }
    // ADR-087 U4, the member notice, is never part of the base run. member_notice installs the module and writes no row.
    // member_notice_deliver installs nothing: it refuses unless the module is installed, then writes one inbox notice to each
    // current member of every real (not synthetic) workspace not yet delivered and records the delivery time, which starts that
    // workspace's 24-hour clock. Never reset; a workspace delivered before is left as it was. It takes no list (Guardian G27,
    // 17 Nov 2026: no 25th workflow input); the database function takes one workspace, so a list can be added later. Run deliver only after U5 is merged and its
    // install approved by the owner: the notice names a switch-on time that must come true. Counts and 8-character ids only.
    if (v.MEMBER_NOTICE_ACTION === 'install') {
      const result = await migrateMemberNotice(pool);
      console.log(
        `installed or already current: member notice (applied ${result.applied.join(', ') || 'nothing new'}; no notice delivered)`,
      );
    }
    if (v.MEMBER_NOTICE_ACTION === 'deliver') {
      // Real workspaces only: the data cleanup classifier's made-up, demo and QA workspaces (reused, read only, never printed
      // here) and archived workspaces are left out. Synthetic workspaces are never candidates.
      const { deliveries: done, skipped } = await deliverMemberNotice(pool, {
        targets: 'all',
        deliveredBy: memberNoticeDispatcher(),
        classify: inventoryDataCleanup,
      });
      const fresh = done.filter((row) => row.delivered);
      console.log(
        `Member notice delivery: workspaces ${done.length}, delivered now ${fresh.length}, already delivered ${done.length - fresh.length}, notices written ${fresh.reduce((n, row) => n + row.notices, 0)}, excluded as made-up, demo or QA ${skipped.listed}, excluded as archived ${skipped.archived}`,
      );
      for (const row of done)
        console.log(
          `  ${row.workspaceId.slice(0, 8)} ${row.delivered ? 'delivered' : 'already delivered'} ${row.deliveredAt.toISOString()} opens ${row.opensAt.toISOString()} notices ${row.notices}`,
        );
    }
    // ADR-087 U5, member access, is never part of the base run. It installs read-only functions only and writes no row; it refuses
    // unless the member notice module (U4) is installed. Each workspace opens 24 hours after its notice delivery, and only while the
    // application switch CORRIDRA_MEMBER_ACCESS is on. The decision card part waits until the decision card module is installed.
    if (v.MEMBER_ACCESS_ACTION === 'install') {
      const result = await migrateMemberAccess(pool);
      console.log(
        `installed or already current: member access (applied ${result.applied.join(', ') || 'nothing new'}${result.waiting.length ? `; waiting ${result.waiting.join(', ')}` : ''}; switch CORRIDRA_MEMBER_ACCESS unchanged)`,
      );
    }
    // Withdraw, correct and hide for private contacts and notes (CRUD G11) are never part of the base run. Install leaves
    // the one control closed; enable and pause are owner decisions with a reason. Reached through field_modules_action
    // (contact_changes_install, contact_changes_enable, contact_changes_pause).
    if (v.COUNTERPARTY_CHANGES_ACTION !== 'unchanged') {
      await migrateCounterpartyChanges(pool);
      if (v.COUNTERPARTY_CHANGES_ACTION === 'install')
        console.log('Contact and note changes installed or already current (control stays closed)');
      else {
        const result = await configureCounterpartyChanges(pool, {
          enabled: v.COUNTERPARTY_CHANGES_ACTION === 'enable',
          reason: v.COUNTERPARTY_CHANGES_REASON,
        });
        console.log(
          `Contact and note changes ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    // The sourcing route profile guard and its one control (ADR-083 slice S1) are never part of the base run. Install leaves the
    // control closed; enable and pause are owner decisions with a reason. Reached through field_modules_action
    // (sourcing_workflow_install, sourcing_workflow_enable, sourcing_workflow_pause). It needs the real-use modules installed.
    if (v.SOURCING_WORKFLOW_ACTION !== 'unchanged') {
      await migrateSourcingWorkflow(pool);
      if (v.SOURCING_WORKFLOW_ACTION === 'install')
        console.log('Sourcing workflow installed or already current (control stays closed)');
      else {
        const result = await configureSourcingWorkflow(pool, {
          enabled: v.SOURCING_WORKFLOW_ACTION === 'enable',
          reason: v.SOURCING_WORKFLOW_REASON,
        });
        console.log(
          `Sourcing workflow ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    // ADR-089 is never part of the base run. It replaces app.guard_ai() after a hash check so real workspaces may hold a reviewed
    // model policy only; runs stay sample-only and AI stays off. Needs the real-use modules installed and the owner's word.
    // Reached only through field_modules_action=ai_model_policy_real.
    if (v.AI_MODEL_POLICY_REAL_ACTION === 'install') {
      await migrateAiModelPolicyReal(pool);
      console.log(
        'AI model policy for real workspaces installed or already current (inference stays off)',
      );
    }
    // ADR-091 is never part of the base run. It lets real workspaces record AI runs, results and reviews behind one control
    // that install leaves closed; enable and pause touch only that control and need a reason. It replaces three functions
    // after hash checks and needs the real-use and network real-use modules installed first. Reached only through
    // field_modules_action (ai_real_install, ai_real_enable, ai_real_pause), and only on the owner's word.
    if (v.AI_REAL_ACTION !== 'unchanged') {
      await migrateAiRealRuns(pool);
      if (v.AI_REAL_ACTION === 'install')
        console.log('AI for real workspaces installed or already current (control stays closed)');
      else {
        const result = await configureAiRealRuns(pool, {
          enabled: v.AI_REAL_ACTION === 'enable',
          reason: v.AI_REAL_REASON,
        });
        console.log(
          `AI for real workspaces ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    // ADR-090 is never part of the base run. It adds the real email lane for introductions behind seven hash-guarded function
    // replacements. It sends nothing and turns nothing on: the switch stays off and the mode stays test. Needs the real-use
    // modules through 0020 and the owner's word. Reached only through OUTREACH_REAL_ACTION=install.
    if (v.OUTREACH_REAL_ACTION === 'install') {
      await migrateOutreachReal(pool);
      console.log('Real outreach module installed or already current (switch off, test mode)');
    }
    // Supply sources (ADR-082) are never part of the base run. Install leaves the module control closed; enable and pause
    // touch only that control and need a reason. Reached through field_modules_action (supply_sources_install,
    // supply_sources_enable, supply_sources_pause). Needs the real-use modules installed first and refuses otherwise.
    if (v.SUPPLY_SOURCES_ACTION !== 'unchanged') {
      await migrateSupplySources(pool);
      if (v.SUPPLY_SOURCES_ACTION === 'install')
        console.log('Supply sources installed or already current (module control stays closed)');
      else {
        const result = await configureSupplySources(pool, {
          enabled: v.SUPPLY_SOURCES_ACTION === 'enable',
          reason: v.SUPPLY_SOURCES_REASON,
        });
        console.log(
          `Supply sources ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.REAL_BILLING_ACTION !== 'unchanged') {
      await migrateCustomerBillingReal(pool);
      if (v.REAL_BILLING_ACTION !== 'install') {
        const result = await configureRealBilling(pool, {
          enabled: v.REAL_BILLING_ACTION === 'enable',
          reason: v.REAL_BILLING_REASON,
        });
        console.log(
          `Real plans ${result.enabled ? 'enabled' : 'paused'}; changed=${result.changed}`,
        );
      }
    }
    if (v.REAL_INVOICING_ACTION !== 'unchanged') {
      await migrateCustomerInvoicingReal(pool);
      if (v.REAL_INVOICING_ACTION === 'install') {
        // Seeds the supplier details on first install (made-up fields are marked) and leaves the control closed.
        const result = await configureRealInvoicing(pool, {
          reason: v.REAL_INVOICING_REASON ?? 'Install real invoicing with the control closed',
        });
        console.log(
          `Real invoices installed; control ${result.enabled ? 'open' : 'closed'}; second approver ${result.requireSecondApprover ? 'required' : 'not required'}; supplier changed=${result.entityChanged}`,
        );
      } else {
        const action = v.REAL_INVOICING_ACTION;
        if (action === 'set_supplier') {
          // Prints only the changed field names, the new version and the made-up field count; never a value.
          const change = await setSupplierFromSecret(pool, {
            raw: supplierSecret,
            reason: v.REAL_INVOICING_REASON,
          });
          console.log(describeSupplierChange(change));
        } else {
          const result = await configureRealInvoicing(pool, {
            reason: v.REAL_INVOICING_REASON,
            ...(action === 'enable' || action === 'pause' ? { enabled: action === 'enable' } : {}),
            ...(action === 'allow_single_approver' || action === 'require_second_approver'
              ? { requireSecondApprover: action === 'require_second_approver' }
              : {}),
          });
          console.log(
            `Real invoices: control ${result.enabled ? 'open' : 'closed'}; second approver ${result.requireSecondApprover ? 'required' : 'not required'}; control changed=${result.controlChanged}; supplier changed=${result.entityChanged}`,
          );
        }
      }
    }
    if (v.SIMULATED_PAYMENTS_ACTION !== 'unchanged') {
      await migrateCustomerPaymentsSimulated(pool);
      const action = v.SIMULATED_PAYMENTS_ACTION;
      // Install leaves the control closed. The made-up refund window defaults to 14 days.
      const result = await configureSimulatedPayments(pool, {
        reason:
          v.SIMULATED_PAYMENTS_REASON ??
          'Install the simulated payment flow with the control closed',
        ...(action === 'enable' || action === 'pause' ? { enabled: action === 'enable' } : {}),
        ...(action === 'set_refund_window'
          ? { refundWindowDays: v.SIMULATED_PAYMENTS_REFUND_DAYS }
          : {}),
      });
      console.log(
        `Simulated payments (madeup): control ${result.enabled ? 'open' : 'closed'}; refund window ${result.refundWindowDays} days (madeup); changed=${result.changed}`,
      );
    }
    if (v.VIEW_AS_ACTION !== 'unchanged') {
      await migrateViewAs(pool);
      console.log('View-as audit function: installed or already current');
    }
    // Real intake owner (B11a, owner decision 23 Nov 2026). Never part of the base run. The module is installed first (it
    // changes no owner by itself and needs the real-use schema), then one transaction appends the founder as the owner of new
    // real requests and ends the two sample memberships in the real workspace only. Nothing is deleted; a second run is unchanged.
    if (v.REAL_INTAKE_OWNER_ACTION === 'apply') {
      await migrateCustomerRealIntakeOwner(pool);
      const result = await changeRealIntakeOwner(pool, {
        apply: true,
        reason: v.REAL_INTAKE_OWNER_REASON,
      });
      console.log(`Real intake owner change: ${result.state}\n${result.lines.join('\n')}`);
    }
    await report('After install');
    // Once more after every mail, notifications and withdrawal step above, so a run that also passes
    // mission_mail_action=install or notifications_action=install ends green, and a module that is still behind ends it red.
    if (v.REAL_USE_ACTION === 'install')
      assertNoneBehind(await refreshInstalledOptionalModules(pool));
    console.log('Install complete. No secret values were written to output.');
  } else {
    console.log('Dry run only. Set INSTALL_APPLY=yes to install.');
  }
} finally {
  endMigrationRun(pool);
  await pool.end();
}
