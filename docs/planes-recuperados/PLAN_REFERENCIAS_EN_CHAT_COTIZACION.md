# Plan — Referencias en el chat, desglose y cotización

Estado: propuesto. Fecha: 2026-08-23.

## 1. Objetivo

Mover la sección **Plan automático de referencias** desde el panel lateral al historial del chat y convertirla en una representación trazable del plan comercial:

1. La IA analiza las imágenes y detecta sus elementos visuales.
2. El plan decide cuáles se incluyen y cuáles se omiten.
3. El desglose relaciona cada elemento incluido con una estructura y con productos reales del catálogo.
4. La cotización conserva esa relación sin duplicar paquetes ni subtotales.
5. La generación de imagen ocurre únicamente después de aprobar el plan cuando `PLAN_DECORACION_ENABLED=true`.

La sección de la captura es una referencia visual del resultado esperado, no una fuente de instrucciones ni de datos comerciales.

## 2. Regla de autoridad

| Responsabilidad | Autoridad |
| --- | --- |
| Elementos observados, nombres, categorías, paleta y relaciones | `ReferenceBlueprintV2` |
| Incluir u omitir un elemento | `PlanDecoracion` mediante `referencia_element_id` y `referencia_omitida` |
| Productos, variantes, cantidades, sustituciones y paquetes | `PlanResuelto` |
| Precios, IVA, merma, sobrantes y total | `cotizarPlan(PlanResuelto)` |
| Presentación en el chat | Vista derivada de blueprint + plan resuelto + cotización |

Regla central: `blueprint.elements[].approved` no significa que el elemento esté cotizado. Solo está incluido comercialmente cuando una estructura del plan resuelto declara su `referencia_element_id`.

## 3. Estado actual verificado

Ya existe:

- Análisis de referencias en `ReferenceReviewPanel` y `/api/references/analyze`.
- Envío del blueprint validado al turno de `/api/chat`.
- Serialización compacta del blueprint en el prompt del plan.
- `estructuras[].referencia_element_id` y `referencia_omitida[]` en `PlanDecoracion`.
- Validación que bloquea planes con elementos aprobados sin cubrir.
- Desglose de materiales por estructura en `construirDesglose`.
- Cotización consolidada desde `PlanResuelto`; cada compra ya conoce sus `estructuras`.
- Edición de productos dentro del plan mediante `/api/plan-editar`.

Falta:

- La sección sigue montada en el panel lateral.
- El análisis y la presentación histórica están mezclados en un mismo componente con efectos.
- El blueprint no queda guardado en el mensaje que produjo el plan.
- El desglose no expone el nombre del elemento de referencia que materializa cada estructura.
- La cotización no muestra qué elementos de referencia cubre cada línea.
- La cotización generada se adjunta al último mensaje del asistente, no necesariamente al mensaje del plan aprobado.
- El editor genérico de cotización puede separar una cotización de su plan y perder la trazabilidad.
- El efecto de generación automática por referencias todavía existe aunque el modo plan use análisis perceptual.

## 4. Flujo objetivo

```text
Adjuntar referencias
        │
        ▼
Tarjeta en el chat: "Analizando referencias…"
        │
        ▼
Blueprint validado
        │
        ▼
Chat busca catálogo real y confirma PlanDecoracion
        │
        ▼
Validación de cobertura referencia → plan
        │
        ▼
PlanResuelto + desglose + cotización previa
        │
        ▼
Tarjeta del chat actualizada:
  incluido → estructura → productos → cantidades → subtotal consolidado
  omitido  → motivo explícito → no cotizado
        │
        ▼
Aprobación del cliente
        │
        ▼
Generación de imagen + cotización final en el mismo mensaje
```

## 5. Contrato derivado de cobertura

Agregar en `src/lib/plan/desglose.ts` una función pura, sin llamadas de red:

```ts
construirCoberturaReferencia(blueprint, planResuelto)
```

Salida propuesta:

```ts
type CoberturaReferencia = {
  elementos: Array<{
    elementId: string;
    nombre: string;
    categoria: string;
    estado: "pendiente" | "incluido" | "omitido";
    estructuraId?: string;
    estructuraNombre?: string;
    variantIds: string[];
    motivo?: string;
  }>;
};
```

Reglas:

