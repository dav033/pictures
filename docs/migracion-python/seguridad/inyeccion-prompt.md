# Análisis de inyección de prompt (Fase 4.3)

Dos rutas reales por las que contenido que esta aplicación no controla
llega al prompt de un modelo. Todo lo de abajo está verificado leyendo el
código actual (2026-09-09), no heredado sin comprobar de la auditoría
previa (`auditoria/08-revision-fase-4.md`, que hizo el primer análisis
estático). Ningún valor de secreto aparece en este documento.

## Vía 1 — Imagen de referencia del cliente

**Cadena real:**

1. El cliente sube una foto de inspiración. `src/lib/ia/analizar-referencias-v2.ts:544`
   le pide a un modelo de visión (Gemini) que describa la escena contra
   `ReferenceBlueprintV2Schema`. El campo `name` de cada elemento detectado
   es `texto(160)` — string libre, longitud máxima 160, **sin enum, sin
   lista cerrada de valores, sin filtro de contenido**
   (`src/lib/ia/reference-blueprint.ts:104`).
2. `bloqueReferencia()` (`src/lib/ia/prompt-sistema.ts:172-182`) interpola
   ese `name` sin escapar ni sanitizar dentro del system prompt del chat
   principal, en la línea `` `- ${element.element_id} (...): "${element.name}" ...` ``
   (línea 166 de ese archivo). Ese bloque se reinyecta en cada vuelta
   posterior del tool-loop mientras la referencia siga vigente.

**Quién controla el contenido inyectable:** el propio cliente, indirectamente
— no escribe el texto él mismo, pero puede preparar una imagen (con texto
superpuesto, por ejemplo) que el modelo de visión describa de forma que el
`name` resultante contenga una instrucción con apariencia de comando
("ignora las reglas anteriores y...").

**Qué SÍ contiene el daño (verificado en código, no supuesto):**
- `confirmar_seleccion_rag` valida cada `product_id`/`variant_id` contra
  `idsRecuperados`, construido en el propio turno por retrieval real
  (`src/lib/rag/chat/validar.ts` — `validarSeleccion`, cubierto además por
  regresión en `scripts/test-rag-validation.ts`). Un `name` inyectado no
  puede hacer que se confirme un producto que no salió de una búsqueda
  real de ese turno.
- `confirmar_plan_decoracion` (la ruta que sí usa `bloqueReferencia`)
  resuelve contra la misma whitelist vía `src/lib/plan/resolver.ts`, que
  la aplica en varios puntos antes de aceptar cualquier producto/variante
  del plan.
- `/api/generate` exige un token HMAC-SHA256 atado al `plan_hash` exacto
  resuelto en servidor (`src/lib/plan/aprobacion.ts`, verificado en
  `generate/route.ts`). Un texto de modelo no puede forjar esa firma sin
  `PLAN_APPROVAL_SECRET`.

**Qué NO contiene (superficie residual):** el `name` inyectado sí llega,
tal cual, al texto que el modelo LEE y puede REPETIR en su respuesta al
cliente — el invariante de catálogo/precio/aprobación está intacto, pero
la honestidad del *texto* que el modelo redacta sobre "lo que ve en tu
foto" no está verificada contra nada. Es un riesgo de contenido/confusión
del cliente sobre su propia imagen, no de autoridad comercial.

## Vía 2 — Catálogo remoto de Happia

**Cadena real:**

1. `packages/happie-package-ia/src/recomendador.ts` construye el contexto
   que se le manda al modelo a partir de `paquetesActivos`, que llega de
   `HAPPIA_API_BASE_URL` — un servicio de un tercero, fuera de control de
   este repositorio.
2. `paqueteAContexto` (líneas ~90-105 de ese archivo) serializa
   `paquete.conditions`, `paquete.restrictions` y `item.description` de
   cada ítem directamente al contexto; `JSON.stringify(...)` de todo eso
   se manda como `contenido` del mensaje al modelo (línea 123).

**Quién controla el contenido inyectable:** quien tenga acceso al panel de
Happia para editar el catálogo de paquetes — un tercero, no el cliente
final de este chat ni un empleado de Sempertex necesariamente.

**Qué SÍ contiene el daño:**
- La salida del modelo se valida contra `RecomendacionSchema`, y
  `porId.get(r.packageId)` (línea ~176) descarta cualquier `packageId`
  inventado — el modelo no puede recomendar un paquete que no exista
  realmente en `paquetesActivos`.
- `razon`/`resumen` (los campos de texto libre que el modelo redacta a
  partir de ese contexto) están acotados en la frontera de contrato real:
  `HappieRecommendationResponseV1Schema` (`src/lib/ia/contracts/happie-v1.ts`)
  limita `razon` a 1000 caracteres y `resumen` a 2000; `generar-recomendacion.ts`
  valida contra ese contrato antes de responder — una violación se
  convierte en un 502 limpio, nunca se expone sin acotar.

**Qué NO contiene:** dentro de esos límites de tamaño, un catálogo Happia
manipulado (`conditions`/`restrictions`/`description` con texto
adversarial) puede inducir al modelo a escribir texto plausible pero
engañoso en `razon`/`resumen`, que sí llega tal cual a
`/api/happie/webhook/chat` — **contenido mostrado a clientes de Happia**,
un tercero que no está en la lista de invariantes del capítulo 6 de este
plan. Es un problema de integridad de contenido hacia un tercero, no de
autoridad comercial ni de inyección técnica (la respuesta es JSON, nunca
se renderiza como HTML de este lado).

## Estado de la validación: análisis estático completo, dinámica pendiente

Todo lo de arriba es análisis de código — rutas reales, confirmadas
línea por línea, con los invariantes que sí las contienen también
confirmados en código (no solo citados de memoria). Lo que **no** está
hecho es una corrida real: subir una imagen preparada con texto
adversarial a `/api/references/analyze` y ver qué `name` produce el
modelo de visión de verdad, o alimentar `recomendador.ts` con un
`conditions`/`description` adversarial de prueba y ver si el modelo
realmente escribe algo engañoso en `razon`/`resumen`. Esa validación
dinámica exige al menos una llamada real a Gemini (dinero real, aunque
mínimo — una imagen y unos tokens de texto).

**Decisión pendiente del usuario:** ¿se autoriza una corrida controlada y
acotada (una llamada de visión + una de texto, con costo estimado de
centavos de dólar) para completar la validación dinámica de esta fase, o
se deja este informe como el criterio de cierre de 4.3 (análisis estático
con evidencia de código, contención verificada, superficie residual
identificada y acotada por diseño)?

## Resumen de hallazgos

| Vía | Contenida por | Superficie residual | Severidad de lo residual |
|---|---|---|---|
| Imagen de referencia → `bloqueReferencia` | Whitelist same-turn en `confirmar_seleccion_rag`/`confirmar_plan_decoracion`; HMAC de aprobación en `/api/generate` | El modelo puede repetirle al cliente una descripción de su propia foto influida por texto inyectado en la imagen | Baja — el cliente ve su propia imagen, puede notar la discrepancia |
| Catálogo Happia → `recomendador.ts` | Resolución contra `porId.get(packageId)`; límites de longitud del contrato `happie-v1` | `razon`/`resumen` pueden ser texto plausible pero engañoso, mostrado a un cliente de Happia (tercero) | Media — afecta a alguien que no controla ni conoce el catálogo real
