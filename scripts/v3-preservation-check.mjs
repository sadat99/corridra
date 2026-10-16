import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const baseline = JSON.parse(readFileSync('docs/v3/phase-0/inventory.json', 'utf8'));
for (const route of baseline.routes)
  assert.ok(existsSync(route.file), `Lost route: ${route.route}`);
for (const entry of [...baseline.migrations, ...baseline.immutableSources]) {
  assert.equal(
    createHash('sha256').update(readFileSync(entry.file)).digest('hex'),
    entry.sha256,
    `Changed immutable history: ${entry.file}`,
  );
}
const navigation = readFileSync('apps/web/lib/workspace-navigation.ts', 'utf8');
for (const id of [
  'workspace-missions',
  'workspace-research',
  'workspace-meetings',
  'workspace-commercial',
  'workspace-delivery',
  'workspace-sources',
  'workspace-evidence',
  'workspace-ai',
  'workspace-network',
  'workspace-operations',
  'ops-dashboard',
  'ops-center',
  'ops-health',
  'ops-gates',
  'workspace-settings',
  'workspace-audit',
  'workspace-authenticator',
  'workspace-controls',
]) {
  assert.ok(navigation.includes(`id: '${id}'`), `Lost expert destination: ${id}`);
}
console.log(
  `PASS: ${baseline.routes.length} baseline route files retained; ${baseline.migrations.length} migration hashes and ${baseline.immutableSources.length} source hashes unchanged; 18 expert destination IDs retained. Runtime preservation remains separately verified.`,
);
