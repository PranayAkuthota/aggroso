const protectedWork = (r) => r.completed || r.status === "in_progress";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  History,
  Bell,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Sparkles,
  ShieldCheck,
  Check,
  CheckCircle2,
  AlertTriangle,
  LoaderCircle,
  Clock3,
  Zap,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
  MapPin,
  Pencil,
  LockKeyhole,
  Radio,
  ClipboardList,
  LogOut,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { api } from "./api";
import "./style.css";
const time = (v) =>
  `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
const toMinutes = (v) => Number(v.split(":")[0]) * 60 + Number(v.split(":")[1]);
const shortDate = (value) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const readable = (value) => value.replaceAll("_", " ");
const requestDefaults = {
  title: "",
  region: "North",
  skill: "electrical",
  priority: "urgent",
  duration: 60,
  windowStart: 600,
  windowEnd: 960,
};
function App() {
  const [data, setData] = useState(null),
    [selectedId, setSelectedId] = useState(null),
    [tab, setTab] = useState("board"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(null),
    [reason, setReason] = useState(""),
    [request, setRequest] = useState(requestDefaults),
    [edit, setEdit] = useState(null),
    [token, setToken] = useState(""),
    [needAuth, setNeedAuth] = useState(false),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  async function refresh(preferred) {
    const next = await api("/state");
    setData(next);
    setNeedAuth(false);
    if (preferred !== undefined) setSelectedId(preferred);
    else
      setSelectedId((prev) =>
        prev && next.versions.some((v) => v.id === prev)
          ? prev
          : next.versions.find(
              (v) => v.status === "draft" && v.baseRevision === next.revision,
            )?.id || next.currentVersion,
      );
    return next;
  }
  useEffect(() => {
    refresh().catch((e) => {
      setError(e.message);
      if (e.status === 401) setNeedAuth(true);
    });
  }, []);
  async function action(fn, message) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(e.message);
      if (e.status === 401) setNeedAuth(true);
      if (e.status === 409) await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const plan = data?.versions.find((v) => v.id === selectedId),
    confirmed = data?.versions.find((v) => v.id === data.currentVersion);
  const assignments = plan?.assignments || [],
    stale = plan?.status === "draft" && plan.baseRevision !== data?.revision;
  const currentDraft = plan?.status === "draft" && !stale;
  const pending = data?.requests.filter((r) => !r.completed) || [];
  const req = (id) => data.requests.find((r) => r.id === id);
  const tech = (id) => data.technicians.find((t) => t.id === id);
  const invalidConfirmed =
    confirmed?.assignments.filter(
      (a) => !protectedWork(req(a.requestId)) && !tech(a.technicianId).active,
    ) || [];
  function open(value, initialReason = "") {
    setModal(value);
    setReason(initialReason);
    setError("");
  }
  async function generate() {
    await action(async () => {
      const v = await api("/proposals", {
        reason: confirmed
          ? "Replan after operational changes; preserve completed and in-progress jobs and minimize disruption."
          : "Plan today’s service requests, prioritize urgent work, and balance workload.",
      });
      await refresh(v.id);
      setTab("board");
    }, "Proposal ready for review. No assignments have been confirmed.");
  }
  async function submitModal(e) {
    e.preventDefault();
    await action(
      async () => {
        if (modal.type === "approve") {
          await api(`/proposals/${plan.id}/approve`, {
            reason,
            draftRevision: plan.draftRevision,
          });
          await refresh(plan.id);
        }
        if (modal.type === "cancel") {
          await api(`/technicians/${modal.id}/cancel`, { reason });
          await refresh();
        }
        if (modal.type === "start") {
          await api(`/requests/${modal.id}/start`, { reason });
          await refresh();
        }
        if (modal.type === "complete") {
          await api(`/requests/${modal.id}/complete`, { reason });
          await refresh();
        }
        if (modal.type === "request" || modal.type === "clarify") {
          await api(
            modal.type === "clarify"
              ? `/requests/${modal.id}/clarify`
              : "/requests",
            Object.fromEntries(
              Object.keys(requestDefaults).map((k) => [k, request[k]]),
            ),
          );
          await refresh();
        }
        if (modal.type === "edit") {
          const rest = assignments.filter((a) => a.requestId !== modal.id);
          const next = edit.technicianId
            ? [
                ...rest,
                {
                  requestId: modal.id,
                  technicianId: edit.technicianId,
                  start: toMinutes(edit.start),
                  end: toMinutes(edit.start) + req(modal.id).duration,
                },
              ]
            : rest;
          const v = await api(
            `/proposals/${plan.id}`,
            { assignments: next, reason, draftRevision: plan.draftRevision },
            "PUT",
          );
          await refresh(v.id);
        }
        setModal(null);
      },
      modal?.type === "approve"
        ? "Schedule confirmed. Mock notifications recorded for each changed assignment."
        : "Change saved. Review or generate a revised proposal.",
    );
  }
  if (needAuth)
    return (
      <div className="auth-page">
        <form
          className="auth-card"
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem("dispatch-token", token);
            action(() => refresh(), "Connected to the dispatch workspace.");
          }}
        >
          <div className="brand-mark mb-6">
            <Radio size={24} />
          </div>
          <h1>Welcome to Dispatch Desk</h1>
          <p>Enter the reviewer access token supplied with the demo.</p>
          <label>
            Access token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          )}
          <Button disabled={busy} className="w-full">
            {busy ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <LockKeyhole size={16} />
            )}{" "}
            Open workspace
          </Button>
        </form>
      </div>
    );
  if (!data)
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="brand-mark mb-6">
            <Radio size={24} />
          </div>
          <h1>Dispatch Desk</h1>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <Button
                onClick={() => action(() => refresh(), "Workspace loaded.")}
              >
                Retry connection
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-2">
              <LoaderCircle className="animate-spin" size={18} /> Loading the
              dispatch workspace…
            </p>
          )}
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("board");
          }}
        >
          <div className="brand-mark">
            <Radio size={21} />
          </div>
          <div>
            Dispatch<span>FIELD OPERATIONS</span>
          </div>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {[
            ["board", LayoutDashboard, "Dispatch board"],
            ["requests", ClipboardList, "Service requests"],
            ["team", Users, "Technicians"],
            ["history", History, "Schedule history"],
            ["activity", Bell, "Activity & logs"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              title={label}
              className={tab === id ? "nav-item selected" : "nav-item"}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
              {id === "requests" && <span>{pending.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pilot">
            <span className="status-dot" /> DEMO WORKSPACE
            <p>One day. One clear plan.</p>
            <small>4 technicians · up to 20 requests</small>
          </div>
          <div className="profile">
            <div className="avatar">PK</div>
            <div>
              Pranay Akuthota<span>Dispatcher</span>
            </div>
            {sessionStorage.getItem("dispatch-token") && (
              <button
                aria-label="Sign out"
                onClick={() => {
                  sessionStorage.removeItem("dispatch-token");
                  setNeedAuth(true);
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>
              {tab === "board"
                ? "Dispatch board"
                : tab === "requests"
                  ? "Service requests"
                  : tab === "team"
                    ? "Technicians"
                    : tab === "history"
                      ? "Schedule history"
                      : "Activity & logs"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="status-dot" />{" "}
              {data.provider === "MockProvider"
                ? "Mock advisor"
                : "OpenAI advisor"}
            </span>
            <button
              className="refresh"
              aria-label="Refresh workspace"
              onClick={() => action(() => refresh(), "Workspace refreshed.")}
              disabled={busy}
            >
              <RefreshCw size={17} className={busy ? "animate-spin" : ""} />
            </button>
            <div className="avatar small">PK</div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> DAILY OPERATIONS
              </div>
              <h1>
                {tab === "board"
                  ? "A clearer day, by design."
                  : tab === "requests"
                    ? "Every request, accounted for."
                    : tab === "team"
                      ? "Your team in the field."
                      : tab === "history"
                        ? "Every plan has a history."
                        : "A record of every decision."}
              </h1>
              <p>
                {tab === "board"
                  ? "Plan the work. Handle the unexpected. Keep people in control."
                  : "A small, transparent workspace for service dispatch."}
              </p>
            </div>
            <div className="heading-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRequest(requestDefaults);
                  open({ type: "request" });
                }}
              >
                <Plus size={16} /> Add request
              </Button>
              <Button disabled={busy} onClick={generate}>
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} />
                )}{" "}
                {confirmed ? "Replan schedule" : "Generate plan"}
              </Button>
            </div>
          </div>
          {error && (
            <div className="message error" role="alert">
              <AlertTriangle size={18} />
              <span className="whitespace-pre-line">{error}</span>
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button onClick={() => setNotice("")}>Dismiss</button>
            </div>
          )}
          {invalidConfirmed.length > 0 && (
            <div className="message warning">
              <AlertTriangle size={18} /> {invalidConfirmed.length} confirmed
              appointment(s) are affected by technician cancellation. Generate
              and approve a revised plan.
            </div>
          )}
          <div className="metrics">
            <Metric
              label="Service requests"
              value={data.requests.length}
              detail={`${pending.filter((r) => r.priority === "urgent").length} urgent · ${data.requests.filter((r) => r.completed).length} completed`}
              icon={ClipboardList}
            />
            <Metric
              label="Scheduled in view"
              value={assignments.length}
              detail={
                plan
                  ? plan.status === "draft"
                    ? "Proposed · awaiting approval"
                    : "Approved schedule version"
                  : "Generate your first proposal"
              }
              icon={CalendarDays}
            />
            <Metric
              label="Available technicians"
              value={data.technicians.filter((t) => t.active).length}
              detail={`Across ${new Set(data.technicians.map((t) => t.region)).size} service regions`}
              icon={Users}
            />
            <Metric
              label="Unassigned in view"
              value={data.requests.length - assignments.length}
              detail={
                plan
                  ? `${plan.summary.risks.length} items to review`
                  : "Waiting for a plan"
              }
              icon={AlertTriangle}
              attention={!!plan?.summary.unassigned.length}
            />
          </div>
          {tab === "board" && (
            <>
              <div className="board-grid">
                <section className="schedule panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        <CalendarDays size={18} /> Daily schedule
                      </h2>
                      <p>
                        {shortDate(data.day)} <span className="mx-1">·</span>{" "}
                        09:00–18:00 IST
                      </p>
                    </div>
                    <span
                      className={`pill ${plan?.status === "draft" ? "amber" : "green"}`}
                    >
                      {!plan
                        ? "Not planned"
                        : stale
                          ? "Stale draft"
                          : plan.status === "draft"
                            ? "Draft · not confirmed"
                            : "Approved version"}
                    </span>
                  </div>
                  <div className="schedule-toolbar">
                    <div className="segmented">
                      {["all", "North", "South"].map((value) => (
                        <button
                          key={value}
                          className={filter === value ? "active" : ""}
                          onClick={() => setFilter(value)}
                        >
                          {value === "all" ? "All regions" : value}
                        </button>
                      ))}
                    </div>
                    <div className="legend">
                      <span className="legend-dot electrical" />
                      Electrical <span className="legend-dot plumbing" />
                      Plumbing <span className="legend-dot hvac" />
                      HVAC
                    </div>
                  </div>
                  {!plan ? (
                    <div className="empty-schedule">
                      <div className="empty-icon">
                        <CalendarDays size={32} />
                      </div>
                      <h3>A good day starts with a plan.</h3>
                      <p>
                        Your team and service requests are ready.
                        <br />
                        Generate a proposal to see the day take shape.
                      </p>
                      <Button disabled={busy} onClick={generate}>
                        <Sparkles size={16} /> Generate first plan{" "}
                        <ArrowRight size={16} />
                      </Button>
                      <small>
                        <ShieldCheck size={14} /> Nothing is confirmed without
                        your approval.
                      </small>
                    </div>
                  ) : (
                    <>
                      <div className="timeline-scroll">
                        <div className="timeline">
                          <div className="time-axis">
                            <div>TECHNICIAN</div>
                            <div className="hours">
                              {Array.from({ length: 10 }, (_, i) => (
                                <span
                                  key={i}
                                  style={{ left: `${(i / 9) * 100}%` }}
                                >
                                  {String(i + 9).padStart(2, "0")}:00
                                </span>
                              ))}
                            </div>
                          </div>
                          {data.technicians
                            .filter(
                              (t) => filter === "all" || t.region === filter,
                            )
                            .map((t) => {
                              const jobs = assignments.filter(
                                  (a) => a.technicianId === t.id,
                                ),
                                load = jobs.reduce(
                                  (s, a) => s + a.end - a.start,
                                  0,
                                );
                              return (
                                <div className="timeline-row" key={t.id}>
                                  <div className="tech-name">
                                    <div
                                      className={`avatar ${!t.active ? "muted" : ""}`}
                                    >
                                      {t.name
                                        .split(" ")
                                        .map((x) => x[0])
                                        .join("")}
                                    </div>
                                    <div>
                                      <strong>{t.name}</strong>
                                      <small>
                                        {t.region} · {load}/{t.maxMinutes} min
                                      </small>
                                      {!t.active && (
                                        <span className="text-red-600 text-[10px]">
                                          Unavailable
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="track">
                                    <div
                                      className="available"
                                      style={{
                                        left: `${((t.start - 540) / 540) * 100}%`,
                                        width: `${((t.end - t.start) / 540) * 100}%`,
                                      }}
                                    />
                                    {jobs.map((a) => {
                                      const r = req(a.requestId);
                                      return (
                                        <button
                                          key={a.requestId}
                                          className={`job ${r.skill} ${r.completed ? "completed" : ""} ${!t.active && !protectedWork(r) ? "affected" : ""} ${r.status === "in_progress" ? "in-progress" : ""}`}
                                          style={{
                                            left: `${((a.start - 540) / 540) * 100}%`,
                                            width: `${((a.end - a.start) / 540) * 100}%`,
                                          }}
                                          onClick={() => {
                                            setEdit({
                                              technicianId: a.technicianId,
                                              start: time(a.start),
                                            });
                                            open({ type: "edit", id: r.id });
                                          }}
                                          title={`${r.title}: ${time(a.start)}–${time(a.end)}${r.completed ? " · Completed" : r.status === "in_progress" ? " · In progress · Locked" : ""}`}
                                        >
                                          <span>
                                            {r.completed && <Check size={11} />}{" "}
                                            {r.title}
                                          </span>
                                          <small>
                                            {time(a.start)}–{time(a.end)}
                                          </small>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                      <div className="schedule-footer">
                        <span>
                          <ShieldCheck size={14} /> Deterministic constraints
                          enforced
                        </span>
                        <span>
                          {assignments.length} jobs ·{" "}
                          {assignments.reduce((s, a) => s + a.end - a.start, 0)}{" "}
                          service minutes
                        </span>
                      </div>
                    </>
                  )}
                </section>
                <aside className="advisor panel">
                  <div className="advisor-header">
                    <div className="ai-icon">
                      <Sparkles size={20} />
                    </div>
                    <div>
                      <h2>Planning advisor</h2>
                      <p>
                        {data.provider === "MockProvider"
                          ? "Deterministic mock · development mode"
                          : "OpenAI · advisory mode"}
                      </p>
                    </div>
                    <span className="ai-tag">AI</span>
                  </div>
                  {!plan ? (
                    <div className="advisor-empty">
                      <h3>
                        Less juggling.
                        <br />
                        More clarity.
                      </h3>
                      <p>
                        Your advisor compares feasible plans, explains
                        trade-offs, and flags work that needs your attention.
                      </p>
                      <div className="advisor-check">
                        <CheckCircle2 size={16} /> Valid skills and time windows
                      </div>
                      <div className="advisor-check">
                        <CheckCircle2 size={16} /> No overlapping appointments
                      </div>
                      <div className="advisor-check">
                        <CheckCircle2 size={16} /> You make the final call
                      </div>
                      <div className="human-note">
                        <ShieldCheck size={18} />
                        <div>
                          <strong>Human approval, always.</strong>
                          <p>AI proposes. Your team confirms.</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="advisor-body">
                        <div className="eyebrow">
                          {plan.agent.provider === "mock"
                            ? "MOCK ADVISOR PROPOSAL"
                            : "AI PROPOSAL"}{" "}
                          <span className="strategy">{plan.strategy}</span>
                        </div>
                        <p className="ai-explanation">
                          {plan.agent.explanation}
                        </p>
                        {plan.manualOverride && (
                          <div className="override-note">
                            <Pencil size={14} /> Dispatcher modified this
                            proposal. The original AI explanation may no longer
                            describe every assignment.
                          </div>
                        )}
                        <h4>Trade-offs</h4>
                        <ul>
                          {plan.agent.tradeoffs.map((text, i) => (
                            <li key={i}>{text}</li>
                          ))}
                        </ul>
                        {plan.summary.risks.length > 0 && (
                          <>
                            <h4 className="text-amber-700">Needs attention</h4>
                            {plan.summary.risks.map((risk, i) => (
                              <p className="risk-item" key={i}>
                                <AlertTriangle size={14} />
                                {risk}
                              </p>
                            ))}
                          </>
                        )}
                        {plan.summary.questions.length > 0 && (
                          <>
                            <h4>Questions before dispatch</h4>
                            {plan.summary.questions.map((q, i) => (
                              <p className="question" key={i}>
                                {q}
                              </p>
                            ))}
                          </>
                        )}
                        <details className="changes">
                          <summary>
                            {plan.changes.length} changes from confirmed plan
                          </summary>
                          {plan.changes.length ? (
                            plan.changes.map((c) => (
                              <div key={c.requestId}>
                                <strong>{req(c.requestId).title}</strong>
                                <span>
                                  {c.kind}:{" "}
                                  {c.before
                                    ? `${tech(c.before.technicianId).name}, ${time(c.before.start)}`
                                    : "Unassigned"}{" "}
                                  →{" "}
                                  {c.after
                                    ? `${tech(c.after.technicianId).name}, ${time(c.after.start)}`
                                    : "Unassigned"}
                                </span>
                                <small>{c.reason || plan.reason}</small>
                              </div>
                            ))
                          ) : (
                            <p>No assignment changes.</p>
                          )}
                        </details>
                      </div>
                      <div className="approval-area">
                        {stale ? (
                          <>
                            <p className="text-amber-700">
                              Inputs changed. This draft needs a fresh proposal.
                            </p>
                            <Button
                              className="w-full"
                              disabled={busy}
                              onClick={generate}
                            >
                              <RefreshCw size={16} /> Generate revised plan
                            </Button>
                          </>
                        ) : currentDraft ? (
                          <>
                            <p>
                              <ShieldCheck size={14} /> Review the schedule
                              before confirming.
                            </p>
                            <Button
                              className="w-full"
                              disabled={busy}
                              onClick={() =>
                                open(
                                  { type: "approve" },
                                  "Reviewed assignments, unassigned work, and planning trade-offs.",
                                )
                              }
                            >
                              <CheckCircle2 size={16} /> Review & approve plan
                            </Button>
                          </>
                        ) : (
                          <div className="approved-note">
                            <CheckCircle2 size={18} /> Approved{" "}
                            {new Date(plan.approvedAt).toLocaleTimeString(
                              "en-IN",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "Asia/Kolkata",
                              },
                            )}{" "}
                            IST
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </aside>
              </div>
              <section className="panel mt-6">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Service queue{" "}
                      <span className="count">{data.requests.length}</span>
                    </h2>
                    <p>A quick look at what’s on the day’s list.</p>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => setTab("requests")}
                  >
                    View all requests <ArrowUpRight size={15} />
                  </button>
                </div>
                <RequestTable
                  requests={data.requests.slice(0, 5)}
                  assignments={assignments}
                  current={confirmed?.assignments || []}
                  tech={tech}
                  busy={busy}
                  onEdit={(r) => {
                    const a = assignments.find((a) => a.requestId === r.id);
                    setEdit({
                      technicianId: a?.technicianId || "",
                      start: time(a?.start || r.windowStart),
                    });
                    open({ type: "edit", id: r.id });
                  }}
                  onStart={(r) =>
                    open(
                      { type: "start", id: r.id },
                      "Technician reported service started.",
                    )
                  }
                  onComplete={(r) =>
                    open(
                      { type: "complete", id: r.id },
                      "Technician reported service completed.",
                    )
                  }
                  onClarify={(r) => {
                    setRequest({ ...r });
                    open({ type: "clarify", id: r.id });
                  }}
                />
              </section>
            </>
          )}
          {tab === "requests" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    Service requests{" "}
                    <span className="count">{data.requests.length}</span>
                  </h2>
                  <p>Missing information and unassigned work stay visible.</p>
                </div>
                <input
                  className="search-input"
                  aria-label="Search requests"
                  placeholder="Search requests…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <RequestTable
                requests={data.requests.filter((r) =>
                  r.title.toLowerCase().includes(search.toLowerCase()),
                )}
                assignments={assignments}
                current={confirmed?.assignments || []}
                tech={tech}
                busy={busy}
                onEdit={(r) => {
                  const a = assignments.find((a) => a.requestId === r.id);
                  setEdit({
                    technicianId: a?.technicianId || "",
                    start: time(a?.start || r.windowStart),
                  });
                  open({ type: "edit", id: r.id });
                }}
                onStart={(r) =>
                  open(
                    { type: "start", id: r.id },
                    "Technician reported service started.",
                  )
                }
                onComplete={(r) =>
                  open(
                    { type: "complete", id: r.id },
                    "Technician reported service completed.",
                  )
                }
                onClarify={(r) => {
                  setRequest({ ...r });
                  open({ type: "clarify", id: r.id });
                }}
              />
            </section>
          )}
          {tab === "team" && (
            <div className="team-grid">
              {data.technicians.map((t) => (
                <section key={t.id} className="panel team-card">
                  <div className="flex items-center justify-between">
                    <div className="avatar large">
                      {t.name
                        .split(" ")
                        .map((x) => x[0])
                        .join("")}
                    </div>
                    <span className={`pill ${t.active ? "green" : "red"}`}>
                      {t.active ? "Available" : "Cancelled"}
                    </span>
                  </div>
                  <h2>{t.name}</h2>
                  <p>
                    <MapPin size={14} /> {t.region} region
                  </p>
                  <div className="skill-tags">
                    {t.skills.map((s) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  <dl>
                    <div>
                      <dt>Availability</dt>
                      <dd>
                        {time(t.start)}–{time(t.end)}
                      </dd>
                    </div>
                    <div>
                      <dt>Maximum workload</dt>
                      <dd>{t.maxMinutes} minutes</dd>
                    </div>
                    <div>
                      <dt>Confirmed jobs</dt>
                      <dd>
                        {confirmed?.assignments.filter(
                          (a) => a.technicianId === t.id,
                        ).length || 0}
                      </dd>
                    </div>
                  </dl>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={busy || !t.active}
                    onClick={() => open({ type: "cancel", id: t.id })}
                  >
                    Report cancellation
                  </Button>
                </section>
              ))}
            </div>
          )}
          {tab === "history" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Schedule versions</h2>
                  <p>
                    Approval freezes a version. New proposals preserve the
                    history.
                  </p>
                </div>
                <History size={20} />
              </div>
              {!data.versions.length ? (
                <Empty text="No versions yet. Generate a proposal to start the history." />
              ) : (
                <div className="version-list">
                  {data.versions.map((v, i) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedId(v.id);
                        setTab("board");
                      }}
                    >
                      <div className="version-icon">
                        <History size={18} />
                      </div>
                      <div>
                        <strong>
                          Version {data.versions.length - i}{" "}
                          <span
                            className={`pill ${v.status === "draft" ? "amber" : "green"}`}
                          >
                            {v.status}
                            {v.id === data.currentVersion ? " · current" : ""}
                          </span>
                        </strong>
                        <p>{v.reason}</p>
                        <small>
                          {v.assignments.length} assignments ·{" "}
                          {v.changes.length} changes · {v.agent.provider}{" "}
                          advisor
                        </small>
                      </div>
                      <span className="version-date">
                        {new Date(v.createdAt).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}{" "}
                        IST <ChevronRight size={16} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {tab === "activity" && (
            <div className="activity-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Decision log</h2>
                    <p>
                      Approvals, overrides, events, and AI workflow metadata.
                    </p>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                {!data.audit.length ? (
                  <Empty text="No events yet. Your first decision will appear here." />
                ) : (
                  data.audit.map((a) => (
                    <div className="audit-entry" key={a.id}>
                      <div className="audit-dot" />
                      <div>
                        <strong>{readable(a.kind)}</strong>
                        <p>
                          {a.reason ||
                            (a.priority
                              ? `${a.requestId} · ${a.priority} priority`
                              : a.requestId || "Workspace input updated")}
                        </p>
                        {a.provider && (
                          <small>
                            {a.provider} · {a.model} · {a.agentStatus} ·{" "}
                            {a.latencyMs ?? 0}ms
                          </small>
                        )}
                        <small>
                          {new Date(a.at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })}{" "}
                          IST · {a.actor}
                        </small>
                        <details>
                          <summary>Structured event</summary>
                          <pre>{JSON.stringify(a, null, 2)}</pre>
                        </details>
                      </div>
                    </div>
                  ))
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      <Bell size={17} /> Mock notifications
                    </h2>
                    <p>Recorded only after approval. No messages are sent.</p>
                  </div>
                </div>
                {!data.notifications.length ? (
                  <Empty text="Confirm a plan to record mocked notifications." />
                ) : (
                  data.notifications.map((n) => (
                    <div className="notification" key={n.id}>
                      <CheckCircle2 size={16} />
                      <div>
                        <strong>{n.message}</strong>
                        <small>
                          {new Date(n.at).toLocaleTimeString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })}{" "}
                          IST · {n.deliveryStatus}
                        </small>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>
              DISPATCH DESK <span className="mx-2">/</span> A focused
              field-service workspace
            </span>
            <span>
              <ShieldCheck size={13} /> Human decisions. Traceable changes.
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(value) => {
          if (!value && !busy) setModal(null);
        }}
        title={
          modal?.type === "start"
            ? "Start service?"
            : modal?.type === "approve"
              ? "Confirm this schedule?"
              : modal?.type === "cancel"
                ? "Report technician cancellation"
                : modal?.type === "complete"
                  ? "Mark service completed"
                  : modal?.type === "edit"
                    ? "Review assignment"
                    : modal?.type === "clarify"
                      ? "Clarify service request"
                      : "Add a service request"
        }
        description={
          modal?.type === "approve"
            ? "You are making the final dispatch decision. Review unassigned and risky requests before approving."
            : modal?.type === "cancel"
              ? "Started work stays with its current technician and time slot so it can finish. Future pending work needs a revised plan."
              : modal?.type === "edit"
                ? "Changes are validated and logged. They remain a draft until approval."
                : modal?.type === "complete"
                  ? "Completed work is locked and cannot move during replanning."
                  : "Provide the information your team needs to schedule this job."
        }
      >
        <form onSubmit={submitModal} className="modal-form">
          {modal?.type === "approve" && (
            <div className="approval-summary">
              <span>
                <CheckCircle2 size={16} /> {assignments.length} proposed
                assignments
              </span>
              <span>
                <AlertTriangle size={16} /> {plan?.summary.unassigned.length}{" "}
                unassigned requests
              </span>
              <span>
                <History size={16} /> {plan?.changes.length} schedule changes
              </span>
              {plan?.summary.unassigned.map((u) => (
                <small key={u.requestId}>
                  {req(u.requestId).title}: {u.reason}
                </small>
              ))}
            </div>
          )}
          {modal?.type === "cancel" && (
            <div className="text-sm mb-4 font-medium">
              {tech(modal.id).name} · {tech(modal.id).region}
            </div>
          )}
          {modal?.type === "complete" && (
            <div className="text-sm mb-4 font-medium">
              {req(modal.id).title}
            </div>
          )}
          {modal?.type === "edit" && (
            <>
              <div className="request-detail">
                <strong>{req(modal.id).title}</strong>
                <p>
                  {req(modal.id).skill || "Skill not specified"} ·{" "}
                  {req(modal.id).region} · {req(modal.id).duration} minutes
                </p>
                <p>
                  Preferred window: {time(req(modal.id).windowStart)}–
                  {time(req(modal.id).windowEnd)}
                </p>
              </div>
              {!currentDraft || protectedWork(req(modal.id)) ? (
                <p className="message warning">
                  {protectedWork(req(modal.id))
                    ? "Started and completed work is locked."
                    : "Select a current draft to modify this assignment."}
                </p>
              ) : (
                <>
                  <label>
                    Technician
                    <select
                      value={edit?.technicianId || ""}
                      onChange={(e) =>
                        setEdit({ ...edit, technicianId: e.target.value })
                      }
                    >
                      <option value="">Leave unassigned</option>
                      {data.technicians
                        .filter(
                          (t) =>
                            t.active &&
                            t.region === req(modal.id).region &&
                            t.skills.includes(req(modal.id).skill),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {time(t.start)}–{time(t.end)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {edit?.technicianId && (
                    <label>
                      Start time
                      <input
                        type="time"
                        min="09:00"
                        max="18:00"
                        value={edit.start}
                        onChange={(e) =>
                          setEdit({ ...edit, start: e.target.value })
                        }
                        required
                      />
                    </label>
                  )}
                </>
              )}
            </>
          )}
          {["request", "clarify"].includes(modal?.type) && (
            <>
              <label>
                Request title
                <input
                  value={request.title}
                  onChange={(e) =>
                    setRequest({ ...request, title: e.target.value })
                  }
                  required
                  minLength={3}
                  maxLength={100}
                  placeholder="e.g. Emergency clinic power outage"
                />
              </label>
              <div className="form-grid">
                <label>
                  Region
                  <select
                    value={request.region}
                    onChange={(e) =>
                      setRequest({ ...request, region: e.target.value })
                    }
                  >
                    <option>North</option>
                    <option>South</option>
                  </select>
                </label>
                <label>
                  Required skill
                  <select
                    value={request.skill || ""}
                    onChange={(e) =>
                      setRequest({ ...request, skill: e.target.value || null })
                    }
                  >
                    <option value="">Needs clarification</option>
                    {["electrical", "plumbing", "hvac", "lift"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={request.priority}
                    onChange={(e) =>
                      setRequest({ ...request, priority: e.target.value })
                    }
                  >
                    {["urgent", "high", "normal", "low"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Duration (minutes)
                  <input
                    type="number"
                    min={15}
                    max={480}
                    value={request.duration}
                    onChange={(e) =>
                      setRequest({
                        ...request,
                        duration: Number(e.target.value),
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Window start
                  <input
                    type="time"
                    min="09:00"
                    max="18:00"
                    value={time(request.windowStart)}
                    onChange={(e) =>
                      setRequest({
                        ...request,
                        windowStart: toMinutes(e.target.value),
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Window end
                  <input
                    type="time"
                    min="09:00"
                    max="18:00"
                    value={time(request.windowEnd)}
                    onChange={(e) =>
                      setRequest({
                        ...request,
                        windowEnd: toMinutes(e.target.value),
                      })
                    }
                    required
                  />
                </label>
              </div>
            </>
          )}
          {!["request", "clarify"].includes(modal?.type) &&
            !(
              modal?.type === "edit" &&
              (!currentDraft || protectedWork(req(modal.id)))
            ) && (
              <label>
                {modal?.type === "approve"
                  ? "Approval note"
                  : "Reason for this change"}
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  placeholder="Record the reason so your team can follow the decision."
                />
              </label>
            )}
          {error && (
            <div role="alert" className="message error whitespace-pre-line">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              Close
            </Button>
            {!(
              modal?.type === "edit" &&
              (!currentDraft || protectedWork(req(modal.id)))
            ) && (
              <Button disabled={busy} type="submit">
                {busy && <LoaderCircle size={15} className="animate-spin" />}
                {modal?.type === "approve"
                  ? "Approve & confirm"
                  : modal?.type === "cancel"
                    ? "Confirm cancellation"
                    : modal?.type === "complete"
                      ? "Mark completed"
                      : "Save change"}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
function Metric({ label, value, detail, icon: Icon, attention }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{String(value).padStart(2, "0")}</strong>
      <p className={attention ? "attention" : ""}>
        {attention && <span className="amber-dot" />}
        {detail}
      </p>
    </div>
  );
}
function Empty({ text }) {
  return (
    <div className="empty-small">
      <ClipboardList size={24} />
      <p>{text}</p>
    </div>
  );
}
function RequestTable({
  requests,
  assignments,
  current,
  tech,
  busy,
  onEdit,
  onComplete,
  onStart,
  onClarify,
}) {
  return !requests.length ? (
    <Empty text="No requests match your search." />
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>REQUEST</th>
            <th>PRIORITY</th>
            <th>REGION / SKILL</th>
            <th>TIME WINDOW</th>
            <th>ASSIGNMENT IN VIEW</th>
            <th> </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const a = assignments.find((a) => a.requestId === r.id),
              live = current.find((a) => a.requestId === r.id),
              completable =
                live &&
                (tech(live.technicianId).active || r.status === "in_progress");
            return (
              <tr key={r.id}>
                <td>
                  <strong>{r.title}</strong>
                  <small>
                    {r.id.toUpperCase()} · {r.duration} min{" "}
                    {r.completed
                      ? "· Completed"
                      : r.status === "in_progress"
                        ? "· In progress · Locked"
                        : ""}
                  </small>
                </td>
                <td>
                  <span className={`priority ${r.priority}`}>
                    {r.priority === "urgent" && <Zap size={11} />} {r.priority}
                  </span>
                </td>
                <td>
                  <span>{r.region}</span>
                  <small>{r.skill || "Needs clarification"}</small>
                </td>
                <td>
                  <span>
                    {time(r.windowStart)}–{time(r.windowEnd)}
                  </span>
                </td>
                <td>
                  {a ? (
                    <span className="assignee">
                      <span className="mini-avatar">
                        {tech(a.technicianId).name[0]}
                      </span>
                      {tech(a.technicianId).name}
                    </span>
                  ) : (
                    <span className="unassigned">Unassigned</span>
                  )}
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    {!r.skill && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onClarify(r)}
                      >
                        Clarify
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Review ${r.title}`}
                      onClick={() => onEdit(r)}
                    >
                      <Pencil size={14} />
                    </Button>
                    {live &&
                      tech(live.technicianId).active &&
                      !protectedWork(r) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          aria-label={`Start ${r.title}`}
                          onClick={() => onStart(r)}
                        >
                          Start
                        </Button>
                      )}
                    {completable && !r.completed && (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={`Complete ${r.title}`}
                        onClick={() => onComplete(r)}
                      >
                        <CheckCircle2 size={15} />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
