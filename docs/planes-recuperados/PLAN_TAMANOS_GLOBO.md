# Plan de implementación — discriminación de tamaños de globo

> Estado: **propuesto** (2026-08-21). No implementado.
> Lectura del pedido: el sistema "siempre bota R-12" al cotizar, pero la imagen
> generada mezcla tamaños distintos. Son **dos fallas separadas** con una raíz
> común: el tamaño no existe como dato de primera clase en ningún punto del
> pipeline `retrieval → selección → cotización → imagen`.
> Todos los números de este documento se midieron contra `data/demo.sqlite`
> (3.727 variantes) el 2026-08-21.

---

## 1. Qué problema resuelve esto

### 1.1 R-12 no es una elección: es el prior estadístico del catálogo

| tamaño | variantes | % del catálogo |
|---|---|---|
| **R-12** | **1.080** | **29,0 %** |
| R-9 | 277 | 7,4 % |
| R-5 | 258 | 6,9 % |
| PAQUETE X 1 | 237 | 6,4 % |
| T260 | 187 | 5,0 % |
| R-24 | 104 | 2,8 % |
| R-18 | 92 | 2,5 % |

Restringido a látex con diámetro redondo estándar (5/9/12/18/24/36), **R-12 es
1.204 de 1.979 variantes = 60,8 %**. Cuando un modelo elige "una variante" sin
ninguna señal que discrimine tamaño, elige la moda de la distribución. No es un
bug de razonamiento: es la ausencia de una entrada.

### 1.2 El LLM elige tamaño a ciegas entre 9 opciones idénticas

`Globo Redondo Fashion Amarillo Miel` (producto real, medido) tiene **9
variantes disponibles**:

| tamaño | precio | u/paq |
|---|---|---|
| R-5 | 4.950 | 20 |
| R-5 | 12.350 | 50 |
| R-9 | 4.350 | 12 |
| R-9 | 6.500 | 20 |
| R-9 | 15.700 | 50 |
| R-12 | 7.150 | 12 |
| R-12 | 26.050 | 50 |
| R-18 | 12.900 | 6 |
| R-24 | 18.800 | 3 |

Lo único que el LLM recibe de cada una es `{ variantId, sku, titulo, precio,
disponible }` (`VarianteCandidata`, `src/lib/rag/chat/buscar.ts:8`). `titulo`
es el código crudo (`"R-12"`), sin diámetro, sin orden, sin criterio de
elección. El SQL que las trae (`buscar.ts:80-88`) **no tiene `ORDER BY`**.

### 1.3 El prompt de imagen le ORDENA mezclar tamaños

Aunque la cotización fuera 100 % R-12, la imagen mezclaría. El prompt lo pide
explícitamente, en tres lugares:

- `src/lib/ia/build-image-prompt.ts:81` — `"…hierarchy, grouping, scale variation, depth…"`
- `src/lib/ia/build-image-prompt.ts:127` — `"Vary scale, overlap, depth, and height."`
- `src/lib/ia/scene-spec.ts:316` — `"…balanced color, varied scale, natural asymmetry…"`

**El sistema hace exactamente lo que se le pide.** El síntoma B no es un fallo
del modelo de imagen: es una instrucción explícita que nadie acotó a los
diámetros cotizados.

---

## 2. Diagnóstico completo

### Falla A — selección (por qué siempre R-12)

