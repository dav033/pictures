# Plan de mejoras de propuestas: color, distribución, conteo y prompting (2026-09-15)

## Origen

Análisis del 2026-09-15 con seis lectores en paralelo (prompting del plan, color, conteo, distribución, prompt de imagen y QA, pruebas) y un verificador que intentó refutar cada hallazgo. De 43 candidatos, 2 quedaron refutados, 20 confirmados y 21 parciales con corrección. Este plan agrupa los confirmados y los parciales ya corregidos en cuatro frentes que se pueden ejecutar por separado, más un frente de integración.

Toda cifra de este documento sale de pruebas deterministas locales, sin proveedores pagos. Una mejora de calidad visual real (Gemini o LoRA) necesita una corrida pagada versionada y **no** se declara hasta tenerla.

## Defectos principales encontrados

| # | Área | Defecto (evidencia verificada) | Consecuencia |
|---|---|---|---|
| D1 | Conteo | Con tamaños obligatorios, `calcularDespieceEstructura` / `_despiece_with_plan_sizes` filtran la mezcla sin renormalizar, y `repartirHamilton` suma como mucho +1 por celda. | Arco 2,4 × 2,2 m con "solo R-12" cotiza 58 globos en vez de ~116; con tamaños fuera de la mezcla el total se multiplica. |
| D2 | Conteo / distribución | Un único Hamilton sobre celdas tamaño × material. | Los acentos R-18/R-24 desaparecen al pasar de 1 a 2 colores, y el reparto por color se desvía en piezas pequeñas repetidas (el error se multiplica por `repeticiones`). |
| D3 | Paridad | El desempate del Hamilton usa `localeCompare` en TS y orden por punto de código en Python. | `[Terracota 0,5, coral 0,5]` da 19/20 en TS y 20/19 en Python. |
| D4 | Conteo | La alerta física divide todos los globos del plan (pared, bouquets) entre el eje sumado de las piezas lineales. Solo existe en TS. | Pared + guirnalda o pared + semiarco no se pueden confirmar en Next y sí en Python. |
| D5 | Conteo | La reserva de merma sin cubrir compra el paquete extra en la primera variante por `variant_id`, no en la más barata. `additional_waste_packages` cuenta todos los paquetes de la línea y el ahorro reportado no existe. | Sobrecosto y métricas de calibración de MERMA engañosas (golden 08). |
| D6 | Color | Los colores obligatorios del cliente solo reconocen 11 colores base (`ALIAS_COLORES_CLIENTE`). | "amarillo", "fucsia", "turquesa", "coral" o "vino" nunca se exigen. |
| D7 | Color | El parser de colores de la foto pierde el tono de "clear pink", no separa "white/gold", manda "hot pink" a rosado y descarta navy, sage, mauve y similares. | La foto no guía el color del plan. |
| D8 | Color | Un producto de un solo color hereda colores de sus etiquetas; las ediciones del plan escriben colores libres o viejos; las alternativas del mismo color quedan de últimas. | Líneas etiquetadas con un color que la variante no tiene. |
| D9 | Prompting del plan | El agente no ve la proporción de color que ya extrajo el análisis de la foto (`appearance.composition`). `participacion` y `rol_material` no tienen descripción, y un 0,33 × 3 gasta rechazos. | Proporciones inventadas, rechazos que degradan la fidelidad de color. |
| D10 | Prompting del plan | En modo diseño se sigue ordenando llamar `calcular_medidas`, que reparte colores por igual y no conoce semiarco ni repeticiones. La descripción de `mezcla` recomienda combinaciones que el resolver no cubre. | Cantidades contradictorias y reintentos `SIN_COBERTURA`. |
| D11 | Prompt de imagen | La proporción y el acabado de color por estructura nunca llegan al prompt de Gemini ni al QA. El prompt promete "percentages in the scene spec" que no existen, y los colores salen en orden de línea, no por dominancia. | El modelo de imagen adivina qué color domina. |
| D12 | Prompt de imagen | "78 balloons total" en columnas repetidas (39 por pieza); un `semiarco` o un `marco` se cuentan como "arches"; las fotos llevan "N paquetes" y los IDs llegan al /edit de LoRA sin preflight. | Densidad duplicada, cardinalidad errónea, fugas de datos comerciales al modelo. |
| D13 | Distribución | Solo se reflejan las piezas laterales repetidas exactamente 2 veces. | Cuatro columnas laterales quedan todas a la izquierda y el QA marca como fallo un render simétrico correcto. |
| D14 | Pruebas | CI no corre la paridad cruzada TS↔Python (hoy pasa 19/19) ni nueve pruebas deterministas de prompts. | Una deriva entre backends puede quedar verde. |

