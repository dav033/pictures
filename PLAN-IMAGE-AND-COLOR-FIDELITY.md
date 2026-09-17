# Image and colour fidelity — diagnosis and phased plan

Written 2026-09-17 against `fase-a/a0-linea-base` at commit `dad9f6f`.

Two reported problems:

1. Images generated from **reference photo + space photo** are inconsistent and poor.
2. **Colour detection is inconsistent** and the planner does not use the right colours.

Every claim below carries its source. Three labels are used and they are not
interchangeable:

| Label | Meaning |
|---|---|
| **MEASURED** | Reproduced in this session. The command is in §7. |
| **READ** | Verified by reading the code at `dad9f6f`, with `file:line`. |
| **REPORTED** | Comes from an existing document or an earlier session. Not re-verified here. |

Prior art this builds on, both still accurate where cited: `SEGUIMIENTO.md` and
`LORAGEMINI.MD` (the latter lives on `origin/main`, not on this branch —
recover it with `git show e38a92a:LORAGEMINI.MD`). Where this document
disagrees with them, it says so.

---

## 1. Executive summary

The headline finding is that **the two reported problems are the same problem
seen from two ends**: nothing in the system measures what a photo actually looks
like, and nothing measures whether the generated image matches it. Every
mechanism that could close that loop exists in the code but is disconnected.

Seven facts decide the plan:

1. **In the hybrid path, not one pixel of the customer's reference photo reaches
   any image model.** The reference is compressed into a text caption. READ,
   `route.ts:1178`, `:1192`, `lora-gemini-composition.ts:23-40`.
2. **Every generation draws a fresh random seed.** Two identical requests
   produce two different images by construction. READ, `lora-seed.ts:26-32`,
   `route.ts:1177`.
3. **A whole family of ordinary designs cannot generate at all.** Two mirrored
   lateral structures with no central focus fail closed with
   `LORA_PREFLIGHT_FAILED`. MEASURED, §3 F4. No fixture in the repository covers
   that shape.
4. **The palette that reaches the plan changes between runs of the same photo.**
   Two photos, five runs each: four distinct palettes out of five, both times.
   MEASURED, §4 G1.
5. **Nothing anywhere measures colour dominance.** The palette is the first
   three or five entries of an unordered model-generated list. READ,
   `colores-referencia.ts:101`, `:123`.
6. **Nothing forces the plan to use the photo's colours.** The reference palette
   is ranking context, never a filter — the code says so in a comment — and the
   planner's material colour is an unconstrained string. READ,
   `registro-herramientas.ts:1102`, `buscar.ts:187-198`,
   `herramientas.ts:124-137`.
7. **The visual QA never receives the customer's photo**, yet it reports whether
   the camera and the architecture were preserved. Those fields are invented by
   the model. READ, `image-qa.ts:277-300`, `:107`, `:140`.

**Credential note:** the fal key committed to `.env.production` and deployed on
the server — the same key in all four copies, including three dated backups —
belongs to an exhausted account (`403 User is locked. Reason: Exhausted
balance`, balance endpoint `200` / `0.0`). A second key, for a funded account
(US$47.43), was supplied during this session and is what the measurements in §6
were run with. **The server and `.env.production` still hold the dead key.**
Rotating them is a prerequisite for anything that generates an image in
production, and belongs in Phase 0.

Ordering principle: **make it deterministic and observable before changing any
prompt**, because on today's system a prompt change cannot be judged — the seed
moves under it.

---

## 2. What the pipeline actually does today

With a space photo present, `/api/generate` enters hybrid mode
(`route.ts:913`):

```
customer reference photo
        │
        ├─► analyser ─► blueprint ─► plan (Python) ─► approved, signed plan
        │
        ▼
    SceneSpec ──► compileProductPrompt() ──► caption, ≤460 chars
                                                   │
                       + LORA_PRESENTATION_INSTRUCTION (290 chars of negations)
                                                   │
                                                   ▼
        STAGE 1   fal.ai flux-2/lora · TEXT endpoint · zero input images
                                                   │
                                        decoration rendered on white
                                                   │
                  space photo ────────────────┐    │
                                              ▼    ▼
        STAGE 2   Gemini gemini-3.1-flash-image · venue + LoRA render
                                                   │
                                                   ▼
                                        the image the customer sees
```

What is discarded in hybrid mode — all READ at `dad9f6f`:

| Discarded | Where |
|---|---|
| Every image the LoRA would receive | `route.ts:1178` — passed `[]` |
| Every image the `/edit` endpoint would receive | `route.ts:1156` — `referenciasEdit = []` |
| The reference photo at the Gemini stage | `route.ts:1192` → `lora-gemini-composition.ts:23-40` returns exactly two inputs |
| Scenery detected in the reference | `route.ts:838` → `reference-structure.ts:362-364` returns `false` when a venue exists |
| Ambient decor in the caption | `route.ts:1066` — `ambientDecor = []` |
| Venue kind, lighting and palette in the caption | `route.ts:1067` — replaced by `GROUPING_ONLY_CONTEXT` |

Because the LoRA receives no images, the adapter selects the text endpoint
(`sempertex-lora.ts:324`), so `/edit` — which accepts four images and a
2 500-character prompt — is never reached in the case that needs it most.

**This is not "reference + space → image". It is "approved plan → text →
decoration on white → composite onto space".**

---

## 3. Problem 1 — findings

### F4 · Two mirrored lateral structures fail closed — MEASURED

The most severe finding, and the only one that produces no image at all.

`resolveRelations` skips the focal clause before assigning relations:

```ts
// src/lib/ia/lora-caption-compiler.ts:750
if (clause === focal) continue;
if (clause.bilateral) {
  clause.relation = `flanking ${focus}`;
```

When two lateral structures are the *only* structures, their merged clause is
itself the focal clause, so it never receives `flanking`. Two consequences
follow:

- Rendering falls through to `:1029` and the caption says both columns are
  **`standing apart on the left`**. The mirror phrase at `:1040` requires
  `relation.startsWith("flanking")`, which is never set.
- The preflight at `lora-prompt-preflight.ts:185` requires exactly that
  relation, fails `relaciones bilaterales 0/1`, and `route.ts:1148` throws
  **`LORA_PREFLIGHT_FAILED`**. The request produces nothing.

Measured with `scripts/diag-bilateral.ts`:

| Scenario | Preflight | Caption |
|---|---|---|
| A · two lateral columns only, role `focal` | **fail** `relaciones bilaterales 0/1` | `two organic balloon columns … standing apart on the left` |
| B · central arch + two lateral columns | pass | `two organic balloon columns …, one standing on the left and one on the right, flanking the main arch` |
| C · two lateral columns only, role `soporte` | **fail** `relaciones bilaterales 0/1` | `… standing apart on the left` |

**Blind spot:** of the 24 frozen plans in `scripts/fixtures/planes-fijados/`,
**zero** have this shape (MEASURED, `scripts/diag-planes-bilaterales.ts`).
`piezas-dos-columnas.json` comes closest but gives its two columns different
`rol_escena` (`focal` / `soporte`), and `expectedBilateralPairs`
(`lora-prompt-preflight.ts:79`) requires equal roles, so it never demands the
pair. The suite cannot regress on a shape it does not contain.

The production rate is **unknown** and must be measured: `plan_audit_log` does
not record generation-time preflight failures (§5).

### F5 · Large diameters are dropped from the caption without failing — MEASURED

`compileProductPrompt` omits any size not in a concept's `allowed_codes` and
only logs a diagnostic. On the control design:

```
element EST_01_COL_IZQ: size(s) R-36 are not in allowed_codes for
  balloon.round.latex.fashion.dusty_rose; omitted from the prompt
element EST_01_COL_IZQ: size(s) R-36 are not in allowed_codes for
  balloon.round.latex.reflex.silver; omitted from the prompt
```

> **Correction.** An earlier version of this finding blamed the vocabulary: "of
> 27 concept blocks only 2 allow R-36". That again counted only the hand-written
> entries. Auditing **all 268 active concepts against the live catalog**
> (`scripts/auditar-tamanos-vocabulario.ts`) returns **zero mismatch**: every
> concept's `allowed_codes` already matches the diameters its products are
> actually sold in.
>
> Which makes the defect sharper, not smaller. `fashion.dusty_rose` stops at
> R-18 because **dusty rose is not manufactured in 36 inches**. So when the
> baseline benchmark dropped R-36 in 4 of 4 cases, nothing was misconfigured:
> the plan had specified a diameter the chosen product does not exist in, and
> the compiler silently dropped it. **The missing gate is upstream** — nothing
> stops a plan from quoting and charging a size its own product cannot be bought
> in, and the only trace is a diagnostic line no one reads.

`route.ts:1086` throws only on `unresolved_products` or `legacy`; the size
diagnostics are returned in the response and otherwise ignored. So the 36-inch
topper that gives a column its size gradient is quoted, charged and then
silently absent from the prompt.

**Production corroboration:** of 971 rows in `plan_audit_log`, **171 (17.6 %)
are `SIN_COBERTURA` carrying a balloon size code** (`EST_01_ARCO:R-24`,
`EST_01_COLUMNA_IZQ:R-5 | R-9 | …`). That is the single largest error family in
the log, and 171 of the 178 `SIN_COBERTURA` rows. MEASURED.

This is the mechanism behind the reported symptom *"5, 12, 18 inch balloons and
a 36-inch topper → all similar, no dominant topper"* and behind the LoRA
evaluation's `0/6` on diameter. It is a **data gap, not a model failure**.

### F12 · The vocabulary resolves by product id, and a plan that picks an unlisted product renders nothing — MEASURED, after two corrections

> **Two earlier versions of this finding were wrong and are retracted.** The
> first said the vocabulary holds 27 concepts covering 11 of 26 colours; that
> counted only the hand-written entries in `product-vocabulary-data.ts` and
> missed the two imported sets (`CATALOG_PRODUCT_CONCEPTS`,
> `V007_DATASET_PRODUCT_CONCEPTS`). The real vocabulary is **269 concepts, 268
> active, 943 product ids, covering 17 of the 26 colours**. The second said
> `negro` had no concept and therefore a grey substitution could not render;
> `negro` has **16**. That probe "failed" only because it used a product id I
> invented, which is the actual mechanism: **resolution is by product id, not by
> colour.**

