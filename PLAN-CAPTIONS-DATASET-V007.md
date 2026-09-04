# Plan — Captions del dataset de fotos reales para reentrenar el LoRA (v007)

Estado: **propuesta, sin ejecutar**. Fecha: 2026-09-02.
Objetivo del entrenamiento: un LoRA que, dado un plan de decoración, componga la escena
correcta **y** rinda la identidad visual de los productos reales de Sempertex.

Este plan se apoya en `HANDOFF-LORA-COMPOSICION.md` (qué rompió el v2 y qué se midió),
`PLAN-COMPILADOR-PROMPT-LORA-V2.md` (gramática de salida y relaciones espaciales),
`writing-block.md` §§7–10 (vocabulario canónico y contrato de caption),
`docs/decisions/product-vocabulary-v001.md` (alcance congelado) y
`PLAN-CONTROL-ENTRENAMIENTOS-LORA-UI.md` (manifiestos y registro de entrenamientos).

Todo número de este documento está medido hoy sobre el disco, no estimado. Los comandos para
reproducir cada medición están en el Apéndice A.

---

## 0. Qué se pide y qué se entrega

Pedido: captions que describan **escena, decoración, composición, tamaños y sobre todo los
nombres canónicos de los productos**, para entrenar la IA, y un plan para paralelizar el
trabajo.

Entregables:

1. Vocabulario canónico de producto ampliado hasta cubrir el dataset real (hoy cubre 9,3%).
2. Un contrato de anotación tipado por imagen (`annotation.v007`) que separa lo que el modelo
   de visión observa de lo que el compilador redacta.
3. Un compilador determinista que rinde el caption final desde ese contrato: los nombres de
   producto salen del vocabulario, nunca de texto libre.
4. Los pares imagen/caption empaquetados con manifiesto, hashes y procedencia.
5. Un entrenamiento con evaluación de criterio pre-registrado.

---

## 1. El dataset: inventario medido hoy

### 1.1 Dónde está

El dataset **no está en un solo directorio**. Son dos mitades, y la mitad web vive en el
worktree paralelo:

| mitad | ruta | imágenes |
| --- | --- | --- |
| Fotos reales de órdenes | `C:\Users\davidt\Downloads\ordenes-decoracion\<orden>\foto-N.(jpg\|png)` | **276** |
| Web oficial Sempertex | `…\demo-decoracion-codex-lora-vocabulario\data\staging\lora-v006-orders-web-v001\original\web-NNN.jpg` | **94** |
|  | **total único por hash** | **370** |

La vista que las une ya existe: `src/lib/lora/dataset-v005-view.ts` (worktree codex) lee las dos
carpetas y las muestra en `src/components/lora/LoraDatasetGallery.tsx`. El manifiesto web es
`data/staging/lora-v006-orders-web-v001/manifest.json`
(`datasetId: lora-dataset-v006-orders-web-v001`, regla declarada: «154 fotos reales de órdenes +
imágenes directas de Sempertex.com; cero Pinterest, BASE o fotos individuales del catálogo
Shopify»).

### 1.2 Conteo exacto y el número 348

Hoy el conjunto suma **370 imágenes únicas por hash**, no 348. Reconstrucción de la diferencia:

- La selección web se declaró en `counts` con `webSelected: 124` y hoy tiene **94** registros y
  94 archivos (ids con huecos: `web-120`, `web-122`, `web-124`), es decir se podaron 30.
  `manifest.json` y `selection.json` fueron reescritos hoy 09:35.
- `276 + 72 = 348`: la galería descarta los registros web cuyo archivo no existe en disco, así
  que cualquier lectura tomada mientras la descarga o la poda estaba a mitad de camino muestra
  un número intermedio. 348 es consistente con un estado con 72 archivos web presentes.
- Ninguna otra combinación de carpetas del disco da 348 (`ordenes + web-limpia` = 356,
  `v005(300) + SEMPERTEX-TRAINING` = 346, `ordenes + v006` = 369).

**Consecuencia operativa:** el conjunto está mutando — la galería tiene botón «Borrar» por
imagen (`src/lib/lora/eliminacion-dataset-v005.ts`). El plan arranca congelando el conjunto, y a
partir de ahí el tamaño del dataset es lo que diga el manifiesto congelado, no lo que haya en
disco. Si el objetivo es literalmente 348, la etapa E0 decide qué 22 de las 370 se excluyen con
un criterio explícito, no por goteo.

### 1.3 Verdad de referencia disponible, por mitad

**Órdenes — verdad de referencia fuerte.** Medido sobre `ordenes-decoracion`:

| dato | valor |
| --- | --- |
| carpetas de orden con `desglose.json` | 385 |
| líneas de desglose (producto + variante + SKU + cantidad) | 2 232 |
| SKUs únicos / títulos únicos / códigos de variante únicos | 992 / 742 / 82 |
| carpetas con foto / fotos | 270 / 276 |
| fotos con `caption-N.json` y `feedback-N.json` | 276 / 276 |
| pares producto–foto marcados `representado: true` | 1 450 |
| fotos con al menos un producto marcado visible | 272 / 276 |
| fotos con `aptoParaEntrenamiento: true` | **142** |
| fotos con `aptoParaEntrenamiento: false` | **134** |
| revisiones con `fuente: "humano"` | **5** |
| líneas con diámetro físico decodificable del código de variante | **1 945 / 2 232 (87,1%)** |

Es decir: para las fotos de órdenes hay **qué producto, en qué tamaño y qué se ve** — el insumo
exacto que pide el pedido. Dos debilidades: 271 de las 276 revisiones las hizo la IA sola
(`fuente: ia_automatica`), incluidos los 134 «no apto»; y 171 de las 276 fotos vienen de
pseudo-órdenes cuya cantidad no es un registro de compra (H9).

**Web — sin verdad de referencia de producto.** Los 94 registros tienen
`productBreakdownStatus: "not_found_in_source_sidecar"`, `productBreakdown: null`,
`trainingEligible: false` y `licenseStatus: "pending_human_confirmation"`. Los sidecars de origen
(`*.source.json` en `SEMPERTEX-TRAINING (2)-unpacked`) traen `articleUrl`, `imageUrl`, `sha256`,
`theme` y `approval: pending_human_confirmation` — **no traen lista de productos**.
`scripts/enriquecer-desgloses-web-v006.ts` intenta derivarla del artículo del blog contra
`data/demo.sqlite`; hoy no resuelve ninguna. Distribución por tema: `amor_amistad` 27,
`navidad` 21, `cumpleanos` 19, `halloween` 17, `boda` 10.

---

## 2. Qué debe decir cada caption: los cinco ejes como campos tipados

El pedido nombra cinco ejes. Ninguno debe quedar en prosa libre: cada uno se anota tipado y lo
redacta el compilador.