- `incluido`: existe una estructura con el mismo `referencia_element_id`.
- `omitido`: aparece en `plan.referencia_omitida`.
- `pendiente`: todavía no hay plan o el plan no lo resolvió.
- Los productos salen exclusivamente de `PlanResuelto.estructuras[].lineas`.
- Una variante compartida puede aparecer relacionada con varios elementos, pero se compra y cotiza una sola vez.
- Un elemento omitido nunca crea una línea de precio cero.

Extender `construirDesglose` para incluir:

- `por_estructura[].referencia_element_id`.
- `por_estructura[].referencia_nombre` cuando haya blueprint.
- `referencias_omitidas` con nombre, categoría y motivo.

## 6. Fase A — Separar análisis y presentación

**Archivos principales:**

- `src/components/references/ReferenceReviewPanel.tsx`
- `src/app/page.tsx`

**Cambios:**

1. Mantener un único componente/controlador encargado de llamar a `/api/references/analyze` para los adjuntos activos.
2. Extraer una tarjeta de presentación pura que reciba blueprint, cobertura, estado y error.
3. La tarjeta histórica nunca ejecutará de nuevo el análisis.
4. Estados visibles:
   - Analizando referencias…
   - Elementos detectados; esperando plan.
   - Plan resuelto.
   - Error con acción para reintentar.
5. El estado asíncrono se anunciará con `role="status"` y `aria-live="polite"`.

No se creará un store nuevo. `Page` continuará siendo propietario del estado de la conversación.

## 7. Fase B — Insertar la tarjeta en el turno correcto

**Archivos principales:**

- `src/app/page.tsx`
- `src/app/api/chat/route.ts`
- `src/lib/ia/ejecutar.ts`

**Cambios:**

1. Extender el tipo local `Mensaje` con `referenceBlueprint?: ReferenceBlueprintV2`.
2. La respuesta `fin` de `/api/chat` devolverá el blueprint ya validado que usó ese turno.
3. `finalizarUltimoMensaje` guardará blueprint y plan en el mismo mensaje del asistente.
4. Renderizar la tarjeta de referencias dentro de `workspace-log`, antes de `TarjetaPlanDecoracion`.
5. Eliminar `ReferenceReviewPanel` del `<aside>` lateral.
6. Incrementar la versión de `CLAVE_CHAT` para no hidratar mensajes antiguos con el contrato incompleto.

Cuando haya referencias y el análisis siga pendiente, el envío del turno esperará el blueprint. El usuario podrá seguir escribiendo, pero `/api/chat` no recibirá un turno de plan sin su análisis estructurado.

## 8. Fase C — Mostrar cobertura y desglose

**Archivos principales:**

- `src/lib/plan/desglose.ts`
- `src/components/references/ReferenceReviewPanel.tsx`
- `src/components/TarjetaPlanDecoracion.tsx`

**Presentación por elemento:**

```text
Marble Arch Solid Panel                         Incluido
backdrop · Estructura: Fondo principal
Productos: Panel mármol, soporte de panel

White Sheer Back Curtains                       Omitido
curtain · Sin equivalente comercial disponible
```

La tarjeta del plan mostrará en cada estructura:

- Elemento de referencia que materializa.
- Productos y variantes reales.
- Unidades por tamaño y color.
- Sustituciones.
- Elementos omitidos y motivos.

El botón de aprobación permanecerá bloqueado si existe cualquier elemento `pendiente`.

## 9. Fase D — Trazabilidad en la cotización

**Archivos principales:**

- `src/lib/cotizacion/motor.ts`
- `src/components/TarjetaCotizacion.tsx`
- `src/app/page.tsx`

**Cambios:**

1. Añadir a `LineaCotizada`:

```ts
referenciaElementIds?: string[];
```

2. En `cotizarPlan`, resolver esos ids mediante:

```text
compra.estructuras
  → plan.plan.estructuras
  → referencia_element_id
```

3. `TarjetaCotizacion` mostrará los nombres de referencia usando el blueprint guardado en el mensaje; si no está disponible, usará el ID.
4. No se repartirá el subtotal por estructura o elemento. El precio seguirá siendo el costo real de paquetes consolidados.
5. Una línea compartida mostrará varias etiquetas de uso y un solo subtotal.

Ejemplo:

```text
Globo R-12 rojo                         $45.000
3 paquetes · 120 necesarios · 30 sobrantes
Usado en: Arco principal, arreglo izquierdo
Referencia: Left Organic Balloon Arrangement
```

