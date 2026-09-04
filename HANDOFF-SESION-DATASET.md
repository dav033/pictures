## ⏱ SESIÓN 5 (2026-08-27, más tarde) — LEER ESTO PRIMERO, es lo más reciente

**Sin crédito otra vez.** Se acabó el saldo de fal.ai mientras se probaba en vivo. Antes de tocar
nada, revisar `fal.ai/dashboard` → team correcto (ver más abajo cuál es) → cargar crédito.

### Hallazgo importante: `.env.local` tenía la `FAL_KEY` de la cuenta EQUIVOCADA

La key que estaba en `.env.local` (la que usó la app y todos los scripts de prueba de la sesión
4) **no pertenece al team "Customer Journey"** — ahí es donde se entrenó el LoRA v2 y donde se
cargaron los US$50. Verificado con evidencia dura: el "Recent History" de Customer Journey solo
muestra 2 requests totales (el training + un `nano-banana-2` ajeno), cero de las ~20 llamadas a
`flux-2/lora` que se hicieron. La cuenta Personal (David Morales, dav033) tampoco tiene actividad
ni método de pago. La key vieja era de una tercera cuenta (probablemente la del LoRA v1, "otra
cuenta low budget" que menciona el handoff original) — por eso el error `403 Exhausted balance`
apareció sin que el saldo de Customer Journey se hubiera tocado.

**Ya corregido**: `.env.local` tiene ahora `FAL_KEY=e0670bfc-...` (verificada con un call de prueba
a `storage/upload/initiate` → 200 OK). Un primer key que el usuario probó
(`aa49b6c3-...`) seguía bloqueada — la que quedó activa es la segunda. **Confirmar contra qué
cuenta/team factura esta key nueva** antes de asumir que es Customer Journey — no se verificó eso
todavía, solo que no está bloqueada.

### Nuevo hallazgo de calidad: la forma del arco salía mal — encontrada la causa y aplicado un fix, SIN VERIFICAR AÚN

El usuario probó en la app (con la key ya arreglada) y el arco de globos salía como una diagonal
imposible (tocando el techo en una esquina, no una forma de arco real de dos patas). Comparé contra
los captions reales de entrenamiento: **todos, sin excepción, anclan el arco a algo inmediatamente
después de nombrarlo** ("framing a doorway", "mounted on a round gold ring frame", "framing a
stage", "framing a pair of wooden double doors"...). El prompt que arma `buildLoraImagePrompt` decía
solo "a balloon arch" a secas, sin ancla — mismo patrón de bug que los anteriores (algo fuera de la
distribución de los 154 captions), esta vez en la sintaxis/composición, no en idioma ni cardinalidad.

**Fix aplicado** en [`build-image-prompt.ts`](src/lib/ia/build-image-prompt.ts): nueva función
`loraGroundingSuffix()` — agrega ", framing the entrance" después de la frase de color, solo para
elementos que matchean `/\barco/` en el nombre. `tsc --noEmit` limpio.

**⚠️ NO SE VERIFICÓ CON UNA IMAGEN REAL** — justo cuando se iba a probar en la app (navegador
integrado, no el de Chrome usado para fal.ai), se acabó el crédito de nuevo. Esto es lo primero que
hay que hacer al retomar: cargar crédito, y generar un caso simple (un solo arco, ej. "Cumpleaños en
salón, un arco de globos rojo y dorado") para confirmar si "framing the entrance" alcanza o si hace
falta seguir iterando la frase de anclaje.

### Otro hallazgo sin resolver, de otra capa (no tocar hoy, solo documentado)

Antes del problema de créditos, se investigó que el chat de armado de plan a veces **narra éxito
sin que la herramienta lo respalde** (dice "ya quedó armado el plan" cuando `confirmar_plan_decoracion`
en realidad devolvió `ok:false`, verificado interceptando el stream real de `/api/chat`). Se agregó
una guarda genérica en `prompt-sistema.ts` (`BLOQUE_PLAN`, "REGLA DE HONESTIDAD SOBRE EL RESULTADO")
pero **tampoco se verificó en vivo** — quedó pendiente por el mismo corte de crédito. Es un problema
de fidelidad del LLM al narrar resultados de herramientas, no relacionado con el LoRA ni con el fix
del arco.

También sin resolver: `VUELTAS_MAX=10` en `registro-herramientas.ts` puede quedarse corto cuando se
pide una estructura + 2 colores en un solo mensaje (mensaje se enreda). No se tocó — se decidió
simplificar el prompt de prueba en vez de subir el tope (ver razonamiento en la conversación: subir
el tope tiene costo/latencia real en cualquier conversación que se enrede, no solo en pruebas).

---

# Handoff: dataset de entrenamiento LoRA Sempertex (continuación 3)

## ⏱ ESTADO Y PRÓXIMO PASO (leer esto primero)

**Sesión 4 (2026-08-27): entrenamiento TERMINADO. Falta evaluar antes de pasar a producción.**

- Request ID: `01a043db-2160-7510-ab09-0965315c4c11` (team "Customer Journey", trainer `fal-ai/flux-2-trainer`).
  Status 200, duración 5090,81s (~84,8 min), **costo real US$25,60** (exacto a lo estimado).
- Parámetros usados: `steps=4000`, `learning_rate=0.0002`, `output_lora_format=fal`.
- **Pesos del LoRA nuevo (v2), ya disponibles**:
  `https://v3b.fal.media/files/b/0aa80af5/Co4ylzKGOqhReEQpYIQl8_pytorch_lora_weights.safetensors`
  (317 MB). Config del training: `https://v3b.fal.media/files/b/0aa80ae0/hx-QYFhTqNb8Unw4PbCN6_config_12e9bb4e-3b2b-42d6-8d03-005c3a585b6d.json`.
- **Dato importante para no repetir la investigación**: `fal-ai/flux-2-trainer` NO expone `rank` como
  parámetro (confirmado leyendo el schema OpenAPI real) — solo `steps`, `learning_rate`,
  `default_caption`, `output_lora_format`. La recomendación de "rank 16" del plan viene de literatura
  de FLUX.1 con otras herramientas; acá no hay ese control, fal lo fija internamente.
- **Actualización 2026-08-27 (misma sesión): el usuario pidió saltar la evaluación y reemplazar
  directo.** Se hizo: `sempertex-lora.ts:5` (`DEFAULT_LORA`) y `sempertex-lora.ts:78` (trigger)
  actualizados a v2; `SEMPERTEX_LORA_URL` agregado a `.env.local`. `tsc --noEmit` limpio. **Ojo: esto
  ya está en el código, pero NO se generó ninguna imagen de prueba real con el LoRA nuevo** — ni
  texto→imagen ni `edit_venue`. La primera vez que alguien genere una imagen en la app (local o
  producción, según dónde se despliegue este cambio) va a ser la primera prueba real del LoRA v2. Si
  algo sale mal, revertir es volver `DEFAULT_LORA`/trigger a v1 (URL vieja:
  `https://v3b.fal.media/files/b/0aa65403/J8b2xDhu6DhqE7Zm0D_cB_pytorch_lora_weights.safetensors`,
  trigger `eventdecor_style_v1`) y quitar `SEMPERTEX_LORA_URL` de `.env.local`.
- Pendiente sin resolver: si la URL de fal.media (`v3b.fal.media/files/b/...`) es estable a largo
  plazo o expira — no se confirmó antes de dejarla como fallback en el código.

### 🔬 AUDITORÍA PROFUNDA: el LoRA v2 NO está roto — el problema es el prompt de inferencia

Las dos primeras pruebas en la app salieron pésimas (una casi en blanco en `edit_venue`, otra con un
"Mrs" gigante en texto→imagen). Se hizo depuración con experimentos controlados en
`reports/lora-debug/` (9 imágenes, ~US$0,20). **Conclusión: el LoRA está excelente; falla el prompt.**

**Experimento decisivo** — mismo LoRA v2, mismo `scale` 0.8, mismo `seed` 42, solo cambia el prompt:

| variante | prompt | resultado |
|---|---|---|
| `AB-A-caption-style.png` | 263 chars, prosa tipo caption | **impecable**: arco correcto, sin texto |
| `AB-B-app-style.png` | 1518 chars, formato de `buildLoraImagePrompt()` | globos flotando sueltos + **cartel con texto ilegible** |
| `FIX-D-caption-style-equivalente.png` | mismo contenido que B, reescrito en prosa | **impecable** — valida la solución |

También `v1-scale0.8.png` y `v2-scale0.8.png` salen ambos perfectos con prompt tipo caption: descarta
que el problema sea sobrecocinar el entrenamiento o el `scale`.

**Causa raíz: desajuste de distribución entre entrenamiento e inferencia.**
- Captions de entrenamiento: prosa fluida, promedio **415 chars** (mín 208 / máx 816). **0 de 154**
  usan campos etiquetados; **146 de 154** arrancan con `eventdecor_style_v2, a …`.
- `buildLoraImagePrompt()` ([build-image-prompt.ts:365](src/lib/ia/build-image-prompt.ts:365)) emite
  secciones etiquetadas unidas por `". "` — `Event:`, `Venue:`, `Palette:`, `MATERIAL ESTIMATE:`,
  `COLOR VARIETY \ MATERIAL MIX:`, cantidades numéricas ("87 Arco…"), `MONOCHROME LOCK` — hasta
  **3.500 chars**. Ese registro **nunca apareció en el entrenamiento**.

**Sobre el texto que aparece en las imágenes** (importante, contradice la hipótesis intuitiva): la
cláusula `"absolutely no visible text, logos, labels, or annotations"` **NO es la culpable**. Se probó
quitarla (`FIX-C-appstyle-sin-clausula-notext.png`, mismo seed) y **el cartel sigue apareciendo igual**.
El texto viene del prior aprendido: **48 de 154 captions (31%) mencionan cartelería** — `sign` 28,
`letter` 16, `banner` 14, `marquee` 8, `name sign` 6 — porque las decoraciones Sempertex reales sí
llevan carteles. El prompt fuera de distribución amplifica ese prior.

**Parámetros de entrenamiento, para el registro**: los defaults de fal son `lr=5e-5` y `steps=1000`;
se usó `2e-4` (4×) y `4000` (4×). Se sospechó sobreentrenamiento, pero **queda descartado como causa
principal** porque el LoRA rinde perfecto con prompts en distribución.

**Solución propuesta (no implementada todavía)**: reescribir `buildLoraImagePrompt()` para emitir
prosa en registro caption en vez de secciones etiquetadas — es una función separada de
`buildImagePrompt()` (la de Gemini), así que se puede cambiar sin tocar el camino de Gemini.
Mantener el contenido (elementos, colores, volumen) pero redactado como describe un caption.

**Cambio temporal aplicado**: [generate/route.ts:938](src/app/api/generate/route.ts:938) ya no
devuelve 422 cuando `usarLora` — la imagen se muestra igual con la advertencia de QA en ámbar, para
poder evaluar. El camino Gemini sigue bloqueando como antes.

### ✅ FIX aplicado: `buildLoraImagePrompt()` reescrito en registro caption

[`build-image-prompt.ts:365`](src/lib/ia/build-image-prompt.ts:365) — ya no arma secciones etiquetadas
(`Event:`, `Venue:`, `COLOR VARIETY / MATERIAL MIX:`, etc., hasta 3.500 chars). Ahora compone UNA
oración fluida (tope 1.200 chars) sin ALL-CAPS ni metainstrucciones, reusando solo `sceneSpec.elements`
(nombre + color) y `material_estimate.design.{visual_density,visual_scale}` traducidos a adjetivos
naturales ("a full, dense", "large", etc. — mapeo en `LORA_DENSITY_WORDS`/`LORA_SCALE_WORDS`) en vez de
`colorVarietyContract()`/`materialEstimateContract()`/`eventAuthorityContract()`.

**Importante — esas tres funciones NO se tocaron**: las sigue usando `buildImagePrompt()` (el prompt de
Gemini, que sí es un modelo de instrucciones y necesita ese formato). Solo se dejó de *llamarlas* desde
`buildLoraImagePrompt()`. Cero riesgo para el camino Gemini.

También se quitó la cláusula "absolutely no visible text..." del lado LoRA — el experimento `FIX-C`
probó que no hacía nada (con y sin ella, el cartel seguía apareciendo igual); lo que sí lo resuelve es
quedarse en el registro de caption, no la prohibición explícita.

### 🔁 Segunda vuelta: se probó en vivo en la app y SEGUÍA mal — causa real más profunda

Al regenerar en la app real (mismo caso: boda en jardín, blanco y dorado) con el fix de arriba ya
aplicado, siguió saliendo mal — esta vez sin texto gigante, pero con siluetas planas tipo cartel y
letras cursivas doradas. Comparando la tarjeta del plan visible en pantalla contra el prompt: **el
mismo bug de fondo aparece en OTRO eje**. `element.name` ("Arco Orgánico Principal", "Columnas de
Bienvenida"), `visualContext.venue`/`eventType`/`style`, y `resolved_colors`/`palette` están **todos
en español** — el LoRA se entrenó con captions 100% en inglés. La primera pasada de esta sesión
arregló el *formato* (prosa vs. etiquetas) pero seguía inyectando texto en español a un modelo
entrenado solo en inglés: el mismo problema, un nivel más abajo.

**Segundo fix, en la misma función**:
- [`taxonomy/v2.ts`](src/lib/rag/taxonomy/v2.ts) — nuevo `PALETA_COLORES_EN_V2`, traduce los 26
  colores canónicos del catálogo (`PALETA_COLORES_V2`) al inglés. Única fuente de verdad, reusable.
- `build-image-prompt.ts` — `loraStructureNoun()` detecta la FORMA de la estructura por palabras
  clave en español (arco/columna/guirnalda/cascada/centro de mesa/bouquet/pared) en vez de usar el
  nombre libre — mismo patrón que ya usaba `cardinalityContract()` en este archivo, solo que antes
  se ignoraba en la ruta LoRA. `loraColorWord()` traduce vía `PALETA_COLORES_EN_V2` con fallback a
  passthrough si el valor no está en el catálogo. `LORA_EVENT_WORDS`/`LORA_STYLE_WORDS`: diccionarios
  chicos y acotados (7 y 15 entradas) para `eventType`/`style`; si no reconoce el valor, **omite la
  cláusula en vez de colar español sin traducir** — mismo principio que ya usa el proyecto en otros
  lados ("no inventar, no adivinar").
- `visualContext.venue` se dejó afuera a propósito: `buildPositiveEnvironmentCues()` (compartida con
  Gemini, ya en inglés) ya aporta esa info por otro lado; repetirla en español habría reintroducido
  el mismo bug.
- Gap conocido, documentado en el código y no resuelto: `revisionInstruction` (el "Ajuste: 'más
  velas'...") es texto libre del usuario, típicamente en español, sin diccionario posible. Hoy es
  inerte en la práctica porque `generate/route.ts` ya bloquea `usarLora` + revisión aparte; si esa
  guarda se levanta algún día, este texto libre volverá a colarse sin traducir.
- De paso, un defecto de gramática que se notó al leer el prompt real ("a full, dense large **a**
  balloon arch" — doble artículo): `loraVolumePhrase()` ya no antepone su propio "a"/"an", se
  empalma en el artículo del sustantivo de estructura.

**Verificado con la función real, no una versión escrita a mano** — importando `buildLoraImagePrompt`
+ `buildVisualContext` directo y llamando a fal.ai con el prompt exacto que produce el código
(mismo LoRA v2, `scale` 0.8, caso idéntico al que falló: Arco Orgánico Principal + Columnas de
Bienvenida, blanco/dorado, boda en jardín, estilo romántico): **jardín real, arco y columna
coherentes en blanco y dorado, sin texto ni fondo lavado.** Ver
`reports/lora-debug/VERIFY-real-function.png`.

- `npx tsc --noEmit` limpio (el único error restante es en `src/app/api/happie/`, código sin
  trackear de la sesión paralela, no tocado esta sesión).
- [`scripts/test-visual-prompts.ts`](scripts/test-visual-prompts.ts) actualizado dos veces (formato,
  después idioma): ahora exige inglés (`balloon arch`, `red, green and gold`, `christmas
  celebration`) y `assert.doesNotMatch` contra el español original (`arco orgánico`, `rojo`,
  `navidad`, etc.) y contra las etiquetas viejas. `npx tsx scripts/test-visual-prompts.ts` → OK.
- Pendiente menor, no bloqueante: la primera vez que se probó en vivo en la app tras el primer fix
  (antes del segundo), pegó contra una guarda existente y no relacionada
  (`"LoRA Sempertex genera desde texto. Para editar fotos o usar referencias, cambia a Gemini."` —
  bloquea `usarLora` + `revisionMode=revise_current_result`). No se volvió a probar en la UI de la
  app después del segundo fix (sí se verificó con la función real vía script, ver arriba) — sería
  bueno confirmarlo una vez más ahí antes de dar por cerrado del todo.

Imágenes de referencia en `reports/lora-debug/`: `AB-A-caption-style.png` / `AB-B-app-style.png` /
`FIX-C-appstyle-sin-clausula-notext.png` / `FIX-D-caption-style-equivalente.png` /
`v1-scale0.8.png` / `v2-scale0.{4,6,8}.png` / `lora-v2-test-output.png` (edit_venue, malo, pre-fix) /
`lora-v2-test-t2i.png` (texto→imagen, malo, primer fix incompleto) /
`VERIFY-real-function.png` (función real, después del segundo fix — bueno).

### 🔁 Tercera vuelta: probado en vivo con LoRA ya de default, seguía faltando estructuras

El usuario probó en la app (plan real: "XV años coquette", arco + columnas laterales + cortina
mariposas) y la imagen **solo mostró el arco** — columnas y backdrop ausentes, más "layer ordering
failed" y globos sueltos flotando. Dos causas nuevas encontradas, una de infraestructura y una en
el prompt:

**1) El selector de proveedor volvía a Gemini en cada recarga.** `src/app/page.tsx:473` — el
`useState<SelectorIA>` arrancaba en `"gemini"`, y un `useEffect` que consulta `/api/ia/salud` (que
**solo conoce proveedores Gemini** — `ProveedorId` nunca incluye `"lora"`) pisaba el selector con
`setSelectorIA(data.predeterminado ?? disponibles[0])` en cada montaje, y `limpiarTodo()` ("Limpiar
chat") lo volvía a pisar con `setSelectorIA(proveedor)`. Resultado: la primera vez que el usuario
generó tras recargar, **generó con Gemini creyendo que era LoRA**. Ahora, a pedido explícito del
usuario, **LoRA Sempertex es el default real**: `useState<SelectorIA>("lora")`, se quitó el
`setSelectorIA(...)` del efecto de salud, y `limpiarTodo()` resetea a `"lora"` en vez de `proveedor`.

**2) El bug real de fondo: elementos duplicados producen la misma frase repetida.** Capturé el
prompt LoRA exacto de una corrida real (interceptando `window.fetch` en el navegador — no una
reconstrucción). El scene spec desdobla una estructura repetida en instancias físicas separadas
(`"Columnas Laterales Pastel #1 de 2"`, `"#2 de 2"` — mismo nombre base, mismo color) y mi
`buildLoraImagePrompt` las traducía cada una por separado, produciendo:
`"...a balloon column in pink, a balloon column in pink..."` — **la misma frase dicha dos veces**.
El modelo lo lee como una sola instrucción reforzada, no como cardinalidad=2 — de ahí
`missing required element EST_02_COLUMNAS#1/#2` en el QA. Nada que ver con idioma o formato; es un
problema de fraseo de cardinalidad.

**Fix**: `loraStructureNoun`/`LORA_CATEGORY_WORDS` ahora devuelven el sustantivo SIN artículo;
`loraNaturalJoin` agrupa frases idénticas (mismo sustantivo + mismo color) y las expresa como
`"two balloon columns in pink"` (numeral + plural) en vez de repetirlas. Cubre 2-6 elementos
duplicados (`LORA_NUMBER_WORDS`); more allá cae a `String(n)`. `loraPluralizeNoun` maneja el plural
regular +s y el caso "arch"→"arches" (termina en sibilante).

**Verificado con la función real + fal.ai, prompt exacto capturado del navegador** (4 elementos:
arco + columna#1 + columna#2 + backdrop, dos seeds): `FIX2-A-two-columns.png` /
`FIX2-B-two-columns-seed2.png` — **arco + 2 columnas + backdrop, las 3 presentes**, en ambas
semillas. `scripts/test-visual-prompts.ts` tiene un caso nuevo que fija este comportamiento
(`two balloon columns in pink`, y `doesNotMatch` contra la frase repetida) — pasa OK.

**Nota honesta sobre el backdrop**: en ambos renders aparece un cartel/ilustración pequeño con
texto cursivo dentro del backdrop (contenido, no domina la escena como el "Mrs" original). No lo
investigué a fondo — candidato principal sigue siendo el mismo de siempre: parte del dataset de
estilo (154 fotos) trae carteles reales (31% de los captions los mencionan), así que el LoRA
aprendió que "a veces hay texto en el fondo". Es mucho más leve que el bug original y no bloquea,
pero si se quiere eliminarlo del todo habría que o (a) aceptar que es fiel al estilo real de
Sempertex, o (b) filtrar/reponderar las fotos con cartelería del dataset de estilo v3 y reentrenar.
- Cargar créditos en fal.ai requirió cuenta "Personal" (David Morales, dav033) — en el team "Customer
  Journey" la pantalla de créditos redirigía sola al dashboard (posible tema de permisos, sin resolver).

### Investigación de esta sesión: ¿el LoRA de estilo sirve para editar el espacio del cliente?

Pregunta del usuario: el caso de uso real es que el cliente suba una foto de SU espacio y la app le
agregue la decoración encima (adaptada), no solo generar desde cero. Investigación completa (fal.ai
docs, comparación con Kontext/Qwen-Image-Edit/Seedream, limitaciones documentadas de FLUX.2):

- Ese caso de uso **ya está construido**: modo `edit_venue` en `scene-spec.ts:64`, rol `venue_base` en
  `generate/route.ts:518`, mismo LoRA en el endpoint `flux-2/lora/edit` (`sempertex-lora.ts:72`).
- Ya existe una red de seguridad automática en `image-qa.ts:172-183` (usa Gemini para juzgar el
  resultado): detecta si cambió la cámara, la arquitectura, o si la similitud fuera de la zona editada
  cae debajo del 90% — dispara `pass:false` y bloquea la respuesta (422) si falla.
- Asimetría real encontrada: el camino Gemini (`!usarLora`) tiene un reintento automático correctivo si
  falla el QA (`generate/route.ts:928`); el camino LoRA no lo tiene — va directo al bloqueo sin
  reintentar solo. No es un blocker, pero es dato para el roadmap.
- Hay DOS trainers distintos en fal.ai — no confundirlos: `flux-2-trainer` (imágenes sueltas, lo que
  usamos) entrena LoRA de **estilo**; `flux-2-trainer/edit` (pares `_start`/`_end`) entrena una
  transformación **fija y repetible** — no sirve para Sempertex porque cada pedido de edición es una
  instrucción distinta, no una receta única.
- Conclusión: no hizo falta cambiar el dataset ni el plan. Ver arriba el pendiente de evaluar
  específicamente el modo edición al validar el LoRA entrenado.

---

**La Fase 1 está lista para entrenar. No falta código ni fotos.**

- `general` = **154 fotos** curadas, auditadas (texto, píxeles y diversidad) y sin escenas repetidas.
- ZIP generado y verificado: **`data/staging/sempertex-general-v003-fal.zip`** (154 img + 154 .txt,
  27,6 MB). Manifiesto: `data/processed/export-general-2026-08-27.json`.
- Presupuesto: **US$70, US$0 gastados.**

**Próximo paso: subir ese ZIP a [fal.ai FLUX.2 trainer](https://fal.ai/models/fal-ai/flux-2-trainer)**
con rank 16, learning rate 2e-4, **~4.000 pasos ≈ US$25,60**. El §7 del plan pide **parar si el
costo que muestra fal antes de "Start" difiere más de 10%** de esa cifra.

**Después de entrenar**: actualizar trigger y URL del modelo en `src/lib/ia/sempertex-lora.ts:78`
(hoy dice `eventdecor_style_v1`; el ZIP nuevo usa **`eventdecor_style_v2`**, porque el v1 sigue
vivo en producción y reusarlo colisionaría).

Todo lo de abajo es el detalle de cómo se llegó acá, por secciones (§4 a §9 son de esta sesión).


Estás retomando trabajo en `C:\Users\davidt\Downloads\demo-decoracion` (repo Next.js). El documento va por acumulación: **la sección "Sesión 3" es la más reciente y tiene prioridad**, después "Sesión 2" (esta de acá abajo), después el handoff de sesión 1 al final. Si hay contradicciones, gana la sesión más nueva.

## ⚠️ Sigue habiendo otra sesión trabajando en paralelo en el mismo repo

Mismo aviso que antes: otro proceso puede tocar `src/lib/ordenes/generarCaption.ts` (motor de captioning, hoy `opencode` + `openai/gpt-5.6-luna`) sin avisar. Releer ese archivo antes de asumir cómo se generan los captions.

## Qué se hizo en esta sesión

### 1. Categoría "no_asignada" separada de "general"

`general` cumplía doble función: "no calza en ningún tema" Y "nadie lo revisó todavía". Se separó:
- `src/lib/ordenes/tipos.ts`: `CATEGORIAS_ENTRENAMIENTO` ahora incluye `no_asignada` (primera de la lista).
- Todos los defaults (`feedbackVacio`, API de feedback, ruta manual, `generarCaption.ts`, scraper del blog) cambiaron su fallback de `"general"` a `"no_asignada"`.
- Migración ejecutada una sola vez: [`scripts/migrar-categoria-no-asignada.ts`](scripts/migrar-categoria-no-asignada.ts) — movió 398/401 fotos de `general` a `no_asignada` (solo se quedaron en `general` las que un humano puso ahí a propósito). **Ya corrió, no hace falta repetirla** salvo que aparezcan datos viejos sin migrar.

### 2. Panel de admin: edición inline en la vista Lista

En `src/components/admin/OrdenesTab.tsx`, cada tarjeta de foto ahora tiene, sin abrir ningún modal:
- Un `<select>` de categoría (guarda al vuelo vía `cambiarCategoria`).
- Un botón clickeable "apta para entrenamiento / no apta" (guarda al vuelo vía `cambiarApto`).

Ambos hacen `PUT /api/admin/ordenes/[numero]/feedback` conservando el resto del feedback, mismo patrón que el toggle de materiales que ya existía.

### 3. Balanceo de `general` por acabado Sempertex

[`scripts/balancear-categoria-general.ts`](scripts/balancear-categoria-general.ts): promueve fotos de `no_asignada` (aptas, con acabado reconocido) a `general` hasta un tope fijo por acabado (`TARGET_POR_ACABADO`, actualmente **30**). Los acabados escasos (CRISTAL, SILK, etc.) aportan todo lo que tienen igual; solo se recortan los abundantes (FASHION, REFLEX). Es re-corrible: si subís el tope y lo corrés de nuevo, solo agrega lo que falta.

Estado actual de `general`: **71 fotos** — FASHION 43, REFLEX 30, INFINITY 16, PASTEL MATE 13, METALIZADO 11, PASTEL DUSK 8, SATIN 6, LINK-O-LOON 5, 2 CARAS 5, SILK 3, CRISTAL 2.

Estado global: 401 fotos totales, ~328 en `no_asignada`, 71 en `general`, 2 en categoría temática (o sea: **los 5 LoRAs de acento por tema del plan v002 casi no tienen dataset todavía** — solo Navidad tiene un puñado).

Pendiente/decisión abierta: ¿subir más el tope de FASHION/REFLEX (quedan candidatas sin usar), o empezar a poblar temas de acento (Halloween, amor y amistad, XV años, fiesta infantil)?

### 4. Auditoría de tamaños en captions — LA PARTE MÁS CRÍTICA

El usuario dejó explícito que un fallo en tamaños/proporciones de globo es un **fallo fundamental** del proyecto. Se hizo trabajo serio acá:

- [`scripts/auditar-tamanos-captions.ts`](scripts/auditar-tamanos-captions.ts): cruza cada mención de tamaño (código R-N o medida en pulgadas) en los 401 captions contra el `desglose.json` real de la orden (cualquier forma de globo, no solo redondo). **Resultado: 0 tamaños inventados.** OJO: la primera versión tenía un bug (solo cruzaba contra redondos) que generó 29 falsos positivos con globos metalizados/foil — ya corregido y reverificado.
- **Importante, esto lo confirmó un consejo de 5 IAs (LLM council) y luego investigación de literatura real**: esa auditoría de 0/401 es *necesariamente cierta por construcción* (el modelo de visión solo puede citar códigos que ya están en el pedido) — prueba que no inventa números, **no prueba que la comparación de tamaño sea visualmente correcta**. Reportes completos en:
  - [`reports/council-tamanos-proporcion-lora-v001.html`](reports/council-tamanos-proporcion-lora-v001.html) / `.md` — consejo de 5 asesores + revisión cruzada + síntesis. Veredicto: falta verificación humana texto-contra-imagen, no solo texto-contra-pedido.
  - [`reports/literatura-tamanos-proporcion-lora-v001.md`](reports/literatura-tamanos-proporcion-lora-v001.md) — investigación en inglés (GenEval, HRS-Bench, CoMPaSS, SPRIGHT, etc.). Veredicto: la debilidad de modelos de difusión para tamaño/posición relativa **está bien documentada** (no es paranoia), y **60-140 fotos es poco** para que un LoRA aprenda una regla generalizable (los estudios que sí funcionaron usaron 500-15.000+ imágenes). Nota técnica: FLUX.2 usa Mistral Small 3.1 como encoder de texto, no CLIP/T5 — ese modelo no está benchmarkeado en nada de lo encontrado, incertidumbre extra.
- **Hice yo mismo un chequeo visual real** (no solo texto): miré 8 fotos reales de `general` con `proporcion_relativa_presente=true` contra su descripción. Resultado: **6/8 correctas, 1 imprecisa (#13599), 1 claramente mal (#13223 — dice "globos progresivamente más chicos hacia arriba del arco" pero la foto real tiene globos grandes arriba también)**. La frase "progressively smaller... near the top" solo aparece en 5/401 captions — no es un hábito sistemático, fue puntual.

### Pendiente inmediato de esto (recomendado por consejo + literatura + mi propio chequeo)

1. ~~**Corregir el caption de la orden #13223**~~ — ✅ HECHO (sesión 3, ver abajo).
2. ~~Canonicalizar el formato de tamaños~~ — ✅ HECHO (sesión 3, ver abajo).
3. ~~Considerar un chequeo visual humano más grande (25-30 fotos, umbral de aceptación definido antes de mirar resultados)~~ — ✅ HECHO (sesión 3, §4). Resultado: banda AMARILLO. **Queda pendiente la validación humana**: el chequeo lo hizo Claude, no una persona, sobre la misma muestra congelada — está disponible en `reports/muestra-chequeo-proporcion-v001.json` para re-evaluar a mano si se quiere la validación fuerte.
4. Guardar como plan B si la prosa sola no rinde después de entrenar: condicionamiento espacial tipo bounding-box/ControlNet (paper citado: arxiv.org/abs/2510.21763, "Proportion ControlNet").

---

## Sesión 3 — correcciones de proporción + canonicalización de tamaños

### 1. Captions de proporción corregidos (2, no 1)

- **#13223** (el que ya estaba identificado): decía "progressively smaller balloons cluster near the top of the arch". Falso — la foto tiene R-18 grandes tanto en la base como en la corona, y los R-5 son racimos de acento sueltos. Reescrito como mezcla orgánica de tres calibres.
- **#13599** (estaba marcado solo como "impreciso" — en realidad estaba **mal, y al revés**): decía que el corazón foil plateado era *"a smaller silver heart-shaped balloon"*. El pedido tiene el corazón en **18 IN** y TODOS los látex redondos en un único **R-12**: el corazón es más GRANDE que los redondos, no más chico. Además la foto no tiene dos tamaños de redondo — el racimo del techo se ve más grande solo por estar más cerca de la cámara. Reescrito para decir eso explícitamente. De paso se corrigió "matte black" → "metallic black" (el producto es GLOBO LATEX REDONDO **METAL** NEGRO).

Ambos quedaron con `caption_status: "editado_manualmente"` y `source: "...+correccion-humana"`. Backup del original en `caption-1.json.bak` de cada carpeta.

> Nota de método: los dos errores son de tipos distintos y ninguno lo agarra la auditoría de texto — uno inventa un **gradiente** que no existe, el otro confunde **perspectiva con tamaño**. Esto refuerza el veredicto del consejo: la verificación texto-contra-pedido no sustituye mirar la foto.

### 2. Canonicalización del formato de tamaños

**Regla canónica adoptada**: la primera mención de cada código en un campo va glosada — `R-12 (12-inch)`, o `(R-12, 12-inch)` si el código ya venía entre paréntesis. Menciones siguientes pueden quedar como `R-12`. Nunca `N in`, `N inches` ni `N"`.

**Por qué esa regla y no otra** (esto es lo importante, no el estilo): en inferencia la app **nunca dice "R-12"**. `src/lib/ia/tamano-fisico.ts` traduce el SKU a pulgadas+cm antes de mandarlo al modelo de imagen (`"12-inch (30.5 cm) round latex balloon"`), y el comentario de cabecera de ese archivo lo dice textual: *"un modelo de imagen no sabe qué es R-12"*. Entrenar el LoRA con captions que dicen `R-12` a secas le enseña a asociar el estilo a un token que **no aparece nunca en el prompt de generación real**. La glosa alinea el vocabulario de entrenamiento con el de inferencia.

- Fuente arreglada: `src/lib/ordenes/generarCaption.ts` — el prompt ahora declara la forma canónica explícitamente y el ejemplo del paso 6 la usa. Los captions nuevos ya salen bien.
- Backfill: [`scripts/canonicalizar-tamanos-captions.ts`](scripts/canonicalizar-tamanos-captions.ts) — `npx tsx scripts/canonicalizar-tamanos-captions.ts` (dry-run) / `--aplicar`. **Ya corrió**: 103 de 401 archivos tocados, 138 campos. Es idempotente (2da corrida = 0 cambios) y deja journal reversible antes/después en `data/processed/canonicalizacion-tamanos-2026-08-26.json`.
- Reverificado después del backfill: `auditar-tamanos-captions.ts` sigue en **0 tamaños inventados** / 401.

### 3. Dos guardas nuevas en el prompt de captioning

Derivadas de los dos errores reales de arriba, agregadas al paso 6 de `generarCaption.ts`:
- **(a) perspectiva ≠ tamaño** — si el pedido confirma un solo diámetro redondo, todos los redondos de la foto son ese diámetro por distintos que se vean; hay que decirlo explícitamente en vez de describir una diferencia inexistente.
- **(b) no inventar gradiente** — "progressively smaller toward the top" solo vale si la foto muestra ese degradado ordenado; en guirnalda orgánica lo normal es mezcla sin orden.

### 4. Chequeo visual de proporción con umbral pre-registrado — HECHO

El punto 3 del pendiente ("chequeo visual de 25-30 fotos con umbral definido antes de mirar") se
ejecutó completo:

- [`reports/protocolo-chequeo-visual-proporcion-v001.md`](reports/protocolo-chequeo-visual-proporcion-v001.md)
  — protocolo escrito y congelado **antes** de mirar la primera foto: población, rúbrica de 3
  etiquetas, sub-tipos de error, umbrales de decisión y reglas de conducta.
- [`scripts/muestrear-chequeo-proporcion.ts`](scripts/muestrear-chequeo-proporcion.ts) — muestra
  n=30 con PRNG de semilla fija (no re-tirable sin que se vea en el diff), congelada en
  `reports/muestra-chequeo-proporcion-v001.json`.
- [`reports/resultados-chequeo-visual-proporcion-v001.md`](reports/resultados-chequeo-visual-proporcion-v001.md)
  — resultados.

**Resultado: 14 correctos / 11 imprecisos / 5 incorrectos → 16,7 % de error → banda 🟡 AMARILLO.**
IC 95 % [7,3 % – 33,6 %]: n=30 no distingue 10 % de 25 %, tal como el protocolo anticipó.

**Decisión pre-registrada que dispara AMARILLO**: no incluir `proporcion_relativa_descripcion` en
el texto de entrenamiento de la primera corrida, o revisar las 107 a mano antes de incluirlo. El
`caption` base no se toca.

**El hallazgo más accionable**: **2 de los 5** errores son detectables *sin visión* (una primera
versión del informe dijo 3 — se corrigió al implementarlo y medirlo). `auditar-tamanos-captions.ts`
solo detectaba tamaños *inventados*, no relaciones *contradichas*. Ya está implementado, ver §5.

Datos importantes de población: de 401 captions, 297 tienen `proporcion_relativa_presente=true`,
pero **solo 107 son además aptos para entrenamiento** — esa es la población que importa.

Colaterales verificados sobre el corpus completo (detalle en el informe):
- **12** captions con meta-comentario del prompt filtrado al texto (una primera cuenta dijo 3; el detector tenía patrones muy estrechos). El delator es la palabra **"confirmed"**, que es vocabulario del prompt, no de la imagen.
- **22** captions (no 8) con un ratio calculado en vez de observado — ver §6.
- 2 pares de fotos binariamente idénticas dentro de la misma orden: `15142/foto-1==foto-2`, `20070/foto-3==foto-4`.

## Sesión 3 (cont.) — §5: reglas de auditoría implementadas y limpieza aplicada

### Nuevas reglas en `auditar-tamanos-captions.ts`

El script ya no detecta solo tamaños *inventados*. Ahora corre cuatro reglas y el resumen las
desglosa por tipo. La lógica nueva vive en [`scripts/lib/comparacion-tamanos.ts`](scripts/lib/comparacion-tamanos.ts):

- `inversion_color` — llama grande a un color cuyo diámetro máximo comprado está por debajo del
  de otro color al que llama chico.
- `variacion_sin_respaldo` — afirma variación de tamaño con un solo diámetro redondo comprado.
- `meta_comentario` — el texto habla del pedido en vez de la imagen.

**Test de regresión**: `npx tsx scripts/test-comparacion-tamanos.ts` — 12/12, con 7 controles
negativos verificados contra la foto. Correrlo si se toca el módulo.

**Gate por fuente, importante**: las dos primeras reglas asumen que *el desglose enumera todos los
tamaños presentes*. Eso vale para órdenes reales y **no** para las entradas del blog, cuyo
desglose es el carrusel inferido. La primera corrida dio 5 hallazgos; verifiqué los 3 nuevos
mirando la foto y **2 eran falsos positivos** (`950000058`, `950000136`), los tres del blog. El
discriminador es **`desglose.cliente`**: las 204 órdenes reales lo traen siempre, las 183 del
blog siempre en `null` — separación perfecta, verificada. Las reglas no opinan sobre el blog.

**Resultado sobre las 401**: 0 hallazgos nuevos. Solo marcó los 2 errores ya conocidos. Es una
guarda de regresión para captions futuros, no una herramienta de descubrimiento.

### Limpieza aplicada

- 12 captions limpiados de meta-comentario: [`scripts/limpiar-meta-comentario-captions.ts`](scripts/limpiar-meta-comentario-captions.ts)
  (`--aplicar`, journal reversible en `data/processed/`). Ya corrió.
- 2 captions corregidos: `13309` (comparación invertida) y `12967/foto-4` (variación sin
  respaldo). Con `13223` y `13599` son **4** captions `editado_manualmente` en total.
- 2 fotos duplicadas desactivadas con `aptoParaEntrenamiento: false` y nota explicativa.
  **No se borró ningún archivo.** Se conservó `15142/foto-2` por estar ya promovida a `general`.
  Población entrenable con proporción: **107 → 105**.
- Fuente arreglada en `generarCaption.ts`: el prompt ahora prohíbe explícitamente hablar del
  pedido dentro del texto ("confirmed", "the order", "purchased").

Auditoría final: **0 violaciones ALTA** en las cuatro reglas. `tsc --noEmit` y eslint limpios.

## Sesión 3 — §6: ratio calculado, y afinado de reglas

### Cuarta regla: `ratio_calculado`

Los ratios que aparecen en los captions son **1.8, 2.4 y 1.33** = exactamente 9÷5, 12÷5 y 12÷9,
los cocientes entre calibres del catálogo. Es división, no medición. Son **22 captions** (no 8
como decía antes; faltaban las variantes "about"/"approximately" y los otros cocientes) y **las
22 son del blog, sin una sola orden real**.

A diferencia de las otras dos reglas nuevas, esta **no depende de que el desglose esté completo**
— es una propiedad del texto — así que corre también sobre el blog, que es donde está el problema.

**Impacto acotado: solo 2 de las 22 estaban aptas** (`950000178`, `950000181`). Ambas corregidas
mirando la foto. Las otras 20 no entran a entrenar y quedan marcadas por la auditoría, así que la
alerta salta sola si alguien las promueve. **No las reescribí a mano a propósito**: su desglose es
inferido (no se pueden anclar afirmaciones de tamaño) y lo que las bloquea de verdad no es el
texto sino que nadie revisó todavía si esas ~183 fotos del blog pertenecen al dataset.

También arreglado en la fuente: el prompt ahora prohíbe calcular la proporción dividiendo los
números dados.

### Regla de omisión afinada: 5 alertas → 1

`posible_omision` marcaba 5 casos. **4 eran fotos de paquetes sin abrir / flat lays de producto**
(`15151`, `17385`, `7559`, `7953`), donde no marcar proporción relativa es lo correcto: no hay
nada instalado que comparar. `feedback.esDecoracion` los separa exactamente. Queda **1** caso real
(`17060`, una guirnalda apta con mezcla de tamaños leve) para criterio humano.

### El test se degradaba al arreglar los datos

`test-comparacion-tamanos.ts` leía los captions vivos, así que empezó a fallar en cuanto corregí
los dos errores — justo cuando debía seguir pasando. Reescrito: los casos positivos ahora usan
**fixtures congelados** (el texto exacto al detectarse el error) y solo los controles negativos
leen disco. Si tocás el módulo, corré `npx tsx scripts/test-comparacion-tamanos.ts` (12/12).

### Cobertura: 3 de 5, pero no por el caso que dije al principio

Dije "3 de 5", corregí a "2 de 5" al implementar, y con la regla de ratio volvió a **3 de 5**.
El "3" original era el número correcto **con el caso equivocado**: no es `8411` (error posicional,
indetectable desde el pedido) sino `950000181` (plantilla aritmética). Ojo: la regla de ratio
marca una *construcción sospechosa*, no una contradicción dura como las otras dos.

### Números de higiene verificados

- **0** fotos aptas con `esDecoracion=false` (ninguna factura ni flat lay se coló).
- **0** captions aptos truncados.
- **140 aptas de 401** — ese es el tamaño real del set entrenable. Leerlo junto al hallazgo de
  literatura: los estudios que sí lograron una regla generalizable de tamaño usaron 500-15.000+.

## Sesión 3 — §7: Fase 1 (`general`) curada y auditada

Decisión del usuario: **la Fase 1 se centra en `general`** (el LoRA base de estilo), buscando la
mayor calidad posible antes de gastar presupuesto.

### Auditoría técnica nueva: [`scripts/auditar-calidad-imagenes.ts`](scripts/auditar-calidad-imagenes.ts)

Hasta ahora solo se auditaba el TEXTO de los captions. Este mira los píxeles: resolución,
relación de aspecto, compresión y duplicados exactos entre órdenes distintas.

**Sobre el umbral de resolución, para no repetir el error**: fal.ai pide 1024×1024 mínimo, pero
aplicar 1024 a rajatabla es engañoso — **154 fotos del corpus miden exactamente 1000px** de lado
corto (son las del blog, tamaño web estándar), a un 2,4% del mínimo, invisible. Y 900 tampoco
sirve: dejaba fuera dos fotos de 899px. **El umbral quedó en 800px**, que separa limpio el grupo
real de recortes de teléfono (≤720px, donde el reescalado ya es del 40%+).

### `balancear-categoria-general.ts` extendido

Ahora hace purga + promoción en ese orden (importa: una foto inservible ocupando cupo hace que el
tope se calcule mal). Flags nuevos: `--tope=N`, `--min-px=N`, `--dry-run`, `--incluir-sin-acabado`.

`--incluir-sin-acabado` promueve también las candidatas sin acabado Sempertex reconocido, siempre
que su `elementoPrincipal` nombre una estructura de globos. Son fotos buenas (arcos y paredes a
1200px) cuyo pedido no tenía producto que matchear — varias son inscripciones a cursos. La regla
retuvo correctamente 3 que no son globos: mesa de picnic, mesa de dulces, guirnalda de banderolas.

**Ya corrió**: `general` pasó de **70 a 105 fotos** (+44 promovidas, −9 purgadas por resolución).

### Auditoría de diversidad: [`scripts/auditar-diversidad-general.ts`](scripts/auditar-diversidad-general.ts)

Este era el chequeo pendiente que el plan de entrenamiento (§2.1) pedía explícitamente: *"si el
80% de las imágenes comparten cuarto/luz/ángulo, el LoRA sobreajusta a esas condiciones"*.
Mide fuente, escenario, iluminación y tipo de estructura, más un **hash perceptual dHash** para
encontrar escenas casi iguales (no solo duplicados byte a byte).

**Resultado: el set está mejor de lo que temía.**

| eje | resultado |
|---|---|
| fuente | **98% órdenes reales en sitio**, solo 2% del blog. El miedo a que dominaran las tomas de estudio con fondo blanco era infundado. |
| escenas casi iguales | **cero**. Ninguna foto desperdicia cupo repitiendo otra. |
| tipo de estructura | bien repartido: arco 34%, guirnalda 27%, pared 10%, columna 8%, bouquet 7%. |
| iluminación | repartida, sin concentración grave (máx. 41% cálida/tenue). |
| escenario | 65% "backdrop montado" — **verificado que NO es artefacto** del clasificador ni monotonía: son backdrops todos distintos (póster de Spider-Man, foil de Frozen, panel arco, cartel corporativo). Es una regularidad del oficio, no condiciones repetidas. |

**Única consecuencia práctica del 65%**: el LoRA probablemente aprenda que "casi siempre hay algo
montado detrás". Es fiel a cómo se ve una decoración Sempertex, pero si pedís una guirnalda
suelta puede meterte un backdrop igual.

### Revisión del pool de órdenes reales: agotado

Se revisaron las 65 fotos de órdenes reales ≥800px que no estaban aptas. **61 tienen
`esDecoracion=false` y ya estaban bien clasificadas**: paquetes sin abrir, cajas de envío, globos
sueltos, capturas de pantalla, certificados, un rodillo de cocina. No son candidatas para un LoRA
de estilo.

> **Corrección de un número mío.** Antes reporté "65 fotos usables de órdenes reales" como pool de
> crecimiento. Ese filtro miraba resolución y aptitud pero **no si eran decoraciones**. El pool
> real de órdenes reales está agotado.

De las 9 que sí nombran una estructura de globos, se miraron todas:

| orden | veredicto | por qué |
|---|---|---|
| `10657` | **rescatable recortando** | pared de globos completa y sin oclusión; persona al borde izquierdo |
| `20604` | **rescatable recortando** | cohete de globos completo; persona al lado, no delante |
| `17295` | marginal | guirnalda circular excelente, pero instructora cruzando el centro del aro y dos cabezas abajo |
| `16397` | marginal | alas de mariposa: pieza vestible de práctica, fuera de la distribución del LoRA base |
| `16702` | no | selfie, personas ~60% del cuadro |
| `17290` | no | seis personas en fila tapando la pared |
| `20540` | no | retrato centrado en la persona |
| `15414` | no | foto de salón de curso; el arco queda chico al fondo |
| `19774` | no | mismo patrón de certificado grupal |

**Patrón útil**: varias fotos de graduación de curso tienen esculturas reales y completas con una
persona parada AL LADO. Recortar la persona las salvaría. No se hizo porque genera imágenes
derivadas (archivos nuevos) y eso es una decisión de estructura del dataset, no una limpieza.

### Conclusión: la Fase 1 ya está lista, no le falta volumen

Esto corrige el marco que yo mismo había planteado. **fal.ai documenta 9-50 imágenes como
suficientes para un LoRA de estilo**, y la tabla de presupuesto del plan asumía **60-80 imágenes**
para el LoRA base. **`general` tiene 105: ya está por encima del objetivo del plan y al doble del
tope recomendado por fal.**

El "cuello de botella de volumen" que identifiqué venía de anclarme en las 500-15.000 imágenes de
la literatura, que eran para aprender una regla de **tamaño** generalizable — objetivo que ya se
descartó para la corrida 1. Para **estilo**, 105 fotos limpias, diversas y sin escenas repetidas
es un dataset holgado.

**Lo que falta para entrenar no son fotos: es el script de export** (ZIP + .txt), que no existe.

Si más adelante se quiere más volumen, el único pool grande son las **167 fotos del blog** — pero
ojo: hoy `general` es 98% en sitio y ese pool es de estudio, así que meterlas de golpe da vuelta la
composición y reintroduce el riesgo que hoy no existe. Correr
`auditar-diversidad-general.ts` después de cada tanda.

### Costo real de entrenar (verificado en fal.ai hoy)

fal.ai cobra **US$0,0064 por paso**, sin componente por imagen. O sea que **el tamaño del dataset
casi no mueve el costo** — lo que sube es cuántos pasos querés. Para 750 imágenes: 4.500 pasos
(~6 épocas) = US$28,80; 7.500 (10 épocas) = US$48; 10.000 (~13) = US$64. Todo dentro de los US$70.

Ojo con el contrapunto: fal documenta **9-50 imágenes como suficientes para un LoRA de estilo**, y
el plan cita que "calidad y diversidad ganan sobre volumen". Las 500-15.000 de la literatura eran
para aprender una regla de **tamaño** generalizable — objetivo que ya se descartó para la corrida 1.

## Sesión 3 — §8: +49 fotos del blog. `general` = 154

Decisión del usuario: sumar ~50 fotos del blog. Se hizo **seleccionando**, no tomando 50 al azar,
porque la composición del set era justo lo que estaba en juego.
[`scripts/seleccionar-blog-para-general.ts`](scripts/seleccionar-blog-para-general.ts).

### Dos fugas del filtro que solo aparecieron al MIRAR las fotos

1. **Detectar "estudio" por texto no funciona.** El primer filtro buscaba "white background" en el
   caption; dejaba pasar tomas de estudio evidentes (#950000045) porque su caption no nombraba el
   fondo. Se cambió a **mirar los píxeles del borde**: de 62 "escenas reales" quedaron 46.
2. **Los PNG con canal alfa no se detectaban.** Recortes de producto sin fondo (#950000110): al
   aplanar la transparencia quedan NEGROS, no blancos, así que el chequeo de blanco no los veía.
   Con detección de alfa, de 46 quedaron **27** escenas reales de verdad.

De 167 candidatas del blog, **140 son tomas de estudio y solo 27 son escenas reales.**

### La estrategia de mezcla, y por qué

27 escenas reales no alcanzaban para 50. Se completó con tomas de estudio **pero solo las que
nombran el fondo en su caption** (90 de 137 lo hacen). Razón: con el fondo descrito, el modelo
puede tratarlo como una variable más en vez de absorberlo dentro del token de estilo — el
principio de captioning que cita el plan. Las 48 de estudio cuyo caption NO nombra el fondo se
dejaron fuera: ahí no hay nada que separe "fondo blanco" del estilo.

### Revisión visual con contact sheets

Se miraron las 50 propuestas (en grillas de 12-20, no de a una). **49 aprobadas, 1 rechazada**:
`950000069` era un solo tubito dorado torcido sobre blanco — un detalle de producto, no una
decoración.

### Resultado: sumar blog MEJORÓ la diversidad

Contra lo que se temía. Comparando antes (105 fotos) y después (154):

| eje | antes | después |
|---|---|---|
| fuente | 98% en sitio / 2% blog | **67% / 33%** |
| concentración de escenario | backdrop **65%** | backdrop **50%** |
| concentración de iluminación | máx **41%** | máx **29%** |
| arco (el tipo dominante) | 34% | **28%** |
| centro_mesa | 2% | **6%** |
| bouquet | 7% | **10%** |
| escenas casi iguales | 0 | **0** |

La selección por round-robin priorizando tipos flojos hizo lo que se buscaba: bajó la
concentración en todos los ejes en vez de subirla. El único costo es el mix de fuente, que sigue
siendo mayoría en sitio.

### Un detalle que no afecta la corrida 1

7 de las 49 promovidas traen la plantilla del ratio calculado (`ratio_calculado` en la auditoría,
ahora 20 marcadas en total). **Están solo en `proporcion_relativa_descripcion`, nunca en
`caption`** — verificado una por una. Como ese campo queda fuera del texto de entrenamiento de la
corrida 1, no llega al modelo. Si alguna vez se decide incluirlo, hay que reescribir esas 7.

**Estado de la Fase 1: 154 fotos en `general`**, muy por encima de las 60-80 que asumía la tabla
de presupuesto del plan y del rango 9-50 que fal.ai documenta como suficiente para estilo.

## Sesión 3 — §9: script de export + ZIP generado

[`scripts/exportar-dataset-fal.ts`](scripts/exportar-dataset-fal.ts) — el que faltaba. Formato:
ZIP plano con `{orden}-{indice}.jpg` + `{orden}-{indice}.txt`, igual que
`package-fal-final-dataset.py` usaba para el dataset de producto.

Cuatro cosas que hace además de comprimir:

1. **Pre-vuelo de texto que ABORTA.** Corre las reglas de auditoría sobre lo que va a exportar y
   no escribe nada si encuentra algo. El export es el último punto barato: después del upload ya
   se pagaron los pasos.
2. **Aplana el canal alfa sobre blanco** — hay 7 PNG de producto recortado entre las aptas.
3. **Renombra a `{orden}-{indice}`** — casi todas se llaman `foto-1.jpg` y colisionarían en un
   ZIP plano.
4. **Manifiesto JSON** con qué entró, de dónde salió y qué transformación recibió cada imagen.

Por defecto exporta **solo el campo `caption`**, no `proporcion_relativa_descripcion` — la
decisión pre-registrada del chequeo visual v001. `--incluir-proporcion` la anula.

**Ya generado**: `data/staging/sempertex-general-v003-fal.zip` — 154 imágenes + 154 `.txt`,
27,6 MB, verificado. Manifiesto en `data/processed/export-general-2026-08-27.json`.

### Trigger: v2, no v1

Los 154 captions arrancaban con `eventdecor_style_v1`, que es el trigger del LoRA **que ya está
vivo en producción** (`src/lib/ia/sempertex-lora.ts`). Reusarlo colisionaría. El ZIP se generó con
`--trigger=eventdecor_style_v2`. **Cuando el LoRA nuevo esté entrenado hay que actualizar el
trigger y la URL del modelo en `sempertex-lora.ts`.**

### Costo real, con precios verificados hoy en fal.ai

- Entrenamiento: **US$0,0064 por paso** (sin componente por imagen).
- Inferencia para evaluar: **US$0,021 por megapíxel** ≈ 2,2 centavos por imagen de 1024×1024.

Para 154 imágenes, a batch 1:

| Pasos | Épocas | Costo |
|---|---|---|
| 1.540 | 10 | US$9,86 |
| 3.080 | 20 | US$19,71 |
| **4.000** | **26** | **US$25,60** |
| 4.620 | 30 | US$29,57 |
| 6.160 | 40 | US$39,42 |

**Recomendado: ~4.000 pasos = US$25,60**, más ~US$1 de inferencia para evaluar unas 45 imágenes.
Deja **~US$43 del presupuesto de US$70 para iterar**, que es exactamente lo que el §5 del plan
decía que el presupuesto tenía que comprar: iteración, no una sola corrida gigante.

Ojo: más pasos NO es linealmente mejor. Con rank 16 (lo que recomienda la literatura del plan
para estilo), pasar de ~30 épocas empieza a sobreajustar y el LoRA pierde flexibilidad.

### Trampa que ya mordió una vez

`muestrear-chequeo-proporcion.ts` reescribía el JSON de la muestra congelada en cada corrida. Al
desactivar las 2 fotos duplicadas la población bajó a 105, y una corrida de rutina **rebarajó las
30 y borró el registro de lo evaluado**. Se reconstruyó a mano y se le puso una guarda: ahora
hace falta `--rehacer` para sobrescribir. El archivo restaurado lleva un campo
`nota_reconstruccion` que explica todo esto.

### Dato de conteo, por si confunde

Son **387 carpetas de orden** y **401 archivos de caption** (hay carpetas con más de una foto). Cuando un script reporta 385 es porque solo leyó `caption-1.json`.

### Nota irrelevante pero por si aparece

Existe un LoRA v1 ya entrenado y activo en producción (`src/lib/ia/sempertex-lora.ts`, trigger `eventdecor_style_v1`, corrida del 14 de agosto en `data/processed/sempertex-training-run-v002.json`). **El usuario dijo explícitamente que esa corrida no importa** ("lo hice en otra cuenta low budget, no tiene nada que ver") — no usarla como precedente ni referencia de calidad. Sigue siendo la que usa la app en producción hoy, eso sí.

---

# Handoff anterior (sesión 1, sigue siendo contexto válido)

Estás retomando trabajo en `C:\Users\davidt\Downloads\demo-decoracion` (repo Next.js). Hay una sesión anterior larga que armó todo el pipeline de dataset para un LoRA de estilo de decoración con globos. No rediseñes desde cero — lee esto primero.

## Dónde vive todo

- **Datos por orden/entrada** (fuera del repo): `C:\Users\davidt\Downloads\ordenes-decoracion\<numero>\` — carpeta con `foto-1.{jpg,png,webp}`, `desglose.json`, `caption-1.json`, `feedback-1.json`. Mismo esquema para las 3 fuentes que ya conviven ahí:
  - **Números de 4-6 dígitos**: órdenes reales de Shopify. 202/202 completas, ya cerradas.
  - **Números que empiezan en `95` (9 dígitos)**: scrapeadas del blog público `sempertex.com/blogs/idea-de-fiesta`. Primeras 8 páginas hechas (~183 notas), quedan 33 de 41 páginas sin tocar.
  - **Números de 13 dígitos (timestamp)**: agregadas a mano desde "Agregar imagen" del panel admin.
- **Catálogo local sincronizado**: SQLite en `data/demo.sqlite`.
- **Plan de entrenamiento**: `docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md` — arquitectura: 1 LoRA base "Sempertex style" + 5 LoRAs de acento por tema (Halloween, Navidad, bodas, cumpleaños infantil, amor y amistad), presupuesto real US$70, $0 gastado todavía.

## Panel de admin (`/admin` → pestaña "Órdenes (dataset)")

Tres vistas: Lista (edición inline de categoría/apto ahora), Galería (filtro por categoría), Estadísticas (salud del dataset, acabados, alertas).

## Gotchas operativos

1. Login: `.env.local` → `APP_PASSWORD`.
2. Dev server: `preview_start` con nombre `demo-decoracion` en `.claude/launch.json`.
3. Para pegarle a la API del admin desde script hace falta el cookie de sesión.
4. No hay script de empaquetado a ZIP para fal.ai todavía. Tampoco script que dispare el training job.
5. Scraper de Ideas de Fiesta: usar `--particion=k/n` si se corre en paralelo.

## Qué sigue (decisiones pendientes)

1. ~~Corregir caption #13223, canonicalizar formato de tamaños.~~ ✅ hecho en sesión 3.
2. Decidir: ¿más volumen en `general` o poblar temas de acento primero?
3. Revisión humana de las ~183 fotos del blog (activar `aptoParaEntrenamiento`).
4. Armar script de export por categoría (ZIP + .txt) para lanzar el training real.
5. Confirmar si seguir con `opencode`/GPT para captions o volver a Claude.
