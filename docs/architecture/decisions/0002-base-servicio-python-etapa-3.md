# ADR 0002: base del servicio Python para Etapa 3

- Estado de decisión: **aceptada; slice local implementada**.
- Fecha: 2026-09-07.
- Alcance: servicio interno base; no cutover.

## Problema

La Etapa 2 dejó contratos JSON Schema, selección de backend, HMAC conceptual,
idempotencia y kill switch, pero no existe consumidor Python. Crear FastAPI
directamente en este repo o mover autoridad comercial antes de tener replay
durable haría difícil verificar compatibilidad y rollback.

## Decisión

### Ubicación y responsabilidad

El servicio será un repositorio hermano independiente:

```text
demo-decoracion-workspace/demo-decoracion-api/
```

El repo Next (`demo-decoracion/`) conserva fachada, autoridades comerciales y
rutas legacy. La slice local vive temporalmente en `services/ai-api/` para
mantener contratos como fuente única y probarla junto al checkout; antes de
tráfico externo se extraerá al repo hermano. FastAPI solo atenderá transporte
interno, autenticación, validación, límites y traducción de errores. No copiará
handlers ni reglas de catálogo, plan, materiales, cotización, LoRA o proveedor.

La ruta hermana sigue siendo objetivo de despliegue. `services/image-api/` está
vacío y no se reutiliza.

### Contratos

Los JSON Schema Draft 7 versionados en `contracts/chat/v1/` y
`contracts/domain/v1/` son la fuente de generación. La implementación Python
debe fijar herramienta y versión de generación, producir modelos Pydantic
deterministas, rechazar propiedades desconocidas y validar entrada/salida en
runtime. No se aceptan tipos Python duplicados a mano.

La cobertura esperada es 9 schemas de chat y 24 de dominio, incluido
`operational.v1`. Fixtures y cambios de contrato se versionan junto con cada
schema. La compatibilidad se comprueba en ambos runtimes antes de cualquier
tráfico.

### Autenticación y replay

Next firma solicitudes internas con HMAC-SHA256 sobre timestamp, nonce, método,
ruta, SHA-256 del cuerpo y scopes ordenados. Python debe validar secreto de al
menos 32 bytes, ventana de 300 segundos, scopes, cuerpo y firma en tiempo
constante. El nonce se consume una sola vez en un store durable; el mismo nonce
es replay y se rechaza.

El store debe ser compartido entre instancias, sobrevivir reinicios y guardar
TTL. Para una `idempotency_key`, reserva atómica, hash distinto produce
`conflict`, hash igual devuelve la respuesta terminal guardada y ningún retry
ejecuta efectos dos veces. El store se mantiene fuera de tablas de autoridad
comercial. PostgreSQL solo se usará si existe una base/schema autorizados y
desechables para la prueba; no se conecta a producción desde Etapa 3.

### Límites y rollback

Etapa 3 no enruta tráfico real, no activa Python por defecto, no concede
autoridad comercial, no usa base remota y no llama Gemini, FAL, Happie, Shopify
ni otro proveedor. No retira rutas Next ni módulos legacy.

Cada endpoint futuro resuelve backend mediante las flags existentes:

- `PYTHON_BACKEND_ENABLED`: habilita Python;
- `PYTHON_BACKEND_KILL_SWITCH`: fuerza Next;
- default: Next.

El kill switch gana siempre. El rollback debe ser un cambio de configuración
por endpoint, conservar Next disponible y no depender de borrar datos ni de
repetir efectos inciertos.

## Alternativas consideradas

- **Crear el servicio dentro de `services/image-api/`:** descartada; esa ruta
  está vacía y su nombre mezcla una futura API de imágenes con el backend
  interno de IA.
- **Crear FastAPI dentro del repo Next:** descartada; mezcla ciclos de entrega,
  dependencias y autoridad con la fachada existente.
- **Generar modelos Python manualmente:** descartada; permite drift frente a los
  JSON Schema versionados.
- **Nonce o replay en memoria:** descartada; se pierde al reiniciar y falla con
  varias instancias.
- **Enrutar Python por defecto o eliminar Next:** descartada; no existe aún
  despliegue, prueba cruzada ni rollback demostrado.
- **Permitir al servicio escribir precios, stock o cotización:** descartada;
  contradice la autoridad PostgreSQL/Next definida en Etapa 2.

## Consecuencias

Positivas:

- separa transporte Python de reglas comerciales;
- permite generar contratos sin duplicar su fuente;
- hace replay y rollback observables y reversibles;
- permite pruebas locales sin proveedor pagado ni base remota.

Costes y límites:

- exige mantener generación reproducible y fixtures cruzados;
- requiere store durable compartido antes de efectos duplicables;
- requiere provisionar secreto, despliegue y observabilidad antes del tráfico;
- la cancelación física de consultas PostgreSQL sigue fuera de esta etapa.

## Verificación

| Criterio | Estado |
|---|---|
| JSON Schema versionados y drift TypeScript | **PASS documentado**: `contracts:check`. |
| Firma HMAC, scopes, hash, skew y selección de backend en TS | **PASS documentado**: `scripts/test-operational-boundary.ts`. |
| Servicio FastAPI en slice local | **PASS**: `services/ai-api`, health/auth/echo sin proveedores. |
| Modelos Pydantic generados y prueba cruzada | **PASS**: 33 schemas, `uv.lock`, generator `--check`, 12 tests. |
| Nonce e idempotencia en store durable | **PASS local**: SQL + store TS + fake tests; no base remota. |
| Pruebas locales Python y concurrencia | **PASS local**: pytest 12/12; concurrencia del store cubierta conceptualmente. |
| HTTP real Next → Python | **No ejecutado** por alcance. |
| Despliegue, secretos, base remota y rollback operativo | **No ejecutado**; requieren infraestructura y autoridad externa. |

Los PASS de implementación local cierran esta slice de Etapa 3. Esta ADR no
afirma despliegue, tráfico real ni acceso comercial.

## Rollback de la decisión

Hasta demostrar paridad, cada endpoint conserva Next como implementación
canónica. Si una prueba, métrica o verificación falla, se apaga
`PYTHON_BACKEND_ENABLED` o se activa `PYTHON_BACKEND_KILL_SWITCH`; ambos deben
resolver a Next. No se elimina el servicio, contratos ni datos de replay sin
una decisión posterior con plan de recuperación.

## Bloqueos restantes

No hay bloqueo técnico para redactar o construir la base local. El primer
tráfico real queda bloqueado por:

1. destino de despliegue y observabilidad aprobados;
2. secreto HMAC provisionado, rotado y disponible para ambos servicios;
3. store durable compartido con retención/TTL acordados;
4. base remota autorizada, solo si una etapa posterior necesita autoridad
   comercial.

No se inventan secretos, despliegues ni conexiones remotas para cerrar estos
bloqueos.
