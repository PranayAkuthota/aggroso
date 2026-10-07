import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
const browser = await chromium.launch(
  existsSync("/usr/bin/chromium")
    ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] }
    : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page
    .getByRole("button", { name: "Generate plan", exact: true })
    .waitFor();
  const before = await fetch("http://127.0.0.1:8000/api/state").then((r) =>
    r.json(),
  );
  await page
    .getByRole("button", { name: "Generate plan", exact: true })
    .click();
  await page.getByText("Draft · not confirmed").waitFor();
  const after = await fetch("http://127.0.0.1:8000/api/state").then((r) =>
    r.json(),
  );
  if (
    after.currentVersion !== before.currentVersion ||
    after.notifications.length !== before.notifications.length
  )
    throw new Error(
      "Proposal improperly confirmed schedule or sent notifications.",
    );
  if (!after.versions[0].assignments.length)
    throw new Error("Expected nonempty schedule proposal.");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/aggroso-live-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/aggroso-live-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile page overflows horizontally.");
  if (errors.length) throw new Error(errors.join("; "));
  console.log(
    JSON.stringify({
      status: "passed",
      workflow:
        "Real Chromium → Vite proxy → Express → Prisma → PostgreSQL → MockProvider → draft",
      assignments: after.versions[0].assignments.length,
      confirmed: false,
      browserErrors: errors.length,
    }),
  );
} finally {
  await browser.close();
}
