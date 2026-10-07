import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  generateCandidates,
  validateAssignments,
  explain,
  changesBetween,
  isProtected,
} from "./domain.js";
import { createProvider } from "./providers.js";
import * as store from "./store.js";
const fail = (status, message, details) =>
  Object.assign(new Error(message), { status, details });
const reasonSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
const assignmentSchema = z
  .object({
    requestId: z.string().min(1).max(50),
    technicianId: z.string().min(1).max(50),
    start: z.number().int().min(540).max(1080),
    end: z.number().int().min(540).max(1080),
  })
  .strict();
const approveSchema = reasonSchema.extend({
  draftRevision: z.number().int().nonnegative(),
});
const editSchema = approveSchema.extend({
  assignments: z.array(assignmentSchema).max(20),
});
const requestSchema = z
  .object({
    title: z.string().trim().min(3).max(100),
    region: z.enum(["North", "South"]),
    skill: z.enum(["electrical", "plumbing", "hvac", "lift"]).nullable(),
    priority: z.enum(["urgent", "high", "normal", "low"]),
    duration: z.number().int().min(15).max(480),
    windowStart: z.number().int().min(540).max(1080),
    windowEnd: z.number().int().min(540).max(1080),
  })
  .strict()
  .refine((r) => r.windowEnd - r.windowStart >= r.duration, {
    message: "Preferred window must fit the estimated duration.",
    path: ["windowEnd"],
  });
