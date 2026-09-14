# Runbook operativo - Fase 10.2

**Estado:** borrador operativo, no cerrado. **Corte de evidencia:** 2026-09-10.

Este documento convierte en pasos de respuesta la Fase 10.2 de
[`PLAN-MAESTRO-V2.md`](../PLAN-MAESTRO-V2.md). No ejecuta operaciones, no
contiene credenciales y no autoriza por sí solo llamadas a Gemini, fal.ai,
Neon, Shopify ni Happia.

## 1. Reglas de operación

Usar estas etiquetas para no confundir una prueba local con una operación real:

| Etiqueta | Significado |
|---|---|
| **LOCAL-SEGURO** | Código, fixtures o PostgreSQL local en `127.0.0.1`; no llama a un proveedor pagado ni toca una base remota. |
| **REMOTO-LECTURA** | Consulta a EC2, Neon o consola de proveedor; requiere autorización y no se ejecutó al redactar este documento. |
| **REMOTO-ESCRITURA** | Cambio de entorno, deploy, migración, restore, saldo, secreto o llamada pagada; requiere autorización explícita por incidente. |
| **BLOQUEAR** | No repetir, no continuar ni convertir el resultado parcial en éxito. |

Reglas que prevalecen sobre cualquier procedimiento:

- Un timeout o una conexión perdida no demuestra que el proveedor no ejecutó la operación.
- No reintentar un `POST` pagado con una clave nueva para "desbloquearlo".
- No registrar prompts completos, conversaciones, imágenes, base64, DSN, claves ni firmas. Conservar solo `request_id`, `correlation_id`, endpoint, timestamps, proveedor, código/status y resultado.
- PostgreSQL es la autoridad de catálogo, precios, stock, variantes, disponibilidad y procedencia. Una caída no se resuelve inventando datos ni usando un catálogo local no validado.
- Next sigue siendo la fachada y el rollback por defecto. Python no se convierte en autoridad comercial.
- No usar `docker compose down -v` como recuperación: destruye el volumen local.

## 2. Evidencia disponible

| Capacidad | Estado demostrado | Límite de la evidencia |
|---|---|---|
| Gemini caído | El código produce errores estables para llave ausente, cuota, timeout y proveedor. El parser/retrieval puede omitir Gemini en ciertos caminos. | No existe evidencia de una prueba de caída real o de un arnés local específico para Gemini. Gemini sigue siendo el proveedor real de chat, imagen y embeddings. |
| fal.ai sin saldo/error | El cliente registra resultado y `request_id` cuando fal.ai lo devuelve; el deadline total de LoRA es 105 s. | No se probó sin saldo ni existe clave de idempotencia del `POST`; un timeout antes de la respuesta deja el cobro sin reconciliar localmente. |
| PostgreSQL no disponible | `scripts/test-rag-degradation.ts` inyecta la falla contra PostgreSQL local y verificó que FTS/trigram reportan `ERROR` sin fabricar resultados. | No prueba una caída de Neon ni una recuperación real sobre Neon. El pool puede saturarse en cola sin emitir error rápidamente. |
| Idempotencia Python | Store local con `new`, `in_flight`, `replay` y `conflict`; frontera Next-Python y rollback por kill switch comprobados localmente y en canario remoto. | No cubre las llamadas de Gemini/fal.ai. Las reclamaciones `in_progress` huérfanas no tienen recuperación con fencing token. |
| Kill switch Python | `PYTHON_BACKEND_KILL_SWITCH=true` forzó `backend: "next"` durante la validación remota de Fase 6. | El cambio requiere actualizar el entorno y redesplegar; no detiene una solicitud Python ya en curso. La evidencia no es un cutover general. |
| Gasto | Existe telemetría estimada y registro de precios en el plan/esquema. | No existe gate de presupuesto antes de la llamada, tope agregado, umbral vigente ni dueño de aprobación. |

## 3. Respuesta común

