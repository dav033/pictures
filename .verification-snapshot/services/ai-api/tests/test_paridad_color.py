"""The chromatic distance ``catalog.py`` substitutes colors with is TypeScript's.

``src/lib/rag/catalog/similitud-color.ts`` owns the CIELAB table and exports it
into the catalog-search.v1 contract as ``x-tonos-colores-catalogo``; Python reads
it from there. The table cannot drift (``contracts:check`` regenerates it), but
``_chromatic_distance`` is written by hand in both languages, so this suite pins
its answers to the numbers measured in TypeScript with the same pairs.

It replaces ``scripts/ops/verificar-paridad-color.py``, which checked exactly
this and was run by no test script and no CI job.
"""

from app.catalog import (
    _DELTA_E_MAX,
    _DELTA_E_SCALE,
    _LAB,
    _UNSOLD_COLORS,
    _chromatic_distance,
    _nearest_present_color,
    purchase_color_for_unsold,
)

#: Measured in TypeScript (`puntuacionCromatica`) with these same pairs.
_TYPESCRIPT_DISTANCES = {
    ("naranja", "cafe"): 0.511,
    ("dorado", "crema"): 0.562,
    ("fucsia", "rosado"): 0.481,
    ("violeta", "morado"): 0.190,
    ("rojo", "rojo"): 0.0,
}


def test_the_contract_carries_what_python_needs_to_measure() -> None:
    assert _DELTA_E_SCALE == 100
    assert _DELTA_E_MAX == 45
    # "gris" is observable in a photo and not sold: it must be measurable and
    # excluded from what a substitution may return.
    assert _UNSOLD_COLORS == frozenset({"gris"})
    assert "gris" in _LAB
    assert all(len(lab) == 3 for lab in _LAB.values())


def test_python_measures_the_same_distance_as_typescript() -> None:
    for (one, other), expected in _TYPESCRIPT_DISTANCES.items():
        assert abs(_chromatic_distance(one, other) - expected) < 0.002, (one, other)


def test_grey_is_bought_as_silver_and_not_as_black() -> None:
    # The hue-angle model this replaced tied every neutral at 0.35 and broke the
    # tie alphabetically, so a matte grey photo bought black balloons.
    assert _nearest_present_color("gris", ["negro", "plateado", "blanco", "dorado"]) == "plateado"
    assert purchase_color_for_unsold("gris") == "plateado"
    # A sold color needs no stand-in.
    assert purchase_color_for_unsold("rojo") is None
