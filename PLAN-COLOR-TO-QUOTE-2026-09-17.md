# Plan — getting the photo's colours all the way to the quote

**Written 2026-09-17 06:10 (SAPST)** against `fase-a/a0-linea-base` at commit
`dad9f6f`, working tree dirty. Sibling of `PLAN-IMAGE-AND-COLOR-FIDELITY.md`,
which this document does not repeat: that one covers why colour was never
*measured*. This one covers why a measured colour still does not reach the
customer's quote.

Every claim below says how it was checked. Claims I could not check are marked
**not established** and carry the reproduction that would settle them. Nothing
here is "done" unless §7 says it landed.

---

## 0. What triggered this

Two real app runs, shown by the user. Neither was findable by the benchmark, and
that is itself a finding (D10).

**Run A — reference "Marco vino y plata"** (burgundy + grey + silver + white,
balloons framing a dessert table). Output: a **pink** arch draped around a
load-bearing wooden post on a patio.

**Run B — reference with pink + white + silver + clear bubble balloons**, two
asymmetric columns. Quote returned nine line items across exactly two products:
`Globo Latex Redondo Reflex Plata` and `Globo Latex Redondo Fashion Palo De
Rosa`. **No white. No clear.** Total $104.736.

The customer-visible failure is the same in both: the proposal is priced and
rendered in colours the customer did not ask for, and nothing tells them a
colour was dropped.

---

## 1. Defect register

| # | Symptom the customer sees | Verified cause | Owner |
|---|---|---|---|
| D1 | wine reference renders pink | `burdeos` had no product concept, excluded on a false premise | **fixed today** |
| D2 | clear/bubble balloons never quoted | `transparente` had no product concept | **fixed**, verified 2026-09-17 (§7) |
| D3 | clear balloons not even detected | `clear` and `cristal` are not aliases of `transparente` | **fixed today**, authorised by the user |
| D4 | grey dropped | `grey`/`gray` are not aliases of `gris`, and `gris` has no concept | person (taxonomy + ADR-0024) |
| D5 | lilac / turquoise dropped | not aliases either, though products exist | **fixed today**, authorised by the user |
| D6 | wine still under-asked even with D1 fixed | `burdeos` loses the pixel vote at every radius | me, needs photos |
| D7 | **white missing from the quote** | two mechanisms, both established (§3) | person (taxonomy + `plan_hash`) |
| D8 | a frame is proposed as an arch | no `marco` class in the 12-class structure taxonomy | person (taxonomy) |
| D9 | arch wrapped around a structural post | obstacle-aware placement ships off | person (flag) |
| D10 | none of D7/D8 is caught before release | the benchmark uses one fixed fixture and never quotes | **fixed**, 2026-09-17 (§7) |

---

## 2. D2 — `transparente` cannot be drawn or quoted

**Checked.** `PRODUCTO_POR_COLOR["transparente"]` returns no product, so
`repartirColores` files it under `sinConcepto` and the scene drops it. The
catalog does carry a plain clear round latex balloon, published, in the **full
size range** — wider than most colours:

```
B2b Globo Latex Redondo Fashion Transparente   product_id 8634277003559
R-5=20000496  R-9=20000633  R-12=20000783  R-18=20000928
R-24=20012073 R-36=20009317 R-40=20000974
```

Note what "Cristal" means in this catalog, because it is easy to get wrong:
`Cristal Pastel Amarillo/Azul/Lila/Rosado/Verde` is a **translucent finish over
a colour**, not clear. The clear one is `Fashion Transparente`. A concept that
pointed at a `Cristal Pastel` product would quote the wrong balloon.

**Fix.** One concept, same shape as the `burdeos` one that landed today:

```ts
concept_id: "balloon.round.latex.fashion.clear",
canonical_label: "round latex balloon in clear, solid Fashion finish",
catalog_titles: ["B2b Globo Latex Redondo Fashion Transparente"],
visual: { family: "Fashion", shape: "round", material: "latex",
          color: "transparent", finish: "Fashion matte", pattern: { kind: "solid" } },
catalog_product_ids: ["20000496", "20000633", "20000783"],
sizes: { separate: true, allowed_codes: ["R-5","R-9","R-12","R-18","R-24","R-36","R-40"] },
```

