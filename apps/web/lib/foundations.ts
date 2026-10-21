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
      expiresAt: new Date(data.session.expiresAt),
    };
  };
  return {
    config,
    ...identity,
    operatorSetup: new OperatorSetup(authPool),
    access: new AccessService(runtimePool, authPool),
    customerWorkspaces: new CustomerWorkspaceService(
      runtimePool,
      authPool,
      {
        enabled: customerWorkspacesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    decisionDisclosures: new DecisionDisclosureService(runtimePool),
    customerDecisions: new CustomerDecisionService(
      runtimePool,
      authPool,
      {
        enabled: customerDecisionsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerDelivery: new CustomerDeliveryService(runtimePool),
    customerAssignedMissions: new CustomerAssignedMissionService(
      runtimePool,
      authPool,
      {
        enabled: customerDeliveryEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
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
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerMemberRoles: new CustomerMemberRoleService(
      runtimePool,
      authPool,
      {
        enabled: customerMemberRolesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
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
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    staffOrganisationLinks: new StaffOrganisationLinkService(runtimePool),
    customerOrganisationProfiles: new CustomerOrganisationProfileService(
      runtimePool,
      authPool,
      {
        enabled: customerOrganisationProfilesEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
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
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    customerSavedMissions: new CustomerSavedMissionService(
      runtimePool,
      authPool,
      {
        enabled: customerSavedMissionsEnabled(),
        synthetic: config.DATA_ENVIRONMENT === 'synthetic',
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
        production: customerProductionLocked(),
        openAdmission: customerOpenAdmission(),
        issuer: customerIssuerFromEnv(),
      },
      readCustomerSession,
    ),
    intelligence: new IntelligenceService(runtimePool, aiEnabled, inferenceAdapter),
    network: new NetworkService(runtimePool, process.env.CORRIDRA_NETWORK_ENABLED === 'true'),
    counterparties: new CounterpartyService(runtimePool),
    missions: new MissionService(runtimePool, config.AUTH_SECRET),
    delivery: new DeliveryService(
      runtimePool,
      new MissionService(runtimePool, config.AUTH_SECRET),
      config.AUTH_SECRET,
    ),
    deliveryExperience: new DeliveryExperienceService(runtimePool),
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
