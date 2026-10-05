# PLAN · Calidad de la imagen generada: del chat al píxel

| | |
|---|---|
| Repositorio | `C:\New folder\pictures` (HEAD `16bd109` + ~158 cambios sin commitear) |
| Repositorio de verdad del armado | `C:\New folder\clasificador-decoraciones` (HEAD `f8b5b3b`, también sucio) |
| Fecha de la auditoría | 2026-10-04 |
| Alcance | Todo lo que hace que una imagen salga distinta del plan aprobado: prompt de Gemini, caption del LoRA, flujo del chat, lectura de la foto, motores de armado, banderas, pruebas y código muerto |
| Método | 5 auditorías independientes y de solo lectura (sin llamadas a Gemini ni a fal, sin escrituras en la base), cada una re-verificada contra el árbol antes de escribir su parte. Evidencia reproducible en el scratchpad de la sesión (`dump-prompt.ts`, `medir.ts`, `colorg-*.py`, volcados `NN-*.txt`); **es temporal**: copiar lo que se quiera conservar fuera del repo antes de cerrar la sesión |
| Estado del árbol | **Se editó mientras se auditaba** (ver §6.1). Toda cita `archivo:línea` se re-localiza **por el símbolo** antes de tocarla |

---

## 0. Cómo leer este documento

- **§1–§8 son el plan maestro**: causas de fondo, decisiones que son de una persona, conflictos entre partes ya resueltos, fases con su orden de despliegue, matriz de impacto y definición de terminado.
- **Partes I–V son el detalle técnico** por frente, con un formato fijo por ítem: problema · causa raíz (`archivo:línea`) · código actual · cambio exacto · pruebas · impacto en `plan_hash`/contratos/vectores · riesgos · reversión · dependencias · esfuerzo.

| Prefijo | Parte | Frente |
|---|---|---|
| `L1–L9`, anexos (a)(b) | I | Caption del LoRA (fal / FLUX.2), vocabulario contra el corpus v007, preflight, guía |
| `H0`, `G1–G15`, `GP1–GP3` | II | Prompt de imagen de Gemini (ruta no-LoRA y etapa 2 del híbrido) |
| `C1–C11` | III | Flujo del chat (Omoikane) → aprobación → `/api/generate` |
| `M1–M11` + matriz de banderas | IV | Lectura de la foto (Amaterasu) y motores de armado |
| `S1–S13` | V | Salud: pruebas rotas, oráculos, código muerto, entorno, CI |

**Esfuerzo:** S < 2 h · M ≈ ½–1 día · L > 1 día.
**`plan_hash`:** el JSON canónico es `{plan, snapshot}` con `snapshot = {catalog_snapshot_id, estructuras, compras, total_cop}` (`services/ai-api/app/plan.py`, `resolve_plan`). Lo que se escribe dentro de `estructuras` cambia el hash **de los planes nuevos**; lo derivado (frases, `armados_*` resueltos, `colores_imagen`, cajas de ubicación) va fuera del snapshot y no lo toca.

---

## 1. Diagnóstico de fondo

Los ~60 hallazgos se reducen a cuatro causas. Cada ítem de las partes cuelga de una.

| # | Causa | Mecanismo | Ítems |
|---|---|---|---|
| **K1** | **El LoRA recibe un texto que no se parece a nada de lo que vio al entrenar** | El compilador sustituye las palabras del corpus por descriptores perceptuales con 0 apariciones (`high-shine Reflex` ×212 → `high-gloss chrome` ×0), usa otra plantilla (sin `built from` ×524, material en singular, tallas entre paréntesis, ubicación al final) y otra cola (`photorealistic … grounded supports` ×0 en lugar de `set against …` ×345/345). El LoRA se «apaga» y gana el prior del modelo base: aspecto de render y mate/brillante indistinguibles (0/6 en acabado en la evaluación de v007). | L1–L5, L9, M11.a |
| **K2** | **Producción no ejecuta lo que se valida en local** | `ARMADO_ARCO_COLUMNA_V1`, `ESTIMAR_CONTEO_V1` y `ANALISIS_COLOR_SEMPERTEX_V1` se encienden solo si `NODE_ENV !== "production"` (`feature-flags.ts:86,97,123`); `PATRONES_COLOR_V1` está OFF en todos los entornos (`:53`), aunque `SEGUIMIENTO.md §0` diga lo contrario; `.env.production` no trae ninguna lectura de la foto. En producción el prompt solo lleva nombre de pieza y colores: sin armado, patrón, remate, tamaños leídos ni el bloque de color exacto. En local, además, se pagan lecturas que nadie consume. | M1, M2, C5, S11, G4 (parte), G15 |
| **K3** | **El prompt de Gemini contradice al plan aprobado** | `SCENE LOCK — HIGHEST PRIORITY` va por encima del plan y lleva la paleta del brief y el **último** mensaje literal («sí, apruébalo así»); la identidad rica del elemento se calcula y se tira; kits y figuras reciben «No balloon color mix is approved»; el acabado no llega; negativos fijos prohíben lo aprobado (arcos, guirnaldas); 30–47k caracteres con la prohibición de texto ~6 veces. | G1–G14, GP1–GP3, C6 |
| **K4** | **Capacidades «portadas pero no cableadas» o con caminos cortados** | El cromado del catálogo (`reflex`) se pinta mate en los tres motores orgánicos; el arco y la columna clásicos ignoran la proporción declarada (70/20/10 → 30/29/29); la clase oficial no decide el motor (aro → arco en espiral); el remate leído no llega a la columna orgánica; el motor de bouquet (~3.900 líneas) no tiene consumidor; el chat pide «dime si la apruebas» y solo se aprueba con un botón; `confirmar_seleccion_rag` promete una imagen que no llega; el patrón pedido por chat se pierde; fondos y paneles de la foto nunca entran. | M3–M10, C1–C4, C7–C9 |

Y una quinta, operativa, que **bloquea todo lo demás**:

| **K0** | **La red de seguridad no está verde ni es estable** | `pytest` falla en 4 casos estables de `test_columnaorg.py` por 1 ulp de `pow` (CPython/UCRT frente a V8). El resultado **depende del sistema operativo** y CI corre en Linux, así que bloquearía el despliegue. Ninguna prueba compara el vocabulario del caption con el corpus ni las invariantes del prompt de Gemini: todos los hallazgos K1/K3 pasan las 32 suites de imagen en verde. | S1–S4, S12, S13, H0, anexo (a) |
|---|---|---|---|

---

## 2. Decisiones que son de una persona (bloqueantes)

AGENTS.md: «Anything a loop cannot decide alone — licensing, spending beyond the cap, taxonomy changes, promoting a prompt variant — goes to a person». Ningún PR de las fases indicadas se abre sin la decisión escrita (en el PR o en `SEGUIMIENTO.md`).

| ID | Decisión | Opciones | Recomendación | Bloquea | Fase |
|---|---|---|---|---|---|
| **D1** | **Dirección del vocabulario LoRA.** El 2026-10-04 a las 11:25, **durante la auditoría**, alguien cambió `FINISH_WORDS` (`lora-caption-compiler.ts`, ~`:329`) a palabras perceptuales (`reflex: "high-gloss chrome"`, `fashion: "solid matte"`, `silk: "soft pearlescent"`) con el comentario «Manda la imagen». Es la dirección **opuesta** a L1. | (a) Corpus para la familia de acabado y para los colores con ≥5 apariciones, y descriptor solo para colores de fantasía raros: regla R1–R6 del anexo (b). (b) Perceptual en todo (estado actual del árbol). | **(a)**, detrás de `LORA_VOCABULARIO_CORPUS_V007` y decidida por el brazo B/F del protocolo de la Parte I. El informe que justifica (b) (`reports/lora-debug/color-fidelidad`) **no está en el árbol** y midió con la plantilla equivocada (`spring pink with a Silk satin finish`, no `satin Silk spring pink …`). | L1–L5, M11.a | F2 |
| **D2** | **Banderas que dependen de `NODE_ENV`** | (a) C5: por defecto `false` en todas partes, y local las enciende **explícitamente** en `.env.local`. (b) M1: dejar los valores por defecto. | **(a)**. Hace visible en un archivo la diferencia entre local y producción, que es justo K2. M1 sigue valiendo para el **orden de encendido**. | C5, matriz de banderas | F1 |
| **D3** | Dos estructuras en `entrada` se dibujan del mismo lado | (a) Espejo para `entrada` con `repeticiones === 2` (G5). (b) Campo `lado` en el plan (cambia `plan_hash`). (c) No cambiar. | (a). Contradice a propósito `test-generate-qa-plan.ts:105-111`, que hoy afirma «un solo lado». | G5, G8 | F6 |
| **D4** | Equivalencias de acabado para el motor | `metal → cromado` (no exacto), `satin/silk/neon → mate` (no exacto, con aviso) | Aceptar la tabla de M3. Antes, sacar las palabras **reales** del catálogo con un `SELECT DISTINCT` de solo lectura. | M3, M8 | F1 |
| **D5** | Cómo se aprueba un plan | (A) Detectar la aprobación escrita y disparar `aprobarPlan`. (B) El texto y el prompt remiten al botón «Aprobar y ver cómo queda». | **(B)**. «Model output cannot grant permissions or authorize operations»; aprobar dispara gasto y registra `CLIENT_APPROVED`. | C1 | F1 |
| **D6** | Formato del prompt con el LoRA v004 en producción (hoy JSON por defecto, decidido con 2 casos) | JSON / texto | Que lo decida el brazo C/D del protocolo de la Parte I. | L6 | F6 |
| **D7** | Código «isla» | `app/bouquet/` (cablear o aparcar), `src/lib/scene/*` (sombra V2), `idempotencia/store.ts`, `inari/parse.ts`, `/api/lora/{compatibility,modes}` | Ver S6a–S6f. Para el bouquet: **primero** conectar su oráculo (`vectores-bouquet.json`, que hoy no lee ninguna prueba) y después cablear la vista previa (M7). | M7, S6 | F6/F7 |
| **D8** | Paridad local/producción | (a) `.env.local` = producción, con un `.env.local.experimento` aparte. (b) Anotar que las mediciones locales usan v17 y dominancia medida. | (a) | S11, matriz paso 0 | F0 |
| **D9** | Regla única de remate sin lectura | **Decidida el 2026-10-05: sin lectura, sin corona** (ya en código desde `6fc3e95`, `armado_estructura._receta`; ADR-0039 §3 enmendada). El globo de 24" nunca se cobraba: el precio no cambia | Una sola regla: «sin lectura, sin corona». Va por la ruta del clasificador. | M11.c | F7 |
| **D10** | Promover variantes de prompt | `LORA_VOCABULARIO_CORPUS_V007`, `PROMPT_IMAGEN_V2` | Solo con la evaluación firmada en `lora_evaluations` o en el informe de `ia:eval` | F2, F4 | F2/F4 |
| **D11** | Umbrales de la matriz de encendido de banderas | Acierto mínimo de cada lectura, tolerancia de conteo y de precio, p95 de confirmación | Los fija negocio antes del paso 2 | M1 | F5 |
| **D12** | Taxonomía de 12 clases | La lista canónica vive en el clasificador; la auditoría no la encontró allí | Pedirla al dueño del clasificador; cambiarla allí primero | C10 | F7 |
| **D13** | `expected` del vector 32 (`pared-organica-zonas-tres-colores`) | Escribirlo a mano tras revisar las cifras | Lo escribe una persona; **nunca** copiando `expected_python` | S12 | F0 |

---

## 3. Conflictos entre partes, ya resueltos

Las cinco partes se escribieron en paralelo. Donde se pisaban, manda esta tabla.

| Conflicto | Parte A | Parte B | Resolución |
|---|---|---|---|
| Valores por defecto de las banderas `NODE_ENV` | C5: quitar la dependencia | M1: no tocar los valores por defecto | **D2 = C5.** La matriz de M1 sigue siendo el orden de encendido en producción. `.env.example` (S7) debe reflejar el valor por defecto nuevo (`false`) en lugar de «Default dev». |
| Aviso de lecturas sin consumidor | C5 paso 2: `assertCoherenciaBanderas()` + filtrar el prompt v17 vía ADR | M2: `CONSUMIDOR_DE_LECTURA` + `lecturasSinConsumidor()` y **no** filtrar v17 (cambiaría su hash y su clave de caché) | **M2.** Se descarta el filtrado del prompt v17. La prueba es `test-feature-flags-coherencia.ts`. C5 conserva los pasos 1, 3, 4 y 5. |
| Orden de despliegue de cambios de contrato | G4 (`colores_imagen` en `plan-resuelto.v1`, TS `.strict()`): **primero la app**, después `ai-api` | C4 (`pedidos_patron` en `plan-resolution-request`, Python `additionalProperties:false`): **primero `ai-api`**, después la app | **Releases separados** (F3a y F3b). Nunca en el mismo despliegue. Recordatorio: `main` despliega la app sola a EC2; `ai-api` va **a mano** al EC2 de `n8n-maros` (SEGUIMIENTO). |
| Dueño de las tablas de acabado | M3: `FAMILIA_POR_PALABRA_CATALOGO` + `ACABADO_MOTOR_POR_FAMILIA` en `src/lib/plan/acabados-motor.ts`, exportadas como `x-acabados-motor` | L1: `FAMILIA_CORPUS_V007` (familia → frase del corpus) en `src/lib/lora/vocabulario-corpus-v007.ts` | **Una sola cadena:** palabra del catálogo → `FamiliaSempertex` (**M3 es el dueño**) → (a) acabado del motor (M3) y (b) frase del corpus v007 (L1, con clave `FamiliaSempertex`, no palabras sueltas) → (c) palabra perceptual para Gemini y v004 (`descriptor-perceptual.ts`). `FINISH_WORDS` deja de tener claves propias y deriva de M3. **Por eso M3 va antes que L1.** |
| Texto de color en el prompt de Gemini | G4: `clave_en` = `color_con_acabado_en` (perceptual, p. ej. «high-shine chrome gold») | L1: palabras del corpus | **Sin conflicto real:** el anexo (b), R6, deja Gemini y v004 en perceptual. El corpus solo aplica al dialecto `product_v007`. |
| Contexto visual (evento, lugar, luz) | G1: quitar `USER REQUEST VERBATIM` y `PALETTE` del prompt | C6: derivar el contexto de `plan.original_request` | **Complementarios.** G1 quita el texto literal; C6 cambia **de dónde** se derivan `Event/Venue/Time of day`. Se aplican juntos (F1). |
| Ubicación de la pareja de columnas | G5: espejo en `entrada` (cajas) | L3: `two matching … one at each end of the …` (caption) | **Complementarios.** G5 cambia las cajas (que lee el caption); L3 cambia la frase. Revisar `ia:test-lora-bilateral` en los dos PR. |
| Semiarco | Informe inicial: «nunca se arma» | M5 re-verificado: **ya está cableado** (`TIPOS_CON_MOTOR`, `_receta` con `medio=True`) | Hallazgo cerrado. M5 se reduce a clase oficial, aro y techo. |
| Inclinación clásica | Informe inicial: «se ignora» | M6.b corregido: el campo `inclinacion` clásico es la **pendiente del patrón**, no el vuelo | No falta cableado; falta una capacidad, que va por la ruta del clasificador (o se avisa). |

---

## 4. Plan por fases

Cada fila es **un PR independiente y reversible**. Una fase no empieza sin que la anterior cumpla su criterio de salida. Las evaluaciones de pago declaran su tope **antes** de correr y desactivan la telemetría.

### F0 · Red de seguridad y coordinación (sin cambio de comportamiento)

| PR | Ítems | Contenido | Criterio de salida |
|---|---|---|---|
| F0.0 | §6.1 | **Coordinar las ediciones concurrentes** (D1, FINISH_WORDS) y congelar el árbol de `columnaorg`/`organico` mientras se regeneran oráculos | Decisión D1 escrita; nadie edita los motores durante F0.1 |
| F0.1 | S1, S2, S3 | `mate.pow` → `ieee754.pow` (fdlibm); generadores del clasificador con `node --no-use-std-math-pow` y guarda que falla sin la opción; oráculos de **todos** los motores regenerados **desde el clasificador commiteado**, con `pow`, `fuente_commit` y `fuente_sucia` | `pytest -q` con 0 fallos en Windows **y** en Linux |
| F0.2 | S13, S4 | Matriz de CI Windows + Linux para las pruebas de motor; `test_puerta_mate.py` | Job verde en los dos sistemas |
| F0.3 | S12, D13 | Excepciones de vectores sin `expected` declaradas y con caducidad; `expected` del vector 32 a mano | `plan:test-color-escena` falla ante un vector no declarado |
| F0.4 | H0 (modo informativo) | Extraer `armarPromptGemini()` de `route.ts`; `ia:test-invariantes-prompt-imagen` con I1 activo y I2–I14 como `[PENDIENTE Gx]` | En verde; imprime qué invariantes están pendientes |
| F0.5 | Anexo (a) (modo informativo) | `lora:medir-corpus`, `data/lora/corpus-v007-ngramas.json`, `lora:test-corpus-gate` (solo avisos); `TRIGGERS` del barrido incluye v3 | La tabla de los 30 peores n-gramas sale en el informe |
| F0.6 | S9, S10, S7, S8, M2, D8 | Log `banderas_efectivas` al arrancar (Next `src/instrumentation.ts` y `lifespan` de `ai-api`); `env:test-banderas`; `.env.example` nuevo; retirar variables muertas (los `.env` reales los edita el operador, **también en el servidor**); aviso `lecturasSinConsumidor` | La línea `banderas_efectivas` del servidor de producción, leída, **reemplaza** a `.env.production` como fuente de verdad del estado real |
| F0.7 | S5 | Borrar `bboxOverlap`, `buildLoraImagePrompt`(+V2) y `seleccionarBackendMigracion`; `test-visual-prompts.ts` pasa a cubrir `compileLoraCaption` | `tsc`, `ia:test-prompts`, `contracts:test:operational` |

### F1 · Arreglos baratos, sin contrato nuevo ni `plan_hash` de planes en vuelo

| PR | Ítems | Despliegue | Nota |
|---|---|---|---|
| F1.1 | C2 → C1 → C11 | app | Retirar `confirmar_seleccion_rag`; la aprobación remite al botón (D5); el prompt no reescribe `mensaje_cliente` |
| F1.2 | C7, C6, C8 | app | Una sola regla de edición (`ajustar` si hay propuesta vigente); `visualDesactualizada` también tras una edición por chat; contexto visual desde `original_request`; blueprint y aspecto anclados al mensaje |
| F1.3 | G1, G6, G11, G14, G9 (fase A) | app | Activa H0 I2, I3 e I4. **Es el arreglo de mayor efecto por línea cambiada en Gemini** |
| F1.4 | G3, G7, G8 | app | Activa I5, I12 e I13. G8 cambia `blueprint_hash`/`sceneSpecHash`, no `plan_hash` |
| F1.5 | C5 (pasos 1, 3 y 4; D2) | app | Las tres banderas pasan a ser explícitas; avisar en el commit a quien desarrolla en local |
| F1.6 | M3 (D4) | **app + ai-api juntos** (extensión de contrato `x-acabados-motor`, sin campos de datos) | Primero el `SELECT DISTINCT` de palabras del catálogo como fixture. Desbloquea L1 (§3) |
| F1.7 | M5, M6.a, M4 capa 1 | ai-api | Cambian el armado de los planes **nuevos** cuando `ARMADO_ARCO_COLUMNA_V1` esté encendida; en producción hoy no tienen efecto |
| F1.8 | L8, L9 | app + ai-api | Escala por defecto, `promover-lora.ts`, aviso de variantes descartadas, `dropped_sizes` visible y plazos de fal |

### F2 · Caption del LoRA en el idioma del corpus (detrás de `LORA_VOCABULARIO_CORPUS_V007`, OFF)

| PR | Ítems | Nota |
|---|---|---|
| F2.1 | L1 + anexo (b) | Depende de D1 y de F1.6. Regla R1–R6; `TERMINOS_COMERCIALES` deja de aplicarse a las 8 familias **solo** en el preflight v007 |
| F2.2 | L2, L3, L4 | `renderClauseV007`, `UBICACION_V007`, `fondoV007`; el preflight cambia **en el mismo PR** (regex de pareja y de techo) |
| F2.3 | L5 | La cobertura de color se comprueba sobre las cláusulas; nunca `(X tones)` en v007 |
| F2.4 | Evaluación | Protocolo de la Parte I: brazos A, B y F (C, D y E en F6). **~4,8 USD estimados, tope `--max-usd 7`** |
| F2.5 | Anexo (a) en modo **estricto** | Con el umbral global fijado con la medición posterior a L1–L4 |
| — | **D10** | Encender la bandera en producción solo con la evaluación firmada |

### F3 · Cambios de contrato (dos releases separados; §3)

| Release | Ítems | Orden de despliegue | Vectores |
|---|---|---|---|
| **F3a** | G4 (+ G2, G10, G14 completos, GP1, GP2) | **1) app** (acepta `colores_imagen` opcional) → **2) ai-api** (lo emite) | Regenerar los 32 `expected_python` con `REGRESION_ACTUALIZAR=1`; el diff debe mostrar **solo** `colores_imagen`; `expected` no se toca |
| **F3b** | C4 (`pedidos_patron`, acción de edición `patron_pedido`) | **1) ai-api** (acepta el campo) → **2) app** (lo envía, detrás de `PATRON_PEDIDO_CHAT_V1`, OFF) | Vector **33** nuevo con `expected` escrito a mano; los 1–32 no se mueven |
| F3c | G13 (aspectos 4:3, 3:4 y 9:16) | app + ai-api juntos (contrato de transporte `image-generate`) | — |

### F4 · Prompt de Gemini v2 (detrás de `PROMPT_IMAGEN_V2`, OFF)

| PR | Ítems | Nota |
|---|---|---|
| F4.1 | G12 | Estructura objetivo de 12 secciones, un bloque por grupo de repetición, negativos filtrados contra lo aprobado y regla de texto invisible **una vez**. Presupuesto `5500 + 900·grupos + 60·instanciasExtra + 120·colores`, con techo de 12.000 caracteres (hoy 30.067–47.297). Activa I6–I8 |
| F4.2 | Evaluación | `npm run ia:eval` con 10 planes, antes y después, mismos insumos. **Tope a declarar antes de correr** (no hay estimación de coste de Gemini imagen en este plan) |
| F4.3 | G15 | Quitar `correctiveInstruction` y decidir `GEMINI_IMAGE_PYTHON_ENABLED` por ADR |
| — | D10 | Promoción por una persona |

### F5 · Encendido medido de banderas en producción (matriz de la Parte IV)

En orden: **paso 2** `PATRON_REFERENCIA_PYTHON_ENABLED` → **paso 3** `ARMADO_ARCO_COLUMNA_V1` (despliegue conjunto) → **paso 4** `PATRONES_COLOR_V1` → **pasos 5 a 7** (guirnalda, bouquet, conteo, en pares lectura+consumidor) → **paso 8** `LECTURA_UNICA` (v17 frente a v16; invalida la línea base de ADR-0029) → **pasos 9 y 10**.

- Cada paso tiene su medición, su criterio (D11) y su reversión, que es poner la variable a `false` y reiniciar.
- **Aviso:** encender solo el paso 2 **ya cambia la mezcla y la compra** de los planes nuevos, porque los tamaños leídos mandan sobre la mezcla declarada.
- Requisito: F1.6 y F1.7 desplegados.

### F6 · Cableado restante

M6.c (forma y relleno de la guirnalda), M8 (croquis del motor como guía), M9 (editar el arco orgánico), M10 (cola de dibujos, solo si la medición lo confirma), M7 (vista previa del bouquet, D7), L6 (formato v004, D6), L7 (guía al final del caption, brazo E), C3 (emulación aceptada con botón), C9 (texto completo del cliente para las restricciones) y G5 (D3).

### F7 · Ruta del clasificador (primero allí, luego se porta)

M4 capa 2 (reparto por peso dentro del patrón), M6.b opción 1 (vuelo de la pieza clásica), M11.c (D9), C10 (D12), motores de aro y de techo si se deciden. Para cada uno: cambio en `clasificador-decoraciones` → `scripts/migracion/vectores-*.ts` (con `--no-use-std-math-pow`) → copiar a `pictures/contracts/domain/v1/golden/` → portar hasta que pasen las pruebas. **Nunca al revés.**

### Grafo de dependencias críticas

```
F0.1(S1-S3) ─► F0.2(S13) ─────────────────────────────────────────────► todas las fases (CI verde)
F0.4(H0) ─► F1.3/F1.4 (activan I2-I5, I12, I13) ─► F3a(G4: I4, I10) ─► F4(G12: I6-I8)
F0.5(gate) ─► F2.1-F2.3 ─► F2.4(eval) ─► F2.5(gate estricto) ─► D10
D1 ─► F2.1      F1.6(M3) ─► F2.1(L1)      F1.6 ─► F1.7 ─► F5 paso 3 ─► F6(M8)
D2 ─► F1.5 ─► F5          F0.6(S9) ─► F5 (estado real de prod, observable)
F3b(C4) ─► F5 paso 4 (patrón pedido + preset coherentes)
```

---

## 5. Matriz de impacto consolidada

| Ítems | `plan_hash` | Contrato | Vectores dorados | Despliegue |
|---|---|---|---|---|
| L1–L5, L7–L9, anexo (a) | no | no (campos aditivos en la respuesta de `/api/generate`: `loraEvaluacion`, `guiaEstructura.motivo`) | no | app (+ai-api en L9) |
| L6 | no | no | no | app |
| G1, G3, G7, G9–G11, G14, G15, GP* | no | no | no | app |
| G2, G6, G8, G5 | no | `SceneSpec` interno | no (cambia `sceneSpecHash`) | app |
| G4 | **no** (fuera del snapshot) | `plan-resuelto.v1` + `colores_imagen?` | 32 `expected_python` | **app → ai-api** |
| G12 | no | no | no | app (bandera) |
| G13 | no | `SceneSpec` + transporte `image-generate` | no | app + ai-api |
| C1, C2 (pasos 1–4), C5–C8, C11 | no (C5: solo en local) | no | no | app |
| C2 paso 5 | no | `chat.sse.v1` (retira `seleccionIA`) | no | consumidor primero |
| C3 | planes nuevos con pared | `chat-v1` + `emulacionesAceptadas?` | no | app |
| C4 | planes nuevos con patrón | `plan-resolution.v1` + `pedidos_patron?`, edición `plan-editar` | +33 | **ai-api → app** |
| C9 | `restricciones` de planes nuevos | no | no | app |
| C10 | planes nuevos | `plan-decoracion.v1` (enum), con legado en lectura | revisión manual | clasificador → ai-api + app |
| M3 | planes nuevos con armado | extensión `x-acabados-motor` | no | app + ai-api |
| M4, M5, M6.a, M6.c, M11.c | planes nuevos con armado | M6.c: `omoikane-armado-estructura.v1` | motor: solo M4 capa 2 (clasificador) | ai-api |
| M7, M9 | no / por edición | respuesta de la vista previa del bouquet; variante de edición | no | app + ai-api |
| S2 | no (`plan_hash` no lleva coordenadas: verificar `grep -rn "svgSha\|globosSha"`) | no | **todos los oráculos de motor**, desde el clasificador | ai-api |

---

## 6. Riesgos transversales

### 6.1 El árbol se edita mientras tanto

Durante la auditoría cambiaron, al menos, estos archivos:

| Archivo o símbolo | Qué cambió |
|---|---|
| `FINISH_WORDS` | D1 |
| `tests/test_organico.py` y `golden/organico/vectores-organico.json` | Produjeron 262 fallos pasajeros |
| `golden/dibujos/` y `app/referencias/dibujos.py` | Aparecieron |
| `plan.py` | Desplazamiento de líneas: `:3912` → `:3930` |
| Cableado del semiarco | Se completó |

**Regla:** antes de cada PR se repite `git status` y se re-localiza cada cita por su símbolo. Los cambios ajenos se preservan (AGENTS.md, «Working discipline»).

### 6.2 Despliegue asimétrico

`main` dispara las *Quality checks* y el despliegue de la app a EC2. `ai-api` **no** se despliega solo, sino a mano. Todo cambio de contrato sigue el orden de §4 F3, y la reversión consiste en desplegar juntas la revisión anterior de la app y la de `ai-api` (AGENTS.md).

### 6.3 `.env.production` del árbol probablemente está obsoleto

Es del 16 de septiembre, y el entorno real vive en el servidor (`deploy-demo-decoracion.sh`). Hasta que S9 esté desplegado, **ninguna afirmación sobre el estado de producción es segura**. Por eso F0.6 va antes de F5.

### 6.4 Cambios de precio en planes nuevos

M3, M4, M5, M6 y el paso 2 de F5 cambian **qué se compra**. No afectan a planes aprobados en vuelo, pero sí a la cotización de los nuevos. Cada uno se comunica al equipo comercial antes de encenderse.

### 6.5 El LoRA casi no vio patrones

v005 tiene 8 captions con «alternating»; v007, 0. C4 y el paso 4 de F5 pueden cobrar un patrón que la imagen no sigue. Hay que medirlo antes de prometerlo en el texto del chat (SEGUIMIENTO §0, pendiente 1).

---

## 7. Evaluaciones de pago previstas

| Corrida | Fase | Diseño | Coste | Decide |
|---|---|---|---|---|
| LoRA corpus | F2.4 / F6 | 8 planes × 3 semillas; brazos A–F; 2 evaluadores a ciegas | ~4,8 USD **estimados** (0,033 USD/imagen); **tope 7 USD** (`exp-fal-lib.ts --max-usd 7 --confirm-spend`) | Persona, firmando en `lora_evaluations` (`protocol_version = "corpus-v007.v1"`) |
| Prompt Gemini v2 | F4.2 | 10 planes, antes y después; métricas: conteo, color, texto renderizado | **Tope a declarar** antes de correr | Persona |
| Lecturas de la foto (pasos 2, 5, 6, 7 y 8 de F5) | F5 | Set fijo de fotos etiquetadas, fuera del repo, sin generar imagen | A declarar en cada paso | Persona, según D11 |
| Fidelidad del patrón | F5 paso 4 | Gemini frente a LoRA con `scripts/lib/medir-guia.ts` | A declarar | Persona |

Ninguna imagen, ruta absoluta ni dato de cliente entra al repo. Se guardan `request_id`, semilla, hash del prompt, versión del compilador y bandera.

---

## 8. Definición de terminado (global)

```bash
cd "C:/New folder/pictures"
npm run build --workspaces --if-present
npm run contracts:check
uv run --directory services/ai-api python scripts/generate_models.py --check
npx tsc --noEmit && npm run -s lint && npm run plan:test
uv run --directory services/ai-api pytest -q
uv run --directory services/ai-api ruff check app scripts tests && uv run --directory services/ai-api ruff format --check app scripts tests && uv run --directory services/ai-api mypy app scripts
uv lock --check --directory services/ai-api
npm run lora:test-corpus-gate && npm run ia:test-invariantes-prompt-imagen && npm run env:test-banderas
npm run build
```

- [ ] `pytest` sin fallos en Windows **y** Linux; oráculos de motor con `pow: fdlibm` y `fuente_sucia: false`.
- [ ] `ia:test-invariantes-prompt-imagen` con **I1–I14 activos** (ninguno pendiente).
- [ ] `lora:test-corpus-gate` en modo estricto: 0 n-gramas con 0 apariciones en el corpus fuera de la allowlist, con el umbral global cumplido.
- [ ] En producción, la línea `banderas_efectivas` coincide con la matriz de F5 en el paso alcanzado.
- [ ] Prompt de Gemini con 12.000 caracteres como máximo, en los 32 vectores.
- [ ] Decisiones D1–D13 escritas.
- [ ] `SEGUIMIENTO.md` corregido: `PATRONES_COLOR_V1` **no** está encendida en `.env.local`.
- [ ] Informe final con los comandos ejecutados, sus resultados y lo que no se ejecutó (AGENTS.md, «Verification and completion»).

---

## 9. Estado de ejecución (2026-10-04, tarde)

Sin commitear, encima de los cambios de la otra sesión. Cada ítem tiene su prueba de regresión.

| ID | Estado | Qué se hizo | Dónde |
|---|---|---|---|
| S1/S2 | **Cerrado por la otra sesión** | Los 4 fallos de `test_columnaorg.py` se resolvieron comparando coordenadas con tolerancia y el `sha` del SVG exacto (memoria «V8 no usa la libm»). S2 (fdlibm en los dos lados) **se descarta**: chocaría con esa decisión | `tests/test_columnaorg.py` |
| G1 + C6 | Hecho | `SCENE LOCK` → `SCENE CONTEXT`, por debajo del plan; sin `PALETTE` del brief, sin `USER REQUEST VERBATIM`, sin plan ni materiales en español; prioridad reescrita; evento/lugar/hora salen de `plan.original_request` (toda la conversación), no del último mensaje | `visual-context.ts`, `build-image-prompt.ts`, `generate/route.ts` |
| G3 | Hecho | Kits, figuras y bouquets con globos en el estimado reciben línea de color; ya no «No balloon color mix is approved» | `build-image-prompt.ts` (`llevaGlobosDelPlan`) |
| G4 (parcial) | Hecho | El candado monocromo lleva el acabado (`Finish: high-shine chrome.`). El bloque `colores_imagen` del contrato **sigue pendiente** (F3a) | `build-image-prompt.ts` |
| G6, G7, G8, G9-A | Hecho | Escala sin flotantes ni tipo interno; una sola regla de conteo (±10 %); simetría del plan (`symmetric` con pares) en vez de `asymmetric` fijo; `negative_space` en inglés; no se promete una referencia de composición que no se envió | `build-image-prompt.ts`, `blueprint.ts`, `scene-spec.ts` |
| G10 | Hecho | Las fotos de catálogo que no cargan se registran y cuentan; el texto de verificación de color solo sale si hay fotos | `generate/route.ts`, `build-image-prompt.ts` |
| G11 | Hecho | Sin imagen previa no hay `REVISION DELTA` (cliente y servidor) | `page.tsx`, `generate/route.ts` |
| G14 | Hecho | Descripción de producto sin `R-12` ni nombre repetido ni `..`; descripción útil de la foto de referencia | `producto-para-imagen.ts`, `generate/route.ts` |
| C1, C2, C11 | Hecho | Retirada `confirmar_seleccion_rag` (herramienta, manejador, texto que prometía imagen); el chat remite al botón «Aprobar y ver cómo queda» (D5 = B); `mensaje_cliente` sin promesas; «Regenerar visual» | `herramientas.ts`, `registro-herramientas.ts`, `texto-final-turno.ts`, `prompt-sistema.ts` |
| C7 | Hecho | Una sola regla de edición (ajustar si hay propuesta vigente) y la imagen queda marcada desactualizada también tras una edición por chat | `prompt-sistema.ts`, `page.tsx` |
| C8 | Hecho | Una propuesta anclada usa el blueprint de su mensaje y el aspecto solo si es la misma foto | `generacion-adjuntos.ts` (`contextoDeGeneracion`), `page.tsx` |
| M3 | Hecho | «reflex»/«metal(izado)» → cromado, «cristal» → transparente, «perlado» → mate con aviso, con la tabla `acabadoDe` del repo dueño (una sola copia: `color_catalogo.ACABADO_MOTOR_POR_FAMILIA`, que ahora lee también `dibujo_estructura.py`) | `color_catalogo.py`, `armado_estructura.py`, `plan_armado_*_organic*.py` |
| M4 capa 1 | Hecho | El arco y la columna clásicos ponen primero el color dominante declarado | `armado_estructura.py` (`_orden_por_peso`) |
| M5 | Parcial | Aro y techo ya los excluyó la otra sesión (`OFICIALES_SIN_MOTOR`). **Pendiente:** `columna_asimetrica`/`arco_asimetrico` con mezcla clásica → necesita un campo en `PiezaArmado` (contrato, Zod primero) | — |
| M6.a | Hecho | La columna orgánica se corona si la foto ve un globo; estrella/racimo/corazón avisan | `armado_estructura.py` |
| M2, S9 | Hecho | `banderas_efectivas` al arrancar (Next `src/instrumentation.ts`, ai-api `lifespan`) sin secretos; aviso `lecturas_sin_consumidor` | `feature-flags.ts`, `instrumentation.ts`, `main.py` |
| S7/S8 | Hecho (solo `.env.example`) | Documentadas las banderas de imagen; retiradas `PYTHON_BACKEND_ENABLED/KILL_SWITCH`, `IMAGE_QA_ENABLED`, `SCENE_PLAN_V2_*` salvo `SHADOW`. **Los `.env` reales (local, producción, servidor) los edita el operador** | `.env.example` |
| S5 | Parcial | Borrados `bboxOverlap` y el envoltorio `buildLoraImagePrompt`. `seleccionarBackendMigracion` se queda (documenta un contrato vivo) | — |
| F0.5 | Hecho (informe) | `npm run lora:informe-corpus` mide cada n-grama del caption contra las 345 captions. Hoy, con el `FINISH_WORDS` perceptual: `high-gloss chrome finish` 100 % de los prompts / 0 en el corpus; `solid matte finish` 83 % / 0 | `scripts/lora/informe-corpus.ts` |
| Pruebas | Arreglado | Tres regex de prueba tenían el carácter retroceso (`\x08`) en lugar de `\b` y sus aserciones negativas pasaban siempre | `test-armado-guirnalda-prompt.ts:507`, `test-lora-caption-compiler.ts:292`, `test-lora-product-runtime.ts:874` |

### 9.1 Decisiones del usuario aplicadas (2026-10-04, noche)

