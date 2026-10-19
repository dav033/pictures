"""Colors a product's title says better than the catalog's derived colors.

The derived catalog colors are Shopify color FAMILIES. The live catalog files all four wine balloons (Fashion
Merlot round, Link-O-Loon and Tubito, Metal Vinotinto) as "rojo", so a photo's burgundy could not be searched, was
replaced by another hue, and left the plan (CASE-006, auditoría de propiedades huérfanas, 2026-10-05).

One owner for the Python side: ``plan._product_colors`` labels and covers with it, ``catalog`` searches with it.
Mirror of ``TITULO_VINO`` and ``patronTituloDeColorSql`` in ``src/lib/plan/colores-producto.ts``.
"""

from __future__ import annotations

import re

#: A wine shade in a folded (lowercase, no accents) title.
WINE_TITLE = re.compile(
    r"\b(?:merlot|vinotinto|vino tinto|burdeos|borgona|granate|marsala|burgundy|wine)\b"
)

#: The color a title rule gives and the catalog family it replaces.
COLOR_BURDEOS = "burdeos"
FAMILIA_BURDEOS = "rojo"


def patron_titulo_sql(color: str) -> str | None:
    """The title rule of ``color`` as a Postgres regex (``\\y`` is ARE's word boundary), or ``None``."""
    if color.strip().lower() != COLOR_BURDEOS:
        return None
    return WINE_TITLE.pattern.replace(r"\b", r"\y")


__all__ = ["COLOR_BURDEOS", "FAMILIA_BURDEOS", "WINE_TITLE", "patron_titulo_sql"]
