# Dispatch Desk

A one-day field-service dispatch workspace: propose a schedule, review exceptions, make manual changes, approve, and replan when the day changes. Built for the AGGROSO **Field Service Dispatch and Replanning Agent** assessment.

The main design decision is to keep the scheduling rules independent of AI. Code generates three feasible candidate plans; the advisor selects one and explains the trade-offs. An explicit dispatcher approval is the only operation that confirms appointments.

## Stack

- React + Vite, JavaScript, Tailwind CSS, and shadcn-style Radix/CVA Button and Dialog components.
- Node.js + Express, Zod input validation, Prisma, and PostgreSQL.
- OpenAI provider and a deterministic MockProvider behind the same interface.
- Vitest + Supertest, with integration tests against an actual, isolated PostgreSQL database.

## Local setup

Use Node 24, npm, and Docker Compose. No Python, TypeScript, or SQLite is required.

```sh
cp .env.example .env
npm ci
npm --prefix frontend ci
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
```

The local PostgreSQL password in Compose is only for the loopback-bound development database. Use Railway's managed credentials in production. `.env` files are ignored. Never commit a real API key, reviewer token, or database URL.

Run the backend and frontend in separate terminals:

```sh
npm run dev
npm --prefix frontend run dev
```

Vite proxies `/api` to the backend on port 8000. The backend uses `PORT` when deployed. The seed command is additive and does not replace an existing workspace. Confirm readiness with `GET /api/health` (database checked) and then generate a proposal in the UI.

## Try the core workflow

1. Generate the first plan. Six seed requests can be scheduled; lift inspection lacks a matching technician, and the shop enquiry needs a skill clarification.
2. Review the timeline, unassigned reasons, risks, and trade-offs. Edit a draft assignment and record a reason. An invalid skill, region, overlap, duration, window, or workload is rejected by the backend.
3. Click **Review & approve plan**, review the summary, and confirm. Mock notifications are created only now.
4. Click **Start** for the confirmed clinic job in the service queue and record a reason. It becomes in-progress and immutable; **Complete** records finished service.
5. Open **Technicians** and report Asha's cancellation with a reason. The confirmed schedule remains a historical record and affected pending jobs are flagged.
6. Add an urgent electrical request in North, with a 60-minute duration and 11:00–16:00 window. Replan. Started and completed work stays in place; feasible pending work is reassigned.
7. Review the before/after changes and approve the revision. **Schedule history** preserves both approved versions; **Activity & logs** records the events and mock notification outbox.
8. Clarify the shop request from **Service requests** and generate another proposal.

## AI configuration

`AI_PROVIDER=mock` runs without a paid API credential and is clearly labelled in the UI. It is a development/test advisor, not evidence of a live LLM call.

For the assessed deployment use:

```dotenv
AI_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini
```

Supply `OPENAI_API_KEY` only through Railway's secure server environment variables. `LLM_API_KEY` is an equivalent binding for cloud environments where `OPENAI_` names are reserved. Neither key is sent to the browser. Provider errors and invalid model output fail visibly with HTTP 502; the application does not silently claim MockProvider output came from OpenAI.

The OpenAI call receives the bounded input, approved assignment baseline, and three validated candidates including deterministic change reasons and evidence. It returns a candidate ID, explanation, and trade-offs. The server validates that output and revalidates all selected assignments. Deterministic code, rather than the model, computes unassigned reasons, risk warnings, and clarification questions. If inputs change during an LLM call, the result is rejected and a fresh proposal is needed.

## Architecture and persistence

```mermaid
flowchart LR
  UI[React dispatcher] --> API[Express / Zod]
  API --> Rules[Deterministic candidate planner]
  Rules --> Advisor[OpenAI or MockProvider]
  Advisor --> Validate[Validate selected candidate]
  Validate --> Draft[Persist draft]
  Draft --> Human[Dispatcher review and approval]
  Human --> Commit[Locked PostgreSQL transaction]
  Commit --> Versions[Schedule versions]
  Commit --> Audit[Audit events]
  Commit --> Outbox[Mock notifications]
```

Prisma stores a single bounded workspace as JSON, with separate version, audit, and notification records. This keeps the assessment domain small and avoids unnecessary relation-management code. It is intentionally a single demo workspace, not a multi-tenant production schema. The schema is in `prisma/schema.prisma`; SQL migrations are versioned.

