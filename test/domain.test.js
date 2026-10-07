import { describe, it, expect } from "vitest";
import {
  seedState,
  generateCandidates,
  validateAssignments,
  changesBetween,
} from "../server/domain.js";
const assignment = {
  requestId: "r1",
  technicianId: "t1",
  start: 540,
  end: 630,
};
describe("deterministic hard constraints", () => {
  it("accepts a valid assignment and back-to-back work", () => {
    const state = seedState();
    expect(validateAssignments(state, [assignment])).toEqual([]);
    expect(
      validateAssignments(state, [
        assignment,
        { requestId: "r6", technicianId: "t1", start: 630, end: 720 },
      ]),
    ).toEqual([]);
  });
  it.each([
    [
      "unknown technician",
      { ...assignment, technicianId: "invented" },
      "Unknown",
    ],
    ["wrong skill", { ...assignment, technicianId: "t2" }, "skill"],
    [
      "wrong region",
      { ...assignment, technicianId: "t3", start: 600, end: 690 },
      "region",
    ],
    ["wrong duration", { ...assignment, end: 631 }, "duration"],
    ["outside window", { ...assignment, start: 700, end: 790 }, "window"],
  ])("rejects %s", (_label, value, message) =>
    expect(validateAssignments(seedState(), [value]).join()).toContain(message),
  );
  it("rejects unavailable technicians", () => {
    const s = seedState();
    s.technicians[0].active = false;
    expect(validateAssignments(s, [assignment]).join()).toContain(
      "unavailable",
    );
  });
  it("rejects duplicate requests even across technicians", () => {
    expect(
      validateAssignments(seedState(), [
        assignment,
        { ...assignment, technicianId: "t4", start: 600, end: 690 },
      ]).join(),
    ).toContain("more than once");
  });
  it("rejects double-booking", () => {
    expect(
      validateAssignments(seedState(), [
        assignment,
        { requestId: "r6", technicianId: "t1", start: 600, end: 690 },
      ]).join(),
    ).toContain("overlapping");
  });
  it("rejects maximum workload overflow", () => {
    const s = seedState();
    s.technicians[0].maxMinutes = 80;
    expect(validateAssignments(s, [assignment]).join()).toContain("workload");
  });
  it("locks completed work even when that technician later cancels", () => {
    const s = seedState();
    s.requests[0].completed = true;
    s.technicians[0].active = false;
    expect(validateAssignments(s, [assignment], [assignment])).toEqual([]);
    expect(validateAssignments(s, [], [assignment]).join()).toContain(
      "immutable",
    );
  });
});
describe("candidate planning", () => {
  it("produces deterministic, constraint-safe plans and explicit unassigned reasons", () => {
    const s = seedState(),
      plans = generateCandidates(s);
    expect(plans).toEqual(generateCandidates(s));
    for (const p of plans) {
      expect(validateAssignments(s, p.assignments)).toEqual([]);
      expect(p.assignments).toHaveLength(6);
      expect(p.summary.unassigned).toHaveLength(2);
      expect(p.summary.questions).toHaveLength(1);
      expect(p.summary.risks.join()).toContain("Lift inspection");
    }
  });
  it("preserves completed assignments without duplication during cancellation replan", () => {
    const s = seedState(),
      initial = generateCandidates(s)[0].assignments;
    s.requests[0].completed = true;
    s.technicians[0].active = false;
    for (const p of generateCandidates(s, initial)) {
      expect(p.assignments.filter((a) => a.requestId === "r1")).toEqual([
        initial.find((a) => a.requestId === "r1"),
      ]);
      expect(validateAssignments(s, p.assignments, initial)).toEqual([]);
    }
  });
  it("uses exact manual boundaries rather than rounding into an overlap", () => {
    const s = seedState();
    s.requests[0].completed = true;
    const old = [{ ...assignment, start: 547, end: 637 }];
    const plans = generateCandidates(s, old);
    for (const p of plans)
      expect(validateAssignments(s, p.assignments, old)).toEqual([]);
  });
  it("reports added, moved, and removed changes", () => {
    const before = [assignment, { ...assignment, requestId: "r2" }];
    const after = [
      { ...assignment, start: 550, end: 640 },
      { ...assignment, requestId: "r3" },
    ];
    expect(changesBetween(before, after).map((c) => c.kind)).toEqual([
      "moved",
      "removed",
      "added",
    ]);
    expect(changesBetween(before, before)).toEqual([]);
  });
});

