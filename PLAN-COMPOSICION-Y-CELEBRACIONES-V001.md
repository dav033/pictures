# Plan — alineación prompting↔entrenamiento, composiciones ricas y gramática de celebración

Fecha: 2026-09-03 · Estado: propuesta, nada implementado · Base: auditoría de código + medición sobre 904 captions reales

Dos mitades que no se pueden separar:

- **Parte I — Auditoría (medida, no opinada).** Qué emite hoy el prompting, qué vio realmente cada
  LoRA, y por qué el sistema colapsa a «un arco y dos columnas».
- **Parte II — Plan.** Cómo alinear prompting↔entrenamiento, cómo ampliar el repertorio
  composicional, y cómo hacer que el modelo de construcción entienda **pasivamente** el tipo de
  celebración y qué debe y qué no debe llevar cada una.

Todo número sale de medir el corpus y leer el código. Las fuentes van con `archivo:línea`.

**Documentos que este plan continúa (no reemplaza):**
`HANDOFF-LORA-COMPOSICION.md` (diagnóstico composicional del v2) ·
`PLAN-CAPTIONS-DATASET-V007.md` (plantilla congelada del v007) ·
`PLAN-COMPILADOR-PROMPT-LORA-V2.md` (diccionario declarado) ·
`docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md` (arquitectura base+acentos) ·
`RUNBOOK-ENTRENAMIENTO-V004.md`.

**Aviso de topología, importante:** parte del trabajo de captions **no está en este worktree**.
El pipeline v007 (anotador de visión, compilador determinista `caption-contract-v2.ts`, vocabulario
de producto) vive en `C:\Users\davidt\Downloads\demo-decoracion-codex-lora-vocabulario`, rama
`codex/lora-vocabulario`, con ~308 rutas sin commitear y 3 commits de retraso respecto a `main`.
Cualquier subagente que toque captions **tiene que saber que ese worktree existe** o va a
reimplementar algo que ya está hecho.

---

# Parte I — Auditoría

## 0. Resumen ejecutivo

Seis hallazgos, en orden de impacto:

1. **Hay DOS gramáticas de entrenamiento y el prompting no está alineado con ninguna.** El LoRA en
   producción (v004, trigger `eventdecor_style_v2`) se entrenó con la gramática A: `large`/`small`,
   `flanked by … on either side`, cierre en `set against`. El LoRA nuevo (v007, trigger
   `eventdecor_style_v3`, 336 imágenes) se entrenó con la gramática B: `N-inch`, una cláusula por
   estructura, nombres canónicos de producto — y **está rechazado**. El compilador de inferencia
   (`lora-caption-v2.2`) habla una **tercera** gramática que no es ninguna de las dos.

2. **Medición del desfase contra el LoRA activo:** las **9** frases de emplazamiento que emite
   producción aparecen **0 veces en los 154 captions**. Las 2 colas fijas: **0**. Las 3 frases de
   relación: **0**. El sustantivo del arco (`organic balloon arch`): **0** — el corpus dice
   `balloon garland arch` (**30**). Y el cierre que está en **154/154** (`set against <pared> and
   <piso>`) producción **no lo emite nunca**.

3. **El LoRA no sabe qué es una celebración, y está probado en tres niveles.** Sobre los **904
   captions** de los cuatro datasets (154+300+336+114): `quinceañera`, `wedding`, `graduation`,
   `corporate`, `anniversary` = **0 ocurrencias**. `birthday` aparece 54 veces en v007 pero
   **siempre pegado a un objeto** (torta, pancarta, letras impresas), nunca como la ocasión de la
   escena. Es deliberado: el prompt del anotador nunca pregunta por la ocasión, y el compilador
   **bloquea con regex** `cumplea\w*` y `feliz`. Mientras tanto el prompt de inferencia sí emite
   `"fifteenth-birthday celebration"`, `"wedding celebration"`, etc. — **ninguna de esas frases
   existe una sola vez en el corpus**.
   → **Conclusión de arquitectura: el conocimiento «qué va y qué no va en cada celebración» tiene
   que vivir en la capa determinista + Gemini, no en el LoRA.**

4. **«Arco + dos columnas» está prescrito en siete lugares a la vez.** El más directo,
   `src/lib/ia/prompt-sistema.ts:117`, se lo pide literalmente al planificador: *«diseña 3–5
   estructuras coordinadas: una focal, dos soportes o marcos laterales»*. Y el eval oficial del
   plan (`scripts/eval-plan-decoracion.ts:44-47`) codifica arco + 2 columnas como fixture en sus 12
   casos: **ningún test puede detectar la falta de variedad**.

5. **El repertorio se estrecha en cada capa.** El dataset conoce **11** tipos de estructura, el
   planificador puede declarar **9**, la geometría puede medir **6**, el motor de escena rico (**17**
   funciones) está apagado por flag. El motivo estructural más frecuente del corpus v005
   (`cluster`, **129/300 = 43 %**) **no es proponible** por el planificador.

6. **Hay activos valiosos sin usar.** Un dataset de estructura (114 img, auditado, splits hechos) y
   uno de 300 img, ambos **nunca entrenados**. Y un compilador determinista de captions con una
   cláusula por estructura ya escrito en el worktree hermano.

Dato operativo que condiciona todo: **el saldo medido de fal es US$4,63**
(`reports/lora-debug/eval-v007-producto/manifiesto-eval-v007-producto.json`, `saldo_despues`).
Una corrida de 1000 pasos cuesta US$6,40. **Hoy no hay presupuesto para entrenar.** El plan está
ordenado para que el 80 % del valor salga sin gastar un dólar.

---

## 1. Método y fuentes

| Qué se midió | Fuente | n |
|---|---|---|
| Captions del LoRA **en producción** | `data/staging/recaption-v004/nuevo/*.txt` | 154 |
| Captions v005 (preparado, sin entrenar) | `data/staging/recaption-v005/nuevo/*.txt` | 300 |
| Captions v007 (entrenado, **rechazado**) | `data/lora-artifacts/datasets/lora-dataset-v007-ordenes/` | 336 |
| Captions de estructura (preparado, sin entrenar) | `data/staging/structure-v001/payload/*.txt` | 114 |
| Distribución oficial de composición | `data/processed/lora-v004-composicion.json` | 154 |
| Prompt de inferencia LoRA | `src/lib/ia/lora-caption-compiler.ts` (`lora-caption-v2.2`) | — |
| Prompt de inferencia Gemini | `src/lib/ia/build-image-prompt.ts:206` | — |
| Compilador de captions v007 | worktree `codex/lora-vocabulario`, `src/lib/lora/caption-contract-v2.ts` | — |
| Salidas reales | `reports/lora-debug/eval-v007-1000/*.png` (6 seeds × 2 escalas) | 12 |
| Etiqueta de ocasión por foto | `<ordenes>/…/feedback-N.json` → `categoria` | 276 |

Conteos con `grep -lio` → **cuentan captions que contienen el término, no ocurrencias**. Es la
métrica correcta: importa en cuántas fotos aparece el concepto.

---

## 2. Auditoría A — prompting vs entrenamiento

### 2.0 Primero: hay dos gramáticas de entrenamiento, no una

Esto hay que decidirlo antes de tocar una línea del compilador, porque «alinear el prompting al
entrenamiento» significa cosas opuestas según a cuál se alinee.

| | **Gramática A — v004** | **Gramática B — v007** |
|---|---|---|
| Trigger | `eventdecor_style_v2` | `eventdecor_style_v3` |
| Imágenes | 154 | 336 |
| Generador | `scripts/recaption-v004.ts` (Gemini, prompt de 7 reglas) | `caption-contract-v2.ts` (compilador **determinista**) |
| Tamaños | `large` / `small` · **`N-inch` = 0** | **`N-inch`** · `5-inch` 51 % · `12-inch` 35 % |
| Estructura del texto | prosa con relaciones | **una cláusula por estructura**, ordenada por `salience` |
| Lateralidad | `on either side` (mirror-safe) | `one at each end` (mirror-safe) |
| Producto | ausente | `canonical_label` dentro de la cláusula de su estructura |
| Acabados | `matte`, `glossy chrome`, `metallic foil` | `Fashion`, `Reflex`, `Silk`, `Pastel Matte`, `Link-O-Loon®` |
| Cierre | `set against …` 154/154 | `set against …` 336/336 |
| **Estado** | **APROBADO 6/6 a escala 0,8 · EN PRODUCCIÓN** | **RECHAZADO 0/6** (acabado 0/6, diámetro 0/6) |

Y el compilador de inferencia habla una tercera cosa. Los sustantivos divergen en tres tablas
distintas para el mismo tipo:

| tipo | Entrenamiento v007 | **Inferencia (producción)** | Entrenamiento structure-v001 |
|---|---|---|---|
| `arco` | `organic balloon arch` | `organic balloon arch` | `balloon arch` |
| `centro_mesa` | `low balloon centerpiece` | `balloon centerpiece` | — |
| `kit` | `coordinated decoration kit` | `balloon decoration kit` | — |
| `backdrop` | `decorated backdrop` | `decorated backdrop` | `decorative backdrop` |

Y ninguno de los tres coincide con lo que el corpus del LoRA **activo** contiene de verdad:
`organic balloon arch` **0/154** frente a `balloon garland arch` **30/154**.

**Matiz que hay que respetar, no revertir:** la lateralidad está desalineada **a propósito** y con
medición detrás. El entrenamiento prohíbe `left`/`right` con regex porque el trainer de fal voltea
las imágenes y no se puede apagar la augmentación (`caption-contract-v2.ts:53`). La inferencia sí
usa `one standing on the left and one on the right` porque **esa capacidad la aporta el modelo
base, no el LoRA**, y se midió 6/6 (`PLAN-CAPTIONS-DATASET-V007.md:427`). Es una asimetría
justificada. Cualquier cambio ahí es un A/B a medir, **no** una corrección obvia.

### 2.1 La gramática real del corpus en producción (v004)

Plantilla observada en **154/154**, literal del generador (`scripts/recaption-v004.ts:49-51`):

```
${TRIGGER}, <structures with their materials and their spatial arrangement>, set against <the wall/floor/room surface>.
```

Ejemplo (`data/staging/recaption-v004/nuevo/10199-1.txt`):

```
eventdecor_style_v2, a circular metal ring frame wrapped in an organic balloon garland of large and
small light blue, dark blue, and glossy chrome silver balloons, with a circular sign mounted in the
center, positioned behind a low white table displaying gifts and treats, set against a plain beige
wall and tiled floor.
```

| Eje | Valor medido |
|---|---|
| Longitud | mediana **53** palabras · min 27 · max 77 |
| Cierre `set against …` | **154/154 (100 %)** |
| Acabado | `matte` 122 (79 %) · `glossy` 86 · `glossy chrome` 80 (52 %) · `metallic` 47 · `pearl` 13 · `clear` 10 · `satin` 7 |
| Tamaño | **solo relativo**: `large` 108 · `small` 103 · `large and small` 46 · `tall` 67 · `low` 51 · **`inch` 0** |
| Espacial | `featuring` 39 · `behind` 30 · `positioned` 29 · `flanked by` 24 · `beside` 24 · `framing` 23 · `above` 20 · `topped with` 19 · `in front of` 14 · `along the` 12 · `on either side` 11 · `at the base` 11 · `centered` 11 · `hanging` 9 · `below` 8 · `suspended` 7 |
| Entorno | `wall` 119 (77 %) · `floor` 95 (62 %) · `tiled floor` 37 · `ceiling` 16 · `studio` 11 · `carpet` 9 · **`outdoor` 3 · `garden` 1** |
| Registro fotográfico | `photorealistic` **0** · `photograph` **0** · `depth` **0** · `lighting` **0** |
| Estilo | `romantic`/`elegant`/`bohemian`/`glamorous`/… **0 en los 904 captions** |

