import { defineConfig, devices } from "@playwright/test";

const managedServer = process.env.PLAYWRIGHT_MANAGED_SERVER === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:1430",
    trace: "retain-on-failure",
  },
  webServer: managedServer
    ? undefined
    : {
        command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1430 --strictPort",
        env: {
          ...process.env,
          VITE_E2E: "1",
        },
        url: "http://127.0.0.1:1430",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
