"""D-038: «el mismo globo» de TypeScript agrupa los paquetes como ``mismo_globo`` de Python.

``contracts/domain/v1/golden/mismo-globo/vectores.json`` lo escribe
``scripts/motor/generar-vectores-mismo-globo.py`` con el código de ``plan._candidate`` y
``presentaciones.mismo_globo``; ``scripts/test/test-mismo-globo.ts`` exige a TypeScript el mismo
grupo. Esta prueba ata el otro lado: si cambia cómo Python normaliza una fila (colores, texto,
diámetro) o cómo compara dos globos, los vectores dejan de ser verdad y hay que regenerarlos (y
copiar el cambio a ``src/lib/globos3d/motor/crosswalk-mismo-globo.ts``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from app.plan import _candidate
from app.presentaciones import mismo_globo

SNAPSHOT = "snapshot-vectores"
FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "mismo-globo"
    / "vectores.json"
)
VECTORES = cast(
    list[dict[str, object]], json.loads(FIXTURE.read_text(encoding="utf-8"))["vectores"]
)


@pytest.mark.parametrize("vector", VECTORES, ids=[str(vector["caso"]) for vector in VECTORES])
def test_el_grupo_de_python_es_el_de_los_vectores(vector: dict[str, object]) -> None:
    filas = cast(list[dict[str, object]], vector["filas"])
    candidatos = [c for c in (_candidate(fila, SNAPSHOT) for fila in filas) if c is not None]
    referencia = next(c for c in candidatos if c.variant_id == vector["pedida"])
    grupo = sorted(c.variant_id for c in candidatos if mismo_globo(referencia, c))
    assert grupo == vector["esperado"]
