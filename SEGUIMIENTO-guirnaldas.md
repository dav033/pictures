# Seguimiento: guirnaldas por partes, conteo desde la foto y armado en fal.ai

Plan de trabajo escrito el 2026-09-25, al cierre de la segunda entrega de bouquets
(`SEGUIMIENTO-bouquets.md`, PR [dav033/pictures#2](https://github.com/dav033/pictures/pull/2)).
Es un documento de traspaso: quien lo retome debe leer `AGENTS.md`, ADR-0028
(patrones), ADR-0029 (v16) y ADR-0030 (bouquets) antes de tocar código. Todo lo
que dice "hoy" está verificado en el código de la rama `feat/bouquets` con la
referencia `archivo:línea`.

## 0. Qué se pidió

1. **Guirnaldas por partes**: llevar a las guirnaldas lo que ADR-0028 y ADR-0030
   hicieron para arcos, columnas y bouquets, con investigación completa (código y
   fuentes del oficio) e implementación completa (Python, contrato, Next, UI,
   prompts, evaluación).
2. **La foto manda sobre la cantidad en todas las estructuras**: hoy solo el bouquet
   toma su cantidad de la lectura de la foto (ADR-0030, decisión 4 enmendada). Se
   extiende a arcos, semiarcos, columnas, guirnaldas, paredes, centros de mesa y
   techos. En piezas de pocos globos la cuenta es exacta; en piezas densas basta
   una aproximación.
3. **Armado del bouquet ↔ generación en fal.ai (Kagutsuchi/LoRA)**: un agente
   autónomo que no pare a preguntar hasta terminar, que sea proactivo con
   funciones y que, si algo lo bloquea, siga con lo demás.

Los tres frentes se ejecutan en este orden: 3 (corto, independiente), 2 (base
que la guirnalda necesita), 1 (la entrega grande).

## 1. Investigación hecha (hechos verificados)

### 1.1 Cómo cuenta hoy una guirnalda (`services/ai-api/app/plan.py`)

- Tipos geométricos: `_GEOMETRIC_TYPES` incluye `guirnalda` (l.107). Densidad
  `_DENSITY_LAMBDA = {sencilla 2.8, media 3.6, lujosa 4.5}` (l.108). Mezclas desde
  el contrato `x-reglas-mezclas` (l.113–122; dueño `src/lib/plan/mezclas.ts:43–62`):
  `clasica` 12" 100 %; `organica_fina` 5" .21 / 9" .18 / 12" .54 / 18" .05 / 24" .02;
  `organica_gruesa` 9" .25 / 12" .45 / 18" .2 / 24" .1; `solo_grandes` 18" .6 / 24" .4.
  No hay mezcla propia de guirnalda ni R-36 en ninguna.
- Medida por defecto: `largo_m` 2,5 (interior) o 3,5 (exterior) (l.147). El eje de
  una guirnalda es `largo_m`, y si falta, `ancho_m` (`_eje`, l.1005–1032). `alto_m`
  se ignora: no hay modelo de caída, vaivén ni grosor.
- Total de globos: el mismo modelo de banda lineal de arcos y columnas
  (`_total_globos`, l.1040–1070): `área = eje × anchoBanda(mezcla) × Ø dominante`,
  `total = ceil(λ(densidad) × área / área ponderada por globo)`. Globos por metro
  que da la fórmula (cálculo propio con esas constantes):

  | mezcla | sencilla | media | lujosa |
  |---|---|---|---|
  | clasica | 16,5 | 21,2 | 26,6 |
  | organica_fina | 14,9 | 19,2 | 23,9 |
  | organica_gruesa | 11,5 | 14,8 | 18,4 |
  | solo_grandes | 8,4 | 10,8 | 13,5 |

  Una guirnalda por defecto (2,5 m, media, organica_fina) son 48 globos. El vector
  dorado 22 fija 47 para 2,5 m lujosa organica_gruesa.
- Reparto por tamaño y color: `_hamilton` (l.1081) y la matriz tamaño × material
  (l.1116–1206); con patrón, `_pattern_matrix` (l.1439). `repeticiones` multiplica.
- Puerta física (`_physical_warnings`, l.1359–1421): `guirnalda` es lineal; bandas
  de globos por metro mín. {8, 14, 20} × 0,6 y máx. {48, 68, 88} × 1,3.
- Merma: 8 % al comprar, nunca dentro de la estructura (l.99, 1571, 2416).

### 1.2 Patrones de color (`services/ai-api/app/patron_color.py`, ADR-0028)

- La guirnalda admite espiral, anillos, bloques, degradado, aleatorio y flor
  (l.50); no damero. Rejilla de racimos `k = globos_por_racimo ?? 4`,
  `filas = round(T/k)` (l.380–388); fila 0 = extremo izquierdo. Solo dirección
  longitudinal y sin espejo (l.391–439).
- Preset: espiral de cuartetos solo con mezcla de un tamaño y 2–4 colores
  (l.702–745); con `organica_fina` (varios tamaños) siempre cae en confeti.
- Frase de eje: "along its length" / "de un extremo al otro" (l.1164, 1172).
- La lectura del patrón en la foto describe "aleatorio" como "colores mezclados sin
  orden, como en una guirnalda orgánica" (`amaterasu/patron_referencia.py:110–123`).

### 1.3 Estructura oficial y taxonomía

- `src/lib/plan/estructuras-oficiales.ts:93`: `guirnalda` = "Tira orgánica de globos
  sobre una superficie o el piso", `forma: organica`, `sustantivoEn: organic balloon
  garland`. Sin `geometria`, sin `densidades`, sin mínimos, sin variantes (no hay
  guirnalda de mesa, de piso, de pared, asimétrica ni aireada). `techo_globos`
  reutiliza `tipoBase: guirnalda` con `ubicacion: techo` (l.98).
- `x-geometria-estructuras-oficiales` (l.260) no tiene entrada de guirnalda.
- Taxonomía de evaluación (12 clases): `guirnalda` es familia propia;
  `garland → guirnalda` en `src/lib/eval/estructuras/familia-v1-v2.ts:26`.

### 1.4 Reconocedor (`src/lib/ia/referencia/reference-structure.ts`)

- Regla base congelada (l.64): "garland = loose organic run along a surface or the
  floor"; `full_width` solo para una pieza continua; dos guirnaldas en lados opuestos
  son dos elementos; globos sueltos en el piso no son guirnalda. v16 (l.112–117) no
  añade nada de guirnaldas.
- Mapeo: `garland → guirnalda` y también `ceiling_installation → guirnalda` (l.155–169).
- Ubicación (`placementFor`, l.177–201): `piso_frontal` solo si la caja está abajo y
  es baja (`y+h ≥ 0,75`, `h ≤ 0,35`); si no, `full_width → fondo_pared`,
  `left/right → lateral_*`, centro → `arco_central`. Nunca `sobre_mesa_principal`,
  `alrededor_mobiliario` ni `recorrido_suelo`.
- **Nada deriva medidas de la foto.** El largo es lo que escribe el modelo del chat
  en `medidas.largo_m` o el default de Python. Es el caso abierto de
  `SEGUIMIENTO.md` §D ("guirnalda de 0,5 m y 12 globos donde hay un racimo grande").
- Exactitud sobre guirnaldas: solo v13 se midió (11 fotos × 3 corridas, 32/33
  detectadas, con un bouquet y un racimo de más en dos fotos), sin verdad humana
  computada. **v16 no se ha medido en guirnaldas.**

### 1.5 Prompts de imagen y captions

- Uzume (`src/lib/ia/uzume/build-image-prompt.ts`): frase de soporte solo para
  guirnalda en `fondo_pared` ("mounted flat against the wall…", l.133–135); nada
  para piso, mesa o sobre otra pieza. Sustantivo "garland" (l.338, 351).
- Kagutsuchi (`src/lib/ia/kagutsuchi/lora-caption-compiler.ts`): "organic balloon
  garland" en los dos dialectos (l.171, 852); "mixed organically rather than
  graded" con varios tamaños (l.1006, suprimido con patrón); ubicaciones v004
  `piso_frontal` "resting on the floor in front", `fondo_pared` "against the rear
  wall" (l.858–866). El vocabulario LoRA (`src/lib/lora/product-vocabulary-data.ts`)
  no tiene entradas de guirnalda; el catálogo trae `assembled.balloon.garland.*` y
  `kit.garland_arch.*`.
- Bloque de tamaños (`src/lib/ia/escena/tamano-fisico.ts:76–103`): "BALLOON SIZE
  MIX — HARD CONSTRAINT", pensado para que una guirnalda orgánica se vea creíble.

### 1.6 UI

- Gráfica del patrón: onda plana, una onda por cada 16 racimos, sin afinar
  (`src/components/plan/patron/geometria-dibujo.ts:148–151`). Leyenda "Extremo
  izquierdo → derecho" (`leyenda.ts:155`). Tarjeta: un solo mosaico "Largo"
  (`DetalleEstructura.tsx:121–124`); `describirEstructuraCliente` da "una guirnalda
  en el piso, al frente" (`presentacion-cliente.ts:149–164`).

### 1.7 Registro de Amaterasu (ADR-0030)

- `services/ai-api/app/amaterasu/estructuras/guirnalda.py` solo define
  `inicio_de_pieza = "the left end of a garland"`. No hay lectura propia de
  guirnalda (a diferencia de `bouquet.py`). Cambiar el orden de `DEFINICIONES`
  cambia `PROMPT_VERSION` del patrón (`0d8c93d34d672014`, fijado en test).

### 1.8 Huecos concretos (lo que la entrega debe cerrar)

1. Sin geometría de guirnalda más allá del largo: ni caída (swag), ni grosor, ni
   variantes de soporte (pared, mesa, piso, sobre estructura, entre dos puntos).
2. La cantidad sale de un default o del modelo del chat, nunca de la foto.
3. `placementFor` no lleva una guirnalda a mesa, mobiliario ni recorrido de suelo.
4. Preset de patrón: confeti para cualquier mezcla de varios tamaños; sin espejo
   desde el centro (una guirnalda simétrica colgada de dos puntos lo necesita).
5. Frase de soporte en el prompt solo para pared.
6. v16 sin medir en guirnaldas.
7. Comentarios rancios: `estructuras-oficiales.ts:64` y `presentacion-cliente.ts:71`
   citan `src/lib/medidas/geometria.ts`, que ya no existe. `SEGUIMIENTO.md` §4 aún
   dice que `MEZCLAS` está duplicada entre lenguajes (ya es `x-reglas-mezclas`).

### 1.9 Fuentes del oficio

- Ya usadas en el repo: Sempertex "Conceptos y técnicas – globos redondos" (pareja,
  trío, cuarteto, quinteto, sexteto; el curso básico de gráficas numeradas) y la
  tabla de helio; Anagram *Balloon Guide*; Qualatex "Balloon Basics" (solo vía
  buscador: la red bloquea qualatex.com y balloonhq.com); tabla de pesas del
  distribuidor. Ninguna trae la técnica de guirnalda orgánica escrita.
- No hay material propio del oficio sobre guirnaldas en el repo: las reglas de
  técnica (unidad del racimo, relleno, soporte) se proponen desde las fuentes de
  arriba y quedan marcadas como supuestos a validar con el negocio, como se hizo
  con las recetas del bouquet.

## 2. Diseño propuesto

### 2.1 Conteo desde la foto para todas las estructuras (frente 2)

**Principio.** Amaterasu describe lo que ve; Python decide la cantidad. La lectura no
compra nada: entrega una cuenta y una confianza, y `plan.py` la convierte en
`unidades_declaradas` (kits) o en medidas y densidad (geométricas) al confirmar.

- **Nueva lectura** `POST /internal/v1/ia/conteo-referencia` (scope
  `ia.conteo_referencia`), una llamada de visión por foto con todos los elementos de
  globos, en paralelo con las lecturas de patrón y de bouquet
  (`src/app/api/references/analyze/route.ts:41–46`). Prompt y esquema en
  `services/ai-api/app/amaterasu/conteo_referencia.py`, con la lista de reglas por
  tipo en el registro `amaterasu/estructuras/<tipo>.py` (campo nuevo
  `como_contar`). Salida por elemento (`conteo-referencia.v1`):
  - `globos_visibles: int` (los que se pueden contar uno a uno);
  - `exacto: bool` (verdadero si la pieza tiene ≤ 40 globos visibles y sin oclusión);
  - `estimado_total: int | null` (en piezas densas: racimos × globos por racimo, o
    largo aparente × globos por metro que el modelo aprecie);
  - `racimos: int | null`, `globos_por_racimo: int | null`;
  - `por_tamano: [{clase: chico|mediano|grande|gigante, proporcion}]` (5"/9" · 12" ·
    18"/24" · 36"), porque el reparto por tamaño cambia la compra;
  - `largo_relativo` y `alto_relativo` respecto de una referencia visible (una
    persona, una puerta, una mesa) cuando exista: `{referencia, veces}`;
  - `confianza` 0–1.
  Se guarda en `appearance.conteo` del blueprint (`reference-blueprint.ts`), como
  `patron_color` y `armado_bouquet`.
- **Contrato** (`src/lib/ia/contracts/domain-v1.ts` → export → `generate_models.py`):
  `pistas_conteo[]` y `completar_conteos` en `plan-resolution.v1` (mismo patrón que
  `pistas_patron`/`pistas_armado`); `conteos_referencia[]` fuera del hash en
  `plan-resuelto.v1` con lo que Python decidió y por qué (para "Ajustes que hice").
- **Reglas en Python (`plan.py`, función nueva `_aplicar_conteos`, antes de
  `_build_resolved`, con el catálogo leído)**:
  - Kits (bouquet, figura, kit): con `exacto` y confianza ≥ 0,5,
    `unidades_declaradas = globos_visibles × repeticiones` (el bouquet ya lo hace
    desde su propia lectura; aquí se unifica: la lectura del armado manda si existe,
    si no, el conteo).
    **Enmienda del 2026-09-25: esta regla queda descartada.** Un bouquet de más de 30
    globos salió con 11 porque la lectura del armado describe una unidad por nivel
    (`SEGUIMIENTO-bouquets.md` §14, rama `feat/bouquets`). El conteo da la cantidad
    y el armado la distribución, y un conteo no exacto también puede subir un kit
    (ver `SEGUIMIENTO-conteo.md` §3).
  - Geométricas: se busca la combinación (densidad ∈ {sencilla, media, lujosa}, eje
    dentro de ±35 % del declarado, o del largo relativo si la foto trae referencia)
    cuyo total de `_total_globos` quede más cerca del `estimado_total` (o de
    `globos_visibles` si es exacto). Se ajustan `densidad` y `medidas` del plan y se
    deja un supuesto: "Guirnalda: la foto muestra unos 60 globos; el plan decía 48
    (2,5 m, media): quedó en 3,1 m". **Aproximado a propósito** en piezas densas:
    la tolerancia es ±15 % y nunca se sale de la puerta física. La mezcla no se
    toca salvo que `por_tamano` la contradiga claramente (p. ej. la foto no tiene
    globos grandes y el plan usa `organica_gruesa`): entonces se elige la mezcla
    del contrato más cercana a la proporción leída.
  - Con confianza < 0,5, sin referencia de escala y sin cuenta exacta: nada cambia.
  - Bandera `CONTEO_REFERENCIA_V1` (default OFF) para la completitud al confirmar y
    `CONTEO_REFERENCIA_PYTHON_ENABLED` para la llamada de visión, como las de
    ADR-0028/0030. `completar_conteos_de: [ids]` en la re-resolución tras editar,
    igual que `completar_armados_de`.
- **El modelo del chat también lo ve**: `serializeReferenceBlueprint`
  (`src/lib/ia/omoikane/prompt-sistema.ts`) añade "conteo leído en la foto: unos N
  globos (exacto/aproximado), racimos R" y la regla de declarar/ajustar en
  consecuencia, como se hizo con "armado leído en la foto".
- **Evaluación** (sin costo primero, paga después con tope): un conjunto de 30
  fotos del dataset privado con conteo humano por foto (el usuario cuenta o valida;
  formato `sha256, globos, exacto`). Métrica: error relativo mediano por familia;
  meta de la primera versión: ≤ 25 % en densas, exacto ±1 en piezas de ≤ 15
  globos. Runner en `src/lib/eval/estructuras/` reutilizando el de reconocimiento
  (tope declarado, telemetría apagada, crudos fuera del repo).

### 2.2 Guirnaldas por partes (frente 1)

**Modelo de la pieza.** Una guirnalda se arma por **racimos** (cuartetos por defecto;
tríos o quintetos según densidad) encadenados a lo largo del eje, con **relleno** de
globos chicos entre racimos en las mezclas orgánicas, sobre un **soporte** (tira en
pared, cuerda entre dos puntos, apoyada en piso o mesa, o abrazada a otra pieza).
Lo que ya existe (rejilla de racimos del patrón, hoja de armado, gráfica numerada)
se reutiliza; lo nuevo es la geometría, el soporte, el relleno y la lectura.

- **Contrato `armado-guirnalda.v1`** (dueño Zod `src/lib/plan/armado-guirnalda.ts`,
  campo opcional `armado_guirnalda` en la estructura, sin `.default()`):
  - `version`, `origen: decorador | referencia | sugerido`;
  - `soporte: pared | colgada | piso | mesa | sobre_estructura` (con
    `sobre_estructura`, `estructura_id` de la pieza anfitriona);
  - `forma: recta | curva | ondulada | u_invertida | arco_caido` (una guirnalda
    colgada de dos puntos cae en U; sobre pared puede subir y bajar);
  - `caida_m` opcional (cuánto baja el centro respecto de los extremos) y
    `puntos_de_anclaje` (2..6);
  - `racimo: {unidad: trio | cuarteto | quinteto, tamano_pulg_base: 9 | 11 | 12}`;
  - `relleno: {material: índice, proporcion 0..0,5} | null` (globos chicos entre
    racimos; su cantidad sale de la mezcla, no se compra aparte);
  - `remates: [{material, posicion: extremo_izq | extremo_der | centro | cada_n}]`
    (foils, burbujas o globos grandes sobre la guirnalda), hasta 6.
  Reglas cruzadas solo en Python (`armado_guirnalda.py`): `sobre_estructura` exige
  que exista la anfitriona y que no sea otra guirnalda; `colgada` exige
  `puntos_de_anclaje ≥ 2`; `relleno` solo con mezcla que tenga globos ≤ 9"; la suma
  de globos del armado = compra del plan (misma regla que el bouquet).
- **Geometría en `plan.py`**: entrada de `guirnalda` en
  `x-geometria-estructuras-oficiales` (dueño `estructuras-oficiales.ts`) con
  `eje: largo`, `caida` y `factor_perfil` por forma; `_eje` deja de ignorar `alto_m`:
  con `forma: u_invertida | arco_caido` el largo real de la cuerda es la catenaria
  aproximada (`largo + 8/3 · caida² / largo`), que hoy la puerta física no ve. La
  densidad sigue mandando en la banda; el relleno no cambia el total (es parte de la
  mezcla). Ningún vector dorado cambia mientras `armado_guirnalda` esté ausente.
- **Registro Amaterasu** `estructuras/guirnalda.py`: criterios de detección
  (soporte, forma, racimos, relleno, remates), prompt y esquema de la lectura
  `lectura-guirnalda` (una llamada por foto con guirnaldas, en paralelo con las
  demás; misma `vision_estructurada.py`), `validar_lecturas`. Salida:
  `{soporte, forma, puntos_de_anclaje, racimos_visibles, unidad_racimo,
  colores_por_racimo[], relleno: {color, proporcion} | null, remates[], confianza}`.
  Con el conteo del frente 2, la lectura de la guirnalda da la **distribución** y
  el conteo da la **cantidad**.
- **Sugerencia y resolución** (`armado_guirnalda.py`, único dueño): `sugerir_armado`
  por lectura o receta (pared si la ubicación es `fondo_pared`, piso si
  `piso_frontal`/`recorrido_suelo`, mesa si `sobre_mesa_principal`; cuarteto de 12"
  con relleno de 5" en `organica_fina`; trío en `sencilla`; quinteto en `lujosa`);
  `armado_resuelto`: leyenda de códigos por material comprado, racimos numerados
  de izquierda a derecha (compatibles con la rejilla del patrón: `k` del patrón =
  globos del racimo), insumos no cotizados (tira perforada en metros, cuerda,
  pegante o ganchos, pesas en piso, tijeras y bomba), duración estimada
  (racimos/hora del oficio, marcado estimado), pasos en español, avisos, y
  `prompt_gemini` / `prompt_lora` (soporte, forma, caída, remates; inglés ASCII sin
  cifras en LoRA). Se emite en `plan_resuelto.armados_guirnalda[]` fuera del hash.
- **Patrón y armado juntos**: el patrón sigue decidiendo el color de cada globo;
  el armado decide unidad, soporte, forma y relleno. Cuando la mezcla tiene varios
  tamaños, el preset del patrón pasa a `espiral`/`anillos` **por racimo** (no
  confeti): hoy `sugerir_patron` cae en confeti por tener varios tamaños
  (`patron_color.py:725–745`); se añade el caso "racimos de guirnalda" con
  `globos_por_racimo` = unidad del armado. Espejo permitido en `guirnalda` con
  `forma: u_invertida` (simetría desde el centro), con su prueba.
- **Ubicación desde la foto**: `placementFor` (`reference-structure.ts:177–201`)
  gana `sobre_mesa_principal` (caja sobre una mesa detectada), `alrededor_mobiliario`
  y `recorrido_suelo`; usa `soporte` de la lectura cuando existe.
- **Prompts**: frase de soporte y forma para cada `soporte` en Uzume
  (`build-image-prompt.ts:133–135` hoy solo pared) y en Kagutsuchi (v004 y v007);
  descriptor "organic balloon garland" se especializa: "draped between two points",
  "resting on the floor along the front", "running along the table edge". Sin
  patrón ni armado, byte a byte lo de siempre (misma prueba de instantánea que
  `test-patron-color-prompt.ts`).
- **UI** (`src/components/plan/guirnalda/`, reutilizando `patron/*`): bloque
  "Armado de la guirnalda" (soporte, forma, unidad, relleno, remates, insumos),
  gráfica con la forma real (recta, U, ondulada) y racimos numerados (la rejilla
  del patrón dibujada sobre la curva del armado), editor con autoguardado
  (soporte, forma, unidad, relleno, remates arrastrables a un racimo) y hoja de
  armado imprimible (insumos con metros de tira y cuerda, pasos por racimo). La
  hoja del patrón y la del armado se funden en una sola para guirnaldas.
- **Evaluación del reconocedor en guirnaldas**: correr v16 (prompt congelado, sin
  cambios) sobre la carpeta `guirnalda` del dataset privado con tope declarado;
  revisar a mano; si v16 falla en guirnaldas colgadas (leídas como arco) se
  documenta y se propone una variante v17 solo bajo pedido (ADR-0029 manda).

### 2.3 Armado del bouquet ↔ fal.ai (frente 3, agente autónomo)

Misión para un agente `general-purpose` en segundo plano, sin preguntas, con
commits propios en la rama y sin push; si algo lo bloquea, lo anota y sigue:

1. Trazar cómo `armados_bouquet` llega a Kagutsuchi y a Uzume desde
   `/api/generate` (`frasesDeEstructuras`, `colorVarietyContract`,
   `compactSceneSpec.color_pattern`, `compileLoraCaption` / `compileProductPrompt`,
   clave de agrupación, JSON de sujetos, compactación, `lora-prompt-preflight.ts`).
   Confirmar que el elemento bouquet cumple `tieneContratoDeColor`, también con
   instancias repetidas (`EST_x#n`) y con `grupos: 2` (números a los lados).
2. Vocabulario LoRA y descriptores (`product-vocabulary-data.ts`,
   `scene-spec.ts` STRUCTURE_DESCRIPTORS, `estructuras-oficiales.ts` `sustantivoEn`,
   `lora-product-runtime.ts` confirmaciones de tamaño): que un globo número, un
   corazón metalizado y una burbuja tengan entrada y tamaño que el caption pueda
   nombrar, coherente con `prompt_lora` (dígitos deletreados, sin cifras, ASCII),
   dentro de `LORA_PROMPT_MAX_LENGTH` y del control de idioma.
3. Etapa híbrida (`lora-gemini-composition.ts`, `hardLockComposicionGemini`): el
   candado debe cubrir también el armado (niveles, remate, dónde van los números)
   cuando hay `armados_bouquet`, sin cambiar la salida cuando no hay nada (las
   instantáneas lo vigilan).
4. Referencias de imagen para `/edit` con LoRA (`lora-edit-referencias`): que un
   bouquet elija sus referencias de catálogo (látex, número, corazón) con sentido.
5. Cualquier otra cosa que haga que el bouquet generado no siga el armado
   (palabras "loose balloons"/"cluster", densidad, "mixed organically" en kits,
   el bloque de estimación que describe 5 globos como arreglo grande).
6. Cero llamadas pagas: todo se verifica con las pruebas deterministas
   (`ia:test-patron-color-prompt`, `ia:test-lora-compiler`,
   `lora:test-product-runtime`, `ia:test-lora-bilateral`, `ia:test-prompts`,
   `plan:test-prompt`). Si hace falta una generación real, deja un script en
   `scripts/ops/` con tope de gasto y modo vista previa para que el usuario lo corra.
   Cierre: `tsc`, lint 0 errores, pruebas afectadas en verde, `contracts:check` si
   tocó contratos, informe en `SEGUIMIENTO-bouquets.md` ("Armado y generación en
   fal.ai": hallazgos con `archivo:línea`, cambios, verificación, pendientes).

## 3. Entregas y orden

| # | Entrega | Rama | Bandera | Reversible con |
|---|---|---|---|---|
| E0 | Frente 3: armado ↔ fal.ai (agente) | `feat/bouquets` | ninguna (solo prompts/vocabulario) | revertir commits |
| E1 | Frente 2a: lectura de conteo + contrato + blueprint (sin cambiar planes) | `feat/conteo-referencia` | `CONTEO_REFERENCIA_PYTHON_ENABLED` OFF | apagar bandera |
| E2 | Frente 2b: `_aplicar_conteos` al confirmar + texto para el modelo + evaluación | misma | `CONTEO_REFERENCIA_V1` OFF | apagar bandera |
| E3 | Frente 1a: contrato `armado-guirnalda.v1`, `armado_guirnalda.py`, geometría (sin UI) | `feat/guirnaldas` | `GUIRNALDAS_ARMADO_V1` OFF | apagar bandera / revertir |
| E4 | Frente 1b: lectura de guirnalda en la foto + `placementFor` | misma | `GUIRNALDA_REFERENCIA_PYTHON_ENABLED` OFF | apagar bandera |
| E5 | Frente 1c: prompts (Uzume/Kagutsuchi), patrón por racimo, espejo | misma | ninguna (byte a byte sin armado) | revertir |
| E6 | Frente 1d: UI (bloque, gráfica, editor, hoja) | misma | ninguna | revertir |
| E7 | Evaluación v16 en guirnaldas y conteo (pagas, con tope) | — | — | — |

Cada entrega termina con: ADR propio (0031 conteo desde la foto; 0032 guirnaldas por
partes) al estilo de ADR-0030, `SEGUIMIENTO` actualizado, PR contra `main` con CI en
verde, y app + `ai-api` desplegados juntos cuando cambie el contrato.

## 4. Decisiones que toma el negocio (se asumen así salvo aviso)

- Tolerancia del conteo aproximado en piezas densas: ±15 %; en piezas de ≤ 15
  globos, exacto. Confianza mínima 0,5, la misma del bouquet.
- Cuando la foto y las medidas del cliente se contradicen, mandan las medidas que
  el cliente escribió (`espacio.fuente: cliente`); la foto solo ajusta densidad.
- Unidad por defecto de la guirnalda: cuarteto de 12"; trío en `sencilla`;
  quinteto en `lujosa`. Relleno de 5" solo en mezclas orgánicas.
- Insumos de soporte no se cotizan (como pesas y cintas del bouquet): se listan.
- Una guirnalda `sobre_estructura` no compra soporte y se dibuja abrazada a la pieza.

## 5. Riesgos y límites

- El reconocedor v16 está congelado y no se ha medido en guirnaldas: si confunde
  guirnaldas colgadas con arcos, el conteo y el armado caen en la pieza equivocada.
  Mitigación: E7 antes de encender banderas; la lectura de conteo/guirnalda se pide
  también para arcos y semiarcos (misma llamada por foto).
- Contar globos en fotos densas es inexacto por naturaleza: por eso es "aproximado"
  y el supuesto se muestra al cliente; nunca se baja de la puerta física.
- Cambiar densidad o medidas cambia `plan_hash` de planes en vuelo solo al
  confirmar (nunca en re-resoluciones), como los patrones y armados.
- Costo: cada foto con estructuras suma una llamada de visión más (conteo) y otra
  para guirnaldas (~US$0,002–0,01 cada una). Las evaluaciones se corren con tope
  declarado y confirmado.

## 6. Verificación por entrega

```
npx tsc --noEmit && npm run -s lint && npm run -s contracts:check && npm run plan:test
uv run --directory services/ai-api pytest -q
uv run --directory services/ai-api ruff check app tests && uv run --directory services/ai-api mypy app
uv run --directory services/ai-api python scripts/generate_models.py --check
```

Más, por entrega: instantáneas byte a byte de prompts sin armado ni conteo; 31
vectores dorados sin cambios; e2e local contra el catálogo real (como
`scratchpad/e2e-armado-bouquet.mts` de la sesión de bouquets: mismo total con y sin
bandera, punto fijo, vista previa = resolución); y para E7, corridas pagas con
tope y crudos fuera del repo.

## 7. Primer paso concreto al retomar

1. Lanzar el agente del frente 3 con la misión de §2.3 (no pregunta; commits en
   `feat/bouquets`).
2. Validar con el negocio los supuestos de §4 (unidad del racimo, relleno, soporte).
3. Contar a mano 30 fotos del dataset privado (10 densas, 10 medias, 10 de pocos
   globos) para la evaluación del conteo; guardar `sha256, globos, exacto` fuera del
   repo.
4. Abrir `feat/conteo-referencia` desde `main` con `feat/bouquets` integrada.

## 8. Estado de las entregas

### E3 — guirnaldas por partes, backend sin UI (hecha el 2026-09-25, rama `feat/guirnaldas`)

Decisiones en ADR-0032 (`docs/architecture/decisions/0032-guirnaldas-por-partes.md`).
Referencias a la rama al cierre de la entrega.

- **Contrato `armado-guirnalda.v1`**: dueño Zod `src/lib/plan/armado-guirnalda.ts`
  (forma y `ArmadoGuirnaldaResueltoSchema`); campo opcional en Plan 1.0 y 1.1
  (`src/lib/plan/tipos.ts:118` y `:349`); `armados_guirnalda` y
  `completar_armados_guirnalda` en `src/lib/ia/contracts/domain-v1.ts:416` y
  `:484`. Exportado (`contracts/domain/v1/*`, y `contracts/chat/v1/request.schema.json`
  porque el chat lleva el plan vigente) y `generated_models.py` regenerado.
- **Geometría**: entrada `guirnalda` en `src/lib/plan/estructuras-oficiales.ts:106`
  (`eje: "largo"`, `factorPerfil` y `conCaida` por forma) →
  `x-geometria-estructuras-oficiales`; en `services/ai-api/app/plan.py`:
  `_GARLAND_SHAPES` (l.152), `_garland_cord` (l.1041, parábola exacta por tramo),
  `_garland_profile` (l.1067), `_eje` (l.1075) y `_structure_count` (l.1515),
  que pasa el armado a `_total_globos`. La puerta física mide sobre la cuerda
  porque lee `eje_m`.
- **Dueño de las reglas**: `services/ai-api/app/armado_guirnalda.py`: supuestos
  del oficio (l.73–103), `_validar_forma_y_soporte` (l.287), `_tomar_relleno`
  (l.356), `_tomar_remates` (l.413), `_racimos` (l.453), `_repartir` (l.506),
  `validar` (l.546), `_receta` (l.571), `_desde_lectura` (l.605, punto de
  entrada de E4), `sugerir_armado` (l.649), `opciones_admitidas` (l.681),
  `_insumos` (l.798), `_duracion` (l.902), `_frases_prompt` (l.927),
  `armado_resuelto` (l.1057).
- **Resolución** (`plan.py`): `completar_armados_guirnalda` en la petición
  (l.341), completitud en `_resolution_result` (l.3576), `armados_guirnalda`
  fuera del hash en `_build_resolved` (l.3078); `_is_garland` (l.3824),
  `_garland_context` (l.3833), `_completar_armados_guirnalda` (l.3929),
  `_armados_guirnalda_resueltos` (l.3957), `vista_previa_de_armado_guirnalda`
  (l.4012), `validar_armado_guirnalda_sin_catalogo` (l.4046); `_runs_by_demand`
  (l.848) sale de `_read_back_purchases` para nombrar con las líneas.
- **Vista previa y edición** (`services/ai-api/app/plan_edicion.py`):
  `EdicionArmadoGuirnalda` (l.250), `completar_armados_guirnalda` en la edición
  (l.312), `PlanArmadoGuirnaldaRequest` (l.408), `_fijar_armado_guirnalda`
  (l.876), `_revisar_armado_guirnalda` (l.893), `vista_previa_armado_guirnalda`
  (l.1052); endpoint `POST /internal/v1/plan/armado-guirnalda` en
  `services/ai-api/app/main.py:1511` (scope `plan.armado_guirnalda`).
- **Next**: bandera `GUIRNALDAS_ARMADO_V1` (`src/lib/ia/nucleo/feature-flags.ts:61`,
  default OFF, y `.env.example`); confirmar pide la completitud
  (`src/lib/ia/herramientas/registro-herramientas.ts:981`); `resolver-backend.ts`
  (l.66) y `python-adapter.ts` (l.1173) la llevan solo cuando se pide; la
  edición re-sugiere solo la pieza que perdió el armado
  (`src/lib/plan/aplicar-edicion.ts:204`); acción `armado_guirnalda` en
  `src/lib/plan/edicion-esquemas.ts:131` y `/api/plan-editar`.
- **Limpieza (§1.8, punto 7)**: comentarios de `estructuras-oficiales.ts` y
  `presentacion-cliente.ts` que citaban `src/lib/medidas/geometria.ts`;
  `SEGUIMIENTO.md` §4 ya no dice que `MEZCLAS` está duplicada.

**Verificación real** (2026-09-25):

- `npx tsc --noEmit`: solo el TS2304 `LayoutProps` preexistente de
  `src/app/layout.tsx`. `npm run -s lint`: 0 errores (26 avisos preexistentes).
  `npm run -s contracts:check`: sin deriva. `npm run plan:test`: completo en 0,
  con `plan:test-armado-guirnalda` (7 casos, salidas reales de Python fijadas
  en `scripts/fixtures/armado-guirnalda/resueltos.json`).
- `pytest -q`: 742 en verde (4 omitidas por falta de Postgres local), con
  `tests/test_armado_guirnalda.py` (47 casos) y `tests/test_plan_guirnalda.py`
  (20: bandera on/off, compra igual, hash, punto fijo, `completar_armados_de`,
  techo y arco sin armado, cuerda y puerta física, vista previa = resolución,
  edición, endpoint). `ruff check`, `ruff format --check`, `mypy app` y
  `generate_models.py --check` limpios. Los 31 vectores dorados no cambian.
- E2E local contra el catálogo real (ai-api del worktree en 8012, sin LLM ni
  gasto): guirnalda de 2,5 m, `media`, `organica_fina`, dos colores Fashion:
  48 globos y 50.436 COP con y sin bandera, mismas líneas, `plan_hash`
  distinto, punto fijo, vista previa = resolución (armado dado y receta), una
  caída de 0,6 m da 2,84 m de cuerda y 55 globos sin aviso de la puerta física,
  y cambiar la mezcla a clásica quita el armado con aviso y la re-resolución
  trae la receta nueva con el mismo total. 14/14.

**Pendientes**:

- Validar con el negocio los supuestos del oficio (ADR-0032): unidad por
  densidad, relleno de 5", remates repartidos, soporte por ubicación, insumos y
  ritmo de armado. `factorPerfil` está en 1 en todas las formas, sin calibrar.
- E4 y E5 hechas (ver abajo). E6: UI y la ruta de Next de la vista previa (Python ya responde en
  `/internal/v1/plan/armado-guirnalda`).
- Un rechazo `armado_invalido` de la vista previa no trae `opciones` (la
  frontera de `main.py` solo deja pasar campos conocidos); el editor de E6
  puede pedirlas con `armado_guirnalda: null`.
- Los remates son globos grandes de látex de la propia guirnalda: un foil o
  una burbuja sobre la guirnalda sigue siendo otra estructura (la resolución
  geométrica solo compra látex redondo).
- Al fusionar con `feat/conteo-referencia`: `_aplicar_conteos` debe ir antes de
  las completitudes de armados en `_resolution_result` (plan.py l.3576), para
  que la receta vea la densidad y las medidas finales.

### Fusión (2026-09-28, `27528f2` en `origin/feat/guirnaldas`)

`feat/bouquets` (E0) y `feat/conteo-referencia` (E1) fusionadas con merges
normales. Conflictos: `package.json` (la cadena de `plan:test` une
`plan:test-armado-guirnalda`, `ia:test-conteo-referencia` e
`ia:test-armado-bouquet-prompt`; un `&&npm` sin espacio de la rama de conteo
quedó normalizado) y `generated_models.py` (regenerado desde el Zod fusionado;
`contracts:export` y `contracts:export:domain` no cambiaron nada). Verificado
tras la fusión: pytest 769, ruff check y format, mypy `app scripts`,
`generate_models.py --check`, `contracts:check`, tsc (solo `LayoutProps`),
lint 0 errores y `plan:test` en 0; los vectores dorados no cambian.

### E4 — lectura de la guirnalda en la foto y ubicación (hecha el 2026-09-28)

Decisiones 16 a 19 de ADR-0032 (numeradas 10 a 13 antes de fusionar E5).

- **Python**: criterios, prompt, esquema y `validar_lecturas` en
  `services/ai-api/app/amaterasu/estructuras/guirnalda.py` (la `DEFINICION` no
  cambia); la llamada en `app/amaterasu/guirnalda_referencia.py` (comprueba
  cada lectura contra `appearance.armado_guirnalda` del contrato); la ruta
  `POST /internal/v1/ia/guirnalda-referencia` (scope `ia.guirnalda_referencia`)
  en `app/main.py`. `pistas_guirnalda` en `PlanResolutionRequest` (`plan.py`,
  validada contra el contrato) llega a `_completar_armados_guirnalda`, y
  `armado_guirnalda.py` la traduce (`_forma_desde_lectura`, `_desde_lectura`;
  `OtraEstructura.referencia_element_id` para la anfitriona).
- **Contrato**: `LecturaGuirnaldaSchema` y `PistaGuirnaldaSchema` en
  `src/lib/plan/armado-guirnalda.ts`; `appearance.armado_guirnalda` en
  `reference-blueprint.ts`; `pistas_guirnalda` en `domain-v1.ts`. Exportado y
  modelos regenerados.
- **Next**: `src/lib/ia/amaterasu/guirnalda-referencia.ts` (qué se lee, caché
  compartida, nunca rompe el análisis); `lecturas-foto.ts` (cuarta lectura y
  `reubicarGuirnaldas`); bandera `GUIRNALDA_REFERENCIA_PYTHON_ENABLED`
  (`feature-flags.ts`, `.env.example`) en `/api/references/analyze`;
  `llamarPythonGuirnaldaReferencia` y `pistasGuirnalda` en `python-adapter.ts` y
  `resolver-backend.ts`; `pistasGuirnaldaDelPlan` al confirmar
  (`registro-herramientas.ts`); `refinarPlacementGuirnalda` y
  `reubicarGuirnaldas` en `src/lib/ia/referencia/reference-structure.ts`.
- **Pruebas**: `tests/test_guirnalda_referencia.py` (prompt, validación, contrato,
  ruta y scope), casos nuevos en `tests/test_armado_guirnalda.py` y
  `tests/test_plan_guirnalda.py` (la foto decide la distribución y no la compra,
  anfitriona por elemento, pista mal formada); `scripts/test/test-guirnalda-referencia.ts`
  en `plan:test` (qué se lee, caché, fallos, bandera apagada = mismo objeto,
  ubicación, `pistas_guirnalda`).

**Verificación real** (2026-09-28): pytest 783 en verde (4 omitidas por falta de
Postgres local); ruff check y format, mypy `app scripts` y
`generate_models.py --check` limpios; `contracts:check` sin deriva; tsc solo con
el `LayoutProps` preexistente; lint 0 errores; `plan:test` en 0 con
`ia:test-guirnalda-referencia` (7 casos). Versiones del prompt del patrón
(`0d8c93d34d672014`) y del conteo sin cambios. Sin llamadas pagas: la lectura
no se probó contra Gemini.

**Pendientes de E4**: medir la lectura en fotos reales con tope de gasto (E7);
calibrar los umbrales de ubicación (mesa, muebles, recorrido de piso); E5 puede
usar `colores_por_racimo` para el patrón por racimo.

**Fusión de conteo E2 (2026-09-28, `0072d33`):** `_aplicar_conteos` corre antes de
las completitudes de bouquets y guirnaldas y cuenta con `_structure_count`, así
que una guirnalda colgada se compara por su cuerda parabólica; pruebas
`test_el_conteo_se_compara_con_la_cuerda_que_se_compra` y
`test_la_cantidad_sale_del_conteo_y_la_distribucion_de_la_lectura`
(`tests/test_plan_guirnalda.py`).

**Fusión de E5 (2026-09-28, `7551491`) y orden al confirmar:** receta → patrón
por racimos → receta en `_completar_armados_guirnalda` (ADR-0032, decisión 20;
las de E4 pasaron a 16–19), degradando con un supuesto si no cabe; pruebas
`test_una_guirnalda_nueva_con_las_dos_banderas_va_por_racimos` y siguientes en
`tests/test_plan_guirnalda.py`. `colores_por_racimo` (E4) queda sin alimentar la
pista del patrón hasta medir las dos lecturas (E7).

### E5 — prompts, patrón por racimo y espejo (hecha el 2026-09-28, rama `feat/guirnaldas-e5`)

Parte de `feat/guirnaldas` en `27528f2` (E0, E1 y E3 ya dentro). Decisiones
10 a 15 de ADR-0032; enmiendas de §3 y §6 en ADR-0028. Sin bandera propia:
sin `armados_guirnalda` nada cambia. Referencias a la rama al cierre.

- **Python, dueño del patrón y del armado**:
  - `services/ai-api/app/patron_color.py`: `EstructuraPatron.racimo_armado` y
    `forma_armado` (l.155); `_admite_espejo` (l.385) y `_racimo_de_armado`
    (l.392); `filas_de_racimos` (l.678), el patrón sobre los racimos que se
    arman; `_preset_por_racimo` (l.784) y `sugerir_patron` (l.819);
    `modos_admitidos` ofrece espejo en U (l.869); la unidad del armado manda
    en `sugerir_patron_modo` (l.1044) y en `patron_desde_pista` (l.1222);
    redacción en espejo `_EJE_ESPEJO` y `_PIE_Y_CLAVE_ES` (l.1282, l.1293).
  - `services/ai-api/app/armado_guirnalda.py`: `EstructuraGuirnalda.filas_de_racimos`
    (l.184), usada por `_racimos` (l.482); `racimo_y_forma` (l.569);
    `_frase_lora` (l.1074), la frase LoRA como modificador.
  - `services/ai-api/app/plan.py`: `_pattern_context` lee el armado de una
    guirnalda por partes (l.666); `_garland_context` pasa el patrón por
    racimos (l.3901, l.3933). Tres líneas de import aparte (`partial`,
    `racimo_y_forma_de_armado`, `filas_de_racimos`).
  - `services/ai-api/app/plan_edicion.py`: `AVISO_ESPEJO_GUIRNALDA` (l.141),
    `_quitar_espejo_sin_u` (l.901), llamado al fijar el armado (l.891) y tras
    `_revisar_armado_guirnalda` (l.1016).
- **Next, solo inserta y elige frases fijas**:
  - `src/lib/ia/uzume/mezcla-color-escena.ts`: `ArmadoGuirnaldaEnPrompt`
    (l.91), `frasesDeEstructuras` con `armados_guirnalda` y la unión con el
    patrón (l.138), `armadoGuirnaldaDeElemento` (l.183).
  - `src/lib/ia/uzume/armado-en-prompt.ts`: `fraseSoporteGuirnalda` (l.140),
    `FRASE_INSTANCIA_CON_ARMADO_GUIRNALDA` (l.150),
    `CARDINALIDAD_CON_GUIRNALDA_ABRAZADA` (l.157).
  - `src/lib/ia/uzume/build-image-prompt.ts`: `shapeClause` con el armado
    (l.119) y `anfitrionaEnPrompt` (l.147); excepción de mesa (l.280); de
    cardinalidad (l.435); reparto orgánico sin patrón (l.506); `armadoClause`
    (l.517).
  - `src/lib/ia/kagutsuchi/lora-caption-compiler.ts`: `armadoGuirnalda` en la
    cláusula (l.148, l.184, l.652, l.1168).
  - `src/lib/ia/uzume/lora-gemini-composition.ts`: `GEMINI_COMPOSITION_GARLAND_LOCK`
    (l.52), `hardLockComposicionGemini` con tercer candado (l.59),
    `candadosDeComposicion` (l.77) y `conArmadoGuirnaldaEnCaption` (l.85);
    `src/app/api/generate/route.ts:1118` lo pasa.
- **Cómo convive el relleno con el patrón** (decidido): el patrón colorea los
  racimos; el relleno y los remates toman el color de su material y no ocupan
  posiciones del patrón. El racimo `i` es la fila `i` del patrón expandido
  sobre los racimos que se arman. La compra sigue saliendo de la rejilla
  completa (T/k filas); si un color no alcanza, `fuera_de_patron` lo avisa
  (en la U en espejo de prueba: 3 de 44 globos).
- **Pruebas nuevas**: `services/ai-api/tests/test_patron_guirnalda.py` (23:
  preset sin armado igual, por racimo, unidad del armado sobre la de la foto,
  espejo en U y fuera de ella, redacción, `filas_de_racimos`, resolución y
  edición); frase LoRA por soporte y forma en `test_armado_guirnalda.py`;
  `scripts/test/test-armado-guirnalda-prompt.ts` (`ia:test-armado-guirnalda-prompt`,
  en `plan:test`) con `scripts/lib/escenas-armado-guirnalda.ts` y
  `scripts/fixtures/armado-guirnalda-prompt/` (15 planes de Python de verdad,
  escritos por `services/ai-api/scripts/fixture_armado_guirnalda_prompt.py`,
  vista previa por defecto y `--escribir`; e instantánea de 16 prompts sin
  armado, capturada con los constructores de `27528f2`). `resueltos.json` de
  E3 lleva la frase LoRA nueva.
- **Script para E7**: `scripts/ops/generar-guirnalda-armado.ts`, generación
  real en fal.ai con y sin armado (pared, swags, U en espejo, piso, abrazada),
  vista previa por defecto, gasto solo con `--confirm-spend --max-usd`. No se
  corrió con gasto.

**Verificación real** (2026-09-28):

- Python: `pytest -q` 799 en verde (4 omitidas por falta de Postgres local);
  `ruff check`, `ruff format --check`, `mypy app scripts` y
  `generate_models.py --check` limpios. Los 31 vectores dorados no cambian
  (`test_plan_parity`, `test_plan_regresion`). Los cinco planes sin armado de
  la fixture salen idénticos resueltos con el código de `27528f2` y con E5.
  `PROMPT_VERSION` del patrón de Amaterasu sigue en `0d8c93d34d672014`.
- Next: `npx tsc --noEmit` solo con el TS2304 `LayoutProps` preexistente de
  `src/app/layout.tsx`; `npm run -s lint` 0 errores (25 avisos
  preexistentes); `npm run -s contracts:check` sin deriva (E5 no toca el
  contrato); `ia:test-armado-guirnalda-prompt`, `ia:test-patron-color-prompt`,
  `ia:test-armado-bouquet-prompt`, `ia:test-lora-compiler`,
  `ia:test-lora-bilateral`, `ia:test-lora-v004-compactacion`,
  `ia:test-prompts`, `lora:test-product-runtime`, `plan:test-prompt` y
  `plan:test-armado-guirnalda` en verde. `npm run plan:test`: completo en 0
  (85 scripts, con `ia:test-armado-guirnalda-prompt`: 12 casos).

**Pendientes**:

- **No se sabe si el LoRA v007 (ni el v004) aprendió guirnaldas por soporte**:
  "draped between two anchor points", "in clusters of four" o "wrapped around
  the balloon arch" nunca estuvieron en sus captions. Se mide en E7, con pago
  y tope (`scripts/ops/generar-guirnalda-armado.ts`).
- Al confirmar, el patrón se completa antes que la receta del armado, así que
  una guirnalda nueva sigue recibiendo confeti con varios tamaños y cuarteto
  (ADR-0032, decisión 15). Propuesta para la fusión con E2/E4: receta →
  patrón por racimo → receta otra vez, validando que ningún remate quede sin
  globo grande.
- La compra por color sigue la rejilla completa y los racimos el patrón sobre
  ellos: con anillos o espejo la diferencia sale como `fuera_de_patron`.
  Contar la rejilla sobre los racimos cambiaría la compra: decisión de negocio.
- La variante JSON del caption (experimental) dice "every listed decoration
  appears once as a separate physical piece" también con una guirnalda
  abrazada a otra pieza; el texto y Gemini ya lo exceptúan.
- Para E6: la gráfica del armado debe dibujar `armados_guirnalda[].racimos`
  (los colores que salen de `filas_de_racimos`), no las filas de
  `patrones_color[].celdas`, que tienen T/k filas.
- Para la fusión con E4: E5 toca `plan.py` solo en `_pattern_context`,
  `_garland_context` y tres imports; ni el contrato ni `reference-structure.ts`.

### E6 — UI del armado de la guirnalda (hecha el 2026-09-28, rama `feat/guirnaldas-e6`)

Parte de `feat/guirnaldas` 27528f2 (sin E4 ni E5). Decisiones 21–25 en ADR-0032
("Entrega E6"; eran 10–14 antes de fusionar E5). Sin Python, sin prompts y sin contratos exportados: la vista
previa usa el endpoint que E3 ya dejó. Referencias a la rama al cierre.

- **Ruta de Next** `POST /api/plan-armado-guirnalda`
  (`src/app/api/plan-armado-guirnalda/route.ts:26` cuerpo estricto, `:63` handler):
  sesión como `/api/plan-editar`, 400 deliberado, 413, líneas con solo los
  campos del contrato (a lo sumo 256). Adaptador:
  `llamarPythonPlanArmadoGuirnalda` (`src/lib/ia/nucleo/python-adapter.ts:2613`;
  scope `plan.armado_guirnalda`, `PythonPlanArmadoGuirnaldaLineaSchema` `:1410`,
  respuesta `plan-armado-guirnalda-result.v1` `:1603`, eco del armado dado
  comparado sin orden de claves) y `vistaPreviaArmadoGuirnaldaPython`
  (`src/lib/plan/edicion-python.ts:408`, plazo `EDICION_PYTHON_DEADLINE_MS`,
  rechazos `:186`). Las opciones que Python admite viven en un módulo sin
  dependencias de servidor, `src/lib/plan/opciones-armado-guirnalda.ts:18`, que
  leen el adaptador y el navegador. Cliente: `pedirVistaArmadoGuirnalda`
  (`src/lib/plan/peticion-armado-guirnalda.ts:61`), con los errores de la vista
  del bouquet (`FalloPlanArmado`; `publicar` quedó exportado en
  `peticion-armado.ts`).
- **Bloque** `BloqueGuirnalda` (`src/components/plan/guirnalda/BloqueGuirnalda.tsx:44`):
  soporte (y anfitriona), forma con caída y anclajes, largo y cuerda, racimo,
  relleno, remates, leyenda de códigos, insumos no cotizados, duración marcada
  "estimado", avisos. Montado en `DetalleEstructura.tsx:411` (misma posición del
  árbol que el del bouquet) desde `TarjetaPlanDecoracion.tsx:1300`, solo con
  `armados_guirnalda` (`:353`).
- **Gráfica** `GraficaGuirnalda` (`GraficaGuirnalda.tsx:78`) sobre
  `dibujarGuirnalda` (`geometria-guirnalda.ts:224`): los racimos de
  `armados_guirnalda[].racimos` con la geometría pseudo-3D del patrón,
  repartidos sobre `curvaGuirnalda` (`src/components/plan/patron/geometria-dibujo.ts:196`,
  que `curvaDe` usa solo con armado, `:236`); relleno y sueltos en los huecos,
  remates junto a su racimo, números de racimo por fuera de la curva, soporte
  (pared, cuerda y anclajes, piso con pesas, mesa, pieza anfitriona). Figura con
  texto alternativo y `<ol>` de racimos en orden de lectura; en el editor, cada
  racimo es un destino (grupo con foco itinerante y zona para soltar). Con patrón
  y armado, el bloque del patrón y la tira del resumen dibujan los racimos del
  armado (`patronSobreArmado`, `geometria-guirnalda.ts:99`;
  `TarjetaPlanDecoracion.tsx:381`), por pedido del orquestador tras E5.
- **Editor** `EditorGuirnalda` (`EditorGuirnalda.tsx:80`) y `ControlesGuirnalda`
  (`ControlesGuirnalda.tsx:116`): soporte, anfitriona, forma, caída (deslizador
  que confirma al soltar), anclajes, unidad y tamaño del racimo, relleno y
  remates (agregar, quitar, color, posición; arrastre con puntero o "Mover" +
  flechas + Enter, Escape cancela y el foco vuelve al remate). Deshacer y
  rehacer, autoguardado con `armado_guirnalda` (`TarjetaPlanDecoracion.tsx:833`),
  aviso cuando el armado cambia la compra (con los números de Python). Estados
  explícitos de la vista previa en `crearVistaGuirnalda` y
  `panelVistaGuirnalda` (`vista-guirnalda.ts:82`, `:237`): cargando, vacío
  (Python no puede armar la receta), error con Reintentar, listo con
  "actualizando" y fallo del último borrador; gana el último borrador, se
  cancela el anterior y lo ya dibujado no se vuelve a pedir.
- **Hoja única** `HojaArmadoGuirnalda` (`HojaArmadoGuirnalda.tsx:75`, diálogo
  `:236`): la del patrón y la del armado fundidas; "Hoja de armado" del bloque
  del patrón abre esta cuando hay armado (`TarjetaPlanDecoracion.tsx:1289`).
- **Edición**: "Quitar armado" no se vuelve a sugerir con la bandera
  (`resugerirArmadoGuirnalda`, `src/lib/plan/aplicar-edicion.ts:137`, usado en `:230`).
- **Pequeños cambios compartidos**: `LeyendaPatron` usa el número como clave
  (varios códigos de un armado son del mismo material); `jsonEstable` exportado
  en `bouquet/borrador-armado.ts`; `BloquePatron`/`VistaPatron` aceptan la curva
  del armado (`guirnalda`, opcional).

**Verificación real** (2026-09-28, en el worktree, sin llamadas pagas):

- `npx tsc --noEmit`: solo el TS2304 `LayoutProps` preexistente de
  `src/app/layout.tsx`. `npm run -s lint`: 0 errores (25 avisos preexistentes,
  ninguno en archivos de E6). `npm run -s contracts:check`: sin deriva (no se
  tocó ningún contrato exportado). `npm run plan:test`: completo en 0 (441 s),
  con las dos pruebas nuevas dentro.
- `plan:test-armado-guirnalda-ruta` (`scripts/test/test-plan-armado-guirnalda-ruta.ts`,
  7 bloques): petición a Python (scope, plazo, campos de cada línea), cuerpo
  estricto con 400 sin llamar a Python, respuesta validada (otra pieza, otro
  armado, opciones fuera del contrato → 502), `armado_invalido` con motivo y
  frase, Python caído (502 `PYTHON_UNAVAILABLE` sin detalles internos),
  sesión, acción `armado_guirnalda` y "Quitar armado" sin re-sugerir.
- `ui:test-armado-guirnalda` (`scripts/test/test-ui-armado-guirnalda.ts`, 10
  casos, salidas reales de Python en `scripts/fixtures/guirnalda-ui/vistas-guirnalda.json`):
  sin armado la tarjeta sale byte a byte igual (huella sha256 de 27528f2,
  editable y de lectura); bloque con armado; las cinco formas (recta plana,
  arco caído de 3 anclajes con 0,4 m a escala, U invertida de 1,2 m a escala,
  ondulada, curva; caída de muestra avisada); cada globo de Python dibujado una
  vez; con patrón, los racimos del armado y no la rejilla; accesibilidad
  (figura, `<ol>` en orden, destinos con un solo Tab stop); controles; borrador;
  hoja única; vista previa (cargando, vacío, error, rechazo, concurrencia,
  Python caído) y la petición del navegador.
- No se tocó Python: no aplica pytest, ruff ni mypy.

**Pendientes**:

- Verificación visual en el navegador: queda para el usuario (la app exige
  login y `next dev` no corre en este worktree con la junction). Se revisó la
  gráfica rasterizada (SVG → PNG con `sharp`) de las cinco formas reales.
- El contrato no deja fijar un remate junto a un racimo cualquiera (solo
  `extremo_izq`, `extremo_der`, `centro`, `cada_n`): soltar en otro racimo lo
  reparte a lo largo. Si el negocio lo pide, haría falta `posicion: "racimo"`
  con su número en `armado-guirnalda.v1`.
- Las opciones de Python no dicen qué formas admite cada soporte: el editor
  ofrece las cinco y Python rechaza con su frase (se deshace). Un
  `opciones.formas` lo evitaría.
- Sin armado no hay invitación a crearlo (pedido: la tarjeta sin armado queda
  igual); tras "Quitar armado" se vuelve con "Deshacer" o al confirmar otra vez.
- El editor del patrón de una guirnalda con armado sigue pintando la rejilla
  completa del patrón; con E5, los racimos del armado son la fila `i` de
  `filas_de_racimos`. **Revisado al fusionar E5 (queda pendiente):** el
  editor dibuja el borrador desde la vista previa del patrón
  (`plan-patron-result.v1`, la rejilla entera) y sus globos pintados a mano se
  ubican por fila y columna de esa rejilla, mientras `filas_de_racimos`
  devuelve `None` con pintados. Dibujar los racimos exige que Python devuelva
  `filas_de_racimos` del borrador en la vista previa del patrón y decidir cómo
  se pinta a mano sobre un racimo: no es un cambio acotado. El bloque del
  patrón, la tira del resumen y la hoja sí dibujan los racimos del armado.
- La huella de la tarjeta sin armado
  (`scripts/fixtures/guirnalda-ui/tarjeta-sin-armado.json`) se tomó con el código
  de 27528f2: si otra entrega cambia la tarjeta a propósito, se vuelve a tomar a
  mano desde un commit sin E6 con esa entrega fusionada. **Comprobada tras
  fusionar el arreglo del 11 ("unos N globos"):** la prueba pasa con la huella
  de 27528f2 sin tocarla; el plan de la huella
  (`scripts/fixtures/patron-color-ui/plan-con-patrones.json`) no lleva kits de
  globos, así que el cambio no lo alcanza.

**Fusiones del 2026-09-28 sobre `feat/guirnaldas`:** conteo con el arreglo del 11
(`1ca3306`): solo `package.json` y `generated_models.py` en conflicto; E6
(`b313970`): `python-adapter.ts` (importaciones de las dos ramas),
`package.json`, ADR-0032 (las decisiones de E6 pasan de 10–14 a 21–25) y este
documento.

### Revisión adversaria, UI del armado (rama `fix/rev-ui`, 2026-09-28)

Hallazgos 18–23. Cada uno tiene su prueba de regresión en `ui:test-armado-guirnalda`
(§10 `probarRevision`), que falla sin el arreglo.

- **18** (`6d61674`, arreglado): mostrar otro borrador cancela la petición en vuelo del
  anterior aunque el nuevo espere su pausa (`vista-guirnalda.ts`, `programar`). Antes, un
  rechazo tardío del viejo deshacía el nuevo.
- **19** (`cc3f9f4`, arreglado): `alBorrador` deriva el estado del borrador de ese render
  (pendiente si el controlador todavía no lo conoce) y lo usa `useVistaGuirnalda`. Antes, el
  «listo» del borrador anterior validaba el nuevo y el autoguardado lo guardaba sin que Python
  lo dibujara.
- **20** (`27a09a5`, arreglado): `conSoporte` y `conForma` quitan `puntos_de_anclaje` cuando
  la guirnalda deja de ir colgada o en arco caído, que es cuando se oculta su control. Queda
  abierto un caso: un armado que llegue de la foto (E4) en pared, recta y con anclajes sigue
  sin control para ellos.
- **21** (`9f997b0`, arreglado): una receta que Python rechaza o que no llega ya no se tapa
  con el armado recién quitado. El panel pasa a «vacío» o a «error» con Reintentar, y los
  controles dicen por qué no hay armado (antes quedaba un esqueleto de carga).
- **22** (`e82bad8`, arreglado): `cerrar()` deja el controlador sin borrador. Así el segundo
  montaje de StrictMode y Fast Refresh vuelven a pedir la vista previa y las opciones.
- **23** (`db46513`, arreglada solo la parte de UI): mientras el deslizador de confeti dibuja
  en vivo, el bloque del patrón ya no pone la rejilla completa sobre la curva del armado.
  **Pendiente en Python** (fuera de esta rama): `vista_previa_de_estructura` y
  `_vista_previa_reparto` (`plan_edicion.py`) deben devolver `filas_de_racimos` con los
  racimos del armado de una guirnalda armada. Con eso, el bloque puede volver a dibujar el
  vivo sobre la curva. La tira del resumen (`MiniPatron`) muestra a lo sumo 12 racimos y
  sigue tomando las filas de la rejilla en vivo.

### Revisión adversaria, frontera TS y prompts (2026-09-28, rama `fix/rev-ts` desde `ef6e3aa`)

Una línea por hallazgo de `hallazgos.json`; cada uno con su prueba, que fallaba antes y pasa después.

- **12** (`7b69dfb`): `refinarPlacementGuirnalda` ya no devuelve `recorrido_suelo` ni `alrededor_mobiliario`, que Plan 1.0 no admite, y la regla de pared no lleva una guirnalda a `fondo_pared` si su foto ya tiene una pieza allí. Prueba en `scripts/test/test-guirnalda-referencia.ts`; ADR-0032 §19 enmendado.
- **14** (`613e32d`): `armadoLeido` no pide "declara unidades_declaradas 0" con una lectura sin globos, ni escribe una línea vacía. Python ya no compra desde esa lectura, así que el arreglo va en el prompt. Prueba en `scripts/test/test-bouquet-referencia.ts`.
- **15** (`e8f7b08`): la guirnalda #n abraza a la anfitriona #n. Sin pareja, "one of the approved structures". Prueba con el plan real de Python `sobre-columnas-repetidas`.
- **16** (`12cbc74`): el soporte del armado decide la TABLE SUPPORT EXCEPTION en los dos sentidos; sin armado decide la ubicación, como siempre. Prueba con el plan `mesa` pasado a colgada, pared, piso y abrazada.
- **17** (`437b852`): la frase de instancia y los candados del híbrido nombran solo el relleno, los remates, el remate y los números que el armado resuelto tiene. Con todas las piezas, las frases son byte a byte las de antes. Pruebas en los tests de guirnalda y de bouquet.
- **32** (`91137b7`): `plan_resuelto.lecturas_guirnalda` (contrato nuevo, fuera del hash) y `lecturasGuirnaldaDeLaEdicion`: una edición que quita el armado lo re-sugiere con la foto y no con la receta. Pruebas en `tests/test_plan_guirnalda_lecturas.py` y `test-guirnalda-referencia.ts`; ADR-0032 §24 enmendado. App y `ai-api` se despliegan juntos.
- Límite anotado (fuera de los hallazgos): con el soporte cambiado en el editor y la ubicación en la mesa, el caption LoRA sigue diciendo "placed on the main table", porque el preflight exige la mesa para `sobre_mesa_principal`.

### Estado final (2026-09-28): todo integrado en `feat/guirnaldas`

`feat/guirnaldas` contiene E0 a E6 (bouquets, conteo E1 y E2 con el arreglo del
11, guirnaldas E3 a E6) y las cuatro ramas de la revisión adversaria, fusionadas
en este orden: `fix/rev-eval` (24–30), `fix/rev-ui` (18–23), `fix/rev-ts`
(12, 14–17, 32) y `fix/rev-python` (1–11, 13, 31, 33, 34). Ya no queda trabajo
en otra rama; las ramas `feat/guirnaldas-e5`, `feat/guirnaldas-e6`, `wip/conteo-e2` y
`fix/rev-*` se pueden borrar cuando el usuario quiera. Sin PR abierto. Las cuatro
banderas (`BOUQUETS_ARMADO_V1`, `GUIRNALDAS_ARMADO_V1`, `CONTEO_REFERENCIA_V1` y
`PATRONES_COLOR_V1`) siguen apagadas; con ellas apagadas, las peticiones son las de
siempre, y los 31 vectores dorados no cambian respecto de `77d0985`.

**Pendiente (técnico):**

- **23, parte de Python:** `vista_previa_de_estructura` y `_vista_previa_reparto`
  deben devolver `filas_de_racimos` de una guirnalda armada.
- **20:** un armado leído de la foto (E4), en pared, recto y con anclajes, sigue sin
  control para ellos.
- `cuentaDeLectura` (`src/lib/eval/estructuras/conteo.ts`) es una copia en TS de
  `cuenta_usable` (`services/ai-api/app/conteo_foto.py`), y ya divergen: no aplica
  el tope de 10000 globos (revisión 10) y cae a `globos_visibles` donde Python no
  usa la lectura. **Va a revisión:** o la cuenta viaja en la respuesta de Python,
  o la evaluación declara que mide la lectura y no la cuenta del plan.
- `scripts/bench/bench-fidelidad.ts` no aplica `--max-usd` a mitad de corrida, y
  `resumirCorrida` tiene la forma del hallazgo 30 (`SEGUIMIENTO-conteo.md` §3.3).
- Con el soporte cambiado en el editor y la ubicación en la mesa, el caption LoRA
  sigue diciendo "placed on the main table".
- La tarjeta no muestra `conteos_referencia`, y el supuesto "medidas asumidas"
  queda con el valor anterior cuando el conteo mueve el largo
  (`SEGUIMIENTO-conteo.md` §4).
- Verificación visual de la UI en el navegador, y `npm run build`, que no corre en
  el worktree con la junction.

**Decide el usuario:**

- **Evaluación pagada, con tope declarado:**
  - conteo: 30 fotos contadas a mano, fuera del repo;
  - lectura de guirnaldas (E7);
  - si el LoRA v007 aprendió guirnaldas por soporte.
- **Validar con el negocio los supuestos del oficio:**
  - ADR-0031: ±15 %, ventana de ±35 %, alturas de referencia, umbral de mezcla,
    un estimado nunca baja un kit;
  - ADR-0032: unidad por densidad, relleno de 5", remates, soporte, insumos,
    `factorPerfil`;
  - la compra por color sobre la rejilla o sobre los racimos.
- **Contrato:** si hace falta `posicion: "racimo"` en los remates y
  `opciones.formas` por soporte.
- **Salida:**
  - abrir el PR de `feat/guirnaldas` a `main`;
  - encender las banderas, primero las `*_PYTHON_ENABLED` y después las `*_V1`;
  - desplegar app y `ai-api` juntos (`lecturas_guirnalda` y `medidas_del_cliente`
    son campos nuevos de los dos lados).

### El armado no llegaba bien a la imagen (2026-09-28, rama `fix/armado-en-imagen`)

**Qué vio el usuario.** Referencia: guirnalda orgánica en pared sobre flecos,
rosado y rojo con racimos dorados. Plan: guirnalda en pared, recta, espiral de
cuartetos rosado, naranja, rosado y dorado, 12 racimos, mezcla 5/9/12/18/24".
La imagen "Generada con LoRA Sempertex" salió en diagonal y con **cintas
retorcidas rosado y naranja cruzando la pieza**; no se veían cuartetos.

**Por dónde salió (con evidencia, sin gastar).** `plan_audit_log`, solo
lectura, generación de las 19:27 UTC (la fusión `94ad16b` es de las 17:49 UTC):
`motor_imagen_previsto = fal` (no `fal+gemini`: sin foto del espacio no hay
etapa híbrida), `preflightOk: true`, `captionLongitud: 655`. En `.env.local`,
`NEXT_PUBLIC_LORA_MODE=training_2`, el slot de `lora-run-v007-1000`, trigger
`eventdecor_style_v3` (dialecto `product_v007`). Sin venue, `/edit` no se usa:
la referencia solo viaja como texto (`referenciasParaLoraEdit`).

**Reproducción.** Plan equivalente resuelto con `resolve_plan` (el código del
endpoint): rosado, naranja y dorado, 3,5 m, receta al confirmar y espiral
`[0, 1, 0, 2]` del decorador → 12 racimos, 4 remates. Con él se armaron los
prompts de `/api/generate` en los tres modos (`frasesDeEstructuras`,
`buildImagePrompt`, `compileProductPrompt` con productos reales del
vocabulario v007, `ensureLoraTriggers`, `promptPresentacionLora`,
`preflightLoraPrompt` y `buildLoraEditPrompt`). Respuestas:

1. **¿Llega la frase del armado?** Sí, en todos: Gemini (línea de color y
   `color_pattern`), caption LoRA v007 y v004, solo texto y en el presupuesto
   del híbrido, y el prompt que recibe fal.
2. **¿La compactación o el preflight la recortan?** No. Ningún paso de la
   compactación toca el patrón: v007 llegó al paso 2 y lo conservó (682/750;
   híbrido 743/750). El preflight exige la frase literal, y el `preflightOk:
   true` del registro confirma que salió entera.
3. **¿Corre la etapa híbrida?** No en este camino (sin foto del espacio). Donde
   corre, lleva el candado de la guirnalda (`conArmadoGuirnaldaEnCaption`).
4. **¿"spiral" dibuja cintas?** Sí, esa es la causa. El caption decía
   "…accent balloons, **wrapped in a spiral of pink, orange and gold stripes
   winding along its length** installed against the rear wall": una pieza
   envuelta en franjas, justo lo que se dibujó y en los mismos colores. En
   Gemini, "continuous diagonal spiral stripes winding along its length" y
   "Keep the clusters tight and twisted against each other".
5. **¿El caption dice "garland"?** Sí, con el sustantivo del corpus: "an
   organic balloon garland round latex balloons in …" (v007) y "an organic
   balloon garland of … balloons" (v004). La frase del armado es un modificador
   detrás de los materiales (decisión 11).
6. **¿`planResuelto` trae `armados_guirnalda`?** Sí. La ruta re-resuelve
   `body.plan.plan`, que lleva `armado_guirnalda` firmado en el `plan_hash`
   (`resolverPlan`), y `planResueltoDesdePython` los conserva.

**Causa probada:** la redacción, no el transporte.

**Arreglo** (decisión 26 de ADR-0032):

| Commit | Qué |
|---|---|
| `888ee7f` | Candado de la etapa 2: la guirnalda es solo de globos; descarta cintas, serpentinas o bandas de la imagen LoRA |
| `c805a19` | Python: espiral y anillos de una guirnalda armada como racimos de globos; el armado sin "twisted"; fixtures y pruebas |
| `a316cfb` | `scripts/ops/generar-guirnalda-espiral.ts` (vista previa por defecto; no se corrió con gasto) |

Caption LoRA v007 del caso, tramo de la guirnalda:

- Antes: "…mounted flat against the wall in clusters of four with small pink,
  orange and gold filler balloons and large pink, orange and gold accent
  balloons, wrapped in a spiral of pink, orange and gold stripes winding along
  its length installed against the rear wall…" (682/750).
- Después: "…accent balloons, every cluster holding two pink, one orange and
  one gold balloon installed against the rear wall…" (668/750; híbrido 729/750).

Gemini, frase del patrón:

- Antes: "COLOR PATTERN — build it from identical four-balloon clusters (pink,
  orange, pink, gold around each cluster) rotated one eighth of a turn per layer
  so the colors form continuous diagonal spiral stripes winding along its
  length; …"
- Después: "COLOR PATTERN — every four-balloon cluster is the same: two pink, one
  orange and one gold round latex balloons, in the order pink, orange, pink,
  gold around the cluster. The clusters repeat one after another along its
  length, each one turned a little further in the same direction, so the colors
  trace a soft spiral through the balloons. The pattern comes only from the
  balloons' own colors; …"
- El armado termina ahora en "…made only of round latex balloons: no ribbons,
  streamers, twisted bands or fabric."

**Qué no cambia y por qué:**

- Sin armado, las frases son byte a byte las de antes: la guirnalda clásica con
  patrón, la columna y el arco conservan "wrapped in a spiral … stripes"
  (`prompts-sin-armado.json` intacta). En una columna esas franjas son el
  diseño.
- La frase LoRA del armado no cambia, ni la forma "recta", que en LoRA sigue
  sin frase (E5). La diagonal de la imagen puede venir del sesgo del LoRA y
  del "winding"; la frase de forma y desnivel es de `feat/guirnalda-caida`.
- En el caption LoRA no se añadió "no ribbons": FLUX.2 en fal no tiene prompt
  negativo y una negación en el caption nombra la cinta. Se describe en
  positivo; las exclusiones van en Gemini (frase del armado y candado).
- Bloques, degradé ("stepped ombre bands") y flores ("daisy flowers") de una
  guirnalda armada quedan igual: sin evidencia de que fallen. Se miden aparte.
- **Bouquet** (`SEGUIMIENTO-bouquets.md` §13): sus frases no usan spiral,
  stripes ni bands, y no llevan patrón. "helium ribbons" son las cintas de
  verdad de un bouquet de helio. Sin cambio.
- Aparte, del mismo registro: `tallasOmitidas` R-12, R-18 y R-24. El
  vocabulario v007 no tiene esas tallas para alguno de los productos del plan,
  así que el caption no las nombró.

**Verificación real:**

- pytest: 912 en verde, 4 omitidas sin Postgres.
- `ruff check`, `ruff format --check`, `mypy app scripts` y
  `generate_models.py --check` limpios.
- `npx tsc --noEmit`: solo el TS2304 `LayoutProps` preexistente.
- `npm run -s lint`: 0 errores (25 avisos preexistentes).
- `ia:test-armado-guirnalda-prompt` en verde, con el caso nuevo
  `sinCintasEnLaImagen`, y `npm run plan:test` en 0. También pasan estos
  scripts: `ia:test-patron-color-prompt`, `ia:test-armado-bouquet-prompt`,
  `ia:test-lora-compiler`, `ia:test-lora-bilateral`, `ia:test-prompts`,
  `ia:test-lora-v004-compactacion`, `lora:test-product-runtime`,
  `plan:test-prompt` y `plan:test-armado-guirnalda`.
- No se hizo ninguna llamada paga.

**Pendiente (decide el usuario): medir con generaciones reales.** Una sola
variable, la frase del patrón, antes y después, con v007-1000 (el slot del
usuario), semillas 101, 202 y 303 y sin foto del espacio:

```
NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/ops/generar-guirnalda-espiral.ts --confirm-spend --max-usd 0.8
```

- Son 6 imágenes de 1536×1024. Costo **estimado** entre US$0,2 y US$0,4; el
  repo no declara un precio por imagen y el runner mide el gasto real contra
  el saldo.
- Con `--artifact-id v004-1000` se repite en v004.
- Lectura: ¿hay cintas o bandas? ¿Se ven racimos rosado, blanco y dorado? ¿Va
  plana contra la pared?

### Revisión adversaria (2026-09-28, rama `fix/rev-python`, sobre `ef6e3aa`)

Hallazgos de Python que tocan guirnaldas. Cada uno tiene su prueba de regresión
en `services/ai-api/tests/test_revision_guirnalda.py` o `test_revision_conteo.py`.
Los del conteo y del bouquet están en `SEGUIMIENTO-conteo.md` §3.4.

- **4** (`dfdc945`): tras editar la mezcla, el conteo cambiaba la densidad y
  el armado conservado ya no cabía (422 armado_invalido). `_aplicar_conteos`
  revisa ahora el armado de cada guirnalda ajustada: lo sugiere de nuevo o lo
  quita, con un supuesto. La sonda pasa de 11 fallos a 0 en 276 casos.
- **5** (`a85a28c`): la vista previa de una forma distinta de la U, o de la
  receta, sobre un patrón en espejo daba 422. La regla pasa a
  `patron_color.quitar_espejo_sin_u`, con un solo dueño para la edición y la
  vista previa.
- **6 = 13** (`9e39fe1`): la anfitriona de una guirnalda no podía ser un arco,
  porque los arcos viajan en `elementos`, no en `otras`. Python y el adaptador
  aceptan ahora la anfitriona de las dos listas, nunca la propia guirnalda. El
  prompt de la lectura cambia de versión (`69be1090c6526060`).
- **31** (`5e81129`): el aviso de patrón degradado de
  `_completar_armados_guirnalda` pasa por `app/supuestos.py` y ya no rompe el
  contrato con nombres largos.

### Caída y desnivel de la foto (2026-09-28, rama `feat/guirnalda-caida` desde `main` 94ad16b)

ADR-0032, decisión 27 (enmienda la 17: "la lectura no trae caída"). Se escribió como
26; al fusionar con `fix/armado-en-imagen` (que usó la 26 para la redacción por
racimos) pasó a 27.

**Pedido.** En la foto del usuario la guirnalda va en la pared, más alta a la
izquierda, y cae hacia la derecha; la gráfica del armado dibujaba doce racimos
en una joroba simétrica hacia arriba. "Si ves que la guirnalda se ve un poco
caída, soportarlo dentro de la gráfica."

**Por qué salía la joroba.** Dos causas: (1) la lectura de la guirnalda no traía
ni caída ni desnivel, así que el armado llegaba con `forma: curva` y nada más; (2)
desde E6 `curva` se dibuja como un arco suave hacia arriba
(`-0,12 · largo · sin(πt)` en `curvaGuirnalda`), porque el contrato no le da
dirección. Una curva que no cae se sigue dibujando igual (prueba byte a byte).

**Qué cambia.**

- **Lectura** (`amaterasu/estructuras/guirnalda.py`, prompt `guirnalda-referencia.v2:8d10b49acc1eda5f`):
  `caida_relativa` (0 a 0,6) y `desnivel_relativo` (−0,6 a 0,6, negativo si cae
  hacia la derecha), fracciones del largo horizontal, nunca metros; `null` si no
  se distinguen o salen de rango. Zod: `LecturaGuirnaldaSchema` (opcionales, para
  que las `lecturas_guirnalda` guardadas sigan valiendo).
- **Armado** (`armado_guirnalda.py`): `desnivel_m` opcional en
  `armado-guirnalda.v1` (−5 a 5 m), solo en pared o colgada
  (`desnivel_sin_soporte`). Esos soportes tienen un dueño en el contrato
  (`SOPORTES_CON_CAIDA_GUIRNALDA` en `armado-guirnalda.ts`, exportado como
  `x-reglas-guirnalda`). `geometria_de_lectura` pasa la lectura a metros sobre
  el largo del plan (a centímetros, desde 0,05 del largo): una recta o curva que
  cae pasa a `arco_caido` con `caida_m`; U invertida y arco caído llevan la caída;
  la ondulada no; el desnivel en cualquier forma. El largo nunca cambia por la
  caída (con o sin `medidas_del_cliente`).
- **Cuerda** (`plan._garland_cord`): la parábola entre dos extremos a distinta
  altura con la caída bajo su cuerda (`_parabola_arc`), por tramo; sin caída, la
  recta inclinada. Sin `desnivel_m`, el cálculo de antes byte a byte.
- **Conteo** (`_counted_with_read_geometry`): el conteo de la foto corre antes del
  armado; ahora cuenta la guirnalda que se va a armar con la geometría de su
  lectura, así que compara con la cuerda que se compra y `globos_despues` es lo
  que se compra.
- **Compra consistente** (`_suggest_garland_assembly`, `_with_garland_assembly`):
  un armado con caída o desnivel se vuelve a sugerir sobre la compra de su propia
  cuerda; con patrón, se sincronizan sus participaciones (punto fijo); si nada
  cabe, la lectura sin su geometría (lo de antes).
- **Gráfica** (`geometria-dibujo.ts`, `geometria-guirnalda.ts`): la forma va sobre
  la recta inclinada entre los extremos, a escala; los racimos se numeran sobre
  esa curva; los anclajes, sobre la recta. Texto alternativo, bloque y hoja:
  "cae hacia la derecha (el extremo derecho, 0,4 m más bajo)".
- **Editor** (`ControlesGuirnalda.tsx`, `borrador-guirnalda.ts`): en pared o
  colgada, interruptor "Un extremo más alto que el otro" y deslizador de −5 a
  5 m (paso 0,05; `aria-valuetext` en palabras); autoguardado y vista previa en
  Python como el resto. `conSoporte`/`conAnfitriona` quitan el desnivel fuera de
  pared o colgada. TypeScript no recalcula nada.
- **Prompts**: una sola línea nueva para Uzume, aislada en `_frase_desnivel`
  (`armado_guirnalda.py`) y añadida al final de `prompt_gemini` en
  `armado_resuelto`; `_frases_prompt` y `_frase_lora` **no se tocaron** (la rama
  `fix/armado-en-imagen` las reescribe). El paso de instalación de la hoja dice
  el desnivel en español. LoRA sin cambios.

**Archivos tocados** (para fusionar con `fix/armado-en-imagen`):
`src/lib/plan/armado-guirnalda.ts`, `src/lib/plan/estructuras-oficiales.ts`
(solo un comentario), `scripts/ops/export-domain-contract-schemas.ts`,
`contracts/chat/v1/request.schema.json`, `contracts/domain/v1/{plan-decoracion,plan-resolution-request,plan-resolution-result,plan-resuelto,reference-blueprint}.schema.json`,
`services/ai-api/app/{generated_models,armado_guirnalda,plan}.py`,
`services/ai-api/app/amaterasu/{guirnalda_referencia.py,estructuras/guirnalda.py}`,
`src/components/plan/patron/geometria-dibujo.ts`,
`src/components/plan/guirnalda/{geometria-guirnalda,leyenda-guirnalda,borrador-guirnalda}.ts`,
`src/components/plan/guirnalda/ControlesGuirnalda.tsx`, las pruebas
(`tests/test_{guirnalda_referencia,armado_guirnalda,plan_guirnalda}.py`,
`scripts/test/test-{armado-guirnalda,guirnalda-referencia,plan-armado-guirnalda-ruta,ui-armado-guirnalda}.ts`),
`scripts/fixtures/guirnalda-ui/vistas-guirnalda.json` (tres casos nuevos, los
anteriores intactos), ADR-0032 y este documento. En `armado_guirnalda.py` los
cambios están en las constantes, `_validar_forma_y_soporte`,
`geometria_de_lectura`/`_forma_desde_lectura` y `armado_resuelto` (pasos y la
línea de Gemini): ninguno dentro de `_frases_prompt`.

**Fusión con `fix/armado-en-imagen` (`main` 25833b6).** Un solo conflicto, en
ADR-0032: las dos ramas escribieron una "decisión 26". La de la redacción por
racimos (ya en `main`) se queda con la 26 y esta pasa a la 27, con sus
referencias en el ADR, este documento y los comentarios del código.
`armado_guirnalda.py` se fusionó solo: la frase nueva del armado ("packed
tightly … made only of round latex balloons") no describe el desnivel, así que
`_frase_desnivel` se queda detrás de ella. Fixtures regeneradas sobre la fusión
y comparadas campo a campo: `planes.json` (con
`scripts/fixture_armado_guirnalda_prompt.py --escribir`) y `resueltos.json`
salen idénticas a las de `main`; en `vistas-guirnalda.json` solo cambian
`prompt_gemini` de los dos casos del desnivel (la frase nueva del armado más la
del desnivel) y `prompt_lora` de los cinco casos de 27528f2, que no se habían
regenerado desde E5 (el fragmento como modificador, decisión 11). La
instantánea de los prompts sin armado no se tocó.
Verificación sobre la fusión: pytest 945 en verde (4 omitidas), 31 vectores
dorados intactos, ruff, mypy `app scripts` y `generate_models.py --check`
limpios; tsc solo con `LayoutProps`, lint 0 errores, `contracts:check` sin
deriva y `plan:test` en 0.

**Pruebas nuevas.** Python: validación y rangos de la lectura y la versión del
prompt fijada; `geometria_de_lectura` (13 casos), `desnivel_sin_soporte`, pasos
y línea de Gemini; cuerda desnivelada (y = x² de 0 a 1 = √5/2 + asinh(2)/4,
signo, límite con desnivel → 0, recta inclinada, tres anclajes); la lectura
llega al armado y a la compra con punto fijo, con patrón por racimos; conteo
más caída con medidas del cliente (el largo no se mueve, `globos_antes` es la
cuenta de la cuerda) y con largo asumido (la caída sigue al largo nuevo). Las
dos del conteo fallan sin `_counted_with_read_geometry` (comprobado). TypeScript:
contrato (`desnivel_m`, `x-reglas-guirnalda`), lectura con caída y desnivel
hasta `pistas_guirnalda`, la ruta (viaja tal cual, 400 fuera de contrato,
`desnivel_sin_soporte` con la frase de Python), la gráfica (sin NaN, extremo
derecho más bajo a escala, curva sobre la recta inclinada, arco caído con los
anclajes a distinta altura, texto alternativo, bloque, hoja, controles y
borrador) y la huella de la tarjeta sin armado, intacta.

**Verificación real** (2026-09-28, en el worktree, sin llamadas pagas):
`npx tsc --noEmit` solo con el TS2304 `LayoutProps` preexistente; `npm run -s lint`
0 errores (los 25 avisos preexistentes, ninguno en archivos tocados);
`npm run -s contracts:check` sin deriva; `npm run plan:test` en 0 (las cuatro
pruebas de guirnaldas dentro, y la instantánea de los prompts sin armado de
`ia:test-armado-guirnalda-prompt` intacta); pytest 932 en verde (4 omitidas por
falta de Postgres), `test_plan_regresion.py` 31 en verde y
`contracts/domain/v1/golden/` sin cambios; `ruff check` y `ruff format --check`
de `app scripts tests` limpios; `mypy app scripts` sin errores;
`generate_models.py --check` al día. La gráfica se revisó rasterizada (SVG → PNG
con `sharp`) en la curva desnivelada y el arco caído colgado con desnivel. No
hizo falta un `ai-api` propio: las pruebas de Python usan `TestClient`.

**Pendientes.**

- Medir la lectura de la caída y el desnivel en fotos reales (E7, con tope de
  gasto): los umbrales (0,05) y la regla "una curva que cae es un arco caído"
  son supuestos sin calibrar. La foto del usuario no se leyó contra Gemini.
- El LoRA no dice el desnivel (ni v007 ni v004 lo aprendieron): se mide en E7.
- Tras la revisión 4 (el conteo rompe un armado conservado), el re-sugerido con
  la foto puede traer una caída distinta de la del armado anterior, y la cuenta
  con que el conteo decidió era la de ese armado: caso límite, sin prueba.
- Verificación visual en el navegador: queda para el usuario.

### Curvatura con sentido (2026-09-28, rama `fix/guirnalda-curvatura` desde `main` 90da1ef)

**Qué vio el usuario.** La foto: guirnalda orgánica en la pared sobre flecos,
arqueada POR ENCIMA de la recta que une sus extremos (convexa, como un techo) y
con el extremo derecho más bajo que el izquierdo. La gráfica del patrón y la
del armado: una U colgando (alta a la izquierda, baja al centro, sube a la
derecha). El desnivel estaba bien; la curvatura, al revés. La imagen LoRA ya no
tenía cintas, pero convirtió la guirnalda en un arco rectangular con dos patas
al piso y soportes metálicos.

**Evidencia (solo lectura, sin gastar).** `plan_audit_log` de la base local,
consulta `BEGIN READ ONLY`, filas más recientes: 20:39:12 UTC
`PLAN_ESQUEMA_INVALIDO` (un `estructura_id` fuera de patrón en un turno
intermedio), 20:39:18 `APROBACION_REQUERIDA` (`EST_01_GUIRNALDA`, 68 globos,
con referencia, sin foto del espacio, `lora_mode` training_2) y 20:40:04
`IMAGEN_GENERADA` (`motor_imagen_previsto` fal, `captionLongitud` 596,
`preflightOk`). Los 68 globos son los de la captura (14 + 12 + 37 + 4 + 1).
**Ni la auditoría ni ninguna otra tabla guardan la lectura**: ninguna columna de
texto o JSON de la base contiene `caida_relativa`, y `armado_guirnalda` solo
aparece en filas `PLAN_EDITED` de otro plan (19:43, colgada en arco caído). La
salida cruda de la lectura no se puede recuperar sin volver a pagarla.

Lo que sí se deduce sin gastar: `curvaGuirnalda` solo dibuja una guirnalda
BAJO la recta entre extremos con `arco_caido` (la curva y la U invertida van
por encima), y el dibujo de la captura baja al centro con el extremo derecho
más bajo. El armado era, por tanto, un `arco_caido` con `caida_m` y `desnivel_m`
negativo (a ojo, flecha ≈ 0,2 y desnivel ≈ −0,2 del largo). Ese armado solo
sale de `geometria_de_lectura` con una `caida_relativa` desde 0,05 (una recta o
una curva que "cae" pasaba a arco caído) o con el arco caído leído tal cual. En
la foto el centro va por encima de la recta: con el prompt v2 la caída correcta
era 0. El prompt v2 no tenía cómo decir "por encima" más que ese 0 escondido en
la frase, y el nombre "caída" invitaba a reportar lo que baja el extremo
derecho.

**Dónde estaba el error.** En la semántica que se le pedía al modelo (la v2 no
tenía sentido de la curva) y en la regla "toda caída es un arco caído" de
`geometria_de_lectura`. La gráfica fue fiel al armado que recibió.

**La imagen.** La hipótesis de la palabra "arch" no se sostuvo: ninguna frase
del armado la usaba (Python, `armado-en-prompt.ts` y el candado); solo nombra la
pieza anfitriona de una guirnalda abrazada. Lo que sí pedía un arco de pie en
un caption con la guirnalda sola en la pared: la cola "natural depth, grounded
supports" (TypeScript), la forma "dipping in swags" (la U que se leyó) y nada
que dijera que los extremos quedan en el aire. Sin generaciones pagas, es una
corrección, no una medición.

**Arreglo** (decisión 28 de ADR-0032, enmienda la 27):

- Lectura `guirnalda-referencia.v3:d1c0d73bb47a41ca`: `sentido_curva`
  (`arriba`/`abajo`) y `flecha_relativa`; la v2 (`caida_relativa`) sigue
  valiendo en el contrato y se lee como antes.
- `geometria_de_lectura`: `arriba` → `curva` con `arqueo_m` (la U invertida,
  con su caída); `abajo` → `arco_caido` con `caida_m`.
- Contrato: `arqueo_m` en `armado-guirnalda.v1` y `formasConArqueo` en
  `x-reglas-guirnalda`; `arqueo_sin_curva` y `arqueo_sin_soporte`.
- Cuerda: la misma parábola reflejada (simétrica en el signo).
- Gráfica, texto alternativo, hoja y editor ("Arqueo declarado").
- Frases: "mounted flat high on the wall", la curva "bowing gently upward along
  the top", la U invertida sin "inverted U"; LoRA con la forma y el desnivel en
  palabras y "both ends free"; Gemini con la exclusión de patas y soportes.
  TypeScript: sin "grounded supports" cuando todas las piezas son guirnaldas en
  alto con armado; el candado del híbrido descarta patas y soportes.

Caption LoRA v007 del caso (guirnalda sola en la pared, espiral de cuartetos),
tramo de la guirnalda y cola:

- Antes (reconstruido con el armado deducido): "…mounted flat against the wall
  dipping in swags in clusters of four with … installed against the rear wall.
  … wide photorealistic event photograph, natural depth, grounded supports."
- Después: "…mounted flat high on the wall, higher on the left, curving along
  the top and dropping lower at the right end, both ends free, in clusters of
  four with small pink, white and gold filler balloons, every cluster holding
  two pink, one white and one gold balloon installed against the rear wall. …
  wide photorealistic event photograph, natural depth."

**Fixtures.** `planes.json` (`fixture_armado_guirnalda_prompt.py --escribir`) y
`vistas-guirnalda.json` (`vista_previa_de_armado_guirnalda`, a mano) se
regeneraron a propósito porque cambiaron las frases de Python; comparadas
campo a campo, solo cambian `prompt_gemini` y `prompt_lora`. Cada una suma el
caso de la foto (`pared-arqueada-desnivel`, `pared_curva_arqueo_desnivel`).
Los planes `*-sin-armado` y la instantánea de los prompts sin armado no
cambiaron. Las expectativas de frases con armado se editaron a mano en las
pruebas.

**Verificación real** (2026-09-28, en el worktree, sin llamadas pagas):
`npx tsc --noEmit` limpio (el `LayoutProps` de antes era falta de
`next typegen` en el worktree); `npm run -s lint` 0 errores (los 25 avisos
preexistentes, ninguno en archivos tocados); `npm run -s contracts:check` sin
deriva; `npm run plan:test` en 0 (con la instantánea de los prompts sin armado
intacta); pytest 969 en verde (4 omitidas por falta de Postgres),
`test_plan_regresion.py` 31 en verde y `contracts/domain/v1/golden/` sin
cambios; `ruff check` y `ruff format --check` de `app scripts tests` limpios;
`mypy app scripts` sin errores; `generate_models.py --check` al día. La gráfica
del caso de la foto se revisó rasterizada (SVG → PNG con `sharp`): alta a la
izquierda, arqueada por arriba y cayendo a la derecha.

**Pendientes.**

- E7, con tope de gasto: ¿Gemini lee bien el sentido en fotos reales? ¿El LoRA
  sigue "higher on the left, curving along the top…" sin inventar patas? Los
  umbrales (0,05) siguen sin calibrar.
- El prompt de Gemini conserva instrucciones genéricas que nombran "arch" y
  "floor contact" para cualquier estructura de globos (`build-image-prompt.ts`);
  no se tocaron porque no llevan armado y cambiarían la instantánea sin armado.
  La línea de Python ("no stands, no legs…") las contradice explícitamente.
- `armado-en-prompt.ts` sigue redactando soporte y forma en el INSTANCE
  CONTRACT (un segundo dueño de la forma, de E5): la curva sigue siendo "a
  gentle curve" y la U invertida "an inverted U" ahí. Migrar esas frases a
  Python queda fuera de este arreglo.
- Verificación visual en el navegador y una generación real: quedan para el
  usuario.

### Guía de estructura para la imagen (2026-09-28, rama `feat/guia-estructura`, ADR-0033)

Detrás de `GUIA_ESTRUCTURA_V1` (apagada): sin foto del espacio y con una sola
guirnalda con armado (o un arco, columna o semiarco con patrón), el LoRA va a
`/edit` con el mapa de color plano de la pieza (la geometría de la gráfica) y su
carta muda; de paso, `REFERENCIA_EN_ETAPA1_V1` por fin llega a fal. Sin gasto:
la corrida comparativa (`scripts/ops/generar-guia-estructura.ts`, 12 imágenes,
US$ 0,693 estimados) queda para el usuario.

### El modelo ubica puntos y Python calcula la curva (2026-09-28, rama `fix/guirnalda-puntos` desde `main` f4ae25c)

ADR-0032, decisión 29.

**Defecto probado con una llamada real.** La foto del usuario, recortada a la
foto (270 × 480 px): guirnalda en la pared que va casi horizontal por lo alto,
más alta a la izquierda, con el centro por encima de la recta entre sus
extremos y el extremo derecho más bajo. Lectura v3
(`guirnalda-referencia.v3:d1c0d73bb47a41ca`):

```
"forma": "curva", "sentido_curva": "abajo", "flecha_relativa": 0.15,
"desnivel_relativo": -0.2, "confianza": 0.95
```

El desnivel, bien; el sentido, al revés. `_forma_desde_lectura` lo volvió
`arco_caido` y la gráfica dibujó una U. El prompt v3 ya explicaba el sentido
contra la recta inclinada y traía este mismo caso como ejemplo: el modelo
responde mal la pregunta abstracta, no le falta información.

**Por qué puntos.** Ubicar un punto en la imagen es lo que un modelo de visión
hace bien; comparar una altura con una recta inclinada imaginaria, no. La v4
pide la línea central como tres puntos `{x, y}` en fracciones de toda la
imagen (extremo izquierdo, punto medio a mitad del recorrido horizontal,
extremo derecho) y `geometria_linea_central` calcula sentido, flecha y
desnivel con el aspecto real de la foto (su cabecera; `tamano_imagen.py`). La
salida de la lectura y el contrato no cambian.

**Lectura v4 (`guirnalda-referencia.v4:d4b1aa13cddf1478`), la misma foto, una
llamada.** Salida cruda del modelo (lo relevante):

```
"soporte": "pared", "forma": "curva", "puntos_de_anclaje": 3,
"linea_central": {"extremo_izquierdo": {"x": 0.08, "y": 0.28},
                  "punto_medio": {"x": 0.51, "y": 0.31},
                  "extremo_derecho": {"x": 0.93, "y": 0.44}},
"racimos_visibles": 12, "unidad_racimo": "cuarteto", "confianza": 0.92
```

Validada por Python: `"sentido_curva": "arriba"`, `"flecha_relativa": 0.107`,
`"desnivel_relativo": -0.335`. A mano: en píxeles los extremos quedan en
(21,6; 134,4) y (251,1; 211,2), largo 229,5; la recta pasa por y = 173,3 en
x = 137,7 y el punto medio va en y = 148,8, 24,5 px por ENCIMA (0,107 del
largo); el extremo derecho está 76,8 px más abajo (−0,335). El desnivel es
mayor que el −0,2 de la v3 porque ahora cuenta el aspecto vertical de la foto
en vez de una estimación a ojo. Uso: 2.208 tokens de entrada y 170 de salida
(costo estimado muy por debajo del tope de US$ 0,05). No hizo falta la
segunda llamada.

**Pruebas deterministas** (`test_guirnalda_referencia.py`,
`test_tamano_imagen.py`): el caso de la foto da `arriba` y desnivel negativo;
una U colgada da `abajo`, también con la recta inclinada; una recta (y una
flecha menor que 0,03) da flecha 0 sin sentido; los mismos puntos en una foto
cuadrada, vertical y apaisada dan pendientes distintas; puntos ausentes,
fuera de 0..1, no numéricos, extremos al revés o casi juntos, punto medio
fuera de la mitad central o sin tamaño de foto dan `null`; lo que el modelo
diga por su cuenta de sentido, flecha o desnivel se ignora; las lecturas v2 y
v3 guardadas siguen cumpliendo el contrato; la ruta usa el tamaño de la foto
recibida; cabeceras PNG, JPEG (con relleno y SOF progresivo) y las tres WebP.

**Verificación.** `pytest` completo, `ruff check` y `ruff format --check` de
`app scripts tests`, `mypy app scripts`, `generate_models.py --check` y
`npm run -s contracts:check`. Sin cambios de TypeScript.

**Pendientes.**

- Una sola foto no calibra nada: medir en E7, con tope, sobre varias fotos
  (colgadas en U, U invertidas, rectas) si los puntos salen bien y si los
  umbrales (0,03 de flecha, mitad central del recorrido) sirven.
- Desplegar `ai-api` para que la app use la v4; la app no cambia.
