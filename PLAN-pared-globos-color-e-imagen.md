# Plan: la pared de globos, su color y su imagen

**Documento vivo.** Se escribe mientras la investigación corre; cada tanda se
actualiza al cerrar un rastreador. La cabecera dice siempre en qué estado está.

- **Abierto**: 2026-09-30.
- **Caso**: pared "Mr & Mrs" — blush perlado dominante, dorado cromado en cuatro
  zonas, blanco perlado mezclado, flores blancas, borde superior e izquierdo roto.
- **Síntomas del usuario**: (1) qué color hay y en qué proporción, (2) dónde va
  cada color, (3) **la imagen, que es lo peor**.
- **Antecedente**: `SEGUIMIENTO-pared-organica.md` (2026-09-29, siete causas ya
  arregladas). Este plan **no** repite nada de aquello; empieza donde aquello
  terminó.
- **Gasto de la investigación hasta ahora**: US$ 0,00. Todo local y determinista.

## Estado de la investigación

| Rastreador | Estado |
|---|---|
| patrón / zonas | cerrado |
| búsqueda RAG | cerrado |
| caption del LoRA | cerrado |
| lectura de la foto | cerrado |
| color → catálogo | cerrado |
| silueta y tamaños | cerrado |
| frontera y contrato | cerrado |
| el LoRA como modelo | cerrado |
| verificación adversaria | parcial — falta la del caption |

Los hallazgos marcados **(sin verificar)** todavía no pasaron las tres lentes.
Los marcados **(verificado a mano)** los comprobé yo leyendo el código.
Los marcados **(3/3)** o **(2/3)** pasaron la verificación adversaria con ese voto.

---

## ✅ Medido con dinero real: la guía es decisiva

**2026-09-30, corrida pagada.** 6 imágenes en fal con el LoRA **aprobado**
(`v004-1000`, `eventdecor_style_v2`), 3 semillas, dos brazos —sin guía y con
guía— sobre la guirnalda en pared. **Gasto real US$ 0,252** (tope 0,35; saldo
41,231 → 40,979). Salidas fuera del repo, en
`<tmp>/demo-decoracion-eval/guia-estructura-v004-1000/`.

| brazo | qué dibuja el LoRA |
|---|---|
| **sin guía** | un **arco completo apoyado en el suelo**, con patas, cruzando un vano |
| **con guía** | la **guirnalda montada en la pared**, siguiendo la forma del croquis, sin patas |

Es el mismo fallo que el repo ya tenía documentado —*"una guirnalda de pared
salió como un arco rectangular sobre patas metálicas"*— y **la guía lo corrige**.

Cuidado con las métricas: el IoU no lo capta (sin 0,60 · con 0,58) porque compara
siluetas alineadas y las dos son manchas alargadas parecidas. Lo que cambia es
**semántico**: patas contra pared, suelo contra montada. El encuadre sí mejora
(0,42 → 0,48). **No leer esta corrida por el IoU.**

Consecuencia: el trabajo de croquis y el de hacerlos llegar valen los dos, y el
canal estaba cerrado **para todas las piezas**, no solo para la pared.

---

## Alcance decidido (2026-09-30)

**El LoRA se queda como está.** No se cambia de versión, no se reentrena, no se
reevalúa v007. El objetivo es que **la distribución de colores esté bien**.

Eso es compatible: **D1 no toca el LoRA**. La guía de estructura es un PNG que
entra por `/edit` con maquinaria existente y la bandera ya encendida; hoy está
apagada para paredes por dos condiciones en un `if`. Es el único canal que puede
llevar la posición a la imagen (ver D2), y no depende del modelo.

### Estado de la implementación

| | qué | verificación | estado |
|---|---|---|---|
| **B1** | la frontera conoce `zonas`, derivada del contrato | 3/3 | **hecho** |
| **B2** | `patronDePista` copia las manchas | 2/3 (latente) | **hecho** |
| **B4** | la prueba del cable, roja sin cada arreglo | — | **hecho** |
| **D1** | la guía de estructura acepta paredes | 3/3 | **hecho** |
| **B5** | el fondo puede ser una mezcla | decisión | pendiente |
| **B3** | reescalar la extensión contra la participación | 3/3 | pendiente |
| **E** | degradar en vez de descartar | decisión | pendiente |
| **A2** | el dominante primero en el caption | 3/3 | pendiente |
| **C3-C5** | que los colores lleguen a la búsqueda | 3 viven / 3 caen | por triar |
| **B6** | las manchas solo viajan con el modo que las admite | producción | **hecho** |
| **F1** | Python dice QUÉ campo rechazó, sin valores | — | **hecho** |

### B6 — la primera mina del cable recién abierto

Al destapar `zonas`, la app se cayó en producción local con
`SERVICIO_NO_DISPONIBLE`. El log de F1 lo dijo en una línea:

```
pistas_patron.0.modo: literal_error
pistas_patron.0.zonas: extra_forbidden
```

Los modelos de la petición de plan son **por modo**: el de `zonas` exige ese
literal y **los demás prohíben el campo**. El lector de la foto adjunta las
manchas para *cualquier* modo, así que una pista `aleatorio` con manchas no
encaja en ninguna variante y Python rechaza **la petición entera**.

Llevaba ahí desde siempre y era inalcanzable, porque la frontera tiraba la
respuesta antes. Arreglado en `patronDePista` con una condición, más una prueba
de regresión (14 casos).

