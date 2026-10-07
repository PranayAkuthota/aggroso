# AI collaboration record

This document records the actual development assistance in this session. It is not a claim that the candidate manually wrote every file.

## Candidate input and decisions

The candidate supplied the AGGROSO assessment screenshots and selected **Field Service Dispatch and Replanning Agent**. The candidate explicitly chose JavaScript throughout, React/Vite/Tailwind/shadcn components, Express/Prisma/PostgreSQL/Zod, Vitest/Supertest, Railway for backend/database, Vercel for frontend, and OpenAI with a MockProvider. The candidate reiterated that AI must stay advisory and that deterministic validation and human approval are mandatory.

Those requirements replaced the assistant's initial suggested stack. Review, hands-on demo execution, deployment/account setup, and final submission remain candidate responsibilities until they are actually carried out.

## Tools and assistance

OpenAI Codex assisted with requirements interpretation, architecture, implementation, UI styling, tests, and documentation. Shell tools, npm, Docker PostgreSQL, Prisma, Vitest, and Supertest were used where available. No sub-agents were delegated implementation work in this session. The application’s runtime OpenAI advisor is separate from Codex's development assistance.

## Representative instructions

- “Use Railway for the backend and PostgreSQL, and Vercel for the frontend. Use OpenAI as the LLM provider … Also implement a MockProvider.”
- “I am most comfortable with JavaScript, so use JavaScript throughout the project … Please do NOT use TypeScript, FastAPI, or SQLite.”
- “AI must remain advisory, with deterministic validation and mandatory human approval before a schedule is confirmed.”

The application provider prompt asks the model to treat request data as untrusted, select a provided candidate ID, explain trade-offs, and never invent assignments or claim approval. The exact prompt is versioned in `server/providers.js`.

## Rejected directions and corrections

- The assistant initially scaffolded a Python/FastAPI/SQLite backend and TypeScript frontend before receiving the candidate's stack preference. The candidate rejected that direction. The scaffold was replaced by the requested JavaScript/PostgreSQL stack; those technologies are not part of the final application.
- A silent heuristic fallback on provider failure was considered in the initial scaffold. The final implementation instead labels MockProvider explicitly and reports OpenAI failure without pretending a live AI workflow succeeded.
- The scheduler does not accept unrestricted model-created appointments. It uses deterministic valid candidates, validates the selected output, and rechecks constraints before approval.
- The first production image could not start as its non-root user because copied workspace files had restrictive permissions. Docker COPY ownership was corrected to the runtime user; the final image was checked for startup, PostgreSQL access, authentication, CORS, and migrations.
- Prisma's engine download hit a cloud network-policy denial. Signature/checksum verification was retained; bypassing verification was not used as a workaround. Clean reinstall later succeeded, and the complete 39-test suite passed.

## Verification and ownership

`docs/VALIDATION.md` records executed checks and pending checks. Unit provider tests simulate the OpenAI SDK response and are not evidence of live model access. The database integration suite uses a dedicated test database, rejects a live/demo database name, and exercises transaction and race conditions.

The candidate should inspect the scheduler, provider prompt, approval transaction, and tests; run the walkthrough; and add their own review notes below after doing so. No review, human-written contribution, deployment, or production provider success is invented in this record.

## Candidate review notes

Pending hands-on review. Add specific changes you chose, tests you ran, trade-offs you accepted, and any AI suggestion you rejected after reviewing the implementation.

## Final observed checks

53 Vitest tests (21 domain, 8 provider, 24 real PostgreSQL API cases), 7 Chromium UI tests with stubbed HTTP, a separate live browser-to-PostgreSQL draft smoke test, frontend production build, idempotent seed/migrations, and production Docker runtime checks passed. Live OpenAI access was not tested without a key. No source push, hosted deployment, or publication was performed, in accordance with the candidate’s instruction.

## Follow-up audit gap implementation

The candidate accepted the earlier audit, supplied the original Antigravity blueprint, and explicitly limited follow-up work to in-progress protection, truthful per-change explanations, provider verification, regression tests, and documentation. Codex retained the JavaScript architecture and the original blueprint unchanged.

Codex added the confirmed-work start transition, locked both started and completed allocations, documented cancellation as finish-started/cancel-future, and attached observed constraint/strategy evidence to each diff. The provider now receives approved baseline assignments and candidate diffs; deterministic facts are computed outside the model. Tests verify protected work, future replanning, manual validation, cancellation/emergency causes, capacity rejection, provider boundaries, and per-change UI reasons.

The new browser test initially tried to read reasons inside a collapsed details section; the test was corrected to open it. It then exposed a missing refresh after the new Start action. Codex fixed the UI refresh and reran the browser tests. The live smoke script initially assumed an empty workspace; its action selector was updated to use the persistent Generate plan button so it can run again without clearing data. These are observed corrections, not invented rejected suggestions.

Process/local environment presence checks found no OpenAI key, and the saved secure binding was unbound. No live model request was made. **OPENAI INTEGRATION CONFIGURED BUT NOT LIVE-VERIFIED**. The blueprint compliance report records reference-design differences rather than claiming exact implementation of its full architecture. No sub-agents, source commits/pushes, deployments, or publications were performed.

## Gemini provider follow-up

The candidate requested Gemini to avoid OpenAI API billing. Added a native HTTPS provider, strict structured output parsing, provider labels, and mocked transport tests. OpenAI and MockProvider remain selectable. No secret was added, and no production database was reset. Real Gemini connectivity requires a key configured privately on Railway and is not claimed by mocked tests.

## Request deletion follow-up

The candidate authorized a focused request cleanup improvement. Added confirmed deletion for unstarted requests with no assignment in any schedule version, with transactional audit evidence, stale-proposal invalidation, and ID reuse prevention. PostgreSQL API tests and a browser confirmation test cover the new behavior. No production data or credentials were modified.

## Technician restoration follow-up

The candidate authorized restoring cancelled technicians rather than expanding roster management. Added a confirmation with a required reason and a transactional restore endpoint with an audit event and revision increment. Tests verify protected work, unchanged approved versions, stale-draft rejection, no automatic notifications, and subsequent proposal approval. Production data was not changed.
