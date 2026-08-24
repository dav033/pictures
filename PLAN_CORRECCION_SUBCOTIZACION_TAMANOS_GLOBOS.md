# Plan de correccion de subcotizacion y distribucion de tamanos de globos

Fecha de auditoria: 2026-08-23  
Estado: plan listo; implementacion no iniciada  
Alcance: imagen de referencia -> observacion visual -> geometria -> demanda instalada -> RAG/catalogo -> paquetes -> cotizacion -> prompt de imagen -> QA  
Caso disparador: cotizacion de 125 globos efectivos, 170 comprados y $193.450 COP para una escena cuyo rango razonable provisional es 160-200 globos y $230.000-$300.000 COP, incluidas dos cortinas.

## 1. Resultado ejecutivo

La cotizacion esta probablemente subestimada, pero no debe corregirse con un multiplicador global de densidad.

El sistema actual no cuenta cada R-5, R-9, R-12, R-18 y R-24 directamente desde la foto. El flujo real combina:

1. Una interpretacion de la imagen hecha por el chat, que propone estructuras, medidas, densidad y una categoria gruesa de mezcla.
2. Un segundo analisis independiente para construir el blueprint de referencia.
3. Porcentajes fijos de tamanos y una formula geometrica marcada como preliminar.
4. Recuperacion de productos comerciales que condiciona que variantes quedan disponibles.

Por tanto, el diagnostico correcto no es solamente "R-5 se confunde con R-9". En muchos recorridos no existe una observacion estructurada de R-5 que pueda confundirse: el tamano se omite antes, cuando el LLM elige una mezcla que no lo contiene o cuando el contrato visual pierde el desglose.

La solucion debe separar cuatro autoridades:

- Vision observa estructura, escala relativa, rangos y confianza.
- El backend calcula cantidades instaladas.
- RAG y catalogo cubren la demanda con variantes verificadas.
- El optimizador decide paquetes, merma, capacidad y costo.

## 2. Benchmark provisional del incidente

Este benchmark se usara para congelar el incidente, pero no se considerara ground truth definitivo hasta tener anotacion independiente.

| Metrica | Cotizacion actual | Objetivo provisional |
|---|---:|---:|
| R-5 | 0 | 20-30 |
| R-9 | 12 | 20-30 |
| R-12 | 99 | 100-115 |
| R-18 | 11 | 12-16 |
| R-24 | 3 | 6-8 |
| Total efectivo | 125 | 160-200 |
| Punto central orientativo | 125 | ~180 |
| Capacidad comprada actual | 170 | derivada de paquetes, no objetivo visual |
| Materiales con dos cortinas | $193.450 | $230.000-$300.000 |
| Zona central de precio | $193.450 | $250.000-$280.000 |

Condiciones del benchmark:

- El rango de precio solo es valido contra un snapshot fijo de catalogo.
- Deben fijarse las variantes exactas de las dos cortinas.
- R-9 frente a R-12 puede ser ambiguo por perspectiva e inflado.
- El total visible no equivale al total instalado por oclusion y profundidad.
- El punto central de 180 no se hardcodeara en produccion.

## 3. Evidencia reproducida

### 3.1 El filtro de tamanos pierde unidades

Codigo: `src/lib/medidas/geometria.ts:154-169`.

Para un arco base de 3 x 2,4 m, densidad media y mezcla `organica_fina`, el motor produce:

| Restriccion | Resultado actual |
|---|---:|
| Sin restriccion | 119 |
| Solo R-5 | 25 |
| Solo R-9 | 22 |
| Solo R-12 | 65 |
| Solo R-18 | 6 |
| Solo R-24 | 3 |
| R-5 + R-12 + R-24 | 93 |
| R-36 + R-40 | 238 |

Causa:

- El total se calcula con la mezcla original.
- Despues se filtran tamanos.
- Las proporciones restantes no se renormalizan.
- La geometria no se recalcula con la mezcla efectiva.
- Los tamanos desconocidos reciben proporcion `1` cada uno y pueden multiplicar el total.

### 3.2 El motor puede alcanzar 181 sin subir densidad global

Con una descomposicion plausible de la foto:

- arco de 3 x 2,5 m;
- dos columnas de 1,5 m;
- densidad media;
- mezcla `organica_fina` en las tres estructuras;

el motor actual devuelve:

| Tamano | Cantidad |
|---|---:|
| R-5 | 38 |
| R-9 | 32 |
| R-12 | 98 |
| R-18 | 8 |
| R-24 | 5 |
| **Total** | **181** |

Esto demuestra:

- No hace falta multiplicar globalmente la densidad para llegar al total esperado.
- La seleccion de estructuras, medidas y mezclas es determinante.
- El total puede coincidir y la distribucion por tamanos seguir siendo incorrecta.
- Forzar `organica_fina` tampoco es una solucion definitiva: sobreasigna pequenos frente al benchmark provisional y subasigna grandes.

### 3.3 La suite actual pasa sin detectar el fallo

Comando ejecutado:

```text
npm run plan:test
```

Resultado: todas las pruebas actuales pasan.

La suite no cubre:

- restricciones parciales de tamanos;
- recomputo geometrico con mezcla efectiva;
- tamanos desconocidos;
- paquete utilizado solo para cubrir merma;
- histograma visual por estructura;
- diferencias entre unidades instaladas y capacidad comprada.

El rango codificado en `scripts/test-geometria-plan.ts:29-56` proviene de la formula actual y no de una anotacion humana independiente. No debe usarse como prueba de calibracion real.

## 4. Hallazgos por severidad

### P0 - Bloqueadores de exactitud comercial

| Hallazgo | Evidencia | Impacto |
|---|---|---|
| Filtrar tamanos rompe el total | `src/lib/medidas/geometria.ts:154-169` | Subcotizacion o sobrecotizacion extrema |
| Tamanos desconocidos pueden duplicar unidades | `src/lib/medidas/geometria.ts:158-169` | Demanda fisica invalida |
| El analisis visual no tiene desglose por tamano | `src/lib/ia/reference-blueprint.ts:24-123` | No existe autoridad visual de R-5/R-24 |
| El JSON Schema de vision no declara `quantity` | `src/lib/ia/analizar-referencias-v2.ts:70-140` | Fallback frecuente a cantidad 1 |
| Chat y analizador interpretan la foto por separado | `src/app/api/chat/route.ts:81-107`, `src/app/api/references/analyze/route.ts:42-52` | Plan y blueprint pueden divergir |
| Paquetes de merma pueden desaparecer al materializar compras | `src/lib/plan/resolver.ts:175-243`, `src/lib/plan/resolver.ts:407-448` | Capacidad comprada menor que necesidad con merma |
| El prompt mezcla instalados con comprados | `src/lib/ia/scene-spec.ts:289-290`, `src/lib/ia/build-image-prompt.ts:207-225` | Imagen contradictoria y no auditable |

### P1 - Sesgos y falta de calibracion

| Hallazgo | Evidencia | Impacto |
|---|---|---|
| El LLM controla indirectamente los tamanos al escoger `mezcla` | `src/lib/ia/herramientas.ts:317-318`, `src/lib/ia/prompt-sistema.ts:111-112` | Una mala etiqueta elimina extremos completos |
| `organica_gruesa` no contiene R-5 | `src/lib/medidas/geometria.ts:42-47` | Mini globos desaparecen por diseno |
| Constantes geometricas preliminares | `src/lib/medidas/geometria.ts:1-24`, `src/lib/medidas/geometria.ts:241-244` | Error sistematico no medido |
| Un mismo modelo de densidad se usa para figuras distintas | `src/lib/medidas/geometria.ts:20-24` | Columnas, arcos y guirnaldas comparten supuestos fisicos debiles |
| Catalogo visual truncado y sin metadata fisica | `src/app/api/references/analyze/route.ts:47-50`, `src/lib/ia/analizar-referencias-v2.ts:54` | Sesgo hacia variantes frecuentes, especialmente R-12 |
| Regex defectuosa en fallback | `src/lib/ia/analizar-referencias-v2.ts:351-352` | Deteriora R-N, colores y acabados |
| Acabado no es filtro estructurado del intent activo | `src/lib/rag/query-parser/schema.ts:17-31` | El LLM puede autocertificar Metal/Satin/Reflex |
| Parser directo solo captura el primer codigo R-N en varios casos | `src/lib/rag/query-parser/deterministic.ts:41-55` | Retrieval y plan pueden exigir listas distintas |
| QA no observa histograma ni conteos | `src/lib/ia/image-qa.ts:21-96` | Perdida de extremos no detectada |
| QA desconocido falla abierto | `src/app/api/generate/route.ts:807-815` | Imagen no conforme puede entregarse normalmente |