Dos consecuencias que hay que interiorizar antes de tocar código:

- **El corpus no habla de fotografía ni de estilo.** El recaption v004 sacó el boilerplate de
  iluminación/cámara a propósito (regla 1 del prompt, `recaption-v004.ts:53`). Todo el bloque
  «foto» que el compilador añade al final es ruido fuera de distribución. Y `STYLE_WORDS`
  (`romantic`, `elegant`, `boho`…) es puro invento de inferencia: **0/904**.
- **El corpus es de interior, pared lisa y piso duro.** `outdoor` 3, `garden` 1. Pedirle jardín o
  playa al LoRA es pedirle algo que no vio 151 de 154 veces.

### 2.2 Lo que emite producción, contado contra el corpus del LoRA activo

Compilador activo: `src/lib/ia/lora-caption-compiler.ts` (`lora-caption-v2.2`), invocado en
`src/app/api/generate/route.ts:935`. `LORA_PROMPT_VERSION` default `v2`.

**Sustantivos de estructura** (`:44-55`):

| Emite | Corpus v004 | Veredicto |
|---|---|---|
| `organic balloon arch` | **0** | ❌ corpus: `balloon garland arch` **30** |
| `asymmetrical balloon half-arch` | **0** | ❌ sin referente |
| `organic balloon garland` | 20 (`balloon garland` 65) | ✅ |
| `balloon column` | 11 | ✅ débil (7 %) |
| `balloon bouquet` | 5 | ⚠️ |
| `balloon wall` | 9 | ✅ |
| `balloon centerpiece` | 5 | ⚠️ (v007 usa `low balloon centerpiece`) |
| `decorated backdrop` | **0** | ❌ corpus: `backdrop panel` **17** / `backdrop` 49 |
| `balloon decoration kit` | **0** | ❌ |
| `decorative accessory` | **0** | ❌ |

**Frases de emplazamiento** (`:57-67`) — **las nueve, 0/154**:

`framing the venue entrance` · `centered around the stage photo area` · `placed on the main table` ·
`standing on the left side` · `standing on the right side` · `installed against the rear wall` ·
`grounded across the front of the stage` · `distributed across the guest tables` ·
`suspended overhead from the ceiling`

**Relaciones y colas fijas:**

| Emite | Corpus v004 |
|---|---|
| `flanking the main arch` (`:326-346`) | **0** |
| `beneath the main arch` | **0** |
| `behind the main arrangement` | **0** |
| `matching one another, one standing on the left and one on the right` | **0** (asimetría deliberada, §2.0) |
| `set up for a <evento>` | **0** |
| `wide photorealistic event photograph` | **0** |
| `natural depth, believable floor contact and supports` | **0** |
| cues de venue (`recognizable indoor event hall…`) | **0** (`event hall` 0 · `ballroom` 0 · `venue` 0) |
| **`set against <pared> and <piso>`** | **154 — y producción NO lo emite** |

**Escala y acabado:**

| Emite | Corpus | Corpus dice |
|---|---|---|
| `grand` · `compact` · `small-accent` | **0** | `tall` 67 · `low` 51 |
| `low coordinated` (`:354`) | **0** | `low` 51 |
| `fashion` (`FINISH_WORDS`) | **0** en v004 | `matte` 122 · (`Fashion` sí existe, pero en v007: 274/336) |

**Color:** `COLOR_ALIASES` (`:96-121`) colapsa `azul rey`, `azul caribe` → `blue` y
`verde esmeralda` → `green`. El corpus v007 enseñó `royal blue` (16), `aquamarine` (8),
`eucalyptus green` (23) como identidades separadas. Ya está documentado como defecto H10 en
`PLAN-CAPTIONS-DATASET-V007.md:270`.

> **Dónde sí está alineado:** color base y acabado del eje `matte`/`glossy`. **Dónde está roto:**
> el eje estructural y espacial completo, que es exactamente el que produce el colapso composicional.

### 2.3 Repertorio de estructuras: se estrecha en cada capa

Distribución del entrenamiento (`data/processed/lora-v004-composicion.json`, n=154) y del v007
(`manifest.json` → `statistics.structures`, n=336):

| Estructura | v004 | % | v007 | % | ¿Planificable? | ¿Cotizable? |
|---|---|---|---|---|---|---|
| Guirnalda orgánica | 35 | 23 % | 116 | 34,5 % | ✅ `guirnalda` | ✅ |
| Arco de guirnalda | 30 | 19 % | 74 | 22,0 % | ✅ `arco` | ✅ |
| **Marquesina / letras** | 18 | 12 % | (prop) | — | ❌ | ❌ |
| **Panel de fondo** | 17 | 11 % | 49 | 14,6 % | ⚠️ `backdrop` sin geometría | ❌ |
| Columna | 11 | 7 % | 82 | 24,4 % | ✅ `columna` | ✅ |
| Muro de globos | 9 | 6 % | 42 | 12,5 % | ✅ `pared` | ⚠️ eje 0, usa área |
| **Racimo / cluster** | 9 | 6 % | — | — | ❌ | ❌ |
| **Aro metálico** | 7 | 5 % | (→`accesorio` 31) | 9,2 % | ❌ | ❌ |
| Centro de mesa | 6 | 4 % | 11 | 3,3 % | ✅ `centro_mesa` | ⚠️ modelado como eje lineal |
| Bouquet | 5 | 3 % | **142** | **42,3 %** | ❌ (existe en `lora-semantics`, no en `plan/tipos`) | ❌ |
| **Escultura** | 3 | 2 % | 1 | 0,3 % | ❌ | ❌ |
| `kit` | — | — | 26 | 7,7 % | ✅ sin geometría | ❌ |
| `semiarco` | — | — | 12 | 3,6 % | ✅ | ✅ |

En el corpus v005 (n=300) el ranking cambia radicalmente: **`cluster` 129 (43 %)**, `table` 67,
`pedestal` 36, `column` 22, `marquee` 18, `ceiling` 16, `sculpture` 15, `balloon wall` 13,
`centerpiece` 12, `ring frame` 7, `cascade` 3.

**El motivo más frecuente del corpus más grande que existe es exactamente el que el sistema no
puede pedir.**

Cadena de estrechamiento:

| Capa | Vocabulario | Archivo |
|---|---|---|
| Dataset LoRA | **11** estructuras | `data/processed/lora-v004-composicion.json` |
| Semántica LoRA | **10** tipos | `src/lib/ia/lora-semantics.ts:3` |
| Plan (autoridad de producción) | **9** tipos | `src/lib/plan/tipos.ts:3` |
| Geometría / cotización | **6** figuras | `src/lib/medidas/geometria.ts:7` |
| Motor de escena V2 | **17** funciones | `src/lib/rag/taxonomy/v3.ts:70` — **apagado** |

```ts
// src/lib/medidas/geometria.ts:7
export type Figura = "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa";
```

Y el efecto perverso: `src/lib/plan/tipos.ts:95-100` exige `unidades_declaradas` + `variant_id` por
material a toda pieza **sin** geometría, y `src/lib/plan/medidas-defecto.ts:13-15` no les da medidas
por defecto. **Proponer algo que no sea arco/columna/guirnalda tiene más probabilidad de que la
tool devuelva `ok:false`.** El camino de menor riesgo es siempre el mismo.

### 2.4 La celebración no existe en el entrenamiento — probado en tres niveles

**Nivel 1 · Prohibida por diseño.** La plantilla congelada
(`PLAN-CAPTIONS-DATASET-V007.md:403`) no tiene campo de ocasión. El prompt del anotador de visión
(`anotar-dataset-v007.ts:269-317`) **nunca menciona** ocasión, tema, celebración ni evento. Y el
compilador **bloquea con regex** (`caption-contract-v2.ts:62`) los términos `cumplea\w*` y `feliz`:
un caption que dijera «cumpleaños» sería rechazado como `forbidden_language`.

**Nivel 2 · El campo existe y no se renderiza.** `caption-contract-v2.ts:106` acepta
`scene.event_type` y `:791` lo rellena desde la `categoria` de la orden:

```ts
event_type: contexto.eventType && contexto.eventType !== "no_asignada" ? contexto.eventType : undefined,
```

Pero el ensamblado del caption (`:682-689`) usa solo `clausulas`, `acentos`,
`non_purchased_elements` y `scene.venue_surface`. **`event_type` jamás llega al texto.**
→ Es un hook ya construido, a una línea de distancia (WP-2.6).

**Nivel 3 · Medición sobre los 904 captions empaquetados.**

| Dataset | ocasión como **escena** | ocasión como **prop** |
|---|---|---|
| v004 (154) | **0** | 2 (`birthday cake`, `piñata`) |
| v005 (300) | 4 — todas dentro del **nombre del SKU** (`E-DECOR BABY SHOWER - GENDER REVEAL`) | 4 |
| v007 (336) | 1 — `a BABY SHOWER banner` (prop rotulado) | 64 |
| structure-v001 (114) | **0** | 2 |

`quinceañera` · `quince` · `XV` · `wedding` · `bridal` · `graduation` · `corporate` ·
`anniversary` = **0 ocurrencias en los cuatro corpus**. Las 54 apariciones de `birthday` en v007
son **todas** props o estampados:

```
… alongside a printed backdrop, a birthday cake, party tables and chairs and a foil star balloon, …
… round latex balloons in assorted colors with a Pastel Matte finish and printed birthday lettering, …
```

Y hay una vuelta más: la regla E1.1 (`PLAN-CAPTIONS-DATASET-V007.md:485`) **colapsa
deliberadamente** la ocasión que venía en el texto del producto: dos «Feliz Cumpleaños» distintos
en foil dorado colapsan en `round foil balloon in gold with printed birthday lettering`.

**Y la etiqueta tampoco está en los metadatos.** La única taxonomía de ocasión por foto es
`categoria` en el sidecar de la orden (`src/lib/ordenes/tipos.ts:43`):

```ts
export const CATEGORIAS_ENTRENAMIENTO = [
  "no_asignada", "general", "amor_y_amistad", "halloween",
  "navidad", "xv_anos", "fiesta_infantil", "fiesta_generica",
] as const;
```

Sobre las 276 fotos de orden del universo completo: `no_asignada` **143 (52 %)** ·
`general` **131 (47 %)** · `navidad` **1** · `amor_y_amistad`, `halloween`, `xv_anos`,
`fiesta_infantil`, `fiesta_generica` = **0 cada una**. Y `boda`, `graduacion`, `corporativo`,
`baby_shower`, `bautizo` **no existen ni en el enum**.

**Qué se sigue, con precisión:**

- El token de ocasión **no activa nada aprendido** en ningún LoRA. Lo resuelve el text-encoder de
  FLUX.2 (VLM Mistral-Small-3.2 24B), que entiende la palabra pero no tiene estilo Sempertex
  asociado a ella.