| # | Hallazgo | Ubicación |
|---|---|---|
| A1 | `IntentQuerySchema.filtros_duros` no tiene `tamanos` ni `formas`. Solo categorías, ocasiones, colores, precio y disponibilidad. "Globos de 5 pulgadas" cae en `semantic_query` y no filtra nada. | `src/lib/rag/query-parser/schema.ts:16` |
| A2 | **Es una regresión.** El camino viejo SQLite sí tenía `tamanos` y `formas` como filtros de herramienta. Al migrar a `HERRAMIENTAS_RAG` se perdieron. | `src/lib/ia/herramientas.ts:87` vs `:227` |
| A3 | `construirSearchText` (fuente del embedding) no incluye tamaño ni forma. Además el embedding es **por producto** y el tamaño vive **por variante**: el índice semántico no puede discriminar tamaño ni en principio. | `src/lib/rag/catalog/sanitize.ts:39` |
| A4 | `FiltrosDuros` y `construirFiltroDuro` no contemplan ninguna condición sobre variantes por tamaño/forma. | `src/lib/rag/retrieval/types.ts:8`, `search.ts:32` |
| A5 | El despiece geométrico existe, es correcto, y **nadie lo consume en el modo RAG**. `calcular_medidas` produce la mezcla `organica_fina` (R-5 31,3 % / R-9 22,4 % / R-12 40,3 % / R-18 6 %). La herramienta que lo traduce a variantes reales (`cotizar` → `mejorVarianteParaTamano`) existe y está disponible, pero corre en paralelo: **la imagen se genera desde `confirmar_seleccion_rag`, no desde `cotizar`**. Dos verdades simultáneas. | `src/lib/medidas/geometria.ts:36`, `src/lib/ia/registro-herramientas.ts:34-36`, `:348` |

### Falla B — renderizado (por qué la imagen mezcla)

| # | Hallazgo | Ubicación |
|---|---|---|
| B1 | **El tamaño se descarta en el puente a la imagen.** `ResultadoCatalogo` trae `tamano`; `aProducto()` no lo copia. El tipo `Producto` no tiene campo de tamaño. Lo único que sobrevive es el sufijo del nombre: `"… — R-12"`. | `src/lib/shopify/consultas.ts:63` → `:371`, `src/lib/types.ts:9` |
| B2 | `R-12` es un SKU interno sin significado físico para un modelo de imagen. `identity_constraints` nunca declara diámetro; la única mención de tamaño es la palabra suelta `"size"` dentro de una frase sobre color y textura. | `src/lib/ia/scene-spec.ts:236` |
| B3 | Tres instrucciones activas de variar escala, sin acotar a los diámetros cotizados. | ver §1.3 |
| B4 | **`medidas` llega al endpoint y se tira.** El cliente lo envía (`page.tsx:1038`), el tipo está importado y declarado en el `Body`… y no hay ni una referencia en el cuerpo del handler. El comentario en `page.tsx:523` dice "se le pasan al prompt de imagen": la intención está escrita, la conexión no. | `src/app/api/generate/route.ts:15,39`, `src/app/page.tsx:523,1038` |
| B5 | **El QA de imagen es un no-op.** `buildQa()` llama a `evaluateSceneQa` pasándole `presentElementIds: <todos los element_id del spec>` — afirma por construcción que todo está presente, **sin mirar la imagen generada**. Los demás campos de observación caen a `true` por defecto ⇒ `retry_reasons` siempre vacío ⇒ `qa.pass` siempre `true` ⇒ **el reintento correctivo de la línea 587 nunca dispara**. El `confidence: "unknown"` es honesto, pero todo el lazo QA/retry es código muerto hoy. | `src/app/api/generate/route.ts:402-405`, `:587` |

---

## 3. Decisiones tomadas (2026-08-21)

| Decisión | Elección | Consecuencia |
|---|---|---|
| Comportamiento sin tamaño explícito | **Mezcla de diseñador** | El despiece geométrico manda. La imagen mezclada pasa de ser un bug a ser el comportamiento correcto — pero con las proporciones reales, no con las que invente el modelo. Exige F3 completa. |
| Fidelidad imagen ↔ cotización | **Contrato duro 1:1** | Solo los diámetros cotizados, en las proporciones cotizadas. Se eliminan/acotan las instrucciones de "vary scale" y se activa QA de tamaño con reintento. |
| Tamaño pedido inexistente | **Más cercano, declarándolo** | Se prioriza producto/color y se ajusta al diámetro disponible más cercano, dicho explícitamente. Nunca sustitución silenciosa. |
| Alcance de generación | **Solo `buildImagePrompt()`** (Gemini con referencias) | LoRA (`buildLoraImagePrompt`) y `sinReferencias` quedan **fuera de alcance**. Ver §7. |

