# Plan — Open Customer Intent Against a Closed Catalog

Status: proposed. Date: 2026-08-24.
Supersedes and merges: `PLAN_ALCANCE_CATALOGO_REFERENCIAS.md`, `PLAN_EVENTOS_NO_CLASIFICADOS.md` (both deleted).

## 1. Thesis

Two symptoms, one root cause. The catalog's taxonomy is **closed**; what a customer says or uploads is **open**. Wherever the two meet, the system treats "not in my enum" as either "does not exist" or "force it into an enum value." Both are wrong, and both produce a bad proposal.

| Axis | Closed catalog fact | Open customer input | Current failure |
| --- | --- | --- | --- |
| **Reference elements** | `CATEGORIAS_CATALOGO_V2` — 10 categories (`v2.ts:11`) | Reference blueprint has 12 element categories (`reference-blueprint.ts:96`), incl. `furniture`, `floral`, `lighting`, `plinth` | Model burns its turn budget hunting for a bench and dried pampas; UI reports "no equivalent product" for everything |
| **Events** | `OCASIONES_CATALOGO_V2` — 11 occasions (`v2.ts:75`) | Any celebration: gender reveal, baptism, first communion, corporate, pet party | Unknown event yields no structured occasion; Scene V2 hard-defaults to `wedding` |

Both axes need the **same three-tier ladder** and the **same honesty invariant**:

| Tier | Reference elements | Events |
| --- | --- | --- |
| Exact | `cubierto` — catalog sells this category | `exact_event` — products tagged for this event |
| Adaptable | `emulable` — rebuild the visual function with balloons | `adaptable` — generic products meeting color/style/budget |
| Out of scope | `fuera_de_catalogo` — declare, never fake | `NO_MATCH`, only after exhausting adaptable |

**Honesty invariant (both axes):** never present an adaptation as an exact match, and never silently drop. `referencia_omitida[].motivo_tipo` and `EventMatchEvidence.match_level` are the same concept on two axes — keep their vocabulary aligned.

**Authority rule:** scope and match level are **facts about the catalog**, computed in code. The model may not declare a balloon garland out of catalog, may not invent an occasion filter, and may not propose emulating furniture.

## 2. Verified diagnosis

### 2.1 Shared blocker — per-component decomposition is dead

`src/lib/ia/registro-herramientas.ts:277`:

```ts
const mensaje = estado.solicitudOriginal || (typeof args.mensaje === "string" ? args.mensaje : "");
```

`solicitudOriginal` **always wins**. Every `buscar_catalogo_rag` call in a turn issues the *same* full conversational query, so searching separately for a focal garland vs. a backdrop vs. tableware is impossible. The existing comment states a legitimate reason — stop the LLM from turning a style word like "glamour" into a hard Reflex filter. **The fix must preserve that guarantee**: use `args.mensaje` as retrieval *text*, and extract/lock hard constraints separately from `solicitudOriginal` + brief.

This one line blocks **both** axes. It lands first.

### 2.2 Reference axis

- **Binary contract, no scope.** `validarCoberturaReferencia` (`restricciones.ts:127`) requires every `approved` element to be in `estructuras[].referencia_element_id` ∪ `referencia_omitida`. `referencia_omitida` (`tipos.ts:135`) carries only `{element_id, motivo}` — free text, unverifiable. "I don't sell furniture" is indistinguishable from "I felt like it."
- **One-directional prompt pressure.** `prompt-sistema.ts:62` and `:118` both call omission "deshonesto"; `:58` orders a search *per element* and lists "cortinas/telones… velas… complementos" as if all were viable. The word "deshonesto" appears twice attached to omitting and **zero times** attached to promising a category that does not exist. With `VUELTAS_MAX = 10` (`registro-herramientas.ts:67`), turns are spent on impossible searches.
- **Hard-wired UI false negative.** `ReferenceReviewPanel.tsx:20` renders `labelMatch(decision.match_type)`, but in perceptual mode — the live mode under `PLAN_DECORACION_ENABLED=true` — `match_type` is **forced to `"none"`** (`analizar-referencias-v2.ts:464`). The panel tells the customer **"Sin producto equivalente"** for *every* element, including the balloon garland that is fully buildable.
- **Trap.** The `categoryMap` at `analizar-referencias-v2.ts:387` maps to `"cortina"`, `"mobiliario"`, `"manteleria"`, `"iluminacion"`, `"flores"` — demo-seed vocabulary (`catalog-data.ts:3`) whose categories **do not exist** in the real catalog. That is precisely why the legacy scorer "found" curtains and furniture. **Do not reuse it.**

