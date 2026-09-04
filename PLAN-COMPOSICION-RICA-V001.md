# Plan: composición rica, anclada y cotizable

Estado: listo para implementación  
Fecha: 2026-09-04  
Alcance: planificador V1, resolución comercial, `SceneSpec`, compilador LoRA, compatibilidad y evaluación  
No incluye: reentrenamiento LoRA, nuevas pantallas de administración ni activación de Scene V2 en producción

## 1. Relación con los planes existentes

Este documento continúa, no reemplaza, `PLAN-COMPOSICION-Y-CELEBRACIONES-V001.md`. Se toman como decisiones previas:

- La falta de variedad debe medirse antes y después; no se evalúa por longitud ni por afinidad léxica aislada.
- La celebración sesga qué piezas convienen, pero la geometría debe obedecer al espacio, presupuesto y anclaje físico.
- El plan no debe volver a converger a `{arco central + dos columnas laterales}`.
- Ningún cambio visual justifica romper catálogo, cotización, aprobación ni el gate previo al proveedor.
- No se reentrena mientras un prompt correcto con el LoRA existente resuelva la composición.

También continúa `PLAN-CONTROL-ENTRENAMIENTOS-LORA-UI.md` en dos puntos:

- La identidad de un LoRA es una tupla de artifact, corrida, dataset, trigger, evaluación y escala; el navegador nunca elige una URL arbitraria.
- Los modos restringidos bloquean antes del gasto cuando la escena usa estructuras o variantes fuera del dataset permitido.

Este plan refina el antiguo WP-3.1. En vez de añadir figuras arbitrarias con una geometría ficticia, introduce una sola clase nueva, `escultura`, con un bill of materials exacto. Los demás tipos propuestos allí (`racimo`, `marquesina`, `panel`, `aro`, `cascada`, `bouquet`) conservan su propio alcance y no son prerrequisito para esta entrega.

### 1.1 Corrección de atribución de la evidencia reciente

Antes de ejecutar otra prueba pagada hay que corregir una inconsistencia verificable en los manifiestos:

- `data/processed/lora-v004-composicion.json:4-12` asocia la URL terminada en `0aa82cf2/...safetensors` con v004 y trigger `eventdecor_style_v2`.
- `reports/lora-debug/eval-v007-producto/manifiesto-eval-v007-producto.json:4-25` asocia v007 con la URL terminada en `0aa8f88d/...safetensors` y trigger `eventdecor_style_v3`.
- Los tres experimentos recientes registran la URL de v004 junto al trigger v3 en sus manifiestos.
- `src/lib/ia/sempertex-lora.ts:6-10` contiene la misma combinación cruzada como fallback actual.

La conclusión útil no cambia: los pesos probados pueden producir escenas ricas cuando reciben relaciones físicas explícitas, y por tanto reentrenar no es la primera respuesta. Sí cambia la atribución: esos resultados no pueden presentarse como validación de v007 hasta repetirlos con una identidad resuelta y coherente. La Fase 0 bloquea nuevas llamadas pagadas hasta resolverlo.

## 2. Resultado esperado

Un cliente podrá recibir, aprobar, cotizar y visualizar composiciones como estas sin introducir objetos ficticios:

- una guirnalda que enmarca una puerta real del espacio;
- una instalación que trepa por una pared y se derrama sobre el piso;
- racimos suspendidos de ramas de árboles a alturas escalonadas;
- una mesa envuelta por una instalación de globos;
- una escultura de araña construida con variantes concretas y cantidades exactas;
- globos impresos cuyo motivo visible, por ejemplo murciélagos o fantasmas, llega al prompt;
- props temáticos seleccionados como productos Shopify independientes, cotizados y colocados alrededor de la instalación.

La salida comercial sigue siendo una compra consolidada en COP. La salida visual deja de ser una lista de productos y pasa a ser un grafo aprobado de elementos, anclas y relaciones físicas.

Flujo objetivo:

```text
Brief + referencia opcional
    |
    v
Anclas verificadas del espacio + búsqueda de catálogo
    |
    v
Plan 1.1: estructuras + props + relaciones físicas
    |
    v
Resolver comercial: geometría o BOM exacto + variantes + paquetes + COP
    |
    v
Aprobación hash-bound del plan resuelto
    |
    v
SceneSpec 1.1: elementos independientes + descriptores perceptuales + anclas
    |
    v
Compatibilidad del LoRA + compilación + preflight del payload exacto
    |
    v
fal.ai
```

## 3. Objetivos medibles

La evaluación extiende el `eval-variedad-composicion` definido en el plan anterior. No se crea un segundo evaluador que mida lo mismo.

### 3.1 Calidad del plan antes de generar imágenes

Usar al menos 36 briefs: 12 situaciones compositivas por tres franjas de presupuesto. Deben incluir interior, exterior, entrada, pared, mesa, árbol, techo y recorrido de piso.

| Métrica | Definición | Criterio de salida |
|---|---|---:|
| `tasa_arco_columnas` | Planes cuya firma es exactamente arco central y dos laterales | `< 20 %`, conservando el umbral del plan anterior |
| `colision_composicional` | Pares de briefs distintos con la misma firma rica | `< 25 %` |
| `arquetipo_dominante` | Participación de la firma rica más frecuente | `< 35 %` |
| `cobertura_relaciones_fisicas` | Relaciones canónicas distintas usadas al menos una vez | `>= 6` |
| `concentracion_relacion` | Participación de la relación física más usada | `< 45 %` |
| `planes_ricos_elegibles` | Planes medios/altos que cumplen los tres ejes de riqueza de abajo | `>= 70 %` |
| `anclajes_con_evidencia` | Anclas con procedencia `cliente`, `foto_espacio` o `foto_referencia` | `100 %` |
| `trazabilidad_catalogo` | Elementos físicos decorativos ligados a una variante real | `100 %` |
| `conciliacion_cotizacion` | Total por líneas igual a total consolidado y hash aprobado | `100 %` |

Un plan cuenta como `plan_rico_elegible` cuando cumple simultáneamente:

1. Tiene al menos dos capas de profundidad o una relación envolvente/suspendida que por sí sola construye profundidad.
2. Tiene al menos una relación física distinta de la bilateralidad izquierda/derecha.
3. Tiene al menos una identidad visual específica: escultura, motivo impreso o prop catalogado.

Los briefs de presupuesto bajo se reportan aparte. No se obliga a añadir piezas para mejorar una métrica si el paquete cerrado excede el techo. Una pieza única bien anclada sigue siendo correcta.

### 3.2 Fidelidad semántica del pipeline

| Contrato | Criterio |
|---|---|
| Escultura | Cada componente del BOM conserva `variant_id`, unidades por instancia y parte visual hasta `PlanResuelto` |
| Prop | Cada prop se mantiene como `SceneElement` independiente; no se mezcla como material de una guirnalda |
| Motivo | `visual.pattern.motif` aparece de forma perceptual en la cláusula del producto correcto |
| Relación | Toda relación primaria del plan llega a una cláusula con el target correcto |
| Descriptor | Ningún nombre comercial definido por `TERMINOS_COMERCIALES` llega al prompt |
| Payload | El texto que pasa preflight es byte a byte el que se envía en `payload.prompt` |
| Bloqueo | Un fallo de catálogo, vocabulario, compatibilidad o preflight produce cero solicitudes a fal.ai |

### 3.3 Validación visual pagada

La validación final usa seis seeds por escenario y la tupla LoRA resuelta desde el registro. Un escenario pasa cuando:

- el anclaje principal es legible en al menos 5/6 imágenes;
- la escena se percibe como una instalación coherente, no como piezas desarmadas, en al menos 5/6;
- la escultura conserva sujeto y partes esenciales en al menos 4/6;
- los props obligatorios son reconocibles y están en el área indicada en al menos 5/6;
- el motivo impreso pedido es reconocible en al menos 4/6;
- no aparece ningún prop temático importante que no esté cotizado en al menos 5/6;
- el brazo nuevo gana o empata al baseline actual en riqueza y coherencia en al menos 80 % de las comparaciones ciegas.

## 4. Principios no negociables

