# REQ-020 M1 deployment

This deployment enables the advisor's text flow. Keep credentials in each provider's encrypted environment settings or the VPS secret store; never commit them or put them in `NEXT_PUBLIC_*` variables.

## Required runtime variables

Configure the same names on Vercel Production and the VPS service:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_DB_URL` | Supabase Postgres transaction-pooler DSN for the advisor schema. It is separate from `DATABASE_URL` and must use TLS. |
| `ASESOR_SESSION_SECRET` | Random signing key with at least 32 characters. Rotate it to invalidate all advisor sessions. |
| `ASESOR_USER_PASSWORD_HASH` | Scrypt hash for the `user` role, generated with `npm run asesor:seed` or the existing password-hash tooling. |
| `ASESOR_ADMIN_PASSWORD_HASH` | Scrypt hash for the `admin` role. Store the corresponding password outside the repository. |
| `GEMINI_API_KEY` | Server-only key used by the advisor's Gemini text conversation. |
| `HAPPIA_API_BASE_URL` | Base URL of the Happia API. The advisor reads packages and services from it on every package or direction request. |
| `HAPPIA_API_KEY` | Server-only key for the Happia API. Never log it or expose it to the client. |

The Happia catalogue has no tables: nothing is cached, seeded or migrated, and an unreachable, unconfigured or invalid Happia API makes the advisor offer no package and no catalogue price (`not_configured`, `request_failed` or `invalid_response`). Both variables are required on Vercel Production and in `/etc/demo-decoracion/demo.env`.

`ASESOR_E2E_USER_PASSWORD`, `ASESOR_E2E_ADMIN_PASSWORD`, `ASESOR_TEST_DATABASE_URL`, `ASESOR_E2E_FAKE_MODEL`, and `ASESOR_E2E_PROVIDER_FAILURE_TOKEN` are acceptance-test inputs only. Do not configure them in Vercel or the VPS service. The local runner creates its fake credentials and failure token in memory; the live runner reads its E2E passwords from the coordinator's environment and does not print them.

For deployed acceptance, run `scripts/e2e/asesor/run.ts --live --deployed --milestone M1` (then M2) with `ASESOR_E2E_DEPLOYED_URL`, `ASESOR_E2E_DEPLOYED_REVISION` (the exact published SHA), and the coordinator's E2E passwords. M2 also needs `ASESOR_E2E_AUDIO_FILE`. `--milestone M3` (with `--task`) reads the live Happia catalogue locally (so it also needs `HAPPIA_API_BASE_URL`/`HAPPIA_API_KEY`) and asserts a birthday conversation receives a standard package card sourced from `happia_api`; `scripts/test/asesor/catalogue-live.ts` is the stand-alone live read and `scripts/e2e/asesor/check-release.ts <dir> --task <id>` validates the release bundle. This mode sends requests to the published origin and never builds or starts a local server. A redirect from `/asesor/login` fails before any password is sent. Local provider-failure injection remains a local-only check; deployed reports enumerate only the checks actually performed.
The deployed runner reads `GET /api/asesor/login` (`asesor-deployment/1`) before and after the scenario and requires its full release SHA to match the requested revision. Unknown identity fails closed. This GET exposes no credentials; POST authentication is unchanged. Deployed reports use the distinct `deployed-integration-results/1` contract and are accepted by `--check-results`; local `integration-results/1` retains its build/start requirements. Reverting the GET/report support disables deployed verification until both sides are rolled forward together; it does not authorize bypassing identity verification.

## Release gate and revision pinning

Run every gate on one commit and deploy that exact commit or immutable build artifact:

```sh
npm run gate
npm run happie:test-webhook
npm run lint
npm run build --workspaces --if-present
npx tsc --noEmit
npm run build
```

After these checks pass, configure the required runtime variables, apply the advisor migration to the intended Supabase project with `npm run asesor:migrate`, and deploy the same SHA. Do not rebuild from a different branch or commit between verification and deployment. Keep the SHA, check outcomes, migration result, and deployment URL in the release record. Run the M1 acceptance command with the live credentials before opening the advisor to users.

## Vercel

Add the five required runtime variables under the Production environment for the advisor's Vercel project. Use the project's encrypted environment-variable controls; do not place values in `vercel.json`, build arguments, or repository files. Set the project build command to `npm run build --workspaces --if-present && npm run build` so clean checkouts compile package outputs before Next. Deploy the verified SHA as a production deployment and retain the previous production deployment until M1 observation is complete. Vercel deployments are immutable, so rollback by promoting the prior deployment for the same project and environment; do not rebuild an older branch to roll back.

The application uses the Vercel Node.js runtime and dynamic Route Handlers. Do not configure a static export for this application.
The local `--start` acceptance runner builds with `VERCEL=1`, matching this runtime so `npm run start` uses the supported `next start` path.

## VPS

Store the same five variables in `/etc/demo-decoracion/demo.env` or the VPS secret manager; `compose.vps.yml` reads that file. Check out the verified SHA into a versioned release directory and build its `Dockerfile`, which builds both workspace packages before Next and runs the generated standalone `server.js`. Keep an immutable image tag containing each release SHA; the existing Compose service uses `demo-decoracion:current`, so point that tag at the verified SHA image immediately before switching the service behind the existing TLS reverse proxy. Preserve the previous SHA-tagged image; rollback points `current` back to that exact artifact and restarts the service. Do not run `npm run start` for the standalone build: Next.js warns that `next start` is unsupported with `output: standalone`. The service must restart on failure and must not print environment values.

Keep the active release as a symlink or equivalent pointer to an immutable SHA directory. Roll back by switching the pointer to the last verified release and restarting the service with its matching environment configuration. Keep the prior release and environment available until the new revision has passed the phone observations below.

## Database and rollback

Run `npm run asesor:migrate` against `SUPABASE_DB_URL` before switching traffic. The migration runner serializes changes, checks stored checksums, and never uses `DATABASE_URL` for this schema. Take the database backup required by the existing Supabase operating procedure before applying production migrations. For application rollback, restore the previous deployment/release and keep the additive advisor schema in place; do not drop or reverse tables while a prior application revision may still be running. Any destructive schema rollback needs its own reviewed migration and data recovery plan.

## M1 observation

After deployment, use a phone to verify login, keyboard visibility, same-device reload, correction of a summary, and admin visibility of an approved brief. Record only pass/fail observations and the release SHA; do not record customer names, contact details, conversation bodies, credentials, or screenshots containing customer data. M1 is not ready for release if the gate, webhook regression, lint, workspace build, type check, production build, live Gemini/Supabase acceptance, or phone observation is missing or failed.

## Audit evidence

The live runner writes `integration-results/1` with its invocation, SHA, task, per-command outcomes, and required M1 scenario checks. The findings file uses `audit-findings/1`, for example:

```json
{
  "schema": "audit-findings/1",
  "revision": "<full 40-character SHA>",
  "taskReferences": ["T7"],
  "findings": [
    { "id": "OBS-1", "severity": "medium", "status": "closed", "taskReferences": ["T7"] }
  ]
}
```

The top-level task list and each finding accept either `taskReferences` or `tasks`; statuses are `open`, `closed`, `fixed` (equivalent to `closed`), and `accepted`. Severities are `critical`, `high`, `medium`, `low`, and `info`.

Run `npx tsx --conditions=react-server scripts/e2e/asesor/check-findings.ts --findings <report> --results <integration-results> --task T7 --known-tasks T7 --revision <SHA> --ledger <ledger> --audit-root <audit-directory> --check-audit-diff` after the independent audit writes its report and ledger. The checker requires live M1 evidence, verifies task/revision/command/outcome linkage and every required scenario step, rejects open critical/high findings and malformed or missing task references, and rejects tracked or untracked audit edits outside the specified findings report and ledger when Git is available. It reports open critical/high findings and their producer tasks before revision or integration outcome mismatches so the blocking product work is actionable. Closed findings still require the ledger, integration evidence and expected revision to match. It also accepts the audit report as the first positional argument and `--integration-results` as an alias for `--results`; integration evidence may use either `integration-results/1` or `deployed-integration-results/1`. Without explicit paths, the checker uses `docs/req-020/T15.findings.json`, `docs/req-020/integration-results.json`, and `docs/req-020/T15.md` rather than ignored runtime reports. In a clean snapshot without Git, revision falls back to the findings report and must still match integration evidence. The snapshot gate owns the audit edit-boundary check. A report file's existence alone is not evidence of audit success.
