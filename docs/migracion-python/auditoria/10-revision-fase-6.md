# Auditoría previa — Fase 6: Staging real del backend Python

**Alcance:** viabilidad real del EC2 `n8n-maros` y de Neon como destino, y el problema de distribución de contratos al repo API (capítulo 13.1 del plan).

**Método — distinto de las auditorías 3.0/4.0/5.0:** esta auditoría usó acceso real y autorizado explícitamente por el usuario en esta sesión: SSH de solo lectura al EC2 `n8n-maros` (clave `~/.ssh/n8n-maros-ssh.pem`, ya configurada en `~/.ssh/config`) y una consulta de solo lectura contra la base Neon real (`DATABASE_URL` de `.env.local`, con `default_transaction_read_only = on`). No se ejecutó ningún `docker run`/`stop`/`rm`, ningún `git push`, ninguna migración, ninguna escritura en Neon, ni se llamó a ningún proveedor de IA. Ningún valor de secreto se imprimió en ningún momento — solo nombres de variables y metadatos de conexión (`usuario@host:puerto/base`).

**Nota de metodología:** el capítulo 13.3 especifica `openai/gpt-5.6-luna` variante `xhigh` para las auditorías 3-10. Esta auditoría la hizo el orquestador (Claude) directamente, no un subagente, porque requería credenciales reales de infraestructura compartida y una decisión de riesgo (autorizar SSH/Neon de solo lectura) que correspondía confirmar con el usuario antes de delegarla — capítulo 13.5: "Nada que toque autoridad comercial" y el criterio de no delegar decisiones de arquitectura se extendió aquí a "acceso a infraestructura compartida real".

---

## 1. Verificación de evidencia

| Afirmación del plan | ¿Sigue siendo cierta? | Evidencia real verificada hoy |
|---|---|---|
| "Destino confirmado: EC2 `n8n-maros` (Docker, script de deploy ya instalado en `/home/ec2-user/deploy-demo-decoracion.sh`, responde HTTP 200)" | **Cierto, y más avanzado de lo que el plan describe: ya no es solo el destino, ya hay un despliegue vivo.** | `docker ps` muestra el contenedor `demo-decoracion` corriendo hace 5 horas (`54b610e8892f`, imagen `demo-decoracion:latest`, red no listada en `docker ps` pero el script lo conecta a `stack_web`). Responde a una petición HTTP interna (`docker exec ... curl localhost:3000/...`) con HTML válido de la app (título "Asistente de decoración \| Demo"). |
| "PostgreSQL Neon" como base del backend Python | Cierto, y ahora con datos de producción reales medidos | Neon accesible, `neondb_owner@ep-weathered-tree-axgxgn6c-pooler.c-4.us-east-2.aws.neon.tech/neondb`. Solo existe el schema `public` — el schema `operational` que exige la "condición no negociable" del capítulo Fase 6 **no existe todavía**. |
| `.github/workflows/checks.yml` y el `deploy.yml` gateado por `workflow_run` (Fase 2.1-2.3, ya commiteados localmente en `fase-1/medicion-y-migraciones-seguras`) | **No están en producción.** Existen solo en el commit local `ebf5551` de esta rama, sin mergear a `main` y sin push. | El checkout real en el EC2 (`/home/ec2-user/demo-decoracion/.git`, rama `main`) tiene `deploy.yml` disparado por `push: branches: [main]` sin ningún gate, y **no tiene `checks.yml`** (`ls` devuelve "No such file or directory"). El script real `/home/ec2-user/deploy-demo-decoracion.sh` (fuera del checkout, provisionado aparte) es la versión **vieja**: `git fetch --depth 1 origin main; git checkout FETCH_HEAD -- .` sin ningún argumento de SHA, sin validación de 40-hex, sin `git merge-base --is-ancestor`. La versión mejorada de este script (commit `ebf5551`, cap. Fase 2.3) tampoco está desplegada — vive solo en el repo, no en `/home/ec2-user/deploy-demo-decoracion.sh`. |
| `prompt-seguimiento-etapa-5.md`, puntos 2-7 (aplicar y verificar SQL, desplegar backend, validar contrato, canary reversible, probar rollback) | **Aún no aplica: no hay nada del backend Python desplegado.** | `find /home/ec2-user/demo-decoracion -maxdepth 1 -iname '*api*'` y `ls workspace` no devuelven nada. El checkout en el EC2 es únicamente el repo Next.js. |

