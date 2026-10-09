# Feedback de la IA (REQ-010)

Calificación 1 a 10 de cada turno de la IA (Taller 3D y chat del cliente) con el estado completo del turno. Contrato
tipado en [`contrato.ts`](./contrato.ts) (zod + tipos; importable desde el navegador). Motivos en [`motivos.ts`](./motivos.ts).

## Flujo de la UI

| Momento | Llamada |
|---|---|
| La IA termina un turno | `POST /api/feedback-ia` con `turnoId`, `producto`, `solicitudId` (cabecera `x-request-id` de la respuesta del turno), `conversacionId`, `pedido`, `respuesta`, `escenaAntes`, `escenaDespues`, `modelo`, `costeUsd`, `latenciaMs`. Sin `calificacion`. |
| Capturas | `POST /api/feedback-ia/capturas`, `multipart/form-data`: `turnoId`, `producto`, `momento` (`antes` \| `despues`), `imagen` (JPEG ≤ 600 KB, ~1280 px). Una llamada por captura. |
| La persona califica | `POST /api/feedback-ia` con el mismo `turnoId`/`producto` + `calificacion` (+ `motivos`, `comentario`). |
| Deshace o corrige a la IA | `POST /api/feedback-ia` con `deshecho: true` (y abrir el panel del «por qué»). |

- Idempotente por `(producto, turnoId)`: repetir un pedido no duplica; los campos que no se envían se conservan. `201` la
  primera vez (`creado: true`), `200` después. Solo quien creó el turno lo modifica (`403 TURNO_AJENO`).
- Taller y cliente usan el mismo modelo de acceso: cookie de sesión, mismo origen y tope de 120 calificaciones / 30 capturas
  por minuto y por IP (`429 DEMASIADAS_PETICIONES`).
- Topes: cuerpo JSON 1 MB, cada escena 400 kB serializada, comentario 2000, pedido 4000, respuesta 8000.
- Errores: `{ error, codigo, detalle? }` con `codigo: CodigoErrorFeedback`. `503 ALMACEN_NO_CONFIGURADO` en las capturas:
  la UI debe seguir sin captura (el feedback no depende de ella).
- Los pasos y herramientas del turno los copia el servidor desde la auditoría usando `solicitudId` + `conversacionId`; la UI no
  los envía. La versión de la app es la del servidor.

## Administrador (solo con sesión de administrador)

| Ruta | Qué |
|---|---|
| `GET /api/feedback-ia/admin` | Listado, peor nota primero. Filtros: `producto`, `minimo`, `maximo`, `motivo`, `desde`, `hasta` (AAAA-MM-DD), `texto`, `deshecho=1`, `sinCalificar=1`, `limite`, `desplazamiento`. `formato=csv` o `completo=1` (JSON con escenas) exportan todo el filtro (máx. 5000). |
| `GET /api/feedback-ia/admin/:id` | Detalle: pasos, llamadas de `ai_call_log`, diferencia y escenas, URLs de captura. |
| `GET /api/feedback-ia/admin/imagen?id=&momento=` | La captura (la sirve el servidor; las claves de S3 nunca salen). |
| `GET/POST /api/feedback-ia/analisis` | Últimos análisis / ejecutar uno (`{ dias, conResumen }`). |
| `GET /api/feedback-ia/analisis-cron` | Análisis semanal con `Authorization: Bearer $CRON_SECRET`. También `npm run feedback:analizar`. |

El panel está en `/admin` → pestaña «Feedback IA» (`src/components/admin/feedback-ia/`).

## Roles

La app todavía tiene una sola contraseña compartida; `acceso.ts` resuelve el actor en un solo lugar (`actorDeSesion`) y
`exigirAdministrador` ya rechaza a quien no sea `admin`. Cuando llegue REQ-004 (usuarios admin|staff) solo cambia `actorDeSesion`.

## Variables de entorno

`ALMACEN_S3_ENDPOINT`, `ALMACEN_S3_BUCKET`, `ALMACEN_S3_ACCESS_KEY_ID`, `ALMACEN_S3_SECRET_ACCESS_KEY`, `ALMACEN_S3_REGION`
(módulo compartido `src/lib/almacen/objetos-s3.ts`, prefijo de clave `feedback/`), `CRON_SECRET`, `FEEDBACK_IA_RESUMEN_GEMINI`,
`DATABASE_URL` (migración `030_ai_feedback.sql`).
