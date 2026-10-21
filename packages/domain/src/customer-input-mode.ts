// This public value selects validation/copy, never account, workspace or database authority.
const publicRealMode = (() => {
  try {
    // Next replaces this exact property at build time. Other browser consumers
    // have no process global and retain the legacy default.
    return process.env.NEXT_PUBLIC_CORRIDRA_REAL_USE_ENABLED === 'true';
  } catch {
    return false;
  }
})();
export function realCustomerInput() {
  return (
    publicRealMode ||
    (typeof process !== 'undefined' &&
      process.env.DATA_ENVIRONMENT === 'real' &&
      process.env.CORRIDRA_REAL_USE_ENABLED === 'true')
  );
}
export function customerLabelAllowed(value: string) {
  return realCustomerInput()
    ? value.length >= 2
    : value.length >= 11 && value.startsWith('Synthetic ');
}
export function customerWebsiteAllowed(value: string) {
  if (!realCustomerInput()) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.hostname.includes('.') &&
      !/[\u0000-\u0020\u007f]/u.test(value)
    );
  } catch {
    return false;
  }
}
export function customerProvenanceAllowed(value: unknown): value is boolean {
  return value === true || (value === false && realCustomerInput());
}
