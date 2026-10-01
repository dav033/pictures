# Seguimiento: lo que detecta el color de la foto y lo que busca parecidos

**Escrito el 2026-09-30.** Documento de traspaso de una sola sesión. Quien lo
retome debe leer `AGENTS.md` y, de los ADR, el **0037** (nació aquí), el 0034
(reemplazado en la parte del color por el 0037) y el 0024 (qué puede decidir el
color de la foto).

Rama `fix/pared-organica-color-e-imagen`, 79 commits por delante de
`origin/main`. **Todo lo de esta sesión está sin commitear.** Durante la sesión
otra sesión commiteó en esta misma rama (`ce8cf9c` y el arreglo de
`silueta_patron.py`): los cambios de abajo están encima de ese trabajo, no
mezclados con él.

---

## 0. Lo primero al retomar: hay trabajo sin commitear

```
 M docs/architecture/decisions/0034-un-color-que-la-foto-no-tiene.md
 D scripts/ops/verificar-paridad-color.py
 M scripts/test/test-plan-auditoria-referencia.ts
 M scripts/test/test-reference-analyze-route.ts
 M scripts/test/test-segunda-e2e-backend.ts
 M scripts/test/test-tercera-e2e-backend.ts
 M services/ai-api/tests/test_plan_auditoria.py
 M src/lib/ia/amaterasu/decodificar-pixeles.ts
 M src/lib/ia/herramientas/convergencia-plan.ts
 M src/lib/ia/herramientas/registro-herramientas.ts
 M src/lib/ia/omoikane/prompt-sistema.ts
 M src/lib/plan/cobertura-materiales.ts
 M src/lib/plan/colores-referencia.ts
 M src/lib/rag/catalog/globos-por-color.ts
?? docs/architecture/decisions/0037-el-color-de-la-foto-se-avisa-no-se-impone.md
?? services/ai-api/tests/test_paridad_color.py
```

**Sí está verificado**, todo ejecutado en esta sesión y en verde:
`npx tsc --noEmit` · `npm run -s lint` (0 errores; 25 advertencias, todas
previas) · `npm run plan:test` completo · `ruff check app tests` · `mypy app` ·
`pytest -q` (1187 pasan, 4 saltadas porque piden Postgres local).

No cambia ningún contrato, ningún `plan_hash` y ningún vector dorado.

---

## 1. Qué se revisó

La cadena entera del color: **etiquetas del analizador → medida de píxeles →
vecino más cercano por ΔE**, en TypeScript y su espejo en Python.

- `src/lib/plan/colores-referencia.ts` — lee las etiquetas (`observed_colors`),
  decide los dominantes y los acabados.
- `src/lib/plan/dominancia-color.ts` + `src/lib/ia/amaterasu/decodificar-pixeles.ts`
  — la medida sobre píxeles. **Detrás de `MEASURED_COLOR_DOMINANCE_V1`, que está
  apagada por defecto y no figura en ningún entorno**: hoy en producción el
  color sale de las etiquetas.
- `src/lib/rag/catalog/similitud-color.ts` — la tabla CIELAB y el ΔE, exportados
  al contrato `catalog-search.v1`; `services/ai-api/app/catalog.py` la lee de ahí.

Lo que está sólido: el modelo CIELAB con sus umbrales razonados sobre los 300
pares reales, la tabla con un solo dueño, y la lectura de etiquetas (36 de 40
etiquetas realistas bien leídas; las 4 que falla — copper, taupe, terracotta,
bronze — se dejan fuera a propósito).

## 2. Qué se quitó, y por qué

Decisión de producto del 2026-09-30: **no depender de auditorías en este flujo**.
Escrita entera en `docs/architecture/decisions/0037-el-color-de-la-foto-se-avisa-no-se-impone.md`.

1. **El rechazo `COLORES_REFERENCIA_OMITIDOS`**, que devolvía `ok: false` desde
   `confirmar_plan_decoracion` y le costaba al turno una vuelta entera del
   modelo más una consulta al catálogo. Con él se fueron
   `coloresReferenciaOmitidosDelTurno`, `coloresReferenciaOmitidos`,
   `productosGloboPorColor`, `ACCION_COLORES_REFERENCIA_OMITIDOS`,
   `MENSAJE_CLIENTE_COLORES_REFERENCIA`, el estado `coloresReferenciaReclamados`
   y la frase del prompt de sistema que lo explicaba.
2. **La poda de color inventado**: `materialesDeColorInventado`,
   `quitarMaterialesDeColorInventado`, `coloresObservadosElemento` y la
   telemetría `PLAN_COLOR_SIN_REFERENCIA`.

Lo que **sigue vivo**: el aviso de sustitución al cliente
(`sustitucionesColorReferencia` y `_reference_color_substitutions` en `plan.py`),
la regla del **acabado** de la foto (`acabadosObservadosDeMateriales` +
`aplicarAcabadoReferencia`, decisión de ADR-0034 que el 0037 no toca), y
`colores_en_catalogo` en la búsqueda.