What is true, measured today:

- **Nine catalog colours have no active concept**: `transparente`, `multicolor`,
  `lila`, `turquesa`, `beige`, `violeta`, `crema`, `nude`, `burdeos`.
- **365 of the 505 sellable round latex products (72%) are outside the
  vocabulary**, matching on product id *and* on SKU the way `productIdAliases`
  does (`route.ts:1047-1054`). But **212 of those 365 are `multicolor`**
  (assorted, printed and bouquet items) which the vocabulary's own scope rule
  excludes on purpose. Net of those, **153 single-colour products are
  unlisted**, and most are printed novelties (`Feliz Cumpleaños`, `Galaxy`,
  `Infinity®`) rather than plain balloons.
- A plan that buys any unlisted product compiles to `unresolved_products` and
  `route.ts:1086` throws `LORA_PRODUCT_VOCABULARY_FAILED`: the request renders
  nothing.

So the exposure is real but narrower than first claimed, and its size depends on
something not yet measured: whether the planner can actually reach those 153
products, which the LoRA dataset allowlist (`variantIds` in
`globos-por-color.ts`) may already prevent. **Measure that before sizing the
work.**

The colour split below still holds and is what drives the remediation:

**Group A — the catalog sells them, the vocabulary just never learned them.**
Verified single-colour round latex Fashion products exist today:

| Colour | Products | Sizes actually sold |
|---|---|---|
| negro | 1 plain (`8634239516967`) | R-5 … R-24, **R-36, R-40** |
| amarillo | 3 plain | R-5 … R-24, **R-36, R-40** |
| naranja | 2 plain | R-5 … R-24, **R-40** |
| cafe | 3 plain | R-5 … R-24 |
| morado | 1 plain | R-5, R-12, R-18, R-24 |
| crema | 1 plain | R-5 … R-24 |

Cheap to fix: add the concepts. Note the sizes — the catalog stocks R-36 and
R-40 that the vocabulary's `allowed_codes` never mention, which is F5 seen from
the supply side.

**Group B — the catalog does not sell them at all.** No single-colour round
latex balloon exists in **lila, turquesa, champagne, coral, menta, nude or
burdeos**, and `fucsia` exists only as printed novelty balloons (`Infinity®
Coquette`, `Terrazo`, `Neon`), never plain. Adding a concept here would promise
something unbuyable. For these, substitution is the only correct answer, and it
must be visible to the customer before generating.

That second group reframes the burgundy story once more. Commit `8b89527` made
`burdeos` claimable so it would stop vanishing — but **there is no burgundy
balloon to sell**. The honest behaviour is to substitute (its nearest stocked
hue is `rojo`, distance 0.056) and say so out loud, not to carry the word
forward to a vocabulary and a supply chain that cannot honour it.

This is not a cosmetic gap. Compiling a catalog-backed element whose product is
outside the vocabulary produces `unresolved_products: 1, legacy: true`, and
`route.ts:1086` turns that into a thrown **`LORA_PRODUCT_VOCABULARY_FAILED`**.
Measured directly:

| Element colour | `unresolved_products` | `legacy` | Result at `/api/generate` |
|---|---|---|---|
| blanco + plateado | 0 | false | compiles |
| **burdeos** | 1 | true | **throws `LORA_PRODUCT_VOCABULARY_FAILED`** |
| **negro** | 1 | true | **throws `LORA_PRODUCT_VOCABULARY_FAILED`** |

Now join it to §4. Commit `8b89527` made `burdeos` claimable so the dominant
colour of a wine-coloured photo would stop vanishing — and it now reaches a
vocabulary that cannot express it. And G3's substitution sends `gris` to
`negro`, which also has no concept. **Both colours at the centre of the original
complaint end in a hard generation failure, not a poor image.**

That reframes the burgundy story: it was never only "the colour disappears". At
the end of the chain the request dies. Any measurement of colour fidelity has to
check this first, because a case that throws produces no image to judge.

**Where it belongs:** Phase 1, beside F4 and F5 — all three are "the pipeline
fails closed or loses data on ordinary input". Fixing it is a vocabulary data
task (add the missing concepts with their real product ids), and it must be
sized before it is scheduled: count how many approved plans in `plan_audit_log`
carry a colour outside the covered eleven.

### F13 · Placement is a constant stamped on the frame; nothing ever looks at the space — READ

Where each structure lands is decided by `automaticTargetBox`
(`route.ts:508-520`), and with a venue it returns **hardcoded fractions of the
image**:

```ts
if (element.scene_role === "midground" || element.category === "balloon_structure") {
  if (index === 0) return { x: 0.12, y: 0.12, width: 0.76, height: 0.5 };
  return index % 2 === 0
    ? { x: 0.08, y: 0.38, width: 0.3, height: 0.5 }
    : { x: 0.62, y: 0.38, width: 0.3, height: 0.5 };
}
```

The first balloon structure always goes dead centre, the rest alternate left and
right, in every photo ever submitted. **No code reads the venue image to decide
placement**: not the architecture, not a doorway or porch opening, not the floor
plane, not where there is free wall, not the eye level. The customer's space is
a backdrop the layout is stamped onto.

The prompts then instruct the compositor to keep it that way:

- `lora-gemini-composition.ts:31` — *"Transfer only their colors, proportions and
  arrangement into the venue."*
- `GEMINI_COMPOSITION_HARD_LOCK` — *"use the venue image as the immutable base …
  Keep the venue's existing architecture, plants, ground, camera and crop
  unchanged … Do not invent, retain or add any of those objects."*

So when a preview shows an arch planted on the lawn in front of a house instead
of framing the porch it is standing next to, that is not the image model
underperforming. **It is the system doing exactly what it was told: transfer,
do not adapt.** Measured on the baseline: every one of the four cases placed the
arch centre-frame on the grass, and the visual QA returned `pasted artifact` on
all three structures plus `contact shadows failed`.

This is the gap behind the most common product complaint — "it looks pasted on"
— and it is addressed in **Phase 6**.

### F1 · The reference never reaches a model — READ

See §2. The consequence is a hard ceiling: the exact shade of the pink, the
share between three colours, the irregular profile of each column and where the
large cluster sits must all survive a round trip through ≤460 characters of
English.

`LORAGEMINI.MD` §4 measured the cost of the resulting architecture on `v007`:
the full current pipeline scored **4/10** on photorealism and commercial
usability, the worst of six variants and the only one below 5. REPORTED — and
note the model it measured is rejected (F10), so the number should be re-taken
on `v004` before being quoted.

### F2 · The UI contract and the server disagree — READ

```ts
// src/lib/estado/modo-vista-reglas.ts:30-35
// Decisión del usuario (2026-09-15): LoRA por defecto también con foto del
// espacio, referencias o ajuste de imagen, que el servidor envía a FLUX.2
// `/edit` (sempertex-lora.ts).
```

With a venue photo the server does the opposite: `usarComposicionLoraGemini`
becomes true (`route.ts:913`) and both `referenciasEdit` and the LoRA inputs are
emptied (`:1156`, `:1178`). The documented intent — one model sees both photos —
has never run for the case it was written for.

### F3 · Every generation is a different image — READ

```ts
// src/lib/ia/lora-seed.ts:26-32
export function randomLoraSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_647;
}
// route.ts:1177
const loraSeed = usarLora ? resolveLoraSeed(seedParse.seed) : undefined;
```

`/api/generate` accepts a `seed`, and the UI never sends one
(`page.tsx:1283-1335`). Stage 2 is worse: the Gemini image call sets no seed,
temperature or top-p at all (`gemini/imagen.ts:82-100`).

So "inconsistent" is not a quality judgement — it is the specified behaviour.
It also makes every other finding harder to measure, which is why Phase 0 comes
first.

### F6 · The caption is written in a register the LoRA never saw — MEASURED

`LORA_PRESENTATION_INSTRUCTION` is **290 of the 750-character budget**, leaving
460 for the entire design (MEASURED, `scripts/diag-caption-hibrido.ts`). It
contains no description — only a prohibition plus two patches written against
observed defects.

Measured over the 345 captions of the v007 training corpus
(`data/staging/lora-v007/captions`):

| Property of the training captions | Value |
|---|---|
| End describing a **real background** (`set against … walls and … floor`) | **345 / 345 = 100 %** |
| Include **props** (`alongside a table, a chair, flowers…`) | 245 / 345 = 71 % |
| Mention a white studio background | 43 / 345 = 12.5 % |
| Contain an imperative prohibition (`No `, `Never `, `must be`) | **0 / 345 = 0 %** |
| Length min / median / p75 / p95 / max | 176 / 416 / 548 / 854 / 1212 |

The two clauses that close 100 % and 71 % of the corpus are exactly the two the
hybrid mode forbids.

**A correction to `LORAGEMINI.MD` §2.1:** that document frames the problem as a
460-character bottleneck. On the control design the compiled caption is only
**289 characters** — well inside budget. The binding constraint is therefore not
length but **register**: the caption is short *and* out of distribution. Freeing
characters alone will not help; rewriting the closing clause will.

### F7 · The finish vocabulary may not match the active model — MEASURED, with a caveat

`FINISH_WORDS.reflex = "glossy"` (`lora-caption-compiler.ts:253`), and the
compiled caption says `glossy chrome silver`. In the **v007** corpus `glossy`
appears in **1 of 345 captions**, while `high-shine Reflex` appears in 147
(43 %).

**Do not act on this yet.** The active approved model is **v004**, whose corpus
is a different dialect: the header of `scripts/lora-caption-affinity.ts` records
that the v004 corpus uses `chrome` in 44 % of captions — which *is* what the
runtime emits. The v004 caption corpus
(`data/processed/export-general-2026-08-27.json`) **is not in the checkout**, so
`lora-caption-affinity.ts` cannot run against the model production actually
serves. Restoring that file is a Phase 0 task; the finish decision depends on it.

### F8 · The runtime can emit colour words the model never saw — MEASURED

