import { defineConfig } from "@playwright/test";
import { BACKEND_PORT, WEB_PORT } from "./e2e/ports";

// CI serves the production build; locally the Vite dev server.
const web = process.env.CI
  ? `bunx vite build && bunx vite preview --port ${WEB_PORT}`
  : `bunx vite --port ${WEB_PORT}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "journeys.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: web,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: false,
    env: {
      PORT: String(WEB_PORT),
      VITE_CONVEX_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      VITE_CONVEX_SITE_URL: `http://127.0.0.1:${BACKEND_PORT + 1}`,
    },
  },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chrome",
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
    trace: "retain-on-failure",
  },
});