| eje | de dónde sale | campo |
| --- | --- | --- |
| **Escena** | observación (VLM) + tema del manifiesto | `scene.event_type`, `scene.venue_surface`, `scene.framing` |
| **Decoración** | observación con tipos cerrados de `LORA_STRUCTURE_TYPES` | `structures[].structure_type`, `.noun`, `.count` |
| **Composición** | observación + diccionarios de `PLAN-COMPILADOR-PROMPT-LORA-V2.md` §§7–8 | `structures[].placement`, `.relation`, `.anchor_structure_id`, `.salience`, `scene.density` |
| **Tamaños** | código de variante de la orden (87% decodable) + mezcla observada | `structures[].visible_sizes[]`, `.size_relation`, `.dimensions_m` |
| **Nombres canónicos** | vocabulario congelado, resuelto desde el desglose | `structures[].visible_concept_ids[]` |

El punto no negociable, ya escrito en `writing-block.md` §9: **el modelo de visión elige IDs de
concepto de una lista que se le entrega; nunca escribe el nombre del producto.** El nombre lo
rinde el compilador leyendo `canonical_label` del vocabulario.

---

## 3. Lo que ya existe y se reutiliza

No hay que construir esto de cero. Piezas vivas (worktree codex salvo aviso):

- **Vocabulario y resolutor** — `src/lib/lora/product-vocabulary.ts`: `ProductConcept`
  (`concept_id`, `canonical_label`, `visual`, `aliases` ES/EN/contextual, `catalog_product_ids`,
  `sizes.allowed_codes`), `resolveProductConcept()` con precedencia determinista,
  `checkVocabularyInvariants()`, `normalizeProductText()`. Datos en `product-vocabulary-data.ts`
  + `product-vocabulary-catalog-data.ts`: **84 conceptos, 83 activos.**
- **Contrato y compilador de caption** — `src/lib/lora/caption-regeneration.ts`:
  `CaptionContractInput`, `compileCaptionContract()` (valida concepto contra vocabulario, rechaza
  `not_visible`, deduplica, ordena determinista, un solo trigger), `resolveVisibleConceptId()`,
  `countTriggerOccurrences()`.
- **Pipeline de regeneración versionada** — `scripts/regenerate-lora-product-captions-v001.ts`
  (dry-run por defecto, `--apply`, `--resume`, `--only`, escritura atómica, manifest de lineage).
- **Auditoría de corpus** — `scripts/audit-lora-caption-corpus.ts` y sus salidas en
  `reports/lora-vocabulary-v001/strict-audit-v003.md` (hoy: 300 imágenes, 131 resueltas, 169
  `environment-only`, PASS con 0 errores).
- **Captioner por foto de orden** — `src/lib/ordenes/generarCaption.ts`: prompt con desglose
  completo, tamaños reales decodificados, auto-revisión de `productos_representados`, salida JSON
  estructurada. Corre `opencode` (`openai/gpt-5.6-luna`, variante `xhigh`), un proceso por foto
  (`spawnSync`).
- **Captioner por lote** — `scripts/recaption-v004.ts`: Gemini (`gemini-3.6-flash`,
  `temperature 0.2`, `thinkingLevel: MINIMAL`, timeout 120 s), **`CONCURRENCIA = 4`**,
  `--solo-pendientes`, `--muestra N` repartida a lo largo del set, normalización de trigger.
- **Semántica y compilador compartidos con producción** — `src/lib/ia/lora-semantics.ts`
  (`VisualSemanticsSchema`: `structure_type`, `placement`, `design_role`, `repetition_group`,
  `dimensions_m`, `density`), `src/lib/ia/lora-caption-compiler.ts` (`LoraVisualClause`,
  `STRUCTURE_NOUNS`, `PLACEMENT_PHRASES`, agrupación de repeticiones, `resolveRelations()`),
  `src/lib/ia/lora-prompt-preflight.ts`.
- **Esquema de anotación de referencias, ya en producción** — `src/lib/ia/reference-blueprint.ts`:
  `ReferenceBlueprintV2Schema` con `elements[]` (`category`, `scene_role`, `reference_bbox`,
  `depth_layer`, `quantity`, `appearance` con `composition` de proporciones, `relationships`,
  `bill_of_materials`, `visual_semantics`), `composition` (`focal_point`, `density`, `symmetry`,
  `negative_space`) y `palette`. **Este esquema es el 80% del contrato de anotación que falta.**
- **Tamaño físico** — `src/lib/ia/tamano-fisico.ts`: `descripcionFisicaTamano()` rinde
  `12-inch (30.5 cm) round latex balloon — about the size of a human head or a basketball`;
  `bloqueMezclaTamanos()` declara proporciones exactas. `decodificarTamano()` en
  `src/lib/shopify/derivar.ts` traduce `R-12` → redondo 12 in.
- **Empaquetado y registro** — `src/lib/lora/dataset-builder.ts`, `repository.ts`, migraciones
  `015_lora_training_registry.sql` / `016_lora_specializations.sql`, y
  `RUNBOOK-ENTRENAMIENTO-V004.md` con los valores de fal ya validados.

---

## 4. Hallazgos medidos que condicionan el diseño

### H1 · El vocabulario cubre 9,3% del dataset. Es el bloqueante real.

Resolviendo los 742 títulos únicos de los desgloses contra los 84 conceptos:

| métrica | valor |
| --- | --- |
| títulos resueltos | **69 / 742 (9,3%)** |
| ambiguos / desconocidos | 0 / **673** |
| cobertura ponderada por línea de orden | **27,2% (607 / 2 232)** |
| cobertura ponderada por foto afectada | **30,2%** |

Los faltantes no son casos raros: son colores que faltan en familias ya modeladas —
`Globo Redondo Fashion Fucsia` (16 fotos), `GLOBO LATEX REDONDO PASTEL MATE AZUL` (15),
`GLOBO LATEX REDONDO FASHION NARANJA` (14), `Globo Redondo Fashion Negro` (14),
`Globo Redondo Reflex Champaña` (10), `Globo Redondo Silk Verde Menta` (10). La variación de
capitalización («Globo Redondo…» vs «GLOBO LATEX REDONDO…») ya la absorbe
`normalizeProductText()`, así que el hueco es de conceptos, no de normalización.

Reparto por forma × familia de los 742 títulos (557 son globo, 185 no):
`REDONDO/FASHION` 161 · `TUBITO/FASHION` 55 · `REDONDO/REFLEX` 47 · `NUMERO/METALIZADO` 41 ·
`REDONDO/·` 40 · `REDONDO/PASTEL MATE` 20 · `LINK/FASHION` 18 · `TUBITO/REFLEX` 17 ·
`REDONDO/SILK` 17 · `REDONDO/PASTEL DUSK` 13 · `REDONDO/NEON` 12 · `ESTRELLA/METALIZADO` 10 ·
resto ≤ 9. Los 185 no-globo son mayoritariamente mesa y papelería (`SERVILLETA…`, `VASO…`,
`PLATO…`, `MANTEL…`, `VELA…`, `CONFETTI…`).

**Sin ampliar el vocabulario, `compileCaptionContract()` devuelve `pending` para casi todo el
dataset y no hay caption con nombre canónico que empaquetar.** Ampliarlo es determinista (sale
del catálogo, no de la IA) y es lo primero que se paraleliza.

### H2 · Hay tres gramáticas de caption incompatibles conviviendo

