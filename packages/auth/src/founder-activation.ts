import { customerCompaniesEnabled } from './customer-companies';
import { customerDeliveryEnabled } from './customer-assigned-missions';
import { customerDecisionsEnabled } from './customer-decisions';
import { customerMemberRolesEnabled } from './customer-member-roles';
import { customerMissionDraftsEnabled } from './customer-mission-drafts';
import { customerMissionSharesEnabled } from './customer-mission-shares';
import { customerOrganisationLinksEnabled } from './customer-organisation-links';
import { customerOrganisationProfilesEnabled } from './customer-organisation-profiles';
import { customerParticipantsEnabled } from './customer-participants';
import { customerProgrammeContextEnabled } from './customer-programme-context';
import { customerProgrammeCoordinationEnabled } from './customer-programme-coordination';
import { customerProgrammeEconomicsEnabled } from './customer-programme-economics';
import { customerProgrammeTemplatesEnabled } from './customer-programme-templates';
import { customerProgrammeTermsEnabled } from './customer-programme-terms';
import { customerProgrammePricingEnabled } from './customer-programme-pricing';
import { customerProgrammesEnabled } from './customer-programmes';
import { customerRequestDetailsEnabled } from './customer-request-details';
import { customerRequestsEnabled } from './customer-requests';
import { customerSavedMissionsEnabled } from './customer-saved-missions';
import { customerServiceRequestsEnabled } from './customer-service-requests';
import { customerBillingEnabled, customerRealBillingEnabled } from './customer-billing';
import { customerInvoicingEnabled } from './customer-invoicing';
import { customerRealInvoicingEnabled } from './customer-invoicing-real';
import { customerSimulatedPaymentsEnabled } from './customer-payments-simulated';
import {
  customerOpenAdmission,
  customerProductionLocked,
  customerProductionUnlocked,
  customerDataEnvironmentAllowed,
  realUseEnabled,
} from './customer-production';
import { customerWorkspacesEnabled } from './customer-workspaces';

export type ActivationState =
  'ON' | 'OFF' | 'WAITING_PREREQUISITE' | 'LOCKED_PRODUCTION' | 'LOCKED_NOT_SYNTHETIC';
export type ModuleActivation = {
  key: string;
  label: string;
  flag: string;
  state: ActivationState;
};
export type FounderActivation = {
  environment: {
    deployment: 'production' | 'preview' | 'development' | 'unknown';
    data: 'synthetic' | 'real' | 'not-synthetic';
    productionUnlocked: boolean;
    openAdmission: boolean;
  };
  modules: ModuleActivation[];
  counts: { on: number; total: number };
  note: string;
};