---

## 2. Sigue en pie / ya no aplica / cambió de forma

| Punto del plan | Estado | Motivo |
|---|---|---|
| Confirmar EC2 como destino | **Ya no aplica como pregunta — está resuelto y superado.** | No solo es viable: ya está en uso activo para `demo-decoracion`. La pregunta relevante ya no es "¿se puede desplegar ahí?" sino "¿qué le falta a lo que ya está desplegado?". |
| Provisionar configuración (paso 2 de `prompt-seguimiento-etapa-5.md`) | **Cambió de forma: ya existe `.env.production`, pero sin las migraciones 020/021 aplicadas detrás.** | `.env.production` y su backup se modificaron hoy (`2026-09-08 15:50`, ~5h antes de esta auditoría) — hay actividad de despliegue reciente y activa en este mismo repositorio, probablemente de otra sesión concurrente (capítulo 13.6). |
| Aplicar y verificar SQL (paso 3) | **Sigue en pie, con un hallazgo nuevo importante.** | Neon real tiene aplicadas las migraciones **001 a 019** (`019_happie_webhook.sql` aplicada hoy mismo, `2026-09-08T14:22:13Z`). **020 (`operational_idempotency`) y 021 (`ai_call_log`, Fase 1.5 de esta sesión) NO están aplicadas.** Antes de desplegar cualquier código de esta rama que dependa de `ai_call_log` (toda la instrumentación de telemetría de Fase 1.5), hay que aplicar 021 en Neon primero — desplegar el código sin la migración causaría errores en cada intento de registrar telemetría (mitigado en parte porque `registrarLlamadaIA` atrapa sus propios fallos y no rompe el turno, pero la telemetría completa quedaría ciega). |
| Desplegar el backend Python (paso 4) | **Sigue en pie, sin empezar.** | Confirmado: no hay ningún checkout ni imagen del backend Python en el EC2. |
| Validar contrato en staging, canary reversible, probar rollback (pasos 5-7) | **Sigue en pie, sin empezar y sin poder empezar** hasta que el paso 4 exista. | — |
| Gate de despliegue por SHA (Fase 2.3, prerrequisito no explícito de Fase 6 pero real) | **Cambió de forma: implementado en el repo, no en producción.** | Ver fila de la sección 1. Mientras el script real del EC2 no sea el de `ebf5551` y `main` no tenga `checks.yml` + el `deploy.yml` gateado, cualquier push a `main` (de cualquiera de los agentes que trabajan en este repo) sigue desplegando sin checks al mismo servidor que ya sirve tráfico. |

---

## 3. Riesgo y esfuerzo por entrega

