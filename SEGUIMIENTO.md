# Seguimiento · estado y pendientes

Escrito el 2026-09-16 al final de una sesión larga y ampliado al cierre de cada
pasada. Está pensado para que quien lo lea mañana —o una sesión nueva sin
memoria— pueda continuar sin volver a descubrir nada. Cada afirmación lleva de
dónde sale.

> **Al día 2026-10-02.** Se trabaja en `main`, y `main` dispara *Quality checks*
> y, si pasan, el despliegue a EC2 (`.github/workflows/deploy.yml`): **lo que
> entra aquí se despliega**. El `ai-api` **no** se despliega solo — va a mano al
> EC2 de `n8n-maros`, así que la app nueva hablaría con un `ai-api` viejo hasta
> que se suba; desplegar los dos juntos. Las secciones 1 a 7 son de la pasada
> del 2026-09-16 y su cabecera original decía `fase-a/a0-linea-base` y «nada
> desplegado»: eso ya no es cierto. Lo que sigue vigente de ellas es el
> **pendiente**, no el estado.
>
> Las pasadas del 2026-10-01 y 2026-10-02 están en §8 y §9 y en sus ADR (0034 a
> 0039). El port 1 a 1 del arco y la columna que se hizo el 2026-10-01 **se
> revirtió** el 2026-10-02 (`ee5db0f`): había dos migraciones del mismo motor en
> marcha y se quedó la que tiene 531 vectores de oro. Sus tres documentos de
> seguimiento se borraron por eso.

---

## 0. Patrones de color por estructura (2026-09-24, rama `feat/patrones-color`)

Sale de `fase-a/a0-linea-base` (459b9d6). **Nada desplegado.** Decisión y
especificación: `docs/architecture/decisions/0028-patrones-de-color-por-estructura.md`.

**Qué es.** Cada estructura del plan puede llevar `patron_color`: dónde va cada
color (espiral, zig-zag, franjas rectas, anillos, bloques, degradé, confeti,
flores, damero/diagonal en pared, acentos cada N, globos pintados a mano). Python
lo expande a una rejilla de racimos o filas, cuenta los globos de cada color (el
patrón manda sobre la cotización), escribe la hoja de armado y la frase del
prompt de imagen. El decorador lo edita en una gráfica numerada como la del
curso Sempertex, con vista 3D, sin botón "Aplicar" (guardado automático), y la
columna se redibuja mientras arrastra el reparto de colores de un confeti.

**Reparto de dueños (regla del usuario: la lógica de IA vive en Python).**
- Python: `app/patron_color.py` (expansión, conteo, presets, textos),
  `app/plan.py` (conteo con patrón, `patrones_color` fuera del hash),
  `app/plan_edicion.py` (toda la edición del plan, migrada desde TypeScript),
  `app/plan_worker.py` (CPU fuera del bucle), `app/amaterasu/patron_referencia.py`
  (detección del patrón en la foto con Gemini).
- TypeScript solo dibuja y transporta: `src/components/plan/patron/*`,
  `/api/plan-patron` (vista previa), `/api/plan-editar` (acción `patron`).
- Adaptador temporal que queda: la frase del patrón se inserta en los prompts
  de imagen TypeScript (`build-image-prompt.ts`, compilador LoRA) hasta que el
  prompt de imagen completo migre a Python.

**Cómo encenderlo.** Dos banderas, apagadas por defecto en código y encendidas
en `.env.local`: `PATRONES_COLOR_V1` (Python asigna el patrón al confirmar) y
`PATRON_REFERENCIA_PYTHON_ENABLED` (lee el patrón en la foto; una llamada de
visión por foto, con caché por foto). En producción: desplegar app y `ai-api`
juntos y encender las dos a la vez. Revertir deja inválidas las propuestas
abiertas que ya tengan `patron_color` (ver ADR, Consecuencias).

**Correr local en Windows.** `uvicorn --reload` lanzado sin consola se cuelga al
recargar y sigue sirviendo código viejo (pasó dos veces el 2026-09-24). Usar
`python scripts/ops/supervisar-ai-api.py`, que reinicia el servicio al cambiar
un `.py` (AGENTS.md lo explica).

**Verificado** (árbol final): pytest 611, `npm run plan:test` completo (224
PASS, 0 FAIL), tsc, lint (0 errores), `contracts:check`, `generate_models
--check`, ruff, mypy. Los 28 vectores dorados previos no cambian; 29–31 son de
patrones. Integración real sin LLM (Next → Python → catálogo Neon) en
`scratchpad`: confirmar, editar (patrón, repartir, mezcla, quitar) y vista
previa, con conteos, hash y firmas coherentes.