- **No tiene sentido intentar que «el LoRA entienda las celebraciones» con el material actual.** Sí
  tiene sentido —y es lo que pide el brief— que **Gemini y la capa determinista** las entiendan.
- El camino de entrenamiento que sí serviría es el de
  `docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md §4` (1 base + acentos por tema compuestos en
  inferencia), y hoy está bloqueado: `src/lib/lora/mode-resolver.ts:213` lanza
  `LORA_MULTI_UNSUPPORTED` mientras `FAL_MULTI_LORA_SUPPORTED !== "true"` (`.env.example:35` lo fija
  en `false`). Y requiere etiquetar la ocasión primero, que hoy es 0 % útil.

Mientras tanto la ocasión sí viaja al prompt, pero solo como decoración semántica:
`src/lib/ia/visual-context.ts:80-86` (7 regex → `"birthday celebration atmosphere"`) ·
`src/lib/ia/lora-caption-compiler.ts:69-77` (`EVENT_WORDS`, 8 claves) ·
`src/lib/plan/tipos.ts:140` (`ocasion` como texto libre, *«never restricted to catalog
occasions»*). **Ninguna cambia una sola decisión composicional.**

### 2.5 Cinco taxonomías de celebración incompatibles

| Taxonomía | Valores | Archivo | Para qué sirve hoy |
|---|---|---|---|
| `OCASIONES_CATALOGO_V2` | 11 | `src/lib/rag/taxonomy/v2.ts:113` | filtro de tags de producto |
| `EventFamilySchema` | 7 | `src/lib/scene/tipos.ts:108` | metadato narrativo |
| `detectEvent` | 7 regex | `src/lib/ia/visual-context.ts:80` | cue de «atmósfera» |
| `EVENT_WORDS` | 8 | `src/lib/ia/lora-caption-compiler.ts:69` | frase del caption |
| `CATEGORIAS_ENTRENAMIENTO` | 8 (5 vacías) | `src/lib/ordenes/tipos.ts:43` | etiqueta del dataset |
| `DEFINICIONES` (Happie) | 6 | `packages/happie-package-ia/src/tipos-curados.ts:22` | wizard de paquetes |
| Semilla admin | 9 (**la única** con infantil/adulto) | `src/lib/db.ts:303` | arquitectura del admin |

Y el clasificador de producción colapsa lo que más importa:
`src/lib/rag/query-parser/parse-event.ts:286` mete **XV, cumpleaños infantil, cumpleaños adulto,
graduación y aniversario en el mismo bucket `milestone`**, y `:579` reduce `event_type` a
`"wedding" | "open"`.

**No existe en ninguna parte del planificador la distinción infantil/adulto.** Es justamente la que
más cambia qué debe y qué no debe llevar una decoración.

### 2.6 Conflictos internos del prompt (bugs reales)

1. **Prohibición de texto vs inyección de IDs.** `build-image-prompt.ts:265` ordena *«never render
   internal project IDs … element names, quantities, measurements»* y `tamano-fisico.ts:89` inyecta
   literalmente `EST_01_ARCO — "Arco principal", 120 balloons total:` en el mismo prompt. Peor:
   `src/lib/plan/coherencia.ts:9` **exige** que el `estructura_id` o el nombre estén presentes o
   lanza error, mientras `lora-prompt-preflight.ts:117` **rechaza** el prompt si detecta
   `EST_\d{2}`. Las dos rutas tienen requisitos mutuamente excluyentes sobre el mismo dato.

2. **El preflight exige frases que el corpus no tiene.** `lora-prompt-preflight.ts:63,65` exige
   `"main table"` (**1/154**) y `"rear wall"` (**0/154**). Si se corrige el compilador sin corregir
   el preflight, **el preflight bloquea el fix**.

3. **El anti-cliché nombra el cliché.** `build-image-prompt.ts:140` dice *«(organic garland, arch,
   column, or clustered frame as appropriate)»* y `:317` *«Group compatible balloons into a cohesive
   arch, garland, columns, or organic clusters»*.

4. **La única cardinalidad instrumentada es arcos/columnas** (`build-image-prompt.ts:168`):
   ```ts
   const kind = normalized.includes("arco") ? "arches" : normalized.includes("columna") ? "columns" : element.category;
   ```

5. **`polaridad: "prohibido"` es código muerto.** Declarado en `src/lib/plan/tipos.ts:24` y `:38`,
   nunca producido ni consumido. **Es el hueco exacto donde encaja «qué no debe ir».**

### 2.7 Parámetros de inferencia

| Parámetro | Valor | Estado |
|---|---|---|
| Endpoint | `fal-ai/flux-2/lora` (texto) / `/lora/edit` | `sempertex-lora.ts:4-5` |
| LoRA activo | **v004-1000**, `eventdecor_style_v2`, rank 16, 1000 pasos, lr 5e-5, 6,5 épocas, US$6,40 | `.env.local:29` + `sempertex-lora.ts:6-7` |
| `SEMPERTEX_LORA_SCALE` | **0.8** (validado 6/6 para v004; el v2 roto exigía 0,3) | `sempertex-lora.ts:77` |
| `guidance_scale` | **3.5 hardcodeado** — el default de FLUX.2 es **2.5** | `sempertex-lora.ts:148` · sin testear |
| `num_inference_steps` | 28 (= default) | `sempertex-lora.ts:149` |
| Multi-LoRA | **bloqueado** | `mode-resolver.ts:213` |
| Escalas por especialización | `product: 0.3` · `structure: 0.6` | `mode-resolver.ts:71` |
| LoRA + foto de espacio | **prohibido** | `route.ts:850` |
| Negative prompt (ruta LoRA) | **no existe** en el payload | `sempertex-lora.ts:142-159` |
| v007 en producción | **bloqueado** por `evaluation_status = rejected`; solo local con `LORA_ALLOW_REJECTED_FOR_TESTING=true` | `mode-resolver.ts` |

### 2.8 Estado de activos: cuatro datasets, dos corridas, un LoRA aprobado

| Dataset | Imágenes | Trigger | Corrida | Veredicto |
|---|---|---|---|---|
| `lora-dataset-v004-154` | 154 | `eventdecor_style_v2` | `lora-run-v004-1000` | ✅ **aprobado 6/6 · producción** |
| `lora-dataset-v007-ordenes` | 336 | `eventdecor_style_v3` | `lora-run-v007-1000` | ❌ **rechazado 0/6** |
| `lora-dataset-v005-300` | 300 | `eventdecor_style_v2` | — | **nunca entrenado** |
| `lora-dataset-structure-v001-114` | 114 | `eventdecor_structure_v1` | — | **nunca entrenado** (`draft: true`) |

Detalle del rechazo del v007
(`reports/lora-debug/eval-v007-producto/veredicto-v007-producto.json`): `color` **6/6** ·
`acabado` **0/6** («Fashion conservó reflejos especulares fuertes; no hubo separación mate») ·
`diametro` **0/6** («las salidas de 5-inch y 24-inch fueron visualmente similares»).
La causa del fallo de diámetro está medida: **`24-inch` + `36-inch` juntos son 12 captions
(3,6 %)** del corpus v007. No había masa para aprender el extremo grande.

> **Matiz importante: el v007 no se rechazó por composición, se rechazó por fidelidad de producto.**
> Su gramática de una-cláusula-por-estructura no está desacreditada.

**Tres problemas de higiene del v007 que hay que arreglar antes de reutilizar ese dataset:**

1. **123 de las 253 fotos de orden estaban marcadas `aptoParaEntrenamiento: false` y entraron
   igual.** Es el hallazgo H6 de `PLAN-CAPTIONS-DATASET-V007.md:244`, no resuelto.
2. **La banda de longitud declarada no se cumplió.** Declarado 55–85 palabras / tope 750
   caracteres (`caption-contract-v2.ts:826`); medido: mediana 62, **p90 115, max 177 palabras**;
   caracteres p90 741, **max 1212**.
3. **271 de las 276 revisiones las hizo la IA sola.**

**El dataset de estructura está listo y nunca se gastó** (`data/staging/structure-v001/audit.json`):
114 aceptadas, 0 rechazadas, splits **81/22/11**, `captionsWithExactTrigger: 114`,
`captionsWithForbiddenTerms: 0`, `vocabularyPass: true`. Su caption antepone tags canónicos:

```
eventdecor_structure_v1, balloon arch, organic balloon garland, decorative backdrop,
complete event decoration installation, <cuerpo v004 completo>
```

Clases: `guirnalda` 65 · `backdrop` 40 · `arco` 37 · `instalacion_completa` 30 · `bouquet` 20 ·
`columna` 11. Multi-estructura **48/114 (42 %)**. `missingLocalClass: "semiarco"`.

**Pero su mapeo de clases pierde información y se contradice con la regla crítica del v007**
(`scripts/build-structure-dataset-v001.ts:75-87`):

```ts
"structure:aro-metalico":      ["arco"],          // ← contradice "un aro metálico NUNCA es arco"
"structure:centro-de-mesa":    ["bouquet"],       // ← colapsa dos tipos distintos
"structure:marquesina-letras": ["backdrop"],      // ← colapsa marquesina en panel
"structure:muro-de-globos":    ["backdrop"],
"structure:escultura":         ["instalacion_completa"],
```

Frente a la desambiguación que el propio proyecto declara crítica
(`anotar-dataset-v007.ts:275-289`): *«Un panel plano recortado en forma de arco es "backdrop",
NUNCA "arco". Un aro metálico desnudo es "accesorio", NUNCA "arco". Confundir esto es el error más
caro del dataset.»*

**Entrenar el LoRA de estructura con este mapeo reintroduce a mano el bug del «portal
rectangular».** Hay que arreglar el mapeo antes (WP-4.1).

Encuadre del dataset de estructura: 3:4 → 38 · 1:1 → 34 · 9:16 → 11 · 4:3 → 10 · **≥3:2 → 3**.
La app genera 3:2. El hueco de dominio sigue abierto.

---

## 3. Auditoría B — por qué siempre sale «un arco y dos columnas»

Siete mecanismos independientes empujan al mismo resultado. Arreglar uno no mueve la aguja.

**B1 · El prompt lo prescribe.** `src/lib/ia/prompt-sistema.ts:117`:
> *«Para una decoración principal de evento (salvo que el cliente pida una pieza única), diseña 3–5
> estructuras coordinadas: **una focal, dos soportes o marcos laterales** y, cuando aporte valor, un
> acento de mesa/suelo/backdrop. No resuelvas todo como un único arco genérico.»*

«Una focal + dos laterales» **es** arco + dos columnas. La cláusula final previene *un* arco, no
*arco + 2 columnas*: la instrucción que la precede lo pide.

**B2 · El ejemplo de la tool lo nombra.** `src/lib/ia/herramientas.ts:311` — el único ejemplo de
`estructura_id` que ve el modelo: `"EST_01_ARCO, EST_02_COLUMNAS..."`.

**B3 · El enum de ubicaciones lo codifica.** `src/lib/plan/tipos.ts:8` contiene `arco_central`,
`lateral_izquierdo`, `lateral_derecho`; `src/lib/plan/ubicaciones.ts:9-12` les da bboxes fijos.
**No hay ubicación para racimos dispersos, perímetro, esquinas, multipunto colgante ni recorrido.**

