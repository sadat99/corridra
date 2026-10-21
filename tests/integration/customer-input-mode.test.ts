import { test, expect } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import {
  realUseEnabled,
  customerProductionUnlocked,
} from '../../packages/auth/src/customer-production';
import { founderActivation } from '../../packages/auth/src/founder-activation';

for (const real of [false, true])
  test(`shared inputs work in a browser without Node globals, real mode=${real}`, async () => {
    const bundle = await build({
      stdin: {
        contents: `export * from ${JSON.stringify(resolve('packages/domain/src/customer-input-mode.ts'))}`,
        resolveDir: resolve('.'),
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      globalName: 'inputs',
      define: real ? { 'process.env.NEXT_PUBLIC_CORRIDRA_REAL_USE_ENABLED': '"true"' } : undefined,
    });
    const sandbox: {
      inputs?: {
        customerLabelAllowed: (v: string) => boolean;
        customerProvenanceAllowed: (v: unknown) => boolean;
      };
    } = {};
    runInNewContext(bundle.outputFiles[0].text, sandbox);
    expect(sandbox.inputs!.customerLabelAllowed('Synthetic example')).toBe(true);
    expect(sandbox.inputs!.customerLabelAllowed('Company name')).toBe(real);
    expect(sandbox.inputs!.customerProvenanceAllowed(false)).toBe(real);
    expect(sandbox.inputs!.customerProvenanceAllowed(true)).toBe(true);
  });
test('public presentation settings cannot enable server admission or production authority', () => {
  const env = {
    VERCEL_ENV: 'production',
    DATA_ENVIRONMENT: 'real',
    NEXT_PUBLIC_CORRIDRA_REAL_USE_ENABLED: 'true',
  };
  expect(realUseEnabled(env)).toBe(false);
  expect(customerProductionUnlocked(env)).toBe(false);
});
test('activation reports approved real data and distinguishes enabled modules from unset flags', () => {
  const env: NodeJS.ProcessEnv = {
    VERCEL_ENV: 'production',
    DATA_ENVIRONMENT: 'real',
    CORRIDRA_REAL_USE_ENABLED: 'true',
    CORRIDRA_CUSTOMER_PRODUCTION_UNLOCK: 'real-use-owner-approved',
    CORRIDRA_CUSTOMER_OPEN_ADMISSION: 'real-use-owner-approved',
    CORRIDRA_DELIVERY_ENABLED: 'true',
  };
  for (const feature of founderActivation(env).modules) env[feature.flag] = 'true';
  const enabled = founderActivation(env);
  expect(enabled.environment).toMatchObject({
    data: 'real',
    productionUnlocked: true,
    openAdmission: true,
  });
  expect(enabled.modules.every((module) => module.state === 'ON')).toBe(true);
  env.CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED = 'false';
  expect(
    founderActivation(env).modules.find(
      (module) => module.flag === 'CORRIDRA_CUSTOMER_PROGRAMME_PRICING_ENABLED',
    )?.state,
  ).toBe('OFF');
});