// Customer modules in dependency order. Each flag name is the one its own enabled function reads.
const modules: {
  key: string;
  label: string;
  flag: string;
  enabled: (env: NodeJS.ProcessEnv) => boolean;
}[] = [
  {
    key: 'workspaces',
    label: 'Customer workspaces',
    flag: 'CORRIDRA_CUSTOMER_WORKSPACES_ENABLED',
    enabled: customerWorkspacesEnabled,
  },
  {
    key: 'requests',
    label: 'Private requests',
    flag: 'CORRIDRA_CUSTOMER_REQUESTS_ENABLED',
    enabled: customerRequestsEnabled,
  },
  {
    key: 'request-details',
    label: 'Request detail workspace',
    flag: 'CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED',
    enabled: customerRequestDetailsEnabled,
  },
  {
    key: 'saved-missions',
    label: 'Saved commercial reports',
    flag: 'CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED',
    enabled: customerSavedMissionsEnabled,
  },
  {
    key: 'decisions',
    label: 'Report decisions',
    flag: 'CORRIDRA_CUSTOMER_DECISIONS_ENABLED',
    enabled: customerDecisionsEnabled,
  },
  {
    key: 'companies',
    label: 'Company continuity',
    flag: 'CORRIDRA_CUSTOMER_COMPANIES_ENABLED',
    enabled: customerCompaniesEnabled,
  },
  {
    key: 'delivery',
    label: 'Assigned missions',
    flag: 'CORRIDRA_CUSTOMER_DELIVERY_ENABLED',
    enabled: customerDeliveryEnabled,
  },
  {
    key: 'member-roles',
    label: 'Team roles and leaving',
    flag: 'CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED',
    enabled: customerMemberRolesEnabled,
  },
  {
    key: 'organisation-profiles',
    label: 'Organisation profiles',
    flag: 'CORRIDRA_CUSTOMER_ORGANISATION_PROFILES_ENABLED',
    enabled: customerOrganisationProfilesEnabled,
  },
  {
    key: 'organisation-links',
    label: 'Company links',
    flag: 'CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED',
    enabled: customerOrganisationLinksEnabled,
  },
  {
    key: 'mission-drafts',
    label: 'Guided request drafts',
    flag: 'CORRIDRA_CUSTOMER_MISSION_DRAFTS_ENABLED',
    enabled: customerMissionDraftsEnabled,
  },
  {
    key: 'programmes',
    label: 'Delegation programmes',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED',
    enabled: customerProgrammesEnabled,
  },
  {
    key: 'participants',
    label: 'Participant invitations and registrations',
    flag: 'CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED',
    enabled: customerParticipantsEnabled,
  },
  {
    key: 'programme-context',
    label: 'Programme context',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMME_CONTEXT_ENABLED',
    enabled: customerProgrammeContextEnabled,
  },
  {
    key: 'mission-shares',
    label: 'Mission sharing with participants',
    flag: 'CORRIDRA_CUSTOMER_MISSION_SHARES_ENABLED',
    enabled: customerMissionSharesEnabled,
  },
  {
    key: 'programme-economics',
    label: 'Organiser programme economics',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED',
    enabled: customerProgrammeEconomicsEnabled,
  },
  {
    key: 'programme-coordination',
    label: 'Programme coordination and reporting',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMME_COORDINATION_ENABLED',
    enabled: customerProgrammeCoordinationEnabled,
  },
  {
    key: 'programme-templates',
    label: 'Repeatable programme templates',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMME_TEMPLATES_ENABLED',
    enabled: customerProgrammeTemplatesEnabled,
  },
  {
    key: 'programme-terms',
    label: 'Programme terms, eligibility and places',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMME_TERMS_ENABLED',
    enabled: customerProgrammeTermsEnabled,
  },
  {
    key: 'programme-pricing',
    label: 'Pricing, series and exports',
    flag: 'CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED',
    enabled: customerProgrammePricingEnabled,
  },
  {
    key: 'service-requests',
    label: 'Paid-service requests',
    flag: 'CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED',
    enabled: customerServiceRequestsEnabled,
  },
  {
    key: 'billing',
    label: 'Sample plans and subscriptions',
    flag: 'CORRIDRA_CUSTOMER_BILLING_ENABLED',
    enabled: customerBillingEnabled,
  },
  {
    key: 'real-billing',
    label: 'Real plans and subscriptions',
    flag: 'CORRIDRA_CUSTOMER_REAL_BILLING_ENABLED',
    enabled: customerRealBillingEnabled,
  },
  {
    key: 'invoicing',
    label: 'Sample invoices and payment records',
    flag: 'CORRIDRA_CUSTOMER_INVOICING_ENABLED',
    enabled: customerInvoicingEnabled,
  },
  {
    key: 'real-invoicing',
    label: 'Real invoices and payment records',
    flag: 'CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED',
    enabled: customerRealInvoicingEnabled,
  },
  {
    key: 'simulated-payments',
    label: 'Simulated payment flow (madeup)',
    flag: 'CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED',
    enabled: customerSimulatedPaymentsEnabled,
  },
];

function deployment(env: NodeJS.ProcessEnv): FounderActivation['environment']['deployment'] {
  const value = env.VERCEL_ENV;
  return value === 'production' || value === 'preview' || value === 'development'
    ? value
    : 'unknown';
}

// Reports which customer modules this running deployment would serve. It reads configuration only:
// whether a database module is installed is verified separately and is never inferred here.
export function founderActivation(env: NodeJS.ProcessEnv = process.env): FounderActivation {
  const locked = customerProductionLocked(env);
  const synthetic = env.DATA_ENVIRONMENT === 'synthetic';
  const rows = modules.map((m): ModuleActivation => {
    let state: ActivationState;
    if (m.enabled(env)) state = 'ON';
    else if (locked) state = 'LOCKED_PRODUCTION';
    else if (!customerDataEnvironmentAllowed(env)) state = 'LOCKED_NOT_SYNTHETIC';
    else if (env[m.flag] !== 'true') state = 'OFF';
    else state = 'WAITING_PREREQUISITE';
    return { key: m.key, label: m.label, flag: m.flag, state };
  });
  return {
    environment: {
      deployment: deployment(env),
      data: realUseEnabled(env) ? 'real' : synthetic ? 'synthetic' : 'not-synthetic',
      productionUnlocked: customerProductionUnlocked(env),
      openAdmission: customerOpenAdmission(env),
    },
    modules: rows,
    counts: { on: rows.filter((r) => r.state === 'ON').length, total: rows.length },
    note: realUseEnabled(env)
      ? 'Configuration only. Real customer access also requires the installed real-use authority. Database installation is checked separately. Outreach, payments and inference retain their separate controls.'
      : 'Configuration only. A module also needs its database installation, checked separately by the owner. No real customer data, outreach, payment or production inference is enabled by any of these.',
  };
}