### 2.3 Event axis

- **Closed occasion filter.** Recognized occasions become exact SQL predicates via `query-parser/deterministic.ts` → `retrieval/search.ts`. "revelacion de genero azul y rosado" keeps its colors but gets no structured occasion.
- **Over-broad FTS.** The FTS branch runs `plainto_tsquery` over the whole conversational request, demanding too many simultaneous terms and dropping products that carry the theme but not the chatter.
- **Wedding default.** `src/lib/scene/tipos.ts:104` is `event_type: z.literal("wedding")` and `query-parser/parse-event.ts:530` defaults to `"wedding"`. An unknown event must never fall back to a wedding.
- **Closed visual cue.** `visual-context.ts:106` sets `eventCue` from a closed detector; unknown events need a safe cue built from the free label.
- **Open data already exists.** Raw catalog tags and descriptions already contain `REVELACION DE GENERO`, `BAUTIZO`, `PRIMERA COMUNION`. Use them instead of discarding them for not being in an enum. `data/captions/dataset-v002-claude.jsonl` is **not** the implementation point.

## 3. Part A — Shared foundation

**A1. Fix retrieval decomposition** (`registro-herramientas.ts:277`).
Retrieval text comes from `args.mensaje`; hard constraints are extracted from `solicitudOriginal` + brief and applied as filters that the model's phrasing cannot alter. Preserves the anti-drift guarantee, unblocks per-component search.

**A2. Shared match-level vocabulary.**
One exported union reused by both axes, so UI and prompt speak one language:

```ts
export type NivelCoincidencia = "exacto" | "adaptable" | "fuera_de_catalogo";
```

**A3. Hard-vs-soft signal split** (`query-parser`).

```ts
type EventSearchIntent = {
  event_label: string | null;      // customer's own words, preserved verbatim
  event_terms: string[];           // retrieval terms only — never ids or products
  occasion_filter: string[];       // filled ONLY when a closed alias is safe
  hard_filters: {                  // verifiable, SQL-safe, explicitly requested
    categorias: string[]; colores: string[]; acabados: string[];
    formas: string[]; diametros_pulgadas: number[];
    precio_max: number | null; solo_disponibles: boolean;
  };
  soft_signals: { estilos: string[]; motivos: string[]; colores: string[] };
  semantic_query: string;          // original request, for traceability
};
```

Rules: the model may enrich soft signals but **never** create a hard SQL filter; an unknown event never becomes `boda`, `cumpleanos` or `baby_shower`.

## 4. Part B — Reference element scope

**B1. New `src/lib/rag/taxonomy/alcance-referencia.ts`.** Static map, no I/O.

```ts
export type AlcanceReferencia = "cubierto" | "parcial" | "emulable" | "fuera_de_catalogo";

export type AlcanceCategoria = {
  alcance: AlcanceReferencia;
  categorias: readonly CategoriaCatalogoV2[];  // [] when fuera_de_catalogo
  nota: string;        // honest, customer-facing sentence
  emulacion?: string;  // only when "emulable": what gets built instead
};

export const ALCANCE_POR_CATEGORIA_REFERENCIA:
  Record<ReferenceElement["category"], AlcanceCategoria> = { /* … */ };
```

Static on purpose: `bloqueReferencia` must be deterministic — same blueprint, same text — because the system-prompt hash cannot vary between identical calls (`prompt-sistema.ts:135`). A count query would break that and add a network dependency to prompt assembly. Keying the record off the enum at `reference-blueprint.ts:96` makes a missing entry a compile error. Importable client-side, so components need no fetch.

| Reference category | Scope | Catalog categories | Emulation |
| --- | --- | --- | --- |
| `balloon_structure` | `cubierto` | `globo_latex`, `globo_metalizado`, `globo_numero_letra`, `guirnalda_arco`, `kit` | — |
| `curtain`, `drape`, `backdrop`, `panel` | `emulable` | `globo_latex`, `globo_metalizado` | vertical balloon plane (organic wall/backdrop) in the observed palette |
| `signage` | `emulable` | `globo_numero_letra`, `banderola_cartel` | letter balloons or a catalog banner — not custom lettering |
| `tableware` | `parcial` | `vela`, `desechable`, `complemento` | — (candles and disposables yes; dishware and glassware no) |
| `furniture` | `fuera_de_catalogo` | — | **never emulated**: there is no balloon furniture |
| `floral` | `fuera_de_catalogo` | — | **never emulated**: fresh/dried florals have no equivalent |
| `lighting` | `fuera_de_catalogo` | — | **never emulated** |
| `plinth` | `fuera_de_catalogo` | — | load-bearing support, not decor |
| `other` | `fuera_de_catalogo` | — | no signal to classify |

