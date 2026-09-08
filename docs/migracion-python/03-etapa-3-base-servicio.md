# Etapa 3 — base del servicio Python

Estado: **base local implementada; Etapa 3 local cerrada**. Cutover y despliegue
siguen fuera de alcance.

## Alcance

Etapa 3 prepara un servicio interno ejecutable y comprobable en local. No mueve
autoridad ni tráfico de producción. No crea todavía un sustituto del handler de
Next, ni llama Gemini, FAL, Happie, Shopify o proveedores externos.

La ubicación de despliegue objetivo, tomada de la decisión de carpetas de Etapa
1, sigue siendo el repositorio hermano. Para esta slice verificable, el
servicio vive en `services/ai-api/` dentro de este checkout para mantener una
sola fuente local de contratos; se extraerá al repo hermano antes de tráfico
externo.

```text
demo-decoracion-workspace/
├── demo-decoracion/          # Next.js; fachada y autoridades actuales
└── demo-decoracion-api/      # Python/FastAPI; repositorio independiente
```

`demo-decoracion-api/` es destino arquitectónico, no una carpeta verificada en
este checkout. `services/image-api/` existe, pero está vacío y no se reutiliza
como servicio Python de esta migración.

## Criterios verificables

### 1. Base y ubicación

- El scaffold local vive en `services/ai-api/`, con runtime Python,
  dependencias fijadas y `uv.lock`; `demo-decoracion-api/` sigue siendo destino
  de despliegue independiente.
- FastAPI limita su responsabilidad a transporte, autenticación, validación,
  límites y traducción de errores. No contiene reglas comerciales ni llamadas
  directas a proveedores.
- El servicio debe arrancar en local con configuración explícita y fallar
  cerrado si falta autenticación interna requerida.

Estado: **PASS local**. Existen `pyproject.toml`, `uv.lock`, endpoints
`/healthz`, `/readyz` y `/internal/v1/echo`, además de pruebas FastAPI locales.

### 2. Contratos Pydantic generados

- La fuente canónica son los JSON Schema Draft 7 versionados en
  `contracts/chat/v1/` y `contracts/domain/v1/`; no se copian tipos a mano.
- La generación debe ser determinista, con herramienta y versión fijadas en el
  repositorio Python. Los modelos generados deben rechazar propiedades no
  declaradas y validarse en runtime en entrada y salida.
- Deben cubrir los 9 contratos de chat y 24 de dominio actuales, incluido
  `operational.v1`, manteniendo `schema_version` y compatibilidad explícita.
- Una prueba cruzada debe validar fixtures JSON compartidos en TypeScript y
  Python. El cambio de schema exige actualizar versión, fixtures y consumidores.

Estado: **PASS**. El generador cubre 9 schemas de chat + 24 de dominio,
resuelve `oneOf`/`$ref` mediante validación Draft 7 embebida, y `--check` detecta
drift. Pruebas Python validan fixture, modelo unión y propiedades extra.

### 3. Autenticación interna HMAC y nonce

El emisor y receptor deben usar HMAC-SHA256 sobre la entrada canónica formada
por `timestamp`, `nonce`, método HTTP, ruta, SHA-256 del cuerpo y scopes
ordenados. El receptor debe:

1. exigir secreto interno de mínimo 32 bytes;
2. validar esquema, timestamp y ventana máxima de 300 segundos;
3. comparar la firma en tiempo constante;
4. exigir scopes requeridos y hash exacto del cuerpo;
5. consumir el nonce atómicamente en almacenamiento durable antes de ejecutar.

El nonce es de un solo uso. Un reintento legítimo debe generar nonce nuevo y
conservar su `idempotency_key`; repetir el mismo nonce es replay, aunque el
cuerpo coincida.

Estado: **PASS** para la forma de contrato, firma, hash, ventana, scopes y
selección de backend en TypeScript; lo prueban `operational.v1` y
`scripts/test-operational-boundary.ts`. El verificador Python y headers de
transporte están probados localmente; producción falla cerrado sin secreto o
store durable inyectado. El nonce durable está implementado en PostgreSQL/TS.
**No ejecutado**: intercambio HTTP real entre Next y Python.

### 4. Store durable de replay e idempotencia

El store debe ser compartido entre instancias y sobrevivir reinicios. Memoria
local, caché best-effort o archivos temporales no cumplen. Debe soportar:

- registro único de nonce por servicio/namespace y expiración TTL;
- registro de `idempotency_key`, hash de cuerpo y estado `new`, `replay` o
  `conflict`;
- inserción/reserva atómica para impedir dos ejecuciones concurrentes de una
  misma operación;
- respuesta terminal guardada: status, headers permitidos, cuerpo versionado y
  hash;
- replay de la respuesta guardada solo cuando el hash coincide;
- conflicto estable cuando la misma clave llega con otro hash;
- limpieza TTL observable, sin borrar un registro que todavía pueda ser
  reintentado dentro de la ventana acordada.

El diseño inicial debe aislar este store de tablas comerciales. PostgreSQL es
una opción de implementación, pero requiere una base/schema autorizados y
desechables para pruebas; no habilita por sí solo lectura de catálogo,
precios, inventario o procedencia.

