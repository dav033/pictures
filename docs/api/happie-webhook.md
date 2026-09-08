# Webhook Happie

## Endpoints y compatibilidad

| POST | Resultado |
| --- | --- |
| `/api/happie/webhook/recommend-packages` | Hasta 3 recomendaciones |
| `/api/happie/webhook/recommend-package` | Hasta 1 recomendacion |
| `/api/happie/webhook/chat` | Pregunta con estado o recomendaciones tras confirmacion |

Se conservan API key, payloads y respuestas exitosas. No se requiere HMAC nuevo,
cookie, Origin ni CORS: son endpoints servidor a servidor sobre HTTPS.
Los endpoints de navegador `/api/happie/recommend-package(s)` siguen usando
`HAPPIE_EXTERNO_API_KEY` y CORS; **no** tienen las garantias durables de este documento.
Contrato anterior: [API externa](happie-recomendacion-externa.md).

## Headers

| Header | Uso |
| --- | --- |
| `x-api-key` | Obligatorio; secreto `HAPPIE_WEBHOOK_API_KEY`, minimo 32 bytes UTF-8 |
| `Content-Type: application/json` | Enviar JSON UTF-8; no se exige un header nuevo a clientes antiguos |
| `Idempotency-Key` | Opcional; 1-128 caracteres ASCII visibles sin espacios; una clave por operacion/turno |
| `X-Correlation-ID` | Respuesta: UUID generado en servidor, distinto en cada intento, incluso replay |
| `Retry-After` | Respuesta: segundos de espera en 429, concurrencia 409 y errores temporales |
| `Cache-Control: no-store` | Todas las respuestas del webhook, incluidos errores |

## Ejemplos

```bash
curl https://TU_HOST/api/happie/webhook/recommend-package \
  -H "Content-Type: application/json" \
  -H "x-api-key: $HAPPIE_WEBHOOK_API_KEY" \
  -H "Idempotency-Key: pedido-123-recomendacion-v1" \
  --data '{"tipoEvento":"Boda","invitados":60,"presupuesto":2500000,"decoracion":true,"preferencias":["estilo elegante"],"url":"https://www.happia.co"}'
```

`tipoEvento`, `invitados` y `presupuesto` son obligatorios. Invitados es entero
positivo hasta 100000, presupuesto numero finito positivo. Servicios opcionales:
`comida`, `bebida`, `decoracion`, `fotografia` (booleanos). Solo los servicios
en true se mencionan al modelo. Preferencias: hasta 20 textos de 1-300 caracteres.
`url` debe ser HTTP(S); solo construye enlaces, no se descarga ni se usa para
acceder al catalogo. Sin `url`, se usa el origen de `HAPPIA_API_BASE_URL`.

```json
{"recomendaciones":[{"url":"https://www.happia.co/client/events/new?package=ID","razon":"Encaja con el evento."}],"resumen":"Una opcion disponible."}
```

Un arreglo vacio es un resultado valido si no hay paquetes activos o adecuados.
Una respuesta vacia/malformada del proveedor es un error temporal, no un exito cacheado.

```bash
curl https://TU_HOST/api/happie/webhook/chat \
  -H "Content-Type: application/json" \
  -H "x-api-key: $HAPPIE_WEBHOOK_API_KEY" \
  -H "Idempotency-Key: conversacion-123-turno-1" \
  --data '{"mensaje":"Boda para 60 personas, presupuesto 2500000"}'
```

El chat acepta `mensaje` (1-2000 caracteres), `estado` y `url` opcionales.
Devuelve `{tipo:"pregunta",mensaje,estado}` o
`{tipo:"recomendaciones",mensaje,estado,recomendaciones,resumen}`.
Reenviar el `estado` recibido junto al siguiente mensaje, con una **nueva** clave
por turno. Fases: descubrimiento, detalles, confirmacion, finalizado.
El estado lo transporta el cliente, no es una sesion persistida ni prueba de
autorizacion; la idempotencia no sustituye la gestion de conversaciones.

## Idempotencia durable

Solo existe garantia de deduplicacion **con `Idempotency-Key`**. PostgreSQL guarda
hashes SHA-256 de credencial, clave y bytes del body, junto con la respuesta exitosa.
El ambito incluye credencial y operacion (chat, recomendacion de 1 o de 3).
Rotar la credencial cambia ese ambito. No se almacena el body de entrada ni la API key.

