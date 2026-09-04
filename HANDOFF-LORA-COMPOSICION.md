# Handoff — Diagnóstico composicional LoRA Sempertex v2 (2026-08-28)

> Pegá el bloque de abajo en una sesión nueva de Claude Code, en
> `C:\Users\davidt\Downloads\demo-decoracion`.

---

Proyecto: `C:\Users\davidt\Downloads\demo-decoracion` (Next.js, Windows, git branch `main`).
Worktree MUY sucio con trabajo previo sin commitear — **nunca uses reset/checkout destructivo**.

## RESULTADOS EXPERIMENTALES — 2026-08-28

Cinco tandas contra fal.ai, **US$1,932 en total** (61 generaciones), saldo restante US$21,88. Todas guardan el
payload literal de cada celda y el gasto real medido contra el saldo, así que **el vacío de
reproducibilidad de las sesiones anteriores queda cerrado**.

- `scripts/exp-fal-lib.ts` — runner común. Usa SIEMPRE `fal-ai/flux-2/lora`, con `loras: []`
  en las celdas base (`loras` es opcional en el schema), así el endpoint deja de ser variable
  de confusión. Soporta `--dry-run` y `--solo <id>` para repetir una celda puntual.
- `scripts/exp-step0-lora-vs-base.ts` · `exp-step1-scale-encuadre.ts` · `exp-step2-panel-seeds.ts`
  · `exp-step3-control-trigger.ts` · `exp-step4-prompt-real.ts`
- `scripts/exp-prompt-produccion-xv.ts` — imprime el prompt REAL del pipeline. No gasta crédito.
- `scripts/exp-contacto.ts` — hoja de contacto etiquetada, para juzgar en grilla y no de a una.
- Imágenes y manifiestos en `reports/lora-debug/step0…step4/`; recortes a resolución nativa en
  `reports/lora-debug/web/`.

### EL HALLAZGO: a `lora_scale` 0,8 la composición se rompe; a 0,3 no

Panel de 3 brazos sobre los **mismos 6 seeds** (101…606), todo lo demás en configuración de
producción (prompt v2, 3:2 1536×1024, guidance 3,5, 28 pasos). Criterio fijado **antes** de
mirar: (1) arco 3D que cierra, no portal ni blob · (2) DOS columnas separadas, distinguibles
de las patas del arco · (3) mesa presente y escena dentro del cuadro.

| brazo                             | pasa    | acumulado con las otras tandas |
| --------------------------------- | ------- | ------------------------------ |
| base, sin LoRA                    | **6/6** | 9/9                            |
| base + trigger, sin pesos (paso 3) | **6/6** | 6/6                            |
| `lora_scale` **0,3**              | **6/6** | 7/7                            |
| `lora_scale` **0,8** (hoy)        | **1/6** | 2/8 (~25%)                     |

A 0,8 aparecen justo las patologías del reporte original: portal rectangular (seeds 101, 505),
esculturas deformes y globos de modelar retorcidos (303, 606), columnas fundidas en las patas.
A 0,3 ninguna de las tres aparece en 7 generaciones.

**Acción inmediata:** `loraScale()` en `src/lib/ia/sempertex-lora.ts` tenía default 0,8; ya está en
0,3, con la medición en el comentario. Pero leer la sección «¿0,3 es el arreglo o control de
daños?» más abajo antes de darlo por cerrado: **es control de daños, no el arreglo.**

#### Verificación de que el LoRA realmente se aplica (paso 3)

Tres comprobaciones, porque todo el resultado depende de que los pesos entren de verdad:

1. **El archivo es un LoRA FLUX legítimo.** `GET` con `Range` sobre la URL y parseo del encabezado
   safetensors: 332.548.896 bytes, 276 tensores, `rank 16`, nombres
   `base_model.model.double_blocks.*.lora_A/lora_B.weight`.
2. **Los pesos se honran.** `lora03` y `lora08` comparten prompt, trigger y seeds y difieren solo
   en `scale`. Si fal ignorara `loras`, esas 12 imágenes serían idénticas de a pares; dan 6/6
   contra 1/6.
