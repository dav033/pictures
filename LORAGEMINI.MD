# LoRA + Gemini · por qué la imagen no se parece a la referencia, y qué hacer

Escrito el 2026-09-16 después de trazar el pipeline línea por línea y de correr
una batería medida contra fal.ai y Gemini. Gasto declarado antes de empezar:
tope US$10; gasto real estimado **US$1** (15 imágenes en fal, 2 en Gemini, 2
llamadas de juez). Las imágenes de la batería **no entran al repositorio**:
viven en el directorio de trabajo de la sesión y se regeneran con los comandos
del §8.

Cada afirmación lleva de dónde sale: `archivo:línea`, una consulta a la base de
datos, o un identificador de petición del proveedor.

---

## 1. El síntoma

El cliente manda la foto de su espacio. El chat arma una propuesta, la cotiza y
genera una vista previa. La vista previa **no se parece a la referencia**: se ve
hecha por una IA. En concreto, sobre los ejemplos revisados:

| Lo que hay en la referencia | Lo que sale generado |
|---|---|
| Rosa palo / dusty rose mate | Rosa chicle claro, más saturado y más brillante |
| Gris mate como segundo color de peso | Desaparece o se lava a blanco |
| Plata Reflex cromada, espejo | Plata genérica, sin reflejo especular |
| Globos de 5", 12", 18" y un remate de 36" | Todos parecidos, sin remate dominante |
| Dos columnas distintas entre sí, orgánicas | Dos torres casi idénticas, en espejo |
| Panel de tela, mesa, plinto acrílico, silla | Ambientación distinta o inventada |

El QA visual **sí lo detecta** —en una corrida marcó `appearance failure
EST_01_COL_IZQ`— pero llega tarde y **no bloquea**: la ruta LoRA está excluida
del corte (`src/app/api/generate/route.ts:1234` exige `!usarLora`), y en local
`IMAGE_QA_NON_BLOCKING=true` también desarma el corte de Gemini
(`src/lib/ia/feature-flags.ts`). Encima `IMAGE_QA_ENABLED` viene **apagado por
defecto** (`feature-flags.ts`), así que sin `imageQaRequested` explícito no hay
observación (`route.ts:633`).

---

## 2. Cómo llega hoy la decoración al modelo

Con foto del espacio, `/api/generate` entra en el modo híbrido:

```
route.ts:913   const usarComposicionLoraGemini = usarLora && Boolean(venue);
```

A partir de ahí el camino es este:

```
foto de referencia del cliente
        │
        ├─► analizador → blueprint → plan (Python) → plan aprobado y firmado
        │
        ▼
   SceneSpec  ──►  compileProductPrompt()  ──►  caption de ≤460 caracteres
                                                        │
                            + LORA_PRESENTATION_INSTRUCTION (290 caracteres)
                                                        │
                                                        ▼
        ETAPA 1   fal.ai flux-2/lora  ·  TEXT_ENDPOINT  ·  sin ninguna imagen
                                                        │
                                            render de la decoración
                                            sobre fondo blanco de estudio
                                                        │
                      foto del espacio ──────────────┐  │
                                                     ▼  ▼
        ETAPA 2   Gemini (gemini-3.1-flash-image)  ·  venue + render LoRA
                                                        │
                                                        ▼
                                              imagen que ve el cliente
```

Lo importante es lo que **no** está en ese diagrama. En modo híbrido:

| Qué se descarta | Dónde |
|---|---|
| Todas las imágenes que recibiría el LoRA (referencia, productos, venue) | `route.ts:1178` — se le pasa `[]` |
| La foto de referencia en la etapa de Gemini | `route.ts:1192` — `inputsParaComposicionGemini` devuelve exactamente dos entradas: venue y render LoRA |
| La escenografía detectada en la foto | `route.ts:838` + `reference-structure.ts:362` — con venue, `debeConservarEscenografiaDeReferencia` devuelve `false` |
| El decorado ambiental del caption | `route.ts:1066` — `ambientDecor = []` |
| El contexto visual (tipo de lugar, luz, paleta) del caption | `route.ts:1067` — se sustituye por `GROUPING_ONLY_CONTEXT`, que es `{venueKind:"unknown", lightingKind:"unspecified", palette:[]}` |

Y como el LoRA no recibe ninguna imagen, el adaptador elige el endpoint de texto:

```
sempertex-lora.ts:324   const endpoint = references.length ? EDIT_ENDPOINT : TEXT_ENDPOINT;
```

**Conclusión del trazado: entre la foto que manda el cliente y el modelo que
dibuja la decoración no pasa un solo píxel. Pasan 460 caracteres de texto.**

### 2.1 El presupuesto real del caption

`LORA_PROMPT_MAX_LENGTH` son 750 caracteres (`lora-caption-compiler.ts:27`), y
en híbrido el compilador recibe ese tope menos la instrucción de presentación
(`route.ts:1076`):

```
 750  presupuesto total del caption
-290  LORA_PRESENTATION_INSTRUCTION (bloque fijo de aislamiento)
─────
 460  para describir el diseño entero: estructuras, colores, acabados,
      diámetros, distribución y asimetría
```

Los 290 caracteres fijos no describen nada: son una negación (*no backdrop, no
drapes, no furniture, tables, chairs, flowers, plants, pedestals or props*) más
dos parches escritos contra defectos observados (*asymmetry means uneven
staggered clusters…*, *pink must be soft pastel, not hot pink*). Es decir: **el
39% del canal se gasta peleando contra el propio modelo**.

En la etapa 2 pasa lo mismo a otra escala: `GEMINI_COMPOSITION_HARD_LOCK` son
680 caracteres que se **concatenan al final** de lo que produce
`buildImagePrompt` (`route.ts:1198`), un prompt largo con su propio inventario
de escena. La instrucción crítica compite con todo lo anterior.

---

## 3. Las cuatro causas, en orden de impacto

### C1 · El modo híbrido corre el LoRA fuera de su distribución de entrenamiento

Esta es la causa principal y es la más barata de arreglar.

El LoRA de producción se entrenó con **336 imágenes y sus captions** (dataset
`lora-dataset-v007-ordenes`). Medí las 345 captions del directorio de origen
(`data/staging/lora-v007/captions`):

| Propiedad de las captions de entrenamiento | Valor |
|---|---|
| Terminan describiendo el **fondo real** (*set against … walls and … floor*) | **345 / 345 = 100%** |
| Incluyen **props del montaje** (*alongside a table, a chair, flowers…*) | 245 / 345 = 71% |
| Mencionan fondo blanco de estudio | 43 / 345 = 12,5% |
| Longitud: mín / mediana / p95 / máx (caracteres) | 176 / 416 / 854 / 1212 |
| Longitud: mediana / p95 (palabras) | 61 / 130 |

Una caption típica del entrenamiento:

> `eventdecor_style_v3, an organic balloon arch, installed against the rear wall,
> built from matte Fashion white round latex balloons and Pastel Matte blue round
> latex balloons, all in 18-inch and 12-inch, mixed organically rather than
> graded, alongside a printed poster, a round plinth stand, bottled water bottles
> and soccer print balloons, set against white walls and a dark tiled floor.`

El caption que manda hoy el modo híbrido termina así, en cambio:

> `… Isolated white-studio presentation: only approved quoted structures.
> Asymmetry means uneven staggered clusters and nonmatching tops, never straight
> matching towers. Pink must be soft pastel, not hot pink. No backdrop, drapes,
> furniture, tables, chairs, flowers, plants, pedestals or props.`

Es el registro opuesto al de las 336 imágenes que el modelo vio: una
**prohibición imperativa en segunda persona** donde el entrenamiento siempre
tuvo una **descripción declarativa de una escena completa**. Las dos cláusulas
que cierran el 100% y el 71% de las captions son exactamente las dos que el modo
híbrido prohíbe.

Un LoRA fuera de distribución no falla ruidosamente: **se apaga**. El peso
adaptado deja de dominar y la imagen se la lleva el prior del modelo base, que
es justo el aspecto "render 3D" que se está viendo.

**Medición (§4): el mismo diseño, la misma semilla, cambiando solo el registro
del caption, pasa de una torre plastificada flotando en blanco a una fotografía
de evento.**

### C2 · El LoRA que se está usando está rechazado por su propia evaluación

Consulta al registro (`lora_mode_slots` + `lora_training_runs` + `lora_artifacts`):

| slot | run | dataset | trigger | evaluación |
|---|---|---|---|---|
| `unlimited` | `lora-run-v004-1000` | v004, 154 imágenes | `eventdecor_style_v2` | **approved** |
| `training_1` | `lora-run-v004-1000` | v004, 154 imágenes | `eventdecor_style_v2` | **approved** |
| `training_2` | `lora-run-v007-1000` | v007, 336 imágenes | `eventdecor_style_v3` | **rejected** |