Occurrences of each runtime colour word in the 345 v007 captions:

| Emitted word | Captions containing it |
|---|---|
| `nude` | **0 / 345** |
| `burgundy` | **1 / 345** |
| `turquoise` | 5 / 345 |
| `beige` | 9 / 345 |
| `mint` | 11 / 345 |
| `champagne` | 13 / 345 |
| `coral` | 13 / 345 |

`burdeos` became claimable in commit `8b89527`. The model has seen the word
once. Meanwhile the corpus uses shades the runtime palette cannot express:
`dusty rose` (15), `pastel pink` (24), `lavender` (13), `peach` (12),
`grey` (10), `off-white` (53).

Note the product vocabulary partly rescues this: `compileProductPrompt` emits
`matte dusty rose` and `glossy chrome silver` from `sceneTerms.descriptor`, not
the flat palette word. The gap is real but narrower than the palette table
alone suggests — it applies where the descriptor falls back to the palette.

### F9 · The visual QA is structurally unable to see the venue — READ

`observarImagenGenerada` (`image-qa.ts:277-300`) attaches exactly one image: the
generated one. Yet the response schema asks the model for

```ts
// image-qa.ts:31
venue_preservation: { camera_ok: boolean; architecture_ok: boolean; outside_region_similarity: number | null }
// image-qa.ts:107
outside_region_similarity: z.number().min(0).max(1).nullable().default(null)
// image-qa.ts:140  ← taken straight from the model's JSON
outsideRegionSimilarity: observado.outside_region_similarity,
```

and `evaluateSceneQa` turns it into the retry reason `outside edit region
changed` (`:389`). A deterministic implementation exists —
`outsideRegionSimilarity()` at `:321` — and is referenced **only by
`scripts/test-image-fidelity.ts`**. Nothing computes it in production.

On top of that, on the LoRA path the QA neither blocks nor retries:

```ts
// route.ts:1217  corrective retry
if (!usarLora && imageQaRequested && qa.pass === false) { … }
// route.ts:1232  the 422 gate
if (planResuelto && !usarLora && bloquearPorQa(qa, generationRequestId)) return respuestaNoConforme(…)
```

**A correction to `LORAGEMINI.MD` §1:** that document says QA does not run
because `IMAGE_QA_ENABLED` defaults off. The flag does default off
(`feature-flags.ts:25`) and `.env.production` does not set it — but the UI
requests QA explicitly on every user-mode turn (`modo-vista-reglas.ts:15`,
`route.ts:633`). QA **runs**; it simply has no teeth on the LoRA path.

**Production corroboration:** `plan_audit_log` holds repeated rows such as
`appearance failure EST_01_COL_IZQ | appearance failure EST_02_COL_DER` and one
with `… | outside edit region changed`, all dated 2026-09-16, all delivered to
the customer. MEASURED.

### F10 · A rejected LoRA has been in real use — MEASURED

Queried from the registry today:

| slot | run | dataset | trigger | evaluation |
|---|---|---|---|---|
| `unlimited` | `lora-run-v004-1000` | v004, 154 images | `eventdecor_style_v2` | **approved** |
| `training_1` | `lora-run-v004-1000` | v004, 154 images | `eventdecor_style_v2` | **approved** |
| `training_2` | `lora-run-v007-1000` | v007, 336 images | `eventdecor_style_v3` | **rejected** |

`plan_audit_log` records **35 turns on `training_2`** against 66 on
`training_1`. Any visual judgement formed on those 35 turns is a judgement of a
model production cannot serve — `mode-resolver.ts:86` only allows it in
development with `LORA_ALLOW_REJECTED_FOR_TESTING=true`.

### F11 · The venue photo is cropped and compressed twice — READ, needs confirmation

Reported by the pipeline audit and not re-verified in the browser: the space
photo is centre-cropped (`page.tsx:408-456`, `:1607-1618`), resized at JPEG
quality 0.82 (`:375-402`) and cropped again at 0.85 (`:443-452`), while the
reference is encoded once at 0.90 (`:1637-1640`). If confirmed, the
"architecture, camera and crop" the prompt orders the model to preserve are
already not the customer's framing. **Verify in the browser before acting.**

---

## 4. Problem 2 — findings

### G1 · The palette that reaches the plan is not stable — MEASURED

The same file analysed five times through the real analyser, with
`forzarNuevoAnalisis` so neither the fixed gallery analysis nor the in-memory
cache is hit (`analizar-referencias-v2.ts:548-553`). 20 paid Gemini calls total.

**`ejemplo-01.jpg`** — elements detected per run: **11, 10, 11, 11, 13**

| Catalog colour reaching the plan | Runs |
|---|---|
| rosado | 5/5 |
| blanco | 5/5 |
| plateado | 5/5 |
| gris | 4/5 |
| verde | **2/5** |
| azul | **1/5** |
| transparente | **1/5** |
| fucsia | **1/5** |

**4 distinct palettes in 5 runs.**

**`ejemplo-04.jpg`** — elements detected per run: **5, 5, 6, 6, 6**

| Catalog colour reaching the plan | Runs | Raw label seen |
|---|---|---|
| dorado | 5/5 | `chrome gold` 5/5 |
| verde | 5/5 | `green` 5/5 |
| blanco | **3/5** | `white` **5/5** |
| cafe | **2/5** | `brown` **5/5** |

**4 distinct palettes in 5 runs.** Note the last two rows: colours the analyser
*observed in every single run* reach the plan in only three and two runs
respectively. The loss happens after detection, not during it.

Raw labels drift as well: the same physical balloon is called `light pink`,
`pastel pink` and `matte light pink` across runs; one run invented
`soft lavender`, another `matte light blue` in a photo no other run saw blue in.

### G2 · Nothing measures dominance; the palette is a positional cut — READ

```ts
// src/lib/plan/colores-referencia.ts:101
return colores.slice(0, MAX_COLORES_REFERENCIA);   // 3
// src/lib/plan/colores-referencia.ts:123
return colores.slice(0, MAX_COLORES_FOTO_CLIENTE); // 5
```

The order being cut is the order the model happened to list. "Most dominant
first" exists only as an instruction inside the analyser prompt
(`analizar-referencias-v2.ts:129`); no code verifies it and no metric records
it. There is **no area, pixel or share measurement anywhere in the colour
path**. G1 is the direct consequence: an unstable ordering truncated at a fixed
position yields an unstable palette.

`coloresFotoCliente` also prefers `blueprint.palette.observed` over the
per-element colours when it is non-empty (`:114-116`) — a second, independently
unstable model output, which is why `white` can be seen on every element in
every run and still miss the palette.

### G3 · Grey is unsellable, unsubstitutable, and becomes black — MEASURED

`PALETA_COLORES_V2` (`src/lib/rag/taxonomy/v2.ts:27-54`) has 26 entries and
**no `gris`**. Two things follow:

1. `coloresFotoParaBusqueda` filters it out entirely before the catalog search:
   ```ts
   // src/lib/plan/colores-referencia.ts:146
   return colores.filter((color) => COLORES_CATALOGO.has(color));
   ```
2. Where it *does* reach chromatic substitution, it resolves to the wrong
   neutral. MEASURED:

   ```
   colorCatalogoMasCercano("gris", <full stock>) -> "negro"
   gris vs negro    = 0.35
   gris vs plateado = 0.35
   ```

   Both score identically because `gris`, `negro` and `plateado` share a neutral
   family (`similitud-color.ts:48-52`), and the tie is broken **alphabetically**:

   ```ts
   // src/lib/rag/catalog/similitud-color.ts:141
   if (puntuacion < mejorPuntuacion || (puntuacion === mejorPuntuacion && (mejor === undefined || opcion < mejor)))
   ```

   `"negro" < "plateado"`, so a matte grey photo buys **black balloons**.

The existing documentation says grey "disappears or washes out to white". The
code says something more specific and worse.

### G4 · The distance model has one axis where it needs three — MEASURED

`HUES` (`similitud-color.ts:10-32`) stores a single hue angle per colour.
Lightness and saturation are absent, so colours that differ only on those axes
score as near-identical. All MEASURED:

| Pair | Distance | What it means |
|---|---|---|
| `naranja` ↔ `cafe` | **0.011** | saturated orange ≈ dark brown |
| `dorado` ↔ `champagne` | 0.011 | |
| `dorado` ↔ `crema` | **0.022** | gold ≈ cream |
| `amarillo` ↔ `crema` | 0.022 | yellow ≈ cream |
| `violeta` ↔ `morado` | 0.022 | |
| `cafe` ↔ `nude` | 0.022 | |
| `rojo` ↔ `burdeos` | 0.056 | |
| `fucsia` ↔ `rosado` | **0.083** | hot pink ≈ soft pink |

That last row is the mechanism behind the *"dusty rose → bubblegum pink"*
symptom, and behind the prompt patch `Pink must be soft pastel, not hot pink`
that now occupies part of the caption budget. The patch is treating a symptom of
this table.

The table is correctly shared with Python through the
`x-tonos-colores-catalogo` contract extension and `catalog.py` reads it back, so
there is **no TS/Python divergence here** — both runtimes are equally wrong, and
fixing the table fixes both.

### G5 · Colour canonicalisation is asymmetric across the boundary — READ

TypeScript canonicalises plan colours through `canonizarColoresPlan`
(`colores-catalogo.ts:18-20`, applied at `registro-herramientas.ts:618`).
Python only strips accents and case (`services/ai-api/app/plan.py:287-292`). A
request that reaches the Python endpoint without passing through Next resolves
`"azul rey"` and `"rosa"` differently from the normal flow.

### G7 · The photo palette never constrains product retrieval — READ

This is the most direct answer to *"the planner is not using the right
colours"*. The reference palette is passed as **ranking context, never as a
filter**, and the code says so:

```ts
// src/lib/ia/registro-herramientas.ts:1102
// Photo colors are not filters, but the occasion must not hide them
// (relajacion-filtros.ts). The customer's own colors replace the photo's.
const coloresContexto = estado.restriccionesUsuario.colores.length > 0 ? [] : coloresFotoParaBusqueda(estado.referenceBlueprint);
```