describe("protected work and evidence-based replanning", () => {
  it("preserves started work through cancellation and emergency without duplicates", () => {
    const s = seedState(),
      baseline = generateCandidates(s)[0].assignments;
    s.requests[0].status = "in_progress";
    s.technicians[0].active = false;
    s.requests.push({
      ...s.requests[0],
      id: "r9",
      status: "pending",
      completed: false,
      createdRevision: 1,
      windowStart: 660,
      windowEnd: 960,
      duration: 60,
    });
    for (const candidate of generateCandidates(s, baseline)) {
      expect(candidate.assignments.find((a) => a.requestId === "r1")).toEqual(
        baseline.find((a) => a.requestId === "r1"),
      );
      expect(validateAssignments(s, candidate.assignments, baseline)).toEqual(
        [],
      );
      expect(candidate.changes.some((c) => c.requestId === "r1")).toBe(false);
      expect(new Set(candidate.assignments.map((a) => a.requestId)).size).toBe(
        candidate.assignments.length,
      );
    }
    expect(
      validateAssignments(
        s,
        baseline.filter((a) => a.requestId !== "r1"),
        baseline,
      ).join(),
    ).toContain("in_progress assignment is immutable");
    const moved = baseline.map((a) =>
      a.requestId === "r1"
        ? { ...a, start: 600, end: 690, technicianId: "t4" }
        : a,
    );
    expect(validateAssignments(s, moved, baseline).join()).toContain(
      "immutable",
    );
  });
  it("records unavailable causes for both moved and removed work", () => {
    const s = seedState(),
      baseline = generateCandidates(s)[0].assignments;
    s.technicians[0].active = false;
    s.technicians[1].active = false;
    const changes = generateCandidates(s, baseline)[0].changes;
    expect(changes.find((c) => c.requestId === "r1")).toMatchObject({
      kind: "moved",
      changeType: "moved",
      cause: { type: "technician_unavailable", technicianId: "t1" },
    });
    expect(changes.find((c) => c.requestId === "r2")).toMatchObject({
      kind: "removed",
      before: baseline.find((a) => a.requestId === "r2"),
      after: null,
      cause: { type: "technician_unavailable" },
    });
  });
  it("ties emergency displacement to the actual blocking assignment", () => {
    const s = seedState();
    s.requests = [
      {
        ...s.requests[0],
        id: "existing",
        priority: "normal",
        duration: 60,
        windowEnd: 900,
      },
      {
        ...s.requests[0],
        id: "emergency",
        createdRevision: 1,
        duration: 60,
        windowEnd: 900,
      },
    ];
    s.technicians = [s.technicians[0]];
    const old = [
      { requestId: "existing", technicianId: "t1", start: 540, end: 600 },
    ];
    const c = generateCandidates(s, old)[0];
    expect(c.changes.find((c) => c.requestId === "emergency")).toMatchObject({
      kind: "added",
      cause: { type: "emergency_request" },
    });
    expect(c.changes.find((c) => c.requestId === "existing")).toMatchObject({
      kind: "moved",
      cause: {
        type: "emergency_slot_conflict",
        relatedRequestIds: ["emergency"],
      },
    });
    expect(
      c.changes.find((c) => c.requestId === "existing").cause
        .blockingAssignments,
    ).toEqual([c.assignments.find((a) => a.requestId === "emergency")]);
  });
  it("distinguishes capacity rejection from an overlapping slot", () => {
    const s = seedState();
    s.technicians = [{ ...s.technicians[0], maxMinutes: 90 }];
    s.requests = [
      {
        ...s.requests[0],
        id: "existing",
        priority: "normal",
        duration: 60,
        windowStart: 660,
        windowEnd: 900,
      },
      {
        ...s.requests[0],
        id: "emergency",
        createdRevision: 1,
        duration: 60,
        windowEnd: 660,
      },
    ];
    const c = generateCandidates(s, [
      { requestId: "existing", technicianId: "t1", start: 660, end: 720 },
    ])[0];
    expect(c.changes.find((c) => c.requestId === "existing")).toMatchObject({
      kind: "removed",
      cause: {
        type: "workload_limit",
        usedMinutes: 60,
        maxMinutes: 90,
        requiredMinutes: 60,
      },
    });
  });
  it("reports a feasible strategy choice honestly and keeps manual reasons distinct", () => {
    const s = seedState();
    s.requests = [s.requests[0]];
    const old = [{ ...assignment, start: 600, end: 690 }];
    const c = generateCandidates(s, old)[0].changes[0];
    expect(c.cause.type).toBe("strategy_selection");
    expect(c.reason).toContain("previous slot was feasible");
    expect(
      changesBetween(old, [], {
        manualReason: "Dispatcher removed this allocation.",
      })[0],
    ).toMatchObject({
      reason: "Dispatcher removed this allocation.",
      cause: { type: "manual_override" },
    });
  });
});
it("rejects a technician availability violation even inside the request window", () => {
  expect(
    validateAssignments(seedState(), [
      { ...assignment, technicianId: "t4", start: 570, end: 660 },
    ]).join(),
  ).toContain("outside availability");
});
