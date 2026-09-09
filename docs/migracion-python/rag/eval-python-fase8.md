# Suite de evaluación del RAG en pytest (Fase 8.1)

**Corte:** 2026-09-09. **Alcance:** entrega 8.1 de `docs/migracion-python/PLAN-MAESTRO-V2.md`
("Suite de evaluación del RAG en pytest con fixtures versionados... Solo
lee. Cero autoridad"). Sin escrituras a la base en ningún paso.

## Qué se construyó

- `scripts/eval-rag-fixture.ts` — generador y runner de un fixture
  reproducible. `--generate` construye `eval/rag/fixture-live-catalog.json`
  con selección **determinista** (`ORDER BY id`, nunca `random()`) contra
  `catalog_products`/`catalog_variants` en vivo: 15 casos de nombre, hasta 6
  de filtro (ground truth calculado con SQL directo, igual que
  `scripts/eval-retrieval.ts`), 5 de "sin resultado", y SKU cuando el
  Postgres usado tiene `sku_original` poblado (ver hallazgo abajo).
  `--run` ejecuta cada caso contra `buscarHibrido()`/`buscarCatalogoRag()`
  reales (sin proveedor: `GEMINI_API_KEY=""`, `RAG_USE_VECTOR=false`, mismo
  patrón que `scripts/bench-rag-v2.ts --no-key`) e imprime una línea JSON
  con métricas y casos fallidos.
- `services/ai-api/tests/test_rag_eval_variance.py` — el punto de entrada
  pytest de la entrega. Corre `eval-rag-fixture.ts --run` en **3 procesos
  independientes**, exige que las 6 métricas de correctitud (recall SKU,
  recall nombre, precisión de filtro, acierto de "sin resultado", IDs
  inválidos, conteo de errores) sean **exactamente idénticas** entre las 3
  corridas — no un umbral de tolerancia inventado, sino la garantía de
  determinismo que la entrega pide: mismo fixture, mismo Postgres, sin
  proveedor real, cero varianza esperada. La latencia sí se reporta (con su
  desviación estándar) pero nunca se le exige un valor, porque varía
  legítimamente con la máquina y la carga.
- Se salta limpio (`pytest.mark.skipif`) si `DATABASE_URL` no está
  configurada, mismo patrón que `tests/test_operational_schema_permissions.py`.

Pytest nunca reimplementa la lógica de scoring del retrieval — solo
orquesta el binario TypeScript existente y audita su estabilidad entre
corridas. `src/lib/rag/retrieval/search.ts` sigue siendo el único dueño de
la lógica de negocio, tal como exige el principio de "un dueño por regla".

## Hallazgo 1: el corpus "v2" (`bench-rag-v2.ts`/`eval-rag-v2.ts`) está roto, no relacionado con esta sesión

`eval/rag/queries-v2.jsonl` (416 casos, con `ground-truth-v2.jsonl`) es el
corpus fijo más completo que existe en el repo, pero depende de una fila
publicada en `rag_source_snapshots` con un `source_sha256` específico —
esa fila la escribe `scripts/import-cdn-catalog.ts`, el pipeline de
regeneración con staging (migración `007_rag_regeneration_schema.sql`).

El comando que **de verdad** usa `npm run rag:sync` (`rag:import` +
`rag:embed`) es `scripts/import-shopify-catalog.ts` — un pipeline más
viejo que nunca escribe en `rag_source_snapshots`. Al momento de escribir
esto, `rag_source_snapshots` está **vacía tanto en Neon (producción) como
en el Postgres local**. `reports/rag-baseline-v2.md`, el último reporte
committeado, muestra un PASS real del 2026-08-22 contra 1411 productos —
pero el catálogo se ha resincronizado varias veces desde entonces (hoy
1672/1671 productos en local/Neon) sin que nadie vuelva a publicar un
snapshot. Como ni `bench-rag-v2.ts` ni `eval-rag-v2.ts` están conectados a
CI ni a ningún script de `package.json` (solo se invocan a mano), nadie lo
notó.

**No se arregló aquí.** Arreglar el pipeline de sincronización para que
publique snapshots de nuevo (o decidir deliberadamente retirar ese
mecanismo) es trabajo de la Fase 3/regeneración RAG, no de la Fase 8. Este
hallazgo es la razón por la que 8.1 se construyó sobre un fixture nuevo en
vez de envolver el corpus v2 existente.

## Hallazgo 2: el Postgres local no tiene `sku_original`/`sku_canonical` poblados — producción sí

Al generar el fixture se encontró que la rama de búsqueda exacta por SKU
(`queryExact()` en `src/lib/rag/retrieval/search.ts:263-264`) busca contra
`v.sku_original`/`v.sku_canonical`, **no** contra la columna legada `v.sku`.
En el Postgres local sincronizado con `npm run rag:sync`:

```
 total | con_sku_original | con_sku_canonical
-------+-------------------+-------------------
  3726 |                 0 |                  0
```

En Neon (producción, verificado de solo lectura):

```
 total | con_sku_original | con_sku_canonical
-------+-------------------+-------------------
  3723 |              3723 |               3723
```

**Producción no está afectada** — la búsqueda exacta por SKU funciona
normalmente ahí. El problema es que `scripts/import-shopify-catalog.ts`
(el pipeline legado que corre `npm run rag:sync`) nunca calcula
`sku_original`/`sku_canonical`, mientras que el Postgres local se
sincronizó con ese pipeline en algún momento y Neon con el correcto
(`import-cdn-catalog.ts` u otro que sí los calcula). Cualquiera que corra
`npm run rag:sync` localmente reproduce este mismo hueco.

**Efecto en el fixture de 8.1:** la categoría `sku` queda vacía si se
genera contra un Postgres con este hueco — `scripts/eval-rag-fixture.ts`
ya usa `sku_original` (no `sku`) a propósito, así que el fixture es honesto
sobre lo que puede y no puede probar en cada entorno, en vez de fabricar
casos que pasarían por casualidad contra la columna equivocada. Cuando se
resincronice el Postgres local con el pipeline correcto, volver a correr
`--generate` recupera la categoría `sku` automáticamente, sin tocar este
código.

## Reproducción

```powershell
$env:DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"
npx tsx --conditions=react-server scripts/eval-rag-fixture.ts --generate
npx tsx --conditions=react-server scripts/eval-rag-fixture.ts --run
cd services/ai-api
uv run --extra test python -m pytest tests/test_rag_eval_variance.py -v -s
```