| Decisión | Qué se hizo |
|---|---|
| **No usar el LoRA entrenado** | Modo nuevo `base`, el default: FLUX.2 en fal con `loras: []` y sin trigger (los endpoints `flux-2/lora` y `/edit` aceptan la lista vacía). No necesita fila en la base, y el chat, la edición y la generación ven **el catálogo completo**: antes el modo limitaba el catálogo a lo que vio el LoRA. Los modos entrenados siguen disponibles, pero no son el default (en desarrollo, `NEXT_PUBLIC_LORA_MODE`). Python acepta `loras` vacío. |
| **Vocabulario nuevo** (sustituye D1 y L1–L5 para el default) | Dialecto `base` del compilador y `src/lib/lora/vocabulario-base.ts`: acabados que se ven («mirror-like chrome», «satin pearlescent», «translucent»), colores de fantasía pasados a color real, sin nombres de línea comercial, sin `(` ni `;`, tamaño en pulgadas y escala relativa, cierre fotográfico. Cubre los 270 conceptos y, si un producto no está, sale de su propio título de catálogo. Tiene presupuesto propio de 1000 caracteres y un preflight propio, que la ruta ya usa. |
| **D2** | `featureEnabled` ya no depende de `NODE_ENV`: todo **encendido por defecto, igual en local y producción**. Quedan apagadas solo `SCENE_PLAN_V2_SHADOW` (diagnóstico), `REFERENCIA_EN_ETAPA1_V1` y `GUIA_ESTRUCTURA_V1` (píxeles por `/edit`, sin medir con el modelo base). Lecturas de la foto (lectura única v17 + patrón, bouquet, conteo y guirnalda) también encendidas. `AMBIENTE_FIESTA_V1` encendida, con el aviso «no cotizado» ya visible junto a la imagen. |
| **D3** | Un número par de piezas en `entrada` la flanquea (mitad a cada lado). |

Verificado: `tsc` y `lint` sin errores. De `plan:test`, 106 de 107 scripts pasan, corridos uno por uno; `contracts:check` está al día. Python (agente): 7700 pruebas pasan. Hay dos fallos ajenos, de trabajo en curso de otra sesión: la instantánea de la tarjeta (`ui:test-armado-guirnalda`) y `ia:test-guia-estructura`, porque la tabla de color se está cambiando. **No se ha generado ninguna imagen real con el modo base**: falta una corrida de pago con tope para validar el vocabulario.

**Pendiente, por decisión o por ser contrato:** D1 (vocabulario LoRA: L1–L5), D2 (banderas `NODE_ENV`; no se tocó para no cambiar el entorno local de la otra sesión), D3 (G5 `entrada`), D6, D7, D9, D11–D13; F3a (G4 `colores_imagen`), F3b (C4 `pedidos_patron`), F4 (G12 prompt v2), F5 (encendido de banderas en producción), C3, C9, C10, M5 (resto), M6.b/c, M7–M11, L6–L9, G2, G5, G13, G15. `SEGUIMIENTO.md §0` sigue diciendo que `PATRONES_COLOR_V1` está encendida en `.env.local`: no lo está.

---

# Partes técnicas

Las partes conservan el formato con el que se verificaron. Los niveles de título están desplazados uno hacia abajo para que cuelguen de este documento.


---

## Parte I · Plan de remediación del camino LoRA (fal / FLUX.2): caption, vocabulario y flujo

Este documento es el plan de arreglo de los hallazgos L1 a L9 de la auditoría del camino LoRA.

**Árbol revisado el 2026-10-04.** Cada `archivo:línea` se volvió a comprobar contra el árbol actual justo antes de escribir esto.

> **Aviso: alguien está editando el compilador ahora mismo y en dirección contraria a este plan.**
> Mientras se hacía la auditoría, `FINISH_WORDS` (`src/lib/ia/kagutsuchi/lora-caption-compiler.ts:309-354`) pasó de las palabras del corpus (`Reflex high-shine`, `matte Fashion`) a las perceptuales (`reflex: "high-gloss chrome"`, `fashion: "solid matte"`, `silk: "soft pearlescent"`). Su comentario lo justifica así: «Manda la imagen».
>
> L1 y el anexo (b) proponen la regla que resuelve esa tensión. **Hay que acordarla con quien está editando antes de tocar nada**, porque si no los dos cambios se van a pisar.

### Cómo se midió

- **Corpus:** las 345 captions de `data/staging/lora-v007/captions/*.txt`, con trigger `eventdecor_style_v3`.
- **Prompts compilados:** 540 escenas por trigger. Son las combinaciones de `scripts/test/test-lora-preflight-barrido.ts`: 5 piezas focales × 2 opciones de soporte × 3 de acento × 6 paletas × 3 eventos, con productos reales y tallas R-5, R-12 y R-18.
- **Conteo:** coincidencia exacta de frase, normalizada a minúsculas y separando por palabras.
- **Script:** `scratchpad/medir.ts`. Las salidas están en `prompts.json` y `json.json`.
- **Corpus de v004:** no está en el árbol. `data/processed/lora-v004-composicion.json` solo tiene estadísticas. Por eso todo lo que se afirma de v004 está marcado como *probable*.

### Plantilla del corpus v007 (lo que hay que imitar)

Las 345 captions son **una sola oración**: 0 captions tienen un `. ` en medio. Siguen este esquema:

```
eventdecor_style_v3, <PIEZA>, <UBICACIÓN>[, <RELACIÓN>], built from <MATERIALES>[, <RELACIÓN DE TALLAS>]
  [, <PIEZA 2> …][ and <PIEZA N> …], alongside <PROPS>, set against <PARED> and <PISO>.
```

Conteos de cada parte en el corpus:

| Elemento | Forma en el corpus (conteo) |
|---|---|
| Conector de materiales | `built from` (524) |
| Material | `<N-inch> <familia> <color> round latex balloons`; talla delante de la familia: 435; `round latex balloons`: 911 (en singular: 0) |
| Familias | `matte Fashion` (533), `high-shine Reflex` (212), `satin Silk` (76), `Pastel Matte` (64), `muted Pastel Dusk` (63), `Metallic` (59), `fluorescent Neon` (17), `translucent Crystal` (9) |
| Relación de tallas | `mixed organically rather than graded` (218), `all at a single N-inch size` (134), `all in N-inch and N-inch` (15) |
| Ubicaciones | `installed against the rear wall` (127), `grounded across the front` (128), `standing to one side` (86), `centred on the main display area` (75, con «centred» británico), `placed on the main table` (31), `suspended overhead` (16), `framing the entrance` (5), `distributed across the guest tables` (2) |
| Relaciones | `anchored to the <pieza>` (74), `one at each end of the <pieza>` (26), `two matching <piezas>` (42), `behind the <pieza>` (≥10) |
| Props | `alongside …` (245 de 345 captions) |
| Cierre | `set against …` (345 de 345). Las formas más frecuentes son `white wall(s)` (86+), `off-white walls` (20), `tiled floor` (57), `plain white studio backdrop` (14+), `no floor visible` (24) |
| Formas ausentes | Paréntesis: 2 en todo el corpus. Punto y coma: 20. `celebration`, `wedding`, `photorealistic`, `natural depth`, `grounded supports`, `flanking`, `centered`, `stage photo area`: todas 0 |

---

### L1 · `aDescriptorPerceptual` (y ahora también `FINISH_WORDS`) sustituye las palabras del corpus por otras con 0 apariciones

**Problema.** En el dialecto `product_v007`, el acabado y el color llegan al LoRA con palabras que nunca vio.

**Causa raíz.**

- **Dónde se reescribe:**
  - `src/lib/lora/descriptor-perceptual.ts:20-27`: la tabla `ACABADOS`.
  - `src/lib/lora/descriptor-perceptual.ts:36-48`: la tabla `COLORES`.
  - `src/lib/lora/descriptor-perceptual.ts:65-72`: `aDescriptorPerceptual`.
- **Dónde se aplica:**
  - `src/lib/ia/kagutsuchi/lora-product-runtime.ts:218`: `canonicalLabel: aDescriptorPerceptual(result.concept.canonical_label)`. Con esto se reescriben 109 de las 178 etiquetas activas de v007.
  - `src/lib/ia/kagutsuchi/lora-product-runtime.ts:287`: la referencia de color.
- **Segunda vía:** el respaldo `FINISH_WORDS` (`lora-caption-compiler.ts:330-354`), editado ahora a palabras perceptuales.
- **Bloqueo:** `descriptor-perceptual.ts:51-58`, `TERMINOS_COMERCIALES`, prohíbe `Reflex`, `Fashion`, `Silk`, `Pastel` y `Crystal`. El test `scripts/test/test-lora-product-runtime.ts:239-242` lo exige.

**Código actual.**

```ts
// descriptor-perceptual.ts:20-27
[/\bSilk satin\b/gi, "soft pearlescent"],
[/\bReflex high-shine\b/gi, "high-gloss chrome"],
[/\bPastel Dusk muted\b/gi, "muted dusty matte"],
[/\bPastel Matte\b/gi, "soft matte"],
[/\btranslucent Crystal\b/gi, "translucent"],
[/\bsolid Fashion\b/gi, "solid matte"],
// lora-caption-compiler.ts:331
reflex: "high-gloss chrome",
```

**Evidencia.** Cada palabra que sale hoy aparece 0 veces en el corpus. Esto es lo que el corpus dice en su lugar:

| Sale hoy | Corpus | | Sale hoy | Corpus |
|---|---|---|---|---|
| `high-gloss chrome` (0) | `high-shine Reflex` 212 | | `warm ivory off-white` (0) | `cream pearl` 12 |
| `solid matte` (0) | `matte Fashion` 533 | | `soft luminous white` (0) | `pearl white` 19 |
| `soft pearlescent` (0) | `satin Silk` 76 | | `pale desaturated mint` (0) | `mint green` 15 |
| `soft matte` (0) | `Pastel Matte` 64 | | `pale warm golden beige` (0) | `champagne` 14 |
| `muted dusty matte` (0) | `muted Pastel Dusk` 63 | | `very pale icy blue` (0) | `arctic blue` 20 |
| `fluorescent` (respaldo) | `fluorescent Neon` 17 | | `soft muted violet` (0) | `amethyst` 16 |

**Cambio propuesto.** La forma en que se nombra el acabado y el color pasa a depender del dialecto. No se elimina el descriptor perceptual, porque Gemini lo sigue usando.

```ts
// NUEVO: src/lib/lora/vocabulario-corpus-v007.ts (puro, sin server-only)
/** Familia de acabado → forma exacta del corpus v007, con su conteo medido (regenerable con L-gate). */
export const FAMILIA_CORPUS_V007: Readonly<Record<string, { frase: string; corpus: number }>> = {
  "solid fashion":       { frase: "matte Fashion",       corpus: 533 },
  "fashion matte":       { frase: "matte Fashion",       corpus: 533 },
  "matte":               { frase: "matte Fashion",       corpus: 533 },
  "solid":               { frase: "matte Fashion",       corpus: 533 },
  "reflex high-shine":   { frase: "high-shine Reflex",   corpus: 212 },
  "silk satin":          { frase: "satin Silk",          corpus: 76 },
  "silk sheen":          { frase: "satin Silk",          corpus: 76 },
  "pastel matte":        { frase: "Pastel Matte",        corpus: 64 },
  "pastel dusk muted":   { frase: "muted Pastel Dusk",   corpus: 63 },
  "pastel dusk":         { frase: "muted Pastel Dusk",   corpus: 63 },
  "metallic":            { frase: "Metallic",            corpus: 59 },
  "metallic sheen":      { frase: "Metallic",            corpus: 59 },
  "neon fluorescent":    { frase: "fluorescent Neon",    corpus: 17 },
  "translucent crystal": { frase: "translucent Crystal", corpus: 9 },
  "satin":               { frase: "Satin",               corpus: 28 },
};
export const SUSTANTIVO_FORMA_V007: Readonly<Record<string, string>> = {
  round: "round latex balloons",            // 911
  modeling: "modeling latex balloons",      // 122
  link: "linking latex balloons",           // 18
  "link-o-loon": "linking latex balloons",
  heart: "heart-shaped latex balloons",     // 15 (latex) / 14 (foil: "heart-shaped foil balloons")
  star: "star-shaped foil balloons",        // 8
  number: "number foil balloons",           // 13
};
/** Regla del anexo (b): nombre de color del corpus salvo excepción verificada en imagen. */
export function colorParaV007(colorCatalogo: string): string;          // ver anexo (b)
/** "12-inch high-shine Reflex rose gold round latex balloons" o undefined si el concepto no es plano (mixto/impreso). */
export function materialCorpusV007(concept: ProductConcept, tallas: readonly string[]): string | undefined;
```

**En `lora-product-runtime.ts`:**

- `ProductConceptClauseInput` gana `corpusV007?: { familia: string; color: string; sustantivo: string }`. Se rellena en `resolveElement`, igual que hoy `sceneTerms`.
- `canonicalLabel` sigue pasando por `aDescriptorPerceptual`. Lo usan el dialecto v004 y Gemini.

**En el compilador:** cuando `dialect === "product_v007"` y todas las entradas de la cláusula traen `corpusV007`, la frase de material se arma con L2 a partir de `corpusV007` en vez de con `canonicalLabel`.

**`FINISH_WORDS`.** Se separa en dos tablas: `FINISH_WORDS_V007` (las formas del corpus) y `FINISH_WORDS_PERCEPTUAL` (la tabla actual, que queda para `scene_v004` y Gemini). `englishFinish(finish, dialect)` recibe el dialecto.

**`TERMINOS_COMERCIALES`.** Sigue aplicándose a Gemini (`assertDescriptorPerceptualSeguro`). El preflight del LoRA v007 lo deja de aplicar a las 8 familias de `FAMILIA_CORPUS_V007`. Las palabras del corpus no son fugas comerciales: son el idioma del LoRA.

**Pruebas.**

- `scripts/test/test-lora-product-runtime.ts:239-242` se cambia y se divide en dos:
  - Con trigger `eventdecor_style_v3`, el prompt contiene `high-shine Reflex gold round latex balloons` y `high-shine Reflex rose gold round latex balloons`, y no contiene `high-gloss chrome`.
  - Con trigger `eventdecor_style_v2`, se mantiene la aserción actual (`glossy chrome` o `high-gloss chrome`).
  - Script: `npm run lora:test-product-runtime`.
- Nuevo `scripts/test/test-vocabulario-corpus-v007.ts` (`npm run lora:test-vocabulario-corpus`). Comprueba que cada `frase` de `FAMILIA_CORPUS_V007` aparece en el corpus al menos 9 veces y que su conteo coincide con el declarado, con una tolerancia de ±0.
- La puerta de vocabulario del anexo (a).

**Impacto en `plan_hash`, contratos y vectores dorados.** No hay. El caption está fuera de `{plan, snapshot}`. Cambian `loraPromptHash` y `captionHash` de la telemetría. Hay que subir `LORA_CAPTION_COMPILER_VERSION` (`lora-caption-compiler.ts:11`) a `lora-caption-v3.0-corpus-v007` y `LORA_PRODUCT_RUNTIME_VERSION` a `.v2`.

**Riesgos.**

- La afirmación de `reports/lora-debug/color-fidelidad` («spring pink → rosa chicle») no se puede volver a verificar: el informe no está en el árbol.
- Volver a nombrar familias comerciales puede devolver el error de color que ese informe describe. Se mitiga con el anexo (b) y el protocolo de evaluación.

**Reversión.** La regla vive detrás de `LORA_VOCABULARIO_CORPUS_V007` (`featureEnabled`, por defecto OFF hasta que la evaluación la apruebe). Apagar la bandera devuelve los bytes actuales; el test v2 lo garantiza.

**Dependencias.** L2, que pone la plantilla donde se insertan estas palabras. Anexo (b). L5, porque la cobertura de color depende del nombre que salga.

**Esfuerzo:** M.

---

### L2 · La plantilla de la cláusula no es la del corpus

**Problema.**

- El sustantivo de la pieza va pegado al material sin conector y nunca aparece `built from`.
- El material va en singular.
- Las tallas van entre paréntesis y la ubicación va al final.
- Usa `;` y punto entre oraciones.

**Causa raíz.**

- `lora-caption-compiler.ts:1238-1241` (`core` + `material`).
- `:1282` (`${colored} ${placementPhrase}`).
- `:608-611` (`withSizes` → `label (sizes)`).
- `:620-647` (`factorLabels` une con `"; "` en `:645`).
- `:649-651` (`pluralizeLabelObject` solo pluraliza cuando agrupa).
- `:1428-1430` (`buildCaption` → `${trigger}, ${structureSentence}. ${tail}`).

**Código actual.**

```ts
// :1241 y :1282
const colored = material ? `${core} ${material}` : core;
return `${colored} ${placementPhrase}`;
// :1430
return `${CAPTION_TRIGGER}, ${parts.structureSentence}. ${parts.tail.join(", ")}.`;
```

**Salida medida** (v3, 540/540 sin conector, 540/540 con paréntesis):

`eventdecor_style_v3, an organic balloon arch round latex balloon in gold with a high-gloss chrome finish (5-inch, 12-inch and 18-inch), mixed organically rather than graded centered around the stage photo area. …`

**Cambio propuesto.** Un renderizador propio del dialecto v007. El de v004 no se toca.

```ts
// lora-caption-compiler.ts — nuevo
function renderClauseV007(clause: LoraVisualClause, render: CaptionRenderState): string {
  const pieza = articuloYSustantivo(clause);                      // "an organic balloon arch" | "two matching balloon columns"
  const ubicacion = UBICACION_V007[clause.placement];              // L3
  const relacion = clause.relation ? `, ${clause.relation}` : "";  // L3: "anchored to the …", "one at each end of the …"
  const materiales = materialesV007(clause, render);               // "5-inch matte Fashion white round latex balloons and high-shine Reflex gold round latex balloons"
  const tallas = relacionTallasV007(clause, render);               // ", mixed organically rather than graded" | ", all at a single 12-inch size" | ""
  const patron = clause.colorPattern ? `, ${clause.colorPattern}` : ""; // verbatim, ADR-0028 §12
  return `${pieza}, ${ubicacion}${relacion}, built from ${materiales}${tallas}${patron}`;
}
```

**Reglas de `materialesV007`:**

- **Un material:** `${talla ? talla + " " : ""}${familia} ${color} ${sustantivo}`. Ejemplo: `12-inch matte Fashion white round latex balloons`.
- **Tallas por concepto:** si el concepto tiene más de una talla, se escribe `5-inch and 12-inch matte Fashion white round latex balloons`. Es la forma `N-inch and N-inch` (12 en el corpus). Nunca entre paréntesis.
- **Si toda la cláusula comparte una sola talla:** no se pone prefijo y se añade `, all at a single N-inch size` (134). Para ese caso se elimina la regla de `fraseRelacionTamanos` (`:1140-1149`) que lo suprimía.
- **Cola de tallas:** `fraseRelacionTamanos` se queda solo para `mixed organically rather than graded` (218).
- **Unión:** varios materiales con `joinNatural`, usando « and ». Nunca `;`.

**`buildCaption` para v007:**

```ts
`${trigger}, ${joinNatural(clausulas)}${props ? `, alongside ${props}` : ""}, ${fondo}.`
```

Es una sola oración. `fondo` viene de L4.

**Compactación (`CAPTION_RENDER_STEPS`, `:932-943`) en v007:**

- El orden es: quitar `alongside`, pasar las tallas al rango del corpus `all in N-inch and N-inch` (15), quitar tallas, compactar el fondo a `set against white walls and a tiled floor`.
- `shortLabels` no aplica, porque la familia no se puede quitar: es el acabado.
- El presupuesto de 750 se mantiene. La mediana del corpus es de 418 caracteres y el p90 de 732.

**Pruebas.**

- **Nuevo `scripts/test/test-lora-plantilla-v007.ts`** (`npm run ia:test-lora-plantilla-v007`). Con trigger v3 y la escena del sweep (arco + 2 columnas + centro de mesa) comprueba que:
  1. `/^eventdecor_style_v3, an organic balloon arch, centred on the main display area, built from /`
  2. El prompt no tiene `(`, `;` ni `/\.\s+\S/`, es decir, ningún punto que no sea el final.
  3. Cada material encaja con `/(\d+-inch (and \d+-inch )?)?(matte Fashion|high-shine Reflex|…) [a-z ]+ round latex balloons/`.
  4. Termina en `/set against [^.]+\.$/`.
- **Golden de bytes v004:** `npm run ia:test-lora-v004-compactacion` tiene que seguir pasando sin cambios.
- **Barrido:** `npm run ia:test-lora-preflight-barrido` añade el trigger `eventdecor_style_v3` a `TRIGGERS` (`test-lora-preflight-barrido.ts`); hoy solo prueba v2 y `structure_v12`.

**Impacto en `plan_hash`, contratos y vectores dorados.** No hay. Sube la versión del compilador. `jsonPrompt` (`buildJsonPrompt`, `:1496`) usa las mismas partes, así que L6 también cambia de bytes.

**Riesgos.**

- `findSeparateSidePieces` y `candadosDeComposicion` leen las cláusulas, no el texto, así que no se ven afectados.
- `verificarColoresCaptionLora` (`route.ts:1143`) lee `clause.colors`, tampoco afectado.
- El preflight sí lee texto (L3 y L5).

**Reversión.** La misma bandera de L1. El renderizador v007 solo se elige con la bandera ON y `dialect === "product_v007"`.

**Dependencias.** L1 (palabras del material), L3 (ubicación y relación) y L4 (fondo). El preflight tiene que cambiar en el mismo PR (L3 y L5).

**Esfuerzo:** L.

---

### L3 · Ubicaciones y relaciones fuera del corpus, impuestas además por el preflight

**Problema.** Las frases de ubicación tienen 0 apariciones en el corpus. Encima, el preflight exige una de ellas con una regex.

**Causa raíz.**

- `lora-caption-compiler.ts:207-225` (`PLACEMENT_PHRASES`).
- `:1271-1278`: la frase de la pareja espejo, `one standing on the left and one on the right`.
- `:886-898`: `flanking ${focus}`, `beneath the main arch`, `behind the main arrangement`.
- `:193-205`: `STRUCTURE_NOUNS.kit = "balloon decoration kit"`, con 0 en el corpus frente a `coordinated decoration kit` (24). También `centro_mesa = "balloon centerpiece"` frente a `low balloon centerpiece` (5).
- `lora-prompt-preflight.ts:192`: la regex `/left and one on the right|standing on each side/`.
- `lora-prompt-preflight.ts:147`: `techo` exige `/ceiling/`.

**Código actual.**

```ts
arco_central: "centered around the stage photo area",   // 0  (corpus: "centred on the main display area" 75)
lateral_izquierdo: "standing on the left side",          // 0  (corpus: "standing to one side" 86)
piso_frontal: "grounded across the front of the stage",  // 0  (corpus: "grounded across the front" 128)
entrada: "framing the venue entrance",                    // 0  (corpus: "framing the entrance" 5)
techo: "suspended overhead from the ceiling",             // "from the ceiling" 0 (corpus: "suspended overhead" 16)
```

**Cambio propuesto.** Solo para v007.

```ts
const UBICACION_V007: Record<LoraPlacement, string> = {
  arco_central: "centred on the main display area",      // 75
  zona_central: "centred on the main display area",      // 75 (sin forma propia en el corpus)
  fondo_pared: "installed against the rear wall",         // 127
  pared_lateral: "installed against the rear wall",       // 127 (aprox.; "side wall" 0 como ubicación)
  lateral_izquierdo: "standing to one side",              // 86
  lateral_derecho: "standing to one side",                // 86
  piso_frontal: "grounded across the front",              // 128
  sobre_mesa_principal: "placed on the main table",       // 31
  mesas_invitados: "distributed across the guest tables", // 2
  techo: "suspended overhead",                            // 16
  techo_multipunto: "suspended overhead",                 // 16
  entrada: "framing the entrance",                        // 5
  // sin equivalente en el corpus → allowlist explícita en la puerta (a):
  fachada: "against the venue facade", vegetacion: "within the approved vegetation area",
  alrededor_mobiliario: "around the existing furniture", recorrido_suelo: "along the approved floor path",
  esquina: "in the architectural corner",
};
const SUSTANTIVO_V007: Partial<Record<CaptionStructureType, string>> = {
  kit: "coordinated decoration kit",    // 24
  centro_mesa: "low balloon centerpiece", // 5
};
```

**Relaciones (en `resolveRelations` para v007):**

- La pareja bilateral con focal pasa a `two matching balloon columns, one at each end of the <sustantivo focal>`. Usa «two matching» (42) y «one at each end of the» (26). Sin focal, queda `two matching balloon columns, standing to one side`.
- `beneath the main arch` → `placed on the main table` + `anchored to the organic balloon arch` (`anchored to` 74).
- `behind the main arrangement` → `behind the <sustantivo focal>` (10).

**Preflight** (`lora-prompt-preflight.ts:192`):

```ts
/left and one on the right|standing on each side|one at each end of the|two matching \w[\w -]*s\b/i
```

Y en `:147` (techo):

```ts
/ceiling|suspended overhead/i
```

**Pruebas.**

- `scripts/test/test-lora-caption-bilateral.ts` (`npm run ia:test-lora-bilateral`) añade un caso v3. Comprueba `two matching balloon columns, one at each end of the organic balloon arch`. El caso de 4 columnas comprueba `four matching … standing to one side` (corpus: `four matching balloon bouquets` 1).
- `test-lora-product-runtime.ts:432`: la aserción `/one standing on the left and one on the right/` pasa a ser solo de v2.
- El barrido de preflight con v3 tiene que dar 0 fallos.

**Impacto en `plan_hash` y contratos.** No hay.

**Riesgos.**

- «standing to one side» para las dos laterales puede hacer que las dos columnas acaben del mismo lado. Por eso la pareja usa siempre `two matching … one at each end of the …`, nunca dos cláusulas sueltas.
- `findSeparateSidePieces` (`:813`) sigue escribiendo `stand apart with an open gap`, con 0 apariciones en el corpus. Queda en la allowlist de (a) hasta que haya evidencia.

**Reversión.** La bandera de L1.

**Dependencias.** L2.

**Esfuerzo:** M.

---

### L4 · La cola del caption no existe en el corpus y no describe el fondo

**Problema.**

- Los 540 prompts v3 terminan con `wide photorealistic event photograph, natural depth, grounded supports`, que tiene 0 apariciones.
- Llevan evento y estilo (`celebration`, `wedding`, `glamorous event decor`) y pistas de entorno escritas en otro registro (`recognizable … with real walls…`), también con 0.
- Ninguno escribe `set against`, que está en 345 de 345 captions.

**Causa raíz.**

- `lora-caption-compiler.ts:1466-1478` (la cola).
- `:227-252` (`EVENT_WORDS`, `STYLE_WORDS`).
- `:1285-1296` (`buildEventPhrase`, `buildStylePhrase`).
- `src/lib/ia/escena/visual-context.ts:281-286` (las pistas de entorno).

**Código actual.**

```ts
"wide photorealistic event photograph",
step.minimalTail ? undefined : enAlto ? "natural depth" : hasCanonicalProducts ? "natural depth, grounded supports" : "natural depth, believable floor contact and supports",
```

**Cambio propuesto.** Para v007:

```ts
function fondoV007(context: VisualContext, hibrido: boolean): string {
  if (hibrido) return "set against plain white studio backdrop, no floor visible"; // 14 + 24; sustituye LORA_PRESENTATION_INSTRUCTION
  const pared = context.venueKind === "outdoor" ? "green turf flooring" /* 2 */ : "white walls";      // 71
  const piso  = context.venueKind === "outdoor" ? undefined : "a light grey tiled floor";              // "tiled floor" 57
  return piso ? `set against ${pared} and ${piso}` : `set against ${pared}`;
}
```

Además:

- **Props:** `ambientDecor` y `creativeCues` se renderizan como `alongside <lista>` (245 captions). Las pistas de `creatividad.ts` se reescriben como sustantivos que el corpus usa después de `alongside`, nunca como frases de dirección de foto: `a cake`, `a round table`, `flowers`. Para eso se mide el top-50 de sustantivos que siguen a `alongside` y la lista de creatividad se convierte en un subconjunto de él.
- **Se quitan en v007:**
  - `wide photorealistic event photograph`
  - `natural depth`
  - `grounded supports`
  - `buildEventPhrase` y `buildStylePhrase`
  - las pistas `recognizable …`
- **Modo híbrido:** `promptPresentacionLora` (`src/lib/ia/uzume/lora-gemini-composition.ts:25`) deja de concatenarse detrás de `grounded supports`, lo que hoy produce la contradicción «grounded supports, … no floor visible». En v007 el fondo lo pone `fondoV007(…, true)`.

**Pruebas.**

- En `test-lora-plantilla-v007.ts`, con trigger v3 el prompt termina en `/set against [^.]+\.$/` y no contiene `/photorealistic|natural depth|grounded supports|celebration|event decor/`.
- En `test-lora-product-runtime.ts`, la aserción 52 (styling) cambia a `alongside`.

**Impacto en `plan_hash` y contratos.** No hay. `LORA_PRESENTATION_INSTRUCTION` cambia de bytes en v007, y lo consume `reservaNotasGuia`, así que hay que recalcular el presupuesto.

**Riesgos.**

- Sin «photorealistic», el estilo pasa a depender por completo del LoRA. LORAGEMINI.MD §C1 indica que el registro del corpus es justo lo que evita el aspecto de render, pero hay que verificarlo con el protocolo.
- En exteriores, el corpus casi no tiene vocabulario: `green turf flooring` aparece 2 veces.

**Reversión.** La bandera.

**Dependencias.** L2.

**Esfuerzo:** S.

---

### L5 · El color del plan se pega a la etiqueta (`dusty rose pink`) o queda como `(X tones)`

**Problema.**

- El preflight exige que la palabra del color del plan aparezca literal.
- El compilador la pega al tono (`dusty rose pink`, 0 en el corpus) o la deja como paréntesis `(cream tones)`. Ocurre en 90 de 540 prompts.
- El propio código documenta que ese paréntesis tiñe la pared y el piso.

**Causa raíz.**

- `lora-caption-compiler.ts:1108-1124` (`withApprovedColorTones`, con el paréntesis en `:1124`).
- `:1087-1098` (`SHADE_FAMILIES`).
- `lora-prompt-preflight.ts:197-200`: `expectedColors`, comprobado con `prompt.includes(color)`.
- Se dispara a menudo porque L1 cambia `cream pearl` por `warm ivory off-white`, y así `cream` ya no coincide.

**Código actual.**

```ts
return unmatched.length ? `${result} (${joinNatural(unmatched)} tones)` : result;     // :1124
const representedColors = [...expectedColors].filter((color) => prompt.toLowerCase().includes(color.toLowerCase())).length; // preflight :198
```

**Cambio propuesto.**

1. **La cobertura se comprueba sobre las cláusulas, no sobre el texto.** Se exporta `colorCubierto(colorPlan: string, clause: LoraVisualClause): boolean` desde el compilador. Devuelve `true` si:
   - algún `canonicalEntries[i].colorName` es igual a `colorPlan`;
   - o pertenece a `SHADE_FAMILIES[colorPlan]`;
   - o, en el camino legacy, `clause.colors` incluye `colorPlan`.

   El preflight (`:197-200`) usa `colorCubierto` para los elementos con productos y deja `includes` solo para los que no tienen producto.
2. **En v007, `withApprovedColorTones` no añade nada.** El color del producto es el del catálogo («dusty rose»). Si un color del plan no queda cubierto por ningún concepto de su cláusula, es un fallo de mapeo plan→producto, no algo de redacción. El preflight devuelve `cobertura de colores` y la ruta responde `LORA_PREFLIGHT_FAILED`, que es cerrado y visible. Nunca se escribe `(X tones)`.
3. **En v004 se mantiene `withApprovedColorTones`,** pero el paréntesis pasa a ser `, with <color> accents`. Antes de aplicarlo hay que medirlo en el corpus v004, que hoy no está disponible: queda pendiente.
4. **`buildJsonPrompt.color_palette` (`:1503`)** usa los `colorName` de los conceptos y no las palabras del plan. Hoy manda `["pink","cream",…]` mientras el material dice «dusty rose» y «ivory».

**Pruebas.**

- **Nuevo caso en `scripts/test/test-lora-product-runtime.ts`.** Plan con `rosado` y `crema`, productos dusty rose y cream pearl, trigger v3. El prompt no contiene `/ tones\)|dusty rose pink/`, contiene `dusty rose` y `cream pearl`, y `preflight.ok === true`.
- **Caso negativo.** Plan con `azul` y un producto dorado: `ok === false` con error `cobertura de colores`.
- **Barrido.** Se le añade una métrica: número de prompts con ` tones)`, que tiene que ser 0 en v3.

**Impacto.**

- No hay en `plan_hash`.
- `verificarColoresCaptionLora` (`src/lib/plan/coherencia.ts`, llamado en `route.ts:1143`) usa `clause.colors`, no el texto, así que no cambia.

**Riesgos.** El caso negativo hará fallar planes que hoy pasan con un tinte global. Es lo correcto (AGENTS.md: fallar de forma visible), pero puede subir los `LORA_PREFLIGHT_FAILED`. Hay que vigilarlo en telemetría con `preflightErrores`.

**Reversión.** La bandera. El cambio del preflight va detrás de la misma bandera.

**Dependencias.** L1 (nombres de color).

**Esfuerzo:** M.

---

### L6 · Producción manda JSON por defecto a v004, y el entorno local usa otro LoRA (*probable*)

**Problema.**

- Con `eventdecor_style_v2`, el único LoRA aprobado, el formato por defecto es un objeto JSON. Ninguna caption de entrenamiento tiene esa forma.
- En local se juzga v007, que está rechazado, gracias a un override.
- En v004, la cola escribe `set in a <venue>`, mientras el propio comentario dice que las 154 captions de v004 usan `set against`.

**Causa raíz.**

- `src/lib/ia/kagutsuchi/lora-prompt-format.ts:19` (`JSON_DEFAULT_TRIGGERS = new Set(["eventdecor_style_v2"])`) y `:49`.
- `src/app/api/generate/route.ts:989` (resolución del formato) y `:1110` (`promptPrincipal`).
- `src/lib/lora/mode-resolver.ts:80-82`: el override `LORA_ALLOW_REJECTED_FOR_TESTING`, documentado en LORAGEMINI.MD §C2.
- `lora-caption-compiler.ts:1374-1376`: `set in …`.

**Código actual.**

```ts
const JSON_DEFAULT_TRIGGERS: ReadonlySet<string> = new Set(["eventdecor_style_v2"]);
return trigger !== undefined && JSON_DEFAULT_TRIGGERS.has(trigger.trim()) ? "json" : "texto";
```

**Cambio propuesto.**

1. **Formato por defecto.** `JSON_DEFAULT_TRIGGERS = new Set()`, o sea, texto por defecto para todos. **Solo después** de la evaluación del protocolo, brazo C frente a D. Promover una variante de prompt lo decide una persona (AGENTS.md).
2. **Cierre de v004.** `sceneSettingCues` (`:1374-1376`) pasa a `set against ${wallFloor(venue)}`, con la tabla de `scripts/lora/recaption-v004.ts:51`. Antes hay que recuperar el corpus v004 (154 captions) y medirlo con la puerta (a).
3. **Override de pruebas.** Cuando `LORA_ALLOW_REJECTED_FOR_TESTING` habilita un slot, la respuesta de `/api/generate` incluye `loraEvaluacion: "rejected"` (hoy solo aparece en `debug`). La UI lo muestra como «LoRA rechazado, solo pruebas». Así nadie juzga en local lo que producción no va a servir.

**Pruebas.**

- `test-lora-product-runtime.ts`, aserción 54 (*prompt format defaults by trigger*): cambia la expectativa de v2 a `texto` (en el PR de promoción, no antes).
- `scripts/test/test-lora-modes.ts`: comprueba que el campo `loraEvaluacion` está presente y vale `rejected` cuando hay override.

**Impacto en contratos.**

- La respuesta de `/api/generate` gana un campo opcional. Es aditivo y hay que documentarlo en el tipo de respuesta.
- `formato-prompt-cliente.ts` (la opción «automático») cambia de comportamiento sin cambiar de API.
- No hay impacto en `plan_hash`.

**Riesgos.** El JSON se eligió porque en 2 casos separaba mejor las piezas laterales (`lora-prompt-format.ts:14-18`). Con texto, ese riesgo vuelve. El protocolo lo mide como métrica de estructura.

**Reversión.** Volver a poner el trigger en `JSON_DEFAULT_TRIGGERS`. Es una línea.

**Dependencias.** Protocolo de evaluación. Anexo (a) para v004.

**Esfuerzo:** S en código, M si se cuenta la evaluación.

---

### L7 · Guía de estructura: llega a fal, pero en otro registro y se cae sin avisar

**Problema.**

- La nota imperativa va justo detrás del trigger.
- Las notas consumen unos 340 caracteres del presupuesto, lo que fuerza compactación.
- Si no caben, la generación sigue sin guía y solo queda un `console.info`.

**Causa raíz.**

- `src/lib/ia/kagutsuchi/sempertex-lora.ts:364` (`NOTA_GUIA_ESTRUCTURA`).
- `sempertex-lora.ts:392-402` (`promptConGuia`, con el `return` en `:401`).
- `route.ts:1058-1071`: el registro con `motivo: "las notas de la guía no caben…"` en `:1070`.
- `.env.example:68`: `GUIA_ESTRUCTURA_V1=false`.
- Lo que sí funciona: `route.ts:1164-1200`, donde `imagenesEdit` → `generarConSempertexLora` → `image_urls`, tanto en TS como en Python.

**Código actual.**

```ts
return `${triggers}${NOTA_GUIA_ESTRUCTURA}\n\n${cuerpo}${carta}`;   // sempertex-lora.ts:401
```

**Cambio propuesto.**

1. **Orden.** `${triggers}${cuerpo}\n\n${NOTA_GUIA_ESTRUCTURA}${carta}`: el caption del corpus va primero y la nota después. Hoy la nota es lo primero que el LoRA lee después del trigger. Esto es una variante que se evalúa con el brazo E del protocolo, no un cambio directo.
2. **Señal visible.** Cuando la guía era elegible pero no cupo, la respuesta incluye `guiaEstructura.usada=false` con `motivo` (hoy solo hay `usada`). Además se registra un evento de telemetría `guia_descartada`.
3. **Presupuesto.** `reservaNotasGuia` (`sempertex-lora.ts:382-384`) se descuenta de `LORA_EDIT_PROMPT_MAX_LENGTH` (2500) en vez de `LORA_PROMPT_MAX_LENGTH` (750). Las notas no son caption: el caption conserva sus 750.