Only colours the customer states explicitly become hard catalog filters
(`buscar.ts:187-198`), and the planner's material colour is an unconstrained
string (`herramientas.ts:124-137`). So nothing *makes* the plan use the photo's
colours: the model is asked to, and a post-hoc guard complains afterwards —
sometimes. Combined with G1 (the palette is unstable) and G2 (no dominance),
the chain from photo to purchased balloon has no enforcing link anywhere.

Whether photo colours *should* be hard filters is a product decision — hard
filtering can empty a result set — but "not a filter, and not measured, and only
sometimes reported" is not a decision, it is three gaps stacked.

### G8 · The second vision pass cannot correct a colour — READ

The analysis runs two passes, inventory then audit, and merges them.
`mergeCandidates` copies `structure`, `shape`, `category`, `scene_role`, `name`,
`visible_evidence` and `uncertainties` from the audit finding — and **not
`appearance` / `observed_colors`**:

```ts
// src/lib/ia/candidatos-referencia.ts:355-357
merged[match] = { ...current, structure: finding.structure ?? current.structure, shape: …,
  category: strongerCategory, scene_role: strongerRole, name: …,
  visible_evidence: finding.visible_evidence, uncertainties: … };
```

The audit pass exists to catch the first pass's mistakes. On colour it
structurally cannot: whatever the inventory pass said is final. This is a strong
contributor to G1 — there is no correction stage for the one field that varies
most.

### G9 · Ambiguous colour labels silently pick the first match — READ

`colorDeParte` treats the classifier's `ambiguous` status the same as `known`
and takes the first value (`colores-referencia.ts:77-79`). A label that could be
two catalog colours becomes whichever one the taxonomy lists first — with no
record that the choice was arbitrary.

### G10 · Catalog colour beats observed colour downstream, by design — READ

`buildApprovedSceneSpec` prefers catalog product colours over observed ones
(`scene-spec.ts:247-251`) and the image prompt explicitly forbids recolouring a
catalog item from the reference palette (`build-image-prompt.ts:582-590`).

That is correct commercially — the customer is charged for the product the
catalog sells, not the colour the photo showed. But it has a consequence worth
stating plainly: **a wrong colour chosen by the planner is then rendered
faithfully.** The image will never reveal a colour error upstream of it. Fixing
colour has to happen in the plan, not in the prompt.

### X2 · The production fal key is dead — MEASURED

`FAL_KEY` in `.env.production`, on the server, and in all three dated backups
(`bak-20260908155024`, `-20260908215718`, `-20260908215856`) is one and the same
key, id `f08b70ee-…`. It authenticates (balance endpoint returns `200`) and its
account is at `0.0`; every queue submission is rejected `403 User is locked`.

So **image generation in production cannot currently produce a LoRA render at
all** — it fails at the provider, not at any of the defects above. Rotate the
key on the server and in `.env.production` before measuring anything else about
production behaviour, and check whether the deployed app surfaces a provider
lock distinctly from a generation failure (`sempertex-lora.ts:55-60` maps
"Exhausted balance" to a non-retryable message, so the mapping exists — verify
what the customer actually sees).

### X1 · The evaluation spend cap fails open — READ