**One thing to settle before writing it.** `visual.color` must be a word that
`clasificarColores` maps to `transparente`, or the concept never reaches a
scene — that is exactly the trap D3 describes. `"transparent"` works today;
`"clear"` does not. Use `"transparent"`.

**Also check, do not assume:** `dominancia-color.ts` lists `transparente` in
`NO_MEDIBLES`, so a clear balloon is deliberately excluded from *pixel*
measurement — correct, since a clear balloon has no colour of its own and its
nominal hex is `#ffffff`, which would steal every white pixel. So D2 makes clear
**quotable** and **drawable**, but its share will keep coming from the
analyser's labels, not from pixels. That is the right split; it should be stated
in the concept's comment so nobody later "fixes" it by removing the exclusion.

**Cost** ~1 h. **Risk** low, additive. **Rollback** delete the concept.

---

## 3. D7 — white is missing, and the cause is established

**Settled 2026-09-17, second session.** It is not one of the three candidates as
this section first framed them, and the third — "the analyser never wrote it" —
is ruled out outright: `white` is the **first** raw label on `ejemplo-01`,
`ejemplo-02` and `ejemplo-07`, and present on `ejemplo-06`, in every run.

**Correction to the reproduction this section proposed.** `diagnostico_generacion`
does **not** record the palette. Migration 026 did land (`plan_audit_log` has 31
columns and 5 rows carry the column), but `DiagnosticoGeneracion` at
`log.ts:154` holds input hashes, seed, caption hash and length, preflight,
dropped sizes and the QA verdict — no colour of any kind. The SQL in the earlier
draft returns a row that cannot answer the question. What did answer it was
already in the repository: `informes/bench/fase-*/resultado.json` records
`coloresCrudos`, `paletaCatalogo`, `paletaBusqueda`, `renderizables` and
`participaciones` for four references across six runs, at no cost.

There are **two independent mechanisms**, and which one is live depends on
`MEASURED_COLOR_DOMINANCE_V1`.

### Mechanism 1 — the flag is off, which is production today

`coloresFotoParaBusqueda` builds the palette from each approved structure's
`coloresDominantesReferencia`, which cuts at `MAX_COLORES_REFERENCIA = 3` **per
element**, in the analyser's writing order. White is listed but seldom first for
any single element, so it falls off that cut before the palettes are unioned.

Measured at `fase-1` (flag off): `blanco` is in `paletaCatalogo` for
`ejemplo-01`, `ejemplo-06` and `ejemplo-07`, and missing from `paletaBusqueda`
for `ejemplo-01` and `ejemplo-06`.

This is candidate cause 1 — truncation — confirmed. The reason reading
`MAX_COLORES_FOTO_CLIENTE` would not have found it is that the binding cap is
the per-element one, not the one on the final list.

### Mechanism 2 — the flag is on: a photographed white is not `#ffffff`

`blanco` is anchored at `#ffffff`, L*100. `plateado` sits at L*76.2 and `gris`
at L*60.3, so the blanco/plateado watershed is at about RGB 220. A balloon is a
curved surface: only its specular highlight reaches 240, and most of it sits
between 170 and 215. Computed with `labDeRgb`, at the shipped classification
radius:

| pixel | classified as |
|---|---|
| 255,255,255 | blanco |
| 235,232,228 | blanco |
| 225,222,218 | blanco |
| 215,212,208 | **plateado** |
| 185,182,178 | **plateado** |
| 170,167,163 | **gris** |

So the measurement reads white decoration as silver and grey, and the shadow
between balloons as `negro`. On `ejemplo-07` — a white-and-burgundy garland on a
white curtain, with no black anywhere in the photo — the whole-image measurement
gives `gris` 50 %, `plateado` 21 %, `negro` 13 %, and `blanco` under 2 %
(`scripts/calibrar-dominancia.ts`). The palette that reached the plan at
`fase-2` is `negro` at 37.8 %, dominant. Then `gris` is outside
`PALETA_COLORES_V2` by ADR-0024, so half of the measurement is discarded a layer
later and what survives is silver and black.

That is the same photo whose first raw label is `white`. It is also, on its own,
a sufficient explanation for why the flag measured QA-negative and ships off.

### A third thing the data shows, not previously recorded

