import { defineConfig, devices } from '@playwright/test'

const port = process.env.PORT ?? '4173'

// Browser suites: every spec runs in Chromium, Firefox and WebKit, plus mobile
// emulation in Chromium and WebKit. The fixture server serves the built dist/datacub.js, the real artefact.
export default defineConfig({
  testDir: 'test/browser',
  // *.pw.ts, so the Bun test runner (which also matches *.spec.ts) leaves these alone
  testMatch: '**/*.pw.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'test-results/browser.json' }]]
    : 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'bun scripts/build.ts && bun test/server.ts',
    url: `http://localhost:${port}/datacub.js`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] } },
  ],
})