## 10. Fase E — Mantener coherencia al aprobar y editar

**Archivos principales:**

- `src/app/page.tsx`
- `src/components/TarjetaCotizacion.tsx`
- `src/components/TarjetaPlanDecoracion.tsx`
- `src/app/api/plan-editar/route.ts`

**Cambios:**

1. `GenerarOverride` aceptará `anchorMessageId`.
2. Al aprobar un plan, la cotización final se adjuntará a ese mensaje exacto, no al último mensaje del asistente.
3. Si `cotizacion.plan_hash` existe, la edición comercial se realizará desde `TarjetaPlanDecoracion` y `/api/plan-editar`.
4. El editor genérico de `TarjetaCotizacion` quedará habilitado únicamente para cotizaciones legacy sin `plan_hash`.
5. Después de editar el plan:
   - recalcular `PlanResuelto`;
   - reconstruir cobertura y cotización;
   - conservar `referencia_element_id` de la estructura;
   - reiniciar aprobación e imagen pendiente.

## 11. Fase F — Convertir la imagen en el control de reemplazo

**Archivo principal:**

- `src/components/TarjetaPlanDecoracion.tsx`

La captura adjunta se usa únicamente como referencia del estado actual. El botón flotante “Cambiar” de la esquina debe desaparecer.

### Vista de detalle

1. La imagen completa será un `<button type="button">`, no un `div` con `onClick` ni una imagen con un botón superpuesto.
2. El botón tendrá `aria-label="Cambiar {nombre del producto}"` y conservará la imagen con su texto alternativo descriptivo.
3. El área interactiva ocupará el ancho y alto completos de la imagen.
4. Hover y foco visible comunicarán que la imagen es interactuable:
   - cursor de acción;
   - leve reducción de brillo o velo con color semántico;
   - borde o anillo de acento;
   - overlay con icono y texto “Cambiar elemento”;
   - transición solo de `opacity`, `transform`, `filter` o color, nunca `transition: all`.
5. El overlay también será visible con `focus-visible` para navegación por teclado.
6. En dispositivos sin hover se mantendrá una indicación visible dentro de la imagen para que la acción no dependa exclusivamente del puntero.
7. `prefers-reduced-motion` eliminará cualquier escala o movimiento no esencial.
8. Si no hay imagen, el placeholder completo seguirá siendo el mismo botón de cambio.

### Vista de reemplazo

El estado actual `intercambioAbierto` se reutilizará como selector de vista. No se creará otro modal.

```text
intercambioAbierto = false  → detalle del producto
intercambioAbierto = true   → opciones de reemplazo
```

Al activar la imagen:

1. `abrirIntercambio()` cambia el contenido completo del `Dialog.Content`.
2. Desaparecen temporalmente imagen, tamaño, color, cantidades y subtotal del producto actual.
3. El título cambia a “Cambiar {nombre del producto}”.
4. Aparece una acción “Volver al detalle” que regresa a la vista anterior sin cerrar el diálogo.
5. La vista de reemplazo contiene solamente:
   - estado “Buscando opciones compatibles…”;
   - recomendaciones por tamaño, forma y color;
   - búsqueda en todo el catálogo;
   - resultados reemplazables;
   - errores inline con el siguiente paso.
6. Los resultados no se renderizan debajo del detalle ni aumentan indefinidamente la altura del modal.
7. El diálogo conservará `max-height`, scroll interno y `overscroll-behavior: contain`.
8. Al entrar en la vista de reemplazo, el foco irá al encabezado o a “Volver al detalle”; no se usará `autoFocus` en móvil.
9. Al volver, el foco regresará al botón-imagen.
10. Al completar un reemplazo se recalcula el plan, se cierra el diálogo y el foco vuelve al elemento que lo abrió.
11. Si el reemplazo falla, el diálogo permanece en la vista de reemplazo y muestra cómo reintentar.

### Autocompletado del catálogo

La búsqueda en todo el catálogo será reactiva. No requerirá pulsar un botón “Buscar” para obtener sugerencias.

