import { test, expect } from "@playwright/test";
import {
  seedState,
  generateCandidates,
  changesBetween,
} from "../server/domain.js";
import { MockProvider } from "../server/providers.js";
// These UI tests stub HTTP to isolate the browser. Real DB/HTTP tests live in test/api.test.js.
async function setup(page) {
  let state = {
    ...seedState(),
    versions: [],
    audit: [],
    notifications: [],
    provider: "MockProvider",
  };
  const candidate = generateCandidates(state)[0];
  const agent = await new MockProvider().select({
    candidates: [candidate],
    state,
  });
  const v = {
    id: "ui-draft",
    status: "draft",
    createdAt: new Date().toISOString(),
    baseRevision: 0,
    draftRevision: 0,
    assignments: candidate.assignments,
    summary: candidate.summary,
    strategy: candidate.id,
    agent,
    changes: candidate.changes,
    reason: "Plan today’s service requests.",
  };
  let approvals = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/state") return route.fulfill({ json: state });
    if (path === "/api/proposals") {
      state.versions = [v];
      return route.fulfill({ status: 201, json: v });
    }
    if (path.endsWith("/approve")) {
      approvals++;
      state.currentVersion = v.id;
      state.revision++;
      v.status = "approved";
      v.approvedAt = new Date().toISOString();
      return route.fulfill({ json: v });
    }
    if (path.endsWith("/start")) {
      const r = state.requests.find((r) => r.id === path.split("/")[3]);
      r.status = "in_progress";
      state.revision++;
      return route.fulfill({ json: r });
    }
    if (path === "/api/requests")
      return route.fulfill({
        status: 422,
        json: {
          error: "Check the form fields.",
          details: ["Preferred window must fit the estimated duration."],
        },
      });
    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });
  await page.goto("/");
  return { approvals: () => approvals };
}
test("empty workspace explains the next step and labels mock mode", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByText("A good day starts with a plan.")).toBeVisible();
  await expect(page.getByText("Mock advisor", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate first plan" }),
  ).toBeVisible();
});
test("proposal renders jobs and requires explicit confirmation before approval", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("button", { name: "Generate first plan" }).click();
  await expect(page.getByText("Draft · not confirmed")).toBeVisible();
  await expect(
    page.getByText("Lift inspection: high request remains unassigned."),
  ).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/aggroso-dispatch-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review & approve plan" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirm this schedule?" }),
  ).toBeVisible();
  expect(state.approvals()).toBe(0);
  await page.getByRole("button", { name: "Approve & confirm" }).click();
  await expect(page.getByText("Approved version")).toBeVisible();
  expect(state.approvals()).toBe(1);
});
test("request validation failure stays visible without closing the form", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add request" }).click();
  await page.getByLabel("Request title").fill("New electrical job");
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Preferred window must fit",
  );
});
test("mobile navigation and approval flow remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "Generate first plan" }).click();
  await expect(page.getByText("Draft · not confirmed")).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/aggroso-dispatch-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review & approve plan" }).click();
  await expect(
    page.getByRole("button", { name: "Approve & confirm" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("handles unavailable backend and retries", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/state", (route) => {
    reads++;
    return reads === 1
      ? route.fulfill({ status: 503, json: { error: "Database unavailable." } })
      : route.fulfill({
          json: {
            ...seedState(),
            versions: [],
            audit: [],
            notifications: [],
            provider: "MockProvider",
          },
        });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Database unavailable");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page.getByText("A good day starts with a plan.")).toBeVisible();
});

test("started work is visible, cannot be edited and has an explicit start transition", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Generate first plan" }).click();
  await page.locator("details.changes summary").click();
  await expect(
    page
      .getByText(
        "A slot was selected from the deterministic candidate set for this previously unassigned request.",
      )
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review & approve plan" }).click();
  await page.getByRole("button", { name: "Approve & confirm" }).click();
  await page
    .getByRole("button", { name: "Start Clinic power fault", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Start service?" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save change" })
    .click();
  await expect(page.getByText("· In progress · Locked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Clinic power fault", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Review Clinic power fault", exact: true })
    .click();
  await expect(
    page.getByText("Started and completed work is locked."),
  ).toBeVisible();
});
test("replanning displays each change's deterministic reason", async ({
  page,
}) => {
  const state = {
    ...seedState(),
    versions: [],
    audit: [],
    notifications: [],
    provider: "MockProvider",
  };
  const baseline = generateCandidates(state)[0];
  state.currentVersion = "baseline";
  state.technicians[0].active = false;
  state.technicians[1].active = false;
  state.revision = 1;
  const revised = generateCandidates(state, baseline.assignments)[2];
  const agent = await new MockProvider().select({
    candidates: [revised],
    state,
  });
  state.versions = [
    {
      id: "revised",
      status: "draft",
      createdAt: new Date().toISOString(),
      baseRevision: 1,
      draftRevision: 0,
      ...revised,
      agent,
      reason: "Generic reason should not replace individual explanations.",
    },
    {
      id: "baseline",
      status: "approved",
      assignments: baseline.assignments,
      summary: baseline.summary,
      changes: baseline.changes,
      agent,
      createdAt: new Date().toISOString(),
      strategy: "priority",
    },
  ];
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  await page.goto("/");
  await page.locator("details.changes summary").click();
  const moved = revised.changes.find((c) => c.requestId === "r1");
  const removed = revised.changes.find((c) => c.requestId === "r2");
  expect(moved.reason).not.toBe(removed.reason);
  await expect(
    page
      .locator("details.changes > div")
      .filter({ has: page.getByText("Clinic power fault", { exact: true }) })
      .getByText(moved.reason, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(removed.reason, { exact: true })).toBeVisible();
});