**B4 · El validador fija el piso en 3.** `src/lib/plan/restricciones.ts:224` exige 3–5 estructuras
para evento abierto; `src/lib/plan/tipos.ts:168-176` exige ≥1 focal, ≤1 en `fondo_pared`, ≤1 en
`techo`. Y `prompt-sistema.ts:118` empuja al **mínimo** («el techo manda»). **El plan legal más
barato es exactamente 1 focal + 2 laterales.**

**B5 · El presupuesto poda justo la variedad.** `prompt-sistema.ts:125` ordena, ante
`PRESUPUESTO_EXCEDIDO`, *«quita la estructura de menor valor (empezando por acentos y rellenos)…
reduce el número de colores distintos»*. Y `src/lib/rag/presupuesto/ensamblar.ts:33`:
```ts
const ORDEN_RECORTE: RolPresupuesto[] = ["servicio", "acento", "soporte", "relleno", "focal"];
```
Los tres ejes de variedad caen primero; el focal es intocable. Además
`src/lib/rag/presupuesto/franjas.ts` fija `focal: {min:1, max:1}` en las franjas `focal` y `escena`,
con categorías `[guirnalda_arco, kit, globo_numero_letra]`. Y en la franja `detalle` (0–50k COP),
`focal: {min:0, max:0}` con categorías vacías, porque la mediana de `guirnalda_arco` (COP 79.800)
ya supera el techo.

**B6 · El retrieval del rol focal solo busca arco.** `src/lib/rag/retrieval/por-rol.ts:35`:
```ts
focal: "elemento protagonista de la decoración: arco, guirnalda o kit armado",
```

**B7 · El motor que lo arreglaba está apagado.** `SCENE_PLAN_V2_*` → `false`
(`src/lib/ia/feature-flags.ts:19-21`). Y aun encendido, su receta genérica
(`src/lib/scene/recipes/generic-event.v1.ts:12-37`) es *«1 focal + 1 fondo + hasta 2 acentos
laterales»* — el mismo patrón. Peor: `src/lib/scene/recipes.ts:82-118` escribe las `requiredZones`
de todos los perfiles ≥`balanced` en vocabulario de la receta de **boda** (`ceremony_aisle`,
`guest_seating`), zonas que la receta genérica no produce → todo evento no-boda degrada siempre a
`focal_only` (`src/lib/scene/coverage.ts:148-160`). **Bug latente.**

Y la decisión de diseño que lo sostiene todo, escrita explícitamente en
`src/lib/scene/tipos.ts:96-99`:
> *«Datos espaciales que gobiernan composición. El evento queda como señal narrativa; nunca decide
> por sí solo geometría o número de estructuras.»*

Las cuatro variables que sí deciden son constantes en la práctica: `space` casi siempre `undefined`
(el parser no hace NLP de espacio), `requested_views` default `["ceremony"]`, `complexity` default
`"balanced_scene"`, `budget_cop` solo si hay palabra disparadora. **La única variable que cambia
entre peticiones —el evento— está deliberadamente excluida de decidir estructura.** De ahí el
resultado invariante.

**Y el meta-problema: ningún test puede detectarlo.** `scripts/eval-plan-decoracion.ts:44-47`
codifica `EST_01_ARCO` (`arco_central`) + `EST_02_COLUMNA` (`lateral_izquierdo`) +
`EST_03_COLUMNA` (`lateral_derecho`) como fixture de sus **12** briefs. **El eval oficial del plan
mide arco + 2 columnas, doce veces.** No existe ningún eval que tome N tipos de evento distintos y
falle si producen la misma composición.

Bonus: `src/lib/rag/retrieval/slot-query-planner.ts:80,164-170` **hardcodea la ocasión `"boda"`
para todo slot de todo evento**. Vive en la rama V2, pero es una bomba si se enciende.

### 3.1 Evidencia visual

`reports/lora-debug/eval-v007-1000/` — 6 seeds × 2 escalas, prompt fijo pidiendo *«a grand organic
balloon arch … two balloon columns … a low coordinated balloon centerpiece … quinceañera
celebration atmosphere»*. Inspeccionadas `scale08-seed101` y `scale1-seed606`:

- Composición **idéntica** entre seeds y entre escalas: arco + columnas + mesa con faldón.
- Se pidieron **dos** columnas; se renderizaron **cuatro** (las patas del arco cuentan como par).
  Es la falla de cardinalidad que predice el 7 % de bilateralidad del corpus v004.
- `quinceañera celebration atmosphere` produjo **cero** iconografía de XV: sin número, sin
  cartelería, sin mesa de postres. Coherente con `quinceaner` 0/904.
- El «centro de mesa de globos» salió como **arreglo floral** en seed 606: 5/154 no da masa.
- Apareció una **cortina de fondo** que el prompt no pidió y que `build-image-prompt.ts:137`
  prohíbe explícitamente — es el prior de `backdrop panel` (17/154) filtrándose.

---

# Parte II — Plan

## 4. Principios de diseño

Cinco reglas que gobiernan todo lo de abajo. Si una tarea las contradice, la tarea está mal.

1. **La gramática del corpus manda sobre la elegancia del código.** Si el corpus dice
   `balloon garland arch`, el compilador dice `balloon garland arch`. No se «mejora» el lenguaje del
   prompt: se copia el del entrenamiento. Toda frase nueva se justifica con su frecuencia medida.
   **Excepción documentada:** la lateralidad (§2.0), donde la asimetría entrenamiento↔inferencia es
   deliberada y está medida. Ahí se mide, no se asume.
2. **Una métrica antes de cada cambio.** `HANDOFF-LORA-COMPOSICION.md` documentó un caso donde una
   métrica de afinidad (90/100) estaba **anti-correlacionada** con la calidad composicional. La
   métrica de este plan no es «parecido al corpus», es **variedad composicional + adecuación a la
   celebración**, medida sobre planes generados.
3. **La celebración es determinista; el estilo es del LoRA.** La celebración decide **qué piezas,
   dónde y qué está prohibido** (capa determinista + Gemini). El LoRA decide **cómo se ve el
   globo**. No se mezclan.
4. **Pasivo significa pasivo.** Nada de UI nueva, ninguna pregunta al cliente, ningún campo
   obligatorio. La gramática de celebración se deriva del texto libre que ya existe
   (`brief.tipo_evento`, `plan.ocasion`, `event_label`, `solicitudOriginal`) y **degrada a un perfil
   neutro** cuando no reconoce nada. Un evento desconocido nunca debe fallar ni empeorar.
5. **Gratis antes que caro.** Saldo de fal: **US$4,63**. Fases 0–3 cuestan **US$0** en generación;
   solo la Fase 4 gasta, y solo con criterio de aceptación escrito de antemano.

---

## 5. Fase 0 — Instrumentación (US$0, bloquea todo lo demás)

Sin esto no hay forma de saber si algo mejoró. **Ninguna otra fase empieza antes de que la Fase 0
esté en verde.**

### WP-0.1 · Eval de variedad composicional
**Nuevo:** `scripts/eval-variedad-composicion.ts` + `npm run plan:eval-variedad`

Toma **N ≥ 24 briefs** de al menos 8 celebraciones distintas (XV, cumpleaños infantil, cumpleaños
adulto, baby shower, boda, bautizo, graduación, corporativo, Halloween, Navidad, San Valentín,
revelación de género) × 3 franjas de presupuesto, corre la cadena real (`resolverPlan` →
`planBlueprint` → `buildApprovedSceneSpec` → `compileLoraCaption` + `buildImagePrompt`)
**sin llamar a ningún proveedor de imagen**, y reporta:

| Métrica | Definición | Objetivo |
|---|---|---|
| `tipos_distintos` | valores distintos de `tipo` en el corpus de planes | ≥ 7 de 9 |
| `entropia_tipo` / `entropia_ubicacion` | entropía de Shannon normalizada | reportar línea base |
| `colision_composicional` | % de pares de briefs de **celebración distinta** con el mismo multiset `{tipo×ubicacion}` | < 25 % |
| `tasa_arco_columnas` | % de planes cuyo multiset es exactamente `{arco@arco_central, columna@lateral_izq, columna@lateral_der}` | < 20 % |
| `cobertura_repertorio` | % de `TIPOS_ESTRUCTURA` que aparece ≥1 vez | ≥ 78 % |

**Criterio:** corre, es determinista (mismo output en dos corridas), publica
`reports/variedad-composicion-baseline.json`. **No fija umbrales de aprobación todavía**: primero
mide la línea base real.

### WP-0.2 · Medidor de afinidad gramatical (no de parecido)
**Nuevo:** `scripts/eval-afinidad-gramatical.ts`

Distinto de `scripts/lora-caption-affinity.ts` (mide parecido léxico global y ya se demostró
engañoso). Este mide **cobertura de la gramática obligatoria del corpus del LoRA activo**, por ejes
separados:

- ¿el caption cierra en `set against <pared> and <piso>`? (corpus 100 %)
- ¿cada sustantivo de estructura emitido tiene frecuencia ≥ 5 en el corpus?
- ¿cada frase espacial emitida tiene frecuencia ≥ 5?
- ¿está en la banda 27–77 palabras?
- lista de infractores con frecuencia 0

**Debe leer el corpus del LoRA registrado como activo**, no una ruta hardcodeada: al cambiar de
LoRA, la referencia cambia sola.

**Criterio:** corriendo hoy sobre el prompt de producción reporta **≥ 12 infractores** (los de
§2.2). Si reporta menos, el medidor está mal.

### WP-0.3 · Desfijar el eval del plan
**Archivo:** `scripts/eval-plan-decoracion.ts:44-47`

Sus 12 fixtures traen arco + 2 columnas hardcodeado. Sustituir por **≥ 4 composiciones distintas**.
No arregla nada; deja de esconder el problema.

**Criterio:** `npm run plan:eval` sigue en verde y ya no comparte composición entre los 12 casos.

---

## 6. Fase 1 — Alinear el prompting al entrenamiento (US$0 + US$0,20 opcional)

### WP-1.0 · Decidir a qué gramática se alinea el prompting ← **decisión, no tarea**

Es la bifurcación de §2.0 y hay que resolverla explícitamente antes de escribir código.

| Opción | Qué implica | A favor | En contra |
|---|---|---|---|
| **(A) Alinear a v004** (recomendada) | reescribir `lora-caption-v2.2` con el léxico medido de los 154 captions | el LoRA activo está aprobado 6/6 a escala 0,8; coste US$0; efecto inmediato | el corpus es pequeño y solo tiene tamaños relativos |
| (B) Alinear a v007 | portar el compilador determinista del worktree hermano a inferencia | una cláusula por estructura, pulgadas, nombres canónicos de producto | el LoRA v3 **está rechazado**: alinear a una gramática sin pesos aprobados es alinear a nada |
| (C) Ambas, por trigger | el compilador elige gramática según el LoRA resuelto | correcto a largo plazo | duplica superficie de test sin beneficio hoy |

**Recomendación: (A) ahora, con la arquitectura preparada para (C).** El selector de gramática debe
salir del LoRA resuelto (`mode-resolver`), no de una constante. Así, cuando exista un LoRA v3
aprobado, cambiar de gramática es configuración y no una reescritura.

### WP-1.1 · Reescribir el vocabulario del compilador contra el corpus v004
**Archivo:** `src/lib/ia/lora-caption-compiler.ts:44-55`