| fuente | iluminación | lateralidad | tamaños | forma |
| --- | --- | --- | --- | --- |
| `scripts/recaption-v004.ts` (dataset v005, trigger v2) | **prohibida** | **prohibida** (`on either side`) | `large` / `small` | 45–70 palabras, `set against …` |
| `caption-regeneration.ts` (canonical v003) | **incluida** (`lighting_description`) | no opina | código crudo `(R-12)` | `structure, featuring <productos>, environment, lighting` |
| `src/lib/ordenes/generarCaption.ts` (fotos de orden, trigger v1) | incluida | libre | `R-12 (12-inch)` glosado | prosa larga |

Los 276 captions de orden que hay en disco son de la tercera; el LoRA v004/v005 se entrenó con la
primera. Mezclarlas bajo un mismo trigger le enseña al token dos distribuciones que se
contradicen. **El plan congela una sola gramática (§6).**

### H3 · El compilador canónico emite `R-12` dentro del caption

`renderProductClause()` rinde `` `${canonical_label} (${size_codes.join(", ")})` ``, o sea
`round latex balloon in gold with a Reflex high-shine finish (R-12)`. `R-12` es un SKU interno:
`PLAN-COMPILADOR-PROMPT-LORA-V2.md` §10 lo prohíbe explícitamente («sin IDs internos»),
`tamano-fisico.ts` existe justamente porque el modelo de imagen no lo sabe leer, y
`generarCaption.ts` ya impone la forma glosada `R-12 (12-inch)`. **Corregir el renderer a
pulgadas es un cambio de una función, y sin él los tamaños del dataset son ruido.**

### H4 · El compilador aplana los productos en una sola cláusula `featuring`

Hoy el caption sale como `<structure_description>, featuring <todos los productos ordenados por
concept_id>, <environment>, <lighting>`. Eso desacopla cada producto de la estructura que forma:
la bolsa de productos no dice qué globo está en la columna y cuál en el arco.

Es exactamente la falla que `HANDOFF-LORA-COMPOSICION.md` midió del lado del prompt: lo que
sostiene la composición es que **cada estructura tenga su propia cláusula independiente** —
`two balloon columns, matching one another, one standing on the left and one on the right`
compone 6/6, mientras la subordinada del v3 (`flanked by two tall balloon columns`) las funde. El
contrato v007 mueve `visible_concept_ids` y `visible_sizes` **dentro de cada estructura**.

### H5 · La mitad web no tiene ni productos ni licencia confirmada

94/94 con `productBreakdown: null` y `licenseStatus: pending_human_confirmation`. Dos
consecuencias: (a) sin desglose no hay `allowedConceptIds`, así que el eje «nombres canónicos» no
se puede cumplir por verdad de referencia y hay que resolverlo con propuesta del VLM +
confirmación humana; (b) la licencia es un gate previo al empaquetado, no un detalle.

### H6 · 134 de 276 fotos de orden están marcadas «no apto para entrenamiento»

Y 271 de las 276 revisiones las hizo la IA sola. Entrenar sobre las 276 mete fotos que el propio
pipeline juzgó borrosas, oscuras o no-decoración; confiar ciegamente en el descarte tira la mitad
del dataset por un juicio no auditado. **Se necesita una pasada de revisión humana muestreada
sobre los `false` antes de decidir el conjunto final** (E0.3).

### H7 · Los tamaños están casi resueltos, pero 285 líneas los esconden en la otra opción

87,1% de las líneas decodifican diámetro del primer segmento de `variante`
(`R-5` 552 líneas, `R-12` 441, `R-9` 402, `T260` 243, `R-18` 86, `R-24` 44, `R-36` 11,
`LOL-6` 15, `C-6` 12…). Las que no decodifican son `PAQUETE X N` (paquete en la primera opción) o
un color (`DORADO`, `FUCSIA`, `NEGRO`): ahí el tamaño está en la otra opción de la variante.
`data/demo.sqlite` tiene `shopify_variante.tamano_codigo` — consultarlo por SKU recupera buena
parte de esas 285 sin tocar la IA.

### H8 · Todo el trabajo de vocabulario está sin commitear, en un worktree aparte

`demo-decoracion-codex-lora-vocabulario` (rama `codex/lora-vocabulario`) está en el mismo commit
que `main` (`f481967`) con **308 rutas sin commitear**, entre ellas
`src/lib/lora/product-vocabulary*.ts`, `caption-regeneration.ts`,
`scripts/audit-lora-caption-corpus.ts`, `dataset-v005-view.ts`, `LoraDatasetGallery.tsx`, las
migraciones 015/016 y todo `reports/lora-vocabulary-v001/`. `main` no tiene ninguno.
**Un `git clean` o un borrado de carpeta perdería la base entera de este plan.** E0.0 es
commitear eso en su rama.

### H10 · `translateLoraColor()` colapsa colores distintos del catálogo — en producción

`src/lib/ia/lora-caption-compiler.ts` traduce color español → inglés con `COLOR_ALIASES`, y
mapea a un color genérico varias identidades distintas del catálogo:

```
Azul Caribe -> blue        Azul Rey -> blue        Azul Ártico -> blue
Amarillo Miel -> yellow    Blanco Nácar -> white   Cristal Rojo -> red
```

Tres azules del catálogo se vuelven `blue`, y `Cristal Rojo` pierde la translucidez. Además
hay 24 colores del dataset sin traducción alguna, que salen en español (Aguamarina, Amatista,
Eucalipto, Frambuesa, Merlot, Moca, Terracota…).

Consecuencias, en dos frentes:

- **Captions:** si se generaran con esa función, el LoRA aprendería que Azul Caribe, Azul Rey
  y Azul Ártico son el mismo producto — exactamente la identidad que este dataset existe para
  enseñar. Por eso el vocabulario lleva su propio mapa uno-a-uno, sin colapsos.
- **Producción, hoy:** el prompt que se manda a fal pide «blue balloons» cuando el plan
  especificó Azul Rey. Es una sustitución silenciosa en el camino de generación, no solo en
  el de entrenamiento. Queda anotado como defecto aparte de este plan; el arreglo natural es
  que el compilador de prompt lea el color del vocabulario en vez de su propio diccionario.

### H9 · 183 de las 385 órdenes son pseudo-órdenes: la cantidad no es verdad de compra

Las órdenes numeradas `9500*` son 183 y **las 183 tienen `cantidad: 1` en absolutamente todas
sus líneas** (964 líneas, 5,3 por orden), contra 202 órdenes normales con 6,3 líneas y
cantidades variadas. Aportan **171 de las 276 fotos** (62%).

Su `variante` también viene simplificada — `"R-5"` a secas en vez de `"R-12 / PAQUETE X 20"`.
El patrón corresponde a una lista curada de «qué productos aparecen en esta foto», no a un
pedido real.

Impacto acotado, pero hay que declararlo:

- **No afecta** la identidad canónica (sale del título) ni el tamaño (sale del código de
  variante): los dos ejes centrales del pedido siguen respaldados en las 276 fotos.
- **Sí invalida** usar `cantidad` como señal de proporción por color o por tamaño — que es
  justo lo que hace `bloqueMezclaTamanos()` para el prompt de producción. Para estas 171 fotos,
  `size_relation` y las proporciones se anotan por observación, nunca por aritmética sobre el
  desglose.
