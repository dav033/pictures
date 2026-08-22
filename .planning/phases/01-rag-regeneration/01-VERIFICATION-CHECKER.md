# Plan verification checker — Phase 01

Fecha: 2026-08-21/22  
Checker: `gsd-plan-checker`  
Resultado: **PASS — planes ejecutables después de correcciones**

## Alcance revisado

Se revisaron los ocho planes `01-01` a `01-08`, junto con:

- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/STRUCTURE.md`
- `.planning/codebase/STACK.md`
- `.planning/codebase/INTEGRATIONS.md`
- `.planning/codebase/CONVENTIONS.md`
- `.planning/codebase/TESTING.md`
- `.planning/codebase/CONCERNS.md`

No se ejecutó código del RAG ni se modificó esquema/datos. Solo se corrigieron
los documentos de planificación para cerrar blockers de ejecución.

## Resultado por dimensión

### Completitud de tareas — PASS

Cada plan tiene exactamente tres tareas. Cada tarea tiene los cuatro elementos
operativos requeridos por este repositorio:

| Plan | Tareas | `name` | `files`/archivos | `action` | `verify` | `done` |
|---|---:|---:|---:|---:|---:|---:|
| 01 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 02 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 03 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 04 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 05 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 06 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 07 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| 08 | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

Los `verify` ahora incluyen invocaciones concretas (`npx tsx`, Docker,
`git check-ignore`, `rg`) y códigos de salida/umbrales, en lugar de depender
solo de una revisión manual.

### Dependencias y waves — PASS

La gráfica es acíclica y todos los IDs referenciados existen:

```text
01 → 02 → 03 → 04 ─┐
             └→ 05 ─┴→ 06 → 07 → 08
```

El Plan 08 además declara explícitamente todos los planes anteriores. Ningún
plan depende de otro de su misma wave o de una wave posterior. Plan 05 no
depende de órdenes (correcto); Plan 06 sí espera el agregado de órdenes y la
taxonomía/parser (correcto).

### Ownership de archivos — PASS

Se extrajeron los `files_modified` del frontmatter y no hay archivos repetidos
entre planes. Cada plan queda en cinco archivos o menos; cada uno tiene dos o
tres tareas. No hay checkpoint mezclado con implementación y todos permanecen
`autonomous: true`.

### Must-haves — PASS

Los ocho planes contienen `truths`, `artifacts` y `key_links`. Los must-haves
son resultados observables, no una repetición de nombres de tareas:

- runtime sano y fallback sin Gemini;
- contratos/hash/PII de las fuentes;
- publicación de productos ACTIVE, precio positivo y SKU ambiguo;
- agregados de órdenes sin PII e idempotentes;
- taxonomía con estados y parser determinista-first;
- retrieval con filtros de la misma variante y fallback sin embeddings;
- benchmark fijo con ground truth independiente;
- E2E, promoción/stale-data/rollback y release auditable.

### Cobertura P0 — PASS

| P0/criterio global | Plan que lo cierra | Evidencia de salida |
|---|---|---|
| Docker/Postgres/pgvector/build | 01 | `docker compose config`, health y build |
| Contrato real CDN y hashes | 02 | Zod, manifest, fixtures y hash |
| ACTIVE/precio/stock/IDs/SKU | 03 | staging, constraints, doble ingesta |
| Órdenes sin PII | 04 | agregado, scan y doble corrida |
| Color/forma/tamaño/unknown | 05 | taxonomía versionada y matriz 3/3 |
| Precio/variante/fallback/relevancia | 06 | SQL/RRF, whitelist y EXPLAIN |
| Ground truth reproducible | 07 | corpus fijo de 400+ y gates |
| E2E/promoción/rollback | 08 | prueba determinista/opcional y runbook |

La cobertura coincide con los diez invariantes no negociables de
`PROJECT.md` y con los ocho gates de `ROADMAP.md`. No queda un P0 sin plan.

## Correcciones aplicadas antes de aprobar

### 1. El Plan 06 no conectaba su `search-v2` con producción

Los callers existentes importan `buscarHibrido` desde
`src/lib/rag/retrieval/search.ts` (`buscar.ts` y `por-rol.ts`). Crear solo
`search-v2.ts` habría dejado el camino real usando el motor viejo. Se corrigió
`01-06-PLAN.md` para modificar el módulo existente, conservar la fachada
`buscarHibrido` y verificar explícitamente los caminos de catálogo y
presupuesto. Esto evita declarar un benchmark verde de código que la aplicación
no ejecuta.

### 2. El build baseline tenía una corrección fuera del alcance declarado

El build real falla porque `src/app/page.tsx` pasa `editable` y `onAplicar` a
`TarjetaCotizacion`, mientras el componente solo declara `cotizacion`. Se
añadió `src/components/TarjetaCotizacion.tsx` al `files_modified` y a la tarea
de build de `01-01-PLAN.md`, con una verificación explícita de reproducir y
corregir esa incompatibilidad antes de aceptar `npm run build`.

### 3. Verificaciones implícitas

Se añadieron comandos/flags de aceptación a los Planes 02–08:
`--offline`, `--fixtures`, `--manifest`, `--schema`, `--canonicalize`,
`--idempotency`, `--no-key`, `--smoke`, `--gate`, `--validate-corpus`,
`--repeat` y `--with-gemini`. Los fixtures se movieron a `eval/fixtures` para no
requerir cambios en `.gitignore`. Estos flags son parte del contrato de cada script
y deben implementarse junto con el script; no son comandos manuales opcionales.

### 4. Riesgo de sobrescribir estado/release existente

`01-08-PLAN.md` ahora exige añadir un bloque RAG a `release-manifest.json` sin
borrar los metadatos LoRA existentes. El cierre de STATE solo puede reportar
PASS/SKIPPED/BLOCKED con evidencia.

## Notas no bloqueantes

- El runtime está actualmente vacío (sin contenedor, imagen, volumen ni
  `DATABASE_URL`), pero eso es el estado inicial que Plan 01 debe resolver; no
  es un defecto de la secuencia.
- La rama Gemini/vector sigue siendo opcional. Los gates requieren que exact,
  FTS y trigram funcionen sin key y que un skip sea explícito.
- Las URLs remotas y los conteos son snapshots versionados; si el hash cambia,
  el corpus/ground truth debe regenerarse. No se debe “forzar” el gate contra
  los conteos históricos.
- Los planes declaran comandos `npx tsx` para mantenerlos ejecutables sin
  añadir un framework de tests no presente en `package.json`.

## Decisión final

**PASS.** La fase está lista para ejecución secuencial por waves. La ausencia
actual de Docker/DB/Gemini se conserva como condición verificable de Wave 1,
no se maquilla como PASS. Si un script no implementa alguno de los flags de
aceptación definidos arriba, el plan correspondiente debe detenerse y quedar
`BLOCKED`; no se permite marcarlo completo por la mera existencia de archivos.
