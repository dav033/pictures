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
- E4: lectura de la guirnalda en la foto y `placementFor`; hoy la bandera solo
  completa por receta. E5: frases en Uzume/Kagutsuchi, patrón por racimo y
  espejo. E6: UI y la ruta de Next de la vista previa (Python ya responde en
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

### E6 — UI del armado de la guirnalda (hecha el 2026-09-28, rama `feat/guirnaldas-e6`)

Parte de `feat/guirnaldas` 27528f2 (sin E4 ni E5). Decisiones 10–14 en ADR-0032
("Entrega E6"). Sin Python, sin prompts y sin contratos exportados: la vista
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
  `filas_de_racimos`. Revisar al fusionar E5.
- La huella de la tarjeta sin armado
  (`scripts/fixtures/guirnalda-ui/tarjeta-sin-armado.json`) se tomó con el código
  de 27528f2: si otra entrega cambia la tarjeta a propósito, se vuelve a tomar a
  mano desde un commit sin E6 con esa entrega fusionada.

### Estado de las ramas (2026-09-28, todas subidas a `origin`, sin PR abierto)

| Rama | Contenido | Estado |
|---|---|---|
| `feat/bouquets` | E0 (armado ↔ fal.ai), código R-12 y SKU en la tarjeta | hecha; PR #2 ya estaba fusionado, lo nuevo necesita otro PR |
| `feat/conteo-referencia` | E1 (lectura de conteo, bandera OFF) | hecha |
| `wip/conteo-e2` | E2 a medias | no pasa `contracts:check`; ver `SEGUIMIENTO-conteo.md` §3 |
| `feat/guirnaldas` | E3 (armado de guirnalda, bandera OFF) | hecha; faltan E4–E6 |

Ninguna rama incluye a las otras todavía; E4 en adelante debe partir de
`feat/guirnaldas` con `feat/bouquets` y `feat/conteo-referencia` fusionadas.
