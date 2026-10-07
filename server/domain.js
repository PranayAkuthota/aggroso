export const minutes = (value) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
export const priorities = { urgent: 0, high: 1, normal: 2, low: 3 };
export const same = (a, b) =>
  !!a &&
  !!b &&
  ["requestId", "technicianId", "start", "end"].every((k) => a[k] === b[k]);
export function seedState() {
  return {
    day: "2026-10-08",
    revision: 0,
    currentVersion: null,
    technicians: [
      {
        id: "t1",
        name: "Asha Rao",
        skills: ["electrical", "hvac"],
        region: "North",
        start: 540,
        end: 1020,
        maxMinutes: 360,
        active: true,
      },
      {
        id: "t2",
        name: "Ravi Kumar",
        skills: ["plumbing"],
        region: "North",
        start: 540,
        end: 1020,
        maxMinutes: 300,
        active: true,
      },
      {
        id: "t3",
        name: "Meera Shah",
        skills: ["electrical", "plumbing"],
        region: "South",
        start: 600,
        end: 1080,
        maxMinutes: 360,
        active: true,
      },
      {
        id: "t4",
        name: "Imran Ali",
        skills: ["hvac", "electrical"],
        region: "North",
        start: 600,
        end: 1080,
        maxMinutes: 300,
        active: true,
      },
    ],
    requests: [
      [
        "r1",
        "Clinic power fault",
        "North",
        "electrical",
        "urgent",
        90,
        540,
        720,
      ],
      ["r2", "Leaking kitchen pipe", "North", "plumbing", "high", 60, 600, 840],
      [
        "r3",
        "Office AC maintenance",
        "North",
        "hvac",
        "normal",
        120,
        720,
        1020,
      ],
      [
        "r4",
        "Apartment switchboard",
        "South",
        "electrical",
        "high",
        90,
        600,
        900,
      ],
      [
        "r5",
        "Water heater inspection",
        "South",
        "plumbing",
        "normal",
        60,
        780,
        1020,
      ],
      ["r6", "Warehouse AC outage", "North", "hvac", "high", 90, 600, 840],
      ["r7", "Lift inspection", "South", "lift", "high", 60, 600, 960],
      ["r8", "Shop service enquiry", "North", null, "normal", 60, 540, 1020],
    ].map(
      ([
        id,
        title,
        region,
        skill,
        priority,
        duration,
        windowStart,
        windowEnd,
      ]) => ({
        id,
        title,
        region,
        skill,
        priority,
        duration,
        windowStart,
        windowEnd,
        completed: false,
        status: "pending",
      }),
    ),
  };
}
export const requestStatus = (r) =>
  r.completed
    ? "completed"
    : r.status === "in_progress"
      ? "in_progress"
      : "pending";
export const isProtected = (r) =>
  ["completed", "in_progress"].includes(requestStatus(r));
