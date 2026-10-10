# Feedback de la IA (REQ-010)

Calificación 1 a 10 de cada turno de la IA (Taller 3D y chat del cliente) con el estado del turno. Contrato tipado en
[`contrato.ts`](./contrato.ts) (zod + tipos; importable desde el navegador). Motivos en [`motivos.ts`](./motivos.ts).

## Flujo de la UI

| Momento | Llamada |
|---|---|
| Un turno **producido en la página** termina (una vez) | `POST /api/feedback-ia` con `turnoId`, `producto`, `solicitudId` (cabecera `x-request-id` de la respuesta del turno), `conversacionId`, `pedido`, `respuesta`, `modelo`, `costeUsd`, `latenciaMs` y `pasos` (ver abajo). Sin `calificacion`, sin escenas. |
| Un turno **restaurado** al cargar la página | Nada: no se registra nunca. Solo se consulta su calificación guardada (fila siguiente). |
| Al cargar la página | `GET /api/feedback-ia?producto=taller\|cliente&turnos=id1,id2` (lote de hasta 100 ids; 240 lecturas por minuto y IP; `Cache-Control: private, no-store`). Devuelve `calificaciones` del navegador; los fallos se recuerdan 30 s. |
| Capturas | `POST /api/feedback-ia/capturas`, `multipart/form-data`: `turnoId`, `producto`, `momento` (`antes` \| `despues`), `conversacionId` (recomendado), `imagen` (JPEG ≤ 600 KB, ~1280 px). Una llamada por captura. |
| La persona califica | `POST /api/feedback-ia` con el mismo `turnoId`/`producto` + `calificacion` (+ `motivos`, `comentario`) **y, en esa misma petición, `escenaAntes` y `escenaDespues`**. |
| Deshace o corrige a la IA | `POST /api/feedback-ia` con `deshecho: true` **y las dos escenas**; abrir el panel del «por qué». |

- **Registro perezoso:** montar un turno no manda nada. El turno se registra con la primera calificación, deshacer o comentario.
  Al cargar, `GET /api/feedback-ia?producto=taller|cliente&turnos=id1,id2` (hasta 100 ids, una petición por lote) devuelve la
  calificación guardada de este navegador para mostrarla seleccionada.
- **Mezcla atómica en SQL:** lo que una petición no envía se conserva; dos peticiones concurrentes sobre el mismo turno no se
  pisan. `201` la primera vez (`creado: true`), `200` después. La respuesta trae la `calificacion` guardada.
- **Dueño del turno:** el servidor pone en el navegador una cookie aleatoria `feedback_usuario` (httpOnly, SameSite=Lax) la
  primera vez; solo ese navegador modifica el turno (`403 TURNO_AJENO` para otro). La UI no tiene que hacer nada.
- **Las escenas solo se guardan si la misma petición califica, deshace o comenta** (`escenasGuardadas` en la respuesta): no
  mandes escenas en el registro del turno. Tope por conversación: 200 turnos (`429 CONVERSACION_LLENA`) y 6 MB de escenas
  (las demás se descartan, la calificación sí se guarda). Cada escena ≤ 400 kB serializada (`413`).
- **`pasos`:** la UI manda lo que ya recibió en el stream (NDJSON del panel B del Taller): `[{ nombre, ok, resumen? (≤300), ms? }]`
  (máx. 100). Se guardan con `fuente: "cliente"`. Si no los manda, el servidor intenta copiarlos de su auditoría (en Vercel
  suele no estar) y los marca `"servidor"`; los del navegador nunca se pisan con los del servidor.
- Acceso de escritura (taller y cliente, igual): cookie de sesión de la app, mismo origen y tope por IP (120 calificaciones /
  30 capturas por minuto, 300 capturas por día; `429 DEMASIADAS_PETICIONES`).
- Errores: `{ error, codigo, detalle? }` con `codigo: CodigoErrorFeedback`. `503 ALMACEN_NO_CONFIGURADO` en las capturas: la UI
  sigue sin captura (el feedback no depende de ella).
- Retención: lo que nunca se calificó, deshizo ni comentó se borra a los 30 días (fila e imágenes), junto con imágenes huérfanas.

## Administrador

Todo lo de abajo exige la sesión de la app **y** la clave `ADMIN_PASSWORD` (cookie `feedback_admin`, 8 h, SameSite=Strict).
Sin `ADMIN_PASSWORD` configurada el administrador está cerrado (`403 ADMIN_NO_CONFIGURADO`); sin la cookie, `401 SOLO_ADMINISTRADOR`.
El panel (`/admin` → «Feedback IA») pide la clave y la entrega a `POST /api/feedback-ia/admin/sesion` (`{ clave }`, 10 intentos/min).

| Ruta | Qué |
|---|---|
| `GET /api/feedback-ia/admin` | Listado, peor nota primero. Filtros: `producto`, `minimo`, `maximo`, `motivo`, `desde`, `hasta` (AAAA-MM-DD), `texto`, `deshecho=1`, `sinCalificar=1`, `limite`, `desplazamiento`. |
| `…/admin?formato=csv` | CSV en flujo, por páginas de 200 (hasta 20 000 filas). |
| `…/admin?completo=1&cursor=N` | NDJSON con la fila completa, **50 filas por petición**; la cabecera `x-siguiente-cursor` dice cómo seguir. |
| `GET /api/feedback-ia/admin/:id` | Detalle: pasos (y su fuente), llamadas de `ai_call_log` (si el id es UUID), diferencia y escenas, URLs de captura. |
| `GET /api/feedback-ia/admin/imagen?id=&momento=` | La captura (la sirve el servidor; las claves de S3 nunca salen). |
| `GET/POST /api/feedback-ia/analisis` | Últimos análisis / ejecutar uno (`{ dias, conResumen }`; con resumen de IA, 5 por hora). |
| `GET /api/feedback-ia/analisis-cron` | Análisis semanal **y retención** con `Authorization: Bearer $CRON_SECRET`. También `npm run feedback:analizar`. |

REQ-004 (usuarios admin|staff) reemplazará la clave compartida de administrador.

## Variables de entorno

`ALMACEN_S3_ENDPOINT`, `ALMACEN_S3_BUCKET`, `ALMACEN_S3_ACCESS_KEY_ID`, `ALMACEN_S3_SECRET_ACCESS_KEY`, `ALMACEN_S3_REGION`
(módulo compartido `src/lib/almacen/objetos-s3.ts`, prefijo de clave `feedback/`), **`ADMIN_PASSWORD`**, `CRON_SECRET`,
`FEEDBACK_IA_RESUMEN_GEMINI`, `DATABASE_URL` (migración `030_ai_feedback.sql`).

## Pruebas

`npm run feedback:test` (rutas, servicio, análisis, retención, almacén; sin base ni red) y `npm run feedback:test-sql`
(SQL contra Postgres real en memoria con PGlite: `npm i --no-save @electric-sql/pglite` o `PGLITE_DIR`).
