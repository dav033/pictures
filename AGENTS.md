<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Engineering rules

These rules apply throughout this repository. Keep the generated Next.js block above intact. `AGENTS.md` is the canonical project instruction file; `CLAUDE.md` imports it. Keep project rules in English and user-facing communication in Spanish unless requested otherwise. Personal instructions remain in the user's configuration, not in machine-specific project paths.

## Working discipline

- Inspect the affected code, its consumers, and `git status` before editing. Preserve unrelated local changes. Keep diffs focused on the requested outcome.
- Prioritize correctness, security, clarity, and measured performance. Do not claim that a language migration or a new abstraction inherently improves quality.
- Fix the cause of a defect. Avoid broad rewrites, speculative frameworks, generic repositories, base classes, or microservices without a concrete need.
- Do not hide existing failures, weaken tests, or disable checks to make a change appear successful. Separate pre-existing debt from regressions.
- Apply rules to new and changed behavior. For legacy violations, prevent additional debt and document a bounded migration; do not require a full rewrite for a small fix.

## Architecture and ownership

- Separate transport, application use cases, domain rules, and infrastructure. Domain logic must not depend on React, HTTP handlers, provider SDKs, environment variables, or database clients.
- HTTP handlers authenticate, authorize, validate, invoke a use case, and translate results. Keep SQL, commercial calculations, and extensive prompt construction outside handlers.
- Give every business rule one authoritative owner. During the Python migration, use explicit temporary adapters instead of independently maintaining equivalent rules in two languages.
- Introduce interfaces at external boundaries or demonstrated substitution points. Keep internal code direct when an interface adds no value.
- Packages expose deliberate public APIs. Do not import another package's internals or import application `src` code from `packages`.
- Keep database transactions short; never hold them open while waiting for an AI provider. Define transaction boundaries around business operations.
- Record significant architectural decisions under `docs/architecture/decisions/`: problem, decision, relevant alternatives, consequences, and rollback. Do not create a decision record for routine edits.

## Contracts and type safety

- Validate external data at runtime: complete HTTP payloads, webhooks, files, provider responses, and tool arguments/results. Treat unvalidated values as `unknown`. Type annotations and casts are not validation.
- Return deliberate client errors for malformed JSON and invalid input. Define stable error codes without exposing stack traces or internal configuration.
- Preserve TypeScript `strict`. Do not introduce `any`, `@ts-ignore`, broad lint suppressions, or unchecked casts to bypass a boundary. A necessary exception must be narrow and explain its reason and removal condition; use explained `@ts-expect-error` where appropriate.
- Version shared contracts and schema changes. Identify consumers, compatibility requirements, and rollback before replacing a contract.
- For Python transport contracts, prefer a maintained schema and generated TypeScript client/types over manually duplicated schemas.
- Define money representation, rounding, physical units, and quantities explicitly. Catalog data, not model output, is authoritative for products, prices, and availability.

## Security and failure handling

- Authenticate callers and authorize access to each resource. Do not trust a user identifier supplied by the browser. Verify identity across the Next.js/Python boundary.
- Required authentication configuration must fail closed in production. Any permissive development mode must be explicit.
- Validate file size/type and remote fetch destinations where applicable. Keep secrets and server-only code out of client bundles.
- Do not log secrets, full conversations, or complete images by default. Prefer correlation identifiers and minimal operational metadata.
- Do not swallow exceptions or return fabricated success. Fallback behavior must be intentional, observable, and tested.
- External operations need deadlines and bounded concurrency. Retry only recoverable failures when effects are idempotent or can be reconciled. A timeout does not prove the provider did not execute the request.

## AI and the Python migration