`coloresFotoCliente` and `coloresFotoParaBusqueda` disagree about white **in both
directions on the same blueprint**. At `fase-2`, `ejemplo-01`: the customer-facing
palette ranks `blanco` fifth and last, the search palette ranks it **first**. At
`ejemplo-07` the customer palette has no `blanco` at all while the search palette
does. They are computed from different sources — area-weighted `measured_colors`
over every element, against per-element dominants of approved balloon structures
only — so they will keep disagreeing. The card the customer reads and the palette
that buys product are not the same list, and nothing says so.

### What this does not settle, deliberately

Neither fix is mine to take:

- Mechanism 2 is an anchor change in `HEX_COLORES_OBSERVABLES`. That table travels
  through the contract to Python (`scripts/verificar-paridad-color.py`), so it
  moves every classification and therefore `plan_hash`. It is a taxonomy change
  and belongs with D4, with a person.
- Mechanism 1 is widening or reordering a per-element cap. §9 already names that
  as detection widening: it moves `plan_hash` and approved plans in flight must
  keep the numbers they were approved with.

**Cost** the reproduction was ~1 h and is done. The fix is a decision, not an
estimate.

---

## 4. D3 / D4 / D5 / D8 — one taxonomy batch, and it is not mine to decide

`AGENTS.md` reserves taxonomy changes for a person. These four are all taxonomy,
so they travel together as one decision rather than four drive-by edits.

**D3 — colour aliases for `transparente`.** Measured:

| word | resolves to |
|---|---|
| `transparent` | `transparente` |
| `crystal` | `transparente` |
| **`clear`** | **unknown** |
| **`cristal`** | **unknown** |

The analyser writes English and its word for this is `clear` — it is literally
in `ejemplo-07`'s raw labels. The catalog writes Spanish and its word is
`Cristal`. Neither resolves. So the two vocabularies that actually produce this
colour are the two spellings missing from the alias list, while the two that do
resolve are spellings nothing emits. Proposed: add `clear`, `clara`,
`cristal`, `transparente` to the `transparente` aliases.

**D4 — grey.** `grey` and `gray` both resolve to nothing, and `gris` has no
concept, although the catalog has three grey round latex products
(`B2b Globo Latex Redondo Fashion Gris` 8634227261735, SKUs R-5=20000494,
R-9=20000632, R-12=20000782, R-24=20013063). But ADR-0024 already decided that
**grey is sold as silver and the customer is told**, and the ΔE substitution
maps `gris → plateado` at distance 16. So there are two coherent answers and
they must not both be implemented:
- (a) add the aliases and the concept — grey becomes its own sellable colour;
- (b) keep ADR-0024 — add the aliases only, and let the substitution carry it to
  `plateado`, so the customer sees silver and a note.
My reading is **(b)**, because it is the decision already recorded and because
grey latex and silver Reflex are not interchangeable on a real installation.
Either way the aliases are needed: without them grey is not detected at all,
which is neither (a) nor (b).

**D5 — lilac and turquoise.** `lilac`, `lavender`, `turquoise` all resolve to
nothing; the products exist (`Fashion Lila` 8634232996135 R-5..R-36,
`Fashion Azul Turquesa Profundo` 8923545141543 R-5..R-24). Lower urgency than
D3 — no reference in hand needed them — but the same one-line fix.

**D8 — a `marco` (frame) class.** Explored in full in §10, which is where the
estimate lives; the summary is that a frame is an arch with corners instead of a
curve, so it is a formula change and not a new family. The 12 official classes are `arco`,
`arco_organico`, `semiarco_organico`, `columna`, `columna_organica`, `pared`,
`guirnalda`, `centro_mesa`, `bouquet`, `figura`, `aro_circular`,
`techo_globos`. There is no frame: balloons across the top **and** down both
sides, enclosing a table. Run A's reference is named "Marco vino y plata" and
the analyser called it `arco asimétrico`, because an arch is the nearest class
that exists. A frame is not an arch — it has two vertical runs that a quote must
count — so this is a real modelling gap, not a labelling nicety. It is also the
most expensive of the four: a new class touches the analyser's prompt, the
structure geometry, the evaluation suites and the golden vectors. It should be
its own decision with its own estimate, not folded into the alias batch.

**Cost** aliases ~1 h plus a taxonomy version bump and golden-vector
regeneration; `marco` is days, not hours. **Risk** the aliases widen what is
detected, so some photos will gain a colour they did not have — which is the
point, but it moves `plan_hash` for new plans and must not be backfilled.

