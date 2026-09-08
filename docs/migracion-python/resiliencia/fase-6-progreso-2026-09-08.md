# Fase 6 — progreso real 2026-09-08

Continuación del mismo día que `incidente-2026-09-08-happie-503.md`. Todo lo
de abajo se hizo con autorización explícita del usuario en la sesión, paso a
paso, verificando antes de avanzar al siguiente.

## Hecho hoy, contra infraestructura real

1. **Migración `001_operational_schema.sql` aplicada en Neon real.** Schema
   `operational` creado con `operational_idempotency`, `operational_request_nonces`
   y `schema_migrations` propio del linaje Python. Verificado con
   `services/ai-api/scripts/migrate.py --dry-run` antes y después; segunda
   corrida confirma 0 nuevas (idempotente).
2. **Rol Postgres restringido `demo_decoracion_ai_api` creado en Neon real.**
   `GRANT` solo sobre `operational.*` (tablas y secuencias, incluidas las que
   se creen después vía `ALTER DEFAULT PRIVILEGES`), `search_path = operational,
   public`. Verificado con una conexión real: puede leer/escribir
   `operational_idempotency` sin calificar el schema, y **recibe
   "permission denied" al intentar leer `public.catalog_products`** — la
   condición no negociable del capítulo Fase 6, comprobada, no supuesta.
   El password vive únicamente en el archivo de entorno del contenedor
   Python en el EC2; no está en ningún archivo del repositorio.
3. **Backend Python desplegado en el EC2 `n8n-maros`.** Imagen construida
   desde `services/ai-api/Dockerfile`, contenedor `demo-decoracion-ai-api`
   corriendo en la red interna `stack_web` (sin puerto publicado al host).
   `INTERNAL_HMAC_SECRET` generado (48 bytes aleatorios), vive solo en el
   env-file del contenedor (`/home/ec2-user/ai-api.env`, `chmod 600`).
   `/healthz` → `200 {"status":"ok"}`. `/readyz` → `200 {"status":"ready"}`
   — esto último implica que el servicio verificó su propia conexión a
   Neon con el rol restringido, no es solo "el proceso arrancó".

## Deliberadamente NO hecho todavía

- **El contenedor Next en vivo no tiene `PYTHON_BACKEND_ENABLED` ni
  `INTERNAL_HMAC_SECRET` configurados** (verificado con `printenv` dentro
  del contenedor: cero coincidencias). El backend Python está desplegado y
  sano, pero **inerte** — ningún tráfico real puede llegar a él todavía
  porque Next nunca lo selecciona.
- No se validó el contrato `operational.v1` de punta a punta (Next →
  Python con HMAC real) contra el despliegue real. El adaptador
  (`src/lib/ia/python-adapter.ts`) firma las peticiones con un esquema
  canónico específico (`firmarRequestInterna`); reproducirlo a mano en un
  script suelto arriesgaba una firma que no coincidiera con el contrato
  real y diera un falso negativo o falso positivo. La forma correcta de
  probarlo es con el propio adaptador, lo que implica tocar la
  configuración del contenedor Next en vivo — no se hizo sin confirmarlo
  antes con el usuario.
- No se ejecutó ningún canario (activar `PYTHON_BACKEND_ENABLED` para el
  endpoint `/api/internal/ai/echo`, aunque sea con tráfico controlado).
- No se probó el rollback (`PYTHON_BACKEND_KILL_SWITCH=true` devolviendo
  el tráfico a Next) porque no hay tráfico Python que revertir todavía.

## Siguiente paso exacto

Para cerrar el criterio de salida de la Fase 6 (`prompt-seguimiento-etapa-5.md`,
pasos 5-7) hace falta, en orden:

1. Añadir `INTERNAL_HMAC_SECRET` (el mismo valor que ya tiene el contenedor
   Python) al env-file del contenedor Next (`.env.production` en el EC2) y
   redesplegar Next para que lo recoja — sin tocar `PYTHON_BACKEND_ENABLED`
   todavía, así el secreto queda disponible pero la ruta Python sigue sin
   seleccionarse.
2. Con eso, probar el contrato real (llamada válida, HMAC inválido, scope
   inválido, nonce repetido, replay, conflicto de idempotencia, timeout,
   cancelación, body demasiado grande) usando el propio adaptador Next
   contra el Python ya desplegado, sin activar tráfico de usuarios reales.
3. Solo si el punto 2 pasa completo: canario controlado (`PYTHON_BACKEND_ENABLED=true`
   para el endpoint interno aprobado), vigilando latencia/errores.
4. Probar el kill switch devolviendo tráfico a Next.

Cada uno de estos cuatro pasos toca la configuración del contenedor Next
que ya sirve tráfico real de usuarios — se dejan para que el usuario decida
explícitamente cuándo continuar, no se encadenan automáticamente al
despliegue del backend.

## Riesgos abiertos

- El rol `demo_decoracion_ai_api` y el `INTERNAL_HMAC_SECRET` nuevo no
  tienen todavía dueño de rotación (mismo hueco que el resto del inventario
  de Fase 4.1, ahora con dos entradas más).
- El contenedor `demo-decoracion-ai-api` no tiene límites de recursos
  (`--memory`, `--cpus`) declarados, igual que ningún otro contenedor en
  este EC2 compartido — pregunta abierta ya señalada en la auditoría 6.0.
- No hay todavía ningún mecanismo de redeploy automático para
  `services/ai-api` equivalente al de `demo-decoracion` (`deploy.yml` +
  `deploy-demo-decoracion.sh`): el despliegue de hoy fue manual. Si el
  código de `services/ai-api` cambia, hay que reconstruir y redesplegar a
  mano hasta que exista ese mecanismo.
