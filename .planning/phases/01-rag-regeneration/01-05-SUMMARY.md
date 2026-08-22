---
phase: 01-rag-regeneration
plan: 05
subsystem: taxonomy-query-parser
tags: [taxonomy-v2, deterministic-parser, gemini-optional, zod, regression]
requires: [01-03]
provides: [versioned-taxonomy, deterministic-query-parser, parser-eval-matrix]
affects: [01-06, 01-07, 01-08]
tech-stack:
  added: []
  patterns: [deterministic-first, longest-alias-match, zod-safe-merge]
key-files:
  created:
    - src/lib/rag/taxonomy/v2.ts
    - src/lib/rag/query-parser/deterministic.ts
    - scripts/eval-query-parser-v2.ts
  modified:
    - src/lib/rag/query-parser/schema.ts
    - src/lib/rag/query-parser/parse.ts
    - src/lib/rag/catalog/canonicalize.ts
completed: 2026-08-21
---

# Phase 01 Plan 05: Taxonomía y parser determinista-first — Summary

Taxonomía v2 versionada y parser local determinista-first para filtros de catálogo, con Gemini opcional únicamente como enriquecimiento validado por Zod.

## Entregado

- `catalog-taxonomy-v2` centraliza categorías, paleta ampliada (incluye lila, turquesa, champagne y compuestos), acabados, patrones, ocasiones, formas y diámetros controlados.
- Cada clasificador devuelve `known`, `unknown` o `ambiguous`; los alias solapados usan longest-match, por lo que `dorado rosa` no se convierte accidentalmente en `dorado` + `rosado`.
- Se expone el desglose `base_color`/`secondary_colors` y clasificación independiente de `finish`, `pattern`, `occasion`, `category`, `forma` y `tamaño`.
- Compatibilidad de exports preservada: los nombres históricos de la taxonomía siguen disponibles desde v2.
- El parser local reconoce SKU textual sin enviarlo al modelo, precio máximo (`$100.000`, `50 mil`, `75k`), disponibilidad, forma y tamaños/códigos (`R-12`, `C-12`, `LOL-660`, `T-260`).
- `C-12` produce `forma=corazon` sin convertirlo en diámetro redondo; `T-260` produce `modelar`; un número desnudo como `12 globos` es `unknown`.
- Preferencias (“preferiría”, “me gustaría”) no se convierten en filtros duros. Alternativas ambiguas tampoco se fijan como filtros.
- Gemini solo se consulta para una interpretación local ambigua, su respuesta entra por `IntentQuerySchema`, nunca puede sobreescribir precio/forma/tamaño/disponibilidad locales y los errores vuelven al resultado local.
- Canonicalización alineada con v2: usa la taxonomía nueva, conserva fallback legado para alias aún no representados y evita mezclar colores solapados.

## Evidencia

- `npx tsc -p tsconfig.json --noEmit --pretty false` — PASS.
- `npx tsx scripts/eval-query-parser-v2.ts --taxonomy-only` — PASS, 13 checks de estado/alias, `catalog-taxonomy-v2`.
- `npx tsx scripts/eval-query-parser-v2.ts --no-key` — PASS, 82 frases × 3 repeticiones, 100% de campos etiquetados, `local_p50=0.26 ms`.
- `npx tsx scripts/eval-query-parser-v2.ts --with-gemini` — PASS con `[SKIPPED_OPTIONAL]` porque no existe `GEMINI_API_KEY`; la matriz local continúa ejecutándose.
- `npx tsx scripts/eval-query-parser.ts` — PASS, regresión histórica 12/12 estable en 3 repeticiones, cero errores.
- La evaluación v2 incluye smoke de `canonicalizeCatalog` contra `eval/fixtures/products_catalog.fixture.json` y un producto sintético sin PII para verificar `DORADO ROSA`, categoría látex y `R-12`.

## Criterios de aceptación

- [x] Parser operativo sin `GEMINI_API_KEY`.
- [x] Taxonomía known/unknown/ambiguous medible por atributo.
- [x] Al menos 50 frases fijas, repetidas tres veces.
- [x] Cero productos, precios o inventario inventados por Gemini.
- [x] Precio, SKU textual, forma, diámetro y disponibilidad determinados localmente.
- [x] Latencia p50 local muy por debajo de 50 ms.

## Desviaciones

1. **Integración crítica:** se extendió `src/lib/rag/catalog/canonicalize.ts` para que la ingesta realmente use v2; de lo contrario los nuevos filtros no encontrarían colores derivados en `p.derived`.
2. **Regresión de integración:** se añadió un smoke de canonización sobre el fixture de productos dentro de la matriz existente, sin persistir datos crudos ni PII.

No se actualizó `STATE.md` ni se creó commit, según la instrucción de ejecución del plan.