- Caso testigo: orden `950000192`, 3 líneas × 1 unidad, todas R-5, y la foto muestra una pared
  completa de globos con muñeco de nieve y plintos. El caption existente atribuye la pared
  entera a esos tres productos.

El inventario de E0.1 marca cada imagen con `order_kind: real | curated` para que los gates
puedan tratarlas distinto y para que la comparación con el v004-154 no se lea de más.

---

## 5. Contrato de anotación `annotation.v007`

Un archivo JSON por imagen. Extiende `CaptionContractInput` con lo que hoy falta (estructuras
como unidad, composición tipada, tamaños por estructura, escena) reusando los enums de
`lora-semantics.ts` y las categorías de `reference-blueprint.ts`.

```jsonc
{
  "schema_version": "annotation.v007",
  "image_id": "10021-1",
  "image_sha256": "…",
  "source": { "kind": "order_photo", "ref": "ordenes-decoracion/10021/foto-1.jpg" },

  "scene": {
    "event_type": "cumpleanos",              // CATEGORIAS_ENTRENAMIENTO
    "framing": "full_scene",                 // full_scene | partial_crop
    "venue_surface": "off-white walls and a light tiled floor",
    "symmetry": "symmetric",                 // symmetric | asymmetric | unknown
    "density": "media"                       // LORA_DENSITIES
  },

  "structures": [
    {
      "structure_id": "s1",
      "structure_type": "columna",           // LORA_STRUCTURE_TYPES (cerrado)
      "noun": "balloon column",              // STRUCTURE_NOUNS, no texto libre
      "count": 2,
      "placement": "lateral_izquierdo",      // LORA_PLACEMENTS (cerrado)
      "design_role": "focal",                // focal | soporte | acento
      "salience": 1,
      "relation": { "kind": "bilateral_pair", "target_structure_id": "s2" },
      "visible_concept_ids": [               // subconjunto de allowed_concept_ids
        "balloon.round.latex.reflex.rose_gold",
        "balloon.round.latex.fashion.white"
      ],
      "visible_sizes": [
        { "concept_id": "balloon.round.latex.reflex.rose_gold", "size_code": "R-12", "diameter_inches": 12 },
        { "concept_id": "balloon.round.latex.fashion.white",    "size_code": "R-5",  "diameter_inches": 5 }
      ],
      "size_relation": "mixed_organic",      // single_size | mixed_organic | graded
      "dimensions_m": { "height": 2.1 },     // opcional, solo si es juzgable
      "evidence": "dos columnas simétricas a los lados del panel central"
    }
  ],

  "non_purchased_elements": ["a round white table", "a name sign"],
  "uncertainties": ["no se distingue si los pequeños son Fashion o Pastel Matte"],

  "provenance": {
    "model": "gemini-3.6-flash",
    "prompt_sha256": "…",
    "vocabulary_version": "product-vocabulary.v1",
    "allowed_concept_ids_sha256": "…",
    "generated_at": "…"
  }
}
```

Reglas del contrato:

1. `visible_concept_ids ⊆ allowed_concept_ids` de esa imagen. `allowed_concept_ids` se calcula
   **antes** de llamar al modelo, resolviendo el desglose con `resolveVisibleConceptId()` y
   filtrando por `representado !== false`. Cualquier id de fuera se rechaza como `not_visible`
   (ya implementado en `compileCaptionContract()`).
2. `visible_sizes[].size_code` tiene que estar en `concept.sizes.allowed_codes` **y** aparecer en
   algún código de variante de esa orden. Sin las dos condiciones, no se afirma tamaño.
3. `relation.kind ∈ {bilateral_pair, anchored_to, on_furniture, behind, overhead, none}` y
   `target_structure_id` tiene que existir — misma validación cruzada que
   `ReferenceBlueprintV2Schema` ya hace con `relationships`.
4. Nada de iluminación, nada de transcribir texto de carteles, nada de vocabulario de pedido
   (`purchased`, `confirmed`, `the order`, `not listed`): los cuatro ya se filtraron a captions
   reales y están documentados en `generarCaption.ts` y en
   `scripts/limpiar-meta-comentario-captions.ts`.
5. Zod estricto (`.strict()`) y validación en el borde: un JSON que no valida es `pending`, no se
   degrada.

---

## 6. Gramática de caption congelada (`lora-caption-v3`)

Una sola forma, resolviendo H2. Se rinde determinista desde `annotation.v007`:

```text
<TRIGGER>, <focal: noun + count + placement + productos canónicos con tamaños>,
<soportes con su relación y sus productos canónicos>, with <acentos anclados>,
set against <venue_surface>.
```

Ejemplo compilado (foto 10021-1, con el vocabulario ampliado):

```text
eventdecor_style_v3, two matching balloon columns standing at each end of a flat arch-shaped
backdrop panel, each built from 12-inch round latex balloons in rose gold with a Reflex
high-shine finish mixed organically with 5-inch matte white and dusty rose round latex balloons,
with a number marquee frame filled with 5-inch pastel green and pastel lilac round latex balloons
beside a round table ringed with small pastel pink balloons, set against off-white walls and a
light tiled floor.
```

Contrato de salida:

| regla | valor | por qué |
| --- | --- | --- |
| trigger | exactamente 1, al inicio | ya validado por `countTriggerOccurrences()` |
| longitud | **55–85 palabras / 400–700 caracteres** | v005 usaba 45–70; las cláusulas de producto + tamaño por estructura suman ~15 palabras. §10 del plan del compilador pide 350–650 con tope duro 750 |
| iluminación | **prohibida** | 93% de los 154 captions v004 la traían y 67% terminaba en ella: es constante, así que pertenece al trigger. Anula `lighting_description` del compilador actual |
| lateralidad | **`on either side` / `at each end` / `on both sides`**, nunca `left`/`right` | el trainer de fal augmenta con volteo horizontal y no se puede apagar; enseñar lateralidad ahí es ruido. El prompt de inferencia **sí** usa `one standing on the left and one on the right` (6/6 medido) porque esa capacidad la aporta el modelo base, no el LoRA |
| una cláusula por estructura | obligatorio | H4; es lo que separa columnas de patas de arco |
| tamaños | `12-inch`, `5-inch`; nunca `R-12`, `12 in`, `12"`, `12 inches` | H3 |
| proporción | describir la mezcla observada (`mixed organically`); prohibido calcular ratios | 16 captions reales repetían «R-9 es 1,8× R-5», que es aritmética 9÷5, y uno estaba contradicho por su propia foto |
| perspectiva | si la orden confirma un solo diámetro, decirlo explícito | error observado: describir una diferencia de tamaño que no existe |
| arcos | `balloon garland arch` (3D) / `flat arch-shaped backdrop panel` (panel) / `metal ring frame` (aro) | de 44 captions con `arch`, 14 eran panel plano y 3 un aro: esa ambigüedad explica los «portales rectangulares» |
| carteles | `a sign`, `a name sign`, `a number marquee`; nunca transcribir letras | 41% mencionaba cartelería y de ahí sale el texto basura en la salida |
| productos | `canonical_label` textual del vocabulario, dentro de la cláusula de su estructura | `writing-block.md` §9 |
| prohibido | SKU, precio, paquete, cantidad comercial, `STRUCTURE:`, JSON, español sin normalizar | §10 |

