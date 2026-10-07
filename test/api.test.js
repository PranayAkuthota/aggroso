import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../server/app.js";
import { MockProvider } from "../server/providers.js";
import { initialize, readState } from "../server/store.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test.",
  );
const db = new PrismaClient({ datasources: { db: { url } } });
let app;
const api = () => request(app);
const propose = async () => {
  const r = await api()
    .post("/api/proposals")
    .send({ reason: "Plan today’s service requests." });
  expect(r.status).toBe(201);
  return r.body;
};
const approve = (v) =>
  api().post(`/api/proposals/${v.id}/approve`).send({
    reason: "Reviewed constraints and remaining unassigned work.",
    draftRevision: v.draftRevision,
  });
const emergency = {
  title: "Emergency office power loss",
  region: "North",
  skill: "electrical",
  priority: "urgent",
  duration: 60,
  windowStart: 660,
  windowEnd: 960,
};
beforeAll(async () => {
  await db.$connect();
});
beforeEach(async () => {
  await db.$transaction([
    db.notification.deleteMany(),
    db.auditEvent.deleteMany(),
    db.scheduleVersion.deleteMany(),
    db.workspace.deleteMany(),
  ]);
  await initialize(db);
  app = createApp({ db, provider: new MockProvider(), accessToken: null });
});
afterAll(async () => {
  await db.$disconnect();
});
describe("persistent dispatch API with real PostgreSQL", () => {
  it("reports DB-backed readiness and seeds a bounded workspace", async () => {
    expect((await api().get("/api/health")).body.status).toBe("ok");
    const s = (await api().get("/api/state")).body;
    expect(s.requests).toHaveLength(8);
    expect(s.versions).toEqual([]);
  });
  it("proposal is advisory until approved; notification outbox commits with approval", async () => {
    const v = await propose();
    const s = (await api().get("/api/state")).body;
    expect(s.currentVersion).toBeNull();
    expect(s.notifications).toEqual([]);
    expect(s.audit[0].kind).toBe("proposal_generated");
    expect((await approve(v)).status).toBe(200);
    const confirmed = (await api().get("/api/state")).body;
    expect(confirmed.currentVersion).toBe(v.id);
    expect(confirmed.notifications).toHaveLength(v.assignments.length);
    expect(
      confirmed.notifications.every((n) => n.deliveryStatus === "mocked"),
    ).toBe(true);
    expect((await approve(v)).status).toBe(409);
  });
  it("rejects unauthorized reads and writes but keeps readiness public", async () => {
    app = createApp({
      db,
      provider: new MockProvider(),
      accessToken: "test-only-reviewer-token",
    });
    expect((await api().get("/api/state")).status).toBe(401);
    expect(
      (await api().post("/api/proposals").send({ reason: "Plan today" }))
        .status,
    ).toBe(401);
    expect(
      (
        await api()
          .get("/api/state")
          .set("Authorization", "Bearer test-only-reviewer-token")
      ).status,
    ).toBe(200);
    expect((await api().get("/api/health")).status).toBe(200);
  });
  it("rejects unsafe manual edits and preserves the previous draft", async () => {
    const v = await propose();
    const edited = [...v.assignments];
    edited[0] = { ...edited[0], technicianId: "t2" };
    const result = await api().put(`/api/proposals/${v.id}`).send({
      assignments: edited,
      reason: "Attempt mismatched skill",
      draftRevision: 0,
    });
    expect(result.status).toBe(422);
    expect(result.body.details.join()).toContain("skill");
    expect(
      (await db.scheduleVersion.findUnique({ where: { id: v.id } })).payload
        .assignments,
    ).toEqual(v.assignments);
  });
  it("records manual overrides and rejects stale draft edits and approval", async () => {
    const v = await propose();
    const response = await api()
      .put(`/api/proposals/${v.id}`)
      .send({
        assignments: v.assignments.filter((a) => a.requestId !== "r3"),
        reason: "Customer requested postponement.",
        draftRevision: 0,
      });
    expect(response.status).toBe(200);
    expect(response.body.draftRevision).toBe(1);
    expect((await approve(v)).status).toBe(409);
    expect((await approve(response.body)).status).toBe(200);
    expect(
      (await api().get("/api/state")).body.audit.some(
        (a) => a.kind === "manual_override" && a.changes[0].kind === "removed",
      ),
    ).toBe(true);
  });
  it("rejects a proposal made stale by an emergency request", async () => {
    const v = await propose();
    expect((await api().post("/api/requests").send(emergency)).status).toBe(
      201,
    );
    expect((await approve(v)).status).toBe(409);
  });
  it("handles completion, cancellation, and emergency replan without duplicating completed work", async () => {
    const v = await propose();
    await approve(v);
    const original = v.assignments.find((a) => a.requestId === "r1");
    expect(
      (
        await api()
          .post("/api/requests/r1/complete")
          .send({ reason: "Technician reported completion." })
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(`/api/technicians/${original.technicianId}/cancel`)
          .send({ reason: "Technician left due to illness." })
      ).status,
    ).toBe(200);
    expect((await api().post("/api/requests").send(emergency)).status).toBe(
      201,
    );
    const revised = await propose();
    expect(revised.assignments.filter((a) => a.requestId === "r1")).toEqual([
      original,
    ]);
    expect(
      revised.assignments.filter(
        (a) => a.technicianId === original.technicianId && a.requestId !== "r1",
      ),
    ).toEqual([]);
    expect((await approve(revised)).status).toBe(200);
    const s = (await api().get("/api/state")).body;
    expect(s.versions).toHaveLength(2);
    expect(s.versions.find((x) => x.id === v.id).assignments).toEqual(
      v.assignments,
    );
    expect(s.requests.find((r) => r.id === "r1").completed).toBe(true);
  });
  it("cannot remove completed assignments with a manual override", async () => {
    const v = await propose();
    await approve(v);
    await api()
      .post("/api/requests/r1/complete")
      .send({ reason: "Finished at customer site." });
    const next = await propose();
    const response = await api()
      .put(`/api/proposals/${next.id}`)
      .send({
        assignments: next.assignments.filter((a) => a.requestId !== "r1"),
        draftRevision: 0,
        reason: "Attempt to remove completed work.",
      });
    expect(response.status).toBe(422);
    expect(response.body.details.join()).toContain("immutable");
  });
  it("cannot complete unconfirmed, duplicate, or cancelled work", async () => {
    expect(
      (
        await api()
          .post("/api/requests/r1/complete")
          .send({ reason: "Completed" })
      ).status,
    ).toBe(409);
    const v = await propose();
    await approve(v);
    await api().post("/api/requests/r1/complete").send({ reason: "Completed" });
    expect(
      (
        await api()
          .post("/api/requests/r1/complete")
          .send({ reason: "Completed" })
      ).status,
    ).toBe(409);
    await api()
      .post("/api/technicians/t2/cancel")
      .send({ reason: "Unavailable today." });
    expect(
      (
        await api()
          .post("/api/requests/r2/complete")
          .send({ reason: "Completed" })
      ).status,
    ).toBe(409);
  });
  it("accepts missing skill as a question and supports later clarification", async () => {
    const added = await api()
      .post("/api/requests")
      .send({ ...emergency, skill: null });
    expect(added.status).toBe(201);
    const v = await propose();
    expect(v.summary.questions.join()).toContain("Emergency office");
    const fixed = await api()
      .post(`/api/requests/${added.body.id}/clarify`)
      .send(emergency);
    expect(fixed.status).toBe(200);
    expect((await approve(v)).status).toBe(409);
    const next = await propose();
    expect(next.summary.questions.join()).not.toContain("Emergency office");
  });
  it.each([
    { ...emergency, duration: "60" },
    { ...emergency, windowEnd: 670 },
    { ...emergency, extra: "unexpected" },
    { ...emergency, region: "Unknown" },
  ])("rejects malformed request input", async (body) => {
    expect((await api().post("/api/requests").send(body)).status).toBe(422);
  });
  it("serializes simultaneous approvals so only one version becomes current", async () => {
    const a = await propose(),
      b = await propose();
    const results = await Promise.all([approve(a), approve(b)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const s = (await api().get("/api/state")).body;
    expect(s.versions.filter((v) => v.status === "approved")).toHaveLength(1);
    expect(s.notifications).toHaveLength(6);
  });
  it("detects input changes that happen while the provider is thinking", async () => {
    let release, started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const mock = new MockProvider();
    app = createApp({
      db,
      accessToken: null,
      provider: {
        select: async (input) => {
          started();
          await gate;
          return mock.select(input);
        },
      },
    });
    const planning = api()
      .post("/api/proposals")
      .send({ reason: "Plan today." })
      .then((r) => r);
    await ready;
    await api().post("/api/requests").send(emergency);
    release();
    expect((await planning).status).toBe(409);
    expect(await db.scheduleVersion.count()).toBe(0);
  });
  it("surfaces provider errors and invented plans without confirming anything", async () => {
    for (const select of [
      vi
        .fn()
        .mockRejectedValue(new Error("provider secret should never appear")),
      vi.fn().mockResolvedValue({ candidateId: "invented" }),
    ]) {
      app = createApp({ db, accessToken: null, provider: { select } });
      const response = await api()
        .post("/api/proposals")
        .send({ reason: "Plan the day." });
      expect(response.status).toBe(502);
      expect(JSON.stringify(response.body)).not.toContain("provider secret");
    }
    expect((await readState(db)).currentVersion).toBeNull();
    expect(await db.scheduleVersion.count()).toBe(0);
  });
  it("persists state across a fresh Express app instance", async () => {
    const v = await propose();
    await approve(v);
    app = createApp({ db, provider: new MockProvider(), accessToken: null });
    const s = (await api().get("/api/state")).body;
    expect(s.currentVersion).toBe(v.id);
    expect(s.versions[0].approvalReason).toContain("Reviewed");
  });
});

it("requires confirmation before start and rejects repeat starts", async () => {
  expect(
    (
      await api()
        .post("/api/requests/r1/start")
        .send({ reason: "Start confirmed work." })
    ).status,
  ).toBe(409);
  await approve(await propose());
  const started = await api()
    .post("/api/requests/r1/start")
    .send({ reason: "Technician started service." });
  expect(started.status).toBe(200);
  expect(started.body.status).toBe("in_progress");
  expect(started.body.startedAt).toBeTruthy();
  expect(
    (
      await api()
        .post("/api/requests/r1/start")
        .send({ reason: "Repeat start." })
    ).status,
  ).toBe(409);
  expect(
    (await api().get("/api/state")).body.audit.some(
      (e) => e.kind === "request_started",
    ),
  ).toBe(true);
});
it("locks started work across cancellation, emergency, manual edits and approval", async () => {
  const first = await propose();
  await approve(first);
  const locked = first.assignments.find((a) => a.requestId === "r1");
  await api()
    .post("/api/requests/r1/start")
    .send({ reason: "Service has started." });
  const cancellation = await api()
    .post(`/api/technicians/${locked.technicianId}/cancel`)
    .send({ reason: "Unavailable for future jobs." });
  expect(cancellation.body.protectedRequestIds).toContain("r1");
  expect(cancellation.body.affectedRequestIds).not.toContain("r1");
  await api().post("/api/requests").send(emergency);
  const next = await propose();
  expect(next.assignments.find((a) => a.requestId === "r1")).toEqual(locked);
  expect(next.changes.some((c) => c.requestId === "r1")).toBe(false);
  const edit = (assignments) =>
    api().put(`/api/proposals/${next.id}`).send({
      assignments,
      draftRevision: next.draftRevision,
      reason: "Test protected assignment editing.",
    });
  expect(
    (await edit(next.assignments.filter((a) => a.requestId !== "r1"))).status,
  ).toBe(422);
  expect(
    (
      await edit(
        next.assignments.map((a) =>
          a.requestId === "r1"
            ? { ...a, start: a.start + 15, end: a.end + 15 }
            : a,
        ),
      )
    ).status,
  ).toBe(422);
  expect((await approve(next)).status).toBe(200);
  const state = (await api().get("/api/state")).body;
  expect(state.versions.find((v) => v.id === first.id).assignments).toEqual(
    first.assignments,
  );
  expect(
    state.notifications
      .filter((n) => n.versionId === next.id)
      .some((n) => n.requestId === "r1"),
  ).toBe(false);
  expect(
    (
      await api()
        .post("/api/requests/r1/complete")
        .send({ reason: "Started service finished safely." })
    ).body.status,
  ).toBe("completed");
});
it("revalidates provider-selected assignments before persistence", async () => {
  app = createApp({
    db,
    accessToken: null,
    provider: {
      async select({ candidates }) {
        candidates[0].assignments[0].technicianId = "invented";
        return { candidateId: "priority" };
      },
    },
  });
  const response = await api()
    .post("/api/proposals")
    .send({ reason: "Check deterministic boundary." });
  expect(response.status).toBe(422);
  expect(await db.scheduleVersion.count()).toBe(0);
});
it("passes approved baseline and deterministic diffs to the advisor", async () => {
  const baseline = await propose();
  await approve(baseline);
  let input;
  const mock = new MockProvider();
  app = createApp({
    db,
    accessToken: null,
    provider: {
      async select(value) {
        input = value;
        return mock.select(value);
      },
    },
  });
  await propose();
  expect(input.currentAssignments).toEqual(baseline.assignments);
  expect(input.candidates.every((c) => Array.isArray(c.changes))).toBe(true);
});
it("retains unrelated deterministic reasons when manually changing a draft", async () => {
  const first = await propose();
  await approve(first);
  await api()
    .post("/api/technicians/t1/cancel")
    .send({ reason: "Unavailable for future service." });
  const next = await propose();
  const original = next.changes.find((c) => c.requestId === "r1");
  const edited = await api()
    .put(`/api/proposals/${next.id}`)
    .send({
      assignments: next.assignments.filter((a) => a.requestId !== "r2"),
      draftRevision: next.draftRevision,
      reason: "Customer requested removal of plumbing job.",
    });
  expect(edited.status).toBe(200);
  expect(edited.body.changes.find((c) => c.requestId === "r1")).toEqual(
    original,
  );
  expect(edited.body.changes.find((c) => c.requestId === "r2")).toMatchObject({
    kind: "removed",
    cause: { type: "manual_override" },
    reason: "Customer requested removal of plumbing job.",
  });
});
it("does not start unstarted work assigned to a cancelled technician", async () => {
  const v = await propose();
  await approve(v);
  await api()
    .post("/api/technicians/t2/cancel")
    .send({ reason: "Technician unavailable." });
  expect(
    (
      await api()
        .post("/api/requests/r2/start")
        .send({ reason: "Start pending service." })
    ).status,
  ).toBe(409);
});

it("Gemini proposals pass the shared validation and remain drafts until human approval", async () => {
  const { GeminiProvider } = await import("../server/providers.js");
  const provider = new GeminiProvider({
    apiKey: "unit-test-placeholder",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    candidateId: "priority",
                    explanation: "Prioritize urgent work.",
                    tradeoffs: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    }),
  });
  app = createApp({ db, provider, accessToken: null });
  const draft = await propose();
  expect(draft.agent.provider).toBe("gemini");
  expect((await readState(db)).currentVersion).toBeNull();
  expect(await db.notification.count()).toBe(0);
  expect((await approve(draft)).status).toBe(200);
  expect((await readState(db)).currentVersion).toBe(draft.id);
});