function check(state, assignments, current) {
  const errors = validateAssignments(state, assignments, current);
  if (errors.length) throw fail(422, "Assignment constraints failed.", errors);
}
async function draft(db, id, s, draftRevision) {
  const v = await store.version(db, id);
  if (!v) throw fail(404, "Plan not found.");
  if (v.status !== "draft")
    throw fail(409, "Only a draft can be changed or approved.");
  if (v.baseRevision !== s.revision)
    throw fail(
      409,
      "Inputs or confirmed schedule changed. Generate a fresh proposal.",
    );
  if (v.draftRevision !== draftRevision)
    throw fail(
      409,
      "This draft changed in another tab. Refresh before continuing.",
    );
  return v;
}
export function createApp({
  db = store.prisma,
  provider = createProvider(),
  accessToken = process.env.APP_ACCESS_TOKEN,
  frontendOrigin = process.env.FRONTEND_ORIGIN,
} = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: frontendOrigin
        ? frontendOrigin.split(",").map((x) => x.trim())
        : ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["GET", "POST", "PUT"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      provider: provider.constructor.name,
      accessProtected: !!accessToken,
    });
  });
  app.use("/api", (req, _res, next) => {
    if (accessToken) {
      const expected = Buffer.from("Bearer " + accessToken),
        actual = Buffer.from(req.headers.authorization || "");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return next(fail(401, "Enter the reviewer access token."));
    }
    next();
  });
  app.use(
    "/api/proposals",
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Planning limit reached. Try again in a minute." },
    }),
  );
  app.get("/api/state", async (_req, res) => {
    // Consistent read while other dispatchers modify the workspace.
    const data = await store.transaction(
      async (tx) => ({
        ...(await store.readState(tx)),
        versions: (
          await tx.scheduleVersion.findMany({ orderBy: { createdAt: "desc" } })
        ).map(store.fromRecord),
        audit: (
          await tx.auditEvent.findMany({ orderBy: { createdAt: "desc" } })
        ).map(store.fromRecord),
        notifications: (
          await tx.notification.findMany({ orderBy: { createdAt: "desc" } })
        ).map(store.fromRecord),
        provider: provider.constructor.name,
      }),
      db,
    );
    res.json(data);
  });
  app.post("/api/proposals", async (req, res) => {
    const { reason } = reasonSchema.parse(req.body);
    const snapshot = await store.transaction(async (tx) => {
      const state = await store.readState(tx);
      return { state, before: await store.currentAssignments(tx, state) };
    }, db);
    const { state, before } = snapshot,
      candidates = generateCandidates(state, before);
    let agent;
    try {
      agent = await provider.select({
        candidates,
        state,
        currentAssignments: before,
        intent: reason,
      });
    } catch {
      // Provider failure must not masquerade as a successful AI result.
      console.warn(
        JSON.stringify({
          event: "agent_failed",
          provider: provider.constructor.name,
        }),
      );
      await store.transaction(
        (tx) =>
          store.audit(tx, "agent_failed", {
            reason,
            provider: provider.constructor.name,
            agentStatus: "failed",
            inputRevision: state.revision,
          }),
        db,
      );
      throw fail(
        502,
        "AI advisor failed or returned invalid output. Check provider settings and retry. No proposal was confirmed.",
      );
    }
    const chosen = candidates.find((c) => c.id === agent.candidateId);
    if (!chosen)
      throw fail(
        502,
        "AI selected an unknown plan. No assignments were changed.",
      );
    check(state, chosen.assignments, before);
    const v = await store.transaction(async (tx) => {
      const latest = await store.readState(tx);
      if (latest.revision !== state.revision)
        throw fail(
          409,
          "Inputs changed while planning. Retry with the latest state.",
        );
      const result = store.fromRecord(
        await tx.scheduleVersion.create({
          data: {
            payload: {
              status: "draft",
              createdAt: new Date().toISOString(),
              baseRevision: state.revision,
              baseVersion: state.currentVersion,
              draftRevision: 0,
              assignments: chosen.assignments,
              strategy: chosen.id,
              agent,
              summary: chosen.summary,
              changes: chosen.changes,
              reason,
              approvedAt: null,
            },
          },
        }),
      );
      await store.audit(tx, "proposal_generated", {
        versionId: result.id,
        reason,
        agentStatus: agent.status,
        provider: agent.provider,
        model: agent.model,
        latencyMs: agent.latencyMs ?? null,
        candidateId: agent.candidateId,
        candidateCount: candidates.length,
      });
      return result;
    }, db);
    res.status(201).json(v);
  });
  app.put("/api/proposals/:id", async (req, res) => {
    const body = editSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx),
        v = await draft(tx, req.params.id, s, body.draftRevision),
        current = await store.currentAssignments(tx, s);
      check(s, body.assignments, current);
      const previous = v.assignments;
      v.assignments = body.assignments;
      v.summary = explain(s, body.assignments);
      const editedIds = new Set(
        changesBetween(previous, body.assignments).map((c) => c.requestId),
      );
      const priorChanges = v.changes;
      v.changes = changesBetween(current, body.assignments, {
        state: s,
        manualReason: body.reason,
      }).map((c) =>
        editedIds.has(c.requestId)
          ? c
          : priorChanges.find((old) => old.requestId === c.requestId) || c,
      );
      v.draftRevision += 1;
      v.manualOverride = true;
      v.manualReason = body.reason;
      await store.saveVersion(tx, v);
      await store.audit(tx, "manual_override", {
        versionId: v.id,
        reason: body.reason,
        changes: changesBetween(previous, body.assignments, {
          manualReason: body.reason,
        }),
      });
      return v;
    }, db);
    res.json(result);
  });
  app.post("/api/proposals/:id/approve", async (req, res) => {
    const body = approveSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx),
        v = await draft(tx, req.params.id, s, body.draftRevision),
        previous = await store.currentAssignments(tx, s);
      check(s, v.assignments, previous);
      v.status = "approved";
      v.approvedAt = new Date().toISOString();
      v.approvalReason = body.reason;
      await store.saveVersion(tx, v);
      s.currentVersion = v.id;
      s.revision += 1;
      await store.saveState(tx, s);
      await store.audit(tx, "plan_approved", {
        versionId: v.id,
        reason: body.reason,
        revision: s.revision,
      });
      for (const change of v.changes)
        await tx.notification.create({
          data: {
            payload: {
              at: new Date().toISOString(),
              versionId: v.id,
              channel: "mock",
              ...change,
              message: `${change.requestId}: confirmed schedule ${change.kind}.`,
              deliveryStatus: "mocked",
            },
          },
        });
      return v;
    }, db);
    res.json(result);
  });
  app.post("/api/technicians/:id/cancel", async (req, res) => {
    const { reason } = reasonSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx),
        t = s.technicians.find((t) => t.id === req.params.id);
      if (!t) throw fail(404, "Technician not found.");
      if (!t.active) throw fail(409, "Technician already cancelled.");
      const current = await store.currentAssignments(tx, s);
      const protectedRequestIds = current
        .filter(
          (a) =>
            a.technicianId === t.id &&
            isProtected(s.requests.find((r) => r.id === a.requestId)),
        )
        .map((a) => a.requestId);
      const affectedRequestIds = current
        .filter(
          (a) =>
            a.technicianId === t.id &&
            !protectedRequestIds.includes(a.requestId),
        )
        .map((a) => a.requestId);
      t.active = false;
      s.revision += 1;
      await store.saveState(tx, s);
      await store.audit(tx, "technician_cancelled", {
        technicianId: t.id,
        policy: "finish_started_work_cancel_future",
        protectedRequestIds,
        affectedRequestIds,
        reason,
        revision: s.revision,
      });
      return {
        status: "cancelled",
        requiresReplan: true,
        protectedRequestIds,
        affectedRequestIds,
      };
    }, db);
    res.json(result);
  });
  app.post("/api/requests", async (req, res) => {
    const body = requestSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx);
      if (s.requests.length >= 20)
        throw fail(
          422,
          "This bounded demo supports up to 20 service requests.",
        );
      const r = {
        id:
          "r" + (Math.max(...s.requests.map((r) => Number(r.id.slice(1)))) + 1),
        ...body,
        completed: false,
        status: "pending",
        createdRevision: s.revision + 1,
      };
      s.requests.push(r);
      s.revision += 1;
      await store.saveState(tx, s);
      await store.audit(tx, "request_added", {
        requestId: r.id,
        priority: r.priority,
        revision: s.revision,
      });
      return r;
    }, db);
    res.status(201).json(result);
  });
  app.post("/api/requests/:id/clarify", async (req, res) => {
    const body = requestSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx),
        r = s.requests.find((r) => r.id === req.params.id);
      if (!r) throw fail(404, "Request not found.");
      if (r.skill !== null || isProtected(r))
        throw fail(409, "Only requests with missing skills can be clarified.");
      if (!body.skill) throw fail(422, "Choose the required skill.");
      Object.assign(r, body);
      s.revision += 1;
      await store.saveState(tx, s);
      await store.audit(tx, "request_clarified", {
        requestId: r.id,
        revision: s.revision,
      });
      return r;
    }, db);
    res.json(result);
  });
  app.post("/api/requests/:id/start", async (req, res) => {
    const { reason } = reasonSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx);
      const r = s.requests.find((r) => r.id === req.params.id);
      if (!r) throw fail(404, "Request not found.");
      if (isProtected(r)) throw fail(409, "Work already started or completed.");
      const a = (await store.currentAssignments(tx, s)).find(
        (a) => a.requestId === r.id,
      );
      if (!a) throw fail(409, "Only confirmed assignments can be started.");
      if (!s.technicians.find((t) => t.id === a.technicianId)?.active)
        throw fail(
          409,
          "Cancelled technician cannot start pending work. Replan first.",
        );
      r.status = "in_progress";
      r.startedAt = new Date().toISOString();
      s.revision += 1;
      await store.saveState(tx, s);
      await store.audit(tx, "request_started", {
        requestId: r.id,
        assignment: a,
        reason,
        revision: s.revision,
      });
      return r;
    }, db);
    res.json(result);
  });
  app.post("/api/requests/:id/complete", async (req, res) => {
    const { reason } = reasonSchema.parse(req.body);
    const result = await store.transaction(async (tx) => {
      const s = await store.readState(tx),
        r = s.requests.find((r) => r.id === req.params.id);
      if (!r) throw fail(404, "Request not found.");
      if (r.completed) throw fail(409, "Request already completed.");
      const a = (await store.currentAssignments(tx, s)).find(
        (a) => a.requestId === r.id,
      );
      if (!a) throw fail(409, "Only confirmed assignments can be completed.");
      if (
        !s.technicians.find((t) => t.id === a.technicianId).active &&
        r.status !== "in_progress"
      )
        throw fail(
          409,
          "Cancelled technician cannot complete pending work. Replan first.",
        );
      r.completed = true;
      r.status = "completed";
      r.completedAt = new Date().toISOString();
      s.revision += 1;
      await store.saveState(tx, s);
      await store.audit(tx, "request_completed", {
        requestId: r.id,
        reason,
        assignment: a,
        revision: s.revision,
      });
      return r;
    }, db);
    res.json(result);
  });
  app.use("/api", (_req, _res, next) =>
    next(fail(404, "API endpoint not found.")),
  );
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(422).json({
        error: "Check the form fields.",
        details: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON body." });
    const status = error.status || 500;
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          status,
          code: error.code || "internal_error",
        }),
      );
    res.status(status).json({
      error:
        status === 500
          ? "Server operation failed. Check server logs and retry."
          : error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });
  return app;
}