1. Declarar el incidente y detener reintentos automáticos o manuales que puedan generar un efecto pagado.
2. Identificar superficie y capacidad: `/api/chat`, `/api/generate`, `/api/references/analyze`, `/api/lora/trainings/[id]/start`, `rag:embed` o frontera `/internal/v1/*`.
3. Capturar los metadatos mínimos indicados arriba. Si no hay `request_id`, anotar timestamp y endpoint; no repetir por esa ausencia.
4. Separar el alcance: proveedor, base de datos, código propio, credencial, saldo o presupuesto. No cambiar varias variables a la vez.
5. Ejecutar únicamente las comprobaciones **LOCAL-SEGURO** aplicables.
6. Mantener bloqueada la capacidad afectada hasta tener causa, estado terminal y verificación posterior.
7. Para recuperación, pedir autorización antes de cualquier acción **REMOTO-LECTURA** o **REMOTO-ESCRITURA**.

## 4. Gemini caído, sin cuota o sin llave

### 4.1 Detección

En `/api/chat`, los códigos públicos existentes son:

| Situación | Código/respuesta esperada |
|---|---|
| Llave ausente o inválida | `AI_KEY_MISSING`, normalmente HTTP 503 |
| Cuota agotada | `AI_QUOTA`, normalmente HTTP 429 |
| Timeout | `AI_TIMEOUT`, normalmente HTTP 504 |
| Otro error del proveedor | `AI_PROVIDER`, normalmente HTTP 502 |
| RAG/PostgreSQL no disponible | `RAG_UNAVAILABLE`, separado del proveedor |

En `/api/generate`, `ErrorIA` expone `causa` como `sin_llave`, `cuota`,
`timeout` o `desconocido`, con 503, 429, 504 o 502 respectivamente. Un error
genérico de imagen no prueba que Gemini no haya ejecutado la llamada.

### 4.2 Contención

- **BLOQUEAR** nuevas generaciones Gemini, análisis de referencias y trabajos de embeddings documentales mientras no se conozca la causa.
- **BLOQUEAR** el reintento correctivo de QA: una generación con QA fallido puede pagar una segunda generación y observaciones adicionales.
- El camino RAG léxico puede seguir solo si PostgreSQL está sano y el producto acepta la degradación. No presentar una respuesta sin catálogo como si fuera una respuesta completa.
- Si falla únicamente el embedding de consulta Python, el diseño conserva ramas léxicas. Eso no convierte Gemini en disponible ni valida el vector.
- No tratar `PYTHON_BACKEND_KILL_SWITCH` como solución para Gemini: el kill switch solo selecciona Next frente a Python.
- No cambiar `GEMINI_API_KEY` ni revocar una llave como primera reacción. La rotación depende de Google AI Studio/Google Cloud y su prueba real está pendiente.

### 4.3 Comprobaciones

- **LOCAL-SEGURO:** `npm run rag:stack-check` solo después de confirmar que `DATABASE_URL` apunta a un PostgreSQL local. Este script comprueba conectividad y solo marca Gemini como `READY` o `SKIPPED_OPTIONAL`; no prueba una llamada a Gemini.
- **LOCAL-SEGURO:** `npm run contracts:test:python-adapter` usa respuestas simuladas y comprueba errores estables de la frontera Python; no comprueba disponibilidad de Gemini.
- **BLOQUEAR:** no usar `npm run rag:health` como health check inocuo durante este incidente: con vector y llave activos ejecuta una llamada real de embedding a Gemini.
- **REMOTO-LECTURA/REMOTO-ESCRITURA, NO EJECUTADO:** revisar la consola autorizada de Google y, si se aprueba, hacer una sola comprobación real de bajo alcance. El comando existente `npx tsx --env-file=.env.local --conditions=react-server scripts/eval-e2e-rag-v2.ts --with-gemini` llama al proveedor y no pertenece al carril local seguro.

### 4.4 Recuperación