- Preserve existing catalog restrictions, plan approvals, material calculations, LoRA compatibility, and commercial provenance checks when moving code.
- Keep FastAPI handlers separate from agent orchestration and domain rules. Do not block the event loop with CPU-heavy work or synchronous clients.
- Use explicit allowed tool registries, validated inputs, permissions, and bounded execution steps. Model output cannot grant permissions or authorize operations.
- Define streaming event contracts, terminal events, error behavior, and disconnect handling. Do not restart an execution automatically after partial output if it can duplicate effects or charges.
- Long-running work needs durable state, idempotency, bounded workers, and restart recovery. In-memory background tasks are not a durable job system.
- Persist external request identifiers when available. Distinguish local cancellation from confirmed provider cancellation.
- Track request/trace identifiers, provider, model, prompt version, and reported usage. Label estimated usage as estimated.
- Reuse existing Python dataset scripts where appropriate. Lock dependencies and document runtime versions when introducing the service.
- Keep each migration slice independently testable and reversible. Do not remove the legacy path until consumer compatibility and data rollback have been verified.

## Frontend design

- Organize components by user responsibility and state ownership. Separate presentation from coordination when it reduces coupling.
- Avoid duplicating derived state. Distinguish remote data from transient UI state and model loading, empty, error, success, and concurrent operations explicitly.
- Use semantic controls, accessible labels, keyboard navigation, and visible focus. Reuse established components before adding variants.
- Add memoization, caching, or render optimizations only for a demonstrated problem. Measure relevant latency, bundle size, or rendering behavior.

## Maintainability and repository hygiene

- Split code by responsibility and reason to change, not to satisfy an arbitrary line count.
- Review new or substantially expanded logic files above 400 lines, functions above 80 lines, or cyclomatic complexity above 10 for extraction opportunities. These are review triggers, not automatic rejection thresholds. Exclude generated data; explain justified exceptions.
- Separate executable logic, generated data, fixtures, and runtime artifacts. A clean checkout must not silently depend on ignored local files.
- Keep scripts import-safe: separate CLI entry points from reusable logic. Data-changing scripts validate targets and arguments, support preview when practical, and document rerun/recovery behavior.
- Do not delete files solely by name or age. Check references and purpose first.
- Temporary compatibility code and rule exceptions need a reason, bounded scope, and removal condition. Avoid silent permanent exceptions.

## Verification and completion

- Add meaningful behavior or regression tests for changed domain rules, defects, permissions, and contracts. Do not test implementation details merely to increase test counts.
- Keep required fast tests independent of paid providers and production credentials. Database integration tests use disposable databases and controlled fixtures.
- Separate deterministic AI invariants from probabilistic quality evaluations. Version evaluation inputs, prompts, and models. Do not assert exact free-form model wording.
- For relevant TypeScript changes, run `npm run lint`, build the workspace packages with `npm run build --workspaces --if-present`, and check application types with `npx tsc --noEmit`. Run builds before type checks when package declarations are needed. These are existing commands, not proof that CI enforces them.
- Run the affected existing test scripts from `package.json`. Include `npm run build` for application integration or deployment changes. Follow repository command-wrapper instructions where applicable.
- Python code must have reproducible lint/format, type-checking, and test commands when introduced; do not document nonexistent commands as functioning checks.
- Documentation-only changes need review and whitespace/link checks, not unrelated application test runs.
- Performance changes require a reproducible scenario and before/after evidence. Set budgets from requirements and a measured baseline, not invented numbers.
- Report what changed, which checks actually ran, their outcomes, and remaining limitations. Never call blocked or unexecuted checks passing.

## Enforcing these rules

- Instructions do not replace automation. When implementing quality infrastructure, add PR checks for lint, application/package types, relevant tests, and build; deploy only the same revision that passed the required checks.
- Enforce layer boundaries with scoped import rules and additional cycle/dynamic-import checks where needed. Roll stricter checks into legacy code with an explicit baseline rather than mass suppressions.
- Verify the remote deployment script and branch protections before claiming deployment is gated. Document controls as pending until implemented and tested.
- Keep this file authoritative. Add scoped `AGENTS.md` files only for genuinely distinct rules, without duplicating or contradicting root instructions.

## Domain ownership and operational rules (consolidated 2026-09-16)

These were spread across ADRs and plan documents that no longer exist. They are
rules, not history: breaking one has caused a production-visible failure before.

### Python owns the commercial rules

`services/ai-api/app/plan.py` is the single owner of counting, measurements,
material estimation and quoting. TypeScript must not reimplement, recompute or
"verify" any of it by recalculating. It maps, validates the boundary and decides
policy (what to do with a plan), never the numbers.

