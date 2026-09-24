"""The mix rules ``plan.py`` counts with come from ``src/lib/plan/mezclas.ts``.

``mezclas.ts`` exports them into the plan-decoracion.v1 contract as
``x-reglas-mezclas``. Only the shape of the substitution rule (adjacent step
and ratio cap) is still written in both languages, so the contract also
carries the pair table the TypeScript rule produces, and this suite requires
the Python rule to give exactly the same answer pair by pair.
"""

from app.generated_models import contract_schema
from app.plan import (
    _DIAMETROS_ESTANDAR,
    _MANDATORY_SIZE,
    _MIXES,
    _admissible_substitution,
)

_RULES = contract_schema("PlanDecoracion")["x-reglas-mezclas"]


def test_resolver_counts_with_the_exported_mix_table() -> None:
    exported = {
        mix: tuple((size["pulgadas"], size["proporcion"]) for size in sizes)
        for mix, sizes in _RULES["mezclas"].items()
    }
    assert _MIXES == exported
    assert _DIAMETROS_ESTANDAR == tuple(_RULES["diametros_estandar"])


def test_python_substitution_rule_matches_the_typescript_table_pair_by_pair() -> None:
    table = _RULES["sustituciones_admisibles"]
    assert set(table) == {str(size) for size in _DIAMETROS_ESTANDAR}
    for requested in _DIAMETROS_ESTANDAR:
        for available in _DIAMETROS_ESTANDAR:
            expected = requested == available or available in table[str(requested)]
            assert _admissible_substitution(requested, available) is expected, (requested, available)


def test_non_standard_diameters_are_never_a_substitution() -> None:
    for requested, available in ((11, 12), (12, 11), (16, 18), (5, 7)):
        assert _admissible_substitution(requested, available) is False


def test_mandatory_size_grammar_is_the_exported_pattern() -> None:
    assert _MANDATORY_SIZE.pattern == _RULES["patron_tamano_obligatorio"]
    for text, size in (("R-12", "12"), ("r12", "12"), (" 24 ", "24")):
        match = _MANDATORY_SIZE.match(text)
        assert match is not None and match.group(1) == size
    for text in ("12.5", "R-١٢", "", "1e2", "R-1234"):
        assert _MANDATORY_SIZE.match(text) is None, text