`.env.local` tiene `NEXT_PUBLIC_LORA_MODE=training_2`. Ese slot solo es
seleccionable porque hay un override de pruebas:

```
mode-resolver.ts:86
  return process.env.NODE_ENV === "development"
      && process.env.LORA_ALLOW_REJECTED_FOR_TESTING === "true";
```

En producción ese mismo slot daría `failed`. O sea: **lo que se está mirando y
juzgando en local no es lo que produciría producción.**

El informe de rechazo (`lora_evaluations`, id `lora-run-v007-1000:eval-v1-scale08`,
36/36 generaciones válidas) dice exactamente qué falla:

| Criterio | Mínimo | Resultado | Observación registrada |
|---|---|---|---|
| Color (*Reflex rose gold* vs *Reflex gold*) | 5/6 | **6/6 ✅** | «Rose gold y gold se distinguieron en las seis semillas» |
| Acabado (*Reflex high-shine* vs *Fashion matte*) | 5/6 | **0/6 ❌** | «Fashion conservó reflejos especulares fuertes; **no hubo separación mate**» |
| Diámetro (*Fashion white 5-inch* vs *24-inch*) | 4/6 | **0/6 ❌** | «Las salidas de 5-inch y 24-inch fueron **visualmente similares**» |
| **Global** | — | **0/6 — rejected** | «No promover el modo» |

Esos dos fallos son, literalmente, dos de las filas de la tabla del §1:

- *no hubo separación mate* → todo sale brillante y plastificado.
- *5-inch y 24-inch visualmente similares* → no hay remate de 36", no hay
  gradación de tamaños, y sin gradación las columnas colapsan en torres
  uniformes.

El color, que en el informe pasa 6/6, sigue fallando en producción. Eso apunta a
que el corrimiento de color **no nace en el LoRA** sino antes, en la cadena
foto → analizador → sustitución de catálogo → traducción a nombre de color del
caption. Es la misma cadena que `SEGUIMIENTO.md §3.A` documenta para el burdeos
que desaparecía en silencio.

### C3 · La referencia no llega a ningún modelo: el cuello de 460 caracteres

Aun con el LoRA perfecto y en su registro, el modo híbrido pide describir en 460
caracteres lo que una foto resuelve en un vistazo: el tono exacto del rosa, la
proporción entre los tres colores, el perfil irregular de cada columna, dónde
está el racimo grande, cómo se apoya en el suelo.

Hay tres capacidades ya construidas y pagadas que el modo híbrido apaga:

1. **`EDIT_ENDPOINT` de flux-2/lora** (`sempertex-lora.ts:6`), que acepta hasta
   4 imágenes y un prompt de hasta 2.500 caracteres
   (`LORA_EDIT_PROMPT_MAX_LENGTH`). El híbrido nunca lo alcanza porque le pasa
   `[]` (`route.ts:1178`).
2. **Las entradas etiquetadas de Gemini** (`gemini/imagen.ts`), con roles
   `composition_reference`, `palette_reference`, `style_reference` ya definidos
   y con frase fija por rol (`sempertex-lora.ts`, `FRASE_POR_ROL`). En híbrido
   solo se usan dos de los siete roles.
3. **La escenografía detectada** en la foto, que ya se valida, se acota por
   categoría y tiene interruptor por chip, y que con venue se descarta entera.

El comentario que justifica no mandarle imágenes al LoRA
(`sempertex-lora.ts:206-225`) es correcto en su premisa —el LoRA se entrenó sin
condicionamiento por imagen, y `/edit` es un régimen que no se midió— pero la
conclusión que se sacó fue cerrar la puerta en vez de medirla. El §4 la mide.

### C4 · La etapa 2 hereda el daño y le suma el suyo

Gemini recibe un render de estudio, aislado, sin suelo ni sombra de contacto, y
tiene que injertarlo en una foto real. Es la operación más difícil posible: debe
inventar la sombra proyectada, el contacto con el piso, la luz ambiente y la
oclusión, sin ninguna referencia de cómo se ve esa decoración en un espacio.

En la medición del §4 esa etapa **resta** 3 puntos de fotorrealismo cuando
recibe el render aislado, y solo 1 cuando recibe el mismo diseño ya ambientado.
El culpable no es Gemini: es lo que le entra.