## Frentes de trabajo

Cada frente trabaja en su propio worktree y rama (`mejoras/w1-conteo`, `mejoras/w2-color`, `mejoras/w3-prompt-plan`, `mejoras/w4-prompt-imagen`) desde `e738610`, con un commit por ítem y pruebas deterministas en cada ítem. Después pasa por una revisión adversarial y se integra en `fase-a/a0-linea-base`.

### W1 — Conteo y reparto (TS y Python a la vez, vectores golden)

1. **Tamaños obligatorios (D1).** Proporciones efectivas = tamaños de la mezcla dentro del conjunto obligatorio, renormalizadas a 1; si ninguno está en la mezcla, partes iguales entre los obligatorios. El total se calcula con esas proporciones (área ponderada y diámetro dominante). Los tamaños obligatorios que no se pueden ubicar quedan como supuesto visible. `repartirHamilton` / `_hamilton` fallan si las cuotas no suman el total.
2. **Redondeo controlado en dos márgenes (D2, D3).** Por instancia: totales por tamaño (Hamilton sobre la mezcla efectiva), totales por material (Hamilton sobre `participacion`) y una matriz entera que respeta ambos márgenes (piso + mayor resto + camino de aumento), con desempate por resto, luego tamaño mayor, luego índice de material. Después se multiplica por `repeticiones`. Así el color deja de decidir el desempate y TS y Python quedan iguales.
3. **Alerta física por estructura (D4).** Un solo dueño en Next (`physicalWarningsForPlan(resuelto)`) que corre sobre el `PlanResuelto` de cualquiera de los dos backends. Cada pieza lineal se compara contra su propia densidad; la pared y las piezas no geométricas se omiten. Una sola regla de `visual_density` (la densidad de la estructura con más globos) en TS y Python.
4. **Paquete extra de merma (D5).** Se elige la compra que minimiza `ceil(pendiente/unidades) × precio`; el delta real de paquetes y el ahorro real se derivan de las líneas (se actualiza golden 08).
5. **Estimación heredada sin plan.** Igualdad exacta de color antes de caer a otro color.
6. **Vectores nuevos:** `20-tamanos-obligatorios`, `21-desempate-color-mayusculas`, `22-matriz-mezclas-densidades`, `23-centro-mesa-repetido-tres-colores`, `24-reserva-paquete-mas-barato`. Se regeneran `expected` y `expected_python` y se corre `--paridad`.
7. **ADR** del reparto (problema, decisión, alternativas, consecuencias y reversión). Cambian `plan_hash` y las aprobaciones de planes con varios colores o tamaños obligatorios hechas antes del despliegue.

### W2 — Color

1. **Vocabulario de colores del cliente (D6)** derivado de la taxonomía v2: plurales y femeninos, alias de varias palabras primero ("oro rosa", "rojo vino") y exclusiones de usos que no son color ("torta de crema", "copa de vino", "rosas naturales"). Se conservan los valores canónicos existentes.
2. **Parser de etiquetas de la foto (D7):** separar por puntuación antes de plegar; "clear + tono" devuelve el tono; hot/neon pink → fucsia; tonos en inglés de una palabra.
3. **Ranking de alternativas (D8):** coincidencia exacta = 0 y familias de neutros.
4. **Color real de la variante (D8), acotado:** la regla 1 de cobertura usa los colores de la variante y la línea se etiqueta con el único color real de la variante elegida. TS y Python, vector `25-color-variante-primero`.
5. **Edición del plan (D8):** canonizar el color, usar el color único de la variante, reiniciarlo en la UI al cambiar de variante y alinear el color de un override sin color entre TS y Python (vector `26-variant-override-sin-color`).

