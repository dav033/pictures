# ADR-0029 — Reconocedor v16 en producción, sin pasada de auditoría

Date: 2026-09-25
Status: accepted
Supersedes: la decisión de producción v13 con dos pasadas (inventario + auditoría) de `analizar-referencias-v2.ts`.

## Problema

El análisis de la foto de referencia (Amaterasu) corría el prompt **v13** en dos
llamadas a Gemini: un inventario y una auditoría que revisaba ese borrador. Dos
defectos medidos:

1. **v13 casi no reconoce bouquets.** En la evaluación del 2026-09-15 (carpeta
   elegida por una persona), solo 7 de 39 fotos de bouquet salían como bouquet; la
   mayoría salía como centro de mesa. Un bouquet mal leído no llega al chat como
   bouquet, y la función de bouquets por partes (ADR siguiente) no se activaría.
2. **La auditoría empeora el tipo de estructura.** Recalculado sin costo sobre las
   respuestas crudas guardadas de la corrida `ajuste-v16-principal-20260915`
   (61 fotos × 2 = 122 análisis), con la misma fusión de producción, con y sin la
   segunda pasada:

   | | Tipo principal correcto |
   |---|---|
   | v16 con auditoría | 109/122 (89,3 %, igual a la cifra publicada de la corrida) |
   | v16 sin auditoría | 113/122 (92,6 %) |

   La auditoría cambió el tipo principal en 10 análisis: 3 veces para bien y 7 para
   mal. Cuatro de esas siete pasaban un centro de mesa a bouquet, justo los errores
   de v16 que la revisión humana confirmó (los 5 casos de
   `revision-v16-centros-mesa`: las cinco piezas son centros de mesa).

## Decisión

1. **`VARIANTE_PRODUCCION = "v16"`** (`src/lib/ia/referencia/reference-structure.ts`).
   El texto de las reglas v16 no cambia ni un byte respecto del evaluado; se renombra
   la variante `v16-candidato` → `v16` y su constante `STRUCTURE_RULES_V16`.
   `v13`, `v14-candidato` y `v15-candidato` siguen seleccionables para evaluación.
2. **Se retira la pasada de auditoría** del análisis de la foto de referencia: una
   sola llamada (inventario). Se borran `AUDIT_SYSTEM*`, `AUDIT_TOOL`, la fusión
   `mergeCandidates` y su umbral `VERIFIER_MIN_CONFIDENCE` (sin otros usos).
   `metadata.passes` pasa a `["inventory"]`.
3. El hash del prompt ya no incluye el texto de la auditoría, porque ya no se envía.
   Hashes nuevos (fijados en `test-telemetria-analisis-referencias.ts`):
   producción v16 `e119092d…`, v13 `c2393842…`. El **texto del inventario** es
   idéntico byte a byte al que midieron las corridas del 15-09 y el 25-09.
4. La galería (`analisis-ejemplos.json`) registra la variante con la que se generó y
   solo se sirve si coincide con la de producción. Se regeneró con v16 sin
   auditoría. `scripts/ops/generar-analisis-ejemplos.ts` ahora llama al análisis
   directamente (no necesita la app levantada ni iniciar sesión) y escribe en la
   ruta vigente del archivo.

El análisis de la foto del **espacio** (`analizar-venue.ts`) conserva su propia
auditoría: no se midió y queda fuera de esta decisión.

## Evidencia

- Revisión humana de los 5 centros de mesa que v16 pasaba a bouquet: ninguno es
  bouquet. Cuatro de esas lecturas venían de la auditoría.
- Corrida de control `control-v16-20260925` (34 fotos de arco y columna, código
  actual, tope US$1,50, costo reportado **US$0,28**, telemetría apagada): 33/34, igual
  que la del 15-09 (mismo hash de prompt y de configuración; sin deriva por el SDK
  nuevo). La foto que falla es la misma en las dos (un arco leído como semiarco).
- Ablación de la auditoría: sin costo, sobre las salidas crudas privadas
  (`estructuras-eval-privado/`), con `parseCandidates`/`mergeCandidates` de
  producción. Límites: una sola métrica (tipo de la pieza más grande), etiquetas de
  carpeta que no son verdad revisada salvo los 5 casos, 122 análisis.

## Alternativas descartadas

- **Mantener la auditoría pero sin permitirle cambiar el tipo** de una pieza ya vista
  (solo agregar): mismo 113/122 en la medición y conserva piezas extra (la auditoría
  agregaba elementos aprobados en 16 de 122 análisis). Se descartó por decisión del
  usuario a favor de una sola llamada: más rápido y más barato.
- **Promover v16 con la auditoría tal cual** (109/122): los centros de mesa que la
  auditoría pasaba a bouquet seguirían ocurriendo.

## Consecuencias

- Una llamada de visión menos por foto: menos latencia (la auditoría costaba p50
  ≈1,3 s y p95 ≈7 s en el control) y menos tokens.
- Se pierden las piezas que solo la auditoría encontraba (luces, cortinas, piezas
  pequeñas). No se midió si eran correctas.
- La caché del análisis se invalida sola (su clave incluye el hash del prompt).
- Cambian los hashes registrados en telemetría: la línea base de evaluación nueva es
  v16 sin auditoría.

## Pendiente acotado

- El estimador de costo de las corridas de evaluación (`src/lib/eval/estructuras/costo.ts`
  y el supuesto `tokens-analisis-2026-09-15.json`) sigue sumando la auditoría:
  **sobreestima** el costo (conservador, no bloquea). `medir-tokens.ts` exige filas de
  auditoría y fallará al medir un supuesto nuevo. Condición de retiro: cuando haya
  suficientes llamadas sin auditoría en `ai_call_log`, medir el supuesto nuevo y
  quitar la auditoría del modelo de costo.

## Rollback

`VARIANTE_PRODUCCION = "v13"` y revertir el commit de la auditoría (vuelve la segunda
pasada). Regenerar la galería con `scripts/ops/generar-analisis-ejemplos.ts`.
Sin migraciones ni cambios de contrato: `metadata.passes` es un campo de la
respuesta HTTP que ningún consumidor lee.