| Hoy | Propuesto | Justificación |
|---|---|---|
| `arco: "organic balloon arch"` | `"balloon garland arch"` | 0 → **30**/154 |
| `semiarco: "asymmetrical balloon half-arch"` | `"asymmetrical balloon garland"` | 0 → deriva de `balloon garland` 65 |
| `backdrop: "decorated backdrop"` | `"backdrop panel"` | 0 → **17**/154 (`backdrop` 49) |
| `centro_mesa: "balloon centerpiece"` | `"low balloon centerpiece"` | `low` 51 refuerza el ancla; **además unifica con v007** |
| `kit: "balloon decoration kit"` | `"balloon cluster arrangement"` | 0 → `balloon cluster` 9/154 y **129/300 en v005** |
| `accesorio: "decorative accessory"` | quitar del caption (sin señal visual) | 0/154 |
| `pared`, `columna`, `guirnalda`, `bouquet` | mantener | 9 · 11 · 20 · 5 ✅ |

Escala: `grand`/`compact`/`small-accent` → `tall`/`low` (67 y 51).
Acabado: quitar `fashion` de `FINISH_WORDS` para la gramática A (0/154 en v004; sí válido en v007).
Estilo: **eliminar `STYLE_WORDS` del caption LoRA** — 0/904 en todos los corpus. Sigue siendo útil
en el prompt de Gemini, que no tiene esa restricción.

### WP-1.2 · Reescribir las 9 frases de emplazamiento
**Archivo:** `src/lib/ia/lora-caption-compiler.ts:57-67`

Regla: cada frase nueva usa preposiciones con frecuencia ≥ 8 en el corpus y **conserva la propiedad
estructural que el prompt necesita** — que cada estructura tenga su **propia cláusula
independiente** (hallazgo confirmado: eso es lo que separa las columnas, no el léxico).

| Ubicación | Hoy (0/154) | Propuesto | Léxico corpus |
|---|---|---|---|
| `fondo_pared` | `installed against the rear wall` | `set against the wall behind` | `behind` 30 · `wall` 119 |
| `arco_central` | `centered around the stage photo area` | `centered as the main focal structure` | `centered` 11 |
| `sobre_mesa_principal` | `placed on the main table` | `positioned on a low table` | `positioned` 29 · `table` 45 · `low` 51 |
| `piso_frontal` | `grounded across the front of the stage` | `at the base, in front of` | `at the base` 11 · `in front of` 14 |
| `mesas_invitados` | `distributed across the guest tables` | `with matching arrangements on the tables` | `table` 45 |
| `entrada` | `framing the venue entrance` | `framing the doorway` | `framing` 23; el corpus dice `doorway`, **nunca `entrance`** |
| `techo` | `suspended overhead from the ceiling` | `suspended from the ceiling above` | `suspended` 7 · `ceiling` 16 · `above` 20 |

**El par lateral se trata aparte, como A/B, no como corrección.** Hoy emite
`matching one another, one standing on the left and one on the right` (0/154 en el corpus, pero
medido 6/6 en generación porque la lateralidad la aporta el modelo base). El candidato alternativo
es la forma del corpus: `flanked by a matching <noun> on either side` (`flanked by` 24 ·
`on either side` 11). **Se comparan los dos con el panel de 6 seeds y gana el que separe las
estructuras**, no el que puntúe más afinidad. Criterio explícito: la forma nueva solo se adopta si
da ≥ 5/6 en «dos columnas distinguibles de las patas del arco». Es el bug de las 4 columnas de
§3.1, y no se resuelve por deducción.

### WP-1.3 · Añadir el cierre obligatorio `set against`
**Archivo:** `src/lib/ia/lora-caption-compiler.ts:456-463`

Sustituir la cola actual —`wide photorealistic event photograph` (0) + `natural depth, believable
floor contact and supports` (0) + cues de venue tipo `event hall` (0)— por el cierre que está en
**154/154** (y en **336/336** del v007, así que es válido para ambas gramáticas):

```
… set against <superficie de pared> and <superficie de piso>.
```

Mapa de superficies derivado del corpus: `plain white wall`, `off-white walls`, `beige wall`,
`wood-paneled wall`, `tiled floor`, `light tiled floor`, `dark wooden floor`, `carpet`,
`plain white background`. Cuando el brief pide exterior, **el prompt debe registrar en el log que
está fuera de distribución** (`outdoor` 3/154) en vez de fingir que funciona.

### WP-1.4 · Desbloquear el preflight en el MISMO commit
**Archivo:** `src/lib/ia/lora-prompt-preflight.ts:59-65`

`requiredAnchorMissing()` exige `"main table"` (1/154) y `"rear wall"` (0/154). Sin este cambio,
WP-1.2 **bloquea todas las generaciones**. Actualizar anclajes + añadir un test que falle si el
preflight exige una frase con frecuencia < 5 en el corpus del LoRA activo.

### WP-1.5 · Resolver los conflictos internos del prompt de Gemini
**Archivos:** `src/lib/ia/tamano-fisico.ts:89` · `src/lib/plan/coherencia.ts:9` ·
`src/lib/ia/build-image-prompt.ts:140,168,317`

1. `bloqueMezclaPorEstructura` deja de emitir `EST_01_ARCO` literal y usa rótulo neutro
   (`Structure 1 — "Arco principal"`); `verificarCoherenciaPrompt` valida contra el nombre, no el
   ID. Elimina la contradicción con el `VISUAL TEXT BAN` y con el rechazo del preflight LoRA.
2. `:140` y `:317` dejan de enumerar `arch, column` como ejemplos. La instrucción pasa a ser
   funcional («una instalación alrededor de un centro focal, con anclaje visible al piso o a la
   pared») y el repertorio permitido llega por la gramática de celebración (Fase 2).
3. `:168` (`cardinalityContract`) generaliza a todos los tipos vía `TIPOS_ESTRUCTURA`.

### WP-1.6 · Unificar las tres tablas de sustantivos
**Archivos:** `src/lib/ia/lora-caption-compiler.ts` · `src/lib/lora/caption-contract-v2.ts`
(worktree hermano) · `scripts/build-structure-dataset-v001.ts:63`

Una sola fuente de verdad para el par `tipo → sustantivo`, importada por los tres consumidores, con
una variante por gramática (A/B) y un test que falle si alguna tabla se desvía. Hoy `centro_mesa`,
`kit` y `backdrop` tienen tres nombres distintos según quién los escriba (§2.0).

### WP-1.7 · Barrido de `guidance_scale` (US$0,20 · requiere autorización)
**Archivo:** `src/lib/ia/sempertex-lora.ts:148`

3.5 hardcodeado; el default de FLUX.2 es 2.5 y nunca se testeó. Barrer 2.0/2.5/3.0/3.5 con
`scripts/exp-step2-panel-seeds.ts` y el criterio de tres puntos. **Único gasto de la Fase 1.** Si
2.5 no mejora, se documenta y se deja en 3.5.

**Criterio de aceptación de la Fase 1:**
- `eval-afinidad-gramatical` reporta **0 infractores** de frecuencia 0.
- `plan:test`, `ia:test-lora-compiler`, `ia:test-plan-lora-e2e` en verde.
- Panel de 6 seeds a escala 0,8: criterio de tres puntos **≥ 5/6** — es un criterio de **no-daño**,
  no de mejora. Si la afinidad sube y la composición baja, **gana la composición**.

---

## 7. Fase 2 — Gramática de celebración (el corazón del brief) · US$0

Objetivo: que el modelo de construcción entienda, **por debajo y sin que nadie lo configure**, qué
tipo de celebración es y qué debe y qué no debe llevar.

### 7.1 Decisión de arquitectura

La gramática de celebración es **datos deterministas versionados**, no un prompt libre:

- El LoRA no puede aprenderla con el material actual (0/904 como descriptor de escena, §2.4).
- Un prompt libre no es auditable ni testeable; una tabla sí, y encaja con el
  `polaridad: "prohibido"` que ya existe en el schema (§2.6.5).
- Permite que **una** fuente de verdad alimente cinco consumidores: prompt del planificador,
  validación del plan, sesgo de retrieval, bloque del prompt de Gemini, y selección de tags del
  caption LoRA.

### WP-2.1 · Taxonomía canónica única
**Nuevo:** `src/lib/celebracion/taxonomia.ts`

Unifica las siete taxonomías de §2.5 en una, con la distinción que hoy falta
(**infantil/juvenil/adulto**) y alias es/en. Propuesta de 16 claves:

```
cumpleanos_infantil · cumpleanos_juvenil · cumpleanos_adulto · xv_anos ·
baby_shower · revelacion_genero · bautizo · primera_comunion ·
boda · aniversario · graduacion · corporativo ·
navidad · halloween · san_valentin · dia_madre
```

Más `generico` como perfil neutro de degradación. Las taxonomías existentes **no se borran**: se
mapean (`OCASIONES_CATALOGO_V2` para filtro de catálogo, `EventFamilySchema` para el motor V2,
`CATEGORIAS_ENTRENAMIENTO` para el dataset) con funciones de traducción y un test que garantice que
todo valor de cada taxonomía vieja tiene destino.

**Extender `CATEGORIAS_ENTRENAMIENTO`** (`src/lib/ordenes/tipos.ts:43`) con las claves que faltan
por completo: `boda`, `graduacion`, `corporativo`, `baby_shower`, `bautizo`, y desdoblar
`fiesta_infantil` de `cumpleanos_infantil`. Hoy 5 de sus 8 valores están **vacíos** y los que faltan
ni existen.

### WP-2.2 · La gramática por celebración
**Nuevo:** `src/lib/celebracion/gramatica.ts` + `gramatica.datos.ts`

Un registro por celebración, Zod, versionado `celebracion-gramatica-v1`:

```ts
type GramaticaCelebracion = {
  clave: ClaveCelebracion;
  audiencia: "infantil" | "juvenil" | "adulto" | "mixto";
  registro: "informal" | "semiformal" | "formal";

  // COMPOSICIÓN — qué debe ir
  estructuras_tipicas: Array<{ tipo: TipoEstructura; peso: number; rol: RolEscena }>;
  ubicaciones_tipicas: Array<{ ubicacion: Ubicacion; peso: number }>;
  estructuras_obligatorias: TipoEstructura[];   // casi siempre vacío: la ocasión sugiere, no impone
  props_esperados: string[];                    // "mesa de postres", "atril", "número gigante"

  // QUÉ NO DEBE IR — aquí se activa `polaridad: "prohibido"`
  estructuras_prohibidas: Array<{ tipo: TipoEstructura; motivo: string }>;
  motivos_prohibidos: string[];                 // "personajes infantiles", "calaveras"
  props_prohibidos: string[];

  // ESTILO (sugerencia, nunca filtro duro)
  paleta_tipica: string[];
  acabados_tipicos: string[];
  densidad_tipica: Densidad;

  fuente: "catalogo_ordenes" | "criterio_decoracion" | "supuesto";
};
```

Tres reglas que hacen esto seguro:

1. **`peso` sesga, no filtra.** Ninguna entrada de `estructuras_tipicas` bloquea nada; solo reordena
   candidatos y alimenta el prompt.