- Mismos bytes y clave: replay de la respuesta exitosa durante 24 horas desde la adquisicion.
- Misma clave y bytes distintos: 409, incluso durante una llamada concurrente.
- JSON equivalente con distinto espaciado/orden tambien tiene hash distinto: reenviar exactamente el mismo body.
- Una reserva atomica con lease de 2 minutos coordina instancias; llamadas concurrentes reciben 409 y Retry-After: 120.
- Errores no se cachean. Se libera el lease tras fallo completado, conservando el hash; un retry puede volver a ejecutar.
- Cancelacion/deadline total conserva el lease hasta vencer, por precaucion ante proveedores aun ejecutando.
- Un proceso caido puede dejar un lease; tras vencer puede recuperarse. El owner evita que una ejecucion antigua sobrescriba la nueva.
- Al vencer las 24 horas se permite reutilizar la clave incluso con otro body. Sin header, cada solicitud puede ejecutar proveedores otra vez.

**No se garantiza exactamente una llamada externa ante crash**, timeout,
cancelacion o perdida de la respuesta/confirmacion PostgreSQL. Una llamada puede
haber llegado a Gemini aunque el cliente local la aborte. No hay transaccion
distribuida ni idempotencia del proveedor; no usar esto para prometer cobros o
acciones externas exactamente una vez. No se mantienen transacciones abiertas
mientras se llama a proveedores.

## Limites y errores

- Body maximo: 32768 bytes leidos del stream antes de JSON.parse; Content-Length solo permite rechazo anticipado.
- Deadline total: 60 segundos, combinado con `request.signal`, incluyendo persistencia y cleanup; el hosting/proxy debe permitir ese tiempo. El cleanup dispone como maximo de 5 segundos y nunca mas que el presupuesto restante del deadline original.
- Happia fetch: 10 segundos, incluyendo lectura de respuesta. Gemini: 25 segundos por llamada, un intento SDK.
- El chat propaga el mismo signal a extraccion, solicitud interna, catalogo y recomendador. No hay retries automaticos de negocio.
- PostgreSQL: adquisicion explicita con `pool.connect()`, espera maxima de 5 segundos o hasta cancelar la solicitud/deadline, lo que suceda antes. Se comprueba la senal antes de adquirir y antes de cada SQL de rate, claim y finish. `query_timeout` local de 5 segundos limita la consulta, no la adquisicion.
- Admisiones PostgreSQL del webhook: maximo **8 adquisiciones pendientes por proceso**, compartidas por rate, claim y finish de todos sus endpoints. El contador persiste entre recargas de modulos. Al saturarse se responde 503 sin llamar a `pool.connect()` ni crear otra cola de espera en la aplicacion.
- La cola de adquisicion de `pg` no es cancelable: **las esperas abandonadas siguen contando dentro de esas 8 plazas** hasta que el pool realmente entregue una conexion o rechace, incluso despues de 60 segundos. Una conexion tardia se libera exactamente una vez sin ejecutar SQL; tanto resolucion como rechazo liberan la plaza de admision. Esto acota la acumulacion, no elimina inmediatamente las entradas pendientes de `pg`.
- No se modifica la configuracion del pool compartido de RAG. El limite solo acota adquisiciones del webhook, no las de otros consumidores de RAG, y no es un limite distribuido: cada proceso/replica tiene sus 8 plazas. Si el pool nunca resuelve ni rechaza esas adquisiciones, el webhook permanece en 503 hasta recuperar el pool o reiniciar el proceso, sin acumular nuevas esperas. Aplicar backoff ante 503.
- Si se interrumpe una consulta ya iniciada, se destruye esa conexion en vez de devolverla ocupada al pool. Esto no garantiza deshacer SQL ya recibido/confirmado por PostgreSQL. Un finish incierto no provoca otro intento de liberar o sobrescribir la reserva; se conserva la proteccion por owner y la recuperacion por expiracion del lease.
- Rate limit durable: 30 solicitudes validas/autenticadas por minuto calendario UTC y credencial, compartido por los tres endpoints, incluidos replays. Puede haber hasta 60 alrededor del cambio de minuto.
- JSON invalido, payload invalido y autenticacion fallida se rechazan antes de PostgreSQL/proveedores. Configurar proteccion volumetrica/IP en el proxy: este limite no protege el trafico no autenticado.

