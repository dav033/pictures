# ADR-0023. Un solo dueño de las reglas de conteo y estimación

Estado: aceptada (2026-09-16). Pendiente de implementar; este registro fija el destino y el orden.

Sustituye en la práctica al mecanismo temporal que describían los ADR 0005 y 0006 (borrados del árbol en `c7facf3`, recuperables con `git show c7facf3^:docs/architecture/decisions/<fichero>`).

## Problema

Las reglas de conteo, medidas, estimación de materiales y cotización están implementadas **dos veces**: en TypeScript (`src/lib/plan/resolver.ts`, `src/lib/materiales/estimacion.ts`, `src/lib/plan/optimizar-materiales.ts`, `src/lib/medidas/geometria.ts`, `src/lib/cotizacion/motor.ts`) y en Python (`services/ai-api/app/plan.py`). Dieciocho funciones de `plan.py` declaran en su propio docstring ser "mirror of" su gemela en TypeScript. Son unas 2.350 líneas de Python cubriendo lo mismo que unas 1.730 de TypeScript.

`AGENTS.md` ya lo prohíbe: *"Give every business rule one authoritative owner. During the Python migration, use explicit temporary adapters instead of independently maintaining equivalent rules in two languages."* Lo que existe es lo segundo.

El coste dejó de ser teórico el 2026-09-16. Una propuesta falló en producción local con `ESTIMACION_INCONSISTENTE` cuatro veces seguidas y después `PLAN_NO_CONVERGE`; el mensaje al cliente lo inventó el modelo. Causa: el proceso `uvicorn` local llevaba desde el día anterior sirviendo el `plan.py` que cargó al arrancar, anterior al commit `e79e8f0`, que redefinió `additional_waste_packages` y `waste_only_savings_cop` **dentro del mismo `design-material-estimate-v1`**. Next ya usaba las definiciones nuevas y recalculaba los totales de Python para compararlos; Python devolvía los viejos. El esquema los aceptaba —son números válidos— y la incoherencia solo apareció una capa después.

Los vectores dorados no lo vieron, y no podían: comparan código contra código, no contra el proceso que responde. Y ningún test pasaba la estimación **de Python** por `validateMaterialEstimate`, la puerta que sí la juzga en producción; solo se validaban las de TypeScript, que son incapaces de fallarla porque `estimateFromPlan` las construye con la misma función `totals()` que después las comprueba.

El duplicado no es homogéneo. Son tres clases con causas distintas:

1. **Duplicación viva.** Las dos implementaciones se ejecutan hoy, en la misma petición, sobre los mismos datos, y nadie compara sus resultados. La geometría (`calcularMedidas`, `tamanosObligatorios`, `proporcionesEfectivas`, `factorGlobosPorMetro`) corre siempre en TypeScript desde la herramienta `calcular_medidas` (`registro-herramientas.ts:1055`), sin pasar por ningún backend, mientras `plan.py` la espeja en `_medidas`, `_TAMANO_OBLIGATORIO` y `_proporciones_efectivas`. Si divergen, sale un plan mal medido sin error.
2. **Duplicación de reversión.** `resolverPlan`, `estimateFromPlan` y `cotizarPlan` solo corren en la rama `backend: "next"` de `resolver-backend.ts:62-67`, que hoy es el destino del kill switch.
3. **Un camino vivo que nunca toca Python.** La rama "sin plan" de `src/app/api/generate/route.ts:861-1114` (`estimateFromMeasuredMaterials` → `blockingPhysicalWarnings` → `cotizarProductos`), alcanzable desde el botón "Generar visualización" de `src/app/page.tsx:1740-1742`, que llama a `generar()` sin plan.

## Decisión

**Python es el único dueño de las reglas de conteo, medidas, estimación y cotización.** El lado TypeScript se retira. No se sustituye el duplicado por un guard de versión ni por más comparaciones: se elimina la causa.

Orden, con su razón:

1. **Se retira la rama "sin plan" de `/api/generate`, y con ella la generación manual sin propuesta.** Decisión del usuario el 2026-09-16, conociendo que desaparece el botón "Generar visualización" con piezas elegidas a mano: toda generación pasa por una propuesta aprobada. Va primero porque es borrado puro, no necesita portar nada, y quita de un golpe `estimateFromMeasuredMaterials`, `blockingPhysicalWarnings` y `cotizarProductos`.
2. **`validateMaterialEstimate` deja de recalcular fórmulas de negocio.** Validar datos externos en el límite es obligatorio y se queda: esquema, no-negativos, y capacidad ≥ demanda por línea. Re-derivar `waste_only_savings_cop`, `additional_waste_packages`, `natural_package_surplus` y los demás totales para compararlos **es el segundo dueño**, no una validación; es exactamente lo que falló el 2026-09-16. Quitada la duplicación, el recálculo sobra.
3. **La geometría pasa a Python.** Se expone como operación de `ai-api` y la herramienta `calcular_medidas` la consume. Coherente con la dirección de la migración; el precio es un salto HTTP más en el turno de chat, sobre un servicio que ese mismo turno ya usa.
4. **Se portan a Python las dos reglas que hoy solo existen en TypeScript:** `physicalWarningsForPlan` (la puerta física por estructura lineal, que hoy se aplica al resultado de los dos backends) y el pipeline de franjas de presupuesto (`resolverFranja`, deliberadamente desactivado cuando Python está seleccionado, así que hoy esa función no existe con Python activo).
5. **Los vectores dorados congelan su bloque `expected`.** Hoy lo genera TypeScript (`scripts/lib/vectores-golden.ts:239-245`) y el pytest de Python se niega a cargar sin él (`services/ai-api/tests/test_plan_parity.py:128`). Su valor es haber salido de una implementación independiente, no seguir atado a ella: se fija como oráculo inmutable y se retira el generador. A partir de ahí, cambiar un `expected` es un acto deliberado y revisable, no el efecto secundario de tocar TypeScript.
6. **Se retira `PYTHON_BACKEND_KILL_SWITCH` y se borra el resolutor TypeScript**, solo cuando 1-5 estén hechos. Es el último paso porque hasta entonces es la única reversión.

## Consecuencias

- **Se pierde la reversión inmediata a TypeScript.** Es el precio explícito de tener un solo dueño, y el ADR 0005 ya lo anticipaba: *"el selector queda como mecanismo temporal de corte, no como solución permanente"*. A partir del paso 6 la recuperación es desplegar la revisión anterior del servicio, no cambiar una variable de entorno.
- **Los planes ya aprobados con procedencia `"next"` y los tokens `v:1` dejan de poder re-resolverse.** Caducan a las 24 h, así que el paso 6 necesita una ventana de esa duración sin emitir tokens `"next"`, no una migración de datos.
- **`plan_hash` deja de ser ambiguo.** Hoy los dos backends lo calculan distinto y por eso está fuera de la paridad; con un solo resolutor, el hash tiene una sola definición.
- **Los ~10 scripts que fuerzan `PYTHON_BACKEND_ENABLED=false` para ejercitar el camino TypeScript** dejan de tener camino que ejercitar y se retiran con él.
- Mientras dure la migración, cada paso deja el árbol desplegable por sí solo. Ningún paso depende de que el siguiente esté hecho.

## Alternativas descartadas

- **Handshake de versión entre Next y Python.** Convertiría el fallo silencioso en uno explícito, que es mejor que hoy, pero deja las dos implementaciones en pie y con ellas la obligación de escribir cada corrección dos veces. Trata el síntoma.
- **Más vectores de paridad.** Los vectores comparan código contra código; el incidente del 2026-09-16 fue de runtime y ninguna cantidad de vectores lo habría detectado. Aun así, la comprobación que faltaba (pasar la estimación de Python por `validateMaterialEstimate`) se añadió el mismo día a `plan:test-paridad`, y se retirará con el paso 2 cuando esa puerta deje de recalcular.
- **Dejar TypeScript como reversión permanente.** Es el estado actual, y es el que produjo el incidente.
- **Mover las reglas a TypeScript en vez de a Python.** Contradice la dirección de la migración y dejaría a Next como dueño de la autoridad comercial, que es justo lo que el ADR 0005 retiraba.

## Rollback

Cada paso es reversible por separado con `git revert` del commit que lo introduce, mientras el paso 6 no se haya ejecutado. Después del paso 6 la reversión es desplegar la revisión anterior de `ai-api` y de la app juntas: dejan de existir dos implementaciones que puedan discrepar, así que tampoco existe la clase de fallo que motivó este registro.

## Nota operativa

En local, `uvicorn` debe arrancarse con `--reload`. Sin él sirve el `plan.py` que cargó al arrancar, que es la forma concreta en que se manifestó este problema el 2026-09-16.