**Trigger nuevo (`eventdecor_style_v3`).** La distribución cambia materialmente respecto de las
154 + 300 captions con las que se entrenó `eventdecor_style_v2`: aparecen pulgadas reales y
nombres canónicos, desaparece `large`/`small`. Reusar el token mezcla dos distribuciones. Requiere
tocar `src/lib/ia/sempertex-lora.ts` y el compilador de prompt — decisión abierta (§13).

---

## 7. Pipeline

Cada etapa escribe artefactos versionados y no modifica sus fuentes (regla ya vigente en
`regenerate-lora-product-captions-v001.ts`).

### E0 · Congelar el conjunto · determinista, sin IA

- **E0.0** Commitear las 308 rutas del worktree codex en `codex/lora-vocabulario` (H8).
- **E0.1** `inventariar-dataset-v007.ts`: recorre las dos carpetas, calcula sha256, detecta
  duplicados exactos, lee dimensiones, y escribe `data/staging/lora-v007/inventario.json` con una
  fila por imagen.
- **E0.2** Licencia: marcar las 94 web como `license_ok` o excluirlas. Gate humano, no IA.
- **E0.3** Elegibilidad: revisión humana muestreada (n = 40, mitad `apto=true` y mitad `false`)
  sobre las fotos de orden, en la galería que ya existe. Mide la tasa de error del juicio
  automático y decide si los 134 `false` entran, salen o se re-revisan en bloque.
- **E0.4** `seleccion.json` firmado: la lista exacta, con motivo de exclusión por imagen.
  **A partir de acá el conjunto no cambia sin bumpear versión.**

### E1 · Ampliar el vocabulario canónico · determinista, sin IA

**Estado: E1.1 hecho y medido (2026-09-02).** `scripts/proponer-conceptos-vocabulario.ts` en el
worktree codex genera **226 conceptos** (131 limpios, 95 con banderas de revisión) desde el
catálogo, sin una sola llamada a IA. Los 226 validan el schema Zod y el efecto sobre las fotos es:

| escenario | fotos completas | parciales | sin ningún producto |
| --- | --- | --- | --- |
| hoy, vocabulario v1 (83 conceptos) | **12** | 200 | 60 |
| + 131 propuestas limpias | 74 | 179 | 19 |
| + las 226 propuestas | **228** | 36 | 8 |
| + 226, mesa/papelería fuera de cuenta | **234** de 270 | 30 | 6 |

De 12 a 228 fotos de 272 (84%). Salida en
`reports/lora-vocabulary-v002/conceptos-propuestos.{json,md}`.

Cobertura por plantilla de título: latex sólido e impreso, foil (número, letra, estrella,
corazón, redondo) y artículos decorativos (banderola, cartel, cortina, mural, serpentina,
confetti, telaraña, camino de mesa, kit de guirnalda). Quedan 82 productos fuera: 56 de
mesa/papelería excluidos por decisión, 13 sin forma reconocible (los `Kit Diy` y los
`Globo Infinity®` sin forma en el título), 9 decoraciones sin color ni estampado declarado,
2 foil sin color, 2 latex sin familia ni estampado.

**Regla que este paso fijó:** para productos impresos, la identidad que un caption *puede*
expresar es más gruesa que el SKU. El contrato prohíbe transcribir letras y dígitos, así que
`Globo Metalizado Numero 0 Dorado Mate` y el 9 del mismo color son **un** concepto
(`balloon.number.foil.matte_gold`), y dos textos distintos de «Feliz Cumpleaños» en foil
dorado colapsan en `round foil balloon in gold with printed birthday lettering`. El texto
literal se reemplaza por un descriptor de un set cerrado, nunca se copia.

- **E1.1** `proponer-conceptos-vocabulario.ts`: cruza los 742 títulos y 992 SKUs de los desgloses
  con `shopify_producto` / `shopify_variante` de `data/demo.sqlite` y con
  `data/processed/shopify-products.enriched.json`; agrupa por (forma, familia, color, acabado,
  estampado) y propone `ProductConcept` con `catalog_product_ids`, `aliases` ES/EN y
  `sizes.allowed_codes` derivados del `tamano_codigo` real.
- **E1.2** Revisión por familia (paralelizable, carril A de §8.1). Reglas duras heredadas de
  `docs/decisions/product-vocabulary-v001.md`: `Reflex` no se traduce a `glossy`; `gold` ≠
  `rose gold`; `latex` ≠ `foil`; `round` ≠ `heart`; sólido ≠ estampado; el tamaño no entra en el
  `concept_id`; nada de SKU, precio ni paquete en el label.
- **E1.3** `checkVocabularyInvariants()` + `scripts/audit-lora-product-vocabulary.ts`:
  0 colisiones, 0 fugas comerciales, 0 alias ambiguos sin contexto.
- **E1.4** Gate: **cobertura ≥ 95% de las líneas de desglose marcadas `representado: true`** del
  conjunto congelado (hoy 27,2% sobre todas las líneas). Los no-globo de mesa y papelería quedan
  fuera del vocabulario salvo que se vean instalados; se describen como `non_purchased_elements`.

### E2 · Verdad de referencia por imagen · determinista, sin IA

- **E2.1** Órdenes: `allowed_concept_ids` = desglose → `resolveVisibleConceptId()` filtrado por
  `representado !== false`; `allowed_sizes` = códigos de variante decodificados
  (`decodificarTamano()`), completando las 285 líneas sin diámetro con
  `shopify_variante.tamano_codigo` por SKU (H7).
- **E2.2** Web: correr `enriquecer-desgloses-web-v006.ts` contra el artículo del blog. Lo que no
  resuelva queda con `allowed_concept_ids = []` y entra a E3 en **modo propuesta**: el VLM propone
  conceptos, el compilador los marca `pending`, y solo una confirmación humana en la galería los
  promueve a `allowed`.
- **E2.3** `verdad-referencia.json` por imagen + reporte de cobertura por mitad.

### E3 · Anotación con visión · paralelo, con IA

- Un JSON `annotation.v007` por imagen en `data/staging/lora-v007/anotaciones/<image_id>.json`.
- Prompt único, versionado por hash, que recibe: la imagen, `allowed_concept_ids` con su
  `canonical_label`, `allowed_sizes` glosados en pulgadas, los enums cerrados de estructura y
  placement, y las reglas del §6 en forma de prohibiciones.
- El modelo devuelve **solo** el contrato tipado. No redacta el caption.
- Detalle de paralelización en §8.

### E4 · Compilación determinista · sin IA

**Estado: E4.1–E4.4 hechos (2026-09-02).** `src/lib/lora/caption-contract-v2.ts` +
`scripts/test-caption-contract-v2.ts`: **33/33 tests pasan**, tsc y eslint limpios, y las tres
suites previas siguen verdes (23/23, 34/34, compilador de prompt OK). El v1 quedó intacto.

