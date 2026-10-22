# REQ-020 M2 deployment record

## Release configuration

Deploy only the revision that passed the full gate, lint, workspace build, application type check, production build, and offline M2 scenario. Pin the deployed release to that exact SHA. The M2 voice flow uses the existing `/api/voz/transcribir` endpoint and the `voz-decoracion` service; configure these server-side variables in the production app environment:

| Variable | Required setting |
| --- | --- |
| `VOZ_ENABLED` | `true` |
| `VOZ_URL` | Private or TLS endpoint reachable from the app runtime |
| `VOZ_SECRETO` | Shared signing secret matching the voice service |

Keep values in the production secret manager. Do not place them in source, deployment manifests, client variables, logs, or this record. Preserve the prior deployment for rollback. A voice-service or phone failure returns to the relevant T8/T9 owner; do not patch photo or dictation source behavior as part of this deployment task.

## Checks

Run from the release candidate:

```sh
npm run gate
npm run lint
npm run build --workspaces --if-present
npx tsc --noEmit
npm run build
ASESOR_TEST_DATABASE_URL=postgresql://rag:rag_local_only_change_me@127.0.0.1:5432/rag npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --fake-model --milestone M2
```

The fake-model scenario uses the local disposable Postgres only and does not call AI providers. The live coordinator check uses the production-equivalent `.env.local` outside the repository:

```sh
npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --live --milestone M2
```

Do not copy `.env.local` into a release artifact or include it in evidence. Record the deployed SHA, deployment URL, check names and pass/fail outcomes, and migration outcome; omit secret values and customer data.

## Phone acceptance record

Complete after deploying the tested SHA on a phone viewport. Use a synthetic event and non-customer media. Record only outcomes and the SHA:

| Observation | Result |
| --- | --- |
| Camera permission granted; capture uploads and remains available after same-device reload | Pending coordinator check |
| Gallery permission granted; selected photo remains available after reload | Pending coordinator check |
| Original received photo is retained; model analysis does not replace the stored original | Pending coordinator check |
| Microphone permission granted; a real voice note transcribes into a normal customer text message | Pending coordinator check |
| Voice transcript and uploaded photo survive reload and appear in the admin conversation/approved brief | Pending coordinator check |
| Correcting a summarized field invalidates approval; corrected brief can be approved and is shown in admin | Pending coordinator check |
| Denied camera/microphone permission shows a recoverable state; retry after granting permission succeeds | Pending coordinator check |
| Provider/network failure preserves the conversation and offers retry without duplicating the accepted turn | Pending coordinator check |
| Mobile keyboard does not cover the composer or prevent sending | Pending coordinator check |

Attach redacted evidence only: check output, SHA, and pass/fail observations. Do not include conversation text, names, contact details, photos, audio, cookies, or screenshots containing customer data.

## Execution status

- Worktree source starts from the integrated T13 revision; no T13 files were replaced.
- Initial gate reproduced the strict inventory failure for `src/app/api/asesor/photos/route.ts` and `src/app/api/asesor/photos/[id]/route.ts`. Both routes are classified as advisor-owned personal-data storage/read paths in `scripts/test/test-guardia-proveedores-ia.ts`; the gate remains strict.
- `npm run gate` passed, including the advisor suite (34/34), the strict route inventory (0 unclassified), and all other gate stages.
- `npm run lint` passed with 0 errors and 50 warnings. `npm run build --workspaces --if-present`, `npx tsc --noEmit`, and `npm run build` passed.
- Offline M2 passed with four scenario checks. The prescribed port `127.0.0.1:5432` was occupied by `pictures-postgres-1`, backed by persistent `pictures_rag_postgres_data`; that database was left untouched. The fake scenario instead used a dedicated disposable Postgres container on `127.0.0.1:15432`, then stopped it. The runner report was written to `/tmp/att-0069-m2-integration-results.json`.
- Checks ran on base commit `50de19e9f0049a5ed591406aa588611393385879` with the two route-classification changes in the worktree. No release SHA has been assigned to that uncommitted worktree delta.
- Production deployment, live Gemini/Supabase E2E, and physical phone permission/keyboard checks are coordinator-run and remain pending here. This record does not claim those checks passed.