**Latencias medidas en local** (Neon a ~66–250 ms por viaje): vista previa del
editor ~140 ms (antes ~265; lo que queda es la escritura del nonce
anti-repetición), vista previa del deslizador en vivo 36–52 ms p90; guardar dos
cambios seguidos resuelve una vez, no dos.

**Pendiente, con dueño a decidir:**
1. **Medir la fidelidad de la imagen con patrón.** El LoRA casi no vio patrones
   en su entrenamiento (v005: 8 "alternating"; v007: 0). Hace falta una corrida
   de evaluación con tope de gasto: Gemini vs LoRA vs híbrido con patrón.
   Opciones si el LoRA no sigue la espiral: mandar a Python un esquema del
   patrón como imagen de referencia, o capturas con patrones en el próximo
   dataset (decisión de una persona).
2. **Pedir el patrón por chat** ("haz la columna en espiral blanco, negro y
   azul") no está: el prompt y las herramientas de Omoikane siguen en
   TypeScript y habría que migrarlos primero.
3. Migrar el prompt de imagen completo a Python para retirar el adaptador.
4. Límite de frecuencia por sesión en `/api/plan-patron` (hoy la interfaz ya
   manda una petición a la vez).

---

## 1. Qué se hizo hoy

### 1.1 El incidente que lo arrancó todo

Una propuesta falló en local con `ESTIMACION_INCONSISTENTE` cuatro veces y
después `PLAN_NO_CONVERGE`; el mensaje que vio el cliente lo inventó el modelo.

Causa: el proceso `uvicorn` local llevaba desde el día anterior sirviendo el
`plan.py` que cargó al arrancar, anterior al commit `e79e8f0`, que había
redefinido `additional_waste_packages` y `waste_only_savings_cop` **dentro del
mismo `design-material-estimate-v1`**. Next ya usaba las definiciones nuevas y
recalculaba los totales de Python para compararlos; Python devolvía los viejos.
El esquema los aceptaba —son números válidos— y la incoherencia solo aparecía
una capa después.

Los vectores dorados no lo vieron y no podían: comparan código contra código, no
contra el proceso que responde.

**Lección operativa, que volvió a morder el mismo día:** en local, `uvicorn` se
arranca **siempre con `--reload`**. Sin él sirve el `plan.py` que cargó. Volvió a
pasar por la tarde, cuando añadí `costes_por_estructura` al contrato y el
servicio seguía emitiendo la forma vieja: el chat respondió *"no pude verificar
la propuesta contra el catálogo"* (`BACKEND_NO_DISPONIBLE` /
`PYTHON_INVALID_RESPONSE` en `plan_audit_log`, 16:29:39).

Comando correcto:

```
cd services/ai-api && uv run --system-certs --env-file ../../.env.local \
  uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 1.2 ADR-0023 · un solo dueño de las reglas de conteo

Dieciocho funciones de `plan.py` declaraban en su docstring ser "mirror of" su
gemela en TypeScript: ~2.350 líneas de Python cubriendo lo mismo que ~1.730 de
TypeScript, contra lo que pide `AGENTS.md`. El ADR que lo ordenaba se borró al consolidar la documentación; sus reglas
vivas están en `AGENTS.md`. El orden se corrigió dos veces mientras se
ejecutaba: primero porque la geometría no corría "siempre en producción" como
creíamos —estaba filtrada del modo plan—, y después porque portar la puerta
física antes de borrar el resolutor no abría nada.

| Paso | Qué | Commit |
|---|---|---|
| 1 | Toda imagen sale de una propuesta aprobada | `dcc47ae` |
| 2 | Se retira el modo legacy de chat | `8450bcc` |
| 3 | Los vectores dorados congelan su bloque `expected` | `4e9290c` |
| 4a | Python mide la puerta física; geometría cubierta en pytest | `541cf1c` |
| 4b | Se borra el pipeline de franjas de presupuesto | `e2b52a8` |
| 5 + 6 | Se borra el resolutor TypeScript y el kill switch | **sin commitear** |

Otros commits del día: `2ac7647` (la puerta de totales nombra los campos que no
cuadran), `2d1a261` (el ADR), `16ee52a` (el hueco de scroll), `fd17ee5`
(migraciones 024 y 025 aplicadas en Neon).

### 1.3 Hallazgos que salieron por el camino

- **Mientras existió `--update`, `expected` no era un oráculo**: lo recalculaba
  el propio resolutor TypeScript, así que era la salida de hoy del código que
  decía vigilar. Se retiró; ahora cambiar un vector es editar su JSON a mano y
  justificarlo en el commit.
- **Ningún test pasaba la estimación *de Python* por `validateMaterialEstimate`**,
  que es la puerta que la juzga en producción. Solo se validaban las de
  TypeScript, que no pueden fallarla porque `estimateFromPlan` las construía con
  la misma función `totals()` que después las comprobaba.
- **El hueco vacío bajo el compositor** eran los textos `sr-only`: Tailwind los
  hace `position: absolute` sin `top`/`left`, y sin ancestro posicionado su
  bloque contenedor era el documento entero, así que escapaban al recorte del
  log y estiraban la página (900 → 1579 px). Se cerró con `position: relative`
  en `.app-log`. Se diagnosticó **midiendo con Playwright**, después de dos
  intentos fallidos razonando desde capturas.

---

## 2. Lo que está a medio commitear (primero al abrir)

El paso 5+6 está **completo y verde pero sin commitear**: `tsc` limpio, `lint`
0 errores, pytest 203 passed, y la batería `npm run plan:test` en exit 0.

Qué contiene:

- Borrados `src/lib/plan/resolver.ts`, `src/lib/medidas/geometria.ts`,
  `src/lib/plan/optimizar-materiales.ts`, `src/lib/cotizacion/constantes.ts`,
  `estimateFromPlan`, `cotizarPlan`, `physicalWarningsForPlan`.
- `resolver-backend.ts` sin ramas: exporta `resolverPlan(entrada)` contra Python.
- Kill switch retirado: `PYTHON_BACKEND_ENABLED` y `PYTHON_BACKEND_KILL_SWITCH`
  ya no se leen; `seleccionarBackendMigracion()` devuelve siempre `python`.
- `validateMaterialEstimate` reducida a un invariante estructural (capacidad ≥
  demanda con merma). **Dejó de recalcular los catorce totales**, que era el
  segundo dueño que causó el incidente.
- Sobrevive `src/lib/plan/mezclas.ts` con la tabla de mezclas, el parseo de
  tamaños obligatorios y `sustitucionAdmisible` (ver deuda en §4).
- Escenografía no-globo: elementos detectados que no son globos llegan al prompt
  en vez de acabar en el prompt negativo, con interruptor por chip.
- `costes_por_estructura`: consumo imputado por estructura, ahora emitido por
  Python (ver §3.C).
- `scripts/` reparado: doble de transporte `scripts/lib/resolutor-python-falso.ts`
  para los seis tests que perdieron el camino offline; 24 planes congelados en
  `scripts/fixtures/planes-fijados/`.

**Verificar antes de commitear** (la batería tardaba ~6 min):

```
npx tsc --noEmit && npm run -s lint && npm run plan:test
uv run --directory services/ai-api pytest -q
```

La batería pasó de 176 a **144** líneas `[PASS]`. La diferencia está contabilizada
entrada por entrada en el informe: 28 de `plan:test-paridad`, 1 de
`plan:test-geometria`, 1 de `plan:test-resolver`, 1 del rollback borrado y 1 del
bloque de kill switch de `test-plan-editar-python`. No desapareció ningún caso
sin justificar.

---

## 3. Pendiente inmediato

Cada punto lleva la evidencia con la que se detectó. Orden sugerido: B primero
porque es barato y quita la peor impresión, C después porque es borrar, A el
tercero porque es el trabajo real, D al final porque necesita medición.

### B (primero, barato) · un fallo técnico se presenta como conversación

Observado: con Python devolviendo una respuesta inválida, el chat dice *"…no
pude verificar la propuesta contra el catálogo en este momento. Intentemos de
nuevo en un momento…"*, con el paso **"Armé la propuesta con medidas y
cantidades" marcado en verde** y sin propuesta.

Tres defectos, independientes de la causa:

1. Un paso que termina en `ok:false` se pinta como completado.
2. El modelo **reescribe** el `mensaje_cliente` que se le entrega y añade una
   promesa que nadie le dio. Mismo patrón del incidente del gorila.
3. No hay acción de salida, aunque los códigos `ui-error.v1` ya llevan
   `accion_sugerida`.

### C (después, es borrar) · TypeScript calcula números que el cliente ve

- `DialogoCotizacion.tsx:129,193` vuelve a decidir el veredicto de presupuesto y
  recalcula el delta con `Math.max(delta_cop, total - techo)`. Python ya es dueño
  de ambos; ese `Math.max` **esconde** una discrepancia en vez de reventar.
- `TarjetaCotizacion.tsx:101` muestra `borrador.total`, una re-suma en React, en
  vez del `total_cop` que firmó Python.
- `TarjetaPlanDecoracion.tsx` + `DetalleEstructura.tsx` deben consumir
  `costes_por_estructura` en vez de calcular el precio por pieza. **El campo ya
  lo emite Python**; falta cablearlo.

### A (el trabajo de verdad) · el color dominante desaparece sin avisar

El catálogo tiene 25 colores y **"burdeos" no está** (comprobado contra
`catalog_variants.derived_colors` y `catalog_products.derived->'colors'`). El
analizador sí lo produce (`colores-referencia.ts:42` traduce *maroon*, *wine*,
*bordeaux* y *oxblood* a "burdeos"). El guard `coloresReferenciaOmitidos` solo
reclama un color si el catálogo tiene un producto con ese nombre exacto, así que
lo deja caer en silencio y el modelo elige otros — llegando a titular la
propuesta *"Elegancia Festiva Dorado y Blanco"* sobre una foto dominada por el
burdeos.

**Decisión del usuario:** el color viaja a la búsqueda de catálogo y **es el lado
del catálogo (Python) quien elige el más cercano disponible**. Por distancia de
color, no por tabla de sinónimos: el analizador se inventa nombres ("frambuesa"
tampoco existe en el catálogo). Hay hex en `presentacion-cliente.ts:214-238`.
La sustitución se registra en `sustituciones` del plan, que ya existe.

**Sale gratis:** con el color ya reclamable, el guard `COLORES_REFERENCIA_OMITIDOS`
empieza a funcionar solo. No hay que escribir un guard nuevo.

**Sin decidir:** burdeos → rojo no es un cambio pequeño. Propuesta pendiente de
aprobar: sustituir siempre, y que la distancia decida el tono del aviso —
cercano se menciona de pasada, lejano se pregunta antes de seguir.

### D (necesita medir) · fidelidad del reconocimiento y de la imagen

- Fondos (paneles con guirnalda montada) leídos como columnas.
- Los fondos **desaparecen** en la imagen generada: los globos quedan flotando
  sobre una pared lisa.
- Medidas declaradas que no cuadran con la foto (guirnalda de 0,5 m y 12 globos
  donde hay un racimo grande). La puerta física no lo ve: 24 globos/m está en
  banda. El problema son las medidas, no la densidad.
- La escultura del gorila no se detecta (sale como "pared densa" + "racimo").

---

## 4. Deuda conocida, con su condición de retirada

- ~~Tres cosas duplicadas entre `src/lib/plan/mezclas.ts` y `plan.py`~~
  (**resuelto**): la tabla `MEZCLAS`, los diámetros estándar, el tope de
  sustitución y el regex `TAMANO_OBLIGATORIO` tienen un solo dueño,
  `mezclas.ts`, que los exporta al contrato `plan-decoracion.v1` como
  `x-reglas-mezclas`; `plan.py` los lee de ahí (`_MIXES`, `_DIAMETROS_ESTANDAR`,
  `_MAX_SUBSTITUTION_RATIO`, `_MANDATORY_SIZE`). Solo la forma de dos líneas de
  `sustitucionAdmisible` existe en los dos lenguajes, y
  `services/ai-api/tests/test_reglas_mezclas.py` exige que Python coincida par a
  par con la tabla `sustituciones_admisibles` exportada (`AGENTS.md`, "Python
  owns the commercial rules").
- **`buscarCatalogoRag` hace `return buscarCatalogoPython(...)` incondicional**,
  así que todo el retrieval TypeScript por debajo es inalcanzable en producción:
  `retrieval/search.ts`, `rrf.ts`, `diversidad.ts`, `rerank.ts`, `match-level.ts`,
  `query-parser/parse.ts`, `relajacion-filtros.ts`. Es un borrado grande
  pendiente.
- `src/lib/rag/tamanos/resolver.ts` y `buscarPorRol` quedaron sin consumidor de
  producción; los ejercitan arneses de evaluación.
- **Plan 1.1 (`props_catalogo`) desapareció con el resolutor TypeScript.** No es
  pérdida real: nunca estuvo en el contrato compartido, así que el modelo no
  podía emitirlo y nadie lo producía. Ojo: su forma exige `product_id` y
  `variant_id`, o sea cosas que se compran — **no sirve** para la escenografía
  detectada en la foto, que no se vende.

---

## 5. Fase A · el hilo más antiguo, parado desde la mañana

Los documentos del plan se borraron al consolidar. Lo que sigue es lo que queda
pendiente; las guardas de una corrida de evaluación (tope de gasto, nada de
imágenes ni rutas en el repo, telemetría apagada, qué decide una persona) están
en `AGENTS.md`.

Decisiones tomadas que siguen vigentes: taxonomía de 12 clases; excepción
`dt7-excepcion-interna-20260915` que autorizó mandar a Gemini 68 fotos sin
permiso solo para evaluación interna, **con el compromiso de reemplazarlas por
fotos con permiso antes de cualquier compuerta**; migraciones 024 y 025
aplicadas en Neon el 2026-09-16; LoRA con foto pasa por `/edit`.

- ~~Promover v16 a producción~~ **Hecho 2026-09-25 (ADR-0029)**: v16 en producción
  y sin pasada de auditoría. Revisión humana de los 5 centros de mesa (ninguno es
  bouquet; 4 de esos errores venían de la auditoría), control de 34 fotos a US$0,28
  sin deriva, y la auditoría retirada (113/122 sin ella frente a 109/122 con ella).
- **LoRA `/edit`**: cableado y desplegable, sin medir porque fal no tenía saldo.
  Puede ser la causa de la mejora de resultados que se observó (ver §6).
- **Propagar la taxonomía de 12 clases** a Fundamentos, la guía 04, los planes
  B/C y la herramienta del recolector, que siguen documentando 16.
- **Confirmar modelo y nivel de pensamiento de producción** antes de dar la línea
  base por buena.
- **Reemplazar las fotos de la excepción `dt7-excepcion-interna-20260915`** por
  fotos con permiso antes de cualquier compuerta.

---

## 6. Avisos para quien despliegue

- **Desaparece la reversión por variable de entorno.** Retirado el kill switch,
  recuperar es desplegar la revisión anterior de la app **y** de `ai-api` juntas.
- **Las propuestas con procedencia `"next"` ya no se pueden re-resolver.** Los
  tokens caducan a las 24 h y en producción solo se emiten `"python"`, así que el
  riesgo real es nulo salvo que el kill switch se haya usado en el último día.
- **Otra sesión comparte esta rama.** No ha empujado nada en todo el día, pero
  los commits `6e10809`, `8ade851`, `3fb3b11` y `e79e8f0` son suyos y tocan la
  misma lógica de conteo. Si tiene trabajo en vuelo sobre `route.ts`, `page.tsx`
  o `estimacion.ts`, el choque será grande.
- **La mejora de resultados observada no viene de la migración.** El resolutor da
  los mismos números y los pesos de LoRA son los mismos. Los candidatos reales
  son: el LoRA con foto pasando por `/edit` (condicionamiento por imagen en vez
  de solo texto), que toda generación pase ahora por el blueprint del plan en vez
  de por `catalogBlueprint`, y la retirada de las prohibiciones contradictorias
  del prompt. **Conviene medirlo antes de darlo por bueno**; el arnés de
  evaluación está montado.

---

## 7. Editar una propuesta desde el chat (lo más urgente del producto)

Observado el 2026-09-16 probando con una foto de baby shower (semiarco blanco con
acentos dorados y hojas verdes sobre pared de follaje).

### E.1 Pedir un cambio rehace el plan entero

El cliente pide un cambio de distribución y la respuesta es **una propuesta
nueva**: cambian los colores (de verde y dorado a dorado y blanco), las piezas y
las medidas que ya había aceptado. No es que el modelo desobedezca: es que la
conversación **no tiene forma de editar**. Solo sabe crear planes.

Existe `/api/plan-editar` con acciones acotadas (`reemplazar`, `agregar`) por
`estructura_id` y `variant_id`, que preserva todo lo que no se menciona y
re-firma el plan. Pero solo se dispara desde el editor de la tarjeta
(`TarjetaPlanDecoracion`). Un mensaje de chat siempre entra por
`confirmar_plan_decoracion`, que construye un plan desde cero.

**Cómo arreglarlo:**

1. Con una propuesta aprobada en la conversación, distinguir dos intenciones:
   **ajustar** lo que hay ("más dorado", "el arco más grande", "quita las hojas")
   frente a **diseñar otra cosa** ("mejor algo para un cumpleaños"). El plan ya
   guarda su procedencia firmada, así que el turno sabe si hay algo que editar.
2. Una intención de ajuste va a una edición acotada, no a `confirmar_plan_decoracion`.
   Lo que el cliente no nombra **no se toca**: mismas estructuras, mismas
   medidas, mismos materiales salvo el cambio pedido.
3. Solo si el cliente pide explícitamente otro diseño se empieza de cero, y
   conviene decírselo ("te armo una propuesta nueva") en vez de sustituirla en
   silencio.
4. Que el cambio sea visible: la tarjeta nueva debería decir qué cambió respecto
   a la anterior, no aparecer como si fuera la primera.

Riesgo a vigilar: la intención la clasifica el modelo, y una clasificación
errónea borra una propuesta aceptada. Ante la duda, editar es lo reversible;
rehacer no. Y la edición ya tiene su propia puerta de allowlist firmada, así que
no abre superficie nueva.

### E.2 El ajuste debe ocurrir en el chat, no en una caja aparte

Hoy el ajuste vive en un campo separado bajo la imagen ("Ajuste: 'más velas',
'de noche'…") que llama a `generar()` con `instruccion`. Es una segunda
conversación paralela a la conversación. Debe ser un mensaje más del chat, con
su respuesta en el hilo.

### E.3 La distribución de color no se compara con la referencia

En la foto el blanco domina y el dorado es acento; en la imagen generada el
dorado ocupa la mitad inferior. Las hojas verdes y la pared de follaje
desaparecen.

Hoy se comprueba que los colores de la foto **estén** (`coloresReferenciaOmitidos`,
y ver §3.A sobre el vocabulario), pero nada compara **en qué proporción**. El
plan declara `participacion` por material y nadie contrasta ese reparto con lo
observado en la referencia. El QA visual, que lo detectaba después de generar
(y tarde), se retiró el 2026-09-21 (ADR-0025): hoy nada lo comprueba.

Pendiente de decidir: si la proporción de la referencia debe ser una
restricción del plan (y entonces el guard la defiende como a los colores), o
solo una advertencia. Lo primero es más fiel; lo segundo deja más margen creativo.

---

## 8. Editar el arco desde la propuesta (2026-10-02, ADR-0035 paso 1)

El arco con `armado_arco` ofrece «Editar arco» (plegado por defecto): patrón con sus mandos y los colores de la pieza
que cumple cada papel, forma, ancho, alto, globos a lo ancho, tamaño de globo e inflado, con el dibujo del motor en vivo
(pausa de 300 ms, `AbortController`, gana la última; los deslizadores aplican al soltar porque la latencia pasa de
250 ms) y «Guardar arco» por `/api/plan-editar` (acción nueva `armado_arco`). Una revisión adversaria encontró y se
corrigió: el 500 de un arco que el contrato no admite (ahora `armado_invalido` con su frase), los índices de color tras
quitar o agregar un color (Python revalida; el editor avisa y no pierde el borrador), las medidas que no seguían al
armado, los colores sin uso, el reparto y la mezcla sobre un arco armado, la falta de cobertura de catálogo al guardar,
y varios puntos de accesibilidad. Detalle, latencias y lo no probado: ADR-0035, «Estado del paso 1».

La imagen ya lee el armado del arco (frases de Python en `armados_arco[]`, derivadas y fuera de `plan_hash`; sin medir con
generación real). Pendiente: capas y secciones (paso 2); un arco sin armado no se edita; a 360 px el dibujo se pierde de vista al bajar
a los mandos. Preexistente que vio la revisión: `/api/plan-editar` sin `isAuthenticatedRequest` propio y «Deshacer» que no
limpia `editadoTrasAprobar`.

---

## 9. El patrón de la foto llega al motor (2026-10-02, ADR-0039)

Había dos lecturas del mismo hecho que no se cruzaban: la foto se leía en los ocho modos de `patron-color.v1`
(ADR-0028 §11) y el motor arma con los suyos (catorce en el arco, nueve en la columna, tres repartos en la
guirnalda). La receta que completa el armado al confirmar elegía el patrón por el **número de colores de la
pieza** —uno sólido, dos a cuatro la espiral del diseñador, cinco o más arcoíris u ombré—, así que **una
columna que en la foto es un apilado de anillos salía en espiral**, con su precio y su croquis. Y como la
receta no pasaba remate, **toda columna salía coronada con un globo de 24"**, lo hubiera en la foto o no, sin
forma de decir que la punta va a ras.

**Hecho.** Un solo módulo cruza los dos vocabularios (`app/patron_de_la_foto.py`) con la tabla de
equivalencias y su motivo fila por fila; viaja también el **orden** de los colores (el dominante manda) y los
**globos de un racimo**, que es la banda del arco y la capa de la columna. Los mismos cortes que
`patron_desde_pista`: confianza bajo 0,5 no se usa, un color que no es de la pieza tumba la lectura entera, y
un patrón que pide más colores de los que hay cae a la siguiente preferencia — todo con su aviso. La misma
llamada de visión lee ahora el **remate** de las columnas, donde **ausente** («no se ve la punta», y la corona
el motor) y **`ninguno`** («no lleva nada») son datos distintos y no se confunden; va en su propio campo del
blueprint (`appearance.remate_columna`) porque mezclarlo con `patron_color` habría roto `pistas_patron` como
el 2026-09-30. La guirnalda orgánica no tiene patrón: lo que la foto decide allí es su **reparto** (`azar`,
`racimos`, `tramos`), y los pesos siguen siendo la participación que declara el plan.

**Dentro de `ARMADO_ARCO_COLUMNA_V1`** (apagada en producción); no se añadió ninguna bandera y no lo gobierna
`PATRONES_COLOR_V1`. La lectura alimenta la **receta**: un armado que el modelo propuso y se sostiene sigue
ganando. El armado que describe la foto se marca `origen: "referencia"`, y la respuesta de la operación lo
refleja con un tercer valor de `origen` para poder medir las tres ramas.

**El eje y la simetría, en la misma pasada.** La lectura tampoco decía por **qué eje** recorre el patrón la
pieza ni si sus **dos mitades** son iguales, y las dos existían ya en el patrón resuelto y en el motor (el
ombré del arco tiene el mando «Dirección» con a lo largo, simétrico y a lo ancho). Un degradé que en la foto
baja de lado a lado salía siempre a lo largo. Ahora la pista lleva `direccion` y `simetria`, y **cada
consumidor aplica sus propias reglas**: `patron_desde_pista` las pone solo si `modos_admitidos` las admite (y
descarta en silencio lo que no, porque dejarlo viajar tumbaría el patrón entero y la pieza perdería una
lectura que sí servía), y el motor las pone donde el mando existe — una columna no se arma en espejo. Eso es lo
que deja que el motor admita un ombré a lo ancho de la banda del arco, que `patron_color` solo admite en una
pared. Las dos van también en el modelo `PistaPatron` de `plan.py`, que se mantiene a mano: sin eso, la
petición de plan entera habría devuelto 422 como el 2026-09-30 con `zonas`.

**Comprobado:** 40 casos en `tests/test_patron_de_la_foto.py` (traducción, receta, remate, guirnalda, eje y
espejo), 8 nuevos en `tests/test_patron_referencia.py` (la lectura), 2 en `tests/test_patron_color.py` (que la
dirección y el espejo entren donde la pieza los admite y se descarten donde no), 4 en
`scripts/test/test-patron-referencia.ts`, `plan:test-armado-estructura-ia`, `tsc`, `lint` (0 errores, 25
avisos preexistentes), `contracts:check` y `ruff`/`mypy` sobre los 108 archivos.

**No comprobado:** que el modelo lea bien el remate, el modo, el eje y la simetría (no se llamó a ningún
proveedor; el eje y la simetría son lo más fácil de confundir en una foto de frente y es lo primero que
debería mirar la evaluación), el efecto en la imagen generada, y cuánto se parece el conteo resultante al de
la foto. Tres filas de la tabla conviene mirarlas con fotos delante: `damero → diamante`, `aleatorio →
punteado` en el arco y `degradado → tramos` en la guirnalda. Detalle y rollback: ADR-0039.

**Dos defectos que salieron al probarlo con una foto real (2026-10-02, baby shower rosa):**

1. **La lectura estaba apagada.** `PATRON_REFERENCIA_PYTHON_ENABLED` no estaba en `.env.local`, así que el
   blueprint salía sin `appearance.patron_color`, la confirmación mandaba cero pistas y el motor armaba con su
   reparto de partida (`azar`): los tres colores salpicados de punta a punta en una pieza que en la foto va por
   tramos. Encendida en desarrollo.
2. **El prompt nombraba la técnica, no la disposición.** Decía que `aleatorio` es «the colors are mixed with no
   regular order, **as in an organic garland**», y la pieza *es* una guirnalda orgánica: la frase empujaba al
   modo equivocado. Ahora `aleatorio` exige que cada color recorra la pieza entera, `bloques` admite
   transiciones que se funden mientras cada color sea dueño de un tramo, y una regla antes de la lista dice que
   lo que se nombra es **cómo están repartidos los colores, nunca cómo se armó la pieza**. Con eso la foto se
   leyó `bloques` con 0,9 de confianza y el armado salió con `origen: referencia`.

**Y uno más, que tapaba el resultado:** el cupo global de los motores (`app/exclusion_motores.py`) contesta
`motor_ocupado` (429) al instante cuando otro dibujo está en curso, y **su propio diseño dice que el cliente
reintente** — el reintento no existía en Next. Peor: el adaptador no tenía rama para 429, así que caía en
`PYTHON_UNAVAILABLE` y el cliente leía «El servicio no respondió», cuando el servicio sí respondió y dijo que
estaba ocupado. Ahora el adaptador reintenta hasta 3 veces con espera corta (el trabajo del motor dura cientos
de milisegundos, no el segundo del `Retry-After`) dentro del presupuesto de la llamada, y si se agota sale como
`SERVICIO_OCUPADO`. Reintentar es seguro: la reserva se toma **antes** de encolar, así que un 429 garantiza que
el trabajo no corrió. Pendiente menor: el texto de `SERVICIO_OCUPADO` dice «intenta de nuevo en unos minutos»,
que para una cola de milisegundos sigue siendo falso; no lo toqué porque esa frase la comparten otras causas.

**Ojo al desplegar:** la versión del prompt de la lectura cambió dos veces en esta pasada (acabó en
`patron-referencia.v1:d937c2c632bc37a1`), así que **la caché de detección por foto se invalida** y la primera
lectura de cada foto se vuelve a pagar. El valor está congelado en dos pruebas —`test_estructuras_registro.py`
(su dueña) y `test_guirnalda_referencia.py`— y las dos se editan juntas.

**Preexistente que apareció al correr la suite:** 4 fallos en `tests/test_columnaorg.py` por 1 ulp
(`0.908799997` contra `0.908799998` del vector de oro generado en Node). Es la libm de V8, no esta pasada;
quedan pendientes de decidir en el repo dueño.

---

## 10. Una IA, una cosa (2026-10-03)

Principio que fijó el usuario: **cada IA se encarga de una cosa y debe ser la mejor en eso**. Medido sobre el
árbol, lo que vivía en una carpeta de IA **sin hablar con ningún proveedor** eran 1.921 líneas:
`omoikane/armado_estructura.py` (1.406), `omoikane/patron_de_la_foto.py` (430) y `amaterasu/tamano_imagen.py`
(85). Estaban ahí por **quién las llama**, no por lo que hacen.

(La primera medición acusó también a `uzume/interaction.py` (200) y era **falso**: hace
`client.aio.interactions.create(...)`, que el patrón de búsqueda no cubría. Es la llamada al proveedor de
Uzume y está donde debe. Corregido el mismo día; el patrón bueno busca también `.create(` y `client.`)

**Hecho:** los dos de Omoikane salieron a `app/armado_estructura.py` y `app/patron_de_la_foto.py`, junto a las
puertas de los motores que usan. `app/omoikane/` se queda sólo con `turno_stream.py`, que es lo único que
conversa con el cliente. La prueba siguió al módulo (`tests/test_armado_estructura.py`).

**El nombre de la operación NO cambió** —`omoikane.armado_estructura` y `omoikane-armado-estructura.v1`— porque
es un identificador publicado: viaja firmado en cada petición y lo nombran el contrato, la ruta y la caché.
Mover el módulo ordena el código; renombrar la operación rompería la frontera.

**Pendiente del mismo principio:** Amaterasu lee la foto cuatro veces con cuatro prompts (el plegado está en
marcha, con v16 intacto detrás de una bandera nueva). `amaterasu/tamano_imagen.py` —leer el ancho y el alto de
la cabecera de un PNG o un JPEG no es una IA— es el último que queda fuera de sitio, y **no se movió a
propósito**: sus consumidores los está reescribiendo ahora mismo el plegado de las lecturas. Se mueve cuando
eso entregue. Y Uzume y Kagutsuchi hacen la misma cosa —generar la imagen— separadas por proveedor y no por
trabajo, que es una decisión de producto sin tomar.
