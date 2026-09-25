# ADR-0028 — Patrones de color por estructura (y la lógica que tocan, en Python)

Date: 2026-09-24
Status: accepted (en implementación en la rama `feat/patrones-color`)
Supersedes: la decisión 1 de ADR-0026 ("TypeScript compone, Python llama al
proveedor") **solo** para lo que esta decisión toca: la redacción del patrón
de color en el prompt de imagen, la detección del patrón en la foto y la
edición del plan. El resto de la composición de prompts sigue en TypeScript
hasta su propia migración (ver "Adaptadores temporales").

## Problema

El plan solo guarda *cuánto* de cada color lleva una estructura
(`materiales[].participacion`); no *dónde* va. Un decorador piensa y arma por
posición: una columna "blanco, negro, azul" en cuartetos que giran 1/8 forma
una espiral; un arco de flores alterna 3 cuartetos de fondo con 3 de pétalos y
un globo central; una pared LOL hace un degradé diagonal fila por fila. El
curso básico de Sempertex (1.er semestre 2026) enseña cada proyecto con una
**gráfica numerada** (cada globo lleva un número = color, con leyenda) y un
paso a paso por racimo.

Sin posición:

- la imagen generada reparte los colores "orgánicamente" aunque la foto o el
  decorador pidan una espiral (el prompt dice literalmente *avoid flat
  stripes*);
- el conteo por color no corresponde a lo que se arma (un ciclo por anillos
  de 3 colores en 10 cuartetos da 16/12/12, no 13/13/13);
- el decorador no tiene una hoja de armado.

Además, el usuario fijó una regla: **toda la lógica de IA vive en Python**; la
lógica TypeScript que esta función toque se migra.

## Decisiones

1. **`patron_color` opcional en cada estructura del plan** (`plan-decoracion.v1`,
   dueño Zod en `src/lib/plan/tipos.ts`). Es declarativo: modo + parámetros en
   índices de `materiales` (nunca nombres de color: el catálogo reetiqueta y
   dos materiales pueden compartir color). Ausente = comportamiento de hoy,
   byte a byte (mismo `plan_hash`). Presente = entra en `plan_hash`, porque
   cambia lo que se arma y se cobra.
2. **Python es el único dueño de la semántica** (`services/ai-api/app/patron_color.py`):
   validación cruzada, expansión a una rejilla filas × posiciones, conteo por
   material, presets, redacción para el prompt de imagen (ES/EN), paso a paso
   e instrucciones de armado. TypeScript no expande ni cuenta patrones.
3. **El patrón manda sobre el conteo por color.** Si una estructura tiene
   patrón, sus cuotas por material salen de la rejilla, no de `participacion`;
   `_complete_plan` reescribe `participacion` con las cuotas efectivas para que
   el plan eco sea veraz y resolver dos veces sea un punto fijo.
4. **Patrón inicial: foto → preset.** Al confirmar un plan (con la bandera
   `PATRONES_COLOR_V1` encendida), Next pide `completar_patrones: true` y manda
   las pistas detectadas en la foto (`pistas_patron`). Python asigna el patrón de la pista si cubre los colores;
   si no, el preset de la estructura. Re-resoluciones posteriores no completan.
5. **Derivado fuera del hash:** `plan_resuelto.patrones_color[]` (nivel
   superior, como `costes_por_estructura`) trae la rejilla, conteos, pasos,
   textos y prompts. Se omite cuando no hay ninguno.
6. **Edición en Python:** la mutación pura del plan (`aplicarEdicion` y sus
   funciones en `src/lib/plan/aplicar-edicion.ts`) se migra a
   `services/ai-api/app/plan_edicion.py` detrás de `POST /internal/v1/plan/edit`.
   Next conserva autenticación, token HMAC, admisión de variante, re-resolución,
   firma y auditoría. Nueva acción `patron`.
7. **Vista previa en Python:** `POST /internal/v1/plan/patron` expande un
   patrón (o sugiere uno) sin catálogo, para que el editor dibuje y cuente sin
   lógica en TypeScript.
8. **Detección en la foto en Python:** `POST /internal/v1/ia/patron-referencia`
   (Gemini visión; prompt y esquema en Python). El prompt de análisis de
   Amaterasu sigue congelado y no se toca.
9. **UI**: editor gráfico por estructura (presets con nombre del oficio +
   pintar racimo/globo en una gráfica numerada), hoja de armado imprimible y
   botón "Regenerar visual" (nunca regenera solo).

## Alternativas descartadas

- *Tabla de sinónimos de patrón en TypeScript y solo conteo en Python*: dos
  dueños del mismo concepto.
- *Aplicar un preset por defecto dentro de `_complete_plan` para todo plan*:
  cambiaría el `plan_hash` de todo plan en vuelo al desplegar (409 "El plan
  base cambió") y todos los vectores dorados. Por eso la completitud es una
  opción de la petición, no un default.
- *Migrar ya todo `buildImagePrompt` y el compilador LoRA (~4000 líneas)*:
  fuera del alcance acordado; queda como adaptador temporal.

## Consecuencias

- Planes con patrón cambian su conteo por color (y en mezcla de un solo
  tamaño, el total se redondea a racimos completos). Solo esos planes.
- Revertir a la revisión anterior rechaza planes que ya traen `patron_color`
  (`additionalProperties:false`): se pierden las propuestas abiertas (≤24 h).
  App y `ai-api` se despliegan juntos, como siempre.

## Adaptadores temporales (con condición de retiro)

- **Frase del patrón en prompts TypeScript.** `build-image-prompt.ts` y el
  compilador LoRA insertan tal cual `prompt_gemini` / `prompt_lora` que
  escribe Python; no redactan patrones. Se retira cuando el prompt de imagen
  completo migre a Python (`/internal/v1/ia/image-prompt`, slice propio).
- **Canonización de colores en TS** (`canonizarColoresPlan`) sigue antes de
  resolver; la edición en Python no canoniza. Se retira con la migración de la
  taxonomía de colores a Python.
- **Bandera `PATRONES_COLOR_V1`** (`featureEnabled`, apagada por defecto en el
  código). Next solo pide `completar_patrones`/`pistas_patron` al confirmar un
  plan si está encendida. Se enciende en el mismo despliegue que la edición en
  Python (§9) y la UI del editor, y se retira después de validarlo en
  producción. La detección en la foto tiene su propia bandera
  (`PATRON_REFERENCIA_PYTHON_ENABLED`); conviene encender las dos juntas.
- **Tablas ES→EN exportadas desde TypeScript** (`x-colores-en`, `x-acabados-en`).
  Son de solo lectura para Python hasta que la taxonomía de colores migre.

---

# Especificación

## 1. Contrato de entrada: `PatronColorV1`

En `EstructuraPlanSchema` (Plan 1.0) y `EstructuraPlan1_1Schema`:
`patron_color: PatronColorV1Schema.optional()`. **Nunca `.default()`** (Zod 4
metería el campo en `required` y en el plan hasheado).

```ts
const IndiceMaterial = z.number().int().min(0).max(11);
const IndiceRejilla = z.number().int().min(0).max(3999); // ver §2: una fila o una columna llegan a 4000 posiciones
const Racimo = z.array(IndiceMaterial).min(1).max(8);
const Peso = z.object({ material: IndiceMaterial, peso: z.number().int().min(1).max(100) }).strict();

const BasePatron = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("espiral"), racimo: Racimo, trazo: z.enum(["espiral", "zigzag", "recto"]) }).strict(),
  z.object({ modo: z.literal("anillos"), secuencia: z.array(IndiceMaterial).min(1).max(12), largo: z.number().int().min(1).max(24) }).strict(),
  z.object({ modo: z.literal("bloques"), bloques: z.array(Peso).min(2).max(12) }).strict(),
  z.object({ modo: z.literal("degradado"), paradas: z.array(IndiceMaterial).min(2).max(6), transicion: z.enum(["suave", "escalonada"]) }).strict(),
  z.object({ modo: z.literal("aleatorio"), pesos: z.array(Peso).min(1).max(6), semilla: z.number().int().min(0).max(2147483647) }).strict(),
  z.object({ modo: z.literal("flor"), fondo: IndiceMaterial, petalo: IndiceMaterial, centro: IndiceMaterial, separacion: z.number().int().min(1).max(6) }).strict(),
  z.object({ modo: z.literal("damero"), secuencia: z.array(IndiceMaterial).min(2).max(4), tamano: z.number().int().min(1).max(4) }).strict(),
]);

export const PatronColorV1Schema = z.object({
  version: z.literal("patron-color.v1"),
  origen: z.enum(["decorador", "referencia", "sugerido"]),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  base: BasePatron,
  acentos: z.array(z.object({
    material: IndiceMaterial,
    cada: z.number().int().min(2).max(24),
    desde: z.number().int().min(1).max(24),
    posiciones: z.array(IndiceRejilla).min(1).max(64).optional(),
  }).strict()).max(4).optional(),
  pintados: z.array(z.object({
    fila: IndiceRejilla,
    columna: IndiceRejilla.optional(),
    material: IndiceMaterial,
  }).strict()).max(512).optional(),
  simetria: z.literal("espejo").optional(),
  direccion: z.enum(["longitudinal", "transversal", "diagonal"]).optional(),
}).strict();
```

La forma (enums, rangos, objetos estrictos) la valida el JSON Schema en los
dos lenguajes. **Las reglas cruzadas solo las valida Python** (no hay
`superRefine` de patrón en Zod: sería un segundo dueño).

## 2. Geometría: la rejilla

Una instancia de estructura con patrón se modela como una rejilla de
`filas × columnas` celdas; cada celda es un globo y guarda un índice de
material. Orden de filas: fila 0 = **base** de la columna, **pie izquierdo**
del arco (sube, pasa por la clave y baja al pie derecho), **base** del
semiarco (hacia la punta), **extremo izquierdo** de la guirnalda, **arriba**
en la pared (columna 0 = izquierda), **abajo** en el centro de mesa.

`T` = globos por instancia de `_total_globos` (sin cambios).
`un_tamano` = la mezcla efectiva (`_effective_proportions`) tiene un solo
diámetro.

- **Racimos** (`tipo` ∈ columna, arco, semiarco, guirnalda, centro_mesa):
  `k = globos_por_racimo ?? (len(base.racimo) si modo espiral) ?? 4`;
  `filas = max(1, round_half_up(T / k))`; `columnas = k`.
- **Rejilla** (`tipo` = pared): `w = ancho_m`, `h = alto_m` (si falta uno,
  cuadrada); `columnas = max(2, round_half_up(sqrt(T * w / h)))`;
  `filas = max(1, round_half_up(T / columnas))`. `globos_por_racimo` se ignora.
- Tope: `filas * columnas <= 4000`; si no, `patron_invalido` (`motivo:
  rejilla_demasiado_grande`).
- Con ese tope una pared puede tener una sola fila y hasta 4000 columnas, y
  una pieza de racimos de 1 globo hasta 4000 filas: por eso `pintados[].fila`,
  `pintados[].columna` y `acentos[].posiciones` del contrato llegan a 3999.
  Todo globo que dibuja la gráfica se puede pintar (una pared de 10 m × 2,4 m
  sale de 18 × 76). El contrato llegó a topar la columna en 63 y la fila en
  999: el pincel de la columna 64 en adelante daba 400 en la vista previa, el
  autoguardado y el cambio de estilo.

## 3. Expansión (determinista, solo enteros y `sha256`)

`L` = longitud del eje del patrón: `filas` (longitudinal), `columnas`
(transversal, solo pared). `i` = índice a lo largo de ese eje.

**Simetría espejo** (solo `arco`): la base y los acentos se evalúan con
`r' = min(r, filas - 1 - r)` y `L' = ceil(filas / 2)` en lugar de `r`/`L`.
No aplica a `aleatorio` ni a `pintados`.

Modos:

- `espiral`: `celda(r, c) = racimo[c]`. Exige `len(racimo) == k`. El trazo no
  cambia el conteo; solo el dibujo (giro por fila: espiral `r * 1/(2k)` de
  vuelta; zigzag: onda triangular con tramos de 2 filas; recto: `(r mod 2) *
  1/(2k)`) y la redacción.
- `anillos`: longitudinal `S[(r // largo) % len(S)]` en toda la fila;
  transversal (pared) `S[(c // largo) % len(S)]` en toda la columna.
- `bloques`: tamaños `_hamilton(L, [L * p / sum(p)], tiebreak 0)` en orden de
  la lista; bloques contiguos a lo largo del eje; toda la fila (o columna) del
  color del bloque.
- `degradado`, con `m = len(paradas)`:
  - escalonada: `t = (i + 0.5) / L`; color `paradas[min(floor(t * m), m - 1)]`
    en toda la fila/columna.
  - suave, longitudinal/transversal: `x = (i + 0.5) / L * (m - 1)`;
    `j = min(floor(x), m - 2)`; `f = x - j`; `u = round_half_up(f * n)` donde
    `n` = celdas de la fila (o columna); la celda `c` de esa línea es
    `paradas[j + 1]` si `floor((c + 1) * u / n) > floor(c * u / n)`, si no
    `paradas[j]`.
  - `direccion: diagonal` (solo pared, suave o escalonada): por celda,
    `t = ((r + 0.5) / filas + (c + 0.5) / columnas) / 2`; escalonada como
    arriba; suave: `x = t * (m - 1)`, `j`, `f` como arriba y la celda es
    `paradas[j + 1]` si `f > ((3 * r + 5 * c) % 8 + 0.5) / 8`.
- `aleatorio`: `M = filas * columnas`; cuotas `_hamilton(M, [M * w / sum(w)],
  tiebreak 0)` por entrada de `pesos`; las celdas se ordenan por
  `sha256(f"{semilla}:{r}:{c}").hexdigest()` y se asignan en ese orden: las
  primeras `cuota[0]` al material de `pesos[0]`, etc. Nunca `random`.
- `flor`: periodo `P = separacion + 3`; `q = r % P`; `q < separacion` → fila de
  `fondo`; si no, fila de `petalo`; si `q == separacion + 1`, además un
  **globo extra** `centro` en esa fila (`extras`). La primera fila es fondo.
- `damero` (solo pared): `S[((r // tamano) + (c // tamano)) % len(S)]`.
  Con 2 colores es damero; con 3–4 da bandas diagonales ("arcoíris diagonal").

Capas sobre la base, en este orden:

1. `acentos`, cada uno en orden: en las filas `r` (o `r'` con espejo) con
   `(r + 1) >= desde` y `(r + 1 - desde) % cada == 0`, las posiciones
   `posiciones` (o todas) pasan a `material`. Posiciones fuera de rango se
   ignoran con aviso.
2. `pintados`, en orden: sin `columna` pinta toda la fila; con `columna`, una
   celda. Fuera de rango: se ignora con aviso (`"N pintados quedaron fuera de
   la estructura"`).

## 4. Reglas cruzadas (solo Python) → `patron_invalido`

Error de dominio `patron_invalido` (HTTP 422) con `motivo` estable y `mensaje`
en español para el decorador. Motivos:

| motivo | regla |
|---|---|
| `tipo_sin_patron` | la estructura no es geométrica (kit, backdrop, accesorio) |
| `un_solo_material` | la estructura tiene menos de 2 materiales |
| `material_fuera_de_rango` | un índice ≥ `len(materiales)` |
| `modo_no_permitido` | modo no admitido para el tipo (tabla abajo) |
| `racimo_incompleto` | `espiral` con `len(racimo) != k` |
| `direccion_no_permitida` | transversal/diagonal fuera de pared, o diagonal con modo distinto de degradado |
| `simetria_no_permitida` | `espejo` fuera de arco |
| `material_sin_uso` | tras expandir, un material de la estructura queda con 0 globos (el mensaje nombra el color), o con varios tamaños `T` no alcanza para un globo por color |
| `rejilla_demasiado_grande` | más de 4000 celdas |

Modos por tipo:

| tipo | modos |
|---|---|
| columna, arco, semiarco, guirnalda | espiral, anillos, bloques, degradado, aleatorio, flor |
| centro_mesa | espiral, anillos, bloques, aleatorio |
| pared | anillos, bloques, degradado, aleatorio, damero |

## 5. Conteo por material

- `c_m` = celdas + extras del material `m` por instancia; `M = filas * columnas + len(extras)`.
- **Un tamaño:** `T_final = M` y los totales por material son exactamente `c_m`
  (racimos completos: el total puede subir o bajar respecto a `T` en menos de
  `k/2` racimos, y sube con los extras de flor).
- **Varios tamaños:** `T_final = T`; totales por material
  `_hamilton(T, [T * c_m / M], tiebreak 0)`. Todo color de la gráfica es una
  compra: si un material con celdas queda en 0, toma 1 globo del material con
  más unidades (desempate por posición), como `plan._distribute_units`; en ese
  caso `participacion` y la siembra de la matriz usan `unidades / T`. Si
  `M ≠ T`, `patrones_color` lleva un aviso.
- La matriz tamaño × material se llena con los márgenes enteros ya dados
  (refactor de `_apportion_margins` en "márgenes" + "relleno"; el camino sin
  patrón no cambia ni un byte).
- `_complete_plan` reescribe `participacion` de cada material con
  `round(c_m / M, 6)`, el último absorbe el resto (siempre > 0 porque
  `material_sin_uso` lo impide).
- `repeticiones` multiplica como hoy (todas las instancias son iguales).

## 6. Presets (`sugerir_patron`)

Entrada: la estructura declarativa (tipo, mezcla, materiales con
`participacion`) y el plan (para la mezcla efectiva). Solo para tipos
geométricos con ≥2 materiales. `origen: "sugerido"`.

- Racimos con mezcla de un solo tamaño y 2–4 materiales → `espiral`, `trazo:
  "espiral"`, `k = 4`. Racimo: se reparten 4 posiciones con 1 por material y
  el resto por mayor resto de `participacion * 4 - 1`; se ordenan
  intercalando (el de más cuota primero, sin repetir el anterior cuando se
  pueda): {A:2,B:1,C:1} → [A,B,A,C]; {A:2,B:2} → [A,B,A,B];
  {A,B,C,D} → [A,B,C,D]; {A:3,B:1} → [A,B,A,A].
- Resto (mezclas orgánicas, 5–6 materiales, pared, centro de mesa) →
  `aleatorio` con `pesos = max(1, round_half_up(participacion * 100))` y
  `semilla = int(sha256(estructura_id).hexdigest()[:8], 16) % 2147483647`.

## 7. Pistas de la foto → patrón (`pistas_patron`)

`plan-resolution.v1` gana dos campos opcionales:

```ts
completar_patrones: z.boolean().optional(),
pistas_patron: z.array(z.object({
  referencia_element_id: z.string().trim().min(1).max(80),
  modo: z.enum(["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero"]),
  colores: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  pesos: z.array(z.number().int().min(1).max(100)).max(12).optional(),
  confianza: z.number().min(0).max(1),
}).strict()).max(16).optional(),
```

Con `completar_patrones`, para cada estructura geométrica con ≥2 materiales y
sin `patron_color`:

1. Si hay pista con su `referencia_element_id` y `confianza >= 0.5`: cada color
   de la pista se mapea a un material (igualdad normalizada con
   `materiales[].color`; si no, el material de tono más cercano con ΔE ≤ 25
   usando la tabla LAB del contrato; si no, la pista se descarta). Se arma el
   patrón del modo de la pista (`espiral`: el racimo es la lista de colores
   repetida/recortada a `k`; `anillos`: `secuencia`, `largo: 1`; `bloques`:
   pesos de la pista o iguales; `degradado`: paradas, suave; `aleatorio`:
   pesos por `participacion` de **todos** los materiales (nunca acentos); `flor`: [fondo, pétalo, centro]; `damero`:
   secuencia, tamaño 1). Materiales sin usar por la base armada entran como `acentos` (`cada:
   3 + j`, `desde: 2 + j`, `posiciones: [0]` en racimos), hasta 4. Si aun así
   queda alguno sin uso, o el patrón no es válido para el tipo → preset.
   `origen: "referencia"`.
2. Si no → preset.

## 8. Derivado: `patrones_color` en `plan-resuelto.v1`

Opcional, nivel superior, **fuera del snapshot** (no entra en `plan_hash`).
Una entrada por estructura que **tiene** `patron_color` (`aplicado: true`); se
omite entero cuando ninguna lo tiene. Las sugerencias (`aplicado: false`) solo
las produce la vista previa (§10): emitirlas al resolver cambiaría la salida
de todo plan sin patrón, empezando por los 28 vectores dorados.

```ts
PatronColorResueltoSchema = z.object({
  estructura_id: idSchema,
  aplicado: z.boolean(),
  patron: PatronColorV1Schema,
  geometria: z.enum(["racimos", "rejilla"]),
  filas: positiveInt, columnas: positiveInt, repeticiones: positiveInt,
  globos_por_instancia: positiveInt,
  celdas: z.array(z.array(nonNegativeInt)),          // filas × columnas
  extras: z.array(z.object({ fila: nonNegativeInt, material: nonNegativeInt }).strict()),
  conteo: z.array(z.object({
    material: nonNegativeInt, color: z.string().nullable(), acabado: z.string().nullable(),
    unidades_por_instancia: nonNegativeInt, unidades_total: nonNegativeInt,
  }).strict()),
  pasos: z.array(z.object({                           // filas idénticas consecutivas
    desde: positiveInt, hasta: positiveInt,            // 1-based, inclusivas
    celdas: z.array(nonNegativeInt), extras: z.array(nonNegativeInt),
  }).strict()),
  nombre: z.string(),            // "Espiral", "Zig-zag", "Franjas rectas", "Anillos", "Bloques", "Degradé", "Confeti", "Flores", "Damero", "Diagonal"
  descripcion: z.string(),       // una frase en español para el decorador
  instrucciones: z.array(z.string()),   // consejos de armado en español (curso Sempertex)
  prompt_gemini: z.string(),     // inglés, imperativo
  prompt_lora: z.string(),       // inglés, sin números ni negaciones
  avisos: z.array(z.string()),
}).strict();
```

`conteo.unidades_por_instancia` suma `T_final`; `unidades_total` multiplica por
`repeticiones`. Con `aplicado: false`, los conteos son los de la sugerencia, no
los del plan (la UI lo rotula "sugerido").

### Textos (Python)

Nombres de color en inglés desde el contrato (`x-colores-en`, exportado desde
la misma tabla con la que el compilador LoRA traduce colores,
`LORA_COLOR_NAMES_EN` — paleta de `taxonomy/v2.ts` más sus alias —; acabados
desde `x-acabados-en`). Un color que no esté en la tabla se nombra "catalog
color", nunca con la palabra en español. `prompt_lora` nombra solo el color,
sin acabado y sin repetir el mismo nombre seguido (el compilador ya dice los
acabados en su frase de materiales, con su propio vocabulario);
`x-acabados-en` solo se usa en `prompt_gemini`. La detección en la foto solo
responde con `x-paleta-colores` (la paleta de `taxonomy/v2.ts`). **`prompt_lora` es inglés ASCII**
("ombre", no "ombré"): TypeScript lo inserta tal cual y el control de idioma
del LoRA rechaza diacríticos y palabras en español. Orden de colores = orden del patrón. Máximo 4 colores
nombrados en una secuencia; más → "a repeating sequence of N colors".
Plantillas (A, B, C = colores; eje = "from base to top" en columna, "from the
left base over the top to the right base" en arco, "from the base to the open
tip" en semiarco, "along its length" en guirnalda, "from top to bottom" en
pared):

| modo | prompt_lora (fragmento) | prompt_gemini (frase) |
|---|---|---|
| espiral/espiral | `wrapped in a spiral of A, B and C stripes winding {eje}` | `COLOR PATTERN — build it from identical four-balloon clusters (A, B, A, C around each cluster) rotated one eighth of a turn per layer so the colors form continuous diagonal spiral stripes winding {eje}; keep the order unbroken and do not randomize.` |
| espiral/zigzag | `with zigzag chevron stripes of A and B running {eje}` | `COLOR PATTERN — identical clusters (…) turned left for two layers and right for the next two, so the stripes zigzag {eje}; keep the order unbroken.` |
| espiral/recto | `composed of straight vertical stripes of A and B balloons` | `COLOR PATTERN — identical clusters (…) stacked without rotation so each color runs as a straight vertical stripe {eje}.` |
| anillos | `built with stacked bands of A, B and C repeating {eje}` | `COLOR PATTERN — each cluster is a single color; clusters follow the order A → B → C, N cluster(s) per color, repeating {eje}.` |
| bloques | `color-blocked in sections of A, then B, then C {eje}` | `COLOR PATTERN — solid color blocks in this order {eje}: A (~p%), B (~p%), C (~p%); clean transitions between blocks.` |
| degradado | `in an ombre gradient from A through B to C {eje}` (escalonada: `in stepped ombre bands of …`) | `COLOR PATTERN — a gradual ombré {eje}: A, blending through B into C; soft mixed transition zones, no hard lines.` (escalonada: "stepped bands") |
| aleatorio | *(vacío: el caption orgánico de hoy)* | *(vacío: la frase orgánica de hoy)* |
| flor | `with daisy flowers of B petals and a C center set between A clusters` | `COLOR PATTERN — every S A clusters, three B clusters form a flower with one C balloon at its center; repeat {eje}.` |
| damero | `in a checkerboard of A and B` (3–4 colores: `with diagonal rainbow bands of A, B and C`) | `COLOR PATTERN — a checkerboard of A and B squares of T balloons` / `diagonal bands of A, B, C` |

Acentos añaden: `, with evenly spaced D accent clusters` (LoRA) y `Every
{cada}th cluster (starting at cluster {desde}) carries D.` (Gemini).
`pintados` añade a Gemini: `Some clusters were hand-painted by the decorator;
follow the per-cluster color map exactly.` y nada al LoRA.

En `bloques`, cada `p` es la parte de las líneas de la pieza entera que ocupa
el bloque. Con espejo cada bloque sale de los dos pies, salvo la línea de la
clave cuando el largo es impar, que es una sola: cuenta una vez (arco de 5
filas con bloques 2 + 1: 80 % y 20 %, no 67 % y 33 %). La instrucción de
armado nombra esa línea aparte ("desde cada pie hasta la clave: 2 cuartetos de
blanco (1); en la clave, 1 cuarteto de negro (2)"), para que armar desde los
dos pies no dé una línea de más.

**Los colores se nombran por lo que se compra.** Al resolver, Python nombra
cada material del patrón (`conteo[].color` y `acabado`, `descripcion`,
`instrucciones`, `prompt_gemini`, `prompt_lora`) por las líneas que de verdad
compra. Un reemplazo (`variant_overrides`, §9) cambia la compra sin tocar
`materiales`, y el patrón apunta a índices. Si todas las líneas de un material
vienen de un reemplazo y dicen un mismo color, el patrón usa ese color y el
acabado de esas líneas. Si solo se reemplazó una parte con otro color (un
tamaño de una mezcla de varios), o todas pero no con un mismo color, un
número de la gráfica serían dos colores:
el material conserva el nombre declarado y el patrón lleva un aviso ("Solo una
parte del color azul (3) se cambió por rojo: …"). Sin reemplazos los nombres
son los de `materiales`, byte a byte como antes. La vista previa (§10) no
tiene catálogo y nombra lo declarado. `conteo[].color` es el color que decide
Python para cada número de la leyenda.

## 9. Edición en Python: `POST /internal/v1/plan/edit`

Scope `plan.edit`. Contrato local (ADR-0026 §3): Pydantic junto al módulo +
Zod local en `python-adapter.ts`.

Petición `plan-edit.v1`:
`{schema_version, plan: PlanDecoracion, lineas_base: [{estructura_id, lineas:
[{product_id, variant_id, color|null}]}], edicion, colores_variante: string[],
completar_patrones?: boolean}`. Las líneas base salen de la re-resolución
verificada del plan, nunca del eco del navegador.
`edicion` es una de: `agregar|reemplazar|quitar` (forma de `EdicionSchema`),
`repartir`, `mezcla`, y la nueva `{accion:"patron", estructura_id,
patron_color: PatronColorV1 | null}`.

Respuesta `plan-edit-result.v1`: `{operation_schema_version, plan, avisos:
string[]}`.

Semántica = la de `aplicar-edicion.ts` hoy (portada una a una, con sus tests)
más:

- `patron`: valida (sección 4, con la geometría de la estructura) y fija o
  quita el campo; sincroniza `participacion`.
- `repartir` en estructura con patrón: si el modo es `aleatorio`, reescribe
  `pesos` con `max(1, round_half_up(p * 100))` y conserva `semilla`; si el
  confeti tenía `acentos` o `pintados`, se integran al confeti (se quitan, con
  aviso), porque con color fijo encima el reparto pedido no saldría. Con otro
  modo → `patron_activo` (409).
- `agregar` en estructura con patrón: el material nuevo entra al final; si el
  modo es `aleatorio`, el color nuevo toma su parte `p` de la base
  (`max(1, round_half_up(p * 100))`) y los pesos que ya estaban se escalan a
  `(1 - p) * 100` conservando su proporción (salen de los pesos, no de
  `participacion`, que ya cuenta acentos y pintados); si no, un acento
  (`cada: 2, desde: 2, posiciones: [0]` en racimos; `cada: 3, desde: 2` en
  pared), si hay cupo (4); si no hay cupo, o el acento deja un color sin
  globos → preset nuevo (aviso). Si la estructura pasa de 1 a 2 materiales sin
  patrón → preset, solo con `completar_patrones` (Next lo manda con la bandera
  `PATRONES_COLOR_V1`).
- `quitar` en estructura con patrón: se rehace el preset con los materiales
  que quedan (aviso "El patrón se rehízo porque quitaste un color"); si queda
  uno solo, el patrón se quita.
- `reemplazar` en estructura con patrón: como en toda pieza geométrica, el
  reemplazo va a `variant_overrides` y ni `materiales` ni el patrón cambian.
  La compra cambia exactamente en esa línea (la variante elegida, con su
  color). Reescribir el material haría que el resolutor volviera a elegir
  producto, tamaño y acabado por su cuenta: con varios tamaños, los que la
  propuesta no tenga del producto nuevo quedarían sin cobertura. Lo que el
  patrón nombra sale de lo que se compra (§8): el conteo, los textos y los
  prompts dicen el color nuevo. La edición no avisa nada; si el reemplazo
  parte un color en dos, el aviso va en el patrón resuelto.
- `colorDeEdicion` se porta sin canonizar (Next canoniza al resolver).

`/api/plan-editar` añade `avisos` a su respuesta solo cuando Python devuelve
alguno. Códigos de dominio → status (Next los traduce a sus mensajes de
siempre; `invalid_plan` se muestra como 400 "La edición del plan no tiene un
formato válido."):
`estructura_no_encontrada` 404, `variante_objetivo_no_encontrada` 404,
`reparto_no_corresponde` 409, `material_no_editable` 409, `unico_material`
400, `sin_participacion` 400, `patron_activo` 409, `patron_invalido` 422
(`motivo`, `mensaje`), `invalid_plan` 422.

## 10. Vista previa: `POST /internal/v1/plan/patron`

Scope `plan.patron`. Petición `plan-patron.v1`: `{schema_version, plan:
PlanDecoracion, estructura_id, patron_color: PatronColorV1 | null,
participaciones?: number[], modo?, desde?: PatronColorV1}` (null = sugerir).
`participaciones` (con `patron_color` nulo) es la vista previa del
deslizador de colores sobre un confeti mientras se arrastra: el mismo
`repartir` de la edición, sin guardar (`sin_patron` 409 si la pieza no tiene
patrón). `modo` (con `patron_color` nulo) pide el punto de partida de ese
estilo (`sugerir_patron_modo`); `desde` (solo con `modo`) es el borrador del
editor, y Python conserva de él lo que el estilo nuevo admite, en este
orden: `globos_por_racimo` (solo en racimos), la `direccion` si está entre
las `direcciones` del estilo, `simetria: "espejo"` si el estilo lo lleva y
cada acento cuyo material y posiciones siguen existiendo. Lo que el estilo no
ofrece (el espejo en un confeti, la diagonal en unos anillos) se deja sin
más; lo que ofrece pero dejaría el patrón inválido se quita y se avisa en
español al principio de `avisos` ("El estilo «flores» no se arma en racimos
de 8 en esta pieza: queda en cuartetos."). Los `pintados` no pasan: son de
la gráfica del estilo anterior. Respuesta `plan-patron-result.v1`:
`{operation_schema_version, patron: PatronColorResuelto, modos_admitidos:
[{modo, direcciones, espejo}]}`. Sin catálogo; usa las mismas funciones que
la resolución (misma rejilla y conteo que dará `resolve`). Errores:
`patron_invalido` 422, `invalid_plan` 422, `estructura_no_encontrada` 404. El
`patron_invalido` de la pieza pedida trae además `modos_admitidos` (vacío si
la pieza no admite patrón): sin sugerencia posible (una rejilla demasiado
chica) el editor sigue ofreciendo los estilos. La frontera (`_detail_metadata`)
los rearma desde valores conocidos: una lista de a lo sumo un estilo por
modo, cada uno exactamente `{modo, direcciones, espejo}`; cualquier otra cosa
quita el campo entero.

Next: `POST /api/plan-patron` (misma autenticación que `/api/plan-editar`;
no firma ni muta nada) → `{patron, modos_admitidos}`. Ante `patron_invalido`
(422), esta ruta y la acción `patron` de `/api/plan-editar` responden
`{error, causa: "PATRON_INVALIDO", motivo, mensaje, ui_error}`, y esta ruta
añade `modos_admitidos` cuando Python los manda (el adaptador los valida con
el esquema de `ModoAdmitido`); `ui_error.mensaje_usuario` es el `mensaje` de
Python si cabe en 280 caracteres. Otros fallos: `{error, ui_error}`.

**Latencia medida** (2026-09-24, plan del laboratorio de 4 piezas, Python y
Next locales, Neon en us-east-2 a 66 ms de ida y vuelta; medición de sesión,
no versionada): la vista previa tardaba ~265 ms de Next a Python y ~280 ms
por la ruta de Next. No era el adaptador de TypeScript (Zod del plan
0,08 ms, del patrón 0,02 ms, firma 0,05 ms) ni el cómputo de Python
(13–18 ms): contra un Python igual pero con el almacén en memoria la misma
llamada tarda ~18–23 ms. El resto es el nonce en Neon: su escritura y, al
devolver la conexión al pool, la consulta de reinicio de asyncpg
(`pg_advisory_unlock_all`, `CLOSE ALL`, `UNLISTEN *`, `RESET ALL`). El
almacén operativo no deja estado de sesión, así que su pool usa el gancho
`reset` de asyncpg sin esa consulta (asyncpg sigue revirtiendo una
transacción abierta; `tests/test_postgres_store.py` vigila que su SQL no
use `SET`, `LISTEN`, cursores ni candados); el nonce se escribe y se valida
igual (una repetición sigue siendo `401 nonce_replay`). La vista previa
valida el plan dos veces (recibido y completado) y lo completa una:
`modos_admitidos` sale de la misma estructura completada, no de otra
validación y otra completitud. Resultado: ~137 ms de Next a Python y ~155 ms
por la ruta; el cómputo de Python bajó de 13,5 a 8,8 ms en la sugerencia.
Lo que queda es sobre todo la escritura del nonce en Neon.

**Cálculo fuera del event loop** (2026-09-24). La vista previa, la edición y
la parte de CPU de la resolución (completar el plan, resolver las líneas y
validar los resultados) corren en un solo hilo aparte
(`app/plan_worker.py`). En el event loop quedan la frontera y las idas al
catálogo. Dentro de un `async def`, ese cálculo paraba todo `ai-api` (chat en
streaming, imagen, nonce) y `asyncio.wait_for` no lo podía cortar. Un solo
hilo acota la concurrencia: con el GIL, más hilos no calculan más rápido y le
quitan turnos al loop. Lo que espera va en la cola y, si su plazo vence antes
de empezar, se cancela sin gastar CPU.

- **Solo la pieza pedida.** La vista previa y la edición expanden solo esa
  pieza: su rejilla no depende de las otras. La resolución del plan editado
  sigue validando todas.
- **Validación más barata.** Validar el patrón resuelto contra el contrato era
  ~85 % del costo. Ahora recorre una sola vez cada valor distinto de una fila
  (`para_validar`). El veredicto es el mismo, porque el contrato no limita el
  largo de una fila.
- **Tope por petición.** El contrato ya acota el trabajo: ≤ 8 piezas y
  ≤ 4000 celdas cada una.

Medido en local (medición de sesión, no versionada) sobre paredes de
13 × 5 m con confeti, de 3762 celdas cada una:

| Operación | Antes | Después |
|---|---:|---:|
| Vista previa del deslizador, 1 pared | 77 ms | 33 ms |
| Vista previa del deslizador, 8 paredes | 198 ms | 61 ms |
| Edición `repartir`, 8 paredes | 73 ms | 29 ms |
| Resolución, 1 pared | 128 ms | 47 ms |
| Resolución, 8 paredes | 1190 ms | 275 ms |
| `/healthz` con 10 vistas previas concurrentes (en proceso) | 1186 ms | 74–103 ms |

Mientras se resuelven tres planes de ocho paredes, el loop se retrasa p50
26 ms y como máximo 42–57 ms. En reposo se retrasa 10,5 ms, que es la
resolución del temporizador de Windows.

En vivo (Next y Python locales, Neon; `/healthz` de Python muestreado desde
el mismo script que carga, como en la medición de antes):

- Un decorador que arrastra la barra sobre la pared de 13 × 5 m: antes p90
  134 ms y máximo 213 ms; ahora p90 36–52 ms y máximo 50–98 ms.
- Diez vistas previas pesadas a la vez: antes el máximo era 2262 ms; ahora
  es 332–741 ms. Con un muestreador en otro proceso, p90 7–15 ms, con un solo
  pico de 0,46–0,91 s por ráfaga, mientras el hilo del plan calcula
  ~1,3 s seguidos. La causa más probable es la espera del GIL, pero no está
  confirmada. Si hiciera falta bajar ese pico, el paso siguiente es un
  proceso aparte en vez de un hilo.

## 11. Detección en la foto: `POST /internal/v1/ia/patron-referencia`

Scope `ia.patron_referencia`. Petición `patron-referencia.v1`: `{schema_version,
imagen: {mime_type, data_base64}, elementos: [{element_id, tipo, bbox?,
colores_observados: string[]}] (1..12)}`. Python arma prompt y esquema de
salida estructurada (Gemini, mismo modelo y cliente que Amaterasu), y
devuelve `patron-referencia-result.v1`: `{operation_schema_version, pistas:
[{element_id, modo | "ninguno", colores, globos_por_racimo?, pesos?,
confianza}], modelo, prompt_version}`. Flag `PATRON_REFERENCIA_PYTHON_ENABLED`
(default OFF en código). Next la llama tras el análisis de referencia y guarda
cada pista en el elemento del blueprint (`appearance.patron_color`, opcional);
al confirmar el plan, las pistas de los elementos referenciados viajan como
`pistas_patron`. Un fallo de detección no rompe el análisis: se registra y el
plan cae al preset.

Cada detección es una llamada de visión con la foto entera, así que se paga
una vez por petición idéntica (misma foto, mismos elementos): Next guarda las
pistas en memoria (40 fotos, como la caché del análisis) y comparte la llamada
en vuelo; si todas las peticiones que la esperan se cancelan, se cancela. Un
análisis que sale de la caché o una foto de la galería, que no llaman a ningún
proveedor, reutilizan la detección ya pagada; "Reintentar" (`sin_cache`) pide
una nueva, que reemplaza a la guardada; un fallo no se guarda. La caché vive en
el proceso de Next: un despliegue (app y `ai-api` juntos) la vacía.

## 12. Prompt de imagen (adaptador temporal)

- Gemini (`colorVarietyContract`): si la estructura tiene entrada en
  `patrones_color` con `aplicado` y `prompt_gemini` no vacío, esa frase
  reemplaza la oración "Distribute them through intentional organic clusters…
  avoid flat stripes…". El prefijo `APPROVED COLOR VARIETY — use exactly these
  catalog colors: X.` se conserva (lo parsea `coherencia.ts`). Si la línea es
  `MONOCHROME LOCK` (dos acabados del mismo color con patrón, p. ej. dorado
  cromado + dorado mate), el candado se conserva y la frase va detrás. El
  elemento de la escena lleva `color_pattern` con la misma frase.
- LoRA: `prompt_lora` se agrega a la cláusula de la estructura justo después de
  la frase de materiales; forma parte de su clave de agrupación, nunca se
  compacta ni se descarta; la cláusula no se reduce con `conciseClause`; con
  patrón no se añade "mixed organically rather than graded". Cada sujeto del
  JSON gana `color_pattern` con el mismo texto de `prompt_lora`.
- Híbrido (etapa 2): el hard lock añade "Keep each structure's color pattern
  exactly as in the first image."

## 13. UI

- `DetalleEstructura`: bloque "Patrón de color" con vista compacta, nombre,
  descripción, conteo por color y botones **Editar patrón** y **Hoja de
  armado**. El dibujo llena su marco conservando la proporción: el marco toma
  la forma del dibujo (angosto y alto para una columna, ancho para un arco o
  una guirnalda) y los contornos miden un píxel a cualquier escala.
  `RepartoColores` solo aparece si no hay patrón o el patrón es `aleatorio`
  (con acentos o pintados también: Python los integra al confeti y lo avisa).
  En un confeti va dentro del bloque, justo bajo el nombre del patrón: al lado
  del dibujo en pantallas anchas y debajo de él en un teléfono, para que la
  pieza entera y la barra se vean a la vez mientras se arrastra.
- **Vista previa en vivo del deslizador de colores** (`vista-reparto.ts`,
  `usarVistaReparto.ts`): sobre un confeti, mientras el decorador arrastra o
  mueve la barra con las flechas, la tarjeta pide `/api/plan-patron` con
  `{patron_color: null, participaciones}` y dibuja lo que devuelve Python en el
  bloque del patrón, la tira del resumen y las cifras bajo la barra ("N
  globos", las de Python; sin patrón, la estimación "≈ N"). Una petición a la
  vez por pieza, al menos 100 ms entre dos, gana el último reparto y las
  respuestas viejas no cuentan. Al soltar se guarda como siempre (`repartir`);
  el dibujo en vivo se queda mientras ese reparto va camino del plan (se
  arrastra, espera su pausa o se guarda) y, cuando llega el plan firmado,
  manda `patrones_color`. Un reparto que no se pudo guardar deja de
  dibujarse (`repartoADibujar`): el bloque y la tira vuelven al plan, que es
  lo que se aprueba y lo que abren "Editar patrón" y la hoja de armado; la
  barra conserva su valor con la estimación "≈ N", el motivo y "Reintentar".
  Un fallo de la vista previa (`sin_patron`, `patron_activo`, red) la apaga
  sin mensaje hasta que la barra vuelva al plan: queda la barra con su
  estimación. Los avisos nuevos de Python para ese reparto se ven, pequeños y
  tal cual, bajo la barra; los que el patrón del plan ya traía se quedan en el
  bloque. El dibujo en vivo no es estado de la tarjeta (`vistas-en-vivo.ts`):
  cada respuesta vuelve a pintar solo el bloque y la tira de esa pieza. Con
  él en la tarjeta, cada respuesta repintaba las cuatro piezas del
  laboratorio (444 globos) y, en un teléfono con la CPU a 4×, dejaba tareas
  de 1 a 1,9 s; ahora son 48 globos y los cuadros quedan en p95 ≈ 270 ms
  (antes 1,3 s). Por lo mismo los globos entran con una animación CSS que
  termina (no un componente animado por globo) y su sombra usa
  `fill-opacity`.
- `EditorPatron` (Radix Dialog; hoja inferior en móvil): vista grande
  (alternar **Vista** pseudo-3D / **Gráfica** numerada), leyenda numerada de
  colores (1 = primer material…), presets con miniatura, parámetros del modo,
  "Acento cada N", pincel (racimo completo o un globo), deshacer local,
  conteo por color en vivo (vista previa Python, con debounce). Los estilos
  son exactamente los `modos_admitidos` que devuelve la vista previa, en el
  orden de Python; la dirección se ofrece con las `direcciones` del modo del
  borrador (si hay más de una) y el espejo cuando su `espejo` es verdadero. Al
  abrir con el patrón del plan se pide igual una vista previa, sin tapar el
  dibujo, solo para conocer esos estilos. Elegir un estilo distinto del modo
  del borrador pide `{patron_color: null, modo, desde: borrador}` y el
  `patron` que devuelve Python pasa a ser el borrador (se dibuja sin otra
  petición); tocar el estilo actual no cambia nada. Python conserva del
  borrador lo que el estilo nuevo admite (globos por racimo, dirección,
  espejo, acentos; §10) y avisa de lo que tuvo que quitar; TypeScript no lo
  mezcla y "Deshacer" sigue volviendo al estilo anterior. Ese aviso (lo que la
  respuesta trae de nuevo respecto del dibujo anterior) va justo bajo los
  estilos, en una región viva (`role="status"`) siempre montada, mientras el
  borrador siga en ese estilo; no se repite en el conteo. En un teléfono el
  conteo queda bajo todos los ajustes y un aviso solo ahí pasaba inadvertido
  mientras el patrón reducido se guardaba solo. Si Python no puede
  sugerir un patrón, su rechazo (`patron_invalido`) trae igual
  `modos_admitidos` y el editor los ofrece. TypeScript solo
  guarda nombres, frases e iconos de cada modo; la única puerta propia es
  mostrar "Crear patrón" en piezas geométricas con dos colores o más
  (`TIPOS_ESTRUCTURA_GEOMETRICOS`). **Sin botón
  "Aplicar"**: cada cambio válido se guarda solo en la propuesta (acción
  `patron`) cuando el decorador se detiene, en cola serializada; el pie
  muestra "Guardando…" / "Cambios guardados" / el motivo y "Reintentar".
  "Restablecer" vuelve al patrón que había al abrir, "Listo" cierra. Un
  patrón que Python rechaza nunca se guarda. "Crear patrón" abre con la
  sugerencia de Python como vista: no entra en la propuesta hasta que el
  decorador la retoca, elige un estilo o pulsa **Usar sugerencia**; cerrar sin
  tocarla no guarda nada. Los deslizadores de colores y tamaños de la tarjeta
  también guardan solos.
- Avisos de la edición: los `avisos` de `/api/plan-editar` ("El patrón se
  rehízo porque quitaste un color.") se muestran tal cual en el aviso de la
  tarjeta tras cada edición y, para el editor, juntos en el aviso de la sesión
  al cerrarlo.
- `HojaArmado`: leyenda, gráfica numerada, paso a paso por racimos (de
  `pasos`), instrucciones, conteo por color y tamaño; **Imprimir** (CSS
  `@media print`). En pantalla solo la gráfica se desplaza de lado (con el
  teclado también); en el papel va a todo el ancho y, si una fila pasa de 24
  globos (lo que cabe con su número en A4 o carta), por tramos parejos de
  izquierda a derecha: ningún globo queda recortado. Los colores de cada paso
  se dicen en texto para el lector de pantalla (`sr-only`), no en un
  `aria-label` sobre un `<span>` genérico.
- "Editar patrón" y "Crear patrón" no se deshabilitan mientras se guarda un
  cambio (`aria-disabled`, el toque no hace nada): al cerrar el editor con un
  cambio pendiente el foco vuelve a ellos, y un botón `disabled` no lo recibe.
- Tras editar un plan ya aprobado: botón **Regenerar visual** (re-aprobar y
  generar). Nunca regenera solo.
- Tokens del tema, accesible por teclado, `prefers-reduced-motion`, sin
  lógica de patrón en TypeScript (dibuja lo que devuelve Python).