**Pruebas.** `scripts/test/test-guia-estructura*.ts` (fixture en `scripts/fixtures/guia-estructura`) comprueba que:

- el prompt con guía empieza por `trigger, <caption>`;
- el caption mide lo mismo con guía y sin ella;
- `motivo` aparece cuando la guía se descarta.

**Impacto.** No hay en `plan_hash`. La respuesta de `/api/generate` gana `guiaEstructura.motivo`, de forma aditiva.

**Riesgos.** `/edit` conserva la imagen que recibe. Con la nota al final, el modelo podría devolver el dibujo retocado (`sempertex-lora.ts:357-362`). Por eso es un brazo de evaluación.

**Reversión.** Constantes. La bandera sigue OFF por defecto.

**Dependencias.** L2 y L4 (que el caption ya esté en el registro del corpus).

**Esfuerzo:** S.

---

### L8 · Configuración y código muerto

| Sub | Archivo:línea | Qué pasa | Cambio | Prueba | Esfuerzo |
|---|---|---|---|---|---|
| L8.1 | `src/lib/lora/mode-resolver.ts:71-74`, `:212` | `DEFAULT_SCALES.product = 0.3` se usa cuando una `loraSelection` manual llega sin `scale`. La migración `scripts/migrations/018_lora_product_v007_scale.sql` dice que a 0,3 queda infraactivado | `product: 0.8`, o mejor: `LoraSelectionSchema` exige `scale`. Sin valor por defecto oculto | `test-lora-modes.ts`: una selección sin escala se rechaza o resuelve a 0,8 | S |
| L8.2 | `scripts/lora/promover-lora.ts:51-53`, `:79-88` | Escribe `SEMPERTEX_LORA_URL` y pide editar `loraScale()`. Ninguna de las dos existe en `src` ni en `services` (búsqueda: 0 resultados) | Reescribirlo para que actúe sobre `lora_mode_slots` (como `registrar-lora-v007-fal.ts:324`) con vista previa y `--confirm`, o eliminarlo tras revisar sus referencias | Ejecución en seco sobre una base desechable | M |
| L8.3 | `src/lib/lora/v007-catalog-allowlist.ts:4` frente a `mode-resolver.ts:315-341` | El comentario habla de 209 conceptos; el vocabulario v007 tiene 178. `filtrarPorVocabulario` deja fuera en silencio lo que no se puede describir | Registrar con `console.warn` el conteo de variantes descartadas, con `datasetId` y número, como ya hace `:250`. Corregir el comentario | Prueba unitaria con un pool simulado: descartar emite el aviso | S |
| L8.4 | `lora-product-runtime.ts:209-213`, `route.ts:1244` | `dropped_sizes` solo viaja en la respuesta y la imagen se genera sin esa talla | Si un elemento del plan pide una talla que no cabe en `allowed_codes`, se muestra un aviso en la UI («la imagen no muestra el 36"») o se falla con `LORA_TALLA_NO_DESCRIBIBLE` según la política. Lo decide producto | `test-lora-product-runtime.ts`: `dropped_sizes` no vacío → aviso | S |

**Impacto en `plan_hash`.** No hay.

**Reversión.**

- L8.1 y L8.3: revertir el commit.
- L8.2: el script antiguo no tiene efecto real, así que no se pierde nada.

**Dependencias.** Ninguna.

---

### L9 · Divergencia TS/Python, límites de tokens y tabla de respaldo para v004

**Problema.**

- Hay pequeñas diferencias entre TS y Python.
- El respaldo `FINISH_WORDS` no distingue dialecto.
- No hay riesgo de truncado.

**Causa raíz.**

- **Plazos:**
  - `services/ai-api/app/kagutsuchi/lora.py:41` y `:331`: el plazo de 105 s empieza a contar después del submit.
  - `src/lib/ia/kagutsuchi/sempertex-lora.ts:494`: 105 s para todo el flujo.
  - `sempertex-lora.ts:462`: el adaptador espera 110 s.

  Python puede agotar el plazo del adaptador antes que el suyo propio, y el error queda clasificado como fallo del adaptador en vez de `lora_timeout`.
- **Respaldo de acabados:** `FINISH_WORDS` (`lora-caption-compiler.ts:330-354`) se aplica igual en v004 y v007 (ver L1).
- **Tokens:** FLUX.2 [dev] usa un codificador de texto de tipo LLM, no CLIP-77. Los captions miden hasta 750 caracteres (menos de 200 tokens) y el JSON hasta 1536 caracteres (menos de 512 tokens). No se trunca nada.

**Cambio propuesto.**

- `POLL_DEADLINE_SECONDS` se mide desde el inicio del submit: mover `deadline_at` antes de `_fetch_allowed` del POST, `lora.py:331` → antes de `:334`.
- `deadlineMs` del adaptador = plazo de Python + 5 s de margen, como constante compartida exportada al contrato `lora-generate.v1`, o al menos documentada.
- `englishFinish(finish, dialect)` según L1.

**Pruebas.**

- `services/ai-api/tests/test_kagutsuchi_lora.py`, o el que ya existe para `lora.py`: con un reloj simulado, un submit lento cuenta contra el plazo.
- `npm run ia:test-kagutsuchi-lora-python`.

**Impacto.** El contrato `lora-generate.v1` no cambia de forma. No hay impacto en `plan_hash`.

**Riesgos.** Ninguno relevante.

**Reversión.** Revertir el commit.

**Dependencias.** L1, solo para `englishFinish`.

**Esfuerzo:** S.

---

### Anexo (a) · Puerta de vocabulario del corpus (prueba de regresión)

**Objetivo.** Ninguna palabra nueva del compilador llega al LoRA sin haber sido medida contra el corpus. Es el principio del equipo («el corpus del LoRA manda»), convertido en un test que falla.

**Archivos.**

- **Lógica pura:** `src/lib/lora/corpus-ngramas.ts`. Expone `normalizar(texto)`, `ngramas(texto, n)` y `contarEnCorpus(frase, indice)`.
- **Generador de la tabla:** `scripts/lora/medir-corpus.ts` (`npm run lora:medir-corpus -- --dataset v007 [--dataset v004]`). Lee `data/staging/lora-v007/captions/*.txt` con `fs.readdirSync`, solo archivos `.txt`, UTF-8, `trim()`. Escribe `data/lora/corpus-v007-ngramas.json` con este formato:

  ```json
  {"version":1,"dataset":"lora-dataset-v007-ordenes","captions":345,"sha256_captions":"<hash del texto concatenado en orden de nombre>",
   "ngramas":{"1":{"matte":606,…},"2":{…},"3":{…}}}
  ```

  La tabla es texto derivado: no incluye imágenes, rutas absolutas ni las captions completas. Así un checkout limpio no depende de `data/staging` (AGENTS.md).
- **Test:** `scripts/test/test-lora-corpus-gate.ts`, con script `npm run lora:test-corpus-gate`, añadido a `plan:test`.
- **Allowlist:** `scripts/test/lora-corpus-gate.allowlist.json`. Cada entrada lleva `{ "ngrama": "...", "trigger": "v3"|"v2"|"*", "razon": "...", "retirar_cuando": "..." }`. AGENTS.md exige motivo y condición de retiro para toda excepción.

**Algoritmo.**

1. **Corpus.** Se carga `corpus-v007-ngramas.json`.
   - Si `data/staging/lora-v007/captions` existe, se recalcula `sha256_captions`. Si no coincide, el test falla con «tabla desactualizada: correr lora:medir-corpus».
   - Para v004, si `data/lora/corpus-v004-ngramas.json` no existe, el caso v2 se marca **SKIP con mensaje explícito** y una salida distinta de 0 en modo `--estricto`. Nunca se da por pasado en silencio.
2. **Prompts.** Se reutiliza el generador de escenas del barrido. Hay que extraer `combinaciones` y `evaluarEscena` de `test-lora-preflight-barrido.ts` a `scripts/test/lib/barrido-escenas.ts` para que el script sea seguro al importarlo.
   - Para cada trigger en `["eventdecor_style_v3", "eventdecor_style_v2"]` se compilan las 1920 escenas (4×4×4×6×5) con `compileProductPrompt` y luego `ensureLoraTriggers`.
   - Con la bandera de L1 en ON y en OFF: dos pasadas.
   - Se incluye el `jsonPrompt` solo para v2, quitando las claves JSON (`scene`, `subjects`, `role`, `description`, `color_palette`, `style`, `composition`) antes de extraer n-gramas.
3. **Extracción.**
   - `normalizar`: minúsculas; se sustituye `[^a-z0-9\-'® ]` por un espacio; se colapsan los espacios.
   - Se quita el trigger y los tokens que encajan con `/^\d+(-inch)?$/`. Las tallas se comprueban aparte: el patrón `\d+-inch` tiene que aparecer en el corpus con ese número, y si no, es un error.
   - n = 1, 2, 3, contados por prompt: cada n-grama una vez por prompt.
4. **Regla de fallo:**
   - **Fallo duro.** Un n-grama con `freq_corpus(n) == 0` que no está en la allowlist y aparece en al menos el 1 % de los prompts (≥ 19 de 1920). Para unigramas basta con aparecer una vez: una palabra que el modelo nunca vio no tiene mínimo de frecuencia.
   - **Aviso.** Un bigrama o trigrama con `freq_corpus ≤ 2`, o un unigrama con `freq_corpus ≤ 2` en más del 10 % de los prompts. Se escribe en `reports/lora-corpus-gate.json`, fuera del repo o en `.gitignore`.
   - **Fallo de sentido.** Una lista mantenida a mano, `SENTIDO_PROHIBIDO`, de n-gramas cuyas apariciones en el corpus describen pisos o paredes, no globos (`glossy` → piso, `gray` → paredes y pisos, `teal` → mantel, `dark green` → piso). Si uno de ellos aparece dentro de una frase de material, entre `built from` y la siguiente coma, el test falla aunque su frecuencia sea mayor que 0.
5. **Umbral global.** Si la proporción de n-gramas, ponderada por apariciones, que tienen 0 en el corpus supera el 5 % de todos los de v3, el test falla aunque cada uno esté en la allowlist. Así la allowlist no puede crecer sin límite. Línea base de hoy: en v3, cerca del 40 % de los trigramas de la cola no existen en el corpus. El umbral se fija con la medición posterior a L1–L4, no a ojo.
6. **Salida.** Una tabla de los 30 peores n-gramas, con `ngrama | %prompts | freq_corpus | sugerencia`. La sugerencia es el n-grama del corpus más cercano por distancia de Jaccard sobre tokens. Así cada fallo dice qué escribir en su lugar.

**Allowlist inicial** (con motivo y condición de retiro):

| N-grama | Motivo |
|---|---|
| `stand apart with an open gap` | `findSeparateSidePieces`; sin evidencia de reemplazo |
| `fachada`, `vegetacion`, `recorrido_suelo`, `esquina` | Placements sin equivalente en el corpus (L3) |
| Frases de `colorPattern` de Python (ADR-0028) | Se insertan tal cual; otro dueño |

**Coste.** No llama a ningún proveedor y tarda menos de 10 s.

---

### Anexo (b) · Resolución entre la fidelidad de color y las palabras del corpus

#### La tensión

`descriptor-perceptual.ts:7-17` y el comentario de `FINISH_WORDS` (`:309-320`) citan `reports/lora-debug/color-fidelidad`: con el mismo LoRA y la misma semilla, `spring pink with a Silk satin finish` salió rosa chicle y el descriptor perceptual salió del color correcto.

**Ese informe no está en el árbol.** Además, la frase que se probó **no era la del corpus**:

- El orden del corpus es `satin Silk spring pink round latex balloons`, no `spring pink with a Silk satin finish`.
- `Silk satin` aparece 2 veces en el corpus; `satin Silk`, 76.
- El propio archivo admite en `:32-34` que «`spring pink` es el único verificado; el resto sale del nombre comercial».

Así que la medición confunde dos variables: la plantilla y la palabra. Lo único demostrado es lo de spring pink, y en la plantilla equivocada.

#### Regla propuesta (solo para el dialecto `product_v007`)

- **R1. La familia de acabado siempre va con la forma del corpus** (`FAMILIA_CORPUS_V007`, L1). El acabado es justo lo que la evaluación de v007 falló (0/6), y la palabra de la familia es la única señal con la que el LoRA aprendió mate frente a brillante. Nunca se sustituye.
- **R2. Si el color tiene 5 o más apariciones en el corpus describiendo un globo, se escribe tal cual.** El LoRA vio el producto real fotografiado con ese nombre al menos 5 veces. El descriptor perceptual nunca apareció en el corpus. Que el color sea de un globo se comprueba porque el n-grama aparece dentro de `built from … balloons`.
- **R3. Si el color tiene menos de 5 apariciones, se usa el descriptor perceptual**, porque el LoRA no tiene a qué anclarlo. La familia sigue con la forma del corpus (R1).
- **R4. Excepción verificada.** Un color con 5 o más apariciones puede usar descriptor solo si está en `EXCEPCIONES_COLOR_VERIFICADAS`, con enlace a una medición A/B **hecha con la plantilla del corpus** (brazo F del protocolo). Mientras tanto, spring pink queda como **candidata**. Su forma por defecto es la del corpus, y el brazo F decide.
- **R5. El descriptor nunca sustituye a la familia.** Si se usa, va en la posición del color: `satin Silk pale silvery mauve-pink round latex balloons`. Nunca hay paréntesis ni `with a … finish`.
- **R6. Gemini y v004 no cambian.** `aDescriptorPerceptual` sigue aplicándose en `scene_v004`, en Gemini y en la etapa 2 del híbrido. Ninguno de esos modelos se entrenó con este corpus.

#### Tabla de mapeos de `COLORES` (`descriptor-perceptual.ts:36-48`) con la regla aplicada

| Color de catálogo | Corpus | Descriptor actual (corpus) | Decisión v007 | Por qué |
|---|---|---|---|---|
| `spring pink` | 8 | `extremely pale desaturated silvery mauve-pink` (0) | **Candidata (R4)**: por defecto `spring pink`; el brazo F decide | Único caso verificado, pero con la plantilla equivocada |
| `arctic blue` | 20 | `very pale icy blue` (0) | `arctic blue` | R2 |
| `amethyst` | 16 | `soft muted violet` (0) | `amethyst` | R2 |
| `cream pearl` | 12 | `warm ivory off-white` (0) | `cream pearl` | R2. Además arregla `(cream tones)` (L5) |
| `pearl white` | 19 | `soft luminous white` (0) | `pearl white` | R2 |
| `mint green` | 15 | `pale desaturated mint` (0) | `mint green` | R2. Ya lo eligió `COLOR_ALIASES` (`:297`) |
| `aurora green` | 11 | `pale iridescent green` (0) | `aurora green` | R2 |
| `champagne` | 14 | `pale warm golden beige` (0) | `champagne` | R2 |
| `green tea` | 6 | `muted sage green` (0) | `green tea` | R2, en el límite. Va al brazo F si sobra presupuesto |
| `pastel lilac` | 1 | `soft pale lilac` (0) | Descriptor `soft pale lilac` | R3 |
| `pastel blue` | 1 | `soft pale blue` (0) | Descriptor `soft pale blue` | R3 |

#### Tabla de mapeos de `ACABADOS` (`:20-27`)

| Familia | Corpus | Descriptor actual | Decisión v007 |
|---|---|---|---|
| `Reflex high-shine` | `high-shine Reflex` 212 | `high-gloss chrome` (0) | `high-shine Reflex` (R1) |
| `solid Fashion` | `matte Fashion` 533 | `solid matte` (0) | `matte Fashion` (R1) |
| `Silk satin` | `satin Silk` 76 | `soft pearlescent` (0) | `satin Silk` (R1) |
| `Pastel Matte` | 64 | `soft matte` (0) | `Pastel Matte` (R1) |
| `Pastel Dusk muted` | `muted Pastel Dusk` 63 | `muted dusty matte` (0) | `muted Pastel Dusk` (R1) |
| `translucent Crystal` | 9 | `translucent` | `translucent Crystal` (R1) |

**Código:** `colorParaV007(color)` y `familiaParaV007(finish)` en `src/lib/lora/vocabulario-corpus-v007.ts`. Los umbrales son una constante `MIN_APARICIONES_COLOR = 5`, y los conteos vienen de la tabla de la puerta (a), no de números escritos a mano. Así, si el corpus cambia, la regla se recalcula sola.

---

### Protocolo de evaluación (de pago, con tope de gasto)

Sigue AGENTS.md («Evaluation runs against paid providers») y usa la herramienta que ya existe: `scripts/lora/exp-fal-lib.ts`. Esa librería exige `--confirm-spend` y `--max-usd`, para antes de pasar el tope y estima el coste con `PRECIO_MP_USD_ESTIMADO = 0.021` (`exp-fal-lib.ts:30`).

#### Diseño

| Parámetro | Valor |
|---|---|
| Planes | **N = 8** planes aprobados y fijos de `scripts/fixtures/planes-fijados`, con al menos: arco + 2 columnas, semiarco asimétrico, pared, guirnalda en pared, centro de mesa, un plan Reflex, uno Fashion, uno Silk/Pastel y uno con spring pink. Los planes viven fuera del repo si contienen datos de clientes |
| Semillas | 3 fijas por celda: 101, 202 y 303 (`LORA_EVAL_SEED` o `--seed`) |
| LoRA | v004 (`training_1`) para los brazos A a D. v007 solo como brazo informativo, marcado «rechazado» (L6) |
| Parámetros fijos | `guidance_scale` 3,5; escala 0,8; 28 pasos; 1024×1536; `enable_prompt_expansion=false`. LORAGEMINI.MD §4.2 muestra que guidance y escala no mueven el resultado |
| Telemetría | Desactivada durante la corrida |

#### Brazos

| Brazo | Qué cambia | Hallazgos que valida |
|---|---|---|
| A | Línea base actual: texto, compilador de hoy | — |
| B | Texto con la bandera `LORA_VOCABULARIO_CORPUS_V007` en ON | L1 a L5 |
| C | JSON actual (lo que hoy sale por defecto con v2) | L6 |
| D | Texto actual con v2 | L6 |
| E | B + guía al final del caption, solo los planes de una estructura | L7 |
| F | Solo spring pink y green tea: palabra del corpus frente a descriptor, ambas con la plantilla del corpus | Anexo (b), R4 |

#### Coste estimado

- Por imagen: 1,57 MP × 0,021 = **0,033 USD** (ESTIMADO).
- Brazo E: 3 entradas adicionales por imagen, unos 0,10 USD.
- A a D: 4 × 8 × 3 = 96 imágenes, unos 3,17 USD.
- E: 4 planes × 3 = 12 imágenes, unos 1,21 USD.
- F: 2 colores × 2 variantes × 3 = 12 imágenes, unos 0,40 USD.
- **Total estimado: 4,8 USD.**
- **Tope declarado: `--max-usd 7`.** Si se alcanza, la corrida para y se reanuda (`resume`) solo con autorización de una persona.

#### Métricas

Cada imagen la puntúan 2 personas, a ciegas respecto al brazo. El orden de las imágenes es aleatorio y los archivos se nombran con un hash.

1. **Acabado correcto** (sí/no por material). El Reflex se ve especular y cromado; el Fashion o el mate no tienen reflejo especular fuerte; el Silk es perlado. Es el criterio que v007 falló 0/6.
2. **Color** (sí/no por material). El tono corresponde al producto según la carta de color del catálogo. Spring pink es pálido malva, no rosa chicle. No hay tinte global en paredes ni piso.
3. **Estructura** (sí/no por pieza):
   - el número de piezas es correcto;
   - las laterales son piezas separadas y no se funden con la focal;
   - el arco cierra;
   - la guirnalda no aparece con patas;
   - la ubicación es la correcta.
4. **Tallas:** hay diferencias visibles de diámetro cuando el plan mezcla tallas.
5. **Fotorrealismo** de 0 a 10: sin aspecto de render ni de plástico.

**Métricas deterministas, por celda y sin coste:**

- `preflight.ok`
- longitud
- paso de compactación
- resultado de la puerta (a)

#### Cómo decide una persona

- **Criterios de aceptación de B frente a A** (los mismos mínimos que `promover-lora.ts:19-20`, adaptados):
  - acabado correcto en al menos 5 de 6 celdas Reflex frente a Fashion;
  - color sin regresión respecto a A (diferencia de 1 celda como mucho, en total);
  - estructura igual o mejor que A en todos los planes con piezas laterales.
- **C frente a D:** si D iguala o mejora a C en separación de laterales (el criterio del 2026-09-14), se aplica L6.1. Si no, el JSON sigue y se documenta.
- **F:** spring pink se queda con el descriptor solo si la palabra del corpus falla el color en al menos 2 de 3 semillas y el descriptor acierta en al menos 2 de 3.
- **Quién firma.** El resultado queda en `lora_evaluations` (`protocol_version = "corpus-v007.v1"`) con las notas de cada evaluador. **Promover la variante (encender la bandera en producción) lo decide una persona,** firmando sobre ese registro. El loop no promueve nada solo.
- **Reproducibilidad.** Ninguna imagen ni ruta absoluta entra al repo. Se guardan `request_id` de fal, semilla, hash del prompt, versión del compilador y bandera.

---

### Orden de ejecución y dependencias

```
(a) puerta de vocabulario  ─┐
L1 + (b) ─► L2 ─► L3 ─► L4 ─┼─► L5 ─► [evaluación B/A, F] ─► encender bandera (decisión humana)
                            └─► L6 (tras evaluación C/D)      L7 (brazo E)
L8, L9: independientes, en cualquier momento.
```

| ID | Esfuerzo | Bandera | Toca `plan_hash` |
|---|---|---|---|
| L1 | M | `LORA_VOCABULARIO_CORPUS_V007` | no |
| L2 | L | ídem | no |
| L3 | M | ídem | no |
| L4 | S | ídem | no |
| L5 | M | ídem | no |
| L6 | S (+eval) | constante `JSON_DEFAULT_TRIGGERS` | no |
| L7 | S | `GUIA_ESTRUCTURA_V1` (existente) | no |
| L8 | S–M | — | no |
| L9 | S | — | no |
| (a) | M | — | no |

**Ningún cambio toca `plan_hash`, `estructuras`, `compras` ni `contracts/domain/v1/golden/plan-resolution/*`.** Los únicos contratos afectados son:

- campos aditivos en la respuesta de `/api/generate`: `loraEvaluacion` y `guiaEstructura.motivo`;
- la versión del compilador y del runtime, que invalida las líneas base de evaluación que comparan por `loraPromptHash`.

**Verificación antes de cerrar cada PR:**

```
npx tsc --noEmit && npm run -s lint && npm run plan:test
npm run lora:test-corpus-gate
npm run lora:test-product-runtime
npm run ia:test-lora-preflight-barrido
npm run ia:test-lora-v004-compactacion
```


---

## Parte II · Plan de remediación técnica — prompt de imagen Gemini (ruta no-LoRA)

> Alcance: `/api/generate` cuando `usarLora === false` (más la parte compartida con la composición híbrida LoRA+Gemini).
> Todas las referencias `archivo:línea` se re-verificaron contra el árbol el 2026-10-04, después del informe. El árbol se está editando: por ejemplo, `plan.py` pasó de `:3912` a `:3930` entre una lectura y otra. **Antes de aplicar cada cambio, vuelve a ubicarlo por el símbolo citado, no por el número de línea.**
> Evidencia de base: `scratchpad/dump-prompt.ts` y los cuatro volcados `29-…txt`, `14-…txt`, `01-…txt` y `23-…txt` (los mismos de la auditoría).

---

### 0. Decisiones transversales (leer primero)

| Tema | Decisión propuesta | Por qué |
|---|---|---|
| Dueño del color exacto (Sempertex/Pantone/hex) | **Python** (`app/color_catalogo.py`, tabla `app/motores/tabla-color.json`). Se publica en `plan_resuelto.colores_imagen[]`, **fuera del snapshot**. | AGENTS.md: una sola fuente por regla. TS no puede leer la tabla sin crear un segundo dueño. |
| Dueño de los nombres de color y acabado en inglés | **TS** `LORA_COLOR_NAMES_EN` + `ACABADO_EN`, ya exportados al contrato como `x-colores-en` / `x-acabados-en` y leídos por Python (`patron_color.py:111-112`). | Ya está así. Se reutiliza; no se crea una tabla nueva. |
| Idioma del prompt | Inglés en todo, **excepto** los nombres de estructura del plan entre comillas. `verificarCoherenciaPrompt` exige `prompt.includes(estructura.nombre)` (`coherencia.ts:99-100`). | No se puede quitar el nombre en español sin cambiar la puerta. Se conserva como etiqueta citada y se marca invisible. |
| Coherencia | `verificarCoherenciaPrompt` gana una opción `traducirColor` (igual que `verificarColoresCaptionLora`), porque las líneas de color pasan a inglés. | La puerta lee hoy los colores en español con el regex `LINEA_COLOR` (`coherencia.ts:65`). |
| `plan_hash` | **Ningún ID de este plan cambia `plan_hash`.** Verificado: el JSON canónico es `{plan, snapshot}`, y `snapshot = {catalog_snapshot_id, estructuras, compras, total_cop}` (`plan.py:3663-3673`). Las cajas (`ubicaciones.ts`) se calculan en TS y solo entran en `sceneSpecHash` y en la auditoría. El comentario de `ubicaciones.ts:63` («la geometría entra en el plan_hash») está **desfasado**; corregirlo en G5. | Elimina el riesgo de invalidar propuestas aprobadas en vuelo. |
| Contratos | Solo G4 toca un contrato (`plan-resuelto.v1`, campo opcional nuevo `colores_imagen`). G13 toca enums de aspecto (`SceneSpec`, `PeticionImagen`, `python-adapter`, `interaction.py`). | — |
| Vectores dorados | G4: `expected_python` se regenera (solo aparece la clave nueva). `expected` (oráculo congelado) no se toca, porque `test_plan_regresion.py:329-338` compara únicamente `expected_python`. | — |

Orden de entrega recomendado (cada fila es un PR independiente y reversible):
1. **H0** arnés de invariantes, en modo informativo (falla solo en invariantes ya cumplidos).
2. G1, G6, G11, G14 (texto, S).
3. G2, G3, G7, G8, G9 (texto + escena, M).
4. G4 (contrato + Python + TS, L).
5. G12 (reestructuración y presupuesto, L). Se hace después de G1–G9 para no reescribir dos veces.
6. G5, G10, G13, GP1–GP3.
7. G15 (retiro de código muerto).

---

### H0 — Arnés de regresión: `scripts/test/test-invariantes-prompt-imagen.ts`

Convierte `dump-prompt.ts` en una prueba sin red sobre **todos** los vectores con `expected`. Para el patrón de carga de catálogo reutiliza `scripts/lib/escena-de-vector.ts` (función `coloresDeProduccionPorVariante`) y `vectores-golden.ts`.

**Primero, refactor mínimo** (necesario: hoy la ruta arma el prompt en línea y el arnés tendría que copiar esa cadena, que es justo lo que AGENTS.md prohíbe):

- Extraer de `route.ts:878-948` una función pura `armarPromptGemini(entrada): { prompt; escena; coherencia }` en `src/lib/ia/uzume/armar-prompt-gemini.ts`. Firma:

```ts
export type EntradaPromptGemini = {
  planResuelto: PlanResuelto;
  materialEstimate: DesignMaterialEstimate;
  productos: Producto[];                 // ya con paquetes/unidadesPaquete del plan
  brief?: Brief;
  solicitudUsuario?: string;
  aspecto: PeticionImagen["aspecto"];
  venueImageId?: string;
  previous?: boolean;
  revisionInstruction?: string;
  creatividad: NivelCreatividad;
  promptInputs: PromptImageInput[];
  dropped: { catalog: number; catalogMissing: number; composition: number };
  escenografia: SceneryElement[];
  referenceComposition?: ReferenceComposition; // G9
};
export function armarPromptGemini(e: EntradaPromptGemini): { prompt: string; sceneSpec: SceneSpec; coherencia: EscenaParaCoherencia; colorPatterns?: FraseDeEstructura[] };
```

- `route.ts` llama a esta función (es el único dueño). `escena-de-vector.ts` también, en lugar de su copia parcial, que hoy **no** pasa `colorPatterns`, `visualContext` ni `officialStructures` (`escena-de-vector.ts:~115`). Por eso las pruebas actuales no ven G1/G3/G6.

**Invariantes** (cada uno con su nombre, para que el fallo diga cuál se rompió):

```ts
// scripts/test/test-invariantes-prompt-imagen.ts  (npm: "ia:test-invariantes-prompt-imagen")
const BRIEFS = [
  { nombre: "sin-brief" },
  { nombre: "brief-paleta-ajena", brief: { colores: ["rosado", "dorado"], espacio: "salón", tipo_evento: "cumpleaños" }, solicitud: "sí, apruébalo así" },
];
for (const vector of vectoresConExpected) for (const caso of BRIEFS) {
  const { prompt, sceneSpec, coherencia } = armarPromptGemini(entradaDeVector(vector, caso));
  // I1 coherencia de siempre
  ok(verificarCoherenciaPrompt(prompt, plan, coherencia, { traducirColor: colorEnPromptGemini }).ok);
  // I2 sin términos internos en español fuera de nombres citados de estructura
  const sinNombres = quitarNombresCitados(prompt, plan.estructuras.map((e) => e.nombre));
  deepEqual(findLoraPromptLanguageLeaks(sinNombres), []);           // reutiliza lora-prompt-preflight.ts:46
  doesNotMatch(sinNombres, /\b(?:entrada|lateral_izquierdo|fondo_pared|centro_mesa|sobre_mesa_principal|composite_installation|circulación|exacto|adaptable)\b/);
  // I3 sin flotantes crudos ni medidas en metros
  doesNotMatch(prompt, /\d+\.\d{4,}/);                                // 4.199999999999999
  doesNotMatch(prompt, /\(\s*\d+(?:\.\d+)?\s*m\b/);                  // "(1.8 m)", "(0.4 m × 0.5 m)"
  // I4 paleta == colores del plan: ningún color fuera de las líneas compradas
  const plan_en = new Set(plan.estructuras.flatMap((e) => e.lineas.map((l) => colorEnPromptGemini(l.color!))));
  for (const c of coloresMencionados(prompt)) ok(plan_en.has(c), `color ajeno al plan: ${c}`);
  doesNotMatch(prompt, /PALETTE: rosado/);
  // I5 todo elemento con globos tiene contrato de color
  for (const el of sceneSpec.elements) if (tieneGlobos(sceneSpec, el)) ok(lineaDeColorDe(prompt, el), el.name);
  doesNotMatch(prompt, /No balloon color mix is approved/, "con globos en el plan");
  // I6 ninguna prohibición contradice una estructura aprobada
  const nouns = sustantivosAprobados(prompt);                          // de CARDINALITY CONTRACT
  for (const linea of seccion(prompt, "MUST NOT INCLUDE")) for (const n of nouns) doesNotMatch(linea, new RegExp(`\\b${n}e?s?\\b`, "i"));
  // I7 presupuesto de largo (G12)
  ok(prompt.length <= presupuesto(sceneSpec), `${prompt.length} > ${presupuesto(sceneSpec)}`);
  // I8 un solo dueño por instrucción repetida
  equal(cuenta(prompt, "invisible"), 1);  equal(cuenta(prompt, "SINGLE-DIAMETER"), sizesUnicos ? 1 : 0);
  // I9 dos instancias del mismo grupo no comparten la misma ubicación (G5)
  // I10 bloque de color exacto presente para todo color resoluble (G4)
}
```

- Archivo nuevo: `scripts/test/test-invariantes-prompt-imagen.ts`. Script: `"ia:test-invariantes-prompt-imagen": "tsx --conditions=react-server scripts/test/test-invariantes-prompt-imagen.ts"`. Se añade a la cadena `plan:test` (`package.json:205`).
- Arranque: I1 se activa ya. I2–I10 empiezan **pendientes**, se listan como `[PENDIENTE Gx]`, no fallan, y cada ID las activa al aterrizar (`const ACTIVOS = new Set(["I1"])`). Nunca se relajan para pasar.
- Riesgo: depende del refactor `armarPromptGemini` (M). Reversión: borrar el script y su entrada en `plan:test`.

---

### Estructura objetivo del prompt (aplica a G1, G6, G7, G9, G12)

Orden y prioridad nuevos. Cada dato tiene **un solo** lugar; nada se repite por instancia salvo el bloque de su grupo.

```
1. TASK                       (1 línea según modo: new / edit venue / revise)
2. SOURCE-OF-TRUTH PRIORITY   (reescrita, ver abajo)
3. APPROVED STRUCTURES        (un bloque por grupo de repetición, no por instancia)
     "<Nombre del plan>" — <count> × <english noun>; placement: <words per instance>;
     form/support: <shapeClause>; physical scale: <words>;
     balloons per instance: <N> (<size mix line>);
     color: <color contract line (EXACT/MONO)>; pattern/assembly: <Python phrase>
4. EXACT BALLOON COLORS       (bloque único, G4)
5. COUNT RULE                 (una regla, G7)
6. SCENE CONTEXT              (event, venue, time of day; sin paleta ni petición literal; G1)
7. PRESERVED SCENE CONTEXT    (solo si hay escenografía)
8. REFERENCE COMPOSITION      (solo si hay blueprint de referencia; G9)
9. IMAGE MAP                  (solo si hay imágenes; incluye catálogo faltante, G10)
10. REVISION DELTA            (solo si hay imagen previa; G11)
11. DO NOT                    (negativos genéricos filtrados contra lo aprobado; G12/I6)
12. OUTPUT                    (texto prohibido: UNA vez, aquí; último bloque)
```

Prioridad reescrita (sustituye `build-image-prompt.ts:656-662`):

```
SOURCE-OF-TRUTH PRIORITY
1. APPROVED STRUCTURES and EXACT BALLOON COLORS decide what exists, how many, which colors, which balloon sizes, and where. Nothing below may add, remove, recolor, or resize them.
2. The venue photo, when supplied, decides camera, crop, architecture, perspective, and ambient light.
3. SCENE CONTEXT decides event mood, venue type, and time of day only where no venue photo exists.
4. Catalog product images decide material identity (sheen, texture) only; their arrangement is not a layout.
5. REFERENCE COMPOSITION, when present, decides framing and spacing only.
6. The previous result, when present, is the base to edit.
If two sources conflict, follow this order and never resolve the conflict by inventing content.
```

**Presupuesto de largo** (medido con los 4 volcados: 30.067 c con 2 instancias, 30.441 c con 3, 30.634 c con 3 y 47.297 c con 10). El costo marginal es (47.297 − 30.067)/8 ≈ **2.150 c por instancia**, y la base fija ≈ **25.800 c**. El JSON `AUTOMATIC_SCENE_SPEC` solo ocupa 7.202 c (vector 29) y 12.353 c (vector 23), y duplica todo lo demás.

| Parte | Hoy (v29 / v23) | Objetivo |
|---|---|---|
| Base fija (sin estructuras) | ~25.800 | **≤ 5.500** |
| Por grupo de repetición | ~1.300 | **≤ 900** (incluye la frase de patrón de Python, que no se recorta) |
| Por instancia adicional del mismo grupo | ~2.150 | **≤ 60** (solo su ubicación en palabras) |
| Bloque EXACT BALLOON COLORS | 0 | ≤ 120 por color distinto |
| Tope duro | — | **12.000** → `presupuesto(s) = 5500 + 900·grupos + 60·instanciasExtra + 120·colores`, con techo 12.000 |

Resultados esperados: v29 ≈ 6.700, v23 ≈ 7.300, frente a 30.067 y 47.297. Si el tope se excede (por ejemplo, frases de patrón largas), **no se recorta en silencio**: se registra `prompt_presupuesto_excedido` con el largo y se envía igual. Un prompt largo pero completo es mejor que uno truncado. La frase de Python no se recorta nunca, igual que en LoRA.

---

### G1 — SCENE LOCK manda sobre el plan y trae la paleta del brief y el último mensaje literal
**Severidad:** crítica · **Esfuerzo:** S (texto) + M (si se elimina `eventAuthority`)

**Causa raíz.**
- `visual-context.ts:171` toma `palette` de `brief.colores`.
- `visual-context.ts:301-309` (`buildVisualSceneLock`) emite `USER REQUEST VERBATIM` y `PALETTE`.
- `build-image-prompt.ts:656-657` pone SCENE LOCK como prioridad 1, por encima de AUTOMATIC_SCENE_SPEC.
- `route.ts:878-880` pasa `userRequest: body.solicitudUsuario`, que es el **último** mensaje (`page.tsx:968`).
- La petición se repite en `build-image-prompt.ts:560` (`ORIGINAL CUSTOMER REQUEST`). Las líneas 563 y 565 repiten PIECE MATCH, APPROVED PLAN y APPROVED MATERIALS, que SCENE LOCK ya trae.

**Código actual.**
```ts
// visual-context.ts:303,309
context.userRequest ? `USER REQUEST VERBATIM: ${context.userRequest}` : undefined,
context.palette.length ? `PALETTE: ${context.palette.join(", ")}` : undefined,
// build-image-prompt.ts:656
1. SCENE LOCK controls requested event, venue, and time of day. ...
```

**Cambio.**
1. Nueva función en `visual-context.ts`: `buildImageSceneContext(context): string[]` (no se toca `buildVisualSceneLock`, que usa LoRA). Emite solo:
   - `Event: ${eventLabel}` (si `eventLabel` contiene caracteres no ASCII, se usa `eventCue`, que ya está en inglés);
   - `Venue: ${matchVenue(venue)?.cue ?? "the named venue"}`;
   - `Time of day: ${lightingKindWords}`;
   - `Style: ${style}` (solo si es inglés plano).

   **No** emite petición, paleta, PIECE MATCH, APPROVED PLAN ni APPROVED MATERIALS.
2. `build-image-prompt.ts`: se renombra la sección a `SCENE CONTEXT` y se baja a la posición 6 de la estructura objetivo. Se elimina `eventAuthorityContract` (`:556-568`) y su llamada. «OPEN-EVENT HONESTY» se fusiona en DO NOT.
3. Se elimina «The final image must visibly prove every populated SCENE LOCK field».
4. Prioridad: se sustituye por la lista reescrita de arriba.
5. `route.ts:878-893`: se deja de pasar `approvedPlan`, `approvedMaterials` y `pieceMatchLevels` a `buildVisualContext` **para Gemini**. LoRA no los lee para el caption: verificar `buildLoraEnvironmentCues` (`visual-context.ts:277`), que no los usa.
6. Si la paleta del brief difiere de los colores del plan, `route.ts` registra `console.info("[generate] paleta del brief distinta del plan", {request_id, brief, plan})`. Dato de diagnóstico; no se envía.

**Pruebas.**
- H0 I4 (sin `PALETTE: rosado` con brief ajeno) e I2 (sin `sí, apruébalo así`).
- Actualizar `scripts/test/test-plan-prompt.ts` y `test-visual-prompts.ts` si afirman `SCENE LOCK` o `USER REQUEST VERBATIM`; buscar `grep -rn "SCENE LOCK\|USER REQUEST VERBATIM" scripts/test`.
- `npm run ia:test-prompts`, `npm run plan:test-prompt`.

**Hash y contratos:** ninguno. No cambia `plan_hash`, `sceneSpecHash`, contrato ni vectores dorados.

**Riesgos:**
- Se pierde la «trazabilidad» de la petición original. La auditoría ya guarda `solicitudOriginal` (`registrarPlanAudit`); no hace falta en el prompt.
- Lugares nombrados en español libre («finca en Llanogrande») pierden su nombre exacto. Mitigación: `Venue:` usa `cue` en inglés, y si no hay `cue`, la cadena del lugar entre comillas como etiqueta invisible.

**Revertir:** revertir el PR, que solo cambia texto.

**Dependencias:** base de G12. I4 de H0.

---

### G2 — La identidad rica del elemento se calcula y se descarta
**Severidad:** alta · **Esfuerzo:** M

**Causa raíz.**
- `scene-spec.ts:417-458` arma hasta 12 `identity_constraints`: desglose de materiales, unidades por instancia, colores por material, `adaptation`, forma y `uncertainties`.
- `scene-spec.ts:460-465` (`safeElements`) los **reemplaza** por dos frases.
- Además, muchas de esas restricciones están en español: `adaptation` («Construir esta estructura…», `blueprint.ts:141`) y `material` («Materiales reales del catálogo…»).

**Código actual.**
```ts
const safeElements = elements.map((element) => ({ ...element, identity_constraints: [
  `Required final arrangement and appearance: ${element.catalog_visual?.descriptor_perceptual_en ?? STRUCTURE_DESCRIPTORS[...] ?? "approved catalog decoration"}.`,
  "Render the approved catalog-backed visual as an installed physical element; ...",
]}));
```

**Cambio.** No se resucita la lista vieja; varias entradas están en español o son redundantes con el estimado. Se añaden datos estructurados al elemento y se renderizan en el bloque del grupo (G12):
- `SceneElementSchema` gana `installed_units_per_material?: Array<{ color_en: string; finish_en?: string; units: number }>`, calculado en `buildApprovedSceneSpec` a partir de `catalogProducts[].installedUnits` y `share`. La ruta ya calcula `installedUnits` (`route.ts:~760`).
- `uncertainties` (los `supuestos` del plan, en español) **no** van al prompt. Hoy tampoco van, y se deja documentado.
- El bloque del grupo emite: `balloons per instance: 40 — 20 matte white, 10 black, 10 blue (12-inch)`.
- Se elimina la construcción muerta de `identity_constraints` en `scene-spec.ts:417-458` y se conserva solo lo que `safeElements` emite, para que nadie crea que llega.
- Se corrige el «`.;`» de `required_elements` (`scene-spec.ts:504`: `identity_constraints[0]` ya termina en punto).

**Pruebas.** H0: nueva aserción I11, «cada grupo declara sus unidades por color y suman `total_unidades / repeticiones`». `npm run ia:test-escena-plan-imagen`.

**Hash y contratos.** Cambia `sceneSpecHash`: `SceneSpec` gana un campo. El cliente no envía `sceneSpecHash` (verificado en `page.tsx`), así que no rompe nada en vuelo. Sin efecto en `plan_hash` ni en vectores dorados.

**Riesgos:** el campo nuevo del esquema afecta a los consumidores de `SceneSpec` (QA, auditoría). Es opcional.

**Revertir:** quitar el campo y su render.

**Dependencias:** G12 (dónde se renderiza) y G4 (nombres de color en inglés).

---

### G3 — Kits, figuras y bouquets sin armado: sin línea de color y con una prohibición de globos
**Severidad:** alta · **Esfuerzo:** S

**Causa raíz.** `build-image-prompt.ts:490-494` (`tieneContratoDeColor`) exige `category === "balloon_structure"`, un nombre que contenga «arco/columna/guirnalda/balloon», o una frase de Python. `planBlueprint` asigna la categoría `"other"` a `kit` y `accesorio` (`blueprint.ts:~117`). Con cero elementos, `colorVarietyContract` emite `"No balloon color mix is approved; do not add balloon structures..."` (`:514`). Volcado del vector 14: el prompt contiene a la vez «2 balloon figures and 1 balloon bouquet» y esa prohibición.

**Cambio.**
```ts
export function tieneContratoDeColor(element, colorPatterns?, sceneSpec?: SceneSpec): boolean {
  if (frasePatronColor(colorPatterns, element, "prompt_gemini")) return true;
  if (["backdrop", "curtain", "drape", "panel", "lighting"].includes(element.category)) return false;
  const conGlobos = (sceneSpec?.material_estimate?.balloons ?? []).some((l) => l.structure_id === idDeEstructura(element) && l.design_quantity > 0);
  return conGlobos || element.category === "balloon_structure" || /\b(?:arco|columna|guirnalda|balloon)\b/i.test(element.name);
}
```
- El fallback `"No balloon color mix is approved; do not add balloon structures..."` se emite solo si **ningún** elemento tiene globos en el estimado, y su texto pasa a ser `"No balloon colors are approved for this scene."` (sin «do not add balloon structures»).
- Llamadores: `route.ts:~940` (`espera_linea_de_color`), `escena-de-vector.ts:~124` y `colorVarietyContract`/`colorPatternSentence`. Hay que pasarles `sceneSpec`.

**Pruebas.** H0 I5. Ajustar las aserciones de conteo de líneas de color en `test-invariantes-plan.ts` y `test-color-escena-produccion.ts`: el vector 14 pasa de 0 a 3 líneas. `npm run plan:test-invariantes`, `npm run plan:test-color-escena`.

**Hash y contratos:** ninguno.

**Riesgos:** `verificarCoherenciaPrompt` pasa a exigir más líneas. Si un kit trae `resolved_colors` del producto (colores de familia) y no los comprados, puede fallar cerrado. Es el comportamiento correcto, pero hay que probarlo con los 31 vectores antes de desplegar.

**Revertir:** volver a la condición anterior.

**Dependencias:** G4 (idioma de la línea) y H0.

---

### G4 — Se pierde el acabado y el color exacto; colores en dos idiomas
**Severidad:** alta · **Esfuerzo:** L (contrato + Python + TS)

**Causa raíz.**
- Candado monocromo sin acabado: `build-image-prompt.ts:522`.
- `resolved_finishes` (`blueprint.ts:133` → `scene-spec.ts:416`) no lo lee ninguna parte del prompt de Gemini (`compactSceneSpec`, `:211-240`, lo omite).
- El bloque «Exact colors» solo se añade a las piezas del motor: `plan.py:3930` dentro de `_armados_del_motor_resueltos` (`:3889`), que depende de `ARMADO_ARCO_COLUMNA_V1`, OFF en producción (`feature-flags.ts:86`).
- La línea de color usa nombres en español (`resolved_colors`), mientras la frase de patrón de Python usa inglés: «blanco, azul, negro» frente a «white, black, white, blue».
- `especificacion_de_colores` omite en silencio un color que no está en la lámina (por ejemplo `burdeos`; verificado con `uv run`).

**Código actual (Python).**
```python
# plan.py:3930
cifras = especificacion_de_colores(materiales)
if cifras:
    publicado["prompt_gemini"] = f"{publicado['prompt_gemini']} {cifras}"
```

**Cambio.**

*Contrato* (`src/lib/ia/contracts/domain-v1.ts`, junto a `patrones_color`, `:~442`):
```ts
export const ColorImagenSchema = z.object({
  color: texto(60),                 // tal como en las líneas del plan (español)
  acabado: texto(40).nullable(),
  clave_en: texto(80),              // color_con_acabado_en(color, acabado): "high-shine chrome gold"
  referencia: z.object({
    codigo: texto(10), nombre_completo: texto(60), familia: texto(20),
    pms: texto(20).nullable(), hex_globo: z.string().regex(/^#[0-9a-f]{6}$/i),
  }).strict().nullable(),           // null = no está en la lámina (p. ej. burdeos)
}).strict();
// PlanResueltoV1Schema:
colores_imagen: z.array(ColorImagenSchema).max(32).optional(),
```
Flujo: `npm run contracts:export:domain` → `uv run --directory services/ai-api python scripts/generate_models.py`.

*Python* (`plan.py`, en `resolve_plan`, **después** de calcular `plan_hash`, al lado de donde se publican `patrones_color`):
```python
def _colores_imagen(structures: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    vistos: dict[tuple[str, str], dict[str, object]] = {}
    for s in structures:
        for linea in _mappings(s.get("lineas")):
            color = _text(linea.get("color")); acabado = _text(linea.get("acabado"))
            if not color or (color, acabado or "") in vistos: continue
            ref = referencia_de(color, acabado)
            vistos[(color, acabado or "")] = {
                "color": color, "acabado": acabado,
                "clave_en": color_con_acabado_en(color, acabado),
                "referencia": None if ref is None else {
                    "codigo": ref["codigo"], "nombre_completo": ref["nombreCompleto"],
                    "familia": ref["familia"], "pms": ref.get("pms") or None, "hex_globo": ref["hexGlobo"]},
            }
    return list(vistos.values())
result["colores_imagen"] = _colores_imagen(structures)   # fuera de snapshot
```
- `plan.py:3928-3931`: **dejar de añadir** `cifras` a `prompt_gemini` de las piezas del motor; el bloque global las sustituye. Así se evita duplicar.
- `color_catalogo.py`: exportar `referencia_de` en `__all__`. Hoy ya está.

*TS* (`build-image-prompt.ts`): una sola función, dueña del color en el prompt.
```ts
export function colorEnPromptGemini(colores: readonly ColorImagen[] | undefined) {
  const porClave = new Map(colores?.map((c) => [plegar(c.color) + "|" + plegar(c.acabado ?? ""), c]));
  return (color: string, acabado?: string | null) =>
    porClave.get(plegar(color) + "|" + plegar(acabado ?? ""))?.clave_en ?? `${ACABADO_EN[plegar(acabado ?? "")] ?? ""} ${translateLoraColor(color)}`.trim();
}
function exactBalloonColorsBlock(colores?: readonly ColorImagen[]): string {
  if (!colores?.length) return "";
  return ["EXACT BALLOON COLORS (match these real Sempertex latex references; hex is the inflated balloon, not ink)",
    ...colores.map((c) => c.referencia
      ? `- ${c.clave_en}: Sempertex ${c.referencia.nombre_completo} ${c.referencia.codigo}${c.referencia.pms ? `, PANTONE ${c.referencia.pms}` : ""}, inflated ${c.referencia.hex_globo}`
      : `- ${c.clave_en}: no catalog reference available; render the plain ${c.clave_en} latex color`)].join("\n");
}
```
- Línea de color por grupo, siempre en inglés y siempre con acabado:
  - `"<Nombre>": EXACT COLORS — use only: high-shine chrome gold, matte white.`
  - en el caso monocromo: `"<Nombre>": SINGLE COLOR — use only: high-shine chrome gold.`
- `describirMezclaDeColor` (`mezcla-color-escena.ts:342`) usa `clave_en`. Hoy concatena el nombre en español y el acabado: «blanco (~50%, matte)».
- `verificarCoherenciaPrompt(prompt, plan, escena, opciones?: { traducirColor?: (c: string) => string })`: el regex `LINEA_COLOR` (`coherencia.ts:65`) pasa a `/^- "?(.+?)"?: (?:EXACT COLORS — use only: ([^.]+)\.|SINGLE COLOR — use only: ([^.]+)\.)/` y `erroresDeColor` compara `conjunto(propios.map(traducir))`.
- La frase de patrón de Python ya usa `color_con_acabado_en`. Con eso, las tres cosas (línea, patrón y bloque) comparten clave.

**Pruebas.**
- Python: `tests/test_color_catalogo.py` y `tests/test_plan_armado_motor.py` dejan de esperar «Exact colors» dentro de `prompt_gemini`. Nuevo `tests/test_colores_imagen.py`: «cada (color, acabado) de las líneas aparece una vez», «`burdeos` → `referencia: null` y `clave_en` en inglés», «`colores_imagen` no cambia `plan_hash`» (resolver dos veces, con y sin el campo, y comparar).
- `REGRESION_ACTUALIZAR=1 uv run --directory services/ai-api pytest tests/test_plan_regresion.py`. Revisar el diff: **solo** debe aparecer `colores_imagen` en `expected_python`.
- TS: H0 I4 e I10. `npm run contracts:check`, `npm run plan:test-color-escena`, `npm run plan:test-invariantes`, `npm run ia:test-patron-color-prompt`.

**Hash, contratos y vectores.**
- `plan_hash`: sin cambio (el campo está fuera del snapshot).
- Contrato `plan-resuelto.v1`: campo opcional nuevo, compatible hacia atrás.
- Despliegue: **app y `ai-api` juntos**. Un `ai-api` viejo no envía el campo y TS cae al fallback `translateLoraColor` + `ACABADO_EN`, que sigue siendo inglés sin cifras. Una app vieja con un `ai-api` nuevo **rechaza** el campo: verificado, `PlanResueltoV1Schema` cierra con `.strict()` en `domain-v1.ts:486`. Orden obligatorio: desplegar primero la app (que acepta el campo opcional) y después `ai-api`.
- Vectores: regenerar los 32 `expected_python`. `expected` no se toca.

**Riesgos:**
- Hex y Pantone pueden introducir texto renderizable (códigos). Mitigación: la regla única de texto invisible de OUTPUT (G12), y medirlo con `ia:eval`.
- `clave_en` cambia el texto que lee la QA y el LoRA. El LoRA no se toca: usa `prompt_lora` y `translateLoraColor`.

**Revertir:** revertir los PR de TS y Python. El campo es opcional y no hay migración de datos.

**Dependencias:** G3, G12. Bloquea I4 e I10.

---

### G5 — Dos estructuras en `entrada` (o `esquina`, `vegetacion`, `pared_lateral`) ×2 quedan del mismo lado
**Severidad:** alta · **Esfuerzo:** S (código) + **decisión de producto**

**Causa raíz.**
- `ubicaciones.ts:55`: `UBICACIONES_CENTRADAS` no incluye `entrada`.
- `ubicaciones.ts:139` solo aplica el espejo en ubicaciones centradas.
- El resto cae en el reparto horizontal dentro de la caja `entrada` (`:14`, `x 0.04–0.32`).
- Volcado del vector 29: «middle left area» dos veces.
- **Es deliberado según una prueba:** `scripts/test/test-generate-qa-plan.ts:105-111` afirma que `entrada`, `esquina`, `vegetacion` y `pared_lateral` «siguen siendo una ubicación de un solo lado».

**Cambio** (solo para `entrada`; las otras tres sí son de un lado por definición):
```ts
// ubicaciones.ts
const UBICACIONES_EN_PAR_FLANQUEANDO = new Set<Ubicacion>(["entrada"]);
// en cajasDeEstructuras, antes de la rama UBICACIONES_CENTRADAS:
if (estructura.repeticiones === 2 && UBICACIONES_EN_PAR_FLANQUEANDO.has(ubicacion)) {
  const izquierda = estructuraBox;                         // x 0.04..0.32
  resultado[`${id}#1`] = izquierda;
  resultado[`${id}#2`] = espejoHorizontal(izquierda);      // x 0.68..0.96
  continue;
}
```
- Corregir el comentario desfasado de `ubicaciones.ts:63` («la geometría entra en el plan_hash»): no entra; entra en `sceneSpecHash`.

**Pruebas.** `test-generate-qa-plan.ts:105-111`: sacar `entrada` del bucle y añadir una aserción espejo («#1 a la izquierda de 0,34; #2 a la derecha de 0,66»). H0 I9. `npm run ia:test-generate-qa-plan`, `npm run ia:test-qa-piezas-separadas` (comprobar que `findSeparateSidePieces` ahora emite SEPARATE SIDE PIECES).

**`plan_hash` y migración.** **Sin efecto en `plan_hash`**: verificado, el JSON canónico de `plan.py:3669-3673` no incluye cajas. Cambian `sceneSpecHash` y la geometría en `plan_audit`. El cliente no envía `sceneSpecHash`, así que no hay nada que migrar en las propuestas abiertas. Vectores dorados: sin cambio.

**Riesgos:**
- Una «entrada» que en el sitio real es una sola puerta lateral con dos columnas juntas queda mal. Lo decide una persona. Alternativa: un campo `lado` en el plan, que sí cambiaría `plan_hash` y quedaría para otra fase.
- El caption LoRA también cambia porque lee las cajas, y hay que revisar `ia:test-lora-bilateral`.

**Revertir:** quitar la rama.

**Dependencias:** ninguna.

---

### G6 — Medidas, flotantes y enums internos en el prompt
**Severidad:** media-alta · **Esfuerzo:** S

**Causa raíz.**
- `route.ts:891` usa `piece: element.name`, que trae «(1.8 m)» y «#1 de 2».
- `route.ts:881` emite `(${estructura.tipo}, ${estructura.ubicacion})`.
- `build-image-prompt.ts:281` imprime `estimate.design.type` («composite_installation», «columna») e `installation_length_m` crudo («4.199999999999999»).
- `blueprint.ts:152` usa `focal_point` = nombre del plan o «instalación central»; `blueprint.ts:155` usa `negative_space` en español; los dos entran en `positive_prompt.composition` (`scene-spec.ts:505`).
- Nombres de instancia «#1 de 2» (`blueprint.ts:~99`).

**Cambio.**
- `route.ts:888-893` y `:881`: se eliminan (G1).
- `build-image-prompt.ts:281`: se elimina la línea «Physical design». Cada grupo ya lleva su escala física (`physicalScale`). Si se conserva algo, que sea `Overall scale: ${visual_scale.replace("_", " ")}`.
- `blueprint.ts`: `focal_point` pasa a `focal_element_id` y el prompt lo nombra con la palabra del grupo («the column pair is the focal point»). `negative_space: ["clear walking space in front of the installation", "visible contact with the floor or furniture"]`. Cambia `blueprint_hash` y, con él, `sceneSpecHash`; no `plan_hash`.
- `promptElementName` (`build-image-prompt.ts:~75`): quitar también el sufijo `#n de m` y numerar en inglés en el bloque del grupo («instance 1 of 2»).

