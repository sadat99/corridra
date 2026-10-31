import { CustomerDeliveredReportService } from '@corridra/auth/customer-delivered-reports';
import { listDeliveredPublications } from '@corridra/delivery/delivered-publications';
import { InboxService } from '@corridra/communications/inbox';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { realReportPublicLinkEnabled } from '@corridra/auth/real-report-access';
import {
  CustomerMissionDraftService,
  customerMissionDraftsEnabled,
} from '@corridra/auth/customer-mission-drafts';
import {
  CustomerProgrammeTemplateService,
  customerProgrammeTemplatesEnabled,
} from '@corridra/auth/customer-programme-templates';
import {
  CustomerProgrammePricingService,
  customerProgrammePricingEnabled,
} from '@corridra/auth/customer-programme-pricing';
import {
  CustomerProgrammeCoordinationService,
  customerProgrammeCoordinationEnabled,
} from '@corridra/auth/customer-programme-coordination';
import {
  CustomerProgrammeEconomicsService,
  customerProgrammeEconomicsEnabled,
} from '@corridra/auth/customer-programme-economics';
import {
  CustomerOrganisationProfileService,
  customerOrganisationProfilesEnabled,
} from '@corridra/auth/customer-organisation-profiles';
import {
  CustomerProgrammeTermsService,
  customerProgrammeTermsEnabled,
} from '@corridra/auth/customer-programme-terms';
import {
  CustomerServiceRequestService,
  customerServiceRequestsEnabled,
} from '@corridra/auth/customer-service-requests';
import {
  CustomerBillingService,
  customerBillingEnabled,
  customerRealBillingEnabled,
} from '@corridra/auth/customer-billing';
import {
  CustomerInvoicingService,
  customerInvoicingEnabled,
} from '@corridra/auth/customer-invoicing';
import { CustomerRealInvoicingService } from '@corridra/auth/customer-invoicing-real';
import { CustomerSimulatedPaymentsService } from '@corridra/auth/customer-payments-simulated';
import { CustomerSimulatedPaymentsStaffService } from '@corridra/delivery/customer-payments-simulated-staff';
import { CustomerRealInvoicingStaffService } from '@corridra/delivery/customer-invoicing-real-staff';
import { CustomerServiceStaffService } from '@corridra/delivery/customer-service-staff';
import { CustomerBillingStaffService } from '@corridra/delivery/customer-billing-staff';
import { CustomerInvoicingStaffService } from '@corridra/delivery/customer-invoicing-staff';
import {
  CustomerMemberRoleService,
  customerMemberRolesEnabled,
} from '@corridra/auth/customer-member-roles';
import {
  CustomerOrganisationLinkService,
  StaffOrganisationLinkService,
  customerOrganisationLinksEnabled,
} from '@corridra/auth/customer-organisation-links';
import {
  CustomerProgrammeContextService,
  customerProgrammeContextEnabled,
} from '@corridra/auth/customer-programme-context';
import {
  CustomerMissionShareService,
  customerMissionSharesEnabled,
} from '@corridra/auth/customer-mission-shares';
import {
  customerIssuerFromEnv,
  customerOpenAdmission,
  customerProductionLocked,
} from '@corridra/auth/customer-production';
import 'server-only';
import { recoverableResource } from './recoverable-resource';
import { localFixtureAdapter } from '@corridra/intelligence/local-fixture';
import { IntelligenceService } from '@corridra/intelligence/service';
import { NetworkService } from '@corridra/network';
import { NetworkInvitations } from '@corridra/auth/network-invitations';
import { Pool, assertRestrictedPool } from '@corridra/db';
import { createIdentity } from '@corridra/auth';
import { operatorRecoveryMailer } from '@corridra/auth/recovery-mail';
import { OperatorSetup } from '@corridra/auth/operator-setup';
import { AccessService } from '@corridra/auth/access';
import {
  CustomerWorkspaceService,
  customerWorkspacesEnabled,
} from '@corridra/auth/customer-workspaces';
import { CustomerRequestService, customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { CustomerMoveService, customerMovesEnabled } from '@corridra/auth/customer-moves';
import { MissionMoveService } from '@corridra/missions/moves';
import {
  CustomerNotificationService,
  PulseService,
  databaseRecipientSource,
  customerNotificationWithdrawalEnabled,
} from '@corridra/auth/customer-notifications';
import { MissionMailService, missionMailApplicationEnabled } from '@corridra/auth/mission-mail';
import { ViewAsService } from '@corridra/auth/view-as';
import {
  CustomerProgrammeService,
  customerProgrammesEnabled,
} from '@corridra/auth/customer-programmes';
import {
  CustomerParticipantService,
  customerParticipantsEnabled,
} from '@corridra/auth/customer-participants';
import {
  CustomerCompanyService,
  customerCompaniesEnabled,
} from '@corridra/auth/customer-companies';
import {
  CustomerSavedMissionService,
  customerSavedMissionsEnabled,
} from '@corridra/auth/customer-saved-missions';
import {
  CustomerRequestDetailService,
  customerRequestDetailsEnabled,
} from '@corridra/auth/customer-request-details';
import {
  CustomerDecisionService,
  customerDecisionsEnabled,
} from '@corridra/auth/customer-decisions';
import { DecisionDisclosureService } from '@corridra/delivery/decision-disclosures';
import { SpecificationConfirmationService } from '@corridra/delivery/specification-confirmation';
import {
  CustomerSpecificationConfirmationService,
  customerSpecificationConfirmationEnabled,
} from '@corridra/auth/customer-specification-confirmation';
import {
  CustomerAssignedMissionService,
  customerDeliveryEnabled,
} from '@corridra/auth/customer-assigned-missions';
import { CustomerDeliveryService } from '@corridra/delivery/customer-delivery';
import { neonAuth } from './neon-auth';
import { EvidenceService, type MalwareScanner } from '@corridra/evidence';
import { ClamAvScanner } from '@corridra/evidence/adapters';
import { createEvidenceStorage } from '@corridra/evidence/storage';
import { readFoundationConfig } from '@corridra/config';
import { CounterpartyService } from '@corridra/counterparties';
import { MissionService } from '@corridra/missions';
import { DeliveryService } from '@corridra/delivery';
import { DeliveryExperienceService } from '@corridra/delivery/experience';
import { ReplyReviewService } from '@corridra/delivery/reply-review';
import { OpportunityService } from '@corridra/opportunities';
import { MeetingService } from '@corridra/missions/meetings';
import { CommercialMissionService } from '@corridra/missions/commercial';
import { CorridorService } from '@corridra/missions/corridors';
import { OperationsService } from '@corridra/missions/operations';
import { CommunicationService } from '@corridra/communications';
import { SyntheticChannel } from '@corridra/communications/adapters';
import { OutboxDispatcher } from '@corridra/workflows';
function createServices() {
  const config = readFoundationConfig();
  if (!config) return null;
  const runtimePool = new Pool({
    connectionString: config.RUNTIME_DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 15000,
  });
  const authPool = new Pool({
    connectionString: config.AUTH_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  const identity = createIdentity({
    pool: authPool,
    secret: config.AUTH_SECRET,
    baseURL: config.APP_ORIGIN,
    basePath: '/api/operator-auth',
    sendPasswordRecovery: operatorRecoveryMailer(),
  });
  const configuredStorage = createEvidenceStorage();
  const storage = configuredStorage ?? {
    async put() {
      throw new Error('Evidence storage is not configured');
    },
    async get() {
      throw new Error('Evidence storage is not configured');
    },
  };
  let scanner: MalwareScanner = {
    async scan() {
      return { verdict: 'ERROR', engine: 'unconfigured' };
    },
  };
  if (process.env.CLAMAV_HOST)
    scanner = new ClamAvScanner(process.env.CLAMAV_HOST, Number(process.env.CLAMAV_PORT ?? 3310));
  let inferenceAdapter;
  let aiEnabled = process.env.CORRIDRA_AI_ENABLED === 'true';
  try {
    inferenceAdapter = localFixtureAdapter(
      config.DATABASE_REGION,
      process.env.VERCEL_ENV,
      process.env.CORRIDRA_AI_FIXTURE_URL,
    );
  } catch {
    aiEnabled = false;
  }
  const ready = Promise.all([
    assertRestrictedPool(runtimePool),
    assertRestrictedPool(authPool, 'corridra_auth'),
  ]);
  void ready.catch(() => {
    void Promise.allSettled([runtimePool.end(), authPool.end()]);
  });
  const readCustomerSession = async () => {
    const auth = neonAuth();
    if (!auth) throw new Error('Customer identity is unavailable');
    const { data, error } = await auth.getSession({ query: { disableCookieCache: true } });
    if (error) throw new Error('Customer identity is unavailable');
    if (!data?.user || !data.session) return null;
    return {
      subject: data.user.id,
      emailVerified: data.user.emailVerified,
      email: data.user.email,
      expiresAt: new Date(data.session.expiresAt),
    };
  };
  // Mission mail. The service is cheap and always built (mute links must keep working if the switch is
  // turned off later). The port that queues mail exists only while the switch is on, so with it off a
  // request is stored exactly as before. Delivery starts only after the request commits, and the
  // workflow is imported lazily to keep the workflow and this module from importing each other.
  const missionMail = new MissionMailService(runtimePool, config.AUTH_SECRET);
  const missionMailPort = missionMailApplicationEnabled()
    ? {
        enqueue: (
          db: Parameters<MissionMailService['enqueue']>[0],
          input: Parameters<MissionMailService['enqueue']>[1],
        ) => missionMail.enqueue(db, input),
        dispatch: async (job: Parameters<MissionMailService['send']>[0]) => {
          const { missionMailOrchestrator } = await import('./mission-mail-orchestrator');
          await missionMailOrchestrator.start(job);
        },
      }
    : undefined;
  return {
    config,
    ...identity,
    missionMail,
    viewAs: new ViewAsService(runtimePool),
    inbox: new InboxService(runtimePool),
    operatorSetup: new OperatorSetup(authPool),
    networkInvitations: new NetworkInvitations(
      authPool,
      process.env.CORRIDRA_NETWORK_ENABLED === 'true',
    ),
    access: new AccessService(runtimePool, authPool),
    customerWorkspaces: new CustomerWorkspaceService(
      runtimePool,
      authPool,
      {
        enabled: customerWorkspacesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    decisionDisclosures: new DecisionDisclosureService(runtimePool),
    specificationConfirmations: new SpecificationConfirmationService(runtimePool),
    customerSpecificationConfirmations: new CustomerSpecificationConfirmationService(
      runtimePool,
      authPool,
      {
        enabled: customerSpecificationConfirmationEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerDecisions: new CustomerDecisionService(
      runtimePool,
      authPool,
      {
        enabled: customerDecisionsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerDelivery: new CustomerDeliveryService(runtimePool),
    // CQ-77: reports published for the customer's own requests (WS-B service, WS-C lister).
    customerDeliveredReports: new CustomerDeliveredReportService(
      runtimePool,
      authPool,
      {
        enabled: customerDeliveryEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
      listDeliveredPublications,
    ),
    customerAssignedMissions: new CustomerAssignedMissionService(
      runtimePool,
      authPool,
      {
        enabled: customerDeliveryEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerCompanies: new CustomerCompanyService(
      runtimePool,
      authPool,
      {
        enabled: customerCompaniesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerMissionShares: new CustomerMissionShareService(
      runtimePool,
      authPool,
      {
        enabled: customerMissionSharesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerParticipants: new CustomerParticipantService(
      runtimePool,
      authPool,
      {
        enabled: customerParticipantsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammeTemplates: new CustomerProgrammeTemplateService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammeTemplatesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammeTerms: new CustomerProgrammeTermsService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammeTermsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammePricing: new CustomerProgrammePricingService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammePricingEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammeCoordination: new CustomerProgrammeCoordinationService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammeCoordinationEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammeEconomics: new CustomerProgrammeEconomicsService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammeEconomicsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerMissionDrafts: new CustomerMissionDraftService(
      runtimePool,
      authPool,
      {
        enabled: customerMissionDraftsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerMoves: new CustomerMoveService(
      runtimePool,
      authPool,
      {
        enabled: customerMovesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    moves: new MissionMoveService(runtimePool),
    customerNotifications: new CustomerNotificationService(
      runtimePool,
      authPool,
      {
        // The page and the route decide what the Pulse switch allows (only switching off when it is off).
        enabled: customerNotificationWithdrawalEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    // Pulse reads the verified address of the account that owns the request inside the database, at send
    // time, and only for a person who switched email on (ADR-067). It sends nothing unless the switch, real
    // use and the database control are all on. The service is always built: mute links must keep working
    // if the switch is turned off later.
    pulse: new PulseService(runtimePool, config.AUTH_SECRET, databaseRecipientSource(runtimePool)),
    customerMemberRoles: new CustomerMemberRoleService(
      runtimePool,
      authPool,
      {
        enabled: customerMemberRolesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerOrganisationLinks: new CustomerOrganisationLinkService(
      runtimePool,
      authPool,
      {
        enabled: customerOrganisationLinksEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    staffOrganisationLinks: new StaffOrganisationLinkService(runtimePool),
    customerServiceStaff: new CustomerServiceStaffService(runtimePool),
    customerBillingStaff: new CustomerBillingStaffService(runtimePool, () =>
      customerRealBillingEnabled(),
    ),
    customerInvoicingStaff: new CustomerInvoicingStaffService(runtimePool),
    customerRealInvoicingStaff: new CustomerRealInvoicingStaffService(runtimePool),
    customerSimulatedPaymentsStaff: new CustomerSimulatedPaymentsStaffService(runtimePool),
    customerSimulatedPayments: new CustomerSimulatedPaymentsService(
      runtimePool,
      authPool,
      {
        enabled: customerRealBillingEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerRealInvoicing: new CustomerRealInvoicingService(
      runtimePool,
      authPool,
      {
        enabled: customerRealBillingEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerInvoicing: new CustomerInvoicingService(
      runtimePool,
      authPool,
      {
        enabled: customerInvoicingEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerBilling: new CustomerBillingService(
      runtimePool,
      authPool,
      {
        enabled: customerBillingEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerServiceRequests: new CustomerServiceRequestService(
      runtimePool,
      authPool,
      {
        enabled: customerServiceRequestsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerOrganisationProfiles: new CustomerOrganisationProfileService(
      runtimePool,
      authPool,
      {
        enabled: customerOrganisationProfilesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammeContext: new CustomerProgrammeContextService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammeContextEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerProgrammes: new CustomerProgrammeService(
      runtimePool,
      authPool,
      {
        enabled: customerProgrammesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerRequests: new CustomerRequestService(
      runtimePool,
      authPool,
      {
        enabled: customerRequestsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
      missionMailPort,
    ),
    customerSavedMissions: new CustomerSavedMissionService(
      runtimePool,
      authPool,
      {
        enabled: customerSavedMissionsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerRequestDetails: new CustomerRequestDetailService(
      runtimePool,
      authPool,
      {
        enabled: customerRequestDetailsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        dataMode: realUseEnabled() ? 'real' : 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    intelligence: new IntelligenceService(runtimePool, aiEnabled, inferenceAdapter),
    network: new NetworkService(runtimePool, process.env.CORRIDRA_NETWORK_ENABLED === 'true'),
    counterparties: new CounterpartyService(runtimePool),
    missions: new MissionService(
      runtimePool,
      config.AUTH_SECRET,
      realUseEnabled() ? 'real' : 'synthetic',
    ),
    delivery: new DeliveryService(
      runtimePool,
      new MissionService(runtimePool, config.AUTH_SECRET, realUseEnabled() ? 'real' : 'synthetic'),
      config.AUTH_SECRET,
      () => realReportPublicLinkEnabled(),
    ),
    deliveryExperience: new DeliveryExperienceService(runtimePool),
    replyReview: new ReplyReviewService(runtimePool),
    meetings: new MeetingService(runtimePool),
    commercialMissions: new CommercialMissionService(runtimePool),
    corridors: new CorridorService(runtimePool),
    operations: new OperationsService(runtimePool),
    opportunities: new OpportunityService(runtimePool),
    communications: new CommunicationService(runtimePool, config.AUTH_SECRET),
    dispatcher: new OutboxDispatcher(runtimePool, new SyntheticChannel(runtimePool)),
    evidence: new EvidenceService(
      runtimePool,
      storage,
      scanner,
      config.EVIDENCE_SCAN_MODE === 'bypass',
    ),
    ready,
    scanMode: config.EVIDENCE_SCAN_MODE,
    uploadsConfigured:
      !!configuredStorage && (config.EVIDENCE_SCAN_MODE === 'bypass' || !!process.env.CLAMAV_HOST),
  };
}
export const foundations = recoverableResource(createServices);