3. **Confusión encontrada y cerrada.** El brazo base del paso 2 salió SIN el token
   `eventdecor_style_v2` (el runner ataba el trigger a la presencia del LoRA, como producción),
   así que base-contra-LoRA movía dos variables. El brazo `base + trigger` del paso 3 da **6/6**:
   el token es composicionalmente inocuo sobre el base y el techo del paso 2 se sostiene.
   `Celda.trigger` ahora permite forzarlo con independencia del LoRA — usarlo en cualquier futuro
   brazo base.

#### El camino de producción ya emite el prompt validado (paso 4)

`scripts/exp-prompt-produccion-xv.ts` recorre la cadena real —`resolverPlan` → `planBlueprint` →
`buildApprovedSceneSpec` → `compileLoraCaption`— sobre un plan XV de cuatro estructuras. No gasta
crédito. Resultado:

- **No hay nada nuevo que implementar en el prompting.** Lo que sale hoy hacia fal difiere del
  string testeado en tres palabras decorativas: producción **no** emite
  `quinceañera celebration atmosphere`. Todo el esqueleto composicional es idéntico, incluida la
  cláusula independiente `two balloon columns, matching one another, one standing on the left and
  one on the right`, que es la que separa las columnas.
- **El preflight PASA** para este plan. La preocupación de que `requiredAnchorMissing()` bloquearía
  por exigir `"main table"` no se materializa: el prompt v2 contiene esa frase.
- `LORA_PROMPT_VERSION` solo se va a v1 con el valor literal `"v1"`; el default es v2, que es el
  camino medido.

`scripts/exp-step4-prompt-real.ts` corre el **string literal de producción** en los mismos 6 seeds:
**6/6 a escala 0,3** y **0–1/6 a 0,8**, con las esculturas deformes de vuelta en los seeds 303 y
606. El contraste se sostiene con los bytes exactos de la app.

**Sobre `quinceañera`.** Se venía asumiendo que fal «no la entiende». Hay que separar dos cosas: el
codificador de texto de FLUX.2 es un VLM Mistral-Small-3.2 de 24B, multilingüe, y la palabra no le
resulta opaca. Lo que nunca la vio es el **LoRA** (0/154 captions), así que el token no activa nada
aprendido y se resuelve como texto común. Y es discutible en la práctica porque producción no la
emite. **Excepción:** el prompt v1 legado la contiene dos veces, así que activar
`LORA_PROMPT_VERSION=v1` la reintroduce.

### CORRECCIONES a lo que se creía (y a lo que esta misma sesión escribió antes)

**1 · "El LoRA destruye la composición" es demasiado fuerte.** Falla a escala 0,8, con ~25% de
aciertos; a 0,3 compone tan bien como el base. No es que el LoRA no pueda componer: es que a
0,8 domina y arrastra.

**2 · La hipótesis de encuadre que propuse quedó REFUTADA por su propio control.** Se había
observado que la celda B (LoRA 0,8, 3:2, seed 777777) colapsaba y que a 1:1 componía bien, y se
atribuyó al sesgo de encuadre del dataset (32% cuadrado, 31% vertical, una sola 16:9). Pero ese
1:1 cambió aspecto **y seed** a la vez. El control `E2c-3x2-lora08-seed424242` — 3:2, mismo seed
que el 1:1 bueno — **compone bien**. El aspecto no separa los casos; el seed sí: 777777 falla en
3:2, en 2:3 y devuelve PNG negro en 1:1, mientras 424242 acierta en los tres. Era varianza por
seed, no encuadre. El sesgo de encuadre del dataset sigue siendo real, pero **no está
demostrado que cause esta falla** y no debe reordenar el recaptioning por sí solo.

**3 · El portal rectangular no viene de la ambigüedad del token `arch`.** Tiene dos causas
medidas, ninguna de ellas el dataset:
- la cláusula `framing a backdrop panel` del prototipo v3, que hace construir un marco alrededor
  de un panel plano — **3/3 seeds sobre el modelo BASE, sin LoRA de por medio**;