1. Confirmar que la causa ya no es llave, permiso, cuota o timeout.
2. Si se rotó la llave, actualizarla únicamente en el gestor/entorno autorizado, redesplegar y probar antes de revocar la anterior. No copiar el valor al repositorio ni al ticket.
3. Verificar una capacidad a la vez: chat, luego la capacidad de imagen o embedding que estaba afectada.
4. Confirmar que no hubo reintentos o cargos pendientes durante la ventana incierta.
5. Reabrir tráfico gradualmente y conservar el registro del incidente.

La recuperación no puede considerarse cerrada hasta probar una caída simulada
sin gasto y una recuperación controlada con el mismo contrato de errores.

## 5. fal.ai sin saldo, error o respuesta incierta

### 5.1 Contención inmediata

- **BLOQUEAR** `/api/lora/trainings/[id]/start`: inicia un entrenamiento real y facturable.
- **BLOQUEAR** `/api/generate` cuando use LoRA; puede enviar trabajo a fal.ai.
- No crear otro draft con una etiqueta diferente para esquivar un fallo de inicio.
- No reintentar el `POST` de `https://queue.fal.run/...` si hubo timeout, conexión perdida o respuesta ilegible.
- En `comparar`, una imagen Gemini que sí llegue no es evidencia de que el camino LoRA haya terminado; mostrar el fallo de LoRA y no activar ese resultado como artefacto.

El cliente actual no envía una clave de idempotencia aceptada por fal.ai.
`operational_idempotency` protege la frontera Next-Python, no el `POST` de
fal.ai. El `request_id` de fal.ai solo existe después de que fal.ai devuelve la
sumisión. Si el timeout ocurrió antes, no hay identificador local con el cual
reconciliar el trabajo.

### 5.2 Diagnóstico y reconciliación

- **LOCAL-SEGURO:** ejecutar pruebas de registro/idempotencia que no llamen al proveedor: `npx tsx scripts/test-idempotency-store.ts` y `npm run contracts:test:python-adapter`.
- **REMOTO-LECTURA, NO EJECUTADO:** revisar en la cuenta/team correcto de fal.ai el estado de la sumisión, saldo, historial y `request_id` si existe. No asumir que un HTTP 402, 403 o 5xx tiene el mismo significado en todos los endpoints.
- **REMOTO-ESCRITURA, NO EJECUTADO:** cargar saldo, cambiar la llave, cancelar o volver a enviar un trabajo. Cada acción necesita aprobación de proveedor y gasto.
- Si no se puede demostrar un estado terminal, dejar la operación como incierta y no volver a enviarla.

### 5.3 Recuperación

1. Confirmar saldo y permisos en la cuenta correcta sin imprimir la llave.
2. Resolver cualquier sumisión incierta antes de otra solicitud.
3. Validar dataset, artefacto LoRA, modelo, pasos y costo estimado en local.
4. Obtener aprobación puntual para la llamada real; no existe todavía una prueba de fal.ai de cero costo.
5. Registrar el `request_id` del proveedor, el costo estimado y el resultado. Reconciliar contra la factura externa, no solo contra `ai_call_log`.

No está permitido cerrar este incidente como resuelto mientras falte la
idempotencia específica del proveedor o un mecanismo de reconciliación probado.

## 6. PostgreSQL no disponible

### 6.1 Contención

- **BLOQUEAR** importaciones, `rag:sync`, `rag:embed`, migraciones, edición de catálogo, generación que necesite autoridad comercial y cualquier restore improvisado.
- Mantener contenedor y volumen. No ejecutar `docker compose down -v`.
- Si solo falla una rama FTS/trigram, el contrato actual puede devolver resultado parcial con `branchStatus` en `ERROR`. Si todas fallan, el resultado es `[]`; no es éxito comercial.
- El chat mapea una falla reconocida de Postgres a `RAG_UNAVAILABLE`. No sustituir el catálogo por SQLite, memoria, un snapshot viejo o datos escritos a mano.
- `/readyz` del backend Python debe tratarse como no listo si el store durable no puede conectar. El entorno productivo no debe aceptar silenciosamente el store en memoria.