Ejemplo real, foto `950000192-1`, mismos datos de disco y cero información nueva:

```text
ANTES (v1, en disco)
eventdecor_style_v1, a Christmas balloon wall with silver glossy chrome/mirror round latex
balloons framing white matte solid round latex balloons and a central gold glossy chrome/mirror
round latex balloon motif, plus a snowman figure, white display plinths, printed party balloons,
dessert displays, decorative bunting, a balloon-filled gift basket, and soft studio lighting.

AHORA (contrato v2)
eventdecor_style_v3, a balloon wall, installed against the rear wall, built from round latex
balloons in white, solid Fashion finish, round latex balloons in gold with a Reflex high-shine
finish and round latex balloons in silver with a Reflex high-shine finish, all at a single
5-inch size, alongside a snowman figure and white display plinths holding dessert displays, set
against a plain wall and a wooden floor.
```

`Reflex` sobrevive en vez de volverse `glossy chrome/mirror`, el único diámetro confirmado se
declara explícito, y desaparecen la iluminación y el trigger v1.

**La marca va pegada al color (2026-09-02).** `fraseProducto()` recompone la frase desde los
campos `visual.*` del vocabulario en vez de usar la prosa del `canonical_label`:

```text
antes  round latex balloons in gold with a Reflex high-shine finish
ahora  high-shine Reflex gold round latex balloons
```

El motivo no es estético: un producto Sempertex **es** el par (familia, color) — «Reflex
Dorado» es un producto distinto de «Fashion Dorado» y de «Reflex Plata». Con la familia a
cuatro palabras del color, el caption invita a aprender `gold` y `Reflex` como dos atributos
independientes en vez de una identidad. El adjetivo de apariencia (`high-shine`) queda delante
porque es lo único que el modelo base entiende sin haber aprendido nada: si el LoRA subentrena,
`high-shine gold` todavía rinde algo parecido, mientras `Reflex` a secas no le significa nada.

Se aplica solo donde hay una familia de acabado real (≈230 de 310 conceptos). `visual.family` en
el v1 escrito a mano trae también valores que no son acabados (`balloon garland and arch
decoration kit`, `Coquette`, `banderola_cartel`) y acabados en prosa (`mixed matte, glossy,
satin, and glossy chrome`): esos conservan su `canonical_label` textual, igual que los surtidos
y los colores de más de tres palabras. Hay test para cada caso de esa red de seguridad.

**El diámetro inequívoco lo aplica el compilador, no el modelo (2026-09-02).** Medido sobre el
corpus, 130 de 982 productos nombrados salían sin tamaño, y la causa dominante eran **68 casos
donde la orden confirma un solo diámetro para ese producto y el modelo igual no lo declaró**.
El prompt le dice «si no podés distinguir el tamaño, no lo pongas», y con una sola opción
posible no hay nada que distinguir: el tamaño no es una observación, es un dato.

Ahora `compileCaptionV2()` recibe los códigos confirmados **por concepto** (no el conjunto
plano de la foto) desde `src/lib/lora/verdad-referencia-v007.ts`, y cuando un concepto tiene
exactamente un código lo aplica solo, registrándolo en `tamanos_inferidos` para que la decisión
quede auditable. Resultado: productos con tamaño **852 → 910 de 982 (87% → 93%)**, y captions
sin ninguna pulgada **19 → 9**.

En el mismo diagnóstico salió otro defecto del generador: el guardián de consistencia
forma/tamaño aplicaba el patrón `^R-` del latex también a los foil, cuyos códigos vienen en
pulgadas (`18 IN`, `32 IN`). Les borraba todos los tamaños y dejaba `allowed_codes: []`. Con la
clave corregida a forma+material, los 21 conceptos foil recuperaron sus tamaños.

Lo que queda sin diámetro y **está bien así**: 17 productos que son murales, banderolas,
cortinas de flecos y serpentinas — no tienen diámetro que afirmar. La cobertura en globos es
910 de 965 (94%). Los 51 restantes son globos comprados en 2+ diámetros donde el modelo no
eligió cuál se ve; afirmar todos los comprados es una inferencia que la foto no respalda, y
queda como decisión abierta.

Dos decisiones que la implementación fijó, ambas con la medición detrás:

- **El tamaño se iza cuando la estructura comparte un solo diámetro.** Prefijarlo por producto
  daba `5-inch … 5-inch … 5-inch …, all at a single 5-inch size`: cuatro repeticiones del mismo
  dato, justo el patrón que no hay que enseñar.
- **El sustantivo cabeza se repite por producto y se deja así.** Colapsar
  `round latex balloons in white…, in gold…` exigiría mutar el `canonical_label`, que
  `writing-block.md` §9 obliga a rendir textual, y el handoff midió que el verbosismo del v2 es
  lo que sostiene la composición (9/9 contra 3/3 de portal del v3 compacto). La verbosidad acá
  no es un defecto a corregir.

- **E4.1** Extender el contrato a `CaptionContractInputV2` (con estructuras) en un módulo nuevo,
  `src/lib/lora/caption-contract-v2.ts`, sin romper la firma v1 ni los tests actuales
  (`scripts/test-lora-caption-regeneration.ts`).
- **E4.2** Renderer por estructura reusando `STRUCTURE_NOUNS`, `PLACEMENT_PHRASES` y
  `resolveRelations()` de `src/lib/ia/lora-caption-compiler.ts` — mismo léxico que el prompt de
  producción, que es el punto de todo esto.
- **E4.3** Tamaños en pulgadas vía `descripcionFisicaTamano()` (H3), forma corta `12-inch` en el
  caption; el anclaje largo («about the size of a…») es para el prompt, no para el caption.
- **E4.4** `linter-caption-v007.ts`: aplica el §6 como asserts sobre el texto final.
- **E4.5** Salida: `captions/<image_id>.txt` + `captions.jsonl` con diagnósticos por imagen.

### E5 · Revisión humana · en la galería que ya existe

- Muestra estratificada de 40 imágenes (por mitad, por tema, por `componentsStatus`) con contact
  sheet, al estilo de `data/staging/structure-v001/review-sample-25-contact-sheet.jpg`.
- Todas las `pending` de E4 pasan por revisión, sin excepción.
- Gate: **≥ 90% de acuerdo** en la muestra antes de empaquetar.

### E6 · Empaquetado

- `dataset-builder.ts` + `scripts/empaquetar-dataset-lora-300.py` adaptado: zip plano
  imagen/`.txt`, manifiesto `lora-dataset-manifest.v1` con `imageSha256`, `captionSha256`,
  `zipSha256`, `sourceDefinition`, `coveragePolicy` y `elements[]` por imagen.
- Registro en `lora_datasets` / `lora_dataset_images` / `lora_dataset_image_elements`
  (migración 015 ya existe).

### E7 · Entrenamiento y evaluación

- Valores de `RUNBOOK-ENTRENAMIENTO-V004.md`: `fal-ai/flux-2-trainer`, `steps=1000`,
  `learning_rate=0.00005`, `default_caption` vacío, `output_lora_format: fal`. ~US$6,40.
  Verificar que el team de fal sea **Customer Journey** antes de pagar.
