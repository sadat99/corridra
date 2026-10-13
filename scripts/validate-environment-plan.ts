import { readFile } from 'node:fs/promises';
import { validateEnvironmentPlan } from '../packages/config/src/environments';
const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3)
  throw new Error('Supply one reviewed environment metadata plan; never include credentials');
const bytes = await readFile(path);
if (bytes.length > 8192) throw new Error('Environment plan is too large');
const result = validateEnvironmentPlan(JSON.parse(bytes.toString('utf8')));
console.log(
  JSON.stringify({
    separationValid: result.separationValid,
    realDataActivation: result.realDataActivation,
    missingApprovalReferences: result.missingApprovalReferences,
    blockedReason: result.blockedReason,
  }),
);
