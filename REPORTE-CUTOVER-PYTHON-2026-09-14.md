# Informe de paridad y cutover Python

Fecha de ejecución: 2026-09-14 09:12:40 -05:00

## Alcance

Se verificó localmente la paridad comercial del resolutor TypeScript/Python y el
camino `Next -> HTTP+HMAC -> FastAPI -> PostgreSQL` usando únicamente el
PostgreSQL Docker local. No se activó ningún entorno remoto ni se cambió Neon,
EC2, flags remotos o proveedores pagados.

## Resultado

- Bloque A: cerrado; 9/9 golden vectors pasan en ambos resolutores.
- B1: cerrado; resolución real con snapshot, estimate, quote y total coherentes.
- B2: cerrado; chat/tool registry conserva snapshot, backend Python y allowlist
  firmados; sin snapshot falla en cerrado.
- B3: cerrado localmente; `/api/generate` y `/api/plan-editar` devuelven HTTP
  409 con `causa: PYTHON_NO_SELECCIONADO` cuando el kill switch invalida un plan
  Python aprobado.
- Activación remota: fuera de alcance y no ejecutada.

## Infraestructura local

- PostgreSQL: `demo-decoracion-postgres-1`, `demo@127.0.0.1:5432/demo_rag`.
- Snapshot: `products_catalog:13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`.
- Catálogo preservado después de recrear solo `schema operational`: 1411
  productos y 3592 variantes.
- La migración Python se aplicó y el dry-run posterior informó:
  `[DRY-RUN] Nada pendiente. 1 migracion(es) ya aplicada(s).`
- El checksum inicial `79985ae...` correspondía a `HEAD`; el worktree había
  cambiado únicamente comentarios de `001_operational_schema.sql`. Se detuvo el
  servicio, se verificó que no hubiera filas `in_progress`, se recreó solo el
  schema operacional y se aplicó el SQL actual. El checksum actual es
  `8a0a102f41a371e3a82b1d74ddfa72597ee0b17b3d8d0159560124d795992f25`.
- FastAPI respondió `/readyz` con HTTP 200 durante B1/B2. El proceso local fue
  detenido al terminar las pruebas.

## Evidencia de pruebas

| Comando | Resultado real |
| --- | --- |
| `npm run plan:test-paridad` | PASS, 9/9 |
| `npm run plan:test-paridad-python` | PASS, 9/9 |
| `uv run --extra test --system-certs python -m pytest tests/test_plan_parity.py` | PASS, 9 passed |
| `npm run plan:test` | PASS; contratos, geometría, resolver, presupuesto, contexto, paridad y rollback |
| `npm run plan:test-python-e2e` | PASS; snapshot anterior, total `104463 COP` |
| `npm run plan:test-python-cutover` | PASS; backend Python, allowlist firmada y guardia `BACKEND_NO_DISPONIBLE` |
| `npm run plan:test-python-rollback` | PASS; ambas rutas devuelven `409 PYTHON_NO_SELECCIONADO` |
| `npm run contracts:check` | PASS; 9 schemas de chat y 28 de dominio |
| `npm run contracts:test` | PASS |
| `npm run contracts:test:domain` | PASS |
| `npm run contracts:test:operational` | PASS, `Operational boundary: OK` |
| `npm run contracts:test:python-adapter` | PASS, `Python adapter: OK` |
| `npm run rag:test-validation` con DSN loopback explícito | PASS, 0 fallos verificables |
| `npm run rag:test-degradation` con DSN loopback explícito | PASS, `OK` |
| `npm run rag:test-generation-resolver` con DSN loopback explícito | PASS |
| `npm run lint` | PASS; 0 errores y 27 warnings heredados |
| `npm run build --workspaces --if-present` | PASS |
| `npm run build` | PASS; 52 páginas estáticas generadas |
| `npx tsc --noEmit` | PASS |
| `uv run --extra test --system-certs python -m pytest` | PASS, 89 passed, 3 skipped, 1 warning AnyIO |
| `uv run --extra quality --system-certs ruff check app scripts tests` | PASS |
| `uv run --extra quality --system-certs ruff format --check app scripts tests` | PASS, 26 archivos formateados |
| `uv run --extra quality --system-certs mypy app scripts` | PASS |
| `uv lock --check --system-certs` | PASS |
| `git diff --check` | PASS |

## Incidentes y ejecuciones descartadas

- El primer `npm run plan:test-python-cutover` falló por consultas/fixtures del
  arnés (`NO_MATCH`) y después por ubicaciones inválidas del schema. El fixture
  quedó corregido y la ejecución final pasa.
- El primer build detectó invocaciones sin el segundo argumento tipado de los
  handlers. El arnés ahora pasa la llamada completa y el build final pasa.
- Una primera ejecución de `rag:test-validation` heredó `DATABASE_URL` desde
  `.env.local`, que apunta a un proveedor remoto. Esa salida se descartó como
  evidencia y la prueba se repitió con `postgresql://demo:demo@127.0.0.1:5432/demo_rag`.
  No se volvió a usar la variable remota.
- `tests/test_rag_eval_variance.py` se ejecutó explícitamente contra PostgreSQL
  local y falló porque el fixture RAG versionado devuelve `recall@5=0` para los
  casos `nombre-*` y `precision=0` para `filtro-*`. Es deuda preexistente del
  fixture/catalogo RAG, no una regresión del resolutor de planes.
- La suite Python general deja tres skips esperados: permisos de schema sin
  `TEST_DATABASE_URL` y dos evaluaciones RAG que requieren configuración de
  base. La corrida local específica de degradación sí pasó.

## Divergencias y riesgos abiertos

- El vector `09-a5-linea-no-geometrica` evidencia un posible bug TypeScript:
  `material_estimate.totals.waste_only_savings_cop` aplica ahorro de merma a una
  línea no geométrica (`telón`). Python reproduce TypeScript para conservar la
  paridad; no se corrigió sin una decisión de dominio.
- E2 sigue abierto: las recomendaciones de `/api/plan-editar` todavía se
  descubren mediante SQL de Next; la aplicación de la edición sí re-resuelve
  con backend y snapshot firmados.
- E3 sigue abierto: falta conservar una asociación producto-variante tipada en
  todos los consumidores de `CatalogAllowlist` y añadir un caso multi-producto.
- La activación de `PYTHON_BACKEND_ENABLED=true` solo se probó temporalmente en
  local. El kill switch conserva Next como rollback y no se tocó producción.

## Archivos principales

- `scripts/test-plan-python-e2e.ts`: B1 HTTP/HMAC real.
- `scripts/test-plan-python-cutover.ts`: B2 chat/tools y snapshot firmado.
- `scripts/test-plan-python-rollback.ts`: B3 rollback en las dos rutas.
- `src/lib/plan/aprobacion.ts`: procedencia firmada del plan.
- `src/lib/plan/resolver-backend.ts`: dueño único de selección/ejecución del backend.
- `src/app/api/generate/route.ts`: revalidación y bloqueo de planes Python.
- `src/app/api/plan-editar/route.ts`: edición con backend y snapshot del token.
- `services/ai-api/app/plan.py`: resolutor Python comercial.
- `services/ai-api/migrations/001_operational_schema.sql`: schema operacional Python.
- `docs/migracion-python/PLAN-PARIDAD-Y-ACTIVACION.md`: criterios y estado de cierre.

No se hizo commit ni staging: el worktree contiene cambios paralelos y archivos
eliminados que no pertenecen necesariamente a esta entrega.
