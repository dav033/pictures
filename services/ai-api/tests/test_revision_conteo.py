"""Regresiones de la revisión adversaria de feat/guirnaldas (conteo de la foto, ADR-0031).

Cada prueba lleva el id del hallazgo (scratchpad/revision/hallazgos.json) y
falla contra el código anterior al arreglo.
"""

from __future__ import annotations

from typing import cast

import pytest

from tests.test_conteo_foto import (
    _conteo,
    _conteos,
    _estructura,
    _guirnalda,
    _plan_geometrico,
    _resolver_geometrico,
    _supuestos,
)

MAX_LARGO_SUPUESTO = 240
MAX_SUPUESTOS = 30


def _arco(nombre: str) -> dict[str, object]:
    return {
        **_guirnalda(estructura_id="EST_01_ARCO", nombre=nombre),
        "tipo": "arco",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3, "alto_m": 2.4},
    }


# --- 3 = 9 = 31: el supuesto del conteo cabe en el contrato ------------------------------


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("nombre", "estimado", "por_tamano"),
    [
        # Densidad y las dos medidas con un nombre corriente (antes: invalid_plan 422).
        ("Arco orgánico de entrada principal del salón", 190, []),
        # Mezcla, densidad y medidas con el nombre más corto.
        ("Arco", 70, [{"clase": "mediano", "proporcion": 1.0}]),
        ("Arco", 210, [{"clase": "mediano", "proporcion": 1.0}]),
        # El nombre más largo que admite el contrato.
        ("A" * 160, 190, []),
    ],
)
async def test_31_el_supuesto_del_conteo_no_pasa_de_240_caracteres(
    nombre: str, estimado: int, por_tamano: list[dict[str, object]]
) -> None:
    resolved = await _resolver_geometrico(
        _plan_geometrico(_arco(nombre)),
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=estimado, por_tamano=por_tamano)],
    )
    [conteo] = _conteos(resolved)
    assert conteo["decision"] == "ajustado"
    supuestos = _supuestos(resolved)
    assert supuestos and all(len(s) <= MAX_LARGO_SUPUESTO for s in supuestos), supuestos
    # La cifra y el ajuste sobreviven al recorte.
    assert any("la foto muestra" in s and "quedó en" in s for s in supuestos), supuestos


@pytest.mark.anyio
async def test_31_el_conteo_no_pasa_del_tope_de_30_supuestos() -> None:
    plan = _plan_geometrico(_guirnalda())
    plan["supuestos"] = [f"supuesto previo {n}" for n in range(MAX_SUPUESTOS)]
    resolved = await _resolver_geometrico(
        plan, completar_conteos=True, pistas_conteo=[_conteo(estimado_total=60)]
    )
    assert _estructura(resolved)["densidad"] == "lujosa"
    assert len(_supuestos(resolved)) == MAX_SUPUESTOS
    # El detalle sigue en conteos_referencia, fuera del hash.
    assert _conteos(resolved)[0]["decision"] == "ajustado"


def test_31_el_aviso_de_patron_degradado_de_la_guirnalda_cabe() -> None:
    from app.supuestos import agregar_supuesto, supuesto

    texto = supuesto(
        "G" * 160,
        "el patrón por racimos no cabe en lo que se compra; queda el patrón sugerido y el"
        " armado de sus racimos.",
    )
    assert len(texto) <= MAX_LARGO_SUPUESTO and texto.endswith("racimos.")
    lista = [f"s{n}" for n in range(MAX_SUPUESTOS)]
    assert agregar_supuesto(lista, texto) is False and len(lista) == MAX_SUPUESTOS


def _cuenta_de(resolved: dict[str, object]) -> int:
    return cast(int, _conteos(resolved)[0]["globos_despues"])
