import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./browser-test",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: existsSync("/usr/bin/chromium")
      ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] }
      : {},
  },
  webServer: {
    command: "npm --prefix frontend run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
