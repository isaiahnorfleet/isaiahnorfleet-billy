import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/billy_e2e";
export const E2E_CRON_SECRET = "e2e-cron-secret-e2e-cron-secret";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB,
      APP_URL: `http://localhost:${PORT}`,
      AUTH_MODE: "dev",
      DEV_AUTH_SECRET: "e2e-dev-secret-e2e-dev-secret-e2e-dev",
      NOTIFY_PROVIDER: "fake",
      CRON_SECRET: E2E_CRON_SECRET,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
      VAPID_PRIVATE_KEY: "fake-for-e2e",
      VAPID_SUBJECT: "mailto:test@example.test",
    },
  },
});
