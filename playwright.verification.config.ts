import { defineConfig, devices } from '@playwright/test';

// Commercial readiness verification suite (program section 8). Three widths; the server seeds its own
// local database with the program flags on. Run: pnpm test:verification [tests/e2e/verification/ws-x]
export default defineConfig({
  testDir: './tests/e2e/verification',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/verification-output',
  use: {
    baseURL: 'http://127.0.0.1:3300',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    {
      name: 'w1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    { name: 'w768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    {
      name: 'w390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/qa/verification-server.ts',
    url: 'http://127.0.0.1:3300',
    reuseExistingServer: false,
    timeout: 90000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
  },
});
