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

## 11. Fase F — Eliminar el disparador paralelo

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

## 12. Pruebas

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

Comandos de verificación:

```bash
npm run plan:test-referencia-cobertura
npm run plan:test-desglose
npm run plan:test-contratos
npm run plan:test
npm run lint
npm run build
```

## 13. Criterios de aceptación

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

## 14. Orden de implementación

1. Contrato de cobertura y pruebas de dominio.
2. Separación analizador/tarjeta.
3. Persistencia del blueprint por mensaje y movimiento al chat.
4. Cobertura visible en `TarjetaPlanDecoracion`.
5. Trazabilidad en `cotizarPlan` y `TarjetaCotizacion`.
6. Anclaje por `messageId` y coherencia de edición.
7. Eliminación del disparador paralelo.
8. Pruebas completas y revisión manual.

Cada fase debe dejar las pruebas anteriores pasando antes de continuar.