## 5. Causa confirmada frente a hipotesis

### Confirmado

- No existe clasificador por instancia y tamano que alimente la cotizacion.
- La mezcla efectiva puede perder unidades por un defecto determinista.
- El modelo elige una categoria de mezcla que determina que tamanos existen.
- La observacion visual y el plan comercial no comparten una unica fuente de verdad.
- El prompt confunde cantidad instalada y contenido comprado.
- Las pruebas actuales no detectan estos fallos.

### Probable, pendiente de congelar el payload exacto

- Parte de la escena fue declarada `clasica`, explicando el peso de R-12.
- Otra parte fue declarada `organica_gruesa`, explicando R-9/R-18/R-24 sin R-5.
- Las medidas inferidas desde la foto quedaron por debajo de la escala real.
- La whitelist de retrieval no expuso todas las variantes hermanas necesarias.

### No demostrado

- Que el precio unitario del catalogo sea incorrecto.
- Que los 45 sobrantes sean un error de redondeo.
- Que todos los globos visualmente pequenos sean nominalmente R-5.
- Que todos los candidatos grandes sean R-24 y no R-18 inflados plenamente.
- Que subir `lambda` globalmente resuelva ambos incidentes.

## 6. Arquitectura objetivo

```text
Imagen de referencia
  -> ReferenceObservation versionada
  -> Estructuras y regiones observadas
  -> Perfil relativo de tamanos con rangos y confianza
  -> Estimador geometrico calibrado
  -> Demanda instalada por estructura, tamano, color y acabado
  -> RAG/catalogo para cubrir la demanda
  -> Optimizador global de presentaciones y merma
  -> Cotizacion preliminar y rango de confianza
  -> Aprobacion
  -> SceneSpec con cantidades instaladas
  -> Generacion
  -> QA visual y comercial
```

### Matriz de autoridad

| Dato | Autoridad |
|---|---|
| Evidencia visible, bbox, estructura y perfil relativo | Analizador visual |
| Medidas dadas por el cliente | Solicitud estructurada |
| Medidas estimadas y confianza | Estimador visual/geometrico |
| Cantidades instaladas | Backend determinista |
| Tamano, color y acabado real de variante | Snapshot de catalogo |
| Precio, paquete y disponibilidad | Oferta comercial PostgreSQL |
| Merma, capacidad y sobrante | Optimizador determinista |
| Apariencia de la imagen generada | Proveedor de imagen, sin autoridad comercial |
| Conformidad visual | QA multimodal con estado explicito |

## 7. Contratos objetivo

### 7.1 Observacion visual

```ts
type BalloonStructureObservation = {
  structure_id: string;
  source_image_id: string;
  type: "arch" | "semiarch" | "garland" | "column" | "cluster";
  bbox: BBox;
  instance_count: number;
  estimated_dimensions_m: {
    min: number;
    recommended: number;
    max: number;
    source: "user" | "scale_anchor" | "default";
  };
  density: "sparse" | "medium" | "dense";
  visible_count: { min: number; max: number };
  occlusion_factor: { min: number; max: number };
  size_profile: Array<{
    visual_band: "mini" | "small" | "base" | "large" | "jumbo";
    nominal_candidates: number[];
    share_min: number;
    share_max: number;
    confidence: number;
    evidence: string;
  }>;
  colors: Array<{ value: string; share: number; confidence: number }>;
  finishes: Array<{ value: string; share: number; confidence: number }>;
  uncertainties: string[];
};
```

Reglas:

- `visual_band` es una observacion; `R-9` o `R-12` es una resolucion posterior.
- Sin escala suficiente se conservan candidatos y rangos.
- La ausencia de una variante de catalogo no modifica lo observado.
- `instance_count` no se mezcla con unidades de globo.
- La observacion no contiene precio, paquete ni disponibilidad.

### 7.2 Demanda fisica

```ts
type InstalledMaterialDemand = {
  structure_instance_id: string;
  size_code: string;
  diameter_inches: number;
  color: string;
  finish?: string;
  installed_units: number;
  confidence: number;
  source_observation_id: string;
};
```

### 7.3 Compra comercial

```ts
type ResolvedPurchase = {
  variant_id: string;
  installed_units: number;
  waste_units: number;
  units_with_waste: number;
  units_per_package: number;
  packages: number;
  purchased_capacity: number;
  operational_surplus: number;
  potential_surplus: number;
  package_price_cop: number;
  subtotal_cop: number;
  snapshot_id: string;
};
```