1. **Cotización antes de visualización.** Si un elemento no se puede resolver a variantes, cantidades, paquetes y precio, no entra en el plan aprobable ni en el prompt.
2. **Producto y forma son datos distintos.** El producto aporta material, color, acabado, tamaño, impresión u objeto físico. El plan aporta cómo se ensambla y dónde se instala.
3. **Una escultura es un ensamblaje, no un SKU ficticio.** La araña no necesita existir como producto terminado, pero cada globo, conector visible o soporte necesario sí debe existir como variante seleccionada.
4. **Un prop no es material de una estructura.** Una calabaza, vela, banderola o mantel es un elemento visible con identidad, cantidad, ubicación y relación propias.
5. **Anclaje topológico antes que forma abstracta.** El compilador prioriza qué enmarca, qué rodea, de dónde cuelga y sobre qué se derrama. No intenta enriquecer con adjetivos como “dramático” o “ambicioso”.
6. **Una relación primaria por elemento.** Puede existir una distribución secundaria, pero no una cadena de instrucciones contradictorias que convierta la escena en collage.
7. **Anclas con procedencia.** Puertas, mesas, árboles y otros objetos del espacio solo se mencionan si vienen del cliente o de una imagen analizada. `supuesto` no es procedencia válida para un ancla obligatoria.
8. **Descripción perceptual.** El proveedor ve forma, material, color, acabado y motivo; nunca nombres de líneas, handles, SKU, IDs ni marketing.
9. **Aprobación cubre composición.** Sujeto de la escultura, props, motivos y relaciones forman parte del hash del plan. No se inyectan después desde `body.blueprint`.
10. **Fail closed antes del costo.** El sistema no degrada `escultura` a `accesorio`, no omite un prop y no sustituye una relación por una frase genérica.

## 5. Decisiones de diseño

### 5.1 Un solo tipo `escultura`

Añadir `escultura` a `TIPOS_ESTRUCTURA`. `figura`, `personaje`, `número`, `letra`, `animal` y nombres concretos como `araña` son alias o sujetos visuales, no tipos estructurales separados.

Alternativa descartada: añadir `escultura` y `figura` como dos enums. No existe una diferencia comercial o geométrica estable entre ambas y se duplicarían reglas, métricas y vocabulario.

Alternativa descartada: modelarla como `kit` o `accesorio`. Esa ruta compila hoy a un sustantivo genérico, pierde partes y no distingue unidades de material de instancias físicas.

### 5.2 BOM exacto para escultura, no geometría universal

`escultura` no se añade a `Figura` en `src/lib/medidas/geometria.ts`. Una araña, un número y un personaje no comparten un perímetro o volumen que produzca cantidades fiables.

La cuantificación se realiza con `unidades_por_instancia` por variante. El backend multiplica por `repeticiones`, consolida por `variant_id`, aplica merma solo a componentes que son globos y compra paquetes cerrados como hoy.

Alternativa descartada: usar `unidades_declaradas` y `participacion` como en `accesorio`. Los porcentajes obligan a reconstruir cantidades exactas mediante redondeo Hamilton; una pata, un ojo o un cuerpo pueden cambiar de unidad y el resultado deja de ser un BOM verificable.

Alternativa descartada: inventar un modelo geométrico paramétrico para toda escultura. Produciría una cotización aparentemente precisa sobre una forma que el backend no conoce.

### 5.3 Props separados de `estructuras`

Agregar `props_catalogo` al plan. Cada prop contiene un solo `product_id` y `variant_id`, cantidad instalada exacta, rol, ubicación y relaciones. Su identidad visual se resuelve desde catálogo y vocabulario, no desde un nombre escrito por el LLM.

Alternativa descartada: seguir usando `accesorio`. Además de ser semánticamente falso, varios props en un accesorio se convierten en materiales intercambiables de una sola cláusula.

Alternativa descartada: permitir props libres en `concepto.descripcion` o `porque`. El hash podría contener texto, pero ni el resolver ni la cotización demostrarían que existe el objeto.

### 5.4 Relación física y ubicación son ejes distintos

`ubicacion` conserva una región gruesa. `relaciones_fisicas` expresa topología y target. Un bbox no significa “enmarca la puerta”; dos cajas superpuestas tampoco significan “envuelve la mesa”.

Alternativa descartada: añadir una ubicación por cada composición posible. Volvería a crear un vocabulario cerrado y combinatorio, sin targets explícitos.

Alternativa descartada: deducir relaciones desde bboxes. Los bboxes sirven como guía de layout, no prueban montaje, continuidad ni soporte.

### 5.5 El catálogo PostgreSQL sigue siendo autoridad

No se poblarán `arquitectura_*` ni `decoraciones` para desbloquear esta feature. Ambas superficies SQLite están vacías y no contienen identidad de variante, paquete, precio ni procedencia suficiente para el flujo comercial actual.

Se reutilizan PostgreSQL, el same-turn allowlist, `resolverPlan`, `ProductConcept` y el registro LoRA. La taxonomía Scene V3 puede recibir un adaptador y nuevas etiquetas, pero no se activa en producción: su retrieval todavía devuelve placeholders y su `component_bom` está vacío.

### 5.6 El compilador sigue siendo determinista

No se añade un segundo LLM para reescribir captions. El planificador elige piezas y relaciones tipadas; el compilador las traduce mediante tablas cerradas y descriptores perceptuales validados.

Alternativa descartada: pedir un prompt creativo largo al mismo LLM. No sería reproducible, podría inventar props y volvería imposible probar cobertura exacta.

### 5.7 Compatibilidad restringida por elementos, no por adjetivos

En `training_1` y `training_2` se exige cobertura de cada tipo estructural y cada variante visible. Una `escultura` se bloquea si el dataset no declara esa estructura; un prop o globo impreso se bloquea si su variante no está en la allowlist.

Las relaciones físicas se registran y se miden, pero no se convierten inicialmente en hard allowlist: la evidencia muestra que el modelo base aporta parte de esa capacidad y bloquearlas impediría usar anclajes nuevos aunque los elementos sí estén cubiertos. Esta decisión se revisa cuando existan estadísticas fiables por relación.

`unlimited` omite allowlist de dataset, pero no omite catálogo, vocabulario perceptual, identidad del artifact, aprobación, preflight ni QA.

## 6. Modelo de datos objetivo

### 6.1 Versión de contratos

Crear `PlanDecoracion` `1.1` y `SceneSpec` `1.1`. El cambio no es solo aditivo: modifica la semántica de cantidades y relaciones.

Durante un despliegue se aceptan planes 1.0 ya aprobados por pestañas abiertas, pero siempre recorren el compilador anterior. Un plan 1.0 nunca accede parcialmente a `escultura`, props o relaciones nuevas. El servidor devuelve `PLAN_VERSION_UNSUPPORTED` después de esa ventana y el cliente regenera el plan. No se convierte un plan 1.0 de forma silenciosa porque no contiene la información necesaria.

### 6.2 Fuente única de vocabulario compositivo

Crear `src/lib/plan/composicion.ts` como autoridad de los enums compartidos. `tipos.ts`, `lora-semantics.ts`, `lora/schema.ts`, herramientas y tests importan de allí cuando el vocabulario representa el mismo concepto.

Valores de `TIPOS_ESTRUCTURA` después de esta entrega:

```text
arco · semiarco · guirnalda · columna · pared · centro_mesa ·
backdrop · kit · accesorio · escultura
```

`figura`, `personaje`, `animal`, `número`, `letra`, `forma temática` y `escultura de globos` se reconocen en input y se normalizan a `escultura`.

`bouquet` permanece como trabajo coordinado del plan anterior. No se añade de forma oportunista en este alcance; si su WP se fusiona primero, la fuente única lo incorpora sin una segunda tabla.

### 6.3 Ubicaciones gruesas

Conservar las ubicaciones actuales y añadir:

```text
zona_central · fachada · pared_lateral · alrededor_mobiliario ·
vegetacion · techo_multipunto · recorrido_suelo · esquina
```

`arco_central` queda aceptado solo para planes 1.0. Los planes 1.1 usan `zona_central`, porque una región del espacio no debe contener el nombre de una estructura.

La ubicación no genera por sí sola una frase de montaje. Para nuevas ubicaciones se requiere una relación física primaria.