---

## 4. Arquitectura objetivo

El arreglo estructural es una separación de responsabilidades que hoy no existe:

```
            HOY                                    OBJETIVO

  LLM elige producto + color + TAMAÑO      LLM      → producto + color   (semántico)
            ↓ (sin señal de tamaño)        RESOLVER → tamaño + cantidad + paquete
        R-12 por moda estadística                     (determinístico, desde geometría)
            ↓                                        ↓
  Prompt: "vary scale" (sin diámetros)     Prompt: SIZE MIX explícito en cm
            ↓                                        ↓
  Imagen mezcla arbitraria                 Imagen = los diámetros cotizados
```

**Principio:** mientras el tamaño sea una elección libre del LLM entre 9
variantes sin señal discriminante, va a seguir cayendo en R-12. El tamaño es
una decisión **física** (geometría de la figura), no **semántica** (qué producto
le gusta al cliente). Deben resolverlos capas distintas.

---

## 5. Fases

### F0 — Baseline medible *(prerrequisito, no opcional)*

Sin esto no se puede afirmar que ninguna fase posterior funcionó.

- `scripts/eval-tamanos.ts`: corre N briefs fijos (con y sin tamaño explícito) y
  registra: distribución de `tamano_codigo` seleccionado, tasa de acierto cuando
  el tamaño se pide explícito, y entropía de la distribución.
- Registrar el baseline actual en `reports/`.
- **Criterio de aceptación:** existe un número contra el cual comparar.

### F1 — Tamaño como dato de primera clase en Postgres

- Migración `006_tamanos_variante.sql`: agregar a `catalog_variants` las
  columnas `codigo_tamano TEXT`, `forma TEXT`, `diam_pulg NUMERIC`,
  `largo_pulg NUMERIC`, `ancho_cm NUMERIC`, `alto_cm NUMERIC` + índice sobre
  `(forma, diam_pulg)`.
- Poblarlas en `normalize.ts` con `decodificarTamano(v.option1)` — la función
  **ya existe, es determinística y está documentada** (`src/lib/shopify/derivar.ts:27`),
  con sus casos especiales ya resueltos (LOL-660, T260). No se escribe lógica nueva.
- **No re-embeber.** Meter tamaños en `search_text` agregaría ruido en vez de
  discriminación: todo producto de látex diría "R-5, R-9, R-12, R-18, R-24" y
  ningún vector separaría nada. El tamaño se resuelve con SQL sobre variantes,
  no con similitud coseno sobre productos. Se evitan además 1.672 re-embeddings.
- **Criterio de aceptación:** `SELECT COUNT(*) FROM catalog_variants WHERE diam_pulg IS NULL AND codigo_tamano ~ '^R-'` = 0.

### F2 — Filtro duro de tamaño y forma en el RAG *(repara la regresión A2)*

- `IntentQuerySchema.filtros_duros` += `tamanos: string[]`, `formas: string[]`
  (vocabularios ya controlados: `nombreForma()` y los códigos del catálogo).
- Ampliar el prompt del intérprete de consultas para que mapee lenguaje natural
  a códigos: *"globos pequeños"* → `R-5, R-9`; *"de 5 pulgadas"* → `R-5`;
  *"globos de corazón"* → `formas: [corazon]`.
- `FiltrosDuros` + `construirFiltroDuro`: condición `EXISTS` sobre
  `catalog_variants` por `forma` / `diam_pulg`, aplicada **en ambas ramas**
  (vectorial y full-text), igual que se hizo con el filtro de precio.
- **Recortar la whitelist `variantIds`** para que `buscar.ts` solo le muestre al
  LLM las variantes que cumplen el filtro. Es el mismo patrón ya usado para el
  presupuesto (`buscar.ts:95-105`) — sin esto, el filtro entra al ranking pero
  el LLM sigue viendo variantes que no cumplen.
- **Criterio de aceptación:** una consulta con `R-5` explícito devuelve 0
  variantes de otro diámetro. Medible en F0.

