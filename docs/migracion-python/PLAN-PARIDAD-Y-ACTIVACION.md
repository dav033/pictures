# Plan de paridad y activación del resolutor Python

Fecha: 2026-09-14 · Estado: verificado localmente; activacion remota pendiente · Autoridad: [ADR 0005](../architecture/decisions/0005-python-authority-cutover.md) y [ADR 0006](../architecture/decisions/0006-procedencia-firmada-del-plan.md)

Este documento está escrito para que otro agente lo ejecute sin más contexto que
el repositorio. Cada tarea lleva diagnóstico exacto (archivo y línea), qué
cambiar, criterio de aceptación verificable y el comando que lo comprueba.

---

## 0. Estado del que partes

La integración de resolución está verificada offline y localmente: el chat,
`/api/generate` y `/api/plan-editar` resuelven por el backend que indica la
procedencia firmada en el token de aprobación, con mapeo de transporte y errores
estables. La paridad comercial y los controles B1-B3 pasan contra PostgreSQL
local. Siguen pendientes dos controles de autoridad de catálogo descritos en §E
y cualquier activación remota.

```bash
npm run plan:test-paridad-python   # la puerta de activación offline. PASA.
```

Salida actual: 9 de 9 vectores pasan, incluidos los tres escenarios A5. B1-B3
también fueron ejecutados localmente; la activación remota sigue requiriendo
cerrar los controles de autoridad indicados en §E y autorización explícita.

### Reglas que no puedes romper

Estas reglas existen porque son exactamente las formas fáciles de "arreglar" la
paridad sin arreglar nada:

1. **No regeneres un vector dorado para que cuadre.** `--update` y
   `PARIDAD_ACTUALIZAR=1` solo se usan cuando cambiaste el resolutor **a
   propósito** y puedes justificar el nuevo valor. Regenerar para silenciar una
   diferencia destruye la única prueba de paridad que existe.
2. **No amplíes `CAMPOS_FUERA_DE_PARIDAD`.** Solo `plan_hash` y `merma_log` están
   excluidos, cada uno con su razón escrita. Añadir un tercero es ocultar el
   problema.
3. **No borres ni relajes assertions.** Si algo no se puede cerrar, déjalo
   fallando y anótalo aquí con el motivo.
4. **La referencia es TypeScript.** Python debe reproducir el comportamiento
   TypeScript, aunque el TypeScript te parezca mejorable. Si encuentras un bug
   real en TypeScript, anótalo aparte; no lo "corrijas" dentro de esta tarea.
5. **No toques Neon ni ningún entorno remoto.** Todo se prueba contra el
   PostgreSQL local. No cambies flags en remoto.
6. **No hagas commit salvo instrucción explícita** del usuario. El worktree tiene
   ~220 archivos modificados de trabajo previo: nunca `git add .`, nunca
   revertir cambios ajenos.

### Cómo se prueba (todo offline, sin base de datos ni red)

```bash
npm run plan:test-paridad          # regresión TypeScript (entra en npm run plan:test)
npm run plan:test-paridad-python   # paridad TS vs Python: la puerta
cd services/ai-api && uv run --extra test --system-certs python -m pytest tests/test_plan_parity.py
```

Los vectores viven en `contracts/domain/v1/golden/plan-resolution/` y su formato
está documentado en el `README.md` de esa carpeta.

---

## Bloque A — Paridad comercial (cerrado offline)

### A1 · `alternativas`: Python no las calcula

**Diagnóstico.** `services/ai-api/app/plan.py:1287` devuelve `"alternativas": []`
literalmente. TypeScript las calcula en `calcularAlternativas`
(`src/lib/plan/resolver.ts:275-327`), invocada en `resolver.ts:644` bajo el flag
`PLAN_COST_OPTIMIZER_V2`, **que por defecto está encendido**
(`src/lib/ia/feature-flags.ts:24`).

Impacto real: `alternativas` es lo que el chat le ofrece al cliente cuando un
plan supera el techo de presupuesto (`registro-herramientas.ts`, rama
`PRESUPUESTO_EXCEDIDO`). Con Python activo, ese caso se queda sin alternativas
que ofrecer.

**Qué hace el algoritmo TypeScript**, para portarlo:

1. Agrupa las líneas geométricas (`diam_pulg != null`) de todas las estructuras
   en "necesidades" por clave `color|forma|diam_pulg`, sumando unidades.
2. Si no hay necesidades, devuelve `[]`.
3. Calcula `costoNoGeometrico` = suma de `subtotal` de las compras con
   `diam_pulg == null` (telones, props: no cambian al cambiar de familia).
