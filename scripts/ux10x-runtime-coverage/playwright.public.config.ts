import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const root = path.resolve(import.meta.dirname, '../..');
export default defineConfig({
  ...base,
  testDir: path.join(root, 'tests/browser'),
  webServer: {
    command: 'sh scripts/ux10x-runtime-coverage/serve-public.sh',
    cwd: root,
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
  },
});