---

## 4. La medición

### 4.1 Método

Protocolo: mismo diseño comercial en todas las corridas —dos columnas orgánicas
de látex mate dusty rose, mate gris y Reflex plata cromada, en 36", 18", 12" y
5"— variando **una sola cosa por corrida**. Semillas fijas 101 y 202.
`num_inference_steps` 28, `image_size` 1024×1536, igual que producción
(`sempertex-lora.ts:358-366`).

Tres registros de caption, con contenido comercial idéntico:

| Variante | Registro | Longitud |
|---|---|---|
| **A** | Compilado + `LORA_PRESENTATION_INSTRUCTION`. **Es lo que manda producción hoy.** | 727 ch |
| **B** | Registro de entrenamiento, cerrando con `set against plain white studio backdrop, no floor visible.` | 496 ch |
| **C** | Registro de entrenamiento, cerrando con props y fondo reales, como el 71% / 100% del corpus | 603 ch |

Y tres arquitecturas de segunda etapa, todas sobre la **misma** foto de espacio
de control (patio con muro de piedra, muro blanco y césped):

| Variante | Arquitectura |
|---|---|
| **D1** | LoRA aislado (A) → Gemini compone sobre el venue. **Es la arquitectura actual completa.** |
| **D2** | LoRA `/edit` directamente sobre la foto del venue, caption en registro de entrenamiento |
| **D3** | LoRA ambientado (C) → Gemini compone sobre el venue |

Puntuación: un juez con rúbrica fija, el mismo patrón que ya usa
`image-qa.ts`, en **una sola llamada con las seis imágenes** para que compartan
escala. Escala 0–10 en fotorrealismo, separación de acabado (mate vs cromo),
variación de diámetro, asimetría orgánica y usabilidad comercial.

### 4.2 Resultados

| Variante | Fotorrealismo | Acabado | Tamaño | Asimetría | **Usable** | Peor defecto según el juez |
|---|---|---|---|---|---|---|
| A · LoRA aislado (producción, etapa 1) | 6 | 6 | 5 | 6 | 6 | Sin remate superior claro |
| B · registro entrenamiento, estudio | 7 | 7 | 7 | 6 | 7 | Sombras de contacto flotantes |
| C · registro entrenamiento, con venue | 7 | 6 | 6 | 7 | 7 | Racimo plateado superior irregular |
| **D1 · arquitectura actual completa** | **4** | 6 | 5 | 6 | **4** | **«Compositing de fondo y contacto con el suelo irreales»** |
| D2 · LoRA `/edit` sobre el venue | 6 | 5 | 5 | 6 | 6 | Cromo sin reflejo especular |
| D3 · LoRA ambientado → Gemini | 6 | 7 | 6 | 6 | 6 | Borde de sombra despegado del piso |

Tres lecturas, en orden de importancia:

1. **La arquitectura actual completa (D1) es la peor de las seis**, y por
   margen: 4/10 en fotorrealismo y 4/10 en usabilidad comercial, contra 6–7 de
   todo lo demás. No es una impresión: es la única variante que el juez baja de 5.

2. **Cambiar solo el registro del caption ya recupera la calidad.** A → C, con
   la misma semilla, el mismo LoRA, los mismos parámetros y el mismo diseño, sube
   de 6 a 7 en fotorrealismo y de 5 a 6 en variación de tamaño. Visualmente el
   salto es mucho mayor de lo que sugiere el número: A produce dos torres
   recortadas flotando sobre blanco; C produce una fotografía de montaje con
   panel de tela, mesa, plinto y césped.

3. **Gemini no es el problema; lo que le entra sí.** Misma etapa 2, mismo
   prompt, mismo venue: con render aislado da 4/10, con render ambientado da
   6/10. La diferencia es enteramente la entrada.

Y el resultado **negativo**, que ahorra trabajo:

| Ablación (misma semilla, mismo caption C) | Fotorrealismo | Acabado | Tamaño | Usable |
|---|---|---|---|---|
| `guidance_scale` 3,5 · escala LoRA 0,8 *(producción)* | 8,5 | 8,5 | 8,0 | 8,5 |
| `guidance_scale` 5,0 · escala 0,8 | 8,0 | 8,5 | 8,0 | 8,0 |
| `guidance_scale` 2,5 · escala 0,8 | 8,5 | 8,5 | 8,0 | 8,5 |
| `guidance_scale` 3,5 · escala 0,6 | 8,5 | 8,5 | 8,5 | 8,5 |
| `guidance_scale` 3,5 · escala 1,0 | 8,0 | 8,0 | 8,0 | 8,0 |