### 6.4 Anclas del espacio

Añadir `espacio.anclas` con máximo 16 elementos. Valores de `TIPOS_ANCLA_ESPACIO`:

```text
puerta · pared · mesa · arbol · techo · piso · fachada · esquina · mobiliario_existente
```

Contrato conceptual:

```ts
type AnclaEspacio = {
  ancla_id: `ANC_${string}`;
  tipo: TipoAnclaEspacio;
  procedencia: "cliente" | "foto_espacio" | "foto_referencia";
  evidencia: string;
  bbox?: { x: number; y: number; width: number; height: number };
};
```

Reglas:

- `evidencia` conserva el fragmento del brief o el ID de región/elemento visual que demuestra la ancla.
- `bbox` solo aparece si una imagen ofrece coordenadas; texto libre no inventa coordenadas.
- No existe `procedencia: "supuesto"`.
- Un objeto seleccionado del catálogo no es `AnclaEspacio`; se referencia como `elemento_plan`.
- `mesa` puede ser una ancla existente del venue aunque la app no la venda. Eso permite colocar un mantel cotizado sin fingir que también se cotizó la mesa.

### 6.5 Relaciones físicas

Valores de `RELACIONES_FISICAS`:

```text
enmarcar · trepar_por · envolver · colgar_de · derramarse_sobre ·
montar_sobre · apoyarse_en · conectar_con · quedar_detras_de · quedar_debajo_de
```

Valores de `DISTRIBUCIONES_ESPACIALES`:

```text
continua · asimetrica · en_racimos · multipunto · alturas_escalonadas · recorrido
```

Contrato conceptual:

```ts
type RelacionFisica = {
  relacion: RelacionFisicaTipo;
  target:
    | { kind: "ancla_espacio"; id: string }
    | { kind: "elemento_plan"; id: string };
  prioridad: "primaria" | "secundaria";
  distribucion?: DistribucionEspacial;
};
```

Invariantes:

- Máximo una relación `primaria` por estructura o prop.
- Máximo una relación `secundaria`; se usa solo si aporta continuidad o profundidad.
- Toda referencia apunta a un ID existente.
- Las relaciones de profundidad no pueden formar ciclos.
- `colgar_de` requiere ancla `techo` o `arbol`, o un elemento aprobado capaz de soportar.
- `derramarse_sobre` requiere `piso`, `mesa` o `mobiliario_existente`.
- `trepar_por` requiere `pared`, `fachada` o un elemento vertical aprobado.
- `enmarcar` requiere `puerta`, `fachada`, `mesa` o un elemento aprobado con contorno visible.
- `alturas_escalonadas` solo acompaña `colgar_de` o `montar_sobre`.
- `recorrido` solo acompaña `conectar_con` o `derramarse_sobre`.

### 6.6 Escultura y BOM exacto

Añadir a una estructura `escultura_visual`:

```ts
type EsculturaVisual = {
  categoria_sujeto: "animal" | "personaje" | "numero" | "letra" | "objeto" | "simbolo" | "forma_tematica";
  sujeto: string;
  descripcion_perceptual_en: string;
  partes: Array<{
    parte_id: string;
    funcion: "volumen_principal" | "extremidad" | "detalle" | "base" | "conexion";
    descriptor_perceptual_en: string;
    variant_ids: string[];
  }>;
};
```

Extender `MaterialPlan` con:

```ts
unidades_por_instancia?: number;
parte_ids?: string[];
```

Validación por modo:

| Tipo | Cantidad | Variante | Participación |
|---|---|---|---|
| Geométrico actual | Backend desde medidas | Backend elige dentro de same-turn allowlist | Requerida, suma 1 |
| `backdrop`, `kit`, `accesorio` 1.0 | `unidades_declaradas` agregadas | Requerida | Requerida, suma 1 |
| `escultura` 1.1 | `unidades_por_instancia` por material | Requerida por material | No se solicita; se deriva de unidades |

Reglas para `escultura`:

- Todos los materiales tienen `product_id`, `variant_id` y `unidades_por_instancia` entero positivo.
- `total_unidades = repeticiones * sum(unidades_por_instancia)`.
- Cada `parte` referencia al menos una variante del BOM.
- Cada variante del BOM participa en al menos una parte.
- Ojos, patas, letras, bases y soportes visibles deben construirse con variantes del BOM; no basta mencionarlos en `descripcion_perceptual_en`.
- Si la construcción exige un soporte o conector no disponible como producto real, la estructura queda `SIN_COBERTURA`.
- El texto inglés pasa el mismo detector de IDs, nombres comerciales, español y términos de compra que el descriptor de producto.
- `sujeto` sirve para UI y trazabilidad; el proveedor recibe `descripcion_perceptual_en` y las partes validadas.

Ejemplo conceptual de araña cotizable:

```text
1 instancia
12 globos negros redondos para volumen principal
8 globos negros modelables/tubulares para extremidades
2 globos blancos pequeños + 2 negros pequeños para ojos
```

Los cuatro renglones deben corresponder a variantes recuperadas y cotizadas. “Araña gigante” describe el ensamblaje aprobado, no crea un producto nuevo.

### 6.7 Props de catálogo

Añadir `props_catalogo` al plan, máximo 16:

```ts
type PropCatalogo = {
  prop_id: `PROP_${string}`;
  product_id: string;
  variant_id: string;
  unidades_declaradas: number;
  rol_escena: "focal" | "soporte" | "relleno" | "acento" | "servicio";
  ubicacion: Ubicacion;
  relaciones_fisicas: RelacionFisica[];
  porque: string;
  referencia_element_id?: string;
};
```

No se acepta `nombre`, `motivo`, `material`, `color` ni `descripcion_visual` desde el LLM en este objeto. Esos datos se cargan del concepto visual ligado a la variante real.

Categorías V2 inicialmente admisibles para props visibles:

```text
banderola_cartel · vela · complemento · kit · desechable
```

La categoría sola no basta. El producto debe pasar una clasificación de visibilidad:

- `decorativo_visible`: sí entra como prop.
- `servicio_visible`: solo entra si el brief incluye mesa/servicio y su presencia es deliberada.
- `consumible_no_visual`: se cotiza si corresponde, pero no entra al prompt.
- `empaque`: nunca entra al prompt.

La clasificación debe guardar evidencia del catálogo o revisión manual. No se infiere que todo `complemento` sea decoración visible.

### 6.8 Tipos resueltos y cotización

Generalizar la procedencia de las líneas en `src/lib/plan/resuelto.ts`:

```ts
type OrigenLineaPlan =
  | { kind: "estructura"; id: string }
  | { kind: "prop"; id: string };
```

`LineaMaterial` conserva `product_id`, `variant_id`, SKU, título, unidades, tamaño, forma, acabado e imagen, y añade `origen`. `CompraConsolidada` sustituye el arreglo semántico `estructuras` por `elementos_origen`.

No se cambia la matemática de compra:

```text
unidades instaladas por variante
    + reserva aplicable solo a globos
    -> ceil(unidades requeridas / unidades por paquete)
    -> paquetes * precio por paquete
```

La consulta del resolver debe propagar además `sku_original`, `source_snapshot_id`, `source_variant_id`, `inventory_quantity` y `unidades_inferidas` cuando existan. Unidades inferidas no autorizan por sí solas un prop: la cantidad por paquete debe tener evidencia de fuente.

### 6.9 SceneSpec 1.1

Añadir `venue.anchors` y reemplazar las relaciones limitadas por `physical_relations`. Conservar relaciones de profundidad como parte del mismo contrato, no como heurística del compilador.

Cada `SceneElement` añade:

```ts
element_kind: "balloon_structure" | "catalog_prop" | "backdrop";
quantity_semantics: "material_units" | "physical_instances";
physical_form?: EsculturaVisual;
catalog_visual?: CatalogVisualDescriptor;
physical_relations: RelacionFisica[];
```

Reglas:

- Una estructura repetida se expande a una instancia física por `SceneElement`, como hoy.
- `quantity` de estructura sigue siendo unidades de material; nunca se redacta como cantidad de esculturas.
- `quantity` de prop significa instancias visibles y sí se redacta, por ejemplo `three carved pumpkins`.
- Un prop con tres unidades puede mantenerse en un elemento si comparte ubicación y relación.
- Props con targets, motivos o ubicaciones diferentes no se agrupan.
- `catalog_product_ids` conserva el BOM completo de una estructura; un prop tiene un solo ID de variante.
- `identity_constraints` deja de transportar nombres de producto. Recibe exclusivamente descriptores perceptuales.

### 6.10 Descriptor perceptual y motivos

`ProductConcept.canonical_label` continúa siendo identidad de catálogo, pero deja de ser texto listo para proveedor.

Extender `src/lib/lora/descriptor-perceptual.ts` con dos operaciones explícitas:

```ts
compilarDescriptorProductoPerceptual(concepto)
assertDescriptorPerceptualSeguro(texto)
```

El descriptor se construye solo con:

- `visual.shape`;
- `visual.material`;
- color traducido;
- acabado traducido;
- transparencia;
- `visual.pattern.kind`;
- `visual.pattern.motif`;
- política de texto impreso.

Extender `visual.pattern` con:

```ts
text_policy?: "none" | "graphic_lettering" | "exact_approved";
approved_text?: string;
evidence_ref?: string;
```

Reglas de render:

- `kind = printed` y `motif` presente produce una frase concreta, por ejemplo `printed with black bats and white ghosts`.
- Nunca se reduce a `and a printed pattern` cuando existe motivo.
- `contains_text = true` sin texto aprobado produce `with graphic lettering`; no inventa palabras legibles.
- `exact_approved` exige `approved_text` y `evidence_ref` de la variante seleccionada.
- El descriptor completo pasa por `aDescriptorPerceptual` y por el assert central.
- El test usa el `PRODUCT_VOCABULARY` combinado, no solo `V007_DATASET_PRODUCT_CONCEPTS`.

### 6.11 Capacidades del modo LoRA

Construir `LoraSceneRequirements` desde el `SceneSpec` final:

```ts
type LoraSceneRequirements = {
  structureTypes: string[];
  variantIds: string[];
  productConceptIds: string[];
  propIds: string[];
  physicalRelations: string[];
};
```

`assertLoraSceneCompatibility` aplica:

| Requisito | Unlimited | Training 1/2 |
|---|---|---|
| Artifact aprobado y respaldado | Obligatorio | Obligatorio |
| URL/trigger/dataset coherentes | Obligatorio | Obligatorio |
| Variantes reales y activas | Obligatorio | Obligatorio |
| Concepto perceptual activo | Obligatorio | Obligatorio |
| Tipo estructural en dataset | Informativo | Obligatorio |
| Variante en dataset | No limita | Obligatorio |
| Relación física en dataset | Telemetría | Telemetría inicial |

La allowlist se calcula sobre `transformedSceneSpec.catalog_product_ids`, no sobre `body.productIds` o `ragVariantIds`. El request del navegador no puede omitir un ID para saltarse la validación.

## 7. Gramática de compilación

### 7.1 Representación intermedia

Ampliar `LoraVisualClause` con:

```ts
elementKind
physicalForm
productDescriptors
printedMotifs
physicalRelations
quantitySemantics
```

Cada cláusula conserva sus `elementIds` para diagnóstico, pero ningún ID llega al texto.

Orden de información por cláusula:

1. Cantidad de instancias si son props o repeticiones físicas.
2. Sustantivo estructural o descriptor perceptual del prop.
3. Sujeto y partes esenciales si es escultura.
4. Materiales, color, acabado, tamaño y motivo provenientes del catálogo.
5. Relación primaria y target.
6. Distribución secundaria.

No se corta una cláusula requerida para cumplir longitud. Primero se eliminan estilo, fotografía repetida, paleta duplicada y calificadores. Si todavía no cabe, el preflight bloquea y reporta `PROMPT_REQUIRED_CONTENT_TOO_LONG`.

### 7.2 Diccionario estructural

Añadir:

| Tipo | Sustantivo base |
|---|---|
| `escultura` | `balloon sculpture` |

El sujeto completa el nombre: `a balloon spider sculpture`, `a balloon number sculpture`, `a balloon character sculpture`. La frase no sale del nombre comercial de los componentes.

El diccionario exacto por LoRA/trigger sigue la decisión de gramática del plan anterior. Este plan agrega semántica; no reabre la discusión v004 contra v007.

### 7.3 Diccionario de relaciones físicas

| Relación | Frase base |
|---|---|
| `enmarcar` | `framing <target>` |
| `trepar_por` | `climbing <target>` |
| `envolver` | `wrapping around <target>` |
| `colgar_de` | `suspended from <target>` |
| `derramarse_sobre` | `spilling onto <target>` |
| `montar_sobre` | `mounted on <target>` |
| `apoyarse_en` | `resting on <target>` |
| `conectar_con` | `leading from <source> toward <target>` |
| `quedar_detras_de` | `behind <target>` |
| `quedar_debajo_de` | `below <target>` |

| Distribución | Frase base |
|---|---|
| `continua` | `as one continuous installation` |
| `asimetrica` | `asymmetrically` |
| `en_racimos` | `in connected clusters` |
| `multipunto` | `at multiple attachment points` |
| `alturas_escalonadas` | `at staggered heights` |
| `recorrido` | `forming a continuous trail` |

Targets perceptuales iniciales:

| Ancla | Frase |
|---|---|
| `puerta` | `the doorway` |
| `pared` | `the wall` |
| `mesa` | `the table` |
| `arbol` | `the tree branches` |
| `techo` | `the ceiling` |
| `piso` | `the floor` |
| `fachada` | `the house facade` o `the venue facade`, según evidencia |
| `esquina` | `the architectural corner` |
| `mobiliario_existente` | descriptor perceptual confirmado por evidencia |

No se emite `or`. Si la evidencia no distingue casa de venue, se usa `the facade`, no una alternativa.

### 7.4 Reglas antidesarme

El hallazgo negativo de los experimentos se convierte en contrato:

- No compilar `cascades`, `tapers`, `sweeps`, `flows` ni `dramatic asymmetry` como forma global si no existe una relación física primaria.
- No describir más de una transformación abstracta por elemento.
- Mantener cada estructura o prop reconocible en su propia cláusula.
- No fusionar elementos con distinto target, motivo o sujeto aunque compartan color.
- Describir continuidad física entre capas con `conectar_con`, no con una lista de posiciones.
- Una instalación suspendida debe decir de qué cuelga.
- Una pieza derramada debe decir sobre qué superficie cae.
- Una escultura debe decir dónde está montada o apoyada.

### 7.5 Preflight ampliado

`LoraPromptPreflightReport` añade:

```text
props: expected/represented
patterns: expected/represented
physicalAnchors: expected/represented
physicalRelations: expected/represented
sculptureParts: expected/represented
catalogTraceability: expected/resolved
providerSafeDescriptors: boolean
payloadPromptHash: string
```

Bloqueos nuevos:

- prop aprobado sin cláusula independiente;
- `visual.pattern.motif` perdido o asociado al elemento equivocado;
- relación primaria sin frase o target;
- relación inventada por el compilador que no existe en `SceneSpec`;
- escultura degradada a `decorative accessory` o `balloon installation`;
- parte visual sin variante del BOM;
- ancla sin evidencia;
- descriptor comercial o no perceptual;
- modo restringido sin cobertura;
- prompt preflight distinto al prompt del payload final.

`requiredAnchorMissing()` deja de buscar tres frases literales y valida el mapa tipado relación-target. Así un nuevo wording no se bloquea por no contener `rear wall`.

## 8. Planificación y presupuesto

### 8.1 Prompt del planificador

Sustituir la prescripción numérica por estas reglas:

- Identifica primero anclas verificadas del espacio.
- Elige una relación física principal que organice la escena.
- Añade piezas solo si aumentan silueta, profundidad, continuidad o identidad temática y caben en el techo.
- No uses lateralidad bilateral como default; úsala solo cuando el brief o el espacio pida simetría.
- Una sola pieza anclada puede ser una composición completa con presupuesto bajo.
- Una composición media/alta debería usar dos capas o una relación envolvente/suspendida, sin imponer una cantidad fija de estructuras.
- Solo propone `escultura` cuando puede declarar BOM exacto con variantes vistas en la búsqueda actual.
- Solo propone props presentes en resultados del mismo turno.
- Nunca añade props “para ambientar” si no fueron seleccionados y cotizados.

