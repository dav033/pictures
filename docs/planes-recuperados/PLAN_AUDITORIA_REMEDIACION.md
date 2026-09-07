# Plan único: presupuesto, RAG y fidelidad visual

Fecha de auditoría: 2026-08-22  
Estado: diagnóstico terminado; implementación no iniciada.

## Resultado ejecutivo

El total de `$408.837 COP` no nace de una suma incorrecta ni de IVA duplicado. El sistema hizo exactamente la cuenta que permiten los productos elegidos, pero llegó a una mala decisión comercial por cuatro fallos encadenados:

1. La IA convirtió un pedido genérico —`XV años estilo glamour en salón`— en una búsqueda que añadió `reflex` sin que el cliente lo hubiera pedido. Después escogió tres familias Reflex de alto costo.
2. El presupuesto no forma parte del contrato del plan. En este caso no había una franja activa; incluso cuando la hay, la canasta RAG suma un paquete por producto antes de conocer la geometría y `confirmar_plan_decoracion` no bloquea el total final.
3. El resolvedor elige la presentación del paquete por cada celda de estructura y consolida después por `variant_id`. Eso produce óptimos locales y no la combinación global más barata de paquetes X12/X20/X50.
4. La escena de imagen pierde `repeticiones`: cotiza todas las unidades, pero crea un solo elemento y una sola caja por estructura. El QA actual no inspecciona la imagen; por diseño queda en `pass: null`.

La interfaz visible contiene **un arco de 118 globos**, **dos columnas que suman 86 globos** y **dos velas**: 206 unidades. No contiene dos arcos. Si el requisito real era “dos arcos y dos columnas”, la pérdida ocurrió antes de la imagen, en el plan declarativo, y la tarjeta tampoco muestra con claridad las repeticiones.

## Evidencia cuantificada del incidente

### Descomposición del total real

| Grupo | Subtotal | Participación |
|---|---:|---:|
| R-12 Reflex | $134.961 | 33,0% |
| R-18 Reflex | $106.224 | 26,0% |
| R-24 Reflex | $145.476 | 35,6% |
| R-9 Reflex | $17.664 | 4,3% |
| Velas 1 y 5 | $4.512 | 1,1% |
| **Total** | **$408.837** | **100%** |

Solo R-18 y R-24 consumen `$251.700`, el **61,6%** de la cotización. El arco `organica_gruesa` introduce 24 globos R-18 y 11 R-24; el precio de catálogo por paquete es `$17.704/6` y `$24.246/3`, respectivamente.

### Qué parte sí es un defecto de empaques

Para las mismas familias Reflex y las mismas cantidades, un optimizador global de presentaciones produciría:

| Necesidad con merma | Compra actual | Óptimo global | Ahorro |
|---|---:|---:|---:|
| Dorado R-12: 74 | 7×X12 = $61.824 | 1×X50 + 2×X12 = $46.641 | $15.183 |
| Plata R-12: 49 | 1×X50 + 1×X12 = $37.809 | 1×X50 = $28.977 | $8.832 |
| Rosado R-12: 45 | 4×X12 = $35.328 | 1×X50 = $28.977 | $6.351 |
| **Total** | **$134.961** | **$104.595** | **$30.366** |

El total bajaría a `$378.471`: el defecto de empaques explica **7,4%**, pero no explica por sí solo el presupuesto desmesurado.

### Prueba de que la familia elegida domina el costo

Con las mismas cantidades, tamaños, colores y 8% de merma, pero usando alternativas disponibles de acabado no Reflex —Metal Dorado, Satin Plata y Fashion Rosado— y optimizando sus paquetes, el costo comparativo sería:

| Familia comparable | Costo simulado |
|---|---:|
| Metal Dorado | $62.118 |
| Satin Plata | $35.092 |
| Fashion Rosado | $65.006 |
| Velas | $4.512 |
| **Total comparable** | **$166.728** |