Worked example (the champagne/gold wedding backdrop): garland → `cubierto`; chiffon curtain and tulle → `emulable`; "love" sign → `emulable` via letter balloons; bench and pampas → `fuera_de_catalogo`. `PALETA_COLORES_V2` (`v2.ts:25`) does include `champagne`, `crema`, `nude`, `beige`, `dorado` — the palette is reachable, which is what makes emulating the champagne textile genuinely good rather than a patch.

**B2. Typed omission reason** (`plan/tipos.ts:135`).

```ts
referencia_omitida: z.array(z.object({
  element_id: z.string().trim().min(1).max(80),
  motivo: z.string().trim().min(1).max(240),
  motivo_tipo: z.enum([
    "fuera_de_catalogo",    // catalog does not sell this category
    "emulacion_propuesta",  // balloon version offered, awaiting customer
    "emulacion_rechazada",  // customer declined
    "decision_de_diseno",   // my choice, explained
  ]),
  propuesta: z.string().trim().max(240).optional(),
}).strict()).max(40).default([])
```

Validation: `emulacion_propuesta` requires `propuesta` (schema `superRefine`); `fuera_de_catalogo` must agree with the element category's real scope, checked in `validarCoberturaReferencia` (`restricciones.ts:127`), which already receives the blueprint. Update the LLM-facing field description at `herramientas.ts:343`.

**The strict partition in `validarCoberturaReferencia` stays.** It is the honesty guarantee; this plan reframes omission, it does not remove accountability.

**B3. Coverage states** (`plan/desglose.ts`). `EstadoCoberturaReferencia` (`:4`) adds `"emulable_pendiente"` and `"fuera_de_catalogo"`; `ElementoCoberturaReferencia` (`:6`) gains `alcance`, `motivoTipo?`, `propuesta?`; `construirCoberturaReferencia` (`:52`) derives state from `motivo_tipo` instead of collapsing everything to `"omitido"`. Mirror in `DesgloseMateriales.referencias_omitidas` (`:41`).

## 5. Part C — Open events

**C1. Component query planner.** Derive per-component queries from space, budget, complexity and request — not from a fixed list. For "elegant gender reveal, blue and pink": theme (`revelacion de genero`), focal (`arco o guirnalda azul rosado elegante`), backdrop, message (`cartel niño o niña`), table (`desechables azul rosado`), accents. Depends on A1.

**C2. Retrieval ladder.**

1. **Exact event** — normalized event name present in title, handle, description or tags.
2. **Thematic** — motifs, symbols and related terms. Ranking signal, never an inferred hard filter.
3. **Adaptable** — generic products satisfying color, style, category, dimensions, availability, budget.
4. **Generic composition** — neutral structures (focal, backdrop, side supports, table/floor accent, accessories only when real candidates exist).

`NO_MATCH` only after tier 3 is exhausted.

**C3. Focused queries and evidence.** Stop relying on `plainto_tsquery` over the whole conversational phrase; add focused event and component queries fused through the existing RRF. Base behavior must be correct on FTS + trigrams — embeddings may improve ranking but must not be a requirement.

```ts
type EventMatchEvidence = {
  match_level: "exact_event" | "thematic" | "adaptable";
  matched_signals: string[];
  relaxations: string[];
};
```

Feed open event signals into `buscarCatalogoRagConPresupuesto`, `buscarPorRol` and the reranker. Event match **adds to ranking**; it must not block generic products when no thematic coverage exists. The relaxation ladder keeps declaring every change to color, occasion, category or ceiling.

**C4. Composition.** Recipes depend primarily on space type/dimensions, requested view, complexity, budget, requested structures and guest count. The event name shapes narrative, palette, motifs and thematic priority — it does not by itself determine geometry. Keep `concepto.ocasion` free text and ensure it receives `event_label`.