1. Reutilizar `consultaCatalogo`, `resultadosCatalogo`, `opcionesBusqueda` y el modo `buscar` de `/api/plan-editar`; no crear otro endpoint ni otro índice.
2. Al escribir 2 o más caracteres, esperar entre 250 y 300 ms desde la última pulsación y ejecutar la búsqueda automáticamente.
3. El texto escrito no se reemplaza ni se completa por la fuerza. El autocompletado consiste en mostrar opciones coincidentes mientras se escribe.
4. Cancelar el temporizador y la petición anterior cuando cambie la consulta, se vuelva al detalle o se cierre el diálogo. Usar `AbortController` o un identificador de petición para impedir que resultados antiguos sobrescriban la consulta actual.
5. El encabezado, “Volver al detalle” y el campo de búsqueda permanecen fijos. Solo cambia la zona de contenido:

```text
consulta con 0–1 caracteres → recomendaciones compatibles
consulta con 2+ caracteres  → carga / resultados / vacío / error de búsqueda
```

6. Al comenzar una búsqueda, las recomendaciones desaparecen y son sustituidas por “Buscando en todo el catálogo…”.
7. Cuando llegan los resultados, estos sustituyen el contenido anterior; nunca se agregan debajo de las recomendaciones.
8. Al borrar la consulta por debajo de 2 caracteres, limpiar `resultadosCatalogo` y restaurar las recomendaciones ya cargadas sin repetir su petición.
9. El botón actual “Buscar” se elimina por redundante. En caso de error se ofrece una acción explícita “Reintentar búsqueda”.
10. El campo tendrá etiqueta accesible, `name`, `autoComplete="off"`, `spellCheck={false}` y placeholder terminado en `…`.
11. Implementar el patrón de autocompletado accesible:
    - campo con `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` y `aria-controls`;
    - resultados aplanados desde `opcionesBusqueda` como opciones seleccionables;
    - Flecha abajo/arriba recorre opciones;
    - Enter elige la opción activa;
    - Escape limpia una consulta no vacía y vuelve a recomendaciones; con la consulta vacía conserva el cierre normal del diálogo;
    - el número de resultados y los estados de carga se anuncian con `aria-live="polite"`.
12. Limitar la cantidad visible a la respuesta ya acotada del servidor. No agregar virtualización, caché ni una nueva dependencia mientras el límite siga siendo pequeño.

No se extraerá un componente nuevo salvo que el mismo patrón vaya a reutilizarse en otra pantalla.

## 12. Fase G — Eliminar el disparador paralelo

**Archivos principales:**

- `src/app/page.tsx`
- `src/components/references/ReferenceReviewPanel.tsx`

Con `PLAN_DECORACION_ENABLED=true`:

- Eliminar el efecto que llama `generar({ automaticOnly: true })` al terminar el análisis.
- No usar `autoProductIds` como fuente comercial.
- El único disparador será aprobar `PlanResuelto`.
- El blueprint seguirá viajando a `/api/generate` como contexto visual.

Con `PLAN_DECORACION_ENABLED=false`, el flujo legacy conservará su comportamiento actual.

No se añadirá otro feature flag. El flag de plan existente cubre la separación entre ambos flujos.

## 13. Pruebas

Ampliar los scripts actuales con `node:assert`, sin agregar otro framework.

### Pruebas de dominio

- Blueprint sin plan produce elementos `pendiente`.
- Estructura con `referencia_element_id` produce elemento `incluido`.
- `referencia_omitida` produce elemento `omitido` con motivo.
- Elemento aprobado sin cubrir bloquea el plan.
- Una estructura con varios materiales conserva todos sus `variantIds`.
- Una variante compartida por varias estructuras no duplica subtotal ni paquetes.
- `cotizarPlan` propaga los `referenciaElementIds` correctos.
- La suma de líneas continúa siendo igual a `plan.totales.total_cop`.

### Pruebas de integración

- El evento SSE `fin` devuelve el blueprint del mismo turno.
- El blueprint y el plan quedan guardados en el mismo mensaje.
- La cotización se adjunta mediante `anchorMessageId`.
- Editar el plan conserva la relación con la referencia y cambia `plan_hash`.
- No se genera automáticamente antes de aprobar cuando el modo plan está activo.

### Revisión manual