- There is no TypeScript resolver and no backend selector. `resolverPlan` in
  `src/lib/plan/resolver-backend.ts` is the only door. Recovery is deploying the
  previous revision of the app and `ai-api` together, not an environment
  variable.
- A boundary gate validates what a schema cannot express. It never re-derives a
  business formula to compare it: that creates a second owner. `validateMaterialEstimate`
  used to recompute fourteen totals and cost a failed proposal and a morning of
  diagnosis when the two definitions drifted apart.
- The mix table, standard diameters, substitution cap and mandatory-size regex
  have one owner, `src/lib/plan/mezclas.ts`, exported into `plan-decoracion.v1`
  as `x-reglas-mezclas` (the `x-geometria-estructuras-oficiales` pattern);
  `plan.py` reads them from there. Only the two-line shape of
  `sustitucionAdmisible` (adjacent step, ratio cap) exists in both languages,
  and `services/ai-api/tests/test_reglas_mezclas.py` requires Python to match
  the exported `sustituciones_admisibles` table pair by pair. Change a value in
  `mezclas.ts`, then regenerate the contract and the models.

### Contracts change in one direction

Zod schema in `src/lib/ia/contracts/domain-v1.ts` → `npm run contracts:export:domain`
→ `uv run --directory services/ai-api python scripts/generate_models.py` →
regenerate the golden vectors. Never the other way: a field added only to Python
is rejected by `additionalProperties: false`, and a field added only to the
contract makes a running service's responses invalid.

Anything added inside `estructuras` or `compras` changes `plan_hash`, because the
canonical JSON is `{plan, snapshot}` and the snapshot carries them. Derived data
for the UI goes outside the snapshot, or every approved plan in flight breaks.

### Golden vectors

`contracts/domain/v1/golden/plan-resolution/*.json` lock the resolver's numbers.
`expected_python` belongs to the resolver and regenerates with
`REGRESION_ACTUALIZAR=1 pytest tests/test_plan_regresion.py`. `expected` is a
frozen oracle: it is edited by hand, deliberately, and the commit says why.

Never regenerate an expectation from the implementation under test to make a
suite pass. That turns the suite into a mirror that would accept any behaviour,
including a broken one. This repo had exactly that for months through an
`--update` flag.

### Running locally

```
cd services/ai-api && uv run --system-certs --env-file ../../.env.local \
  uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
PORT=3010 npm run dev
```

`--reload` is not optional. Without it uvicorn keeps serving the `plan.py` it
loaded at startup; this caused two separate production-visible failures on
2026-09-16, hours apart. Do not use `set -a; . ../../.env.local`: `APP_PASSWORD`
has unquoted metacharacters and the shell fails without exporting anything.

Verification before calling anything done:

```
npx tsc --noEmit && npm run -s lint && npm run plan:test
uv run --directory services/ai-api pytest -q
uv run --directory services/ai-api ruff check app tests && mypy app
```

### Evaluation runs against paid providers

- A run declares a spending cap up front and stops at it; the runner supports
  preview, budget, concurrency, deadline and resume.
- Telemetry is disabled during evaluation runs so they do not pollute production
  series.
- No images, no absolute paths and no customer data enter the repository.
  Evaluation inputs live outside it.
- Estimated cost is labelled estimated. Reported usage comes from the provider.
- Anything a loop cannot decide alone — licensing, spending beyond the cap,
  taxonomy changes, promoting a prompt variant — goes to a person.

### Standing decisions

- Structure taxonomy is **12 classes**: dense/non-dense variants and plain
  `semiarco` were retired; every half-arch is organic. Parts of `docs/` that said
  16 were deleted rather than corrected.
- The reference analysis prompt for production is byte-frozen. Candidate variants
  append their rules only on request so the production hash and its cache key stay
  identical. Changing it invalidates the evaluation baseline.
- Scenery (non-balloon elements detected in the customer's photo) enters the image
  prompt and nothing else. The plan owns what is built and charged; scenery is
  what is preserved from the photo. It never touches quoting, materials or
  `plan_hash`.