2. **`estructuras_prohibidas` sí bloquea**, y por eso empieza casi vacío y solo con casos que un
   decorador firmaría: personajes de dibujos en `boda`/`corporativo`; iconografía de Halloween en
   `bautizo`; globo de número «15» en `cumpleanos_infantil` cuando la edad declarada no es 15. **Cada
   prohibición lleva `motivo` textual y se audita.**
3. **`generico` no prohíbe nada** y sus pesos son uniformes. Un evento desconocido se comporta
   exactamente como hoy.

**Poblado con datos reales, no inventados.** La fuente primaria son las órdenes históricas
(`src/lib/ordenes/`, sidecars `feedback-N.json`, `scripts/procesar-ordenes.ts`): para cada orden con
celebración conocida, contar qué estructuras se montaron de verdad. **Advertencia medida:** hoy el
143/276 de las fotos está en `no_asignada` y 131 en `general` — es decir, **la fuente primaria
todavía no existe** hasta que se ejecute WP-4.2 (etiquetado). Consecuencia práctica: la primera
versión de la gramática nace mayormente con `fuente: "criterio_decoracion"` y `"supuesto"`, y **eso
tiene que quedar visible en un reporte**, no escondido. **No se aceptan pesos sin procedencia
declarada.**

### WP-2.3 · Detección pasiva de celebración
**Nuevo:** `src/lib/celebracion/detectar.ts`

Sustituye las 7 regex de `visual-context.ts:80-86` y las 8 claves de
`lora-caption-compiler.ts:69-77` por un detector único sobre el texto libre que ya existe. Devuelve:

```ts
{ clave: ClaveCelebracion | null; confianza: "alta" | "media" | "baja"; evidencia: string }
```

Requisitos:
- **Lee la edad** para desambiguar infantil/juvenil/adulto («cumpleaños de mi hija de 5», «los 40
  de mi esposo»). Es la señal que más cambia el resultado y hoy no se lee en ninguna parte.
- **Respeta la negación** (precedentes: `restricciones.ts:64`, `parse-event.ts:356`).
- `null` → perfil `generico`. **Nunca lanza error, nunca bloquea.**
- Con `confianza: "baja"` se aplican pesos pero **no** prohibiciones.

### WP-2.4 · Conectar la gramática a los cinco consumidores

| Consumidor | Archivo | Qué cambia |
|---|---|---|
| **Prompt del planificador** | `src/lib/ia/prompt-sistema.ts:117` | Sustituir «una focal, dos soportes o marcos laterales» por el repertorio ponderado de la celebración detectada, como bloque `REPERTORIO PARA ESTA CELEBRACIÓN` + `NO INCLUIR`. **Es el cambio que rompe el molde.** |
| **Validación del plan** | `src/lib/plan/restricciones.ts` | Nueva `validarGramaticaCelebracion(plan, gramatica)`: **error** solo por `estructuras_prohibidas`/`motivos_prohibidos`; **warning** (no error) por composición atípica. Aquí se activa `polaridad: "prohibido"`. |
| **Retrieval** | `src/lib/rag/retrieval/por-rol.ts:35` | `PISTA_POR_ROL.focal` deja de decir «arco, guirnalda o kit armado» y se deriva de `estructuras_tipicas`. Elimina B6. |
| **Prompt de imagen (Gemini)** | `src/lib/ia/build-image-prompt.ts` | Nuevo bloque tras `SCENE LOCK`: `CELEBRATION GRAMMAR` con audiencia, registro, props esperados y **lista explícita de qué no debe aparecer**. Es la vía por la que Gemini «entiende» la celebración. |
| **Caption LoRA** | `src/lib/ia/lora-caption-compiler.ts` | La celebración **no** entra como palabra suelta (0/904 de utilidad). Entra eligiendo entre los tags del vocabulario del corpus y sesgando acabado/paleta hacia `acabados_tipicos`. |

> **Nota de honestidad técnica que hay que respetar:** la decisión actual está escrita en
> `src/lib/scene/tipos.ts:96-99` — *«El evento queda como señal narrativa; nunca decide por sí solo
> geometría o número de estructuras»*. Esta fase **la revisa deliberadamente**, con justificación
> empírica: al excluir el evento, las cuatro variables que sí deciden son constantes en la práctica
> (§B7) → salida invariante. La revisión conserva el espíritu: la celebración **sesga** (pesos) y
> solo **prohíbe** donde un decorador prohibiría. La geometría sigue saliendo del espacio y del
> presupuesto. Este párrafo va al `decision-log.md`, no se decide en silencio.

### WP-2.5 · Quitar el hardcode de ocasión «boda»
**Archivo:** `src/lib/rag/retrieval/slot-query-planner.ts:80,164-170`

`SlotOccasionSignal.occasion` es el literal `"boda"` para todo slot de todo evento. Debe salir de la
celebración detectada.

### WP-2.6 · Renderizar `event_type` en el caption de entrenamiento — el hook más barato que existe
**Archivo:** `src/lib/lora/caption-contract-v2.ts:106,682-689` (worktree `codex/lora-vocabulario`)

El contrato v007 **ya acepta y rellena** `scene.event_type` desde la `categoria` de la orden, y el
ensamblado **nunca lo emite** (§2.4, nivel 2). Añadirlo al `cuerpo` es un cambio de una línea, y es
el **prerrequisito** para que algún día un LoRA aprenda ocasión.

Dos condiciones no negociables:
1. **Solo cuando `event_type` sea real** (no `no_asignada`) — o se enseña ruido. Hoy eso es el
   47–52 % de las fotos, así que el impacto inmediato es bajo: **primero WP-4.2**.
2. **Quitar `cumplea\w*` y `feliz` de la lista de prohibiciones** (`:62`) o añadir una excepción
   para el descriptor de escena, porque hoy el propio compilador rechazaría el caption. Sin este
   ajuste, WP-2.6 no compila conceptualmente.

**Criterio de aceptación de la Fase 2:**
- `colision_composicional` **< 25 %** y `tasa_arco_columnas` **< 20 %** contra la línea base.
- Un brief de `boda` nunca produce un plan con `motivos_prohibidos` de boda; uno de
  `cumpleanos_infantil` no produce iconografía de XV.
- Un brief con celebración **desconocida** produce un plan **idéntico** al actual (test de no-daño).
- Toda entrada de gramática tiene `fuente`, y las `"supuesto"` están listadas en un reporte de
  revisión pendiente.

---

## 8. Fase 3 — Ampliar el repertorio composicional (US$0)

Sin esto, la gramática de celebración solo puede recombinar seis piezas y el techo sigue bajo.

### WP-3.1 · Cinco figuras nuevas, end-to-end
**Archivos:** `src/lib/medidas/geometria.ts` · `src/lib/plan/tipos.ts` ·
`src/lib/plan/medidas-defecto.ts` · `src/lib/plan/resolver.ts:49` · `src/lib/ia/lora-semantics.ts` ·
`src/lib/ia/herramientas.ts:313` · `src/lib/ia/lora-caption-compiler.ts`

Prioridad por masa en el corpus (lo que el LoRA **ya sabe dibujar**):

| Figura nueva | v004 | v005 | v007 | Modelo geométrico | Sustantivo LoRA |
|---|---|---|---|---|---|
| `racimo` (cluster) | 9 (6 %) | **129 (43 %)** | — | nº de racimos × globos/racimo (discreto, no eje) | `balloon cluster` |
| `marquesina` (número/letras) | 18 (12 %) | 18 | prop | perímetro de dígito × densidad; unidades declaradas | `number marquee` |
| `panel` (backdrop panel) | 17 (11 %) | 22 | 49 (14,6 %) | área (como `pared`) + guirnalda de borde opcional | `backdrop panel` |
| `aro` (ring frame) | 7 (5 %) | 7 | (→`accesorio`) | circunferencia × cobertura parcial | `metal ring frame` |
| `cascada` | 3 (2 %) | 3 | — | eje vertical con densidad decreciente | `balloon cascade` |

Reglas no negociables:

1. **Toda figura nueva llega con modelo geométrico real**, no con `default: return 0`. `pared` ya
   mostró el problema (`geometria.ts:92` → eje 0, salvado por el modelo de área en `:207`).
2. **`centro_mesa` se corrige de paso.** Hoy `calcularEje` le da `max(ancho, alto, largo)` y lo
   trata como banda lineal (`geometria.ts:94`) — físicamente incorrecto para un volumen. Pasa a
   modelo de volumen/racimo.
3. **Toda figura nueva llega con medidas por defecto** (`medidas-defecto.ts`), o hereda el problema
   de §2.3: sin defaults, el planificador la evita porque tiene más riesgo de rechazo.
4. **`bouquet` se promueve** de `lora-semantics.ts` (donde existe) a `plan/tipos.ts` (donde no). Es
   el **42 %** del corpus v007 y hoy es describible pero no planificable.
5. **`aro` es `accesorio`, no `arco`.** Respetar la desambiguación crítica del v007 (§2.8): un aro
   metálico desnudo nunca se llama arco. Es el error que produce «portales rectangulares».
6. Cada figura nueva trae un caso en `plan:test-geometria` con un montaje real de referencia, o
   queda marcada `confianza: "preliminar"` como ya hace `geometria.ts:243`.

### WP-3.2 · Ubicaciones que rompen el eje central
**Archivos:** `src/lib/plan/tipos.ts:8` · `src/lib/plan/ubicaciones.ts`

Añadir al menos `perimetro`, `esquinas`, `techo_multipunto`, `recorrido`, cada una con bbox y
`depthLayer`. El enum actual **es** el molde: sin alternativas espaciales, el planificador no tiene
dónde poner variedad. Nota de respaldo: `corner` aparece en 6/154 captions y `ceiling` en 16 — el
LoRA ya vio esquinas y techo.

Ajustar `tipos.ts:168-176`: los límites «≤1 en `fondo_pared`» y «≤1 en `techo`» tienen sentido para
una estructura monolítica, no para multipunto.

### WP-3.3 · Cardinalidad y presupuesto: dejar de premiar el mínimo
**Archivos:** `src/lib/plan/restricciones.ts:211-231` · `src/lib/ia/prompt-sistema.ts:118` ·
`src/lib/rag/presupuesto/franjas.ts` · `src/lib/rag/presupuesto/ensamblar.ts:33`

- `franjas.ts`: el rol `focal` tiene `max: 1` en `focal` y `escena` con categorías
  `[guirnalda_arco, kit, globo_numero_letra]`. Revisar contra el coste real de las figuras nuevas:
  un racimo o un aro no cuesta lo que un arco, así que `max` puede subir sin romper el techo.
- `ORDEN_RECORTE` poda acentos primero. Añadir **diversidad mínima**: no recortar el último acento si
  eso deja la composición en `{focal + 2 laterales}` y existe alternativa igual de barata.
- `prompt-sistema.ts:118` («empieza por lo que cabe y crece solo si sobra techo») se **mantiene** —es
  honestidad comercial correcta— pero se le añade que **dentro del mismo techo hay más de una
  composición válida**, y que la elegida sale del repertorio de la celebración.

### WP-3.4 · Decidir el destino del motor de escena V2
**Archivos:** `src/lib/scene/*` · `src/lib/ia/feature-flags.ts:19`

17 funciones de escena, 3 recetas, un optimizador y un motor de invariantes **apagados**, con un bug
latente conocido (§B7). Tres opciones honestas:

| Opción | Coste | Riesgo |
|---|---|---|
| **(a) Arreglar el bug de zonas y encender en shadow para medir** | bajo | ninguno: shadow no llega al usuario |
| (b) Portar las 17 funciones como vocabulario del plan V1 | medio | duplica taxonomía |
| (c) Dejarlo apagado y documentarlo como deuda | cero | la brecha 17 vs 9 se queda |

**Recomendación: (a).** Es la única que produce datos para decidir, y `SCENE_PLAN_V2_SHADOW` ya
escribe a `registrarPlanAudit` con `status: "SCENE_V2_SHADOW"` sin tocar la respuesta al cliente.
Decidir (b) o (c) con dos semanas de shadow, no antes.

**Criterio de aceptación de la Fase 3:** `cobertura_repertorio` ≥ 78 % con las figuras nuevas;
`plan:test` completo en verde; cada figura nueva cotiza un despiece plausible revisado por el equipo
de decoración (o queda `preliminar`); `tasa_arco_columnas` en descenso respecto a Fase 2.

---

## 9. Fase 4 — Datos y entrenamiento

**Estado: el entrenamiento está bloqueado por presupuesto.** Saldo US$4,63; una corrida de 1000
pasos cuesta US$6,40. **WP-4.2 (etiquetado) sí es ejecutable hoy y cuesta US$0** — y es prerrequisito
de casi todo lo demás.

### WP-4.2 · Etiquetar la ocasión — la tarea más importante de esta fase (US$0) ← **hacer primero**

Hoy: `no_asignada` 143/276 (52 %), `general` 131 (47 %), `navidad` 1, y `xv_anos`,
`fiesta_infantil`, `amor_y_amistad`, `halloween`, `fiesta_generica` **vacías**. Sin esto:

- la gramática de celebración (WP-2.2) no tiene fuente empírica;
- WP-2.6 (renderizar `event_type`) no tiene qué renderizar;
- los acentos por tema de `PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md §4` son gasto a ciegas.

Trabajo concreto:
1. Extender `CATEGORIAS_ENTRENAMIENTO` con las claves que faltan (WP-2.1).
2. Etiquetar las 276 fotos de orden. La trazabilidad ya existe: el manifiesto de estructura guarda
   `sourceRef: "orden/<n>/feedback-N.json"`.
3. **Reportar la distribución real antes de decidir arquitectura.** Si una celebración tiene < 20
   imágenes, no da para un acento propio (`PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md §5` pide 20–30).
4. De paso, corregir el hueco de encuadre: **2/154** panorámicas en v004 y **3/114** en estructura,
   mientras la app genera 3:2. Recortar variantes panorámicas de las fotos existentes es gratis.

### WP-4.1 · Arreglar y entrenar el LoRA de estructura (US$6,40, cuando haya saldo)

El activo existe, está auditado y nunca se gastó: 114 imágenes, splits 81/22/11, trigger
`eventdecor_structure_v1`, `vocabularyPass: true`.

**Antes de entrenar hay que arreglar el mapeo de clases** (`build-structure-dataset-v001.ts:75-87`,
§2.8): `aro-metalico → arco` contradice la regla que el proyecto declara «el error más caro del
dataset»; `centro-de-mesa → bouquet` y `marquesina-letras → backdrop` colapsan tipos distintos.
Entrenar así reintroduce a mano el bug del portal rectangular.

Parámetros (del runbook v004, que sí funcionó): `steps=1000`, `learning_rate=0.00005`,
`default_caption` **vacío**, `output_lora_format=fal`.

**Criterio de aceptación escrito ANTES de entrenar** (misma disciplina que rechazó el v007):
- Panel de 6 seeds a escala **0,6 y 0,8** (no 0,3), criterio de tres puntos.
- ≥ **5/6** en composición **y** separación de estructuras medible: en un prompt de 4 estructuras,
  las 4 son identificables por separado en ≥ 4/6 seeds.
- Si solo es usable a escala baja → **checkpoint fallado**, no se promueve.

### WP-4.3 · Verificar el schema multi-LoRA antes de prometer acentos por tema (US$0,05)

`mode-resolver.ts:213` bloquea >1 LoRA con `FAL_MULTI_LORA_SUPPORTED=false`. El payload de fal ya
manda `loras` como **array**, lo que sugiere soporte, pero **no está verificado**. Una generación
con dos pesos apilados lo resuelve. Sin esta verificación, la arquitectura «base + acento por
celebración» **no es implementable**.

### WP-4.4 · Higiene de dataset antes de reutilizar el v007

1. **Excluir las 123 fotos marcadas `aptoParaEntrenamiento: false`** que entraron al v007
   (§2.8). Medir el efecto en la distribución antes de reentrenar.
2. **Hacer cumplir la banda de longitud**: declarada 55–85 palabras / tope 750 caracteres; medido
   p90 115 palabras y max 1212 caracteres. El compilador tiene el tope declarado y no lo aplica.
3. **Reponderar el extremo grande**: `24-inch` + `36-inch` = 12/336 (3,6 %) es la causa medida del
   fallo `diametro 0/6`. Sin más masa ahí, reentrenar el v007 falla igual.

### WP-4.5 · Anotar procedencia, siempre

El LoRA v2 llegó a producción sin registro de sus parámetros y obligó a arqueología en el dashboard
de fal. Toda corrida nueva escribe `reports/lora-debug/entrenamiento-<v>.json` con parámetros reales
y coste facturado, y se registra vía `scripts/backfill-lora-registry.ts`.

---

## 10. Fase 5 — Guardarraíles permanentes (US$0)

- **WP-5.1 · Test de no-colapso.** Falla si >20 % de los N briefs comparten multiset composicional o
  si `tasa_arco_columnas` supera su umbral. **Es el test que hoy no existe y que habría detectado
  el problema hace meses.**
- **WP-5.2 · Test de gramática vs corpus.** Falla si el compilador emite cualquier término con
  frecuencia 0 en el corpus del **LoRA registrado como activo**. Al cambiar de LoRA, la referencia
  cambia sola. Cierra la clase de bug de §2.2 —no un caso— para que no se reabra en el próximo
  recaption.
- **WP-5.3 · Test de no-daño para celebración desconocida.** Un brief con ocasión no reconocida
  produce exactamente el mismo plan que hoy. Protege el principio «pasivo».
- **WP-5.4 · Test de tablas unificadas.** Falla si las tres tablas de sustantivos (§2.0, WP-1.6)
  divergen.
- **WP-5.5 · `decision-log.md`.** Cada fase cerrada escribe su entrada con canal, acción, resultado,
  coste y los números medidos — la disciplina que el repo ya tiene.

---

## 11. Ejecución con subagentes Luna xhigh

### 11.1 Definir los subagentes

El modelo y el esfuerzo de razonamiento salen de la **definición** del agente, no de la llamada.
Crear en `.claude/agents/` un archivo por rol:

```markdown
---
name: composicion-builder
description: Implementa un work package del PLAN-COMPOSICION-Y-CELEBRACIONES-V001 en este repo.
model: luna
reasoning_effort: xhigh
tools: Read, Write, Edit, Grep, Glob, Bash
---

Contexto obligatorio ANTES de escribir código:
1. PLAN-COMPOSICION-Y-CELEBRACIONES-V001.md completo — Parte I incluida: los números importan.
2. HANDOFF-LORA-COMPOSICION.md — contiene hipótesis que parecen razonables y están REFUTADAS
   empíricamente. No repitas ninguna.
3. PLAN-CAPTIONS-DATASET-V007.md — la plantilla congelada del v007 y sus reglas de vocabulario.
4. AGENTS.md — este Next.js tiene breaking changes; consulta node_modules/next/dist/docs/ antes de
   escribir código de framework.
5. Si tu WP toca captions: el pipeline v007 vive en el worktree hermano
   C:\Users\davidt\Downloads\demo-decoracion-codex-lora-vocabulario (rama codex/lora-vocabulario),
   con ~308 rutas sin commitear. NO reimplementes lo que ya está ahí.

Reglas duras:
- Ningún término nuevo en un prompt de LoRA sin su frecuencia medida en el corpus del LoRA ACTIVO
  (data/staging/recaption-v004/nuevo/). Si es 0, no entra. Reporta la frecuencia en el diff.
- La lateralidad entrenamiento↔inferencia está desalineada A PROPÓSITO y medida. No la "corrijas":
  si tu WP la toca, es un A/B con panel de seeds, no una deducción.
- Nada de gasto en fal.ai sin autorización explícita por mensaje. El saldo es US$4,63.
- Cambios acotados a tu WP. Si encuentras algo fuera de alcance, repórtalo, no lo arregles.
- Al terminar: npx tsc --noEmit, lint dirigido, y los tests npm run que cubran tus archivos.
```

Tres roles, no uno:

| Agente | `reasoning_effort` | Para qué |
|---|---|---|
| `composicion-investigator` | xhigh | localizar y medir antes de tocar (Fase 0, poblado de WP-2.2, etiquetado WP-4.2) |
| `composicion-builder` | xhigh | implementar un WP acotado |
| `composicion-reviewer` | xhigh | revisar el diff contra las reglas duras y contra el corpus |

> Si el runtime no acepta `model: luna`, usar el modelo de mayor capacidad disponible manteniendo
> `reasoning_effort: xhigh`. El esfuerzo es lo que importa: casi todos los WP exigen razonar sobre
> acoplamientos no obvios entre cinco capas y dos worktrees.

### 11.2 Grafo de dependencias y paralelismo

```
Fase 0 ─┬─ WP-0.1 eval variedad        ─┐
        ├─ WP-0.2 afinidad gramatical  ─┤ los 3 en PARALELO, agentes distintos
        └─ WP-0.3 desfijar eval plan   ─┘
                     │  gate: los 3 en verde
                     ▼
        WP-1.0 DECISIÓN de gramática objetivo  ← humano, no agente
                     │
Fase 1 ─┬─ WP-1.1 vocabulario ─┐
        ├─ WP-1.2 placements   ─┤ MISMO agente, MISMO commit
        ├─ WP-1.3 cierre       ─┤ (separarlos deja el preflight bloqueando)
        └─ WP-1.4 preflight    ─┘
        ├─ WP-1.5 conflictos Gemini   ← agente separado, PARALELO
        ├─ WP-1.6 unificar tablas     ← toca el worktree hermano: agente propio
        └─ WP-1.7 guidance sweep      ← requiere autorización de gasto
                     │
                     ▼
Fase 4 ─ WP-4.2 ETIQUETAR OCASIÓN ← arranca YA, en paralelo a Fase 1. US$0 y bloquea Fase 2
                     │
                     ▼
Fase 2 ─┬─ WP-2.1 taxonomía ──► WP-2.2 gramática (investigator, se alimenta de WP-4.2)
        ├─ WP-2.3 detector ─────┤
        │                       ▼
        ├──────────────► WP-2.4 conectar 5 consumidores (secuencial, un agente)
        ├─ WP-2.5 quitar hardcode boda   ← paralelo, trivial
        └─ WP-2.6 renderizar event_type  ← worktree hermano; DESPUÉS de WP-4.2
                     │
                     ▼
Fase 3 ─┬─ WP-3.1 figuras nuevas   ← worktree AISLADO (toca geometría/cotización)
        ├─ WP-3.2 ubicaciones      ← PARALELO a 3.1
        ├─ WP-3.3 cardinalidad/presupuesto ← después de 3.1+3.2
        └─ WP-3.4 shadow V2        ← PARALELO, independiente
                     │
                     ▼
Fase 5 ─ WP-5.1..5.5 ← un agente al cierre de cada fase
Fase 4 ─ WP-4.1/4.3/4.4 ← bloqueadas por saldo
```

