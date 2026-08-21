# Plan de entrenamiento Sempertex v002

Fecha: 2026-08-21
Reemplaza a: `PLAN-ENTRENAMIENTO-SEMPERTEX-v001.md` (eliminado a petición explícita — v001 solo cubría el trial de validación de pipeline de 15 imágenes, no un entrenamiento real).
Presupuesto real asignado: **US$70** (antes se evaluaban niveles de US$7–64; este documento ya no es un menú de opciones, es la arquitectura recomendada para ese monto).
Temas objetivo declarados: **Halloween, Navidad, bodas, cumpleaños infantiles, día del amor y la amistad.**

## 1. Objetivo

Reemplazar el LoRA de prueba (`eventdecor_style_v1`, 15 imágenes, 300 pasos, ya en producción como "LoRA Sempertex") por un entrenamiento real, fundamentado en literatura técnica y documentación oficial de fal.ai/FLUX.2, que cubra los 5 temas declarados sin que ninguno "contamine" visualmente a los demás.

## 2. Qué dice la investigación

### 2.1 Tamaño de dataset y calidad

fal.ai documenta 9–50 imágenes como suficientes para entrenar un LoRA de estilo; la comunidad converge en 20–25 imágenes como punto óptimo por concepto ([fal.ai FLUX.2 Trainer](https://fal.ai/models/fal-ai/flux-2-trainer), [Modal — Fine-tuning a FLUX.1-dev style LoRA](https://modal.com/blog/fine-tuning-flux-style-lora)). El hallazgo más consistente entre fuentes: **calidad y diversidad ganan sobre volumen** — si el 80% de las imágenes comparten cuarto/luz/ángulo, el LoRA sobreajusta a esas condiciones en vez de aprender el concepto ([Segmind — Easy Flux LoRA Training Guide](https://blog.segmind.com/easy-flux-lora-training-guide/)). Esto es relevante para Sempertex: **verificar antes de entrenar** que las 15 "escenas terminadas" del dataset maestro no comparten backdrop/iluminación entre sí.

### 2.2 Captioning

Principio compartido por todas las fuentes: el caption describe **todo excepto** el concepto que se quiere enseñar; el concepto vive en una palabra disparadora fija y corta ([Segmind](https://blog.segmind.com/easy-flux-lora-training-guide/), [fal.ai FLUX.2 Developer Guide](https://fal.ai/learn/devs/flux-2-developer-guide)). Los pipelines de auto-captioning suelen filtrar mal esto — vale la pena revisar a mano los `.txt` generados por `dataset:build-pilot`/`dataset:package-final` antes de enviar el ZIP, no confiar en el auto-caption ciego.

### 2.3 Hiperparámetros de referencia

No hay una receta única, pero el experimento mejor documentado para un LoRA de estilo FLUX en dataset pequeño (20–25 imágenes) usó **rank 16, learning rate 2e-4, ~4000 pasos**, y encontró contraintuitivamente que ranks bajos (8) dan resultados *más* ruidosos, no menos — los LoRA de estilo necesitan más rank que los de personaje ([Modal](https://modal.com/blog/fine-tuning-flux-style-lora)). Rank ≥64 en datasets chicos sobreajusta ([Segmind](https://blog.segmind.com/easy-flux-lora-training-guide/)). fal.ai no publica un número de pasos recomendado — cobra `US$0,0064 × pasos` sin mínimo ni máximo sugerido ([fal.ai FLUX.2 Trainer](https://fal.ai/models/fal-ai/flux-2-trainer)), así que el número de pasos es una decisión nuestra, no una default de la plataforma.

### 2.4 El riesgo real de meter 5 temas en un solo LoRA

Esto es lo que más literatura tiene y lo que más directamente afecta la petición de "Halloween + Navidad + bodas + cumpleaños + amor y amistad" en un solo entrenamiento. El fenómeno se llama **concept bleeding**: modelos como SDXL mezclan atributos entre conceptos distintos en la misma imagen porque el text encoder comprime todo el prompt en un número fijo de tokens ([arXiv 2606.03792 — Training-Free Multi-Concept LoRA Composition](https://arxiv.org/pdf/2606.03792)). Combinar LoRAs o conceptos ingenuamente "genera interferencia entre conceptos, degradando la fidelidad visual" (mismo paper). Hay investigación reciente construida específicamente para esto — **Ortho-Hydra / Anima LoRA** ([arXiv 2605.03252](https://arxiv.org/abs/2605.03252)) usa un mixture-of-experts con "subespacios de salida disjuntos" para que cada estilo tenga su propio subespacio en vez de promediarse en una sola matriz de bajo rango. El problema real: **eso requiere código de entrenamiento propio** — fal.ai es un trainer alojado sin esa opción, así que el principio no es aplicable directo, solo confirma por qué un solo LoRA con 5 temas mezclados es una apuesta arriesgada, no una simplificación segura.

### 2.5 La alternativa que sí es accionable hoy: componer LoRAs en inferencia, no en entrenamiento

Existe una línea de investigación completa sobre combinar *varios LoRAs ya entrenados por separado* en el momento de generar la imagen, evitando el problema de 2.4 por construcción — cada LoRA nunca vio los otros conceptos durante su propio entrenamiento ([arXiv 2505.23758 — LoRAShop](https://arxiv.org/html/2505.23758v1), [arXiv 2502.04923 — Cached Multi-Lora Composition](https://arxiv.org/pdf/2502.04923)). Esto **ya es viable en el código actual sin rediseño**: [`src/lib/ia/sempertex-lora.ts:82`](src/lib/ia/sempertex-lora.ts:82) manda `loras: [{ path, scale }]` como **arreglo** al endpoint `fal-ai/flux-2/lora` — hoy con una sola entrada, pero el esquema ya soporta varias. Apilar un LoRA base de estilo Sempertex + un LoRA pequeño de acento por tema (Halloween, Navidad, etc.), cada uno con su propio `scale`, es un cambio de código pequeño sobre algo que ya existe, no una reconstrucción.

### 2.6 Por qué "entrenar el tamaño de los globos" no es un problema de dataset (con o sin globos físicos)

Esto responde directo a tu pregunta. La literatura es inusualmente contundente en este punto específico: **"Text-to-Image Diffusion Models Cannot Count, and Prompt Refinement Cannot Help"** ([arXiv 2503.06884](https://arxiv.org/pdf/2503.06884)) — modelos de difusión SOTA aciertan solo 25–28% en benchmarks de conteo exacto, y **más datos o mejores prompts no lo arreglan**, es una limitación estructural del mecanismo de atención, no de los datos de entrenamiento. Un benchmark de 2601 confirma lo mismo para proporción/espacio: el razonamiento espacial es "el cuello de botella principal" incluso en modelos punta ([arXiv 2601.20354 — Everything in Its Place](https://arxiv.org/pdf/2601.20354)).

Traducido a tu caso: **fotografiar el globo físico no resuelve esto.** El problema no es "el modelo nunca vio un R-12 real", es que un modelo de difusión no representa internamente "12 pulgadas" como una cantidad — ni con foto real ni sin ella. Fotos aisladas de producto (sin nada al lado que dé escala) no le enseñan proporción a ningún modelo, con o sin muestra física.

Tu arquitectura actual ya tomó la decisión correcta sin saberlo: el plan v001 ya establecía "*El LoRA no será la base de datos... PostgreSQL/pgvector conserva identidad comercial, SKU, tamaños, colores*" — el tamaño exacto vive como texto/metadata recuperada (`tamano_codigo` en [`consultas.ts`](src/lib/shopify/consultas.ts)), no como algo que el LoRA deba "saber". Eso es exactamente el patrón que la investigación recomienda para compensar esta limitación: delegar conteo/medida exacta a una capa simbólica/estructurada en vez de a los pesos del modelo generativo ([arXiv 2305.13655 — LLM-grounded Diffusion](https://arxiv.org/pdf/2305.13655) usa el mismo principio con layouts explícitos).

**Qué sí puedes entrenar, y no necesita globos físicos:** proporción *relativa* en contexto, no medida absoluta. Tus 15 "escenas terminadas" ya tienen personas, puertas, mesas — anclas de escala reales — a diferencia de una foto de producto aislado. Si el captioning de esas fotos describe la relación de tamaño visible ("arco que llega a la altura del pecho de un adulto junto a la entrada"), el LoRA aprende composición realista sin necesitar saber que eso es "12 pulgadas". Esto no es una limitación temporal por falta de muestras — es cómo funciona (o no funciona) este tipo de modelo en general.

### 2.7 Proporción relativa *entre tamaños de globo* dentro de una misma composición

Precisión importante sobre 2.6: la intención original no era conteo ni medida absoluta, sino algo más específico — que un R-12 se vea consistentemente más chico que un R-24 cuando ambos aparecen en la misma composición (radio relativo, no pulgadas exactas). Es un problema distinto y más resoluble.

No existe un benchmark limpio que mida exactamente esto — T2I-CompBench evalúa *attribute binding* de color/forma/textura, no una categoría de tamaño explícita ([arXiv 2307.06350](https://arxiv.org/pdf/2307.06350)) — así que esta sección es razonamiento a partir de ese hallazgo, no una cita directa. Lo que sí confirma T2I-CompBench: los modelos fallan en asociar el atributo correcto al objeto correcto cuando hay más de uno de cada uno en el prompt ("attribute binding"); ese mismo mecanismo de falla aplica en principio a "grande/chico" igual que a "rojo/azul". La implicación práctica: cuanto más dependa el resultado de que el modelo *lea y asocie* la palabra de tamaño por texto, peor sale; cuanto más se le muestre el patrón *ya resuelto en píxeles*, mejor — esto es justamente lo que un LoRA aprende bien (patrón visual repetido), a diferencia de la aritmética de 2.6.

**Recomendación concreta:**

1. **La señal es la foto con varios tamaños juntos en el mismo cuadro, no un objeto externo de escala.** En decoración con globos esto ya es una técnica real: las guirnaldas orgánicas mezclan a propósito 5"/11"/16"/24" en la misma pieza. Si la librería de 200 imágenes tiene guirnaldas así, priorizarlas en el LoRA base — es la señal más fuerte posible para esto.
2. **Caption de la comparación, no del tamaño individual**: "globo pequeño R-12 al frente, globo grande R-24 detrás, aproximadamente el doble de diámetro" en vez de captionar cada uno por separado.
3. **Mientras no hay fotos reales con mezcla de tamaños**: una gráfica de comparación de tamaños (line-up R-5/R-9/R-12/R-24/R-36) casi seguro ya existe como material de marketing/catálogo de Sempertex — se puede sacar de Shopify hoy, sin muestra física, y es mejor señal de escala relativa que una foto de producto aislado. Usar solo un puñado de estas, no el grueso del dataset: es estética de gráfico/estudio, no de escena real, y el mismo riesgo de sobreajuste por imágenes repetitivas de 2.1 aplica aquí si domina el dataset.

## 3. Brecha detectada entre los 5 temas pedidos y lo que el pipeline ya curó

Los scripts existentes (`scripts/select-sempertex-final-training-dataset.ts:23`, `scripts/select-sempertex-training-products.ts:19`) clasifican imágenes en exactamente `"halloween" | "coquette" | "navidad" | "cumpleanos" | "genericos"`. Comparado con los 5 temas que acabas de pedir:

| Tema pedido | Estado real en el pipeline |
|---|---|
| Halloween | ✅ bucket propio, patrón claro (`HALLOWEEN\|CALABAZA\|BRUJA\|...`) |
| Navidad | ✅ bucket propio |
| Cumpleaños infantiles | ⚠️ bucket "cumpleanos" existe pero mezcla con `FUTBOL\|KARS\|NEON` — cumpleaños en general, no específicamente infantil |
| Día del amor y la amistad | ⚠️ las palabras clave (`AMOR\|LOVE\|CORAZON\|SAN VALENTIN`) existen, pero están **fusionadas dentro de "coquette"**, que es un bucket mucho más amplio dominado por princesa/Barbie/pastel — no hay forma de muestrear "amor y amistad" por separado hoy |
| Bodas | ❌ **no existe como bucket** — cae entero en "genericos"; el patrón `BODA\|MATRIMONIO` solo aparece en la selección de *productos*, no en la clasificación de *imágenes de entrenamiento* |

**Antes de armar el ZIP de entrenamiento**, esto necesita una actualización pequeña y localizada:
1. Agregar `"boda"` al tipo `Theme` y su regex (`BODA|MATRIMONIO|NOVIA|NOVIO|RAMO|ANILLO`) en ambos scripts de selección.
2. Separar `"amor_amistad"` de `"coquette"` con un patrón más angosto (`SAN VALENTIN|DIA DEL AMOR|AMOR Y AMISTAD`), dejando `coquette` para lo que realmente es (estética princesa/pastel) en vez de que absorba Valentín por compartir la palabra "amor".
3. Revisar cuántas imágenes reales del catálogo Shopify caen en los 2 buckets nuevos — si son pocas, ese es el cuello de botella real del entrenamiento, no el presupuesto.

Sin este paso, "entrenar para 5 temas" en la práctica sería entrenar para 3 temas bien curados y 2 diluidos dentro de baldes que no les pertenecen.

## 4. Arquitectura recomendada: LoRA base + acentos por tema, compuestos en inferencia

En vez de un solo LoRA con los 5 temas mezclados (riesgo de concept bleeding, §2.4) o 5 LoRAs completos independientes (más caro, sin capa de estilo compartida), la recomendación es la intermedia que ya soporta el código (§2.5):

- **1 LoRA base "Sempertex style"**: composición, material de globo, iluminación, look fotográfico — entrenado sobre el dataset más grande y diverso posible (los 5 temas juntos + genéricos), *sin* intentar que aprenda a distinguir temas.
- **5 LoRAs de acento pequeños**, uno por tema, cada uno entrenado *solo* con las imágenes de ese tema — aprenden la iconografía específica (calabazas, esferas navideñas, arcos de novia, torta de cumpleaños, corazones).
- En inferencia, [`sempertex-lora.ts`](src/lib/ia/sempertex-lora.ts:82) apila `loras: [{ path: base, scale: 0.8 }, { path: acentoDelTema, scale: 0.35–0.5 }]` según el `tipo_evento`/`estilo` que ya viene en el `Brief` ([tipos.ts](src/lib/types.ts)) — no hace falta que el cliente elija nada nuevo, el brief ya trae la señal.
- Si un evento no cae en ninguno de los 5 temas (ej. "fiesta corporativa"), se manda solo el LoRA base — se degrada con gracia, no falla.

**Precisión importante sobre qué le enseña el LoRA base**: nunca decide cantidad ni tipo de globo — eso ya lo determina la cotización/bill-of-materials, siempre como texto/dato exacto (`build-image-prompt.ts:124`, "Respect package quantities exactly"), igual que el tamaño (§2.6). Entrenar con decoraciones armadas reales no es "enséñale a copiar este producto" — es "enséñale el principio general de cómo se arma bien un bouquet/arco/guirnalda", que después aplica a cualquier combinación de globos que la cotización determine, incluida una que el LoRA nunca vio en entrenamiento. Confirmado que hace falta esto (no alcanza con prompt solo): prueba real sin LoRA en §7 no logró reproducir la estructura de un bouquet.

## 5. Presupuesto: US$70 (`US$0,0064 × pasos`, [fal.ai](https://fal.ai/models/fal-ai/flux-2-trainer))

| Entrenamiento | Dataset | Pasos | Costo |
|---|---|---|---|
| Base "Sempertex style" | ~60–80 img (15 escenas reales + 35–50 decoraciones armadas de todos los temas + 8–12 de proporción relativa §2.7; recalibrado hacia abajo de la estimación original de 150–180 al pasar a curación manual — §7) | 3000 | US$19,20 |
| Acento Halloween | 20–30 img | 1000 | US$6,40 |
| Acento Navidad | 20–30 img | 1000 | US$6,40 |
| Acento cumpleaños infantil | 20–30 img | 1000 | US$6,40 |
| Acento bodas *(dataset nuevo, §3)* | 20–30 img | 1000 | US$6,40 |
| Acento amor y amistad *(dataset nuevo, §3)* | 20–30 img | 1000 | US$6,40 |
| **Subtotal** | | | **US$51,20** |
| **Margen para reintentos/iteración** | | | **US$18,80** |

El margen no es un descuido — es deliberado: si un acento sobreajusta o no aprende suficiente con la primera corrida, hay presupuesto real para repetir 2–3 veces sin pedir más dinero, en línea con lo que ya señalaba el plan v001 sobre que el presupuesto compra iteración, no "más calidad lineal" por gastar todo en una sola corrida gigante.

## 6. Sobre las muestras físicas de globos

No las bloquees ni las apures por la medida absoluta (§2.6) — eso no lo resuelve ninguna foto, física o no. Sí valen la pena para la proporción relativa entre tamaños (§2.7): cuando lleguen, lo más útil es fotografiar **varios tamaños juntos en el mismo cuadro** (ej. una guirnalda orgánica mezclando R-5/R-11/R-16/R-24, no un globo solo junto a una regla) — eso alimenta el LoRA base (§4) como escena real, no como un LoRA de "tamaño" separado, que no debería existir en la arquitectura. Mientras tanto, revisar si Shopify ya tiene una gráfica de comparación de tamaños que sirva de apoyo temporal (§2.7, punto 3).

## 7. Guía de selección manual (sin scripts automáticos)

Decisión explícita: la selección de imágenes se hace a mano, no con `dataset:select-final`/`dataset:select-products`. Esos scripts sí se corrigieron a nivel de código (el bug forma/tema de §3 — `CORAZON`/`AMOR` sueltos ya no cuentan como tema, `boda`/`amor_amistad` ya existen como temas propios) por si algún día se necesita una corrida automática, pero **no se van a ejecutar** para armar este dataset. Esto es la checklist para reproducir a mano el mismo criterio.

**Exclusión importante confirmada internamente (2026-08-21)**: los productos "paquete/kit" preconfigurados (`product_type = E-DECORS` en tu catálogo, ej. E-DECOR NEON) tienen diseño desactualizado según revisión del equipo — **no uses sus fotos como fuente de "decoraciones armadas"** para el LoRA base, por más que sean técnicamente escenas reales y no fichas aisladas. Entrenar con ellas metería ese mismo diseño anticuado en el modelo. En su lugar, usa **`sempertex.com/blogs/idea-de-fiesta`** ("Ideas de Fiesta", 41 páginas de proyectos instalados reales, filtrable por MOTIVOS/OCASIÓN/FESTIVIDADES/DISEÑO/GÉNERO) como fuente principal — es contenido de marketing/showroom más reciente, no el catálogo de kits. Esto no invalida el mecanismo de bill-of-materials (§4) ni la cotización — solo cambia de dónde salen las fotos de composición, el "qué globos van" lo sigue decidiendo la cotización igual.

**Por tema, qué SÍ cuenta** (basado en los patrones ya verificados contra tu catálogo real de 1.505 productos disponibles):

| Tema | Señales reales en título/tags | Candidatos reales en tu catálogo |
|---|---|---|
| Halloween | HALLOWEEN, CALABAZA, BRUJA, FANTASMA, MURCIÉLAGO, TELARAÑA, ESQUELETO | 131 |
| Navidad | NAVIDAD, SANTA/PAPÁ NOEL, RENO, NOCHEBUENA, MUÑECO DE NIEVE, ÁRBOL NAVIDEÑO | 192 |
| Cumpleaños infantil | CUMPLEAÑOS/BIRTHDAY + algo que lo marque infantil (personaje, "niño/niña", tema de fiesta) — cuidado: "cumpleaños" solo también trae fiestas de adultos | 314 (sin filtrar por "infantil" todavía) |
| Bodas | BODA, MATRIMONIO, NOVIA/NOVIOS, NUPCIAL, ANIVERSARIO — **ojo**: muchas no dicen "boda" en el título, son vajilla/servilletas/globos en paleta elegante (blanco, dorado, champán, marmoleado) etiquetados por tag, no por nombre | 59-61 |
| Amor y amistad | SAN VALENTÍN, "DÍA DEL AMOR Y LA AMISTAD", CUPIDO, ENAMORADOS — frase completa de la ocasión | 219 |

**Por tema, qué NO cuenta aunque parezca que sí:**
- Un globo con forma de **corazón** (código `C-N`) no es automáticamente "amor y amistad" — esa forma se usa en cumpleaños, bodas, cualquier ocasión. Clasifica por la ocasión real del producto/foto, no por la forma del globo.
- "Coquette" (princesa, pastel, mariposa, perla) es una **estética**, no lo mismo que "amor y amistad" — se solapan poco en la práctica real (364 productos coquette vs. 219 amor y amistad, con overlap bajo).
- Metalizado no es una forma ni un tema — es un acabado (§ corrección de `derivar.ts`). No lo uses como criterio de clasificación temática.

**Cuántas por tema**: apunta a 20-30 imágenes reales por tema (§2.1) — es el punto óptimo documentado, no un mínimo a superar. Con 59+ candidatos reales hasta en el tema más chico (bodas), es alcanzable en los 5 temas nuevos sin forzar relleno genérico.

**Al mirar cada candidata, pregúntate:**
1. ¿Esta foto se parece demasiado a otras 3-4 que ya elegiste del mismo tema (mismo fondo, misma luz)? Si el 80% del tema comparte encuadre, mejor variar antes de sumar más (§2.1 — señal débil por sobreajuste, no por pocas fotos).
2. ¿Es una escena real (arco montado, mesa decorada) o una ficha de producto aislada? Prioriza escena real — es la que enseña proporción y composición (§2.6/2.7), la ficha aislada solo enseña textura de globo suelto.
3. ¿Aparecen varios tamaños de globo juntos en el mismo cuadro (ej. guirnalda orgánica)? Márcala aparte — es oro para la proporción relativa (§2.7), sepárala mentalmente de la cuota normal del tema.
4. Al escribir el caption: describe todo menos el estilo Sempertex (que es el trigger fijo) — composición, colores, iluminación (§2.2). Si es una de las fotos multi-tamaño del punto 3, describe la comparación de tamaño explícitamente.

**Dos ejes más que van en el LoRA base (no en un acento nuevo), por la misma razón que la proporción relativa (§2.7): son independientes del tema — un acabado o un formato no cambian según sea Halloween o boda.**

- **Acabado real de Sempertex** (Fashion, Reflex, Silk, Deluxe, Metalizado — catálogo real de texturas de `sempertex.com/collections/globos-fiesta-textura-*`): al elegir las 35-50 decoraciones armadas, procura que cada acabado tenga al menos 1-2 fotos donde se vea claro, y nómbralo en el caption. Sin esto, el prompt puede pedir "acabado Reflex" en generación pero el modelo nunca aprendió qué es eso visualmente — confirmado con prueba real: describir el acabado por texto solo no le enseña a un modelo sin entrenar cómo se ve.
- **Formato/forma de armado** (arco, guirnalda, semi arco, bouquet, columna — categorías reales de Sempertex; la idea de "formato" es válida aunque el ejemplo de kit que la mostró, E-DECOR NEON, quedó excluido por diseño desactualizado): mismo trato — varias fotos reales **de Ideas de Fiesta**, no de kits, por formato, nombrado en el caption. Confirmado con prueba empírica (ver decision-log): un prompt de texto detallado a Gemini, sin entrenamiento ni foto de referencia, no reprodujo la estructura de "bouquet" (base compacta + globos en cordones hacia arriba) — salieron dos masas separadas en el piso en su lugar. Dale más peso a los formatos que más se piden (arco/guirnalda) sobre los ocasionales (bouquet/columna), no reparto parejo.
- **Lógica de combinación de color de Sempertex** (no colores sueltos — esos ya los conoce cualquier modelo, confirmado con prueba real en §7). El objetivo es que el LoRA interiorice *cómo* Sempertex junta colores como marca, no que aprenda a nombrarlos. Usa las 6 paletas "Mix & Match" ya cargadas en el selector del chat (Ombré chocolate, Ombré lila, Rosa romántico, Nude y burdeos, Dorado y salvia, Aguamarina y lila — ver `ESQUEMAS_COLOR` en `page.tsx`) como criterio de búsqueda: prioriza para el base fotos reales de Ideas de Fiesta que ya combinen esos mismos tonos entre sí, y nombra la paleta en el caption (ej. "paleta Ombré chocolate: Fashion Mocha, Fashion Latte, Fashion Chocolate, Fashion Coffee"). Si una foto real no calza con ninguna paleta ya definida, igual sirve para el base — no hace falta forzarla a encajar.

## 7b. Cambios de código que siguen pendientes (independientes de cómo se arme el dataset)

- `configs/lora/`: pasar de una sola URL (`SEMPERTEX_LORA_URL`) a un mapa `{ base, halloween, navidad, cumpleanos, boda, amor_amistad }`, siguiendo el patrón ya existente de `project-v001.yaml`/`inference-v001.yaml`.
- [`sempertex-lora.ts`](src/lib/ia/sempertex-lora.ts): resolver el LoRA de acento a partir del `Brief` y apilarlo en el arreglo `loras` (§4) — cambio pequeño, la plomería del arreglo ya existe.

Estos dos no dependen de si el dataset se arma a mano o con script — son sobre cómo se *usan* los LoRA ya entrenados, no cómo se eligieron sus imágenes.

## 8. Criterios de aceptación

- Cada tema (5) tiene al menos 20 imágenes reales curadas antes de enviar su ZIP — si no las hay, ese acento no se entrena todavía, no se fuerza con imágenes genéricas.
- Ningún entrenamiento se envía sin revisar a mano una muestra de sus captions (§2.2).
- Prueba de composición fija tras cada acento: mismo prompt base, comparar con/sin ese LoRA de acento activo, confirmar que el tema se nota sin que la composición general se rompa — **incluida la proporción relativa entre tamaños de globo** (§2.7): el acento no debe diluir lo que aprendió el base solo por venir de un dataset con fotos de producto más aisladas. Si se nota peor, el fix es curar el dataset del acento con más escenas reales, no crear un LoRA de tamaño aparte.
- El costo mostrado por fal.ai antes de dar "Start" debe coincidir (±10%) con la tabla del §5 — si no, parar y revisar antes de pagar.

## 9. Fuentes

- [fal.ai — FLUX.2 [dev] Trainer](https://fal.ai/models/fal-ai/flux-2-trainer)
- [fal.ai — FLUX.2 Developer Guide](https://fal.ai/learn/devs/flux-2-developer-guide)
- [fal.ai — FLUX.2 [dev] LoRA (inferencia)](https://fal.ai/models/fal-ai/flux-2/lora)
- [Modal — Fine-tuning a FLUX.1-dev style LoRA](https://modal.com/blog/fine-tuning-flux-style-lora)
- [Segmind — Easy Flux LoRA Training Guide for Beginners](https://blog.segmind.com/easy-flux-lora-training-guide/)
- [arXiv 2606.03792 — Training-Free Multi-Concept LoRA Composition with Prompt-Aware Weighting](https://arxiv.org/pdf/2606.03792)
- [arXiv 2605.03252 — Ortho-Hydra / Anima LoRA (multi-style MoE LoRA)](https://arxiv.org/abs/2605.03252)
- [arXiv 2505.23758 — LoRAShop: Training-Free Multi-Concept Image Generation and Editing](https://arxiv.org/html/2505.23758v1)
- [arXiv 2502.04923 — Cached Multi-Lora Composition for Multi-Concept Image Generation](https://arxiv.org/pdf/2502.04923)
- [arXiv 2503.06884 — Text-to-Image Diffusion Models Cannot Count, and Prompt Refinement Cannot Help](https://arxiv.org/pdf/2503.06884)
- [arXiv 2601.20354 — Everything in Its Place: Benchmarking Spatial Intelligence of Text-to-Image Models](https://arxiv.org/pdf/2601.20354)
- [arXiv 2305.13655 — LLM-grounded Diffusion](https://arxiv.org/pdf/2305.13655)
- [arXiv 2307.06350 — T2I-CompBench: A Comprehensive Benchmark for Compositional Text-to-Image Generation (attribute binding)](https://arxiv.org/pdf/2307.06350)