- `lora_scale` alto (0,8), que lo produce en 2/6 seeds con el prompt v2.
Con prompt v2 y escala ≤0,3 no apareció ni una vez en 16 generaciones.

**4 · El PNG negro no es censura.** `enable_safety_checker: false` lo devuelve igual y fal no
cobra: es la generación que se cae, y solo con LoRA 0,8 + 1:1 + seed 777777. El runner ahora
marca como `censurada` cualquier salida <200 KB para que no se cuele como éxito en el manifiesto.

### La afinidad al corpus está ANTI-correlacionada con la composición — CONFIRMADO

Replicado en 3 seeds sobre el modelo base, sin LoRA:

- **prompt v2** (afinidad −6/100) → arco 3D real + dos columnas separadas, **9/9**.
- **prompt v3** (afinidad 90/100) → **portal rectangular en 3/3**.

`scripts/lora-caption-affinity.ts` mide parecido a los captions de entrenamiento, no calidad
composicional, y acá las dos cosas apuntan en direcciones opuestas. **Los pasos 1c, 1d y 1e del
plan de abajo están escritos al revés:**

- **1c (promover el compilador v3)** — no promoverlo. Puntúa 90 y compone peor.
- **1d (acortar a 40–70 palabras)** — el verbosismo del v2 es lo que sostiene las dos columnas.
- **1e (eliminar izquierda/derecha)** — `two balloon columns, matching one another, one standing
  on the left and one on the right` es **cláusula independiente**, y es la que separa las
  columnas. La subordinada del v3 (`flanked by two tall balloon columns`) las funde. Lo que
  importa no es el léxico sino que cada estructura tenga su propia cláusula.

Lo único que el v3 gana es el centro de mesa, que nombra y cuelga de la mesa; el v2 lo resuelve
con flores. Esa cláusula conviene portarla al v2.

### ¿0,3 es "el arreglo" o control de daños? — control de daños

Medido sobre las 18 imágenes del panel (proxies crudos, `sharp`, miniaturas a 512 px):

| brazo | saturación media | brillos especulares | contraste p99−p01 |
| ----- | ---------------- | ------------------- | ----------------- |
| base  | 0,4066           | 0,583 %             | 207,5             |
| 0,3   | 0,4161           | 0,390 %             | 201,0             |
| 0,8   | 0,4066           | 0,181 %             | 192,0             |

Y recortes a resolución nativa de la misma región en los tres brazos, en
`reports/lora-debug/web/crop-seed202.png` y `crop-seed505.png`.

**El LoRA no es un no-op.** Tiene firma visual real y dosis-dependiente: en el seed 202 a 0,8 los
globos salen claramente más grandes y más cobrizos/metálicos que en el base, y 0,3 queda en el
medio. Eso es estilo Sempertex genuino.

**Pero también degrada la superficie.** Los brillos especulares caen de forma monótona con la
escala y el contraste con ellos; en el seed 505 a 0,8 la superficie se ve más plana y turbia, no
más estilizada.

**La conclusión incómoda: tener que correrlo a 0,3 es en sí mismo el síntoma.** Un LoRA de estilo
sano se usa a 0,8–1,0. Que haya que bajarlo a un tercio para que no rompa la composición significa
que lo estamos apagando en su mayor parte para evitar su daño — la huella exacta del
sobreentrenamiento de la causa A (4000 pasos, lr 2e-4, contra los defaults 1000 y 5e-5).

Por eso **se revierte** lo que una versión anterior de esta sección afirmaba: el reentrenamiento
**no** deja de ser urgente. 0,3 compra imágenes usables hoy a cambio de quedarse con un tercio del
estilo por el que se pagó el entrenamiento. El reentrenamiento sigue siendo el único camino a tener
el estilo a intensidad plena sin perder la estructura.

Alcance de esta medición: una sola escena (XV multi-estructura, rosa y oro rosa). No se probó si el
LoRA aporta más en otras paletas o tipos de estructura.

### PROCEDENCIA DE LOS PARÁMETROS DEL v2 — confirmada en el dashboard