**Pruebas.** H0 I2 e I3. Las pruebas que buscan «#1 de 2» en el prompt (`grep -rn "de 2\"" scripts/test`) se actualizan. Ojo: `coherencia.ts:99-100` busca `estructura.nombre` (sin «#»), así que sigue cumpliéndose.

**Hash:** solo cambia `sceneSpecHash`.

**Riesgos:** `anfitrionaEnPrompt` (`build-image-prompt.ts:~150`) quita `#\d+ de \d+` con un regex; hay que adaptarlo.

**Revertir:** revertir el PR.

**Dependencias:** G1, G12.

---

### G7 — Reglas de conteo contradictorias
**Severidad:** media · **Esfuerzo:** S

**Causa raíz.**
- `build-image-prompt.ts:283`: «exact object-by-object counting is not required».
- `:692`: «Respect INSTALLED DESIGN quantities exactly».
- `scene-spec.ts:517` (#3): «Respect the installed design quantities».
- El SIZE MIX dice «HARD CONSTRAINT … 40 balloons each».
- La frase de patrón describe una rejilla exacta.

**Cambio.** Una sola regla en la sección COUNT RULE; se elimina el texto de `:283`, `:692` y `scene-spec.ts:517` (#3):
```
COUNT RULE
- Structure count is exact (see APPROVED STRUCTURES).
- Balloon counts per structure are targets: stay within ±10% of each structure's stated count and keep its size and color proportions. Never render purchased package surplus.
- When a structure carries a COLOR PATTERN or ASSEMBLY, follow its rows/clusters exactly; that phrase overrides the ±10% tolerance for that structure.
```
`EXCEPCION_CONTEO_CON_ARMADO` (`armado-en-prompt.ts`) se sustituye por el tercer punto.

**Pruebas.** H0 I12: `cuenta(prompt, /exact(ly)? object-by-object|Respect INSTALLED DESIGN quantities exactly/) === 0`. Ajustar `test-armado-bouquet-prompt.ts` si busca `EXCEPCION_CONTEO_CON_ARMADO`.

**Hash:** ninguno. **Riesgos:** el ±10 % es una elección; validarlo con `ia:eval`. **Revertir:** revertir el PR. **Dependencias:** G12.

---

### G8 — Simetría fija `asymmetric`
**Severidad:** media · **Esfuerzo:** S

**Causa raíz.** `blueprint.ts:154` fija `symmetry: "asymmetric"`. A eso se suman «natural asymmetry» (`scene-spec.ts:505`) y «Balance left and right without forcing perfect symmetry» (`build-image-prompt.ts` sección CREATIVE).

**Cambio.**
```ts
// blueprint.ts
const simetria = plan.plan.estructuras.some((e) => e.repeticiones % 2 === 0 && e.repeticiones >= 2) ? "symmetric" : "balanced";
composition: { ..., symmetry: simetria }
```
- El prompt solo menciona la simetría cuando vale `symmetric`: «Mirror paired structures left/right around the focal center.».
- Se eliminan las frases fijas de asimetría en `scene-spec.ts:505` y en CREATIVE.
- Revisar el enum de `ReferenceBlueprintV2Schema.composition.symmetry` antes de usar `balanced`; si no existe, usar `"balanced"` → `undefined` y omitir.

**Pruebas.** H0, nueva I13: con vectores de pares (01, 29) no aparece «asymmetr».

**Hash:** `blueprint_hash` y `sceneSpecHash`. **Riesgos:** bajos. **Revertir:** revertir el PR. **Dependencias:** G5.

---

### G9 — La composición de la referencia no llega, pero el prompt dice que manda
**Severidad:** media · **Esfuerzo:** S (fase A) / M (fase B)

**Causa raíz.**
- `route.ts:698` (comentario «así que no se lee aquí») y `:718`: `body.blueprint` solo alimenta la escenografía.
- Sin embargo, `build-image-prompt.ts:660` y `:704` afirman que AUTOMATIC_SCENE_SPEC trae encuadre, densidad y asimetría de la referencia.
- `:624` dice «using the supplied composition reference» aunque no haya ninguna.

**Cambio.**
- **Fase A (S):** borrar `:660`, `:704` y la línea «The analyzed reference may describe…». La tarea en modo `text_to_image` se escribe condicional: `inputs.some((i) => i.role === "composition_reference") ? " Use the composition reference only for framing and spacing." : ""`.
- **Fase B (M):** `ImagePromptInput.referenceComposition?: { density: string; symmetry: string; focal: string }`, leído de `referenciaAnalizada.data.composition` en `route.ts:718`. Se valida que los textos estén en inglés plano con `ambientDecorName`-like (`reference-structure.ts:390`) y se emite como sección 8 de la estructura objetivo.

**Pruebas.** H0 I14: sin `composition_reference` en `inputs`, el prompt no contiene «composition reference». `npm run ia:test-escenografia` (la fase B toca la misma lectura).

**Hash:** ninguno. **Riesgos:** fase B: textos del analizador en español; filtrar o descartar. **Revertir:** revertir el PR. **Dependencias:** G12.

---

### G10 — Fotos de catálogo perdidas sin aviso
**Severidad:** media · **Esfuerzo:** S

**Causa raíz.**
- `route.ts:265-290`: `cargarFoto` devuelve `null` en 9 caminos, incluido un `catch {}` sin registro (`:288`).
- Solo admite `*.shopify.com` (`hostImagenPermitido`).
- `route.ts:436`: `droppedCatalogProductIds` solo cuenta las fotos recortadas por el límite del proveedor.
- `build-image-prompt.ts:608` afirma «all … photos fit», y `:719` pide comparar contra una imagen que no se envió.

**Cambio.**
```ts
type FalloFoto = "host_no_permitido" | "redireccion" | "http" | "mime" | "tamano" | "ruta" | "excepcion";
async function cargarFoto(foto: string): Promise<{ imagen: Imagen } | { fallo: FalloFoto }>;
// cargarFotosProducto devuelve { imagenes, faltantes: Array<{ productoId; fallo }> }
console.warn("[generate] foto de catálogo no cargada", { request_id, variant_id, fallo });   // sin URL completa
```
- `buildInputs` recibe `missingCatalogProductIds`, y `promptBase` recibe `droppedCatalogReferenceCount: recortadas + faltantes`.
- Texto nuevo en IMAGE MAP: `CATALOG PHOTOS: ${n} of ${m} approved materials have no photo; render them from their EXACT BALLOON COLORS entry only.`
- `:719` («Product color verification…») se emite solo si `inputs.some((i) => i.role === "catalog_product_reference")`.
- Telemetría: `diagnosticoGeneracion.fotosCatalogoFaltantes` en `auditarImagen` (`route.ts:~620`).

**Pruebas.** Nueva `scripts/test/test-generate-fotos-catalogo.ts` (`ia:test-generate-fotos-catalogo`): con un `fetch` doble que devuelve 404 o un host no permitido, la salida trae `faltantes` y el prompt no dice «all … fit».

**Hash:** ninguno. **Riesgos:** ruido en los logs; limitarlo a un aviso por variante y petición. **Revertir:** revertir el PR. **Dependencias:** G4 (el texto remite al bloque de color) y GP2.

---

### G11 — «REVISION DELTA» sin imagen previa
**Severidad:** media · **Esfuerzo:** S

**Causa raíz.**
- `page.tsx:1342` envía `revisionInstruction` aunque no haya `ultimaImagenGenerada`; `:1334` sí condiciona `previousGeneratedImage`.
- `route.ts:895`: `const revisionInstruction = body.revisionInstruction ?? body.instruccion;` sin guarda.
- `build-image-prompt.ts:618` emite «Apply only this user delta to the existing result».

**Cambio.**
- `page.tsx:1342`: `revisionInstruction: (override?.instruccion ?? ajuste.trim()) && ultimaImagenGenerada ? (override?.instruccion ?? ajuste.trim()) : undefined`.
- `route.ts:895`: `const revisionInstruction = previous ? (body.revisionInstruction ?? body.instruccion) : undefined;` y, si llega sin `previous`, `console.info("[generate] ajuste ignorado: no hay imagen previa", { request_id })`.
- Fijar en el texto de la instrucción que debe estar en inglés o citarse como dato: `Customer adjustment (quoted, may be Spanish): "…"`.

**Pruebas.** Extender `ia:test-ajuste-propuesta` o crear `test-generate-revision.ts`: sin `previousGeneratedImage`, el prompt no contiene «REVISION DELTA».

**Hash:** ninguno. **Riesgos:** un usuario que escriba un ajuste antes de la primera imagen pierde el texto. Es aceptable: lo correcto es pedirlo en el chat (SEGUIMIENTO §E.2). **Revertir:** revertir el PR. **Dependencias:** ninguna.

---

### G12 — Prompt de 30–47k caracteres, repetido y con negativos que contradicen lo aprobado
**Severidad:** media · **Esfuerzo:** L

**Causa raíz.**
- El JSON `AUTOMATIC_SCENE_SPEC` (`build-image-prompt.ts:211-240`) repite lo que ya dicen las secciones: 7.202 c en el vector 29 y 12.353 c en el 23.
- MUST INCLUDE, COLOR, INSTANCE y COMPOSITION se emiten por instancia (`:600-690`).
- La prohibición de texto aparece unas 6 veces.
- Negativos fijos que chocan con el plan:
  - `scene-spec.ts:522` prohíbe «isolated balloon arches, or loose garlands» aunque el plan apruebe un arco o una guirnalda;
  - `:517` (#5) pide «Use accent kits, signs, and themed props», que contradice las prohibiciones;
  - `:529` y `build-image-prompt.ts:710` dan ejemplos fijos de negro/plateado/azul;
  - instrucciones de luces sin que haya luces (`:517` #8);
  - `VENUE_PRESERVATION` (`scene-spec.ts:229`) en `text_to_image`, y «Keep areas outside automatic editable regions unchanged» (`:701`) sin foto del espacio.

**Cambio.**
1. Se elimina `compactSceneSpec` del prompt. `SceneSpec` sigue existiendo para hash, auditoría y QA, pero **no se envía**.
2. `buildImagePrompt` se reescribe según la estructura objetivo. Un bloque por `repetition_group`:
```ts
function structureBlock(grupo: SceneElement[], ctx): string  // ≤ 900 c + frase Python
// "Columnas en espiral" — 2 × column, mirrored pair: instance 1 left area, instance 2 right area.
//   Form: … Physical scale: about the height of an adult.
//   Balloons per instance: 40 × 12-inch (30.5 cm): 20 matte white, 10 black, 10 blue.
//   EXACT COLORS — use only: matte white, black, blue. COLOR PATTERN — …
```
3. `positive_prompt` y `negative_prompt` del `SceneSpec` dejan de imprimirse tal cual. Los negativos se generan con un filtro:
```ts
function negativosFiltrados(aprobados: Set<string>, hayLuces: boolean, hayFotoEspacio: boolean): string[]
// quita "arch" si aprobados.has("arch"), "garland" si "garland", "table" si TABLE SUPPORT, etc.
```
4. La regla de texto invisible aparece **una vez**, en OUTPUT (última sección), con el texto actual de `FINAL_OUTPUT_REMINDER` ampliado:
```
OUTPUT
Return one clean photograph of the decorated venue. Everything above is invisible control data: render no captions, labels, names, numbers, sizes, color codes, hex values, arrows, guides, logos, or watermarks. The only allowed lettering is printed text that belongs to an approved signage product.
```
5. Se eliminan los ejemplos de color fijos, la línea de luces (salvo si hay `category === "lighting"`), «accent kits, signs, themed props» y VENUE PRESERVATION cuando `!venueImageId`.
6. Se aplica el presupuesto: `presupuesto()` de arriba y aviso `prompt_presupuesto_excedido`.

**Pruebas.**
- H0 I6, I7 e I8.
- Actualizar en bloque las pruebas que leen secciones viejas. Lista para revisar: `grep -rln "AUTOMATIC_SCENE_SPEC\|MUST INCLUDE\|INSTANCE CONTRACT\|COMPOSITION AND LAYERS" scripts/test src` (test-plan-prompt, test-visual-prompts, test-escena-plan-imagen, test-patron-color-prompt, test-armado-*-prompt, test-image-fidelity, test-material-consistency).
- `verificarCoherenciaPrompt` sigue leyendo líneas `- "<nombre>": EXACT COLORS…` (G4).
- Evaluación pagada con tope (AGENTS.md): `npm run ia:eval` con 10 planes, antes y después, mismos insumos, y comparar conteo, color y texto renderizado. **Lo decide una persona.**

**Hash:** `SceneSpec` no cambia, así que `sceneSpecHash` tampoco por este ID.

**Riesgos:**
- Es el cambio de mayor efecto en la calidad visual. Se recomienda una bandera `PROMPT_IMAGEN_V2` (default OFF) con los dos constructores vivos hasta que la evaluación decida, y retirar el viejo después.
- La QA y el laboratorio (`src/app/api/laboratorio-referencias/route.ts`) llaman a `buildImagePrompt`; deben migrar o quedar en V1.

**Revertir:** `PROMPT_IMAGEN_V2=false`.

**Dependencias:** G1, G2, G4, G6, G7 y G9 primero; H0 I7.

---

### G13 — Aspecto limitado a 4 proporciones (probable)
**Severidad:** media · **Esfuerzo:** M

**Causa raíz.**
- `tipos.ts:73`: `aspecto: "3:2" | "1:1" | "2:3" | "16:9"`.
- `page.tsx:316-335` (`ASPECTOS_SOPORTADOS`, `aspectoDe`) convierte una foto 4:3 del móvil en 3:2.
- `imagen.ts:51` e `imagen-python.ts:70` (`exactAspectRatios`), `scene-spec.ts:123` (enum), `python-adapter.ts:1329`, `interaction.py:73`, `aspect-transform.ts:10`.
- Mientras tanto, `scene-spec.ts:~511` exige «every other pixel must come out identical».

**Cambio.**
- Añadir `"4:3" | "3:4" | "9:16"` en todos los puntos citados, después de verificar en la documentación de `gemini-3.1-flash-image` (Interactions API, `response_format.aspect_ratio`) que los acepta.
- Añadirlos a `imageSizeFor` (`sempertex-lora.ts:225`) con tamaños de fal válidos, o mapearlos allí al más cercano. LoRA queda igual.
- `aspectoDe` usa la lista ampliada solo para la foto del espacio.

**Pruebas.** `ia:test-uzume-imagen-python` (paridad del enum), una prueba unitaria de `aspectoDe(4032, 3024) === "4:3"`, y que `resolveAspectTransform` devuelva `strategy: "exact"`.

**Hash y contratos:** el enum de `SceneSpec` (contrato interno) y el contrato de transporte `image-generate` hacia Python, que exige desplegar app y `ai-api` juntos. `plan_hash` no cambia.

**Riesgos:** si el modelo no admite la proporción, el proveedor devuelve 400. Mitigación: `exactAspectRatios` como lista de capacidad (ya existe) y el fallback `pad` de `resolveAspectTransform`.

**Revertir:** quitar los valores del enum.

**Dependencias:** ninguna.

---

### G14 — Descripciones vacías o ruidosas junto a cada imagen
**Severidad:** baja · **Esfuerzo:** S

**Causa raíz.**
- `route.ts:694`: cada referencia lleva `descripcion: "Automatic model decision defines element inclusion and catalog adaptation."`.
- `producto-para-imagen.ts:40-44`: `${nombre}. ${product.descripcion}.` da «Globo latex blanco. Globo latex blanco R-12..» (código de SKU y doble punto). La descripción real del catálogo puede ser texto de marketing en español.
- APPROVED PLAN MATERIALS repite variantes por tamaño (vector 23: «Globo latex rosado — rosado» ×4). Lo elimina G1.

**Cambio.**
- `route.ts:694`: `descripcion: ""`. `imagen.ts:~66` ya concatena rol + `allowed_use`; quitar el espacio final cuando la descripción está vacía.
- `descripcionProductoParaImagen`: `Material identity reference: ${clave_en} latex balloon (${diam}-inch).` Usa G4 y no envía la descripción del catálogo.

**Pruebas.** Unitaria de `descripcionProductoParaImagen` (sin dígitos de SKU y sin «..»).

**Hash:** ninguno. **Riesgos:** se pierde información de kits con estampado; para `tipoProducto` en E-DECORS conservar `nombreProductoParaImagen`. **Revertir:** revertir el PR. **Dependencias:** G4.

---

### G15 — Código muerto y flags apagados en el camino de imagen
**Severidad:** baja · **Esfuerzo:** S

**Hechos verificados.**
- `GEMINI_IMAGE_PYTHON_ENABLED` (`feature-flags.ts:184`) no está definido en `.env.local` ni en `.env.production`, así que `imagen-python.ts` no se ejecuta. El prompt se arma igual en ambos caminos (TS), por lo que **no hay divergencia de prompt**; solo transporte.
- `correctiveInstruction` (`build-image-prompt.ts:54`, `:740`) no tiene llamadores; la QA se retiró (ADR-0025).
- `ambiente.instruccion` solo se usa en la composición híbrida (`route.ts:1215`) y nunca en Gemini puro; `AMBIENTE_FIESTA_V1` está OFF (`feature-flags.ts:39`).
- `VENUE_AWARE_PLACEMENT_V1` está OFF.
- Las frases del motor con cifras dependen de `ARMADO_ARCO_COLUMNA_V1`, OFF en producción.

**Cambio.**
- Quitar `correctiveInstruction` y su sección. Si la QA vuelve, se reintroduce con su consumidor.
- Decidir por ADR: o se enciende `GEMINI_IMAGE_PYTHON_ENABLED` en un despliegue medido, o se documenta la condición de retiro de `imagen.ts`. AGENTS.md: «Do not remove the legacy path until…».
- `ambiente`: o se pasa a `buildImagePrompt` como sección opcional (bajo la misma bandera), o se documenta que es solo para el modo híbrido.

**Pruebas.** `ia:test-uzume-imagen-python` sigue verde. Al quitar `correctiveInstruction`: `tsc --noEmit`.

**Hash:** ninguno. **Riesgos:** ninguno funcional. **Revertir:** revertir el PR. **Dependencias:** G12 (para no tocar el constructor dos veces).

---

### Probables

#### GP1 — Más imágenes de entrada que el límite de alta fidelidad
**Esfuerzo:** S · **Causa raíz:** `objectFidelityInputLimit: 5` está declarado (`imagen.ts:53`, `imagen-python.ts:72`) pero no se aplica; `route.ts:871` usa `totalInputImageLimit` (14).

**Cambio.** En `buildInputs` (`route.ts:~405`), dentro de los productos (prioridad 3), tomar como máximo `capabilities.objectFidelityInputLimit` **fotos distintas** (después de GP2) y pasar el resto a `catalogMissing` con el motivo `"fidelity_cap"`. Venue, previo y composición no cuentan contra ese límite.

**Pruebas:** unitaria de `buildInputs` con 9 productos: salen 5 de catálogo y la cuenta `dropped` es correcta. **Riesgo:** materiales sin foto, que G4 y G10 cubren con texto. **Revertir:** quitar el límite.

#### GP2 — Foto duplicada por cada variante de tamaño
**Esfuerzo:** S · **Causa raíz:** `generate-products.ts:127` (`p.image_urls[1] AS imagen_principal`), con la misma URL para todas las variantes del producto. `cargarFotosProducto` (`route.ts:293`) no deduplica.

**Cambio.** Deduplicar por URL normalizada antes de `cargarFoto`; una foto por `product_id` cuyo `allowed_use` liste las variantes («also covers 9, 12, 18 and 24-inch sizes»).

**Pruebas:** unitaria con 4 variantes y 1 URL, que debe dar 1 input. **Riesgo:** ninguno. **Dependencias:** GP1.

#### GP3 — `brief.colores` desactualizado tras editar el plan
**Esfuerzo:** S · Queda resuelto en la práctica con G1, porque la paleta deja de entrar al prompt.

**Seguimiento:** el log de G1 («paleta del brief distinta del plan») mide la frecuencia. Si es alta, actualizar `briefRef` en `page.tsx` al aplicar una edición de plan.

---

### Tabla resumen

| ID | Sev. | Esf. | `plan_hash` | `sceneSpecHash` | Contrato | Vectores | Depende de |
|---|---|---|---|---|---|---|---|
| H0 | — | M | no | no | no | no | refactor `armarPromptGemini` |
| G1 | crítica | S | no | no | no | no | — |
| G2 | alta | M | no | **sí** | SceneSpec interno | no | G4, G12 |
| G3 | alta | S | no | no | no | no | G4 |
| G4 | alta | L | no | no | **plan-resuelto.v1 (+opcional)** | `expected_python` ×32 | G3 |
| G5 | alta | S | **no (verificado)** | **sí** | no | no | decisión de producto |
| G6 | media-alta | S | no | sí (blueprint) | no | no | G1, G12 |
| G7 | media | S | no | no | no | no | G12 |
| G8 | media | S | no | sí | no | no | G5 |
| G9 | media | S/M | no | no | no | no | G12 |
| G10 | media | S | no | no | no | no | G4, GP2 |
| G11 | media | S | no | no | no | no | — |
| G12 | media | L | no | no | no | no | G1, G2, G4, G6, G7, G9 |
| G13 | media | M | no | sí | SceneSpec + transporte image-generate | no | — |
| G14 | baja | S | no | no | no | no | G4 |
| G15 | baja | S | no | no | no | no | G12 |
| GP1 | — | S | no | no | no | no | GP2 |
| GP2 | — | S | no | no | no | no | — |
| GP3 | — | S | no | no | no | no | G1 |

**Verificación antes de cerrar cada PR** (AGENTS.md):
- `npx tsc --noEmit && npm run -s lint && npm run plan:test`
- `uv run --directory services/ai-api pytest -q`
- `uv run --directory services/ai-api ruff check app tests && mypy app`
- G4 además: `npm run contracts:check` y `generate_models.py --check`.
- G12 y G13: evaluación pagada con tope declarado, cuya promoción decide una persona.


---

## Parte III · Plan de remediación: flujo chat → imagen (Omoikane → `/api/generate`)

Árbol verificado el 2026-10-04 releyendo cada archivo:línea justo antes de citarlo. Dos correcciones respecto al informe previo: el historial está en `historial-chat.ts:22` (no `:257`, que era la línea dentro de un `cat` concatenado) y las reglas de propuesta vigente están en `resumen-plan-vigente.ts:294,300`.

Convenciones:
- `S`/`M`/`L` = esfuerzo.
- «Hash» = `plan_hash` (JSON canónico `{plan, snapshot}`).
- Verificación común al cerrar cada ID (AGENTS.md):
  `npx tsc --noEmit && npm run -s lint && npm run plan:test && npm run contracts:check`, y además
  `uv run --directory services/ai-api pytest -q`, `ruff check app tests` y `mypy app`.

Orden sugerido: **C2 → C1 → C11 → C7 → C6 → C8 → C5 → C4 → C3 → C9 → C10**. C2 limpia el terreno del prompt y C1 depende de él. C4 y C3 son los cambios de contrato.

---

### C1 · El chat pide aprobar por escrito, pero solo se aprueba con el botón

**Problema.** El texto le dice al cliente «dime si la apruebas». Si contesta «sí», no pasa nada y el turno termina sin imagen.

**Causa raíz (verificada):**
- `src/lib/ia/omoikane/texto-final-turno.ts:29`: `TEXTO_PLAN_LISTO = "…dime si la apruebas o qué quieres ajustar."`
- `src/lib/ia/herramientas/registro-herramientas.ts:406`: el mismo texto en `textoAlAgotarVueltas`.
- `src/lib/ia/omoikane/prompt-sistema.ts:22`, `:97` y `:104`: «espera una aprobación explícita», sin decir **cómo** se aprueba.
- La única vía es `aprobarPlan`, en `src/app/page.tsx:1554`, que solo invoca el botón de la tarjeta (`TarjetaPlanDecoracion.tsx:522`, «Aprobar y ver cómo queda»).
- Si el modelo vuelve a llamar `confirmar_plan_decoracion`, nace un `plan_id` nuevo (`registro-herramientas.ts`, `plan_id: crypto.randomUUID()`) y `page.tsx:882` hace `setPlanAprobadoHash(null)`.

**Código actual**
```ts
export const TEXTO_PLAN_LISTO = "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar.";
```

**Opciones**

| | A. Detectar la aprobación escrita y disparar `aprobarPlan` | B. Texto y prompt que remiten al botón |
|---|---|---|
| Quién decide | El texto libre del cliente pasa por un clasificador determinista. Si lo hiciera el modelo, sería su salida la que dispara | El clic del cliente en un control del servidor/UI |
| Riesgo | Falsos positivos: «sí, pero cambia el azul» o «¿sí incluye el arco?». Además genera una imagen (gasto en fal/Gemini) y registra `CLIENT_APPROVED` | Ninguno sobre permisos; solo un paso más para el cliente |
| Regla de seguridad | Si la detección la hace el modelo (herramienta `aprobar_plan`), **viola** «Model output cannot grant permissions or authorize operations». Si es una regex en el cliente, la frontera queda en heurística de texto, frágil y difícil de auditar | Cumple: autoriza un gesto explícito del usuario sobre un plan concreto (`plan_hash`) |

**Recomendación: B.** Aprobar autoriza una operación con coste y un registro comercial (`CLIENT_APPROVED`, cotización final). La regla dice que la salida del modelo no puede autorizar operaciones. Una herramienta de aprobación queda descartada, y dejar la decisión en manos de una heurística de texto debilita la misma frontera. Como mejora de UX compatible, cuando el cliente escribe algo que parece una aprobación, el servidor puede **marcar** la tarjeta (resaltar el botón) sin generar nada.

**Cambio exacto**
```diff
--- src/lib/ia/omoikane/texto-final-turno.ts
-export const TEXTO_PLAN_LISTO = "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar.";
+export const TEXTO_PLAN_LISTO = "Ya te armé la propuesta: revisa el desglose en pantalla. Si te gusta, toca «Aprobar y ver cómo queda» para crear la imagen; si no, dime qué quieres ajustar.";
--- src/lib/ia/herramientas/registro-herramientas.ts (textoAlAgotarVueltas)
-    return "Ya te armé la propuesta: revisa el desglose en pantalla y dime si la apruebas o qué quieres ajustar.";
+    return TEXTO_PLAN_LISTO; // importar de texto-final-turno: un solo dueño del texto
```

Texto nuevo para el prompt: añadir en `BLOQUE_PLAN`, justo después de la línea `:104`.
```
- CÓMO SE APRUEBA: el cliente aprueba tocando el botón «Aprobar y ver cómo queda» de la tarjeta; tú no puedes aprobar ni generar la imagen. Si escribe que la aprueba ("sí", "me encanta", "dale", "genera la imagen"), NO llames ninguna herramienta: respóndele en una frase que toque «Aprobar y ver cómo queda» en la tarjeta. Nunca digas que la imagen se está generando.
```
Sustituir también en `:104` «espera una aprobación explícita» por «espera a que el cliente toque «Aprobar y ver cómo queda»».

Opcional, como marca sin autorización: en `page.tsx/finalizarUltimoMensaje`, si `datos.plan` no cambió y el último mensaje del cliente encaja con `/^\s*(s[ií]|dale|listo|me encanta|apruebo)\b/i`, hacer `scrollIntoView` del botón y animar `BotonAprobar` (`destacar`). **Sin** llamar `generar`.

**Pruebas**
- `scripts/test/test-jerga-herramientas.ts` (`npm run ia:test-jerga-herramientas`): `TEXTO_PLAN_LISTO` contiene «Aprobar y ver cómo queda» y no contiene «dime si la apruebas»; `textoAlAgotarVueltas` devuelve el mismo texto.
- `scripts/test/test-inyeccion-prompt.ts` o uno nuevo, `test-prompt-aprobacion.ts`, enganchado a `plan:test`: `construirSistema(...)` contiene «CÓMO SE APRUEBA».
- Evaluación manual (`npm run rag:eval-chat`, con tope de gasto): añadir un diálogo «propuesta → "sí, apruébala"» y comprobar que no hay ninguna llamada a herramienta y que el texto nombra el botón.

**Hash, contratos y vectores:** ninguno.
**Riesgos:** el modelo puede seguir llamando `confirmar_plan_decoracion` ante un «sí»; se mitiga con la regla del prompt y con C7.
**Revertir:** restaurar las dos constantes y quitar el párrafo del prompt.
**Dependencias:** C2 (quitar el lenguaje de «modo» que enturbia `:66` y `:97`) y C7.
**Esfuerzo:** S.

---

### C2 · `confirmar_seleccion_rag` sigue expuesta y su texto promete una imagen que nunca llega

**Problema.** Una herramienta muerta: el modelo puede llamarla, el cliente lee «se está generando tu visualización» y no se genera nada.

**Causa raíz (verificada):**
- `src/lib/ia/herramientas/herramientas.ts:19-37`: `CONFIRMAR_SELECCION_RAG`; `:73`, dentro de `HERRAMIENTAS_RAG`.
- `registro-herramientas.ts:147`: `...HERRAMIENTAS_RAG` se expone siempre. El handler está en `:1674` y llena `seleccionFinalIA` en `:1708`.
- `src/app/page.tsx:845-857` no llama a `generar`. `src/app/api/generate/route.ts:497` lanza `APROBACION_REQUERIDA` si no hay plan.
- `texto-final-turno.ts:30` (`TEXTO_SELECCION_LISTA`) y `:98`; `registro-herramientas.ts:409`.
- En `texto-final-turno.ts:101`, `seleccionConfirmada` desactiva el guard de «cambié…».
- El prompt se contradice: `prompt-sistema.ts:42`, `:66`, `:69`, `:78` y `:95-97` (la frase «ESCOGE TÚ MISMO 3–6 piezas… confirmar_seleccion_rag») chocan con `:103`.

**Código actual**
```ts
export const HERRAMIENTAS_RAG: Herramienta[] = [ {guardar_brief}, {buscar_catalogo_rag}, CONFIRMAR_SELECCION_RAG ];
```

**Cambio exacto**
1. `herramientas.ts`: borrar `CONFIRMAR_SELECCION_RAG` y `SELECCION_PROPIEDADES`, y sacarla de `HERRAMIENTAS_RAG`.
2. `registro-herramientas.ts`: borrar el handler `confirmar_seleccion_rag` (`:1674-…`). En `textoAlAgotarVueltas` quitar la rama `seleccionFinalIA`. Quitar `"confirmar_seleccion_rag"` del comentario de `HERRAMIENTAS_SOLO_LECTURA`. **Mantener** el campo `seleccionFinalIA` del estado hasta el paso 5 (lo leen `empaquetar` y el contrato `fin`), pero sin escritor.
3. `texto-final-turno.ts`: borrar `TEXTO_SELECCION_LISTA` y `seleccionConfirmada` de `EstadoTextoFinal`:
   ```diff
   -  if (!estado.planConfirmado && !estado.seleccionConfirmada && afirmaCambioAplicado(limpio)) {
   +  if (!estado.planConfirmado && afirmaCambioAplicado(limpio)) {
   ```
   Y en `ejecutar.ts:121` dejar solo `{ planConfirmado }`.
4. Prompt (`prompt-sistema.ts`):
   - `:42`: borrar la línea.
   - `:43`: «confirmar_plan_decoracion: es la única forma de proponer una decoración; el backend calcula tamaños, paquetes, precios y cobertura.»
   - `:66`: «- No conoces otra forma de proponer que confirmar_plan_decoracion; después espera a que el cliente toque «Aprobar y ver cómo queda».»
   - `:69`: «…confirmar_plan_decoracion rechaza en el backend cualquier product_id/variant_id que no venga de ahí…»
   - `:78`: «Nunca menciones ni calcules un precio de memoria: los precios salen de la respuesta de confirmar_plan_decoracion.»
   - `:95`: «- Además de mostrar tarjetas, TÚ armas la propuesta completa: en cuanto tengas tipo de evento + un dato más (estilo, colores u ocasión), busca opciones y diseña el plan con confirmar_plan_decoracion usando solo productos de las búsquedas de ESTE turno.»
   - `:97`: «- Termina siempre con confirmar_plan_decoracion y espera a que el cliente toque «Aprobar y ver cómo queda».»
   - `:103`: quitar «no llames confirmar_seleccion_rag.»
   - Quitar el condicional «En modo DISEÑO DE DECORACIÓN» de `:21-22` (es el único modo).
5. En otra entrega, retirar `seleccionIA` del evento `fin` (`chat/route.ts:404`, `contracts/chat-v1.ts`, `page.tsx:845-857`). Ese cambio toca el contrato `chat.sse.v1`, que es un campo opcional: bajar primero el consumidor y luego el productor.

**Pruebas**
- `scripts/test/test-jerga-herramientas.ts`: `herramientasActivas()` no contiene `confirmar_seleccion_rag`, y `construirSistema()` no contiene ese nombre.
- `scripts/test/test-catalog-allowlist.ts` y `test-rag-validation.ts` (`npm run rag:test-allowlist`, `rag:test-validation`): quitar o adaptar los casos que usan el handler.
- Nueva unidad en `src/lib/ia/omoikane/texto-final-turno.test.ts` (`tsx --test`, añadir script `ia:test-texto-final`): un turno sin plan con «cambié el azul» devuelve `TEXTO_CAMBIO_NO_APLICADO`.

**Hash, contratos y vectores:** ninguno en los pasos 1-4. El paso 5 cambia `chat.sse.v1` (requiere `npm run contracts:export` y `contracts:check`).
**Riesgos:** arneses de evaluación (`scripts/eval/eval-chat-thinking.ts`) que cuentan con la herramienta; revisar con `grep -rn confirmar_seleccion_rag scripts`.
**Revertir:** `git revert` del commit; no hay datos persistidos que migrar.
**Dependencias:** ninguna. Desbloquea C1 y C11.
**Esfuerzo:** M (por la cantidad de pruebas que tocan la herramienta).

---

### C3 · Fondos y paneles de la foto nunca llegan a la imagen

**Problema.** `backdrop`, `panel`, `curtain` y `drape` son «emulables»: no pueden entrar al plan aunque el cliente lo acepte, y `backdrop`/`panel` tampoco son escenografía. En la imagen, los globos aparecen delante de una pared lisa.

**Causa raíz (verificada):**
- `src/lib/rag/taxonomy/alcance-referencia.ts:46,52,58,64`: `curtain`, `drape`, `backdrop` y `panel` → `alcance: "emulable"`.
- `src/lib/plan/restricciones.ts:501`: rechazo incondicional.
- `src/lib/ia/referencia/reference-structure.ts:378,422`: la escenografía solo admite `curtain` y `drape`.
- `src/lib/plan/desglose.ts:99`: `emulable_pendiente` no tiene acción en la UI.
- Contradicción en el prompt: `prompt-sistema.ts:68` («haz una búsqueda enfocada de la reinterpretación con globos») contra `:123` («no lo asignes a una estructura en el primer plan»).

**Código actual**
```ts
// restricciones.ts:501
if (alcance.alcance === "fuera_de_catalogo" || alcance.alcance === "emulable") {
  invalidos.add(elementId);
  continue;
}
```

**Cambio exacto: emulación aceptada por el cliente con evidencia que no viene del modelo**
1. `restricciones.ts`: el validador recibe `emulacionesAceptadas: ReadonlySet<string>`.
   ```diff
   -    if (alcance.alcance === "fuera_de_catalogo" || alcance.alcance === "emulable") {
   +    if (alcance.alcance === "fuera_de_catalogo"
   +        || (alcance.alcance === "emulable" && !emulacionesAceptadas.has(elementId))) {
   ```
   Una estructura que materializa un emulable aceptado debe ser `tipo: "pared"` (estructura oficial de pared) y llevar globos. Esto se comprueba con `validarEstructurasDeGlobosConGlobos`, que ya existe.
2. La evidencia de aceptación **no** la escribe el modelo:
   - La tarjeta muestra, para cada `emulable_pendiente`, el botón «Incluir como pared de globos».
   - El clic añade `element_id` a `chat-v1.emulacionesAceptadas: string[]` (máximo 20, regex `^REF_\d{2}_E\d{2}$`), que viaja en el siguiente `/api/chat`.
   - La ruta valida el campo con Zod y comprueba que cada id exista en el `referenceBlueprint` del turno con `alcance === "emulable"`.
   - Pasa el set a `crearEstadoConversacion` y de ahí a `validarCoberturaReferencia`.
   - Alternativa sin botón: que lo detecte `extraerRestriccionesUsuario` en el texto del cliente («sí, incluye el fondo»). La recomiendo menos, por el mismo argumento de C1.
3. Prompt (`prompt-sistema.ts:123`), texto nuevo:
   ```
   - Respeta el alcance comercial de cada elemento: un elemento fuera_de_catalogo no dispara buscar_catalogo_rag ni una propuesta de emulación; decláralo con motivo_tipo "fuera_de_catalogo". Un elemento emulable (fondo, panel, cortina) va en referencia_omitida con motivo_tipo "emulacion_propuesta" y una propuesta concreta ("una pared de globos negra detrás de la mesa"), y en tu resumen ofrécele al cliente incluirla. Solo cuando EMULACIONES ACEPTADAS lo liste, materialízalo como una estructura tipo pared con su referencia_element_id.
   ```
   Y `construirSistema` añade el bloque `EMULACIONES ACEPTADAS: REF_01_E02, …` cuando el set no está vacío.
4. Mientras tanto, en la imagen: añadir `"backdrop"` y `"panel"` a `SCENERY_EXTRA_CATEGORIES` (`reference-structure.ts:422`). Así se conservan como escenografía no cotizada, igual que la cortina, y se pasan por `NON_RENDERABLE_TEXT` (un panel con letrero se descarta). No toca hash (AGENTS: «Scenery… never touches quoting, materials or `plan_hash`»).

**Pruebas**
- `scripts/test/test-plan-auditoria-referencia.ts` (en `plan:test`):
  - emulable sin aceptar → `COBERTURA_REFERENCIA_INCOMPLETA`;
  - emulable aceptado con `tipo:"pared"` → cubierto;
  - aceptado con `tipo:"arco"` → rechazado.
- `scripts/test/test-chat-contracts.ts` (`contracts:test`): `emulacionesAceptadas` admite ids válidos y rechaza un id con texto libre o más de 20.
- Test de `sceneryFromReference` (`npm run ia:test-prompts` o un `reference-structure.test.ts` nuevo): un `backdrop` aprobado y no materializado sale como escenografía; un `panel` con «sign» no.

**Hash, contratos y vectores:** cambia `chat-v1` (campo opcional nuevo; `contracts:export`). El plan resultante incluye una estructura más, así que su hash es distinto, como cualquier plan nuevo; ningún plan en vuelo cambia. Sin vectores dorados nuevos: no cambia el resolutor. El punto 4 no toca hash.
**Riesgos:** cotizar una pared grande puede pasarse del presupuesto (ya lo cubre `PRESUPUESTO_EXCEDIDO`). Una escenografía de `backdrop` en una foto de venue puede copiar un fondo ajeno; lo limitan `SCENERY_LIMIT` y el chip para apagarla.
**Revertir:** quitar el campo del contrato (opcional) y volver la condición a la original; quitar las dos categorías.
**Dependencias:** C8 (la escenografía debe salir del blueprint anclado).
**Esfuerzo:** M (punto 4: S).

---

### C4 · Un patrón pedido por chat («espiral blanco, negro y azul») se pierde

**Problema.** No hay ningún campo, ninguna acción ni ninguna extracción para el patrón. En producción, ni el motor ni `PATRONES_COLOR_V1` están encendidos.

**Causa raíz (verificada):**
- `herramientas.ts:113-145`: el esquema de estructura de `confirmar_plan_decoracion` no tiene `patron_color`.
- `herramientas.ts:419`: `ajustar` solo tiene `agregar|reemplazar|quitar|repartir|mezcla`.
- `resumen-plan-vigente.ts:300` lo prohíbe por chat.
- `feature-flags.ts:53` (`PATRONES_COLOR_V1` → false) y `:86` (`ARMADO_ARCO_COLUMNA_V1`, apagado en producción).
- `registro-herramientas.ts:1185`: `completarPatrones` depende de esa bandera.
- `.env.local` y `.env.production` no definen `PATRONES_COLOR_V1`.
- Ya existen: `PatronColorV1Schema` en la estructura (`src/lib/plan/tipos.ts:119`), `PistaPatronSchema` (`src/lib/plan/patron-color.ts:329`) y `pistas_patron` en `PlanResolutionRequestV1Schema` (`src/lib/ia/contracts/domain-v1.ts:542`). Del lado de Python, `patron_desde_pista` (`services/ai-api/app/patron_color.py:1658`, que exige `confianza ≥ 0,5` y pone `origen:"referencia"`) y `_plan_to_resolve` (`app/plan.py:3938-3943`).

**Decisión de diseño.** El modelo **no** escribe `PatronColorV1` completo: tiene rejillas, índices y `pintados`, y sus reglas cruzadas son de Python. El modelo declara una **intención**: `{modo, colores[]}`. Python la convierte con la misma tabla `material_de_color` que usa para la pista de la foto. Sigue la dirección de AGENTS.md: Zod → export → `generate_models.py` → vectores.

**Cambio exacto**

1. **Zod de dominio** (`src/lib/plan/patron-color.ts`, junto a `PistaPatronSchema`):
   ```ts
   /** Patrón que el CLIENTE pidió por chat para una estructura (no leído de una foto). */
   export const PedidoPatronSchema = z.object({
     estructura_id: z.string().trim().min(1).max(160),
     modo: z.enum(MODOS_PATRON_COLOR).exclude(["zonas"]),
     colores: z.array(z.string().trim().min(1).max(80)).min(2).max(8),
     trazo: z.enum(TRAZOS_ESPIRAL).optional(),        // espiral | zigzag | recto
     globos_por_racimo: z.number().int().min(1).max(8).optional(),
   }).strict();
   ```
   En `src/lib/ia/contracts/domain-v1.ts`, dentro de `PlanResolutionRequestV1Schema` (`:532-…`):
   ```ts
   /** Solo al confirmar o ajustar por chat: patrón pedido por el cliente; manda sobre la pista de la foto y el preset. */
   pedidos_patron: z.array(PedidoPatronSchema).max(16).optional(),
   ```
   Para `origen` se reutiliza `"decorador"` (una persona lo decidió) y **no** se añade un valor al enum `ORIGENES_PATRON_COLOR`. Un valor nuevo cambiaría `PatronColorV1` y obligaría a regenerar más contratos. Si se quiere distinguir al cliente del decorador, hacerlo en un ADR aparte.
2. **Exportación:** `npm run contracts:export:domain` (`scripts/ops/export-domain-contract-schemas.ts`), que regenera `contracts/domain/v1/plan-resolution-request*.schema.json`.
3. **Python, modelos generados:** `uv run --directory services/ai-api python scripts/generate_models.py`, que regenera `generated_models.py`; `--check` debe pasar en CI. Como `PistaPatron` de `app/plan.py:470-485` se mantiene a mano (SEGUIMIENTO §9), añadir también a mano `class PedidoPatron(ContractModel)` y `pedidos_patron: list[PedidoPatron] = Field(default_factory=list, max_length=16)` en `PlanResolutionRequest` (`app/plan.py:473-`).
4. **Python, lógica:**
   - En `app/patron_color.py`, crear `patron_desde_pedido(estructura, pedido)`, que reutiliza `_base_de_pista`, `material_de_color` y `_eje_y_simetria_de_pista`, no exige confianza y escribe `origen: "decorador"`. Devuelve `None` con motivo si un color no es material de la pieza o si el modo no vale para el tipo, y en ese caso **no cae al preset**: es un rechazo.
   - En `_complete_plan` (`app/plan.py`), aplicar `pedidos_patron` **antes** de las pistas y del preset, y **sin** depender de `completar_patrones`: un pedido explícito no se apaga con la bandera del preset.
   - Si un pedido es inválido, `PlanResolutionError("patron_pedido_invalido", 422, detalle=[{estructura_id, motivo}])`.
5. **Herramienta del modelo** (`herramientas.ts`, en `items.properties` de `estructuras`, `:113-145`):
   ```json
   "patron_pedido": {
     "type": "object",
     "required": ["modo", "colores"],
     "description": "SOLO si el cliente pidió cómo van los colores en ESTA pieza (\"en espiral\", \"por anillos\", \"degradado\", \"en bloques\"). colores son nombres de color de los materiales de la pieza, en el orden pedido. Sin pedido del cliente no lo mandes: el sistema decide.",
     "properties": {
       "modo": { "type": "string", "enum": ["espiral","anillos","bloques","degradado","aleatorio","flor","damero"] },
       "colores": { "type": "array", "minItems": 2, "maxItems": 8, "items": { "type": "string" } },
       "trazo": { "type": "string", "enum": ["espiral","zigzag","recto"] }
     }
   }
   ```
   En `confirmarPlan` (`registro-herramientas.ts:786-`), sacar `patron_pedido` de cada estructura **antes** de `PlanDecoracionSchema.safeParse`, porque la estructura del plan no lo admite. Convertirlo a `pedidos_patron: [{estructura_id, ...}]`, validar con `PedidoPatronSchema` y pasarlo a `resolverPlan` (`python-adapter.ts` → `pedidos_patron`).
6. **Evidencia que no viene del modelo:**
   - En `src/lib/plan/restricciones.ts`, añadir a `extraerRestriccionesUsuario` un campo `patrones: Array<{modo, texto_original}>` con una regex sobre el texto del cliente: `/\b(espiral|zig\s?zag|anillos?|franjas|bloques|degradad[oa]|ombr[eé]|damero|confeti)\b/i`.
   - Si el modelo manda `patron_pedido` sin restricción equivalente en el texto del cliente, el pedido **se descarta** con aviso (`PLAN_PATRON_SIN_PEDIDO` en `plan_audit_log`).
   - Si el cliente pidió un patrón y ninguna estructura lo lleva, rechazar con `PATRON_PEDIDO_OMITIDO` y `accion_requerida`, igual que los colores. Así el «espiral» no se pierde en silencio.
7. **Ajustar por chat:**
   - En `PROPIEDADES_EDICION_PLAN` (`herramientas.ts:416-451`), añadir la acción `"patron"` con `modo`, `colores` y `trazo`.
   - En `src/lib/plan/edicion-chat.ts:41-50`, añadir una rama que construye `EdicionPatronSchema` (`edicion-esquemas.ts:112`). En lugar de `patron_color` completo, envía la nueva variante `{accion:"patron_pedido", estructura_id, pedido}`, que Python expande en `app/plan_edicion.py` con `patron_desde_pedido`. Es un esquema de edición nuevo: añadirlo a `EdicionSchema` y al contrato de `plan-editar`.
   - En `resumen-plan-vigente.ts:300`, cambiar a: «El patrón de color sí se cambia por aquí con accion "patron" (modo y colores en palabras del catálogo); el armado de arcos, columnas y guirnaldas se cambia desde la propuesta en pantalla.»
8. **Prompt** (`BLOQUE_PLAN`), línea nueva:
   ```
   - PATRÓN PEDIDO: si el cliente dice cómo van los colores en una pieza ("columna en espiral blanco, negro y azul", "arco por bloques"), pon patron_pedido en ESA estructura con el modo y los colores en el orden que dijo, y asegúrate de que esos colores estén en sus materiales. No lo inventes si no lo pidió.
   ```

**Pruebas**
- Python: `services/ai-api/tests/test_patron_color.py` con `patron_desde_pedido`: espiral de 3 colores en columna → base con `k=3`; color ausente → `None` con motivo; `zonas` → rechazo.
- Python: `tests/test_plan_resolution*.py`: `pedidos_patron` manda sobre `pistas_patron` y sobre el preset, también con `completar_patrones=False`.
- **Vector dorado nuevo** `contracts/domain/v1/golden/plan-resolution/33-patron-pedido-espiral.json`, con `expected` escrito **a mano** (oráculo congelado) y `expected_python` regenerado con `REGRESION_ACTUALIZAR=1 pytest tests/test_plan_regresion.py`. El commit explica por qué.
- TS: `scripts/test/test-domain-contracts.ts` (`contracts:test:domain`) acepta y rechaza `PedidoPatronSchema`; `contracts:check` sin deriva.
- TS: `scripts/test/test-ajustar-plan-chat.ts` (`plan:test-ajustar-plan-chat`):
  - «hazla en espiral» → acción `patron`;
  - el caso actual «la herramienta… sin ofrecer patrón» pasa a afirmar lo contrario. Es un cambio deliberado: el commit lo dice.
- TS: `scripts/test/test-patron-color-prompt.ts` (`ia:test-patron-color-prompt`): un plan con `origen:"decorador"` llega a la frase del prompt de imagen.
- Integración sin LLM (patrón del scratchpad de SEGUIMIENTO §0): confirmar con `pedidos_patron` → plan con `patron_color` → re-resolución en `/api/generate` sin `pedidos_patron` → **mismo** `plan_hash`.

**Hash, contratos y vectores**
- `patron_color` queda escrito en `estructuras`, así que el hash de los planes **nuevos** con pedido incluye el patrón. Es esperado: el patrón cambia la compra. Los planes en vuelo no cambian, porque la re-resolución no recibe `pedidos_patron`.
- Contrato `plan-resolution.v1`: campo opcional nuevo, compatible hacia atrás. Desplegar `ai-api` **antes** que la app: un campo añadido solo en TS lo rechaza `additionalProperties:false` en el Python viejo (AGENTS.md).
- Vector 33 nuevo; los 1-32 no deben moverse.

**Riesgos:** el LoRA casi no vio patrones en su entrenamiento (SEGUIMIENTO §0, «Pendiente 1»), así que la imagen puede no seguir la espiral; medirlo con una corrida de evaluación con tope de gasto antes de prometerlo en el texto. Hay que desplegar los dos lados juntos.
**Revertir:** el campo es opcional. Dejar de enviarlo desde TS (bandera `PATRON_PEDIDO_CHAT_V1`, por defecto OFF hasta medir) es la vuelta atrás inmediata; los planes ya aprobados conservan su `patron_color`, que sigue siendo válido.
**Dependencias:** C5 (encender `PATRONES_COLOR_V1` de forma coherente) y C7 (las reglas de edición).
**Esfuerzo:** L.

---

### C5 · Local y producción generan imágenes distintas por las banderas; hay lecturas que se pagan y nadie usa

**Problema.** Lo que se prueba en local no es lo que corre en producción, y hay variables de entorno muertas.

**Causa raíz (verificada):**
- `src/lib/ia/nucleo/feature-flags.ts:86,97,123`: `ARMADO_ARCO_COLUMNA_V1`, `ESTIMAR_CONTEO_V1` y `ANALISIS_COLOR_SEMPERTEX_V1` dependen de `NODE_ENV`.
- `:53,59,66,104`: `PATRONES_COLOR_V1`, `BOUQUETS_ARMADO_V1`, `GUIRNALDAS_ARMADO_V1` y `CONTEO_REFERENCIA_V1` → false.
- `.env.local` tiene `LECTURA_UNICA_REFERENCIA_ENABLED`, `PATRON_REFERENCIA_PYTHON_ENABLED` y `MEASURED_COLOR_DOMINANCE_V1`, que no están en `.env.production`.
- Con el motor encendido, `registro-herramientas.ts:1236` pasa `pistasPatronDelPlan` a `conArmadosDeMotor` sin `PATRONES_COLOR_V1`: en local el patrón de la foto llega por ahí.
- `prompt-sistema.ts:177` (`armadoLeido`) no depende de `BOUQUETS_ARMADO_V1`.
- Variables en `.env*` que el código no lee: `PLAN_DECORACION_ENABLED`, `PYTHON_BACKEND_ENABLED`, `PYTHON_BACKEND_KILL_SWITCH`, `RAG_FRANJAS_ENABLED`. `grep` en `src` y `services/ai-api/app` solo encuentra una mención en un comentario, `operational-v1.ts:176`.

**Código actual**
```ts
if (name === "ARMADO_ARCO_COLUMNA_V1") return process.env.NODE_ENV !== "production";
```

**Cambio exacto**
1. Quitar la dependencia de `NODE_ENV` en las tres banderas: el valor por defecto es `false` en todas partes, y local las enciende **explícitamente** en `.env.local`. Así la diferencia queda escrita en un archivo, no implícita en el entorno.
   ```diff
   -    if (name === "ARMADO_ARCO_COLUMNA_V1") return process.env.NODE_ENV !== "production";
   +    if (name === "ARMADO_ARCO_COLUMNA_V1") return false;
   ```
   Lo mismo en `:97` y `:123`.
2. Paridad de lecturas: si una lectura está encendida, su consumidor también. Añadir `assertCoherenciaBanderas()`, que se ejecuta al cargar la ruta `/api/chat` y en `scripts/ops`, y registra un `console.warn` una vez por proceso:
   - `LECTURA_UNICA_REFERENCIA_ENABLED || PATRON_REFERENCIA_PYTHON_ENABLED` sin `PATRONES_COLOR_V1 || ARMADO_ARCO_COLUMNA_V1`;
   - `BOUQUET_REFERENCIA_PYTHON_ENABLED` sin `BOUQUETS_ARMADO_V1`;
   - `CONTEO_REFERENCIA_PYTHON_ENABLED` sin `CONTEO_REFERENCIA_V1`;
   - `GUIRNALDA_REFERENCIA_PYTHON_ENABLED` sin `GUIRNALDAS_ARMADO_V1`.

   Con `LECTURA_UNICA_REFERENCIA_ENABLED`, pedir solo las lecturas cuyo consumidor está encendido. Requiere un parámetro en `app/lecturas_foto.py` y en el prompt v17; como cambia el `config_hash`, va en un ADR aparte.
3. `prompt-sistema.ts:177-207`: `armadoLeido` devuelve `""` si `!featureEnabled("BOUQUETS_ARMADO_V1")`. Validar `NUMEROS_REFERENCIA_OMITIDOS` (`numeros-pedidos.ts:91`) solo con la misma bandera. Así no se exige la cantidad de la foto cuando Python no va a armar el bouquet.
4. Borrar de `.env.example`, de la documentación de despliegue (`.github/workflows/deploy.yml` si las inyecta) y avisar al dueño de `.env.local`/`.env.production`: `PLAN_DECORACION_ENABLED`, `PYTHON_BACKEND_ENABLED`, `PYTHON_BACKEND_KILL_SWITCH`, `RAG_FRANJAS_ENABLED`. **No** edito `.env*` en este plan; lo hace el operador.
5. Decidir, con medición previa, el conjunto de banderas de producción y copiar el **mismo** conjunto a `.env.local`. La regla queda escrita en AGENTS.md: «local = producción + lo que se está probando, declarado en `.env.local`».

**Pruebas**
- `scripts/test/test-feature-flags.ts`, nuevo y enganchado a `plan:test`: con `NODE_ENV=development` y la variable sin definir, `ARMADO_ARCO_COLUMNA_V1`, `ESTIMAR_CONTEO_V1` y `ANALISIS_COLOR_SEMPERTEX_V1` valen `false`; `assertCoherenciaBanderas` avisa en cada combinación incoherente.
- `scripts/test/test-armado-estructura-ia.ts` (`plan:test-armado-estructura-ia`) y `test-estimar-conteo-globos.ts`: fijar las banderas explícitamente con `process.env` dentro del test (hoy dependen del `NODE_ENV` del runner).
- `scripts/test/test-plan-auditoria-referencia.ts`: con `BOUQUETS_ARMADO_V1=false`, ni `armadoLeido` ni el rechazo `NUMEROS_REFERENCIA_OMITIDOS`.

**Hash, contratos y vectores:** el paso 1 cambia qué llevan los planes **en local** (sin armado de motor si no se declara), así que en local cambia su hash; en producción, nada. Sin cambios de contrato.
**Riesgos:** quien desarrolla en local pierde el motor hasta poner `ARMADO_ARCO_COLUMNA_V1=true` en su `.env.local`. Comunicarlo en el commit.
**Revertir:** volver las tres líneas a `NODE_ENV`.
**Dependencias:** C4 (encender `PATRONES_COLOR_V1` por el camino correcto).
**Esfuerzo:** S (pasos 1, 3 y 4); M si se incluye el paso 2 en Python.

---

### C6 · La generación recibe solo el último mensaje como «solicitud del cliente»

**Problema.** Tras «sí» o «cambia el azul por rojo», el contexto visual (evento, lugar, luz) sale de esa frase y no de la petición original.

**Causa raíz (verificada):**
- `src/app/page.tsx:968`: `solicitudUsuarioRef.current = limpio;`
- `page.tsx:1568` (`aprobarPlan`) y `:1718` (`aplicarAjusteSobrePropuesta`) la envían.
- `src/lib/ia/escena/visual-context.ts:151,158` construyen el contexto con `userRequest`.
- `prompt-sistema.ts:40-44` no nombra `guardar_brief`, que es la otra fuente de esos datos (`herramientas.ts:45`).

**Código actual**
```ts
solicitudUsuarioRef.current = limpio;
```

**Cambio exacto: que el servidor sea el dueño de ese texto**
1. `PlanResuelto` ya tiene `original_request` como campo de primer nivel (`src/lib/plan/resuelto.ts:131`, contrato `domain-v1.ts:381`). Lo llena `enriquecerPlanResueltoEvento` en el chat (`registro-herramientas.ts:317`, con `parseEventIntent(estado.solicitudOriginal)`). Está **fuera** del hash, y la re-resolución de `/api/generate` (`:612`) no lo repone, así que hay que leerlo de `body.plan`. Es dato del navegador, pero solo ambienta la escena: no toca compra ni precio. En `src/app/api/generate/route.ts`, en la llamada a `completarEscenaConPlan` (`:879`) y en la de `visualContext`:
   ```diff
   - userRequest: body.solicitudUsuario,
   + userRequest: solicitudDelPlan(body.plan) ?? body.solicitudUsuario,
   ```
   `solicitudDelPlan` valida `body.plan.original_request` con `z.string().trim().min(1).max(2000)` y lo pasa por el mismo saneado de texto observado. Si no viene, cae a `body.solicitudUsuario`.
2. Alternativa solo de cliente, menos robusta: `solicitudUsuarioRef.current = mensajes.filter(m => m.role === "user").map(m => m.content).join(" ").slice(-2000)`.
3. Prompt: añadir a `HERRAMIENTAS` (`prompt-sistema.ts:40-44`):
   ```
   - guardar_brief: llámala en cuanto el cliente diga tipo de evento, espacio, momento del día, colores, estilo, fecha, invitados o presupuesto; esos datos ambientan la imagen.
   ```

**Pruebas**
- `scripts/test/test-visual-prompts.ts` (`npm run ia:test-prompts`): con `solicitudUsuario:"sí"` y un plan con `original_request:"boda en jardín de noche"`, el `visualContext` tiene `lightingKind:"night"` y lugar «jardín».
- Test de contrato (`contracts:test:domain`): `original_request` sigue siendo opcional y aparte de `estructuras`/`compras`.

**Hash, contratos y vectores:** ninguno. `original_request` ya existe en `PlanResuelto` (`resuelto.ts:131`) y está fuera del snapshot.
**Riesgos:** un `original_request` largo o manipulado por el navegador solo altera el ambiente de la escena. Se acota a 2 000 caracteres y se sanea.
**Revertir:** la línea del diff.
**Dependencias:** C9 (lo que se pierde al recortar el historial también afecta a `original_request`).
**Esfuerzo:** S.

---

### C7 · Reglas opuestas para editar la propuesta vigente, y la imagen vieja queda sin aviso

**Problema.** El prompt base manda reconfirmar desde cero (`confirmar`) y el bloque de la propuesta vigente manda `ajustar`. Además, una edición hecha por chat no marca la imagen como desactualizada.

**Causa raíz (verificada):**
- `prompt-sistema.ts:131` («arma el plan nuevo sin eso y confírmalo») contra `resumen-plan-vigente.ts:294` («usa ajustar_plan_decoracion. No llames confirmar_plan_decoracion…»).
- `page.tsx:882` solo hace `setPlanAprobadoHash(null)`; el modal, en `:1588`, además llama `setVisualDesactualizada(...)`.

**Cambio exacto**
1. `prompt-sistema.ts:131`, texto nuevo:
   ```
   - CAMBIOS DEL CLIENTE: lo último que pide manda sobre lo anterior. Si hay PROPUESTA VIGENTE EN PANTALLA, aplica el cambio con ajustar_plan_decoracion como indican sus reglas; solo sin propuesta vigente, o si pide un diseño distinto desde cero, arma el plan nuevo y confírmalo con confirmar_plan_decoracion. Nunca digas que cambiaste, actualizaste, quitaste o agregaste algo ("cambié", "actualicé", "ya quedó") si en este turno la herramienta no devolvió ok:true con ese cambio: di que todavía no pudiste aplicarlo y por qué.
   ```
2. `page.tsx/finalizarUltimoMensaje` (`:836-882`):
   ```diff
   -    if (datos.plan) setPlanAprobadoHash(null);
   +    if (datos.plan) {
   +      if (planAprobadoHash && imagenes.length > 0 && datos.plan.plan_hash !== planAprobadoHash) {
   +        setVisualDesactualizada({ mensajeId: idUltimoAsistente, planHash: planAprobadoHash });
   +      }
   +      setPlanAprobadoHash(null);
   +    }
   ```
   `idUltimoAsistente` es el id de la burbuja que se completa (`copia[copia.length - 1].id`).
3. Opcional, red de seguridad en el servidor: con `estado.planVigente` presente y una primera llamada a `confirmar_plan_decoracion` en el turno, devolver una sola vez `{ok:false, status:"USA_AJUSTAR", accion_requerida:"Hay propuesta vigente: usa ajustar_plan_decoracion salvo que el cliente pida un diseño nuevo desde cero; si es así, vuelve a llamar confirmar_plan_decoracion."}`. Contaría como rechazo en `rechazosPlan`; medirlo.

**Pruebas**
- `scripts/test/test-ajustar-plan-chat.ts`: `sistemaConPropuestaVigente(construirSistema(...), plan)` no contiene «arma el plan nuevo sin eso y confírmalo» sin el condicional.
- Test de UI (existe `test-armazon-ui.ts`): con un plan aprobado y una imagen, un `fin` con un plan distinto deja `visualDesactualizada`.

**Hash, contratos y vectores:** ninguno.
**Riesgos:** el punto 3 puede gastar una vuelta del modelo.
**Revertir:** textos y la rama de UI.
**Dependencias:** C1 y C4 (paso 7).
**Esfuerzo:** S.

---

### C8 · La generación ancla las fotos al mensaje, pero no el análisis ni el aspecto

**Problema.** Si el cliente cambió de foto después de la propuesta, la escenografía y el lienzo salen de la foto nueva, aplicados a un plan de la foto vieja.

**Causa raíz (verificada):**
- `page.tsx:1327-1328`: `aspecto: fotoEspacioRef.current?.aspecto ?? …` y `blueprint: referenceDraftRef.current?.blueprint ?? …`. Las fotos, en cambio, se anclan con `adjuntosAnclados` (`:1192-1204`).
- `generate/route.ts:718` usa `body.blueprint` para la escenografía y lo cruza con `materializedReferenceIds`. Los ids `REF_01_E0x` coinciden entre fotos distintas.
- El mensaje del asistente ya guarda `referenceBlueprint` (`page.tsx:868`).

**Cambio exacto**
```diff
--- src/app/page.tsx (generar)
+    const mensajeAncla = override.anchorMessageId ? mensajes.find((m) => m.id === override.anchorMessageId) : undefined;
+    const blueprintAnclado = mensajeAncla?.referenceBlueprint ?? (override.anchorMessageId ? undefined : referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint);
…
-            aspecto: fotoEspacioRef.current?.aspecto ?? aspectoActivoRef.current,
-            blueprint: referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint,
+            aspecto: (adjuntosAnclados ? adjuntosAnclados.fotoEspacio?.aspecto : fotoEspacioRef.current?.aspecto) ?? aspectoActivoRef.current,
+            blueprint: blueprintAnclado,
```
Servidor, como defensa: en `/api/generate`, descartar la escenografía si un `referencia_element_id` del plan no existe en `body.blueprint` o si su categoría difiere. Eso indica un blueprint de otra foto, y se registra `ESCENOGRAFIA_BLUEPRINT_AJENO`.

Requisito: que `adjuntos.fotoEspacio` guarde `aspecto`. Revisar `adjuntosDelTurno`; si no lo guarda, añadirlo.

**Pruebas**
- Unidad sobre la función pura extraída (`elegirBlueprintGeneracion(mensajes, override, actual)`), en `src/lib/estado/*.test.ts`: con un ancla devuelve el blueprint del mensaje, aunque el borrador actual sea otro.
- `generate`: `scripts/test/test-generation-resolver.ts` (`rag:test-generation-resolver`) con un blueprint ajeno → escenografía vacía y aviso.

**Hash, contratos y vectores:** ninguno (la escenografía no toca el hash).
**Riesgos:** las propuestas restauradas tras recargar sin `referenceBlueprint` se quedan sin escenografía, que es lo correcto: no hay forma de saber a qué foto pertenecía.
**Revertir:** las dos líneas.
**Dependencias:** C3 (paso 4).
**Esfuerzo:** S.

---

### C9 · (Probable) El recorte del historial pierde restricciones antiguas

**Problema.** En conversaciones largas, colores, números («mis 40») y medidas dichos al principio se pierden de `solicitudOriginal` y de las restricciones.

**Causa raíz (verificada):**
- `src/lib/ia/omoikane/historial-chat.ts:22`: unos 4 000 tokens estimados (16 000 caracteres).
- `src/app/api/chat/route.ts:279` aplica `limitarHistorialChat` **antes** de construir el estado.
- `src/lib/ia/omoikane/ejecutar.ts:92` arma `mensajesCliente` con el historial ya recortado.

**Cambio exacto**
- Separar el historial que va **al modelo**, que se sigue recortando, del texto del cliente que va **a las restricciones**: todos los mensajes `user`, con un tope propio de 8 000 caracteres desde el final y un tope de 40 mensajes.
- En `chat/route.ts`, pasar `mensajesClienteCompletos = (messages ?? []).filter(m => m.role === "user").map(m => m.content)` a `ejecutarConversacionStream` en un parámetro nuevo, `textoCliente`.
- `estadoDelTurno` lo usa en lugar de derivarlo de `historial`. `referenciaSinGlobosYaPreguntada` sigue con el historial recortado.

**Pruebas:** en `scripts/test/test-restricciones-conversacion*.ts` (buscarlo con `grep -l extraerRestriccionesUsuario scripts/test`), un historial de 30 turnos con «mis 40 años en dorado» al inicio conserva `numerosPedidos=["40"]` y el color dorado.
**Hash, contratos y vectores:** ninguno, salvo que cambien las restricciones de planes nuevos (más fieles); `restricciones` sí entra en el plan, así que su hash cambia, como corresponde.
**Riesgos:** recuperar un color que el cliente ya retiró; lo cubre `coloresRetiradosCliente`, que se calcula sobre el mismo texto completo y por orden.
**Revertir:** quitar el parámetro.
**Dependencias:** C6.
**Esfuerzo:** S-M.

---

### C10 · El prompt del chat todavía ofrece la taxonomía retirada

**Problema.** El modelo puede elegir `semiarco` simple, `arco_no_denso`, `columna_no_densa`, `pared_densa` o `pared_no_densa`. Son clases retiradas, y sus sustantivos para el LoRA («airy…», «…installation») no aparecen en su corpus.

**Causa raíz (verificada):**
- `src/lib/plan/estructuras-oficiales.ts:50-57` (`ESTRUCTURAS_OFICIALES_IDS`, 17 ids) y `:126,127,131,132,133` (entradas retiradas).
- El comentario de `:21-30` admite que «airy» e «installation» aparecen 0 veces en el corpus.
- `GUIA_ESTRUCTURAS_OFICIALES` entra en el prompt (`prompt-sistema.ts:384`) y en el `enum` de `herramientas.ts:144`.
- AGENTS.md, «Standing decisions»: 12 clases; sin variantes densa/no densa y sin semiarco simple.

**Orden obligatorio (regla del proyecto: el clasificador es la fuente de verdad):**
1. **Primero en `C:\New folder\clasificador-decoraciones`.** Localizar ahí la lista canónica de las 12 clases y sus nombres. En esta auditoría no la encontré con una búsqueda rápida (`src` y `AGENTS.md` no nombran `semiarco`), así que el paso 0 es pedirle la ubicación a su dueño. Cualquier criterio de armado que cambie se cambia allá primero.
2. Portar a `pictures` la tabla resultante: `ESTRUCTURAS_OFICIALES_IDS` = las 12 clases del clasificador, cada una con su `estructura_oficial` equivalente.

**Cambio exacto en `pictures` (después del paso 1)**
- `estructuras-oficiales.ts`: quitar `arco_no_denso`, `columna_no_densa`, `pared_densa`, `pared_no_densa` y `semiarco`. Introducir `pared` (con las densidades `sencilla|media|lujosa` admitidas) si el clasificador lo llama así.
- `identificarEstructuraOficial` (`:200-230`): `semiarco` → siempre `semiarco_asimetrico` (todo medio arco es orgánico); `arco` sin forma asimétrica → `arco`; pared → `pared` o `pared_organica`.
- **Compatibilidad de lectura:** los planes en vuelo con ids retirados siguen validando durante 24 h (TTL del token). Añadir `ESTRUCTURAS_OFICIALES_LEGADO` aceptado por `PlanDecoracionSchema` **solo en lectura** (re-resolución en `/api/generate` y `/api/plan-editar`), no en `herramientas.ts`.
- La tabla de coherencia (`reglasJsonSchemaEstructuraOficial`, `:301-`) se exporta al contrato. Regenerar con `npm run contracts:export:domain` y `generate_models.py`.

**Pruebas**
- `scripts/test/test-estructuras-oficiales.ts` (en `plan:test`): exactamente las clases del clasificador; `identificarEstructuraOficial({tipo:"semiarco", …simétrico})` → `semiarco_asimetrico`.
- `scripts/test/test-lora-caption-compiler.ts` (`ia:test-lora-compiler`): ningún sustantivo emitido contiene «airy» ni «installation».
- Vectores dorados: los que usen ids retirados tienen `expected` congelado. **No** regenerarlos a ciegas: revisar cada uno a mano y explicarlo en el commit.

**Hash, contratos y vectores:** cambia `estructura_oficial` dentro de `estructuras`, así que el hash de los planes nuevos con esas piezas cambia. Cambia el contrato `plan-decoracion.v1` (enum): versionarlo o mantener el legado en lectura. Puede tocar vectores que usen esos ids.
**Riesgos:** la imagen de la pared «densa» cambia de sustantivo. Medirlo con una corrida de evaluación con tope de gasto, porque el propio comentario de `:36-41` dice que cambiar sustantivos sin una imagen que lo justifique es adivinar.
**Revertir:** restaurar la tabla; el legado en lectura evita romper planes.
**Dependencias:** depende del repo clasificador. Es independiente del resto.
**Esfuerzo:** M-L.

---

### C11 · El prompt nombra un botón que no existe y empuja a reescribir `mensaje_cliente`

**Problema.** El prompt menciona un botón «Regenerar imagen» que no existe. Además, la instrucción «con tus palabras» invita al modelo a reformular textos del servidor y añadir promesas (SEGUIMIENTO §3 B.2, abierto).

**Causa raíz (verificada):** `prompt-sistema.ts:98` («…requieren que pulse "Regenerar imagen"»), `:57` y `:134` («usando su "mensaje_cliente" con tus palabras»). En la UI el control es «Regenerar visual» (`TarjetaPlanDecoracion.tsx:522`).

**Cambio exacto**
- `:98`: «- Si el cliente cambia la propuesta después de ver la imagen, la tarjeta le muestra «Regenerar visual» para crear la imagen nueva; tú no la generas.»
- `:57`: «…Cuando una herramienta devuelve "mensaje_cliente", dilo tal cual o casi tal cual: no le agregues promesas, plazos ni acciones que la herramienta no dijo ("en un momento", "ya lo estoy buscando").»
- `:134`: sustituir «usando su "mensaje_cliente" con tus palabras» por «usando su "mensaje_cliente" sin agregarle promesas».
- Determinista: en `texto-final-turno.ts`, si el turno termina sin plan y el texto contiene `PROMESA_DE_SEGUIR` (`:77`), aplicar `sinPromesaDeSeguir` también al **texto del modelo**, no solo al respaldo.

**Pruebas:** en `texto-final-turno.test.ts` (nuevo, de C2), un turno sin plan con «Estoy buscando una alternativa, en un momento te la muestro» pierde esa frase. `test-jerga-herramientas.ts`: el prompt no contiene «Regenerar imagen».
**Hash, contratos y vectores:** ninguno.
**Riesgos:** quitar frases del modelo puede dejar un texto vacío; en ese caso se cae al respaldo, que ya existe.
**Revertir:** textos y la regla.
**Dependencias:** C2 (el mismo archivo de prueba).
**Esfuerzo:** S.

---

### Resumen de impacto

| ID | Hash | Contrato | Vectores dorados | Despliegue |
|---|---|---|---|---|
| C1 | — | — | — | app |
| C2 | — | `chat.sse.v1` (paso 5, opcional) | — | app |
| C3 | solo planes nuevos con pared | `chat-v1` (+`emulacionesAceptadas`) | — | app |
| C4 | planes nuevos con patrón | `plan-resolution.v1` (+`pedidos_patron`), edición `plan-editar` | +33 | **ai-api primero**, luego app |
| C5 | en local, planes nuevos | — | — | app (+ADR si se toca la lectura única) |
| C6 | — | — (verificar `original_request`) | — | app |
| C7 | — | — | — | app |
| C8 | — | — | — | app |
| C9 | `restricciones` de planes nuevos | — | — | app |
| C10 | planes nuevos | `plan-decoracion.v1` (enum) | revisión manual | clasificador → ai-api + app |
| C11 | — | — | — | app |


---

## Parte IV · Plan de corrección · lectura de la foto y motores de estructura (M1–M11)

Alcance: lo que se lee de la foto de referencia (`services/ai-api/app/amaterasu/*`, `lecturas_foto.py`,
`patron_de_la_foto.py`, `src/lib/ia/amaterasu/*`, `src/app/api/references`) y si lo que arman los motores
(`app/{arco,columna,organico,columnaorg,guirnalda,bouquet}/`, `armado_*.py`, `plan_armado_*.py`, `plan.py`)
llega al plan, al croquis y al prompt de imagen.

**Árbol re-verificado el 2026-10-04 justo antes de escribir esto.** Alguien está editando el árbol y hay
dos cambios desde la auditoría:

- **El semiarco ya está cableado.** `TIPOS_CON_MOTOR` incluye `"semiarco"` (`armado_estructura.py:142`),
  `_receta` lo manda siempre al arco orgánico con `medio=True` (`:1309-1314`), `_TIPO_DE_CLASE` es una tupla
  `("arco", "semiarco")` (`plan.py:1861-1864`) y `TIPOS_ARMADO_MOTOR` también lo incluye
  (`src/lib/plan/armado-estructura-ia.ts:41`). Por eso M5 queda reducido a la clase oficial, el aro y el
  techo.
- **Corrección al informe (M6.b).** El campo `inclinacion` de los contratos clásicos
  (`armado-arco.ts:123`, `armado-columna.ts:185`) es la **pendiente de las franjas del patrón**, no el
  vuelo de la pieza. El motor clásico no sabe inclinar una pieza: no falta cablearlo, falta la capacidad.

Convenciones del documento:

- **plan_hash.** Todo lo que se escriba dentro de `estructuras` (los campos `armado_*`) entra en el
  `plan_hash` **de los planes nuevos**. Lo derivado (`armados_*` resueltos, frases de imagen) va fuera del
  snapshot y no lo toca.
- **Vectores de oro.** El `expected` de `contracts/domain/v1/golden/plan-resolution/*.json` es un oráculo
  congelado que **se edita a mano**, con el motivo en el commit. `expected_python` se regenera con
  `REGRESION_ACTUALIZAR=1`.
- **Ruta del clasificador.** Si un ítem cambia un **criterio de armado** (cómo coloca o elige el motor), el
  cambio se hace primero en `C:\New folder\clasificador-decoraciones`, allí se regeneran sus vectores
  (`contracts/domain/v1/golden/{arco,columna,columnaorg,guirnalda,organico,bouquet}`) y después se porta.
  En cada ítem se dice si hace falta.
- **Comandos de verificación** (los de AGENTS.md):
  `uv run --directory services/ai-api pytest -q`,
  `uv run --directory services/ai-api ruff check app tests && mypy app`,
  `npx tsc --noEmit && npm run -s lint && npm run plan:test`,
  `npm run contracts:check`.
- **Ruido preexistente.** 4 fallos de 1 ulp en `tests/test_columnaorg.py`; no son de este plan.

---

### Matriz de banderas (M1 y M2)

#### Estado actual

Leído de `src/lib/ia/nucleo/feature-flags.ts` y de los `.env`; de estos solo se miraron nombres y
booleanos. «dev» es `.env.local`. «prod» es `.env.production` del árbol; el entorno real del EC2 no se pudo
ver.

| Bandera | Dueño de la regla | Por defecto en código (línea) | dev | prod | Qué gobierna | Depende de |
|---|---|---|---|---|---|---|
| `LECTURA_UNICA_REFERENCIA_ENABLED` | TS (prompt v17) + Py (`lecturas_foto.py`, valida) | off (`:270`) | **on** | off | Una sola llamada de visión, variante `v17-lectura-unica`, con las 4 lecturas. Encendida, **las cuatro `*_REFERENCIA_PYTHON_ENABLED` no se leen** (`analyze/route.ts:50,64-73`) | Sus lecturas solo sirven si están encendidas las banderas que las consumen (ver abajo) |
| `PATRON_REFERENCIA_PYTHON_ENABLED` | Py (`amaterasu/patron_referencia.py`) | off (`:203`) | on (sin efecto mientras esté la lectura única) | off | Lectura v16 de patrón, remate, tamaños, dirección y simetría | — |
| `BOUQUET_REFERENCIA_PYTHON_ENABLED` | Py | off (`:225`) | — | off | Lectura v16 del armado del bouquet | — |
| `CONTEO_REFERENCIA_PYTHON_ENABLED` | Py | off (`:236`) | — | off | Lectura v16 del conteo | — |
| `GUIRNALDA_REFERENCIA_PYTHON_ENABLED` | Py | off (`:249`) | — | off | Lectura v16 del armado de guirnalda y su reubicación | — |
| `REFERENCE_ANALYSIS_PYTHON_ENABLED` | transporte | off (`:181`) | — | — | Solo por dónde pasa la llamada | — |
| `MEASURED_COLOR_DOMINANCE_V1` | TS (`analizar-referencias-v2.ts:733`) | off (`:35`) | on | off | Reordena la paleta por píxeles medidos. **Cambia qué colores compra un plan** | — |
| `ANALISIS_COLOR_SEMPERTEX_V1` | TS | on fuera de prod (`:123`) | on | off | Solo diagnóstico, fuera del blueprint | — |
| `ARMADO_ARCO_COLUMNA_V1` | TS (puerta) + Py (motor, `armado_estructura.completar`) | on fuera de prod (`:86`) | on | **off** | Herramientas del motor, `conArmadosDeMotor` (`registro-herramientas.ts:1228`), frases de imagen de arco, columna y semiarco/arco/columna/guirnalda orgánicos | Remate, tamaños, inclinación y curva solo llegan al motor con ella |
| `ESTIMAR_CONTEO_V1` | TS + Py | on fuera de prod (`:97`) | on | off | Herramienta de solo lectura | Conteo de la foto (opcional) |
| `PATRONES_COLOR_V1` | Py (`plan.py` `_complete_plan`) | off (`:53`) | **off** | off | `pistas_patron` y `completar_patrones` al confirmar (`registro-herramientas.ts:1185`). **Única vía del patrón para paredes y centros de mesa** | Lectura de patrón |
| `BOUQUETS_ARMADO_V1` | Py (`armado_bouquet.py`) | off (`:59`) | **off** | off | `completar_armados` y `pistas_armado` (`:1187`) | Lectura de bouquet |
| `GUIRNALDAS_ARMADO_V1` | Py (`armado_guirnalda.py`, ADR-0032) | off (`:66`) | **off** | off | `completar_armados_guirnalda` y `pistas_guirnalda` (`:1189`) | Lectura de guirnalda |
| `CONTEO_REFERENCIA_V1` | Py (`conteo_foto.py`) | off (`:104`) | **off** | off | `completar_conteos` (`:1192`). **Cambia cantidades y precio** | Lectura de conteo |
| `GUIA_ESTRUCTURA_V1` | TS (`guia-estructura.ts`) | off (`:112`) | off | off | Mapa de color plano como imagen guía | M8 |
| `REFERENCIA_EN_ETAPA1_V1` | TS (`generate/route.ts:1157`) | off (`:43`) | off | off | La foto de referencia como píxeles en la etapa 1 | Fuera de este alcance |

**Hechos que la matriz deja ver:**

1. En dev se pagan cuatro lecturas en la misma llamada y tres de ellas se tiran: bouquet, guirnalda (salvo
   la curva) y conteo (salvo la herramienta de estimar). Además, el patrón de las piezas que no tienen
   motor (paredes, centros de mesa) también se tira.
2. Tamaños, remate, inclinación y curva **no tienen bandera de consumo propia**:
   - `pistasTamanosDelPlan` viaja siempre a la resolución (`registro-herramientas.ts:1285`).
   - Los cuatro viajan siempre a `conArmadosDeMotor`.
   - Por eso **encender solo la lectura de patrón en prod ya cambia la mezcla y la compra de los planes
     nuevos**: los tamaños leídos mandan sobre la mezcla declarada.
3. `SEGUIMIENTO.md §0` dice que `PATRONES_COLOR_V1` está encendida en `.env.local`. **Es falso hoy** y hay
   que corregirlo en el documento.

#### Cambio de código para M2: coherencia de banderas observable

En `src/lib/ia/nucleo/feature-flags.ts`:

```ts
/** Pares lectura → consumidor. Una lectura encendida con su consumidor apagado se paga y se tira. */
export const CONSUMIDOR_DE_LECTURA = [
  { lectura: "patron",    consumidor: "PATRONES_COLOR_V1",      nota: "paredes y centros de mesa; las piezas con motor la usan vía ARMADO_ARCO_COLUMNA_V1" },
  { lectura: "bouquet",   consumidor: "BOUQUETS_ARMADO_V1" },
  { lectura: "guirnalda", consumidor: "GUIRNALDAS_ARMADO_V1",   nota: "la curva viaja igual al motor" },
  { lectura: "conteo",    consumidor: "CONTEO_REFERENCIA_V1",   nota: "ESTIMAR_CONTEO_V1 la usa de solo lectura" },
] as const satisfies ReadonlyArray<{ lectura: string; consumidor: FeatureFlag; nota?: string }>;

export function lecturasEncendidas(): ReadonlySet<"patron" | "bouquet" | "guirnalda" | "conteo"> { /* LECTURA_UNICA ⇒ las 4; si no, cada *_REFERENCIA_PYTHON_ENABLED */ }

export function lecturasSinConsumidor(): string[] {
  const on = lecturasEncendidas();
  return CONSUMIDOR_DE_LECTURA.filter((p) => on.has(p.lectura) && !featureEnabled(p.consumidor)).map((p) => p.lectura);
}
```

- **Llamarla** una vez por proceso en `src/app/api/references/analyze/route.ts` y emitir
  `console.warn("[flags] lecturas sin consumidor", …)`. Solo nombres: no se loguean ni la foto ni el
  blueprint.
- **No filtrar el prompt v17 según las banderas**: cambiaría su hash y su clave de caché por combinación de
  banderas, y rompería la comparabilidad con la línea base.
- **Prueba nueva** `scripts/test/test-feature-flags-coherencia.ts`, que se añade a `plan:test`. Comprueba:
  - con `LECTURA_UNICA` encendida y los cuatro consumidores apagados, `lecturasSinConsumidor()` devuelve
    las 4;
  - con todo encendido, devuelve `[]`;
  - cada `consumidor` es un `FeatureFlag` válido (lo garantiza `satisfies`).
- **Impacto:** `plan_hash`, contratos y vectores de oro, ninguno. **Revertir:** quitar el aviso.
- **Esfuerzo:** S.

#### Orden de encendido

Cada paso se mide antes de pasar al siguiente. Las corridas pagadas declaran un tope de gasto, desactivan
la telemetría y usan entradas que viven fuera del repo (AGENTS.md).

| Paso | Bandera(s), dónde | Prerrequisito de código | Qué se mide antes | Criterio para pasar | Cómo se revierte |
|---|---|---|---|---|---|
| 0 | dev: igualar `.env.local` a lo que vaya a tener prod en cada paso, o declarar en el informe de la corrida que dev usa la variante v17 | — | — | — | — |
| 1 | — (código) | **M3, M4, M6.a y M5** fusionados | `pytest`, `plan:test`, `contracts:check` | Todo en verde | Revertir el commit |
| 2 | prod: `PATRON_REFERENCIA_PYTHON_ENABLED=true` | Paso 1 | Corrida de lectura sobre un set fijo de fotos etiquetadas, sin generar imagen: acierto de modo, remate (incluido ausente frente a `ninguno`), tamaños, dirección y simetría | Acierto por campo ≥ al umbral que fije negocio. El remate y los tamaños son los que mueven la compra | `=false` y reiniciar la app. Los planes ya confirmados no cambian |
| 3 | prod: `ARMADO_ARCO_COLUMNA_V1=true`, con despliegue **conjunto** de app y ai-api | Pasos 1 y 2 | ADR-0034: conteo del motor frente a la fórmula y frente al conteo de la foto, por tipo de pieza; latencia de la confirmación; tasa de `ARMADO_MOTOR_NO_DISPONIBLE` y de `SERVICIO_OCUPADO` (M10) | Error de conteo dentro de la tolerancia acordada; p95 de confirmación aceptable | `=false`: `sinArmadosDeMotor` quita los armados del modelo. Los planes con armado lo conservan (`feature-flags.ts:80-84`) |
| 4 | prod: `PATRONES_COLOR_V1=true` | Paso 2 | Fidelidad del patrón en la imagen, Gemini contra LoRA (pendiente 1 de `SEGUIMIENTO §0`), con `scripts/lib/medir-guia.ts` | La imagen sigue el patrón en la proporción acordada | `=false`. Las propuestas abiertas que ya tengan `patron_color` lo conservan (ADR-0028) |
| 5 | prod: `GUIRNALDA_REFERENCIA_PYTHON_ENABLED` + `GUIRNALDAS_ARMADO_V1` | Paso 2 y M6.c | Lectura de soporte, forma y relleno; frase de la guirnalda en la imagen | Igual que arriba | `=false` las dos |
| 6 | prod: `BOUQUET_REFERENCIA_PYTHON_ENABLED` + `BOUQUETS_ARMADO_V1` | M7 si se quiere croquis | Acierto de niveles, números y remate; la compra no cambia (ADR-0030) | — | `=false` las dos |
| 7 | prod: `CONTEO_REFERENCIA_PYTHON_ENABLED` + `CONTEO_REFERENCIA_V1` | Paso 3 | Delta de cantidades y precio frente al conteo humano; supuestos visibles | El error medio de precio dentro del margen acordado | `=false`. Los planes confirmados conservan sus cantidades |
| 8 | prod: `LECTURA_UNICA_REFERENCIA_ENABLED`, que reemplaza los pasos 2, 5, 6 y 7 | Pasos 2 a 7 medidos con v16 | Corrida v17 contra v16 (reconocimiento y las 4 lecturas a la vez). La línea base de ADR-0029 deja de aplicar | v17 no peor en ningún campo | `=false` y se vuelve a v16 y las 4 llamadas |
| 9 | prod: `MEASURED_COLOR_DOMINANCE_V1` | — | `scripts/bench/bench-fidelidad.ts` | — | `=false` |
| 10 | prod: `GUIA_ESTRUCTURA_V1` | M8 | `scripts/ops/generar-guia-estructura.ts` (IoU y color) | — | `=false`; la petición a fal vuelve a ser byte a byte la de siempre |

Los `.env` los cambia el usuario o quien despliega; este plan no los toca.

---

### M1 · En producción no llega ninguna lectura de la foto ni ningún motor a la imagen

- **Problema:** con la configuración de prod, el prompt de imagen solo lleva el nombre de la pieza y sus
  colores.
- **Causa raíz:**
  - `feature-flags.ts:86` (`ARMADO_ARCO_COLUMNA_V1` se apaga si `NODE_ENV === "production"`);
  - `:203`, `:225`, `:236`, `:249` y `:270` (lecturas apagadas por defecto);
  - `.env.production` no define ninguna de ellas.

  Sin armado no hay `armados_*` en el resuelto, y `frasesDeEstructuras` (`mezcla-color-escena.ts:190`,
  llamada en `generate/route.ts:934`) devuelve `undefined` para esas piezas.
- **Código actual:**
  ```ts
  if (name === "ARMADO_ARCO_COLUMNA_V1") return process.env.NODE_ENV !== "production";
  export const PATRON_REFERENCIA_PYTHON_ENABLED = process.env.PATRON_REFERENCIA_PYTHON_ENABLED === "true";
  ```
- **Cambio propuesto:** no tocar los valores por defecto del código, porque son deliberados y están
  documentados. Encender por pasos según la matriz. Lo único de código es el aviso de coherencia (ver M2).
- **Pruebas:** las de cada paso de la matriz. Antes del paso 3, en `scripts/test/test-armado-estructura-ia.ts`:
  con la bandera encendida y un plan con arco, la confirmación escribe `armado_arco` y el resuelto trae
  `armados_arco[0].prompt_gemini` no vacío. Ya cubierto en parte; añadir la aserción de la frase.
- **Impacto:**
  - `plan_hash`: cambia para los planes nuevos desde el paso 3 (armado en `estructuras`); desde el paso 2
    ya cambia la mezcla, por los tamaños leídos.
  - Contratos: ninguno.
  - Vectores de oro: ninguno (sus planes traen el armado explícito).
- **Riesgos:** precio distinto en los planes nuevos; latencia de la confirmación (una llamada más a Python);
  cola de motores (M10).
- **Revertir:** variable a `false` y reiniciar la app. No hay migración de datos.
- **Dependencias:** M2, M3, M4, M5, M6.a, M10.
- **Esfuerzo:** S en código, L en medición.

### M2 · Se pagan lecturas cuyo consumidor está apagado

- **Problema:** en dev, la variante v17 devuelve 4 lecturas y las de bouquet, guirnalda, conteo y el patrón
  de las piezas sin motor se descartan al confirmar.
- **Causa raíz:**
  - `analyze/route.ts:64-73`: con la lectura única siempre se adjuntan las 4;
  - `registro-herramientas.ts:1185,1187,1189,1192`: las banderas de consumo apagadas;
  - `:1274-1305`: `resolverPlanDelTurno` solo manda pistas con esas banderas encendidas;
  - `.env.local` no las define.
- **Código actual:**
  ```ts
  const pistasArmado = completarArmados ? pistasArmadoDelPlan(plan, estado.referenceBlueprint) : [];
  ```
- **Cambio propuesto:** el `lecturasSinConsumidor()` de arriba, y decidir para cada lectura entre encender
  su consumidor (matriz) o aceptar el coste. Corregir `SEGUIMIENTO.md §0`.
- **Pruebas:** `scripts/test/test-feature-flags-coherencia.ts` (arriba).
- **Impacto:** `plan_hash`, contratos y vectores de oro, ninguno.
- **Riesgos:** ninguno funcional.
- **Revertir:** quitar el aviso.
- **Dependencias:** M1, M6.c y M7.
- **Esfuerzo:** S.

### M3 · El cromado «reflex» del catálogo se pinta mate en los tres motores orgánicos

- **Problema:** la palabra del catálogo (`reflex`, `metal`, `cristal`…) no coincide con ninguno de los 4
  acabados del motor y cae a `mate`.
- **Causa raíz:**
  - El motor solo conoce `Acabado = Literal["mate", "cromado", "confeti", "transparente"]`
    (`app/organico/tipos.py:46`, `ACABADOS` en `:63`).
  - El plan escribe la palabra del catálogo: `"acabado": candidate.finishes[0]` (`plan.py:2478`).
  - `_acabado_de` solo acepta coincidencia exacta (`armado_estructura.py:696-719`).
  - Lo mismo, sin aviso, en `plan_armado_arco_organico.py:170`, `plan_armado_columna_organica.py:164` y
    `plan_armado_guirnalda_organica.py:187`, cada uno con `ACABADO_POR_DEFECTO = "mate"`
    (`:130`, `:124` y `:131` respectivamente).
  - Sonda: columna, arco y guirnalda orgánicos con «reflex» salieron con `acabado: "mate"` y el aviso
    «El acabado reflex no es uno del motor».
- **Código actual:**
  ```python
  if declarado is not None:
      limpio = declarado.strip().lower()
      if limpio in VALORES_ACABADO:
          return limpio
      avisos.append(f"El acabado «{declarado}» no es uno del motor; ese color va mate.")
  return "mate"
  ```

#### Diseño del dueño único

`_acabado_de` se negaba, con razón, a escribir una equivalencia de vocabulario en Python. La equivalencia
tiene que tener **un dueño**, y ese dueño ya existe a medias:

- `src/lib/plan/acabado-observado.ts:21` define `FamiliaSempertex` (fashion, pastelDusk, pastelMate, satin,
  silk, neon, metal, reflex, cristal).
- `src/lib/ia/kagutsuchi/lora-caption-compiler.ts:330` (`FINISH_WORDS`) normaliza las mismas palabras para
  el caption.

Se crea un módulo TS dueño, que se exporta al contrato igual que `x-reglas-mezclas`
(`mezclas.ts:126`, `scripts/ops/export-domain-contract-schemas.ts:93`):

1. **Nuevo `src/lib/plan/acabados-motor.ts`** (puro, sin React ni red):
   ```ts
   import type { FamiliaSempertex } from "./acabado-observado";

   /** Los 4 acabados que pinta el motor orgánico. Su dueño es `app/organico/tipos.py` (puerto del clasificador);
    *  esta lista se comprueba contra él en `test_acabados_motor.py`, no se decide aquí. */
   export const ACABADOS_MOTOR = ["mate", "cromado", "confeti", "transparente"] as const;
   export type AcabadoMotor = (typeof ACABADOS_MOTOR)[number];

   /** Palabra del catálogo (`derived->'finishes'`, normalizada: minúsculas, sin tildes) → familia Sempertex. */
   export const FAMILIA_POR_PALABRA_CATALOGO: Readonly<Record<string, FamiliaSempertex | "confeti">> = {
     reflex: "reflex", cromado: "reflex", metal: "metal", metalizado: "metal",
     fashion: "fashion", mate: "fashion", "pastel mate": "pastelMate", "pastel dusk": "pastelDusk",
     satin: "satin", satinado: "satin", perlado: "silk", silk: "silk", neon: "neon",
     cristal: "cristal", transparente: "cristal", confeti: "confeti",
   };

   /** Familia → acabado del motor. `exacto: false` = el motor no tiene ese acabado y se usa el más cercano (con aviso). */
   export const ACABADO_MOTOR_POR_FAMILIA: Readonly<Record<FamiliaSempertex | "confeti", { motor: AcabadoMotor; exacto: boolean }>> = {
     reflex: { motor: "cromado", exacto: true },
     metal: { motor: "cromado", exacto: false },        // decisión de negocio: Metal es satinado metálico, no espejo
     cristal: { motor: "transparente", exacto: true },
     confeti: { motor: "confeti", exacto: true },
     fashion: { motor: "mate", exacto: true },
     pastelMate: { motor: "mate", exacto: true },
     pastelDusk: { motor: "mate", exacto: true },
     neon: { motor: "mate", exacto: false },
     satin: { motor: "mate", exacto: false },
     silk: { motor: "mate", exacto: false },
   };

   export type AcabadosMotorContrato = {
     acabados_motor: readonly AcabadoMotor[];
     familia_por_palabra: Record<string, string>;
     por_familia: Record<string, { motor: AcabadoMotor; exacto: boolean }>;
   };
   export function acabadosMotor(): AcabadosMotorContrato { /* copia literal de las tres tablas */ }
   ```
   - **Antes de escribir las claves**, sacar la lista real de palabras del catálogo con una consulta de
     **solo lectura** (`SELECT DISTINCT jsonb_array_elements_text(derived->'finishes') …`) y guardarla
     como fixture sin datos de cliente.
   - `FINISH_WORDS` del compilador LoRA debería pasar a derivar sus claves de `FAMILIA_POR_PALABRA_CATALOGO`
     y sus valores (palabras del corpus) de una tabla familia → palabra. Es un refactor aparte y opcional.
2. **Exportar:** en `scripts/ops/export-domain-contract-schemas.ts`, junto a `:93`, añadir
   `"x-acabados-motor": acabadosMotor()`. Después `npm run contracts:export:domain` y
   `uv run --directory services/ai-api python scripts/generate_models.py`.
3. **Consumir en Python sin ser dueño.** Nuevo bloque en `app/plan_armado_comun.py`, que ya comparten las
   rutas del editor:
   ```python
   _ACABADOS = cast(Mapping[str, Any], contract_schema("PlanDecoracion")["x-acabados-motor"])
   _FAMILIA = cast(Mapping[str, str], _ACABADOS["familia_por_palabra"])
   _POR_FAMILIA = cast(Mapping[str, Mapping[str, object]], _ACABADOS["por_familia"])

   @dataclass(frozen=True, slots=True)
   class AcabadoDelMotor:
       valor: str            # uno de VALORES_ACABADO
       aviso: str | None     # None si la equivalencia es exacta o la palabra ya es del motor

   def acabado_del_motor(declarado: str | None, admitidos: Sequence[str]) -> AcabadoDelMotor:
       if declarado is None:
           return AcabadoDelMotor("mate", None)
       limpio = _normalizar(declarado)              # minúsculas, sin tildes, espacios colapsados
       if limpio in admitidos:
           return AcabadoDelMotor(limpio, None)
       familia = _FAMILIA.get(limpio)
       if familia is None:
           return AcabadoDelMotor("mate", f"El acabado «{declarado}» no es uno del motor; ese color va mate.")
       destino = _POR_FAMILIA[familia]
       valor = str(destino["motor"])
       aviso = None if destino["exacto"] else f"El motor no tiene acabado {declarado}; se pinta {valor}."
       return AcabadoDelMotor(valor, aviso)
   ```
   - `armado_estructura._acabado_de` (`:696`) pasa a delegar en ella cuando `pedido is None`: añade
     `aviso` a `avisos` si lo hay. Un `pedido` del modelo se sigue validando estrictamente contra
     `VALORES_ACABADO`.
   - Los tres `_acabado_de` de `plan_armado_*_organic*.py` se sustituyen por
     `acabado_del_motor(material.get("acabado"), admitidos).valor`, y así desaparecen las 3 copias.
   - **Por qué no es un segundo dueño:** Python no escribe ninguna palabra ni ninguna equivalencia; lee la
     tabla del contrato, como `plan.py:162-166` lee `x-reglas-mezclas`.

- **Pruebas:**
  - **Nuevo `tests/test_acabados_motor.py`:**
    - `test_cada_acabado_del_contrato_es_uno_del_motor`: los valores de `por_familia[*].motor` y de
      `acabados_motor` están contenidos en `VALORES_ACABADO` (de `organico/tipos.py`). Falla si alguien
      porta un acabado nuevo en un lado y no en el otro.
    - `test_reflex_se_pinta_cromado_sin_aviso` (`acabado_del_motor("Reflex", VALORES_ACABADO) ==
      AcabadoDelMotor("cromado", None)`).
    - `test_metal_se_pinta_cromado_con_aviso`.
    - `test_cristal_se_pinta_transparente`.
    - `test_palabra_desconocida_va_mate_con_aviso`.
    - `test_toda_palabra_del_catalogo_tiene_familia`, contra el fixture de palabras reales.
  - **`tests/test_armado_estructura.py:558`**
    (`test_un_acabado_del_plan_que_el_motor_no_conoce_va_mate_con_aviso`): sigue siendo válido con
    `perlado` (silk → mate, no exacto, con aviso). Cambiar la aserción del aviso a la frase nueva y añadir
    `test_la_receta_organica_pinta_cromado_el_reflex_del_plan` sobre `completar` con columna, arco y
    guirnalda.
  - **`tests/test_plan_armado_columna_organica.py`, `_arco_organico.py` y `_guirnalda_organica.py`:**
    `test_la_receta_lleva_el_cromado_del_plan` (material `acabado: "reflex"` → paleta `cromado`).
  - **TS:** `scripts/test/test-acabados-motor.ts` comprueba que `FamiliaSempertex` está cubierta entera
    por `ACABADO_MOTOR_POR_FAMILIA` (tipo exhaustivo y `Object.keys` contra una lista).
- **Impacto:**
  - Contratos: `plan-decoracion.v1` gana la extensión `x-acabados-motor`, sin campos de datos nuevos, así
    que `additionalProperties` no se ve afectado. Hay que regenerar `generated_models.py` y pasar
    `contracts:check`.
  - `plan_hash`: lo que la receta escribe en `estructuras[*].armado_*_organic*.colores.paleta[*].acabado`
    cambia de `mate` a `cromado`, así que cambia para los planes nuevos con ARMADO encendido. Los planes
    ya confirmados no cambian.
  - Vectores de oro de `plan-resolution`: sin cambio, porque traen el armado explícito y la resolución no
    llama a la receta. Comprobar con `pytest tests/test_plan_regresion.py` **sin** `REGRESION_ACTUALIZAR`.
  - Vectores del motor: sin cambio, porque el motor no se toca.
  - **Ruta del clasificador: no hace falta.** Es un adaptador de entrada; el motor ya pinta `cromado`.
- **Riesgos:** la decisión metal→cromado es de negocio. Si el catálogo trae palabras compuestas
  («reflex high-shine»), `_normalizar` tiene que tratarlas y por eso existe el fixture.
- **Revertir:** quitar la clave `x-acabados-motor` y volver `_acabado_de` a la coincidencia exacta. Los
  planes con `cromado` siguen siendo válidos porque es un valor del contrato del armado.
- **Dependencias:** ninguna. Bloquea el paso 3 de la matriz.
- **Esfuerzo:** M.

### M4 · El arco y la columna clásicos ignoran la participación declarada

- **Problema:** con 70/20/10 declarado, el motor coloca y cobra 30/29/29 (sonda con un arco de 3 m:
  `compra` 33/32/32).
- **Causa raíz:**
  - `_pieza_del_plan` solo carga `pesos` y `acabados` para piezas orgánicas (`armado_estructura.py:1612-1627`).
  - La receta clásica usa `list(range(cuantos))` en el orden del plan (`:1357` arco, `:1361` columna).
  - El patrón se elige por número de colores: `_patron_arco_para` (`:1007`) y `_patron_columna_para`
    (`:1023`).
- **Código actual:**
  ```python
  return _armado_arco(pieza, patron, list(range(cuantos)), None, None, avisos)
  ```
- **Cambio propuesto (en dos capas):**
  1. **Adaptador de pictures, sin ruta del clasificador.**
     - Cargar siempre `pesos` en `PiezaArmado`: quitar la condición de `de_paleta` para `pesos` y dejar
       `acabados` como está.
     - En la receta clásica, ordenar por peso descendente, que es lo mismo que hace la lectura con
       `_orden_de_paleta`:
     ```python
     def _orden_por_peso(pieza: PiezaArmado, cuantos: int) -> list[int]:
         pesos = pieza.pesos or []
         return sorted(range(cuantos), key=lambda i: (-(pesos[i] if i < len(pesos) else 0.0), i))
     ```
     Usarla en `:1357` y `:1361` en lugar de `list(range(cuantos))`. Esto ya hace que el dominante sea el
     primer color del patrón, que es el que el motor reparte más en espiral y ombré.
  2. **Criterio de armado, con ruta del clasificador.** Repartir por peso dentro del patrón: por ejemplo,
     `bloques` con índices repetidos (el arco los admite, porque `armado_arco.validar` no rechaza
     duplicados; la columna los colapsa, `app/columna/motor.py:322`), o un mando de peso por color.
     - Primero en el clasificador: definir en su diseñador cómo un peso por color se traduce a la lista o
       a los mandos del patrón, generar sus vectores, portar `app/arco` y `app/columna`, y luego en
       pictures:
       `_lista_ponderada(pieza, maximo: int) -> list[int]` (método de mayores restos sobre `maximo`
       huecos) para `bloques` y `rayas`.
     - Si la ponderación no cabe en el patrón (por ejemplo, la espiral con 4 colores y un 85 %
       dominante), dar el aviso «el patrón reparte por igual; la compra sigue al patrón».
- **Pruebas** en `tests/test_armado_estructura.py`:
  - `test_la_receta_clasica_pone_primero_el_color_dominante` (participación [0.1, 0.7, 0.2] →
    `armado["materiales"][0] == 1`);
  - `test_la_receta_clasica_reparte_por_peso_cuando_el_patron_lo_admite` (capa 2: compra del dominante ≥
    55 % con 70/20/10);
  - mantener `test_la_receta_del_arco_usa_el_arcoiris_cuando_hay_mas_colores_que_bandas` (`:372`).
- **Impacto:**
  - `plan_hash`: cambia para los planes nuevos (el orden y la lista de materiales del armado clásico).
  - Contratos: sin cambio en la capa 1; en la capa 2, solo si se añade un mando nuevo, que llegaría con el
    puerto.
  - Vectores de `plan-resolution`: sin cambio en la capa 1. En la capa 2 se regeneran los del motor
    portado (`golden/arco`, `golden/columna`) **en el clasificador**; los `expected` de plan-resolution no
    se tocan salvo decisión explícita.
- **Riesgos:** el orden cambia la estética de la espiral; es posible que los vectores del clasificador
  asuman el orden de la paleta.
- **Revertir:** la capa 1 es un commit; la capa 2 revierte el puerto.
- **Dependencias:** ninguna para la capa 1.
- **Esfuerzo:** S para la capa 1; M-L para la capa 2.

### M5 · La clase oficial de la pieza no decide el motor (aro y techo mal armados)

- **Problema:**
  - `columna_asimetrica` o `arco_asimetrico` con mezcla `clasica` se arman con el motor clásico (sonda:
    `armado_columna` en espiral).
  - `aro_circular` se arma como un arco «tall arch» (sonda: `armado_arco` en espiral), mientras
    `build-image-prompt.ts:391` dice «circular hoop».
  - `techo_globos` (tipo `guirnalda`) se arma como guirnalda orgánica.
- **Causa raíz:** `_pieza_del_plan` (`armado_estructura.py:1565`) y `_receta` (`:1283`) miran solo `tipo`
  y `mezcla`. `TIPOS_CON_MOTOR` está en `:142`; las ramas orgánicas en `:1315` y `:1321`. Ninguno lee
  `estructura_oficial`. El semiarco **ya está resuelto** (ver la cabecera).
- **Código actual:**
  ```python
  tipo = estructura.get("tipo")
  if tipo not in TIPOS_CON_MOTOR:
      return None
  ```
- **Cambio propuesto:**
  ```python
  #: Clases oficiales que su tipo base no sabe armar: el arco no hace aros y la guirnalda no hace techos.
  #: Sin motor propio, la pieza se queda con la fórmula y la imagen la nombra por su clase.
  _CLASES_SIN_MOTOR = frozenset({"aro_circular", "techo_globos"})
  #: Clases que el plan declara orgánicas por nombre: van al motor orgánico aunque la mezcla diga clásica.
  _CLASES_ORGANICAS = frozenset({"columna_asimetrica", "arco_asimetrico", "semiarco_asimetrico"})

  def _pieza_del_plan(estructura, mezcla_leida=None):
      oficial = estructura.get("estructura_oficial")
      if oficial in _CLASES_SIN_MOTOR:
          return None
      ...
      organica_por_clase = oficial in _CLASES_ORGANICAS
      # PiezaArmado gana `organica: bool = False`
      return PiezaArmado(..., organica=organica_por_clase or (mezcla_declarada in MEZCLAS_ORGANICAS))
  ```
  - En `_receta`, las condiciones de `:1315` y `:1321` pasan de `pieza.mezcla in MEZCLAS_ORGANICAS` a
    `pieza.organica`.
  - `de_paleta` pasa a la misma condición.
  - Si la clase es orgánica y la mezcla es `clasica`, dar el aviso «La pieza es orgánica y su mezcla es de
    un solo tamaño; el motor la arma en racimos de ese tamaño».
  - **Del lado TS no hay nada que cambiar.** `conArmadosDeMotor` filtra solo por tipo y Python ya no
    devuelve armado para aro y techo, así que `sinArmadosDeMotor` no hace falta.
- **Pruebas** en `tests/test_armado_estructura.py`:
  - `test_un_aro_circular_no_recibe_armado_de_arco`;
  - `test_un_techo_de_globos_no_recibe_armado_de_guirnalda`;
  - `test_una_columna_asimetrica_va_al_motor_organico_aunque_la_mezcla_sea_clasica` (clave
    `armado_columna_organica`);
  - lo mismo para `arco_asimetrico`.

  Y en `scripts/test/test-armado-estructura-ia.ts`: un plan con aro confirma sin `armado_arco`.
- **Impacto:**
  - `plan_hash`: cambia para los planes nuevos de esas clases (armado distinto o ausente).
  - Contratos: `PiezaArmado` es un modelo de Python interno de la operación `omoikane-armado-estructura.v1`.
    Si está en el esquema exportado, añadir `organica` desde Zod; si no, solo en Python.
  - Vectores de oro: ninguno.
  - **Ruta del clasificador:** solo si se quiere un motor de aro o de techo (L). La exclusión es política
    del plan y es de pictures.
- **Riesgos:** un aro pierde el croquis del motor (antes tenía uno, aunque equivocado). La columna
  orgánica de un solo tamaño puede verse rara; hay que revisarlo con el editor.
- **Revertir:** quitar los dos conjuntos.
- **Dependencias:** ninguna. Bloquea el paso 3 de la matriz.
- **Esfuerzo:** S.

### M6 · Lecturas que llegan al plan pero no al armado

#### M6.a · La columna orgánica ignora el remate leído

- **Causa:**
  - La rama orgánica de `_receta` (`armado_estructura.py:1315-1320`) retorna antes de `remate_del_motor`
    (`:1330`).
  - `_armado_columna_organica` fija la corona (`:1196-1203`, `"activa": False` en `:1199`) con el
    comentario «la foto no dice si la hay». Con lectura, sí lo dice.
- **Código actual:**
  ```python
  "corona": {"activa": False, "tamano": ..., "material": 0},
  ```
- **Cambio:**
  ```python
  def _armado_columna_organica(pieza, avisos, leido=None, inclinacion=None, remate: RemateLeido | None = None):
      ...
      activa = remate is not None and remate.tipo == "globo"
      if remate is not None and remate.tipo in ("racimo", "estrella", "corazon"):
          avisos.append(f"La foto corona la columna con «{remate.tipo}»; el motor orgánico solo corona con un globo y la deja sin corona.")
      "corona": {"activa": activa, "tamano": ..., "material": remate.material if (activa and remate.material is not None) else 0},
  ```
  En `_receta`, rama de la columna orgánica:
  `remate = remate_del_motor("columna", lectura_remate, de_la_pieza, avisos)` y pasarlo. Si la corona se
  activa, `origen = "referencia"`. Sin lectura, la corona sigue apagada (decisión vigente).
- **Pruebas:** `test_la_columna_organica_lleva_corona_si_la_foto_ve_un_globo`,
  `test_la_columna_organica_sin_lectura_de_remate_no_se_corona` y
  `test_un_remate_estrella_en_columna_organica_avisa_y_no_corona` (`tests/test_armado_estructura.py`).
  Además, que la frase de `armado_columna_organica_prompt.py` nombre la corona; verificar que la lee del
  armado.
- **Impacto:** `plan_hash` de los planes nuevos (más globos de 24"). Contratos: ninguno (la corona ya está
  en `armado-columna-organica.v1`). Vectores: ninguno. **Clasificador: no** (la corona ya existe en el
  motor).

#### M6.b · El vuelo de una columna o un arco clásicos (corregido)

- El motor clásico **no tiene vuelo**: el `inclinacion` de sus contratos es la pendiente del patrón.
- La lectura `appearance.inclinacion` solo se honra en el motor orgánico (`:1162-1166` columna,
  `:1250-1257` arco).
- **Cambio:** no lo hay sin capacidad nueva. Dos opciones:
  1. **Ruta del clasificador:** añadir vuelo a la columna o al arco de patrones allí, con sus vectores, y
     portarlo.
  2. **Política en pictures:** si `|inclinacion| ≥ 0.15` y la pieza es clásica, aviso «la foto muestra la
     pieza inclinada; el armado de patrones la deja recta».
- **Prueba (opción 2):** `test_una_columna_clasica_inclinada_avisa`.
- **Esfuerzo:** S en la opción 2; L en la opción 1.

#### M6.c · La lectura de la guirnalda solo aporta el reparto y la curva al motor orgánico

- **Causa:** `_peticion_con_reparto` (`armado_estructura.py:1042-1055`) solo lleva `reparto`; `forma`,
  `soporte`, `puntos_de_anclaje`, `relleno`, `unidad_racimo` y `remates` no se usan. La curva viaja aparte
  (`pistasCurvaDelPlan`, `registro-herramientas.ts:706`).
- **Cambio** (traductor nuevo en `app/patron_de_la_foto.py`, que es el módulo dueño de cruzar vocabularios
  de la foto y del motor):
  ```python
  #: Forma leída → forma lista del motor (`app/guirnalda/formas.py`: recta, ondulada, feston, doble-feston, …, piso).
  FORMA_LISTA_DE_LECTURA: Mapping[str, str] = {"recta": "recta", "curva": "recta", "ondulada": "ondulada", "arco_caido": "feston"}
  def forma_lista_del_motor(lectura: Mapping[str, object] | None, avisos: list[str]) -> str | None:
      # soporte "piso" → "piso"; arco_caido con puntos_de_anclaje ≥ 3 → "doble-feston"; u_invertida → None con aviso
  def volumen_del_motor(lectura, avisos) -> VolumenPedido | None:
      # relleno.proporcion → VolumenPedido(relleno=...) SOLO si el clasificador confirma que su `relleno` es la misma magnitud
  ```
  - En `completar`, añadir al request `guirnaldas: list[LecturaGuirnaldaMotor]`, igual que `curvas`
    (ADR-0039).
  - En TS, `pistasFormaGuirnaldaDelPlan` dentro de `conArmadosDeMotor`, al lado de `curvas`.
  - En `_receta`, la rama de la guirnalda construye la petición con `forma_lista` y `volumen`.
  - Los `remates` (globos grandes en extremos o en el centro) no tienen equivalente en el motor:
    `adornos` son follaje y flores. Hasta que lo tenga, aviso.
- **Pruebas:**
  - `tests/test_patron_de_la_foto.py`: `test_forma_leida_arco_caido_va_a_feston`,
    `test_u_invertida_no_tiene_forma_y_avisa`, `test_soporte_piso_va_a_piso`;
  - `tests/test_armado_estructura.py`: `test_la_receta_de_la_guirnalda_usa_la_forma_de_la_foto`;
  - TS: `scripts/test/test-armado-estructura-ia.ts`, que la pista viaja.
- **Impacto:**
  - Contrato de la operación `omoikane-armado-estructura.v1`: un campo nuevo en la petición, en Zod
    primero.
  - `plan_hash` de los planes nuevos.
  - **Ruta del clasificador:** sí para `relleno`, porque hay que confirmar la unidad, y para cualquier
    remate de guirnalda (capacidad nueva).

#### Resto de M6

- **Riesgos:** todas las sub-partes añaden o cambian globos cobrados; hay que medirlas con fotos reales
  (paso 2 de la matriz).
- **Revertir:** commit por sub-parte.
- **Dependencias:** M1 (sin ARMADO no se ve nada), M2 y M5.
- **Esfuerzo:** a S · b S (opción 2) · c M.

### M7 · El motor del bouquet no tiene consumidor

- **Problema:** `app/bouquet/` (motor del ramo más el dibujo de `armado-bouquet.v1`; unas 3.900 líneas)
  solo lo importa `tests/test_formas_listas.py`.
- **Causa raíz:** `app/bouquet/__init__.py:18`: «Nada de esto está cableado al plan todavía».
  `/internal/v1/plan/armado-bouquet` (`main.py`) usa `app/armado_bouquet.py`, que valida y cuenta, no
  dibuja con el motor. Además `BOUQUETS_ARMADO_V1` está apagada (`feature-flags.ts:59`).
- **Cambio propuesto** (ADR breve, porque es un cableado nuevo):
  1. `app/plan_armado_bouquet.py` gana `dibujo: str` en la respuesta de vista previa: llama a
     `app.bouquet.armado.generar_armado(normalizar_armado(...))` y a
     `svg_documento_armado(...)` con los colores de los materiales del plan. Sin tocar ninguna regla
     comercial, que siguen siendo de `armado_bouquet.py` y `plan.py`.
  2. `src/components/plan/bouquet/EditorBouquet.tsx` muestra ese SVG, con el mismo patrón que
     `usarVistaArco`.
  3. Correr bajo `correr_motor` (`exclusion_motores.py`) como las otras vistas previas.
  4. El motor del ramo libre (`motor.py`) se queda sin cablear hasta que haya un contrato para el ramo
     libre: se documenta como deuda y se quita el «todavía».
- **Pruebas:** `tests/test_plan_armado_bouquet.py::test_la_vista_previa_trae_el_dibujo_del_motor` (SVG no
  vacío, que contiene tantos `<circle` como globos cuenta `armado_resuelto`); prueba del adaptador TS.
- **Impacto:**
  - `plan_hash`: ninguno (el dibujo es derivado).
  - Contratos: la respuesta de la vista previa del bouquet gana `dibujo` (Zod → export → modelos).
  - Vectores: los del motor ya existen (`golden/bouquet`). Clasificador: no (es el puerto 1 a 1).
- **Riesgos:** el dibujo y el conteo pueden discrepar. La prueba lo detecta.
- **Revertir:** quitar el campo.
- **Dependencias:** paso 6 de la matriz para que haya bouquets con armado.
- **Esfuerzo:** M.

### M8 · Los armados del motor no tienen guía visual

- **Problema:** `estructuraParaGuia` solo conoce `patrones_color` y `armados_guirnalda`, así que el croquis
  del arco, de la columna y de las piezas orgánicas nunca llega como imagen guía.
- **Causa raíz:** `src/lib/ia/kagutsuchi/guia-estructura.ts:80`:
  `Pick<PlanResuelto, "plan" | "estructuras" | "props" | "patrones_color" | "armados_guirnalda">` (y
  `:86`, `:92`).
- **Cambio propuesto:**
  - Ampliar el `Pick` con `armados_arco | armados_columna | armados_arco_organico |
    armados_columna_organica | armados_guirnalda_organica`.
  - Para esas piezas, pedir el dibujo a la ruta de vista previa de su motor (la misma de
    `/api/plan-armado-*`) con el armado del plan, rasterizarlo con el mismo camino que el mapa plano
    actual y marcar `fuente: "motor"`.
  - Prioridad cuando una pieza tiene las dos: motor > guirnalda ADR-0032 > patrón (la misma regla que
    `frasesDeEstructuras`).
- **Pruebas:** `scripts/test/test-guia-estructura.ts`: un resuelto con solo `armados_columna_organica`
  produce `EstructuraConGuia` con `fuente: "motor"`; sin bandera, la petición a fal es la de siempre.
- **Impacto:** `plan_hash`, contratos y vectores, ninguno. Coste de fal: una imagen de entrada.
- **Riesgos:** latencia de un dibujo más antes de generar; `v007` nunca se midió con `/edit`.
- **Revertir:** bandera apagada.
- **Dependencias:** M1 y M3 (el croquis tiene que pintar bien el cromado).
- **Esfuerzo:** M.

### M9 · El arco orgánico no se puede editar

- **Problema:** el bloque del arco orgánico es de solo lectura; no existe la acción de edición.
- **Causa raíz:** `DetalleEstructura.tsx:171` («that edit does not exist yet on either side»). No hay
  acción `armado_arco_organico` en `src/lib/plan/edicion-esquemas.ts` (la columna está en `:178`) ni en
  `services/ai-api/app/plan_edicion.py` (la columna en `:354` y `:1277-1287`).
- **Cambio propuesto:** copiar el patrón de la columna orgánica:
  - Zod `accion: z.literal("armado_arco_organico")` con `armado_arco_organico: ArmadoArcoOrganicoV1 |
    null`;
  - export y modelos;
  - nuevo `app/plan_edicion_arco_organico.py` con `fijar_armado_arco_organico`,
    `revisar_armado_arco_organico` y `sin_armado_arco_organico`;
  - rama en `plan_edicion.py`;
  - `"armado_arco_organico"` en `ACCIONES_DE_MOTOR` (`exclusion_motores.py:36`);
  - casos en `aplicar-edicion.ts` (`:96-103` y `:164-171`);
  - `onGuardar` en `TarjetaPlanDecoracion.tsx`.

  Un semiarco se edita por la misma acción.
- **Pruebas:** `tests/test_plan_edicion_arco_organico.py` (fijar válido, índice fuera de rango →
  `armado_invalido`, quitar), y la prueba TS de `aplicar-edicion`.
- **Impacto:**
  - Contratos: nueva variante de la edición, en Zod primero.
  - `plan_hash`: lo cambia la edición, como en cualquier otra pieza.
  - Vectores: ninguno.
- **Riesgos:** bajo.
- **Revertir:** quitar la acción. Los planes editados conservan su armado, que sigue siendo válido.
- **Dependencias:** ninguna.
- **Esfuerzo:** M.

### M10 · Cupo de motor 1 sin cola (probable)

- **Problema:** varias vistas previas simultáneas reciben 429 y, agotados 3 reintentos de 120 ms, salen
  como `SERVICIO_OCUPADO`.
- **Causa raíz:** `exclusion_motores.py:48-63` (`ExclusionDeMotores`, un trabajo a la vez,
  `RESERVA_MAXIMA_S = 30.0` en `:31`); `python-adapter.ts:421-422`.
- **Primero medir:**
  - abrir una tarjeta con 4 o más piezas de motor y los editores desplegados;
  - contar 429 en `preview_logs` y `SERVICIO_OCUPADO` en `[plan]`;
  - si los bloques están plegados por defecto y no piden dibujo al montar, el riesgo es menor.
- **Cambio propuesto (si se confirma):** en el cliente, una cola por tarjeta (`colaDibujos` en
  `src/components/plan/vistas-en-vivo.ts` o en un módulo nuevo) que serializa las peticiones de dibujo y
  gana la última por pieza. Es preferible a subir el cupo, que existe para no saturar el hilo del plan. La
  alternativa en el servidor es una espera acotada:
  ```python
  async def correr_motor(funcion, *args, espera_max_s: float = 1.0, **kwargs):  # reintenta reservar cada 25 ms hasta espera_max_s, luego 429
  ```
- **Pruebas:**
  - `tests/test_exclusion_motores.py::test_un_segundo_trabajo_espera_y_corre_si_el_primero_termina_a_tiempo`;
  - TS: cola con 4 peticiones → 4 respuestas, en orden, y la última por pieza gana.
- **Impacto:** `plan_hash`, contratos y vectores, ninguno.
- **Riesgos:** latencia percibida.
- **Revertir:** commit.
- **Dependencias:** M1 (prod con ARMADO).
- **Esfuerzo:** S-M.

### M11 · Ajustes menores

- **a. La frase LoRA de los motores va sin acabado.**
  - Dónde: `armado_arco_prompt.py:141`, `armado_columna_prompt.py:106`,
    `armado_columna_organica_prompt.py:191`, `armado_guirnalda_organica_prompt.py:104` (`nombre_color_en`).
  - Hoy lo compensa la etiqueta del elemento (`lora-caption-compiler.ts:1236`).
  - **Cambio:** ninguno hasta medirlo. Antes de tocar una palabra, contarla en las 345 captions
    (`data/staging/lora-v007`). Si se añade, usar la palabra del corpus («Reflex high-shine»), saliendo de
    la tabla familia → palabra de M3.
  - **Prueba:** `tests/test_armado_*_prompt.py`, que la frase LoRA de una pieza `reflex` contiene la
    palabra del corpus.
  - Esfuerzo: S.
- **b. Dev no corre el análisis de producción.** `LECTURA_UNICA_REFERENCIA_ENABLED=true` en `.env.local`
  hace que dev use v17 y no el v16 congelado (ADR-0029). **Cambio:** paso 0 de la matriz; el aviso de M2
  lo hace visible. Esfuerzo: S.
- **c. Remate por defecto de la columna clásica.** Sin lectura, el motor la corona con un globo de 24"
  (sonda: `remate: {tipo: globo, tamano: 24}`). La orgánica decide lo contrario (`:1196-1198`).
  **Cambio:** decidir **una** regla para las dos. Si es «sin lectura no se corona», pasa por la **ruta del
  clasificador**, porque cambia el valor de partida del diseñador, o por la receta de pictures pasando
  `RematePedido(tipo="ninguno")` cuando no hay lectura. Prueba:
  `test_columna_clasica_sin_lectura_de_remate_sigue_la_regla_comun`. `plan_hash` de los planes nuevos.
  Esfuerzo: S.

---

### Orden recomendado

1. **M3, M5 y M6.a**: son baratos y corrigen el croquis, la compra y la contradicción del prompt.
2. **M4 capa 1 y M2.**
3. **Pasos 2 y 3 de la matriz** (M1).
4. **M6.c, M9, M10 y M8.**
5. **M7, M4 capa 2 y M6.b opción 1**, que van por la ruta del clasificador.


---

## Parte V · Plan de remediación: salud, código muerto y desfase de banderas

Repositorio: `C:\New folder\pictures` (HEAD `16bd109`, con 158 cambios sin commitear del usuario).
Motor de referencia: `C:\New folder\clasificador-decoraciones` (HEAD `f8b5b3b`, también con cambios sin commitear en `src/lib/{columnaorg,organico,guirnalda,bouquet}`).
Fecha: 2026-10-04, 12:53 hora local. **El árbol cambia mientras se escribe esto.** Hace 10 minutos apareció `golden/dibujos/vectores-dibujos.json` (generado 17:42Z) junto a `app/referencias/dibujos.py`. Todo lo que sigue se midió sobre el estado de las 12:00 a 12:50.

Formato de cada ítem: **archivo:línea · cambio exacto · prueba · riesgo · reversión · esfuerzo** (S < 2 h, M ≈ ½–1 día, L > 1 día).

Reglas que este plan no rompe:
- **El oráculo nunca se regenera desde el puerto en Python.** Los vectores de oro de los motores (`contracts/domain/v1/golden/{arco,columnaorg,organico,guirnalda,bouquet,columna,dibujos}`) los escribe solo `clasificador-decoraciones/scripts/migracion/vectores-*.ts`. El `expected` de `plan-resolution` se edita a mano, con la razón en el commit (AGENTS.md, «Golden vectors»). No se usa `--update` ni `REGRESION_ACTUALIZAR=1` para hacer pasar una suite.
- Ante una discrepancia entre los dos repos, se adapta `pictures`. Los criterios del motor se cambian primero en el clasificador.
- No se borra nada solo por su nombre o su antigüedad: cada borrado lleva el grep que demuestra que no tiene consumidores (AGENTS.md, «Maintainability»).

---

### A. Los 4 fallos estables de `test_columnaorg.py`

#### S1 — Diagnóstico: el `**` de Node y el de CPython no eligen el mismo ulp (confirmado)

**Estado actual, medido de nuevo a las 12:05:** `uv run --directory services/ai-api pytest -q tests/test_columnaorg.py` da **4 fallos y 1090 aprobados** (89 s). El árbol ya se había asentado y los fallos son los mismos que en la corrida completa.

| Prueba | Línea | Valor del puerto | Valor del oráculo |
|---|---|---|---|
| `test_resultado[mezcla-solo-5]` | `tests/test_columnaorg.py:278` | `r9(anchoM)=0.908799997` (bruto `0.9087999970981991`) | `0.908799998` |
| `test_medidas_densidad_y_compra[mezcla-solo-5]` | `tests/test_columnaorg.py:349` | `0.908799997` | `0.908799998` |
| `test_resultado[mezcla-gruesa-9]` | `tests/test_columnaorg.py:324` | `globosSha=1af3d8d675c330b1f832712ae2bc3ae773316e51f4cece3907d0fe1c57785a58` | `d980741e9a57e14d3b4b7fc8119d0cb6740848381314e07c9c806860f9106128` |
| `test_resultado[mezcla-gruesa-12]` | `tests/test_columnaorg.py:324` | `globosSha=d8b4dadc7763eb23b1e9bab4c48058b7492c2fac77197ffffd13e15956423422` | `224fb28780e32b5f00930b71fccfcf6da4d8be39adb7ba9f6607e21e5fc46c26` |

**Procedimiento que se siguió.** Es reproducible y no escribe nada fuera del scratchpad. Los scripts están en el scratchpad.

1. Volcar el motor de TypeScript con el árbol actual del clasificador: `npx tsx scratchpad/colorg-ts.ts scratchpad/colorg-ts.json`. El script importa `clasificador-decoraciones/src/lib/columnaorg/{motor,limites}` y, para cada caso, ejecuta `normalizarConfig(v.entrada)`, luego `disposicionCol` y luego `pintarCol`. Vuelca los puntos de la espina, `disp.bs` y los globos a precisión completa.
   - **Resultado:** el motor de TypeScript **reproduce el oráculo**. En `mezcla-solo-5` da `anchoM=0.9087999975042639`, que con `r9` queda en `0.908799998`. El oráculo es coherente con su fuente y lo que diverge es el puerto.
2. Comparar el puerto punto por punto: `PYTHONPATH=. uv run python scratchpad/colorg-cmp.py <scratch>`.
   - **La primera diferencia está en la espina, en el punto 150 de 721.** En `mezcla-solo-5` el puerto da `x=0.11364224619124647` y TypeScript `0.11364224619124644`, un ulp de diferencia. La tangente del punto 149 hereda la diferencia, y a partir de ahí los 732 globos de `disp.bs` difieren. El empaquetado iterativo la amplifica hasta 4,06e-10 en `anchoM`, y ese valor cae justo en la frontera de `r9`: `908799997,098` frente a `908799997,504`.
   - En `mezcla-gruesa-9` y `mezcla-gruesa-12` pasa lo mismo, pero el error no alcanza a `anchoM`: solo cambia `globosSha`.
3. Aislar la causa. Con t = 150/720 = `0.20833333333333334`:
   - Node calcula `t ** 1.6 = 0.08128567569524661`, con `Math.pow` por defecto y también con `--no-use-std-math-pow`.
   - `mate.pow`, que delega en el `**` de CPython y por tanto en la UCRT de MSVC, da `0.08128567569524663`.
   - El origen está en el clasificador, `src/lib/columnaorg/espina.ts:25` (`f.inclinacionM * t ** 1.6`) y `:53` (`u ** 0.85`). En el puerto son `app/columnaorg/espina.py:41` y `:60`.
4. Contar todas las llamadas. `scratchpad/colorg-pares.py` registra cada par `(base, exponente)` que el puerto pasa a `pow` en los cuatro casos: son **3604 pares**. Node los calcula todos (`b ** e`, en `pares-node.json`).
   - `mate.pow` difiere de Node en **8**.
   - `pow_fdlibm` (`app/motores/ieee754.py:721`) difiere de Node en **350**.
   - Los exponentes de los 8 pares que fallan son 0.85 y 1.6.
5. Prueba causal (`scratchpad/colorg-parche2.py`): se sustituye en memoria `mate.pow` por la tabla de Node.
   - **Con eso, los 4 casos quedan idénticos bit a bit**: 732/732, 548/548, 316/316 y 141/141 globos, y `anchoM` coincide.
   - No hay ninguna otra fuente de divergencia.
6. ¿Quién redondea bien? Se recalcularon los 8 pares con `decimal` a 60 dígitos. Node acierta en 7 y CPython en 1. **Ninguno de los dos es un `pow` correctamente redondeado**, así que el `pow` de Node por defecto no se puede reproducir desde Python. Coincide con lo que documenta `app/motores/mate.py:13-27` y con la nota de memoria «V8 no usa la libm del sistema».
7. **Riesgo para CI.** CI corre en `ubuntu-latest` (`checks.yml:93`), donde CPython usa el `pow` de glibc, que redondea correctamente en la práctica. En Linux, el puerto coincidiría con Node en 7 de los 8 pares y fallaría en `b=0.24347777148992317, e=0.85`, que es justo donde Node se equivoca. **Hoy la suite de motores depende del sistema operativo.** No lo verifiqué en Linux: habría que descargar una imagen de Docker y eso necesita permiso.

#### S2 — Corrección: un solo `pow`, el de fdlibm, en el oráculo y en el puerto (opción B, verificada)

**Verificación ya hecha** (`scratchpad/colorg-fdlibm.py`):
- Oráculo calculado con `node --no-use-std-math-pow --import tsx colorg-ts.ts`.
- Puerto con `mate.pow = ieee754.pow`.
- Resultado: **los 4 casos son idénticos bit a bit**, incluido `anchoM`. El `anchoM` de `mezcla-solo-5` pasa a ser `0.908800045`, porque el oráculo cambia.

Cambios, en este orden:

1. **Clasificador (primero, porque es la verdad del armado):** `clasificador-decoraciones/scripts/migracion/vectores-*.ts` (10 scripts, los de arco, columna, columnaorg, organico, guirnalda, bouquet, dibujos, etc.).
   - Ejecutarlos siempre con `node --no-use-std-math-pow --import tsx scripts/migracion/vectores-<motor>.ts`, no con `npx tsx`. Lo más simple es un script de `package.json`: `"vectores:<motor>": "node --no-use-std-math-pow --import tsx scripts/migracion/vectores-<motor>.ts"`.
   - Añadir al principio de cada generador una guarda que **falle** si la opción no está activa:
     ```ts
     // Medido con Node 24.19 en Windows: el pow por defecto da 0.30094727854177367; fdlibm (--no-use-std-math-pow) da 0.3009472785417736.
     if (0.24347777148992317 ** 0.85 !== 0.3009472785417736) throw new Error("Ejecutar con node --no-use-std-math-pow");
     ```
     El par sale de S1, paso 6: es el único de los 8 en el que el `pow` por defecto de Node no coincide con el valor correctamente redondeado.
   - Escribir en el JSON `"pow": "fdlibm (--no-use-std-math-pow)"` y `"fuente_commit": "<sha del clasificador>"`.
2. **Pictures:** `services/ai-api/app/motores/mate.py:40-55`. Cambiar el cuerpo de `pow` para que, después de los casos especiales de JavaScript, devuelva `ieee754.pow(base, exponente)` en lugar de `float(base**exponente)`. Actualizar el docstring (`:13-27`) con la medida de S1: 8 de 3604 frente a 350 de 3604 y la dependencia del sistema operativo.
   - Se cambia la puerta y no cada motor, así que los 8 módulos que llaman a `mate.pow` (`arco/motor.py`, `bouquet/{medidas,motor}.py`, `columnaorg/espina.py`, `guirnalda/espina.py`, `organico/{espina,motor}.py` y `referencias/dibujos.py`) cambian a la vez.
3. **Regenerar todos los oráculos de motor desde el clasificador,** con la opción del paso 1 y el árbol del clasificador **commiteado** (ver S3). Copiarlos a `pictures/contracts/domain/v1/golden/<motor>/`. Nunca desde Python.
4. Commit en los dos repos, en el mismo PR lógico. El mensaje dice por qué cambian los sha: «el oráculo pasa a fdlibm, independiente del sistema operativo».

- **Prueba:**
  - `uv run --directory services/ai-api pytest -q tests/test_columnaorg.py tests/test_arco.py tests/test_organico.py tests/test_guirnalda*.py tests/test_ieee754.py` en Windows, y la misma suite en el job de Linux de CI.
  - Prueba nueva en `tests/test_ieee754.py`: `mate.pow(0.20833333333333334, 1.6) == 0.08128567569524661` y `mate.pow(0.24347777148992317, 0.85) == 0.3009472785417736`. Los dos valores son los de `node --no-use-std-math-pow`, medidos. Fijan la puerta.
- **Riesgo:**
  - Cambian a nivel de ulp **todas** las coordenadas de los motores y los `svgSha`, y por tanto los dibujos que se muestran.
  - Hay que confirmar que ningún plan persistido guarda coordenadas ni `svgSha`: `plan_hash` lleva la configuración del armado, no el dibujo. Comprobarlo con `grep -rn "svgSha\|globosSha" services/ai-api/app src/lib/plan`, que hoy solo debería aparecer en pruebas.
  - El dibujo que pinta el propio clasificador en el navegador, con el `pow` por defecto de Chrome, puede diferir en 1 ulp del oráculo. Es aceptable, porque el dibujo que ve el cliente de `pictures` lo produce Python.
- **Reversión:** revertir `mate.py` y los JSON de oro al commit anterior. Los dos van en el mismo commit.
- **Esfuerzo:** M (los oráculos se regeneran en minutos; la suite de motores tarda unos 20 min en Windows).

**Opción A (alternativa, más invasiva):** eliminar del motor los `**` con exponente no entero (inventario en S4) y sustituirlos por `Math.exp(e * Math.log(b))`. Habría que portar `log` de fdlibm (`e_log.c`) a `ieee754.py`, que hoy solo tiene los internos de `log` dentro de `pow` (`:695`, `:806`, `:841`), y medirlo en 4000 casos igual que `tests/test_ieee754.py`. Esfuerzo L, y cambia el código del motor en los dos repos. Solo tiene sentido si se decide que el oráculo debe coincidir también con lo que dibuja el navegador.

**Lo que no se hace:** tolerancias en `r9` ni en los sha, tablas de excepciones en Python o regenerar el oráculo desde el puerto.

#### S3 — Procedencia del oráculo

- **Archivo:** `clasificador-decoraciones/scripts/migracion/vectores-*.ts` (cabecera del JSON) y `pictures/contracts/domain/v1/golden/*/vectores-*.json`.
- **Hallazgo:** `vectores-columnaorg.json` se generó el 2026-10-04T05:53Z con el clasificador sucio (`git status`: `M src/lib/columnaorg/formas.ts`, `M src/lib/organico/{formas,tipos}.ts`). El campo `fuente` no dice qué commit lo produjo.
- **Cambio:** el generador escribe `fuente_commit` y `fuente_sucia`, este último con `git status --porcelain src/lib` no vacío. En `pictures`, cada `tests/test_<motor>.py` añade `test_oraculo_limpio` con `assert not vectores["fuente_sucia"]`, marcado `xfail(strict=False)` mientras dure la migración.
- **Prueba:** la nueva aserción.
- **Riesgo:** bajo.
- **Reversión:** quitar los dos campos.
- **Esfuerzo:** S.

#### S4 — Guarda contra potencias que dependen de la plataforma

- **Inventario en el clasificador** (`**` con exponente no entero):
  - `arco/motor.ts:248`
  - `columnaorg/espina.ts:25` y `:53`
  - `organico/espina.ts:60`, `:61`, `:63`, `:91` y `:128`
  - `organico/motor.ts:210` y `:243`
  - `guirnalda/espina.ts:49`
  - `bouquet/medidas.ts:33`, `:34` y `:49`
  - `bouquet/motor.ts:101` y `:273`

  Los `** 2` y `** 3` son exactos y no hacen falta en la lista.
- **Cambio en pictures:** prueba nueva `services/ai-api/tests/test_puerta_mate.py`. Recorre `app/**/*.py` con `ast` y falla si encuentra un `BinaryOp` con `Pow` de exponente no entero, o una llamada a `math.pow`, `math.sin`, `math.exp` y similares fuera de `app/motores/`. Todo debe pasar por `mate`.
- **Cambio en el clasificador:** una regla `no-restricted-syntax` de ESLint sobre `BinaryExpression[operator='**']` en `src/lib/{arco,columna,columnaorg,organico,guirnalda,bouquet}`, solo como aviso. Documenta qué líneas dependen de S2.
- **Prueba:** la propia prueba nueva; debe pasar sobre el `app/` actual.
- **Riesgo:** falsos positivos con exponentes enteros. Se resuelve con una lista de exponentes permitidos (`2` y `3`).
- **Reversión:** borrar la prueba.
- **Esfuerzo:** S.

---

### B. Código muerto: qué se borra y qué necesita una decisión

Orden de ejecución: **S5a → S5b → S5c → S5d** (de menor a mayor radio de impacto). Cada borrado se hace en su propio commit con el grep en el mensaje. Antes de cada uno:

```bash
cd "C:/New folder/pictures"
# Todos los greps se lanzan sobre src, packages, scripts, eval y services/ai-api. Excluyen node_modules y __pycache__.
```

#### S5 — Borrar (cero consumidores en producción, demostrado)

| ID | Archivo:línea | Qué se borra | Comprobación (debe dar exactamente lo indicado) |
|---|---|---|---|
| S5a | `src/lib/ia/referencia/reference-blueprint.ts:347-351` | `export function bboxOverlap` | `grep -rnw "bboxOverlap" src packages scripts eval` → solo la definición |
| S5b | `src/lib/ia/uzume/build-image-prompt.ts:744-751` | el envoltorio `buildLoraImagePrompt`. Producción usa `compileLoraCaption` directamente en `kagutsuchi/lora-product-runtime.ts:5,339` | `grep -rnw "buildLoraImagePrompt" src packages scripts eval` → definición y `scripts/test/test-visual-prompts.ts:2,54,83` |
| S5b' | `src/lib/ia/kagutsuchi/lora-caption-compiler.ts:1594-1596` | `buildLoraImagePromptV2`, que solo usa el envoltorio | `grep -rnw "buildLoraImagePromptV2" src packages scripts` → definición y `build-image-prompt.ts:6,750` |
| S5c | `src/lib/ia/contracts/operational-v1.ts:174-189` | `seleccionarBackendMigracion`, un selector retirado (ADR-0023 paso 5) | `grep -rnw "seleccionarBackendMigracion" src packages scripts` → definición y `scripts/test/test-operational-boundary.ts:8` |
| S5d | `.env*` (ver S8) | las variables que el código ya no lee | grep de S8 |

**Cambio exacto:**
- **S5b/S5b':** en `scripts/test/test-visual-prompts.ts:2` cambiar el import a `compileLoraCaption` (desde `../../src/lib/ia/kagutsuchi/lora-caption-compiler`). En `:54` y `:83`, sustituir `buildLoraImagePrompt({...})` por `compileLoraCaption({...}).prompt`. La prueba pasa así a cubrir la función que usa producción en lugar de un envoltorio que nadie llama.
- **S5c:** borrar las aserciones sobre `seleccionarBackendMigracion` en `test-operational-boundary.ts`. **No se pierde cobertura:** el contrato `backend-selection.v1` lo publica Python en `/internal/v1/echo` y lo valida `BackendSelectionV1Schema`, que se queda.
- **Prueba:** `npx tsc --noEmit`, `npm run -s lint`, `npm run ia:test-prompts` y `npm run contracts:test:operational`.
- **Riesgo:** mínimo. `tsc` detecta cualquier consumidor que se haya escapado.
- **Reversión:** `git revert` del commit.
- **Esfuerzo:** S.

**Opcional (S5e):** unos 50 archivos de `src/lib/{ia,lora,scene}` exportan símbolos que solo se usan dentro del propio archivo. Quitar `export` no cambia el comportamiento. No merece un PR manual. Si se quiere, se añade `knip` como devDependency (decisión: dependencia nueva) con una línea base. Esfuerzo M.

#### S6 — Cablear o decidir (necesita una persona; no se borra)

| ID | Qué | Evidencia | Decisión que hay que tomar | Recomendación |
|---|---|---|---|---|
| S6a | `services/ai-api/app/bouquet/` (`armado.py`, `armado_formas.py`, `formas.py`, `limites.py`, `medidas.py`, `motor.py`, `tipos.py`), sin commitear | `grep -rln "app\.bouquet" services/ai-api/app \| grep -v "^services/ai-api/app/bouquet/"` → vacío. Solo `tests/test_formas_listas.py:25-27` importa `formas`, `limites` y `tipos`. `armado_formas.py` y `medidas.py` no los importa nadie. `__init__.py:18` dice «Nada de esto está cableado» | ¿Se cablea el motor de bouquet al plan, como el arco orgánico, o se aparca? | **Antes de cablear, conectar el oráculo:** `golden/bouquet/vectores-bouquet.json` existe y **no lo lee ninguna prueba** (`grep -rln "vectores-bouquet" services/ai-api/tests` → vacío). Crear `tests/test_bouquet_motor.py` con la misma forma que `test_columnaorg.py`. Sin eso, el puerto no está verificado. Esfuerzo M |
| S6b | `services/ai-api/app/arco/secciones.py` | `grep -rn "secciones" services/ai-api/app --include=*.py \| grep import` → vacío. Solo lo usa `tests/test_arco.py:28` | Es un puerto 1 a 1 de `clasificador/src/lib/arco/secciones.ts`. ¿Lo usa el editor de arco? | Cablearlo al editor del arco o anotar en el `__init__` por qué está. No borrarlo: es parte del puerto. S |
| S6c | `src/lib/scene/*` (orchestrator, optimizer, recipes, resolver, coverage, invariants y hashes) | Solo `registro-herramientas.ts:1110-1113` llega a él, vía `sceneShadowPipeline` y detrás de `SCENE_PLAN_V2_SHADOW` (apagada por defecto, `false` en `.env.example:91`). No devuelve plan. Lo cubren `scripts/test/test-scene-*.ts` | ¿Se sigue midiendo la sombra V2? | Si nadie consulta esas métricas: retirar la llamada de sombra (`registro-herramientas.ts:74`, `:1110-1135`), la bandera y luego el directorio, en un PR separado. `scene/tipos.ts` **no** se borra: lo importan `plan/*` y `ordenes/*`. M |
| S6d | `src/lib/ia/idempotencia/store.ts` | La aplicación no lo importa. Solo lo usa `scripts/test/test-idempotency-store.ts`, que CI ejecuta (`checks.yml:71`) | AGENTS.md pide idempotencia para trabajo largo. ¿Era la base de un trabajo futuro? | Mantenerlo y documentar el consumidor previsto, o borrar el store y su prueba de CI juntos. S |
| S6e | `src/lib/ia/inari/parse.ts` y la bandera `INTENT_PARSER_PYTHON_ENABLED` | La aplicación no lo alcanza. Solo lo usan `scripts/bench/*` y `scripts/eval/*`, así que la bandera (`feature-flags.ts`, `INTENT_PARSER_PYTHON_ENABLED`) gobierna código inalcanzable | ¿El parser de Inari sigue vivo como herramienta de evaluación? | Moverlo a `scripts/lib/` si es solo de evaluación, y retirar la bandera de `feature-flags.ts`. S |
| S6f | `src/app/api/lora/compatibility/route.ts` y `src/app/api/lora/modes/route.ts` | `grep -rn "lora/compatibility\|lora/modes" src/components src/app --include=*.tsx` → vacío | ¿Son para un consumidor externo o para la consola de LoRA? | Si no hay consumidor externo, borrarlos. Si lo hay, documentarlo en la ruta. S |
| S6g | Endpoint de Python de Inari | `python-adapter.ts:2720` lo llama, pero solo desde `inari/parse` (S6e) | Va con S6e | — |

---

### C. Higiene de variables de entorno

#### S7 — Bloque nuevo de `.env.example` (sustituye las líneas 35-37, 40-76 y 91-95)

- **Archivo:** `.env.example:35-37`, `:40-76` y `:91-95`.
- **Cambio exacto:** borrar `PYTHON_BACKEND_ENABLED`, `PYTHON_BACKEND_KILL_SWITCH` (`:36-37`), `IMAGE_QA_ENABLED` (`:73`) y `SCENE_PLAN_V2_{ENABLED,REQUIRE_VERIFIED_SOURCES,VISUAL_QA,KILL_SWITCH}` (`:92-95`). Sustituir el bloque de banderas por:

```dotenv
# ============================================================================
# Banderas de imagen, análisis de foto y armado. Única fuente: src/lib/ia/nucleo/feature-flags.ts.
# Los valores escritos aquí son los DEFAULTS del código; dejar la línea comentada = default.
# "dev" = encendida si NODE_ENV!=production, apagada en producción.
# ============================================================================

# --- Análisis de la foto de referencia (Amaterasu) ---------------------------
# Una sola llamada de visión con las cuatro lecturas (variante v17-lectura-unica).
# Cambia el prompt congelado de producción (v16): invalida la línea base de ADR-0029.
# Encendida, las cuatro *_REFERENCIA_PYTHON_ENABLED de abajo no se leen.
LECTURA_UNICA_REFERENCIA_ENABLED=false
# Lecturas por separado (una llamada a Gemini vía Python cada una, en paralelo).
PATRON_REFERENCIA_PYTHON_ENABLED=false      # ADR-0028 §11: patrón de color por estructura
BOUQUET_REFERENCIA_PYTHON_ENABLED=false     # ADR-0030: armado de cada bouquet
CONTEO_REFERENCIA_PYTHON_ENABLED=false      # ADR-0031 E1: conteo de globos por estructura
GUIRNALDA_REFERENCIA_PYTHON_ENABLED=false   # ADR-0032 E4: armado de guirnaldas (y reubicación)
# Caché en memoria del análisis (misma foto + mismo prompt). Off desde 2026-09-25.
REFERENCE_ANALYSIS_CACHE_ENABLED=false
# Paleta medida sobre píxeles en lugar del orden de redacción del analizador (cambia lo que se compra).
MEASURED_COLOR_DOMINANCE_V1=false
# Colores medidos por croquis + referencia Sempertex; va fuera del blueprint (no toca plan_hash). Default "dev".
# ANALISIS_COLOR_SEMPERTEX_V1=
# Solo navegador: corta el flujo tras el análisis (sin chat, plan ni cotización).
NEXT_PUBLIC_SOLO_ANALISIS_FOTO=false

# --- Del análisis al plan (al confirmar) -------------------------------------
PATRONES_COLOR_V1=false       # ADR-0028: Python pone patrón (pista de la foto o preset). Apagarla no quita patrones.
BOUQUETS_ARMADO_V1=false      # ADR-0030: armado de bouquets desde la lectura o la receta.
GUIRNALDAS_ARMADO_V1=false    # ADR-0032: armado de guirnaldas por receta.
CONTEO_REFERENCIA_V1=false    # ADR-0031 E2: ajusta kits/medidas/mezcla al conteo leído.
# ADR-0034 §5: herramientas del motor del diseñador (arco, columna, guirnalda orgánica) y patrón de la
# foto hacia el motor (ADR-0039). Cambia plan_hash. Default "dev".
# ARMADO_ARCO_COLUMNA_V1=
# ADR-0038: herramienta de solo lectura estimar_conteo_globos. Default "dev".
# ESTIMAR_CONTEO_V1=

# --- Generación de la imagen -------------------------------------------------
IA_PROVEEDOR=gemini
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image   # default en src/lib/gemini.ts:4 y app/uzume/interaction.py:29
GEMINI_CHAT_MODEL=gemini-3.6-flash          # default en src/lib/gemini.ts:3
GUIA_ESTRUCTURA_V1=false          # ADR-0033: mapa de color + carta por /edit del LoRA (~US$0,042 est./imagen)
SEMPERTEX_LORA_EDIT=true          # solo el literal "false" apaga /edit del LoRA (interruptor de retiro)
VENUE_AWARE_PLACEMENT_V1=false    # colocación según el venue (fase 6.A)
AMBIENTE_FIESTA_V1=false          # props de ambiente no cotizados (fase 6.B)
REFERENCIA_EN_ETAPA1_V1=false     # referencia como píxeles a la etapa 1 del LoRA (fase 4)
# Default: true en development, false en el resto.
# IMAGE_DEBUG=
# Solo development: modo LoRA training_2.
# NEXT_PUBLIC_LORA_MODE=training_1
# Solo development: permite artefactos LoRA rechazados.
# LORA_ALLOW_REJECTED_FOR_TESTING=false

# --- Llamadas generativas enrutadas a Python (ADR-0026) ----------------------
GEMINI_IMAGE_PYTHON_ENABLED=false
LORA_GENERATION_PYTHON_ENABLED=false
REFERENCE_ANALYSIS_PYTHON_ENABLED=false
CHAT_PYTHON_ENABLED=false
HAPPIE_PYTHON_ENABLED=false

# --- Plan (Next y ai-api: PLAN_COST_OPTIMIZER_V2 lo leen los DOS procesos) ----
PLAN_COST_OPTIMIZER_V2=true
PLAN_BUDGET_GATE_V2=true
SCENE_PLAN_V2_SHADOW=false        # ver S6c

# --- ai-api (services/ai-api/app/main.py:243-256, :1342) ---------------------
# APP_ENV=development             # o ENVIRONMENT; "production" endurece la auth
# RERANK_MODEL_WARMUP=false
```

- **Prueba:** S10 (`npm run env:test-banderas`) en verde.
- **Riesgo:** ninguno en tiempo de ejecución: `.env.example` no se carga. Hay que copiar los defaults **exactos** del código; S10 lo comprueba.
- **Reversión:** `git checkout -- .env.example`.
- **Esfuerzo:** S.

#### S8 — Variables retiradas que hay que quitar de los cuatro archivos

Comprobación previa: cada nombre debe dar **cero** resultados en código:
```bash
for n in PYTHON_BACKEND_ENABLED PYTHON_BACKEND_KILL_SWITCH PLAN_DECORACION_ENABLED RAG_FRANJAS_ENABLED RAG_MIN_SIMILARITY RAG_VECTOR_LIMIT GEMINI_EMBEDDING_MODEL GEMINI_EMBEDDING_DIMENSIONS IMAGE_QA_ENABLED IMAGE_QA_NON_BLOCKING SCENE_PLAN_V2_ENABLED SCENE_PLAN_V2_KILL_SWITCH SCENE_PLAN_V2_REQUIRE_VERIFIED_SOURCES SCENE_PLAN_V2_VISUAL_QA SEMPERTEX_LORA_URL; do
  echo "$n $(grep -rlw "$n" src packages services/ai-api/app --include=*.ts --include=*.tsx --include=*.py | grep -v '\.test\.\|generated' | wc -l)"; done
# Resultado esperado: 0 en todas. Hoy PYTHON_BACKEND_* aparece 1 vez, solo en un comentario de operational-v1.ts:176.
```

| Variable | `.env.example` | `.env.local.example` | `.env.local` | `.env.production` |
|---|---|---|---|---|
| `PYTHON_BACKEND_ENABLED` | `:36` | `:26` | `:30` | `:29` |
| `PYTHON_BACKEND_KILL_SWITCH` | `:37` | `:27` | `:32` | `:31` |
| `PLAN_DECORACION_ENABLED` | – | – | `:12` | `:11` |
| `RAG_FRANJAS_ENABLED` | – | – | `:13` | `:12` |
| `RAG_VECTOR_LIMIT` | – | `:20` | `:14` | `:13` |
| `RAG_MIN_SIMILARITY` | – | `:22` | `:16` | `:15` |
| `GEMINI_EMBEDDING_MODEL` y `_DIMENSIONS` | – (el código los fija; ya lo dice `.env.example:18`) | `:17-18` | `:9-10` | `:8-9` |
| `IMAGE_QA_ENABLED` | `:73` | – | – | – |
| `IMAGE_QA_NON_BLOCKING` | – | `:57` | – | – |
| `SCENE_PLAN_V2_{ENABLED,REQUIRE_VERIFIED_SOURCES,VISUAL_QA,KILL_SWITCH}` | `:92-95` | – | – | – |
| `SEMPERTEX_LORA_URL` | – | `:32` | – | – |

- **Cambio:** borrar esas líneas.
  - `.env.local` y `.env.production` están ignorados por git (`.gitignore:34`). Los edita el usuario a mano, no un PR.
  - **El entorno real de producción vive en el servidor** (`deploy.yml` solo ejecuta `/home/ec2-user/deploy-demo-decoracion.sh`). Hay que repetir la limpieza allí, y antes compararlo con `.env.production`, que es del 16 de septiembre y probablemente está viejo.
- **Prueba:** S10 pasa sin la lista de excepciones de «retiradas».
- **Riesgo:** bajo. Si una variable resultara leída por un script de despliegue fuera del repo, se rompería allí. Por eso hay que revisar el script del servidor.
- **Reversión:** volver a añadir la línea.
- **Esfuerzo:** S.

#### S9 — Registrar al arrancar el valor efectivo de cada bandera (sin secretos)

**Next:** archivo nuevo `src/instrumentation.ts`. Es la convención de Next 16.3: `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md:17,43,72`, con `src/` junto a `app/` y la rama `NEXT_RUNTIME`.
```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumenBanderas } = await import("@/lib/ia/nucleo/feature-flags");
  // Una línea JSON, solo nombres → booleano o nombre de modelo. Nunca valores de claves.
  console.info(JSON.stringify({ evento: "banderas_efectivas", servicio: "next", ...resumenBanderas() }));
}
```
En `src/lib/ia/nucleo/feature-flags.ts`, añadir y exportar:
```ts
const BANDERAS_IMAGEN: readonly FeatureFlag[] = ["PATRONES_COLOR_V1","BOUQUETS_ARMADO_V1","GUIRNALDAS_ARMADO_V1","ARMADO_ARCO_COLUMNA_V1","ESTIMAR_CONTEO_V1","CONTEO_REFERENCIA_V1","MEASURED_COLOR_DOMINANCE_V1","ANALISIS_COLOR_SEMPERTEX_V1","GUIA_ESTRUCTURA_V1","VENUE_AWARE_PLACEMENT_V1","AMBIENTE_FIESTA_V1","REFERENCIA_EN_ETAPA1_V1","SCENE_PLAN_V2_SHADOW","PLAN_COST_OPTIMIZER_V2","PLAN_BUDGET_GATE_V2"];
export function resumenBanderas(): Record<string, boolean | string> {
  return {
    node_env: process.env.NODE_ENV ?? "unset",
    ...Object.fromEntries(BANDERAS_IMAGEN.map((n) => [n, featureEnabled(n)])),
    LECTURA_UNICA_REFERENCIA_ENABLED, PATRON_REFERENCIA_PYTHON_ENABLED, BOUQUET_REFERENCIA_PYTHON_ENABLED,
    CONTEO_REFERENCIA_PYTHON_ENABLED, GUIRNALDA_REFERENCIA_PYTHON_ENABLED, REFERENCE_ANALYSIS_CACHE_ENABLED,
    GEMINI_IMAGE_PYTHON_ENABLED, LORA_GENERATION_PYTHON_ENABLED, REFERENCE_ANALYSIS_PYTHON_ENABLED, CHAT_PYTHON_ENABLED,
    SEMPERTEX_LORA_EDIT: process.env.SEMPERTEX_LORA_EDIT !== "false", IMAGE_DEBUG,
    GEMINI_IMAGE_MODEL: MODELO_IMAGEN, GEMINI_CHAT_MODEL: MODELO_CHAT,   // nombres de modelo, no secretos
  };
}
```
La lista es **explícita**, nunca `Object.keys(process.env)`. Así no puede entrar `*_KEY`, `*_SECRET`, `DATABASE_URL` ni `APP_PASSWORD`. `MODELO_*` se importa de `src/lib/gemini.ts:3-4`.

**ai-api:** en `services/ai-api/app/main.py:1325`, dentro de `lifespan` y antes del `start()` del store:
```python
logger.info("banderas_efectivas %s", json.dumps({
    "servicio": "ai-api",
    "environment": current_settings.environment,
    "PLAN_COST_OPTIMIZER_V2": _plan_cost_optimizer_v2(),   # la misma función que plan.py:2380-2383
    "RERANK_MODEL_WARMUP": os.getenv("RERANK_MODEL_WARMUP", "").strip().lower() in {"1", "true", "on"},
    "hmac_configurado": bool(current_settings.hmac_secret),  # booleano, nunca el valor
    "database_configurada": bool(current_settings.database_url),
}))
```
Hay que exponer la función de `plan.py:2380` con un nombre público, o importarla, para no duplicar la regla.

- **Prueba:**
  - Script nuevo `scripts/test/test-resumen-banderas.ts`. Con `process.env` controlado, comprueba que `resumenBanderas()` coincide con `featureEnabled` para cada nombre, que con `NODE_ENV=production` da `ARMADO_ARCO_COLUMNA_V1=false`, y que ningún valor serializado contiene el valor de una variable `*_KEY`/`*_SECRET` sembrada en la prueba.
  - En pytest: `caplog` sobre `create_app(...)` con `TestClient` comprueba la línea y que no contiene el valor sembrado de `INTERNAL_HMAC_SECRET`.
- **Riesgo:** bajo. Es una línea de log por arranque. `instrumentation.ts` se ejecuta en cada worker de Node.
- **Reversión:** borrar `src/instrumentation.ts` y la línea de `lifespan`.
- **Esfuerzo:** S–M.

#### S10 — Prueba: toda bandera leída está documentada, y toda variable documentada se lee

- **Archivo nuevo:** `scripts/test/test-banderas-documentadas.ts`, con su script `"env:test-banderas"` en `package.json` y encadenado al final de `plan:test`.
- **Algoritmo:**
  1. **Leídas en TypeScript:** expresiones regulares `process\.env\.([A-Z0-9_]+)` y `process\.env\[["']([A-Z0-9_]+)["']\]` sobre `src` y `packages/*/src`, excluyendo `*.test.ts`. Más los miembros del tipo `FeatureFlag` de `feature-flags.ts:6-21`, que se leen con nombre variable (`:24`).
  2. **Leídas en Python:** con `ast`, o con la expresión `os\.(?:getenv|environ\.get)\(\s*["']([A-Z0-9_]+)` sobre `services/ai-api/app`.
  3. **Documentadas:** nombres de `.env.example` que coinciden con `^#?\s*([A-Z][A-Z0-9_]+)=`. Una línea comentada cuenta como documentada con el valor por defecto.
  4. **Plataforma:** lista de excepciones explícita y mínima: `NODE_ENV`, `NEXT_RUNTIME`, `APPDATA`, `LOCALAPPDATA`, `OPENCODE_BIN`, `OPENCODE_CAPTION_MODEL` y `OPENCODE_CAPTION_VARIANT`.
  5. `assert` que `leídas − documentadas − plataforma` es vacío. El mensaje dice el nombre y `archivo:línea`.
  6. `assert` que `documentadas − leídas` es vacío. Esto detecta las retiradas de S8. Excepciones: variables de infraestructura que el código no lee (`POSTGRES_*`, `POSTGRES_BIND_HOST`, `POSTGRES_PORT`), cada una con su motivo escrito.
  7. Bonus: para cada `FeatureFlag`, el valor en `.env.example` coincide con `featureEnabled(n)` evaluado con `process.env` vacío y `NODE_ENV=production`. Las líneas comentadas valen como «default dev».
- **Prueba:** sobre el árbol actual debe **fallar** y listar lo de S7 y S8. Pasa cuando S7 y S8 están aplicados.
- **Riesgo:** falsos positivos con nombres construidos dinámicamente. Hoy solo existe `feature-flags.ts:24`, que ya está cubierto por el paso 1.
- **Reversión:** quitar el script de `plan:test`.
- **Esfuerzo:** S.

#### S11 — Desfase entre local y producción en lo que afecta a la imagen (decisión, no código)

- **Hechos:**
  - `.env.local` enciende `LECTURA_UNICA_REFERENCIA_ENABLED`, que pasa el análisis a v17 cuando producción usa v16 congelado (`feature-flags.ts:270`, `src/app/api/references/analyze/route.ts:50,64`). También enciende `MEASURED_COLOR_DOMINANCE_V1` (`analizar-referencias-v2.ts:733`) y `PATRON_REFERENCIA_PYTHON_ENABLED`. **Ninguna está en `.env.production`.**
  - Con `NODE_ENV=production`, `ARMADO_ARCO_COLUMNA_V1` está apagada (`feature-flags.ts:86`). Así, la ruta de ADR-0039 (el patrón de la foto llega al motor, `registro-herramientas.ts:1200,1233`) está **inactiva en producción**, y `PATRONES_COLOR_V1` también (`:1185`, default OFF en `:53`).
- **Cambio:** una de dos.
  - (a) Que `.env.local` refleje producción y se use un `.env.local.experimento` aparte para v17 y dominancia.
  - (b) Anotar en `SEGUIMIENTO.md` que todas las mediciones locales de imagen se hicieron con v17 y dominancia medida.

  Con S9 en marcha, la línea `banderas_efectivas` del servidor dice la verdad sobre producción.
- **Esfuerzo:** S (decisión) y M (si se encienden en producción tras la evaluación de ADR-0029).

---

### D. CI

#### S12 — `plan:test-color-escena` no puede saltarse un vector sin decirlo

- **Archivos:** `scripts/test/test-color-escena-produccion.ts:68-72` (el `continue` cuando falta `expected`) y `:100-103` (el mensaje de omitidos). También `scripts/lib/vectores-golden.ts:267-269` (`tienePlanFijado`) y `scripts/test/test-invariantes-plan.ts:376-378`, que se salta los mismos vectores.
- **Hecho:** `contracts/domain/v1/golden/plan-resolution/32-pared-organica-zonas-tres-colores.json` trae `expected_python` y no `expected` (claves: `allowlist`, `catalog_rows`, `catalog_snapshot_id`, `description`, `expected_python`, `lora_variant_ids`, `name`, `plan`). Hoy se informa de 31 de 32 y la prueba pasa.
- **Cambio exacto:**
  1. Fichero nuevo `scripts/fixtures/vectores-sin-plan-fijado.json`:
     ```json
     { "32-pared-organica-zonas-tres-colores": { "motivo": "expected sin congelar a mano tras e70d5c3/83a4b02 (zonas)", "caduca": "2026-10-31" } }
     ```
  2. En `vectores-golden.ts`, exportar `vectoresSinPlanFijadoPermitidos()`, que lee ese fichero.
  3. En `test-color-escena-produccion.ts`, después del bucle:
     ```ts
     const permitidos = vectoresSinPlanFijadoPermitidos();
     assert.deepEqual(new Set(sinPlanFijado), new Set(Object.keys(permitidos)),
       `vectores sin \`expected\` no declarados (o declarados que ya lo tienen): ${sinPlanFijado.join(", ")}`);
     for (const [n, { caduca }] of Object.entries(permitidos)) assert.ok(new Date() < new Date(caduca), `${n}: la excepción caducó el ${caduca}; congelar su expected a mano`);
     ```
     Lo mismo en `test-invariantes-plan.ts:378`.
  4. **La solución de fondo es humana:** una persona revisa las cifras de `expected_python` del vector 32 frente a la regla de negocio y escribe `expected` a mano, con la razón en el commit. **No se copia `expected_python` a `expected` con un script**: eso convertiría el oráculo en un espejo (AGENTS.md, «Golden vectors»). Hecho eso, se borra la entrada del fichero de excepciones.
- **Prueba:**
  - Si se añade un vector sin `expected` y sin declarar, `npm run plan:test-color-escena` falla.
  - Si se borra la línea de la excepción, falla.
  - Si se pone una fecha de caducidad pasada, falla.
- **Riesgo:** bajo. CI ya ejecuta `plan:test` (`checks.yml:68`), así que no hace falta otro paso en el workflow.
- **Reversión:** revertir los tres archivos.
- **Esfuerzo:** S.

#### S13 — La suite de motores, en Windows y en Linux

- **Archivo:** `.github/workflows/checks.yml:76-93` (job de Python).
- **Cambio:** convertir el job de Python en una matriz `os: [ubuntu-latest, windows-latest]`, o al menos ejecutar `pytest tests/test_ieee754.py tests/test_columnaorg.py tests/test_arco.py tests/test_organico.py` en `windows-latest`. S1, paso 7, muestra que la igualdad bit a bit con el oráculo depende de la libm. Después de S2 la matriz debe quedar en verde en los dos sistemas. Si no, S2 no está completo.
- **Riesgo:** el job de Windows dura unos 22 minutos. Se puede limitar a las pruebas de motor.
- **Reversión:** quitar la entrada de la matriz.
- **Esfuerzo:** S.

---

### E. Definición de terminado

Ejecutar en este orden. Todos en verde, **sin** `--update`, sin `REGRESION_ACTUALIZAR=1` y sin oráculos regenerados desde Python:

```bash
cd "C:/New folder/pictures"
npm run build --workspaces --if-present
npm run contracts:check
uv run --directory services/ai-api python scripts/generate_models.py --check
npx tsc --noEmit && npm run -s lint && npm run plan:test        # incluye env:test-banderas (S10) y la regla de S12
uv run --directory services/ai-api pytest -q                     # 0 fallos (hoy: 4 en test_columnaorg.py)
uv run --directory services/ai-api ruff check app tests && uv run --directory services/ai-api mypy app
uv run --directory services/ai-api ruff check app scripts tests && uv run --directory services/ai-api ruff format --check app scripts tests && uv run --directory services/ai-api mypy app scripts   # lo que corre CI
uv lock --check --directory services/ai-api
npm run build                                                    # cambios de integración (S9, instrumentation.ts)
```

Lista de comprobación:
- [ ] **S1/S2:** `tests/test_columnaorg.py` en 0 fallos en Windows **y** en Linux (S13). `mate.pow` delega en `ieee754.pow`. Los oráculos de motor están regenerados **desde el clasificador** con `--no-use-std-math-pow` y llevan `pow: fdlibm`.
- [ ] **S3:** cada `vectores-*.json` trae `fuente_commit` y `fuente_sucia=false`.
- [ ] **S4:** `test_puerta_mate.py` en verde.
- [ ] **S5:** greps de la tabla S5 en cero. `npm run ia:test-prompts` y `npm run contracts:test:operational` en verde.
- [ ] **S6:** una decisión escrita (en el PR o en `SEGUIMIENTO.md`) para cada S6a–S6f. Si S6a se cablea, existe `tests/test_bouquet_motor.py` y lee `vectores-bouquet.json`.
- [ ] **S7/S8:** el `.env.example` nuevo. Las retiradas fuera de los cuatro archivos y del entorno del servidor de EC2.
- [ ] **S9:** `npm run dev` y el arranque de ai-api imprimen una línea `banderas_efectivas` sin valores secretos. `test-resumen-banderas.ts` y la prueba de `caplog` están en verde.
- [ ] **S10:** `npm run env:test-banderas` en verde.
- [ ] **S11:** la decisión sobre la paridad entre local y producción está registrada.
- [ ] **S12:** `plan:test-color-escena` falla ante un vector sin `expected` no declarado. El vector 32 tiene `expected` congelado a mano, o una excepción vigente.
- [ ] Informe final: qué comandos se ejecutaron, con sus resultados, y qué quedó sin ejecutar (AGENTS.md, «Verification and completion»).

Material de diagnóstico en el scratchpad: `colorg.txt` (pytest -vv), `colorg-ts.ts`, `colorg-cmp.py`, `colorg-pares.py`, `pares-node.json`, `colorg-parche2.py`, `colorg-fdlibm.py`, `colorg-ts.json` y `colorg-ts-fdlibm.json`.