Esta cifra no es una nueva cotización contractual: cambia el acabado. Sirve para aislar la causa. El acabado Reflex fue una preferencia inventada por la IA, no una restricción expresa del cliente, y elevó el caso aproximadamente `$242.109` frente a esa alternativa comparable.

## Auditoría por capa

### 1. Brief y contrato de intención

- Ninguno de los cuatro chips de presupuesto está activo en el caso visible.
- El brief no conserva una lista estructurada de cantidades solicitadas, acabados explícitos y preferencias inferidas.
- El prompt obliga a proponer 3–5 estructuras y favorece mezclas complejas aun sin conocer presupuesto.
- La tarjeta no muestra `repeticiones`; “Columnas” oculta que son 2×43 y solo enseña 86 unidades agregadas.

Conclusión: el sistema puede diseñar una escena premium completa sin haber acordado costo ni cardinalidad física.

### 2. RAG

- La telemetría del turno registra la consulta generada `globo latex reflex satin rosado dorado plateado negro cromo orgánico`; `reflex`, `negro` y `cromo` no estaban en el mensaje del cliente.
- El acabado existe en la taxonomía, pero no está almacenado en `catalog_products.derived` ni en el contrato estructurado de `IntentQuery`. Queda mezclado en texto semántico y no puede distinguirse “pedido por el cliente” de “añadido por el modelo”.
- Sin presupuesto, el camino RAG base ordena por relevancia y no por costo total instalado.
- Con presupuesto, `ensamblarCanasta` suma `cantidad: 1` y `subtotal: precio` por variante. Eso controla una cesta de paquetes, no el número de paquetes que exige un arco o una columna.
- En modo plan se elimina `confirmar_seleccion_rag`, aunque `BLOQUE_FRANJAS` sigue instruyendo al modelo a usar esa herramienta. El nuevo handler no consume la canasta como restricción.

Conclusión: el RAG recupera referencias válidas, pero no entrega un conjunto factible para una geometría y un presupuesto concretos.

### 3. Catálogo y precios

- PostgreSQL contiene precios positivos, unidades por paquete y disponibilidad coherentes para las tres familias Reflex.
- Los subtotales de la UI coinciden exactamente con `paquetes × price` de PostgreSQL.
- `resolverPlan` consulta PostgreSQL y `cotizarPlan` consume el plan resuelto; SQLite no interviene en esta cotización.
- No hay evidencia de escala monetaria incorrecta, IVA duplicado ni multiplicación accidental por 100.
- El catálogo sí tiene alternativas más económicas en los mismos colores y tamaños. Falta una dimensión estructurada de acabado/calidad para compararlas sin perder intención.

Conclusión: los datos explican el precio; la selección y la optimización son el problema.

### 4. Geometría, materiales y compra

- 204 globos para un arco de 3×2,5 m y dos columnas de 2 m no es, por sí solo, un conteo anormal.
- `organica_gruesa` impone 20% R-18 y 10% R-24. Esa elección es visualmente compleja y comercialmente costosa.
- Las constantes geométricas siguen marcadas en código como preliminares y solo tienen un montaje real de calibración. Es una incertidumbre secundaria que debe medirse, no la causa principal de este incidente.
- `elegir()` decide X12/X50 usando la necesidad local; después `comprasPorVariante` solo consolida líneas que ya eligieron el mismo `variant_id`.
- No existe optimización global por familia + color + tamaño que pueda combinar distintas presentaciones.
- `confirmar_plan_decoracion` solo bloquea falta de cobertura; acepta cualquier `total_cop` y activa la generación.

Conclusión: el motor es determinista, pero optimiza la variable equivocada demasiado pronto y no tiene una restricción comercial final.

### 5. Generación de imagen