Estado: **PASS local**. `019_operational_idempotency.sql` crea tablas aditivas
para idempotencia y nonce; el store implementa reserva atómica, `new/replay`,
`conflict`, `in_flight`, respuesta terminal, TTL y cleanup con `SKIP LOCKED`.
Test fake cubre concurrencia conceptual, replay, conflicto, nonce y expiración.

### 5. Límites de Etapa 3

Durante esta etapa quedan fuera de alcance y deben rechazarse explícitamente:

- tráfico real Next → Python o activación de Python por defecto;
- autoridad sobre catálogo, disponibilidad, inventario, precios, cantidades,
  identidad canónica, aprobación, materiales o cotización;
- conexión a base remota o producción;
- llamadas a Gemini, FAL, Happie, Shopify u otro proveedor;
- eliminación de rutas Next, `@sempertex/agente-core` o adaptadores legacy;
- cambios de Plan 1.1, SceneSpec V2 o catálogo V3, que siguen `deferred`.

Un endpoint base puede exponer salud y validación sintética. No debe ejecutar
efectos comerciales ni simular éxito de proveedor.

Estado: **PASS local**. El endpoint sintético no ejecuta efectos comerciales ni
proveedores; payload máximo y auth se aplican en FastAPI.

### 6. Pruebas locales

El cierre de Etapa 3 exige pruebas sin credenciales pagadas ni base remota:

- generación y validación Pydantic contra fixtures de cada árbol de schema;
- firma válida y rechazo por secreto corto, timestamp vencido, método, ruta,
  cuerpo, scope o firma alterados;
- nonce aceptado una vez y rechazado en replay, incluso con concurrencia;
- idempotencia `new`, `replay`, `conflict`, respuesta guardada y TTL;
- selección por endpoint: Next por defecto, Python solo con flag y kill switch
  siempre ganador;
- errores estables, límites de payload, deadline y cancelación del contrato;
- arranque, health check y apagado local del servicio.

Los comandos de contratos de Etapa 2 siguen siendo evidencia de la base
TypeScript:

```powershell
rtk npm run contracts:test
rtk npm run contracts:test:domain
rtk npm run contracts:test:operational
rtk npm run contracts:test:cancel
rtk npm run contracts:check
```

Estado: **PASS** para la línea base TypeScript documentada y **PASS local** para
Python: `uv run --extra test --system-certs python -m pytest` ejecutó 12 tests.
No se usaron credenciales pagadas ni base remota.

### 7. Rollback por endpoint

Cada adaptador de endpoint debe resolver backend antes de ejecutar efectos:

- `PYTHON_BACKEND_ENABLED` habilita la ruta Python;
- `PYTHON_BACKEND_KILL_SWITCH` fuerza Next, aunque Python esté habilitado;
- el valor por defecto es Next;
- apagar la bandera o activar el kill switch no requiere borrar datos ni
  cambiar la autoridad comercial;
- la ruta legacy de Next permanece disponible hasta pasar replay, observación y
  rollback controlado.

Las flags ya tienen semántica comprobada en `operational.v1` y
`scripts/test-operational-boundary.ts`. La integración real por endpoint,
telemetría de decisión y prueba de rollback HTTP quedan **pendientes**.

## Estado y bloqueos reales

| Área | Estado | Evidencia o bloqueo |
|---|---|---|
| JSON Schema versionado | PASS | 9 chat + 24 dominio; `contracts:check` documentado como PASS. |
| Frontera HMAC/flags en TypeScript | PASS | Contrato operativo y prueba local existentes. |
| Repositorio/servicio Python | PASS local | `services/ai-api`, FastAPI, `pyproject.toml`, `uv.lock`, health/auth y tests. |
| Pydantic generado | PASS | 33 modelos raíz; validación Draft 7 y `--check` sin drift. |
| Replay durable | PASS local | PostgreSQL SQL + store TS para idempotencia y nonce; sin aplicar en base remota. |
| Tráfico real | No ejecutado | Fuera del alcance; no hay despliegue ni firma HTTP Next → Python. |
| Secretos internos | No ejecutado | Falta provisionar, rotar y verificar secreto en entornos autorizados. |
| Base remota/comercial | No ejecutado | No hay autorización ni necesidad para la base local; PostgreSQL comercial conserva autoridad. |
| Despliegue/observabilidad | No ejecutado | Falta destino, health check operativo, métricas, logs redacted y rollback probado. |

No hay bloqueo técnico para documentar o construir el esqueleto local. Sí hay
bloqueos externos para tráfico real: destino de despliegue, gestión de
secretos, store durable compartido y, solo si se necesitara acceso comercial,
base remota autorizada. Ninguno se resuelve inventando credenciales o
conectando producción.

## Criterio de cierre

Etapa 3 local queda **PASS**: servicio base, generación/validación de 33
schemas, auth HMAC, nonce/idempotencia durable, pruebas locales y rollback por
flags están implementados. El repositorio hermano, despliegue, secreto
provisionado y HTTP real siguen siendo gates de la siguiente etapa.
