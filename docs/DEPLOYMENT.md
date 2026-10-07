# Railway backend + PostgreSQL / Vercel frontend

These files prepare deployment. A live URL is only verified after deployment and the checks below.

## Before connecting hosting

Review the local files, then commit and push them to your chosen GitHub deployment branch when you are ready. This session did not push source or deploy anything. The initially empty remote must contain the reviewed project before Railway or Vercel can build it. `.env` and generated outputs are ignored; keep real credentials out of the commit.

## Railway

1. Connect the GitHub repository to your Railway project. Add Railway PostgreSQL.
2. Create the backend service from the repository root. `railway.json` selects the root Dockerfile and `/api/health` readiness check.
3. Bind `DATABASE_URL` to the PostgreSQL service's private connection URL via Railway variable references. Do not paste it into code or chat.
4. Add secure server variables: `NODE_ENV=production`, `AI_PROVIDER=openai`, `OPENAI_MODEL=gpt-4o-mini`, `OPENAI_API_KEY`, and a long random `APP_ACCESS_TOKEN` for reviewer access. Railway supplies `PORT`.
5. Set `FRONTEND_ORIGIN` to your exact Vercel HTTPS origin (no trailing slash). Multiple exact origins can be comma-separated for a preview; do not use a wildcard.
6. Enable a Railway public domain. The pre-deploy command applies Prisma migrations; application startup initializes the seed workspace only if absent.
7. Verify `/api/health` returns `status: ok`, `provider: OpenAIProvider`, and `accessProtected: true`.

The Docker image retains the pinned Prisma CLI for the migration pre-deploy command. The database owns persistence; backend filesystem changes are unnecessary. A redeploy must preserve the approved versions and audit events.

## Vercel

1. Import the same repository. Set **Root Directory** to `frontend`, framework to Vite, and Node.js version to 24.
2. Configure `VITE_API_URL` as the backend's public HTTPS origin. This is a public URL, not a secret.
3. Build with `npm run build`, output directory `dist`. The root `frontend/vercel.json` provides these settings and a SPA rewrite.
4. Never place `OPENAI_API_KEY`, `DATABASE_URL`, or `APP_ACCESS_TOKEN` in a `VITE_` variable. Vite embeds those values into the public browser bundle.
5. Deploy. Ensure the final origin is present in Railway's `FRONTEND_ORIGIN`, then redeploy the backend if it changed.

Reviewers enter the access token at the app's login screen. It is held in browser session storage for the current tab and sent as a Bearer header. Supply only this demo token privately in submission remarks, not production credentials. Choose a token unique to this demo and rotate it after review.

## Verify the deployed application

- Open the Vercel URL in a fresh browser; confirm the access screen rejects an incorrect token and loads with the demo token.
- Generate a plan and verify the advisor identifies OpenAI, not MockProvider. The proposal appears as a draft; no notification is recorded before approval.
- Approve, start a job, cancel its technician, add an emergency, and generate/approve a revised plan. Verify started and completed work is preserved and the history includes both versions.
- Refresh the browser and redeploy the backend; verify the PostgreSQL data persists.
- Try an overlapping manual edit; confirm the API rejects it and the previous draft stays intact.
- Confirm mock notifications appear only for confirmed assignment changes.
- Keep Railway PostgreSQL, the backend, Vercel, and the server OpenAI key available through review.

## If something fails

- HTTP 401: use the reviewer token configured on Railway, not the OpenAI key.
- Browser network/CORS failure: compare `VITE_API_URL` and exact `FRONTEND_ORIGIN`; use HTTPS for both deployed origins.
- Health check failure: inspect Railway logs and the private `DATABASE_URL` reference. Migrations and seed must succeed before readiness.
- HTTP 502 during generation: inspect OpenAI account quota/model access and secure key binding. No assignments are confirmed on provider failure.
- HTTP 409: refresh and generate a fresh proposal; its input revision is stale.

This project uses one shared demonstration workspace. Before sharing, keep seed/demo data only. There is no public reset endpoint and no production customer information should be used.

## Local Docker validation behind a cloud proxy

Normal hosting builds use `docker build -t dispatch .`. The Dockerfile accepts an optional BuildKit `build_ca` secret for environments with a trusted interception CA. Supply the environment-provided CA file through `--secret id=build_ca,src=<provided-ca-file>`, and pass Docker’s predefined proxy build arguments when needed. The mount exists only for the dependency-install step; do not copy certificates, proxy credentials, API keys, or `.env` into the image. Keep npm, TLS, and Prisma checksum verification enabled. The Codex cloud build also required a writable Docker config directory and an explicit host mapping for its supplied proxy. These machine-specific settings are not required Railway variables.