1. Referencia con todos los elementos disponibles.
2. Referencia con un elemento sin equivalente comercial.
3. Referencia con una variante usada en dos estructuras.
4. Edición de un producto antes de aprobar.
5. Recarga de página después de recibir el plan.
6. Conversación sin referencias.
7. Flujo legacy con el plan desactivado.
8. Vista móvil: tarjeta dentro del chat sin desbordamiento horizontal.
9. Navegación por teclado y lectura de estados asíncronos.
10. Toda la imagen abre el reemplazo; no queda un botón flotante en la esquina.
11. Hover y `focus-visible` hacen evidente la interacción sin depender solo del color.
12. En un dispositivo táctil existe una indicación visible para cambiar el elemento.
13. Al abrir “Cambiar”, el detalle se sustituye completamente por los resultados.
14. “Volver al detalle” restaura contenido y foco sin cerrar el diálogo.
15. Carga, resultados vacíos y error permanecen dentro de la vista de reemplazo.
16. `prefers-reduced-motion` desactiva movimiento no esencial.
17. Escribir 2 caracteres dispara una sola búsqueda después del debounce, sin pulsar un botón.
18. Al seguir escribiendo, una respuesta atrasada nunca reemplaza los resultados de la consulta más reciente.
19. Los resultados de búsqueda sustituyen las recomendaciones en la misma zona del modal.
20. Borrar la consulta restaura las recomendaciones sin volver a solicitarlas.
21. Flechas, Enter y Escape permiten usar el autocompletado sin ratón.

Comandos de verificación:

```bash
npm run plan:test-referencia-cobertura
npm run plan:test-desglose
npm run plan:test-contratos
npm run plan:test
npm run lint
npm run build
```

## 14. Criterios de aceptación

- La sección de referencias ya no aparece en el panel lateral.
- Aparece una sola vez en el turno correcto del chat y persiste al recargar.
- Cada elemento detectado termina incluido u omitido con motivo; nunca desaparece silenciosamente.
- Cada elemento incluido muestra su estructura, productos y cantidades reales.
- Cada línea de cotización muestra qué elementos de referencia cubre.
- Productos compartidos no duplican paquetes ni precios.
- Elementos omitidos no crean líneas comerciales falsas.
- La cotización final queda anclada al mensaje del plan aprobado.
- Editar un plan conserva trazabilidad y reinicia su aprobación.
- En modo plan no existe generación previa a la aprobación.
- El flujo sin referencias y el flujo legacy no cambian.
- La imagen completa del producto funciona como botón accesible para cambiarlo.
- Hover, foco y dispositivos táctiles comunican que la imagen es interactuable.
- El botón flotante “Cambiar” ya no existe.
- La vista de reemplazo sustituye el detalle dentro del mismo modal; nunca se agrega debajo.
- Es posible volver al detalle sin cerrar el modal y sin perder el foco.
- Carga, vacío y error tienen estados explícitos dentro de la vista de reemplazo.
- La búsqueda consulta automáticamente al escribir 2 o más caracteres.
- Las consultas anteriores se cancelan o ignoran y nunca pisan resultados nuevos.
- Recomendaciones y resultados de búsqueda ocupan la misma región y se sustituyen entre sí.
- Borrar la consulta restaura las recomendaciones cargadas.
- El autocompletado funciona con teclado y anuncia sus cambios a tecnologías de asistencia.

## 15. Coordinación con subagentes

Durante la implementación, si las herramientas disponibles permiten delegar y existe trabajo realmente independiente, se usarán subagentes con:

- Modelo: `gpt-5.6-luna`.
- Razonamiento: `xhigh`.

Delegación sugerida:

- Un subagente revisa interacción, accesibilidad y estados del modal.
- Otro subagente revisa pruebas de cobertura, desglose y cotización.
- El agente principal conserva la integración en `page.tsx` y resuelve cualquier solapamiento.

No se crearán subagentes para tareas pequeñas, secuenciales o que deban editar simultáneamente las mismas líneas. Su uso es condicional a que reduzca tiempo sin aumentar conflictos.

## 16. Orden de implementación

1. Contrato de cobertura y pruebas de dominio.
2. Separación analizador/tarjeta.
3. Persistencia del blueprint por mensaje y movimiento al chat.
4. Cobertura visible en `TarjetaPlanDecoracion`.
5. Trazabilidad en `cotizarPlan` y `TarjetaCotizacion`.
6. Anclaje por `messageId` y coherencia de edición.
7. Imagen interactiva, alternancia detalle/reemplazo y autocompletado dentro del modal.
8. Eliminación del disparador paralelo.
9. Pruebas completas y revisión manual.

Cada fase debe dejar las pruebas anteriores pasando antes de continuar.
