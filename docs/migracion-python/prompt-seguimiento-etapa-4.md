# Prompt de seguimiento — Etapa 4

Continúa la migración Python de `demo-decoracion` hasta cerrar la Etapa 4 o
hasta encontrar un bloqueo externo real. No pidas confirmación para decisiones
reversibles: elige la opción más segura, documenta la decisión y continúa.

## Contexto verificado

- La Etapa 3 local está cerrada.
- `services/ai-api/` contiene el scaffold FastAPI, 33 modelos Pydantic
  generados desde los JSON Schema versionados, HMAC y pruebas locales.
- El store PostgreSQL/TypeScript de nonce e idempotencia está implementado,
  pero no se ha aplicado a una base remota.
- Next sigue siendo la fachada y autoridad; Python no recibe tráfico por
  defecto. `PYTHON_BACKEND_KILL_SWITCH` siempre gana.
- No se han provisionado secretos, desplegado el servicio ni ejecutado tráfico
  Next → Python real.

## Reglas de trabajo

- Inspecciona primero `git status --short`, `AGENTS.md`, `CLAUDE.md`,
  `docs/migracion-python/`, `contracts/` y `package.json`.
- Preserva todos los cambios sucios del usuario. No uses `git reset`,
  `git checkout --` ni limpiezas destructivas.
- Usa `apply_patch` para editar y `rtk` en comandos de terminal.
- Usa subagentes nativos de Codex con `gpt-5.6-luna` y razonamiento `xhigh`,
  con scopes de escritura separados. No uses OpenCode. Revisa los cambios de
  cada subagente antes de integrarlos.
- No inventes secretos, credenciales, destinos de despliegue ni autorización
  de base remota. Si falta uno, completa el trabajo local preparatorio y
  documenta el bloqueo.
- Mantén Next como rollback inmediato y no elimines rutas legacy.

## Objetivo técnico

Preparar y demostrar una migración reversible por endpoint:

1. Verificar el destino arquitectónico `demo-decoracion-api/`. Si no existe o
   no está autorizado, no lo inventes: deja una extracción reproducible desde
   `services/ai-api/` y documenta el gate.
2. Completar el adaptador Next → Python con HMAC, request/correlation IDs,
   body hash, scopes, nonce de un solo uso, idempotencia y errores estables,
   sin duplicar reglas comerciales.
3. Preparar despliegue, health/readiness, límites, timeout, cancelación,
   logs redactados, métricas mínimas y rollback por flags.
4. Aplicar la migración SQL solo en una base desechable autorizada. Si no hay
   autorización o `DATABASE_URL`, validar con fake/integración local y dejar
   el bloqueo explícito.
5. Ejecutar una prueba de contrato extremo a extremo sin proveedores pagos:
   Next por defecto, Python solo con flag, kill switch forzando Next, replay,
   conflicto, nonce repetido, timeout y errores de autenticación.
6. Mantener catálogo, disponibilidad, precios, cantidades, identidad,
   aprobación, materiales y cotización bajo la autoridad actual de Next/
   PostgreSQL.

## Criterio de salida

Entrega un informe con archivos modificados, decisiones, rollback, riesgos y
bloqueos externos. Ejecuta y reporta los checks relevantes de TypeScript,
Python, contratos, lint y build. Marca Etapa 4 como cerrada solo si existe
evidencia reproducible de integración reversible; de lo contrario, deja la
Etapa 4 en progreso con el siguiente paso exacto y sin afirmar tráfico real.