4. Para **cada `product_id`** con candidatos, intenta cubrir *todas* las
   necesidades solo con variantes de ese producto que estén en la allowlist:
   filtra por `forma === (necesidad.forma ?? "redondo")`, `diamPulg` exacto,
   color y acabado normalizados, y resuelve con `optimizarCobertura`
   (`src/lib/plan/optimizar-materiales.ts:31`). Si alguna necesidad no tiene
   cobertura, ese perfil se descarta entero.
5. Ordena los perfiles por `total` y desempata por `productId`, se queda con 3,
   deduplica por `productId`, y etiqueta `economica` / `equilibrada` / `premium`
   por posición.
6. `ahorro_cop = max(0, totalActual - perfil.total)`; `titulo` = títulos únicos
   de las compras del perfil (primer segmento antes de `" — "`) unidos por
   `" + "`, o el `productId` si queda vacío.

**Cómo arreglarlo.** Implementa en `app/plan.py` un `_alternatives(...)` que
reproduzca esos seis pasos y llámalo desde `_build_resolved` en lugar del `[]`.
Necesitas portar también el equivalente de `optimizarCobertura`; revisa antes si
`_choose` (`plan.py:566`) ya cubre parte del problema y reutiliza en vez de
duplicar. Respeta la normalización de color/acabado de `_normalize`
(`plan.py:234`), que debe coincidir con `normalizar`
(`src/lib/plan/resolver.ts:68`).

> `PLAN_COST_OPTIMIZER_V2` no existe en Python. Decide **explícitamente** si el
> servicio lo lee de entorno con el mismo valor por defecto (encendido) o si lo
> implementa siempre. Si lo haces configurable, documenta el flag en
> `services/ai-api/README.md` y en `.env.example`; si no, escribe en el código
> por qué no es configurable. No lo dejes implícito.

**Criterio de aceptación.**
- `npm run plan:test-paridad-python` no reporta ninguna diferencia en
  `plan_resuelto.alternativas` en ningún vector.
- Existe un vector con techo de presupuesto excedido (ver A5) en el que ambos
  backends devuelven la misma lista de alternativas, en el mismo orden y con las
  mismas etiquetas.
- `pytest tests/test_plan_parity.py` sigue en verde tras regenerar
  `expected_python` con `PARIDAD_ACTUALIZAR=1`.

---

### A2 · `waste_only_savings_cop` del `material_estimate` está fijo en 0

**Diagnóstico.** `services/ai-api/app/plan.py:1102` escribe
`"waste_only_savings_cop": 0` sin calcular nada. TypeScript lo calcula por línea
de compra en `src/lib/materiales/estimacion.ts:171-176`:

```
unitPrice     = package_count > 0 ? purchase_cost / package_count : 0
basePackages  = ceil(design_quantity / units_per_package)
naivePackages = ceil(ceil(design_quantity * (1 + MERMA)) / units_per_package)
savings      += max(0, (naivePackages - basePackages) * unitPrice)
```

y al final `Math.round(...)` sobre la suma.

Comprobado en el vector `04-paquete-pequeno-merma-inventario`:
`design_quantity=60`, `units_per_package=7`, `package_count=9`,
`purchase_cost=13500` → `unitPrice=1500`, `base=9`, `naive=ceil(65/7)=10`,
ahorro `1500`. Python devuelve `0`.

**Ojo, hay dos definiciones distintas y ambas son correctas.** El mismo nombre de
campo significa cosas distintas en dos sitios, y Python debe reproducir las dos:

| Campo | Fórmula TypeScript | Estado en Python |
| --- | --- | --- |
| `plan_resuelto.totales.waste_only_savings_cop` | `max(0, costoIngenuoConMerma − costoPaquetesSinConsolidar)` (`resolver.ts:641`) | **Ya coincide** (`plan.py:1272`) |
| `material_estimate.totals.waste_only_savings_cop` | por línea, fórmula de arriba (`estimacion.ts:171`) | **Falta** (`plan.py:1102`) |

No unifiques las dos fórmulas. Si crees que deberían ser una sola, eso es una
discusión de dominio aparte, no parte de esta tarea.

**Cómo arreglarlo.** Sustituye el `0` de `plan.py:1102` por el cálculo por línea
sobre `purchase_lines`, con redondeo al final (no por línea) para reproducir el
`Math.round` de TypeScript. Cuida la división entera: en Python usa división
flotante para `unitPrice` y redondea solo el total.

**Criterio de aceptación.**
- `npm run plan:test-paridad-python` no reporta diferencia en
  `material_estimate.totals.waste_only_savings_cop` en ningún vector.