## 8. Invariantes no negociables

```text
sum(size_demands.installed_units) == structure.installed_units
sum(structure.installed_units) == plan.total_installed_units
sum(color_shares) == 1 +/- tolerance
sum(size_shares) == 1 +/- tolerance
purchased_capacity >= units_with_waste
operational_surplus == purchased_capacity - units_with_waste
potential_surplus == purchased_capacity - installed_units
subtotal_cop == packages * package_price_cop
quote_total_cop == sum(subtotal_cop)
every_visual_commercial_item_is_quoted == true
every_quoted_installed_item_has_visual_binding == true
silent_size_drop_count == 0
```

## 9. Plan de ejecucion

### Ola 0 - Congelar y reconstruir el incidente

Objetivo: explicar exactamente de donde salieron 125 globos y $193.450 sin volver a invocar IA.

Archivos previstos:

- `scripts/test-plan-subcotizacion.ts` nuevo.
- `src/lib/rag/observability/log.ts`.
- `src/lib/ia/registro-herramientas.ts`.
- `src/app/api/generate/route.ts`.
- fixture privado fuera del repositorio si la imagen no tiene derechos de redistribucion.

Tareas:

- [ ] Capturar el `PlanDecoracion` exacto del incidente.
- [ ] Capturar medidas, densidad y mezcla por estructura.
- [ ] Capturar restricciones acumuladas y consultas RAG.
- [ ] Capturar whitelist de variantes.
- [ ] Capturar `PlanResuelto`, paquetes, merma y cotizacion.
- [ ] Fijar snapshot y variantes de las dos cortinas.
- [ ] Crear el fixture emparejado del caso anterior que sobredimensiono R-12.
- [ ] Registrar un `request_id` comun desde analisis hasta cotizacion.

Gate:

- [ ] El fixture reproduce 125 globos efectivos.
- [ ] El fixture reproduce 170 unidades compradas.
- [ ] El fixture reproduce $193.450 COP.
- [ ] Se identifica la estructura o regla que llevo R-5 a cero.

### Ola 1 - Corregir aritmetica determinista P0

Objetivo: impedir perdida o duplicacion de unidades antes de tocar prompts o calibracion.

Archivos previstos:

- `src/lib/medidas/geometria.ts`.
- `src/lib/plan/resolver.ts`.
- `src/lib/plan/optimizar-materiales.ts`.
- `src/lib/plan/resuelto.ts`.
- `src/lib/cotizacion/motor.ts`.
- `scripts/test-geometria-plan.ts`.
- `scripts/test-resolver-plan.ts`.
- `scripts/test-desglose-materiales.ts`.

Tareas:

- [ ] Introducir `resolveEffectiveSizeMix()` con proporciones normalizadas.
- [ ] Calcular area ponderada usando la mezcla efectiva.
- [ ] Recalcular el total cuando cambia el diametro medio.
- [ ] Rechazar tamanos fuera de la taxonomia soportada.
- [ ] Aplicar Hamilton en dos etapas: tamano y luego material/color.
- [ ] Definir minimo visible para tamanos obligatorios cuando el total lo permita.
- [ ] Conservar compras usadas solo para cubrir merma.
- [ ] Separar instalados, merma, capacidad y dos clases de sobrante.
- [ ] Ejecutar invariantes antes de devolver `PlanResuelto`.

Pruebas obligatorias:

- [ ] Solo R-5 conserva cobertura fisica y recalcula el total.
- [ ] Solo R-12 no devuelve simplemente 54% del total anterior.
- [ ] R-5 + R-12 + R-24 suma exactamente el total recalculado.
- [ ] R-36/R-40 se rechaza o usa un perfil explicitamente soportado, nunca duplica el total.
- [ ] Seis colores no eliminan un tamano obligatorio por redondeo.
- [ ] X50+X12 conserva X12 cuando solo cubre reserva de merma.
- [ ] `purchased_capacity >= units_with_waste` en todos los casos.

Gate:

- [ ] Cero violaciones de invariantes en 10.000 combinaciones generadas.
- [ ] Cero tamanos descartados silenciosamente.
- [ ] El fixture previo de sobrecotizacion no aumenta por un multiplicador global.

### Ola 2 - Crear una unica observacion visual tipada

Objetivo: dejar de depender de dos interpretaciones independientes de la misma foto.

Archivos previstos:

- `src/lib/ia/reference-balloon-observation.ts` nuevo.
- `src/lib/ia/analizar-referencias-v2.ts`.
- `src/lib/ia/reference-blueprint.ts`.
- `src/app/api/references/analyze/route.ts`.
- `src/app/api/chat/route.ts`.
- `src/lib/plan/tipos.ts`.
- `src/lib/ia/registro-herramientas.ts`.

Tareas:

- [ ] Agregar cantidad, perfil, acabado, confianza y evidencia al JSON Schema real.
- [ ] Separar cantidad de estructuras de cantidad de componentes.
- [ ] Permitir `unknown` y rangos honestos.
- [ ] Hacer que el auditor pueda corregir cantidad, bbox, perfil, color y acabado.
- [ ] Retirar el catalogo de la primera pasada de percepcion.
- [ ] Persistir o firmar la observacion y reutilizarla en chat, plan y blueprint.
- [ ] Convertir `mezcla` de decision libre del LLM a resultado derivado por backend.
- [ ] Pedir una medida clave cuando la confianza de escala quede por debajo del umbral.

Gate:

- [ ] Esta foto identifica evidencia no nula de mini y jumbo.
- [ ] Una columna clasica uniforme puede producir cero mini/jumbo.
- [ ] Plan y blueprint comparten el mismo `observation_hash`.
- [ ] Falta de R-5 en catalogo no cambia la observacion a R-9.

### Ola 3 - Calibrar geometria con montajes reales

Objetivo: sustituir porcentajes arbitrarios por parametros explicables y medidos.

Dataset minimo:

| Segmento | Minimo | Objetivo |
|---|---:|---:|
| Montajes completos | 30 | 50 |
| Arcos/semiarcos | 10 | 15 |
| Guirnaldas | 8 | 12 |
| Columnas | 8 | 12 |
| Mezclas clasicas | 8 | 12 |
| Mezclas con mini y jumbo | 15 | 25 |
| BOM y medidas reales | 100% | 100% |

Tareas:

- [ ] Registrar BOM instalado, medidas, fotos y merma real por montaje.
- [ ] Calibrar densidad por figura, no solo globalmente.
- [ ] Calibrar ancho y profundidad de banda por figura.
- [ ] Modelar oclusion visible -> instalado.
- [ ] Ajustar perfiles de tamano por tipo visual.
- [ ] Separar train/test por montaje y evento.
- [ ] Penalizar mas la subestimacion grave que la sobreestimacion leve.
- [ ] Versionar parametros y dataset de evaluacion.

Gates sugeridos:

| Metrica | Gate |
|---|---:|
| Mediana de error absoluto total | <=10% |
| Percentil 90 de error total | <=20% |
| Error medio de participacion por tamano | <=8 puntos porcentuales |
| Recall de presencia R-5/R-24 | >=90% |
| Subestimaciones mayores a 20% en suite critica | 0 |
| Cobertura del intervalo estimado | >=85% |

### Ola 4 - Reubicar RAG como resolvedor comercial

Objetivo: usar RAG para cubrir demanda, nunca para decidir cuanto material observa la foto.

Archivos previstos:

- `src/lib/rag/query-parser/schema.ts`.
- `src/lib/rag/query-parser/deterministic.ts`.
- `src/lib/rag/taxonomy/v2.ts`.
- `src/lib/rag/chat/buscar.ts`.
- `src/lib/plan/resolver.ts`.
- `src/lib/rag/catalog/*`.
- migracion de acabado por variante si falta en PostgreSQL.

Tareas:

- [ ] Anadir acabado a `IntentQuerySchema`.
- [ ] Persistir acabado verificado por variante.
- [ ] Parsear todas las menciones de tamano.
- [ ] Soportar AND, OR, negacion y ultima correccion gana.
- [ ] Consultar familias despues de conocer el perfil requerido.
- [ ] Expandir variantes hermanas en servidor solo para tamanos requeridos.
- [ ] Rankear familias por cobertura completa y costo instalado.
- [ ] Eliminar seed demo y truncamiento de la ruta comercial.
- [ ] Corregir regex de normalizacion.
- [ ] Propagar la foto especifica de variante.
- [ ] Emitir `SIN_COBERTURA` para cualquier extremo faltante.

Gates:

- [ ] Recall@1 de variante por color/tamano/acabado >=95%.
- [ ] Precision de filtros duros =100%.
- [ ] Cero sustituciones silenciosas.
- [ ] Cero acabados autocertificados por texto del LLM.
- [ ] Toda necesidad termina cubierta o declarada como brecha.

