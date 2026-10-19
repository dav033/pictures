"""Fase 8.1 (plan Fase 8): suite de evaluacion del RAG en pytest.

Reemplaza `npm run rag:eval` (scripts/eval/eval-retrieval.ts, Fase 3B, muestreo
`ORDER BY random()` no reproducible) por una suite reproducible: el fixture
que corre (eval/rag/fixture-live-catalog.json, generado por
scripts/eval/eval-rag-fixture.ts) es determinista y versionado en git, y esta
suite corre la evaluacion en varios procesos INDEPENDIENTES para reportar
si el resultado varia entre corridas.

No usa eval/rag/queries-v2.jsonl + ground-truth-v2.jsonl (el corpus "v2" de
bench-rag-v2.ts / eval-rag-v2.ts) a proposito: ese corpus depende de una
fila publicada en `rag_source_snapshots`, que scripts/catalogo/import-cdn-catalog.ts
escribe pero el pipeline que de verdad usa `npm run rag:sync`
(scripts/catalogo/import-shopify-catalog.ts) no. Al momento de escribir esto
`rag_source_snapshots` esta vacia tanto en Neon como en el Postgres local
-- ese corpus no puede correr contra ninguna base real disponible. Es un
hallazgo real y preexistente, documentado en
docs/migracion-python/rag/eval-python-fase8.md; arreglarlo es trabajo de
otra fase (el pipeline de sincronizacion), no de esta.

Solo lee. Cero autoridad: nunca escribe en la base, nunca decide nada sobre
retrieval -- eso sigue siendo exclusivamente TypeScript
(src/lib/rag/retrieval/search.ts). Este arnes es orquestacion y reporte de
varianza sobre un binario que ya existe, no una segunda implementacion de
la logica de scoring en Python.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPO_ROOT / "eval" / "rag" / "fixture-live-catalog.json"
DATABASE_URL = os.environ.get("DATABASE_URL")
INDEPENDENT_RUNS = 3
SUBPROCESS_TIMEOUT_SECONDS = 120

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason=(
        "DATABASE_URL no configurada -- apuntar al Postgres LOCAL "
        "(nunca Neon) para correr esta suite, p.ej. "
        "postgresql://demo:demo@127.0.0.1:5432/demo_rag"
    ),
)


def _run_fixture_once(fixture_path: Path = FIXTURE_PATH) -> dict[str, Any]:
    result = subprocess.run(
        [
            "npx",
            "tsx",
            "--conditions=react-server",
            "scripts/eval/eval-rag-fixture.ts",
            "--run",
            "--fixture",
            str(fixture_path),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=SUBPROCESS_TIMEOUT_SECONDS,
        env={**os.environ, "DATABASE_URL": DATABASE_URL or ""},
        shell=(os.name == "nt"),
    )
    lines = [line for line in result.stdout.strip().splitlines() if line.strip()]
    assert lines, (
        "scripts/eval/eval-rag-fixture.ts --run no imprimio ninguna linea de salida.\n"
        f"exit_code={result.returncode}\nstdout={result.stdout}\nstderr={result.stderr}"
    )
    try:
        parsed = json.loads(lines[-1])
    except json.JSONDecodeError as error:
        raise AssertionError(
            f"la ultima linea de stdout no es JSON valido: {lines[-1]!r}\nstderr={result.stderr}"
        ) from error
    assert isinstance(parsed, dict), (
        f"la ultima linea de stdout no es un objeto JSON: {lines[-1]!r}"
    )
    return parsed


@pytest.fixture(scope="module")
def fixture_metadata() -> dict[str, Any]:
    assert FIXTURE_PATH.exists(), (
        f"{FIXTURE_PATH} no existe -- generarlo con "
        "`npx tsx --conditions=react-server scripts/eval/eval-rag-fixture.ts --generate` "
        "contra el Postgres local"
    )
    data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, dict), "el fixture no es un objeto JSON"
    assert data.get("casos"), "el fixture no tiene casos"
    return data


def test_fixture_is_versioned_and_covers_required_categories(
    fixture_metadata: dict[str, Any],
) -> None:
    casos = fixture_metadata["casos"]
    categorias = {caso["categoria"] for caso in casos}
    assert categorias, "el fixture no declara categorias"
    # Procedencia obligatoria: sin el snapshot del catalogo, un fixture
    # generado contra otro catalogo (otros product_id) solo se ve como
    # recall=0, indistinguible de una regresion del retrieval.
    catalogo = fixture_metadata.get("catalogo")
    assert isinstance(catalogo, dict), "el fixture no declara 'catalogo' (regenerar con --generate)"
    assert isinstance(catalogo.get("source_snapshot_ids"), list), (
        "el fixture no declara catalogo.source_snapshot_ids"
    )
    # "sku" puede quedar vacia si el Postgres usado para generar el fixture
    # no tiene sku_original poblado (pipeline legado, ver
    # scripts/eval/eval-rag-fixture.ts). nombre/filtro/sin_resultado no dependen
    # de esa columna y sí deben estar presentes siempre.
    for categoria_obligatoria in ("nombre", "filtro", "sin_resultado"):
        assert any(caso["categoria"] == categoria_obligatoria for caso in casos), (
            f"el fixture no tiene ningun caso de categoria {categoria_obligatoria}"
        )


def test_rag_fixture_passes_and_correctness_metrics_are_deterministic(
    fixture_metadata: dict[str, Any],
) -> None:
    del fixture_metadata  # solo para forzar el skip si el fixture no existe
    runs = [_run_fixture_once() for _ in range(INDEPENDENT_RUNS)]

    for index, run in enumerate(runs):
        assert run.get("status") == "PASS", (
            f"corrida {index + 1}/{INDEPENDENT_RUNS} fallo: {run.get('failed_cases')}"
        )

    # Las metricas de CORRECTITUD deben ser identicas entre corridas
    # independientes: mismo fixture versionado, misma base, sin proveedor
    # real (GEMINI_API_KEY vacia y PYTHON_BACKEND_KILL_SWITCH=true dentro
    # del script; ramas_con_proveedor_usadas lo verifica caso a caso). Cero
    # varianza es la garantia de determinismo que pide esta entrega, no un
    # umbral inventado -- si alguna vez varia, es una regresion real de
    # estabilidad, no ruido de medicion. La latencia SI varia con la
    # maquina/carga concurrente: se reporta, nunca se le exige un valor.
    correctness_keys = [
        "sku_recall_at_5",
        "nombre_recall_at_5",
        "filtro_precision",
        "sin_resultado_accuracy",
        "ids_invalidos_total",
        "fixture_ids_esperados_ausentes",
        "ramas_con_proveedor_usadas",
        "error_count",
    ]
    for key in correctness_keys:
        values = [run["metrics"][key] for run in runs]
        distinct = {json.dumps(v) for v in values}
        assert len(distinct) == 1, (
            f"metrica de correctitud '{key}' vario entre corridas independientes: {values} "
            "-- el retrieval deberia ser determinista con proveedor falso"
        )

    latencies_p50 = [run["metrics"]["latencia_ms"]["p50"] for run in runs]
    stdev = statistics.pstdev(latencies_p50) if len(latencies_p50) > 1 else 0.0
    print(
        f"\n[reporte de varianza] correctitud identica en {INDEPENDENT_RUNS} corridas "
        f"independientes de {len(runs[0]['metrics'].keys())} metricas revisadas; "
        f"latencia p50 por corrida: {latencies_p50} ms (stdev={stdev:.2f}ms) -- "
        "se reporta, no se exige un umbral."
    )


def test_stale_fixture_is_reported_as_stale_not_as_zero_recall(tmp_path: Path) -> None:
    """Regresion 2026-09-14: el fixture versionado referenciaba product_id de
    un catalogo anterior (0 de 1346 presentes tras reimportar el snapshot) y
    la suite solo mostraba recall@5=0 / precision=0, indistinguible de una
    regresion del retrieval. El runner debe nombrar la causa."""
    stale_fixture = {
        "generado_en": "2026-09-14T00:00:00.000Z",
        "nota": "fixture sintetico de regresion: id esperado inexistente a proposito",
        "catalogo": {
            "source_snapshot_ids": ["products_catalog:snapshot-inexistente-de-prueba"],
            "productos": 0,
            "productos_sin_snapshot": 0,
            "variantes": 0,
        },
        "casos": [
            {
                "id": "nombre-stale-001",
                "categoria": "nombre",
                "consulta": {"semanticQuery": "globo", "filtros": {"disponible": False}},
                "esperadoIds": ["product-id-que-no-existe-en-el-catalogo"],
            }
        ],
    }
    fixture_path = tmp_path / "fixture-stale.json"
    fixture_path.write_text(json.dumps(stale_fixture), encoding="utf-8")

    run = _run_fixture_once(fixture_path)

    assert run["status"] == "FAIL"
    assert run["metrics"]["fixture_ids_esperados_ausentes"] == 1
    assert run["metrics"]["fixture_snapshot_coincide"] is False
    assert run["metrics"]["ramas_con_proveedor_usadas"] == 0
    first_failure = run["failed_cases"][0]
    assert first_failure["id"] == "fixture"
    assert "fixture desactualizado" in first_failure["detalle"]
