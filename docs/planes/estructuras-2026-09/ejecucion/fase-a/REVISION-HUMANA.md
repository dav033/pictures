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

- **`scripts/migrations/024_telemetria_plan_a.sql` — pendiente de aplicar por una persona.** Agrega `ai_call_log.finish_reason` y `config_hash`, y siete columnas de `plan_audit_log`. Todas son nulables y tienen restricciones. Se verificó en PGlite desechable (aplica, es idempotente, rollback y re-aplicación). No se aplicó a Neon. Rollback en la cabecera del archivo.
- **Filas de `ai_model_pricing` (Plan A §A0.1 tarea 4).** Faltan `gemini-3.6-flash` y `gemini-3.1-flash-image` con `fuente` y vigencias 2026/2027. El loop no inventa precios: hace falta la tabla de precios estándar (no batch) verificada en la página oficial, con fecha.

- **Orden obligatorio:** `.github/workflows/deploy.yml` no aplica migraciones. La migración `024` tiene que aplicarse en Neon **antes** de desplegar esta rama. Si no, cada `INSERT` en `ai_call_log` (`finish_reason`/`config_hash`) y en `plan_audit_log` (hechos de la petición) falla, y la telemetría y la auditoría de planes se pierden sin error visible, porque ambas absorben los fallos.

## Decisiones que bloquean A1

- **Orientación EXIF en `/api/references/analyze` (T1).** La UI endereza la foto antes de enviarla, pero el servidor reenvía sin normalizar lo que mande otro cliente. Decidir si se normaliza en `analisis-http.ts` con `sharp().rotate()`. Implica un cambio de comportamiento, el build Docker `standalone` y una prueba de humo de la ruta dentro de la imagen (Plan A §A0.2, L17). Al hacerlo, retirar el caso de caracterización "hoy el servidor no normaliza" de `scripts/test-reference-analyze-route.ts`.
- **Laboratorio de referencias (Plan A §A0.2 tarea 5, F18; §11 pregunta 10).** ¿Se sigue usando `src/app/laboratorio-referencias`? Si sí, hay que corregir `idsDelJson`. Si no, se retira la página. El loop no la toca sin esa confirmación.
- **`plan_audit_log.motor_imagen_previsto` (A0.1).** El motor de imagen previsto (FLUX+LoRA o Gemini con foto) lo decide hoy `src/lib/estado/modo-vista-reglas.ts`, del lado del cliente. Para llenar la columna sin duplicar esa regla hay que decidir un dueño único accesible desde el servidor (compartido o enviado y validado en la petición). Mientras tanto la columna queda NULL.
- DP-13: presupuesto de A0.4a y A1.2 (esta corrida usa un tope local de US$15 para A0.4a).
- Confirmar con operación el modelo de producción y `GEMINI_CHAT_THINKING_LEVEL` (Plan A §12 día 1), sin exponer secretos.
