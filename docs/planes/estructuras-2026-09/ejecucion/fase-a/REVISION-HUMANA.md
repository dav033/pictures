# Revisión humana · fase A0

Lo que el loop no puede decidir ni hacer. Actualizado: 2026-09-15.

## Muestra ciega (10 %)

_Vacío. Se llena en T4 con las imágenes `sha256 mod 10 == 0`, sin predicción visible._

## Cuarentena BY-SA

_Vacío. Se llena en T3 (`15_quarantine/by-sa-revision-legal/`)._

## Flags de riesgo

_Vacío._

## Brechas por clase frente a metas

_Vacío. Se llena en T4._

## Leads para pedir permiso

_Vacío. Solo nombre comercial y URL pública; nadie del loop contacta a nadie._

## Migraciones sin aplicar

_Vacío. La migración `024` de A0.1 (T6) se anotará aquí: se prueba en base desechable y la aplica una persona._

## Decisiones que bloquean A1

- **Orientación EXIF en `/api/references/analyze` (T1).** La UI endereza la foto antes de enviarla, pero el servidor reenvía sin normalizar lo que mande otro cliente. Decidir si se normaliza en `analisis-http.ts` con `sharp().rotate()`. Implica un cambio de comportamiento, el build Docker `standalone` y una prueba de humo de la ruta dentro de la imagen (Plan A §A0.2, L17). Al hacerlo, retirar el caso de caracterización "hoy el servidor no normaliza" de `scripts/test-reference-analyze-route.ts`.
- **Laboratorio de referencias (Plan A §A0.2 tarea 5, F18; §11 pregunta 10).** ¿Se sigue usando `src/app/laboratorio-referencias`? Si sí, hay que corregir `idsDelJson`. Si no, se retira la página. El loop no la toca sin esa confirmación.
- DP-13: presupuesto de A0.4a y A1.2 (esta corrida usa un tope local de US$15 para A0.4a).
- Confirmar con operación el modelo de producción y `GEMINI_CHAT_THINKING_LEVEL` (Plan A §12 día 1), sin exponer secretos.