---

## 5. D6 — even with a concept, wine does not win the pixel vote

**Checked** with `scripts/calibrar-dominancia.ts` over `ejemplo-07`:

| radius | classification |
|---|---|
| ΔE<15 | unclassified 36 %, gris 33 %, plateado 21 %, negro 5 % |
| ΔE<25 | gris 50 %, plateado 21 %, negro 12 %, cafe 8 % |
| ΔE<45 | gris 50 %, plateado 21 %, negro 13 %, cafe 8 % |

`burdeos` **never appears, at any radius from 15 to 45**. Element-level
measurement with the enrichment filter gives it 7 %, behind `negro` at 41 % —
i.e. the wine balloons are being read as black and grey. The cause is that the
nominal catalog hex for `burdeos` is far more saturated than a real wine balloon
under event lighting, so the neutral centroids win.

**What not to do.** Widening the radius is already measured and it is worse: at
ΔE<35 the lawn classifies as catalog `verde` (24 % of the garden photo). The
threshold is not the lever.

**What to do.** Replace the nominal hexes with hexes **measured from product
photography**, and allow more than one centroid per colour where a finish
changes the reading (Metal wine under warm light is a different point in LAB
than the nominal swatch). Concretely: sample each product's own catalog image,
take the modal balloon colour, and store it in the contract table next to the
nominal hex so both TypeScript and Python see the same thing. The measurement
script can be written now; it needs a person to confirm the image set is
licensed for this use.

**Cost** ~1 d for the measurement harness, unknown for the palette review.
**Owner** me for the harness, a person for the go-ahead.

---

## 6. D9 and D10 — the flag, and the blind benchmark

**D9. Correcting my own recommendation.** On 2026-09-17 I told the user all four
new flags should stay off. That contradicted my own benchmark: the two best runs
(phases 2 and 3, QA 2/4) had `MEASURED_COLOR_DOMINANCE_V1` **and**
`VENUE_AWARE_PLACEMENT_V1` on; the decline to 1/4 (phase 4b) came from adding
`AMBIENTE_FIESTA_V1` and to 0/4 (phase 4) from adding
`REFERENCIA_EN_ETAPA1_V1`. Placement is also the only flag that reads
obstacles — the post that Run A's arch was wrapped around. **Measured
recommendation: those two on, the other two off.** The dev server has been
restarted with exactly that pair so the next generation shows it.

**D10. The benchmark cannot see the defects that actually reached the user.**
It builds every scene from one fixed fixture (`plantilla-arco-dos-columnas`),
so structure fidelity is untested by construction — D8 was invisible. And it
stops at the image: it never quotes, so a colour that is detected, folded, and
then silently dropped before the line items — D7, D2 — leaves no trace in it.
Two additions, both free:
1. **Quote assertion.** For each case, compare the quote's distinct product
   colours against the reference's renderable palette and report the difference.
   A colour in the palette with no line item is the D7 class of defect, caught
   automatically.
2. **Structure fidelity.** Record the analyser's structure classes for the
   reference alongside the fixture's, so a frame-read-as-arch is a number in the
   report rather than something a person has to notice in a screenshot.

**Cost** ~half a day. **Risk** none, it is a harness.

---

## 7. What already landed, 2026-09-17

| Item | Evidence |
|---|---|
| `burdeos` concept added | `balloon.round.latex.metal.burgundy` in `product-vocabulary-data.ts`, backed by `B2b Globo Latex Redondo Metal Vinotinto` (`8634257539367`, published; SKUs R-5=20000546, R-9=20000695, R-12=20000863; only R-9 in stock today). `PRODUCTO_POR_COLOR["burdeos"]` now returns `20000546`, and `ejemplo-07`'s renderable set gains `burdeos`. |
| the false premise corrected | the comment claiming the catalog "deliberately has no single-colour round latex product" for seven colours is replaced with the queried truth: all seven exist and are published; for champagne, coral, menta and nude the claim was merely stale, they were already drawable. |
| verification | `npx tsc --noEmit` clean, `lora:test-product-runtime` 52/52, `npm run plan:test` exit 0 with zero failures. |

Not landed, deliberately: the eight-digit ids in this file are `sku_canonical`
values, not Shopify product ids — checked, 3/3 matched — so they are valid and
were left alone rather than "modernised".

