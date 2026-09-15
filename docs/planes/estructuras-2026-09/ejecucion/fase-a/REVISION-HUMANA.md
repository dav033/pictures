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

- **LoRA con foto por `/edit` (decisión del usuario, 2026-09-15; cambia producción al desplegar esta rama).** Con foto del espacio, referencia del cliente o ajuste de imagen previa, el LoRA va ahora por `fal-ai/flux-2/lora/edit` en lugar de caer a Gemini (modo usuario) o rechazarse (modo dev). Sin esas imágenes, texto a imagen no cambia. Riesgos: (1) fal no tiene saldo, así que esas generaciones fallan con el mensaje de saldo hasta recargar; antes funcionaban con Gemini. (2) `/edit` + LoRA nunca se validó: el panel de 6 seeds es solo de texto. Retiro sin tocar código: `SEMPERTEX_LORA_EDIT=false` en el servidor. Antes de desplegar, decidir si se acepta que con foto la imagen falle mientras no haya saldo.

- **Frontera bouquet / centro de mesa (bloquea cualquier ajuste del reconocedor en esas clases).** La candidata `v14-candidato` (commit `d292fcb`, sin promover) llevó bouquet de 15 % a 100 %, pero bajó centro de mesa de 97 % a 25 %, columna orgánica de 89 % a 74 % y arco orgánico de 57 % a 36 %. En total: 75 % frente a 80 % en las mismas 105 fotos (16 mejoran, 23 empeoran). Causa: las carpetas `bouquet` y `centro_mesa` contienen piezas visualmente iguales (base compacta con globo burbuja o foil, a veces sobre una mesa; globos de helio con peso sobre mesa de invitados guardados como centro de mesa). Hace falta una regla del negocio que no dependa de adivinar la intención: tamaño, ubicación (mesa de invitados frente a piso o mesa principal), si se repite por mesa, o fusionar ambas clases. Decidir también si las piezas en L de `arco_organico` son semiarcos orgánicos (según la definición actual, sí).

- **Decisión del usuario (2026-09-15): se retiran las variantes densa/no densa.** `pared_densa` y `pared_no_densa` pasan a ser `pared`; `arco_no_denso` y `columna_no_densa` desaparecen (las piezas con huecos se clasifican como su familia). La taxonomía baja de 16 a 13 clases. Ya aplicado en la carpeta manual, en el script de captura y en `src/lib/eval/estructuras` (`familia-clase.ts`, `suite-manual.ts`). **Falta propagarlo:** Fundamentos §4 (tabla §4.7, fichas §4.5, pares confundibles §4.6, metas §7.7), guía `04` §3.2 y §6.1, Plan B/C y la herramienta del recolector (`derivar.py`, 16 clases), que siguen con 16. Hay que confirmar si la densidad se conserva como atributo informativo (útil para la cotización: `densidad` cambia el número de globos) aunque ya no defina la clase.

- **Excepción `dt7-excepcion-interna-20260915` (aprobada por el usuario el 2026-09-15 en la sesión).** Autoriza enviar a Gemini (API de pago) 68 fotos de Pinterest y Google, sin permiso de sus autores, capturadas a mano en `C:\Users\davidt\Downloads\estructuras-manual`. Alcance: solo evaluación interna orientativa. Esas fotos y sus resultados nunca van a `gold`, entrenamiento, demos ni informes externos, y se reemplazan por fotos con permiso antes de cualquier compuerta. Tope aprobado: el del protocolo (US$15), con gasto esperado ≈US$3,5. Línea base con `thinking_level=low` (`.env.local`), porque el valor de producción sigue sin confirmar.
  - **Ampliación (usuario, 2026-09-15):** se permite incluir unas 10–12 miniaturas con cajas dibujadas en un artifact privado de claude.ai, para el resumen ejecutivo de la validación completa. El enlace no se comparte, y el artifact se borra o se rehace sin fotos cuando se reemplacen por fotos con permiso.
  - **Retiro de `semiarco` regular (usuario, 2026-09-15):** en la práctica todo semiarco es orgánico; quedan 12 clases.

- **Fuente de imágenes para `dev-seed-v0` (bloquea T5, T8 y T9).** Wikimedia Commons no sirve para esto: de 674 candidatas con 350 licencias aptas, las 150 descargadas fueron descartadas en revisión humana (globos sueltos, personas, letreros, documentos antiguos). La búsqueda por palabras clave no filtra por contenido. Opciones de la guía `04`: (1) permisos escritos de decoradores como fuente base, que requiere Q-30 (revisión legal de la plantilla) y Q-29 (contraprestación); (2) sesiones o licencias pagadas para las clases raras; (3) si se mantiene Commons, filtrar antes de descargar, por ejemplo con categorías específicas de decoración con globos, y medir el rendimiento con 20 imágenes antes de otra tanda. Conviene pausar o reorientar el loop recolector para no gastar descargas ni pre-clasificación en ruido; esa decisión corresponde a quien lo opera.

- **Orientación EXIF en `/api/references/analyze` (T1).** La UI endereza la foto antes de enviarla, pero el servidor reenvía sin normalizar lo que mande otro cliente. Decidir si se normaliza en `analisis-http.ts` con `sharp().rotate()`. Implica un cambio de comportamiento, el build Docker `standalone` y una prueba de humo de la ruta dentro de la imagen (Plan A §A0.2, L17). Al hacerlo, retirar el caso de caracterización "hoy el servidor no normaliza" de `scripts/test-reference-analyze-route.ts`.
- **Laboratorio de referencias (Plan A §A0.2 tarea 5, F18; §11 pregunta 10).** ¿Se sigue usando `src/app/laboratorio-referencias`? Si sí, hay que corregir `idsDelJson`. Si no, se retira la página. El loop no la toca sin esa confirmación.
- **`plan_audit_log.motor_imagen_previsto` (A0.1).** El motor de imagen previsto (FLUX+LoRA o Gemini con foto) lo decide hoy `src/lib/estado/modo-vista-reglas.ts`, del lado del cliente. Para llenar la columna sin duplicar esa regla hay que decidir un dueño único accesible desde el servidor (compartido o enviado y validado en la petición). Mientras tanto la columna queda NULL.
- **Marca de tráfico E2E/local (A0.1, entrada de G3–G5).** `scripts/consultas/volumen-turnos-con-foto.sql` no puede excluir el tráfico de smoke/E2E ni el de servidores locales: hoy nada lo distingue en `ai_call_log` ni en `plan_audit_log`, y los locales escriben en Neon. Decidir una marca, por ejemplo una cabecera validada que termine en `superficie` o en una columna, y quién la emite. Hasta entonces las cifras son una cota superior.
- **Pensamiento y modelo de producción para la línea base A0.4a (T8).** El runner toma `GEMINI_CHAT_MODEL` y `GEMINI_CHAT_THINKING_LEVEL` del entorno donde corre. En `.env.local` da `gemini-3.6-flash` con `low`. A0.4a exige los valores de producción: una persona debe confirmarlos en el servidor, sin exponer secretos, antes de ejecutar T8. Si difieren, se corre con los valores de producción y se registran en `run.json`.
- DP-13: presupuesto de A0.4a y A1.2 (esta corrida usa un tope local de US$15 para A0.4a).
- Confirmar con operación el modelo de producción y `GEMINI_CHAT_THINKING_LEVEL` (Plan A §12 día 1), sin exponer secretos.