La instrucción de piezas sin geometría se divide: legacy usa `unidades_declaradas`; `escultura` usa unidades exactas por material; props usan cantidad instalada por variante.

### 8.2 Few-shot y schema de herramienta

Eliminar `EST_01_ARCO, EST_02_COLUMNAS...` de `herramientas.ts`. Usar una descripción neutral:

```text
Identificador estable con formato EST_01_NOMBRE; el sufijo describe la pieza elegida y no prescribe su tipo.
```

Agregar un fixture de contrato diverso, no un ejemplo mostrado siempre al modelo, con:

- guirnalda que enmarca puerta;
- escultura montada en una esquina;
- dos props sobre una mesa;
- cero columnas laterales.

El fixture prueba el schema; no se incrusta literalmente en todo prompt para no sustituir un cliché por otro.

### 8.3 Cardinalidad

Eliminar la validación 3-5 de `validarCardinalidadEventoAbierto`. Mantener:

- mínimo una pieza focal cotizable;
- máximo global de 8 estructuras y 16 props;
- respeto estricto al presupuesto;
- warning de baja riqueza solo para briefs elegibles, nunca error comercial;
- error por relaciones inválidas, targets inexistentes o piezas sin cobertura.

La cardinalidad deja de ser proxy de calidad. Una puerta enmarcada por una sola guirnalda puede ser mejor composición que tres piezas sin relación.

### 8.4 Recorte presupuestal

Reemplazar el orden fijo de poda por costo marginal compositivo. Cada candidato aporta un conjunto calculado:

```text
anclaje · silueta · profundidad · continuidad · tema · servicio
```

Reglas de recorte:

- Nunca dejar una relación cuyo target fue recortado.
- Recortar juntos dependencias que de otro modo quedarían incoherentes.
- No proteger siempre `focal`; comparar costo por aporte marginal.
- Conservar al menos una señal temática si existe una opción catalogada que cabe.
- No conservar el último lateral solo porque su rol es `soporte` si la escena puede usar una pieza anclada más barata.
- Recalcular cotización, hash y firma compositiva después de cada reparación.
- Si ningún conjunto cabe, devolver la pieza única mejor anclada, no tres piezas mínimas.

## 9. Trazabilidad y seguridad comercial

### 9.1 Gate de catálogo

Antes de aprobar:

1. Cada `product_id` y `variant_id` apareció en `buscar_catalogo_rag` en el mismo turno.
2. La pareja producto/variante existe y está activa.
3. La variante tiene precio positivo y cantidad por paquete con evidencia.
4. Las unidades instaladas son enteras positivas.
5. El BOM de escultura no contiene variantes fuera de la búsqueda.
6. Cada prop está clasificado como visible y tiene concepto perceptual activo.
7. La compra consolidada cubre diseño y merma aplicable.
8. El plan resuelto, snapshot y total forman el `plan_hash`.

No se permite que `descripcion_perceptual_en` introduzca un producto adicional. Solo describe el ensamblaje de variantes ya ligadas.

### 9.2 Gate LoRA previo al costo

Orden obligatorio dentro de `/api/generate`:

1. Revalidar y resolver el plan.
2. Construir `SceneSpec` final.
3. Resolver todos los `ProductConcept`.
4. Derivar `LoraSceneRequirements` del `SceneSpec`, no del body.
5. Resolver modo y artifact desde servidor.
6. Validar artifact, evaluación, estructura y allowlist de variantes.
7. Compilar cada variante real de prompt.
8. Construir el payload final puro, incluyendo triggers y referencias opcionales.
9. Ejecutar preflight sobre `payload.prompt` exacto.
10. Abrir la llamada pagada.

Comparación, fallback legacy y modo por defecto pasan por los mismos pasos. No puede existir una ruta que use la URL hardcodeada sin `ResolvedLoraApplication`.

### 9.3 Fallos estables

Agregar códigos diferenciados:

```text
PLAN_SCULPTURE_BOM_INVALID
PLAN_PROP_NOT_CATALOG_BACKED
PLAN_ANCHOR_EVIDENCE_MISSING
PLAN_PHYSICAL_RELATION_INVALID
LORA_ARTIFACT_IDENTITY_MISMATCH
LORA_UNSUPPORTED_STRUCTURE
LORA_UNSUPPORTED_VARIANT
LORA_PERCEPTUAL_DESCRIPTOR_FAILED
LORA_REQUIRED_SEMANTICS_MISSING
```

Todos son anteriores a fal.ai. Los modos restringidos usan HTTP 409 para incompatibilidad; errores de plan no aprobable usan 422. Nunca se continúa con un prompt reducido.

## 10. Cambios por archivo

### 10.1 Contratos de plan y resolución

| Archivo | Cambio |
|---|---|
| `src/lib/plan/composicion.ts` | Nuevo: enums compartidos de estructura, ubicación, ancla, relación y distribución; schemas auxiliares e invariantes puras |
| `src/lib/plan/tipos.ts` | Plan 1.1, `escultura`, `espacio.anclas`, `relaciones_fisicas`, `escultura_visual`, `MaterialPlan.unidades_por_instancia/parte_ids`, `props_catalogo` |
| `src/lib/plan/resuelto.ts` | Origen genérico de línea, `PropResuelto`, BOM exacto y orígenes de compra consolidada |
| `src/lib/plan/resolver.ts` | Rama de BOM exacto, rama de props, same-turn allowlist, propagación de procedencia, consolidación conjunta y merma solo para globos |
| `src/lib/plan/medidas-defecto.ts` | Reconocer `escultura` sin inventar medidas ni geometría; no aplicar defaults geométricos |
| `src/lib/medidas/geometria.ts` | No añadir una figura universal; exportar un predicate compartido de tipos geométricos para eliminar arrays duplicados |
| `src/lib/plan/ubicaciones.ts` | Nuevas regiones, layouts derivados de anclas con bbox y fallback grueso; la relación queda como verdad semántica |
| `src/lib/plan/restricciones.ts` | Alias de escultura/figura; extracción de pedidos explícitos; validación de props y anclas; retirar cardinalidad 3-5 |
| `src/lib/plan/hash.ts` | Confirmar mediante test que sujeto, partes, props, anclas y relaciones alteran el hash |
| `src/lib/plan/coherencia.ts` | Validar estructuras y props sin exigir IDs dentro del prompt enviado al modelo |

### 10.2 Planificador y herramientas

| Archivo | Cambio |
|---|---|
| `src/lib/ia/herramientas.ts` | Schema 1.1 completo, enum `escultura`, BOM exacto, props y relaciones; ejemplo de ID neutral |
| `src/lib/ia/prompt-sistema.ts` | Quitar focal + dos laterales; añadir reglas anchor-first, SKU-only y presupuesto; serializar forma/composición de referencias |
| `src/lib/ia/registro-herramientas.ts` | Validar allowlist de variantes para componentes y props, resolver Plan 1.1 y devolver errores estables |
| `src/lib/rag/query-parser/parse-event.ts` | Reconocer aliases de escultura y anclas físicas sin convertirlos en productos |
| `src/lib/rag/retrieval/por-rol.ts` | Reemplazar pista focal arco/guirnalda/kit por intención dinámica de forma, tema y ancla |
| `src/lib/rag/retrieval/event-query-planner.ts` | Generar consultas específicas para props explícitos y componentes de escultura |
| `src/lib/rag/presupuesto/ensamblar.ts` | Poda por aporte marginal y dependencias, no por rol fijo |
| `src/lib/rag/presupuesto/franjas.ts` | Permitir props visibles y focos escultóricos según costo real, sin cuotas que fuercen laterales |
| `src/lib/rag/taxonomy/alcance-referencia.ts` | Permitir `other` solo cuando un match real lo reclasifica a categoría catalogada; props reales dejan de quedar automáticamente fuera de catálogo |

### 10.3 SceneSpec y prompts