- El vector `04` da exactamente `1500` en los dos backends.
- Añade un caso donde `naivePackages == basePackages` (ahorro 0) y otro con dos
  líneas de compra que sumen, para que el redondeo final quede cubierto.

---

### A3 · `additional_waste_packages` está fijo en 0 (divergencia latente)

**Diagnóstico.** Dos sitios en Python escriben `0` sin calcular:
`plan.py:1103` (dentro de `_material_estimate`) y `plan.py:1273` (dentro de
`_build_resolved`). TypeScript lo calcula en los dos equivalentes:

- `src/lib/materiales/estimacion.ts:187`:
  `purchases.filter(l => l.additional_package_for_waste).reduce((s, l) => s + l.package_count, 0)`
- `src/lib/plan/resolver.ts:689`:
  `compras.filter(c => c.additional_package_for_waste).reduce((s, c) => s + c.paquetes, 0)`

**Esto hoy no lo detecta ninguna prueba**: los cinco vectores tienen
`additional_package_for_waste = false` en todas sus compras, así que ambos lados
dan `0` por casualidad. Es la razón por la que A5 no es opcional.

**Cómo arreglarlo.** Implementa las dos sumas y **primero** añade el vector de
A5 que fuerza `additional_package_for_waste = true`, para que la prueba falle
antes de arreglarla. Si arreglas sin el vector, no tienes evidencia de nada.

**Criterio de aceptación.**
- Existe un vector con al menos una compra con `additional_package_for_waste =
  true`, y en él `plan_resuelto.totales.additional_waste_packages` y
  `material_estimate.totals.additional_waste_packages` coinciden entre backends
  y son distintos de cero.
- Ese vector falla en `plan:test-paridad-python` **antes** del arreglo (déjalo
  registrado en el informe) y pasa después.

---

### A4 · `cotizacion.lineas[].color`: decisión de producto, no bug

**Diagnóstico.** `cotizarPlan` (`src/lib/cotizacion/motor.ts:248`) no asigna
`color` a las líneas del plan; Python sí lo transporta en `quote.v1` y el mapper
lo copia. Es un campo de presentación (`LineaCotizada.color`), no un valor
comercial: no afecta precios ni cantidades.

**Cómo arreglarlo.** Hay dos salidas y **hay que elegir una explícitamente**:

- **(a) Recomendada — alinear TypeScript:** añadir `color: compra.color ??
  undefined` en `cotizarPlan`. El dato ya existe en la compra consolidada y la
  UI tiene filtro de color en el modal de reemplazo. Requiere regenerar
  `expected` (`--update`) y **mirar la tarjeta de cotización** para confirmar que
  el color añadido se ve bien y no duplica información del título.
- **(b) Alinear Python:** dejar de emitir `color` en `_quote`. Más barato, pero
  tira un dato útil que el contrato ya transporta.

Esta es la única tarea del bloque A que cambia lo que ve el cliente, así que
**pregunta antes de elegir** si no tienes instrucción. No la hagas por defecto.

**Criterio de aceptación.**
- `npm run plan:test-paridad-python` no reporta diferencia en
  `cotizacion.lineas[].color`.
- Si elegiste (a): `expected` regenerado con `--update`, `npm run plan:test` en
  verde, y una nota en el informe de que se revisó la tarjeta.

---

### A5 · Cobertura de vectores: tres huecos que hacen la suite optimista

Los cinco vectores actuales comparten limitaciones que ocultan divergencias
reales. Añade uno por hueco (no mezcles varios huecos en un mismo vector, o el
fallo no te dirá cuál es la causa):

| Hueco | Qué falta hoy | Qué debe forzar el vector nuevo | Qué destapa |
| --- | --- | --- | --- |
| Techo de presupuesto | Los 5 vectores tienen `restricciones.presupuesto` ausente, así que `comercial.estado` siempre es `APROBACION_REQUERIDA` | Un plan con `presupuesto.techo_cop` por debajo del total, y otro por encima | `PRESUPUESTO_EXCEDIDO` y `VERIFICADO`, `techo_cop`, `procedencia`, `delta_cop`, y las `alternativas` de A1 en el caso real en que se usan |
| Paquete extra por merma | Ninguna compra tiene `additional_package_for_waste = true` | Una variante cuya reserva de merma no cabe en el sobrante natural y obliga a un paquete más | `additional_waste_packages` (A3) |
| Línea no geométrica | Todas las compras son globos con `diam_pulg` | Un plan que mezcle globos con un telón o prop (`diam_pulg = null`) | `costoNoGeometrico` de `calcularAlternativas` (A1) y `special_elements` del estimate |