Todo cae en 8,0–8,5: **ni `guidance_scale` ni la escala del LoRA son la
palanca.** No hay que gastar tiempo ahí. Los niveles de creatividad
(`creatividad.ts`, que mueven `guidanceScale` entre 2,0 y 4,5) tampoco explican
ni arreglan el problema.

### 4.3 Qué no prueba esta medición

Hay que decirlo antes de que alguien cite los números de más:

- **El juez es un modelo, en una pasada, sin consenso ni repetición.** Sus
  números sirven para **ordenar dentro de una misma llamada**, no como métrica
  absoluta. Se nota en que la variante C puntúa 7 en la corrida de seis imágenes
  y 8,5 en la corrida de ablación: la escala se recalibra con el conjunto que se
  le presenta. **Nunca compares puntuaciones entre corridas distintas.**
- Son **una semilla o dos por celda**, no una distribución. Sirven para decidir
  hacia dónde ir, no para firmar una compuerta.
- El venue de control es una imagen generada, no la foto de un cliente real.
- No se midió con las fotos reales de los ejemplos del §1 porque no están en el
  repositorio y no deben entrar (`AGENTS.md`: nada de imágenes ni datos de
  cliente en el repo).

Lo que sí queda establecido, porque no depende del juez: el registro de las 336
captions de entrenamiento (100% con fondo, 71% con props), el rechazo 0/6 de la
evaluación del LoRA en uso, y el hecho de que en híbrido no viaja ni un píxel de
la referencia.

---

## 5. El plan

Cuatro fases. Cada una es independiente, reversible, y tiene su criterio de
aceptación antes de empezar. El orden es por relación impacto/coste, no por
dificultad.

### Fase 0 · Dejar de medir sobre un modelo rechazado (1 hora, US$0)

No es una mejora: es la condición para que las demás fases se puedan juzgar.

1. Pasar local a un slot **approved** (`unlimited` o `training_1`, ambos v004) o
   documentar explícitamente que se está probando el v007 rechazado y por qué.
2. Que la UI diga, visiblemente, cuando el modo activo es `testing_rejected`.
   Hoy `modeStatus` ya devuelve ese estado (`mode-resolver.ts`) y nadie lo
   muestra.
3. Encender `IMAGE_QA_ENABLED` en local y retirar `IMAGE_QA_NON_BLOCKING`, que
   se marcó **temporal el 2026-09-15** y sigue puesto. Sin QA observando, cada
   iteración de las fases siguientes se juzga a ojo.

**Aceptación:** dos generaciones consecutivas del mismo plan con el slot
declarado en la respuesta y con `qa.pass` no nulo.

### Fase 1 · Devolver al LoRA su registro de entrenamiento (1 día, ~US$3)

La de mayor impacto por unidad de trabajo. No toca la arquitectura: solo cambia
qué texto se le manda al mismo modelo.

1. **Retirar `LORA_PRESENTATION_INSTRUCTION`** tal como está. Sustituirla por
   una cláusula de cierre en el registro del corpus, declarativa y no
   imperativa: `…, set against plain white studio backdrop, no floor visible.`
   Eso libera ~230 de los 290 caracteres que hoy se gastan en negaciones.
2. **Dejar de vaciar el contexto visual del caption** (`route.ts:1067`). El
   `GROUPING_ONLY_CONTEXT` existe para que el LoRA no dibuje el venue; con la
   cláusula de cierre del punto 1 ese objetivo ya está cubierto por una frase
   que el modelo sí reconoce.
3. **Subir el techo del caption en híbrido.** Con la instrucción fija reducida,
   el compilador puede usar ~700 de los 750 caracteres, que es donde vive el
   p75 del corpus de entrenamiento (548 ch).
4. **Trasladar al compilador el parche de la asimetría.** Hoy *«asymmetry means
   uneven staggered clusters…»* es una frase suelta al final. El corpus dice
   `mixed organically rather than graded` — esa es la expresión que el modelo
   asocia con el comportamiento buscado, y `compileProductPrompt` ya la emite
   por cláusula.