- `calcularDespieceEstructura` multiplica correctamente materiales por `repeticiones`.
- `planBlueprint` crea un elemento por estructura declarada, no por instancia física, y usa `total_unidades` como `quantity`.
- `cajasDeEstructuras` devuelve una caja por `estructura_id` e ignora `repeticiones`.
- El prompt termina diciendo cuántos globos hay, pero no garantiza “2 arcos” o “2 columnas” como instancias separadas.
- `buildQa()` declara presentes todos los elementos desde el propio `sceneSpec`, cambia `pass` a `null` y nunca observa la imagen generada. La corrección automática no puede dispararse.

Conclusión: la imagen actual coincide razonablemente con el plan visible de un arco y dos columnas, pero esa coincidencia depende del nombre plural y no de un contrato verificable. Dos arcos repetidos podrían colapsar en uno sin que el sistema lo detecte.

### 6. UI e hidratación

- En la sesión auditada no hay error de hidratación ni claves duplicadas; la consola solo contiene el aviso de Reduced Motion.
- La UI llama automáticamente `/api/generate` en cuanto aparece cualquier plan válido. El usuario ve el desglose, pero no tiene una oportunidad real de aprobar o corregir el costo antes de gastar una generación.

Conclusión: no hay un fallo de hidratación activo, pero sí un fallo de secuencia y consentimiento.

## Hipótesis contrastadas

| Hipótesis | Resultado | Evidencia |
|---|---|---|
| El catálogo o la suma están mal | Rechazada | Los 14 subtotales suman `$408.837` y coinciden con PostgreSQL. |
| La geometría produjo cientos de globos de más | Rechazada como causa principal | Son 204 globos; el 61,6% del costo está en 35 globos jumbo y sus paquetes. |
| El redondeo de paquetes infla el total | Confirmada, secundaria | El óptimo Reflex ahorra `$30.366`, 7,4%. |
| La IA eligió una gama premium no solicitada | Confirmada, principal | La consulta RAG añadió `reflex`; alternativas comparables bajan la simulación a `$166.728`. |
| El presupuesto protege el plan final | Rechazada | No había franja activa y el handler del plan no compara con `techoCop`. |
| La imagen recibe la cardinalidad física | Rechazada | `repeticiones` no llega al blueprint, layout ni QA visual. |

## Contrato objetivo

La solución se considerará correcta solo si el flujo completo cumple estas invariantes:

1. Una restricción dura solo puede venir del cliente, del catálogo o de una regla de negocio; una palabra añadida por la IA queda como preferencia blanda.
2. El presupuesto se valida contra la compra total posterior a geometría, merma y empaques, nunca contra el precio de un paquete aislado.
3. La compra es el mínimo costo global entre presentaciones permitidas, con desempate por menor sobrante y luego menor número de paquetes.
4. Sin presupuesto, el sistema muestra al menos una alternativa equilibrada y exige aprobación explícita del total antes de generar la imagen.
5. El número de instancias visuales coincide con el requisito: 2 arcos son dos elementos posicionados; 2 columnas son dos elementos posicionados.
6. Plan, cotización, prompt, imagen y QA comparten el mismo `plan_hash` y la misma lista de instancias.

## Plan de ejecución

### Ola 0 — Congelar el incidente y medirlo

#### Tarea 0.1 — Fixture de regresión end to end sin proveedor

Archivos: `scripts/test-plan-presupuesto.ts`, `scripts/test-resolver-plan.ts`, `scripts/eval-plan-decoracion.ts`, `package.json`.

- [ ] Codificar el plan exacto del incidente: 118 globos de arco, 86 de columnas, 2 velas y las tres familias Reflex.
- [ ] Añadir otro fixture explícito de “2 arcos + 2 columnas” para separar cardinalidad solicitada de unidades de material.
- [ ] Afirmar los subtotales actuales, el total `$408.837`, el óptimo Reflex `$378.471` y el comparativo no Reflex `$166.728`.
- [ ] No invocar chat ni imagen; toda la reproducción debe ser determinista contra fixtures y PostgreSQL.

Verificación: `npm run plan:test` y un nuevo `npm run plan:test-presupuesto` reproducen primero el fallo y después fijan la regresión.