### Second session, same day

| Item | Evidence |
|---|---|
| **D2 was already done** — verified, not re-implemented | `balloon.round.latex.fashion.clear` is active in `product-vocabulary-data.ts` with `color: "clear"`, `pattern.kind: "solid"` and 7 catalog ids, and `PRODUCTO_POR_COLOR["transparente"]` resolves to `20000928`. It landed with phase 1.3b ("six concepts with catalog-verified ids"), which this register did not know about. The concept this section proposed writing would have been a duplicate. Confirmed against the benchmark too: `transparente` is in `sinConcepto` at `fase-0` and gone from `fase-1` on. |
| **D7 established** | §3, rewritten. Two mechanisms, evidence in `informes/bench/fase-*/resultado.json` and `scripts/calibrar-dominancia.ts`. Neither fix is takeable without a person. |
| **D10 landed** | `coloresDeEscena` and `estructurasDeEscena` in `scripts/bench/escena.ts`; `cotizados`, `sinLinea` and `PistaEstructura` in `scripts/bench/tipos.ts`; computed in `bench-fidelidad.ts`; two new report rows and two new table columns in `bench/informe.ts`. 5 tests in `scripts/bench/escena.test.ts`, registered as `bench:test-cotizacion` and appended to the `plan:test` chain. |
| the blind spot D10 actually closes | the template colours the arch with `slice(0, 3)` and each column with `slice(0, 2)`, so a fourth renderable colour reaches no piece at all while the report counted it under `renderizables`. `ejemplo-06` at `fase-1` is exactly that case — `["rosado","azul","morado","blanco"]` — and it is the first test. |
| old runs stay honest | the new aggregates are `number | null`: a run from before D10 renders "—", not 0. A run that measured nothing and a run that lost nothing are different facts. |
| `bench-informe.ts` takes `--raiz` | the harness works in `reports/` (now gitignored) while the committed snapshot is `informes/`, so the committed report could not be regenerated from a clean checkout. Default unchanged. |

**Not done, and why.** The D7 fixes. Both move `plan_hash` — one through the ΔE
table that crosses the contract into Python, the other through detection
widening that §9 already rules out unilaterally. They are listed for a person
below rather than taken quietly.

---

## 8. Order of work

Items 1 to 3 are done; what is left is what needs a person or a photo set.

1. ~~**D7 repro**~~ — done, §3. It found two mechanisms instead of one, and
   corrected this document's own reproduction instructions.
2. ~~**D2**~~ — was already shipped by phase 1.3b; verified rather than rewritten.
3. ~~**D10**~~ — the quote assertion and the structure-fidelity record are in the
   harness, with tests, so 1 and 2 cannot silently regress.
4. **D4 + D7 mechanism 2 + D3/D5 follow-up** — one taxonomy decision now, not
   two. The `blanco` anchor is the same class of question as "what is grey":
   both are about a colour label whose nominal hex is not what a camera records.
   Person, and it moves `plan_hash`.
5. **D7 mechanism 1** — the per-element cap at `MAX_COLORES_REFERENCIA = 3`.
   Cheaper than 4 and independent of it, but still detection widening. Person.
6. **D9** — confirm or reject the two-flag recommendation on a real generation.
   Person. Blocked in practice until the fal key is rotated (§X2 of the fidelity
   plan): the key in `.env.production` and on the server is still the exhausted
   one.
7. **D6** — measured hexes. Needs the photo set cleared.
8. **D8** — the `marco` class, on its own estimate.

## 9. What this plan deliberately does not propose

- **Widening the classification radius.** Measured: it turns the lawn green.
- **Removing `transparente` from `NO_MEDIBLES`.** Its nominal hex is `#ffffff`;
  it would eat every white pixel and make D7 worse.
- **Turning on `AMBIENTE_FIESTA_V1` or `REFERENCIA_EN_ETAPA1_V1`.** Both are
  measured as QA-negative, and the first also needs its "not quoted" notice
  visible in the UI first.
- **Backfilling existing plans** with any new colour. Detection widening moves
  `plan_hash`; approved plans in flight must keep the numbers they were approved
  with.

---

## 10. Exploration — a `marco` is an arch with corners, not a new family

