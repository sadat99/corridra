// Customer modules are synthetic-only. A production deployment runs them only after the owner sets
// this exact value, and only while data is synthetic. Unset, misspelt or any other value stays locked.
// This does not admit anyone: workspace admission, module installation and each module flag remain
// separate, and real customer data, outreach, payments and inference stay behind their own gates.
export const customerProductionUnlockValue = 'synthetic-only';

export function customerProductionUnlocked(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.VERCEL_ENV === 'production' &&
    env.DATA_ENVIRONMENT === 'synthetic' &&
    env.CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK === customerProductionUnlockValue
  );
}

// True when the deployment is production and the owner has not opted in.
export function customerProductionLocked(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === 'production' && !customerProductionUnlocked(env);
}

// Owner opt-in: admit any email-verified account automatically instead of by offline allowlist.
// It never applies while a production deployment is locked, and needs synthetic data.
export const customerOpenAdmissionValue = 'synthetic-only';
export function customerOpenAdmission(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.CORRIDRA_CUSTOMER_OPEN_ADMISSION === customerOpenAdmissionValue &&
    env.DATA_ENVIRONMENT === 'synthetic' &&
    !customerProductionLocked(env)
  );
}

// The issuer label the customer modules pin. An explicit owner setting wins, so the exact string the
// database pins is known; otherwise the provider address from the existing identity settings.
export function customerIssuerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_CUSTOMER_ISSUER || env.NEON_AUTH_BASE_URL || '';
}