### 6.2 Diagnóstico local

1. Confirmar el destino de `DATABASE_URL` antes de ejecutar cualquier script. El valor de `.env.local` del checkout apunta a Neon según la evidencia histórica; no asumir que un comando llamado `stack-check` es local.
2. **LOCAL-SEGURO:** con un DSN confirmado de loopback, ejecutar `npm run rag:stack-check`. Es una consulta de lectura y comprueba PostgreSQL, extensiones, pgvector, provenance y dimensión.
3. **LOCAL-SEGURO:** con PostgreSQL local sano, ejecutar `npx tsx scripts/test-rag-degradation.ts`. Inyecta fallos en el pool sin apagar el servidor y verifica que no se fabrica éxito.
4. **REMOTO-LECTURA, NO EJECUTADO:** si el destino real es Neon, comprobar conectividad, base, migraciones y conteos con el procedimiento autorizado de [`rag-rollback-v2.md`](../../operations/rag-rollback-v2.md). No usar esos resultados para afirmar que el restore está probado.

### 6.3 Recuperación de datos o esquema

- Si una importación falla antes de `published`, verificar que el snapshot anterior sigue publicado; no ejecutar otro importador encima.
- Si el snapshot publicado es incorrecto, usar primero un backup verificable. La reimportación solo es rollback si el cuerpo y SHA coinciden con el snapshot aprobado.
- El objetivo de rollback RAG documentado es `RAG_ENABLED=false` más los SHA de productos `13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42` y órdenes `d4f5dd037656209f25b018274877333bd134560df5f055168410ffeaac58b414`.
- **REMOTO-ESCRITURA, NO EJECUTADO:** aplicar una migración, reimportar, restaurar Neon, cambiar flags o activar tráfico requiere autorización y backup/manifest previo.
- La prueba de backup/restore existente restauró Neon en una base local desechable. No probó el mecanismo específico de restore sobre Neon en producción.

## 7. Idempotencia y operaciones inciertas

### 7.1 Frontera Next-Python

Cuando la operación use `operational.v1`:

- Mantener el mismo `scope`, `idempotency-key` y cuerpo canónico para repetir la misma operación.
- `new` reserva; `in_flight` significa que otra ejecución sigue reclamando la clave; `replay` devuelve la respuesta terminal guardada; `conflict` significa que la misma clave llegó con otro hash.
- Un `nonce` de `operational_request_nonces` evita replay de la firma HMAC; no sustituye la idempotencia de la operación.
- No borrar manualmente reclamaciones `in_progress` vencidas: la migración y la decisión de arquitectura evitan ese borrado para no permitir que un worker tardío finalice una reclamación reutilizada.
- Si falla la finalización, conservar el estado y escalar. La recuperación de huérfanas necesita fencing token, que todavía no está implementado.

### 7.2 Proveedores pagados

- Gemini no recibe una clave de idempotencia de aplicación en la ruta de imagen; fal.ai tampoco en su `POST` actual.
- Un `request_id` de Next o `correlation_id` sirve para correlación, no demuestra deduplicación ante el proveedor.
- Si una llamada pagada no tiene resultado terminal, **BLOQUEAR** el reintento y reconciliar primero en el proveedor autorizado.
- `happie_webhook_requests`, `operational_idempotency` y el store Python pertenecen a fronteras distintas. No usar una fila de webhook como prueba de que una generación Gemini/fal.ai fue deduplicada.

## 8. Kill switch de Python

### 8.1 Qué hace y qué no hace

`PYTHON_BACKEND_KILL_SWITCH=true` tiene precedencia sobre
`PYTHON_BACKEND_ENABLED=true` y selecciona Next para nuevas llamadas del
adaptador. Según la capacidad, el efecto esperado es:

| Capacidad | Degradación esperada |
|---|---|
| Echo | Respuesta de Next |
| Rerank | Se conserva el orden local de PostgreSQL |
| Embedding de consulta | Se abandona la ruta Python y se conserva el fallback configurado, normalmente lexical si el vector no está disponible |

No apaga Gemini, fal.ai ni PostgreSQL, no revoca secretos y no cancela una
solicitud Python que ya comenzó. No es un kill switch general de IA.

### 8.2 Procedimiento

1. **LOCAL-SEGURO:** ejecutar `npm run contracts:test:python-adapter`; cubre selección Next, precedencia del kill switch, HMAC, nonce, replay, conflicto, timeout y errores estables con fetch simulado.
2. **REMOTO-ESCRITURA, NO EJECUTADO:** establecer `PYTHON_BACKEND_KILL_SWITCH=true` en el entorno de despliegue autorizado y redesplegar una revisión conocida. No editar ni registrar valores de secretos en el repositorio.
3. **REMOTO-LECTURA, NO EJECUTADO:** verificar `/healthz`, `/readyz`, la capacidad afectada y que los eventos ya no muestran selección Python. El echo no basta si el incidente era rerank o embedding.
4. Mantener el switch activo mientras se diagnostica. No volver a `false` solo porque `/healthz` responde.
5. Para reactivar Python, pedir autorización, dejar constancia de la causa corregida y repetir la verificación de la capacidad concreta. `PYTHON_BACKEND_ENABLED` debe permanecer `false` por defecto fuera del canario aprobado.

La validación remota de Fase 6 demostró el cambio `python -> next` con el kill
switch y dejó los flags en `false` al finalizar esa sesión. El estado remoto
actual debe comprobarse antes de operar; ver los huecos al final.

## 9. Migración fallida a mitad

### 9.1 Identificar el linaje

| Linaje | Alcance | Runner autorizado |
|---|---|---|
| Comercial | `public.*`: catálogo, RAG, planes y telemetría | `npm run rag:migrate` / `scripts/migrate.ts` |
| Operacional | `operational.*`: idempotencia y nonces del backend Python | `services/ai-api/scripts/migrate.py` |

`services/ai-api/migrations/001_operational_schema.sql` es la migración
autoritativa del linaje Python. La antigua migración operacional del repo Next
fue retirada; no aplicar DDL operacional desde el runner TypeScript.

### 9.2 Qué hacer ante el fallo

- El runner TypeScript usa un solo cliente, advisory lock y una transacción por migración. Si falla el archivo actual, esa transacción debe hacer rollback; los archivos anteriores de la misma ejecución pueden haber quedado committeados.
- El runner Python también aplica cada archivo dentro de una transacción, con checksum y lock. No tiene `--target` ni reconciliación de renombrados.
- **LOCAL-SEGURO:** en una base loopback confirmada, `npm run rag:migrate:check` muestra pendientes sin escribir. Desde `services/ai-api`, `uv run --system-certs python scripts/migrate.py --help` muestra las opciones sin conectar.
- **REMOTO-ESCRITURA, NO EJECUTADO:** `npm run rag:migrate -- --allow-remote` aplica el linaje comercial; `--target <archivo>` permite bisecar solo en el runner TypeScript. El runner Python requiere `--dsn` y solo admite `--allow-remote` explícito para una base no local.
- No marcar manualmente una migración como aplicada, no editar una migración ya aplicada y no repetir a ciegas después de perder la conexión.
- Revisar `schema_migrations`, checksum, lock y estado de la migración antes de continuar. Un checksum divergente detiene el runner y requiere decisión del dueño.

### 9.3 Reversión