#### Tarea 0.2 — Trazabilidad del plan

Archivos: `scripts/migrations/011_plan_audit.sql`, `src/lib/rag/observability/log.ts`, `src/lib/ia/registro-herramientas.ts`, `src/app/api/generate/route.ts`.

- [ ] Registrar solicitud original, restricciones explícitas, consultas RAG generadas, candidatos, familia elegida, geometría, costo mínimo compatible, costo elegido, techo, delta, empaques e instancias visuales.
- [ ] Asociar búsqueda, plan, cotización e imagen con `request_id` y `plan_hash`.
- [ ] Prohibir que la telemetría guarde imágenes, secretos o payloads completos del proveedor.

Verificación: una consulta SQL reconstruye el caso completo sin depender del estado del navegador.

### Ola 1 — Corregir intención y recuperación

#### Tarea 1.1 — Restricciones con procedencia

Archivos: `src/app/api/chat/route.ts`, `src/lib/ia/registro-herramientas.ts`, `src/lib/rag/query-parser/schema.ts`, `src/lib/rag/query-parser/parse.ts`, `src/lib/ia/herramientas.ts`.

- [ ] Crear un contrato `RestriccionesUsuario` con presupuesto, cantidades de estructuras, colores, tamaños y acabados.
- [ ] Marcar cada valor como `explicito`, `inferido` o `supuesto` y conservar el texto original del cliente como fuente.
- [ ] Impedir que una consulta generada por la IA eleve `reflex`, `cromo`, colores o cantidades no presentes a filtro duro.
- [ ] Validar que “2 arcos y 2 columnas” sobreviva hasta el `PlanDecoracion` o produzca un error corregible.

Verificación: pruebas de parser demuestran que “glamour” puede sugerir Reflex, pero no bloquear alternativas económicas ni cambiar cardinalidades.

#### Tarea 1.2 — Acabado estructurado y candidatos comparables

Archivos: `src/lib/rag/catalog/schemas.ts`, `src/lib/rag/catalog/canonicalize.ts`, `src/lib/rag/taxonomy/v2.ts`, `src/lib/rag/chat/buscar.ts`, `src/lib/rag/chat/buscar-presupuesto.ts`, migración/reimportación de catálogo.

- [ ] Persistir `derived.finishes` usando la taxonomía existente: Reflex, Satin, Metal, Fashion, etc.
- [ ] Separar coincidencia de color, acabado, ocasión y costo en el resultado RAG.
- [ ] Devolver familias alternativas compatibles por color y tamaño, no solo variantes lexicalmente cercanas.
- [ ] Mantener el acabado como obligación solo cuando el cliente lo pidió de forma explícita.

Verificación: para el fixture aparecen Reflex Dorado/Plata/Rosado y al menos una familia comparable más económica por cada color.

### Ola 2 — Unificar geometría, costo y presupuesto

#### Tarea 2.1 — Optimizador global de empaques

Archivos: `src/lib/plan/resolver.ts`, `src/lib/plan/resuelto.ts`, `src/lib/cotizacion/motor.ts`, `scripts/test-resolver-plan.ts`, `scripts/test-desglose-materiales.ts`.

- [ ] Dejar de fijar `variant_id` de empaque dentro de `elegir()`.
- [ ] Resolver primero familia + color + diámetro; agregar la necesidad de todas las estructuras y aplicar la merma una sola vez por grupo físico.
- [ ] Resolver después el problema entero de cobertura mínima entre X12/X20/X50; permitir una compra mixta de presentaciones.
- [ ] Desempatar por costo, sobrante, número de paquetes e ID estable.
- [ ] Conservar trazabilidad desde cada estructura a las variantes finalmente compradas.

Verificación: Dorado R-12 necesita 74 y compra `1×X50 + 2×X12`; el total Reflex del fixture queda en `$378.471`.

#### Tarea 2.2 — Selección costo-compatible de familia

