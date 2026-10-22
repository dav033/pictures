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
- The previous strict-inventory failure concerned the advisor photo routes. They are classified in `scripts/test/test-guardia-proveedores-ia.ts` as advisor-owned personal-data storage/read paths, and the existing `/api/voz/transcribir` route is inventoried as the voice provider flow. The strict gate remains enabled.
- `npm run gate` passed on `6288772f262a2336374d5b083fedbc68d1eb694e`; its strict route inventory reported `0 rutas sin clasificar`, and the advisor suite passed 34/34.
- `npm run lint` passed with 0 errors and 50 warnings. `npm run build --workspaces --if-present`, `npx tsc --noEmit`, and `npm run build` all passed on the same source revision.
- The offline M2 scenario passed all four scenario checks in fake-model mode on revision `6288772f262a2336374d5b083fedbc68d1eb694e`. The runner also passed its workspace build, production build, and two advisor migrations against the test schema. Port `127.0.0.1:5432` was occupied by `pictures-postgres-1`, backed by the persistent `pictures_rag_postgres_data` volume; it was left untouched. The scenario instead used a dedicated disposable Postgres container at `127.0.0.1:15432`, which was stopped after the run. The runner's local JSON report is ignored and is not part of the release artifact.
- No source changes were needed for this rework: the route classifications are already present in the preserved snapshot, and the strict gate passes. The recorded revision is the tested source commit; no deployment SHA has been assigned.
- Production deployment with `VOZ_ENABLED=true`, `VOZ_URL`, and `VOZ_SECRETO`, live Gemini/Supabase E2E, and physical phone camera/microphone permission, retry, keyboard, reload, and admin observations remain coordinator-run and pending. This record does not claim the live deployment or phone acceptance passed.