**Cómo construirlos.** Copia la forma de un vector existente. Las filas de
catálogo llevan las mismas claves en los dos backends; lo único que no puedes
olvidar es `source_snapshot_id` igual a `catalog_snapshot_id` y
`currency: "COP"` (`_candidate`, `plan.py:290`). Después:

```bash
npx tsx --conditions=react-server scripts/test-paridad-plan-python.ts --update
cd services/ai-api && PARIDAD_ACTUALIZAR=1 uv run --extra test --system-certs python -m pytest tests/test_plan_parity.py
```

**Criterio de aceptación.**
- Hay al menos 8 vectores y cada hueco de la tabla está cubierto.
- Cada vector nuevo se documenta en `contracts/domain/v1/golden/plan-resolution/README.md`
  con una línea que diga qué escenario fija.
- `npm run plan:test-paridad` y `pytest tests/test_plan_parity.py` en verde.

---

## Bloque B — Verificación real (cerrado localmente; no remoto)

La cadena `Next → HTTP+HMAC → FastAPI → PostgreSQL` fue ejercitada contra el
PostgreSQL local y el snapshot publicado real. No se usó ningún entorno remoto.

### B1 · Smoke end-to-end contra el servicio vivo

**Preparación.**

```bash
# 1. PostgreSQL local con catálogo y un snapshot publicado
#    (DATABASE_URL y CATALOG_DATABASE_URL ya están en .env.example)
# 2. Servicio Python
cd services/ai-api && uv run --system-certs uvicorn app.main:app --host 127.0.0.1 --port 8000
# 3. En .env.local, solo para esta prueba:
#    INTERNAL_HMAC_SECRET=<el mismo que use el servicio>
#    PYTHON_BACKEND_ENABLED=true
#    PYTHON_BACKEND_KILL_SWITCH=false
```

**Implementado.** `scripts/test-plan-python-e2e.ts` resuelve un plan real contra
el servicio vivo mediante `llamarPythonPlanResolution`, con el
snapshot publicado real y una allowlist derivada de una búsqueda real. Omite con
un mensaje explícito si faltan variables o el kill switch está activo. Si el
backend está configurado y el servicio no responde, falla: un smoke configurado
no puede convertir una caída del servicio en un PASS.

**Criterio de aceptación.**
- El script devuelve un `plan_resuelto`, `material_estimate` y `quote`
  coherentes, y la validación de consistencia del adaptador
  (`planResolutionPayloadIsConsistent`) pasa contra una respuesta real, no
  simulada.
- Queda registrado en el informe el total en COP obtenido y el `catalog_snapshot_id`
  usado.
- El script no requiere credenciales de producción ni toca Neon.

Resultado local: `[PASS] Next adapter -> Python -> PostgreSQL local`, snapshot
`products_catalog:13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`,
total `104463 COP`.

### B2 · El camino del chat con snapshot real

`estado.ragCatalogSnapshotId` solo se llena cuando la búsqueda de catálogo pasa
por Python (`src/lib/rag/chat/buscar.ts:198`). Con el flag encendido eso ocurre
y quedó verificado de punta a punta por el arnés B2.

**Criterio de aceptación.**
- Con el flag encendido y el servicio vivo, una conversación que busca y confirma
  un plan produce una propuesta con `approval_token` cuyo contexto firmado lleva
  `backend: "python"` y un `catalogSnapshotId` no nulo.
- Sin búsqueda previa en el turno, `confirmar_plan_decoracion` responde
  `BACKEND_NO_DISPONIBLE` con `SIN_SNAPSHOT_CATALOGO` y el modelo no inventa
  precios.

Resultado local: `npm run plan:test-python-cutover` pasa. La búsqueda fija el
snapshot, la confirmación emite `approval_token` con `backend: "python"`,
snapshot y allowlist firmados; sin búsqueda devuelve
`BACKEND_NO_DISPONIBLE`.

### B3 · Rollback verificado

El ADR 0006 dice que un plan producido por Python deja de poder generarse o
editarse si se activa el kill switch. Está implementado y probado localmente.

**Criterio de aceptación.**
- Con un plan aprobado por el camino Python, activar
  `PYTHON_BACKEND_KILL_SWITCH=true` hace que `/api/generate` y `/api/plan-editar`
  respondan 409 con `causa: "PYTHON_NO_SELECCIONADO"` y un mensaje que pide
  volver a solicitar la propuesta.