Every write takes a PostgreSQL row lock on the workspace. Input mutations and approval increase its revision. A proposal records its input revision; manual edits also carry a draft revision. Approval checks both, validates again, and commits the current-version pointer, approval audit event, and notification outbox in one transaction. Concurrent approvals cannot both win. A provider call happens outside the database lock, followed by a revision check.

Approved assignment snapshots are never edited. Start and completion are recorded on the live request and in the audit log, so historical versions continue to describe their original schedules. Cancellation does not erase the previous approved plan. Its explicit policy is to finish started work with the original technician and time slot, while cancelling future unstarted work. A started job on a cancelled technician can still be completed; no new pending job can be started by that technician. Future impacted appointments require a new proposal and approval.

Structured application logs contain event metadata and IDs, not credentials or full prompts. Persisted audit events include reasons and change diffs; proposal records contain provider, model, outcome, explanation, and timing. Logs and data may contain demo operational information; access to the API requires the reviewer token in production.

## Rules and deliberate limits

- Strict skill and region matching; preferred windows are treated as hard constraints.
- Technician availability and maximum workload are enforced in service minutes. Completed and in-progress service counts toward workload.
- No duplicate request assignment, double booking, or moving/removing/reassigning completed or in-progress work.
- One working day, 4 seeded technicians, at most 20 requests. The demo day is 8 October 2026 and displayed in IST.
- Three deterministic greedy strategies: priority/deadline, workload balance, and continuity. This is not a global optimizer.
- No real travel time, maps, GPS, payroll, route APIs, actual notifications, or technician login.
- A dispatcher can deliberately leave work unassigned, with a logged reason. Hard constraints cannot be overridden.
- Request editing is limited to clarification of a missing skill; technician configuration is seeded, with cancellation supported. General resource CRUD and reactivation are excluded.
- Reviewer-token authentication is suitable for the bounded demo. It is not a production account/role system. All token holders share the dispatcher identity; no claim of per-user attribution is made.
- Version history is retained. Work status shown on an old version reflects current request status; assignment snapshots and audit events preserve original timing.
- OpenAI may choose a suboptimal feasible candidate. The UI shows all unassigned work and requires a human to accept the result.

## Tests

Create an isolated test database, apply migrations to it, and set `TEST_DATABASE_URL` to its URL. Its database name **must end in `_test`**: the integration suite refuses any other target because it clears test records between cases. Do not use the live demo database.

```sh
docker compose exec postgres createdb -U dispatch dispatch_test
DATABASE_URL=postgresql://dispatch:dispatch_local_only@localhost:55432/dispatch_test npm run db:migrate
TEST_DATABASE_URL=postgresql://dispatch:dispatch_local_only@localhost:55432/dispatch_test npm test
npm --prefix frontend run build
npm run test:browser
```

Browser checks use stubbed HTTP and system Chromium when available; otherwise install Playwright Chromium with `npx playwright install chromium`. They verify interface behavior and do not replace database integration tests.

Unit coverage checks hard constraints, deterministic planning, diffs with causal evidence, completed/in-progress locks, MockProvider behavior, and OpenAI response parsing using a mocked SDK transport. Database-backed API tests cover approval gating, audit/outbox atomicity, manual edit validation, stale drafts, completion/cancellation/emergency replanning, concurrent approvals, input races during AI work, provider errors, malformed input, authentication, and persistence across app instances.

See `docs/VALIDATION.md` for observed results, including what has not yet been verified. Unit tests of a mocked SDK do not verify a real OpenAI connection or hosted deployment.

## Deployment and submission

See [Railway + Vercel deployment](docs/DEPLOYMENT.md), [reviewer demo](docs/DEMO.md), and [AI collaboration record](AGENT_USAGE.md). A hosted app with working OpenAI integration is required by the assessment. Deployment files alone do not satisfy that requirement.

## Blueprint comparison and current verification

The supplied [IMPLEMENTATION_BLUEPRINT.md](IMPLEMENTATION_BLUEPRINT.md) is retained unchanged. [Blueprint compliance](docs/BLUEPRINT_COMPLIANCE.md) maps its requirements and records implementation differences. The assessment is authoritative; the candidate’s explicit JavaScript and no-deployment instructions take precedence over TypeScript and deployment phases in that reference.

Current status: **OPENAI INTEGRATION CONFIGURED BUT NOT LIVE-VERIFIED**. No secure API key is available in this workspace. MockProvider, simulated OpenAI transport, PostgreSQL workflows, and browser behavior are locally verified; no hosted deployment is claimed. See [validation evidence](docs/VALIDATION.md).
