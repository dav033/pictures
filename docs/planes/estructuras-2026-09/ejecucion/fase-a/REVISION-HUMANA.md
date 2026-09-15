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
- **`scripts/migrations/025_precios_gemini_flash.sql` — pendiente de aplicar por una persona.** Precios estándar de `gemini-3.6-flash` para 2026 y desde 2027-01-01, verificados en la página oficial el 2026-09-15. Se probó en PGlite. No se aplicó a Neon.
- **Precio de `gemini-3.1-flash-image` (A0.1 tarea 4).** La página publica US$0,067 por imagen 1K y US$0,101 por imagen 2K, y producción usa ambas (`src/lib/ia/gemini/imagen.ts`: `calidad` alta = 2K). La clave única de `ai_model_pricing` `(proveedor, modelo, vigente_desde, tipo_unidad)` solo admite un precio `generacion` por modelo y fecha. El precio por tokens exige `precio_cacheado`, que la página no publica para ese modelo. Decidir cómo modelarlo, por ejemplo con la resolución en la clave.
- **`coste_estimado` en `ai_call_log` (criterio de aceptación de A0.1).** Hay precios cargados, pero ningún código asigna todavía `pricing_id`/`coste_estimado` al persistir. El criterio "≥99 % de filas nuevas con `coste_estimado` a los 7 días" no se cumple con esta rama. Decidir dónde se resuelve el precio vigente (caché en el servidor o `INSERT … SELECT`) sin duplicar `calcularCosteEstimado`.

- **Orden obligatorio:** `.github/workflows/deploy.yml` no aplica migraciones. La migración `024` tiene que aplicarse en Neon **antes** de desplegar esta rama. Si no, cada `INSERT` en `ai_call_log` (`finish_reason`/`config_hash`) y en `plan_audit_log` (hechos de la petición) falla, y la telemetría y la auditoría de planes se pierden sin error visible, porque ambas absorben los fallos.

## Decisiones que bloquean A1

- **Fuente de imágenes para `dev-seed-v0` (bloquea T5, T8 y T9).** Wikimedia Commons no sirve para esto: de 674 candidatas con 350 licencias aptas, las 150 descargadas fueron descartadas en revisión humana (globos sueltos, personas, letreros, documentos antiguos). La búsqueda por palabras clave no filtra por contenido. Opciones de la guía `04`: (1) permisos escritos de decoradores como fuente base, que requiere Q-30 (revisión legal de la plantilla) y Q-29 (contraprestación); (2) sesiones o licencias pagadas para las clases raras; (3) si se mantiene Commons, filtrar antes de descargar, por ejemplo con categorías específicas de decoración con globos, y medir el rendimiento con 20 imágenes antes de otra tanda. Conviene pausar o reorientar el loop recolector para no gastar descargas ni pre-clasificación en ruido; esa decisión corresponde a quien lo opera.

- **Orientación EXIF en `/api/references/analyze` (T1).** La UI endereza la foto antes de enviarla, pero el servidor reenvía sin normalizar lo que mande otro cliente. Decidir si se normaliza en `analisis-http.ts` con `sharp().rotate()`. Implica un cambio de comportamiento, el build Docker `standalone` y una prueba de humo de la ruta dentro de la imagen (Plan A §A0.2, L17). Al hacerlo, retirar el caso de caracterización "hoy el servidor no normaliza" de `scripts/test-reference-analyze-route.ts`.
- **Laboratorio de referencias (Plan A §A0.2 tarea 5, F18; §11 pregunta 10).** ¿Se sigue usando `src/app/laboratorio-referencias`? Si sí, hay que corregir `idsDelJson`. Si no, se retira la página. El loop no la toca sin esa confirmación.
- **`plan_audit_log.motor_imagen_previsto` (A0.1).** El motor de imagen previsto (FLUX+LoRA o Gemini con foto) lo decide hoy `src/lib/estado/modo-vista-reglas.ts`, del lado del cliente. Para llenar la columna sin duplicar esa regla hay que decidir un dueño único accesible desde el servidor (compartido o enviado y validado en la petición). Mientras tanto la columna queda NULL.
- **Marca de tráfico E2E/local (A0.1, entrada de G3–G5).** `scripts/consultas/volumen-turnos-con-foto.sql` no puede excluir el tráfico de smoke/E2E ni el de servidores locales: hoy nada lo distingue en `ai_call_log` ni en `plan_audit_log`, y los locales escriben en Neon. Decidir una marca, por ejemplo una cabecera validada que termine en `superficie` o en una columna, y quién la emite. Hasta entonces las cifras son una cota superior.
- **Pensamiento y modelo de producción para la línea base A0.4a (T8).** El runner toma `GEMINI_CHAT_MODEL` y `GEMINI_CHAT_THINKING_LEVEL` del entorno donde corre. En `.env.local` da `gemini-3.6-flash` con `low`. A0.4a exige los valores de producción: una persona debe confirmarlos en el servidor, sin exponer secretos, antes de ejecutar T8. Si difieren, se corre con los valores de producción y se registran en `run.json`.
- DP-13: presupuesto de A0.4a y A1.2 (esta corrida usa un tope local de US$15 para A0.4a).
- Confirmar con operación el modelo de producción y `GEMINI_CHAT_THINKING_LEVEL` (Plan A §12 día 1), sin exponer secretos.