### F3 — Resolver determinístico de tamaño *(el núcleo)*

- Ordenar las variantes que ve el LLM y **exponer el diámetro en cm**, no solo
  el código: `titulo: "R-12"` → `{ codigo: "R-12", diamPulg: 12, diamCm: 30.5 }`.
  Barato y ya ayuda, pero **no basta por sí solo**.
- Nuevo `src/lib/rag/tamanos/resolver.ts` con
  `resolverVariantesPorDespiece(despiece, productosElegidos)`:
  - entrada: el `despiece` de `calcular_medidas` (líneas `{tamano, pulgadas, cantidad, color}`)
    + los productos/colores que eligió el LLM;
  - salida: variantes reales + paquetes cerrados, redondeando hacia arriba y
    dejando el sobrante explícito (misma regla que `cotizarLinea`, `motor.ts:95`);
  - **fallback por cercanía (decisión §3):** si el diámetro exacto no existe para
    ese producto/color, tomar el disponible más cercano por `|diam_pulg - objetivo|`
    y devolver un campo `sustitucion: { pedido, entregado, motivo }` que el chat
    **debe** verbalizar. `mejorVarianteParaTamano` (`consultas.ts:329`) hace hoy
    match exacto y devuelve `null`: se porta a Postgres y se le agrega la cercanía.
- Encadenar `calcular_medidas → resolver → confirmar_seleccion_rag`, de forma
  que la selección que dispara la imagen y la cotización tengan **una sola verdad**.
- **Criterio de aceptación:** en briefs sin tamaño explícito, la distribución de
  tamaños seleccionados se parece a la mezcla `organica_fina` (±10 pp por tamaño),
  no a un 100 % R-12.

### F4 — Propagar el tamaño hasta el prompt de imagen

1. **Dejar de descartarlo:** agregar `tamano`, `diamPulg`, `diamCm`, `forma` a
   `Producto` (`types.ts:9`) y copiarlos en `aProducto()` (`consultas.ts:371`).
   Es el arreglo de una línea que hoy tira el dato.
2. **Traducir el código a física anclada.** `R-12` no significa nada para un
   modelo de imagen; `"12-inch (30 cm) round latex balloon, about the size of a
   human head"` sí. Los modelos de imagen resuelven escala por anclaje a
   referentes conocidos, no por códigos internos. Tabla de anclajes por diámetro
   (5" ≈ puño, 9" ≈ melón, 12" ≈ cabeza humana, 18" ≈ torso, 24"/36" ≈ jumbo).
3. **Bloque `SIZE MIX` en el prompt**, alimentado por `medidas` (que ya llega y
   hoy se ignora — B4):
   ```
   BALLOON SIZE MIX — HARD CONSTRAINT
   This installation uses exactly these balloon diameters, in these proportions:
   - 31% 5-inch (13 cm) round latex
   - 22% 9-inch (23 cm) round latex
   - 40% 12-inch (30 cm) round latex
   -  6% 18-inch (46 cm) round latex
   Do not introduce any other diameter. Do not add jumbo or micro balloons.
   ```
4. **Acotar las tres instrucciones de "vary scale"** (§1.3). No eliminarlas del
   todo — la variación de escala es lo que hace creíble una guirnalda orgánica —
   sino condicionarlas: *"vary scale ONLY within the diameters listed in BALLOON
   SIZE MIX; never invent an intermediate, smaller, or larger balloon size."*
5. Agregar `physical_size` a `SceneElement` (`{ diameter_in, diameter_cm, shape }`)
   y meterlo en `identity_constraints` **entre los dos primeros** — `required_elements`
   solo toma `identity_constraints.slice(0, 2)` (`scene-spec.ts:320`), así que un
   constraint de tamaño en la posición 5 nunca llega a la sección MUST INCLUDE.
   Este detalle ya está documentado en el código y hay que respetarlo.
- **Criterio de aceptación:** el prompt generado (visible con `IMAGE_DEBUG=true`)
  contiene los diámetros en cm de cada línea cotizada.

### F5 — QA de tamaño con reintento *(exige revivir B5)*