Archivos: nuevo `src/lib/plan/optimizar-materiales.ts`, `src/lib/plan/resolver.ts`, `src/lib/rag/retrieval/rerank.ts`, `src/lib/rag/chat/buscar-presupuesto.ts`.

- [ ] Proyectar el costo instalado de cada familia candidata sobre el despiece real, no sobre un paquete unitario.
- [ ] Construir un frente de opciones `economica`, `equilibrada` y `premium`, todas compatibles con restricciones explícitas.
- [ ] Penalizar una opción dominada: más cara sin mejorar una restricción pedida por el cliente.
- [ ] Eliminar la afirmación de que `ensamblarCanasta` representa el presupuesto de una instalación geométrica; limitarla a preselección o reemplazarla por el costo posterior al plan.

Verificación: “glamour” sin acabado explícito no puede escoger automáticamente Reflex si una opción visualmente compatible cuesta sustancialmente menos sin mostrar la diferencia.

#### Tarea 2.3 — Presupuesto como compuerta dura

Archivos: `src/lib/ia/registro-herramientas.ts`, `src/lib/ia/prompt-sistema.ts`, `src/lib/plan/tipos.ts`, `src/lib/plan/resuelto.ts`.

- [ ] Pasar `techoCop` y su procedencia al contrato del plan.
- [ ] Si `total_cop > techoCop`, devolver `PRESUPUESTO_EXCEDIDO`, delta exacto y opciones deterministas de reparación; no llenar `seleccionFinalIA` ni confirmar el plan.
- [ ] Corregir la contradicción de `BLOQUE_FRANJAS`, que hoy referencia una herramienta retirada en modo plan.
- [ ] Si no hay presupuesto, marcar el plan `APROBACION_REQUERIDA` en vez de asumir que cualquier total es aceptable.

Verificación: un techo de `$150.000` bloquea el fixture Reflex antes de la imagen y nunca presenta el plan como “verificado”.

### Ola 3 — Consentimiento y claridad de UI

#### Tarea 3.1 — Separar cotizar de generar

Archivos: `src/app/page.tsx`, `src/components/TarjetaPlanDecoracion.tsx`, `src/components/TarjetaCotizacion.tsx`.

- [ ] Eliminar la generación automática del efecto que observa cualquier `plan_hash` válido.
- [ ] Mostrar primero plan, costo, techo/delta, acabado y comparativo de alternativas.
- [ ] Requerir “Aprobar y generar” para iniciar `/api/generate`; un cambio de costo invalida la aprobación anterior.
- [ ] Mostrar `2 × columnas`, unidades por instancia y total, no solo el agregado.
- [ ] Mantener un único estado cliente inicial para evitar reintroducir errores de hidratación o claves duplicadas.

Verificación en navegador: el plan puede inspeccionarse sin ninguna llamada a `/api/generate`; la consola queda sin hydration mismatch ni claves duplicadas.

### Ola 4 — Cardinalidad y QA visual real

#### Tarea 4.1 — Instancias físicas en el scene spec

Archivos: `src/lib/plan/ubicaciones.ts`, `src/app/api/generate/route.ts`, `src/lib/ia/reference-blueprint.ts`, `src/lib/ia/scene-spec.ts`, `src/lib/ia/build-image-prompt.ts`, `src/lib/ia/tamano-fisico.ts`.

- [ ] Separar `material_unit_count` de `structure_instance_count`.
- [ ] Expandir cada repetición a IDs estables (`EST_02_COLUMNAS#1`, `#2`) y cajas distintas o declarar un grupo con ubicaciones explícitas.
- [ ] Dividir cantidades y mezclas por instancia sin alterar la compra consolidada.
- [ ] Incluir al inicio del prompt un contrato literal: “exactamente 2 arcos y 2 columnas”, seguido por posición y tamaño de cada instancia.
- [ ] Hacer que `plan_hash` cubra cardinalidad, layout, costo y materiales.