- **No** se re-resuelve con TypeScript ni se genera ninguna imagen.
- Los planes nuevos siguen funcionando por el camino TypeScript.

Resultado local: `npm run plan:test-python-rollback` pasa; ambas rutas devuelven
HTTP `409` con `causa: "PYTHON_NO_SELECCIONADO"`.

---

## Bloque C — Activación

Solo cuando A y B estén cerrados. En este orden:

1. Ejecuta la batería completa y pega la salida real en el informe:
   `npm run contracts:check`, `contracts:test`, `contracts:test:domain`,
   `contracts:test:operational`, `contracts:test:python-adapter`,
   `npm run plan:test`, **`npm run plan:test-paridad-python`**, `npm run lint`,
   `npm run build --workspaces --if-present`, `npm run build`,
   `npx tsc --noEmit`, y en `services/ai-api`: `pytest`, `ruff check`,
   `ruff format --check`, `mypy`.
2. `PYTHON_BACKEND_ENABLED=true` se activó **solo en local** y B1-B3 se repitieron
   con el servicio vivo.
3. Documenta en `docs/migracion-python/progreso.md` qué se activó, con qué
   evidencia y cómo se revierte.
4. La activación remota **no es parte de esta tarea**: requiere autorización
   explícita del usuario, secreto HMAC provisionado y la ventana de observación
   descrita en el ADR 0005.

**Criterio de aceptación de la activación local.** `plan:test-paridad-python` en
verde, B1-B3 ejecutados con salida real registrada y rollback probado. Esto no
autoriza un cutover remoto.

---

## Bloque E — Controles de autoridad encontrados en la revisión

### E1 · Metadata de generación ligada al snapshot

**Estado: corregido y probado localmente (2026-09-14).** Cuando un plan Python aprobado
llega a `/api/generate`, `resolverProductosParaGeneracion` recibe el
`catalogSnapshotId` firmado y exige que `catalog_products` y `catalog_variants`
pertenezcan a ese mismo snapshot. Los productos SQLite del camino legado no se
mezclan con esa restricción porque tienen otra autoridad explícita.

El test `npm run rag:test-generation-resolver` incluye la comprobación contra un
snapshot publicado y pasa con el DSN loopback explícito.

### E2 · Recomendaciones del editor

**Estado: mitigado localmente, migración pendiente.** `src/app/api/plan-editar/route.ts`
todavía consulta SQL directo para construir recomendaciones, pero ahora exige el
token de aprobación y, para planes Python, filtra la lectura al snapshot firmado.
La aplicación de una edición vuelve a resolver el plan con el backend y snapshot
firmados. Antes de declarar el cutover completo, decidir si esta búsqueda pasa a
un endpoint Python con contrato propio o si queda documentada explícitamente
como descubrimiento no comercial.

### E3 · Allowlist producto-variante

**Estado: abierto, sin ampliación de permisos confirmada.** La búsqueda Python
recibe `variant_ids` como restricción efectiva y la selección comprueba además
que cada variante pertenezca a su `product_id`. Falta conservar esa asociación
desde el tipo paralelo de `CatalogAllowlist` y añadir un caso multi-producto.

---

## Bloque D — Fuera de esta capacidad

Sigue abierto y no lo toques dentro de este plan salvo que te lo pidan:

| Fase | Pendiente |
| --- | --- |
| 1.4 | Arnés de medición `npm run ia:bench` |
| 1.5 | Telemetría durable `ai_call_log`, costes y taxonomía de IA |
| 3.12 | Panel de consumo (bloqueado por falta de tráfico real instrumentado) |
| 5.4 / 5.5 | Fallos de proveedores pagados, store de idempotencia, replicación de artefactos LoRA |
| 7.2 | Presupuesto de latencia de negocio, backpressure, cancelación real |
| 9.1 | Idempotencia confirmada de fal.ai, presupuesto de gasto, límite agregado de QA/reintentos |
| 10 | Cutover selectivo, runbook final, limpieza de temporales |

---

## Informe que debes entregar al terminar

Informe entregado: [`REPORTE-CUTOVER-PYTHON-2026-09-14.md`](../../REPORTE-CUTOVER-PYTHON-2026-09-14.md).

1. Qué tareas cerraste y cuáles no, con el motivo real de las que no.
2. La salida **real** de cada comando que ejecutaste. Si algo no se ejecutó, dilo;
   no lo declares en verde.
3. Las divergencias que sigan abiertas, con campo, valor TypeScript, valor Python
   y vector.
4. Cualquier bug que encontraste en TypeScript y **no** corregiste, para que se
   trate aparte.