The user's framing, 2026-09-17, and it changes the estimate: **a frame is the
same structure as an arch, except the top corners are square instead of
curved.** That is a geometry formula, not a new product family — so it reuses
the arch's counting, mixing, pricing and caption machinery instead of needing
its own.

### 10.1 Why it is not free: the two shapes do not cost the same

`_axis_length` in `services/ai-api/app/plan.py:569` measures an arch as half the
perimeter of an ellipse with `a = ancho/2`, `b = alto` (Ramanujan):

```
arco   = pi * (3(a+b) - sqrt((3a+b)(a+3b))) / 2
marco  = 2 * alto + ancho                     # three sides of a rectangle
```

For the official default arch, 3 m wide x 2.4 m high:

| shape | axis length | balloons, relative |
|---|---|---|
| `arco` | **6.21 m** | baseline |
| `marco` | **7.80 m** | **+25.7 %** |

So the current behaviour — the analyser reading a frame as `arco_asimetrico`
because no frame class exists — **under-quotes the installation by about a
quarter** on the same bounding box. That is the commercial reason to do this,
and it is a stronger reason than the picture looking wrong.

### 10.2 What the exploration has to settle, in order

1. **Is `marco` one class or two?** A frame that reaches the floor on both
   sides (Run A's reference) is `2*alto + ancho`. A frame that stops partway
   down is a different length. Decide whether `marco` takes its side drop from
   `alto` always, or whether a second field is needed. Cheapest answer first:
   one class, sides run the full height, and an asymmetric variant later if a
   real reference needs it.
2. **Does it belong to the `arco` family for evaluation?** `familiaDesdeClaseOficial`
   maps classes to families to stratify the evaluation suites. `marco -> arco`
   keeps the suites comparable; a new `marco` family splits the baseline and
   every stratified number moves. Prefer `marco -> arco`.
3. **Is it `_LINEAR_STRUCTURES`?** Yes — it is measured along an axis like the
   arch, the semiarch, the garland and the column, so it inherits the same
   linear density and mix handling. This is what makes the change small.
4. **Two corners, and what happens at them.** Real frames cluster balloons at
   the corners. If the count is a flat length x density, the corners are
   under-filled relative to a real installation. Check whether
   `_band_profile_factor` (`plan.py:577`) can express that, since it already
   exists to vary width along a band; if it can, no new concept is needed.
5. **What the caption must say.** A frame is described to the LoRA differently
   from an arch: "framing the table on three sides" rather than "arching over".
   The compiler already has per-class phrasing, so this is a string plus a test,
   not a new mechanism.

### 10.3 Blast radius, named

This is the part that makes it days rather than hours, and none of it is
optional:

- **`plan.py`** — the formula, `_OFFICIAL_GEOMETRY` defaults, `_GEOMETRIC_TYPES`
  and `_LINEAR_STRUCTURES`. Python owns the numbers; TypeScript must not
  recompute them.
- **`estructuras-oficiales.ts`** and `GRAMATICA_OFICIAL` in
  `presentacion-cliente.ts` — the name, gender and plural for the customer card
  ("el marco", "los marcos").
- **`x-geometria-estructuras-oficiales`** in
  `contracts/domain/v1/plan-decoracion.schema.json` — the geometry travels by
  contract, so the export/regenerate chain runs in one direction:
  Zod -> `contracts:export:domain` -> `generate_models.py` -> golden vectors.
- **Golden vectors** — `expected_python` regenerates from the resolver;
  `expected` is the frozen oracle and is edited **by hand, deliberately**, with
  the commit saying why. A new class means new vectors, not edited old ones.
- **The analyser prompt** — production's reference-analysis prompt is
  byte-frozen, so `marco` arrives as a candidate variant appended on request,
  never as an edit to the frozen text. The evaluation baseline stays valid.
- **`familia-clase.ts`** and the evaluation suites — a 13th class, with the
  family decision from 10.2.2.

### 10.4 What would make this cheap, and the trap

Cheap path: `marco` is a class whose axis length is `2*alto + ancho`, family
`arco`, linear, one caption phrase, one golden vector set. Roughly a day of work
plus the contract chain.

The trap is doing it as a *presentation* alias — teaching the analyser to say
"marco" while the plan still computes an arch. That would make the picture
right and keep the quote 25.7 % short, which is worse than today: today at
least the wrong shape and the wrong price agree with each other. **Either the
formula changes or nothing changes.**

---

## 11. Landed after the user's authorisation, 2026-09-17 ~06:40

The user authorised the alias half of §4 explicitly ("añadir clear y cristal,
agregar alias lila y turquesa"). Grey (D4) was **not** authorised and was left
alone: it still carries the ADR-0024 conflict described in §4.

| Change | Where | Evidence |
|---|---|---|
| `clear` added to the `transparente` **colour** aliases | `src/lib/rag/taxonomy/v2.ts` | `clasificarColores("clear")` → `transparente`; `"pink and clear balloons"` → `rosado, transparente` |
| `cristal` added to the `transparente` **finish** aliases, not the colour ones | same file | see 11.1 — this is a deliberate change to what was asked |
| `lilac`, `lavender`, `lavanda`, `lilas` → `lila` | same file | `clasificarColores("lilac")` → `lila` |
| `turquoise`, `turquesas` → `turquesa` | same file | `clasificarColores("turquoise")` → `turquesa`; also removes a duplicated `"turquesa"` entry that was in the list twice |
| `etiquetaColorAcabado()` | `src/lib/plan/presentacion-cliente.ts` | see 11.2 — a latent defect the alias change exposed |

Verification: `npx tsc --noEmit` clean, `npm run contracts:check` clean
(9 chat + 30 domain schemas — the palette enum did not change, only aliases, so
no contract regeneration was needed), `npm run plan:test` exit 0 with 153 `[PASS]`
lines.

### 11.1 Why `cristal` went on the finish axis instead of the colour axis

Asked for as a colour alias; putting it there would have been wrong, and the
catalog says why. Five published products are named `Cristal Pastel <colour>`,
where **Cristal is a translucent finish over a colour**, not clear. As a colour
alias, those five would have read as transparent *and* their real colour at
once. Measured after the change, with `cristal` on the finish axis:

| catalog title | colour | finish |
|---|---|---|
| `Cristal Pastel Rosado` | `rosado` | `transparente` |
| `Cristal Pastel Azul` | `azul` | `transparente` |
| `Cristal Pastel Lila` | `lila` | `transparente` |
| `Fashion Transparente` | `transparente` | `fashion` + `transparente` |

That is the correct reading of all four: the translucent pastels keep their
colour and gain the finish, and the plain clear balloon is the only one whose
*colour* is transparent. The intent of the request is served; the axis is not
the one named.

### 11.2 The defect the aliases exposed, and why the test was not touched

Adding `cristal` to the finishes made `plan:test` fail on
`test-presentacion-cliente.ts`: the customer card rendered
**"transparente transparente"**, because both call sites built their label as
`[colour, finish].filter(Boolean).join(" ")` and for a clear balloon those two
words are the same. The test's expectation (`transparente`) was right and the
code was wrong, so the code changed — `etiquetaColorAcabado()` drops the finish
when it repeats the colour name. The expectation was **not** regenerated to
match the implementation; `AGENTS.md` forbids exactly that, and doing it here
would have shipped "transparente transparente" to a customer's quote.

---

## 12. Repository policy exemption, 2026-09-17

`AGENTS.md` says: "No images, no absolute paths and no customer data enter the
repository. Evaluation inputs live outside it." I raised this before committing,
and the user waived the rule ("ignora esa regla") so the benchmark evidence
travels with the code.

Recorded here so it reads as a decision rather than an accident:

- **Scope of the waiver:** `informes/` only — 151 files, 137 MB, of which the
  bulk is full-resolution stage-1 and composite PNGs. The largest single file is
  3.8 MB, well under GitHub's per-file limit. There is no customer data: the
  references are the app's own sample set and the rest is model output.
- **Not a precedent.** Images elsewhere in the tree are still out. If the repo
  size becomes a problem, the cheap reduction is dropping
  `informes/bench/*/*.png` and keeping `mini/*.jpg` — the HTML report only ever
  references the thumbnails, so the report survives intact at roughly a tenth of
  the weight.
- **`reports/` is now git-ignored** and stays the harness's working directory;
  `informes/` is the committed snapshot. Without that split the same 137 MB
  would be committed twice on the next run.
- **Git history is permanent.** Removing these files later shrinks the checkout
  but not the history; that would need a history rewrite, which is a separate
  decision.