| Entrega | Riesgo | Esfuerzo | Invariante del capítulo 6 en juego |
|---|---|---|---|
| Aplicar 020/021 en Neon | Medio: es la primera vez que se aplica una migración de esta rama contra la base real, no contra un Docker desechable. El runner ya tiene las salvaguardas de la Fase 1.3 (confirmación de destino, `--allow-remote` explícito, checksum, advisory lock), así que el riesgo técnico es bajo, pero es la primera ejecución real. | Bajo — es exactamente lo que `scripts/migrate.ts --allow-remote` ya sabe hacer, una vez que alguien decida conscientemente ejecutarlo contra Neon. | Ninguno directo; indirectamente sostiene el invariante 7 (nada de telemetría de coste fantasma) al no dejar `ai_call_log` a medio poblar. |
| Mergear los gates de CI (Fase 2) a `main` y actualizar el script real del EC2 | **Alto por omisión, bajo por ejecución.** Mientras no se haga, cualquier commit a `main` de cualquier agente sigue desplegando sin red a un servidor con tráfico real. Hacerlo es mecánico (mergear, y sobrescribir `/home/ec2-user/deploy-demo-decoracion.sh` con la versión de `ebf5551`). | Bajo-medio — el script mejorado ya existe y está probado localmente; falta decidir el proceso de merge a `main` (fuera del alcance de un agente sin autoridad de merge) y desplegarlo al EC2 (una escritura real en un archivo fuera de git, en un servidor compartido). | Ninguno de los 8 directamente, pero es el prerrequisito operativo de todos: sin esto, ninguna otra fase que termine mergeada a `main` está realmente protegida. |
| Crear el schema `operational` en Neon | Bajo — es DDL aditivo (`CREATE SCHEMA`), no toca `public`. | Bajo, una vez que el runner Python (Fase 6, capítulo 10.4) exista; hoy no hay ningún runner que lo cree. | Invariante 3 y 5 indirectamente: la condición no negociable del plan es que el servicio Python no reciba permisos de lectura sobre catálogo/precios/inventario — crear el schema es el primer paso técnico de esa separación, pero por sí solo no la garantiza (falta el `GRANT`/`REVOKE` explícito que 10.4 exige verificar con un test, no un supuesto). |
| Desplegar el backend Python al EC2 | Alto — primer tráfico real Next↔Python, primer canary, primera prueba de rollback. Es exactamente el trabajo que `prompt-seguimiento-etapa-5.md` ya detalla. | Alto — no hay nada construido todavía en el EC2 para esto. | Invariante 6 (kill switch) es el que más se ejercita aquí: la primera vez que el tráfico real pase por el flag, hay que probar que el kill switch fuerza Next de verdad, no solo en local. |

---

## 4. Orden propuesto dentro de la fase

Difiere del orden que sugeriría "seguir la numeración del prompt de etapa 5 tal cual":

1. **Primero, fuera de Fase 6 en sentido estrico pero bloqueante para ella: mergear Fase 2 (CI/gates) a `main` y actualizar el script real del EC2.** Justificación nueva de esta auditoría: hay tráfico real sirviéndose desde este servidor ahora mismo, y cada commit que llegue a `main` sin gate lo toca directamente. Siendo la Fase 6 la que va a generar más actividad de despliegue (backend Python, canary), es el peor momento para seguir sin el gate real.
2. **Aplicar 020 y 021 contra Neon** con `scripts/migrate.ts --allow-remote`, antes de que cualquier código de Fase 1.5/3.x llegue a `main` y se despliegue al EC2 sin esas tablas.
3. **Crear el schema `operational` y el runner Python de migraciones (capítulo 10.4)**, con el test de permisos mínimos que el plan exige (no un supuesto).
4. **Recién ahí, los pasos 4-7 de `prompt-seguimiento-etapa-5.md`** (desplegar backend, validar contrato, canary, rollback).

---

## 5. Lo que el plan no vio

1. **El plan trata "confirmar EC2 como destino" como una decisión pendiente; ya no lo es — el EC2 ya sirve `demo-decoracion` en producción, compartido con otros tres proyectos activos** (`hermes`, `lotm`, `trainingapp`, visibles en `docker ps`). Esto cambia el perfil de riesgo de toda la Fase 6: no se trata de "elegir un servidor de staging", se trata de añadir un segundo servicio (Python) a una máquina multi-tenant que ya está sirviendo tráfico real de otro proyecto propio. El aislamiento de recursos (CPU/memoria/disco) entre `demo-decoracion` y el resto de contenedores no se auditó aquí — está fuera del alcance de "solo lectura" pero es una pregunta abierta real.

