# REQ-020 remediation release evidence

## Status: pending owner evidence

No repaired release is authorized or recorded by this task. No deployment command was run, and no physical-phone observation was performed. The release and manual acceptance criterion remains **pending** until David explicitly authorizes the repaired release and supplies redacted, revision-bound evidence for all required live checks and phone observations. The independent verifier must keep this criterion pending until then. Missing or unexecuted checks are unaccepted; failures must be recorded as failures, not omitted or relabeled.

## Evidence required for the repaired release

David/coordinator must attach or identify redacted evidence that binds every result below to the same exact released revision (full 40-character SHA) and deployed origin. Do not include credentials, customer data, conversation bodies, photos, audio, cookies, or screenshots containing customer data.

| Required evidence | Status | Evidence / revision |
| --- | --- | --- |
| David's explicit authorization to release the repaired revision, with release date and exact full SHA | Pending | Not supplied |
| Fresh deployed M1 acceptance against that SHA | Pending | Not supplied |
| Fresh deployed M2 acceptance against that SHA | Pending | Not supplied |
| Full real-model nine-scenario evaluation against the repaired/released revision | Pending | Not supplied |
| Negative-path matrix, with each result and failure recorded | Pending | Not supplied |
| Privacy checks, with redacted result evidence | Pending | Not supplied |
| Provider-failure and retry checks, including duplicate/idempotency outcome | Pending | Not supplied |

The live evidence must use the real model and must identify all nine scenario IDs and their pass/fail outcomes. Fake-model or local deterministic evaluation does not satisfy the real-model matrix. Deployed M1 and M2 receipts must freshly verify the deployed SHA; older receipts do not transfer to the repaired revision.

## Physical-phone observations required

David must provide pass/fail observations from a physical phone against the same authorized repaired deployment. Bind the observations to its exact full SHA and record failures as failures. All rows remain pending until real observations are supplied.

| Observation | Status | Result / redacted evidence |
| --- | --- | --- |
| Login succeeds on the phone | Pending | Not supplied |
| Notices and recoverable error states are visible and understandable | Pending | Not supplied |
| Mobile keyboard remains usable and does not block the composer or sending | Pending | Not supplied |
| Camera permission: allow, capture, media display, and recovery after retry | Pending | Not supplied |
| Camera permission: deny, recoverable notice, then retry after permission is granted | Pending | Not supplied |
| Gallery permission: allow, selection, media display, and recovery after retry | Pending | Not supplied |
| Gallery permission: deny, recoverable notice, then retry after permission is granted | Pending | Not supplied |
| Microphone permission: allow, voice-note capture and transcription, and recovery after retry | Pending | Not supplied |
| Microphone permission: deny, recoverable notice, then retry after permission is granted | Pending | Not supplied |
| Captured/selected media displays correctly and remains available after same-device reload | Pending | Not supplied |
| Same-device reload restores the conversation and its media | Pending | Not supplied |
| Summary approval reflects the current corrected summary | Pending | Not supplied |
| Approved summary can be printed | Pending | Not supplied |
| Admin can see the approved summary and relevant accepted media | Pending | Not supplied |

Record only the SHA, pass/fail outcome, and minimal redacted supporting reference. Do not attach sensitive screenshots or real customer content.

## Historical evidence preserved, not applicable to repaired release

Existing records retain their original provenance and must not be rewritten or reused as evidence for the repaired release:

- `docs/req-020/remediation-readiness.md` records local deterministic checks on source revision `599a56ef3a2864c601396afd023042c846ab8b05`; its real-model and physical-phone items remain pending.
- `docs/req-020/integration-results.json` records historical T14a local live M1/M2 on revision `edc2fcd26404db8da426529dec0d7f5841a236c0`, receipt `sha256:56f81d7d1cba375a911244c6d621a61b32574cb9e984a04e6adc917d26e9ec30`.
- The same integration record identifies historical deployed M1/M2 on revision `c25a5f42fc9727b84f454f166e08348521cca6ad`. These receipts are not fresh acceptance for the repaired revision.
- `docs/req-020/remediation-evaluation.md` describes the live matrix and its runtime prerequisites. No results are added here because none were supplied for this task.

These historical results remain intact. They do not establish repaired release authorization, repaired-revision deployment, current live acceptance, or phone acceptance.

## Acceptance decision

**Pending.** Do not mark T15.6's manual criterion accepted until the owner-authorized repaired release, fresh deployed M1/M2, complete real-model nine-scenario/negative/privacy/provider-retry evidence, and all physical-phone observations above are supplied and independently verified against the same released revision. This document records the evidence required; it is not itself evidence that release or acceptance occurred.