**`steps=4000` y `learning_rate=0.0002` están verificados en el dashboard de fal por el usuario**
(2026-08-28), no inferidos. Contra los defaults de fal (1000 y 5e-5) son 4× en ambos ejes. El
diagnóstico de sobreentrenamiento descansa sobre este dato y ahora tiene fuente.

**El dashboard muestra UN SOLO entrenamiento en esta cuenta.** Eso invalida un registro del repo:

- `data/processed/sempertex-training-run-v002.json` describe una corrida de **200 imágenes, 1000
  pasos, trigger `eventdecor_style_v1`**, con pesos en `.../0aa65403/J8b2xDhu6DhqE7Zm0D_cB_...`.
  Ese archivo existe y responde con HTTP 206, pero **la corrida no aparece en la cuenta**. Salió de
  otra cuenta — encaja con los dos incidentes de key/saldo equivocados ya conocidos.
- Por lo tanto **ese JSON no es fuente confiable**, y su campo `estimatedCostUsd: 6.4` tampoco: es
  una estimación escrita a mano, para otra corrida, en otra cuenta.
- El LoRA que corre en producción (trigger `eventdecor_style_v2`, pesos en `.../0aa80af5/Co4ylz…`)
  **no tiene registro local de su entrenamiento**. La única fuente de sus parámetros es el
  dashboard.

**Para la próxima corrida: anotar los parámetros reales y el costo facturado en
`reports/lora-debug/entrenamiento-v004.json`.** Que el LoRA de producción no tenga procedencia
escrita es lo que obligó a esta arqueología.

### ESPECIFICACIÓN DEL REENTRENAMIENTO

Medido sobre los 154 captions de `data/processed/export-general-2026-08-27.json` en esta sesión.

#### El hallazgo que faltaba: el LoRA nunca vio una relación bilateral

| medición sobre los 154 captions | valor |
| --- | --- |
| captions con ≥2 tipos de estructura | 91 · 59% |
| …y además una relación espacial explícita | 81 · 53% |
| captions con la palabra `flank` | 13 |
| **captions con `on either side`, o con `left` Y `right`** | **0** |

La composición no está ausente del dataset, como se creía: el 53% relaciona estructuras. Pero
**todas esas relaciones son unilaterales** (`beside`, `behind`, `against`) y **ninguna es
bilateral**. El prompt de producción pide exactamente lo que el LoRA jamás vio:
`one standing on the left and one on the right`. Por eso a escala alta las columnas se funden en
las patas del arco — no hay señal aprendida para colocación bilateral, así que el LoRA solo puede
pisar la que el modelo base sí tiene.

**Es la corrección de captions más importante y la más barata.** Pero escribirla con
`left`/`right` sería un error: el trainer no permite apagar la augmentación, y si voltea las
imágenes esa lateralidad se vuelve ruido. La forma correcta es bilateral e invariante al volteo:
`flanked by a matching balloon column on either side`.

#### Los otros cuatro desajustes, con números

| desajuste | medición | por qué importa |
| --- | --- | --- |
| Boilerplate constante | 93% tiene cláusula de iluminación, 67% **termina** en ella | Es constante, así que debería pertenecer al trigger. Describirlo en cada caption es lo que acopla estilo↔composición |
| Densidad de estilo | 5,6 palabras de acabado/luz por caption contra 1,3 espaciales · **ratio 4,4:1** | El modelo aprende que el trigger significa «describir acabados», no «escena Sempertex» |
| Token `arch` ambiguo | 44 captions con `arch`: 27 arco 3D, **14 panel plano/silueta**, 3 aro metálico | 39% de `arch` no es un arco 3D. Explica el portal rectangular |
| Encuadre | 39% vertical 3:4 · 35% cuadrado · 13% vertical alto · 12% apaisado · **1% (2 fotos) panorámico ≥3:2** | La app genera 3:2. No está demostrado que cause la falla (ver corrección 2), pero es un hueco de dominio del 99% |
| Cartelería | 41% menciona cartel, letras, número o marquesina | Texto basura y letras de globos en la salida |

Largo de caption: mediana 59 palabras, p90 82. El prompt de producción tiene ~60 — **ya está en
distribución**, no hace falta acortarlo (refuerza que el paso 1d del plan está al revés).

