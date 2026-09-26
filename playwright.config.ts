import { defineConfig, devices } from '@playwright/test'

// The oracle drives the BUILT bundle, not the dev server: what GitHub Pages
// serves is what is judged. tests/support/local-stack.ts brings up Supabase,
// builds against it and serves dist/, so there is no webServer here.
// 360 px is the narrowest viewport the brief admits.
export default defineConfig({
  testDir: 'tests/acceptance',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 360, height: 800 },
  },
})
