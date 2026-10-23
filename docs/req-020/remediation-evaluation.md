# REQ-020 remediation evaluation

The deterministic evaluation uses fake `ChatPort` and catalogue/direction ports. It verifies server-owned consent and approval gates, privacy redaction, scenario inventory, offer provenance, fallback freshness and retry idempotence. Its results do not describe Gemini behavior, a deployed revision, production data or physical-phone acceptance.

`advisor-evaluation/1` artifacts contain only the mode, selected model label, scenario IDs and invariant labels. With `--fake-model`, `liveEvaluation.status` is `pending` and includes the exact command to run the real-model evaluation. Do not replace that status with a pass based on deterministic ports.

## Full live matrix

Run these commands from the repaired snapshot after its checks pass and the coordinator has supplied the required runtime configuration through the environment or ignored local env files. Local M1/M2 create conversations and must use a dedicated disposable or staging advisor database. Deployed M1/M2 also create data; target an explicitly approved staging deployment, never production by default. Keep generated evidence outside production and redact it before sharing.

```sh
npx tsx --conditions=react-server scripts/eval/asesor/run.ts --live
npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --live --milestone M1 --task T15
npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --live --milestone M2 --task T15
npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M1 --revision "$ASESOR_E2E_DEPLOYED_REVISION" --origin "$ASESOR_E2E_DEPLOYED_URL"
npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --live --deployed --milestone M2 --revision "$ASESOR_E2E_DEPLOYED_REVISION" --origin "$ASESOR_E2E_DEPLOYED_URL"
```

The live nine-scenario evaluation requires `GEMINI_API_KEY`. Local M1 additionally requires the advisor database and E2E account/session configuration; local M2 also requires the configured voice service and an approved audio fixture. Deployed M1/M2 require the exact deployed URL and 40-character revision plus E2E user/admin credentials; M2 requires the audio fixture. Do not put credential values in this report or in evaluation artifacts.

Still pending after these automated runs: owner-confirmed release/deployment evidence for this repaired revision and physical-phone acceptance. A successful local live run cannot close either item.