- No existe un comando `down` común. Usar únicamente la nota `-- rollback:` del archivo exacto, después de backup y prueba en una copia.
- Para migraciones marcadas como no reversibles, hacer restore del backup; no inventar un `DROP` que no reconstruya datos.
- La migración operacional no debe revertirse mientras haya reclamaciones `in_progress` u operaciones sin respuesta terminal: perdería el registro que evita duplicados.
- La nota de rollback de Python nunca se ejercitó contra una base real. La operación real de restore sobre Neon tampoco está verificada.

## 10. Rollback de aplicación, datos y capacidad

Aplicar el nivel mínimo que contenga el incidente:

1. **Capacidad:** kill switch Python para nuevas selecciones Python; `RAG_ENABLED=false` para un incidente de RAG. Estos flags no reemplazan un bloqueo de proveedor pagado.
2. **Revisión:** desplegar el SHA conocido como bueno mediante el mecanismo existente de despliegue. El SHA debe provenir del release/manifest y verificarse antes de desplegar; no usar `latest` por intuición.
3. **Contenedor:** los documentos registran `demo-decoracion-rollback-f2cadd3` y `demo-decoracion-ai-api-rollback-f2cadd3` como conservados. Confirmar que existen, corresponden al contrato y están disponibles antes de depender de ellos.
4. **RAG/datos:** mantener tráfico retirado, restaurar backup o reimportar únicamente los SHA aprobados, ejecutar los gates y observar antes de reactivar.
5. **Esquema:** no hacer rollback de DDL en producción sin backup, aprobación del dueño de datos y prueba en una copia.

Verificación posterior mínima: salud/readiness, contrato afectado, no-key E2E,
estado de flags, ausencia de nuevos errores y preservación de telemetría. La
verificación remota y cualquier redeploy de esta sección no se ejecutaron.

## 11. Límites de gasto

### 11.1 Hechos, no límites activos

- Una sesión histórica gastó US$1.932 en 61 generaciones y dejó US$21,88 de saldo en ese momento. No es el saldo actual ni un límite operativo.
- fal.ai documentó US$0,0064 por paso. La ruta de creación de draft acepta actualmente entre 100 y 2.000 pasos y calcula un costo estimado; ese cálculo no bloquea el inicio ni limita gasto diario.
- Un registro anterior autorizó un entrenamiento dev de máximo 300 pasos y costo teórico de US$1,92. Esa autorización histórica no coincide con el máximo actual de la ruta y no debe reutilizarse.
- Una generación Gemini con QA fallido puede implicar dos generaciones y dos observaciones. El análisis de referencias puede tener hasta seis intentos según el plan.
- `ai_call_log` y la tabla de precios son estimaciones locales y no sustituyen la factura ni el saldo del proveedor.

### 11.2 Control requerido antes del cierre

El gate debe ejecutarse **antes** de cada llamada pagada y tener dos valores por
flujo: aviso y corte duro. Los valores, moneda, periodo, dueño y acción ante
excepción aún no están definidos; por eso esta capacidad permanece bloqueada
para una operación no autorizada.

| Flujo | Límite que debe aprobarse | Alcance propuesto por el plan |
|---|---|---|
| `entrenamiento_lora` | USD por corrida y por día | Incluye pasos, entrenamiento y evaluación fal.ai |
| `generador_imagen` | USD por día y por conversación | Incluye QA y retry correctivo |
| `armador_decoracion` | USD por conversación | Corta loops patológicos |
| `evaluacion` | USD por corrida | Evita que un benchmark consuma el saldo |
| `indexacion_catalogo` | USD por corrida/lote | Incluye embeddings documentales Gemini |

Ante el umbral de aviso: congelar expansión y nuevos experimentos. Ante el
corte: bloquear la llamada antes del proveedor y no permitir bypass manual sin
autorización del dueño del presupuesto. El repositorio no tiene hoy un
interruptor global para ejecutar ese corte; detener tráfico o una operación de
proveedor requiere un mecanismo de despliegue/cuenta que todavía no está
definido en este runbook.

## 12. Acciones que requieren autorización