### Ola 5 - Corregir cotizacion, prompt, UI y QA

Objetivo: representar con honestidad lo instalado, comprado y visible.

Archivos previstos:

- `src/lib/cotizacion/motor.ts`.
- `src/components/TarjetaCotizacion.tsx`.
- `src/components/TarjetaPlanDecoracion.tsx`.
- `src/lib/ia/scene-spec.ts`.
- `src/lib/ia/build-image-prompt.ts`.
- `src/lib/ia/tamano-fisico.ts`.
- `src/lib/ia/image-qa.ts`.
- `src/app/api/generate/route.ts`.

UI objetivo:

| Campo | Significado |
|---|---|
| Globos instalados | Material que compone el diseno |
| Reserva de merma | Reventones previstos |
| Capacidad comprada | Contenido total de paquetes |
| Sobrante operativo | Capacidad menos instalados y reserva |
| Excedente potencial | Capacidad menos instalados si no hay perdidas |

Tareas de prompt:

- [ ] Eliminar instrucciones de usar todo el paquete en la imagen.
- [ ] No enviar capacidad comprada al proveedor visual.
- [ ] Enviar cantidades instaladas por estructura.
- [ ] En instalaciones grandes usar politica visual `approximate_distribution`.
- [ ] Exigir presencia visible de extremos, no conteo pixel-perfect.
- [ ] Mantener el LoRA limitado a estilo y escala relativa.

Tareas de QA:

- [ ] Observar conteo por estructura como rango.
- [ ] Estimar histograma mini/small/base/large/jumbo.
- [ ] Fallar si falta un extremo obligatorio.
- [ ] Tratar `unknown` como no conforme para promocion.
- [ ] Permitir un solo retry correctivo.
- [ ] Nunca modificar la cotizacion a partir de la imagen generada.

Gate:

- [ ] El caso muestra por separado ~180 instalados, reserva, capacidad y sobrante.
- [ ] La imagen contiene mini y jumbo de forma visible.
- [ ] El precio se conserva aunque la imagen visual no cuente exactamente 180.

### Ola 6 - Evaluacion, shadow y despliegue

Matriz minima:

| Caso | Riesgo cubierto |
|---|---|
| Foto de este incidente | Perdida de R-5/R-24 y subcotizacion |
| Foto del incidente anterior | Sobredimension de R-12 |
| Arco clasico R-12 | No forzar extremos universalmente |
| Guirnalda fina | Alta presencia de pequenos |
| Diseno jumbo | R-18/R-24 dominantes |
| Solo R-12 explicito | Diametro unico |
| R-5 + R-12 + R-24 | Mezcla filtrada |
| Seis materiales | Redondeo jerarquico |
| X50 + X12 por merma | Compra completa |
| Catalogo sin R-5 | Brecha explicita |
| Dos vistas de la misma escena | No duplicar inventario |
| Foto sin escala | Rango y baja confianza |

Tareas:

- [ ] Ejecutar V2 en sombra sin alterar cotizaciones.
- [ ] Registrar diferencia de total, histograma y precio frente a V1.
- [ ] Revisar manualmente diferencias mayores a 20%.
- [ ] Activar aritmetica P0 primero.
- [ ] Activar observacion y estimador despues.
- [ ] Activar RAG por demanda solo al cumplir gates.
- [ ] Mantener Scene V2 desactivado hasta eliminar stubs y placeholders.
- [ ] Crear flags independientes y rollback sin mutar catalogo.

Flags sugeridas:

```text
GEOMETRY_EFFECTIVE_MIX_V2
REFERENCE_BALLOON_OBSERVATION_V1
SIZE_PROFILE_ESTIMATOR_V2
DEMAND_DRIVEN_RAG_V1
INSTALLED_UNITS_PROMPT_V1
BALLOON_SIZE_QA_V1
```

## 10. Metricas operativas

Registrar sin guardar fotos o base64:

- `observation_hash`.
- perfil visual por estructura.
- medidas y procedencia.
- total bajo/recomendado/alto.
- mezcla efectiva.
- demanda por tamano/color/acabado.
- brechas de catalogo.
- capacidad con y sin merma.
- costo por grupo.
- diferencia V1/V2.
- aprobacion y hashes.
- QA de extremos y confianza.

Alertas:

- Diferencia V1/V2 superior a 25%.
- Cualquier tamano observado con demanda cero.
- Cualquier compra con capacidad insuficiente.
- R-12 superior a 80% en una referencia con pequenos y jumbo visibles.
- `unknown` visual entregado como conforme.
- Precio fuera del rango historico sin cambio de snapshot.

## 11. Rollback

- Cada ola se activa por flag independiente.
- El rollback vuelve al estimador previo, no revierte catalogo ni telemetria.
- Los planes V1 y V2 conservan schema/version/hash diferentes.
- Una aprobacion de V1 no se reutiliza para V2.
- Un cambio de precio o snapshot invalida la aprobacion.
- No se borra evidencia del incidente durante el rollback.

## 12. Acciones prohibidas

- No multiplicar todos los conteos por 1,44.
- No hardcodear 180 globos para cualquier arco con columnas.
- No cambiar precios para acercar artificialmente el resultado a $260.000.
- No forzar R-5/R-24 en decoraciones clasicas.
- No usar RAG para estimar cantidades visuales.
- No representar capacidad comprada como cantidad instalada.
- No tratar el test actual de 181 como ground truth humano.
- No entrenar un LoRA esperando conteo exacto de 180 objetos.
- No activar Scene V2 como parche de este incidente.
- No declarar conforme una imagen con QA desconocido.

## 13. Bloqueadores adyacentes descubiertos

No explican directamente los 125 globos, pero deben tener tickets P0 separados antes de un release comercial:

1. `body.blueprint` puede ganar al blueprint reconstruido desde el plan mientras las cajas usan IDs del plan: `src/app/api/generate/route.ts:615-620` y `src/app/api/generate/route.ts:675-682`.
2. La aprobacion no esta persistida server-side como token de un solo uso ligado a plan, precio y sesion.
3. Productos visuales adicionales pueden no quedar cubiertos por `cotizarPlan()`.
4. La prueba de idempotencia de ingesta puede purgar un catalogo real si se ejecuta contra la base equivocada.
5. El working tree auditado contiene muchos cambios y archivos sin seguimiento; debe fijarse un checkpoint reproducible sin revertir trabajo existente.

## 14. Verificacion final

Comandos minimos esperados al terminar:

```text
npm run plan:test
npm run plan:test-pg
npm run rag:eval-parser
npm run rag:e2e-v2
npm run ia:test
npm run ia:test-prompts
npm run lint
npm run build
```

Se deben agregar comandos explicitos para:

```text
npm run plan:test-subcotizacion
npm run plan:test-effective-mix
npm run plan:test-purchase-capacity
npm run ia:eval-reference-sizing
npm run ia:eval-balloon-size-qa
```

## 15. Definicion de terminado

- [ ] El incidente exacto se reproduce de forma determinista.
- [ ] El caso corregido queda entre 160 y 200 globos efectivos sin hardcode.
- [ ] R-5 queda entre 20 y 30 o existe una adjudicacion documentada que cambie el rango.
- [ ] R-24 queda entre 6 y 8 o existe una adjudicacion documentada que cambie el rango.
- [ ] R-12 permanece aproximadamente entre 100 y 115.
- [ ] El caso anterior no vuelve a sobreestimar brutalmente R-12.
- [ ] El precio del fixture, con snapshot fijo y dos cortinas, queda entre $230.000 y $300.000 COP.
- [ ] Ninguna compra tiene capacidad inferior a necesidad con merma.
- [ ] Instalados, merma, comprados y sobrantes aparecen separados.
- [ ] Toda brecha de tamano o acabado es explicita.
- [ ] Vision, plan, cotizacion, prompt y QA comparten hashes trazables.
- [ ] Una imagen sin mini o jumbo cuando son obligatorios no obtiene estado conforme.
- [ ] La suite de release tiene un gate automatico y reproducible.

## 16. Orden recomendado

El orden de implementacion no debe alterarse:

1. Ola 0: reconstruir el incidente.
2. Ola 1: arreglar aritmetica e invariantes.
3. Ola 2: unificar la observacion visual.
4. Ola 3: calibrar con datos reales.
5. Ola 4: resolver demanda con RAG/catalogo.
6. Ola 5: corregir contrato visual, UI y QA.
7. Ola 6: shadow, gates y despliegue.

Cambiar primero el prompt o el RAG sin completar las Olas 0 y 1 ocultaria defectos deterministas bajo una nueva capa probabilistica.