- Evaluación con criterio **pre-registrado antes de mirar**, igual que el panel que cerró el
  diagnóstico: 6 seeds fijos (101…606), `lora_scale` 0,3 y 0,8, prompt literal de producción
  (`scripts/exp-prompt-produccion-xv.ts`), y los tres criterios del handoff — arco 3D que cierra;
  dos columnas separadas; mesa presente y escena en cuadro — **más uno nuevo**: identidad de
  producto correcta (color y acabado del concepto pedido, verificable contra la foto de catálogo
  que la galería ya trae por SKU).
- Comparar contra `sempertex-v004-1000.safetensors` en los mismos seeds.

---

## 8. Paralelización

### 8.1 Tres carriles independientes

Se pueden correr a la vez porque no comparten archivos de salida:

```
Carril A — Vocabulario (E1)            determinista, sin IA, 1 escritor al final
  A1 familia Fashion (161 títulos)
  A2 Reflex + Silk (64)
  A3 Pastel Mate + Pastel Dusk + Neon (45+)
  A4 Metalizado: números, estrellas, corazones, cartelería (59+)
  A5 Tubito/Modelar + Link-O-Loon (76+)
  A6 no-globo: instalable vs. mesa/papelería (185)
     → cada uno propone conceptos en su propio JSON; un solo merge al final (A7)

Carril B — Órdenes (E2.1 → E3 → E4)    276 imágenes, verdad de referencia lista
Carril C — Web (E0.2, E2.2 → E3 → E4)   94 imágenes, bloqueado por licencia y desglose
```

Dependencias reales: `A7 → B.E3` y `A7 → C.E3`, porque la anotación necesita
`allowed_concept_ids`. B.E2.1 y C.E0.2/E2.2 no esperan nada. El carril A es el camino crítico:
**empezar por ahí.**

### 8.2 Sharding reproducible

`shard = crc32(image_sha256) mod S`. Con `S = 8`, ~44 imágenes por shard. Ventajas: un shard se
puede repetir solo, el reparto no cambia si se agregan imágenes al final, y el runner es el mismo
binario con `--shard k/S`.

### 8.3 Pool de trabajadores y elección de modelo

Dos proveedores ya probados en el repo, con roles distintos:

| pasada | modelo | rol | concurrencia |
| --- | --- | --- | --- |
| P1 — anotación base | `gemini-3.6-flash` vía REST (patrón de `recaption-v004.ts`) | todas las imágenes, contrato completo | **4 por proceso** (valor probado); 2 procesos = 8 en vuelo |
| P2 — adjudicación | `openai/gpt-5.6-luna` variante `xhigh` vía `opencode` (patrón de `generarCaption.ts`) | solo las que fallan gates de E4, las que traen `uncertainties`, y las que tienen ≥ 2 conceptos confundibles en el desglose | **2** (un proceso por imagen, es caro) |

Antes de lanzar todo: **calibración con 25 imágenes** (muestra repartida, como ya hace
`--muestra 25`) corriendo P1 y P2 sobre las mismas, midiendo acuerdo en `visible_concept_ids`,
`structure_type`, `placement` y `relation`. Si el acuerdo en conceptos es < 85%, P1 no alcanza
para el eje de producto y hay que invertir los roles. Esa medición decide el presupuesto del
resto y cuesta 25 llamadas.

El techo real de concurrencia son los 429 del proveedor, no la CPU. Subir de 8 en vuelo solo
después de medir. `AbortSignal.timeout(120_000)` y reintento con backoff **por imagen**, no por
lote.

### 8.4 Idempotencia, reanudación, determinismo

- Una imagen = un archivo de salida. Escritura atómica (`.tmp` + `rename`), ya es el patrón del
  repo.
- `--solo-pendientes`: si existe anotación válida, se salta. Permite matar y relanzar sin perder
  trabajo.
- Clave de invalidación:
  `image_sha256 + prompt_sha256 + vocabulary_version + allowed_concept_ids_sha256`. Si cambia el
  vocabulario, se reanotan solas las imágenes afectadas; las demás no.
- `temperature 0.2`, `thinkingLevel: MINIMAL`, prompt fijo, orden de salida determinista. Dos
  corridas con la misma clave deben dar el mismo caption compilado: se testea con `--seed-check`
  sobre 10 imágenes.
- Ningún proceso escribe en `ordenes-decoracion` ni en `SEMPERTEX-TRAINING…`: son fuentes.

### 8.5 Lo que NO se paraleliza

- El merge del vocabulario (A7): un solo escritor, o aparecen colisiones de `concept_id`.
- E4.1 / E4.2 (el compilador): es código, se hace una vez.
- El manifiesto y el zip de E6: un solo proceso, con hashes.
- Los gates y el entrenamiento.

### 8.6 Presupuesto

- P1: una llamada con imagen por foto a un modelo flash. Del orden de centavos.
- P2: acotada por diseño a ~100 imágenes; el costo real depende del plan de opencode.
- Entrenamiento: **US$6,40** (1 000 pasos × US$0,0064). Saldo del team *Customer Journey*:
  **US$21,88** al 2026-08-28.
- Evaluación: 12 generaciones ≈ US$0,40 (61 generaciones costaron US$1,93).
- Queda margen para exactamente **una** segunda corrida (500 o 1 500 pasos, según resultado). No
  hay presupuesto para iterar tres veces: por eso los gates deterministas van antes de gastar.

---

## 9. Gates de aceptación

Ningún gate se declara «pasado» sin el número al lado. Lo no verificable queda `incomplete`.

**Vocabulario (E1)**
- Cobertura ≥ 95% de líneas `representado: true` del conjunto congelado.
- 0 colisiones globales, 0 fugas comerciales en `canonical_label`, 0 alias ambiguos sin contexto.
- `Reflex` intacto; `gold` / `rose gold` separados; latex/foil y round/heart separados.

**Anotación (E3)**
- 100% de las imágenes con JSON que valida el Zod estricto.
- 0 `visible_concept_ids` fuera de `allowed_concept_ids`.
- 0 `visible_sizes` sin código de variante que lo respalde.
- 100% de los `relation.target_structure_id` existentes.

**Captions (E4)**
- N/N con exactamente 1 trigger.
- 0 ocurrencias de `R-\d`, de palabras de iluminación, de `left`/`right`, de vocabulario de
  pedido, de texto transcripto de carteles.
- 100% de los pares bilaterales detectados rendidos con la frase bilateral.
- Longitud dentro de 55–85 palabras / 400–700 caracteres en ≥ 95%; 0 por encima de 750.
- Afinidad al corpus previo **reportada, no optimizada** (`scripts/lora-caption-affinity.ts`):
  está anti-correlacionada con la composición — el prompt v2 puntúa −6 y compone 9/9, el v3
  puntúa 90 y hace portal en 3/3. Sirve como detector de deriva, no como objetivo.

**Dataset (E6)**
- N imágenes = N captions, sin huérfanos.
- `imageSha256` / `captionSha256` por imagen y `zipSha256` del paquete.
- Licencia resuelta en el 100% de las imágenes web.
- Procedencia por imagen hasta la orden o la URL del artículo.