**C5. Scene V2 (before leaving shadow).** Replace `event_type: z.literal("wedding")` (`scene/tipos.ts:104`) and the `"wedding"` default (`parse-event.ts:530`) with an open contract or `event_family` + `event_label`; add generic indoor/outdoor recipes; select by space, view and complexity; forbid a wedding fallback for unknown events; keep recipe and original-name traceability.

**C6. Visual generation.** Propagate `event_label`, original request, palette, style, confirmed motifs, piece match levels, and the approved plan/materials into the image prompt. With no thematic products, express the event through composition and color — never invent signage, text or accessories unbacked by plan and catalog. `visual-context.ts:106` must stop being the sole source of `eventCue`; build a safe cue from the free label for unrecognized events.

## 6. Part D — Interface and observability

**D1. `ReferenceReviewPanel.tsx`** — delete `labelMatch` (`:20`) and its render (`:60`). In perceptual mode there is no catalog verdict to show; it is noise with the sign inverted. Replace with the scope badge from the static map.

**D2. `ReferencePlanCard.tsx`** — three groups instead of a flat list: **Lo que voy a armar** (`incluido`, with structure and lines, already at `:45`); **Puedo emularlo con globos — ¿lo incluyo?** (`emulable_pendiente`, showing `propuesta`); **Fuera de mi catálogo** (`fuera_de_catalogo`, with the honest note). The `pendientes` badge (`:31`) stops counting `fuera_de_catalogo` — that is scope, not a gap.

**D3. Customer-facing copy.** Exact: "Encontré piezas específicas para revelación de género y completé el montaje con globos coordinados en azul y rosado." Adaptable: "No encontré una línea específica para este festejo, pero armé una propuesta adaptable con la paleta y el estilo que pediste." Missing mandatory physical/commercial attributes must be stated; an adaptable piece is never presented as an exact thematic match.

**D4. Logging** per search: `event_label`; whether a closed occasion was recognized; per-component queries; candidate counts per tier; selected pieces' match levels; relaxations applied; outcome (plan confirmed / clarification / `NO_MATCH`); parser, retrieval and planning latencies.

**Metrics:** useful-proposal rate for unclassified events; `NO_MATCH` rate before vs. after fallback; mean role/structure coverage; share of exact vs. thematic vs. adaptable pieces; relaxed-constraint incidents; conversion delta vs. classified events.

## 7. Out of scope

- The **hard `sin_cobertura` block** (`registro-herramientas.ts:636`). It concerns balloon *diameters* inside an already-committed structure and is a correct gate — do not quote materials that cannot be bought. Different problem.
- **Wiring up the dead `src/lib/scene/` stack.** `computeCoverageReport` / `SceneCoverageReport` are a richer coverage model but disconnected (eval scripts only). Folding it in triples the change. Part C5 touches only what blocks the wedding default.
- **Dynamic scope map via count query.** Static wins on prompt-hash determinism. Refining `parcial` with real counts is a follow-up.
- Creating inventory that does not exist; guaranteeing specialized accessories for any imaginable event; turning training captions into commercial classifications; silently relaxing physical or budget constraints; a bespoke recipe per event name.

## 8. Subagent delegation

Parts B and C are independent once Part A lands, and both are deep enough that a fresh context per workstream beats one long thread. Delegate with **`Agent` at `xhigh` reasoning effort** where it saves wall-clock time or the work is self-contained; keep integration and final review in the main thread.

| Stage | Delegation | Effort |
| --- | --- | --- |
| Part A | **Main thread.** Single shared blocker, small, and everything else depends on its exact shape. | — |
| Part B (reference scope) | 1 agent — `alcance-referencia.ts` + `tipos.ts` + `restricciones.ts` + `desglose.ts` | `xhigh` |
| Part C1–C3 (planner + ladder + ranking) | 1 agent — the deepest RAG work; `search.ts`, RRF fusion, reranker, budget path | `xhigh` |
| Part C4–C6 (plan, Scene V2, visual) | 1 agent — depends on C's intent contract, so start after C1–C3 settles the types | `xhigh` |
| Part D (UI + observability) | 1 agent — start once B2/B3 land the state names | `high` |
| Test suites (§9) | 1 agent, after implementation | `high` |
| Final cross-cutting review | **Main thread** — `/code-review` at `xhigh` over the full diff | `xhigh` |