| Archivo | Cambio |
|---|---|
| `src/lib/ia/reference-blueprint.ts` | Relaciones físicas con targets de elemento/ancla y preservación de forma, material y composición |
| `src/lib/ia/analizar-referencias-v2.ts` | Emitir anclas y relaciones nuevas; mantener incertidumbre y evidencia |
| `src/lib/ia/scene-spec.ts` | Schema 1.1, `element_kind`, semántica de cantidad, forma física, descriptor de catálogo, anclas y relaciones |
| `src/app/api/generate/route.ts` | `planBlueprint` conserva nuevos campos; props son elementos independientes; gate final sobre SceneSpec; ningún fallback LoRA anónimo |
| `src/lib/ia/lora-semantics.ts` | Importar vocabulario compartido y transportar relaciones/forma, sin duplicar enums |
| `src/lib/ia/lora-caption-compiler.ts` | IR rica, sustantivo `balloon sculpture`, motivos concretos, props, targets y diccionario de relaciones |
| `src/lib/ia/lora-product-runtime.ts` | Pasar descriptor perceptual y patrón estructurado, no solo `canonical_label` |
| `src/lib/ia/lora-prompt-preflight.ts` | Cobertura de props, motivos, escultura y relaciones; validación del payload final |
| `src/lib/ia/build-image-prompt.ts` | Consumir la misma semántica en la ruta Gemini; quitar enumeraciones anti-cliché que nombran arco/columnas |
| `src/lib/ia/image-qa.ts` | Observar sujeto de escultura, props, motivo y anclaje, además de cantidad/color |
| `src/lib/ia/sempertex-lora.ts` | Extraer builder puro de payload; eliminar combinación URL/trigger hardcodeada; enviar solo aplicaciones resueltas |

### 10.4 Vocabulario y compatibilidad LoRA

| Archivo | Cambio |
|---|---|
| `src/lib/lora/product-vocabulary.ts` | Política de texto, evidencia visual y validaciones para props/motivos |
| `src/lib/lora/product-vocabulary-data.ts` | Conceptos de props elegibles con evidencia real; no añadir conceptos por inferencia de marketing |
| `src/lib/lora/v007-dataset-product-vocabulary.ts` | Completar motivo/text policy donde existe evidencia; mantener identidad separada del descriptor proveedor |
| `src/lib/lora/descriptor-perceptual.ts` | Compilador y assert proveedor-seguro centralizados para productos y escultura |
| `src/lib/lora/schema.ts` | Alinear `escultura` y estructura canónica; requisitos de escena |
| `src/lib/lora/compatibility.ts` | `assertLoraSceneCompatibility` y error detallado por estructura/variante |
| `src/lib/lora/mode-resolver.ts` | Resolver siempre artifact/dataset/trigger; allowlist desde stats; eliminar bypass del modo default |
| `src/lib/lora/repository.ts` | Consultar capacidades de estructura y variantes por dataset |

No hace falta migración SQL para props: usan `shopify_variant`. `escultura` usa `element_kind = structure` y las relaciones siguen usando `spatial_relation`, valores que ya admite la migración 015. Si se decide persistir motivos como capability independiente, sí se requiere una migración posterior; no es necesario para el gate inicial porque el `variant_id` ya identifica el motivo.

### 10.5 Scene V2 y activos vacíos

| Archivo | Cambio |
|---|---|
| `src/lib/rag/taxonomy/v3.ts` | Añadir `decorative_prop` solo si se implementa un adaptador real; no activar categorías sin fuente |
| `src/lib/scene/*` | Mapear en shadow las firmas nuevas para comparación; no convertirlo en ruta de producción en esta entrega |
| `src/lib/arquitectura.ts` | Sin cambio funcional; documentar que no es autoridad comercial de esta feature |
| `src/lib/decoraciones.ts` | Sin cambio funcional; los paquetes curados podrán consumir Plan 1.1 cuando tengan filas reales |

## 11. Estrategia de pruebas

### 11.1 Contratos puros

Extender `scripts/test-plan-contratos.ts` con:

- escultura válida con cuatro variantes y partes ligadas;
- rechazo de componente sin `variant_id`;
- rechazo de componente sin unidades por instancia;
- rechazo de parte sin variante;
- rechazo de variante no usada por ninguna parte;
- rechazo de ancla con procedencia supuesta;
- rechazo de target inexistente;
- rechazo de dos relaciones primarias;
- rechazo de ciclo de profundidad;
- prop válido sin campos visuales libres;
- Plan 1.0 que no acepta campos 1.1;
- Plan 1.1 que no usa `arco_central`.

### 11.2 Cotización y resolver

Extender `scripts/test-resolver-plan.ts`, `scripts/test-plan-pg.ts`, `scripts/test-desglose-materiales.ts` y `scripts/test-material-consistency.ts`:

- `repeticiones = 2` duplica cada cantidad del BOM;
- una variante compartida por guirnalda y escultura se consolida en una compra;
- globos de escultura participan en reserva de merma;
- calabazas, manteles y velas no reciben merma de globos;
- cantidad de tres props compra el número correcto de paquetes;
- precio, SKU y unidades por paquete salen de DB, no del plan;
- producto/variante cruzados fallan;
- variante fuera del same-turn allowlist falla;
- cantidad por paquete desconocida falla;
- inventario conocido insuficiente falla o queda como bloqueo comercial explícito;
- total COP y hash cambian al cambiar una unidad, prop o variante.

### 11.3 Propagación end-to-end sin red

Extender `scripts/test-plan-lora-e2e.ts` con un fixture de Halloween catalogado:

- guirnalda `enmarcar -> ANC_PUERTA`;
- araña `montar_sobre -> guirnalda`;
- cuerpo, patas y ojos con BOM exacto;
- globos impresos con murciélagos y fantasmas;
- tres props independientes sobre el porche.

El test verifica campo por campo:

```text
Plan 1.1
-> PlanResuelto
-> planBlueprint
-> SceneSpec 1.1
-> ProductPromptCompilation
-> LoraVisualClause
-> prompt
-> payload.prompt
```

No basta buscar la palabra `spider`: debe comprobar target, partes, IDs diagnósticos, motivo, cantidades y que el prompt final no contiene IDs ni nombres comerciales.

### 11.4 Descriptor y motivo

Extender `scripts/test-descriptor-perceptual.ts` y `scripts/test-lora-product-runtime.ts`:

- recorrer el `PRODUCT_VOCABULARY` completo;
- comprobar idempotencia;
- comprobar que ningún término de `TERMINOS_COMERCIALES` sobrevive;
- concepto impreso cuyo `canonical_label` omite el detalle conserva `visual.pattern.motif`;
- murciélagos y fantasmas quedan en la misma cláusula del globo seleccionado;
- texto no aprobado se vuelve `graphic lettering`, no una frase inventada;
- prop usa descriptor físico y no título/handle de Shopify;
- concepto parcial o ambiguo bloquea todo el elemento.

### 11.5 Compilador y preflight

Extender `scripts/test-lora-caption-compiler.ts`:

- una prueba por cada relación física y target;
- `colgar_de + alturas_escalonadas`;
- `conectar_con + recorrido`;
- guirnaldas iguales con targets distintos no se agrupan;
- props iguales con motivos distintos no se agrupan;
- escultura nunca cae en fallback genérico;
- cantidad de materiales no se redacta como cantidad de esculturas;
- cantidad de props sí se redacta como instancias;
- el contenido obligatorio no se trunca;
- una forma abstracta sin ancla es inválida;
- el reporte declara cobertura 100 % de relaciones, props, motivos y partes.

Crear `scripts/test-lora-final-payload.ts`:

- construye el payload con el mismo builder que producción;
- verifica igualdad byte a byte entre prompt validado y enviado;
- inyecta un fetch espía y comprueba cero llamadas si falla compatibilidad o preflight;
- cubre individual, comparación y modo default.

### 11.6 Compatibilidad LoRA

Extender `scripts/test-lora-modes.ts` y `scripts/test-lora-specializations.ts`:

- artifact URL y trigger pertenecen a la misma corrida/dataset;
- ningún modo usa fallback anónimo;
- `escultura` fuera de stats bloquea Training 1/2;
- prop variant fuera de stats bloquea Training 1/2;
- Unlimited permite la variante, pero exige concepto perceptual;
- la allowlist usa IDs del SceneSpec final;
- un cliente no puede omitir `ragVariantIds` para saltar el gate;
- v007 rechazado no se promueve por usar un flag local;
- comparación aplica el preflight a cada payload antes de lanzar ambas llamadas.

### 11.7 Eval automático de variedad

Implementar o extender `scripts/eval-variedad-composicion.ts` con una firma rica canónica:

```text
tipo de elemento
+ tipo estructural o clase de prop
+ ubicación
+ relación primaria
+ tipo de target
+ distribución
+ capa de profundidad
+ sujeto/motivo canónico
```

Modos del script:

| Modo | Red | Uso |
|---|---|---|
| `--fixtures` | No | CI hermética sobre planes y catálogo sintético |
| `--replay <manifest>` | No | Recalcula métricas sobre salidas capturadas |
| `--live` | Solo Gemini planificador, nunca fal.ai | Gate manual/nocturno cuando cambia el prompt o retrieval |

El reporte se guarda en `reports/variedad-composicion/<fecha>.json` e incluye firmas, métricas por presupuesto, errores comerciales y versión/hash del prompt de sistema.

Modificar `scripts/eval-plan-decoracion.ts`: sus 12 casos dejan de compartir arco + columnas. Debe contener al menos seis firmas, tres relaciones y dos props, sin convertir el fixture en una expectativa única nueva.

Agregar scripts npm:

```text
plan:eval-variedad
plan:test-composicion
lora:test-final-payload
```

`plan:test-composicion` agrupa contratos, resolver, e2e, compilador, descriptor, compatibilidad y payload sin red.

### 11.8 Regresión visual controlada

Endurecer `scripts/exp-fal-lib.ts` antes de usarlo:

- `--dry-run` funciona sin `FAL_KEY`;
- `--artifact-id` resuelve URL, trigger, dataset y evaluación desde el registro;
- eliminar `--lora <url>` de protocolos oficiales;
- exigir `--confirm-spend`;
- exigir `--max-usd` y abortar antes de superar el límite;
- prohibir ejecución cuando `CI=true`;
- registrar artifact ID, run ID, dataset ID, trigger, URL hash, compiler version, prompt hash y payload literal.

Panel de aceptación:

| Caso | Capacidad aislada |
|---|---|
| Puerta Halloween | enmarcar + escultura + impresos + props |
| Mesa interior | trepar + envolver + props de mesa |
| Jardín nocturno | colgar de árbol + alturas escalonadas |
| Escena por capas | techo + backdrop + piso conectado |
| Mesa envuelta | relación envolvente sin arco |
| Control simple | una sola pieza bien anclada, no daño |

Primero ejecutar 3 seeds por caso. Solo si no hay regresión grave se ejecutan 6 seeds. Usar evaluación humana ciega y `image-qa` como segunda señal; pixel diff y dHash no deciden riqueza semántica.

## 12. Observabilidad

Registrar por generación:

- `plan_version` y `scene_spec_version`;
- firma compositiva rica;
- tipos estructurales;
- cantidad y clase de props;
- anclas, procedencia y relaciones;
- cobertura de motivos;
- total COP y cantidad de variantes;
- mode, artifact, run, dataset, trigger y escala LoRA;
- compiler version y payload prompt hash;
- resultado de compatibilidad y preflight;
- QA por anclaje, escultura, prop y motivo;
- latencia y costo de proveedor;
- nunca prompt con SKU/IDs en logs no protegidos ni `FAL_KEY`.

Dashboards o reportes mínimos:

- tasa semanal de arco + dos laterales;
- distribución de relaciones físicas;
- porcentaje de planes con props;
- bloqueos por falta de SKU/BOM/vocabulario;
- incompatibilidades por modo LoRA;
- tasa de QA visual por arquetipo;
- diferencia entre composición propuesta y composición final tras recorte de presupuesto.

## 13. Fases de implementación

### Fase 0: identidad, baseline y congelación de contratos

Trabajo:

- Corregir la atribución de los tres experimentos sin borrar sus manifiestos originales.
- Eliminar la pareja fallback URL v004 + trigger v3.
- Hacer que toda selección, incluido Unlimited/default, resuelva un artifact registrado.
- Endurecer el runner pago.
- Congelar fixtures de los prompts D, E, F y C como evidencia, sin convertirlos en templates de producción.
- Implementar la firma rica y publicar baseline sobre los fixtures actuales.
- Fijar los schemas conceptuales de Plan 1.1 y SceneSpec 1.1.

Criterio de salida:

- Un test falla ante cualquier combinación URL/trigger/dataset incorrecta.
- `--dry-run` no requiere clave y no abre red.
- Existe baseline reproducible de variedad.
- No se ha llamado a fal.ai.

### Fase 1: vocabulario y schemas

Trabajo:

- Crear fuente única de enums.
- Añadir `escultura`, ubicaciones, anclas y relaciones.
- Añadir BOM exacto y props.
- Versionar Plan 1.1.
- Implementar invariantes de targets, partes, procedencia y ciclos.
- Actualizar herramienta y aliases, sin cambiar todavía producción.

Criterio de salida:

- Todos los casos válidos e inválidos de contratos pasan.
- No existe una segunda lista manual de los mismos enums.
- Plan 1.0 y 1.1 no se mezclan.
- Cero cambios en la cotización de fixtures 1.0.

### Fase 2: resolución comercial

Trabajo:

- Resolver BOM exacto de escultura.
- Resolver props visibles.
- Generalizar origen de líneas.
- Consolidar variantes entre estructuras, esculturas y props.
- Aplicar merma según identidad física.
- Propagar procedencia e inventario.
- Actualizar edición de plan para no perder cantidades ni relaciones.

Criterio de salida:

- Araña fixture cotiza componentes, paquetes y COP exactos.
- Cambiar una pata o prop cambia compra, total y hash.
- Ningún producto no recuperado puede aprobarse.
- Los fixtures comerciales 1.0 mantienen totales previos.

### Fase 3: descriptor perceptual y SceneSpec

Trabajo:

- Extender vocabulario de patrones y props con evidencia.
- Centralizar descriptor proveedor-seguro.
- Versionar SceneSpec 1.1.
- Preservar forma, partes, props, targets y cantidades en `planBlueprint`.
- Eliminar títulos comerciales de `identity_constraints`.
- Preservar forma/composición al serializar referencias.

Criterio de salida:

- El e2e Halloween conserva todos los campos hasta SceneSpec.
- `test-descriptor-perceptual` recorre todo el vocabulario y pasa.
- Cada prop visible tiene concepto activo; los demás quedan bloqueados.
- El plan hash cubre toda intención visual nueva.

### Fase 4: compilador anclado y preflight

Trabajo:

- Ampliar IR y diccionarios.
- Compilar motivos concretos.
- Compilar esculturas y props independientes.
- Compilar relación-target y distribución.
- Implementar reglas antidesarme y presupuesto de palabras.
- Validar el payload exacto mediante builder puro.

Criterio de salida:

- Cobertura semántica 100 % en fixtures.
- Cero fallbacks genéricos para tipos conocidos.
- Cero términos comerciales.
- Cero fetch ante cualquier fallo.
- Prompt final dentro del límite o bloqueo explícito, nunca truncado.

### Fase 5: planificador, retrieval y presupuesto

Trabajo:

- Sustituir focal + laterales por anchor-first.
- Neutralizar el ejemplo de la herramienta.
- Retirar cardinalidad 3-5.
- Recuperar props/componentes explícitos.
- Introducir recorte por aporte compositivo y dependencias.
- Corregir alcance de referencia para props catalogados.
- Ejecutar eval live del planificador sin imágenes.

Criterio de salida:

- `tasa_arco_columnas < 20 %`.
- `colision_composicional < 25 %`.
- `arquetipo_dominante < 35 %`.
- Al menos seis relaciones físicas aparecen.
- Ningún plan excede presupuesto para mejorar diversidad.

### Fase 6: compatibilidad y rutas completas

Trabajo:

- Derivar requirements del SceneSpec final.
- Gate de estructura y variantes para modos restringidos.
- Cerrar bypasses de default y comparación.
- Aplicar mismo pipeline a LoRA y Gemini donde corresponda.
- Añadir códigos de error y telemetría.

Criterio de salida:

- Training 1/2 bloquean escena no cubierta antes de costo.
- Unlimited conserva catálogo completo sin saltarse seguridad.
- La comparación preflighta cada payload antes de iniciar llamadas.
- Artifact, trigger y dataset quedan trazados en toda generación.

### Fase 7: validación visual y rollout

Trabajo:

- Ejecutar smoke de 3 seeds con gasto aprobado.
- Corregir solo reglas generales.
- Ejecutar panel final de 6 seeds.
- Evaluar ciego con rúbrica versionada.
- Activar bajo `RICH_COMPOSITION_V1` y compilador `v3_anchored`.
- Mantener rollback al compilador anterior para planes 1.0.

Criterio de salida:

- Se cumplen los umbrales visuales de la sección 3.3.
- No hay regresión comercial ni de descriptor.
- Rollback probado sin aceptar planes 1.1 en un compilador incapaz de expresarlos.
- Costos, payloads y veredictos quedan en manifiesto.

## 14. Grafo de dependencias

```text
Fase 0 identidad + baseline
        |
        v
Fase 1 schemas
        |
        v
Fase 2 cotización ---------+
        |                  |
        v                  |
Fase 3 SceneSpec + visual  |
        |                  |
        v                  |
Fase 4 compilador          |
        |                  |
        +--------+---------+
                 v
Fase 5 planificador + presupuesto
                 |
                 v
Fase 6 compatibilidad integral
                 |
                 v
Fase 7 pruebas pagadas + rollout
```

Fases 2 y el enriquecimiento de vocabulario de Fase 3 pueden avanzar en paralelo después de congelar schemas. Fase 5 no se activa antes de Fase 4: sería posible aprobar una composición que el compilador todavía aplana. Ninguna prueba pagada empieza antes de Fase 6.

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Una descripción rica produce una escena desarmada | Una relación primaria por elemento, target obligatorio, una distribución secundaria máxima y regla que prohíbe forma abstracta sin ancla |
| El prompt crece fuera de banda | Presupuesto de palabras por prioridad; deduplicar contexto; bloquear en vez de cortar contenido obligatorio |
| La escultura queda visualmente bien pero cotiza mal | BOM exacto por variante, unidades por instancia, repetición en backend y revisión de montaje por decoración |
| El LLM inventa ojos, patas o soportes | Cada parte de escultura referencia variantes del BOM; soporte no catalogado produce `SIN_COBERTURA` |
| Los props enriquecen la imagen pero no la compra | Props independientes, variant ID obligatorio y misma consolidación comercial |
| Todo `complemento` entra como decoración | Clasificación explícita de visibilidad con evidencia; empaque y consumibles no visuales quedan fuera del prompt |
| Se filtra un nombre comercial al proveedor | Descriptor central, assert en startup/runtime/preflight y test sobre vocabulario completo |
| El motivo impreso se asocia al producto equivocado | Motivo estructurado por `ProductConceptClauseInput`; grouping key incluye concepto y patrón |
| Los bboxes contradicen relaciones | Relación es autoridad; bbox se deriva de ancla cuando existe y solo orienta layout |
| Un target se poda por presupuesto y deja una pieza flotando | Recorte por grupos de dependencia y revalidación del grafo tras cada reparación |
| La diversidad obliga a gastar más | Métricas separadas por presupuesto; no hay mínimo de piezas; presupuesto sigue siendo hard gate |
| Modo restringido genera un elemento fuera de entrenamiento | Requirements desde SceneSpec final y allowlist de estructura/variante antes de fal |
| Unlimited se convierte en bypass de seguridad | Solo omite allowlist del dataset; mantiene artifact, catálogo, vocabulario, aprobación y preflight |
| Se atribuye una prueba al LoRA incorrecto | Artifact ID obligatorio y manifiesto con tuple completa; no se aceptan URLs sueltas |
| Se sustituye arco + columnas por un nuevo template Halloween | Eval de 36 briefs, firma rica, límite de arquetipo dominante y fixture Halloween no inyectado en el prompt global |
| QA automático premia detalle pero no coherencia | Rúbrica humana ciega manda; QA automático es segunda señal |
| Plan 1.1 cae por rollback a compilador antiguo | El gate de versión bloquea la combinación; no degrada silenciosamente |

## 16. Qué no hacer

- No reentrenar v007 para resolver este problema antes de validar el compilador anclado.
- No copiar los prompts D/E/C como templates por celebración.
- No añadir adjetivos de forma abstracta sin targets físicos.
- No convertir `escultura` en una nueva fórmula de `geometria.ts`.
- No usar porcentajes como sustituto de cantidades exactas en esculturas.
- No usar `accesorio` como cajón de props visibles.
- No insertar props desde la gramática de celebración si no fueron recuperados del catálogo.
- No usar título, handle, SKU o canonical label comercial como descripción de imagen.
- No confiar en `body.productIds` para compatibilidad; usar SceneSpec final.
- No preflightar un prompt y modificarlo después en el adaptador.
- No activar Scene V2 solo porque tiene más funciones; primero requiere catálogo y BOM reales.
- No poblar tablas SQLite vacías como atajo alrededor del resolver PostgreSQL.
- No medir variedad contando únicamente tipos; las relaciones, targets, capas y props forman parte de la firma.
- No declarar victoria con dos seeds.

## 17. Definición de terminado

- `TIPOS_ESTRUCTURA` admite `escultura`; `figura` y sujetos concretos normalizan a ese valor.
- Una escultura aprobada tiene BOM exacto de variantes reales, cantidades por instancia y partes visuales ligadas.
- `props_catalogo` representa objetos no estructurales como elementos independientes y cotizables.
- Toda pieza visible del plan tiene trazabilidad a producto/variante real o es una ancla de venue con evidencia explícita.
- `visual.pattern.motif` llega al prompt con detalle concreto y política de texto segura.
- Plan y SceneSpec conservan targets y relaciones físicas de extremo a extremo.
- El compilador puede expresar enmarcar, trepar, envolver, colgar, derramarse, escalonar y conectar sin depender de bboxes fijos.
- Ningún descriptor proveedor contiene nombres comerciales, IDs, SKU, precio o paquetes.
- La aprobación y hashes cubren sujeto, BOM, props, motivos, anclas y relaciones.
- La cotización consolida estructuras, esculturas y props sin cambiar la matemática de paquetes ni COP.
- Training 1/2 bloquean estructuras y variantes no cubiertas antes de fal.ai.
- Unlimited no inventa productos ni omite gates.
- El prompt validado es idéntico al `payload.prompt` pagado.
- El eval automático detecta colapso de variedad y cumple los umbrales de la sección 3.1.
- El panel visual cumple los umbrales de la sección 3.3.
- `npm run plan:test`, `npm run plan:test-composicion`, `npm run ia:test-lora-compiler`, `npm run lora:test-product-runtime`, `npm run lora:test-modes`, `npm run lora:test-specializations`, `npx tsx scripts/test-descriptor-perceptual.ts`, `npx tsc --noEmit`, `npm run lint` y `npm run build` pasan.
- La tupla artifact/run/dataset/trigger/evaluación queda registrada en cada generación y experimento.
- Existe rollback probado y nunca degrada un plan 1.1 a un compilador que no puede expresarlo.

## 18. Preparación de implementación

Antes de modificar rutas o contratos Next.js, leer la documentación local de Next 16:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`

Orden recomendado de pull requests:

1. Identidad LoRA, runner seguro y baseline.
2. Contratos Plan 1.1 y tests puros.
3. Resolver comercial de escultura/props.
4. Descriptor perceptual y SceneSpec 1.1.
5. Compilador anclado, preflight y payload puro.
6. Planificador, retrieval y presupuesto.
7. Compatibilidad integral, eval y rollout.

Cada PR debe incluir los comandos ejecutados, métricas antes/después y confirmación de gasto US$0. Solo el último PR puede incluir un manifiesto pagado, con autorización explícita y tope fijado antes de ejecutar.
