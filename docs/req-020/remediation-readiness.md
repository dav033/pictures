# REQ-020 repaired-tree readiness

## Scope and provenance

This report records local deterministic readiness checks for the repaired source containing T15.3/T15.4. It is not a release decision or acceptance of pending live, deployment, or physical-phone checks.

- Tested source revision: `599a56ef3a2864c601396afd023042c846ab8b05`.
- Tested source Git tree: `37e45525462ae70de2a276f332be521c51e1ab7e`.
- The commands below ran against that checkout. This report was added afterward; the final worktree is that source snapshot plus this report. No source changes were made by the checks.
- Historical local-live evidence is recorded in `integration-results.json` for revision `edc2fcd26404db8da426529dec0d7f5841a236c0` / task T14a, not for the tested repaired tree. The same historical receipt digest appears for M1 and M2: `sha256:56f81d7d1cba375a911244c6d621a61b32574cb9e984a04e6adc917d26e9ec30`.
- The task identifies the immutable historical file as `bitacora/pictures/artifacts/req020-supervisor-root-cause/local-live-receipt.json` and reports that the supervisor restored its original bytes at 13:18 with that SHA-256. That artifact path is absent from this worktree, so its bytes could not be independently re-hashed here. The digest agrees with the historical M1/M2 receipt references in `integration-results.json`; this reconciliation does not extend those receipts to the repaired tree.
- Historical deployed M1/M2 evidence remains bound to `c25a5f42fc9727b84f454f166e08348521cca6ad` in `integration-results.json`. It is historical only and does not establish that the repaired source was deployed.

## Local checks

These are the exact required commands and outcomes on the tested source revision. Artifact references point to the redacted summaries in this section; raw console output is not persisted here. The summaries omit generated correlation IDs. There are no claims about Gemini, production data, a deployment, or a physical phone from these deterministic checks.

| Exact command | Exit code | Redacted artifact reference / result |
| --- | ---: | --- |
| `test -s docs/req-020/remediation-readiness.md` | 0 | `remediation-readiness.md` — report exists and is non-empty. |
| `npx tsx scripts/e2e/asesor/ui-remediation.ts` | 0 | `remediation-readiness.md#local-checks` — browser flow passed: camera/gallery controls, authenticated photo retry, SSE cards and summary, correction invalidation, brief link, reload restore. |
| `npx tsx --conditions=react-server scripts/eval/asesor/run.ts --fake-model` | 0 | `remediation-readiness.md#local-checks` — `advisor-evaluation/1`, fake model; all nine required scenario IDs completed; `liveEvaluation.status` is `pending`. |
| `npm run happie:test-webhook` | 0 | `remediation-readiness.md#local-checks` — package build and webhook/control/panel/package checks passed; node test totals: 27 passed, 0 failed. |

Prerequisites needed to run those exact commands in this checkout:

| Exact command | Exit code | Result |
| --- | ---: | --- |
| `npm ci --offline` | 0 | Installed locked dependencies locally; no registry access. |
| `npm run build --workspace=@sempertex/agente-core` | 0 | Produced the workspace package `dist` required by the webhook suite. |

The first UI invocation before dependency installation exited 1 (`Cannot find module 'esbuild'`). The first webhook-suite invocation before building its workspace dependency exited 1 (`@sempertex/agente-core/dist/index.js` missing). Both required commands passed after the prerequisites above; these initial environment setup failures are retained here for provenance.

## Pending coordinator run: live nine-scenario evaluation

Run from the repaired checkout after providing `GEMINI_API_KEY` through the coordinator's approved secret/environment mechanism. Do not put credential values in this report or its artifacts.

```sh
npx tsx --conditions=react-server scripts/eval/asesor/run.ts --live
```

This is the real-model nine-scenario evaluation. Its result must be recorded against the exact source revision/tree and redacted. It is still pending; the fake-model run above does not satisfy it. Live database-backed local M1/M2 and deployed M1/M2 checks are separate checks, with prerequisites and staging constraints described in `remediation-evaluation.md`.

## Owner release, deployed, and physical-phone checklist

These steps remain pending and owner/coordinator-only. Repaired source has not been released by this task.

- [ ] Decide and authorize whether to release the repaired source. No deployment, production write, or release was performed here.
- [ ] Complete the live nine-scenario coordinator command above and preserve its redacted receipt tied to the tested repaired revision/tree.
- [ ] If database-backed local M1/M2 checks are required, use a dedicated disposable or staging advisor database, the required E2E account/session configuration, configured voice service, and approved audio fixture. Do not target production by default.
- [ ] If deployed M1/M2 checks are authorized, first deploy the tested repaired revision to an explicitly approved staging target, then run the existing deployed coordinator commands with that exact 40-character deployed revision and origin:

  ```sh
  npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M1 --revision "$ASESOR_E2E_DEPLOYED_REVISION" --origin "$ASESOR_E2E_DEPLOYED_URL"
  npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M2 --revision "$ASESOR_E2E_DEPLOYED_REVISION" --origin "$ASESOR_E2E_DEPLOYED_URL"
  ```

- [ ] Record redacted deployed M1/M2 outcomes and their exact deployed revision. Do not reuse the historical `c25a5f42fc9727b84f454f166e08348521cca6ad` receipts as evidence for the repaired revision.
- [ ] On a physical phone against the explicitly approved tested deployment, verify login; camera/gallery permission and retry; microphone permission and real voice-note transcription; keyboard visibility; same-device reload; correction and summary approval invalidation; and approved-brief visibility to the admin. Record only pass/fail observations and the deployed SHA, with no customer data or sensitive screenshots.
- [ ] Owner reviews the evidence and makes the release/acceptance decision. Passing local checks or live evaluation alone does not close deployment or physical-phone acceptance.

## Readiness status

Local deterministic UI, fake-model evaluation, and webhook regression checks passed on the identified source tree. Historical local-live and deployed receipts retain their original provenance and do not cover this tree. Live evaluation, any authorized staging deployment checks, physical-phone observations, and owner release/acceptance remain pending.