#### Qué hacer con los captions

- **Sacar** el boilerplate constante: la cláusula de iluminación de cierre y todo lo fotográfico
  invariante. Eso pasa a pertenecer al trigger, que es el objetivo de un LoRA de estilo.
- **Conservar** lo que varía y la app necesita controlar por plan: tipos de estructura, colores,
  acabados (mate/cromado/metalizado) y tamaños. No son estilo constante: son contenido.
- **Agregar** relaciones espaciales bilaterales explícitas en las ~35 escenas multi-estructura.
  Es el 0/154 de arriba.
- **Desambiguar** `arch`: reservar `balloon garland arch` para el arco 3D y recaptionar los 14
  paneles planos y los 3 aros con otro sustantivo.
- **Reponderar o filtrar** el 41% con cartelería.
- **Corregir el sesgo de encuadre**: recortar variantes panorámicas o sumar fotos 3:2.

#### Hiperparámetros

**El trainer de fal expone solo CINCO parámetros** (verificado contra el schema OpenAPI de
`fal-ai/flux-2-trainer` y `-v2`): `image_data_url`, `steps`, `learning_rate`, `default_caption`,
`output_lora_format`. **No hay `rank`, ni checkpoints intermedios, ni control de augmentación.**
Todo lo demás se controla por el dataset.

| parámetro | v2 (roto) | propuesto | por qué |
| --- | --- | --- | --- |
| `steps` | 4000 | **500 / 1000 / 1500** | Default de fal 1000. Como no hay checkpoints, se entrenan tres corridas separadas |
| `learning_rate` | 2e-4 | **5e-5** | Default de fal. No moverlo en la primera vuelta: un solo eje por vez |

Dos consecuencias de que el trainer sea tan cerrado:

- **`rank` no se puede bajar.** El 16 del v2 es el rango fijo del trainer, no una decisión. Descartar
  esa palanca; la capacidad se controla solo con `steps` y con el dataset.
- **No hay checkpoints intermedios**, así que «evaluar checkpoints» se implementa como **tres
  entrenamientos separados** a 500, 1000 y 1500 pasos, cada uno evaluado con el mismo panel. Es la
  única forma de encontrar el punto antes del sobreentrenamiento.
- **La augmentación no es controlable.** Si el trainer aplica volteo horizontal, cualquier caption
  que diga «izquierda/derecha» le enseña al modelo que la lateralidad es ruido. Por eso los captions
  nuevos deben usar lenguaje bilateral **invariante al volteo**: `flanked by a matching balloon
  column on either side` en vez de `one on the left and one on the right`. Se gana la bilateralidad
  sin apostar a una augmentación que no podemos ver ni apagar.

#### El cambio de proceso, que es lo que más importa

El v2 se entrenó a ciegas: 4000 pasos, un solo checkpoint, sin evaluación held-out. Ahora existe
una evaluación reproducible y barata, así que el entrenamiento deja de ser una apuesta:

1. Entrenar tres corridas separadas: 500, 1000 y 1500 pasos (el trainer no da checkpoints).
2. Evaluar **cada corrida** con `scripts/exp-step2-panel-seeds.ts` — 6 seeds, criterio de tres
   puntos — **a escala 0,8 y 1,0**, no a 0,3. Cuesta ~US$0,20 por corrida y escala.
3. Añadir 2–3 escenas multi-estructura **held-out** que no estén en el entrenamiento.
4. **Criterio de aceptación, fijado antes de entrenar:** el checkpoint elegido debe dar **≥5/6 de
   composición a escala 0,8** y a la vez una diferencia de estilo medible contra el base — globos
   más grandes y más cobrizos, la firma que ya se midió en `crop-seed202.png`. Un checkpoint que
   solo sea usable a 0,3 es un checkpoint fallado, aunque sus imágenes se vean lindas.

Es exactamente el criterio que el v2 no habría pasado, y por eso llegó a producción.

### Qué hacer ahora, en orden

1. Bajar el default de `SEMPERTEX_LORA_SCALE` a 0,3 en `sempertex-lora.ts:48`. Es gratis y sube
   la tasa de acierto de ~25% a 100% sobre 7 generaciones.
