// Audit-only: installs every optional LOCAL module into corridra_browser (same list as scripts/qa/local-install.ts),
// pins the customer issuer to the stand-in, and opens the sample-safe controls. Real use / real billing stay closed, so the
// simulated payments control (it needs the real-use configuration) stays closed too.
import { readFileSync } from 'node:fs';
import { Pool } from '../../packages/db/src/index';
import {
  installLocalModules,
  openLocalControls,
  pinLocalCustomerIssuer,
} from '../../scripts/qa/local-install';
import { configureSupplySources } from '../../packages/auth/src/supply-source-configuration';
import { configureCounterpartyChanges } from '../../packages/auth/src/counterparty-change-configuration';
import { migrateSourcingWorkflow } from '../../packages/db/src/sourcing-workflow-migrate';
import { configureSourcingWorkflow } from '../../packages/auth/src/sourcing-workflow-configuration';

const local = JSON.parse(readFileSync('.cache/part03-local.json', 'utf8'));
const customers = JSON.parse(readFileSync('.cache/audit/customers.json', 'utf8'));
const db = new Pool({
  host: '127.0.0.1',
  port: 54329,
  user: 'postgres',
  password: local.ownerPassword,
  database: 'corridra_browser',
});
const out: Record<string, string> = {};
const step = async (name: string, run: () => Promise<unknown>) => {
  try {
    await run();
    out[name] = 'ok';
  } catch (error) {
    out[name] = `FAILED: ${(error as Error).message.slice(0, 200)}`;
  }
};
const reason = 'Local audit preview opens this control in a throwaway database';
await step('modules', () => installLocalModules(db));
await step('controls', () => openLocalControls(db));
await step('issuer', () => pinLocalCustomerIssuer(db, customers.base));
await step('supply', () => configureSupplySources(db, { enabled: true, reason }));
await step('counterpartyChanges', () =>
  configureCounterpartyChanges(db, { enabled: true, reason }),
);
await step('sourcingInstall', () => migrateSourcingWorkflow(db));
await step('sourcing', () => configureSourcingWorkflow(db, { enabled: true, reason }));
await db.end();
console.log(JSON.stringify(out));
