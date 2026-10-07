"""Una talla que el producto no tiene se sirve con la más cercana del MISMO producto.

Banco de fotos 04 (2026-10-06): el motor de la columna orgánica sube el globo grande de la punta a R-36 cuando la
punta es ancha, el Reflex Dorado del catálogo llega hasta R-24 y, como el 36 no estaba en la escalera de
diámetros de ``mezclas.ts``, ningún producto podía servirlo: la confirmación respondía SIN_COBERTURA nueve veces
y la vista guiada se quedaba sin plan. Con el 36 en la escalera, el R-36 se compra como R-24 del mismo producto y
la línea lleva su sustitución, que es lo que se le dice al cliente.
"""

from app.plan import _DIAMETROS_ESTANDAR, Candidate, _admissible_substitution, _choose, _line


def _reflex_dorado(diametro: int) -> Candidate:
    return Candidate(
        product_id="8634255638823",
        variant_id=f"v-{diametro}",
        sku=None,
        sku_original=None,
        source_snapshot_id="snap",
        source_variant_id=None,
        inventory_quantity=None,
        unidades_inferidas=None,
        title="B2b Globo Latex Redondo Reflex Dorado",
        price=10_000,
        units_per_package=3 if diametro >= 24 else 12,
        size_code=f"R-{diametro}",
        shape="redondo",
        diameter_inches=float(diametro),
        colors=("dorado",),
        variant_colors=("dorado",),
        finishes=("reflex",),
        image=None,
    )


def test_la_escalera_llega_al_36() -> None:
    assert _DIAMETROS_ESTANDAR[-1] == 36
    assert _admissible_substitution(36, 24) is True
    # El tope de razón sigue mandando: un 36 nunca se sirve con un 18.
    assert _admissible_substitution(36, 18) is False


def test_un_r36_que_el_producto_no_tiene_se_compra_como_su_r24() -> None:
    candidatos = [_reflex_dorado(diametro) for diametro in (5, 9, 12, 18, 24)]
    elegido = _choose(candidatos, 36.0, "dorado", 1, exact=False)
    assert elegido is not None and elegido.diameter_inches == 24.0
    linea = _line("EST_01_COLUMNA", elegido, 1, "dorado", 36.0)
    assert linea["sustitucion"] is not None
    assert linea["sustitucion"]["pedido"] == "R-36"
    assert linea["sustitucion"]["entregado"] == "R-24"


def test_con_talla_exacta_no_hay_sustitucion() -> None:
    candidatos = [_reflex_dorado(diametro) for diametro in (12, 24, 36)]
    elegido = _choose(candidatos, 36.0, "dorado", 1, exact=False)
    assert elegido is not None and elegido.diameter_inches == 36.0
    assert _line("EST_01_COLUMNA", elegido, 1, "dorado", 36.0)["sustitucion"] is None


def test_una_talla_exigida_por_el_cliente_no_se_sustituye() -> None:
    candidatos = [_reflex_dorado(diametro) for diametro in (12, 24)]
    assert _choose(candidatos, 36.0, "dorado", 1, exact=True) is None