2. Decidir a ojo de marca si 0,3 conserva suficiente estilo Sempertex. Si no, barrer 0,35–0,5
   con el mismo panel de 6 seeds (~US$0,70).
3. Portar la cláusula de centro de mesa del v3 al v2 y volver a correr el panel.
4. **No** reescribir el compilador hacia el v3 ni acortar prompts hasta tener una métrica que
   correlacione con composición y no con parecido al corpus.
5. **Reentrenar (fase 3, US$8–12) vuelve a ser la vía principal**, no un extra. No porque haga
   falta para tener imágenes usables — 0,3 ya las da — sino porque a 0,3 se está usando un tercio
   del estilo. El objetivo del reentrenamiento es un checkpoint utilizable a 0,8–1,0: pasos
   1000–1500, lr 5e-5…1e-4, checkpoints intermedios evaluados con el panel de 6 seeds y el mismo
   criterio de tres puntos de esta sesión, que ahora existe y es reproducible.

### Pendiente administrativo — cerrado

`FAL_KEY` factura al team **Customer Journey** (`telwilliam2012@gmail.com`, `is_personal: false`),
el mismo donde se entrenó el LoRA. Saldo se consulta en
`GET https://rest.alpha.fal.ai/billing/user_balance` con la key; `billing/user_details` exige una
key ADMIN y devuelve 403 con esta.

### Dos hallazgos de infraestructura

- **El default de `guidance_scale` en FLUX.2 es 2,5**, verificado contra el schema OpenAPI
  publicado (`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2`) y no
  contra documentación. `sempertex-lora.ts:86` tiene 3,5 hardcodeado. **Sin testear todavía** si
  2,5 mejora algo. `num_inference_steps: 28` sí coincide con el default.
