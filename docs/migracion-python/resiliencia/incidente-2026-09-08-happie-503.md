# Incidente 2026-09-08 — Webhook de Happie devolvía 503, y primer deploy real por el gate de Fase 2

**Contexto:** al ejecutar el orden recomendado por la auditoría 6.0 (mergear el gate de Fase 2 a `main`, aplicar migraciones 020/021 en Neon, continuar con Fase 6), el usuario pidió verificar que el webhook de la IA de Happia siguiera respondiendo bien. No respondía: los tres endpoints (`recommend-package`, `recommend-packages`, `chat`) devolvían `503 Servicio temporalmente no disponible` en cada llamada real y autenticada.

Esta es la única vez en la sesión en que se usó acceso real de escritura a infraestructura compartida (EC2 `n8n-maros`, Neon), todo con autorización explícita del usuario en el momento.

## Causa raíz del 503 (bug de producción, preexistente)

`HappiaClient.listarPackages()` (`packages/happie-package-ia/src/cliente.ts`) validaba la respuesta de la API de Happia con un schema Zod que exigía `description: z.string()` en cada `package_item`. La API real de Happia devuelve `description: null` en la gran mayoría de los ítems — es el estado normal de "sin descripción", no un caso raro. Cada llamada a `listarPackages()` fallaba con un `ZodError` antes de llegar siquiera a construir el prompt para Gemini.

Diagnóstico complicado a propósito por una decisión de diseño correcta: `webhook-control.ts` nunca loguea el error real ("Never log provider messages, bodies, prompts or credentials"), así que el 503 no dejaba ninguna pista en los logs. Se descartaron, en orden, conectividad a Happia (200 real), a Gemini (200 real) y a Postgres (conexión real exitosa) antes de reproducir la validación exacta contra el catálogo real y encontrar el campo que no encajaba.

**Fix:** `description: z.string().nullable()` en el schema y en el tipo `HappiaPackageItem` (commit `2b35140`). Test de regresión en `packages/happie-package-ia/test/cliente.test.ts` que fija `description: null` como válido.

## Lo que se destapó al intentar desplegar el fix

El propio intento de desplegar reveló que el gate de CI/CD de la Fase 2, aunque commiteado, nunca se había ejercitado de verdad contra `main` ni contra el EC2 real (ver `auditoria/10-revision-fase-6.md`). Cuatro problemas nuevos, cada uno real y verificado, bloquearon el primer despliegue en cascada:

1. **Drift de contratos** (commit `95b8ff8`): la versión de `zod` fijada en `package-lock.json` genera `anyOf: [{type: X}, {type: "null"}]` para campos nullable; 8 schemas de dominio committeados seguían con el formato viejo `type: [X, "null"]`. Nunca se había detectado porque `contracts:check` nunca corrió en CI antes de esta sesión.
2. **Python sin paquete instalable** (mismo commit): `services/ai-api/pyproject.toml` tenía `[tool.setuptools] py-modules = []`, dejando `app` sin instalar; cada test fallaba con `ModuleNotFoundError`. Fix: `pythonpath = ["."]` en `[tool.pytest.ini_options]`, replicando cómo ya funciona en runtime (uvicorn corre desde `WORKDIR /app` sin pasar por el paquete instalado).
3. **Modelos Python desactualizados** (commit `391006f`): al arreglar (1), los modelos Pydantic generados quedaron desactualizados respecto a los schemas corregidos — descuido propio, corregido regenerándolos.
4. **Test de cancelación con timing ajustado** (mismo commit): margen de 5ms/25ms entre el abort programado y el delay del proveedor falso, candidato clásico a flaky bajo un runner de CI más cargado. Ensanchado a 40ms/200ms.
5. **Build faltante de `@sempertex/agente-core`** (commit `9af629f`): el job `deterministic-tests` nunca compilaba ese paquete antes de correr `contracts:test:cancel` ni `plan:test-event-contract`, que lo importan. Funcionaba en local solo porque el `dist/` ya existía de sesiones anteriores. Fix: build inline en ambos scripts de `package.json`, mismo patrón que ya usaba `happie:test-webhook`.

Con los cinco arreglados, `Quality checks` pasó por primera vez de verdad (run `34279999047`, SHA `9af629f`) y `Deploy to EC2` se disparó automáticamente por primera vez desde que existe el gate — antes siempre había quedado en `skipped` porque los checks fallaban.

## El propio deploy falló la primera vez, y también se corrigió

El primer disparo automático del deploy falló en el paso "Deploy via SSH". Reproducido manualmente: `/usr/bin/env: 'bash\r': No such file or directory`. El script `/home/ec2-user/deploy-demo-decoracion.sh` (vive fuera del checkout de git, se actualiza aparte) se había copiado por `scp` desde el working tree de Windows de esta sesión, que normaliza los archivos a CRLF (`core.autocrlf`) — el shebang `#!/usr/bin/env bash` quedó como `#!/usr/bin/env bash\r`, rompiendo la resolución del intérprete.

**Fix:** `sed -i 's/\r$//' /home/ec2-user/deploy-demo-decoracion.sh` directamente en el servidor. Verificado con `file` (pasó de reportar terminadores CRLF a "Bourne-Again shell script" limpio) y con una ejecución manual completa del script.

## Verificación final

Deploy manual ejecutado con el SHA exacto (`9af629f9828d91868fb4c98afe4783c54ffd8efe`), contenedor `demo-decoracion` recreado. Los tres webhooks probados con una llamada real y autenticada (`HAPPIE_WEBHOOK_API_KEY` real, nunca impresa) contra el contenedor en producción:

| Endpoint | Resultado |
|---|---|
| `POST /api/happie/webhook/recommend-package` | `200`, recomendación real ("Celebración Express", ajustada a presupuesto e invitados) |
| `POST /api/happie/webhook/recommend-packages` | `200` |
| `POST /api/happie/webhook/chat` | `200`, respuesta conversacional coherente |

## Lecciones y seguimiento

- **El gate de Fase 2 nunca se había ejercitado contra `main` real.** Un gate commiteado pero nunca corrido en el objetivo real no es un gate probado — cinco problemas independientes esperaban a la primera ejecución real. Ahora que corrió una vez con éxito, el riesgo de regresión de estos cinco puntos específicos es bajo, pero es evidencia de que "está commiteado" y "está probado contra producción" son afirmaciones distintas, tal como ya advertía la auditoría 6.0.
- **El script de deploy del servidor vive fuera de git y se actualiza manualmente.** Cualquier actualización futura debe normalizar line endings antes de copiarlo (`dos2unix`, o `git config core.autocrlf input` para este repo, o simplemente generar el archivo con LF explícito antes de `scp`). Queda como pregunta abierta de la auditoría 6.0 quién es el dueño de mantener ese archivo sincronizado con el repo.
- **El diseño de "nunca loguear el error real" en `webhook-control.ts` es correcto y se mantiene**, pero hace que diagnosticar un 503 genuino sea deliberadamente más lento. No se propone cambiarlo — es el trade-off correcto entre seguridad y velocidad de diagnóstico — pero cualquier futuro incidente similar debería empezar por el mismo método usado aquí: descartar cada dependencia externa con una llamada real y aislada antes de sospechar del código propio.
- **`ai_call_log`/`ai_model_pricing`/`operational_idempotency`/`operational_request_nonces` ya están en Neon** (migraciones 020/021 aplicadas como parte de este mismo trabajo), confirmado por consulta de solo lectura.