| Status | Significado / accion |
| --- | --- |
| 400 | JSON, payload o Idempotency-Key invalido; corregir |
| 401 | API key ausente/incorrecta; no reintentar sin corregir |
| 408 | Solicitud cancelada por cliente (si aun puede recibir respuesta) |
| 409 | Hash diferente: corregir clave; en curso: esperar Retry-After |
| 413 | Body demasiado grande; reducir |
| 429 | Rate limit; esperar Retry-After: 60 |
| 502 | Fallo/respuesta invalida de Happia o Gemini |
| 503 | Webhook no configurado, coordinacion PostgreSQL no disponible o admisiones saturadas; falla cerrado, sin fallback en memoria |
| 504 | Timeout local/proveedor |

```json
{"error":"Servicio temporalmente no disponible.","correlationId":"UUID"}
```

Errores no exponen mensajes, cuerpos, prompts ni credenciales de proveedores.
Para diagnostico usar `X-Correlation-ID`; los logs de control solo incluyen ID,
operacion y status. Para 502/503/504, aplicar backoff exponencial con jitter,
respetando Retry-After (normalmente 5 segundos) y un numero acotado de intentos.
Conservar clave/body; un retry puede recibir 409 hasta vencer el lease.

## Configuracion y migracion

| Variable | Uso |
| --- | --- |
| `HAPPIE_WEBHOOK_API_KEY` | Secreto servidor a servidor, no exponer en navegador |
| `DATABASE_URL` | PostgreSQL compartido entre replicas, pool existente de RAG |
| `HAPPIA_API_BASE_URL` | Base del catalogo Happia (por ejemplo https://www.happia.co/api) |
| `HAPPIA_API_KEY` | Credencial de catalogo Happia |
| `GEMINI_API_KEY` | Credencial de Gemini |
| `GEMINI_CHAT_MODEL` | Modelo opcional; default gemini-3.6-flash |

Los limites son constantes de codigo, no variables de entorno.
Antes de desplegar ejecutar `npm run rag:migrate` con la base correcta configurada.
Compilar tambien `npm run build --workspace=@sempertex/happie-package-ia` antes
del build de Next: el workspace publica/consume `dist`, no los fuentes TypeScript.
Aplica `scripts/migrations/019_happie_webhook.sql` segun el registro
`schema_migrations`; crea `happie_webhook_rate` y `happie_webhook_requests`.
Sin migracion no se ejecutan proveedores para solicitudes validas: 503.
No se ejecuto la migracion contra bases reales durante estas pruebas locales.

Programar mantenimiento periodico (por ejemplo diario), fuera de requests:

```sql
DELETE FROM happie_webhook_requests WHERE expires_at < now() AND lease_until < now();
DELETE FROM happie_webhook_rate WHERE window_start < now() - interval '1 day';
```

Las respuestas persistidas pueden contener preferencias inferidas por la IA:
restringir acceso a tablas/backups y ajustar retencion operativa. La expiracion
logica no borra fisicamente filas sin mantenimiento. Aplicar limites de conexion
y statement_timeout en PostgreSQL/infraestructura segun capacidad.

## Pruebas locales

`npm run happie:test-webhook` compila el workspace consumido desde dist y ejecuta
tests sin cargar .env, sin secretos reales ni llamadas de red. Cubre autenticacion,
contratos, confirmacion del chat, replay, hash conflictivo y concurrencia,
ausencia de header, errores temporales, 429, fallo cerrado, lectura streaming,
cancelacion, propagacion de signal y regresion de items inactivos con fetch mock.
Incluye saturacion de 8 plazas abandonadas: tras multiples oleadas de retries
y mas de 60 segundos no aumenta la cola, no se ejecuta SQL tardio y las plazas
se recuperan al resolver o rechazar las adquisiciones (incluido fallo sincrono).
Tambien verifica adquisicion tardia tras aborto/timeout para rate, claim y
finish (cero SQL tardio y liberacion unica), aborto durante la entrega de conexion,
destruccion de cliente con consulta interrumpida y fallo a los 59 segundos con
conexion de cleanup a los 61: el handler termina a los 60 y no libera el lease
con SQL tardio. Si el deadline vence durante cleanup, se conserva el error
original ya preparado para la respuesta; no se extiende la espera para cambiarlo.
El adaptador SQL se verifica con pool mock: **no sustituye una prueba de
integracion PostgreSQL de locks, reinicios, expiracion y migracion**.