- **Hay un proxy que intercepta TLS en esta máquina.** Node falla contra fal.ai con
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE` salvo que corra con `--use-system-ca`; curl falla con
  `CRYPT_E_NO_REVOCATION_CHECK`. Cualquier script o el server de Next que llame a fal.ai necesita
  `NODE_OPTIONS=--use-system-ca`.

---

## Contexto

El LoRA Sempertex v2 (FLUX.2 vía fal.ai) genera imágenes con composiciones incoherentes:
blobs dorados amorfos, arcos que salen como portales rectangulares, arcos múltiples
superpuestos, esculturas irreconocibles. La textura de globos sale bien; la estructura no.

En la sesión del 2026-08-28 se hizo una auditoría forense completa. **No se generó ninguna
imagen ni se gastó crédito de fal.ai.** El diagnóstico está publicado como artifact:
https://claude.ai/code/artifact/8ff18432-4299-428e-9fbd-48446306a7ac

## Diagnóstico: tres causas que se multiplican

**A · Sobreentrenamiento (la causa más profunda, no vista en sesiones anteriores).**
El v2 se entrenó con `steps=4000` y `learning_rate=0.0002`. Los defaults de
`fal-ai/flux-2-trainer` son **1000 steps y 5e-5** — 4× en ambos ejes, ~26 épocas sobre 154
imágenes. fal documenta textualmente sobre sus LoRA de estilo: *"by the time we train for
2000 steps we can no longer prompt... Just total garbage."*
(https://blog.fal.ai/training-flux-style-lora-on-fal-ai/)
Además, la guía de fal pide captions que describan la escena y **NO** el estilo; estos
captions describen exhaustivamente acabado/iluminación/textura — eso acopla estilo↔composición
y es por lo que 4000 steps destruyeron la adherencia.
**Implicación clave:** FLUX.2 usa un VLM Mistral-Small-3.2 de 24B (no T5) y **sí tiene
control composicional nativo**. El LoRA no falla en *agregar* composición: está *destruyendo*
la que el base ya trae. Un LoRA de estilo sano debería ser composicionalmente neutro.

**B · El prompt está fuera de la distribución de entrenamiento.**
Medido objetivamente con `scripts/lora-caption-affinity.ts` (creado en esa sesión):
- captions reales medidos contra el corpus = **88/100** (techo)
- compilador **v2 actual = −6/100**
- compilador v1 legado = 14/100
- prototipo v3 (`scripts/proto-lora-caption-v3.ts`) = **88/100**

Las 9 `PLACEMENT_PHRASES` del compilador tienen frecuencia **0/154**
(`"centered around the stage photo area"`, `"standing on the left side"`,
`"installed against the rear wall"`, `"placed on the main table"`…), igual que
`"wide photorealistic event photograph"`, `"natural depth"`,
`"believable floor contact"`, `"celebration atmosphere"`, `"quinceañera"`.
Y omite lo que domina el corpus: `matte` 82%, cláusula de iluminación de cierre 93%,
`round balloons` 62%, superficie pared/piso 55%, tamaños large/small 45%.
Emite `"Reflex"` (2/154) donde el corpus dice `"glossy chrome"` (41/154), y `"fashion"`
(5/154) donde dice `"matte solid"` (39/154).

Trampas léxicas verificadas:
- `beside` en el corpus une la estructura con **un mueble** (mesa de regalos/postres,
  pedestal), no con otra estructura. El v1 une dos estructuras con `beside`.
- `mirror` es **acabado** (glossy chrome/mirror), nunca simetría.
- `entrance` aparece **0 veces**; el corpus dice `doorway`. El fix previo
  `", framing the entrance"` era él mismo fuera de distribución.
- **`requiredAnchorMissing()` en `lora-prompt-preflight.ts` EXIGE `"main table"` y
  `"rear wall"`, ambas 0/154.** El validador fuerza el error — hay que actualizarlo en el
  mismo commit que el compilador o bloqueará el fix.

**C · El dataset casi no contiene composición.**
De los 154 captions: 17% sin estructura, **60% una sola**, 20% dos, 2% tres, 1% cuatro.
Solo **4 captions** describen una composición multi-estructura real; **uno solo** expresa
una relación bilateral completa. Columna 13%, centro de mesa 7% — las dos estructuras que
más fallan son las peor representadas. El token `arch` está repartido entre tres referentes
(arco 3D, panel plano con silueta de arco en 6 captions, aro metálico en 9) → explica los
"portales rectangulares". Cartelería/letras en 32% → texto basura y letras de globos.
Encuadre: 32% cuadrado, 31% vertical 3:4, **1 sola imagen en 16:9**; la app genera 3:2
horizontal (1536×1024).

**La validación anterior era inválida.** El A/B decisivo de la sesión 4 (263 vs 1518 chars)
fue con **un arco solo**. Al abrir `reports/lora-debug/VERIFY-real-function.png` se ve un
arco que no cierra y **una letra "H" de globos donde debía ir una columna**; `FIX2-A/B`
muestran una sola guirnalda cuyas patas se contaron como "las dos columnas". Los prompts
literales de esos experimentos **no se guardaron** — vacío de reproducibilidad.

## Archivos clave

- Dataset real del v2: `data/processed/export-general-2026-08-27.json` (154 captions, campo
  `entradas[].texto`). **OJO:** `data/manifests/sempertex-training-v002-manifest.jsonl` es de
  otro linaje (v001), no es este dataset.
- `scripts/lora-caption-affinity.ts` — medidor de afinidad. Correr:
  `npx tsx scripts/lora-caption-affinity.ts "<prompt>"`
- `scripts/proto-lora-caption-v3.ts` — prototipo del compilador v3 con gramática del corpus.
- `src/lib/ia/lora-caption-compiler.ts` — compilador v2 en producción (el que puntúa −6).
- `src/lib/ia/lora-prompt-preflight.ts` — preflight (exige frases 0/154).
- `src/lib/ia/build-image-prompt.ts` — `buildLoraImagePromptV1` legado.
- `src/lib/ia/sempertex-lora.ts` — inferencia. `guidance_scale: 3.5` y
  `num_inference_steps: 28` **hardcodeados** (líneas 86-87); `SEMPERTEX_LORA_SCALE` default
  0.8, nunca barrido.
- `src/app/api/generate/route.ts` — `planBlueprint()` (exportada), flujo `compararLora`.
- `src/app/comparar-lora/page.tsx` + `src/app/api/debug/lora-prompt-compare/route.ts` —
  comparador v1 vs v2 de solo texto, sin fal.ai.

## Estado del código

Fases 1–4 del compilador v2 implementadas, sin commitear. `npx tsc --noEmit`, lint dirigido,
toda la suite de tests y `npm run build` en verde. Tests: `npm run ia:test-lora-compiler`,
`npm run ia:test-plan-lora-e2e`, `npm run plan:test-contratos`, `npm run ia:test`.
El modo "Depurar LoRA" en la app genera **dos** salidas (v1 y v2); la tercera variante
"prompt directo" fue removida a pedido del usuario.

## Próximos pasos, en orden

**0. EL EXPERIMENTO QUE DECIDE TODO (~US$0,05).** Generar la escena XV multi-estructura
(arco central + 2 columnas laterales + centro de mesa) **sin el LoRA**, contra
`fal-ai/flux-2` base, mismo seed, mismo prompt.
- Si el base compone bien → el LoRA es el problema; reentrenar es la vía principal.
- Si el base también falla → límite del modelo; saltar a condicionamiento por layout.
**No tomar ninguna otra decisión antes de este resultado.**

**1. Fase 1 (~US$1, 40 imágenes).** Un cambio por vez, seed fijo:
   a. Bajar `guidance_scale` 3.5 → 2.5 (default de fal para FLUX.2); probar 2.0/2.5/3.0.
   b. Barrer `SEMPERTEX_LORA_SCALE`: 0.3/0.5/0.6/0.7/0.8/1.0 — óptimo esperado 0.5–0.7.
   c. Implementar compilador v3 + **actualizar el preflight en el mismo commit**.
   d. Acortar prompts a 40–70 palabras (BFL: banda 30–80; >100 "crea confusión";
      el que funcionó tenía 44, el que falló 253).
   e. Eliminar todo lenguaje izquierda/derecha (el flip horizontal en training lo destruye).
   f. Probar prompting JSON nativo de FLUX.2 con `subjects[].position` y `composition`.
   Criterio de paso: en la escena XV con 3 seeds, las columnas aparecen como piezas
   separadas del arco y el centro de mesa existe.

**2. Fase 2 (~US$0,50).** Condicionamiento por layout: renderizar un layout tosco desde los
`target_bbox` que el `SceneSpec` ya tiene (SVG/Canvas) y pasarlo como `image_urls` a
`fal-ai/flux-2/lora/edit` — endpoint **ya declarado en `sempertex-lora.ts:4`**. Scale 0.6–0.8.

**3. Fase 3 (~US$8–12), solo si 1 y 2 no bastan.** Reentrenar con `steps` 1000–1500 y
`lr` 5e-5…1e-4, checkpoints intermedios evaluados con ~15 prompts held-out multi-estructura;
recaptionar describiendo escena y layout **sin describir el estilo**; recaptionar las 35
escenas multi-estructura con relación espacial explícita; corregir el sesgo de encuadre;
filtrar/reponderar el 32% con cartelería.

## No hacer

- No subir `lora_scale` para "recuperar" estilo — empeora la estructura.
- No perseguir ControlNet en fal: solo existe para FLUX.1 (incompatible); el de FLUX.2
  open-weights (`alibaba-pai/FLUX.2-dev-Fun-Controlnet-Union`) tiene **licencia no comercial**.
- No activar `LORA_PROMPT_VERSION=v2` por defecto: hoy está en `.env.example` sin haber
  pasado su criterio de aceptación, y puntúa peor que el v1.
- No insistir con cláusulas negativas contra el texto: ya se probó quitarlas y ponerlas,
  el cartel sale igual. El prior se combate con anclaje positivo.

## Pendiente administrativo

**Confirmar contra qué cuenta/team factura la `FAL_KEY` actual antes de gastar** — el LoRA se
entrenó en el team "Customer Journey" y ya hubo dos incidentes de key/saldo equivocados.
Cargar crédito antes de cualquier generación.