El lazo de reintento **ya existe** (`route.ts:587`) pero nunca dispara porque
`buildQa` no observa la imagen. Contrato duro 1:1 sin verificación es una
instrucción, no una garantía.

- Reemplazar `buildQa()` por una observación real: pasar la imagen generada a un
  paso de visión que devuelva un `SceneQaObservation` de verdad, incluyendo un
  campo nuevo `sizeMixFailures: string[]`.
- Check de tamaño: *"list the distinct balloon diameters visible, estimated
  against the door/person/table in frame"* → comparar contra el `SIZE MIX`.
- Si hay diámetros fuera del set cotizado ⇒ `retry_reasons` ⇒ el reintento
  correctivo existente hace el resto.
- Marcar `confidence: "vision_assisted"` (el enum ya lo contempla).
- **Nota de honestidad:** esto convierte un no-op en una llamada real de visión
  por generación. Tiene costo y latencia. Si eso no es aceptable, la alternativa
  es dejar F5 fuera y aceptar que el contrato 1:1 es *best-effort*, lo cual hay
  que decirlo explícitamente y no presentarlo como garantizado.
- **Criterio de aceptación:** una imagen con globos jumbo no cotizados falla el QA.

### F6 — Evaluación

Ampliar `scripts/eval-tamanos.ts` de F0 con:
- **Acierto de tamaño explícito:** % de veces que "globos de 5 pulgadas" devuelve R-5.
- **Distribución vs. baseline:** entropía de tamaños seleccionados; debe subir.
- **Coherencia imagen ↔ cotización:** juez de visión sobre N imágenes, comparando
  diámetros visibles contra el `SIZE MIX` del prompt.
- **Tasa de sustitución declarada:** % de sustituciones por cercanía que el chat
  efectivamente verbalizó (decisión §3: nunca en silencio).

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| El filtro duro de tamaño devuelve cero resultados (ej. R-18 + color raro + presupuesto bajo) | Escalera de relajación, igual que la que ya existe para roles en `retrieval/por-rol.ts`. Relajar color antes que tamaño cuando el tamaño fue explícito. |
| La mezcla de diseñador multiplica las líneas de cotización (4 tamaños × N colores) | Tope de líneas + consolidación por variante. El sobrante de paquete ya se maneja en `motor.ts`. |
| El modelo de imagen ignora el `SIZE MIX` igual | Es justamente lo que mide F5/F6. Si tras F4 la coherencia no sube, el problema es de capacidad del modelo y hay que decirlo, no seguir agregando texto al prompt. |
| Los anclajes físicos ("del tamaño de una cabeza") introducen objetos no deseados en la escena | Ponerlos como comparación de escala, nunca como sustantivo de la escena; verificarlo en las primeras iteraciones. |
| F5 agrega costo y latencia por generación | Feature flag propio; medir antes de dejarlo por defecto. |

---

## 7. Qué NO cubre este plan

- **LoRA Sempertex** (`buildLoraImagePrompt`, `sempertex-lora.ts`): fuera de
  alcance por decisión explícita. Su prompt es mucho más corto y puede traer
  sesgo de tamaño propio del entrenamiento — habría que **medirlo aparte** antes
  de tocarlo. Consecuencia: tras este plan, Gemini-con-referencias y LoRA
  tendrán comportamientos de tamaño distintos.
- **Modo `sinReferencias`**: fuera de alcance. Es donde el anclaje físico más
  falta hace (no hay foto que corrija), así que es el primer candidato a ampliar.
- **Re-indexado de embeddings**: descartado a propósito (§F1), no olvidado.
- **Tamaños no-globo** (empaques `AxB CM`, `PAQUETE X N`): `decodificarTamano`
  ya los decodifica pero no fijan forma; quedan fuera del resolver geométrico.
- **Calibración del modelo geométrico**: `geometria.ts` sigue marcado
  `confianza: "preliminar"` con un solo dato oficial de densidad. Este plan hace
  que el despiece **se use**; no lo hace más exacto. Son problemas distintos.