**Aceptación:** sobre 10 planes fijados, en un juez de una sola llamada por par,
el caption nuevo gana al actual en fotorrealismo y variación de tamaño en ≥7 de
10, sin perder ninguna comprobación de `preflightLoraPrompt`,
`verificarColoresCaptionLora` ni `findLoraPromptLanguageLeaks`.

**Reversión:** una constante. Sin migración ni cambio de contrato.

### Fase 2 · Que la referencia llegue en píxeles, no en 460 caracteres (3–5 días, ~US$15)

Aquí está el techo real de calidad. Dos opciones; la medición favorece la
primera, pero la segunda es menos invasiva.

**Opción A — el LoRA edita la foto del espacio (arquitectura de D2).**
Una sola llamada en vez de dos: `EDIT_ENDPOINT` con la foto del venue y el
caption en registro de entrenamiento describiendo el espacio observado.
`buildLoraEditPrompt` y `referenciasParaLoraEdit` ya están escritos y probados
(`sempertex-lora.ts:229-305`), y con venue presente `referenciasParaLoraEdit` ya
filtra a solo la foto del cliente para que `/edit` no copie otro fondo.

- Elimina la etapa 2 entera: se acaba el problema de sombra de contacto y
  compositing, que es el defecto que el juez le imputó a D1.
- Reduce el coste por vista previa: una llamada a fal en vez de fal + Gemini.
- Riesgo real: `/edit` **no está medido** con este LoRA, y el comentario de
  `sempertex-lora.ts:206` advierte que su prompt vive en un registro distinto.
  Hay que medirlo con el protocolo del §4 antes de moverlo.

**Opción B — mantener las dos etapas y darle a cada una lo que le falta.**

- Etapa 1: la foto de referencia como `composition_reference` por `/edit`, con
  la foto del venue.
- Etapa 2: la foto de referencia entra como **tercera entrada** de Gemini con
  rol `palette_reference`. Los roles y sus frases fijas ya existen; solo hay que
  dejar de descartarlos en `inputsParaComposicionGemini` (`route.ts:1192`).
- Etapa 2: acortar `GEMINI_COMPOSITION_HARD_LOCK`. 680 caracteres de negaciones
  al final de un prompt largo se diluyen; lo que sobrevive es lo específico.

En las dos opciones, un cambio que no depende de la elección: **volver a admitir
la escenografía detectada cuando hay venue.** Hoy `debeConservarEscenografiaDeReferencia`
devuelve `false` con venue (`reference-structure.ts:362`), y con eso se pierde
mesa, plinto, silla y flores de la referencia. El montaje de C y D2 se ve
completo precisamente porque esos objetos estaban en el caption. La escenografía
ya tiene su propia puerta: no toca cotización, materiales ni `plan_hash`, y el
cliente la enciende o apaga por chip.

**Aceptación:** contra la línea base de la Fase 1, sobre 10 planes fijados, la
opción elegida gana en fotorrealismo y usabilidad en ≥7 de 10, **y** el QA
visual no empeora la conformidad con el plan aprobado (cardinalidad, colores por
estructura, elementos presentes). Si sube la calidad y baja la fidelidad al
plan, no se promueve: la propuesta es lo que se cobra.

**Reversión:** la opción A cambia el endpoint y el número de llamadas; debe ir
detrás de un interruptor explícito hasta que dos corridas de control la
confirmen. `SEMPERTEX_LORA_EDIT` ya existe como interruptor de retiro.

### Fase 3 · Los dos ejes que el LoRA no controla (2–3 semanas, ~US$40 de entrenamiento)

Solo después de las fases 1 y 2, porque hasta entonces no se sabe cuánto del
problema era el registro y cuánto es el modelo.

El v007 falla 0/6 en acabado y 0/6 en diámetro. Son fallos de **dataset**, no de
hiperparámetros:

- **Acabado.** El corpus embebe marca + color + forma + material en una
  identidad única (*high-shine Reflex rose gold round latex balloons*). Si casi
  toda foto de pedido real tiene brillo especular por el flash o el sol, el
  modelo nunca ve el contraste mate/cromo y no puede aprender a separarlo. Hay
  que **contar cuántas imágenes del dataset son efectivamente mate** antes de
  reentrenar nada.
- **Diámetro.** «5-inch y 24-inch visualmente similares» es lo esperable cuando
  el diámetro solo aparece como texto y no hay en la foto una referencia de
  escala estable. La salida no es más pasos: es **caption con relación de
  tamaño** (*one oversized 36-inch topper above 5-inch clusters*) y/o un
  muestreo del dataset que garantice contraste de diámetro dentro de la misma
  imagen.