| Acción | Autorización mínima |
|---|---|
| Cualquier llamada real a Gemini, fal.ai, Shopify, Happia o un endpoint de proveedor | Dueño del incidente y autorización de costo/alcance |
| Entrenamiento LoRA, evaluación, generación, retry o reenvío incierto | Dueño de presupuesto y responsable técnico; registrar costo máximo antes de enviar |
| Crear saldo, cambiar/revocar `GEMINI_API_KEY` o `FAL_KEY` | Dueño de la cuenta del proveedor y responsable de despliegue |
| Leer o modificar Neon/EC2, cambiar env, flags o kill switch, redeploy | Responsable de infraestructura; lectura remota también debe quedar registrada |
| Aplicar migración remota, rollback DDL, borrar tablas, restaurar backup o reimportar catálogo | Dueño de datos y responsable técnico; backup y manifest previos |
| Reactivar Python, RAG, vector, QA o una capacidad bloqueada | Dueño de producto más responsable técnico, con verificación posterior |
| Fijar o cambiar umbrales de gasto y autorizar un bypass | Dueño de presupuesto; no se puede inferir desde el saldo observado |

## 13. Cierre del incidente

- [ ] Capacidad y proveedor afectados identificados.
- [ ] Reintentos pagados detenidos durante el estado incierto.
- [ ] Metadatos de correlación conservados sin secretos, cuerpos ni imágenes.
- [ ] Estado de migraciones, flags, salud y readiness verificado.
- [ ] Toda operación remota y su autorización registradas.
- [ ] No se confundió una prueba local con una llamada real.
- [ ] Idempotencia o reconciliación confirmada para cada operación incierta.
- [ ] Backup/manifest y SHA exactos conservados si hubo datos o despliegue.
- [ ] Verificación posterior de la capacidad afectada completada.
- [ ] El runbook sigue marcando como abierto cualquier hueco no probado.

## 14. Huecos que impiden considerarlo cerrado

1. No hay arnés de inyección de fallos para Gemini/fal.ai ni prueba sin saldo de fal.ai; la idempotencia específica del `POST` de fal.ai sigue pendiente.
2. No existe gate de presupuesto implementado antes de la llamada, ni umbrales vigentes, dueño del presupuesto, límite global ni corte agregado para QA/retry.
3. La evidencia de PostgreSQL es una inyección contra Postgres local. No se probó caída, recuperación ni restore sobre Neon en producción.
4. El rollback de la migración Python y la recuperación de reclamaciones `in_progress` no se han ejercitado en una base real; tampoco existe `--target` o `down` para el runner Python.
5. El estado documentado de los flags es inconsistente: Fase 6 terminó con `PYTHON_BACKEND_ENABLED=false` y `PYTHON_BACKEND_KILL_SWITCH=false`, mientras el progreso posterior describe el canario de embeddings Python activo. Debe comprobarse el entorno real antes de cambiarlo.
6. No hay dueño humano asignado para secretos, cuentas de proveedor, infraestructura ni aprobación de gasto. El despliegue Python tampoco tiene redeploy automático equivalente al de Next.
7. No existe un kill switch general para Gemini/fal.ai ni rate limit para `/api/chat`, `/api/generate`, `/api/references/analyze` y el inicio de entrenamiento LoRA.
8. `release-manifest.json` conserva `status: "development_only"` y `rollback_target: null` en el nivel superior, aunque contiene un rollback target anidado para RAG. No es un manifest de release operativo único.
9. La cobertura y reconciliación completa de `ai_call_log` no está demostrada para todas las llamadas del plan; además, sus costos son estimados y no incluyen por sí solos el saldo/factura externa.
10. El runbook no puede fijar una acción automática al alcanzar el corte porque el mecanismo de bloqueo de proveedor y sus responsables todavía no están definidos.

Mientras estos puntos sigan abiertos, la Fase 10.2 debe considerarse
**documentada parcialmente**, no cerrada.