Verificación: snapshots de blueprint/scene spec contienen cuatro instancias para el fixture 2+2 y ninguna comparte identidad ni caja por accidente.

#### Tarea 4.2 — Observación de la imagen y reparación

Archivos: `src/lib/ia/image-qa.ts`, `src/app/api/generate/route.ts`, pruebas de `scripts/test-image-fidelity.ts` y evaluación visual controlada.

- [ ] Reemplazar el QA autorreferencial por un observador multimodal que reciba la imagen final y la lista esperada de instancias.
- [ ] Validar conteo de estructuras, ubicación, paleta, tamaños permitidos y objetos inesperados con confianza explícita.
- [ ] Ejecutar como máximo un reintento correctivo; si sigue fallando, etiquetar la imagen como no conforme y no afirmar que representa el plan.
- [ ] Mantener pruebas deterministas de prompt y una evaluación visual opt-in separada para no gastar proveedor en cada test local.

Verificación: una imagen con un arco cuando se esperan dos falla por cardinalidad y activa una corrección específica.

### Ola 5 — Integración, métricas y despliegue

Archivos: `package.json`, `scripts/eval-plan-decoracion.ts`, `scripts/eval-presupuesto.ts`, `scripts/rag-metrics.ts`, documentación operativa del único plan.

- [ ] Añadir métricas: porcentaje sobre presupuesto, razón `costo_elegido/costo_compatible_minimo`, ahorro por optimización de paquetes, aprobación antes de generar y acierto de cardinalidad visual.
- [ ] Ejecutar en sombra el optimizador V2 sobre conversaciones nuevas y comparar sin cambiar la selección durante una muestra definida.
- [ ] Activar por flags independientes: `PLAN_COST_OPTIMIZER_V2`, `PLAN_BUDGET_GATE_V2`, `IMAGE_INSTANCE_QA`.
- [ ] Definir rollback por flag, sin revertir catálogo ni perder telemetría.

Verificación final:

```text
npm run plan:test
npm run plan:test-pg
npm run rag:eval-parser
npm run rag:eval-presupuesto
npm run rag:e2e-v2
npm run ia:test
npm run ia:test-prompts
npm run build
npm run lint
```

Después, ejecutar tres recorridos en el navegador integrado:

1. Sin presupuesto: muestra opciones y cotización; no genera hasta aprobación.
2. Con techo de `$150.000`: rechaza el plan Reflex y ofrece una reparación que sí cabe o declara honestamente que no existe.
3. Con solicitud explícita “2 arcos, 2 columnas, Reflex”: preserva las cuatro instancias, muestra el costo premium y solo genera tras aprobación.

## Criterios de aceptación del hito

- [ ] Cero planes confirmados por encima del techo sin consentimiento explícito y trazable.
- [ ] Cero acabados convertidos en restricción dura si no aparecen en la solicitud original.
- [ ] La compra del fixture Reflex es globalmente mínima y totaliza `$378.471` con las cantidades actuales.
- [ ] La opción comparable no Reflex se presenta como alternativa, no se sustituye en silencio.
- [ ] La tarjeta muestra repeticiones, unidades por instancia y costo antes de generar.
- [ ] “2 arcos + 2 columnas” produce cuatro instancias en plan, prompt y QA.
- [ ] Una imagen con cardinalidad incorrecta no obtiene estado conforme.
- [ ] No hay errores de hidratación, claves duplicadas ni doble generación en el navegador.

## Fuera de alcance y prohibiciones

- No editar precios para hacer que la cotización “se vea razonable”.
- No eliminar R-18/R-24 ni Reflex cuando el cliente los pide explícitamente.
- No poner un tope arbitrario si el cliente no dio presupuesto; se exige aprobación y se muestran alternativas.
- No confiar en sumas, cantidades o paquetes calculados por el LLM.
- No usar la canasta de un paquete por producto como prueba de que una instalación cabe en presupuesto.
- No generar ni reintentar una imagen antes de validar plan, costo, aprobación y cardinalidad.