Antes de gastar en una corrida: reetiquetar una muestra de 40 imágenes con
acabado y diámetro verificados, medir el desequilibrio, y solo entonces decidir
si es recaption (barato) o recolección (caro).

**Aceptación:** el protocolo que ya existe, sin cambiarlo para que pase —
`lora-eval-v1`, 6 semillas, mínimos 5/6 color, 5/6 acabado, 4/6 diámetro. Y la
promoción pasa por `evaluation_status = approved` en el registro, no por el
override de pruebas.

### Fase 4 · Que el color deje de corromperse en el camino (1 semana)

Independiente de todo lo anterior y probablemente la causa del rosa chicle y del
gris que desaparece. El informe de evaluación dice que el LoRA **sí** distingue
colores (6/6). Entonces el corrimiento nace antes.

La cadena es: foto → analizador (produce nombres como «burdeos» o «frambuesa»
que el catálogo no tiene) → sustitución por el color disponible más cercano
(ahora en Python, por distancia, decisión del `SEGUIMIENTO.md §3.A`) →
traducción a color del caption (`translateLoraColor`).

Falta lo que `SEGUIMIENTO.md §E.3` ya identificó y nadie cerró: **nadie compara
la proporción**. El plan declara `participacion` por material y nada contrasta
ese reparto con el observado en la referencia. Un gris que es el 40% de la foto
y el 5% del plan pasa sin que salte nada.

Dos cosas concretas:

1. Que la sustitución de color viaje hasta el caption **con su distancia**, y
   que una sustitución lejana sea visible para el cliente antes de generar, no
   después.
2. Un guard de proporción sobre `participacion`, primero como advertencia
   medida. Si se confirma que correlaciona con las quejas, se sube a
   restricción. Decidirlo requiere datos, no opinión: empezar advirtiendo.

---

## 6. Lo que no hay que hacer

- **No subir `guidance_scale` ni la escala del LoRA.** Medido en §4.2: no mueven
  nada entre 2,5 y 5,0 y entre 0,6 y 1,0.
- **No añadir más frases prohibitivas al caption.** Cada una consume presupuesto
  del canal de 460 caracteres y ninguna está en el registro del entrenamiento.
  Los tres parches actuales (*asymmetry means…*, *pink must be…*, *no
  backdrop…*) son un síntoma del cuello de botella, no su solución.
- **No reentrenar el LoRA todavía.** Hasta la Fase 2 no se sabe cuánto del
  problema era el registro. Entrenar antes cuesta ~US$10 por corrida y mide
  sobre un pipeline que va a cambiar.
- **No apagar el QA visual para que las imágenes «pasen».** `IMAGE_QA_NON_BLOCKING`
  ya lleva un día de más y la ruta LoRA ya está exenta del corte. El QA marcó
  `appearance failure` correctamente: era la única pieza que vio el problema.
- **No cambiar de proveedor de imagen antes de la Fase 2.** La medición muestra
  que Gemini rinde según lo que le entra (4/10 con render aislado, 6/10 con
  render ambientado). Cambiarlo ahora movería la variable equivocada.

---

## 7. Riesgos y qué vigilar

| Riesgo | Señal temprana | Mitigación |
|---|---|---|
| Subir calidad bajando fidelidad al plan | `qa.pass` empeora o suben los `retry_reasons` de cardinalidad | El criterio de aceptación de la Fase 2 exige que el QA no empeore |
| `/edit` copia fondo de una imagen que no es el venue | Fondo distinto al de la foto del cliente | `referenciasParaLoraEdit` ya filtra a solo venue cuando hay venue (`sempertex-lora.ts:236-242`) |
| El caption más largo rompe el preflight | `LORA_PREFLIGHT_FAILED` en la respuesta | El preflight ya corre sobre el prompt final que recibe fal (`route.ts:1152-1170`) |
| Reabrir la escenografía duplica objetos que el plan ya materializa | Dos mesas, dos sillas | `materializedReferenceIds` ya excluye lo que el plan dibuja (`route.ts:834`) |
| La medición se lee como métrica absoluta | Alguien cita «8,5» de una corrida en otra | §4.3: solo ordena dentro de una llamada |

---

## 8. Reproducir la medición

