import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.operator.config';

const root = path.resolve(import.meta.dirname, '../..');
export default defineConfig({
  ...base,
  testDir: path.join(root, 'tests/operator'),
  webServer: {
    command: 'sh scripts/ux10x-runtime-coverage/serve-operator.sh',
    cwd: root,
    url: 'http://127.0.0.1:3200',
    reuseExistingServer: false,
    timeout: 60000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
  },
});