**Consecuencia asumida**: un "Reflex Fucsia" que la foto no tiene vuelve a
cotizarse y a dibujarse, y puede dejar sin material a la pista de patrón de la
foto (el defecto del 2026-09-29 en cadena). La fidelidad a la paleta queda en el
prompt y en lo que devuelva la búsqueda.

## 3. Qué se arregló

- **La orientación EXIF** (`decodificar-pixeles.ts`): era el único `sharp` del
  repo sin `.rotate()`. Con una foto de teléfono (orientación 6) el fotograma
  salía 240×160 donde la vista derecha es 160×240, así que **cada
  `reference_bbox` caía sobre otra región**: el 40 % superior del fixture daba
  66 % de gris sin enderezar y 16 % enderezado. La UI endereza en el navegador,
  así que no se veía desde la web; sí desde el bench, la evaluación y cualquier
  llamador que no sea la UI — justo las corridas con las que se validaría la
  bandera. Prueba nueva en `ia:test-referencias-ruta`.
- **La paridad cromática TS↔Python**: vivía en `scripts/ops/verificar-paridad-color.py`,
  que no corría ningún script de npm ni CI. Ahora es
  `services/ai-api/tests/test_paridad_color.py`, usa las funciones reales de
  `catalog.py` (`_chromatic_distance`, `_nearest_present_color`,
  `purchase_color_for_unsold`), fija las cinco distancias medidas en TypeScript
  y cubre gris→plateado, que no cubría nadie. El script se borró.

---

## 4. Lo que queda pendiente

### 4.1 Antes de encender `MEASURED_COLOR_DOMINANCE_V1`

Los dos son decisiones de producto, no bugs a tapar; encender la bandera sin
resolverlos suelta los dos a la vez.

**a) Qué gana cuando la medida y las etiquetas discrepan.** Hoy la medida gana
siempre (`colores-referencia.ts:268`), incluso midiendo una caja que es 90 %
pared. `sinClasificar` se calcula (`dominancia-color.ts:157`) y se documenta
como "la medida dice poco", pero **nadie lo lee**: `dominancia-referencia.ts:44`
lo descarta. Medido: etiquetas `[rosado, dorado, blanco]` + medida `[cafe 1.0]`
→ `['cafe']`, y con los colores se van sus acabados. Es la forma del incidente
del muro de ladrillo. Además el filtro de fondo se apaga entero con cobertura
≥ 0,8. Propuesta: la medida decide el ORDEN, las etiquetas ponen el VOCABULARIO;
o al menos un umbral de `sinClasificar` y de `pixelesMedidos` por debajo del cual
la medida no manda.

**b) El `gris` medido se pierde sin sustitución ni aviso.**
`colores-referencia.ts:193` descarta lo que no está en la paleta vendible.
Medido:

```
etiquetas ["matte grey","white"]   -> ['gris','blanco']  → sustituye a plateado y avisa
medido     gris .7 / blanco .2     -> ['blanco']         → ni plateado ni aviso
coloresFotoCliente                 -> ['gris']           → al cliente sí se le muestra
```

La tarjeta dice "tu foto es gris", la pieza se arma blanca y `sustituciones` va
vacío. El camino de etiquetas hace lo correcto. El test
`scripts/test/test-color-referencia-fases2.ts:46` congela la caída actual, así
que cambiarlo es decisión deliberada: plegarlo a `plateado` sumando
participación, o dejarlo pasar como hacen las etiquetas.

### 4.2 Del clasificador de píxeles (misma bandera)

- **El racimo pálido**: beige/champagne 8,8 · beige/crema 9,7 · dorado rosa/nude
  10,8 · beige/nude 11,8 · champagne/nude 14,7. Con radio 30, un solo tono nude
  real se reparte entre tres etiquetas y puede empujar fuera de los tres cupos a
  un segundo tono de verdad. Fusionar por debajo de cierto ΔE antes de recortar.
- **El rojo saturado no clasifica**: el rojo puro `254,0,0` del fixture de EXIF
  queda sin clasificar, porque el nominal del catálogo es `#d32f2f` y la
  distancia supera el radio de 30. Un globo rojo a pleno sol puede quedarse
  fuera de la medida. Mismo tipo de problema que el racimo pálido.

### 4.3 Suelto

`DELTA_E_PISTA = 25` (`services/ai-api/app/patron_color.py:51`) es un tercer
umbral de "cerca", escrito a mano en Python y sin espejo en el dueño de
TypeScript. Es el que hace que `patron_desde_pista` sea todo-o-nada: un solo
color de la pista sin material a menos de 25 tumba el patrón entero.

---

## 5. Cómo se revierte

Los cambios de esta sesión son política de frontera: sin contrato, sin
`plan_hash`, sin vector dorado. Revertir el commit (o descartar el árbol de
trabajo si aún no se commiteó) devuelve el rechazo, la poda, sus pruebas y su
texto de prompt. Nada persistido cambia de forma, así que los planes firmados
entre medias siguen siendo válidos.