2. **La brecha entre "el gate de Fase 2 está commiteado" y "el gate de Fase 2 protege algo" es total, no parcial.** No es que falte pulir algo: `main` no tiene `checks.yml`, el `deploy.yml` de `main` sigue con el trigger `push` sin condición, y el script ejecutable real del servidor es la versión pre-Fase-2.3 sin validación de SHA. Cualquier afirmación de "Fase 2 completa" debe ir acompañada de esta salvedad explícita mientras no se mergee.

3. **Ya hay evidencia de despliegue concurrente hoy mismo** (`.env.production` modificado hace ~5 horas, migración `019` aplicada a las 14:22 del mismo día). El capítulo 13.6 del plan advierte de trabajo concurrente sobre git; esta auditoría confirma que la concurrencia también alcanza a la infraestructura de despliegue real, no solo al repositorio.

4. **No hay backup/restore verificado de la base que ya está en Neon** (esto conecta directamente con la Fase 5.2, todavía pendiente) — y Neon ya tiene datos reales de producción (`catalog_variants` ~3.724 filas, `catalog_products` ~1.671, `plan_audit_log` ~446). La Fase 6 va a añadir el servicio Python que lee/escribe en esta misma base (aunque en un schema separado); hacerlo sin que 5.2 esté resuelta significa que el primer incidente de la Fase 6 encontraría el mismo hueco que la Fase 5 ya documentó.

5. **El endpoint `/api/ia/salud` no está excluido del gate de `proxy.ts`** — una petición interna sin cookie de sesión recibe la página de login en vez de una respuesta de salud. Verificado en vivo contra el contenedor real. No se pudo determinar si esto es intencional (evitar exponer salud sin autenticar) o un descuido, porque no hay ningún comentario en el código que lo explique; es una pregunta abierta, no un hallazgo de severidad alta — el endpoint es interno, no se usa como health check de infraestructura (no hay `HEALTHCHECK` en el `Dockerfile` verificado en esta auditoría, ni un probe de EC2 que lo consulte).

---

## 6. Preguntas abiertas

1. **¿Quién tiene permiso para mergear la rama `fase-1/medicion-y-migraciones-seguras` a `main`?** Sin eso, todo el trabajo de Fase 2 (y 3, 4, 5 de esta sesión) sigue sin proteger el `main` real ni el EC2 real, sin importar cuántos commits locales existan.
2. **¿Quién actualiza `/home/ec2-user/deploy-demo-decoracion.sh`?** Vive fuera del checkout de git (es un archivo provisionado aparte, referenciado por `authorized_keys` con `command=`), así que un merge a `main` no lo actualiza solo — hace falta un paso manual (o un mecanismo de sincronización que hoy no existe) para que el script mejorado de Fase 2.3 reemplace al viejo.
3. **¿Aplicar 020/021 a Neon ahora, o esperar a que el código que los usa esté mergeado a `main`?** Aplicarlos antes es seguro (son aditivos) pero deja el runner de migraciones de producción por delante del código desplegado; aplicarlos después es más ortodoxo pero exige coordinar el orden exacto del despliegue.
4. **¿El EC2 tiene límites de recursos (CPU/memoria/disco) reservados por servicio, o los cuatro proyectos compiten por lo mismo?** No verificado en esta auditoría — requeriría inspeccionar límites de Docker (`--memory`, `--cpus`) por contenedor, que ninguno de los `docker run` observados (ni el de `demo-decoracion` ni los de los otros tres proyectos) parece declarar.
5. **¿Existe ya un plan de qué pasa con las tres copias de idempotencia** (`operational_idempotency`, `happie_webhook_requests`, el store Python sobre la primera) **cuando el schema `operational` se cree de verdad?** El capítulo 10.7 del plan lo deja para la Fase 6 sin más detalle; esta auditoría no encontró ninguna decisión adicional tomada al respecto.