Requisitos: `FAL_KEY` con saldo y `GEMINI_API_KEY` en `.env.local`. En Windows,
`curl` necesita `--ssl-no-revoke`; Node no.

Slots y artefactos en uso:

```bash
node --input-type=module -e "import pg from 'pg'; process.loadEnvFile('.env.local'); const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); const r=await p.query(\"SELECT s.slug, s.lora_scale::float8, r.id, r.dataset_id, r.trigger_token, r.evaluation_status FROM lora_mode_slots s LEFT JOIN lora_training_runs r ON r.id=s.training_run_id\"); console.table(r.rows); await p.end();"
```

Informe de rechazo del v007:

```bash
node --input-type=module -e "import pg from 'pg'; process.loadEnvFile('.env.local'); const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); const r=await p.query(\"SELECT result_snapshot FROM lora_evaluations WHERE id='lora-run-v007-1000:eval-v1-scale08'\"); console.log(JSON.stringify(r.rows[0],null,1)); await p.end();"
```

Distribución de las captions de entrenamiento (§3, C1):

```bash
node -e "const fs=require('fs'),d='data/staging/lora-v007/captions',f=fs.readdirSync(d).filter(x=>x.endsWith('.txt')),c=f.map(x=>fs.readFileSync(d+'/'+x,'utf8').trim());const q=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor(a.length*p)];const L=c.map(t=>t.length);console.log('captions',c.length,'| mediana',q(L,.5),'| p95',q(L,.95),'| con fondo',c.filter(t=>/set against/i.test(t)).length,'| con props',c.filter(t=>/alongside/i.test(t)).length);"
```

Presupuesto real del caption híbrido:

```bash
node -e "const I=' Isolated white-studio presentation: only approved quoted structures. Asymmetry means uneven staggered clusters and nonmatching tops, never straight matching towers. Pink must be soft pastel, not hot pink. No backdrop, drapes, furniture, tables, chairs, flowers, plants, pedestals or props.';console.log('instruccion fija:',I.length,'| queda para el diseno:',750-I.length);"
```

Las peticiones de la batería quedaron registradas en fal con estos
identificadores, por si hay que auditarlas:

| Variante | `request_id` de fal |
|---|---|
| A · producción, semilla 101 | `01a0ac54-32b1-7062-ac91-78dacb66810c` |
| B · registro estudio, semilla 101 | `01a0ac54-68f4-77a2-b483-d7eaf29620c6` |
| C · registro venue, semilla 101 | `01a0ac55-1ae9-7470-acbb-7b9fb968486d` |
| C · registro venue, v004, semilla 101 | `01a0ac56-0887-7593-af98-9db2b25169bc` |
| A · producción, semilla 202 | `01a0ac57-46a7-7770-a847-bca11a4bf506` |
| C · registro venue, semilla 202 | `01a0ac59-5261-70c1-a8f3-b2c356c64a16` |
| Ablación `guidance` 5,0 / 2,5 | `01a0ac5e-e319-7ee1-8074-c7ae1acbc4bb` / `01a0ac5f-1d6f-71b1-8859-3d7f652fd142` |
| Ablación escala 0,6 / 1,0 | `01a0ac5f-51f5-7552-89a1-09c21a0c028b` / `01a0ac5f-ff47-7002-8f19-4cf84160669d` |

Verificación antes de dar por buena cualquier fase (`AGENTS.md`):

```bash
npx tsc --noEmit && npm run -s lint && npm run plan:test
```

```bash
uv run --directory services/ai-api pytest -q
```

---

## 9. Resumen ejecutable

| # | Acción | Coste | Impacto esperado | Reversión |
|---|---|---|---|---|
| 0 | Slot approved + QA encendido y bloqueante | 1 h, US$0 | Habilita medir | Variable de entorno |
| 1 | Caption en el registro del entrenamiento | 1 d, ~US$3 | **Alto** | Una constante |
| 2 | La referencia llega en píxeles (`/edit` o tercera entrada) | 3–5 d, ~US$15 | **El techo real** | Interruptor |
| 3 | Reentrenar por acabado y diámetro | 2–3 sem, ~US$40 | Medio, tardío | No promover el slot |
| 4 | Proporción de color observada vs declarada | 1 sem | Medio | Advertencia antes que restricción |

Si solo se hace una cosa: **la Fase 1**. Es un cambio de texto, cuesta un día, y
es la diferencia entre pedirle al modelo algo que nunca vio y pedírselo como se
lo enseñamos.