**Raíz aún abierta**: `patron_referencia.py` no debería adjuntar `zonas` a un
modo que no las admite, y `PistaPatronSchema` (el contrato) es **más laxo que los
modelos de la petición de plan**. Esa inconsistencia es la que permitió el fallo,
y es de la clase que puede repetirse en otros campos.

**La lección**: el cable llevaba roto desde que nació el modo, así que **todo lo
que hay aguas abajo nunca ha visto estos datos**. Cada etapa es una mina
potencial.

### F1 — un rechazo de contrato era indiagnosticable

`services/ai-api/app/main.py`, `_parse_model` hacía `del error` y levantaba
`invalid_request` a secas. El operador se quedaba sin nada: un plan rechazado el
2026-09-30 costó una hora de adivinar **qué campo** rechazó el contrato. Ahora se
registra la **ruta del campo y la regla** que falló, nunca los valores (el cuerpo
lleva datos del cliente y un mensaje de Pydantic cita el valor). El cliente sigue
recibiendo `invalid_request`.

Verificado: `ruff` y `mypy` limpios, **1180 pruebas de Python en verde**.

### ✗ Caídos en la verificación — NO implementar

- **C1** (`metal` no cumple `reflex`) — **refutado 3/3**. Los pasos 1-4 son
  ciertos, pero el daño no. Comprobado también a mano contra el catálogo:
  **`GLOBO LATEX REDONDO REFLEX DORADO` existe y está disponible**, así que es
  falso que el único cromado dorado sea el `METAL`. Un veredicto añade que el
  arreglo propuesto sería **contraproducente**.
- **C2** (un producto sirve al dorado y al rosado) — **refutado 3/3**. El
  rastreador leyó **la tabla equivocada**: `data/demo.sqlite` la escribe el
  ingest legado y **el plan no la lee** — busca contra Postgres
  `catalog_products.derived`, donde ese producto tiene `dorado rosa`, no
  `dorado` + `rosado`.
- **A7** (la frase de tamaños suprimida con patrón) — **refutado 2/3**: hoy es
  un no-op en el dialecto que corre, y hay un veto aguas abajo que el hallazgo
  no miró. Lo había recomendado; se cae.
- **A1** (el sustantivo de la pared) — una lente lo refuta porque la línea vive
  en una rama de dialecto que **no se ejecuta con el LoRA que genera hoy**.
  Fuera de alcance igualmente.
- **`MEASURED_COLOR_DOMINANCE_V1`** — refutado como causa actual (la bandera
  está apagada y no figura en ningún entorno). **Sigue siendo una trampa armada**
  para el día que se encienda: el aviso se mantiene.

### Fuera del alcance por ahora

A1 (sustantivo), A4, A5, A7 (tamaños), elección de LoRA, reentrenamiento y
aspecto. Todo eso es **forma**, no distribución de color. Queda escrito para
cuando toque.

> Excepción barata: el arreglo de las banderas muertas del runner (tres líneas,
> gratis) conviene hacerlo igual, para que la medición esté lista el día que se
> quiera.

### Las tres decisiones de oficio, resueltas

1. **¿Quién decide cuántos globos por color?** → **La participación decide
   *cuánto*; la extensión decide el reparto *relativo* entre las manchas de un
   mismo color.** El usuario dejó la decisión abierta y se toma con este
   argumento: hoy las dos cifras son estimaciones (la participación la escribe el
   modelo del chat leyendo una frase; la extensión, el lector de patrón por
   mancha), así que no es "cuál mide mejor" sino **cuál es la dueña**. La
   participación ya manda sobre globos, precio y `plan_hash`; que la extensión la
   sobrescriba en silencio crea un segundo dueño del mismo número. Además, cuatro
   manchas al 20 % suman 80 % para un color que la foto muestra al 25 %: la
   extensión por mancha no cuadra sola.
2. **Un color que la foto muestra mezclado** (el blanco perlado dentro del blush)
   → **entra en la mezcla del fondo**, salpicado entre el dominante. Ni zona
   propia ni bandas.
3. **Un color sin material en el plan** → **degradar**: se descarta ese color o
   esa mancha, el resto del patrón sobrevive, y el motivo se registra en `avisos`.

---

## ⚠ Contexto: no estás mirando el LoRA que produciría producción

`.env.local` líneas 37-38:

```
LORA_ALLOW_REJECTED_FOR_TESTING=true
NEXT_PUBLIC_LORA_MODE=training_2
```

`training_2` es el slot de **`lora-run-v007-1000`, que está `rejected`**
(LORAGEMINI.MD §tabla de slots). Solo es seleccionable por el override de
desarrollo: en producción ese mismo slot daría `failed`. **Las imágenes que estás
juzgando no son las que saldrían desplegadas.**

Y arrastra el dialecto: `eventdecor_style_v3` → **`product_v007`**, no
`scene_v004`. Parte del análisis de la tanda A se hizo sobre `scene_v004`; hay que
separar qué hallazgo aplica a cuál (anotado en cada uno).

### Cuántas paredes vio cada LoRA

Conteo propio sobre los captions de entrenamiento del repo:

| | **v004-154** *(approved)* | **v007-336** *(rejected)* |
|---|---|---|
| `balloon wall`, cualquier forma | **9 / 154** | **42 / 336** |
| `organic` + `wall`, mismo caption | **2 / 154** | **30 / 336** |
| `asymmetric*` + `wall` | 0 / 154 | 2 / 336 |
| `arch` | 43 / 154 | 85 / 336 |
| `backdrop` + `panel` | **82 / 154** | 101 / 336 |

