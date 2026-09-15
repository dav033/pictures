"""Grey is not silver: mirror of ``coloresRealesProducto`` (E2E 2026-09-15, ejemplo-07).

Also the variant-first colors (W2.4): a product's derived colors carry the
Shopify color FAMILIES of its tags, so they cannot label a line on their own.
"""

from __future__ import annotations

from app.plan import Candidate, _line_color, _product_colors, _variant_real_colors


def _candidate(title: str, variant_colors: tuple[str, ...], colors: tuple[str, ...]) -> Candidate:
    return Candidate(
        product_id="P-1",
        variant_id="V-1",
        sku=None,
        sku_original=None,
        source_snapshot_id="SNAP",
        source_variant_id=None,
        inventory_quantity=None,
        unidades_inferidas=None,
        title=title,
        price=1000,
        units_per_package=50,
        size_code="R-12",
        shape="redondo",
        diameter_inches=12.0,
        colors=colors,
        variant_colors=variant_colors,
        finishes=(),
        image=None,
    )


def test_variant_colors_win_over_the_product_family_colors() -> None:
    assert _variant_real_colors(
        "Globo Latex Redondo Fashion Violeta", ("violeta",), ("violeta", "morado")
    ) == ("violeta",)


def test_without_variant_colors_the_product_colors_stay() -> None:
    """25 round latex products have no variant colors: an empty list is uncoverable."""
    assert _variant_real_colors("Globo Latex Redondo Fashion Merlot", (), ("rojo", "burdeos")) == (
        "rojo",
        "burdeos",
    )
    assert _variant_real_colors("Globo Latex Redondo Fashion Gris", (), ("plateado",)) == ("gris",)


def test_line_color_uses_the_single_real_color_of_the_variant() -> None:
    title = "Globo Latex Redondo Fashion Violeta"
    violeta = _candidate(
        title,
        _variant_real_colors(title, ("violeta",), ("violeta", "morado")),
        ("violeta", "morado"),
    )
    assert _line_color(violeta, "morado") == "violeta"
    assert _line_color(violeta, "violeta") == "violeta"
    assert _line_color(violeta, None) == "violeta"


def test_line_color_keeps_the_requested_color_when_the_variant_has_several() -> None:
    title = "Globo Latex Redondo Fashion Merlot"
    merlot = _candidate(
        title, _variant_real_colors(title, (), ("rojo", "burdeos")), ("rojo", "burdeos")
    )
    assert _line_color(merlot, "burdeos") == "burdeos"
    assert _line_color(merlot, "rojo") == "rojo"
    assert _line_color(merlot, None) == "rojo"


def test_grey_title_replaces_derived_silver() -> None:
    assert _product_colors("B2b Globo Latex Redondo Fashion Gris", ("plateado",)) == ("gris",)


def test_silver_products_keep_their_colors() -> None:
    assert _product_colors("B2b Globo Latex Redondo Reflex Plata", ("plateado",)) == ("plateado",)
    assert _product_colors("Globo Gris Plata Duo", ("plateado",)) == ("plateado",)


def test_grey_is_added_first_and_other_colors_stay() -> None:
    assert _product_colors("Globo Silk Nuevo Gris Medianoche", ("Negro",)) == ("gris", "negro")
