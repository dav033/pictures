"""Grey is not silver: mirror of ``coloresRealesProducto`` (E2E 2026-09-15, ejemplo-07)."""

from __future__ import annotations

from app.plan import _product_colors


def test_grey_title_replaces_derived_silver() -> None:
    assert _product_colors("B2b Globo Latex Redondo Fashion Gris", ("plateado",)) == ("gris",)


def test_silver_products_keep_their_colors() -> None:
    assert _product_colors("B2b Globo Latex Redondo Reflex Plata", ("plateado",)) == ("plateado",)
    assert _product_colors("Globo Gris Plata Duo", ("plateado",)) == ("plateado",)


def test_grey_is_added_first_and_other_colors_stay() -> None:
    assert _product_colors("Globo Silk Nuevo Gris Medianoche", ("Negro",)) == ("gris", "negro")