El aprobado vio **dos** paredes orgánicas y 82 backdrops/paneles: la prior de
"superficie plana trasera" es **nueve veces más fuerte** que la de "pared de
globos". Eso no lo arregla una redacción.

**Matiz del rastreador, contando sobre los corpus completos** (154 de v004 en
`data/staging/recaption-v004/nuevo`, 345 de v007 en `data/staging/lora-v007/captions`):
el LoRA **sí vio paredes de globos — pero todas cerradas y geométricas**:
rectangular, grid, square, full, heart-shaped, y una literalmente llamada
`dense balloon wall panel`. Lo que no vio nunca es una **orgánica o asimétrica**.
Y el análisis de composición del propio repo lo remata: `backdrop panel` aparece
en 17-19 captions contra 9 de `balloon wall`, y la palabra `wall` a secas sale en
**112 de 154** captions significando *la pared del local*, porque el cierre
obligatorio del corpus es `set against a plain white wall and tiled floor`.

El rechazado vio **quince veces más** paredes orgánicas — y se rechazó por otra
cosa: acabado (0/6, *"Fashion conservó reflejos especulares fuertes, no hubo
separación mate"*) y diámetro (0/6, *"5-inch y 24-inch fueron visualmente
similares"*). El color lo pasó 6/6.

**Esto es una bifurcación y es tuya** (ver *Lo que tenés que decidir*, punto 5).

---

## El diagnóstico, en una frase

No es un defecto: son **dos cadenas independientes rotas a la vez**. La lectura de
la foto nunca llega al plan porque un esquema la rechaza en la frontera, y el
texto que recibe el generador está escrito en un vocabulario que ese generador
nunca vio. Arreglar una sola de las dos no cambia lo que ves.

```
FOTO ──► lectura (Python, sana) ──╳── frontera Zod ──► plan ──► patrón ──► caption ──╳── LoRA
                                   ▲                                                   ▲
                             CADENA A: el cable cortado              CADENA B: el vocabulario
                            (dónde va cada color)                        (parece un panel)
```

---

## Tanda A — El caption del LoRA

**Por qué primero**: es lo que más pesa en el síntoma peor (la imagen), **no
depende de nada más**, no mueve `plan_hash` y no toca ninguna regla comercial.
Son cambios de vocabulario y puntuación.

Todo esto se midió contra los **154 captions reales de entrenamiento del LoRA
v004-1000** (`data/lora-artifacts/datasets/lora-dataset-v004-154/`).

### A1. El sustantivo de la pared orgánica no existe en el entrenamiento

`estructuras-oficiales.ts:109` — `sustantivoEn: "asymmetrical organic balloon wall installation"`.

| frase | corpus |
|---|---|
| `asymmetrical organic balloon wall` | **0 / 154** |
| `balloon wall installation` | **0 / 154** |
| `organic balloon garland` (el arco, que sí sale bien) | 23 / 154 |
| `arch` | 46 / 154 |
| `backdrop` | 49 / 154 |
| `panel` | 33 / 154 |

Fuera de distribución, la prior del modelo para "algo grande contra la pared del
fondo" es **un panel plano**. Y hay un daño colateral del arreglo anterior: al
pasar de `pared_densa` a `pared_organica`, el commit `b7be2c9` **perdió la palabra
`dense`**, que era la única que decía que la pared cubre todo el fondo sin huecos.

**Cambio**: `sustantivoEn` a una redacción que el corpus tenga y que recupere la
densidad (`"full dense balloon wall"` o `"dense balloon wall"`). Lo orgánico se
dice como lo dice el corpus (`layered with organic clusters of`), no con
`asymmetrical`, que en sus 7 apariciones siempre modifica una guirnalda o un arco.
Mismo problema en `SCENE_V004_NOUNS.pared` (`lora-caption-compiler.ts:881`).

**Riesgo**: `sustantivoEn` se exporta al contrato → regenerar
`npm run contracts:export:domain` y los modelos de Python. Rompe instantáneas
byte a byte. No mueve `plan_hash`.

### A2. El caption ordena los colores alfabéticamente y no lleva ninguna proporción

`lora-caption-compiler.ts:956` — `[...byConcept.keys()].sort()` **(verificado a mano)**.

`fashion` < `reflex` < `satin`, así que el **blanco (10 %) se nombra primero** y el
**rosado (60 %) último**. Se demostró generando el mismo caption con tres repartos
distintos: salen **byte a byte idénticos**. La función que sabe decir la
proporción (`describirMezclaDeColor`) tiene un solo consumidor, y es **Gemini**.

**Cambio**: ordenar por participación descendente (el dato ya está en
`sceneSpec.material_estimate.balloons`) y usar la gramática que el corpus tiene:
dominante primero, minoritarios detrás de `accented with clusters of`
(`accent` 11/154). **No** usar `mostly` / `primarily` / `predominantly`: 0/154.

### A3. La coma que falta reconstruye el panel

`lora-caption-compiler.ts:1139` pega la ubicación **sin coma**:

> …plus white clustered at the lower left corner **among pink balloons against the rear wall**.

En inglés eso ata *against the rear wall* a *pink balloons*: dice que los globos
rosados son los que están contra la pared. Es el mismo fondo rosado plano que
`83a4b02` creía haber matado al quitar `over a pink base`; la concatenación lo
rehace.

**Cambio**: una coma cuando la cláusula trae `colorPattern`. **Un carácter.**

### A4. `grounded supports` sigue llegando a la pared

0/154 en el corpus. El propio fichero documenta que esa frase ya causó *"una
guirnalda de pared salió como un arco rectangular sobre patas metálicas"*. El
candado `soloGuirnaldasEnAlto` (`:1262`) exige `armadoGuirnalda` en **todas** las
cláusulas, y una pared nunca lo tiene → el arreglo excluía a la pared por
construcción **(verificado a mano)**.

**Cambio**: que una cláusula de `structureType === "pared"` tampoco pida
`grounded supports`.

> **Corrección**: dije también que `installed against the rear wall` estaba fuera
> de distribución. **Es falso, y depende del LoRA.** En v007 esa frase exacta está
> en **119 de 345** captions y es la cláusula de colocación normal, usada igual
> para arcos y columnas: ahí es vocabulario nativo. En v004 la palabra `installed`
> no aparece **ni una vez**, y el cierre de sitio es `set against` en **154 de
> 154** — el rasgo más consistente de todo el conjunto. El compilador **ya hace lo
> correcto** con el mecanismo de dialecto. No hay nada que arreglar aquí, y el
> pendiente §4.4 del SEGUIMIENTO queda **cerrado**.

### A7. Con patrón de color se pierde la única frase de mezcla de tamaños que el corpus conoce

`lora-caption-compiler.ts:1051` — la guarda es
`!scenePhrase && !clause.colorPattern && clause.canonicalEntries?.length`.

`fraseRelacionTamanos` emite `mixed organically rather than graded`, que el corpus
usa **214 veces en 180 de sus 345 captions**. Como **toda** pared lleva ahora
patrón de color, la guarda se cumple siempre y **la frase no se emite jamás para
una pared**. Se le quita al caption la única señal de mezcla de diámetros que el
modelo aprendió, y en su lugar se le pone una frase de posición cuyo vocabulario
es **0 %** del corpus (ver D1).

**Esta es la regresión que coincidió con la entrada de `zonas`**, y explica
"empeoró justo cuando entró `zonas`" sin apelar a nada más.

**Cambio**: las dos frases **no se contradicen** — una habla de diámetros y la
otra de color. Quitar `!clause.colorPattern` de la guarda. La contradicción que
la motivó era solo con `aleatorio`/confeti.

### A5. El caption sale sin una sola palabra de tamaño

`sceneSizeWords` (`:916`) con un solo diámetro dice `large` solo si ≥16" y `small`
solo si ≤9". **El 12" cae en el hueco 10–15 y devuelve cadena vacía** — y una
pared es en la práctica siempre de un diámetro.

**Cambio**: cerrar el hueco con la forma del corpus (`all at a single 12-inch size`).
Y acotar la supresión de `fraseRelacionTamanos` (`:1050`): se apaga con
*cualquier* patrón de color, cuando la contradicción que la motivó era solo con
`aleatorio`/confeti — con `zonas` no hay tal contradicción.

### A6. `cromado` viaja sin traducir en el camino legacy

`FINISH_WORDS` no tiene `cromado`; `ACABADO_EN` y el contrato sí. El caption
legacy sale con *"with pearl, **cromado** and matte finishes"* — una palabra en
español para un modelo entrenado 154/154 en inglés. Producción no emite ese
camino, **pero es el que usa la herramienta de diagnóstico del SEGUIMIENTO §4.3**:
quien diagnostique con ella está leyendo una cadena que producción no manda.

**Cambio**: `cromado: "glossy"` en `FINISH_WORDS`, y un test que exija que toda
clave de `ACABADO_EN` tenga entrada en `FINISH_WORDS`.

---

## Tanda B — El cable cortado: que la lectura de la foto llegue

**Estos dos van juntos o no van.** Arreglar uno solo no mueve nada y parecerá que
el arreglo no sirvió — es la misma trampa de las tres iteraciones del 2026-09-29.

### B1. La frontera rechaza la respuesta ENTERA (verificado a mano, 3/3)

`python-adapter.ts:1543` — `patronReferenciaPistaSchema` es `.strict()` y no
declara `zonas`. Python **sí** las manda (`patron_referencia.py:288`). Zod falla
con `unrecognized_keys` y la línea 2151 lanza `PYTHON_INVALID_RESPONSE` **502**:
no se descarta esa pista, se tira la **respuesta de lectura de patrón completa**,
con las pistas de todas las piezas de esa foto. Arriba, `registrarOmision` lo
despacha con un `console.warn`.

> **Corrección de la verificación**: escribí antes que morían también "el arco y
> la guirnalda de la misma foto". **Es falso.** Las cuatro lecturas son llamadas
> independientes en un `Promise.all` (`lecturas-foto.ts:48-53`): el conteo, el
> bouquet y la guirnalda sobreviven. El daño se limita al patrón de color — que
> sigue siendo total para ese eje.

Consecuencia: **el modo `zonas` de ADR-0036 nunca se ha ejecutado desde una foto,
ni una sola vez.** De ahí "Zonas · sugerido" con una mancha de dorado.

**Cambio**: derivar el esquema de `PistaPatronSchema` en vez de reescribirlo a
mano (para que un campo nuevo del contrato no vuelva a perderse), validar **pista
a pista** en vez de tirar la respuesta entera, y que esta omisión salga como error
visible.

### B2. `patronDePista` tampoco copia las manchas (verificado a mano, 2/3)

`amaterasu/patron-referencia.ts:88` reconstruye el objeto campo a campo y no
menciona `zonas`. El destino sí lo admite. Perverso para diagnosticar: el log que
`6e472cc` añadió justamente para distinguir "leída con sus cuatro manchas" de
"llegó sin ninguna" imprimiría `"zonas": null` **incluso con B1 arreglado**.

> **Corrección de la verificación**: una lente lo refutó *como causa*, y tiene
> razón. Hoy es **código inalcanzable**: B1 revienta antes, así que B2 no explica
> nada de lo que ves. Es un **co-requisito latente**, no una causa. Enunciado
> correcto: *"segundo corte del mismo cable, que se activa el día que se arregle
> el primero"*. Por eso van en el mismo commit.

**Cambio**: dejar que el esquema de destino haga el parseo, en vez de una tercera
copia manual.

### B4. Nada prueba este transporte — por eso lleva roto desde que nació

`scripts/test/test-patron-referencia.ts:66` — en TypeScript la respuesta de Python
la **fabrica el propio test** con `resultadoPatron(pistas)`: el test define el
contrato que verifica, así que no puede detectar deriva del productor real. Y
ninguno de sus casos usa `zonas`. Del lado de los vectores golden: **ninguno de
los 32** lleva `pistas_patron`.

Eso explica lo más incómodo de todo: el defecto lleva vivo **desde que existe el
modo** (`6e472cc`) y las cuatro suites están en verde.

**Cambio**: (a) un caso cuyo doble devuelva una pista con cuatro manchas del mismo
color y afirme que llegan a `appearance.patron_color.zonas` y de ahí a
`pistas_patron` — **hoy sale en rojo**, con B1+B2 sale en verde; (b) un vector
golden que recorra la ruta de la pista.

### B5. El fondo tiene que poder ser una mezcla — hoy no puede

Consecuencia de la **decisión 2**, y es capacidad nueva. Hoy la base de un patrón
en zonas tiene `fondo` como **un solo índice de material**: el fondo es
monocolor por construcción. No hay forma de decir "el fondo es blush con blanco
salpicado", que es literalmente lo que muestra la foto.

**Forma propuesta del arreglo**, reutilizando maquinaria existente en vez de
inventar un modo nuevo: que `fondo` admita **varios materiales con peso**, y que
las celdas de fondo se repartan entre ellos con el mismo reparto ponderado que ya
usa el modo `aleatorio`. Los pesos salen de la participación (decisión 1).

Con eso, los tres colores de esta pared quedan así:

- **dorado** → cuatro manchas por ancla (lo que la foto agrupa),
- **blush + blanco** → mezcla del fondo, ponderada 60/10 por participación.

Y desaparece el acento de filas enteras que motivaba el aviso B3: un color sin
mancha ya no cae en `sin_uso`, cae en el fondo.

**Riesgo**: toca la forma de la base del patrón → contrato, modelos de Python y
vectores dorados. Es el cambio más grande del alcance. `plan_hash` se mueve.

### ⚠ B3. Por qué B1+B2 no van solos

Medido con corridas deterministas: si las manchas empiezan a llegar **sin arreglar
antes C1 y C2**, la pared sale **peor** que hoy.

- **(3/3)** En una pared, **todo color de la pieza que la base del patrón no
  usa** —lo nombre la foto o no— se convierte en **acento de filas enteras**:
  sin `posiciones` (omitidas a propósito cuando `tipo == TIPO_REJILLA`),
  `_aplicar_capas` traduce "sin posiciones" a "todas". Filas 2, 5, 8, 11… =
  **33,3 % exacto de la pared en bandas horizontales** (la foto tiene 10 % de
  blanco). Y el caption pide `evenly spaced white accent clusters` justo detrás
  de una frase que dice `no stripes, no bands`.
  > La verificación **amplió** la precondición: no hace falta que el modelo
  > nombre el color sin darle mancha. Basta que la base no lo use.
- **(3/3)** La cuota de cada color sale de la `extension` que el modelo estima
  **a ojo**. Con cuatro manchas de dorado al 20 %: **dorado 52 %, rosado 14 %**.
  > La verificación lo **agravó**: no es que "nada las reconcilie" con la
  > participación medida — es que la **sobrescribe**. Y precisó que
  > `participacion` hoy tampoco es una medición sobre píxeles: la escribe el
  > modelo del chat leyendo una frase de texto libre.

---

## Tanda C — Que el color correcto se compre

### C1. El dorado cromado real se cambia por **oro rosa**

`cobertura-materiales.ts:195` — `ACABADOS_QUE_CUMPLEN` no admite `metal` como
cumplidor de `reflex`. El único globo de látex cromado dorado que el catálogo
vende de verdad es `GLOBO REDONDO METAL DORADO` (acabado `metal`), así que se
sustituye por `GLOBO REDONDO REFLEX DORADO ROSA` — **oro rosa, a ΔE 22,6 del
blush**. La pared se vuelve rosa + rosa-oro: *bicolor*, sin que nada falle
visiblemente. **Es un defecto nuevo, dentro del arreglo del 2026-09-29.**

**Cambio**: `reflex: ["reflex", "metal"]`. El comentario de arriba ya distingue
`metalizado` (mylar/foil, que **no** debe cumplir) de la línea de látex.

### C2. Un mismo producto sirve al dorado y al rosado

`colores-producto.ts:55` — las variantes de este catálogo no traen color, así que
`GLOBO REDONDO REFLEX DORADO ROSA` queda con `["dorado", "multicolor", "rosado"]`.
El mismo globo satisface el filtro del dorado **y** el del blush.

**Cambio**: un producto cuyo título nombra un color compuesto de la paleta
(`dorado rosa`) tiene **ese** color, no los dos sueltos — mismo patrón que la
corrección de `gris` que ya vive en ese fichero.

### C3. El brief lo escribe el modelo y se lee como restricción del cliente

Es **el agujero de `91b7fa8` por la otra puerta**. `guardar_brief` hace
`Object.assign(estado.brief, brief)` y trece líneas después ese brief alimenta
`filtrosDurosDeBusqueda` → el **acabado vuelve a ser filtro duro y nunca
relajable** (`escaleraRelajacion` solo desmonta `ocasiones` y `colores`).

**Cambio**: no derivar `acabados`/`formas`/`diámetros`/`categorías` del brief,
solo de `solicitudOriginal`. Y quitar el `|| mensaje` que sobrevive en
`registro-herramientas.ts:1295` bajo el nombre `solicitudParaFiltros`.

### C4. Con foto y sin texto nada garantiza que los colores tengan candidato

`coloresContexto` es **estructuralmente inerte** en ese caso: la escalera de
relajación no tiene peldaños que recorrer, así que su único consumidor nunca se
llama. Y el top-K reparte por orden alfabético de `product_id`: ningún color tiene
plaza reservada.

**Cambio (barato)**: cuando queden colores de la foto sin cubrir, emitir una
búsqueda extra **de un solo color** por cada uno y unir los candidatos. El propio
prompt ya lo sugiere como reparación posterior; falta hacerlo como primer intento.

### C5. Las flores blancas entran como color de globo

Nada en el prompt del patrón excluye lo que no es globo dentro del bbox. Tu pared
tiene cuatro ramos de flores blancas, casi en los mismos sitios donde se agrupa el
dorado. El lector tiene todos los incentivos para devolver manchas de `blanco`.
Y un color sin material **tumba el patrón entero**.

**Cambio**: una frase en `SYSTEM_INSTRUCTION` de `patron_referencia.py`, en la
misma gramática que ya usa el lector de conteo: *"Name only the colors of the
BALLOONS. Flowers, foliage, foil letters, fabric or props are not balloons."*
Una línea, ningún contrato tocado.

---

## Tanda D — La geometría nunca llega al generador

### D1. La guía de estructura descarta las paredes por construcción

`kagutsuchi/guia-estructura.ts:51` — ADR-0033 abrió el **único** canal por el que
la geometría real de la pieza (posiciones, borde vivo, dónde cae cada color) puede
llegar al LoRA: un PNG plano que entra por `/edit`. La bandera `GUIA_ESTRUCTURA_V1`
está **encendida** en `.env.local`. Pero `estructuraParaGuia` descarta la pieza por
dos condiciones: `pared` no está en `TIPOS_CON_PATRON` y la geometría `rejilla` no
se acepta.

O sea: **el croquis que ves en pantalla nunca ha llegado al generador de imagen.**
Todo lo que sabe el LoRA de esta pared es el texto.

**Cambio**: añadir `pared` a `TIPOS_CON_PATRON` y aceptar `geometria === "rejilla"`.
`discosDeGuia` ya funciona sin cambios.

**Nota**: **sin verificar** todavía por la lente adversaria.

### D2. El LoRA no tiene NINGUNA palabra para decir dónde va un color dentro de la pieza

**Este es el hallazgo que decide la forma del plan.** Conteo sobre los dos corpus:

| | v004 (154) | v007 (345) |
|---|---|---|
| `corner` | 6 — **las seis significan esquina del LOCAL** | **0** |
| `upper right` | **0** | — |
| `lower left` | **0** | — |
| `clustered` | 5, y 3 de ellas no son de color | — |

El modo `zonas` describe la distribución así: *"gold clustered at the **upper
right corner**, plus white clustered at the **lower left corner**"*. El único
significado que el modelo aprendió para `corner` es **una esquina de la
habitación** (`rising in a room corner`, `mounted against a corner wall`). Pedirle
"dorado en la esquina superior derecha" lo empuja a poner dorado **en la esquina
del cuarto**, no en el cuadrante de la pared.

**El modo `zonas` habla un idioma que el generador nunca aprendió.** Por texto, la
posición **no es transportable** con ninguno de los dos LoRA.

### Consecuencia: D1 no es complemento de la tanda A, es el arreglo

La guía de estructura es el **único canal que puede llevar el "dónde"**: le
entrega la forma y las manchas **dibujadas** en vez de describírselas, y no
depende de ninguna prior de vocabulario. `silueta.py` ya dibuja las manchas por
ancla; esa imagen sí transporta la posición, el texto no.

Y refuerza el orden: **arreglar la tanda B sin D1 activa mejora el croquis y la
hoja de armado, pero no puede mejorar la imagen**, porque las cuatro manchas de
dorado viajarían en palabras que el modelo no entiende.

---

## Tanda E — Degradar en vez de descartar (decisión de negocio)

`patron_color.py:1589` — con tres colores y cinco manchas hay **≥13 puntos únicos
de fallo total**: cualquiera devuelve `None` y la pared cae al preset, perdiendo
el fondo correcto, las cuatro manchas y la etiqueta "de tu foto". Basta que el
catálogo llame `marfil` a lo que el detector llama `blanco`.

Además, `material_de_color` resuelve dentro de ΔE 25 y **nada impide que dos
colores distintos caigan en el mismo material** (blanco–crema 15,3; nude–oro rosa
10,8; rosado–oro rosa 22,6).

**Cambio propuesto**: degradar — un color que no resuelve se **omite**; una mancha
que no resuelve se **descarta sola**; el resto sobrevive; el motivo se registra en
`avisos`. Perder las cuatro manchas de dorado porque el blanco no mapeó es
estrictamente peor que quedarse con las cuatro.

**Esto es tuyo, no mío**: es el pendiente que el SEGUIMIENTO §5 dejó explícitamente
abierto. Y reescribe a conciencia
`test_una_pista_de_zonas_que_no_se_puede_usar_cae_al_preset`, que hoy afirma lo
contrario.

---

## Lo que queda por decidir

1. **`plan_hash` se mueve** con B+C+E: toda pared aprobada y no generada hay que
   **reaprobarla**. ¿Cuándo, y se avisa a negocio antes o después?
2. **¿Hasta dónde llega el alcance?** Hoy es "que la distribución de color esté
   bien". Los arreglos de forma y tamaño (A1, A5, A7) quedan fuera; A7 en
   particular es **quitar una condición de un `if`** y es la regresión que
   coincidió con `zonas`. ¿Entra de rebote o se deja para la siguiente?

### Ya decididas — no reabrir sin motivo

- **Cuánto por color** → la participación manda; la extensión reparte entre
  manchas del mismo color.
- **Color mezclado** → al fondo, salpicado. Ni zona ni bandas.
- **Color sin material** → degradar, con aviso.
- **El LoRA** → se queda como está. Ni cambio de versión ni reentrenamiento.

### Archivado: la elección de LoRA

Fuera de alcance por decisión del 2026-09-30, pero los números quedan aquí para
cuando se retome:
   - **v004 (aprobado)**: es lo que iría a producción, pero vio **2 paredes
     orgánicas**. La tanda A lo acerca a lo que sí vio, y ahí tiene techo.
   - **v007 (rechazado)**: vio **30**, y su rechazo fue por acabado y diámetro,
     no por forma. Si el acabado y el diámetro importan menos en una pared que en
     un bouquet, puede ser el modelo correcto para esta pieza — pero hoy no es
     desplegable y habría que reevaluarlo.
   - **Reentrenar**: la tubería existe y v007 demuestra que el dataset sabe
     producir paredes orgánicas. Es lo caro y lo definitivo.
   - **No elegir modelo: D1.** La guía de estructura no depende de la prior del
     texto. Es el único arreglo que sirve con cualquiera de los tres — y tras D2,
     el único que puede transportar la posición.
   > Dato para decidir: v007 vio **24-inch en 9 de 345** captions y **5-inch en
   > 178**. Casi no aprendió globos grandes, que es exactamente lo que midió su
   > propio rechazo. Ninguna redacción arregla eso.

---

## Verificación

Gratis y local, antes de tocar nada pagado:

```bash
npx tsc --noEmit && npm run -s lint && npm run -s plan:test
```

```bash
uv run --system-certs --directory services/ai-api --extra test pytest -q
```

Trampas ya conocidas (SEGUIMIENTO §6): el lint recorre los worktrees si no están
excluidos; `18-colores-foto-paleta.json` se marca modificado por finales de línea
y se restaura con `git checkout --`; un oráculo byte a byte no se rebasa sin
demostrar qué lo movió.

**Instantáneas que van a romperse a propósito** con la tanda A:
`scripts/fixtures/armado-bouquet-prompt/prompts-sin-armado.json`,
`armado-guirnalda-prompt`, `patron-color-prompt`. Regenerarlas **diciendo por qué
en el commit**, nunca para que pase la suite.

### ⚠ La herramienta de medición está rota. Arreglarla ANTES de gastar

`scripts/ops/comparar-pared-organica.ts` — tope acordado **US$ 0,50**, autorizado
el 2026-09-29 y nunca gastado. Menos mal, porque tal como está **no puede
contestar su propia pregunta**:

1. **Las tres banderas están muertas.** `flag(nombre)` busca `--${nombre}`, y el
   script llama `flag("--artifact-id", …)` → busca `----artifact-id`, que nunca
   aparece. Las tres toman siempre el valor por defecto y **fallan en silencio**.
   Es el único fichero de `scripts/` con ese error. Consecuencia: no se pueden
   añadir semillas (una sola muestra **no es una medición**), no se puede comparar
   **v004 contra v007** —que tras el hallazgo del slot es *la* pregunta— ni
   cambiar la escala. **Arreglo: quitar dos guiones en tres líneas.**
2. **Su escena fija pide el panel en LOS DOS brazos.** Contiene
   `filling a rectangular backdrop frame`. Salgan como salgan las dos imágenes,
   ninguna puede contestar *"¿la pared sale llena de globos o sigue siendo un
   panel?"*, que es la lectura declarada en el SEGUIMIENTO §5.2.
3. **Mezcla dialectos**: usa `R-5 (5-inch)` (vocabulario v007) junto a
   `set against` (cierre v004) y lo manda al LoRA v004 — cuyo corpus **no contiene
   el token `inch` ni una vez**.

**Antes de gastar un céntimo**: quitar `backdrop`/`panel`/`frame` de la escena
fija, no mezclar dialectos, y que la variable única sea la frase de forma de la
pared (control = lo que producción emite hoy, 0/154; tratamiento = el molde que sí
existe en el corpus).

**Segunda variable propuesta, barata**: el aspecto. Hoy se genera en **3:2
apaisado**, que el corpus vio **2 veces de 154 (1 %)**; el 39 % es vertical 3:4 y
el 35 % cuadrado. Un lienzo ancho deja espacio horizontal sobrante que el modelo
rellena con lo que sí sabe poner ahí: **superficie de fondo**. Dos celdas más a
1:1, misma semilla y caption: ~US$ 0,08.

---

## Registro del documento

- **2026-09-30, apertura** — 6 de 8 rastreadores cerrados. Tandas A–E. Sin
  verificación adversaria.
- **2026-09-30, 2.ª** — Cierra el rastreador de frontera/contrato: **el contrato
  está sano**, la única deriva es el campo `zonas` de la tanda B. Añadido **B4**
  (nada prueba el transporte). Llegan los primeros veredictos: B1 **3/3**, B2
  **2/3 como corte latente, no como causa**, y los dos avisos de B3 **3/3, uno de
  ellos agravado**. Tres enunciados míos corregidos, anotados donde tocaba.
- **2026-09-30, 3.ª** — El usuario aporta que el LoRA *"probablemente vio algunas
  paredes pero no las suficientes"*. Conteo propio sobre los cuatro datasets del
  repo: **v004 (aprobado) vio 2 paredes orgánicas y 82 backdrops/paneles**.
  Descubierto además que `.env.local` corre el **LoRA rechazado v007** con el
  override de pruebas, así que lo que se está juzgando no es lo que produciría
  producción — y arrastra el dialecto `product_v007`. Nueva cabecera de aviso,
  **D1 sube a arreglo estratégico**, y quinta decisión abierta: contra qué modelo
  se arregla.
- **2026-09-30, 4.ª** — Cierra el último rastreador, el del modelo, y **reordena
  el plan**. Lo decisivo: **D2** — el LoRA no tiene ninguna palabra para decir
  dónde va un color dentro de la pieza (`corner` es 0/345 en v007, y sus 6
  apariciones en v004 son esquinas del local), así que **la posición no es
  transportable por texto** y D1 pasa de complemento a arreglo. Añadido **A7**: la
  frase de mezcla de tamaños que el corpus usa 214 veces se suprime justo cuando
  hay patrón de color — **esa es la regresión que coincidió con `zonas`**.
  Corregido A4: `installed against the rear wall` **no** está fuera de
  distribución, es la cláusula nativa de v007 (119/345); el pendiente §4.4 del
  SEGUIMIENTO queda cerrado. Y descubierto que **la herramienta de medición pagada
  está rota** por partida triple: se arregla antes de gastar. La infraestructura
  del LoRA (escala 0,8, 28 pasos, guidance 3,5, registro de identidad) está sana y
  no se toca.
- **2026-09-30, 6.ª — IMPLEMENTADO Y MEDIDO.** Nueve commits en
  `fix/pared-organica-color-e-imagen`. El cable (B1/B2/B4/B6), el acento
  salpicado, la `g` del caption, el log del campo rechazado, la bandera de
  desarrollo, **el canal de la guía abierto para paredes Y guirnaldas** (D1 + el
  candado del formato), el borde orgánico que muerde un globo y el tope del
  croquis. Verificado: 1180 pruebas de Python, `plan:test`, `tsc`, lint en 25
  avisos (la línea base), `ruff` y `mypy`. Y **medido con 6 imágenes pagadas**:
  la guía convierte un arco sobre patas en una guirnalda montada en la pared.
  Queda A2 (dominante primero en el caption), que exige enhebrar la
  participación hasta `ProductConceptClauseInput` y no cabía en esta pasada.
- **2026-09-30, 5.ª — ALCANCE DECIDIDO.** El usuario fija el objetivo: **el LoRA
  se queda como está y lo que tiene que quedar bien es la distribución de
  colores.** Nueva sección de alcance arriba. Las tres decisiones de oficio quedan
  resueltas (la primera la tomo yo con argumento escrito, porque el usuario la
  dejó abierta). Añadido **B5**: el fondo tiene que poder ser una mezcla, que es
  capacidad nueva y el cambio más grande del alcance — y que de paso hace
  desaparecer el acento de filas enteras. A1/A4/A5/A7 y la elección de LoRA pasan
  a archivo.

---

## Orden de trabajo

1. **C1 + C2** — que el dorado sea dorado y no oro rosa. Sin esto la distribución
   está mal en la raíz, y son dos cambios pequeños. *(No mueve `plan_hash` por sí
   solo; sí cambia qué producto se compra.)*
2. **B5** — el fondo mezclado. Es el más grande y todo lo demás se apoya en él.
3. **B1 + B2 + B4** — que las manchas lleguen, con su prueba en rojo primero.
4. **E** — degradar, con el aviso.
5. **C3 + C4 + C5** — que los colores lleguen a estar disponibles en la búsqueda.
6. **D1** — que la distribución llegue a la imagen.
7. **A2** — el dominante primero en el caption.
8. Verificación completa, y recién entonces la medición pagada.