it("deletes unassigned requests atomically, logs their details and never reuses IDs", async () => {
  const added = await api().post("/api/requests").send(emergency);
  const id = added.body.id;
  const removed = await api()
    .delete(`/api/requests/${id}`)
    .send({ reason: "Created by mistake." });
  expect(removed.status).toBe(200);
  const state = await readState(db);
  expect(state.requests.some((r) => r.id === id)).toBe(false);
  const events = await db.auditEvent.findMany();
  expect(
    events.some(
      (e) =>
        e.payload.kind === "request_deleted" &&
        e.payload.request.title === emergency.title,
    ),
  ).toBe(true);
  const again = await api().post("/api/requests").send(emergency);
  expect(again.body.id).not.toBe(id);
  expect(
    (
      await api()
        .delete(`/api/requests/${id}`)
        .send({ reason: "Already removed." })
    ).status,
  ).toBe(404);
});
it("protects draft assignments and history and invalidates stale proposals on deletion", async () => {
  const v = await propose();
  const assignedId = v.assignments[0].requestId;
  expect(
    (
      await api()
        .delete(`/api/requests/${assignedId}`)
        .send({ reason: "Delete request." })
    ).status,
  ).toBe(409);
  expect(
    (
      await api()
        .delete("/api/requests/r8")
        .send({ reason: "Created by mistake." })
    ).status,
  ).toBe(200);
  expect((await approve(v)).status).toBe(409);
  expect(
    (await db.scheduleVersion.findUnique({ where: { id: v.id } })).payload
      .assignments,
  ).toEqual(v.assignments);
});
it("rejects deleting started and completed requests even when no version is available", async () => {
  const state = await readState(db);
  state.requests[0].status = "in_progress";
  state.requests[1].completed = true;
  await db.workspace.update({
    where: { id: "demo" },
    data: { payload: state },
  });
  for (const id of ["r1", "r2"])
    expect(
      (
        await api()
          .delete(`/api/requests/${id}`)
          .send({ reason: "Delete request." })
      ).status,
    ).toBe(409);
});