Not one of the two reported problems, but it gates every paid phase below and
`AGENTS.md` requires the opposite ("a run declares a spending cap up front and
**stops at it**").

`correrExperimento` measures spend as the difference between two readings of
`/billing/user_balance` (`scripts/exp-fal-lib.ts:335-341`), and `saldo()`
returns `null` on any non-OK response (`:160-172`), in which case the check is
skipped entirely:

```ts
const saldoActual = await saldo(key);
if (manifiesto.saldo_antes !== null && saldoActual !== null) {
  const gastoHastaAhora = manifiesto.saldo_antes - saldoActual;
  if (gastoHastaAhora >= maxUsd) { … break; }
}
```

With a working account the cap does function — the run in §6 read
`saldo antes US$47.426 · saldo despues US$47.258` and reported US$0.168, so the
arithmetic is right. The defect is the failure mode: whenever that endpoint is
unavailable or returns something unparseable, `saldo()` yields `null`, the
comparison is skipped, and the run continues spending with no cap at all —
silently. The `--dry-run`, `--confirm-spend` and `CI` guards are unaffected.

`AGENTS.md` requires a run to "declare a spending cap up front and stop at it".
**Fix before the next paid run:** cap on counted provider calls times a declared
unit price as the primary limit, keep the balance delta as a cross-check, and
treat a missing balance reading as a reason to stop rather than a reason to skip
the check.

### G6 · Proportion is still never compared — READ

The plan declares `participacion` per material. Nothing contrasts that share
with what the reference photo shows. The QA observer prompt *does* name
`color_proportion` as an appearance failure (`image-qa.ts` observer prompt), but
QA runs after the fact, never sees the reference, and does not block on the LoRA
path (F9). `SEGUIMIENTO.md` §E.3 opened this and it is still open.

---

## 5. What cannot currently be proven

Independently reached by the documentation audit and confirmed here. The system
can show that contracts are valid, that the planner respects its rules, that
chosen colours exist or can be substituted, and that prompts contain colour and
structure information. It **cannot** show:

- that the generated image preserves the real space;
- that the background survives the composite;
- that structures keep their scale and position;
- that the colour distribution matches the photo;
- that the colour the planner chose appears in the pixels;
- that changing LoRA, seed or model improves anything consistently.

Concretely missing from telemetry: a durable hash of the input images, the
reference colour distribution, the result colour distribution, a background
preservation score, and any human visual verdict bound to a `requestId`.
`plan_audit_log` also has a `motor_imagen_previsto` column that is **null in all
971 rows** (MEASURED), and records no generation-time preflight failures at all.

---

## 5b. Measured: what changing only the caption does

Run `registro-caption-v004`, 2026-09-17. Six images against **`v004-1000`, the
approved slot**, trigger `eventdecor_style_v2`, scale 0.8, guidance 3.5, 28
steps, 1024×1536 — production parameters. Declared cap US$0.60, **real spend
US$0.168**. Same commercial design in every cell; the only variable is the
wording. Judged in **one** call with all six images, so the numbers order the
cells *within this call* and nothing else.

This matters because `LORAGEMINI.MD` §4 ran the equivalent comparison on
`v007-1000`, which its own evaluation rejected. This is the first time the
question has been asked of the model production can actually serve.

| Cell | What changed | Photo | Finish | Size | Asymmetry | Isolation | Usable |
|---|---|---|---|---|---|---|---|
| A · s101 | production caption + the 290-char prohibition block | 6 | 6 | 6 | 5 | 4 | 6 |
| A · s202 | same, second seed | 6 | 6 | 5 | 5 | 4 | 5 |
| B · s101 | production caption, **prohibition block removed** | 6 | 6 | 6 | 5 | 4 | 6 |
| C · s101 | corpus register, real background **and props** | 5 | 6 | 6 | 6 | 3 | 4 |
| **D · s101** | **corpus register, asking for studio isolation** | 6 | 6 | 6 | **6** | **7** | **7** |
| D · s202 | same, second seed | 5 | 5 | 5 | 5 | 7 | 5 |

Four readings, in order of how much they change the plan:

1. **Removing the prohibition block alone changes nothing.** A and B are
   identical on every axis. The 290 characters are not what costs quality on
   v004 — which contradicts the working assumption. Reclaiming caption budget is
   not a lever; it is housekeeping.

2. **The corpus's own isolation clause beats the prohibition block at the
   prohibition block's own job.** `set against a plain white studio backdrop, no
   floor visible.` scored **7** on isolation against **4** for 290 characters of
   `No backdrop, drapes, furniture, tables, chairs…`, and carried usability up
   with it (7 vs 6). Visually the difference is unambiguous: A and B both put
   the columns in a room with a visible floor seam and wall junction — exactly
   what the prohibition forbids and does not prevent. **This is the Phase 3
   change, and it is now specific: replace the block with the closing clause.**

3. **The effect is real but small, and one seed disagrees.** D·s202 scores 5s,
   at or below A. Six images with one or two seeds per cell order a direction;
   they do not sign a gate. The Phase 3 acceptance criterion — ≥7 of 10 frozen
   plans — is the right bar, and **this run does not meet it.** Treat §5b as
   evidence for what to build next, not as the verdict.

4. **Finish separation never moves.** Flat at 5–6 in every cell, including the
   two in the corpus register. Whatever makes matte read as matte and chrome
   read as chrome is not in the caption wording — which is consistent with the
   v007 evaluation's `0/6` on finish and points at Phase 5, not Phase 3. C's
   photorealism penalty is an artefact of the prop I asked for (a table in the
   centre foreground), not of the register.

The images live outside the repository per `AGENTS.md`; the run manifest with
every literal payload is at
`reports/lora-debug/registro-caption-v004/manifiesto-registro-caption-v004.json`
and the judge's raw output beside it in `juez.json`.

---

## 6. The plan

Six phases. Each is independently shippable and reversible, and each states its
acceptance criterion **before** the work starts. Ordering is by
evidence-per-unit-of-cost, not by difficulty. Phases 0–2 need no fal balance.

> **Standing rule for every phase** (`AGENTS.md`): a run against paid providers
> declares its spending cap up front and stops at it; telemetry is disabled
> during evaluation runs; no images, absolute paths or customer data enter the
> repository; estimated cost is labelled estimated.

---

### Phase 0 · Make the system measurable — 1 day, US$0

Nothing here improves an image. It is the precondition for judging everything
that follows: today a prompt change cannot be attributed, because the seed moves
underneath it.

**0.1 — Pin the seed for evaluation.** `/api/generate` already accepts `seed`
(`lora-seed.ts:13-19`); the UI never sends it (`page.tsx:1283-1335`). Add an
explicit evaluation path that sets it, and return the effective seed in the
response for every generation (it already is — keep it). Do **not** remove the
random draw from normal use: customers benefit from variation, evaluation does
not.

**0.2 — Declare the active slot in the response and in the UI.** `modeStatus`
already returns `testing_rejected` (`mode-resolver.ts:88-96`) and nothing
displays it. Surface it, and record `lora_mode` + artifact id + evaluation
status alongside every generation.

**0.3 — Restore the v004 caption corpus.** `data/processed/export-general-2026-08-27.json`
is referenced by `scripts/lora-caption-affinity.ts` and absent from the
checkout, so the only harness that measures caption/corpus affinity cannot run
against the model production actually serves. Recover it, and make the script
resolve its corpus from the **active slot's dataset**, not a hard-coded path.

**0.4 — Wire the deterministic background check.** Call
`outsideRegionSimilarity()` (`image-qa.ts:321`) on the (venue, generated) pair
and use its value instead of the model-invented
`observation.outsideRegionSimilarity`. Keep the model field, renamed, as a
subjective signal — do not let it decide a retry reason any more.

**0.5 — Record what a diagnosis needs.** Add to the generation audit: input
image hashes, effective seed, slot + artifact id, caption hash and length,
preflight result, dropped size diagnostics, and the QA verdict. Populate
`motor_imagen_previsto`, which is null in all 971 existing rows.

**Acceptance:** two consecutive generations of the same approved plan with the
same explicit seed return byte-identical stage-1 images; every generation row
names its slot, its seed and a non-null QA verdict.

**Rollback:** all additive. No contract change, no migration beyond one audit
column set.

---

### Phase 1 · Stop failing closed and stop losing data — 2–3 days, US$0

Pure defect repair. No prompt rewriting, no architecture change. Each item has a
deterministic test that fails today.

**1.1 — Fix the bilateral focal clause (F4).** In `resolveRelations`
(`lora-caption-compiler.ts:737-752`), a bilateral clause must receive a mirror
relation even when it is the focal clause. When there is no other structure to
flank, the relation is not `flanking <focus>` but a self-contained mirror phrase
— the corpus writes this as two placements in one sentence, e.g.
`one standing on the left and one on the right`. Update the renderer at `:1040`
so it keys off `clause.bilateral` rather than `relation.startsWith("flanking")`,
and relax the preflight at `lora-prompt-preflight.ts:185` to accept the mirror
phrase without requiring the word `flanking`.

> Decide deliberately: the preflight currently fails **closed**, which turns a
> caption defect into a dead request. Once the caption is right, keep it closed
> — a wrong caption should not reach a paid provider.

**1.2 — Add the missing fixtures.** Three frozen plans that do not exist today:
two columns same type/role with no focus; two half-arches same type/role with no
focus; and one asymmetric lateral pair that must **not** be treated as a mirror.
Without them 1.1 can regress silently, exactly as it did until now.

**1.3 — Gate the size upstream, instead of dropping it at the caption (F5).**
The audit is done and `allowed_codes` needs no filling: it already matches what
the catalog sells. So the fix is not data, it is a missing gate.

- Make the omission visible: a dropped size becomes a named, surfaced condition
  on the response, not a diagnostic string nobody reads. This is the cheap half
  and it should land first, because it turns an invisible failure into a
  measurable one.
- Then decide where the real gate belongs: a plan should not be able to quote
  and charge a diameter the chosen product is not manufactured in. Python owns
  the plan's numbers (`AGENTS.md`), so the check belongs beside the rest of the
  material estimate, not in the TypeScript caption compiler — which is the last
  place that could notice and the worst place to fail.
- Investigate the 171 `SIN_COBERTURA` size rows as one population, not
  individually: they are 17.6 % of all audit rows and very likely this same
  root cause seen from the resolver's side.

**1.3b — Close the vocabulary colour gap, for the colours that are actually
sellable (F12 group A).** Add concepts for `negro`, `amarillo`, `naranja`,
`cafe`, `morado` and `crema`, with the product ids and size codes verified
against the live catalog in F12. That alone unblocks every plan that buys one of
them, and `negro` in particular is where G3's grey substitution sends traffic.

**Do not add concepts for group B** (`lila`, `turquesa`, `champagne`, `coral`,
`menta`, `nude`, `burdeos`, and plain `fucsia`): the catalog sells no such
balloon, so a concept would promise something that cannot be bought. Those
belong to Phase 2.5's substitution decision instead.

Sequencing matters: until `negro` exists as a concept, G3's grey fix is
invisible — grey would resolve to a colour that still cannot render. Land 1.3b
before Phase 2.3.

**1.4 — Restore reference scenery when a venue exists (F1, partial).**
`debeConservarEscenografiaDeReferencia` returns `false` with a venue
(`reference-structure.ts:362-364`), which drops the table, plinth, chair and
flowers that make a montage read as a photograph. Scenery already has its own
gate: it never touches quoting, materials or `plan_hash`, and the customer
toggles it per chip. Re-admit it, with `materializedReferenceIds`
(`route.ts:834`) still excluding whatever the plan itself builds.

**1.5 — Reconcile the UI contract with the server (F2).** Either the comment at
`modo-vista-reglas.ts:30-35` is wrong and should say what the server does, or
the server is wrong and Phase 4 fixes it. Do not leave both.

**Acceptance:** the three new fixtures pass; a two-column plan generates an
image; a plan requesting a 36-inch topper either carries it into the caption or
reports why it cannot, and never silently omits it; `npx tsc --noEmit &&
npm run -s lint && npm run plan:test` and `uv run --directory services/ai-api
pytest -q` all green.

**Rollback:** per-item revert. No contract or schema change.

---

### Phase 2 · Make colour measured instead of guessed — 1 week, ~US$5 in Gemini

The whole of Problem 2, and it needs no fal balance.

**2.1 — Measure dominance (G2).** Today the palette is `slice(0, 3)` of an
unordered list. Replace positional truncation with a measured share: compute
each colour's actual image share, deterministically, from the pixels — the
analyser can keep proposing *names*, but the *ranking and the share* must come
from measurement, not from the order the model happened to write. Carry the
share through the blueprint into the plan next to `participacion`.

> This is the single highest-value change in the colour path. Every other colour
> finding is downstream of not having this number.

**2.2 — Stabilise what the analyser returns (G1).** With 2.1 in place, re-run
the variance harness (`scripts/diag-varianza-colores.ts`) and set a threshold:
the measured palette of a photo must agree across five runs. Two levers, in
order of preference: constrain the analyser's colour output to the catalog
vocabulary at the schema level rather than folding free text afterwards; and
take the palette from the measured shares rather than from
`blueprint.palette.observed` (`colores-referencia.ts:114-116`), which is an
independently unstable second output.

**2.3 — Fix the neutral tie (G3).** `colorCatalogoMasCercano`
(`similitud-color.ts:132-151`) must not break a neutral-family tie
alphabetically. `gris` resolving to `negro` rather than `plateado` is a
one-line-class defect with a customer-visible consequence. Add the regression
test: `colorCatalogoMasCercano("gris", stock)` must be `plateado`.

**2.4 — Give the distance model a lightness axis (G4).** Extend
`x-tonos-colores-catalogo` from a hue angle to hue + lightness + saturation and
update both `similitud-color.ts` and its Python reader in `catalog.py`. Do it
**through the contract**, in the one direction `AGENTS.md` allows: Zod →
`npm run contracts:export:domain` → `generate_models.py` → regenerate golden
vectors. Acceptance is behavioural, not structural: `naranja`↔`cafe` and
`dorado`↔`crema` must stop being near-identical, and `fucsia` must stop being a
close substitute for `rosado`.

**2.5 — Decide what grey is (G3).** `gris` is in the analyser's output, in the
neutral family and in the LoRA's vocabulary (`grey` in 10 of 345 captions), but
not in the catalog palette. Three options, and this is a **product decision, not
an engineering one**: sell grey (add it to the palette if the catalog stocks it
under another label — `globos-por-color.ts:116` says grey balloons are filed
under `plateado`); or substitute it deliberately to `plateado` and tell the
customer; or declare it unavailable and say so before generating. Today it does
the fourth thing: disappears, or silently becomes black.

**2.6 — Compare proportion, as a warning first (G6).** With 2.1 producing a
measured share for the reference and the plan declaring `participacion`,
contrast them. Ship it as an observed warning with the delta recorded. Promote
it to a constraint only if the data shows it correlates with rejected proposals
— that decision needs the data 2.1 creates, which is why it comes last in this
phase and not first.

**2.7 — Make colour canonicalisation symmetric (G5).** Either Python applies the
same canonicalisation as `canonizarColoresPlan`, or the boundary rejects
non-canonical colour names. Do not leave two behaviours depending on the caller.

**2.8 — Let the audit pass correct a colour (G8).** Add `appearance` /
`observed_colors` to what `mergeCandidates` carries over
(`candidatos-referencia.ts:355-357`). The second vision pass exists to fix the
first one's mistakes and is currently blind to the field that varies most. Small
change, and it makes 2.2's variance threshold reachable.

**2.9 — Decide what the photo palette is allowed to do (G7).** Today it is
ranking context and nothing else — the comment at
`registro-herramientas.ts:1102` is explicit about it. With 2.1 producing a
measured share, the dominant colour of a photo becomes a defensible constraint
in a way it never was while the palette was an unordered guess. Options, in
increasing strength: keep it as context but make the post-hoc guard
unconditional; make the single dominant colour a soft boost with a recorded
penalty when unmet; make it a hard filter with an explicit relaxation rung.
**This is a product decision.** Take it deliberately — the current state is not
a decision, it is three gaps stacked (not a filter, not measured, only
sometimes reported).

**2.10 — Reject ambiguity instead of resolving it silently (G9).** `colorDeParte`
treats `ambiguous` as `known` and takes the first value
(`colores-referencia.ts:77-79`). An ambiguous label should be recorded as
ambiguous, not resolved by list order.

**Acceptance:** the same photo yields the same measured palette across five runs
(today: four different palettes out of five, on both test photos);
`colorCatalogoMasCercano("gris", …)` returns `plateado`; the four near-identical
pairs in §4 G4 separate; a colour that cannot be honoured is reported to the
customer before generation, never after.

**Rollback:** 2.3 and 2.5 are local. 2.4 changes a contract and must ship with
regenerated golden vectors; its rollback is the previous contract revision
deployed together with `ai-api`, as `AGENTS.md` requires.

---

> **IMPLEMENTED 2026-09-17, with one correction to this plan.** Item 3.4 below
> says `compileProductPrompt` "already emits" `mixed organically rather than
> graded`. **It does not.** The phrase appears in 180 of the corpus captions and
> nowhere in `src/`. Removing the loose asymmetry sentence as written would have
> removed the behaviour with nothing replacing it. What shipped instead: the
> compiler now emits the corpus phrase per clause (`fraseRelacionTamanos`),
> derived from the clause's own confirmed size codes, and only then was the loose
> sentence removed. Only the multi-size half shipped — the corpus also writes
> `all at a single N-inch size`, but *instead of* naming the size per concept,
> and this compiler already puts it in parentheses, so adding the summary said it
> twice.
>
> Item 3.3 also needed narrowing. The plan says "stop emptying the visual
> context"; of its three fields two **are** the venue (`venueKind`,
> `lightingKind`), and in hybrid mode stage 1 is a text-only call that must not
> draw the venue. Only `palette` came back — it is `brief.colores`, the
> customer's colours, and the compiler uses it solely when the clauses carry no
> colour of their own.

### Phase 3 · Align the caption with the model's own dialect — 2 days, ~US$5

Partly pre-measured: §5b already ran the decisive comparison on the approved
v004 slot and identified the change. What remains is to reach the acceptance bar
over 10 plans rather than 1 design and 2 seeds.

Still gated on Phase 0.3 for the vocabulary questions (3.1 and 3.5), because
those must be measured against the corpus of the **active** slot, not v007.

**3.1 — Establish which dialect v004 speaks.** Run `lora-caption-affinity.ts`
against the restored v004 corpus and produce the same table §3 F6 produces for
v007: how captions close, whether props appear, which finish and colour words
dominate, and the length distribution.

**3.2 — Replace `LORA_PRESENTATION_INSTRUCTION` with the corpus's closing
clause.** §5b measured this: `…, set against a plain white studio backdrop, no
floor visible.` scored 7 on isolation where the 290-character prohibition block
scored 4, and carried usability with it. Not a shortened prohibition — the
declarative clause, in the grammar the corpus uses (43 of its 345 captions
mention a white studio).

Note what §5b also settles: **removing the prohibition block without replacing
it changes nothing** (cell B is identical to cell A on every axis). The budget it
frees is not the point; the clause that replaces it is.

**3.3 — Stop emptying the visual context** (`route.ts:1067`). Its purpose —
keeping the LoRA from drawing the venue — is served by 3.2's closing clause,
which the model recognises.

**3.4 — Move the asymmetry patch into the compiler.** `asymmetry means uneven
staggered clusters…` is a loose sentence; the corpus expresses the same
behaviour as `mixed organically rather than graded` (218 occurrences, 180
captions), and `compileProductPrompt` already emits it per clause.

**3.5 — Decide the finish vocabulary from 3.1, not from v007** (F7). If v004
speaks `chrome`, `FINISH_WORDS.reflex = "glossy"` is nearly right and only
`glossy` → `chrome` needs review. If it speaks `high-shine Reflex`, change it.
**Do not guess.**

**Acceptance:** over 10 frozen plans, judged pairwise in a single call per pair,
the new caption beats the current one on photorealism and size variation in
**≥7 of 10**, with no regression in `preflightLoraPrompt`,
`verificarColoresCaptionLora` or `findLoraPromptLanguageLeaks`. Seeds pinned
(Phase 0.1) so the caption is the only variable.

**Rollback:** constants. No migration, no contract change.

---

### Phase 4 · Let the reference arrive as pixels — 3–5 days, ~US$15 · **needs fal balance**

The real ceiling. Two options; measure before choosing.

**Option A — the LoRA edits the space photo directly.** One call instead of two:
`EDIT_ENDPOINT` with the venue photo and a training-register caption.
`buildLoraEditPrompt` and `referenciasParaLoraEdit` are written and tested
(`sempertex-lora.ts:229-305`), and with a venue present `referenciasParaLoraEdit`
already filters to the customer photo alone so `/edit` cannot copy another
background. It removes stage 2 entirely — and with it the contact-shadow and
compositing defect that the earlier measurement blamed for the worst score — and
halves the cost per preview. The risk is real: `/edit` has never been measured
with this LoRA.

**Option B — keep two stages and give each what it lacks.** The reference photo
enters stage 1 as `composition_reference` through `/edit`, and stage 2 as a
third Gemini input with role `palette_reference`. Both roles and their fixed
phrases already exist (`sempertex-lora.ts` `FRASE_POR_ROL`, improved in
`ef9b77b` to number each input); they are simply discarded at
`route.ts:1192`. Also shorten `GEMINI_COMPOSITION_HARD_LOCK` — 680 characters of
negation at the end of a long prompt dilute; what survives is what is specific.

Independent of the choice: Phase 1.4 has already re-admitted reference scenery.

**Acceptance:** against the Phase 3 baseline, over 10 frozen plans, the chosen
option wins on photorealism and usability in **≥7 of 10 and** the visual QA does
not worsen conformance to the approved plan (cardinality, per-structure colours,
elements present). **If quality rises and plan fidelity falls, do not promote
it** — the proposal is what the customer is charged for.

**Rollback:** Option A changes the endpoint and the number of provider calls; it
ships behind an explicit switch until two control runs confirm it.
`SEMPERTEX_LORA_EDIT` already exists as the withdrawal switch.

---

### Phase 5 · Retrain only if the evaluation still fails — 2–3 weeks, ~US$40 · **needs fal balance**

Last, because until Phases 3 and 4 land nobody knows how much of the problem was
the caption and how much is the model.

The v007 rejection report (`lora-run-v007-1000:eval-v1-scale08`, 36/36 valid
generations) is specific: colour **6/6 pass**, finish **0/6**, diameter **0/6**.
> **MEASURED 2026-09-17 — the finish hypothesis below is wrong.** Running
> `scripts/medir-desbalance-dataset.ts` over the 356 usable v007 annotations:
> **40 % of images contain matte and glossy finishes in the same frame** and
> another 44 % are matte-only. `fashion` appears 847 times and `pastel_matte`
> 111 against `reflex`'s 270. The matte/chrome contrast is in the dataset,
> abundantly. So finish 0/6 is **not** a coverage problem and **re-collection is
> not the lever** — the caption or the training is. Retrain plans that assume
> otherwise should be dropped.
>
> The diameter hypothesis **holds**: only **24 % of images have a max/min
> diameter ratio ≥ 2**, and `size_relation` is `single_size` in 236 of 614
> annotated structures. The model rarely saw a 5-inch beside a 36-inch, which is
> exactly the reported failure.

Both failures look like dataset properties, not hyper-parameters:

- **Finish.** ~~The corpus binds brand + colour + form + material into one identity
  (`high-shine Reflex rose gold round latex balloons`). If nearly every real
  order photo carries specular highlight from flash or sun, the model never sees
  the matte/chrome contrast.~~ **Retracted by the measurement above.** The
  contrast is present in 40 % of frames. What to investigate instead: whether
  the caption makes finish *discriminative* (it binds finish into a single
  identity phrase, so the model may never be asked to vary it independently),
  and whether the LoRA rank/scale can carry a material property at all.
- **Diameter.** "5-inch and 24-inch visually similar" is the expected outcome
  when diameter appears only as text with no stable scale reference in frame.
  The fix is a caption that states the size *relation* (`one oversized 36-inch
  topper above 5-inch clusters`) and/or sampling that guarantees diameter
  contrast within a single image. Note this compounds with F5: the runtime
  cannot even emit R-36 for most concepts, so Phase 1.3 must land first or the
  retrained capability stays unreachable.

Before spending: re-label a sample of 40 images with verified finish and
diameter, measure the imbalance, and only then decide between re-captioning
(cheap) and re-collection (expensive).

**Acceptance:** the existing protocol, unchanged to make it pass — `lora-eval-v1`,
6 seeds, minimums 5/6 colour, 5/6 finish, 4/6 diameter — and promotion through
`evaluation_status = approved` in the registry, never through the testing
override.

---

### Phase 6 · Adapt the decoration to the space — 1–2 weeks, ~US$20

The previous five phases make the preview *faithful*. This one makes it
*designed*. It addresses F13 and the complaint it produces: the decoration is
put in front of the space instead of installed into it.

Two halves, and they must stay separate because only one of them touches what
the customer is charged for.

**6.A — Space-aware placement. No commercial risk.** Same structures, same
quantities, same price; only *where* and *how big* changes.

- Replace `automaticTargetBox`'s constants (`route.ts:508-520`) with boxes
  derived from the venue photo. The analyser already does structured vision on
  the reference; point the same capability at the space and extract what a
  decorator would look for: openings worth framing (a porch, a doorway, an
  archway), flat wall suitable for a backdrop, the floor plane and where it
  meets the wall, obstacles, and the eye level.
- Anchor the plan's structures to those findings rather than to frame fractions.
  A focal arch frames the opening it stands beside; lateral columns flank what
  is actually there; a backdrop goes against real wall.
- Scale from the space, not the frame. The venue gives a metric reference (a
  door is ~2 m, a chair ~0.45 m). The plan already declares `dimensiones_m`;
  nothing currently reconciles the two, which is why the baseline rendered an
  arch as tall as the house eaves.
- Change what stage 2 is asked to do. Today the instruction is *transfer* and
  *keep unchanged*; it needs to become *install*: the venue's architecture,
  camera and crop stay fixed, but the decoration may be re-posed, re-scaled and
  re-lit to sit in that space, with contact shadows and the scene's light
  direction. That is a prompt change, and it is the one the current
  `GEMINI_COMPOSITION_HARD_LOCK` actively blocks.

**6.B — Party context. Commercial risk, so it needs a gate.** An empty lawn with
three balloon structures does not read as an event. Tables, chairs, a cake
table, string lights are what make it one.

- Two legitimate sources only: scenery detected in the customer's own reference
  photo (Phase 1.4 re-admitted this), and an explicit ambience toggle.
- Anything from the toggle must be visibly marked as **not quoted** wherever the
  image is shown next to a price. The plan owns what is built and charged
  (`AGENTS.md`); ambience is set dressing and must never be mistaken for it.
- Never silently invented. The existing prohibition list is the right instinct
  applied at the wrong level: the problem is not that props appear, it is that
  props could appear *without the customer knowing they are not buying them*.

**Acceptance:** on the four benchmark cases, a decorator reviewing the output
agrees the decoration is placed where they would place it and is the size they
would build, in ≥3 of 4; the visual QA's `pasted artifact` and
`contact shadows failed` reasons stop appearing; and no unquoted object appears
without its marker. Add a fifth benchmark metric for this — structure and
placement fidelity against the space — since the current four do not measure it.

**Rollback:** 6.A is a placement function plus a prompt; both revert cleanly.
6.B ships behind its toggle, default off.

---

## 6b. Implementation log — what actually shipped

Written as the work landed, 2026-09-17. Each line names the artefact, so a reader
can check the claim instead of believing it. **Nothing here is a plan; it is a
diff.** Items the plan lists and this log does not are not done.

### Phase 0 · measurability

| Item | State | Evidence |
|---|---|---|
| 0.1 pin the seed | **done** | `LORA_EVAL_SEED` in `lora-seed.ts`: an explicit request seed still wins, then the run's seed, then the draw. The customer path is untouched on purpose — variation benefits them, and setting this in production would freeze every preview on one image, so it is an evaluation environment variable and deliberately not a feature flag. A malformed value warns and falls back to the draw rather than producing a run that *looks* deterministic. 8 tests. |
| 0.2 declare the active slot | **partial** | `motorImagenPrevisto` is now populated; the slot's artifact id and evaluation status are recorded as `null` because the resolver does not expose them at the audit point |
| 0.3 corpus resolution | **done (the half that is not blocked)** | `scripts/lora-caption-affinity.ts` resolves the active slot's dataset, accepts `--corpus <path>`, reads both corpus shapes, and fails naming what it looked for instead of silently analysing the wrong model. Runs today against 345 v007 captions. |
| 0.3 restore the v004 corpus | **blocked, cause identified** | `data/processed/export-general-2026-08-27.json` and `data/staging/recaption-v004/` are both absent; the only v004 artefact in the checkout is a *summary* (`lora-v004-composicion.json`) with image lists but no caption text, and the 361 v007 annotations carry v3-contract captions — a different dialect. The corpus has to come from outside this repo. |
| 0.4 deterministic background check | **done** | `outsideRegionSimilarity()` existed and was never called; the retry read a number the vision model invented. Now the measured value decides and the model's is kept, renamed, as a reported opinion. When it cannot be measured (no venue, different byte lengths) the reason does **not** fire — a retry is a paid call, so it fails open. |
| 0.5 record what a diagnosis needs | **done, migration applied** | migration `scripts/migrations/026_generation_diagnostics.sql` **applied 2026-09-17 10:30 UTC**: `plan_audit_log` went from 30 to 31 columns and `diagnostico_generacion` is present. `DiagnosticoGeneracion` in `src/lib/rag/observability/log.ts`; populated from `route.ts`. Input hashes, effective seed, caption hash + length, preflight, dropped sizes and the QA verdict now travel with every generation row. **The ordering was not cosmetic:** the INSERT already named that column as `$29`, Postgres fails the *whole* statement on a missing column, and the `catch` at `log.ts:248` downgrades it to a `console.error` — so against a database without the column the plan audit log stopped writing rows entirely and silently, rather than losing one field. |

### Phase 1 · stop failing closed

| Item | State | Evidence |
|---|---|---|
| 1.1 bilateral focal clause | **done** | `lora-caption-compiler.ts` keys off `clause.bilateral`; `lora-prompt-preflight.ts` accepts the mirror phrase without requiring the word `flanking` |
| 1.2 fixtures | **done** | `scripts/test-lora-caption-bilateral.ts`, 4 cases, in the `plan:test` chain |
| 1.3 surface the dropped size | **done** | `TallaOmitida` in `lora-product-runtime.ts` — a typed condition (`dropped_sizes`) instead of a free-text string in `diagnostics`. It survives the element falling back to legacy rendering, because the customer asked for that diameter either way. |
| 1.3b vocabulary colour gap | **done** | six concepts with catalog-verified ids in `product-vocabulary-data.ts` |
| 1.4 reference scenery with a venue | **done** | the dead `debeConservarEscenografiaDeReferencia` gate was removed outright rather than made to return `true` |

### Phase 2 · colour measured instead of guessed

| Item | State | Evidence |
|---|---|---|
| 2.1 measure dominance | **done, default OFF** | `src/lib/plan/dominancia-color.ts` (pure) + `decodificar-pixeles.ts` (the only `sharp` boundary) + `dominancia-referencia.ts` (enrichment). `measured_colors` is an optional addition to the blueprint's `AppearanceSchema`, so old blueprints still validate and `plan_hash` is untouched. Flag `MEASURED_COLOR_DOMINANCE_V1`. 10 unit tests. |
| — its threshold | **measured, not chosen** | `scripts/calibrar-dominancia.ts`. On the garden photo, radius 30 leaves 24 % unclassified and `verde` at 7 %; radius 35 lets the lawn in at 24 %. The constant sits in that gap and the comment says so, including that the 7 % is sunlit grass and the filter is not perfect. |
| 2.2 stabilise the analyser | **partial** | the palette now comes from the measured shares rather than from `blueprint.palette.observed`, which was the second unstable output. The five-run variance threshold is not yet enforced. |
| 2.3 neutral tie | **done** | `colorCatalogoMasCercano("gris", …)` → `plateado` (ΔE 16 vs `negro`'s 51) |
| 2.4 lightness axis | **done** | CIELAB ΔE through the contract; `scripts/verificar-paridad-color.py` checks TS/Python parity, 8/8 |
| 2.5 decide what grey is | **done, recorded** | ADR-0024 |
| 2.6 proportion as a warning | **done** | `src/lib/plan/proporcion-referencia.ts`, 7 tests. Reports, never enforces. The measured share is renormalised over classified pixels first — without that, every plan would trip it. |
| 2.7 canonicalisation symmetry | **done** | of the three callers of `resolverPlan`, only one canonicalised. It now happens at the door, once. Idempotence is tested, which is what makes moving it safe. |
| 2.8 audit pass carries colours | **done** | The verifier wins only where the inventory is empty — the same rule `category` and `scene_role` already use. A disagreement between the two passes is recorded in `uncertainties` instead of being dropped, because from here there is no way to tell which one is right. |
| 2.9 what the palette may do | **done, recorded** | ADR-0024. Signal, not filter; `ragColoresFotoSinCubrir` records the miss unconditionally, where before only the rare colour-relaxation case left a trace. |
| 2.10 reject ambiguity | **done** | the taxonomy's ambiguity markers are Spanish (`rojo o azul`) and the analyser writes English, so they never fired. Split in `colores-referencia.ts`, which owns photo labels; `mint green` stays one colour. |

### Phase 3 · caption in the corpus's dialect

| Item | State | Evidence |
|---|---|---|
| 3.1 establish v004's dialect | **blocked** | needs the corpus 0.3 cannot recover |
| 3.2 replace the presentation instruction | **done** | the 290-character prohibition block became the measured clause `, set against a plain white studio backdrop, no floor visible.` The caption budget went from 460 to 688 effective characters, and the joining is now grammatical — it is a subordinate clause, so the trailing period is stripped instead of producing `supports., set against`. |
| 3.3 stop emptying the visual context | **done, narrowed** | see the callout in Phase 3 |
| 3.4 asymmetry into the compiler | **done, after correcting the plan** | see the callout in Phase 3 |
| 3.5 finish vocabulary | **blocked** | same corpus |

### Phase 4 · the reference as pixels

| Item | State | Evidence |
|---|---|---|
| Option B, the selection | **done, default OFF** | `src/lib/ia/referencias-etapa1.ts`, 5 tests. In hybrid mode stage 1 received **zero** images, so the customer's photo reached the stage that draws the balloons only as text. The function admits composition references and refuses the venue, the previous result, product photos and the palette — sending the venue would both leak a background into `/edit` and leave stage 2 nothing to do. Flag `REFERENCIA_EN_ETAPA1_V1`. |
| A vs B decision | **for a person** | it needs the 10-plan paid evaluation, and `AGENTS.md` puts promoting a prompt variant with a person |

### Phase 5 · the measurement that decides a retrain

`scripts/medir-desbalance-dataset.ts`, over the 356 usable v007 annotations.
**One of the plan's two hypotheses is wrong** — see the callout in Phase 5. Finish
contrast is present in 40 % of frames, so re-collection is not the lever. Diameter
contrast is weak (24 % of images at a ≥ 2× ratio), so that hypothesis holds.

### Phase 6 · adapting to the space

| Item | State | Evidence |
|---|---|---|
| 6.A venue analysis + placement | **done, default OFF** | `analizar-venue.ts`, `venue-placement.ts` (pure), flag `VENUE_AWARE_PLACEMENT_V1`, 3 tests. Measured by the benchmark's `--colocacion`. |
| 6.A stage-2 instruction | **done, unflagged** | `GEMINI_COMPOSITION_HARD_LOCK` now says *install*, re-pose, re-scale, re-light, with contact shadows — instead of *transfer* and *keep unchanged* |
| 6.B party context | **done as a module, not yet wired** | `src/lib/ia/ambiente-fiesta.ts`, 8 tests. Closed vocabulary (a model may choose from the list, never extend it), hard cap of 4 props, opt-in, and an explicit *not quoted* notice that also fires for scenery taken from the customer's own photo. |

## 7. Reproducing everything in this document

Diagnostics added by this session (no network, no paid calls):

```bash
npx tsx --conditions=react-server scripts/diag-caption-hibrido.ts
```
```bash
npx tsx --conditions=react-server scripts/diag-bilateral.ts
```
```bash
npx tsx scripts/diag-planes-bilaterales.ts
```

Colour variance (**paid**: 2 Gemini calls per repetition):

```bash
npx tsx --conditions=react-server --env-file=.env.local scripts/diag-varianza-colores.ts --foto ejemplo-01 --repeticiones 5
```

Caption register experiment against fal (**paid**; the run in §5b cost US$0.168):

```bash
npx tsx scripts/exp-registro-caption-v004.ts --dry-run
```
```bash
npx tsx scripts/exp-registro-caption-v004.ts --confirm-spend --max-usd 0.60
```

Then reduce the renders and score them in one judge call (**paid**, 1 call):

```bash
npx tsx scripts/diag-miniaturas.ts reports/lora-debug/registro-caption-v004
```
```bash
npx tsx --env-file=.env.local scripts/diag-juez-registro.ts reports/lora-debug/registro-caption-v004
```

Training corpus distribution and colour distance probe:

```bash
node /c/tmp/pa/vocab.js
```

LoRA registry state:

```bash
node --input-type=module -e "import pg from 'pg'; process.loadEnvFile('.env.local'); const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); const r=await p.query(\"SELECT s.slug, r.id, r.dataset_id, r.trigger_token, r.evaluation_status FROM lora_mode_slots s LEFT JOIN lora_training_runs r ON r.id=s.training_run_id\"); console.table(r.rows); await p.end();"
```

Verification gate before calling any phase done (`AGENTS.md`):

```bash
npx tsc --noEmit && npm run -s lint && npm run plan:test
```
```bash
uv run --directory services/ai-api pytest -q
```

---

## 8. What not to do

- **Do not raise `guidance_scale` or the LoRA scale.** Already measured: flat at
  8.0–8.5 across 2.5–5.0 and 0.6–1.0. The creativity levels
  (`creatividad.ts`, 2.0–4.5) neither explain nor fix this. REPORTED,
  `LORAGEMINI.MD` §4.2.
- **Do not add another prohibition to the caption.** None exists in the training
  register — 0 of 345 captions contain an imperative — and §5b measured that the
  existing block does not even achieve what it asks for: 4/10 on isolation
  against 7/10 for one declarative clause.
- **Do not simply delete the prohibition block either.** MEASURED in §5b: cell B
  removes it and scores identically to production on every axis. Deleting it
  frees budget and buys nothing; the value is entirely in what replaces it.
- **Do not act on the finish vocabulary before Phase 0.3.** The v007 corpus says
  `high-shine Reflex`; the active v004 model may well speak `chrome`, which is
  what the runtime already emits. Changing it now could make things worse.
- **Do not retrain the LoRA yet.** Until Phase 4, nobody knows how much of the
  problem was the register.
- **Do not judge quality on `training_2`.** It is rejected and production cannot
  serve it.
- **Do not turn the visual QA off to make images pass.** It was the only
  component that saw the problem: `appearance failure EST_01_COL_IZQ |
  appearance failure EST_02_COL_DER` is in the audit log, correctly, repeatedly,
  and was delivered anyway.
- **Do not change image provider before Phase 4.** Stage 2 performs according to
  what it receives; changing it now moves the wrong variable.
- **Do not compare judge scores across runs.** The rubric judge recalibrates to
  the set it is shown — the same variant scored 7 in one batch and 8.5 in
  another. Scores order variants *within one call*; they are not an absolute
  metric.

---

## 8a. Why a wine-and-silver reference still renders pink

Found 2026-09-17 from a real app run the user showed, not from the benchmark —
which could not have found it. Reference `ejemplo-07`, "Marco vino y plata":
burgundy + grey + silver + white. Output: a **pink** balloon arch wrapped round a
load-bearing post. Three independent causes, and the benchmark was blind to two.

**1. `burdeos` had no product concept, on a false premise.** The measured palette
is `negro 41 %, dorado rosa 40 %, plateado 8 %, burdeos 7 %, gris 2 %`; the scene
could draw only `negro, dorado rosa, plateado`, so **rose gold at 40 % became the
lead colour — that is the pink**. The vocabulary comment justified excluding
`burdeos` by asserting the catalog "deliberately has no single-colour round latex
product" for it. Queried against the live catalog, it does:
`B2b Globo Latex Redondo Metal Vinotinto`, product_id `8634257539367`, published,
variants R-5 / R-9 / R-12 (only R-9 in stock today). The same assertion covers
six other colours and is false for all seven; for champagne, coral, menta and
nude it was merely stale — they are already drawable through other concepts.
**Fixed:** `balloon.round.latex.metal.burgundy` added with verified SKUs, comment
corrected. `burdeos` now resolves to product `20000546`, and `ejemplo-07`'s
renderable set gains it. The vocabulary's 8-digit ids were checked before
trusting them — they are `sku_canonical` values, 3/3 matched, not stale.

**2. `burdeos` also loses the pixel vote, which the fix above does not address.**
`scripts/calibrar-dominancia.ts` over the whole photo gives `gris 50 %,
plateado 21 %, negro 13 %, cafe 8 %` and **`burdeos` never appears at any radius
from ΔE 15 to 45**. The wine of a real balloon under event lighting is far more
desaturated than the nominal catalog hex, so neutrals win. A concept makes wine
*drawable*; it does not make the measurement *ask* for it. The lever is measured
hexes from product photography instead of nominal ones, or more than one centroid
per colour — not a threshold tweak.

**3. Two gaps that are a person's call, not a loop's.**
`clasificarColores` maps neither `grey`/`gray` → `gris` nor `lilac`/`lavender` →
`lila` nor `turquoise` → `turquesa`, so those three can never reach a scene even
though all three products exist. And the 12-class structure taxonomy has no
**`marco`** (frame): balloons across the top *and* down both sides enclosing a
table. The reference's own name is "Marco…" and the analyser labelled it
"arco asimétrico", because an arch is the closest class available. Both are
colour/structure taxonomy changes, which `AGENTS.md` reserves for a person.

**Correction to §6b's flag recommendation.** I wrote that all four new flags
should stay off. That contradicted my own benchmark: the two best runs (phases 2
and 3, QA 2/4) had `MEASURED_COLOR_DOMINANCE_V1` *and*
`VENUE_AWARE_PLACEMENT_V1` on — the decline to 1/4 and 0/4 came from adding
`AMBIENTE_FIESTA_V1` and then `REFERENCIA_EN_ETAPA1_V1`. Placement is also the
flag that reads obstacles, which is exactly the post the arch was wrapped around.
The measured recommendation is **those two on, the other two off**.

## 8b. Running the stack locally — two defects found doing it

Verified 2026-09-17 by actually bringing both processes up on this machine, not
by reading the commands. `AGENTS.md`'s local-run block is correct about the
*shape* but cannot produce a ready service as written, for two independent
reasons in `.env.local`:

1. **`DATABASE_URL` carried a shell escape.** The value was unquoted and
   contained `require\&channel_binding=require`. uv's dotenv parser rejects the
   line outright (`Failed to parse environment file … at position 128`) and
   drops it, so the Python service starts with no database and `/readyz`
   answers `not_ready`. Node's `loadEnvFile` does not reject it — it keeps the
   backslash, so `sslmode` was silently never honoured on the TypeScript side
   either. Fixed by quoting the value and removing the escape; `pg` then treats
   `sslmode=require` as `verify-full` and still connects.
2. **`CATALOG_DATABASE_URL` was absent.** `main.py` builds `catalog_store` only
   from that variable and deliberately does **not** fall back to
   `DATABASE_URL` (operational and catalog stores are separate by design), so
   `/readyz` fails its third check. The catalog tables (`catalog_products`,
   `catalog_variants`, 1411 products) live in the same Neon database, so the
   same DSN is the right value locally.

A third item is environment-specific rather than a defect: `PYTHON_BACKEND_URL`
in `.env.local` is `http://demo-decoracion-ai-api:8000`, the compose service
name, which does not resolve from the Windows host. Overriding it per process
(`PYTHON_BACKEND_URL=http://127.0.0.1:8000 npm run dev`) is enough; the file
should keep the compose value.

With all three handled: `/healthz` ok, `/readyz` `{"status":"ready"}`,
`npm run rag:stack-check` READY on every row (Postgres, pgvector 768, pg_trgm,
unaccent, embedding provenance), Next on :3010 serving `/login`.

`uv` itself was not installed. `python -m pip install uv` works, but
`uv python install 3.12` fails on this machine with `Missing expected target
directory for Python minor version link` — the interpreter *is* extracted and
usable, only the minor-version symlink is missing, so passing the versioned
interpreter path explicitly (`--python …/cpython-3.12.14-…/python.exe`) gets
`uv sync` through. The project needs `>=3.11,<3.13` and the system Python is
3.13. With that done the Python suite runs for the first time in this line of
work: **`pytest` 210 passed, 4 skipped** (the four want a local Postgres and
refuse to run against Neon), **`ruff` clean**, **`mypy` no issues in 11 files**.

## 9. Cost and sequencing summary

| # | Phase | Cost | Impact | Rollback |
|---|---|---|---|---|
| 0 | Make it measurable (+ rotate the dead key, X2) | 1 d · US$0 | enables everything | additive |
| 1 | Stop failing closed, stop losing data | 2–3 d · US$0 | **high** — removes dead requests and silent loss | per item |
| 2 | Colour measured instead of guessed | 1 w · ~US$5 | **high** — all of Problem 2 | contract for 2.4 |
| 3 | Caption in the model's dialect | 2 d · ~US$5 | high — change already identified in §5b | constants |
| 4 | Reference arrives as pixels | 3–5 d · ~US$15 | **the real ceiling** | switch |
| 5 | Retrain for finish and diameter | 2–3 w · ~US$40 | medium, late | do not promote |
| 6 | Adapt the decoration to the space | 1–2 w · ~US$20 | **the "it looks pasted on" complaint** | function + prompt, toggle for 6.B |

Provider credit is no longer a blocker: the funded account holds US$47.43 and
the §5b run cost US$0.168, so the whole plan's measurement budget is roughly
1.5 % of what is on hand. **What is still urgent is X2** — the key deployed in
production is dead, so production cannot render at all until it is rotated.

**If only one phase is done: Phase 1.** It is the only one that turns requests
that currently produce nothing into requests that produce an image, and it costs
no provider credit.