Rules for delegation: run B and C1–C3 **in parallel** (single message, multiple `Agent` calls); give each agent the verified file:line anchors from §2 rather than asking it to re-discover them; require every agent to report which acceptance criteria in §10 its work satisfies. Do not delegate Part A, schema decisions, or the final review.

## 9. Testing

**Reference axis** — extend `scripts/test-referencia-plan-cobertura.ts` (already builds a `category: "curtain"` blueprint at `:17`):

| Case | Expected |
| --- | --- |
| `balloon_structure`, covered | enters the plan via `referencia_element_id` |
| `drape`, emulable | `emulacion_propuesta` with `propuesta` present; **not** in the first confirmation |
| `furniture` declared `cubierto` by the model | plan rejected |

**Event axis — parser:** `revelacion de genero azul y rosado`, `bautizo blanco y dorado`, `primera comunion elegante`, `evento corporativo verde y blanco`, `quinceanero fucsia`, `aniversario plateado`, plus an invented celebration name. Assert `event_label` is preserved, `occasion_filter` is never invented, colors and physical constraints still work, and results are stable with no remote provider.

**Event axis — retrieval:** exact-tag recall for a tag absent from the taxonomy; thematic recall via title/description; fallback to compatible generic products; rejection of out-of-stock and over-budget items; exact → thematic → adaptable ordering; correct behavior with vectors disabled.

**Chat integration:** a multi-component request must produce **distinct** search messages, all preserving the original constraints (this is the A1 regression test).

**Plan and generation:** 3–5 structures for an unclassified event when generic inventory suffices; no wedding fallback; free event present in visual context and prompt; no product outside the retrieved whitelist; honest wording for adaptable pieces.

**Regression:** existing cases for birthday, XV años, wedding, baby shower, graduation, Christmas, Halloween, SKU search, and size/shape/color/finish/budget.

```bash
npm run plan:test-referencia-cobertura
npm run plan:test
npm run ia:test-referencias-perceptual
npm run rag:eval-parser && npm run rag:eval && npm run rag:regression
npm run lint
```

**Manual end-to-end.** Start the dev server via `preview_start` (never Bash). Upload the champagne/gold backdrop photo and confirm: the garland enters the plan; the chiffon curtain appears as a proposed emulation with an explicit question; bench and pampas appear out of catalog with no balloon proposal; `ReferenceReviewPanel` no longer says "Sin producto equivalente" on the garland. Then run a "revelación de género elegante azul y rosada" turn and confirm distinct per-component searches and no wedding fallback.

## 10. Acceptance criteria

**Reference axis**

1. No `fuera_de_catalogo` element triggers catalog searches or emulation proposals.
2. No `emulable` element enters the plan without an affirmative customer answer.
3. A plan declaring `fuera_de_catalogo` for a covered category is rejected by the backend.
4. `validarCoberturaReferencia` still requires the complete partition of approved elements.
5. `bloqueReferencia` stays deterministic: same blueprint → same text → same hash.
6. The UI shows no catalog verdict derived from `match_type` in perceptual mode.

**Event axis**

7. A new event needs no enum entry to receive a proposal.
8. The free event name survives chat, search, plan and image.
9. Per-component searches use genuinely different queries.
10. An AI-enriched query cannot alter the customer's original constraints.
11. Exact thematic products are prioritized when they exist; compatible generic products may complete the proposal.
12. `NO_MATCH` appears only after the adaptable fallback is exhausted.
13. The system states whether a piece is exact, thematic or adaptable.
14. No unknown event becomes a wedding.
15. Known events hold or improve their current precision.
16. The flow works without mandatory remote embeddings.

**Both**

17. No invented products, prices, availability, text or accessories.

## 11. Implementation order

1. **Part A** — shared foundation. Main thread. A1 first (one line, unblocks everything), then A2/A3 contracts.
2. **Parts B and C1–C3 in parallel** — two `xhigh` subagents.
3. **Part C4–C6** — after C's intent contract is stable.
4. **Part D** — after B2/B3 fix the state names.
5. **Tests** (§9), then `/code-review` at `xhigh` over the full diff in the main thread.
6. **Controlled rollout** — feature flag, shadow evaluation on anonymized real requests, compare `NO_MATCH` / coverage / quality against the current flow, gradual release, keep a kill switch.

A satisfactory result for an event with no dedicated product line is a coherent composition of real, adaptable products — not a false exact match.
