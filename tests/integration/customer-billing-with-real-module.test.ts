// ADR-062: the whole sample billing suite, run again with the real-billing module installed and its control closed.
// Sample workspaces, sample staff and the sample invoicing module must behave exactly as they do without it.
process.env.BILLING_WITH_REAL_MODULE = '1';
await import('./customer-billing.test');
export {};
