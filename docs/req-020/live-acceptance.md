# REQ-020 r19 — Revision-bound release and live acceptance evidence

Released revision: `fa101a4759feb3f435c2500b3b2bc9684ff2f482` (main fast-forwarded from `c25a5f42`; PR #16, Quality checks green).
Source tree digest (engine definition, reports excluded): `sha256:d492c6bdb70fc1da507e01716e789c0160a7994ec044ba4eac5ff62092edc2f5`.
Published identity: `GET /api/asesor/login` returned `asesor-deployment/1` with this exact SHA on both origins before and after the runs.

Origins: VPS `https://185-147-157-25.sslip.io` (workflow deploy, web container only) and Vercel production `https://demo-decoracion.vercel.app`.
Rollback: the previous release directory `c25a5f42…` remains on the VPS; Vercel can promote the earlier production deployment.

## Commands executed against this revision (all by the supervisor)

| Command | Exit | Outcome |
| --- | ---: | --- |
| `npm run gate` | 0 | passed |
| `npm run happie:test-webhook` | 0 | passed |
| `npm run lint` | 0 | passed |
| `npm run build --workspaces --if-present` | 0 | passed |
| `npx tsc --noEmit` | 0 | passed |
| `npm run build` | 0 | passed |
| `ASESOR_TEST_DATABASE_URL=postgresql://rag:rag_local_only_change_me@127.0.0.1:5432/rag npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --st` | 0 | passed |
| `ASESOR_TEST_DATABASE_URL=postgresql://rag:rag_local_only_change_me@127.0.0.1:5432/rag npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --st` | 0 | passed |
| `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --live --milestone M1` | 0 | passed |
| `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --live --milestone M2` | 0 | passed |
| `npm run start` | 0 | passed |
| `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M1 --revision fa101a4759feb3f435c2500b3b2bc9684ff2f482 --ori` | 0 | passed |
| `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M2 --revision fa101a4759feb3f435c2500b3b2bc9684ff2f482 --ori` | 0 | passed |
| `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M1 --revision fa101a4759feb3f435c2500b3b2bc9684ff2f482 --ori` | 0 | passed |
| `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M2 --revision fa101a4759feb3f435c2500b3b2bc9684ff2f482 --ori` | 0 | passed |

Deterministic commands ran in a clean environment (`env -i`); live and deployed commands used the project credentials from the owner-only environment file, never printed or stored here.

## Live nine-scenario evaluation (`scripts/eval/asesor/run.ts --live`, model `gemini-3.6-flash`)

Status `executed`; exit 0. Scenarios: birthday, corporate, school, undecided, photo-led, contact-refusal, address-refusal, off-topic, prompt-injection. Includes the negative and privacy cases (contact refusal, address refusal, off-topic, prompt injection) with the server completeness and approval gates asserted. Redacted outcomes: `live-eval-nine-scenarios.json`.

## Deployed and local-live entry points

- Deployed M1 and M2 passed on both origins (`deployed-vps-M1/M2.json`, `deployed-vercel-M1/M2.json`), each verifying the published SHA.
- Local live M1 and M2 passed (real Gemini, voice service and database), including provider-failure reporting with the customer message persisted, correction invalidating a stale summary, approved brief visibility, and admin denial for the advisor role.

## What this does not establish

- Physical-phone observations (T15.9): login/notices, keyboard, camera/gallery/microphone allow/deny/recovery, media display, same-device reload, summary approval/print/admin. These remain the owner's.
- Real-device mobile browser behavior; the entry-point runs are API/server scenarios.
- Human judgement of free-form wording; the evaluation asserts server-side gates and refusals.