Reglas de orquestación:

1. **WP-1.1 a WP-1.4 en un solo agente y un solo commit.** Separarlos deja el preflight bloqueando
   generaciones (§2.6.2). Es la lección más caras de aprender dos veces.
2. **WP-4.2 arranca ya**, en paralelo a la Fase 1. Cuesta US$0 y es prerrequisito de la Fase 2. Es
   el cuello de botella real, no el presupuesto de fal.
3. **WP-3.1 en worktree aislado** (`isolation: "worktree"`): toca `geometria.ts`, el corazón de la
   cotización. Debe poder descartarse sin ensuciar el árbol.
4. **WP-1.6 y WP-2.6 tocan el worktree hermano.** Agente propio, y coordinar el merge de
   `codex/lora-vocabulario` a `main` **antes** o el trabajo se pierde.
5. **Un reviewer por fase, no por WP** — necesita ver el acoplamiento entre WPs de la misma fase.
6. **Los tres agentes de Fase 0 arrancan a la vez**, en un mismo mensaje: son independientes.
7. **Ningún agente decide gastar en fal.** WP-1.7, WP-4.1 y WP-4.3 requieren autorización explícita.

### 11.3 Contrato de entrega de cada agente

Cada agente termina con este reporte, o el WP no está cerrado:

```
WP: <id>
Archivos tocados: <lista con líneas>
Worktree: <main | codex/lora-vocabulario | worktree aislado>
Frecuencias medidas: <término → conteo en corpus>   (obligatorio si tocó un prompt de LoRA)
Tests corridos: <comandos npm + resultado literal>
tsc/lint: <resultado>
Métrica antes → después: <del eval de variedad o del de afinidad>
Fuera de alcance encontrado: <lista, sin arreglar>
Gasto en proveedores: US$0 (o el importe autorizado)
```

---

## 12. Criterios de aceptación globales

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | El prompt del LoRA no emite ningún término con frecuencia 0 en el corpus del LoRA activo | WP-0.2 · test WP-5.2 |
| 2 | El caption cierra en `set against …` como el 100 % del corpus | WP-0.2 |
| 3 | `tasa_arco_columnas` < 20 % sobre ≥24 briefs de ≥8 celebraciones | WP-0.1 |
| 4 | `colision_composicional` < 25 % entre celebraciones distintas | WP-0.1 |
| 5 | `cobertura_repertorio` ≥ 78 % de `TIPOS_ESTRUCTURA` | WP-0.1 |
| 6 | Ninguna celebración produce un elemento de su lista `prohibido` | test WP-2.4 |
| 7 | Celebración desconocida → plan idéntico al actual | test WP-5.3 |
| 8 | Composición no empeora: ≥5/6 en el panel de 6 seeds a escala 0,8 | `scripts/exp-step2-panel-seeds.ts` |
| 9 | Las tres tablas de sustantivos no divergen | test WP-5.4 |
| 10 | Toda entrada de gramática tiene `fuente`; las `supuesto` van a revisión | reporte WP-2.2 |
| 11 | Distribución de ocasión etiquetada publicada antes de cualquier decisión de entrenamiento | reporte WP-4.2 |
| 12 | `plan:test`, `ia:test-lora-compiler`, `plan:eval`, `tsc`, `lint`, `build` en verde | CI local |

---

## 13. Riesgos y qué no hacer

**Riesgos**

| Riesgo | Mitigación |
|---|---|
| Alinear el prompt al corpus **empeora** la composición (ya pasó: el prototipo v3 puntuó 90/100 de afinidad y produjo portales rectangulares en 3/3) | El criterio #8 es de **no-daño composicional**, no de afinidad. Si la afinidad sube y la composición baja, gana la composición. |
| Se «corrige» la lateralidad y se rompe lo que funcionaba | §2.0 y WP-1.2: es un A/B con panel de seeds y umbral explícito, no una deducción |
| La gramática de celebración se vuelve filtro duro y estrecha en vez de ampliar | `peso` sesga, `prohibido` bloquea y empieza casi vacío; `generico` no prohíbe nada; test de no-daño WP-5.3 |
| Prohibiciones inventadas por el modelo, no por el negocio | `fuente` obligatoria; las `"supuesto"` van a revisión humana antes de bloquear nada |
| La gramática se puebla con datos que no existen | Reconocido explícitamente en WP-2.2: hoy 52 % de las fotos es `no_asignada`. Por eso WP-4.2 va primero. |
| Figuras nuevas cotizan mal y llegan a un cliente | `confianza: "preliminar"` + el aviso que ya emite `geometria.ts:243`; revisión del equipo de decoración por figura |
| Se gasta el saldo restante en una corrida sin criterio | Fase 4 bloqueada; criterio escrito antes de entrenar. El v007 ya demostró que la disciplina funciona: se rechazó. |
| El trabajo del worktree hermano se pierde | Coordinar el merge de `codex/lora-vocabulario` antes de WP-1.6 y WP-2.6 |
| El detector de celebración se equivoca y aplica la gramática errónea | `confianza` explícita; con `baja` se aplican pesos pero **no** prohibiciones |

**Qué NO hacer**

- **No subir `lora_scale` para «recuperar estilo»** — empeora la estructura (medido).
- **No promover el compilador v3 de `scripts/proto-lora-caption-v3.ts`**: 90/100 de afinidad y peor
  composición. Su única aportación válida es la cláusula de centro de mesa.
- **No acortar el prompt** a 40–70 palabras: la mediana del corpus es 53 y el prompt ya está en
  banda; el verbosismo es lo que sostiene las cláusulas independientes por estructura.
- **No eliminar la independencia de cláusula por estructura.** Es el hallazgo confirmado: lo que
  separa las columnas no es el léxico, es que cada estructura tenga su propia cláusula. WP-1.2
  cambia el léxico **conservando** la independencia.
- **No entrenar el LoRA de estructura con el mapeo actual** (`aro-metalico → arco`): reintroduce a
  mano el bug del portal rectangular.
- **No reentrenar el v007 sin arreglar el extremo grande** (`24-inch`+`36-inch` = 3,6 %): el fallo
  `diametro 0/6` se repite.
- **No perseguir ControlNet en fal**: solo existe para FLUX.1 (incompatible) y el de FLUX.2
  open-weights tiene licencia no comercial.
- **No meter la celebración como palabra suelta en el caption del LoRA** esperando efecto: 0/904.
- **No entrenar acentos por celebración** antes de WP-4.2 (etiquetado) y WP-4.3 (verificación
  multi-LoRA). Sin esos dos, es gasto a ciegas.
- **No tocar `geometria.ts` sin worktree aislado.** Es el corazón de la cotización.
- **No activar `LORA_ALLOW_REJECTED_FOR_TESTING` en producción.** Es una vía de escape local para el
  v007 rechazado.

---

## 14. Apéndice — tablas crudas

### A · Estructuras en el entrenamiento
**v004 (n=154):** Guirnalda orgánica 35 (23 %) · Arco de guirnalda 30 (19 %) · Marquesina/letras 18
(12 %) · Panel de fondo 17 (11 %) · Columna 11 (7 %) · Muro de globos 9 (6 %) · Racimo 9 (6 %) ·
Aro metálico 7 (5 %) · Centro de mesa 6 (4 %) · Bouquet 5 (3 %) · Escultura 3 (2 %)

**v007 (n=336):** bouquet 142 (42,3 %) · guirnalda 116 (34,5 %) · columna 82 (24,4 %) · arco 74
(22,0 %) · backdrop 49 (14,6 %) · pared 42 (12,5 %) · accesorio 31 (9,2 %) · kit 26 (7,7 %) ·
semiarco 12 (3,6 %) · centro_mesa 11 (3,3 %)

### B · Relaciones espaciales (v004, n=154)
`set against` 154 (100 %) · Detrás de 30 (19 %) · Flanqueado por 24 (16 %) · Al lado de 24 (16 %) ·
Encima de 20 (13 %) · Delante de 14 (9 %) · **A ambos lados (bilateral) 11 (7 %)** ·
En esquina 6 (4 %)

**v007 (n=336):** `grounded across the front` 120 (36 %) · `installed against the rear wall` 118
(35 %) · `centred on the main display area` 73 (22 %) · `standing to one side` 64 (19 %) ·
`anchored to the …` 36 (11 %) · `placed on the main table` 31 (9 %) · `one at each end` 28 (8 %) ·
`suspended overhead/above` 13–16 (4 %) · `framing the entrance` 4 (1 %) ·
`distributed across the guest tables` 2 (1 %) · **`left`/`right` 0**

### C · Objetos del entorno (v004, n=154)
Pared 112 (73 %) · Piso 90 (58 %) · Mesa 45 (29 %) · Cartel/letrero 31 (20 %) · Torta 17 (11 %) ·
Techo 16 (10 %) · Cortina 11 (7 %) · Atril/soporte 5 (3 %) · Escenario 4 (3 %)

### D · Encuadre — la app genera 3:2
**v004 (n=154):** Vertical 3:4 60 (39 %) · Cuadrado 1:1 54 (35 %) · Vertical alto 20 (13 %) ·
Apaisado ~4:3 18 (12 %) · **Panorámico ≥3:2 2 (1 %)**
**structure-v001 (n=114):** 3:4 → 38 · 1:1 → 34 · 9:16 → 11 · 4:3 → 10 · **≥3:2 → 3**

### E · Tamaños
**v004/v005/structure:** solo `large` / `small`. **`N-inch` = 0.**
**v007 (n=336):** `5-inch` 173 (51 %) · `9-inch` 147 (44 %) · `12-inch` 117 (35 %) · `2-inch` 58
(17 %) · `18-inch` 36 (11 %) · `6-inch` 12 (4 %) · **`24-inch` 9 (3 %) · `36-inch` 3 (1 %)**
Cierres: `mixed organically rather than graded` 176 (52 %) · `all at a single N-inch size` 94
(28 %) · `all N-inch` 28 (8 %) · `graded from … down to …` **2 (1 %)**

### F · Vocabulario estructural en v005-300 (preparado, sin entrenar)
`cluster` **129 (43 %)** · `table` 67 · `pedestal` 36 · `column` 22 · `marquee` 18 · `ceiling` 16 ·
`sculpture` 15 · `balloon wall` 13 · `centerpiece` 12 · `ring frame` 7 · `cascade` 3

### G · Ocasión etiquetada — 276 fotos de orden
`no_asignada` 143 (52 %) · `general` 131 (47 %) · `navidad` 1 · `amor_y_amistad` 0 · `halloween` 0 ·
`xv_anos` 0 · `fiesta_infantil` 0 · `fiesta_generica` 0. `boda`, `graduacion`, `corporativo`,
`baby_shower`, `bautizo` **no existen en el enum**.

### H · Ocasión en los 904 captions
Como descriptor de escena: v004 **0** · v005 **4** (dentro del nombre del SKU) · v007 **1** (prop
rotulado) · structure-v001 **0**.
`quinceañera` · `wedding` · `graduation` · `corporate` · `anniversary` = **0 en los cuatro corpus**.