### W3 — Prompting del agente de plan

1. Pasar `appearance.composition` saneada al bloque de referencia, con una regla subordinada a los colores del cliente y a la cobertura (D9).
2. Describir `participacion` y `rol_material` en la herramienta. Normalizar de forma determinista antes de zod (|suma−1| ≤ 0,02 se reescala; el principal pasa a ser el material de mayor participación) con registro de auditoría. La regla 3 de cobertura elige como principal al de mayor participación (D9).
3. En modo diseño, sin `calcular_medidas`; las cantidades que se mencionan al cliente salen solo del último `confirmar_plan_decoracion` con ok:true (D10).
4. Regla acotada de `unidades_declaradas` (geométricas sin cantidades; Bouquet/Figura/kit/backdrop con cantidades), con el ejemplo generado desde `ESTRUCTURAS_OFICIALES`.
5. Descripción de `mezcla` alineada con `sustitucionAdmisible`, más una tabla de prueba (D10).
6. Los ajustes de acabado se devuelven como `avisos_cliente`.
7. Nota de costo de acentos muy pequeños (cada color se compra por paquete cerrado en cada tamaño) y redacción "clear + color = línea Cristal; clear solo = transparente".

### W4 — Prompt de imagen, QA y ubicación

1. `planBlueprint` agrega por color, ordena por participación, arma `composition` con fragmentos completos y emite `resolved_colors` por dominancia (D11).
2. `colorVarietyContract` por estructura: color dominante primero, porcentaje y acabado. Se elimina la frase falsa y el QA recibe la misma mezcla (D11).
3. `bloqueMezclaPorEstructura` por instancia, sin IDs y con porcentajes que suman 100 (D12).
4. Cardinalidad por tipo de estructura (no por subcadena del nombre), cláusula de forma de semiarco y cláusula de piezas laterales separadas con el mismo dueño que el QA (D12).
5. Descripciones de fotos sin paquetes ni sufijos de variante; prompt de /edit de LoRA con frases fijas en inglés y preflight del prompt final, cerrado ante fallo (D12).
6. QA con `appearance_details` opcional y reintento correctivo con nombres legibles, insertado antes de `FINAL_OUTPUT_REMINDER`.
7. `verificarCoherenciaPrompt` estructural por estructura, también para colores.
8. Ubicación de estructuras repetidas: laterales pares ≥ 4 alternan lados; las ubicaciones centradas ×2 van en espejo (D13).
9. `sceneSizeWords` (v004) con varios diámetros; `gris` en los alias de color de LoRA y en el preflight.

### W5 — Integración

Fusionar las ramas y regenerar los vectores golden después de fusionar (W1 cambia los conteos de los vectores de W2). Añadir `plan:test-paridad-python` y las pruebas deterministas de prompts a `plan:test`, corregir la cabecera obsoleta del script de paridad y añadir una prueba de invariantes sobre los vectores (líneas ↔ compras ↔ estimado ↔ cotización ↔ bloques de prompt). Correr lint, build de workspaces, `tsc --noEmit`, `plan:test`, pytest, ruff y mypy.

## Estado de ejecución (2026-09-15, rama `mejoras/integracion`)

Los cuatro frentes se ejecutaron en su worktree desde `e738610` y están fusionados.

| Frente | Commits | Merge | Estado |
|---|---|---|---|
| W1 — conteo y reparto | `76a976d..8ade851` (8) | `0fae9cc` | completo, incluidos los cinco vectores nuevos (20–24) y el ADR del reparto |
| W2 — color | `c045697..5297627` (8) | `6e10809` | completo, con los vectores `25-color-variante-primero` y `26-variant-override-sin-color` |
| W3 — prompting del plan | `07631c4..b01f198` (11) | `240b849` | completo |
| W4 — prompt de imagen, QA y ubicación | `7cb8c34..482c228` (13) | `86e10ca` | completo |
| W5 — integración | `2e3a23b`, `ae57c38`, `715a946`, `a40562b`, `d11a7a7`, `6e28c26`, `e4f9057`, `6eaf436`, `3ef5291`, `81c790a` | — | completo salvo lo que queda listado abajo |

Lo que hizo la integración, además de fusionar:

- El vector de tamaños mal escritos pasó a `27-` para dejar 25 y 26 a la rama de color, y su campo `name` interno se corrigió (`715a946`). No había otras referencias al nombre viejo.
- **No hizo falta regenerar vectores.** Se corrieron `scripts/test-paridad-plan-python.ts --update` y `PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py` sobre los 27 vectores y el diff quedó vacío: los cambios de reparto y de reserva de merma de W1 no mueven ninguna cifra de los vectores de W2 (arco de dos materiales con mezcla clásica, `repeticiones` 1 y sin tamaños obligatorios) ni de los demás. El orden de regeneración ya no importa: desde `3ef5291`, `--update` reinyecta `expected_python` tal cual está escrito en vez de reescribir el archivo entero con `JSON.stringify` (ver la revisión de abajo).
- `plan:test` pasó de 47 a 60 agregados (`a40562b`; hoy son 61 con `plan:test-color-escena`): entraron `plan:test-color-prompt`, `plan:test-paridad-python` (la comparación cruzada TS↔Python, que hasta ahora pasaba pero no corría en CI), `plan:test-referencia-cobertura`, `ia:test-prompts`, `ia:test-creatividad`, `ia:test-escena-plan`, `ia:test-escena-plan-imagen`, `ia:test-qa-piezas-separadas`, `ui:test-presentacion-plan`, `ia:test-lora-compiler`, `ia:test-lora-v004-compactacion` y `lora:test-product-runtime`. `.github/workflows/checks.yml` ya ejecuta `npm run plan:test`, así que no hizo falta añadir pasos al workflow. Con esto queda cerrado D14.
- Prueba nueva de invariantes cruzadas (`d11a7a7`): `plan:test-invariantes` recorre los vectores y comprueba líneas ↔ despiece ↔ estimado ↔ compras ↔ cotización ↔ bloque de tamaños ↔ color del prompt. Los vectores cuya forma no admite una invariante se omiten con la razón impresa (28 vectores y 13 omisiones hoy). `scripts/lib/vectores-golden.ts` pasa a ser el dueño único de cargar y resolver los vectores para las dos suites, y `scripts/lib/escena-de-vector.ts` el de armar la escena y el prompt con la cadena de producción.

Comprobaciones ejecutadas en este worktree y su resultado real:

| Comprobación | Resultado |
|---|---|
| `npm run lint` | verde (0 errores, 30 avisos preexistentes) |
| `npm run build --workspaces --if-present` | verde |
| `npx tsc --noEmit` | exit 0 y salida vacía, también tras borrar `tsconfig.tsbuildinfo` (medido con `cmd > fichero 2>&1; echo $?`, nunca detrás de un pipe) |
| `npm run contracts:check` | verde (9 contratos de chat, 30 de dominio) |
| `npm run plan:test` | verde, 61 agregados |
| `plan:test-paridad` / `plan:test-paridad-python` | 28/28 y 28/28 |
| `plan:test-invariantes` | 28 vectores, 13 invariantes omitidas con razón, 2 rangos por instancia comprobados, 0 fallos |
| `plan:test-color-escena` | 28 vectores coherentes con los colores de producción + control negativo |
| `pytest` (services/ai-api) | 172 pasadas, 4 omitidas (necesitan Postgres) |
| `ruff check` / `ruff format --check` | verde / 31 archivos ya formateados |
| `mypy app scripts` | verde (15 archivos) |
| `npm run build` (app Next) | **bloqueado en este worktree**, ver abajo |

### Revisión de la integración (segunda pasada, 2026-09-15)

Una revisión posterior levantó seis hallazgos. Lo verificado, con su commit o su evidencia de rechazo:

| Hallazgo | Veredicto | Qué se hizo |
|---|---|---|
| El color de la escena no tiene un solo dueño (W2 × W4) | **confirmado** | `e4f9057`. `itemDesdeFila` etiquetaba `Producto.colores` con su propia regla y `verificarCoherenciaPrompt` compara esa lista con los colores comprados: los vectores 19 y 25 rompían la puerta y la generación moría en 500 con un plan aprobado. Ahora `/api/generate` usa `coloresRealesVariante`, el mismo dueño que el resolutor. |
| La invariante (f) no comprobaba el color de producción | **confirmado** | `e4f9057`. La invariante llenaba `catalogProducts[].colors` con una tercera regla. Ahora la escena de la prueba se arma con la cadena de producción entera (`scripts/lib/escena-de-vector.ts`); con la regla anterior la suite da 4 fallos donde antes daba 0. |
| `--update` pisaba `expected_python` | **confirmado** | `3ef5291`. Reescribía el archivo entero y dejaba `12` donde Python había escrito `12.0`; medido en +461/−461 líneas sobre los 27 vectores. Ahora reinyecta el bloque tal cual y `plan:test-paridad` lo comprueba en cada corrida. |
| Los vectores 25 y 26 no llevaban su número en el campo `name` | **confirmado** | `6eaf436`. Los vectores 01-09 siguen sin prefijo como deuda heredada. |
| Ningún vector ejercitaba el rango `N-N+1` por instancia | **confirmado** | `81c790a`. Vector `28-figura-repetida-reparto-inexacto` (3 piezas, 50 globos → 16-17 por pieza) y una guarda que falla si ningún vector emite un rango. |
| `npx tsc --noEmit` estaría en rojo por el export `planBlueprint` | **rechazado** | No reproduce. Next 16.3 construye con Turbopack y genera `.next/types/validator.ts`, que valida cada ruta con `extends RouteHandlerConfig<...>` y admite exports de más; `npx tsc --noEmit` sale 0 y con salida vacía, con y sin `tsconfig.tsbuildinfo`, y también tras regenerar los tipos. El `checkFields<Diff<...>>` que cita el hallazgo lo emite el plugin de **webpack** (`node_modules/next/dist/build/webpack/plugins/next-types-plugin`), no la build por defecto; el archivo `.next/types/app/api/generate/route.ts` que se observó era un resto de una build antigua. El documento tampoco declaraba verde `npm run build`: ya decía que está bloqueado en este worktree. Aun así se aceptó el fondo: en `6e28c26` `planBlueprint` salió del módulo de ruta a `src/lib/plan/blueprint.ts`, porque un módulo de ruta solo debería exportar handlers y configuración y siete scripts dependían del handler HTTP. |

### Pendiente y limitaciones

- **`npm run build` no se puede correr aquí.** Falla en 6 s con `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`: el `node_modules` del worktree es una junction al del árbol principal y Turbopack no la acepta. No es un fallo de código ni de configuración de entorno; hay que correr el build en un checkout con su propio `node_modules` antes de desplegar.
- **El TS2304 `LayoutProps` de `src/app/layout.tsx` no es deuda de código.** Se comprobó moviendo `.next/types` y volviendo a ponerlo: sin los tipos de ruta que genera Next el error aparece, con ellos `npx tsc --noEmit` queda completamente limpio. Un worktree recién creado no los tiene hasta que corre `next dev` o `next build`.
- **`plan_hash` cambia** con el reparto de W1: los planes aprobados antes del despliegue con varios colores o con tamaños obligatorios se tienen que volver a aprobar (ya estaba en Reversión).
- Sigue sin correrse nada pagado: ninguna mejora de calidad visual de Gemini o del LoRA está declarada.

## Fuera de alcance (decisiones pendientes, no se implementan)

- **Campo `patron_color`** (espiral, franjas, bloques, degradado): requiere ADR, medir la demanda y comprobar que Gemini y el LoRA sepan dibujarlo.
- **Asignación de tamaños por rol de acento** y **reserva de merma por grupo**: son decisiones comerciales. Por ahora solo se añade la nota de costo en el prompt.
- **Conector y señal de mezcla del dialecto v007 de LoRA, y orden de conceptos por unidades instaladas:** requieren una corrida pagada versionada (fal sin saldo).
- **Calibración de MERMA, λ y el factor ×0,7:** requieren montajes reales.

## Reversión

Cada ítem es un commit independiente. Los cambios de conteo cambian `plan_hash`: la reversión es revertir los commits de W1 y regenerar los vectores, y los planes aprobados después del despliegue se tienen que volver a aprobar. `PYTHON_BACKEND_KILL_SWITCH` sigue siendo la reversión del backend.
