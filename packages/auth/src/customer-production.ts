// Production customer modules require an explicit owner opt-in. Legacy synthetic
// activation remains valid; real use additionally requires its distinct mode,
// approval value, installed authority and each module's own feature flag.
export const customerProductionUnlockValue = 'synthetic-only';
export const customerRealUseApprovalValue = 'real-use-owner-approved';

export function customerProductionUnlocked(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.VERCEL_ENV === 'production' &&
    ((env.DATA_ENVIRONMENT === 'synthetic' &&
      env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK === customerProductionUnlockValue) ||
      (env.DATA_ENVIRONMENT === 'real' &&
        env.CORRIDRA_REAL_USE_ENABLED === 'true' &&
        env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK === customerRealUseApprovalValue))
  );
}

// True when the deployment is production and the owner has not opted in.
export function customerProductionLocked(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === 'production' && !customerProductionUnlocked(env);
}

// Owner opt-in: admit any email-verified account automatically instead of by offline allowlist.
// It never applies while production is locked. Real admission has its own exact approval value.
export const customerOpenAdmissionValue = 'synthetic-only';
export function customerOpenAdmission(env: NodeJS.ProcessEnv = process.env) {
  return (
    ((env.CORRIDRA_CUSTOMER_OPEN_ADMISSION === customerOpenAdmissionValue &&
      env.DATA_ENVIRONMENT === 'synthetic') ||
      (realUseEnabled(env) &&
        env.CORRIDRA_CUSTOMER_OPEN_ADMISSION === customerRealUseApprovalValue)) &&
    !customerProductionLocked(env)
  );
}

export function realUseEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.DATA_ENVIRONMENT === 'real' &&
    env.CORRIDRA_REAL_USE_ENABLED === 'true' &&
    !customerProductionLocked(env)
  );
}

export function customerDataEnvironmentAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.DATA_ENVIRONMENT === 'synthetic' || realUseEnabled(env);
}

// The issuer label the customer modules pin. An explicit owner setting wins, so the exact string the
// database pins is known; otherwise the provider address from the existing identity settings.
export function customerIssuerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_CUSTOMER_ISSUER || env.NEON_AUTH_BASE_URL || '';
}
