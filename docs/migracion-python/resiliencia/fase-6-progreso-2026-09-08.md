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

## Continuación el mismo día: contrato validado, canario y rollback probados

El usuario autorizó explícitamente continuar con los cuatro pasos que este
documento dejaba pendientes, con una condición explícita: verificar el
webhook de Happie después de cada paso que tocara el contenedor Next en
vivo. Se hizo así, y **el webhook de Happie devolvió `200` con una
recomendación real después de cada uno de los cuatro redeploys** que
siguen.

1. **`INTERNAL_HMAC_SECRET` y `PYTHON_BACKEND_URL` añadidos a
   `.env.production`** (backup tomado antes de cada cambio) y redeploy con
   el mismo SHA ya desplegado (`1e7d53f827c787eed623a94c0bdf394a9db11253`)
   para que Next los recogiera. `PYTHON_BACKEND_URL=http://demo-decoracion-ai-api:8000`
   — ambos contenedores están en la red `stack_web`, se resuelven por
   nombre sin exponer ningún puerto.
2. **Contrato validado con una llamada real, no una simulación.** Se
   confirmó primero que `PYTHON_BACKEND_ENABLED` seguía sin definirse y que
   `POST /api/internal/ai/echo` respondía `backend: "next"` (con una cookie
   de sesión calculada dentro del propio contenedor —
   `sha256(APP_PASSWORD)`, nunca leída en texto plano fuera de ese
   proceso). Se confirmó también, antes de tocar nada, que
   `PYTHON_BACKEND_ENABLED` es consumido únicamente por
   `src/lib/ia/python-adapter.ts`, y ese módulo solo lo importa
   `src/app/api/internal/ai/echo/route.ts` — ninguna ruta de Happie, chat o
   generación depende de este flag, así que activarlo no podía afectarlas.
3. **Canario controlado:** `PYTHON_BACKEND_ENABLED=true`, redeploy, y la
   misma llamada devolvió `{"backend":"python", ...}` con el mismo payload
   y IDs correctos — primera solicitud real de la migración que cruza
   Next → Python con HMAC real, nonce real y el rol restringido de Neon de
   por medio.
4. **Rollback probado de verdad:** con `PYTHON_BACKEND_ENABLED=true`
   todavía activo, se añadió `PYTHON_BACKEND_KILL_SWITCH=true` y se
   redesplegó. La misma llamada volvió a devolver `backend: "next"` — el
   kill switch gana sobre el flag de activación, tal como exige el
   invariante 6, comprobado contra el despliegue real y no solo en tests
   locales.
5. **Estado final restaurado al default seguro:** se añadieron
   `PYTHON_BACKEND_ENABLED=false` y `PYTHON_BACKEND_KILL_SWITCH=false` al
   final de `.env.production` (los parsers de env-file, incluido el de
   Docker, toman la última ocurrencia de una clave repetida) y se
   redesplegó una última vez. Verificado: el eco vuelve a `backend: "next"`
   por defecto, y Happie sigue en `200`. La sesión de hoy fue una
   validación completa de la Fase 6, no una decisión de cortar tráfico real
   a Python — esa decisión de cutover, por capacidad y con evidencia, es
   explícitamente el alcance de la Fase 10.

**Con esto, el criterio de salida completo de
`prompt-seguimiento-etapa-5.md` queda satisfecho con evidencia real:**
backend desplegado, PostgreSQL de staging migrado (schema `operational`),
secreto HMAC provisionado, contrato Next → Python validado, canario
controlado, y rollback comprobado. Ningún punto de estos se afirma sin la
llamada real que lo respalda, documentada arriba.

## Qué queda pendiente después de esto

- **La decisión de cutover real** (activar Python de forma permanente para
  algún endpoint o capacidad) no se tomó hoy y no se toma implícitamente
  por haber probado el canario — corresponde a la Fase 10, por capacidad y
  con evidencia de antes/después, no a esta validación.
- `services/ai-api` no tiene builds ni tests corriendo en CI todavía más
  allá de `python-quality` (que sí corre en cada push, ver
  `.github/workflows/checks.yml`), pero no hay ningún job que reconstruya
  ni redespliegue automáticamente su imagen Docker — el despliegue de hoy
  fue manual y así queda hasta que se decida construir ese mecanismo.
- Las notas `-- rollback:` de `services/ai-api/migrations/001_operational_schema.sql`
  nunca se ejercitaron de verdad (`DROP SCHEMA operational` no se probó) —
  no hizo falta porque no hubo ningún fallo que revertir.

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