**Entrenamiento (E7)**
- Criterio pre-registrado por escrito antes de generar.
- ≥ 5/6 seeds a `lora_scale` 0,3 en los tres criterios composicionales.
- Identidad de producto correcta en ≥ 5/6 para el concepto pedido.
- Comparación cabeza a cabeza contra v004-1000 en los mismos seeds.

---

## 10. Scripts a crear o extender

| script | carril | qué hace |
| --- | --- | --- |
| `scripts/inventariar-dataset-v007.ts` | E0 | inventario + sha256 + duplicados + dimensiones |
| `scripts/proponer-conceptos-vocabulario.ts` | A | propone `ProductConcept` desde catálogo + desgloses |
| `scripts/medir-cobertura-vocabulario.ts` | A | la medición de H1, como gate repetible |
| `scripts/verdad-referencia-v007.ts` | B/C | `allowed_concept_ids` + `allowed_sizes` por imagen |
| `scripts/anotar-dataset-v007.ts` | B/C | runner de E3: `--shard k/S --solo-pendientes --modelo --concurrencia --muestra` |
| `scripts/adjudicar-anotaciones-v007.ts` | B/C | pasada P2 sobre el subconjunto dudoso |
| `src/lib/lora/caption-contract-v2.ts` | E4 | `CaptionContractInputV2` + `compileCaptionContractV2()` |
| `scripts/linter-caption-v007.ts` | E4 | §6 como asserts |
| `scripts/compilar-captions-v007.ts` | E4 | contrato → `.txt` + `captions.jsonl` + diagnósticos |
| `scripts/empaquetar-dataset-v007.ts` | E6 | zip + manifiesto + registro en SQLite |

Convenciones obligatorias, heredadas del repo: dry-run por defecto con `--apply` explícito,
`--only <image_id>`, `--resume`, `--report <path>` en Markdown, salida atómica, todas las rutas
resueltas dentro del workspace, y jamás escribir sobre una fuente.

Extender, no duplicar: `scripts/audit-lora-caption-corpus.ts` ya hace el join
captions × desglose × feedback × manifiesto y emite el reporte por dataset — la auditoría de v007
es un modo nuevo de ese script, no un script nuevo.

---

## 11. Riesgos

| riesgo | probabilidad | mitigación |
| --- | --- | --- |
| Pérdida del worktree codex sin commitear (H8) | media | E0.0 antes que nada |
| El VLM elige el concepto equivocado entre dos colores cercanos (fucsia/orquídea, dorado/champaña) | **alta** | `allowed_concept_ids` acotado por orden; pasada P2 de adjudicación; foto de catálogo por SKU ya disponible en la galería para revisión humana |
| Las 94 web se caen por licencia | media | los carriles son independientes: se empaqueta con 276 y las web entran en un v007.1 |
| El conjunto sigue mutando por borrados desde la galería | **alta** | `seleccion.json` firmado en E0.4; la galería opera sobre la selección, no sobre el disco |
| Trigger nuevo obliga a tocar producción | segura | está aislado en `sempertex-lora.ts` y el compilador de prompt; el modo viejo sigue resolviendo por `lora_mode_slots` |
| Sin presupuesto para tres corridas | segura | gates deterministas antes de pagar; una corrida planificada más una de reserva |
| Los 134 «no apto» se descartan o se aceptan sin evidencia | media | E0.3 mide la tasa de error del juicio automático con 40 revisiones humanas antes de decidir |

---

## 12. Orden de ejecución

```
E0.0 commit ──┬─> E0.1 inventario ──> E0.3 muestra elegibilidad ──> E0.4 selección firmada ─┐
              └─> E0.2 licencia web ────────────────────────────────────────────────────────┤
                                                                                           │
A1..A6 (6 en paralelo) ──> A7 merge ──> E1.3 invariantes ──> E1.4 gate cobertura ≥95% ─────┤
                                                                                           │
                                        E2.1 órdenes ──┐                                  │
                                        E2.2 web ──────┴──> E3 calibración 25 ─────────────┤
                                                                                           │
                            E4.1/E4.2 compilador (en paralelo con A y E2) ─────────────────┤
                                                                                           v
       E3 anotación en 8 shards ──> E4 compilación ──> E4.4 linter ──> E5 revisión ──> E6 zip ──> E7
```

Camino crítico: **A → E1.4 → E3 → E4 → E5 → E6 → E7.** El carril A y el compilador E4.1/E4.2
pueden arrancar hoy en paralelo, y el compilador no depende de ninguna llamada a IA.

---

## 13. Decisiones que necesito de tu parte

1. **El conjunto exacto.** Hoy hay 370 imágenes en disco (276 órdenes + 94 web). ¿348 es un
   objetivo — excluir 22 con criterio — o era el número que mostraba la galería a mitad de
   descarga y el conjunto real es 370?
2. **Los 134 «no apto para entrenamiento».** ¿Entran, salen o se re-revisan? Si salen, el dataset
   queda en ~142 + 94 = 236 imágenes, y eso cambia la comparación contra el v004-154.
3. **Trigger.** ¿`eventdecor_style_v3` nuevo (recomendado: la distribución de captions cambia) o
   se sigue con `eventdecor_style_v2`?
4. **Licencia de las 94 web.** Están en `pending_human_confirmation`. ¿Hay autorización para usar
   imágenes del blog oficial en un dataset de entrenamiento?
5. **Lateralidad.** Confirmar que los captions van mirror-safe (`on either side`) mientras el
   prompt de inferencia mantiene `left`/`right`: es la lectura que hago de las dos mediciones, y
   conviene que quede explícita antes de escribir cientos de captions.
6. **Alcance del vocabulario en los 185 no-globo** (servilletas, vasos, platos, manteles, velas).
   ¿Se les da concepto canónico o se describen genéricamente como elementos de mesa?

---

## Apéndice A — mediciones reproducibles

```bash
# Conteo por mitad
find /c/Users/davidt/Downloads/ordenes-decoracion -regextype posix-extended \
  -regex '.*/foto-[0-9]+\.(jpe?g|png|webp)' | wc -l
ls "/c/Users/davidt/Downloads/demo-decoracion-codex-lora-vocabulario/data/staging/lora-v006-orders-web-v001/original" | wc -l
```

```bash
# Estado del manifiesto web (registros vs. counts declarados)
node -e "const m=require('C:/Users/davidt/Downloads/demo-decoracion-codex-lora-vocabulario/data/staging/lora-v006-orders-web-v001/manifest.json');console.log(m.records.length,m.counts)"
```

```bash
# Auditoría del corpus actual (300 imágenes, vocabulario v1)
npx tsx scripts/audit-lora-caption-corpus.ts
```

Las mediciones de H1 (cobertura del vocabulario sobre los 742 títulos, con
`resolveProductConcept({text, productId})` contra `PRODUCT_VOCABULARY`) y de H7 (decodificación
de los 82 códigos de variante con `decodificarTamano()`) se hicieron con scripts exploratorios en
esta sesión; quedan formalizados como `scripts/medir-cobertura-vocabulario.ts` en E1, porque son
gates repetibles y no mediciones de una vez.
