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
  reales (sin proveedor: `GEMINI_API_KEY=""` y
  `PYTHON_BACKEND_KILL_SWITCH=true`, ver "Actualización 2026-09-14") e
  imprime una línea JSON con métricas y casos fallidos.
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

## Actualización 2026-09-14: fixture desactualizado tras reimportar el catálogo local

**Síntoma.** Con el Postgres local (`postgresql://demo:demo@127.0.0.1:5432/demo_rag`,
contenedor `demo-decoracion-postgres-1`) la suite fallaba: los 15 casos
`nombre-*` con `recall@5=0` y los 5 casos `filtro-*` con `precision=0`.

**Causa raíz: fixture desactualizado, no regresión del retrieval.** El
fixture versionado se generó el 2026-09-09 contra el catálogo local de
entonces (pipeline legado, 1672 productos según la sección anterior). El
2026-09-11 el catálogo local se reimportó desde el CDN bajo el snapshot
publicado
`products_catalog:13a9033d8c72f30fa60f75c825358c21537fd869bf0e666d659d7be047f0ce42`
(1411 productos / 3592 variantes, `source_kind=products_catalog`), con
otros `product_id` (catálogo "B2b"). Verificado con SQL de solo lectura:

- 0 de los 1346 `product_id` esperados por el fixture viejo existen hoy en
  `catalog_products`.
- Los 1411 productos tienen `source_snapshot_id` = ese snapshot; 0
  variantes huérfanas, 0 productos sin variantes, 0 `search_text` vacíos:
  el catálogo local es coherente e íntegro.
- El retrieval no regresionó: para los títulos del fixture viejo que
  tienen equivalente hoy (p. ej. "Lanza Confetti Niño" → "B2b Lanza
  Confetti Niño"), el producto equivalente sale en posición 0–1. Los
  predicados del script (recall@5, precisión en conjunto) eran correctos;
  simplemente comparaban contra ids que ya no existen (`ids_invalidos_total=0`
  en ambas corridas: todo lo devuelto sí pertenece al catálogo actual).

**Arreglo.**

1. Se regeneró `eval/rag/fixture-live-catalog.json` con el propio generador
   (`--generate`, sin editar ids a mano) contra el Postgres local Docker
   `demo_rag`, snapshot de arriba. El generador ahora escribe procedencia:
   `motivo`, `origen` (`loopback`, nombre de base; nunca la URL) y
   `catalogo` (`source_snapshot_ids`, productos, productos sin snapshot,
   variantes). Dos generaciones seguidas produjeron casos idénticos
   (determinismo verificado). El fixture nuevo tiene 40 casos: 15 `sku`
   (el catálogo reimportado sí tiene `sku_original`: 3588/3592 variantes,
   así que el Hallazgo 2 ya no aplica a este Postgres local), 15 `nombre`,
   5 `filtro` y 5 `sin_resultado` (la combinación "guirnalda para boda"
   no tiene productos y se omite, igual que antes).
2. `--run` ahora falla con la causa explícita en vez de un recall=0 mudo:
   métrica `fixture_ids_esperados_ausentes` y un fallo `id: "fixture"`
   ("fixture desactualizado: N de M ids esperados no existen…"), además de
   `catalogo_snapshot_ids` y `fixture_snapshot_coincide` en la salida.
   `test_stale_fixture_is_reported_as_stale_not_as_zero_recall` cubre esa
   regresión con un fixture sintético.
3. Hallazgo lateral corregido en el mismo script: `process.env.RAG_USE_VECTOR = "false"`
   no tenía efecto, porque `RAG_USE_VECTOR`/`RAG_RERANK_ENABLED`/
   `RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED` son constantes de
   `src/lib/ia/feature-flags.ts` evaluadas al importar (verificado con
   `tsx`: la constante sigue en `true` tras asignar el env). Con
   `PYTHON_BACKEND_ENABLED=true` y `RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED=true`/
   `RAG_RERANK_ENABLED=true` en el entorno del padre, la eval intentaba el
   embedding de consulta y el rerank vía Python (observado: `vector=ERROR`,
   `rerank=ERROR` solo porque `PYTHON_BACKEND_URL` no estaba configurada;
   con el backend configurado habría llamado al servicio y, para el
   embedding, al proveedor). Ahora `--run` fija `PYTHON_BACKEND_KILL_SWITCH=true`
   (leído en cada llamada, con precedencia absoluta) además de
   `GEMINI_API_KEY=""`, y cada caso falla si `vector` o `rerank` quedan en
   un estado distinto de `SKIPPED_OPTIONAL` (métrica
   `ramas_con_proveedor_usadas`). Verificado con esos flags activos en el
   padre: `ramas_con_proveedor_usadas=0` y PASS.

**Métricas (mismo Postgres local, sin proveedor).**

| Métrica | Antes (fixture 2026-09-09) | Después (fixture 2026-09-14) |
| --- | --- | --- |
| total_casos | 25 | 40 |
| sku_recall_at_5 | null (sin casos) | 1 |
| nombre_recall_at_5 | 0 | 1 |
| filtro_precision | 0 | 1 |
| sin_resultado_accuracy | 1 | 1 |
| ids_invalidos_total | 0 | 0 |
| fixture_ids_esperados_ausentes | 1346 (métrica nueva) | 0 |
| error_count | 20 | 0 |
| pytest `test_rag_eval_variance.py` | 1 failed, 1 passed | 3 passed (3 corridas independientes, correctitud idéntica; p50 9/8/9 ms) |

**Nota sobre el Hallazgo 1.** En el Postgres local `rag_source_snapshots`
ya no está vacía (snapshots `products_catalog` y `order_data` publicados el
2026-09-11). No se verificó en esta actualización si el corpus v2
(`bench-rag-v2.ts`/`eval-rag-v2.ts`) vuelve a correr: queda fuera de este
arreglo y sigue documentado como pendiente.

**Cuándo regenerar.** Cada vez que el catálogo local cambie de snapshot o
de `product_id` (`fixture_snapshot_coincide=false` o
`fixture_ids_esperados_ausentes>0`). El fixture sigue siendo de catálogo
**local**: generado contra otro Postgres (p. ej. Neon) no es
intercambiable, y la suite lo dirá con la causa en vez de con recall=0.

## Reproducción

```powershell
$env:DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"
npx tsx --conditions=react-server scripts/eval-rag-fixture.ts --generate --motivo "<por qué se regenera>"
npx tsx --conditions=react-server scripts/eval-rag-fixture.ts --run
cd services/ai-api
uv run --extra test --system-certs python -m pytest tests/test_rag_eval_variance.py -v -s
```

`scripts/eval-rag-fixture.ts` carga `.env.local` con `process.loadEnvFile`,
que **no** sobrescribe variables ya presentes en el proceso (verificado en
Node 24.16): definir `DATABASE_URL` en el mismo proceso garantiza el
Postgres local.