export function lockedAssignments(state, current) {
  const completed = new Set(
    state.requests.filter(isProtected).map((r) => r.id),
  );
  return current
    .filter((a) => completed.has(a.requestId))
    .map((a) => ({ ...a }));
}
export function validateAssignments(state, assignments, current = []) {
  const errors = [],
    seen = new Set(),
    load = new Map();
  for (const a of assignments) {
    const r = state.requests.find((r) => r.id === a.requestId),
      t = state.technicians.find((t) => t.id === a.technicianId);
    if (!r || !t) {
      errors.push(
        `Unknown request or technician: ${a.requestId}/${a.technicianId}`,
      );
      continue;
    }
    if (seen.has(r.id)) errors.push(`${r.id}: request assigned more than once`);
    seen.add(r.id);
    if (
      !t.active &&
      !lockedAssignments(state, current).some((locked) => same(locked, a))
    )
      errors.push(`${r.id}: technician unavailable`);
    if (!r.skill || !t.skills.includes(r.skill))
      errors.push(`${r.id}: required skill does not match`);
    if (r.region !== t.region) errors.push(`${r.id}: region does not match`);
    if (
      !Number.isInteger(a.start) ||
      !Number.isInteger(a.end) ||
      a.end - a.start !== r.duration
    )
      errors.push(`${r.id}: duration must be ${r.duration} minutes`);
    if (!(
      Math.max(t.start, r.windowStart) <= a.start &&
      a.start < a.end &&
      a.end <= Math.min(t.end, r.windowEnd)
    ))
      errors.push(`${r.id}: outside availability or preferred window`);
    load.set(t.id, (load.get(t.id) || 0) + a.end - a.start);
  }
  for (const [tid, used] of load)
    if (used > state.technicians.find((t) => t.id === tid).maxMinutes)
      errors.push(`${tid}: maximum workload exceeded`);
  for (let i = 0; i < assignments.length; i++)
    for (const b of assignments.slice(i + 1)) {
      const a = assignments[i];
      if (
        a.technicianId === b.technicianId &&
        a.start < b.end &&
        b.start < a.end
      )
        errors.push(
          `${a.technicianId}: overlapping ${a.requestId} and ${b.requestId}`,
        );
    }
  for (const a of lockedAssignments(state, current))
    if (!assignments.some((b) => same(a, b)))
      errors.push(
        `${a.requestId}: ${requestStatus(state.requests.find((r) => r.id === a.requestId))} assignment is immutable`,
      );
  return [...new Set(errors)].sort();
}
export function explain(state, assignments) {
  const assigned = new Set(assignments.map((a) => a.requestId)),
    unassigned = [],
    risks = [],
    questions = [];
  for (const r of state.requests) {
    if (!assigned.has(r.id)) {
      const eligible = state.technicians.filter(
        (t) => t.active && t.region === r.region && t.skills.includes(r.skill),
      );
      const reason = !r.skill
        ? "Required skill is missing; dispatcher clarification needed."
        : !eligible.length
          ? "No active technician matches skill and region."
          : "No slot found by this heuristic within availability, preferred window, and workload limits.";
      unassigned.push({ requestId: r.id, reason });
      if (!r.skill)
        questions.push(`${r.title}: which service skill is required?`);
      if (priorities[r.priority] < 2)
        risks.push(`${r.title}: ${r.priority} request remains unassigned.`);
    } else {
      const a = assignments.find((a) => a.requestId === r.id);
      if (r.windowEnd - a.end < 30 && !r.completed)
        risks.push(
          `${r.title}: less than 30 minutes of window slack; delays may require replanning.`,
        );
    }
  }
  return { unassigned, risks, questions };
}
const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};
export function generateCandidates(state, current = []) {
  // A bounded greedy heuristic; no claim of global optimality or real travel modelling.
  return ["priority", "balanced", "continuity"].map((id) => {
    const assignments = lockedAssignments(state, current);
    const decisions = {};
    const requests = state.requests
      .filter((r) => !isProtected(r) && r.skill)
      .sort(
        (a, b) =>
          priorities[a.priority] - priorities[b.priority] ||
          a.windowEnd - b.windowEnd ||
          a.id.localeCompare(b.id),
      );
    for (const r of requests) {
      const slots = [],
        old = current.find((a) => a.requestId === r.id);
      for (const t of state.technicians) {
        if (!t.active || t.region !== r.region || !t.skills.includes(r.skill))
          continue;
        const starts = new Set([
          Math.max(t.start, r.windowStart),
          ...assignments
            .filter((a) => a.technicianId === t.id)
            .map((a) => a.end),
        ]);
        if (old?.technicianId === t.id) starts.add(old.start);
        for (const start of starts) {
          const assignment = {
            requestId: r.id,
            technicianId: t.id,
            start,
            end: start + r.duration,
          };
          if (
            validateAssignments(state, [...assignments, assignment], current)
              .length
          )
            continue;
          const load = assignments
            .filter((a) => a.technicianId === t.id)
            .reduce((s, a) => s + a.end - a.start, 0);
          const score =
            id === "balanced"
              ? [load / t.maxMinutes, start, t.id]
              : id === "continuity"
                ? [same(old, assignment) ? 0 : 1, start, t.id]
                : [start, t.id];
          slots.push({ score, assignment });
        }
      }
      slots.sort((a, b) => compare(a.score, b.score));
      const selected = slots[0]?.assignment || null;
      decisions[r.id] = explainDecision(
        state,
        r,
        old,
        selected,
        assignments,
        current,
        id,
      );
      if (selected) assignments.push(selected);
    }
    const changes = changesBetween(current, assignments, { state, decisions });
    return {
      id,
      assignments,
      summary: explain(state, assignments),
      decisions,
      changes,
    };
  });
}
// Causes describe observed checks/choices, never counterfactual LLM guesses.
function explainDecision(
  state,
  request,
  old,
  selected,
  placed,
  baseline,
  strategy,
) {
  const evidence = {
    strategy,
    previousAssignment: old || null,
    selectedAssignment: selected,
    constraints: [],
  };
  if (!old) {
    return {
      reason:
        request.priority === "urgent" && request.createdRevision
          ? "This added urgent request received a slot that passed all deterministic constraints."
          : "A slot was selected from the deterministic candidate set for this previously unassigned request.",
      cause: {
        type:
          request.priority === "urgent" && request.createdRevision
            ? "emergency_request"
            : "new_assignment",
        ...evidence,
      },
    };
  }
  const errors = validateAssignments(state, [...placed, old], baseline);
  evidence.constraints = errors;
  const technician = state.technicians.find((t) => t.id === old.technicianId);
  if (!technician?.active)
    return {
      reason: `Previous technician ${old.technicianId} is unavailable for unstarted work. ${selected ? "A valid replacement was selected." : "This heuristic found no valid replacement slot."}`,
      cause: {
        type: "technician_unavailable",
        technicianId: old.technicianId,
        ...evidence,
      },
    };
  const blockers = placed.filter(
    (a) =>
      a.technicianId === old.technicianId &&
      a.start < old.end &&
      old.start < a.end,
  );
  if (blockers.length) {
    const urgent = blockers.filter(
      (a) =>
        state.requests.find((r) => r.id === a.requestId)?.priority === "urgent",
    );
    const protectedWork = blockers.filter((a) =>
      isProtected(state.requests.find((r) => r.id === a.requestId)),
    );
    const higher = blockers.filter(
      (a) =>
        priorities[state.requests.find((r) => r.id === a.requestId).priority] <
        priorities[request.priority],
    );
    const type = urgent.length
      ? "emergency_slot_conflict"
      : protectedWork.length
        ? "protected_work_conflict"
        : higher.length
          ? "higher_priority_slot_conflict"
          : "slot_conflict";
    return {
      reason: `The previous slot overlaps ${urgent.length ? "urgent work" : protectedWork.length ? "protected work" : higher.length ? "higher-priority work" : "work placed earlier by this strategy"} (${blockers.map((a) => a.requestId).join(", ")}). ${selected ? "A different valid allocation was selected." : "No replacement slot was found by this heuristic."}`,
      cause: {
        type,
        relatedRequestIds: blockers.map((a) => a.requestId),
        blockingAssignments: blockers,
        ...evidence,
      },
    };
  }
  if (errors.some((e) => e.includes("maximum workload"))) {
    const usedMinutes = placed
      .filter((a) => a.technicianId === old.technicianId)
      .reduce((sum, a) => sum + a.end - a.start, 0);
    return {
      reason: `At this planning step, ${old.technicianId} had ${technician.maxMinutes - usedMinutes} workload minutes left; this job needs ${request.duration}. ${selected ? "Another valid allocation was selected." : "No replacement slot was found by this heuristic."}`,
      cause: {
        type: "workload_limit",
        technicianId: old.technicianId,
        usedMinutes,
        maxMinutes: technician.maxMinutes,
        requiredMinutes: request.duration,
        ...evidence,
      },
    };
  }
  if (errors.length)
    return {
      reason: `The previous allocation failed deterministic checks: ${errors.join("; ")}.`,
      cause: { type: "constraint_rejection", ...evidence },
    };
  return {
    reason: selected
      ? `The previous slot was feasible, but the ${strategy} strategy ranked another allocation first.`
      : "The heuristic did not find a replacement allocation; no global infeasibility claim is made.",
    cause: { type: "strategy_selection", ...evidence },
  };
}

export function changesBetween(before, after, context = {}) {
  const ids = [
    ...new Set([...before, ...after].map((a) => a.requestId)),
  ].sort();
  return ids.flatMap((requestId) => {
    const old = before.find((a) => a.requestId === requestId) || null;
    const next = after.find((a) => a.requestId === requestId) || null;
    if (same(old, next)) return [];
    const kind = !old ? "added" : !next ? "removed" : "moved";
    let explanation = context.decisions?.[requestId];
    if (context.manualReason)
      explanation = {
        reason: context.manualReason,
        cause: { type: "manual_override" },
      };
    if (!explanation && context.state) {
      const r = context.state.requests.find((r) => r.id === requestId);
      if (r)
        explanation = explainDecision(
          context.state,
          r,
          old,
          next,
          after.filter((a) => a.requestId !== requestId),
          before,
          context.strategy || "priority",
        );
    }
    explanation ||= {
      reason: `Assignment ${kind} in this schedule change.`,
      cause: { type: "recorded_assignment_change" },
    };
    return [
      {
        requestId,
        before: old,
        after: next,
        kind,
        changeType: kind,
        ...explanation,
      },
    ];
  });
}
